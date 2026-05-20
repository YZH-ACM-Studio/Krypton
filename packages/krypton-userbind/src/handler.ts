/**
 * HTTP handlers + route registration for krypton-userbind.
 *
 * Templates set on `this.response.template` are consumed by ui-next's PAGE_MAP
 * (see packages/ui-next/src/pages/resolver.tsx).
 */
import {
    Context, Handler, NotFoundError, ObjectId, OplogModel, param, PRIV,
    Types, ValidationError,
} from 'hydrooj';
import { userBindModel } from './model';
import {
    bindTokensColl, schoolsColl, studentsColl, userGroupsColl, bindingRequestsColl,
} from './db';

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
        const [groups, { docs: students, total }, schoolTokens] = await Promise.all([
            userBindModel.listUserGroups(domainId, schoolId),
            userBindModel.listStudents(domainId, { schoolId, limit: 200 }),
            userBindModel.listInviteTokens(domainId, { schoolId, kind: 'school' }),
        ]);
        this.response.template = 'admin_userbind_school_detail.html';
        this.response.body = { school, groups, students, studentTotal: total, schoolTokens };
    }

    @param('schoolId', Types.ObjectId)
    @param('ttlDays', Types.UnsignedInt, true)
    async postGenerateLink(
        { domainId }: { domainId: string }, schoolId: ObjectId, ttlDays = 0,
    ) {
        const ttlMs = ttlDays > 0 ? ttlDays * 86400 * 1000 : undefined;
        const token = await userBindModel.generateSchoolInviteToken(
            domainId, schoolId, this.user._id, ttlMs,
        );
        await OplogModel.log(this, 'userbind.token.school.create', { schoolId, tokenId: token._id });
        this.response.redirect = this.url('admin_userbind_school_detail', { schoolId });
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
        const [{ docs: members }, groupTokens, school] = await Promise.all([
            userBindModel.listStudents(domainId, { groupId, limit: 500 }),
            userBindModel.listInviteTokens(domainId, { userGroupId: groupId, kind: 'user_group' }),
            userBindModel.getSchool(domainId, group.schoolId),
        ]);
        this.response.template = 'admin_userbind_group_detail.html';
        this.response.body = { group, members, groupTokens, school };
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

    @param('groupId', Types.ObjectId)
    @param('ttlDays', Types.UnsignedInt, true)
    async postGenerateLink(
        { domainId }: { domainId: string }, groupId: ObjectId, ttlDays = 0,
    ) {
        const ttlMs = ttlDays > 0 ? ttlDays * 86400 * 1000 : undefined;
        const token = await userBindModel.generateUserGroupInviteToken(
            domainId, groupId, this.user._id, ttlMs,
        );
        await OplogModel.log(this, 'userbind.token.user_group.create', { groupId, tokenId: token._id });
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

    @param('studentRecordId', Types.ObjectId)
    @param('ttlDays', Types.UnsignedInt, true)
    async postGenerateStudentToken(
        { domainId }: { domainId: string }, studentRecordId: ObjectId, ttlDays = 0,
    ) {
        const ttlMs = ttlDays > 0 ? ttlDays * 86400 * 1000 : undefined;
        const token = await userBindModel.generateStudentInviteToken(
            domainId, studentRecordId, this.user._id, ttlMs,
        );
        await OplogModel.log(this, 'userbind.token.student.create', { studentRecordId, tokenId: token._id });
        this.response.redirect = this.url('admin_userbind_tokens');
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
    @param('kind', Types.String, true)
    @param('unusedOnly', Types.Boolean, true)
    async get(
        { domainId }: { domainId: string }, kind?: string, unusedOnly = false,
    ) {
        const validKind = (kind === 'student' || kind === 'school' || kind === 'user_group') ? kind : undefined;
        const tokens = await userBindModel.listInviteTokens(domainId, { kind: validKind, unusedOnly });
        // Resolve target names for display.
        const tokenInfos: any[] = [];
        for (const t of tokens) {
            let targetLabel = '';
            if (t.kind === 'student' && t.studentRecordId) {
                const s = await studentsColl.findOne({ _id: t.studentRecordId });
                targetLabel = s ? `${s.studentId} ${s.realName}` : '(已删除)';
            } else if (t.kind === 'school' && t.schoolId) {
                const s = await schoolsColl.findOne({ _id: t.schoolId });
                targetLabel = s ? s.name : '(已删除)';
            } else if (t.kind === 'user_group' && t.userGroupId) {
                const g = await userGroupsColl.findOne({ _id: t.userGroupId });
                targetLabel = g ? g.name : '(已删除)';
            }
            tokenInfos.push({ ...t, targetLabel });
        }
        this.response.template = 'admin_userbind_tokens.html';
        this.response.body = { tokens: tokenInfos, kind: validKind, unusedOnly };
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
        // Resolve school names for each request.
        const schoolIds = Array.from(new Set(docs.map((d) => d.schoolId.toString())));
        const schools = await schoolsColl.find({
            _id: { $in: schoolIds.map((id) => new ObjectId(id)) },
        }).toArray();
        const schoolMap: Record<string, string> = {};
        for (const s of schools) schoolMap[s._id.toString()] = s.name;

        this.response.template = 'admin_userbind_requests.html';
        this.response.body = {
            requests: docs, total, page, pageSize: limit, status: validStatus,
            schoolMap,
        };
    }

    @param('requestId', Types.ObjectId)
    async postApprove({ }, requestId: ObjectId) {
        await userBindModel.approveBindingRequest(requestId, this.user._id);
        await OplogModel.log(this, 'userbind.request.approve', { requestId });
        this.response.redirect = this.url('admin_userbind_requests');
    }

    @param('requestId', Types.ObjectId)
    @param('reason', Types.String)
    async postReject({ }, requestId: ObjectId, reason: string) {
        // Reason required — model enforces too, but check here for early feedback.
        if (!reason || !reason.trim()) {
            throw new ValidationError('reason', null, '驳回理由必填');
        }
        await userBindModel.rejectBindingRequest(requestId, this.user._id, reason);
        await OplogModel.log(this, 'userbind.request.reject', { requestId, reason });
        this.response.redirect = this.url('admin_userbind_requests');
    }
}

// ─── Student-facing handlers ──────────────────────────────────────────────

/**
 * /user/bind — apply form (manual application, e.g. no token in hand).
 * After submitting a request, redirects to /user/bind/applications.
 */
class UserBindHandler extends Handler {
    async prepare() {
        this.checkPriv(PRIV.PRIV_USER_PROFILE);
    }

    async get({ domainId }: { domainId: string }) {
        const schools = await userBindModel.listSchools(domainId);
        const alreadyBound = !!(this.user as any).studentId;
        const pendingApplication = await bindingRequestsColl.findOne({
            domainId, userId: this.user._id, status: 'pending',
        });
        this.response.template = 'user_bind.html';
        this.response.body = {
            schools, alreadyBound,
            currentStudentId: (this.user as any).studentId || null,
            currentRealName: (this.user as any).realName || null,
            hasPending: !!pendingApplication,
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
        await OplogModel.log(this, 'userbind.request.create', { schoolId, studentId });
        this.response.redirect = this.url('user_bind_applications');
    }
}

/**
 * /user/bind/applications — "我的申请" — student's full application history.
 * Includes reject reasons and links back to bind paths.
 */
class UserBindApplicationsHandler extends Handler {
    async prepare() {
        this.checkPriv(PRIV.PRIV_USER_PROFILE);
    }

    async get({ domainId }: { domainId: string }) {
        const { docs: requests } = await userBindModel.listBindingRequests(domainId, {
            userId: this.user._id, limit: 50,
        });
        const schoolIds = Array.from(new Set(requests.map((r) => r.schoolId.toString())));
        const groupIds = Array.from(new Set(
            requests.filter((r) => r.targetUserGroupId).map((r) => r.targetUserGroupId!.toString()),
        ));
        const [schools, groups] = await Promise.all([
            schoolsColl.find({ _id: { $in: schoolIds.map((s) => new ObjectId(s)) } }).toArray(),
            groupIds.length > 0
                ? userGroupsColl.find({ _id: { $in: groupIds.map((s) => new ObjectId(s)) } }).toArray()
                : Promise.resolve([]),
        ]);
        const schoolMap: Record<string, string> = {};
        for (const s of schools) schoolMap[s._id.toString()] = s.name;
        const groupMap: Record<string, string> = {};
        for (const g of groups) groupMap[g._id.toString()] = g.name;

        this.response.template = 'user_bind_applications.html';
        this.response.body = {
            requests, schoolMap, groupMap,
            alreadyBound: !!(this.user as any).studentId,
            currentStudentId: (this.user as any).studentId || null,
            currentRealName: (this.user as any).realName || null,
        };
    }
}

/**
 * /bind/:token — invite landing.
 * Branches on token kind:
 *   - student     → show student info card + confirm-bind button
 *   - school      → show school name + form to collect studentId/realName
 *   - user_group  → show group + school + form
 *
 * Anonymous viewers are allowed to SEE the basic info (no roster), but
 * actions require sign-in.
 */
class BindLandingHandler extends Handler {
    async prepare() {
        // Anonymous OK on GET; POST checks below.
    }

    @param('token', Types.String)
    async get({ }, token: string) {
        const tokenDoc = await bindTokensColl.findOne({ _id: token });
        if (!tokenDoc) {
            this.response.template = 'user_bind_landing.html';
            this.response.body = {
                token, signedIn: this.user._id !== 0,
                error: 'invalid_token', errorMessage: '邀请链接无效或已过期。',
                kind: null,
            };
            return;
        }
        if (tokenDoc.expiresAt && tokenDoc.expiresAt < new Date()) {
            this.response.template = 'user_bind_landing.html';
            this.response.body = {
                token, signedIn: this.user._id !== 0,
                error: 'expired', errorMessage: '邀请链接已过期。',
                kind: tokenDoc.kind,
            };
            return;
        }
        if (tokenDoc.kind === 'student') {
            if (tokenDoc.used) {
                this.response.template = 'user_bind_landing.html';
                this.response.body = {
                    token, signedIn: this.user._id !== 0,
                    error: 'used', errorMessage: '邀请链接已被使用。',
                    kind: 'student',
                };
                return;
            }
            const student = await studentsColl.findOne({ _id: tokenDoc.studentRecordId });
            const school = student ? await schoolsColl.findOne({ _id: student.schoolId }) : null;
            const groups = student && student.groupIds.length > 0
                ? await userGroupsColl.find({ _id: { $in: student.groupIds } }).toArray()
                : [];
            const inviterUser = await (await import('hydrooj')).UserModel.getById(
                this.domain?._id || 'system', tokenDoc.createdBy,
            ).catch(() => null);
            this.response.template = 'user_bind_landing.html';
            this.response.body = {
                token, signedIn: this.user._id !== 0,
                kind: 'student',
                student: student ? {
                    _id: student._id, studentId: student.studentId, realName: student.realName,
                    boundUserId: student.boundUserId,
                } : null,
                school: school ? { _id: school._id, name: school.name } : null,
                groups: groups.map((g) => ({ _id: g._id, name: g.name })),
                inviter: inviterUser ? { uid: inviterUser._id, uname: inviterUser.uname } : null,
                tokenInfo: {
                    createdAt: tokenDoc.createdAt, expiresAt: tokenDoc.expiresAt,
                    used: tokenDoc.used,
                },
            };
            return;
        }
        if (tokenDoc.kind === 'school') {
            const school = await schoolsColl.findOne({ _id: tokenDoc.schoolId });
            const inviterUser = await (await import('hydrooj')).UserModel.getById(
                this.domain?._id || 'system', tokenDoc.createdBy,
            ).catch(() => null);
            this.response.template = 'user_bind_landing.html';
            this.response.body = {
                token, signedIn: this.user._id !== 0,
                kind: 'school',
                school: school ? { _id: school._id, name: school.name } : null,
                inviter: inviterUser ? { uid: inviterUser._id, uname: inviterUser.uname } : null,
                tokenInfo: { createdAt: tokenDoc.createdAt, expiresAt: tokenDoc.expiresAt },
            };
            return;
        }
        if (tokenDoc.kind === 'user_group') {
            const group = await userGroupsColl.findOne({ _id: tokenDoc.userGroupId });
            const school = group ? await schoolsColl.findOne({ _id: group.schoolId }) : null;
            const inviterUser = await (await import('hydrooj')).UserModel.getById(
                this.domain?._id || 'system', tokenDoc.createdBy,
            ).catch(() => null);
            this.response.template = 'user_bind_landing.html';
            this.response.body = {
                token, signedIn: this.user._id !== 0,
                kind: 'user_group',
                group: group ? { _id: group._id, name: group.name, schoolId: group.schoolId } : null,
                school: school ? { _id: school._id, name: school.name } : null,
                inviter: inviterUser ? { uid: inviterUser._id, uname: inviterUser.uname } : null,
                tokenInfo: { createdAt: tokenDoc.createdAt, expiresAt: tokenDoc.expiresAt },
            };
            return;
        }
        // Unknown kind
        this.response.template = 'user_bind_landing.html';
        this.response.body = {
            token, signedIn: this.user._id !== 0,
            error: 'unknown_kind', errorMessage: '邀请链接类型未知。',
            kind: null,
        };
    }

    /**
     * POST behavior by kind:
     *   - student    → direct consume (legacy "one-click bind")
     *   - school     → expect studentId/realName in body; do roster lookup, branch:
     *                    matched_unbound → bind
     *                    matched_self    → already bound (no-op + show success)
     *                    matched_other   → error
     *                    no_match        → redirect to /user/bind/apply with prefill
     *   - user_group → same as school + add user to group
     */
    @param('token', Types.String)
    @param('studentId', Types.String, true)
    @param('realName', Types.String, true)
    async post(
        { domainId }: { domainId: string },
        token: string, studentIdInput?: string, realNameInput?: string,
    ) {
        this.checkPriv(PRIV.PRIV_USER_PROFILE);
        const tokenDoc = await bindTokensColl.findOne({ _id: token });
        if (!tokenDoc) throw new NotFoundError('Bind token');
        if (tokenDoc.expiresAt && tokenDoc.expiresAt < new Date()) {
            throw new ValidationError('token', null, 'Token expired');
        }

        if (tokenDoc.kind === 'student') {
            const { studentRecord, school } = await userBindModel.consumeStudentInviteToken(
                token, this.user._id,
            );
            await OplogModel.log(this, 'userbind.bind.student_invite', {
                token, studentRecordId: studentRecord._id, schoolId: school._id,
            });
            this.response.template = 'user_bind_success.html';
            this.response.body = { studentRecord, school };
            return;
        }

        if (!studentIdInput || !realNameInput) {
            throw new ValidationError('input', null, '请填写学号和姓名');
        }

        let targetSchoolId: ObjectId;
        let targetGroupId: ObjectId | undefined;
        if (tokenDoc.kind === 'school') {
            targetSchoolId = tokenDoc.schoolId;
        } else if (tokenDoc.kind === 'user_group') {
            const group = await userGroupsColl.findOne({ _id: tokenDoc.userGroupId });
            if (!group) throw new NotFoundError('UserGroup');
            targetSchoolId = group.schoolId;
            targetGroupId = group._id;
        } else {
            throw new ValidationError('token', null, 'Unknown token kind');
        }

        const outcome = await userBindModel.rosterLookup(
            domainId, targetSchoolId, studentIdInput, realNameInput, this.user._id,
        );

        if (outcome.kind === 'matched_unbound') {
            const { studentRecord, school } = await userBindModel.bindMatchedStudent(
                outcome.studentRecord, this.user._id, targetGroupId,
            );
            await OplogModel.log(this, 'userbind.bind.shared_link', {
                token, kind: tokenDoc.kind,
                studentRecordId: studentRecord._id, schoolId: school._id, groupId: targetGroupId,
            });
            this.response.template = 'user_bind_success.html';
            this.response.body = {
                studentRecord, school,
                joinedGroupId: targetGroupId || null,
            };
            return;
        }
        if (outcome.kind === 'matched_self') {
            // Same user, possibly just joining group now.
            if (targetGroupId) {
                await userBindModel.joinUserGroup(this.user._id, outcome.studentRecord, targetGroupId);
                await OplogModel.log(this, 'userbind.join.user_group', {
                    token, groupId: targetGroupId,
                });
            }
            const school = await schoolsColl.findOne({ _id: outcome.studentRecord.schoolId });
            this.response.template = 'user_bind_success.html';
            this.response.body = {
                studentRecord: outcome.studentRecord, school,
                joinedGroupId: targetGroupId || null,
                wasAlreadyBound: true,
            };
            return;
        }
        if (outcome.kind === 'matched_other') {
            this.response.template = 'user_bind_landing.html';
            this.response.body = {
                token, signedIn: true, kind: tokenDoc.kind,
                school: tokenDoc.kind === 'school'
                    ? await schoolsColl.findOne({ _id: tokenDoc.schoolId })
                    : (await userGroupsColl.findOne({ _id: tokenDoc.userGroupId }))
                        && await schoolsColl.findOne({ _id: targetSchoolId }),
                group: tokenDoc.kind === 'user_group'
                    ? await userGroupsColl.findOne({ _id: tokenDoc.userGroupId })
                    : undefined,
                error: 'matched_other',
                errorMessage: `该学生身份已被其他账号绑定（UID ${outcome.boundToUid}）。如有错误请联系管理员。`,
            };
            return;
        }
        // no_match → submit a binding request automatically
        const req = await userBindModel.submitBindingRequest(
            domainId, this.user._id, targetSchoolId, studentIdInput, realNameInput,
            { sourceTokenId: token, targetUserGroupId: targetGroupId },
        );
        await OplogModel.log(this, 'userbind.request.from_token', {
            token, requestId: req._id, kind: tokenDoc.kind,
        });
        this.response.redirect = this.url('user_bind_applications');
    }
}

/**
 * /user/bind/claim — temp account claim, 2-step.
 *
 * Step 1 (GET / POST with action=lookup):
 *   - User enters studentId + realName
 *   - Server returns list of matching temp accounts + school candidates
 * Step 2 (POST with action=submit):
 *   - User picks one temp UID + school from dropdowns
 *   - Server creates a BindingRequest with claimTempUserId
 */
class UserBindClaimHandler extends Handler {
    async prepare() {
        this.checkPriv(PRIV.PRIV_USER_PROFILE);
    }

    async get({ domainId }: { domainId: string }) {
        // Show step 1 form (no candidates yet).
        const userSchoolId = (this.user as any).parentSchoolId?.[0] || null;
        const schools = userSchoolId
            ? await schoolsColl.find({ _id: userSchoolId }).toArray()
            : await userBindModel.listSchools(domainId);
        this.response.template = 'user_bind_claim.html';
        this.response.body = {
            step: 1,
            schools,
            schoolLocked: !!userSchoolId,
            candidates: null,
            currentStudentId: (this.user as any).studentId || null,
            currentRealName: (this.user as any).realName || null,
        };
    }

    @param('action', Types.String)
    @param('studentId', Types.String, true)
    @param('realName', Types.String, true)
    @param('tempUserId', Types.Int, true)
    @param('schoolId', Types.ObjectId, true)
    async post(
        { domainId }: { domainId: string },
        action: string,
        studentIdInput?: string, realNameInput?: string,
        tempUserId?: number, schoolId?: ObjectId,
    ) {
        if (action === 'lookup') {
            const sid = (studentIdInput || '').trim();
            const name = (realNameInput || '').trim();
            if (!sid || !name) throw new ValidationError('input', null, '请填写学号和姓名');
            const candidates = await userBindModel.findClaimCandidates(domainId, sid, name);
            const userSchoolId = (this.user as any).parentSchoolId?.[0] || null;
            const schools = userSchoolId
                ? await schoolsColl.find({ _id: userSchoolId }).toArray()
                : await userBindModel.listSchools(domainId);
            this.response.template = 'user_bind_claim.html';
            this.response.body = {
                step: 2,
                schools,
                schoolLocked: !!userSchoolId,
                candidates,
                studentIdInput: sid,
                realNameInput: name,
                currentStudentId: (this.user as any).studentId || null,
                currentRealName: (this.user as any).realName || null,
            };
            return;
        }
        if (action === 'submit') {
            if (!tempUserId || !schoolId || !studentIdInput || !realNameInput) {
                throw new ValidationError('input', null, '请补全所有字段');
            }
            const req = await userBindModel.submitBindingRequest(
                domainId, this.user._id, schoolId, studentIdInput, realNameInput,
                { claimTempUserId: tempUserId },
            );
            await OplogModel.log(this, 'userbind.claim.submit', {
                requestId: req._id, tempUserId, schoolId,
            });
            this.response.redirect = this.url('user_bind_applications');
            return;
        }
        throw new ValidationError('action');
    }
}

// ─── Force-bind middleware (before-prepare hook) ──────────────────────────

const FORCE_BIND_BYPASS_PREFIX = [
    '/userbind', '/bind', '/login', '/logout', '/register',
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

    // Student-facing — paths under /userbind/* to avoid clashing with /user/:uid (hydrooj core).
    ctx.Route('user_bind', '/userbind', UserBindHandler, PRIV.PRIV_USER_PROFILE);
    ctx.Route('user_bind_applications', '/userbind/applications', UserBindApplicationsHandler, PRIV.PRIV_USER_PROFILE);
    ctx.Route('user_bind_claim', '/userbind/claim', UserBindClaimHandler, PRIV.PRIV_USER_PROFILE);
    ctx.Route('user_bind_landing', '/bind/:token', BindLandingHandler);

    // Force-bind enforcement hook (PRD §3.2 — "保留，但条件化")
    ctx.on('handler/before-prepare', async (h) => {
        const enforced = global.Hydro.model.system.get('userbind.forceBind');
        if (!enforced) return;
        if (!shouldEnforceBindFor(h as Handler)) return;
        const accept = h.request?.headers?.accept || '';
        if (h.request?.method !== 'GET') return;
        if (!accept.includes('text/html')) return;
        (h.response as any).redirect = (h as Handler).url('user_bind');
        return true;
    });
}
