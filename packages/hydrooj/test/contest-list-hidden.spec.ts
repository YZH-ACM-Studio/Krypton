import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import { expect } from 'chai';
import { ObjectId } from 'mongodb';
import {
    contestVisibleByStaffSchoolScope,
    isListVisibleToUser,
    listAccessQuery,
    loadContestListParticipantScope,
    parentSchoolIdsFromUser,
    resolveContestListParticipantScope,
    studentRecordHitsContestScope,
} from '../src/lib/contest-list-access';
import {
    withStudentDirectory,
    type StudentDirectory,
    type StudentDirectorySchool,
    type StudentDirectoryStudent,
} from '../src/service/student-directory';

const handlerRoot = resolve(__dirname, '../src/handler');
const groupId = new ObjectId('6aa0bf822f2f1ea8af181537');
const otherGroupId = new ObjectId('6aacee67f6e8b68176be8041');
const schoolId = new ObjectId('6a12e708e13b3e957f16320c');
const otherSchoolId = new ObjectId('6a12e708e13b3e957f16320d');

const scopedGroupContest = {
    owner: 1,
    assign: [] as string[],
    participantScopeMode: 'groups' as const,
    participantGroupIds: [groupId],
};

const scopedSchoolContest = {
    owner: 1,
    assign: [] as string[],
    participantScopeMode: 'schools' as const,
    participantSchoolIds: [schoolId],
};

function studentQuery(uid: number, groups: string[], scope?: Parameters<typeof listAccessQuery>[3]) {
    return listAccessQuery(uid, groups, false, scope);
}

describe('contest list hidden', () => {
    it('lets restricted browsers see everything', () => {
        expect(listAccessQuery(8, ['default'], true)).to.deep.equal({});
        expect(isListVisibleToUser({ owner: 1, hidden: true }, 8, ['default'], true)).to.equal(true);
        expect(isListVisibleToUser({ ...scopedGroupContest, hidden: true }, 8, ['default'], true)).to.equal(true);
    });

    it('lists missing hidden as public when there is no participant scope', () => {
        const query = studentQuery(8, ['default']);
        expect(query).to.deep.equal({
            $or: [
                { owner: 8 },
                { maintainer: 8 },
                {
                    hidden: { $ne: true },
                    $and: [
                        { $or: [{ assign: { $in: ['default'] } }, { assign: { $size: 0 } }] },
                        {
                            $or: [
                                { participantScopeMode: { $exists: false } },
                                { participantScopeMode: 'none' },
                                { participantScopeMode: 'groups', participantGroupIds: { $in: [] } },
                                { participantScopeMode: 'schools', participantSchoolIds: { $in: [] } },
                            ],
                        },
                    ],
                },
            ],
        });
        expect(isListVisibleToUser({ owner: 1, assign: [] }, 8, ['default'], false)).to.equal(true);
        expect(isListVisibleToUser({ owner: 1, hidden: false, assign: [] }, 8, ['default'], false)).to.equal(true);
        expect(isListVisibleToUser({ owner: 1, assign: [], participantScopeMode: 'none' }, 8, ['default'], false)).to.equal(true);
    });

    it('hides hidden contests from students but keeps owner and maintainer', () => {
        expect(isListVisibleToUser({ owner: 1, hidden: true, assign: [] }, 8, ['default'], false)).to.equal(false);
        expect(isListVisibleToUser({ owner: 8, hidden: true, assign: [] }, 8, ['default'], false)).to.equal(true);
        expect(isListVisibleToUser({ owner: 1, maintainer: [8], hidden: true, assign: [] }, 8, ['default'], false)).to.equal(true);
    });

    it('still honors assign after a contest is listed', () => {
        expect(isListVisibleToUser({ owner: 1, assign: ['lab'] }, 8, ['default'], false)).to.equal(false);
        expect(isListVisibleToUser({ owner: 1, assign: ['default'] }, 8, ['default'], false)).to.equal(true);
        expect(isListVisibleToUser({ owner: 1, hidden: true, assign: ['default'] }, 8, ['default'], false)).to.equal(false);
    });

    it('hides group-scoped contests from students who are not in the roster', () => {
        expect(isListVisibleToUser(scopedGroupContest, 8, ['default'], false)).to.equal(false);
        expect(isListVisibleToUser(scopedGroupContest, 8, ['default'], false, { groupIds: [otherGroupId], schoolIds: [] })).to.equal(false);
        expect(isListVisibleToUser(scopedGroupContest, 8, ['default'], false, { groupIds: [groupId], schoolIds: [] })).to.equal(true);
        expect(isListVisibleToUser({ ...scopedGroupContest, hidden: true }, 8, ['default'], false, { groupIds: [groupId], schoolIds: [] })).to.equal(
            false,
        );
        expect(isListVisibleToUser(scopedGroupContest, 8, ['default'], false, 'ignore')).to.equal(true);
        expect(studentQuery(8, ['default'], { groupIds: [groupId], schoolIds: [] })).to.deep.equal({
            $or: [
                { owner: 8 },
                { maintainer: 8 },
                {
                    hidden: { $ne: true },
                    $and: [
                        { $or: [{ assign: { $in: ['default'] } }, { assign: { $size: 0 } }] },
                        {
                            $or: [
                                { participantScopeMode: { $exists: false } },
                                { participantScopeMode: 'none' },
                                { participantScopeMode: 'groups', participantGroupIds: { $in: [groupId] } },
                                { participantScopeMode: 'schools', participantSchoolIds: { $in: [] } },
                            ],
                        },
                    ],
                },
            ],
        });
    });

    it('hides school-scoped contests from students outside that school', () => {
        expect(isListVisibleToUser(scopedSchoolContest, 8, ['default'], false, { groupIds: [groupId], schoolIds: [otherSchoolId] })).to.equal(false);
        expect(isListVisibleToUser(scopedSchoolContest, 8, ['default'], false, { groupIds: [], schoolIds: [schoolId] })).to.equal(true);
        expect(isListVisibleToUser(scopedSchoolContest, 8, ['default'], false, { groupIds: [], schoolIds: [otherSchoolId, schoolId] })).to.equal(
            true,
        );
        expect(
            isListVisibleToUser(
                { owner: 1, assign: [], participantScopeMode: 'legacy' } as unknown as Parameters<typeof isListVisibleToUser>[0],
                8,
                ['default'],
                false,
            ),
        ).to.equal(false);
    });

    it('keeps owner and maintainer on scoped contests they cannot enter as students', () => {
        expect(isListVisibleToUser({ ...scopedGroupContest, owner: 8 }, 8, ['default'], false)).to.equal(true);
        expect(isListVisibleToUser({ ...scopedGroupContest, maintainer: [8] }, 8, ['default'], false)).to.equal(true);
    });

    it('loads bound student groups and ignores guest or unbound users', async () => {
        expect(await loadContestListParticipantScope('system', 0)).to.deep.equal({ groupIds: [], schoolIds: [] });
        expect(parentSchoolIdsFromUser({ _udoc: { parentSchoolId: [schoolId, 'nope'] } })).to.deep.equal([schoolId]);
        expect(parentSchoolIdsFromUser({ parentSchoolId: [schoolId] })).to.deep.equal([]);
        const student = {
            _id: new ObjectId(),
            domainId: 'system',
            schoolId,
            studentId: '20260001',
            realName: '测',
            groupIds: [groupId],
            boundUserId: 8,
            boundAt: new Date('2026-09-01T00:00:00.000Z'),
        } satisfies StudentDirectoryStudent;
        const schools: StudentDirectorySchool[] = [{ _id: schoolId, domainId: 'system', name: '本校', staffUids: [11] }];
        const directory = {
            async listSchools() {
                return schools;
            },
            async findStudentByUserId(_domainId: string, userId: number) {
                return userId === 8 ? student : null;
            },
        } as unknown as StudentDirectory;
        await withStudentDirectory(directory, async () => {
            expect(await loadContestListParticipantScope('system', 8)).to.deep.equal({ groupIds: [groupId], schoolIds: [schoolId] });
            expect(await loadContestListParticipantScope('system', 9)).to.deep.equal({ groupIds: [], schoolIds: [] });
            expect(await loadContestListParticipantScope('system', 11)).to.deep.equal({ groupIds: [], schoolIds: [schoolId] });
            expect(await loadContestListParticipantScope('system', 12, [schoolId])).to.deep.equal({ groupIds: [], schoolIds: [schoolId] });
            expect(await loadContestListParticipantScope('system', 13, [otherSchoolId])).to.deep.equal({ groupIds: [], schoolIds: [] });
            expect(await resolveContestListParticipantScope('system', 8, true)).to.equal('ignore');
            expect(await resolveContestListParticipantScope('system', 8, false)).to.deep.equal({ groupIds: [groupId], schoolIds: [schoolId] });
            expect(isListVisibleToUser(scopedSchoolContest, 11, ['default'], false, { groupIds: [], schoolIds: [schoolId] })).to.equal(true);
            expect(isListVisibleToUser(scopedGroupContest, 11, ['default'], false, { groupIds: [], schoolIds: [schoolId] })).to.equal(false);
            expect(await contestVisibleByStaffSchoolScope('system', { _id: 11 }, scopedSchoolContest)).to.equal(true);
            expect(await contestVisibleByStaffSchoolScope('system', { _id: 11 }, scopedGroupContest)).to.equal(false);
            expect(await contestVisibleByStaffSchoolScope('system', { _id: 12, parentSchoolId: [schoolId] }, scopedSchoolContest)).to.equal(true);
            expect(await contestVisibleByStaffSchoolScope('system', { _id: 9 }, { ...scopedSchoolContest, participantSchoolIds: [otherSchoolId] })).to.equal(
                false,
            );
            expect(await studentRecordHitsContestScope('system', 8, scopedSchoolContest)).to.equal(true);
            expect(await studentRecordHitsContestScope('system', 11, scopedSchoolContest)).to.equal(false);
            expect(await studentRecordHitsContestScope('system', 12, scopedSchoolContest)).to.equal(false);
            expect(await studentRecordHitsContestScope('system', 8, scopedGroupContest)).to.equal(true);
            expect(await studentRecordHitsContestScope('system', 11, scopedGroupContest)).to.equal(false);
            expect(await studentRecordHitsContestScope('system', 8, { participantScopeMode: 'none' })).to.equal(true);
        });
    });

    it('wires list/home/problem-bank through the shared filter and participant scope', () => {
        const contestHandler = readFileSync(resolve(handlerRoot, 'contest.ts'), 'utf8');
        const homeHandler = readFileSync(resolve(handlerRoot, 'home.ts'), 'utf8');
        const problemHandler = readFileSync(resolve(handlerRoot, 'problem.ts'), 'utf8');
        expect(contestHandler).to.include('contest.listAccessQuery(');
        expect(contestHandler).to.include('contest.resolveContestListParticipantScope(');
        expect(contestHandler).to.include('canBrowseAssignRestricted && !group, participantScope');
        expect(homeHandler).to.include('contest.listAccessQuery(');
        expect(homeHandler).to.include('contest.resolveContestListParticipantScope(');
        expect(problemHandler).to.include('contest.listAccessQuery(');
        expect(problemHandler).to.include('contest.resolveContestListParticipantScope(');
        expect(problemHandler).to.include('contest.isListVisibleToUser(');
        expect(problemHandler).to.include('participantScope');
        expect(contestHandler).to.include('contest.parentSchoolIdsFromUser(');
        expect(contestHandler).to.include('contest.contestVisibleByStaffSchoolScope(');
        expect(contestHandler).to.include('contest.studentRecordHitsContestScope(');
        expect(contestHandler).to.include('schoolScopeView: this.staffSchoolContestView');
        expect(homeHandler).to.include('contest.parentSchoolIdsFromUser(');
        expect(problemHandler).to.include('contest.parentSchoolIdsFromUser(');
        expect(problemHandler).to.include('this.staffSchoolContestView');
        const paperHandler = readFileSync(resolve(handlerRoot, 'paper.ts'), 'utf8');
        const vigilHelpers = readFileSync(resolve(__dirname, '../../krypton-vigilguard/src/helpers.ts'), 'utf8');
        expect(paperHandler).to.not.include('contestVisibleByStaffSchoolScope');
        expect(vigilHelpers).to.include('record.schoolId');
        expect(contestHandler).to.include('hidden,');
        expect(contestHandler).not.to.include('hidden === true && this.response.redirect');
    });
});
