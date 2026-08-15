import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ObjectId } from 'mongodb';
import type { ExamPreloginPreparationFacts } from '../src/model/exam-prelogin-resolver';

const dbPath = require.resolve('../src/service/db.ts');
const previousDbCache = require.cache[dbPath];
require.cache[dbPath] = {
    id: dbPath,
    filename: dbPath,
    loaded: true,
    exports: { __esModule: true, default: { collection: () => ({}) } },
} as NodeModule;
(global as unknown as { Hydro: { model: Record<string, unknown> } }).Hydro = { model: {} };
const { compileExamPreloginPreparation } = require('../src/model/exam-prelogin-resolver.ts') as typeof import('../src/model/exam-prelogin-resolver');
if (previousDbCache) require.cache[dbPath] = previousDbCache;
else delete require.cache[dbPath];

const eventId = new ObjectId('64b100000000000000000001');
const schoolId = new ObjectId('64b100000000000000000002');
const assignmentId = new ObjectId('64b100000000000000000003');
const studentRecordId = new ObjectId('64b100000000000000000004');
const bindingId = new ObjectId('64b100000000000000000005');

function facts(overrides: Partial<ExamPreloginPreparationFacts> = {}): ExamPreloginPreparationFacts {
    return {
        domainId: 'system',
        eventId,
        eventRevision: 3,
        eventType: 'krypton',
        eventLifecycle: 'scheduled',
        eventEndAt: new Date('2026-08-12T03:00:00.000Z'),
        schoolId,
        assignment: { assignmentId, revision: 2, fingerprint: 'a'.repeat(64) },
        publicationRevision: 1,
        workspace: { kind: 'contest', contestId: '64b100000000000000000006', path: '/exam-mode/64b100000000000000000006' },
        assignments: [{ uid: 42, studentRecordId, sourceSeatId: 'seat-1' }],
        students: [{ uid: 42, studentRecordId, schoolId }],
        bindings: [{ sourceSeatId: 'seat-1', bindingId, bindingRevision: 4, endpointId: 'ep_one', schoolId }],
        contestEligibility: [{ uid: 42, eligible: true }],
        endpointFacts: [
            {
                endpointId: 'ep_one',
                online: true,
                serviceVersion: '0.5.0',
                protocolVersion: 2,
                capabilities: [{ name: 'exam.prelogin', version: 1, commands: ['launch_prelogin'] }],
                activeSessionId: null,
            },
        ],
        observedAt: new Date('2026-08-12T01:00:00.000Z'),
        ...overrides,
    };
}

test('compile preparation binds each student to the current physical seat and ready endpoint', () => {
    const result = compileExamPreloginPreparation(facts());

    assert.equal(result.hardErrorCount, 0);
    assert.equal(result.items[0].ready, true);
    assert.equal(result.items[0].bindingRevision, 4);
    assert.equal(result.items[0].endpointId, 'ep_one');
    assert.match(result.fingerprint, /^[a-f0-9]{64}$/);
});

test('compile preparation aggregates user, seat, endpoint and active-session blockers without issuing facts', () => {
    const result = compileExamPreloginPreparation(
        facts({
            students: [{ uid: 42, studentRecordId: new ObjectId(), schoolId }],
            bindings: [{ sourceSeatId: 'seat-1', bindingId, bindingRevision: 5, endpointId: 'ep_two', schoolId }],
            contestEligibility: [{ uid: 42, eligible: false, reason: 'contest_scope_changed' }],
            endpointFacts: [
                {
                    endpointId: 'ep_two',
                    online: false,
                    serviceVersion: '0.4.0',
                    protocolVersion: 2,
                    capabilities: [],
                    activeSessionId: 'ses_existing',
                },
            ],
        }),
    );

    assert.equal(result.items[0].ready, false);
    assert.deepEqual(
        result.items[0].diagnostics.map((item) => item.code),
        [
            'active_session_conflict',
            'contest_not_enterable',
            'endpoint_capability_missing',
            'endpoint_incompatible',
            'endpoint_offline',
            'user_binding_changed',
        ],
    );
    assert.equal(result.hardErrorCount, 6);
});

test('compile preparation returns a complete diagnostic for an unbound physical seat', () => {
    const result = compileExamPreloginPreparation(facts({ bindings: [] }));

    assert.equal(result.items[0].bindingId, null);
    assert.equal(result.items[0].endpointId, null);
    assert.equal(result.items[0].ready, false);
    assert.deepEqual(result.items[0].diagnostics, [{ code: 'seat_binding_changed', severity: 'error' }]);
    assert.match(result.fingerprint, /^[a-f0-9]{64}$/);
});

test('compile preparation distinguishes repeated source seat ids by their structured classroom key', () => {
    const secondStudentRecordId = new ObjectId('64b100000000000000000007');
    const secondBindingId = new ObjectId('64b100000000000000000008');
    const result = compileExamPreloginPreparation(
        facts({
            assignments: [
                {
                    uid: 42,
                    studentRecordId,
                    sourceSeatId: 'seat-1',
                    seatKey: 'classroom-a\0seat-1',
                    diagnostics: [{ code: 'seat_facing_changed', severity: 'warning' }],
                },
                { uid: 43, studentRecordId: secondStudentRecordId, sourceSeatId: 'seat-1', seatKey: 'classroom-b\0seat-1' },
            ],
            students: [
                { uid: 42, studentRecordId, schoolId },
                { uid: 43, studentRecordId: secondStudentRecordId, schoolId },
            ],
            bindings: [
                {
                    sourceSeatId: 'seat-1',
                    seatKey: 'classroom-a\0seat-1',
                    bindingId,
                    bindingRevision: 4,
                    endpointId: 'ep_one',
                    schoolId,
                },
                {
                    sourceSeatId: 'seat-1',
                    seatKey: 'classroom-b\0seat-1',
                    bindingId: secondBindingId,
                    bindingRevision: 2,
                    endpointId: 'ep_two',
                    schoolId,
                },
            ],
            contestEligibility: [
                { uid: 42, eligible: true },
                { uid: 43, eligible: true },
            ],
            endpointFacts: [
                {
                    endpointId: 'ep_one',
                    online: true,
                    serviceVersion: '0.6.0',
                    protocolVersion: 2,
                    capabilities: [{ name: 'exam.prelogin', version: 1, commands: ['launch_prelogin'] }],
                    activeSessionId: null,
                },
                {
                    endpointId: 'ep_two',
                    online: true,
                    serviceVersion: '0.6.0',
                    protocolVersion: 2,
                    capabilities: [{ name: 'exam.prelogin', version: 1, commands: ['launch_prelogin'] }],
                    activeSessionId: null,
                },
            ],
        }),
    );

    assert.deepEqual(
        result.items.map((item) => ({ uid: item.uid, sourceSeatId: item.sourceSeatId, endpointId: item.endpointId, diagnostics: item.diagnostics })),
        [
            {
                uid: 42,
                sourceSeatId: 'seat-1',
                endpointId: 'ep_one',
                diagnostics: [{ code: 'seat_facing_changed', severity: 'warning' }],
            },
            { uid: 43, sourceSeatId: 'seat-1', endpointId: 'ep_two', diagnostics: [] },
        ],
    );
    assert.equal(result.hardErrorCount, 0);
    assert.equal(result.warningCount, 1);
});

test('external events and ended events fail closed as preparation diagnostics', () => {
    const result = compileExamPreloginPreparation(
        facts({
            eventType: 'external',
            eventEndAt: new Date('2026-08-12T00:59:59.000Z'),
            workspace: null,
        }),
    );

    assert.deepEqual(
        result.items[0].diagnostics.map((item) => item.code),
        ['contest_not_enterable', 'external_workspace_unavailable'],
    );
    assert.equal(result.hardErrorCount, 2);
});
