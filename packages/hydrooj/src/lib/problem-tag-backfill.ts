import fs from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import type { ProgrammingTagNormalizationPreview } from '../model/managed-problem-authoring';
import { canonicalJson, sha256 } from './problem-batch-import';
import { classifyLegacyProgrammingTags, type KnowledgeMindmapOption } from './problem-tag-canonical';

export const PROBLEM_TAG_BACKFILL_SCHEMA_VERSION = 1;
const SHA256 = /^[a-f0-9]{64}$/;
const OBJECT_ID = /^[a-f0-9]{24}$/i;

export type ProblemTagBackfillDecision = 'already-canonical' | 'ready' | 'skipped';
export type ProblemTagBackfillApplyStatus = 'applied' | 'no-op' | 'stale';

export class ProblemTagBackfillError extends Error {
    constructor(
        message: string,
        public readonly code = 'PROBLEM_TAG_BACKFILL_FAILED',
        public readonly details?: unknown,
        options?: ErrorOptions,
    ) {
        super(message, options);
        this.name = 'ProblemTagBackfillError';
    }
}

export interface ProblemTagBackfillNonTagFacts {
    documentId: string;
    pid: unknown;
    title: unknown;
    owner: unknown;
    problemKindPresent: boolean;
    problemKind: unknown;
    authoringModePresent: boolean;
    authoringMode: unknown;
    hidden: unknown;
    archivedAtPresent: boolean;
    archivedAtFingerprint: string;
    sourceMetaFingerprint: string;
    managedAuthoringFingerprint: string;
    configFingerprint: string;
    dataFingerprint: string;
    additionalFileFingerprint: string;
    contentFingerprint: string;
    htmlFingerprint: string;
    permitCount: number;
}

export interface ProblemTagBackfillProblemSnapshot {
    domainId: string;
    docId: number;
    pid: string;
    title: string;
    tag: unknown;
    knowledgeMapId: unknown;
    knowledgeNodeIdsPresent: boolean;
    knowledgeNodeIds: unknown;
    managedNodeIds: unknown;
    structureRevisionPresent: boolean;
    structureRevision: unknown;
    authoringModePresent: boolean;
    authoringMode: unknown;
    nonTagFacts: ProblemTagBackfillNonTagFacts;
    nonTagFingerprint: string;
    stateFingerprint: string;
}

export interface ProblemTagBackfillPlanEntry {
    domainId: string;
    docId: number;
    pid: string;
    title: string;
    decision: ProblemTagBackfillDecision;
    reason: string;
    snapshot: ProblemTagBackfillProblemSnapshot;
    sourceTags: string[];
    suggestions: Array<{ tag: string; nodeId: string; label: string }>;
    selectedNodeIds: string[];
    nextTags: string[];
    unknownTags: string[];
    ambiguousTags: Array<{ tag: string; candidates: string[] }>;
    normalizationFingerprint?: string;
    mindmapPathVersion?: Array<{ id: string; parentId: string | null; topic: string; updatedAt: string }>;
    expectedStructureRevisionAfterApply?: number;
    detail?: string;
}

export interface ProblemTagBackfillExecutionResult {
    domainId: string;
    docId: number;
    pid: string;
    status: ProblemTagBackfillApplyStatus;
    reason: string;
    observedStateFingerprint: string;
    at: string;
}

export interface ProblemTagBackfillExecution {
    planFingerprint: string;
    actor: number;
    state: 'applying' | 'applied' | 'failed';
    startedAt: string;
    updatedAt: string;
    results: ProblemTagBackfillExecutionResult[];
    lastError?: string;
}

export interface ProblemTagBackfillVerificationItem {
    domainId: string;
    docId: number;
    pid: string;
    ok: boolean;
    state: string;
    reason: string;
    currentStateFingerprint?: string;
}

export interface ProblemTagBackfillVerification {
    verifiedAt: string;
    ok: boolean;
    items: ProblemTagBackfillVerificationItem[];
}

export interface ProblemTagBackfillOutcomeEntry {
    domainId: string;
    docId: number;
    pid: string;
    title: string;
    state: ProblemTagBackfillDecision | ProblemTagBackfillApplyStatus;
    reason: string;
    oldTags: unknown;
    unknownTags: string[];
    ambiguousTags: Array<{ tag: string; candidates: string[] }>;
    detail?: string;
}

export interface ProblemTagBackfillOutcomeGroup {
    state: ProblemTagBackfillOutcomeEntry['state'];
    reason: string;
    entries: ProblemTagBackfillOutcomeEntry[];
}

export interface ProblemTagBackfillReport {
    schemaVersion: 1;
    generatedAt: string;
    mindmapFingerprint: string;
    entries: ProblemTagBackfillPlanEntry[];
    fingerprint: string;
    confirmationToken: string;
    outcomeGroups: ProblemTagBackfillOutcomeGroup[];
    execution?: ProblemTagBackfillExecution;
    verification?: ProblemTagBackfillVerification;
}

export interface ProblemTagBackfillPlanFacts {
    problems: ProblemTagBackfillProblemSnapshot[];
    mindmapOptions: KnowledgeMindmapOption[];
    mindmapFingerprint: string;
}

export interface ProblemTagBackfillPlanAdapter {
    loadPlanFacts(): Promise<ProblemTagBackfillPlanFacts>;
    preview(snapshot: ProblemTagBackfillProblemSnapshot, selectedNodeIds: string[]): Promise<ProgrammingTagNormalizationPreview>;
    close?(): Promise<void>;
}

export interface ProblemTagBackfillApplyResult {
    status: ProblemTagBackfillApplyStatus;
    reason: string;
    observedStateFingerprint: string;
}

export interface ProblemTagBackfillRuntimeAdapter {
    prepareActor(actor: number, entries: ProblemTagBackfillPlanEntry[]): Promise<void>;
    loadMindmapFingerprint(): Promise<string>;
    inspectEntryStateFingerprint(entry: ProblemTagBackfillPlanEntry): Promise<string>;
    applyReady(entry: ProblemTagBackfillPlanEntry, actor: number, planFingerprint: string): Promise<ProblemTagBackfillApplyResult>;
    verifyEntry(
        entry: ProblemTagBackfillPlanEntry,
        execution: ProblemTagBackfillExecutionResult | undefined,
        planFingerprint: string,
        actor: number | undefined,
    ): Promise<ProblemTagBackfillVerificationItem>;
    close?(): Promise<void>;
}

function own(value: object, field: PropertyKey): boolean {
    return Object.hasOwn(value, field);
}

function valueFingerprint(present: boolean, value: unknown): string {
    return sha256(canonicalJson({ present, value: present ? value : null }));
}

function stateFingerprint(snapshot: Omit<ProblemTagBackfillProblemSnapshot, 'stateFingerprint'>): string {
    return sha256(
        canonicalJson({
            domainId: snapshot.domainId,
            docId: snapshot.docId,
            tag: snapshot.tag,
            knowledgeMapId: snapshot.knowledgeMapId,
            knowledgeNodeIdsPresent: snapshot.knowledgeNodeIdsPresent,
            knowledgeNodeIds: snapshot.knowledgeNodeIdsPresent ? snapshot.knowledgeNodeIds : null,
            structureRevisionPresent: snapshot.structureRevisionPresent,
            structureRevision: snapshot.structureRevisionPresent ? snapshot.structureRevision : null,
            nonTagFingerprint: snapshot.nonTagFingerprint,
        }),
    );
}

export function createProblemTagBackfillSnapshot(pdoc: Record<string, any>, permitCount: number): ProblemTagBackfillProblemSnapshot {
    if (typeof pdoc.domainId !== 'string' || !pdoc.domainId || !Number.isSafeInteger(pdoc.docId) || pdoc.docId < 1) {
        throw new ProblemTagBackfillError('programming problem identity is malformed', 'PROBLEM_TAG_BACKFILL_PROBLEM_INVALID');
    }
    if (!Number.isSafeInteger(permitCount) || permitCount < 0) {
        throw new ProblemTagBackfillError('problem permit count is malformed', 'PROBLEM_TAG_BACKFILL_PROBLEM_INVALID');
    }
    const problemKindPresent = own(pdoc, 'problemKind');
    const authoringModePresent = own(pdoc, 'authoringMode');
    const sourceMetaPresent = own(pdoc, 'sourceMeta');
    const managedAuthoringPresent = own(pdoc, 'managedAuthoring');
    const configPresent = own(pdoc, 'config');
    const dataPresent = own(pdoc, 'data');
    const additionalFilePresent = own(pdoc, 'additional_file');
    const contentPresent = own(pdoc, 'content');
    const htmlPresent = own(pdoc, 'html');
    const archivedAtPresent = own(pdoc, 'archivedAt');
    const nonTagFacts: ProblemTagBackfillNonTagFacts = {
        documentId: String(pdoc._id ?? ''),
        pid: pdoc.pid,
        title: pdoc.title,
        owner: pdoc.owner,
        problemKindPresent,
        problemKind: problemKindPresent ? pdoc.problemKind : null,
        authoringModePresent,
        authoringMode: authoringModePresent ? pdoc.authoringMode : null,
        hidden: pdoc.hidden,
        archivedAtPresent,
        archivedAtFingerprint: valueFingerprint(archivedAtPresent, pdoc.archivedAt),
        sourceMetaFingerprint: valueFingerprint(sourceMetaPresent, pdoc.sourceMeta),
        managedAuthoringFingerprint: valueFingerprint(managedAuthoringPresent, pdoc.managedAuthoring),
        configFingerprint: valueFingerprint(configPresent, pdoc.config),
        dataFingerprint: valueFingerprint(dataPresent, pdoc.data),
        additionalFileFingerprint: valueFingerprint(additionalFilePresent, pdoc.additional_file),
        contentFingerprint: valueFingerprint(contentPresent, pdoc.content),
        htmlFingerprint: valueFingerprint(htmlPresent, pdoc.html),
        permitCount,
    };
    const knowledgeNodeIdsPresent = own(pdoc, 'knowledgeNodeIds');
    const structureRevisionPresent = own(pdoc, 'structureRevision');
    const snapshotWithoutState: Omit<ProblemTagBackfillProblemSnapshot, 'stateFingerprint'> = {
        domainId: pdoc.domainId,
        docId: pdoc.docId,
        pid: typeof pdoc.pid === 'string' ? pdoc.pid : `P${pdoc.docId}`,
        title: typeof pdoc.title === 'string' ? pdoc.title : '[标题字段畸形]',
        tag: pdoc.tag,
        knowledgeMapId: pdoc.knowledgeMapId,
        knowledgeNodeIdsPresent,
        knowledgeNodeIds: knowledgeNodeIdsPresent ? pdoc.knowledgeNodeIds : null,
        managedNodeIds: pdoc.managedAuthoring?.selectedMindmapNodeIds ?? null,
        structureRevisionPresent,
        structureRevision: structureRevisionPresent ? pdoc.structureRevision : null,
        authoringModePresent,
        authoringMode: authoringModePresent ? pdoc.authoringMode : null,
        nonTagFacts,
        nonTagFingerprint: sha256(canonicalJson(nonTagFacts)),
    };
    return { ...snapshotWithoutState, stateFingerprint: stateFingerprint(snapshotWithoutState) };
}

function normalizedNodeIds(value: unknown): string[] | null {
    if (!Array.isArray(value)) return null;
    const result = value.map((item) => String(item));
    if (!result.length || result.some((item) => !OBJECT_ID.test(item))) return null;
    return [...new Set(result)].sort();
}

function normalizedPreview(preview: ProgrammingTagNormalizationPreview) {
    return {
        sourceTags: [...preview.sourceTags],
        selectedNodeIds: preview.selectedNodeIds.map(String).sort(),
        nextTags: [...preview.nextTags],
        fingerprint: preview.fingerprint,
        mindmapPathVersion: [...(preview.mindmapPathVersion || [])],
    };
}

function skippedEntry(
    snapshot: ProblemTagBackfillProblemSnapshot,
    reason: string,
    extra: Partial<ProblemTagBackfillPlanEntry> = {},
): ProblemTagBackfillPlanEntry {
    return {
        domainId: snapshot.domainId,
        docId: snapshot.docId,
        pid: snapshot.pid,
        title: snapshot.title,
        decision: 'skipped',
        reason,
        snapshot,
        sourceTags: [],
        suggestions: [],
        selectedNodeIds: [],
        nextTags: [],
        unknownTags: [],
        ambiguousTags: [],
        ...extra,
    };
}

async function planOne(
    snapshot: ProblemTagBackfillProblemSnapshot,
    mindmapOptions: KnowledgeMindmapOption[],
    adapter: ProblemTagBackfillPlanAdapter,
): Promise<ProblemTagBackfillPlanEntry> {
    if (!Array.isArray(snapshot.tag) || snapshot.tag.some((tag) => typeof tag !== 'string')) {
        return skippedEntry(snapshot, 'malformed-tags');
    }
    if (snapshot.structureRevisionPresent && (!Number.isSafeInteger(snapshot.structureRevision) || Number(snapshot.structureRevision) < 1)) {
        return skippedEntry(snapshot, 'malformed-structure-revision');
    }
    const managed = snapshot.authoringModePresent && snapshot.authoringMode === 'managed';
    if (snapshot.authoringModePresent && !['managed', undefined].includes(snapshot.authoringMode as any)) {
        return skippedEntry(snapshot, 'malformed-authoring-mode');
    }
    const knowledgeMapId = String(snapshot.knowledgeMapId || '');
    if (!OBJECT_ID.test(knowledgeMapId)) return skippedEntry(snapshot, 'malformed-knowledge-map');
    const scopedMindmapOptions = mindmapOptions.filter((option) => option.mapId === knowledgeMapId);
    if (!scopedMindmapOptions.length) return skippedEntry(snapshot, 'missing-knowledge-map');
    if (managed || snapshot.knowledgeNodeIdsPresent) {
        let nodeIds: string[] | null;
        if (managed) {
            nodeIds = normalizedNodeIds(snapshot.managedNodeIds);
            if (!nodeIds) return skippedEntry(snapshot, 'malformed-knowledge-nodes');
            if (snapshot.knowledgeNodeIdsPresent) {
                const storedNodeIds = normalizedNodeIds(snapshot.knowledgeNodeIds);
                if (!storedNodeIds || !isDeepStrictEqual(storedNodeIds, nodeIds)) {
                    return skippedEntry(snapshot, 'canonical-fact-conflict', {
                        selectedNodeIds: nodeIds,
                        detail: 'managedAuthoring.selectedMindmapNodeIds conflicts with knowledgeNodeIds',
                    });
                }
            }
        } else {
            nodeIds = normalizedNodeIds(snapshot.knowledgeNodeIds);
        }
        if (!nodeIds) return skippedEntry(snapshot, 'malformed-knowledge-nodes');
        try {
            const preview = normalizedPreview(await adapter.preview(snapshot, nodeIds));
            if (!isDeepStrictEqual(preview.selectedNodeIds, nodeIds) || !isDeepStrictEqual(preview.nextTags, snapshot.tag)) {
                return skippedEntry(snapshot, 'canonical-fact-conflict', {
                    sourceTags: preview.sourceTags,
                    selectedNodeIds: preview.selectedNodeIds,
                    nextTags: preview.nextTags,
                    normalizationFingerprint: preview.fingerprint,
                    mindmapPathVersion: preview.mindmapPathVersion,
                });
            }
            return {
                ...skippedEntry(snapshot, 'canonical-pair-validated'),
                decision: 'already-canonical',
                sourceTags: preview.sourceTags,
                selectedNodeIds: preview.selectedNodeIds,
                nextTags: preview.nextTags,
                normalizationFingerprint: preview.fingerprint,
                mindmapPathVersion: preview.mindmapPathVersion,
            };
        } catch (error) {
            return skippedEntry(snapshot, 'invalid-canonical-mindmap', {
                detail: error instanceof Error ? error.message : String(error),
            });
        }
    }
    if (!snapshot.tag.length) return skippedEntry(snapshot, 'empty-tags');
    const classification = classifyLegacyProgrammingTags(snapshot.tag, scopedMindmapOptions);
    const classificationFacts = {
        sourceTags: classification.sourceTags,
        suggestions: classification.suggestions,
        unknownTags: classification.unknownTags,
        ambiguousTags: classification.ambiguousTags,
    };
    if (classification.unknownTags.length) return skippedEntry(snapshot, 'unknown-tags', classificationFacts);
    if (classification.ambiguousTags.length) return skippedEntry(snapshot, 'ambiguous-tags', classificationFacts);
    const invalidSuggestedPath = scopedMindmapOptions.find((option) => classification.suggestedNodeIds.includes(option.id) && option.pathError);
    if (invalidSuggestedPath) {
        return skippedEntry(snapshot, 'invalid-mindmap-path', {
            ...classificationFacts,
            detail: invalidSuggestedPath.pathError,
        });
    }
    if (!classification.suggestedNodeIds.length) {
        return skippedEntry(
            snapshot,
            classification.sourceTags.length === snapshot.tag.length ? 'source-tags-only' : 'no-knowledge-suggestion',
            classificationFacts,
        );
    }
    try {
        const preview = normalizedPreview(await adapter.preview(snapshot, classification.suggestedNodeIds));
        if (!preview.selectedNodeIds.length) return skippedEntry(snapshot, 'no-knowledge-suggestion', classificationFacts);
        return {
            ...skippedEntry(snapshot, 'strict-unique-match', classificationFacts),
            decision: 'ready',
            selectedNodeIds: preview.selectedNodeIds,
            nextTags: preview.nextTags,
            normalizationFingerprint: preview.fingerprint,
            mindmapPathVersion: preview.mindmapPathVersion,
            expectedStructureRevisionAfterApply: Number(snapshot.structureRevision ?? 0) + 1,
        };
    } catch (error) {
        return skippedEntry(snapshot, 'invalid-mindmap-path', {
            ...classificationFacts,
            detail: error instanceof Error ? error.message : String(error),
        });
    }
}

function unsignedReport(report: Pick<ProblemTagBackfillReport, 'schemaVersion' | 'generatedAt' | 'mindmapFingerprint' | 'entries'>) {
    return {
        schemaVersion: report.schemaVersion,
        generatedAt: report.generatedAt,
        mindmapFingerprint: report.mindmapFingerprint,
        entries: report.entries,
    };
}

function reportFingerprint(report: Pick<ProblemTagBackfillReport, 'schemaVersion' | 'generatedAt' | 'mindmapFingerprint' | 'entries'>) {
    return sha256(canonicalJson(unsignedReport(report)));
}

export function problemTagBackfillOutcomeGroups(report: Pick<ProblemTagBackfillReport, 'entries' | 'execution'>): ProblemTagBackfillOutcomeGroup[] {
    const executionByIdentity = new Map((report.execution?.results || []).map((result) => [`${result.domainId}/${result.docId}`, result] as const));
    const groups = new Map<string, ProblemTagBackfillOutcomeGroup>();
    for (const entry of report.entries) {
        const result = executionByIdentity.get(`${entry.domainId}/${entry.docId}`);
        const state = result?.status || entry.decision;
        const reason = result?.reason || entry.reason;
        const key = `${state}\u0000${reason}`;
        const outcome: ProblemTagBackfillOutcomeEntry = {
            domainId: entry.domainId,
            docId: entry.docId,
            pid: entry.pid,
            title: entry.title,
            state,
            reason,
            oldTags: entry.snapshot.tag,
            unknownTags: [...entry.unknownTags],
            ambiguousTags: entry.ambiguousTags.map((item) => ({ tag: item.tag, candidates: [...item.candidates] })),
            ...(entry.detail ? { detail: entry.detail } : {}),
        };
        const group = groups.get(key) || { state, reason, entries: [] };
        group.entries.push(outcome);
        groups.set(key, group);
    }
    return [...groups.values()]
        .map((group) => ({
            ...group,
            entries: group.entries.sort((left, right) => left.domainId.localeCompare(right.domainId) || left.docId - right.docId),
        }))
        .sort((left, right) => left.reason.localeCompare(right.reason) || left.state.localeCompare(right.state));
}

export function refreshProblemTagBackfillOutcomeGroups(report: ProblemTagBackfillReport): void {
    report.outcomeGroups = problemTagBackfillOutcomeGroups(report);
}

export function problemTagBackfillConfirmationToken(fingerprint: string): string {
    return `APPLY:problem-tag-backfill:${fingerprint}`;
}

export async function planProblemTagBackfill(adapter: ProblemTagBackfillPlanAdapter, now = new Date()): Promise<ProblemTagBackfillReport> {
    const facts = await adapter.loadPlanFacts();
    if (!SHA256.test(facts.mindmapFingerprint)) {
        throw new ProblemTagBackfillError('mindmap fingerprint is invalid', 'PROBLEM_TAG_BACKFILL_PLAN_INVALID');
    }
    const problems = [...facts.problems].sort((left, right) => left.domainId.localeCompare(right.domainId) || left.docId - right.docId);
    const entries: ProblemTagBackfillPlanEntry[] = [];
    for (const snapshot of problems) entries.push(await planOne(snapshot, facts.mindmapOptions, adapter));
    const unsigned = {
        schemaVersion: PROBLEM_TAG_BACKFILL_SCHEMA_VERSION as 1,
        generatedAt: now.toISOString(),
        mindmapFingerprint: facts.mindmapFingerprint,
        entries,
    };
    const fingerprint = reportFingerprint(unsigned);
    const report: ProblemTagBackfillReport = {
        ...unsigned,
        fingerprint,
        confirmationToken: problemTagBackfillConfirmationToken(fingerprint),
        outcomeGroups: [],
    };
    refreshProblemTagBackfillOutcomeGroups(report);
    return report;
}

export function assertProblemTagBackfillReport(raw: unknown): ProblemTagBackfillReport {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        throw new ProblemTagBackfillError('report must be a JSON object', 'PROBLEM_TAG_BACKFILL_REPORT_INVALID');
    }
    const report = raw as ProblemTagBackfillReport;
    if (
        report.schemaVersion !== PROBLEM_TAG_BACKFILL_SCHEMA_VERSION ||
        typeof report.generatedAt !== 'string' ||
        !SHA256.test(report.mindmapFingerprint) ||
        !Array.isArray(report.entries) ||
        !SHA256.test(report.fingerprint)
    ) {
        throw new ProblemTagBackfillError('report header is invalid', 'PROBLEM_TAG_BACKFILL_REPORT_INVALID');
    }
    if (reportFingerprint(report) !== report.fingerprint || report.confirmationToken !== problemTagBackfillConfirmationToken(report.fingerprint)) {
        throw new ProblemTagBackfillError('report fingerprint does not match its plan facts', 'PROBLEM_TAG_BACKFILL_REPORT_INVALID');
    }
    const identities = new Set<string>();
    for (const entry of report.entries) {
        const identity = `${entry?.domainId}/${entry?.docId}`;
        if (
            typeof entry?.domainId !== 'string' ||
            !entry.domainId ||
            !Number.isSafeInteger(entry?.docId) ||
            entry.docId < 1 ||
            typeof entry.pid !== 'string' ||
            typeof entry.title !== 'string' ||
            typeof entry.reason !== 'string' ||
            !['already-canonical', 'ready', 'skipped'].includes(entry?.decision) ||
            !Array.isArray(entry.sourceTags) ||
            !Array.isArray(entry.suggestions) ||
            !Array.isArray(entry.selectedNodeIds) ||
            !Array.isArray(entry.nextTags) ||
            !Array.isArray(entry.unknownTags) ||
            !Array.isArray(entry.ambiguousTags) ||
            !entry.snapshot ||
            entry.snapshot.domainId !== entry.domainId ||
            entry.snapshot.docId !== entry.docId ||
            !SHA256.test(entry.snapshot.nonTagFingerprint) ||
            !SHA256.test(entry.snapshot.stateFingerprint) ||
            identities.has(identity)
        ) {
            throw new ProblemTagBackfillError(`report entry is invalid: ${identity}`, 'PROBLEM_TAG_BACKFILL_REPORT_INVALID');
        }
        const { stateFingerprint: _stateFingerprint, ...snapshotWithoutState } = entry.snapshot;
        if (!entry.snapshot.nonTagFacts || sha256(canonicalJson(entry.snapshot.nonTagFacts)) !== entry.snapshot.nonTagFingerprint) {
            throw new ProblemTagBackfillError(`report non-tag fingerprint is invalid: ${identity}`, 'PROBLEM_TAG_BACKFILL_REPORT_INVALID');
        }
        if (stateFingerprint(snapshotWithoutState) !== entry.snapshot.stateFingerprint) {
            throw new ProblemTagBackfillError(`report snapshot fingerprint is invalid: ${identity}`, 'PROBLEM_TAG_BACKFILL_REPORT_INVALID');
        }
        if (
            entry.decision === 'ready' &&
            (!entry.selectedNodeIds.length ||
                entry.selectedNodeIds.some((nodeId) => typeof nodeId !== 'string' || !OBJECT_ID.test(nodeId)) ||
                !entry.nextTags.length ||
                entry.nextTags.some((tag) => typeof tag !== 'string') ||
                !SHA256.test(entry.normalizationFingerprint || '') ||
                entry.expectedStructureRevisionAfterApply !== Number(entry.snapshot.structureRevision ?? 0) + 1)
        ) {
            throw new ProblemTagBackfillError(`ready entry is incomplete: ${identity}`, 'PROBLEM_TAG_BACKFILL_REPORT_INVALID');
        }
        identities.add(identity);
    }
    if (report.execution) {
        const execution = report.execution;
        if (
            execution.planFingerprint !== report.fingerprint ||
            !Number.isSafeInteger(execution.actor) ||
            execution.actor < 1 ||
            !['applying', 'applied', 'failed'].includes(execution.state) ||
            typeof execution.startedAt !== 'string' ||
            typeof execution.updatedAt !== 'string' ||
            !Array.isArray(execution.results) ||
            (execution.lastError !== undefined && typeof execution.lastError !== 'string')
        ) {
            throw new ProblemTagBackfillError('execution report is invalid', 'PROBLEM_TAG_BACKFILL_REPORT_INVALID');
        }
        const ready = new Map(
            report.entries.filter((entry) => entry.decision === 'ready').map((entry) => [`${entry.domainId}/${entry.docId}`, entry]),
        );
        const resultIdentities = new Set<string>();
        for (const result of execution.results) {
            const identity = `${result?.domainId}/${result?.docId}`;
            const entry = ready.get(identity);
            if (
                !entry ||
                result.pid !== entry.pid ||
                !['applied', 'no-op', 'stale'].includes(result.status) ||
                typeof result.reason !== 'string' ||
                !SHA256.test(result.observedStateFingerprint) ||
                typeof result.at !== 'string' ||
                resultIdentities.has(identity)
            ) {
                throw new ProblemTagBackfillError(`execution result is invalid: ${identity}`, 'PROBLEM_TAG_BACKFILL_REPORT_INVALID');
            }
            resultIdentities.add(identity);
        }
        if (execution.state === 'applied' && resultIdentities.size !== ready.size) {
            throw new ProblemTagBackfillError('completed execution is missing ready results', 'PROBLEM_TAG_BACKFILL_REPORT_INVALID');
        }
    }
    if (report.verification) {
        const verification = report.verification;
        const expectedIdentities = new Set(['*/0', ...report.entries.map((entry) => `${entry.domainId}/${entry.docId}`)]);
        const verificationIdentities = new Set<string>();
        if (
            typeof verification.verifiedAt !== 'string' ||
            Number.isNaN(Date.parse(verification.verifiedAt)) ||
            typeof verification.ok !== 'boolean' ||
            !Array.isArray(verification.items)
        ) {
            throw new ProblemTagBackfillError('verification report is invalid', 'PROBLEM_TAG_BACKFILL_REPORT_INVALID');
        }
        for (const item of verification.items) {
            const identity = `${item?.domainId}/${item?.docId}`;
            if (
                !expectedIdentities.has(identity) ||
                verificationIdentities.has(identity) ||
                typeof item.pid !== 'string' ||
                typeof item.ok !== 'boolean' ||
                typeof item.state !== 'string' ||
                typeof item.reason !== 'string' ||
                (item.currentStateFingerprint !== undefined && !SHA256.test(item.currentStateFingerprint))
            ) {
                throw new ProblemTagBackfillError(`verification item is invalid: ${identity}`, 'PROBLEM_TAG_BACKFILL_REPORT_INVALID');
            }
            verificationIdentities.add(identity);
        }
        if (verificationIdentities.size !== expectedIdentities.size || verification.ok !== verification.items.every((item) => item.ok)) {
            throw new ProblemTagBackfillError('verification report is incomplete or inconsistent', 'PROBLEM_TAG_BACKFILL_REPORT_INVALID');
        }
    }
    if (!Array.isArray(report.outcomeGroups) || !isDeepStrictEqual(report.outcomeGroups, problemTagBackfillOutcomeGroups(report))) {
        throw new ProblemTagBackfillError('report outcome groups are missing or inconsistent', 'PROBLEM_TAG_BACKFILL_REPORT_INVALID');
    }
    return report;
}

export async function readProblemTagBackfillReport(filename: string): Promise<ProblemTagBackfillReport> {
    let raw: unknown;
    try {
        raw = JSON.parse(await fs.readFile(filename, 'utf8'));
    } catch (error) {
        throw new ProblemTagBackfillError(
            'cannot read or parse tag backfill report',
            'PROBLEM_TAG_BACKFILL_REPORT_INVALID',
            { filename },
            { cause: error },
        );
    }
    return assertProblemTagBackfillReport(raw);
}

function upsertExecutionResult(execution: ProblemTagBackfillExecution, result: ProblemTagBackfillExecutionResult): void {
    execution.results = execution.results.filter((item) => item.domainId !== result.domainId || item.docId !== result.docId);
    execution.results.push(result);
    execution.results.sort((left, right) => left.domainId.localeCompare(right.domainId) || left.docId - right.docId);
    execution.updatedAt = result.at;
}

export async function applyProblemTagBackfill(input: {
    report: ProblemTagBackfillReport;
    adapter: ProblemTagBackfillRuntimeAdapter;
    actor: number;
    fingerprint: string;
    confirmationToken: string;
    persistReport: (report: ProblemTagBackfillReport) => Promise<void>;
    now?: () => Date;
}) {
    const report = assertProblemTagBackfillReport(input.report);
    const persistReport = async () => {
        refreshProblemTagBackfillOutcomeGroups(report);
        await input.persistReport(report);
    };
    if (!Number.isSafeInteger(input.actor) || input.actor < 1) {
        throw new ProblemTagBackfillError('actor must be a positive integer', 'PROBLEM_TAG_BACKFILL_CONFIRMATION_REQUIRED');
    }
    if (input.fingerprint !== report.fingerprint || input.confirmationToken !== report.confirmationToken) {
        throw new ProblemTagBackfillError(
            'apply fingerprint or confirmation token does not match the report',
            'PROBLEM_TAG_BACKFILL_CONFIRMATION_REQUIRED',
        );
    }
    if (
        report.execution &&
        ['applying', 'failed'].includes(report.execution.state) &&
        (!report.verification || Date.parse(report.verification.verifiedAt) < Date.parse(report.execution.updatedAt))
    ) {
        throw new ProblemTagBackfillError(
            'interrupted or failed execution must be verified before recovery apply',
            'PROBLEM_TAG_BACKFILL_RECOVERY_VERIFY_REQUIRED',
        );
    }
    await input.adapter.prepareActor(input.actor, report.entries);
    const now = input.now || (() => new Date());
    const startedAt = now().toISOString();
    const execution = report.execution || {
        planFingerprint: report.fingerprint,
        actor: input.actor,
        state: 'applying' as const,
        startedAt,
        updatedAt: startedAt,
        results: [],
    };
    if (execution.actor !== input.actor || execution.planFingerprint !== report.fingerprint) {
        throw new ProblemTagBackfillError('execution actor or plan fingerprint changed', 'PROBLEM_TAG_BACKFILL_CONFIRMATION_REQUIRED');
    }
    execution.state = 'applying';
    delete execution.lastError;
    delete report.verification;
    report.execution = execution;
    await persistReport();
    try {
        for (const entry of report.entries.filter((candidate) => candidate.decision === 'ready')) {
            let result: ProblemTagBackfillApplyResult;
            if ((await input.adapter.loadMindmapFingerprint()) !== report.mindmapFingerprint) {
                result = {
                    status: 'stale',
                    reason: 'global-mindmap-drift',
                    observedStateFingerprint: await input.adapter.inspectEntryStateFingerprint(entry),
                };
            } else {
                result = await input.adapter.applyReady(entry, input.actor, report.fingerprint);
            }
            const at = now().toISOString();
            upsertExecutionResult(execution, {
                domainId: entry.domainId,
                docId: entry.docId,
                pid: entry.pid,
                ...result,
                at,
            });
            await persistReport();
        }
        execution.state = 'applied';
        execution.updatedAt = now().toISOString();
        await persistReport();
    } catch (error) {
        execution.state = 'failed';
        execution.updatedAt = now().toISOString();
        execution.lastError = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
        await persistReport();
        throw error;
    }
    return problemTagBackfillSummary(report);
}

export async function verifyProblemTagBackfill(input: {
    report: ProblemTagBackfillReport;
    adapter: ProblemTagBackfillRuntimeAdapter;
    persistReport: (report: ProblemTagBackfillReport) => Promise<void>;
    now?: Date;
}) {
    const report = assertProblemTagBackfillReport(input.report);
    const executionByIdentity = new Map((report.execution?.results || []).map((result) => [`${result.domainId}/${result.docId}`, result]));
    const currentMindmapFingerprint = await input.adapter.loadMindmapFingerprint();
    const items: ProblemTagBackfillVerificationItem[] = [
        {
            domainId: '*',
            docId: 0,
            pid: 'MINDMAP',
            ok: currentMindmapFingerprint === report.mindmapFingerprint,
            state: 'mindmap',
            reason: currentMindmapFingerprint === report.mindmapFingerprint ? 'mindmap-fingerprint-matched' : 'mindmap-fingerprint-drift',
        },
    ];
    for (const entry of report.entries) {
        items.push(
            await input.adapter.verifyEntry(
                entry,
                executionByIdentity.get(`${entry.domainId}/${entry.docId}`),
                report.fingerprint,
                report.execution?.actor,
            ),
        );
    }
    const verification: ProblemTagBackfillVerification = {
        verifiedAt: (input.now || new Date()).toISOString(),
        ok: items.every((item) => item.ok),
        items,
    };
    report.verification = verification;
    refreshProblemTagBackfillOutcomeGroups(report);
    await input.persistReport(report);
    if (!verification.ok) {
        throw new ProblemTagBackfillError(
            'tag backfill verification found mismatched production facts',
            'PROBLEM_TAG_BACKFILL_VERIFY_FAILED',
            items.filter((item) => !item.ok),
        );
    }
    return problemTagBackfillSummary(report);
}

export function problemTagBackfillSummary(report: ProblemTagBackfillReport) {
    const decisions = { ready: 0, 'already-canonical': 0, skipped: 0 };
    for (const entry of report.entries) decisions[entry.decision]++;
    const execution = { applied: 0, 'no-op': 0, stale: 0 };
    for (const result of report.execution?.results || []) execution[result.status]++;
    return {
        fingerprint: report.fingerprint,
        confirmationToken: report.confirmationToken,
        total: report.entries.length,
        decisions,
        execution,
        executionState: report.execution?.state || 'not-started',
        verificationOk: report.verification?.ok,
    };
}

function markdownCell(value: unknown): string {
    return String(value ?? '')
        .replace(/\|/g, '\\|')
        .replace(/\r?\n/g, ' ');
}

export function renderProblemTagBackfillMarkdown(report: ProblemTagBackfillReport): string {
    const summary = problemTagBackfillSummary(report);
    const lines = [
        '# Programming Problem Tag Backfill',
        '',
        `- Plan fingerprint: \`${report.fingerprint}\``,
        `- Mindmap fingerprint: \`${report.mindmapFingerprint}\``,
        `- Generated at: ${report.generatedAt}`,
        `- Ready: ${summary.decisions.ready}`,
        `- Already canonical: ${summary.decisions['already-canonical']}`,
        `- Skipped: ${summary.decisions.skipped}`,
        `- Execution: ${summary.executionState} (applied ${summary.execution.applied}, no-op ${summary.execution['no-op']}, stale ${summary.execution.stale})`,
        `- Verification: ${summary.verificationOk === undefined ? 'not run' : summary.verificationOk ? 'passed' : 'failed'}`,
        '',
    ];
    for (const group of report.outcomeGroups) {
        lines.push(
            `## ${group.state} / ${group.reason} (${group.entries.length})`,
            '',
            '| PID | Title | State | Old tags | Unknown / ambiguous |',
            '| --- | --- | --- | --- | --- |',
        );
        for (const entry of group.entries) {
            const oldTags = Array.isArray(entry.oldTags) ? entry.oldTags.join(', ') : JSON.stringify(entry.oldTags);
            const issues = [
                ...entry.unknownTags,
                ...entry.ambiguousTags.map((item) => `${item.tag} => ${item.candidates.join(' / ')}`),
                ...(entry.detail ? [entry.detail] : []),
            ];
            lines.push(
                `| ${markdownCell(entry.pid)} | ${markdownCell(entry.title)} | ${entry.state} | ${markdownCell(oldTags)} | ${markdownCell(issues.join('; '))} |`,
            );
        }
        lines.push('');
    }
    if (report.verification) {
        lines.push('## Verification', '', '| PID | OK | State | Reason |', '| --- | --- | --- | --- |');
        for (const item of report.verification.items) {
            lines.push(`| ${markdownCell(item.pid)} | ${item.ok ? 'yes' : 'no'} | ${markdownCell(item.state)} | ${markdownCell(item.reason)} |`);
        }
        lines.push('');
    }
    return `${lines.join('\n')}\n`;
}
