import { isDeepStrictEqual } from 'node:util';
import { Logger } from '@hydrooj/utils';
import { ManagedProblemMetadataConflictError, ValidationError } from '../error';
import type {
    ProblemTagBackfillApplyResult,
    ProblemTagBackfillPlanEntry,
    ProblemTagBackfillProblemSnapshot,
    ProblemTagBackfillRuntimeAdapter,
    ProblemTagBackfillVerificationItem,
} from '../lib/problem-tag-backfill';
import { createProblemTagBackfillSnapshot, ProblemTagBackfillError } from '../lib/problem-tag-backfill';
import { normalizeProblemTagBackfillMindmapFacts, problemTagBackfillMindmapFingerprint } from '../lib/problem-tag-backfill-facts';
import { canonicalJson, sha256 } from '../lib/problem-batch-import';
import { commitProblemWriteClaimUpdate, inspectProblemWriteClaim } from './problem-access';
import * as document from './document';
import { previewProgrammingTagNormalization } from './managed-problem-authoring';
import * as OplogModel from './oplog';
import ProblemModel from './problem';
import UserModel from './user';
import db from '../service/db';
import { parallelAllSettled } from '../service/bus';

const logger = new Logger('problem-tag-backfill');

function equal(left: unknown, right: unknown): boolean {
    return canonicalJson(left) === canonicalJson(right);
}

function missingFingerprint(entry: ProblemTagBackfillPlanEntry): string {
    return sha256(canonicalJson({ domainId: entry.domainId, docId: entry.docId, state: 'missing' }));
}

function auditIdentity(entry: ProblemTagBackfillPlanEntry, planFingerprint: string) {
    return {
        type: 'problem.tag.backfill',
        domainId: entry.domainId,
        problemId: entry.docId,
        requestId: `problem-tag-backfill:${planFingerprint}:${entry.domainId}:${entry.docId}`,
    };
}

function assertAudit(record: any, entry: ProblemTagBackfillPlanEntry, actor: number, planFingerprint: string, nextStateFingerprint: string): void {
    if (
        !record ||
        record.operator !== actor ||
        record.planFingerprint !== planFingerprint ||
        record.problemId !== entry.docId ||
        record.result !== 'success' ||
        record.oldStateFingerprint !== entry.snapshot.stateFingerprint ||
        record.nextStateFingerprint !== nextStateFingerprint
    ) {
        throw new ProblemTagBackfillError(
            `${entry.domainId}/${entry.docId}: backfill audit is missing or conflicting`,
            'PROBLEM_TAG_BACKFILL_AUDIT_CONFLICT',
            record,
        );
    }
}

export default class HydroProblemTagBackfillAdapter implements ProblemTagBackfillRuntimeAdapter {
    private readonly actorByDomain = new Map<string, any>();

    private async loadMindmapFacts() {
        const rows = await db
            .collection<Record<string, any>>('mindmap.nodes')
            .find({}, { projection: { _id: 1, parentId: 1, topic: 1, tags: 1, updatedAt: 1 } })
            .toArray();
        return normalizeProblemTagBackfillMindmapFacts(rows);
    }

    private async permitCount(domainId: string, docId: number): Promise<number> {
        return db.collection('problem.permits').countDocuments({ domainId, pid: docId, active: { $in: [true, null] } });
    }

    private async loadSnapshot(domainId: string, docId: number): Promise<ProblemTagBackfillProblemSnapshot | null> {
        const pdoc = await document.coll.findOne(
            { domainId, docType: document.TYPE_PROBLEM, docId },
            {
                projection: {
                    _id: 1,
                    domainId: 1,
                    docId: 1,
                    pid: 1,
                    title: 1,
                    owner: 1,
                    tag: 1,
                    knowledgeNodeIds: 1,
                    structureRevision: 1,
                    problemKind: 1,
                    authoringMode: 1,
                    sourceMeta: 1,
                    managedAuthoring: 1,
                    config: 1,
                    data: 1,
                    additional_file: 1,
                    hidden: 1,
                    content: 1,
                    html: 1,
                    archivedAt: 1,
                },
            },
        );
        return pdoc ? createProblemTagBackfillSnapshot(pdoc as any, await this.permitCount(domainId, docId)) : null;
    }

    private previewEntry(snapshot: ProblemTagBackfillProblemSnapshot, selectedNodeIds: string[]) {
        return previewProgrammingTagNormalization({
            domainId: snapshot.domainId,
            docId: snapshot.docId,
            structureRevision: snapshot.structureRevisionPresent ? Number(snapshot.structureRevision) : undefined,
            currentTags: snapshot.tag,
            selectedNodeIds,
        });
    }

    async prepareActor(actor: number, entries: ProblemTagBackfillPlanEntry[]): Promise<void> {
        for (const domainId of [...new Set(entries.map((entry) => entry.domainId))]) {
            const user = await UserModel.getById(domainId, actor);
            if (!user || user._id !== actor || !ProblemModel.isProblemBankAdmin(user)) {
                throw new ProblemTagBackfillError(
                    `actor UID ${actor} is not a problem-bank administrator in ${domainId}`,
                    'PROBLEM_TAG_BACKFILL_ACTOR_DENIED',
                );
            }
            this.actorByDomain.set(domainId, user);
        }
    }

    async loadMindmapFingerprint(): Promise<string> {
        return problemTagBackfillMindmapFingerprint(await this.loadMindmapFacts());
    }

    async inspectEntryStateFingerprint(entry: ProblemTagBackfillPlanEntry): Promise<string> {
        return (await this.loadSnapshot(entry.domainId, entry.docId))?.stateFingerprint || missingFingerprint(entry);
    }

    private expectedState(current: ProblemTagBackfillProblemSnapshot, entry: ProblemTagBackfillPlanEntry): boolean {
        const nodeIds = Array.isArray(current.knowledgeNodeIds) ? current.knowledgeNodeIds.map(String).sort() : [];
        return (
            current.nonTagFingerprint === entry.snapshot.nonTagFingerprint &&
            current.structureRevisionPresent &&
            current.structureRevision === entry.expectedStructureRevisionAfterApply &&
            isDeepStrictEqual(current.tag, entry.nextTags) &&
            isDeepStrictEqual(nodeIds, [...entry.selectedNodeIds].sort())
        );
    }

    private async findAudit(entry: ProblemTagBackfillPlanEntry, planFingerprint: string) {
        return OplogModel.coll.findOne(auditIdentity(entry, planFingerprint));
    }

    private async ensureAudit(
        entry: ProblemTagBackfillPlanEntry,
        actor: number,
        planFingerprint: string,
        nextStateFingerprint: string,
    ): Promise<void> {
        const identity = auditIdentity(entry, planFingerprint);
        const existing = await this.findAudit(entry, planFingerprint);
        if (existing) {
            assertAudit(existing, entry, actor, planFingerprint, nextStateFingerprint);
            return;
        }
        try {
            await OplogModel.add({
                ...identity,
                operator: actor,
                planFingerprint,
                oldStateFingerprint: entry.snapshot.stateFingerprint,
                nextStateFingerprint,
                selectedNodeIds: entry.selectedNodeIds,
                oldTags: entry.snapshot.tag,
                nextTags: entry.nextTags,
                result: 'success',
                time: new Date(),
            } as any);
        } catch (error) {
            const confirmed = await this.findAudit(entry, planFingerprint);
            if (!confirmed) throw error;
            assertAudit(confirmed, entry, actor, planFingerprint, nextStateFingerprint);
            logger.warn(
                'Problem tag backfill audit confirmed after lost response domain=%s pid=%d actor=%d planFingerprint=%s stage=audit result=confirmed',
                entry.domainId,
                entry.docId,
                actor,
                planFingerprint,
            );
        }
    }

    async applyReady(entry: ProblemTagBackfillPlanEntry, actor: number, planFingerprint: string): Promise<ProblemTagBackfillApplyResult> {
        const user = this.actorByDomain.get(entry.domainId);
        if (!user || user._id !== actor) throw new ProblemTagBackfillError('backfill actor was not prepared', 'PROBLEM_TAG_BACKFILL_ACTOR_DENIED');
        const before = await this.loadSnapshot(entry.domainId, entry.docId);
        if (!before) return { status: 'stale', reason: 'problem-missing', observedStateFingerprint: missingFingerprint(entry) };
        if (before.nonTagFacts.archivedAtPresent) {
            return { status: 'stale', reason: 'problem-archived', observedStateFingerprint: before.stateFingerprint };
        }
        if (this.expectedState(before, entry)) {
            if (await inspectProblemWriteClaim(entry.domainId, entry.docId)) {
                throw new ProblemTagBackfillError(
                    `${entry.domainId}/${entry.docId}: a problem write claim remains on an expected backfill state`,
                    'PROBLEM_TAG_BACKFILL_CLAIM_CONFLICT',
                );
            }
            const audit = await this.findAudit(entry, planFingerprint);
            if (!audit) {
                return { status: 'stale', reason: 'expected-state-without-backfill-audit', observedStateFingerprint: before.stateFingerprint };
            }
            const confirmed = await this.loadSnapshot(entry.domainId, entry.docId);
            if (!confirmed || confirmed.stateFingerprint !== before.stateFingerprint) {
                return {
                    status: 'stale',
                    reason: confirmed ? 'expected-state-drift-during-no-op' : 'problem-missing-during-no-op',
                    observedStateFingerprint: confirmed?.stateFingerprint || missingFingerprint(entry),
                };
            }
            if (await inspectProblemWriteClaim(entry.domainId, entry.docId)) {
                throw new ProblemTagBackfillError(
                    `${entry.domainId}/${entry.docId}: a problem write claim started during no-op confirmation`,
                    'PROBLEM_TAG_BACKFILL_CLAIM_CONFLICT',
                );
            }
            assertAudit(audit, entry, actor, planFingerprint, confirmed.stateFingerprint);
            return { status: 'no-op', reason: 'already-applied-with-audit', observedStateFingerprint: confirmed.stateFingerprint };
        }
        if (before.stateFingerprint !== entry.snapshot.stateFingerprint) {
            return { status: 'stale', reason: 'problem-facts-drift', observedStateFingerprint: before.stateFingerprint };
        }
        const outerPreview = await this.previewEntry(before, entry.selectedNodeIds);
        if (outerPreview.fingerprint !== entry.normalizationFingerprint || !equal(outerPreview.nextTags, entry.nextTags)) {
            return { status: 'stale', reason: 'mindmap-path-drift', observedStateFingerprint: before.stateFingerprint };
        }
        const requestId = auditIdentity(entry, planFingerprint).requestId;
        let stale: ProblemTagBackfillApplyResult | null = null;
        let committed: ProblemTagBackfillProblemSnapshot | null = null;
        await ProblemModel.withAuthorizedWriteClaim(
            entry.domainId,
            entry.docId,
            user,
            'problem-tag-backfill',
            async (claim) => {
                const current = await this.loadSnapshot(entry.domainId, entry.docId);
                if (current?.nonTagFacts.archivedAtPresent) {
                    stale = {
                        status: 'stale',
                        reason: 'problem-archived-inside-claim',
                        observedStateFingerprint: current.stateFingerprint,
                    };
                    return;
                }
                if (!current || current.stateFingerprint !== entry.snapshot.stateFingerprint) {
                    stale = {
                        status: 'stale',
                        reason: current ? 'problem-facts-drift-inside-claim' : 'problem-missing-inside-claim',
                        observedStateFingerprint: current?.stateFingerprint || missingFingerprint(entry),
                    };
                    return;
                }
                let preview;
                try {
                    preview = await this.previewEntry(current, entry.selectedNodeIds);
                } catch (error) {
                    if (error instanceof ManagedProblemMetadataConflictError || error instanceof ValidationError) {
                        stale = { status: 'stale', reason: 'mindmap-path-drift-inside-claim', observedStateFingerprint: current.stateFingerprint };
                        return;
                    }
                    throw error;
                }
                if (preview.fingerprint !== entry.normalizationFingerprint || !equal(preview.nextTags, entry.nextTags)) {
                    stale = { status: 'stale', reason: 'mindmap-path-drift-inside-claim', observedStateFingerprint: current.stateFingerprint };
                    return;
                }
                let result;
                try {
                    result = await commitProblemWriteClaimUpdate(
                        claim,
                        { tag: preview.nextTags, knowledgeNodeIds: preview.selectedNodeIds } as any,
                        {},
                        'tag',
                        {
                            ...(current.structureRevisionPresent
                                ? { expectedStructureRevision: Number(current.structureRevision) }
                                : { expectedStructureRevisionAbsent: true }),
                            expectedTag: current.tag as string[],
                            allowHistoricalStructureLock: true,
                        },
                    );
                } catch (error) {
                    if (error instanceof ManagedProblemMetadataConflictError || error instanceof ValidationError) {
                        try {
                            const latestPreview = await this.previewEntry(current, entry.selectedNodeIds);
                            if (latestPreview.fingerprint !== entry.normalizationFingerprint || !equal(latestPreview.nextTags, entry.nextTags)) {
                                stale = {
                                    status: 'stale',
                                    reason: 'mindmap-path-drift-at-cas',
                                    observedStateFingerprint: current.stateFingerprint,
                                };
                                return;
                            }
                        } catch (latestError) {
                            if (latestError instanceof ManagedProblemMetadataConflictError || latestError instanceof ValidationError) {
                                stale = {
                                    status: 'stale',
                                    reason: 'mindmap-path-drift-at-cas',
                                    observedStateFingerprint: current.stateFingerprint,
                                };
                                return;
                            }
                            throw latestError;
                        }
                    }
                    throw error;
                }
                if (!result) {
                    const observed = await this.loadSnapshot(entry.domainId, entry.docId);
                    stale = {
                        status: 'stale',
                        reason: 'problem-cas-conflict',
                        observedStateFingerprint: observed?.stateFingerprint || missingFingerprint(entry),
                    };
                    return;
                }
                const next = createProblemTagBackfillSnapshot(result as any, await this.permitCount(entry.domainId, entry.docId));
                if (!this.expectedState(next, entry)) {
                    throw new ProblemTagBackfillError(
                        `${entry.domainId}/${entry.docId}: narrow CAS produced an unexpected state`,
                        'PROBLEM_TAG_BACKFILL_WRITE_INVALID',
                        { expected: entry.nextTags, actual: next },
                    );
                }
                await parallelAllSettled('problem/edit', result, claim.requestId, { hidden: result.hidden });
                await this.ensureAudit(entry, actor, planFingerprint, next.stateFingerprint);
                committed = next;
            },
            { requestId, capability: 'tag' },
        );
        if (stale) return stale;
        if (!committed) throw new ProblemTagBackfillError('backfill claim completed without a result', 'PROBLEM_TAG_BACKFILL_WRITE_INVALID');
        logger.info(
            'Problem tag backfill applied domain=%s pid=%s docId=%d actor=%d oldRevision=%s nextRevision=%s planFingerprint=%s stage=apply result=success',
            entry.domainId,
            entry.pid,
            entry.docId,
            actor,
            entry.snapshot.structureRevisionPresent ? entry.snapshot.structureRevision : 'absent',
            entry.expectedStructureRevisionAfterApply,
            planFingerprint,
        );
        return { status: 'applied', reason: 'canonical-tags-written', observedStateFingerprint: committed.stateFingerprint };
    }

    async verifyEntry(
        entry: ProblemTagBackfillPlanEntry,
        execution: import('../lib/problem-tag-backfill').ProblemTagBackfillExecutionResult | undefined,
        planFingerprint: string,
        actor: number | undefined,
    ): Promise<ProblemTagBackfillVerificationItem> {
        const current = await this.loadSnapshot(entry.domainId, entry.docId);
        if (!current) {
            return { domainId: entry.domainId, docId: entry.docId, pid: entry.pid, ok: false, state: 'missing', reason: 'problem-missing' };
        }
        const base = {
            domainId: entry.domainId,
            docId: entry.docId,
            pid: entry.pid,
            currentStateFingerprint: current.stateFingerprint,
        };
        const claim = await inspectProblemWriteClaim(entry.domainId, entry.docId);
        if (claim) return { ...base, ok: false, state: 'claim-conflict', reason: `problem-write-claim-${claim.state}` };
        const audit = await this.findAudit(entry, planFingerprint);
        if (entry.decision !== 'ready') {
            if (audit) return { ...base, ok: false, state: entry.decision, reason: 'unexpected-backfill-audit' };
            if (current.stateFingerprint !== entry.snapshot.stateFingerprint) {
                return { ...base, ok: false, state: entry.decision, reason: 'non-ready-problem-facts-changed' };
            }
            if (entry.decision === 'already-canonical') {
                try {
                    const preview = await this.previewEntry(current, entry.selectedNodeIds);
                    if (preview.fingerprint !== entry.normalizationFingerprint || !equal(preview.nextTags, current.tag)) {
                        return { ...base, ok: false, state: entry.decision, reason: 'canonical-pair-drift' };
                    }
                } catch (error) {
                    return { ...base, ok: false, state: entry.decision, reason: `canonical-validation-failed: ${String(error)}` };
                }
            }
            return { ...base, ok: true, state: entry.decision, reason: 'unchanged' };
        }
        if (!execution) return { ...base, ok: false, state: 'ready', reason: 'apply-result-missing' };
        if (execution.status === 'stale') {
            if (audit) return { ...base, ok: false, state: 'stale', reason: 'stale-entry-has-backfill-audit' };
            return {
                ...base,
                ok: current.stateFingerprint === execution.observedStateFingerprint,
                state: 'stale',
                reason: current.stateFingerprint === execution.observedStateFingerprint ? 'stale-observation-unchanged' : 'stale-observation-drift',
            };
        }
        if (!this.expectedState(current, entry)) return { ...base, ok: false, state: execution.status, reason: 'applied-state-mismatch' };
        if (!audit) return { ...base, ok: false, state: execution.status, reason: 'backfill-audit-missing' };
        try {
            if (!Number.isSafeInteger(actor) || actor! < 1) throw new Error('execution actor is missing');
            assertAudit(audit, entry, actor!, planFingerprint, current.stateFingerprint);
            const preview = await this.previewEntry(current, entry.selectedNodeIds);
            if (!equal(preview.nextTags, current.tag)) return { ...base, ok: false, state: execution.status, reason: 'materialized-tags-drift' };
        } catch (error) {
            return { ...base, ok: false, state: execution.status, reason: `applied-validation-failed: ${String(error)}` };
        }
        return { ...base, ok: true, state: execution.status, reason: 'applied-state-verified' };
    }
}
