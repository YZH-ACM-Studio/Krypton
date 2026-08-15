import { expect } from 'chai';
import { ObjectId } from 'mongodb';
import { beforeEach, describe, it } from 'node:test';

class EmptyCollection {
    createIndex() {
        return Promise.resolve('index');
    }

    deleteMany() {
        return Promise.resolve({ deletedCount: 0 });
    }

    findOne() {
        return Promise.resolve(null);
    }

    insertOne() {
        return Promise.resolve({ insertedId: new ObjectId() });
    }

    find() {
        return { sort: () => ({ limit: () => ({ toArray: async () => [] }) }) };
    }
}

const dbPath = require.resolve('../src/service/db.ts');
const userPath = require.resolve('../src/model/user.ts');
const previousDbCache = require.cache[dbPath];
const previousUserCache = require.cache[userPath];
let contestAssignGroups: Array<{ domainId: string; name: string; uids: number[] }> = [];
let userStateRows: Array<{ _id: number; priv: number }> = [];
require.cache[dbPath] = {
    id: dbPath,
    filename: dbPath,
    loaded: true,
    exports: { __esModule: true, default: { collection: () => new EmptyCollection() } },
} as NodeModule;
require.cache[userPath] = {
    id: userPath,
    filename: userPath,
    loaded: true,
    exports: {
        __esModule: true,
        default: {
            coll: { find: () => ({ sort: () => ({ toArray: async () => userStateRows }) }) },
            collGroup: { find: () => ({ toArray: async () => contestAssignGroups }) },
        },
    },
} as NodeModule;
(global as unknown as { Hydro: { model: Record<string, unknown> } }).Hydro = { model: {} };
const seatPlanModule = require('../src/model/exam-seat-plan.ts') as typeof import('../src/model/exam-seat-plan');
const resolverModule = require('../src/model/exam-roster-resolver.ts') as typeof import('../src/model/exam-roster-resolver');
if (previousDbCache) require.cache[dbPath] = previousDbCache;
else delete require.cache[dbPath];
if (previousUserCache) require.cache[userPath] = previousUserCache;
else delete require.cache[userPath];

const domainId = 'system';
const schoolId = new ObjectId('66bb00000000000000000001');
const groupId = new ObjectId('66bb00000000000000000002');
const eventId = new ObjectId('66bb00000000000000000003');
const contestId = new ObjectId('66bb00000000000000000004');

function event() {
    return {
        _id: eventId,
        domainId,
        schoolId,
        title: '校赛',
        type: 'krypton' as const,
        contestId,
        lifecycle: 'scheduled' as const,
        startAt: new Date('2026-08-12T01:00:00.000Z'),
        endAt: new Date('2026-08-12T03:00:00.000Z'),
        ownerUid: 2,
        collaboratorUids: [],
        revision: 3,
        auditRef: `exam-event:${eventId}:3`,
        createdAt: new Date('2026-08-11T00:00:00.000Z'),
        createdBy: 2,
        updatedAt: new Date('2026-08-11T00:00:00.000Z'),
        updatedBy: 2,
    };
}

function snapshot(selectedGroupIds: ObjectId[] | null, students: Array<{ uid: number | null; record: number }>) {
    return {
        domainId,
        schoolId,
        schoolName: '计算机学院',
        selectionKind: selectedGroupIds === null ? ('school' as const) : ('groups' as const),
        selectedGroupIds: selectedGroupIds || [],
        groups: selectedGroupIds === null ? [] : [{ groupId, schoolId, name: '一班', archivedAt: null, fingerprint: 'b'.repeat(64) }],
        students: students.map(({ uid, record }) => ({
            studentRecordId: new ObjectId(`66bb0000000000000000${record.toString(16).padStart(4, '0')}`),
            schoolId,
            studentId: `26${record}`,
            realName: `学生${record}`,
            groupIds: selectedGroupIds || [],
            boundUserId: uid,
        })),
        fingerprint: 'a'.repeat(64),
    };
}

function cursor<T>(rows: T[]) {
    return { toArray: async () => rows };
}

function mutableModel(): Record<string, unknown> {
    return global.Hydro.model as unknown as Record<string, unknown>;
}

beforeEach(() => {
    contestAssignGroups = [];
    userStateRows = [];
    mutableModel().userbind = {
        loadExamRosterUserbindSnapshot: async (_domainId: string, _schoolId: ObjectId, groupIds: ObjectId[] | null) =>
            snapshot(groupIds, [{ uid: 101, record: 1 }]),
    };
    mutableModel().contestTeam = { listTeams: async () => [] };
});

describe('P2.4 Contest audience compilation', () => {
    it('compiles an explicit group without an invite code as a fixed audience', async () => {
        mutableModel().contest = {
            get: async () => ({
                _id: contestId,
                docId: contestId,
                domainId,
                participantScopeMode: 'groups',
                participantGroupIds: [groupId],
                participantSchoolIds: [],
                participationMode: 'individual',
                assign: [],
            }),
            getMultiStatus: () =>
                cursor([
                    { uid: 101, attend: 1 },
                    { uid: 999, attend: 1 },
                ]),
        };
        const source = await resolverModule.loadExamRosterResolutionSource(event(), { kind: 'contestAudience' });

        expect(source.kind).to.equal('contestAudience');
        expect(source.students.map((student) => student.boundUserId)).to.deep.equal([101]);
        expect(source.sourceFingerprint).to.match(/^[a-f0-9]{64}$/);
    });

    it('rejects an invite-code audience because later attendees can still change it', async () => {
        let userbindReads = 0;
        mutableModel().userbind = {
            loadExamRosterUserbindSnapshot: async () => {
                userbindReads++;
                return snapshot([groupId], [{ uid: 101, record: 1 }]);
            },
        };
        mutableModel().contest = {
            get: async () => ({
                _id: contestId,
                docId: contestId,
                domainId,
                participantScopeMode: 'groups',
                participantGroupIds: [groupId],
                participantSchoolIds: [],
                participationMode: 'individual',
                assign: [],
                _code: 'never-persist-this',
            }),
            getMultiStatus: () => cursor([{ uid: 101, attend: 1 }]),
        };

        expect(await resolverModule.getExamContestAudienceState(event())).to.equal('public');
        let reason: string | null = null;
        try {
            await resolverModule.loadExamRosterResolutionSource(event(), { kind: 'contestAudience' });
        } catch (error) {
            reason = (error as { reason?: string }).reason || null;
        }
        expect(reason).to.equal('contest_audience_not_fixed');
        expect(userbindReads).to.equal(0);
    });

    it('uses only finalized active team members and does not reapply individual group scope', async () => {
        let observedGroupIds: ObjectId[] | null | undefined;
        mutableModel().userbind = {
            loadExamRosterUserbindSnapshot: async (_domainId: string, _schoolId: ObjectId, groupIds: ObjectId[] | null) => {
                observedGroupIds = groupIds;
                return snapshot(groupIds, [
                    { uid: 201, record: 1 },
                    { uid: 202, record: 2 },
                ]);
            },
        };
        mutableModel().contest = {
            get: async () => ({
                _id: contestId,
                docId: contestId,
                domainId,
                participantScopeMode: 'groups',
                participantGroupIds: [groupId],
                participantSchoolIds: [],
                participationMode: 'team',
                rule: 'acm',
                participationRevision: 4,
                teamBatchId: new ObjectId('66bb00000000000000000005'),
                assign: [],
            }),
            getMultiStatus: () => cursor([]),
        };
        mutableModel().contestTeam = {
            listTeams: async () => [
                {
                    teamId: new ObjectId('66bb00000000000000000006'),
                    revision: 1,
                    memberUids: [202, 201],
                },
            ],
        };

        const source = await resolverModule.loadExamRosterResolutionSource(event(), { kind: 'contestAudience' });
        expect(observedGroupIds).to.equal(null);
        expect(source.students.map((student) => student.boundUserId)).to.deep.equal([201, 202]);
    });

    it('reports the exact members whose finalized team or role changed after a frozen roster', async () => {
        userStateRows = [
            { _id: 201, priv: 4 },
            { _id: 202, priv: 4 },
        ];
        mutableModel().userbind = {
            loadExamRosterUserbindSnapshot: async (_domainId: string, _schoolId: ObjectId, groupIds: ObjectId[] | null) =>
                snapshot(groupIds, [
                    { uid: 201, record: 1 },
                    { uid: 202, record: 2 },
                ]),
        };
        mutableModel().contest = {
            get: async () => ({
                _id: contestId,
                docId: contestId,
                domainId,
                participantScopeMode: 'none',
                participantGroupIds: [],
                participantSchoolIds: [],
                participationMode: 'team',
                rule: 'acm',
                participationRevision: 4,
                teamBatchId: new ObjectId('66bb00000000000000000005'),
                assign: [],
            }),
            getMultiStatus: () => cursor([]),
        };
        const originalTeamId = new ObjectId('66bb00000000000000000006');
        const replacementTeamId = new ObjectId('66bb00000000000000000007');
        let currentTeams = [{ teamId: originalTeamId, revision: 1, captainUid: 201, memberUids: [201, 202] }];
        mutableModel().contestTeam = { listTeams: async () => currentTeams };
        const frozen = await resolverModule.resolveExamRosterForEvent(event(), { kind: 'contestAudience' });
        const roster = {
            _id: new ObjectId('66bb00000000000000000008'),
            domainId,
            eventId,
            schoolId,
            source: frozen.source,
            entries: frozen.entries,
            exclusions: frozen.exclusions,
        } as import('../src/model/exam-seat-plan').ExamRosterRevisionDoc;
        currentTeams = [{ teamId: replacementTeamId, revision: 2, captainUid: 202, memberUids: [201, 202] }];

        const drift = await resolverModule.inspectExamRosterDrift(event(), roster, [
            {
                boundUserId: 201,
                studentRecordId: frozen.entries[0].studentRecordId,
                studentId: frozen.entries[0].studentId,
                teamId: originalTeamId.toHexString(),
                teamRole: 'captain',
            },
            {
                boundUserId: 202,
                studentRecordId: frozen.entries[1].studentRecordId,
                studentId: frozen.entries[1].studentId,
                teamId: originalTeamId.toHexString(),
                teamRole: 'member',
            },
        ]);

        expect(drift.changed).to.equal(true);
        expect(drift.items.map((item) => [item.boundUserId, item.kind, item.currentTeamRole])).to.deep.equal([
            [201, 'team_changed', 'member'],
            [202, 'team_changed', 'captain'],
        ]);
    });

    it('rejects an empty active team before reading userbind PII', async () => {
        let userbindReads = 0;
        mutableModel().userbind = {
            loadExamRosterUserbindSnapshot: async () => {
                userbindReads++;
                return snapshot(null, []);
            },
        };
        mutableModel().contest = {
            get: async () => ({
                _id: contestId,
                docId: contestId,
                domainId,
                participantScopeMode: 'none',
                participantGroupIds: [],
                participantSchoolIds: [],
                participationMode: 'team',
                rule: 'acm',
                teamBatchId: new ObjectId('66bb00000000000000000005'),
                assign: [],
            }),
            getMultiStatus: () => cursor([]),
        };
        mutableModel().contestTeam = {
            listTeams: async () => [{ teamId: new ObjectId('66bb00000000000000000006'), revision: 1, memberUids: [] }],
        };
        let reason: string | null = null;
        try {
            await resolverModule.loadExamRosterResolutionSource(event(), { kind: 'contestAudience' });
        } catch (error) {
            reason = (error as { reason?: string }).reason || null;
        }
        expect(reason).to.equal('contest_team_roster_invalid');
        expect(userbindReads).to.equal(0);
    });

    it('rejects a member duplicated across active teams', async () => {
        mutableModel().contest = {
            get: async () => ({
                _id: contestId,
                docId: contestId,
                domainId,
                participantScopeMode: 'none',
                participantGroupIds: [],
                participantSchoolIds: [],
                participationMode: 'team',
                rule: 'acm',
                teamBatchId: new ObjectId('66bb00000000000000000005'),
                assign: [],
            }),
            getMultiStatus: () => cursor([]),
        };
        mutableModel().contestTeam = {
            listTeams: async () => [
                { teamId: new ObjectId('66bb00000000000000000006'), revision: 1, memberUids: [101] },
                { teamId: new ObjectId('66bb00000000000000000007'), revision: 1, memberUids: [101, 102] },
            ],
        };
        let reason: string | null = null;
        try {
            await resolverModule.loadExamRosterResolutionSource(event(), { kind: 'contestAudience' });
        } catch (error) {
            reason = (error as { reason?: string }).reason || null;
        }
        expect(reason).to.equal('contest_team_roster_invalid');
    });

    it('rejects a forged cross-domain Contest identity before reading userbind PII', async () => {
        let userbindReads = 0;
        mutableModel().userbind = {
            loadExamRosterUserbindSnapshot: async () => {
                userbindReads++;
                return snapshot(null, []);
            },
        };
        mutableModel().contest = {
            get: async () => ({ _id: contestId, docId: contestId, domainId: 'other-domain' }),
            getMultiStatus: () => cursor([]),
        };
        let reason: string | null = null;
        try {
            await resolverModule.loadExamRosterResolutionSource(event(), { kind: 'contestAudience' });
        } catch (error) {
            reason = (error as { reason?: string }).reason || null;
        }
        expect(reason).to.equal('contest_identity_mismatch');
        expect(userbindReads).to.equal(0);
    });

    it('rejects an unknown participation mode before reading userbind PII', async () => {
        let userbindReads = 0;
        mutableModel().userbind = {
            loadExamRosterUserbindSnapshot: async () => {
                userbindReads++;
                return snapshot(null, []);
            },
        };
        mutableModel().contest = {
            get: async () => ({
                _id: contestId,
                docId: contestId,
                domainId,
                participantScopeMode: 'none',
                participantGroupIds: [],
                participantSchoolIds: [],
                participationMode: 'corrupt',
                assign: [],
            }),
            getMultiStatus: () => cursor([]),
        };
        let reason: string | null = null;
        try {
            await resolverModule.loadExamRosterResolutionSource(event(), { kind: 'contestAudience' });
        } catch (error) {
            reason = (error as { reason?: string }).reason || null;
        }
        expect(reason).to.equal('contest_audience_invalid');
        expect(userbindReads).to.equal(0);
    });

    it('rejects a malformed invite-code fact before reading userbind PII', async () => {
        let userbindReads = 0;
        mutableModel().userbind = {
            loadExamRosterUserbindSnapshot: async () => {
                userbindReads++;
                return snapshot(null, []);
            },
        };
        mutableModel().contest = {
            get: async () => ({
                _id: contestId,
                docId: contestId,
                domainId,
                participantScopeMode: 'none',
                participantGroupIds: [],
                participantSchoolIds: [],
                participationMode: 'individual',
                assign: [],
                _code: 0,
            }),
            getMultiStatus: () => cursor([]),
        };
        let reason: string | null = null;
        try {
            await resolverModule.loadExamRosterResolutionSource(event(), { kind: 'contestAudience' });
        } catch (error) {
            reason = (error as { reason?: string }).reason || null;
        }
        expect(reason).to.equal('contest_audience_invalid');
        expect(userbindReads).to.equal(0);
    });

    it('rejects falsy malformed audience configuration instead of defaulting it', async () => {
        let userbindReads = 0;
        mutableModel().userbind = {
            loadExamRosterUserbindSnapshot: async () => {
                userbindReads++;
                return snapshot(null, []);
            },
        };
        for (const malformed of [{ participantScopeMode: '' }, { assign: 0 }, { participantSchoolIds: null }]) {
            mutableModel().contest = {
                get: async () => ({
                    _id: contestId,
                    docId: contestId,
                    domainId,
                    participantScopeMode: 'none',
                    participantGroupIds: [],
                    participantSchoolIds: [],
                    participationMode: 'individual',
                    assign: [],
                    ...malformed,
                }),
                getMultiStatus: () => cursor([]),
            };
            let reason: string | null = null;
            try {
                await resolverModule.loadExamRosterResolutionSource(event(), { kind: 'contestAudience' });
            } catch (error) {
                reason = (error as { reason?: string }).reason || null;
            }
            expect(reason).to.equal('contest_audience_invalid');
        }
        expect(userbindReads).to.equal(0);
    });

    it('rejects an assigned Contest audience member missing from the school userbind snapshot', async () => {
        contestAssignGroups = [{ domainId, name: 'assigned', uids: [101, 102] }];
        mutableModel().contest = {
            get: async () => ({
                _id: contestId,
                docId: contestId,
                domainId,
                participantScopeMode: 'none',
                participantGroupIds: [],
                participantSchoolIds: [],
                participationMode: 'individual',
                assign: ['assigned'],
            }),
            getMultiStatus: () => cursor([]),
        };
        let reason: string | null = null;
        try {
            await resolverModule.loadExamRosterResolutionSource(event(), { kind: 'contestAudience' });
        } catch (error) {
            reason = (error as { reason?: string }).reason || null;
        }
        expect(reason).to.equal('contest_audience_userbind_missing');
    });

    it('rejects a fully public Contest before reading mutable attendance or userbind facts', async () => {
        let attendanceReads = 0;
        let userbindReads = 0;
        mutableModel().userbind = {
            loadExamRosterUserbindSnapshot: async () => {
                userbindReads++;
                return snapshot(null, []);
            },
        };
        mutableModel().contest = {
            get: async () => ({
                _id: contestId,
                docId: contestId,
                domainId,
                participantScopeMode: 'none',
                participantGroupIds: [],
                participantSchoolIds: [],
                participationMode: 'individual',
                assign: [],
            }),
            getMultiStatus: () => {
                attendanceReads++;
                return cursor([{ uid: '101', attend: 1 }]);
            },
        };
        let reason: string | null = null;
        try {
            await resolverModule.loadExamRosterResolutionSource(event(), { kind: 'contestAudience' });
        } catch (error) {
            reason = (error as { reason?: string }).reason || null;
        }
        expect(reason).to.equal('contest_audience_not_fixed');
        expect(attendanceReads).to.equal(0);
        expect(userbindReads).to.equal(0);
    });

    it('propagates cross-school group rejection without converting it to an empty roster', async () => {
        mutableModel().userbind = {
            loadExamRosterUserbindSnapshot: async () => {
                throw Object.assign(new Error('group_school_mismatch'), {
                    name: 'ExamRosterUserbindSourceError',
                    reason: 'group_school_mismatch',
                });
            },
        };
        let reason: string | null = null;
        let translated = false;
        try {
            await resolverModule.loadExamRosterResolutionSource(event(), { kind: 'userbindGroups', groupIds: [groupId] });
        } catch (error) {
            reason = (error as { reason?: string }).reason || null;
            translated = error instanceof seatPlanModule.ExamSeatPlanError;
        }
        expect(reason).to.equal('group_school_mismatch');
        expect(translated).to.equal(true);
    });

    it('rejects a non-canonical OJ privilege bitmask instead of truncating it', async () => {
        userStateRows = [{ _id: 101, priv: Number.NaN }];
        let reason: string | null = null;
        try {
            await resolverModule.loadExamRosterUserStates([101]);
        } catch (error) {
            reason = (error as { reason?: string }).reason || null;
        }
        expect(reason).to.equal('user_state_invalid');
    });
});
