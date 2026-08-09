import { describe, it } from 'node:test';
import { expect } from 'chai';
import { ObjectId } from 'mongodb';
import type { PracticeContextDoc, PracticeIntegrityRevisionDoc } from '../src/model/practice-integrity';

function sameValue(left: unknown, right: unknown): boolean {
    if (left instanceof ObjectId || right instanceof ObjectId) return String(left) === String(right);
    return left === right;
}

class MemoryCollection<T extends { _id: ObjectId }> {
    docs: T[] = [];
    indexes: Array<{ key: Record<string, number>; options: Record<string, unknown> }> = [];
    nextInsertError: Error | null = null;

    async createIndex(key: Record<string, number>, options: Record<string, unknown> = {}) {
        this.indexes.push({ key, options });
        return String(options.name || 'index');
    }

    async findOne(filter: Record<string, unknown>) {
        return this.docs.find((doc) => this.matches(doc, filter)) || null;
    }

    find(filter: Record<string, unknown>) {
        let values = this.docs.filter((doc) => this.matches(doc, filter));
        return {
            sort: (sort: Record<string, number>) => {
                const [field, direction] = Object.entries(sort)[0];
                values = [...values].sort((left, right) => direction * (Number((left as any)[field]) - Number((right as any)[field])));
                return {
                    limit: (count: number) => ({
                        next: async () => values.slice(0, count)[0] || null,
                    }),
                };
            },
        };
    }

    async insertOne(doc: T) {
        if (this.nextInsertError) {
            const error = this.nextInsertError;
            this.nextInsertError = null;
            throw error;
        }
        const revision = doc as unknown as PracticeIntegrityRevisionDoc;
        if ('containerKind' in revision && 'revision' in revision) {
            const conflict = this.docs.some((candidate) => {
                const current = candidate as unknown as PracticeIntegrityRevisionDoc;
                const sameContainer =
                    current.domainId === revision.domainId &&
                    current.containerKind === revision.containerKind &&
                    sameValue(current.containerId, revision.containerId);
                return sameContainer && (current.revision === revision.revision || (current.state === 'draft' && revision.state === 'draft'));
            });
            if (conflict) {
                const sameRevision = this.docs.some((candidate) => {
                    const current = candidate as unknown as PracticeIntegrityRevisionDoc;
                    return (
                        current.domainId === revision.domainId &&
                        current.containerKind === revision.containerKind &&
                        sameValue(current.containerId, revision.containerId) &&
                        current.revision === revision.revision
                    );
                });
                throw Object.assign(new Error('duplicate key'), {
                    code: 11000,
                    keyPattern: sameRevision
                        ? { domainId: 1, containerKind: 1, containerId: 1, revision: 1 }
                        : { domainId: 1, containerKind: 1, containerId: 1, state: 1 },
                    keyValue: sameRevision
                        ? {
                              domainId: revision.domainId,
                              containerKind: revision.containerKind,
                              containerId: revision.containerId,
                              revision: revision.revision,
                          }
                        : {
                              domainId: revision.domainId,
                              containerKind: revision.containerKind,
                              containerId: revision.containerId,
                              state: 'draft',
                          },
                });
            }
        }
        this.docs.push({ ...doc });
        return { insertedId: doc._id };
    }

    async updateOne(filter: Record<string, unknown>, update: Record<string, any>) {
        const index = this.docs.findIndex((doc) => this.matches(doc, filter));
        if (index === -1) return { matchedCount: 0, modifiedCount: 0 };
        const next: any = { ...this.docs[index] };
        Object.assign(next, update.$set || {});
        for (const [field, amount] of Object.entries(update.$inc || {})) next[field] = Number(next[field] || 0) + Number(amount);
        for (const field of Object.keys(update.$unset || {})) delete next[field];
        this.docs[index] = next;
        return { matchedCount: 1, modifiedCount: 1 };
    }

    private matches(doc: T, filter: Record<string, unknown>): boolean {
        return Object.entries(filter).every(([field, value]) => sameValue((doc as any)[field], value));
    }
}

const dbPath = require.resolve('../src/service/db.ts');
const previousDbCache = require.cache[dbPath];
const productionCollections = new Map<string, MemoryCollection<any>>();
require.cache[dbPath] = {
    id: dbPath,
    filename: dbPath,
    loaded: true,
    exports: {
        __esModule: true,
        default: {
            collection(name: string) {
                if (!productionCollections.has(name)) productionCollections.set(name, new MemoryCollection());
                return productionCollections.get(name);
            },
        },
    },
} as NodeModule;
(global as any).Hydro = { model: {} };
const practiceIntegrityModule = require('../src/model/practice-integrity.ts') as typeof import('../src/model/practice-integrity');
if (previousDbCache) require.cache[dbPath] = previousDbCache;
else delete require.cache[dbPath];
const { combinePracticePolicies, PracticeIntegrityConflictError, PracticeIntegrityContextError, PracticeIntegrityService } = practiceIntegrityModule;

async function capture(run: () => Promise<unknown>): Promise<Error | null> {
    try {
        await run();
        return null;
    } catch (error) {
        return error as Error;
    }
}

function makeService() {
    const revisions = new MemoryCollection<PracticeIntegrityRevisionDoc>();
    const contexts = new MemoryCollection<PracticeContextDoc>();
    let now = new Date('2026-08-09T08:00:00.000Z');
    const service = new PracticeIntegrityService({
        revisions: revisions as any,
        contexts: contexts as any,
        now: () => now,
        contextTtlMs: 15 * 60_000,
    });
    return { service, revisions, contexts, setNow: (value: Date) => (now = value) };
}

const courseId = new ObjectId('66b700000000000000000001');
const problemSetId = new ObjectId('66b700000000000000000002');
const strictPolicy = {
    prohibitExternalCodeInjection: true,
    removeIndependentSubmitForm: false,
    antiAiCopyInjection: true,
};

function contextTarget(revision: PracticeIntegrityRevisionDoc, scopeId = 4) {
    return {
        revision,
        scopeKind: revision.containerKind === 'course' ? ('chapter' as const) : ('stage' as const),
        scopeId,
    };
}

describe('practice integrity canonical model', () => {
    it('creates the exact revision and context indexes', async () => {
        const { service, revisions, contexts } = makeService();
        await service.ensureIndexes();
        expect(revisions.indexes).to.deep.equal([
            {
                key: { domainId: 1, containerKind: 1, containerId: 1, revision: 1 },
                options: { name: 'practiceIntegrityRevisionIdentity', unique: true },
            },
            {
                key: { domainId: 1, containerKind: 1, containerId: 1, state: 1 },
                options: {
                    name: 'practiceIntegritySingleDraft',
                    unique: true,
                    partialFilterExpression: { state: 'draft' },
                },
            },
            {
                key: { domainId: 1, containerKind: 1, containerId: 1, state: 1, revision: -1 },
                options: { name: 'practiceIntegrityPublishedLookup' },
            },
        ]);
        expect(contexts.indexes).to.deep.equal([
            { key: { expiresAt: 1 }, options: { name: 'practiceContextExpiry', expireAfterSeconds: 0 } },
            {
                key: { domainId: 1, uid: 1, containerKind: 1, containerId: 1, pid: 1, expiresAt: -1 },
                options: { name: 'practiceContextLookup' },
            },
        ]);
    });

    it('lets exactly one concurrent draft creation win and exposes unrelated duplicate keys', async () => {
        const { service, revisions } = makeService();
        const input = {
            domainId: 'system',
            containerKind: 'course' as const,
            containerId: courseId,
            policy: strictPolicy,
            actorUid: 2,
            expectedDraftVersion: 0,
        };
        const results = await Promise.allSettled([service.saveDraft(input), service.saveDraft(input)]);
        expect(results.filter((result) => result.status === 'fulfilled')).to.have.length(1);
        expect(results.filter((result) => result.status === 'rejected')).to.have.length(1);
        expect((results.find((result) => result.status === 'rejected') as PromiseRejectedResult).reason).to.be.instanceOf(
            PracticeIntegrityConflictError,
        );

        const unrelated = Object.assign(new Error('unexpected _id collision'), {
            code: 11000,
            keyPattern: { _id: 1 },
            keyValue: { _id: new ObjectId() },
        });
        const fresh = makeService();
        fresh.revisions.nextInsertError = unrelated;
        expect(await capture(() => fresh.service.saveDraft(input))).to.equal(unrelated);
        expect(revisions.docs).to.have.length(1);
    });

    it('publishes immutable revisions and creates the next draft with CAS', async () => {
        const { service, revisions } = makeService();
        const draft1 = await service.saveDraft({
            domainId: 'system',
            containerKind: 'course',
            containerId: courseId,
            policy: strictPolicy,
            actorUid: 2,
            expectedDraftVersion: 0,
        });
        expect(draft1).to.include({ revision: 1, draftVersion: 1, state: 'draft' });

        const draft2 = await service.saveDraft({
            domainId: 'system',
            containerKind: 'course',
            containerId: courseId,
            policy: { ...strictPolicy, removeIndependentSubmitForm: true },
            actorUid: 2,
            expectedDraftVersion: 1,
        });
        expect(draft2.draftVersion).to.equal(2);
        const published = await service.publishDraft({
            domainId: 'system',
            containerKind: 'course',
            containerId: courseId,
            actorUid: 2,
            expectedDraftVersion: 2,
        });
        expect(published).to.include({ revision: 1, state: 'published' });
        expect(published).not.to.have.property('draftVersion');

        const next = await service.saveDraft({
            domainId: 'system',
            containerKind: 'course',
            containerId: courseId,
            policy: strictPolicy,
            actorUid: 2,
            expectedDraftVersion: 0,
        });
        expect(next).to.include({ revision: 2, draftVersion: 1, state: 'draft' });
        expect(revisions.docs.find((doc) => doc.state === 'published')?.policy.removeIndependentSubmitForm).to.equal(true);

        const conflict = await capture(() =>
            service.saveDraft({
                domainId: 'system',
                containerKind: 'course',
                containerId: courseId,
                policy: strictPolicy,
                actorUid: 2,
                expectedDraftVersion: 0,
            }),
        );
        expect(conflict).to.be.instanceOf(PracticeIntegrityConflictError);
    });

    it('lets exactly one concurrent publish win', async () => {
        const { service } = makeService();
        await service.saveDraft({
            domainId: 'system',
            containerKind: 'course',
            containerId: courseId,
            policy: strictPolicy,
            actorUid: 2,
            expectedDraftVersion: 0,
        });
        const results = await Promise.allSettled(
            [2, 3].map((actorUid) =>
                service.publishDraft({
                    domainId: 'system',
                    containerKind: 'course',
                    containerId: courseId,
                    actorUid,
                    expectedDraftVersion: 1,
                }),
            ),
        );
        expect(results.filter((result) => result.status === 'fulfilled')).to.have.length(1);
        expect(results.filter((result) => result.status === 'rejected')).to.have.length(1);
    });

    it('combines nested policies by taking the stricter OR result', () => {
        expect(
            combinePracticePolicies([
                { prohibitExternalCodeInjection: true, removeIndependentSubmitForm: false, antiAiCopyInjection: false },
                { prohibitExternalCodeInjection: false, removeIndependentSubmitForm: true, antiAiCopyInjection: true },
            ]),
        ).to.deep.equal({
            prohibitExternalCodeInjection: true,
            removeIndependentSubmitForm: true,
            antiAiCopyInjection: true,
        });
    });

    it('binds a short-lived context to every identity and participating revision', async () => {
        const { service, contexts } = makeService();
        const course = await service.saveDraft({
            domainId: 'system',
            containerKind: 'course',
            containerId: courseId,
            policy: strictPolicy,
            actorUid: 2,
            expectedDraftVersion: 0,
        });
        await service.publishDraft({
            domainId: 'system',
            containerKind: 'course',
            containerId: courseId,
            actorUid: 2,
            expectedDraftVersion: course.draftVersion!,
        });
        const problemSet = await service.saveDraft({
            domainId: 'system',
            containerKind: 'problemSet',
            containerId: problemSetId,
            policy: { prohibitExternalCodeInjection: false, removeIndependentSubmitForm: true, antiAiCopyInjection: false },
            actorUid: 3,
            expectedDraftVersion: 0,
        });
        await service.publishDraft({
            domainId: 'system',
            containerKind: 'problemSet',
            containerId: problemSetId,
            actorUid: 3,
            expectedDraftVersion: problemSet.draftVersion!,
        });
        const revisions = await Promise.all([
            service.getLatestPublished('system', 'course', courseId),
            service.getLatestPublished('system', 'problemSet', problemSetId),
        ]);
        const missingPrimary = await capture(() =>
            service.issueContext({
                domainId: 'system',
                uid: 8,
                containerKind: 'course',
                containerId: courseId,
                scopeKind: 'chapter',
                scopeId: 4,
                pid: 42,
                mode: 'student',
                targets: [contextTarget(revisions[1] as PracticeIntegrityRevisionDoc)],
            }),
        );
        expect(missingPrimary).to.be.instanceOf(PracticeIntegrityContextError);
        for (const invalidPair of [
            { containerKind: 'course' as const, containerId: courseId, scopeKind: 'stage' as const, revisions },
            {
                containerKind: 'problemSet' as const,
                containerId: problemSetId,
                scopeKind: 'chapter' as const,
                revisions: [revisions[1] as PracticeIntegrityRevisionDoc],
            },
        ]) {
            expect(
                await capture(() =>
                    service.issueContext({
                        domainId: 'system',
                        uid: 8,
                        scopeId: 4,
                        pid: 42,
                        mode: 'student',
                        ...invalidPair,
                        targets: (invalidPair.revisions as PracticeIntegrityRevisionDoc[]).map((revision) => contextTarget(revision)),
                    }),
                ),
            ).to.be.instanceOf(PracticeIntegrityContextError);
        }
        const context = await service.issueContext({
            domainId: 'system',
            uid: 8,
            containerKind: 'course',
            containerId: courseId,
            scopeKind: 'chapter',
            scopeId: 4,
            pid: 42,
            mode: 'student',
            targets: (revisions as PracticeIntegrityRevisionDoc[]).map((revision) => contextTarget(revision)),
        });
        expect(context.revisions).to.have.length(2);
        expect(context.revisions.map((target) => [target.containerKind, target.scopeKind, target.scopeId])).to.deep.equal([
            ['course', 'chapter', 4],
            ['problemSet', 'stage', 4],
        ]);
        expect(context.policy).to.deep.equal({
            prohibitExternalCodeInjection: true,
            removeIndependentSubmitForm: true,
            antiAiCopyInjection: true,
        });
        expect(
            await capture(() =>
                service.issueContext({
                    domainId: 'system',
                    uid: 8,
                    containerKind: 'problemSet',
                    containerId: problemSetId,
                    scopeKind: 'stage',
                    scopeId: 4,
                    pid: 42,
                    mode: 'student',
                    targets: (revisions as PracticeIntegrityRevisionDoc[]).map((revision) => contextTarget(revision)),
                }),
            ),
        ).to.be.instanceOf(PracticeIntegrityContextError);
        expect(
            await service.assertContext({
                contextId: context._id.toHexString(),
                domainId: 'system',
                uid: 8,
                containerKind: 'course',
                containerId: courseId,
                scopeKind: 'chapter',
                scopeId: 4,
                pid: 42,
                mode: 'student',
            }),
        ).to.deep.equal(context);
        expect(
            await service.assertSubmissionContext({
                contextId: context._id.toHexString(),
                domainId: 'system',
                uid: 8,
                pid: 42,
            }),
        ).to.deep.equal(context);
        const storedContext = contexts.docs.find((candidate) => candidate._id.equals(context._id))!;
        const originalPrimary = {
            containerKind: storedContext.containerKind,
            containerId: storedContext.containerId,
            scopeKind: storedContext.scopeKind,
        };
        storedContext.containerKind = 'problemSet';
        storedContext.containerId = problemSetId;
        storedContext.scopeKind = 'stage';
        expect(
            await capture(() =>
                service.assertSubmissionContext({
                    contextId: context._id.toHexString(),
                    domainId: 'system',
                    uid: 8,
                    pid: 42,
                }),
            ),
        ).to.be.instanceOf(PracticeIntegrityContextError);
        Object.assign(storedContext, originalPrimary);
        expect(
            await capture(() =>
                service.assertSubmissionContext({
                    contextId: context._id.toHexString(),
                    domainId: 'system',
                    uid: 9,
                    pid: 42,
                }),
            ),
        ).to.be.instanceOf(PracticeIntegrityContextError);
        for (const mismatch of [
            { uid: 9 },
            { pid: 43 },
            { containerId: problemSetId },
            { domainId: 'other' },
            { scopeKind: 'stage' as const },
            { scopeId: 5 },
            { mode: 'preview' as const },
        ]) {
            const error = await capture(() =>
                service.assertContext({
                    contextId: context._id.toHexString(),
                    domainId: 'system',
                    uid: 8,
                    containerKind: 'course',
                    containerId: courseId,
                    scopeKind: 'chapter',
                    scopeId: 4,
                    pid: 42,
                    mode: 'student',
                    ...mismatch,
                }),
            );
            expect(error).to.be.instanceOf(PracticeIntegrityContextError);
        }

        const forged = { ...revisions[0], _id: new ObjectId() } as PracticeIntegrityRevisionDoc;
        expect(
            await capture(() =>
                service.issueContext({
                    domainId: 'system',
                    uid: 8,
                    containerKind: 'course',
                    containerId: courseId,
                    scopeKind: 'chapter',
                    scopeId: 4,
                    pid: 42,
                    mode: 'student',
                    targets: [contextTarget(forged)],
                }),
            ),
        ).to.be.instanceOf(PracticeIntegrityContextError);

        const sameContainerRevision = {
            ...(revisions[0] as PracticeIntegrityRevisionDoc),
            _id: new ObjectId(),
            revision: 2,
        };
        expect(
            await capture(() =>
                service.issueContext({
                    domainId: 'system',
                    uid: 8,
                    containerKind: 'course',
                    containerId: courseId,
                    scopeKind: 'chapter',
                    scopeId: 4,
                    pid: 42,
                    mode: 'student',
                    targets: [contextTarget(revisions[0] as PracticeIntegrityRevisionDoc), contextTarget(sameContainerRevision)],
                }),
            ),
        ).to.be.instanceOf(PracticeIntegrityContextError);

        context.policy.removeIndependentSubmitForm = false;
        expect(
            await capture(() =>
                service.assertContext({
                    contextId: context._id.toHexString(),
                    domainId: 'system',
                    uid: 8,
                    containerKind: 'course',
                    containerId: courseId,
                    scopeKind: 'chapter',
                    scopeId: 4,
                    pid: 42,
                    mode: 'student',
                }),
            ),
        ).to.be.instanceOf(PracticeIntegrityContextError);

        context.policy.removeIndependentSubmitForm = true;
        const courseIndex = context.revisions.findIndex((revision) => revision.containerKind === 'course');
        context.revisions.splice(courseIndex, 1);
        expect(
            await capture(() =>
                service.assertContext({
                    contextId: context._id.toHexString(),
                    domainId: 'system',
                    uid: 8,
                    containerKind: 'course',
                    containerId: courseId,
                    scopeKind: 'chapter',
                    scopeId: 4,
                    pid: 42,
                    mode: 'student',
                }),
            ),
        ).to.be.instanceOf(PracticeIntegrityContextError);
    });

    it('re-resolves canonical revisions and rejects malformed, changed, or missing revision state', async () => {
        const { service, revisions, contexts } = makeService();
        const draft = await service.saveDraft({
            domainId: 'system',
            containerKind: 'course',
            containerId: courseId,
            policy: strictPolicy,
            actorUid: 2,
            expectedDraftVersion: 0,
        });
        const published = await service.publishDraft({
            domainId: 'system',
            containerKind: 'course',
            containerId: courseId,
            actorUid: 2,
            expectedDraftVersion: draft.draftVersion!,
        });
        (published.policy as any).antiAiCopyInjection = 'yes';
        expect(
            await capture(() =>
                service.issueContext({
                    domainId: 'system',
                    uid: 8,
                    containerKind: 'course',
                    containerId: courseId,
                    scopeKind: 'chapter',
                    scopeId: 1,
                    pid: 42,
                    mode: 'student',
                    targets: [contextTarget(published, 1)],
                }),
            ),
        ).to.be.instanceOf(PracticeIntegrityContextError);

        published.policy = { ...strictPolicy };
        const context = await service.issueContext({
            domainId: 'system',
            uid: 8,
            containerKind: 'course',
            containerId: courseId,
            scopeKind: 'chapter',
            scopeId: 1,
            pid: 42,
            mode: 'student',
            targets: [contextTarget(published, 1)],
        });
        contexts.docs[0].scopeKind = 'stage';
        expect(
            await capture(() =>
                service.assertContext({
                    contextId: context._id.toHexString(),
                    domainId: 'system',
                    uid: 8,
                    containerKind: 'course',
                    containerId: courseId,
                    scopeKind: 'chapter',
                    scopeId: 1,
                    pid: 42,
                    mode: 'student',
                }),
            ),
        ).to.be.instanceOf(PracticeIntegrityContextError);
        contexts.docs[0].scopeKind = 'chapter';
        context.revisions[0].revision += 1;
        expect(
            await capture(() =>
                service.assertContext({
                    contextId: context._id.toHexString(),
                    domainId: 'system',
                    uid: 8,
                    containerKind: 'course',
                    containerId: courseId,
                    scopeKind: 'chapter',
                    scopeId: 1,
                    pid: 42,
                    mode: 'student',
                }),
            ),
        ).to.be.instanceOf(PracticeIntegrityContextError);

        context.revisions[0].revision -= 1;
        revisions.docs.length = 0;
        expect(
            await capture(() =>
                service.assertContext({
                    contextId: context._id.toHexString(),
                    domainId: 'system',
                    uid: 8,
                    containerKind: 'course',
                    containerId: courseId,
                    scopeKind: 'chapter',
                    scopeId: 1,
                    pid: 42,
                    mode: 'student',
                }),
            ),
        ).to.be.instanceOf(PracticeIntegrityContextError);
    });

    it('rejects stale revisions for new contexts without invalidating contexts already issued', async () => {
        const { service } = makeService();
        const firstDraft = await service.saveDraft({
            domainId: 'system',
            containerKind: 'course',
            containerId: courseId,
            policy: strictPolicy,
            actorUid: 2,
            expectedDraftVersion: 0,
        });
        const first = await service.publishDraft({
            domainId: 'system',
            containerKind: 'course',
            containerId: courseId,
            actorUid: 2,
            expectedDraftVersion: firstDraft.draftVersion!,
        });
        const issuedBeforeUpdate = await service.issueContext({
            domainId: 'system',
            uid: 8,
            containerKind: 'course',
            containerId: courseId,
            scopeKind: 'chapter',
            scopeId: 1,
            pid: 42,
            mode: 'student',
            targets: [contextTarget(first, 1)],
        });

        const secondDraft = await service.saveDraft({
            domainId: 'system',
            containerKind: 'course',
            containerId: courseId,
            policy: { ...strictPolicy, removeIndependentSubmitForm: true },
            actorUid: 2,
            expectedDraftVersion: 0,
        });
        await service.publishDraft({
            domainId: 'system',
            containerKind: 'course',
            containerId: courseId,
            actorUid: 2,
            expectedDraftVersion: secondDraft.draftVersion!,
        });

        expect(
            await capture(() =>
                service.issueContext({
                    domainId: 'system',
                    uid: 8,
                    containerKind: 'course',
                    containerId: courseId,
                    scopeKind: 'chapter',
                    scopeId: 1,
                    pid: 42,
                    mode: 'student',
                    targets: [contextTarget(first, 1)],
                }),
            ),
        ).to.be.instanceOf(PracticeIntegrityContextError);
        expect(
            await service.assertContext({
                contextId: issuedBeforeUpdate._id.toHexString(),
                domainId: 'system',
                uid: 8,
                containerKind: 'course',
                containerId: courseId,
                scopeKind: 'chapter',
                scopeId: 1,
                pid: 42,
                mode: 'student',
            }),
        ).to.deep.equal(issuedBeforeUpdate);
    });

    it('rejects expired contexts even before Mongo TTL cleanup', async () => {
        const { service, setNow, revisions, contexts } = makeService();
        const revision: PracticeIntegrityRevisionDoc = {
            _id: new ObjectId(),
            domainId: 'system',
            containerKind: 'course',
            containerId: courseId,
            revision: 1,
            state: 'published',
            policy: strictPolicy,
            createdBy: 2,
            createdAt: new Date('2026-08-09T07:00:00.000Z'),
            updatedBy: 2,
            updatedAt: new Date('2026-08-09T07:00:00.000Z'),
            publishedBy: 2,
            publishedAt: new Date('2026-08-09T07:00:00.000Z'),
        };
        revisions.docs.push(revision);
        const context = await service.issueContext({
            domainId: 'system',
            uid: 8,
            containerKind: 'course',
            containerId: courseId,
            scopeKind: 'chapter',
            scopeId: 1,
            pid: 42,
            mode: 'preview',
            targets: [contextTarget(revision, 1)],
        });
        setNow(new Date('2026-08-09T08:16:00.000Z'));
        const error = await capture(() =>
            service.assertContext({
                contextId: context._id.toHexString(),
                domainId: 'system',
                uid: 8,
                containerKind: 'course',
                containerId: courseId,
                scopeKind: 'chapter',
                scopeId: 1,
                pid: 42,
                mode: 'preview',
            }),
        );
        expect(error).to.be.instanceOf(PracticeIntegrityContextError);
        expect(error?.message).to.equal('expired');
        expect(contexts.indexes.some((index) => index.options.expireAfterSeconds === 0)).to.equal(true);
    });
});
