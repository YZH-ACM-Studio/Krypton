/**
 * HTTP handlers + route registration for krypton-userbind.
 *
 * Templates set on `this.response.template` are consumed by ui-next's PAGE_MAP
 * (see packages/ui-next/src/pages/resolver.tsx). The actual page UIs are
 * implemented in Issue 1.9 / 1.10 under packages/ui-next/src/pages/userbind/.
 */
import { ObjectId } from 'mongodb';
import {
    Context, Handler, NotFoundError, OplogModel, param, PRIV, Types,
    ValidationError, system,
} from 'hydrooj';
import { userBindModel } from './model';

// ─── Admin handlers ───────────────────────────────────────────────────────

class UserbindAdminHandler extends Handler {
    async prepare() {
        this.checkPriv(PRIV.PRIV_EDIT_SYSTEM);
    }
}

class AdminOverviewHandler extends UserbindAdminHandler {
    async get({ domainId }: { domainId: string }) {
        const [schoolCount, groupCount, studentCount, pendingRequests] = await Promise.all([
            userBindModel.listSchools(domainId).then((s) => s.length),
            userBindModel.listUserGroups(domainId).then((g) => g.length),
            userBindModel.listStudents(domainId, { limit: 1 }).then((r) => r.total),
            userBindModel.listBindingRequests(domainId, { status: 'pending', limit: 1 }).then((r) => r.total),
        ]);
        this.response.template = 'admin_userbind_overview.html';
        this.response.body = {
            schoolCount, groupCount, studentCount, pendingRequests,
        };
    }
}

class AdminSchoolsHandler extends UserbindAdminHandler {
    async get({ domainId }: { domainId: string }) {
        const schools = await userBindModel.listSchools(domainId);
        this.response.template = 'admin_userbind_schools.html';
        this.response.body = { schools };
    }

    @param('name', Types.String)
    async postCreate({ domainId }: { domainId: string }, name: string) {
        const school = await userBindModel.createSchool(domainId, name, this.user._id);
        await OplogModel.log(this, 'userbind.school.create', { schoolId: school._id, name });
        this.response.body = { school };
        this.response.redirect = this.url('admin_userbind_schools');
    }

    @param('schoolId', Types.ObjectId)
    @param('name', Types.String)
    async postRename({ domainId }: { domainId: string }, schoolId: ObjectId, name: string) {
        await userBindModel.updateSchool(domainId, schoolId, { name });
        await OplogModel.log(this, 'userbind.school.rename', { schoolId, name });
        this.response.redirect = this.url('admin_userbind_schools');
    }

    @param('schoolId', Types.ObjectId)
    async postDelete({ domainId }: { domainId: string }, schoolId: ObjectId) {
        await userBindModel.deleteSchool(domainId, schoolId);
        await OplogModel.log(this, 'userbind.school.delete', { schoolId });
        this.response.redirect = this.url('admin_userbind_schools');
    }
}

class AdminSchoolDetailHandler extends UserbindAdminHandler {
    @param('schoolId', Types.ObjectId)
    async get({ domainId }: { domainId: string }, schoolId: ObjectId) {
        const school = await userBindModel.getSchool(domainId, schoolId);
        if (!school) throw new NotFoundError('School');
        const [groups, { docs: students, total }] = await Promise.all([
            userBindModel.listUserGroups(domainId, schoolId),
            userBindModel.listStudents(domainId, { schoolId, limit: 200 }),
        ]);
        this.response.template = 'admin_userbind_school_detail.html';
        this.response.body = { school, groups, students, studentTotal: total };
    }
}

class AdminGroupsHandler extends UserbindAdminHandler {
    @param('schoolId', Types.ObjectId, true)
    async get({ domainId }: { domainId: string }, schoolId?: ObjectId) {
        const [groups, schools] = await Promise.all([
            userBindModel.listUserGroups(domainId, schoolId),
            userBindModel.listSchools(domainId),
        ]);
        this.response.template = 'admin_userbind_groups.html';
        this.response.body = { groups, schools, filterSchoolId: schoolId };
    }

    @param('schoolId', Types.ObjectId)
    @param('name', Types.String)
    async postCreate({ domainId }: { domainId: string }, schoolId: ObjectId, name: string) {
        const group = await userBindModel.createUserGroup(domainId, schoolId, name, this.user._id);
        await OplogModel.log(this, 'userbind.group.create', { groupId: group._id, name });
        this.response.body = { group };
        this.response.redirect = this.url('admin_userbind_groups');
    }

    @param('groupId', Types.ObjectId)
    @param('name', Types.String)
    async postRename({ domainId }: { domainId: string }, groupId: ObjectId, name: string) {
        await userBindModel.updateUserGroup(domainId, groupId, { name });
        this.response.redirect = this.url('admin_userbind_groups');
    }

    @param('groupId', Types.ObjectId)
    async postDelete({ domainId }: { domainId: string }, groupId: ObjectId) {
        await userBindModel.deleteUserGroup(domainId, groupId);
        this.response.redirect = this.url('admin_userbind_groups');
    }
}

class AdminGroupDetailHandler extends UserbindAdminHandler {
    @param('groupId', Types.ObjectId)
    async get({ domainId }: { domainId: string }, groupId: ObjectId) {
        const group = await userBindModel.getUserGroup(domainId, groupId);
        if (!group) throw new NotFoundError('Group');
        const { docs: members } = await userBindModel.listStudents(domainId, { groupId, limit: 500 });
        this.response.template = 'admin_userbind_group_detail.html';
        this.response.body = { group, members };
    }

    @param('groupId', Types.ObjectId)
    @param('studentIds', Types.CommaSeperatedArray)
    async postAssign(
        { domainId }: { domainId: string }, groupId: ObjectId, studentIds: string[],
    ) {
        const ids = studentIds.map((s) => new ObjectId(s));
        await userBindModel.assignStudentsToGroup(domainId, groupId, ids);
        this.response.redirect = this.url('admin_userbind_group_detail', { groupId });
    }

    @param('groupId', Types.ObjectId)
    @param('studentIds', Types.CommaSeperatedArray)
    async postRemove(
        { domainId }: { domainId: string }, groupId: ObjectId, studentIds: string[],
    ) {
        const ids = studentIds.map((s) => new ObjectId(s));
        await userBindModel.removeStudentsFromGroup(domainId, groupId, ids);
        this.response.redirect = this.url('admin_userbind_group_detail', { groupId });
    }
}

class AdminStudentsHandler extends UserbindAdminHandler {
    @param('schoolId', Types.ObjectId, true)
    @param('groupId', Types.ObjectId, true)
    @param('q', Types.String, true)
    @param('page', Types.PositiveInt, true)
    async get(
        { domainId }: { domainId: string },
        schoolId?: ObjectId, groupId?: ObjectId, q?: string, page = 1,
    ) {
        const limit = 50;
        const { docs: students, total } = await userBindModel.listStudents(domainId, {
            schoolId, groupId, query: q, limit, skip: (page - 1) * limit,
        });
        const schools = await userBindModel.listSchools(domainId);
        this.response.template = 'admin_userbind_students.html';
        this.response.body = {
            students, total, page, pageSize: limit,
            schools, filterSchoolId: schoolId, filterGroupId: groupId, q,
        };
    }
}

class AdminStudentImportHandler extends UserbindAdminHandler {
    async get({ domainId }: { domainId: string }) {
        const schools = await userBindModel.listSchools(domainId);
        this.response.template = 'admin_userbind_students_import.html';
        this.response.body = { schools, report: null };
    }

    @param('schoolId', Types.ObjectId)
    @param('text', Types.String)
    async post(
        { domainId }: { domainId: string }, schoolId: ObjectId, text: string,
    ) {
        const rows = parseStudentImportText(text);
        const report = await userBindModel.importStudents(domainId, schoolId, rows, this.user._id);
        await OplogModel.log(this, 'userbind.student.import', {
            schoolId, attempted: rows.length, inserted: report.inserted,
        });
        const schools = await userBindModel.listSchools(domainId);
        this.response.template = 'admin_userbind_students_import.html';
        this.response.body = { schools, report };
    }
}

function parseStudentImportText(text: string): Array<{ studentId: string; realName: string }> {
    return (text || '')
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith('#'))
        .map((line) => {
            const parts = line.split(/[\s,;\t]+/).filter(Boolean);
            return { studentId: parts[0] || '', realName: parts.slice(1).join(' ') || '' };
        });
}

class AdminTokensHandler extends UserbindAdminHandler {
    @param('schoolId', Types.ObjectId, true)
    @param('unusedOnly', Types.Boolean, true)
    async get(
        { domainId }: { domainId: string }, schoolId?: ObjectId, unusedOnly = false,
    ) {
        const tokens = await userBindModel.listInviteTokens(domainId, { unusedOnly });
        this.response.template = 'admin_userbind_tokens.html';
        this.response.body = { tokens, filterSchoolId: schoolId, unusedOnly };
    }

    @param('studentRecordId', Types.ObjectId)
    @param('ttlDays', Types.UnsignedInt, true)
    async postGenerate(
        { domainId }: { domainId: string }, studentRecordId: ObjectId, ttlDays = 0,
    ) {
        const ttlMs = ttlDays > 0 ? ttlDays * 86400 * 1000 : undefined;
        const token = await userBindModel.generateInviteToken(
            domainId, studentRecordId, this.user._id, ttlMs,
        );
        this.response.body = { token };
        this.response.redirect = this.url('admin_userbind_tokens');
    }

    @param('tokenId', Types.String)
    async postRevoke({ }, tokenId: string) {
        await userBindModel.revokeInviteToken(tokenId);
        this.response.redirect = this.url('admin_userbind_tokens');
    }
}

class AdminRequestsHandler extends UserbindAdminHandler {
    @param('status', Types.String, true)
    @param('page', Types.PositiveInt, true)
    async get(
        { domainId }: { domainId: string }, status?: string, page = 1,
    ) {
        const limit = 30;
        const validStatus = (['pending', 'approved', 'rejected'] as const).includes(status as any)
            ? status as 'pending' | 'approved' | 'rejected'
            : undefined;
        const { docs, total } = await userBindModel.listBindingRequests(domainId, {
            status: validStatus, limit, skip: (page - 1) * limit,
        });
        this.response.template = 'admin_userbind_requests.html';
        this.response.body = {
            requests: docs, total, page, pageSize: limit, status: validStatus,
        };
    }

    @param('requestId', Types.ObjectId)
    async postApprove({ }, requestId: ObjectId) {
        await userBindModel.approveBindingRequest(requestId, this.user._id);
        await OplogModel.log(this, 'userbind.request.approve', { requestId });
        this.response.redirect = this.url('admin_userbind_requests');
    }

    @param('requestId', Types.ObjectId)
    @param('reason', Types.String, true)
    async postReject({ }, requestId: ObjectId, reason = '') {
        await userBindModel.rejectBindingRequest(requestId, this.user._id, reason);
        await OplogModel.log(this, 'userbind.request.reject', { requestId, reason });
        this.response.redirect = this.url('admin_userbind_requests');
    }
}

// ─── Student-facing handlers ──────────────────────────────────────────────

class UserBindHandler extends Handler {
    async prepare() {
        this.checkPriv(PRIV.PRIV_USER_PROFILE);
    }

    async get({ domainId }: { domainId: string }) {
        const schools = await userBindModel.listSchools(domainId);
        const myRequests = await userBindModel.listBindingRequests(domainId, { userId: this.user._id, limit: 10 });
        const alreadyBound = !!(this.user as any).studentId;
        this.response.template = 'user_bind.html';
        this.response.body = {
            schools, myRequests: myRequests.docs, alreadyBound,
            currentStudentId: (this.user as any).studentId || null,
            currentRealName: (this.user as any).realName || null,
        };
    }

    @param('schoolId', Types.ObjectId)
    @param('studentId', Types.String)
    @param('realName', Types.String)
    async post(
        { domainId }: { domainId: string },
        schoolId: ObjectId, studentId: string, realName: string,
    ) {
        await userBindModel.submitBindingRequest(
            domainId, this.user._id, schoolId, studentId, realName,
        );
        this.response.redirect = this.url('user_bind');
    }
}

class BindLandingHandler extends Handler {
    async prepare() {
        // Allow unauthenticated landing — show "please log in to bind" prompt.
    }

    @param('token', Types.String)
    async get({ }, token: string) {
        this.response.template = 'user_bind_landing.html';
        // Don't expose student info to anonymous viewers — defer to JSON probe.
        this.response.body = { token, signedIn: this.user._id !== 0 };
    }

    @param('token', Types.String)
    async post({ }, token: string) {
        this.checkPriv(PRIV.PRIV_USER_PROFILE);
        const { studentRecord, school } = await userBindModel.consumeInviteToken(token, this.user._id);
        await OplogModel.log(this, 'userbind.bind.invite', {
            token, studentRecordId: studentRecord._id, schoolId: school._id,
        });
        this.response.template = 'user_bind_success.html';
        this.response.body = { studentRecord, school };
    }
}

class UserBindClaimHandler extends Handler {
    async prepare() {
        this.checkPriv(PRIV.PRIV_USER_PROFILE);
    }

    async get() {
        // List of temp users whose studentId+realName matches the requesting user's
        // — these are candidates to claim. Caller-side filtering happens in the UI.
        this.response.template = 'user_bind_claim.html';
        this.response.body = {
            currentStudentId: (this.user as any).studentId || null,
        };
    }

    @param('tempUserId', Types.Int)
    @param('schoolId', Types.ObjectId)
    @param('studentId', Types.String)
    @param('realName', Types.String)
    async post(
        { domainId }: { domainId: string },
        tempUserId: number, schoolId: ObjectId, studentId: string, realName: string,
    ) {
        const req = await userBindModel.submitBindingRequest(
            domainId, this.user._id, schoolId, studentId, realName,
        );
        // Attach the temp user reference for the reviewer.
        const { bindingRequestsColl } = await import('./db');
        await bindingRequestsColl.updateOne(
            { _id: req._id }, { $set: { claimTempUserId: tempUserId } },
        );
        this.response.redirect = this.url('user_bind');
    }
}

// ─── Force-bind middleware (before-prepare hook) ──────────────────────────

const FORCE_BIND_BYPASS_PREFIX = [
    '/user_bind', '/bind', '/login', '/logout', '/register',
    '/lostpass', '/sudo', '/api', '/manifest.json', '/favicon',
    '/_spike-webview',
];

function shouldEnforceBindFor(handler: Handler): boolean {
    if (!handler.user || handler.user._id === 0) return false;
    if ((handler.user as any).isTemporary) return false; // temp users (Task 2) — never enforce
    if ((handler.user as any).studentId) return false; // already bound
    const path = handler.request.path || '';
    if (FORCE_BIND_BYPASS_PREFIX.some((p) => path === p || path.startsWith(`${p}/`))) return false;
    return true;
}

// ─── Route registration ───────────────────────────────────────────────────

export function applyHandlers(ctx: Context) {
    // Admin
    ctx.Route('admin_userbind', '/admin/userbind', AdminOverviewHandler, PRIV.PRIV_EDIT_SYSTEM);
    ctx.Route('admin_userbind_schools', '/admin/userbind/schools', AdminSchoolsHandler, PRIV.PRIV_EDIT_SYSTEM);
    ctx.Route('admin_userbind_school_detail', '/admin/userbind/schools/:schoolId', AdminSchoolDetailHandler, PRIV.PRIV_EDIT_SYSTEM);
    ctx.Route('admin_userbind_groups', '/admin/userbind/groups', AdminGroupsHandler, PRIV.PRIV_EDIT_SYSTEM);
    ctx.Route('admin_userbind_group_detail', '/admin/userbind/groups/:groupId', AdminGroupDetailHandler, PRIV.PRIV_EDIT_SYSTEM);
    ctx.Route('admin_userbind_students', '/admin/userbind/students', AdminStudentsHandler, PRIV.PRIV_EDIT_SYSTEM);
    ctx.Route('admin_userbind_students_import', '/admin/userbind/students/import', AdminStudentImportHandler, PRIV.PRIV_EDIT_SYSTEM);
    ctx.Route('admin_userbind_tokens', '/admin/userbind/tokens', AdminTokensHandler, PRIV.PRIV_EDIT_SYSTEM);
    ctx.Route('admin_userbind_requests', '/admin/userbind/requests', AdminRequestsHandler, PRIV.PRIV_EDIT_SYSTEM);

    // Student-facing
    ctx.Route('user_bind', '/user/bind', UserBindHandler, PRIV.PRIV_USER_PROFILE);
    ctx.Route('user_bind_claim', '/user/bind/claim', UserBindClaimHandler, PRIV.PRIV_USER_PROFILE);
    ctx.Route('user_bind_landing', '/bind/:token', BindLandingHandler);

    // Force-bind enforcement hook (PRD §3.2 — "保留，但条件化")
    ctx.on('handler/before-prepare', async (h) => {
        const enforced = system.get('userbind.forceBind');
        if (!enforced) return;
        if (!shouldEnforceBindFor(h as Handler)) return;
        // Soft redirect: only on GET requests for HTML; let API calls proceed and fail elsewhere.
        const accept = h.request?.headers?.accept || '';
        if (h.request?.method !== 'GET') return;
        if (!accept.includes('text/html')) return;
        (h.response as any).redirect = (h as Handler).url('user_bind');
        // Throwing here would abort the chain; instead the redirect terminates the flow.
        return true;
    });
}
