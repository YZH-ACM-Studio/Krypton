/**
 * Route handlers for krypton-rankboard.
 *
 *   GET  /rankboard                         RankBoardMainHandler          (public)
 *   GET  /rankboard/:studentDocId           RankBoardDetailHandler        (public)
 *   GET  /admin/rankboard                   AdminRankBoardListHandler     (system admin)
 *   POST /admin/rankboard                   AdminRankBoardListHandler.postX (add / delete / config / batch)
 *   GET  /admin/rankboard/awards            AdminAwardTypesHandler        (system admin)
 *   POST /admin/rankboard/awards            AdminAwardTypesHandler.postX  (upsert / delete)
 *   GET  /admin/rankboard/people/:id        AdminPersonDetailHandler      (system admin)
 *   POST /admin/rankboard/people/:id        AdminPersonDetailHandler.postSave (save awards)
 */
import type { Context } from 'hydrooj';
import {
    localizedErrorText,
    BadRequestError,
    db,
    Handler,
    NotFoundError,
    ObjectId,
    param,
    PERM,
    PermissionError,
    PRIV,
    PrivilegeError,
    Types,
    UserModel,
    ValidationError,
} from 'hydrooj';
import type { BatchImportRow } from './model';
import {
    addAwardImage,
    applyGpltStoreScores,
    buildGallery,
    createPerson,
    deleteAwardType,
    deletePerson,
    getConfig,
    getPerson,
    importAwardsBatch,
    listAwardTypes,
    listImportBatches,
    listLeaderboard,
    RANKBOARD_DOMAIN,
    rollbackImportBatch,
    setConfig,
    updatePerson,
    upsertAwardType,
} from './model';
import type { Award } from './types';

const studentsColl = db.collection<any>('userbind.students');
const schoolsColl = db.collection<any>('userbind.schools');

class RankBoardMainHandler extends Handler {
    noCheckPermView = true;
    async get() {
        const [rows, awardTypes, config] = await Promise.all([listLeaderboard(), listAwardTypes(), getConfig()]);
        this.response.template = 'rankboard_main.html';
        this.response.body = {
            rows: rows.map((r) => ({
                ...r,
                // Strip Mongo ObjectId types for the bootstrap serializer.
                student: {
                    ...r.student,
                    _id: String(r.student._id),
                    schoolId: String(r.student.schoolId),
                },
                person: {
                    ...r.person,
                    _id: String(r.person._id),
                    studentDocId: String(r.person.studentDocId),
                },
            })),
            awardTypes,
            config,
        };
    }
}

class RankBoardDetailHandler extends Handler {
    noCheckPermView = true;
    @param('studentDocId', Types.ObjectId)
    async get(_ctx: any, studentDocId: ObjectId) {
        const rows = await listLeaderboard();
        const row = rows.find((r) => String(r.student._id) === String(studentDocId));
        if (!row) throw new NotFoundError(localizedErrorText`person`, String(studentDocId));
        const awardTypes = await listAwardTypes();
        this.response.template = 'rankboard_detail.html';
        this.response.body = {
            row: {
                ...row,
                student: {
                    ...row.student,
                    _id: String(row.student._id),
                    schoolId: String(row.student.schoolId),
                },
                person: {
                    ...row.person,
                    _id: String(row.person._id),
                    studentDocId: String(row.person.studentDocId),
                },
            },
            awardTypes,
        };
    }
}

/**
 * 权限分层（PLAN 2026-07-02 §1，教师默认包已不含荣誉写权限）：
 *  - 进入 admin 页面：站点管理员 或 持 PERM_RANKBOARD_IMPORT / MANAGE 的角色。
 *  - 数据操作（导入/录奖/传照片/编辑人员）：PERM_RANKBOARD_IMPORT。
 *  - 结构操作（奖项类型/计分权重/删除人员）：PERM_RANKBOARD_MANAGE。
 */
/**
 * 荣誉榜是 system 域全局单例。`this.user.hasPerm` 按**请求所在域**求值——
 * 而任意域的 owner 在自己域里是 root（PERM_ALL）。若不锁定域，一个只被
 * 授予 IMPORT 的教师只要拥有任意课程域，就能从 /d/<该域>/admin/rankboard
 * 进来、在自己域的 root 身份下 hasPerm(MANAGE) 恒真，击穿权限分层
 * （对抗性审查 G1）。因此：非全局管理员的 perm 判定一律要求请求域 = system。
 */
class AdminBase extends Handler {
    /** true 表示是荣誉榜的合法域（system）或持全局 PRIV。 */
    private rankboardScopeOk(): boolean {
        // `this.args` includes query/body fields and is therefore attacker
        // controlled. Bind the singleton scope to the framework-resolved
        // request domain instead; a missing domain fails closed.
        return this.user.hasPriv(PRIV.PRIV_EDIT_SYSTEM) || String(this.domain?._id ?? '') === RANKBOARD_DOMAIN;
    }

    protected canManageRankboard(): boolean {
        if (this.user.hasPriv(PRIV.PRIV_EDIT_SYSTEM)) return true;
        return this.rankboardScopeOk() && this.user.hasPerm(PERM.PERM_RANKBOARD_MANAGE);
    }

    protected canImportRankboard(): boolean {
        if (this.canManageRankboard()) return true;
        return this.rankboardScopeOk() && this.user.hasPerm(PERM.PERM_RANKBOARD_IMPORT);
    }

    async prepare() {
        if (this.user.hasPriv(PRIV.PRIV_EDIT_SYSTEM)) return;
        if (this.canImportRankboard()) return;
        throw new PrivilegeError(PRIV.PRIV_EDIT_SYSTEM);
    }

    checkDataOp() {
        if (this.user.hasPriv(PRIV.PRIV_EDIT_SYSTEM)) return;
        if (this.canImportRankboard()) return;
        throw new PermissionError(PERM.PERM_RANKBOARD_IMPORT);
    }

    checkStructuralOp() {
        if (this.user.hasPriv(PRIV.PRIV_EDIT_SYSTEM)) return;
        if (this.canManageRankboard()) return;
        throw new PermissionError(PERM.PERM_RANKBOARD_MANAGE);
    }
}

class AdminRankBoardListHandler extends AdminBase {
    private async renderSection(section: 'people' | 'import' | 'settings', extra: Record<string, unknown> = {}) {
        const body: Record<string, unknown> = {
            section,
            canImport: this.canImportRankboard(),
            canManage: this.canManageRankboard(),
            ...extra,
        };
        if (section === 'people') {
            const rows = await listLeaderboard();
            body.rows = rows.map((r) => ({
                ...r,
                student: {
                    ...r.student,
                    _id: String(r.student._id),
                    schoolId: String(r.student.schoolId),
                },
                person: {
                    ...r.person,
                    _id: String(r.person._id),
                    studentDocId: String(r.person.studentDocId),
                },
            }));
        } else if (section === 'import') {
            const [batches, schools] = await Promise.all([listImportBatches(), schoolsColl.find({ domainId: RANKBOARD_DOMAIN }).toArray()]);
            body.batches = batches.map((b) => ({ ...b, _id: String(b._id) }));
            body.schools = schools.map((s: any) => ({ _id: String(s._id), name: s.name }));
        } else {
            body.config = await getConfig();
        }
        this.response.template = 'admin_rankboard.html';
        this.response.body = body;
    }

    @param('section', Types.String, true)
    async get(_ctx: any, requestedSection?: string) {
        const section = requestedSection || 'people';
        if (section !== 'people' && section !== 'import' && section !== 'settings') {
            throw new BadRequestError(localizedErrorText`未知的荣誉管理分区`);
        }
        if (section === 'settings') this.checkStructuralOp();
        await this.renderSection(section);
    }

    @param('studentDocId', Types.ObjectId)
    async postAdd(_ctx: any, studentDocId: ObjectId) {
        this.checkDataOp();
        const student = await studentsColl.findOne({
            _id: studentDocId,
            domainId: RANKBOARD_DOMAIN,
        });
        if (!student) throw new NotFoundError(localizedErrorText`student`, String(studentDocId));
        const person = await createPerson({
            studentDocId,
            createdBy: this.user._id,
        });
        this.response.redirect = this.url('admin_rankboard_person', { id: String(person._id) });
    }

    @param('personId', Types.ObjectId)
    async postDelete(_ctx: any, personId: ObjectId) {
        this.checkStructuralOp();
        await deletePerson(personId);
        this.response.redirect = `${this.url('admin_rankboard')}?section=people`;
    }

    @param('baseScore', Types.Float, true)
    @param('decayFactor', Types.Float, true)
    async postConfig(_ctx: any, baseScore?: number, decayFactor?: number) {
        this.checkStructuralOp();
        if (baseScore != null || decayFactor != null) {
            const current = await getConfig();
            await setConfig({
                baseScore: baseScore ?? current.baseScore,
                decayFactor: decayFactor ?? current.decayFactor,
            });
        }
        this.response.redirect = `${this.url('admin_rankboard')}?section=settings`;
    }

    @param('batchId', Types.ObjectId)
    async postRollbackBatch(_ctx: any, batchId: ObjectId) {
        this.checkDataOp();
        const result = await rollbackImportBatch(batchId, this.user._id);
        this.response.body = { rolledBack: result.pulled };
        this.response.redirect = `${this.url('admin_rankboard')}?section=import`;
    }

    @param('batchTsv', Types.Content)
    @param('createMissing', Types.Boolean, true)
    @param('schoolId', Types.ObjectId, true)
    async postBatch(_ctx: any, batchTsv: string, createMissing?: boolean, schoolId?: ObjectId) {
        this.checkDataOp();
        // Radix Select 的 required 不可靠，空值提交会让 createMissing
        // 静默失效——显式报错（对抗性审查 #11）。
        if (createMissing && !schoolId) throw new ValidationError('schoolId', null, localizedErrorText`开启自动建档时必须选择学校`);
        const rows: BatchImportRow[] = batchTsv
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean)
            .filter((line) => !line.startsWith('#'))
            .map((line) => {
                const parts = line.split('\t');
                return {
                    studentId: (parts[0] || '').trim(),
                    type: (parts[1] || '').trim(),
                    contest: (parts[2] || '').trim() || undefined,
                    date: (parts[3] || '').trim() || undefined,
                    liveRank: parts[4] ? Number(parts[4]) || undefined : undefined,
                    schoolRank: parts[5] ? Number(parts[5]) || undefined : undefined,
                    team: (parts[6] || '').trim() || undefined,
                    teammates: parts[7]
                        ? parts[7]
                              .split(',')
                              .map((s) => s.trim())
                              .filter(Boolean)
                        : undefined,
                    realName: (parts[8] || '').trim() || undefined,
                };
            });
        const report = await importAwardsBatch(rows, this.user._id, {
            createMissing: !!createMissing,
            schoolId,
        });
        await this.renderSection('import', { report });
    }
}

class AdminAwardTypesHandler extends AdminBase {
    async get() {
        this.checkStructuralOp();
        const types = await listAwardTypes({ includeHidden: true });
        this.response.template = 'admin_rankboard_awards.html';
        this.response.body = {
            types,
            canImport: this.canImportRankboard(),
            canManage: this.canManageRankboard(),
        };
    }

    @param('key', Types.String)
    @param('name', Types.String)
    @param('weight', Types.Float)
    @param('useRankDecay', Types.Boolean, true)
    @param('order', Types.Int, true)
    @param('hidden', Types.Boolean, true)
    async postUpsert(_ctx: any, key: string, name: string, weight: number, useRankDecay?: boolean, order?: number, hidden?: boolean) {
        this.checkStructuralOp();
        await upsertAwardType({
            key,
            name,
            weight,
            useRankDecay: !!useRankDecay,
            order: order || 100,
            hidden,
        });
        this.response.redirect = this.url('admin_rankboard_awards');
    }

    @param('key', Types.String)
    async postDelete(_ctx: any, key: string) {
        this.checkStructuralOp();
        await deleteAwardType(key);
        this.response.redirect = this.url('admin_rankboard_awards');
    }
}

class AdminPersonDetailHandler extends AdminBase {
    @param('id', Types.ObjectId)
    async get(_ctx: any, id: ObjectId) {
        const person = await getPerson(id);
        if (!person) throw new NotFoundError(localizedErrorText`person`, String(id));
        // Overlay empty 天梯赛 scores from the store so the admin sees the
        // same numeric score as the public board; existing edits stay.
        await applyGpltStoreScores([person]);
        const student = await studentsColl.findOne({ _id: person.studentDocId });
        const types = await listAwardTypes({ includeHidden: true });
        this.response.template = 'admin_rankboard_person.html';
        this.response.body = {
            person: {
                ...person,
                _id: String(person._id),
                studentDocId: String(person.studentDocId),
            },
            student: student
                ? {
                      ...student,
                      _id: String(student._id),
                      schoolId: String(student.schoolId),
                  }
                : null,
            types,
            canImport: this.canImportRankboard(),
            canManage: this.canManageRankboard(),
        };
    }

    @param('id', Types.ObjectId)
    @param('awards', Types.Content, true)
    @param('employmentStatus', Types.String, true)
    async postSave(_ctx: any, id: ObjectId, awardsJson?: string, employmentStatus?: string) {
        this.checkDataOp();
        // JSON 往返会把 importBatchId 的 ObjectId 变成 string——存回前还原，
        // 否则批次回滚的 $pull 匹配不到这些奖项。
        const awards: Award[] = (awardsJson ? JSON.parse(awardsJson) : []).map((a: any) => ({
            ...a,
            ...(a.importBatchId ? { importBatchId: new ObjectId(a.importBatchId) } : {}),
        }));
        await updatePerson(id, { awards, employmentStatus });
        this.response.redirect = this.url('admin_rankboard_person', { id: String(id) });
    }
}

class AdminPeopleSearchHandler extends AdminBase {
    @param('q', Types.String, true)
    async get(_ctx: any, q?: string) {
        // 荣誉榜是 system 域全局单例——搜索也限定 system 域，避免把外域学生
        // 加进榜单或泄漏外域学号姓名（对抗性审查 G5）。
        const filter: Record<string, unknown> = { domainId: RANKBOARD_DOMAIN };
        if (q && q.trim()) {
            const safe = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            filter.$or = [{ studentId: { $regex: safe, $options: 'i' } }, { realName: { $regex: safe, $options: 'i' } }];
        }
        const docs = await studentsColl.find(filter).limit(20).toArray();
        this.response.body = {
            students: docs.map((s) => ({
                _id: String(s._id),
                studentId: s.studentId,
                realName: s.realName,
                schoolId: String(s.schoolId),
                boundUserId: s.boundUserId,
            })),
        };
    }
}

/**
 * Search teammates by OJ uname OR userbind student (studentId / realName).
 *
 * Returns a unified result list distinguished by `kind`:
 *   - `user`    — an OJ account; `label` is the uname.
 *   - `student` — a userbind.students entry without (or with) an OJ binding;
 *                 `label` is "学号 姓名" so the stored teammate string stays
 *                 readable even when the student has no OJ account.
 *
 * The frontend writes `label` into the `teammates: string[]` field directly,
 * so freetext picks (non-OJ, non-student) still work.
 */
class AdminUserSearchHandler extends AdminBase {
    @param('q', Types.String, true)
    async get(_ctx: any, q?: string) {
        const results: Array<{
            kind: 'user' | 'student';
            label: string;
            uid?: number;
            uname?: string;
            studentId?: string;
            realName?: string;
            boundUserId?: number | null;
        }> = [];
        const query = (q || '').trim();
        if (!query) {
            this.response.body = { results, users: [] };
            return;
        }

        // OJ users by uname prefix.
        const userMatches = await UserModel.getPrefixList(this.domain._id, query, 10);
        for (const u of userMatches.filter(Boolean)) {
            results.push({ kind: 'user', label: u.uname, uid: u._id, uname: u.uname });
        }

        // userbind.students by studentId or realName（限定 system 域，G5）。
        const safe = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const studentDocs = await studentsColl
            .find({
                domainId: RANKBOARD_DOMAIN,
                $or: [{ studentId: { $regex: safe, $options: 'i' } }, { realName: { $regex: safe, $options: 'i' } }],
            })
            .limit(10)
            .toArray();
        for (const s of studentDocs) {
            const label = `${s.studentId} ${s.realName}`;
            results.push({
                kind: 'student',
                label,
                studentId: s.studentId,
                realName: s.realName,
                boundUserId: s.boundUserId ?? null,
            });
        }

        // Legacy `users` field kept for older callers.
        const users = results.filter((r) => r.kind === 'user').map((r) => ({ uid: r.uid!, uname: r.uname! }));
        this.response.body = { results, users };
    }
}

/**
 * 荣誉照片墙（PLAN 2026-07-02 §7）——公开展示；带数据权限的用户可在
 * 卡片上内联传照片（前端先传 /file 拿 URL，再 POST 挂到目标奖项）。
 */
class RankBoardGalleryHandler extends Handler {
    noCheckPermView = true;

    // 荣誉榜是 system 全局单例——上传权限同样要锁定 system 域（G1 同源问题）。
    private canUpload(): boolean {
        if (this.user.hasPriv(PRIV.PRIV_EDIT_SYSTEM)) return true;
        // Query/body fields live in `this.args` and cannot define the request
        // scope. Use the framework-resolved domain; missing context denies.
        if (String(this.domain?._id ?? '') !== RANKBOARD_DOMAIN) return false;
        return this.user.hasPerm(PERM.PERM_RANKBOARD_IMPORT) || this.user.hasPerm(PERM.PERM_RANKBOARD_MANAGE);
    }

    async get() {
        const gallery = await buildGallery();
        this.response.template = 'rankboard_gallery.html';
        this.response.body = {
            ...gallery,
            canUpload: this.canUpload(),
        };
    }

    @param('personId', Types.ObjectId)
    @param('awardIndex', Types.Int)
    @param('url', Types.String)
    @param('expectType', Types.String, true)
    @param('setCover', Types.Boolean, true)
    @param('replace', Types.Boolean, true)
    async postAddImage(_ctx: any, personId: ObjectId, awardIndex: number, url: string, expectType?: string, setCover?: boolean, replace?: boolean) {
        if (!this.canUpload()) throw new PermissionError(PERM.PERM_RANKBOARD_IMPORT);
        // 只收站内 /file URL 或 http(s) 外链；`/(?![/\\])` 同时挡协议相对
        // 外链 `//evil.com` 和反斜杠变体 `/\evil.com`（浏览器按 // 解析），
        // 长度限 2048（对抗性审查 #8 / G4）。
        if (url.length > 2048 || !/^(?:https?:\/\/|\/(?![/\\]))/i.test(url)) {
            throw new ValidationError('url', null, localizedErrorText`图片链接无效`);
        }
        // TOCTOU 防护（审查 #6/G8）：expectType 作为原子写条件传入，
        // 页面快照里的 awardIndex 因他人回滚/编辑而错位时 matched=0 → null。
        const imageUrls = await addAwardImage(personId, awardIndex, url, !!setCover, expectType, !!replace);
        if (imageUrls === null) {
            this.response.status = 409;
            this.response.body = { error: 'stale', message: '奖项列表已被修改，请刷新页面后重试' };
            return;
        }
        this.response.body = { ok: 1, imageUrls };
    }
}

export function applyHandlers(ctx: Context) {
    ctx.Route('rankboard_main', '/rankboard', RankBoardMainHandler);
    // NOTE: /rankboard/gallery 必须注册在 /rankboard/:studentDocId 之前，
    // 否则 'gallery' 会被当作 studentDocId 解析（同 permits inbox 的教训）。
    ctx.Route('rankboard_gallery', '/rankboard/gallery', RankBoardGalleryHandler);
    ctx.Route('rankboard_detail', '/rankboard/:studentDocId', RankBoardDetailHandler);
    ctx.Route('admin_rankboard', '/admin/rankboard', AdminRankBoardListHandler);
    ctx.Route('admin_rankboard_awards', '/admin/rankboard/awards', AdminAwardTypesHandler);
    ctx.Route('admin_rankboard_person', '/admin/rankboard/people/:id', AdminPersonDetailHandler);
    ctx.Route('admin_rankboard_search', '/admin/rankboard/search', AdminPeopleSearchHandler);
    ctx.Route('admin_rankboard_user_search', '/admin/rankboard/user-search', AdminUserSearchHandler);
}
