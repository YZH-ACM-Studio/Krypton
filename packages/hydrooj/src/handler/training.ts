import assert from 'assert';
import { escapeRegExp, pick } from 'lodash';
import { Filter, ObjectId } from 'mongodb';
import { sortFiles } from '@hydrooj/utils/lib/utils';
import { localizeErrorParameter, localizedErrorText, FileLimitExceededError, FileUploadError, NotFoundError, ValidationError } from '../error';
import { Tdoc, TrainingDoc } from '../interface';
import { isProblemSetKind, withProblemSetKind } from '../lib/training-kind';
import { PERM, PRIV, STATUS } from '../model/builtin';
import { contextualCompletionService } from '../model/contextual-completion';
import * as document from '../model/document';
import * as oplog from '../model/oplog';
import { practiceIntegrityService } from '../model/practice-integrity';
import problem from '../model/problem';
import { assertProblemBankSelection } from '../model/problem-access';
import storage from '../model/storage';
import system from '../model/system';
import * as training from '../model/training';
import user from '../model/user';
import { Handler, param, post, Types } from '../service/server';
import { getVisibleReferencedProblems, normalizeProblemDocIds } from './problem-reference';

async function _parseDagJson(domainId: string, _dag: string): Promise<Tdoc['dag']> {
    const parsed = [];
    try {
        const dag = JSON.parse(_dag);
        assert(dag instanceof Array, 'dag must be an array');
        const ids = new Set(dag.map((s) => s._id));
        assert(dag.length, 'must have at least one node');
        assert(dag.length === ids.size, '_id must be unique');
        for (const node of dag) {
            assert(node._id, 'each node should have a _id');
            assert(node.title, 'each node shoule have a title');
            assert(node.requireNids instanceof Array);
            assert(node.pids instanceof Array);
            assert(node.pids.length, 'each node must contain at lease one problem');
            for (const nid of node.requireNids) {
                assert(ids.has(nid), `required nid ${nid} not found`);
            }
            const newNode = {
                _id: +node._id,
                title: node.title,
                requireNids: Array.from(new Set(node.requireNids)),
                pids: normalizeProblemDocIds(node.pids),
            };
            parsed.push(newNode);
        }
    } catch (e) {
        throw localizeErrorParameter(new ValidationError('dag', null, e.message), 2, 'The training structure is invalid: {0}', e.message);
    }
    return parsed;
}

/**
 * Krypton §10：course（kind='course'）与 training 共用 docType 40，但走
 * 各自的 /course 路由。训练系列 handler 必须拒绝 course 文档，否则
 * course 的班级可见性 / PERM_EDIT_COURSE 会被训练路由绕过（对抗性审查
 * #1/#2）。
 */
function assertProblemSet(tdoc: { kind?: string }): void {
    if (!isProblemSetKind(tdoc?.kind)) throw new NotFoundError(localizedErrorText`training`);
}

class TrainingMainHandler extends Handler {
    @param('page', Types.PositiveInt, true)
    @param('q', Types.String, true)
    async get(domainId: string, page = 1, q = '') {
        const query: Filter<TrainingDoc> = withProblemSetKind(
            q ? { title: { $regex: new RegExp(escapeRegExp(q), 'i') } } : {},
        ) as Filter<TrainingDoc>;
        await this.ctx.parallel('training/list', query, this);
        const [tdocs, tpcount] = await this.paginate(training.getMulti(domainId, query), page, 'training');
        const tids: Set<ObjectId> = new Set();
        for (const tdoc of tdocs) tids.add(tdoc.docId);
        const tsdict = {};
        let tdict = {};
        if (this.user.hasPriv(PRIV.PRIV_USER_PROFILE)) {
            const enrolledTids: Set<ObjectId> = new Set();
            const tsdocs = await training
                .getMultiStatus(domainId, {
                    uid: this.user._id,
                    $or: [{ docId: { $in: Array.from(tids) } }, { enroll: 1 }],
                })
                .toArray();
            for (const tsdoc of tsdocs) {
                tsdict[tsdoc.docId] = tsdoc;
                enrolledTids.add(tsdoc.docId);
            }
            for (const tid of tids) enrolledTids.delete(tid);
            if (enrolledTids.size) {
                tdict = await training.getList(domainId, Array.from(enrolledTids));
                // enroll:1 会命中已报名的 course，getList 不区分 kind——只保留
                // 题集，避免课程或未知 kind 串进训练页「已报名」列表。
                for (const k of Object.keys(tdict)) {
                    if (!isProblemSetKind(tdict[k]?.kind)) {
                        delete tdict[k];
                        tsdict[k] = undefined;
                    }
                }
            }
        }
        for (const tdoc of tdocs) tdict[tdoc.docId.toHexString()] = tdoc;
        if (this.user.hasPriv(PRIV.PRIV_USER_PROFILE)) {
            await Promise.all(
                (Object.values(tdict) as TrainingDoc[]).map(async (tdoc) => {
                    const publishedIntegrity = await practiceIntegrityService.getLatestPublished(domainId, 'problemSet', tdoc.docId);
                    if (!publishedIntegrity) return;
                    const contextualDoneByScope = await contextualCompletionService.getCompletedByScope(
                        domainId,
                        this.user._id,
                        'problemSet',
                        tdoc.docId,
                    );
                    const key = tdoc.docId.toHexString();
                    tsdict[key] = {
                        ...tsdict[key],
                        contextualProgress: training.buildScopedTrainingProgress(tdoc, contextualDoneByScope),
                    };
                }),
            );
        }
        this.response.template = 'problem_set_main.html';
        this.response.body = {
            tdocs,
            page,
            tpcount,
            tsdict,
            tdict,
            q,
        };
    }
}

class TrainingDetailHandler extends Handler {
    @param('tid', Types.ObjectId)
    @param('uid', Types.PositiveInt, true)
    async get(_domainId: string, tid: ObjectId, uid = this.user._id) {
        const domainId = String(this.domain?._id);
        problem.assertProblemAclDomain(this.user, domainId);
        const tdoc = await training.get(domainId, tid);
        assertProblemSet(tdoc);
        await this.ctx.parallel('training/get', tdoc, this);
        let enrollUsers: number[] = [];
        let shouldCompare = false;
        const pids = training.getPids(tdoc.dag);
        if (this.user.hasPriv(PRIV.PRIV_USER_PROFILE) && this.ctx.setting.get('training.enrolled-users')) {
            enrollUsers = (
                await training
                    .getMultiStatus(domainId, { docId: tid, uid: { $gt: 1 }, enroll: 1 })
                    .project({ uid: 1 })
                    .limit(500)
                    .toArray()
            ).map((x) => +x.uid);
            shouldCompare = uid !== this.user._id;
        } else uid = this.user._id;
        const [udoc, udict, pdict] = await Promise.all([
            user.getById(domainId, tdoc.owner),
            user.getListForRender(domainId, enrollUsers, this.user.hasPerm(PERM.PERM_VIEW_USER_PRIVATE_INFO)),
            getVisibleReferencedProblems(domainId, pids, this.user),
        ]);
        const missing = pids.filter((pid) => !pdict[pid]?.docId);
        const exist = pids.filter((pid) => pdict[pid]?.docId);
        const [psdict, selfPsdict, publishedIntegrity] = await Promise.all([
            problem.getListStatus(domainId, uid, exist),
            shouldCompare ? problem.getListStatus(domainId, this.user._id, exist) : {},
            practiceIntegrityService.getLatestPublished(domainId, 'problemSet', tdoc.docId),
        ]);
        const [contextualDoneByScope, selfContextualDoneByScope] = publishedIntegrity
            ? await Promise.all([
                  contextualCompletionService.getCompletedByScope(domainId, uid, 'problemSet', tdoc.docId),
                  shouldCompare
                      ? contextualCompletionService.getCompletedByScope(domainId, this.user._id, 'problemSet', tdoc.docId)
                      : Promise.resolve(null),
              ])
            : [null, null];
        const totalProblemCount = tdoc.dag.reduce((total, node) => total + new Set(node.pids).size, 0);
        const donePids = new Set<number>();
        const progPids = new Set<number>();
        for (const pid in psdict) {
            if (!+pid) continue;
            const psdoc = psdict[pid];
            if (!publishedIntegrity && psdoc.status) {
                if (psdoc.status === STATUS.STATUS_ACCEPTED) {
                    donePids.add(+pid);
                } else progPids.add(+pid);
            }
        }
        const nsdict = {};
        const ndict = {};
        const doneNids = new Set<number>();
        let completedProblemCount = 0;
        for (const node of tdoc.dag) {
            ndict[node._id] = node;
            const nodePids = new Set(node.pids);
            const totalCount = nodePids.size;
            const scopedDonePids = contextualDoneByScope ? nodePids.intersection(contextualDoneByScope.get(node._id) || new Set<number>()) : donePids;
            if (contextualDoneByScope) for (const pid of scopedDonePids) donePids.add(pid);
            const doneCount = nodePids.intersection(new Set(scopedDonePids)).size;
            completedProblemCount += doneCount;
            const nsdoc = {
                progress: totalCount ? Math.floor(100 * (doneCount / totalCount)) : 100,
                isDone: training.isDone(node, doneNids, scopedDonePids),
                isProgress: training.isProgress(node, doneNids, scopedDonePids, progPids),
                isOpen: training.isOpen(node, doneNids, scopedDonePids, progPids),
                isInvalid: training.isInvalid(node, doneNids),
                donePids: Array.from(scopedDonePids),
                selfDonePids: selfContextualDoneByScope
                    ? Array.from(nodePids.intersection(selfContextualDoneByScope.get(node._id) || new Set<number>()))
                    : [],
            };
            if (nsdoc.isDone) doneNids.add(node._id);
            nsdict[node._id] = nsdoc;
        }
        const computedStatus = {
            doneNids: Array.from(doneNids),
            donePids: Array.from(donePids),
            done: doneNids.size === tdoc.dag.length,
        };
        const tsdoc = publishedIntegrity
            ? { ...(await training.getStatus(domainId, tdoc.docId, uid)), ...computedStatus }
            : await training.setStatus(domainId, tdoc.docId, uid, computedStatus);
        const groups = this.user.hasPerm(PERM.PERM_EDIT_DOMAIN) ? await user.listGroup(domainId) : [];
        this.response.body = {
            tdoc,
            tsdoc,
            pids,
            pdict,
            psdict,
            ndict,
            nsdict,
            udoc,
            udict,
            selfPsdict,
            groups,
            missing,
            completedProblemCount,
            totalProblemCount,
            integrityControlled: !!publishedIntegrity,
        };
        this.response.body.tdoc.description = this.response.body.tdoc.description
            .replace(/\(file:\/\//g, `(./${tdoc.docId}/file/`)
            .replace(/="file:\/\//g, `="./${tdoc.docId}/file/`);

        // ── Krypton P2.3：参加名单（服务端 gate：管理员+教师）────────────
        // PERM_USERBIND_MANAGE_STUDENTS 是教师档的"学生数据操作"位
        // （permission.ts PERM_TEACHER 含之，学生无）——名单含真实姓名/
        // 学号 PII，与审批页/record 学号列同档。学生响应不含 members 字段。
        // 纯读聚合（PLAN Rev.8）：4 条批量查询 + 内存归并，零写库零 N+1。
        if (this.user.hasPerm(PERM.PERM_USERBIND_MANAGE_STUDENTS)) {
            const enrollDocs = await training
                .getMultiStatus(domainId, { docId: tid, uid: { $gt: 1 }, enroll: 1 })
                .project({ uid: 1 })
                .limit(1000)
                .toArray();
            const memberUids = enrollDocs.map((x) => +x.uid);
            const ub = (global as any).Hydro?.model?.userbind;
            const [memberUdict, students, ubGroups, acDocs, contextualCounts] = await Promise.all([
                // getListForRender = 单条批量查询；getList 是 N 个 getById（对抗审查发现）
                user.getListForRender(domainId, memberUids, false),
                ub?.findStudentsByUserIds ? ub.findStudentsByUserIds(domainId, memberUids) : {},
                ub?.listUserGroups ? ub.listUserGroups(domainId) : [],
                !publishedIntegrity && memberUids.length && exist.length
                    ? document
                          .getMultiStatus(domainId, document.TYPE_PROBLEM, {
                              uid: { $in: memberUids },
                              docId: { $in: exist },
                              status: STATUS.STATUS_ACCEPTED,
                          })
                          .project({ uid: 1, docId: 1 })
                          .toArray()
                    : [],
                publishedIntegrity
                    ? contextualCompletionService.getCompletedCounts(
                          domainId,
                          memberUids,
                          'problemSet',
                          tdoc.docId,
                          new Map(tdoc.dag.map((node) => [node._id, new Set(node.pids)])),
                      )
                    : new Map<number, number>(),
            ]);
            // limit 1000 截断不许静默（对抗审查发现）——前端据此提示。
            this.response.body.membersTruncated = enrollDocs.length >= 1000;
            const doneByUid = new Map<number, number>();
            for (const d of acDocs) doneByUid.set(d.uid, (doneByUid.get(d.uid) || 0) + 1);
            const groupNameById = new Map((ubGroups as any[]).map((g) => [String(g._id), g.name]));
            this.response.body.members = memberUids.map((mUid) => {
                const s = (students as any)[String(mUid)];
                return {
                    uid: mUid,
                    uname: memberUdict[mUid]?.uname || `UID ${mUid}`,
                    realName: s?.realName || '',
                    studentId: s?.studentId || '',
                    groups: (s?.groupIds || []).map((g: any) => groupNameById.get(String(g))).filter(Boolean),
                    done: publishedIntegrity ? contextualCounts.get(mUid) || 0 : doneByUid.get(mUid) || 0,
                    total: publishedIntegrity ? tdoc.dag.reduce((total, node) => total + node.pids.length, 0) : exist.length,
                };
            });
        }

        this.response.pjax = 'partials/training_detail.html';
        this.response.template = 'problem_set_detail.html';
    }

    @param('tid', Types.ObjectId)
    async postEnroll(domainId: string, tid: ObjectId) {
        this.checkPriv(PRIV.PRIV_USER_PROFILE);
        const tdoc = await training.get(domainId, tid);
        assertProblemSet(tdoc);
        await training.enroll(domainId, tdoc.docId, this.user._id);
        this.back();
    }

    @param('tid', Types.ObjectId)
    async postDelete(domainId: string, tid: ObjectId) {
        const tdoc = await training.get(domainId, tid);
        assertProblemSet(tdoc);
        if (!this.user.own(tdoc)) this.checkPerm(PERM.PERM_EDIT_TRAINING);
        await Promise.all([
            training.del(domainId, tid),
            storage.del(tdoc.files?.map((i) => `training/${domainId}/${tid}/${i.name}`) || [], this.user._id),
        ]);
        this.response.redirect = this.url('training_main');
    }
}

class TrainingEditHandler extends Handler {
    tdoc: TrainingDoc;

    @param('tid', Types.ObjectId, true)
    async prepare(_domainId: string, tid: ObjectId) {
        const authoritativeDomainId = String(this.domain?._id);
        problem.assertProblemAclDomain(this.user, authoritativeDomainId);
        if (tid) {
            this.tdoc = await training.get(authoritativeDomainId, tid);
            assertProblemSet(this.tdoc);
            if (!this.user.own(this.tdoc)) this.checkPerm(PERM.PERM_EDIT_TRAINING);
            else this.checkPerm(PERM.PERM_EDIT_TRAINING_SELF);
        } else this.checkPerm(PERM.PERM_CREATE_TRAINING);
    }

    async get() {
        this.response.template = 'problem_set_edit.html';
        this.response.body = { page_name: this.tdoc ? 'problem_set_edit' : 'problem_set_create' };
        if (this.tdoc) {
            this.response.body.tdoc = this.tdoc;
            this.response.body.dag = JSON.stringify(this.tdoc.dag, null, 2);
        }
    }

    @param('tid', Types.ObjectId, true)
    @param('title', Types.Title)
    @param('content', Types.Content)
    @param('dag', Types.Content)
    @param('pin', Types.UnsignedInt)
    @param('description', Types.Content)
    async post(_domainId: string, tid: ObjectId, title: string, content: string, _dag: string, pin = 0, description: string) {
        const authoritativeDomainId = String(this.domain?._id);
        problem.assertProblemAclDomain(this.user, authoritativeDomainId);
        if (!!this.tdoc?.pin !== !!pin) this.checkPerm(PERM.PERM_PIN_TRAINING);
        const dag = await _parseDagJson(authoritativeDomainId, _dag);
        const pids = training.getPids(dag);
        assert(pids.length, new ValidationError('dag', null, localizedErrorText`Please specify at least one problem`));
        const existingPids = training.getPids(this.tdoc?.dag || []);
        await assertProblemBankSelection(authoritativeDomainId, pids, this.user, existingPids);
        if (!tid) {
            tid = await training.add(authoritativeDomainId, title, content, this.user._id, dag, description, pin);
        } else {
            await training.edit(authoritativeDomainId, tid, {
                title,
                content,
                dag,
                description,
                pin,
            });
        }
        this.response.body = { tid };
        this.response.redirect = this.url('training_detail', { tid });
    }
}

export class TrainingFilesHandler extends Handler {
    tdoc: TrainingDoc;

    @param('tid', Types.ObjectId)
    async prepare(domainId: string, tid: ObjectId) {
        this.tdoc = await training.get(domainId, tid);
        assertProblemSet(this.tdoc);
        if (!this.user.own(this.tdoc)) this.checkPerm(PERM.PERM_EDIT_TRAINING);
        else this.checkPerm(PERM.PERM_EDIT_TRAINING_SELF);
    }

    @param('tid', Types.ObjectId)
    async get(domainId: string, tid: ObjectId) {
        if (!this.user.own(this.tdoc)) this.checkPerm(PERM.PERM_EDIT_TRAINING);
        const tsdoc = await training.getStatus(domainId, this.tdoc.docId, this.user._id);
        const publishedIntegrity = await practiceIntegrityService.getLatestPublished(domainId, 'problemSet', this.tdoc.docId);
        const contextualProgress = publishedIntegrity
            ? training.buildScopedTrainingProgress(
                  this.tdoc,
                  await contextualCompletionService.getCompletedByScope(domainId, this.user._id, 'problemSet', this.tdoc.docId),
              )
            : null;
        this.response.body = {
            tdoc: this.tdoc,
            tsdoc: contextualProgress ? { ...tsdoc, contextualProgress } : tsdoc,
            udoc: await user.getById(domainId, this.tdoc.owner),
            files: sortFiles(this.tdoc.files || []),
            urlForFile: (filename: string) => this.url('training_file_download', { tid, filename }),
        };
        this.response.pjax = 'partials/files.html';
        this.response.template = 'problem_set_files.html';
    }

    @param('tid', Types.ObjectId)
    @post('filename', Types.Filename, true)
    async postUploadFile(domainId: string, tid: ObjectId, filename: string) {
        if ((this.tdoc.files?.length || 0) >= system.get('limit.contest_files')) {
            throw new FileLimitExceededError('count');
        }
        const file = this.request.files?.file;
        if (!file) throw new ValidationError('file');
        const size = Math.sum((this.tdoc.files || []).map((i) => i.size)) + file.size;
        if (size >= system.get('limit.contest_files_size')) {
            throw new FileLimitExceededError('size');
        }
        await storage.put(`training/${domainId}/${tid}/${filename}`, file.filepath, this.user._id);
        const meta = await storage.getMeta(`training/${domainId}/${tid}/${filename}`);
        const payload = { _id: filename, name: filename, ...pick(meta, ['size', 'lastModified', 'etag']) };
        if (!meta) throw new FileUploadError();
        await training.edit(domainId, tid, { files: [...(this.tdoc.files || []), payload] });
        this.back();
    }

    @param('tid', Types.ObjectId)
    @post('files', Types.ArrayOf(Types.Filename))
    async postDeleteFiles(domainId: string, tid: ObjectId, files: string[]) {
        await Promise.all([
            storage.del(
                files.map((t) => `training/${domainId}/${tid}/${t}`),
                this.user._id,
            ),
            training.edit(domainId, tid, { files: this.tdoc.files.filter((i) => !files.includes(i.name)) }),
        ]);
        this.back();
    }
}
export class TrainingFileDownloadHandler extends Handler {
    @param('tid', Types.ObjectId)
    @param('filename', Types.Filename)
    @param('noDisposition', Types.Boolean)
    async get(_domainId: string, tid: ObjectId, filename: string, noDisposition = false) {
        const domainId = String(this.domain?._id);
        const tdoc = await training.get(domainId, tid);
        assertProblemSet(tdoc);
        if (!(tdoc.files || []).some((file) => file.name === filename)) throw new NotFoundError(localizedErrorText`file`);
        this.response.addHeader('Cache-Control', 'public');
        const target = `training/${domainId}/${tid}/${filename}`;
        const file = await storage.getMeta(target);
        await oplog.log(this, 'download.file.training', {
            target,
            size: file?.size || 0,
        });
        this.response.redirect = await storage.signDownloadLink(target, noDisposition ? undefined : filename, false, 'user');
    }
}

function requestQuery(handler: Handler): Record<string, string> {
    const raw = handler.request.query;
    if (!raw || typeof raw !== 'object') return {};
    const query: Record<string, string> = {};
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
        if (value === undefined || value === null) continue;
        query[key] = Array.isArray(value) ? String(value[0]) : String(value);
    }
    return query;
}

function canonicalTrainingRouteName(path: string, tid?: ObjectId, filename?: string) {
    if (filename) return 'training_file_download';
    if (/\/edit\/?$/.test(path)) return 'training_edit';
    if (/\/file\/?$/.test(path)) return 'training_files';
    if (/\/create\/?$/.test(path)) return 'training_create';
    if (tid) return 'training_detail';
    return 'training_main';
}

class TrainingCompatRedirectHandler extends Handler {
    async prepare() {
        if (this.request.method !== 'GET' && this.request.method !== 'HEAD') {
            throw new ValidationError('path', null, localizedErrorText`请从题集页面提交这次操作。`);
        }
    }

    @param('tid', Types.ObjectId, true)
    @param('filename', Types.Filename, true)
    async get(_domainId: string, tid?: ObjectId, filename?: string) {
        const name = canonicalTrainingRouteName(String(this.request.path || ''), tid, filename);
        const query = requestQuery(this);
        const args: Record<string, unknown> = Object.keys(query).length ? { query } : {};
        if (tid) args.tid = tid;
        if (filename) args.filename = filename;
        this.response.redirect = this.url(name, args);
        this.response.status = 301;
    }
}

export async function apply(ctx) {
    ctx.Route('training_main', '/problem-sets', TrainingMainHandler, PERM.PERM_VIEW_TRAINING);
    ctx.Route('training_create', '/problem-sets/create', TrainingEditHandler);
    ctx.Route('training_detail', '/problem-sets/:tid', TrainingDetailHandler, PERM.PERM_VIEW_TRAINING);
    ctx.Route('training_edit', '/problem-sets/:tid/edit', TrainingEditHandler);
    ctx.Route('training_files', '/problem-sets/:tid/file', TrainingFilesHandler, PERM.PERM_VIEW_TRAINING);
    ctx.Route('training_file_download', '/problem-sets/:tid/file/:filename', TrainingFileDownloadHandler, PERM.PERM_VIEW_TRAINING);
    ctx.Route('training_compat_main', '/training', TrainingCompatRedirectHandler);
    ctx.Route('training_compat_create', '/training/create', TrainingCompatRedirectHandler);
    ctx.Route('training_compat_detail', '/training/:tid', TrainingCompatRedirectHandler);
    ctx.Route('training_compat_edit', '/training/:tid/edit', TrainingCompatRedirectHandler);
    ctx.Route('training_compat_files', '/training/:tid/file', TrainingCompatRedirectHandler);
    ctx.Route('training_compat_file_download', '/training/:tid/file/:filename', TrainingCompatRedirectHandler);
}
