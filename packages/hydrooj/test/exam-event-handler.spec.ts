import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import { expect } from 'chai';
import { ObjectId } from 'mongodb';
import type { ExamEventDoc } from '../src/model/exam-event';

const source = readFileSync(resolve(__dirname, '../src/handler/exam-event.ts'), 'utf8');
const auditSource = readFileSync(resolve(__dirname, '../src/model/exam-event-audit.ts'), 'utf8');
const requestSource = readFileSync(resolve(__dirname, '../src/model/exam-event-request.ts'), 'utf8');
const frameworkServerSource = readFileSync(resolve(__dirname, '../../../framework/framework/server.ts'), 'utf8');

describe('ExamEvent HTTP boundary contracts', () => {
    it('keeps raw decorator arguments separate and exposes only the narrow OJ routes', () => {
        expect(source).to.include("'/api/admin/exam-events'");
        expect(source).to.include("'/api/admin/exam-events/:eventId'");
        expect(source).not.to.include('/admin/vigil');
        expect(source).not.to.include('dashboardToken');
        expect(source).to.match(/async post\(\s*_args: unknown,\s*schoolId: ObjectId,/);
        expect(source).to.include("@param('title', Types.String)");
        expect(source).not.to.include("@param('title', Types.Title)");
        expect(source).to.match(/async get\(_args: unknown, eventId: ObjectId\)/);
        expect(source).to.match(/async post\(\s*_args: unknown,\s*eventId: ObjectId,/);
    });

    it('exposes authenticated UI entry routes without creating a second write boundary', () => {
        expect(source).to.include("'/admin/exam-infrastructure'");
        expect(source).to.include("'/admin/exam-infrastructure/events/:eventId'");
        expect(source).to.include("this.response.template = 'admin_exam_infrastructure.html'");
        expect(source).to.include("this.response.template = 'admin_exam_event.html'");
        expect(source).to.match(/class ExamInfrastructureDetailPageHandler[\s\S]*assertCanManageExamEvent/);
        expect(source.match(/class ExamInfrastructure[\s\S]*?async post/g) || []).to.have.length(0);
    });

    it('rechecks school, event ownership, collaborators, Contest and CAS on the server', () => {
        for (const contract of [
            'assertExamEventSchoolAccess',
            'assertCanManageExamEvent',
            'assertExamEventCollaborators',
            'assertExamEventContestAccess',
            'expectedRevision',
        ]) {
            expect(source, `missing server boundary: ${contract}`).to.include(contract);
        }
        expect(source).to.include("@param('action', Types.Range(['update', 'schedule', 'archive']))");
        expect(source).to.include("@param('expectedRevision', Types.PositiveInt)");
        expect(source).not.to.include("@param('operation'");
        expect(frameworkServerSource).to.include('ctx.request.body?.operation');
        expect(frameworkServerSource).not.to.include('ctx.request.body?.action');
        expect(source).to.include('parseExamEventUpdatePatch(body)');
        expect(requestSource).to.include("Object.hasOwn(body, 'contestId')");
        expect(requestSource).to.include('empty_update');
    });

    it('creates the audit intent before every mutation and finalizes the same fact', () => {
        expect(source).to.include('runAuditedExamEventMutation(');
        expect(auditSource).to.include("result: 'started'");
        expect(auditSource).to.include("result: 'success'");
        expect(auditSource).to.include("result: 'failed'");
        expect(auditSource).to.include('eventAuditSnapshot');
        expect(auditSource).to.include('changedEventFields');
    });

    it('does not expose a hard-delete mutation before reference models exist', () => {
        expect(source).not.to.match(/action['"], Types\.Range\(\[[^\]]*delete/);
        expect(source).not.to.include('deleteOne(');
    });
});

const dbPath = require.resolve('../src/service/db.ts');
const previousDbCache = require.cache[dbPath];
require.cache[dbPath] = {
    id: dbPath,
    filename: dbPath,
    loaded: true,
    exports: { __esModule: true, default: { collection: () => ({}) } },
} as NodeModule;
(global as unknown as { Hydro: { model: Record<string, unknown> } }).Hydro = { model: {} };
const auditModule = require('../src/model/exam-event-audit.ts') as typeof import('../src/model/exam-event-audit');
const eventModel = require('../src/model/exam-event.ts') as typeof import('../src/model/exam-event');
if (previousDbCache) require.cache[dbPath] = previousDbCache;
else delete require.cache[dbPath];

function event(patch: Partial<ExamEventDoc> = {}): ExamEventDoc {
    const now = new Date('2026-08-10T10:00:00.000Z');
    return {
        _id: new ObjectId('66b800000000000000000601'),
        domainId: 'system',
        schoolId: new ObjectId('66b800000000000000000602'),
        title: 'Event',
        type: 'external',
        lifecycle: 'draft',
        startAt: new Date('2026-08-10T12:00:00.000Z'),
        endAt: new Date('2026-08-10T14:00:00.000Z'),
        ownerUid: 1,
        collaboratorUids: [2],
        revision: 1,
        auditRef: 'exam-event:66b800000000000000000601:1',
        createdAt: now,
        createdBy: 1,
        updatedAt: now,
        updatedBy: 1,
        ...patch,
    };
}

describe('ExamEvent audited mutation boundary', () => {
    it('does not mutate if the audit intent cannot be persisted', async () => {
        let mutated = false;
        const store = {
            add: async () => {
                throw new Error('audit unavailable');
            },
            updateOne: async () => ({ matchedCount: 1 }),
        };
        try {
            await auditModule.runAuditedExamEventMutation(
                { actorUid: 1, domainId: 'system' },
                'schedule',
                {
                    eventId: event()._id,
                    expectedRevision: 1,
                    observedRevision: 1,
                    targetRevision: 2,
                    requestedFields: ['lifecycle'],
                    before: event(),
                },
                async () => {
                    mutated = true;
                    return event({ lifecycle: 'scheduled', revision: 2 });
                },
                store,
            );
            expect.fail('expected audit failure');
        } catch (error) {
            expect(error).to.have.property('message', 'audit unavailable');
        }
        expect(mutated).to.equal(false);
    });

    it('records full canonical associations and the actual schedule/archive field change', async () => {
        const writes: Array<Record<string, unknown>> = [];
        const store = {
            add: async (data: Record<string, unknown>) => {
                writes.push(data);
                return new ObjectId('66b800000000000000000603');
            },
            updateOne: async (_filter: unknown, update: { $set: Record<string, unknown> }) => {
                writes.push(update.$set);
                return { matchedCount: 1 };
            },
        };
        const before = event();
        const after = event({ lifecycle: 'scheduled', revision: 2, auditRef: 'exam-event:66b800000000000000000601:2' });
        await auditModule.runAuditedExamEventMutation(
            { actorUid: 1, domainId: 'system' },
            'schedule',
            {
                eventId: before._id,
                expectedRevision: 1,
                observedRevision: 1,
                targetRevision: 2,
                requestedFields: ['lifecycle'],
                before,
            },
            async () => after,
            store,
        );
        expect(writes[0]).to.include({
            type: 'exam.event.schedule',
            operator: 1,
            expectedRevision: 1,
            observedRevision: 1,
            targetRevision: 2,
            auditRef: 'exam-event:66b800000000000000000601:2',
            result: 'started',
        });
        expect(writes[1]).to.include({ result: 'success' });
        expect(writes[1].changedFields).to.deep.equal(['lifecycle']);
        expect(writes[1].after).to.deep.include({
            schoolId: '66b800000000000000000602',
            type: 'external',
            contestId: null,
            ownerUid: 1,
            collaboratorUids: [2],
            lifecycle: 'scheduled',
        });
    });

    it('keeps stale and future CAS attempts distinguishable in the failed audit fact', async () => {
        for (const expectedRevision of [1, 4]) {
            const writes: Array<Record<string, unknown>> = [];
            const store = {
                add: async (data: Record<string, unknown>) => {
                    writes.push(data);
                    return new ObjectId();
                },
                updateOne: async (_filter: unknown, update: { $set: Record<string, unknown> }) => {
                    writes.push(update.$set);
                    return { matchedCount: 1 };
                },
            };
            const before = event({ revision: 3, auditRef: 'exam-event:66b800000000000000000601:3' });
            try {
                await auditModule.runAuditedExamEventMutation(
                    { actorUid: 1, domainId: 'system' },
                    'update',
                    {
                        eventId: before._id,
                        expectedRevision,
                        observedRevision: 3,
                        targetRevision: expectedRevision + 1,
                        requestedFields: ['title'],
                        before,
                    },
                    async () => {
                        throw new eventModel.ExamEventError('revision_conflict');
                    },
                    store,
                );
                expect.fail('expected revision conflict');
            } catch (error) {
                expect(error).to.have.property('reason', 'revision_conflict');
            }
            expect(writes[0]).to.include({
                expectedRevision,
                observedRevision: 3,
                targetRevision: expectedRevision + 1,
                auditRef: `exam-event:66b800000000000000000601:${expectedRevision + 1}`,
            });
            expect(writes[1]).to.include({ result: 'failed' });
        }
    });

    it('classifies malformed collaborator input as the expected ExamEvent request error', () => {
        try {
            eventModel.canonicalCollaboratorUids(1, [0]);
            expect.fail('expected invalid collaborators');
        } catch (error) {
            expect(error).to.be.instanceOf(eventModel.ExamEventError);
            expect(error).to.have.property('reason', 'invalid_collaborators');
        }
        const tryOffset = source.indexOf('try {', source.indexOf('class ExamEventCollectionHandler'));
        expect(tryOffset).to.be.lessThan(source.indexOf('canonicalCollaboratorUids(this.user._id', tryOffset));
        expect(source.indexOf('translateExamEventError(error)', tryOffset)).to.be.greaterThan(tryOffset);
    });

    it('translates teacher-facing HTTP errors into Chinese and keeps reason codes in logs', () => {
        expect(source).to.include("throwExamTeacherValidationError('examEvent'");
        expect(source).to.include('logger.warn(\'Exam event rejected reason=%s\'');
        expect(source).not.to.include('Invalid request:');
        expect(source).not.to.include("throw new ValidationError('examEvent', null, error.reason)");
    });
});
