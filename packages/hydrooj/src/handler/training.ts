import assert from 'assert';
import { escapeRegExp, pick } from 'lodash';
import { Filter, ObjectId } from 'mongodb';
import { sortFiles } from '@hydrooj/utils/lib/utils';
import { localizeErrorParameter, localizedErrorText, FileLimitExceededError, FileUploadError, NotFoundError, ValidationError } from '../error';
import { Tdoc, TrainingDoc } from '../interface';
import { problemSetAudienceOf } from '../lib/problem-set-audience';
import { isProblemSetKind, withProblemSetKind } from '../lib/training-kind';
import { PERM, PRIV, STATUS } from '../model/builtin';
import { contextualCompletionService } from '../model/contextual-completion';
import * as oplog from '../model/oplog';
import { practiceIntegrityService } from '../model/practice-integrity';
import problem from '../model/problem';
import { assertProblemBankSelection } from '../model/problem-access';
import storage from '../model/storage';
import system from '../model/system';
import { canManageProblemSet, problemSetAccessService } from '../model/problem-set-access';
import * as training from '../model/training';
import user from '../model/user';
import { Handler, param, post, Types } from '../service/server';
import { getVisibleReferencedProblems, normalizeProblemDocIds } from './problem-reference';
import { loadCompletedPidsByUid } from '../lib/practice-roster-load';
import { assemblePracticeRosterMembers, PRACTICE_ROSTER_ENROLL_LIMIT, serializePracticeRosterProblems } from '../lib/practice-roster';

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
            if (Object.hasOwn(node, 'sections')) {
                throw new Error('题集阶段不支持小节');
            }
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
        const listed = await training.getMulti(domainId, query).toArray();
        const tsdict = {};
        let extraDocs: TrainingDoc[] = [];
        if (this.user.hasPriv(PRIV.PRIV_USER_PROFILE)) {
            const listedIds = new Set(listed.map((tdoc) => String(tdoc.docId)));
            const tsdocs = await training
                .getMultiStatus(domainId, {
                    uid: this.user._id,
                    $or: [{ docId: { $in: listed.map((tdoc) => tdoc.docId) } }, { enroll: 1 }],
                })
                .toArray();
            const extraIds: ObjectId[] = [];
            for (const tsdoc of tsdocs) {
                tsdict[tsdoc.docId] = tsdoc;
                if (!listedIds.has(String(tsdoc.docId)) && tsdoc.enroll === 1) extraIds.push(tsdoc.docId);
            }
            if (extraIds.length) {
                extraDocs = Object.values(await training.getList(domainId, extraIds)).filter((tdoc: TrainingDoc) => isProblemSetKind(tdoc?.kind));
            }
        }
        const enrollments = new Map<string, boolean>();
        for (const [key, tsdoc] of Object.entries(tsdict)) {
            enrollments.set(String((tsdoc as { docId?: ObjectId }).docId || key), (tsdoc as { enroll?: number }).enroll === 1);
        }
        const candidates = [...listed, ...extraDocs];
        const decisions = await problemSetAccessService.evaluateMany(domainId, this.user, candidates, enrollments);
        const discoverableListed = listed.filter((tdoc) => decisions.get(String(tdoc.docId))?.discoverable);
        const pageSize = this.ctx.setting.get('pagination.training') || 20;
        const tpcount = Math.max(1, Math.ceil(discoverableListed.length / pageSize));
        const tdocs = discoverableListed.slice((page - 1) * pageSize, page * pageSize);
        const tdict = {};
        const access = {};
        for (const tdoc of extraDocs) {
            const decision = decisions.get(String(tdoc.docId));
            if (!decision?.discoverable) {
                tsdict[String(tdoc.docId)] = undefined;
                continue;
            }
            tdict[String(tdoc.docId)] = tdoc;
            access[String(tdoc.docId)] = decision;
        }
        for (const tdoc of tdocs) {
            tdict[tdoc.docId.toHexString()] = tdoc;
            access[tdoc.docId.toHexString()] = decisions.get(String(tdoc.docId));
        }
        const extraDiscoverable = extraDocs.filter((tdoc) => decisions.get(String(tdoc.docId))?.discoverable);
        for (const tdoc of extraDiscoverable) {
            if (tdocs.some((listedDoc) => String(listedDoc.docId) === String(tdoc.docId))) continue;
            tdocs.push(tdoc);
        }
        for (const key of Object.keys(tsdict)) {
            const status = tsdict[key] as { docId?: ObjectId };
            const id = String(status?.docId || key);
            if (!decisions.get(id)?.discoverable) delete tsdict[key];
        }
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
            access,
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
        const access = await problemSetAccessService.assertAccessible(domainId, this.user, tdoc);
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
            const hasAccess = problemSetAccessService.stageIsAccessible(access, node._id);
            const isInvalid = training.isInvalid(node, doneNids);
            const nsdoc = {
                progress: totalCount ? Math.floor(100 * (doneCount / totalCount)) : 100,
                isDone: training.isDone(node, doneNids, scopedDonePids),
                isProgress: training.isProgress(node, doneNids, scopedDonePids, progPids),
                isOpen: training.isOpen(node, doneNids, scopedDonePids, progPids),
                isInvalid,
                hasAccess,
                lockReason: hasAccess ? (isInvalid ? 'prereq' : undefined) : 'no_access',
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
        const tsdoc = { ...(await training.getStatus(domainId, tdoc.docId, uid)), ...computedStatus };
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
            access,
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
                .limit(PRACTICE_ROSTER_ENROLL_LIMIT)
                .toArray();
            const memberUids = enrollDocs.map((x) => +x.uid);
            const ub = global.Hydro?.model?.userbind;
            const scopePids = new Map(tdoc.dag.map((node) => [node._id, new Set(node.pids)]));
            if (memberUids.length && typeof ub?.findStudentsByUserIds !== 'function') {
                throw new TypeError('userbind.findStudentsByUserIds is unavailable');
            }
            if (typeof ub?.listUserGroups !== 'function') throw new TypeError('userbind.listUserGroups is unavailable');
            const [memberUdict, students, ubGroups, completedPidsByUid] = await Promise.all([
                user.getListForRender(domainId, memberUids, false),
                memberUids.length ? ub.findStudentsByUserIds(domainId, memberUids) : {},
                ub.listUserGroups(domainId),
                loadCompletedPidsByUid({
                    domainId,
                    memberUids,
                    pids: exist,
                    publishedIntegrity: !!publishedIntegrity,
                    containerKind: 'problemSet',
                    containerId: tdoc.docId,
                    scopePids,
                }),
            ]);
            this.response.body.membersTruncated = enrollDocs.length >= PRACTICE_ROSTER_ENROLL_LIMIT;
            const groupNameById = new Map((ubGroups as Array<{ _id: ObjectId; name: string }>).map((group) => [String(group._id), group.name]));
            this.response.body.members = assemblePracticeRosterMembers({
                memberUids,
                udict: memberUdict,
                students,
                groupNameById,
                completedPidsByUid,
                total: exist.length,
            });
            this.response.body.rosterProblems = serializePracticeRosterProblems(exist, pdict);
        }

        this.response.pjax = 'partials/training_detail.html';
        this.response.template = 'problem_set_detail.html';
    }

    @param('tid', Types.ObjectId)
    async postEnroll(domainId: string, tid: ObjectId) {
        this.checkPriv(PRIV.PRIV_USER_PROFILE);
        const tdoc = await training.get(domainId, tid);
        assertProblemSet(tdoc);
        await problemSetAccessService.assertAccessible(domainId, this.user, tdoc);
        await training.ensureEnrolled(domainId, tdoc.docId, this.user._id);
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
            if (!canManageProblemSet(this.user, this.tdoc)) {
                await problemSetAccessService.assertAccessible(authoritativeDomainId, this.user, this.tdoc);
            }
            if (!this.user.own(this.tdoc)) this.checkPerm(PERM.PERM_EDIT_TRAINING);
            else this.checkPerm(PERM.PERM_EDIT_TRAINING_SELF);
        } else this.checkPerm(PERM.PERM_CREATE_TRAINING);
    }

    async get() {
        const authoritativeDomainId = String(this.domain?._id);
        const groups = (global as any).Hydro?.model?.userbind?.listUserGroups
            ? await (global as any).Hydro.model.userbind.listUserGroups(authoritativeDomainId)
            : [];
        this.response.template = 'problem_set_edit.html';
        this.response.body = {
            page_name: this.tdoc ? 'problem_set_edit' : 'problem_set_create',
            groups: (groups as Array<{ _id: unknown; name: string; archivedAt?: unknown }>).map((group) => ({
                _id: String(group._id),
                name: group.name,
                archivedAt: group.archivedAt || null,
            })),
            audience: this.tdoc ? problemSetAudienceOf(this.tdoc) : { public: true, groupIds: [] },
        };
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
    @param('audiencePublic', Types.Boolean, true)
    @param('audienceGroupIds', Types.CommaSeperatedArray, true)
    async post(
        _domainId: string,
        tid: ObjectId,
        title: string,
        content: string,
        _dag: string,
        pin = 0,
        description: string,
        audiencePublic?: boolean,
        audienceGroupIds?: string[],
    ) {
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
        if (audiencePublic !== undefined) {
            await training.setProblemSetAudience(authoritativeDomainId, tid, {
                public: !!audiencePublic,
                groupIds: audienceGroupIds || [],
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
        if (!canManageProblemSet(this.user, this.tdoc)) {
            await problemSetAccessService.assertAccessible(domainId, this.user, this.tdoc);
        }
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
        await problemSetAccessService.assertAccessible(domainId, this.user, tdoc);
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
