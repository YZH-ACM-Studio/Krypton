/**
 * 课程模块（PLAN 2026-07-02 §10）。
 *
 * 课程与训练共用 docType 40（TrainingDoc），靠 `kind: 'course'` 区分；
 * 复用 training model 的报名 / 进度 / 章节题目跟踪。课程额外有：
 *   - `courseGroupIds`：可见范围（userbind 班级；空 = 全域可见）
 *   - 章节 `tids`：引用制挂已有比赛/作业（比赛在比赛模块独立创建）
 *   - `term`：学期等元信息
 *
 * 章节结构是线性目录（DAG requireNids 始终为空，前端编辑器只做线性）。
 * 权限：查看 PERM_VIEW_TRAINING；建/改 PERM_CREATE_COURSE / PERM_EDIT_COURSE。
 */
import assert from 'assert';
import { escapeRegExp, pick } from 'lodash';
import { Filter, ObjectId } from 'mongodb';
import { Logger } from '@hydrooj/utils';
import { sortFiles } from '@hydrooj/utils/lib/utils';
import {
    FileLimitExceededError, FileUploadError, NotFoundError, PermissionError, ValidationError,
} from '../error';
import { TrainingDoc, TrainingNode } from '../interface';
import { PERM, PRIV, STATUS } from '../model/builtin';
import * as contest from '../model/contest';
import * as oplog from '../model/oplog';
import problem from '../model/problem';
import { assertProblemBankSelection } from '../model/problem-access';
import storage from '../model/storage';
import system from '../model/system';
import * as training from '../model/training';
import user from '../model/user';
import {
    Handler, param, post, Types,
} from '../service/server';
import { getVisibleReferencedProblems, normalizeProblemDocIds } from './problem-reference';

const logger = new Logger('course');

/** 当前用户所属的 userbind 班级 id 集合；查询失败必须向上抛出。 */
async function userGroupIds(domainId: string, uid: number): Promise<Set<string>> {
    const userbind = (global as any).Hydro?.model?.userbind;
    if (typeof userbind?.findStudentByUserId !== 'function') {
        throw new TypeError('userbind.findStudentByUserId is unavailable');
    }
    try {
        const student = await userbind.findStudentByUserId(domainId, uid);
        return new Set((student?.groupIds || []).map((g: ObjectId) => String(g)));
    } catch (error) {
        logger.error('Course user-group lookup failed domain=%s uid=%d error=%o', domainId, uid, error);
        throw error;
    }
}

/** 课程对当前用户是否可见：全域课程(空 groupIds)或用户属于其某个班级。 */
function courseVisibleTo(tdoc: TrainingDoc, myGroups: Set<string>, canManage: boolean): boolean {
    if (canManage) return true;
    const groups = tdoc.courseGroupIds || [];
    if (!groups.length) return true;
    return groups.some((g) => myGroups.has(String(g)));
}

function courseFilePrefix(domainId: string, tid: ObjectId): string {
    return `course/${domainId}/${tid}/`;
}

function listedCourseFile(tdoc: TrainingDoc, filename: string) {
    const file = (tdoc.files || []).find((item) => item.name === filename);
    if (!file) throw new NotFoundError('file');
    return file;
}

async function parseChaptersJson(domainId: string, raw: string): Promise<TrainingNode[]> {
    const parsed: TrainingNode[] = [];
    try {
        const chapters = JSON.parse(raw);
        assert(chapters instanceof Array, 'chapters must be an array');
        assert(chapters.length, 'must have at least one chapter');
        const ids = new Set(chapters.map((s) => +s._id));
        assert(chapters.length === ids.size, '_id must be unique');
        for (const node of chapters) {
            assert(node._id, 'each chapter needs an _id');
            assert(node.title, 'each chapter needs a title');
            if (node.content !== undefined && typeof node.content !== 'string') {
                throw new ValidationError('chapters', null, `章节 ${node._id} 的讲义必须是字符串`);
            }
            const pids = normalizeProblemDocIds(Array.isArray(node.pids) ? node.pids : []);
            const rawTids: string[] = Array.isArray(node.tids) ? node.tids : [];
            // 校验比赛存在。
            const tids: ObjectId[] = [];
            for (const t of rawTids) {
                let tid: ObjectId;
                try {
                    tid = new ObjectId(t);
                } catch {
                    throw new ValidationError('tids', null, `无效的比赛 id: ${t}`);
                }
                // eslint-disable-next-line no-await-in-loop
                const tdoc = await contest.get(domainId, tid).catch(() => null);
                if (!tdoc) throw new ValidationError('tids', null, `比赛不存在: ${t}`);
                tids.push(tid);
            }
            parsed.push({
                _id: +node._id,
                title: node.title,
                ...(node.content ? { content: node.content } : {}),
                requireNids: [], // 线性目录：无先修依赖
                pids,
                ...(tids.length ? { tids } : {}),
            });
        }
    } catch (e: any) {
        throw new ValidationError('chapters', null, e.message);
    }
    return parsed;
}

class CourseMainHandler extends Handler {
    @param('page', Types.PositiveInt, true)
    @param('q', Types.String, true)
    async get(_domainId: string, page = 1, q = '') {
        const domainId = String(this.domain?._id);
        const query: Filter<TrainingDoc> = { kind: 'course' };
        if (q) query.title = { $regex: new RegExp(escapeRegExp(q), 'i') };
        const isAdmin = this.user.hasPriv(PRIV.PRIV_EDIT_SYSTEM);
        const canCreate = this.user.hasPerm(PERM.PERM_CREATE_COURSE) || isAdmin;
        const canManageAll = this.user.hasPerm(PERM.PERM_EDIT_COURSE) || isAdmin;
        // 可见性下推进 mongo query，使分页计数准确（对抗性审查 #5）：全域
        // 课程(空/无 courseGroupIds)或用户所属班级的课程。管理者看全部。
        if (!canManageAll) {
            const myGroups = await userGroupIds(domainId, this.user._id);
            // 容错构造（对齐 post 路径）：畸形 id 跳过，避免整个列表页 500。
            const groupOids = Array.from(myGroups)
                .map((s) => {
                    try {
                        return new ObjectId(s);
                    } catch {
                        return null;
                    }
                })
                .filter((x): x is ObjectId => !!x);
            query.$or = [
                { owner: this.user._id },
                { courseGroupIds: { $exists: false } },
                { courseGroupIds: { $size: 0 } },
                ...(groupOids.length ? [{ courseGroupIds: { $in: groupOids } }] : []),
            ];
        }
        const [tdocs, tpcount, tcount] = await this.paginate(
            training.getMulti(domainId, query),
            page,
            'training',
        );
        const managedIds = tdocs
            .filter((tdoc) => canManageAll || this.user.own(tdoc))
            .map((tdoc) => String(tdoc.docId));
        const tids = tdocs.map((t) => t.docId);
        const tsdict = {};
        if (this.user.hasPriv(PRIV.PRIV_USER_PROFILE)) {
            const tsdocs = await training.getMultiStatus(domainId, {
                uid: this.user._id, docId: { $in: tids },
            }).toArray();
            for (const tsdoc of tsdocs) tsdict[tsdoc.docId.toHexString()] = tsdoc;
        }
        this.response.template = 'course_main.html';
        this.response.body = {
            tdocs, page, tpcount, tcount, tsdict, q, canCreate, managedIds,
        };
    }
}

class CourseDetailHandler extends Handler {
    @param('tid', Types.ObjectId)
    async get(_domainId: string, tid: ObjectId) {
        const domainId = String(this.domain?._id);
        problem.assertProblemAclDomain(this.user, domainId);
        const tdoc = await training.get(domainId, tid);
        if (tdoc.kind !== 'course') throw new ValidationError('tid', null, 'Not a course');
        const canManage = this.user.own(tdoc)
            || this.user.hasPerm(PERM.PERM_EDIT_COURSE)
            || this.user.hasPriv(PRIV.PRIV_EDIT_SYSTEM);
        // 可见性拦截（非管理者且不属于课程班级 → 拒绝）。
        if (!canManage && (tdoc.courseGroupIds || []).length) {
            const myGroups = await userGroupIds(domainId, this.user._id);
            if (!courseVisibleTo(tdoc, myGroups, false)) {
                throw new ValidationError('tid', null, '你不在该课程的可见范围内');
            }
        }
        const pids = training.getPids(tdoc.dag);
        // 解析章节引用的所有比赛。
        const allTids = Array.from(new Set<string>(
            tdoc.dag.flatMap((n) => (n.tids || []).map((t) => String(t))),
        )).map((s) => new ObjectId(s));
        const [udoc, pdict, psdict, ctdocs, tsdoc] = await Promise.all([
            user.getById(domainId, tdoc.owner),
            getVisibleReferencedProblems(domainId, pids, this.user),
            this.user.hasPriv(PRIV.PRIV_USER_PROFILE)
                ? problem.getListStatus(domainId, this.user._id, pids) : {},
            allTids.length
                ? contest.getMulti(domainId, { docId: { $in: allTids } })
                    .project({ docId: 1, title: 1, rule: 1, beginAt: 1, endAt: 1 }).toArray()
                : [],
            this.user.hasPriv(PRIV.PRIV_USER_PROFILE)
                ? training.getStatus(domainId, tdoc.docId, this.user._id) : null,
        ]);
        const cdict: Record<string, any> = {};
        for (const c of ctdocs) cdict[String(c.docId)] = c;
        // 逐章节进度（线性，无先修）。
        const donePids = new Set<number>();
        for (const pid in psdict) {
            if (!+pid) continue;
            if (psdict[pid].status === STATUS.STATUS_ACCEPTED) donePids.add(+pid);
        }
        const chapters = tdoc.dag.map((node) => {
            const total = node.pids.length;
            const done = node.pids.filter((p) => donePids.has(p)).length;
            return {
                _id: node._id,
                title: node.title,
                content: node.content || '',
                pids: node.pids,
                tids: (node.tids || []).map((t) => String(t)),
                progress: total ? Math.floor(100 * (done / total)) : 100,
                doneCount: done,
                totalCount: total,
            };
        });
        this.response.template = 'course_detail.html';
        const canDownloadFiles = this.user.hasPriv(PRIV.PRIV_USER_PROFILE);
        this.response.body = {
            tdoc, chapters, pdict, psdict, cdict, udoc, canManage, tsdoc,
            canEnroll: canDownloadFiles && !tsdoc?.enroll,
            canDownloadFiles,
            files: canDownloadFiles ? sortFiles(tdoc.files || []) : [],
        };
    }

    @param('tid', Types.ObjectId)
    async postEnroll(domainId: string, tid: ObjectId) {
        this.checkPriv(PRIV.PRIV_USER_PROFILE);
        const tdoc = await training.get(domainId, tid);
        if (tdoc.kind !== 'course') throw new ValidationError('tid', null, 'Not a course');
        // 可见范围外不允许报名。
        if ((tdoc.courseGroupIds || []).length) {
            const myGroups = await userGroupIds(domainId, this.user._id);
            if (!courseVisibleTo(tdoc, myGroups, this.user.hasPriv(PRIV.PRIV_EDIT_SYSTEM))) {
                throw new PermissionError(PERM.PERM_VIEW_TRAINING);
            }
        }
        await training.enroll(domainId, tdoc.docId, this.user._id);
        this.back();
    }
}

class CourseEditHandler extends Handler {
    tdoc: TrainingDoc;

    @param('tid', Types.ObjectId, true)
    async prepare(_domainId: string, tid: ObjectId) {
        const authoritativeDomainId = String(this.domain?._id);
        problem.assertProblemAclDomain(this.user, authoritativeDomainId);
        if (tid) {
            this.tdoc = await training.get(authoritativeDomainId, tid);
            if (this.tdoc.kind !== 'course') throw new ValidationError('tid', null, 'Not a course');
            if (!this.user.own(this.tdoc)) this.checkPerm(PERM.PERM_EDIT_COURSE);
        } else {
            this.checkPerm(PERM.PERM_CREATE_COURSE);
        }
    }

    async get(_domainId: string) {
        const authoritativeDomainId = String(this.domain?._id);
        problem.assertProblemAclDomain(this.user, authoritativeDomainId);
        // 提供可选比赛列表给编辑器挂章节。
        const groups = (global as any).Hydro?.model?.userbind?.listUserGroups
            ? await (global as any).Hydro.model.userbind.listUserGroups(authoritativeDomainId) : [];
        this.response.template = 'course_edit.html';
        this.response.body = {
            page_name: this.tdoc ? 'course_edit' : 'course_create',
            groups: groups.map((g: any) => ({ _id: String(g._id), name: g.name, archivedAt: g.archivedAt || null })),
            canManageFiles: !!this.tdoc && (this.user.own(this.tdoc) || this.user.hasPriv(PRIV.PRIV_EDIT_SYSTEM)),
            files: sortFiles(this.tdoc?.files || []),
        };
        if (this.tdoc) {
            this.response.body.tdoc = this.tdoc;
            this.response.body.chapters = JSON.stringify(
                this.tdoc.dag.map((n) => ({
                    _id: n._id,
                    title: n.title,
                    content: n.content || '',
                    pids: n.pids,
                    tids: (n.tids || []).map((t) => String(t)),
                })),
                null, 2,
            );
        }
    }

    @param('tid', Types.ObjectId, true)
    @param('title', Types.Title)
    @param('content', Types.Content)
    @param('chapters', Types.Content)
    @param('description', Types.Content, true)
    @param('term', Types.String, true)
    @param('courseGroupIds', Types.CommaSeperatedArray, true)
    async post(
        _domainId: string, tid: ObjectId,
        title: string, content: string, chaptersJson: string,
        description = '', term = '', courseGroupIds: string[] = [],
    ) {
        const authoritativeDomainId = String(this.domain?._id);
        problem.assertProblemAclDomain(this.user, authoritativeDomainId);
        const dag = await parseChaptersJson(authoritativeDomainId, chaptersJson);
        const pids = training.getPids(dag);
        const existingPids = training.getPids(this.tdoc?.dag || []);
        await assertProblemBankSelection(authoritativeDomainId, pids, this.user, existingPids);
        const groupIds = (courseGroupIds || [])
            .map((s) => {
                try {
                    return new ObjectId(s);
                } catch {
                    return null;
                }
            })
            .filter((x): x is ObjectId => !!x);
        if (!tid) {
            tid = await training.add(authoritativeDomainId, title, content, this.user._id, dag, description, 0, {
                kind: 'course',
                courseGroupIds: groupIds,
                term,
            });
            await oplog.log(this, 'course.create', { tid, title });
        } else {
            await training.edit(authoritativeDomainId, tid, {
                title, content, dag, description, term, courseGroupIds: groupIds,
            });
            await oplog.log(this, 'course.edit', { tid, title });
        }
        this.response.body = { tid };
        this.response.redirect = this.url('course_detail', { tid });
    }

    @param('tid', Types.ObjectId)
    async postDelete(_domainId: string, tid: ObjectId) {
        const domainId = String(this.domain?._id);
        const tdoc = await training.get(domainId, tid);
        if (tdoc.kind !== 'course') throw new ValidationError('tid', null, 'Not a course');
        if (!this.user.own(tdoc)) this.checkPerm(PERM.PERM_EDIT_COURSE);
        await Promise.all([
            training.del(domainId, tid),
            storage.del((tdoc.files || []).map((file) => `${courseFilePrefix(domainId, tid)}${file.name}`), this.user._id),
        ]);
        await oplog.log(this, 'course.delete', { tid });
        this.response.redirect = this.url('course_main');
    }
}

class CourseFilesHandler extends Handler {
    tdoc: TrainingDoc;
    domainId: string;

    @param('tid', Types.ObjectId)
    async prepare(_domainId: string, tid: ObjectId) {
        this.domainId = String(this.domain?._id);
        this.tdoc = await training.get(this.domainId, tid);
        if (this.tdoc.kind !== 'course') throw new NotFoundError('course');
        if (!this.user.own(this.tdoc)) this.checkPriv(PRIV.PRIV_EDIT_SYSTEM);
    }

    async get() {
        this.response.body = { files: sortFiles(this.tdoc.files || []) };
    }

    @param('tid', Types.ObjectId)
    @post('filename', Types.Filename)
    async postUploadFile(_domainId: string, tid: ObjectId, filename: string) {
        const files = this.tdoc.files || [];
        const previous = files.find((item) => item.name === filename);
        if (!previous && files.length >= system.get('limit.contest_files')) {
            throw new FileLimitExceededError('count');
        }
        const file = this.request.files?.file;
        if (!file) throw new ValidationError('file');
        const retainedSize = Math.sum(files.filter((item) => item.name !== filename).map((item) => item.size));
        if (retainedSize + file.size >= system.get('limit.contest_files_size')) {
            throw new FileLimitExceededError('size');
        }
        const target = `${courseFilePrefix(this.domainId, tid)}${filename}`;
        await storage.put(target, file.filepath, this.user._id);
        const meta = await storage.getMeta(target);
        if (!meta) throw new FileUploadError();
        const payload = { _id: filename, name: filename, ...pick(meta, ['size', 'lastModified', 'etag']) };
        await training.edit(this.domainId, tid, {
            files: files.filter((item) => item.name !== filename).concat(payload),
        });
        await oplog.log(this, 'course.file.upload', { tid, filename, size: payload.size });
        this.response.body = { file: payload };
    }

    @param('tid', Types.ObjectId)
    @post('files', Types.ArrayOf(Types.Filename))
    async postDeleteFiles(_domainId: string, tid: ObjectId, files: string[]) {
        for (const filename of files) listedCourseFile(this.tdoc, filename);
        await Promise.all([
            storage.del(files.map((filename) => `${courseFilePrefix(this.domainId, tid)}${filename}`), this.user._id),
            training.edit(this.domainId, tid, {
                files: (this.tdoc.files || []).filter((item) => !files.includes(item.name)),
            }),
        ]);
        await oplog.log(this, 'course.file.delete', { tid, files });
        this.response.body = { deleted: files };
    }
}

class CourseFileDownloadHandler extends Handler {
    @param('tid', Types.ObjectId)
    @param('filename', Types.Filename)
    @param('noDisposition', Types.Boolean, true)
    async get(_domainId: string, tid: ObjectId, filename: string, noDisposition = false) {
        this.checkPriv(PRIV.PRIV_USER_PROFILE);
        const domainId = String(this.domain?._id);
        const tdoc = await training.get(domainId, tid);
        if (tdoc.kind !== 'course') throw new NotFoundError('course');
        const file = listedCourseFile(tdoc, filename);
        const canManage = this.user.own(tdoc) || this.user.hasPriv(PRIV.PRIV_EDIT_SYSTEM);
        if (!canManage && (tdoc.courseGroupIds || []).length) {
            const myGroups = await userGroupIds(domainId, this.user._id);
            if (!courseVisibleTo(tdoc, myGroups, false)) throw new PermissionError(PERM.PERM_VIEW_TRAINING);
        }
        const target = `${courseFilePrefix(domainId, tid)}${filename}`;
        this.response.addHeader('Cache-Control', 'private');
        await oplog.log(this, 'course.file.download', { tid, filename, size: file.size || 0 });
        this.response.redirect = await storage.signDownloadLink(
            target,
            noDisposition ? undefined : filename,
            false,
            'user',
        );
    }
}

export async function apply(ctx) {
    ctx.Route('course_main', '/course', CourseMainHandler, PERM.PERM_VIEW_TRAINING);
    ctx.Route('course_create', '/course/create', CourseEditHandler);
    ctx.Route('course_detail', '/course/:tid', CourseDetailHandler, PERM.PERM_VIEW_TRAINING);
    ctx.Route('course_edit', '/course/:tid/edit', CourseEditHandler);
    ctx.Route('course_files', '/course/:tid/file', CourseFilesHandler);
    ctx.Route('course_file_download', '/course/:tid/file/:filename', CourseFileDownloadHandler);
}
