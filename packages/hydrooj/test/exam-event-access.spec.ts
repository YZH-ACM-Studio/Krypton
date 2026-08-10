import { describe, it } from 'node:test';
import { expect } from 'chai';
import { ObjectId } from 'mongodb';
import type { ExamEventDoc } from '../src/model/exam-event';

const hydro = ((global as unknown as { Hydro?: { model?: Record<string, unknown> } }).Hydro ||= { model: {} });
hydro.model ||= {};
const { PERM, PRIV } = require('../src/model/builtin.ts') as typeof import('../src/model/builtin');

const schoolA = new ObjectId('66b800000000000000000301');
const schoolB = new ObjectId('66b800000000000000000302');

function actor(uid: number, permissions: bigint[] = [], privileges: number[] = [], schools: ObjectId[] = []) {
    return {
        _id: uid,
        parentSchoolId: schools,
        hasPerm: (permission: bigint) => permissions.includes(permission),
        hasPriv: (privilege: number) => privileges.includes(privilege),
    };
}

const owner = actor(2, [PERM.PERM_CREATE_EXAM_EVENT, PERM.PERM_EDIT_CONTEST_SELF], [], [schoolA]);
const collaborator = actor(3, [PERM.PERM_CREATE_EXAM_EVENT, PERM.PERM_EDIT_CONTEST_SELF], [], [schoolA]);
const otherSchool = actor(4, [PERM.PERM_CREATE_EXAM_EVENT], [], [schoolB]);
const administrator = actor(5, [PERM.PERM_MANAGE_EXAM_INFRASTRUCTURE]);
const root = actor(1, [], [PRIV.PRIV_EDIT_SYSTEM]);

const users = new Map([
    [2, owner],
    [3, collaborator],
    [4, otherSchool],
    [5, administrator],
    [1, root],
]);

hydro.model.userbind = {
    getSchool: async (domainId: string, schoolId: ObjectId) =>
        domainId === 'system' && [schoolA, schoolB].some((candidate) => candidate.equals(schoolId))
            ? { _id: schoolId, domainId, name: schoolId.equals(schoolA) ? 'A' : 'B' }
            : null,
    listSchools: async () => [],
    findStudentByUserId: async () => null,
};
hydro.model.user = { getById: async (_domainId: string, uid: number) => users.get(uid) || null };
hydro.model.contest = {
    get: async (domainId: string, contestId: ObjectId) => {
        if (domainId !== 'system' || contestId.toHexString().endsWith('999')) throw new Error('contest_not_found');
        return { owner: 2, maintainer: [3] };
    },
};

const access = require('../src/model/exam-event-access.ts') as typeof import('../src/model/exam-event-access');

function event(patch: Partial<ExamEventDoc> = {}): ExamEventDoc {
    const now = new Date('2026-08-10T10:00:00.000Z');
    return {
        _id: new ObjectId('66b800000000000000000401'),
        domainId: 'system',
        schoolId: schoolA,
        title: 'Event',
        type: 'external',
        lifecycle: 'draft',
        startAt: new Date('2026-08-10T12:00:00.000Z'),
        endAt: new Date('2026-08-10T14:00:00.000Z'),
        ownerUid: 2,
        collaboratorUids: [3],
        revision: 1,
        auditRef: 'exam-event:fixture:1',
        createdAt: now,
        createdBy: 2,
        updatedAt: now,
        updatedBy: 2,
        ...patch,
    };
}

async function rejects(run: () => Promise<unknown>) {
    try {
        await run();
        return null;
    } catch (error) {
        return error as Error;
    }
}

describe('ExamEvent school and role authorization', () => {
    it('allows only owner/collaborator inside the canonical userbind school', async () => {
        await access.assertCanManageExamEvent('system', event(), owner);
        await access.assertCanManageExamEvent('system', event(), collaborator);
        expect(await rejects(() => access.assertCanManageExamEvent('system', event(), otherSchool))).to.have.property('name', 'PermissionError');
        expect(await rejects(() => access.assertCanManageExamEvent('other', event(), owner))).to.have.property('name', 'PermissionError');
    });

    it('allows the explicit infrastructure administrator across activities but not across domains', async () => {
        await access.assertCanManageExamEvent('system', event({ ownerUid: 42, collaboratorUids: [], schoolId: schoolB }), administrator);
        await access.assertCanManageExamEvent('system', event({ ownerUid: 1, collaboratorUids: [], schoolId: schoolB }), root);
        expect(await rejects(() => access.assertCanManageExamEvent('other', event(), administrator))).to.have.property('name', 'PermissionError');
        expect(access.isExamInfrastructureAdmin(actor(6, [], [PRIV.PRIV_EDIT_SYSTEM]))).to.equal(true);
    });

    it('rejects collaborators without the same canonical school role', async () => {
        await access.assertExamEventCollaborators('system', schoolA, 2, [3]);
        expect(await rejects(() => access.assertExamEventCollaborators('system', schoolA, 2, [4]))).to.have.property('name', 'ValidationError');
        await access.assertExamEventCollaborators('system', schoolA, 2, [5]);
        expect(await rejects(() => access.assertExamEventCollaborators('system', schoolB, 2, [4]))).to.have.property('name', 'ValidationError');
    });

    it('rechecks Contest existence and ownership instead of trusting the submitted id', async () => {
        const contestId = new ObjectId('66b800000000000000000501');
        await access.assertExamEventContestAccess('system', contestId, owner);
        await access.assertExamEventContestAccess('system', contestId, collaborator);
        expect(await rejects(() => access.assertExamEventContestAccess('system', contestId, otherSchool))).to.have.property(
            'name',
            'PermissionError',
        );
        expect(await rejects(() => access.assertExamEventContestAccess('system', new ObjectId('66b800000000000000000999'), owner))).to.have.property(
            'message',
            'contest_not_found',
        );
    });

    it('rechecks linked Contest existence and the canonical self-edit permission on every event access', async () => {
        const contestId = new ObjectId('66b800000000000000000501');
        const linked = event({ type: 'krypton', contestId });
        await access.assertCanManageExamEvent('system', linked, owner);
        expect(
            await rejects(() => access.assertCanManageExamEvent('system', linked, actor(2, [PERM.PERM_CREATE_EXAM_EVENT], [], [schoolA]))),
        ).to.have.property('name', 'PermissionError');
        expect(
            await rejects(() =>
                access.assertCanManageExamEvent(
                    'system',
                    event({ type: 'krypton', contestId: new ObjectId('66b800000000000000000999') }),
                    administrator,
                ),
            ),
        ).to.have.property('message', 'contest_not_found');
    });
});
