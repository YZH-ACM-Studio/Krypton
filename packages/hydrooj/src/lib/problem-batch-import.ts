import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import yaml from 'js-yaml';
import {
    assertProgrammingStatementComplete,
    compileProgrammingStatement,
    normalizeProgrammingStatement,
    type ProgrammingStatement,
} from './programming-statement';

const SHA256 = /^[a-f0-9]{64}$/;
const BATCH_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/;
const SOURCE_CODE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/;
const OBJECT_ID = /^[a-f0-9]{24}$/i;
const SAFE_FILENAME = /^[^/\\\0]+$/;

export interface ProblemBatchManifest {
    schemaVersion: 1 | 2;
    batchId: string;
    domain: string;
    actor: number;
    /** Omitted manifests retain the v1 public-finalization behavior. */
    visibility?: 'public' | 'hidden';
    source: {
        template: string;
        year: number;
        round?: number;
        season?: string;
        level?: string;
    };
    author: { uid: number; username: string };
    training: {
        id: string;
        title: string;
        chapterTitle: string;
        /** Historical backfill only: reuse this exact chapter instead of creating a new front chapter. */
        chapterId?: number;
        /** Exact current members that the approved apply will replace. */
        replacePids?: number[];
    };
    selection:
        | { field: 'accepted'; operator: '>' | '>=' | '='; value: number; source: string }
        | { field: 'sourceProblemCode'; operator: 'in'; value: string[]; source: string };
    problems: ProblemBatchManifestEntry[];
}

export interface ProblemBatchManifestEntry {
    sourceProblemCode: string;
    title: string;
    difficulty: number;
    /** Overrides the batch default for this problem only. */
    visibility?: 'public' | 'hidden';
    mindmapNodeIds: string[];
    origStat?: { accepted: number; submitted: number };
    statement: string;
    /** Required by schemaVersion 2; canonical structured-v1 source. */
    programmingStatement?: string;
    assets: Array<{ source: string; target: string }>;
    testdata: {
        directory: string;
        files: string[];
        config: string;
        checker: string | null;
        cases: Array<{ input: string; output: string }>;
    };
    ambiguities?: Array<{ field: string; message: string; confirmed: boolean }>;
}

export interface ValidatedBatchFile {
    name: string;
    path: string;
    size: number;
    sha256: string;
}

export interface ValidatedProblemBatchEntry extends ProblemBatchManifestEntry {
    fingerprint: string;
    statementFile: ValidatedBatchFile;
    programmingStatementFile?: ValidatedBatchFile;
    canonicalStatement?: ProgrammingStatement;
    assetFiles: Array<ValidatedBatchFile & { target: string }>;
    testdataFiles: ValidatedBatchFile[];
    configFile: ValidatedBatchFile;
}

export interface ValidatedProblemBatch {
    manifestPath: string;
    rootDir: string;
    manifest: ProblemBatchManifest;
    fingerprint: string;
    problems: ValidatedProblemBatchEntry[];
    totalCases: number;
}

export interface ProblemBatchPreflightProblem {
    sourceProblemCode: string;
    fingerprint: string;
    pid: string;
    knowledgeMapId: string;
    state: 'new' | 'draft' | 'published';
    docId?: number;
}

export interface ProblemBatchProductionFacts {
    domain: string;
    actor: { uid: number; username: string };
    author: { uid: number; username: string };
    counter: { namespace: string; value: number };
    training: {
        id: string;
        title: string;
        chapterId: number;
        chapterTitle: string;
        chapterState: 'missing' | 'existing';
        chapterMode: 'create-front' | 'replace-existing';
        chapterPosition: number;
        currentMaxChapterId: number;
        nonTargetDagFingerprint: string;
        targetPids: number[];
        replacePids: number[];
    };
    knowledgeMaps: Array<{ id: string; title: string }>;
    mindmapNodes: Array<{ id: string; mapId: string; topic: string; tags: string[] }>;
    problems: ProblemBatchPreflightProblem[];
    suspectedDuplicates: Array<{ sourceProblemCode: string; docId: number; pid: string; title: string }>;
}

export interface ProblemBatchImportPlan {
    schemaVersion: 1;
    batchId: string;
    localFingerprint: string;
    confirmationToken: string;
    createdAt: string;
    facts: ProblemBatchProductionFacts;
    fingerprint: string;
}

export interface ProblemBatchProgressEvent {
    at?: string;
    stage: 'draft-created' | 'draft-ready' | 'training-ready' | 'publication-incomplete' | 'published' | 'verified';
    sourceProblemCode?: string;
    docId?: number;
    pid?: string;
    requestId?: string;
    incompleteStages?: string[];
    note?: string;
}

export interface ProblemBatchExecutionReport {
    schemaVersion: 1;
    batchId: string;
    planFingerprint: string;
    actor: number;
    startedAt: string;
    updatedAt: string;
    state: 'applying' | 'applied' | 'verified' | 'failed';
    events: ProblemBatchProgressEvent[];
    error?: string;
}

export interface ProblemBatchVerifyResult {
    ok: true;
    batchId: string;
    problems: Array<{
        sourceProblemCode: string;
        docId: number;
        pid: string;
        hidden: boolean;
        metadataStatus: string;
        testdataFiles: number;
        cases: number;
        assets: number;
    }>;
    training: { id: string; chapterId: number; chapterTitle: string; pids: number[] };
}

export interface ProblemBatchImportAdapter {
    preflight(batch: ValidatedProblemBatch): Promise<ProblemBatchProductionFacts>;
    apply(
        batch: ValidatedProblemBatch,
        plan: ProblemBatchImportPlan,
        report: ProblemBatchExecutionReport,
        progress: (event: ProblemBatchProgressEvent) => Promise<void>,
    ): Promise<ProblemBatchVerifyResult>;
    verify(batch: ValidatedProblemBatch, plan: ProblemBatchImportPlan): Promise<ProblemBatchVerifyResult>;
}

export class ProblemBatchImportError extends Error {
    constructor(
        message: string,
        readonly code = 'BATCH_IMPORT_INVALID',
        readonly details?: unknown,
        options?: ErrorOptions,
    ) {
        super(message, options);
        this.name = 'ProblemBatchImportError';
    }
}

function invariant(condition: unknown, message: string, code = 'BATCH_IMPORT_INVALID', details?: unknown): asserts condition {
    if (!condition) throw new ProblemBatchImportError(message, code, details);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function assertKeys(value: Record<string, unknown>, allowed: readonly string[], field: string): void {
    const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
    invariant(!unknown.length, `${field} contains unsupported fields: ${unknown.join(', ')}`);
}

function integer(value: unknown, field: string, minimum: number, maximum = Number.MAX_SAFE_INTEGER): number {
    invariant(typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum && value <= maximum, `${field} must be an integer`);
    return value;
}

function nonEmptyString(value: unknown, field: string, maximum = 512): string {
    invariant(typeof value === 'string' && !!value.trim() && value.length <= maximum, `${field} must be non-empty text`);
    return value.trim();
}

function canonicalize(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(canonicalize);
    if (!isPlainObject(value)) return value;
    return Object.fromEntries(
        Object.keys(value)
            .sort()
            .map((key) => [key, canonicalize(value[key])]),
    );
}

export function canonicalJson(value: unknown): string {
    return JSON.stringify(canonicalize(value));
}

function countLiteralCjkUnicodeEscapes(value: unknown): number {
    if (typeof value === 'string') {
        return [...value.matchAll(/\\u([0-9a-fA-F]{4})/g)].filter((match) => {
            const codePoint = Number.parseInt(match[1], 16);
            return (
                (codePoint >= 0x3000 && codePoint <= 0x303f) ||
                (codePoint >= 0x3400 && codePoint <= 0x9fff) ||
                (codePoint >= 0xff00 && codePoint <= 0xffef)
            );
        }).length;
    }
    if (Array.isArray(value)) return value.reduce((count, item) => count + countLiteralCjkUnicodeEscapes(item), 0);
    if (isPlainObject(value)) {
        return Object.values(value).reduce((count, item) => count + countLiteralCjkUnicodeEscapes(item), 0);
    }
    return 0;
}

export function sha256(value: string | Buffer): string {
    return createHash('sha256').update(value).digest('hex');
}

async function sha256File(filename: string): Promise<string> {
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(filename)) hash.update(chunk as Buffer);
    return hash.digest('hex');
}

async function resolveBatchPath(rootDir: string, relativePath: unknown, field: string): Promise<string> {
    const input = nonEmptyString(relativePath, field, 1024);
    invariant(!path.isAbsolute(input) && !input.includes('\\'), `${field} must be a portable relative path`);
    const resolved = path.resolve(rootDir, input);
    invariant(resolved.startsWith(`${rootDir}${path.sep}`), `${field} escapes the batch directory`);
    let realPath: string;
    try {
        realPath = await fs.realpath(resolved);
    } catch (error) {
        throw new ProblemBatchImportError(`${field} is missing`, 'BATCH_IMPORT_FILE_MISSING', { path: resolved }, { cause: error });
    }
    invariant(realPath.startsWith(`${rootDir}${path.sep}`), `${field} resolves outside the batch directory`, 'BATCH_IMPORT_FILE_INVALID', {
        path: resolved,
        realPath,
    });
    return realPath;
}

async function inspectFile(filename: string, name: string, allowEmpty: boolean): Promise<ValidatedBatchFile> {
    let stat;
    try {
        stat = await fs.stat(filename);
    } catch (error) {
        throw new ProblemBatchImportError(`${name} is missing`, 'BATCH_IMPORT_FILE_MISSING', { path: filename }, { cause: error });
    }
    invariant(stat.isFile(), `${name} is not a regular file`, 'BATCH_IMPORT_FILE_INVALID', { path: filename });
    invariant(allowEmpty || stat.size > 0, `${name} is empty`, 'BATCH_IMPORT_FILE_INVALID', { path: filename });
    return { name, path: filename, size: stat.size, sha256: await sha256File(filename) };
}

function safeFilename(value: unknown, field: string): string {
    const filename = nonEmptyString(value, field, 255);
    invariant(SAFE_FILENAME.test(filename) && filename !== '.' && filename !== '..', `${field} must be one safe filename`);
    return filename;
}

function sampleIds(statement: string, kind: 'input' | 'output'): string[] {
    const fence = '```';
    return [...statement.matchAll(new RegExp(`${fence}${kind}(\\d+)\\r?\\n[\\s\\S]*?\\r?\\n${fence}`, 'g'))].map((match) => match[1]);
}

function selectionMatches(entry: ProblemBatchManifestEntry, selection: ProblemBatchManifest['selection']): boolean {
    if (selection.field === 'sourceProblemCode') return selection.value.includes(entry.sourceProblemCode);
    if (!entry.origStat) return false;
    const actual = entry.origStat.accepted;
    if (selection.operator === '>') return actual > selection.value;
    if (selection.operator === '>=') return actual >= selection.value;
    return actual === selection.value;
}

function normalizeManifest(raw: unknown): ProblemBatchManifest {
    invariant(isPlainObject(raw), 'batch.json must contain one object');
    assertKeys(raw, ['schemaVersion', 'batchId', 'domain', 'actor', 'visibility', 'source', 'author', 'training', 'selection', 'problems'], 'batch');
    invariant(raw.schemaVersion === 1 || raw.schemaVersion === 2, 'schemaVersion must be 1 or 2');
    const schemaVersion = raw.schemaVersion;
    const batchId = nonEmptyString(raw.batchId, 'batchId', 96);
    invariant(BATCH_ID.test(batchId), 'batchId contains unsupported characters');
    const domain = nonEmptyString(raw.domain, 'domain', 64);
    const actor = integer(raw.actor, 'actor', 1);
    let visibility: ProblemBatchManifest['visibility'];
    if (raw.visibility !== undefined) {
        invariant(raw.visibility === 'public' || raw.visibility === 'hidden', 'visibility must be public or hidden');
        visibility = raw.visibility;
    }

    invariant(isPlainObject(raw.source), 'source must be an object');
    assertKeys(raw.source, ['template', 'year', 'round', 'season', 'level'], 'source');
    const source: ProblemBatchManifest['source'] = {
        template: nonEmptyString(raw.source.template, 'source.template', 64),
        year: integer(raw.source.year, 'source.year', 2000, 2100),
    };
    if (raw.source.round !== undefined) source.round = integer(raw.source.round, 'source.round', 1, 99);
    if (raw.source.season !== undefined) source.season = nonEmptyString(raw.source.season, 'source.season', 16);
    if (raw.source.level !== undefined) source.level = nonEmptyString(raw.source.level, 'source.level', 16);

    invariant(isPlainObject(raw.author), 'author must be an object');
    assertKeys(raw.author, ['uid', 'username'], 'author');
    const author = {
        uid: integer(raw.author.uid, 'author.uid', 1),
        username: nonEmptyString(raw.author.username, 'author.username', 64),
    };

    invariant(isPlainObject(raw.training), 'training must be an object');
    assertKeys(raw.training, ['id', 'title', 'chapterTitle', 'chapterId', 'replacePids'], 'training');
    const training: ProblemBatchManifest['training'] = {
        id: nonEmptyString(raw.training.id, 'training.id', 24),
        title: nonEmptyString(raw.training.title, 'training.title', 128),
        chapterTitle: nonEmptyString(raw.training.chapterTitle, 'training.chapterTitle', 128),
    };
    invariant(OBJECT_ID.test(training.id), 'training.id must be one ObjectId');
    const hasChapterId = raw.training.chapterId !== undefined;
    const hasReplacePids = raw.training.replacePids !== undefined;
    invariant(hasChapterId === hasReplacePids, 'training.chapterId and training.replacePids must be provided together');
    if (hasChapterId) {
        training.chapterId = integer(raw.training.chapterId, 'training.chapterId', 1);
        invariant(Array.isArray(raw.training.replacePids), 'training.replacePids must be an array');
        invariant(raw.training.replacePids.length > 0, 'training.replacePids must be non-empty');
        training.replacePids = raw.training.replacePids.map((pid, index) => integer(pid, `training.replacePids[${index}]`, 1));
        invariant(new Set(training.replacePids).size === training.replacePids.length, 'training.replacePids contains duplicates');
    }

    invariant(isPlainObject(raw.selection), 'selection must be an object');
    assertKeys(raw.selection, ['field', 'operator', 'value', 'source'], 'selection');
    let selection: ProblemBatchManifest['selection'];
    if (raw.selection.field === 'accepted') {
        invariant(['>', '>=', '='].includes(String(raw.selection.operator)), 'selection.operator is unsupported');
        selection = {
            field: 'accepted',
            operator: raw.selection.operator as '>' | '>=' | '=',
            value: integer(raw.selection.value, 'selection.value', 0),
            source: nonEmptyString(raw.selection.source, 'selection.source', 512),
        };
    } else {
        invariant(raw.selection.field === 'sourceProblemCode', 'selection.field is unsupported');
        invariant(raw.selection.operator === 'in', 'selection.operator is unsupported');
        invariant(Array.isArray(raw.selection.value) && raw.selection.value.length > 0, 'selection.value must be a non-empty array');
        const value = raw.selection.value.map((code, index) => {
            const normalized = nonEmptyString(code, `selection.value[${index}]`, 32);
            invariant(SOURCE_CODE.test(normalized), `selection.value[${index}] contains unsupported characters`);
            return normalized;
        });
        invariant(new Set(value).size === value.length, 'selection.value contains duplicates');
        selection = {
            field: 'sourceProblemCode',
            operator: 'in',
            value,
            source: nonEmptyString(raw.selection.source, 'selection.source', 512),
        };
    }

    invariant(Array.isArray(raw.problems) && raw.problems.length > 0, 'problems must be a non-empty array');
    const seenCodes = new Set<string>();
    const problems = raw.problems.map((candidate, index): ProblemBatchManifestEntry => {
        const field = `problems[${index}]`;
        invariant(isPlainObject(candidate), `${field} must be an object`);
        assertKeys(
            candidate,
            [
                'sourceProblemCode',
                'title',
                'difficulty',
                'visibility',
                'mindmapNodeIds',
                'origStat',
                'statement',
                'programmingStatement',
                'assets',
                'testdata',
                'ambiguities',
            ],
            field,
        );
        const sourceProblemCode = nonEmptyString(candidate.sourceProblemCode, `${field}.sourceProblemCode`, 32);
        invariant(SOURCE_CODE.test(sourceProblemCode), `${field}.sourceProblemCode contains unsupported characters`);
        invariant(!seenCodes.has(sourceProblemCode), `duplicate sourceProblemCode: ${sourceProblemCode}`);
        seenCodes.add(sourceProblemCode);
        let problemVisibility: ProblemBatchManifestEntry['visibility'];
        if (candidate.visibility !== undefined) {
            invariant(candidate.visibility === 'public' || candidate.visibility === 'hidden', `${field}.visibility must be public or hidden`);
            problemVisibility = candidate.visibility;
        }
        invariant(Array.isArray(candidate.mindmapNodeIds) && candidate.mindmapNodeIds.length > 0, `${field}.mindmapNodeIds must be non-empty`);
        const mindmapNodeIds = [
            ...new Set(
                candidate.mindmapNodeIds.map((id, nodeIndex) => {
                    const normalized = nonEmptyString(id, `${field}.mindmapNodeIds[${nodeIndex}]`, 24);
                    invariant(OBJECT_ID.test(normalized), `${field}.mindmapNodeIds[${nodeIndex}] must be an ObjectId`);
                    return normalized.toLowerCase();
                }),
            ),
        ].sort();
        let origStat: ProblemBatchManifestEntry['origStat'];
        if (candidate.origStat !== undefined) {
            invariant(isPlainObject(candidate.origStat), `${field}.origStat must be an object`);
            assertKeys(candidate.origStat, ['accepted', 'submitted'], `${field}.origStat`);
            origStat = {
                accepted: integer(candidate.origStat.accepted, `${field}.origStat.accepted`, 0),
                submitted: integer(candidate.origStat.submitted, `${field}.origStat.submitted`, 0),
            };
            invariant(origStat.accepted <= origStat.submitted, `${field}.origStat accepted exceeds submitted`);
        }

        invariant(Array.isArray(candidate.assets), `${field}.assets must be an array`);
        const assetTargets = new Set<string>();
        const assets = candidate.assets.map((asset, assetIndex) => {
            invariant(isPlainObject(asset), `${field}.assets[${assetIndex}] must be an object`);
            assertKeys(asset, ['source', 'target'], `${field}.assets[${assetIndex}]`);
            const target = safeFilename(asset.target, `${field}.assets[${assetIndex}].target`);
            invariant(!assetTargets.has(target), `${field} has duplicate asset target ${target}`);
            assetTargets.add(target);
            return { source: nonEmptyString(asset.source, `${field}.assets[${assetIndex}].source`, 1024), target };
        });

        invariant(isPlainObject(candidate.testdata), `${field}.testdata must be an object`);
        assertKeys(candidate.testdata, ['directory', 'files', 'config', 'checker', 'cases'], `${field}.testdata`);
        invariant(Array.isArray(candidate.testdata.files), `${field}.testdata.files must be an array`);
        const files = candidate.testdata.files.map((name, fileIndex) => safeFilename(name, `${field}.testdata.files[${fileIndex}]`));
        invariant(new Set(files).size === files.length, `${field}.testdata.files contains duplicates`);
        invariant(!files.includes('config.yaml'), `${field}.testdata.files cannot use reserved name config.yaml`);
        invariant(Array.isArray(candidate.testdata.cases) && candidate.testdata.cases.length > 0, `${field}.testdata.cases must be non-empty`);
        const cases = candidate.testdata.cases.map((testcase, caseIndex) => {
            invariant(isPlainObject(testcase), `${field}.testdata.cases[${caseIndex}] must be an object`);
            assertKeys(testcase, ['input', 'output'], `${field}.testdata.cases[${caseIndex}]`);
            return {
                input: safeFilename(testcase.input, `${field}.testdata.cases[${caseIndex}].input`),
                output: safeFilename(testcase.output, `${field}.testdata.cases[${caseIndex}].output`),
            };
        });
        const checker = candidate.testdata.checker === null ? null : safeFilename(candidate.testdata.checker, `${field}.testdata.checker`);
        const ambiguities =
            candidate.ambiguities === undefined
                ? undefined
                : (() => {
                      invariant(Array.isArray(candidate.ambiguities), `${field}.ambiguities must be an array`);
                      return candidate.ambiguities.map((ambiguity, ambiguityIndex) => {
                          invariant(isPlainObject(ambiguity), `${field}.ambiguities[${ambiguityIndex}] must be an object`);
                          assertKeys(ambiguity, ['field', 'message', 'confirmed'], `${field}.ambiguities[${ambiguityIndex}]`);
                          invariant(typeof ambiguity.confirmed === 'boolean', `${field}.ambiguities[${ambiguityIndex}].confirmed must be boolean`);
                          return {
                              field: nonEmptyString(ambiguity.field, `${field}.ambiguities[${ambiguityIndex}].field`, 128),
                              message: nonEmptyString(ambiguity.message, `${field}.ambiguities[${ambiguityIndex}].message`, 1024),
                              confirmed: ambiguity.confirmed,
                          };
                      });
                  })();
        const entry: ProblemBatchManifestEntry = {
            sourceProblemCode,
            title: nonEmptyString(candidate.title, `${field}.title`, 256),
            difficulty: integer(candidate.difficulty, `${field}.difficulty`, 1, 10),
            ...(problemVisibility ? { visibility: problemVisibility } : {}),
            mindmapNodeIds,
            ...(origStat ? { origStat } : {}),
            statement: nonEmptyString(candidate.statement, `${field}.statement`, 1024),
            ...(schemaVersion === 2
                ? { programmingStatement: nonEmptyString(candidate.programmingStatement, `${field}.programmingStatement`, 1024) }
                : {}),
            assets,
            testdata: {
                directory: nonEmptyString(candidate.testdata.directory, `${field}.testdata.directory`, 1024),
                files,
                config: nonEmptyString(candidate.testdata.config, `${field}.testdata.config`, 1024),
                checker,
                cases,
            },
            ...(ambiguities ? { ambiguities } : {}),
        };
        if (schemaVersion === 1 && candidate.programmingStatement !== undefined) {
            invariant(false, `${field}.programmingStatement requires schemaVersion 2`);
        }
        invariant(selectionMatches(entry, selection), `${field} does not satisfy the declared selection rule`);
        return entry;
    });

    if (selection.field === 'sourceProblemCode') {
        const selected = [...selection.value].sort();
        const declared = problems.map((problem) => problem.sourceProblemCode).sort();
        invariant(canonicalJson(selected) === canonicalJson(declared), 'selection.value must exactly match the declared problem codes');
    }

    return {
        schemaVersion,
        batchId,
        domain,
        actor,
        ...(visibility ? { visibility } : {}),
        source,
        author,
        training,
        selection,
        problems,
    };
}

export function problemBatchFinalHidden(manifest: ProblemBatchManifest, entry?: ProblemBatchManifestEntry): boolean {
    return (entry?.visibility || manifest.visibility) === 'hidden';
}

export async function validateProblemBatchManifest(manifestPathInput: string): Promise<ValidatedProblemBatch> {
    const requestedManifestPath = path.resolve(manifestPathInput);
    let manifestPath: string;
    let raw: unknown;
    try {
        manifestPath = await fs.realpath(requestedManifestPath);
        raw = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    } catch (error) {
        throw new ProblemBatchImportError(
            'cannot read or parse batch manifest',
            'BATCH_IMPORT_MANIFEST_INVALID',
            { manifestPath: requestedManifestPath },
            { cause: error },
        );
    }
    const rootDir = path.dirname(manifestPath);
    const manifest = normalizeManifest(raw);
    const validatedProblems: ValidatedProblemBatchEntry[] = [];
    for (const entry of manifest.problems) {
        const prefix = `${manifest.batchId}/${entry.sourceProblemCode}`;
        const statementPath = await resolveBatchPath(rootDir, entry.statement, `${prefix}.statement`);
        const statementFile = await inspectFile(statementPath, `${prefix}.statement`, false);
        const statement = await fs.readFile(statementPath, 'utf8');
        invariant(!!statement.trim(), `${prefix}.statement is blank`);
        let programmingStatementFile: ValidatedBatchFile | undefined;
        let canonicalStatement: ProgrammingStatement | undefined;
        if (manifest.schemaVersion === 2) {
            const canonicalPath = await resolveBatchPath(rootDir, entry.programmingStatement!, `${prefix}.programmingStatement`);
            programmingStatementFile = await inspectFile(canonicalPath, `${prefix}.programmingStatement`, false);
            let canonicalInput: unknown;
            try {
                canonicalInput = JSON.parse(await fs.readFile(canonicalPath, 'utf8'));
            } catch (error) {
                throw new ProblemBatchImportError(`${prefix}.programmingStatement is not valid JSON`, 'BATCH_IMPORT_STATEMENT_INVALID', undefined, {
                    cause: error,
                });
            }
            try {
                canonicalStatement = normalizeProgrammingStatement(canonicalInput);
            } catch (error) {
                throw new ProblemBatchImportError(`${prefix}.programmingStatement is invalid`, 'BATCH_IMPORT_STATEMENT_INVALID', undefined, {
                    cause: error as Error,
                });
            }
            invariant(
                countLiteralCjkUnicodeEscapes(canonicalStatement) === 0,
                `${prefix}.programmingStatement contains literal CJK Unicode escapes; regenerate it with the supported Node runtime`,
                'BATCH_IMPORT_STATEMENT_INVALID',
            );
            invariant(
                compileProgrammingStatement(canonicalStatement) === statement,
                `${prefix}.statement differs from its canonical programming statement`,
                'BATCH_IMPORT_STATEMENT_INVALID',
            );
        }
        const inputs = sampleIds(statement, 'input').sort();
        const outputs = sampleIds(statement, 'output').sort();
        invariant(
            (manifest.schemaVersion === 2 || inputs.length > 0) && canonicalJson(inputs) === canonicalJson(outputs),
            `${prefix}.statement has invalid Hydro inputN/outputN samples`,
        );

        const referencedAssets = [...statement.matchAll(/file:\/\/([^\s)]+)/g)].map((match) => match[1]).sort();
        const declaredAssets = entry.assets.map((asset) => asset.target).sort();
        invariant(canonicalJson(referencedAssets) === canonicalJson(declaredAssets), `${prefix}.statement asset references do not match assets`);
        const assetFiles = [] as ValidatedProblemBatchEntry['assetFiles'];
        for (const asset of entry.assets) {
            const source = await resolveBatchPath(rootDir, asset.source, `${prefix}.assets.${asset.target}`);
            assetFiles.push({ ...(await inspectFile(source, `${prefix}.assets.${asset.target}`, false)), target: asset.target });
        }

        const dataDir = await resolveBatchPath(rootDir, entry.testdata.directory, `${prefix}.testdata.directory`);
        let dataStat;
        try {
            dataStat = await fs.stat(dataDir);
        } catch (error) {
            throw new ProblemBatchImportError(
                `${prefix}.testdata.directory is missing`,
                'BATCH_IMPORT_FILE_MISSING',
                { path: dataDir },
                { cause: error },
            );
        }
        invariant(dataStat.isDirectory(), `${prefix}.testdata.directory is not a directory`);
        const actualFiles = (await fs.readdir(dataDir, { withFileTypes: true }))
            .filter((item) => item.isFile())
            .map((item) => item.name)
            .sort();
        invariant(canonicalJson(actualFiles) === canonicalJson([...entry.testdata.files].sort()), `${prefix}.testdata file list differs from disk`);
        const requiredFiles = new Set(entry.testdata.cases.flatMap((testcase) => [testcase.input, testcase.output]));
        if (entry.testdata.checker) requiredFiles.add(entry.testdata.checker);
        invariant(
            canonicalJson([...requiredFiles].sort()) === canonicalJson([...entry.testdata.files].sort()),
            `${prefix}.testdata.files must exactly cover cases and checker`,
        );
        const testdataFiles = [] as ValidatedBatchFile[];
        for (const filename of entry.testdata.files) {
            testdataFiles.push({
                ...(await inspectFile(path.resolve(dataDir, filename), `${prefix}.testdata.${filename}`, true)),
                name: filename,
            });
        }

        const configPath = await resolveBatchPath(rootDir, entry.testdata.config, `${prefix}.testdata.config`);
        const configFile = {
            ...(await inspectFile(configPath, `${prefix}.testdata.config`, false)),
            // Hydro's observer only treats this canonical storage name as judge configuration.
            name: 'config.yaml',
        };
        let config: any;
        try {
            config = yaml.load(await fs.readFile(configPath, 'utf8'));
        } catch (error) {
            throw new ProblemBatchImportError(`${prefix}.testdata.config is not valid YAML`, 'BATCH_IMPORT_CONFIG_INVALID', undefined, {
                cause: error,
            });
        }
        invariant(isPlainObject(config), `${prefix}.testdata.config must parse to an object`, 'BATCH_IMPORT_CONFIG_INVALID');
        if (canonicalStatement) {
            try {
                assertProgrammingStatementComplete(canonicalStatement, config);
            } catch (error) {
                throw new ProblemBatchImportError(`${prefix}.programmingStatement is incomplete`, 'BATCH_IMPORT_STATEMENT_INVALID', undefined, {
                    cause: error as Error,
                });
            }
        }
        invariant(canonicalJson(config.cases) === canonicalJson(entry.testdata.cases), `${prefix}.testdata.config cases differ from the manifest`);
        if (entry.testdata.checker) {
            invariant(config.checker === entry.testdata.checker, `${prefix}.testdata checker differs from config`);
            invariant(typeof config.checker_type === 'string' && !!config.checker_type, `${prefix}.testdata checker_type is missing`);
            if (config.checker_type === 'testlib') {
                const checkerSource = await fs.readFile(path.resolve(dataDir, entry.testdata.checker), 'utf8');
                const hasProcessMain = /\bint\s+main\s*\(\s*int\s+argc\s*,\s*char\s*(?:\*\s*argv\s*\[\s*\]|\*\s*\*\s*argv)\s*\)/.test(checkerSource);
                const forwardsProcessArguments = /\bregisterTestlibCmd\s*\(\s*argc\s*,\s*argv\s*\)/.test(checkerSource);
                invariant(
                    hasProcessMain && forwardsProcessArguments,
                    `${prefix}.testdata testlib checker must forward process argc/argv to registerTestlibCmd from main(int argc, char* argv[])`,
                    'BATCH_IMPORT_CONFIG_INVALID',
                );
            }
        } else {
            invariant(config.checker === undefined && config.checker_type === undefined, `${prefix}.testdata has an undeclared checker`);
        }

        const fingerprint = sha256(
            canonicalJson({
                sourceProblemCode: entry.sourceProblemCode,
                title: entry.title,
                difficulty: entry.difficulty,
                mindmapNodeIds: entry.mindmapNodeIds,
                origStat: entry.origStat,
                statement: { size: statementFile.size, sha256: statementFile.sha256 },
                ...(programmingStatementFile
                    ? {
                          programmingStatement: {
                              size: programmingStatementFile.size,
                              sha256: programmingStatementFile.sha256,
                          },
                      }
                    : {}),
                assets: assetFiles.map(({ target, size, sha256: digest }) => ({ target, size, sha256: digest })),
                testdata: {
                    files: testdataFiles.map(({ name, size, sha256: digest }) => ({ name, size, sha256: digest })),
                    config: { size: configFile.size, sha256: configFile.sha256 },
                    checker: entry.testdata.checker,
                    cases: entry.testdata.cases,
                },
                ambiguities: entry.ambiguities || [],
            }),
        );
        validatedProblems.push({
            ...entry,
            fingerprint,
            statementFile,
            ...(programmingStatementFile ? { programmingStatementFile } : {}),
            ...(canonicalStatement ? { canonicalStatement } : {}),
            assetFiles,
            testdataFiles,
            configFile,
        });
    }
    const fingerprint = sha256(
        canonicalJson({
            manifest,
            problems: validatedProblems.map((entry) => ({ sourceProblemCode: entry.sourceProblemCode, fingerprint: entry.fingerprint })),
        }),
    );
    return {
        manifestPath,
        rootDir,
        manifest,
        fingerprint,
        problems: validatedProblems,
        totalCases: validatedProblems.reduce((sum, entry) => sum + entry.testdata.cases.length, 0),
    };
}

function planFingerprint(plan: Omit<ProblemBatchImportPlan, 'fingerprint'>): string {
    return sha256(canonicalJson(plan));
}

export function assertProblemBatchPlan(plan: ProblemBatchImportPlan): void {
    invariant(isPlainObject(plan) && plan.schemaVersion === 1, 'preflight plan is invalid', 'BATCH_IMPORT_PLAN_INVALID');
    invariant(SHA256.test(plan.localFingerprint), 'preflight local fingerprint is invalid', 'BATCH_IMPORT_PLAN_INVALID');
    invariant(SHA256.test(plan.fingerprint), 'preflight fingerprint is invalid', 'BATCH_IMPORT_PLAN_INVALID');
    const { fingerprint, ...unsigned } = plan;
    invariant(planFingerprint(unsigned) === fingerprint, 'preflight plan fingerprint does not match its content', 'BATCH_IMPORT_PLAN_INVALID');
}

export async function preflightProblemBatchImport(batch: ValidatedProblemBatch, adapter: ProblemBatchImportAdapter): Promise<ProblemBatchImportPlan> {
    const facts = await adapter.preflight(batch);
    invariant(facts.domain === batch.manifest.domain, 'production domain differs from manifest', 'BATCH_IMPORT_PRODUCTION_DRIFT');
    invariant(facts.actor.uid === batch.manifest.actor, 'production actor differs from manifest', 'BATCH_IMPORT_PRODUCTION_DRIFT');
    invariant(facts.author.uid === batch.manifest.author.uid, 'production author differs from manifest', 'BATCH_IMPORT_PRODUCTION_DRIFT');
    invariant(
        !facts.suspectedDuplicates.length,
        'suspected legacy duplicates require an explicit user decision',
        'BATCH_IMPORT_DUPLICATE',
        facts.suspectedDuplicates,
    );
    invariant(
        facts.problems.length === batch.problems.length,
        'preflight problem plan length differs from manifest',
        'BATCH_IMPORT_PRODUCTION_DRIFT',
    );
    for (const entry of batch.problems) {
        const planned = facts.problems.find((candidate) => candidate.sourceProblemCode === entry.sourceProblemCode);
        invariant(planned, `preflight omitted ${entry.sourceProblemCode}`, 'BATCH_IMPORT_PRODUCTION_DRIFT');
        invariant(
            planned.fingerprint === entry.fingerprint,
            `${entry.sourceProblemCode}: production identity fingerprint conflicts`,
            'BATCH_IMPORT_IDENTITY_CONFLICT',
        );
    }
    const unsigned: Omit<ProblemBatchImportPlan, 'fingerprint'> = {
        schemaVersion: 1,
        batchId: batch.manifest.batchId,
        localFingerprint: batch.fingerprint,
        confirmationToken: `APPLY:${batch.manifest.batchId}`,
        createdAt: new Date().toISOString(),
        facts,
    };
    return { ...unsigned, fingerprint: planFingerprint(unsigned) };
}

export function createProblemBatchExecutionReport(plan: ProblemBatchImportPlan, actor: number): ProblemBatchExecutionReport {
    assertProblemBatchPlan(plan);
    const now = new Date().toISOString();
    return {
        schemaVersion: 1,
        batchId: plan.batchId,
        planFingerprint: plan.fingerprint,
        actor,
        startedAt: now,
        updatedAt: now,
        state: 'applying',
        events: [],
    };
}

export function assertProblemBatchExecutionReport(report: ProblemBatchExecutionReport, plan: ProblemBatchImportPlan, actor: number): void {
    invariant(
        report.schemaVersion === 1 && report.batchId === plan.batchId,
        'execution report belongs to another batch',
        'BATCH_IMPORT_REPORT_INVALID',
    );
    invariant(report.planFingerprint === plan.fingerprint, 'execution report belongs to another preflight plan', 'BATCH_IMPORT_REPORT_INVALID');
    invariant(report.actor === actor, 'execution report actor differs from this apply', 'BATCH_IMPORT_REPORT_INVALID');
}

function assertNoIncompletePublication(report: ProblemBatchExecutionReport): void {
    const incomplete = report.events.filter((event) => event.stage === 'publication-incomplete');
    invariant(
        !incomplete.length,
        'execution report contains an incomplete committed publication; repair its recorded stages before continuing',
        'BATCH_IMPORT_PUBLICATION_INCOMPLETE',
        incomplete,
    );
}

export async function applyProblemBatchImport(input: {
    batch: ValidatedProblemBatch;
    plan: ProblemBatchImportPlan;
    adapter: ProblemBatchImportAdapter;
    actor: number;
    fingerprint: string;
    confirmationToken: string;
    report: ProblemBatchExecutionReport;
    persistReport: (report: ProblemBatchExecutionReport) => Promise<void>;
}): Promise<ProblemBatchVerifyResult> {
    assertProblemBatchPlan(input.plan);
    invariant(
        input.batch.manifest.schemaVersion === 2,
        'schemaVersion 1 manifests are verify-only; create a structured schemaVersion 2 manifest for new apply',
        'BATCH_IMPORT_LEGACY_VERIFY_ONLY',
    );
    invariant(input.plan.batchId === input.batch.manifest.batchId, 'preflight plan belongs to another batch', 'BATCH_IMPORT_PLAN_INVALID');
    invariant(input.plan.localFingerprint === input.batch.fingerprint, 'local batch content changed after preflight', 'BATCH_IMPORT_LOCAL_DRIFT');
    invariant(input.fingerprint === input.plan.fingerprint, 'apply fingerprint does not match preflight', 'BATCH_IMPORT_CONFIRMATION_REQUIRED');
    invariant(input.confirmationToken === input.plan.confirmationToken, 'apply confirmation token is invalid', 'BATCH_IMPORT_CONFIRMATION_REQUIRED');
    invariant(input.actor === input.batch.manifest.actor, 'apply actor differs from manifest', 'BATCH_IMPORT_CONFIRMATION_REQUIRED');
    const unconfirmed = input.batch.problems.flatMap((entry) =>
        (entry.ambiguities || [])
            .filter((ambiguity) => !ambiguity.confirmed)
            .map((ambiguity) => ({ sourceProblemCode: entry.sourceProblemCode, ...ambiguity })),
    );
    invariant(!unconfirmed.length, 'apply refuses unconfirmed ambiguities', 'BATCH_IMPORT_AMBIGUITY', unconfirmed);
    assertProblemBatchExecutionReport(input.report, input.plan, input.actor);
    assertNoIncompletePublication(input.report);
    input.report.state = 'applying';
    delete input.report.error;
    input.report.updatedAt = new Date().toISOString();
    await input.persistReport(input.report);
    try {
        const result = await input.adapter.apply(input.batch, input.plan, input.report, async (event) => {
            input.report.events.push({ ...event, at: event.at || new Date().toISOString() });
            input.report.updatedAt = new Date().toISOString();
            await input.persistReport(input.report);
        });
        input.report.state = 'applied';
        input.report.updatedAt = new Date().toISOString();
        await input.persistReport(input.report);
        return result;
    } catch (error) {
        input.report.state = 'failed';
        input.report.error = error instanceof Error ? error.message : String(error);
        input.report.updatedAt = new Date().toISOString();
        await input.persistReport(input.report);
        throw error;
    }
}

export async function verifyProblemBatchImport(input: {
    batch: ValidatedProblemBatch;
    plan: ProblemBatchImportPlan;
    adapter: ProblemBatchImportAdapter;
    report?: ProblemBatchExecutionReport;
    persistReport?: (report: ProblemBatchExecutionReport) => Promise<void>;
}): Promise<ProblemBatchVerifyResult> {
    assertProblemBatchPlan(input.plan);
    invariant(input.plan.batchId === input.batch.manifest.batchId, 'preflight plan belongs to another batch', 'BATCH_IMPORT_PLAN_INVALID');
    invariant(input.plan.localFingerprint === input.batch.fingerprint, 'local batch content changed after preflight', 'BATCH_IMPORT_LOCAL_DRIFT');
    const result = await input.adapter.verify(input.batch, input.plan);
    if (input.report) {
        assertProblemBatchExecutionReport(input.report, input.plan, input.report.actor);
        assertNoIncompletePublication(input.report);
    }
    if (input.report && input.persistReport) {
        input.report.state = 'verified';
        input.report.events.push({ stage: 'verified', at: new Date().toISOString(), note: `${result.problems.length} problems` });
        input.report.updatedAt = new Date().toISOString();
        delete input.report.error;
        await input.persistReport(input.report);
    }
    return result;
}

export async function readProblemBatchPlan(filename: string): Promise<ProblemBatchImportPlan> {
    const plan = JSON.parse(await fs.readFile(filename, 'utf8')) as ProblemBatchImportPlan;
    assertProblemBatchPlan(plan);
    return plan;
}

export async function readProblemBatchExecutionReport(filename: string): Promise<ProblemBatchExecutionReport | null> {
    try {
        return JSON.parse(await fs.readFile(filename, 'utf8')) as ProblemBatchExecutionReport;
    } catch (error: any) {
        if (error?.code === 'ENOENT') return null;
        throw error;
    }
}

export async function writeJsonAtomic(filename: string, value: unknown): Promise<void> {
    const resolved = path.resolve(filename);
    await fs.mkdir(path.dirname(resolved), { recursive: true });
    const temporary = `${resolved}.tmp-${process.pid}`;
    await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    await fs.rename(temporary, resolved);
}

export function problemBatchValidationSummary(batch: ValidatedProblemBatch) {
    return {
        ok: true as const,
        stage: 'validate' as const,
        batchId: batch.manifest.batchId,
        visibility: batch.manifest.visibility || 'public',
        fingerprint: batch.fingerprint,
        problems: batch.problems.map((entry) => ({
            sourceProblemCode: entry.sourceProblemCode,
            title: entry.title,
            visibility: entry.visibility || batch.manifest.visibility || 'public',
            fingerprint: entry.fingerprint,
            cases: entry.testdata.cases.length,
            testdataFiles: entry.testdataFiles.length + 1,
            assets: entry.assetFiles.length,
            accepted: entry.origStat?.accepted ?? null,
            submitted: entry.origStat?.submitted ?? null,
            ambiguities: entry.ambiguities || [],
        })),
        totalCases: batch.totalCases,
    };
}
