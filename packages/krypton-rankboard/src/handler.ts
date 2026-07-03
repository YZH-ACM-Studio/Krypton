/**
 * Route handlers for krypton-rankboard.
 *
 *   GET  /rankboard                         RankBoardMainHandler          (public)
 *   GET  /rankboard/:studentDocId           RankBoardDetailHandler        (public)
 *   GET  /admin/rankboard                   AdminRankBoardListHandler     (system admin)
 *   POST /admin/rankboard                   AdminRankBoardListHandler.post (add / delete / config / batch)
 *   GET  /admin/rankboard/awards            AdminAwardTypesHandler        (system admin)
 *   POST /admin/rankboard/awards            AdminAwardTypesHandler.post   (upsert / delete)
 *   GET  /admin/rankboard/people/:id        AdminPersonDetailHandler      (system admin)
 *   POST /admin/rankboard/people/:id        AdminPersonDetailHandler.post (save awards / upload image)
 */
import type { Context } from 'hydrooj';
import {
    db, Handler, NotFoundError, ObjectId, param, PERM, PermissionError, PRIV,
    PrivilegeError, Types, UserModel, ValidationError,
} from 'hydrooj';
import {
    addAward, addAwardImage, applyGpltStoreScores, buildGallery, createPerson, deleteAwardType,
    deletePerson, getConfig, getPerson, importAwardsBatch, listAwardTypes, listImportBatches,
    listLeaderboard, RANKBOARD_DOMAIN, removeAwardAt, rollbackImportBatch, setConfig,
    updateAwardAt, updatePerson, upsertAwardType,
} from './model';
import type { BatchImportRow } from './model';
import type { Award } from './types';

const studentsColl = db.collection<any>('userbind.students');
const schoolsColl = db.collection<any>('userbind.schools');

class RankBoardMainHandler extends Handler {
    noCheckPermView = true;
    async get() {
        const [rows, awardTypes, config] = await Promise.all([
            listLeaderboard(),
            listAwardTypes(),
            getConfig(),
        ]);
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
        if (!row) throw new NotFoundError('person', String(studentDocId));
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
 * 权限分层（PLAN 2026-07-02 §1）：
 *  - 进入 admin 页面：站点管理员 或 持 PERM_RANKBOARD_IMPORT / MANAGE 的角色（教师）。
 *  - 数据操作（导入/录奖/传照片/编辑人员）：PERM_RANKBOARD_IMPORT。
 *  - 结构操作（奖项类型/计分权重/删除人员）：PERM_RANKBOARD_MANAGE，教师默认没有。
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
        return this.user.hasPriv(PRIV.PRIV_EDIT_SYSTEM) || this.args.domainId === RANKBOARD_DOMAIN;
    }

    async prepare() {
        if (this.user.hasPriv(PRIV.PRIV_EDIT_SYSTEM)) return;
        if (this.rankboardScopeOk()
            && (this.user.hasPerm(PERM.PERM_RANKBOARD_MANAGE) || this.user.hasPerm(PERM.PERM_RANKBOARD_IMPORT))) return;
        throw new PrivilegeError(PRIV.PRIV_EDIT_SYSTEM);
    }

    checkDataOp() {
        if (this.user.hasPriv(PRIV.PRIV_EDIT_SYSTEM)) return;
        if (this.rankboardScopeOk()
            && (this.user.hasPerm(PERM.PERM_RANKBOARD_MANAGE) || this.user.hasPerm(PERM.PERM_RANKBOARD_IMPORT))) return;
        throw new PermissionError(PERM.PERM_RANKBOARD_IMPORT);
    }

    checkStructuralOp() {
        if (this.user.hasPriv(PRIV.PRIV_EDIT_SYSTEM)) return;
        if (this.rankboardScopeOk() && this.user.hasPerm(PERM.PERM_RANKBOARD_MANAGE)) return;
        throw new PermissionError(PERM.PERM_RANKBOARD_MANAGE);
    }
}

class AdminRankBoardListHandler extends AdminBase {
    async get() {
        const [rows, config, batches, schools] = await Promise.all([
            listLeaderboard(),
            getConfig(),
            listImportBatches(),
            schoolsColl.find({ domainId: RANKBOARD_DOMAIN }).toArray(),
        ]);
        this.response.template = 'admin_rankboard.html';
        this.response.body = {
            rows: rows.map((r) => ({
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
            })),
            config,
            batches: batches.map((b) => ({ ...b, _id: String(b._id) })),
            schools: schools.map((s: any) => ({ _id: String(s._id), name: s.name })),
            // 前端按此决定结构操作按钮（配置/删除/奖项类型）是否可见。
            canManage: this.user.hasPriv(PRIV.PRIV_EDIT_SYSTEM) || this.user.hasPerm(PERM.PERM_RANKBOARD_MANAGE),
        };
    }

    @param('operation', Types.String)
    @param('studentDocId', Types.ObjectId, true)
    @param('personId', Types.ObjectId, true)
    @param('baseScore', Types.Float, true)
    @param('decayFactor', Types.Float, true)
    @param('batchTsv', Types.Content, true)
    @param('createMissing', Types.Boolean, true)
    @param('schoolId', Types.ObjectId, true)
    @param('batchId', Types.ObjectId, true)
    async post(
        { domainId }: { domainId: string },
        operation: string,
        studentDocId?: ObjectId,
        personId?: ObjectId,
        baseScore?: number,
        decayFactor?: number,
        batchTsv?: string,
        createMissing?: boolean,
        schoolId?: ObjectId,
        batchId?: ObjectId,
    ) {
        switch (operation) {
            case 'add': {
                this.checkDataOp();
                if (!studentDocId) throw new Error('studentDocId required');
                const student = await studentsColl.findOne({ _id: studentDocId });
                if (!student) throw new NotFoundError('student', String(studentDocId));
                const person = await createPerson({
                    studentDocId, createdBy: this.user._id,
                });
                this.response.redirect = this.url('admin_rankboard_person', { id: String(person._id) });
                return;
            }
            case 'delete': {
                this.checkStructuralOp();
                if (!personId) throw new Error('personId required');
                await deletePerson(personId);
                break;
            }
            case 'config': {
                this.checkStructuralOp();
                if (baseScore == null && decayFactor == null) break;
                const current = await getConfig();
                await setConfig({
                    baseScore: baseScore ?? current.baseScore,
                    decayFactor: decayFactor ?? current.decayFactor,
                });
                break;
            }
            case 'rollbackBatch': {
                this.checkDataOp();
                if (!batchId) throw new Error('batchId required');
                const r = await rollbackImportBatch(batchId, this.user._id);
                this.response.body = { rolledBack: r.pulled };
                break;
            }
            case 'batch': {
                this.checkDataOp();
                if (!batchTsv) throw new Error('batchTsv required');
                // Radix Select 的 required 不可靠，空值提交会让 createMissing
                // 静默失效——显式报错（对抗性审查 #11）。
                if (createMissing && !schoolId) throw new ValidationError('schoolId', null, '开启自动建档时必须选择学校');
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
                                ? parts[7].split(',').map((s) => s.trim()).filter(Boolean)
                                : undefined,
                            realName: (parts[8] || '').trim() || undefined,
                        };
                    });
                const report = await importAwardsBatch(rows, this.user._id, {
                    createMissing: !!createMissing, schoolId,
                });
                this.response.body = { report };
                this.response.template = 'admin_rankboard.html';
                // Reload data for the page
                const fresh = await listLeaderboard();
                this.response.body.rows = fresh.map((r) => ({
                    ...r,
                    student: { ...r.student, _id: String(r.student._id), schoolId: String(r.student.schoolId) },
                    person: { ...r.person, _id: String(r.person._id), studentDocId: String(r.person.studentDocId) },
                }));
                this.response.body.config = await getConfig();
                this.response.body.batches = (await listImportBatches()).map((b) => ({ ...b, _id: String(b._id) }));
                this.response.body.schools = (await schoolsColl.find({ domainId: RANKBOARD_DOMAIN }).toArray()).map((s: any) => ({ _id: String(s._id), name: s.name }));
                this.response.body.canManage = this.user.hasPriv(PRIV.PRIV_EDIT_SYSTEM) || this.user.hasPerm(PERM.PERM_RANKBOARD_MANAGE);
                return;
            }
            default:
                throw new Error(`unknown operation: ${operation}`);
        }
        this.response.redirect = this.url('admin_rankboard');
    }
}

class AdminAwardTypesHandler extends AdminBase {
    async get() {
        const types = await listAwardTypes({ includeHidden: true });
        this.response.template = 'admin_rankboard_awards.html';
        this.response.body = { types };
    }

    @param('operation', Types.String)
    @param('key', Types.String, true)
    @param('name', Types.String, true)
    @param('weight', Types.Float, true)
    @param('useRankDecay', Types.Boolean, true)
    @param('order', Types.Int, true)
    @param('hidden', Types.Boolean, true)
    async post(
        _ctx: any, operation: string,
        key?: string, name?: string, weight?: number,
        useRankDecay?: boolean, order?: number, hidden?: boolean,
    ) {
        this.checkStructuralOp();
        if (operation === 'upsert') {
            if (!key || !name || weight == null) throw new Error('key/name/weight required');
            await upsertAwardType({
                key, name, weight, useRankDecay: !!useRankDecay,
                order: order || 100, hidden,
            });
        } else if (operation === 'delete') {
            if (!key) throw new Error('key required');
            await deleteAwardType(key);
        }
        this.response.redirect = this.url('admin_rankboard_awards');
    }
}

class AdminPersonDetailHandler extends AdminBase {
    @param('id', Types.ObjectId)
    async get(_ctx: any, id: ObjectId) {
        const person = await getPerson(id);
        if (!person) throw new NotFoundError('person', String(id));
        // Overlay 天梯赛 scores from the store (store-first, embedded fallback)
        // so the admin sees the same numeric score as the public board.
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
            student: student ? {
                ...student,
                _id: String(student._id),
                schoolId: String(student.schoolId),
            } : null,
            types,
        };
    }

    @param('id', Types.ObjectId)
    @param('operation', Types.String)
    @param('awards', Types.Content, true)
    @param('employmentStatus', Types.String, true)
    async post(
        _ctx: any, id: ObjectId, operation: string,
        awardsJson?: string, employmentStatus?: string,
    ) {
        this.checkDataOp();
        if (operation === 'save') {
            // JSON 往返会把 importBatchId 的 ObjectId 变成 string——存回前还原，
            // 否则批次回滚的 $pull 匹配不到这些奖项。
            const awards: Award[] = (awardsJson ? JSON.parse(awardsJson) : []).map((a: any) => ({
                ...a,
                ...(a.importBatchId ? { importBatchId: new ObjectId(a.importBatchId) } : {}),
            }));
            await updatePerson(id, { awards, employmentStatus });
        } else if (operation === 'upload') {
            // For now images are passed in via the `awards` JSON which includes
            // imageUrls populated by the frontend after uploading separately
            // through Hydro's file endpoints. (See P3 admin UI.)
        }
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
            filter.$or = [
                { studentId: { $regex: safe, $options: 'i' } },
                { realName: { $regex: safe, $options: 'i' } },
            ];
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
        const studentDocs = await studentsColl.find({
            domainId: RANKBOARD_DOMAIN,
            $or: [
                { studentId: { $regex: safe, $options: 'i' } },
                { realName: { $regex: safe, $options: 'i' } },
            ],
        }).limit(10).toArray();
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
        const users = results
            .filter((r) => r.kind === 'user')
            .map((r) => ({ uid: r.uid!, uname: r.uname! }));
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
        if (this.args.domainId !== RANKBOARD_DOMAIN) return false;
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
    async postAddImage(
        _ctx: any, personId: ObjectId, awardIndex: number, url: string,
        expectType?: string, setCover?: boolean,
    ) {
        if (!this.canUpload()) throw new PermissionError(PERM.PERM_RANKBOARD_IMPORT);
        // 只收站内 /file URL 或 http(s) 外链；`/(?![/\\])` 同时挡协议相对
        // 外链 `//evil.com` 和反斜杠变体 `/\evil.com`（浏览器按 // 解析），
        // 长度限 2048（对抗性审查 #8 / G4）。
        if (url.length > 2048 || !/^(https?:\/\/|\/(?![/\\]))/i.test(url)) {
            throw new ValidationError('url', null, '图片链接无效');
        }
        // TOCTOU 防护（审查 #6/G8）：expectType 作为原子写条件传入，
        // 页面快照里的 awardIndex 因他人回滚/编辑而错位时 matched=0 → null。
        const imageUrls = await addAwardImage(personId, awardIndex, url, !!setCover, expectType);
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
