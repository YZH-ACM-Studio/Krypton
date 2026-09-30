/**
 * Teacher user-group pages. Route privilege is PRIV_USER_PROFILE;
 * prepare requires PERM_MANAGE_OWN_USER_GROUP.
 */
import { Logger } from '@hydrooj/utils';
import { localizedErrorText, Handler, ObjectId, OplogModel, param, PERM, PRIV, Types, ValidationError } from 'hydrooj';
import type { Context, StaffScopeActor } from 'hydrooj';
import {
    addToTeacherGroup,
    archiveTeacherGroup,
    buildTeacherGroupDetail,
    buildTeacherGroupList,
    clearTeacherGroupMembers,
    createTeacherGroup,
    deleteOwnStudent,
    deleteTeacherGroup,
    importToTeacherGroup,
    loadOwnedGroup,
    removeFromTeacherGroup,
    renameTeacherGroup,
    unarchiveTeacherGroup,
} from './teacher-groups';

const logger = new Logger('userbind.teacher-groups');
const RECORD_ID_RE = /^[a-f0-9]{24}$/i;

function actorOf(handler: Handler): StaffScopeActor {
    const user = handler.user as { _id: number; parentSchoolId?: ObjectId[] };
    return { _id: user._id, parentSchoolId: user.parentSchoolId };
}

function recordObjectIds(domainId: string, uid: number, stage: string, field: string, raw: string[]): ObjectId[] {
    const ids: ObjectId[] = [];
    for (const value of raw) {
        if (!RECORD_ID_RE.test(value)) {
            logger.warn('domain=%s uid=%s stage=%s reason=%s', domainId, uid, stage, 'bad_student_record_id');
            throw new ValidationError(field, null, localizedErrorText`学生记录参数无效`);
        }
        ids.push(new ObjectId(value));
    }
    return ids;
}

class TeacherUserGroupsHandler extends Handler {
    async prepare() {
        try {
            this.checkPerm(PERM.PERM_MANAGE_OWN_USER_GROUP);
        } catch (error) {
            logger.warn('domain=%s uid=%s stage=%s reason=%s', this.args.domainId, this.user._id, 'prepare', 'missing_permission');
            throw error;
        }
    }

    async get({ domainId }: { domainId: string }) {
        this.response.template = 'teacher_user_groups.html';
        this.response.body = await buildTeacherGroupList(domainId, actorOf(this));
    }

    @param('schoolId', Types.ObjectId)
    @param('name', Types.String)
    async postCreate({ domainId }: { domainId: string }, schoolId: ObjectId, name: string) {
        const actor = actorOf(this);
        const group = await createTeacherGroup(domainId, actor, schoolId, name);
        await OplogModel.log(this, 'userbind.teacher_group.create', {
            uid: actor._id,
            groupId: group._id.toHexString(),
            schoolId: group.schoolId.toHexString(),
        });
        this.response.redirect = this.url('teacher_user_group_detail', { groupId: group._id });
    }
}

class TeacherUserGroupDetailHandler extends Handler {
    async prepare() {
        try {
            this.checkPerm(PERM.PERM_MANAGE_OWN_USER_GROUP);
        } catch (error) {
            logger.warn('domain=%s uid=%s stage=%s reason=%s', this.args.domainId, this.user._id, 'prepare', 'missing_permission');
            throw error;
        }
    }

    @param('groupId', Types.ObjectId)
    @param('q', Types.String, true)
    async get({ domainId }: { domainId: string }, groupId: ObjectId, q?: string) {
        this.response.template = 'teacher_user_group_detail.html';
        this.response.body = await buildTeacherGroupDetail(domainId, actorOf(this), groupId, q || '', null);
    }

    @param('groupId', Types.ObjectId)
    @param('name', Types.String)
    async postRename({ domainId }: { domainId: string }, groupId: ObjectId, name: string) {
        const actor = actorOf(this);
        await renameTeacherGroup(domainId, actor, groupId, name);
        await OplogModel.log(this, 'userbind.teacher_group.rename', { uid: actor._id, groupId: groupId.toHexString() });
        this.response.redirect = this.url('teacher_user_group_detail', { groupId });
    }

    @param('groupId', Types.ObjectId)
    async postArchive({ domainId }: { domainId: string }, groupId: ObjectId) {
        const actor = actorOf(this);
        await archiveTeacherGroup(domainId, actor, groupId);
        await OplogModel.log(this, 'userbind.teacher_group.archive', { uid: actor._id, groupId: groupId.toHexString() });
        this.response.redirect = this.url('teacher_user_group_detail', { groupId });
    }

    @param('groupId', Types.ObjectId)
    async postUnarchive({ domainId }: { domainId: string }, groupId: ObjectId) {
        const actor = actorOf(this);
        await unarchiveTeacherGroup(domainId, actor, groupId);
        await OplogModel.log(this, 'userbind.teacher_group.unarchive', { uid: actor._id, groupId: groupId.toHexString() });
        this.response.redirect = this.url('teacher_user_group_detail', { groupId });
    }

    @param('groupId', Types.ObjectId)
    async postClearMembers({ domainId }: { domainId: string }, groupId: ObjectId) {
        const actor = actorOf(this);
        const count = await clearTeacherGroupMembers(domainId, actor, groupId);
        await OplogModel.log(this, 'userbind.teacher_group.clear', { uid: actor._id, groupId: groupId.toHexString(), count });
        this.response.redirect = this.url('teacher_user_group_detail', { groupId });
    }

    @param('groupId', Types.ObjectId)
    @param('studentRecordIds', Types.CommaSeperatedArray)
    async postAdd({ domainId }: { domainId: string }, groupId: ObjectId, studentRecordIds: string[]) {
        const actor = actorOf(this);
        const recordIds = recordObjectIds(domainId, actor._id, 'add', 'studentRecordIds', studentRecordIds);
        await addToTeacherGroup(domainId, actor, groupId, recordIds);
        await OplogModel.log(this, 'userbind.teacher_group.add', {
            uid: actor._id,
            groupId: groupId.toHexString(),
            count: recordIds.length,
        });
        this.response.redirect = this.url('teacher_user_group_detail', { groupId });
    }

    @param('groupId', Types.ObjectId)
    @param('studentRecordIds', Types.CommaSeperatedArray)
    async postRemove({ domainId }: { domainId: string }, groupId: ObjectId, studentRecordIds: string[]) {
        const actor = actorOf(this);
        const recordIds = recordObjectIds(domainId, actor._id, 'remove', 'studentRecordIds', studentRecordIds);
        await removeFromTeacherGroup(domainId, actor, groupId, recordIds);
        await OplogModel.log(this, 'userbind.teacher_group.remove', {
            uid: actor._id,
            groupId: groupId.toHexString(),
            count: recordIds.length,
        });
        this.response.redirect = this.url('teacher_user_group_detail', { groupId });
    }

    @param('groupId', Types.ObjectId)
    @param('text', Types.Content)
    async postImportText({ domainId }: { domainId: string }, groupId: ObjectId, text: string) {
        const actor = actorOf(this);
        const importReport = await importToTeacherGroup(domainId, actor, groupId, text);
        // OplogModel.log stores a clone of handler.args. The pasted roster is not an audit field.
        delete this.args.text;
        await OplogModel.log(this, 'userbind.teacher_group.import', {
            uid: actor._id,
            groupId: groupId.toHexString(),
            created: importReport.created,
            attached: importReport.attached,
            alreadyMember: importReport.alreadyMember,
            autoBound: importReport.autoBound,
            alreadyBound: importReport.alreadyBound,
            failed: importReport.failed.length,
            autoBindSkipped: importReport.autoBindSkipped.length,
        });
        this.response.template = 'teacher_user_group_detail.html';
        this.response.body = await buildTeacherGroupDetail(domainId, actor, groupId, '', importReport);
    }

    @param('groupId', Types.ObjectId)
    @param('studentRecordId', Types.String)
    async postDeleteStudent({ domainId }: { domainId: string }, groupId: ObjectId, studentRecordId: string) {
        const actor = actorOf(this);
        await loadOwnedGroup(domainId, actor, groupId, 'delete_student');
        const [recordId] = recordObjectIds(domainId, actor._id, 'delete_student', 'studentRecordId', [studentRecordId]);
        await deleteOwnStudent(domainId, actor, recordId);
        await OplogModel.log(this, 'userbind.teacher_group.delete_student', {
            uid: actor._id,
            groupId: groupId.toHexString(),
            recordId: recordId.toHexString(),
        });
        this.response.redirect = this.url('teacher_user_group_detail', { groupId });
    }

    @param('groupId', Types.ObjectId)
    async postDelete({ domainId }: { domainId: string }, groupId: ObjectId) {
        const actor = actorOf(this);
        await deleteTeacherGroup(domainId, actor, groupId);
        await OplogModel.log(this, 'userbind.teacher_group.delete', { uid: actor._id, groupId: groupId.toHexString() });
        this.response.redirect = this.url('teacher_user_groups');
    }
}

export function applyTeacherGroupHandlers(ctx: Context) {
    ctx.Route('teacher_user_groups', '/user-groups', TeacherUserGroupsHandler, PRIV.PRIV_USER_PROFILE);
    ctx.Route('teacher_user_group_detail', '/user-groups/:groupId', TeacherUserGroupDetailHandler, PRIV.PRIV_USER_PROFILE);
}
