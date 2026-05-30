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
    db, Handler, NotFoundError, ObjectId, param, PRIV,
    PrivilegeError, Types, UserModel,
} from 'hydrooj';
import {
    addAward, createPerson, deleteAwardType, deletePerson, getConfig, getPerson,
    importAwardsBatch, listAwardTypes, listLeaderboard, removeAwardAt,
    setConfig, updateAwardAt, updatePerson, upsertAwardType,
} from './model';
import type { Award, BatchImportRow } from './types';

const studentsColl = db.collection<any>('userbind.students');

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

class AdminBase extends Handler {
    async prepare() {
        if (!this.user.hasPriv(PRIV.PRIV_EDIT_SYSTEM)) {
            throw new PrivilegeError(PRIV.PRIV_EDIT_SYSTEM);
        }
    }
}

class AdminRankBoardListHandler extends AdminBase {
    async get() {
        const rows = await listLeaderboard();
        const config = await getConfig();
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
        };
    }

    @param('operation', Types.String)
    @param('studentDocId', Types.ObjectId, true)
    @param('personId', Types.ObjectId, true)
    @param('baseScore', Types.Float, true)
    @param('decayFactor', Types.Float, true)
    @param('batchTsv', Types.Content, true)
    async post(
        _ctx: any,
        operation: string,
        studentDocId?: ObjectId,
        personId?: ObjectId,
        baseScore?: number,
        decayFactor?: number,
        batchTsv?: string,
    ) {
        switch (operation) {
            case 'add': {
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
                if (!personId) throw new Error('personId required');
                await deletePerson(personId);
                break;
            }
            case 'config': {
                if (baseScore == null && decayFactor == null) break;
                const current = await getConfig();
                await setConfig({
                    baseScore: baseScore ?? current.baseScore,
                    decayFactor: decayFactor ?? current.decayFactor,
                });
                break;
            }
            case 'batch': {
                if (!batchTsv) throw new Error('batchTsv required');
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
                        };
                    });
                const report = await importAwardsBatch(rows, this.user._id);
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
        if (operation === 'save') {
            const awards: Award[] = awardsJson ? JSON.parse(awardsJson) : [];
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
        const filter: Record<string, unknown> = {};
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

        // userbind.students by studentId or realName.
        const safe = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const studentDocs = await studentsColl.find({
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

export function applyHandlers(ctx: Context) {
    ctx.Route('rankboard_main', '/rankboard', RankBoardMainHandler);
    ctx.Route('rankboard_detail', '/rankboard/:studentDocId', RankBoardDetailHandler);
    ctx.Route('admin_rankboard', '/admin/rankboard', AdminRankBoardListHandler);
    ctx.Route('admin_rankboard_awards', '/admin/rankboard/awards', AdminAwardTypesHandler);
    ctx.Route('admin_rankboard_person', '/admin/rankboard/people/:id', AdminPersonDetailHandler);
    ctx.Route('admin_rankboard_search', '/admin/rankboard/search', AdminPeopleSearchHandler);
    ctx.Route('admin_rankboard_user_search', '/admin/rankboard/user-search', AdminUserSearchHandler);
}
