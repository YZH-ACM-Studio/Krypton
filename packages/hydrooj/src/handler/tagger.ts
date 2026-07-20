/**
 * Problem Tagger — service-token-gated batch tag/title editor (OJ side).
 *
 * Powers the Rust + Iced desktop cleanup tool (ecosystems/KryptonTagger) and
 * the TypeScript DeepSeek auto-tagger (ecosystems/KryptonAutoTaggerAgent).
 * Auth is a per-worker service token on channel `tagger` (NOT a Hydro login).
 * See docs/PLAN-2026-06-08-problem-tagger.md.
 *
 * Blast radius is bounded BY CONSTRUCTION: title-only writes use the normal
 * authorized edit entrypoint, while knowledge-tag writes use the canonical
 * map/node preview + fingerprint CAS entrypoint. content / hidden / pid /
 * difficulty / testdata are physically unreachable through these routes.
 *
 * Endpoints (all require X-Service-Token, channel `tagger`, fixed domain):
 *   GET  /api/tagger/problems  → canonical problem summaries (excludes hidden)
 *   GET  /api/tagger/vocab     → { domainId, categories: {cat:[sub...]}, tagCounts: {tag:n} }
 *   GET  /api/tagger/mindmap?mapId=... → one public map's live hierarchy
 *   GET  /api/tagger/problem-context?docId=N → one in-scope problem statement
 *   POST /api/tagger/apply     → title-only edits or explicit canonical map/node edits
 *   POST /api/tagger/retag     → dry-run inventory only; flat tag rewrites are rejected
 */
import yaml from 'js-yaml';
import { Context, db, Handler, OplogModel, param, PERM, PermissionError, Types } from 'hydrooj';
import { ObjectId } from 'mongodb';
import { requireAuthToken } from '../lib/auth-token';
import { resolveProblemKnowledgeNodeIds } from '../lib/problem-tag-canonical';
import { Logger } from '../logger';
import { ProblemTagConflictError } from '../error';
import * as document from '../model/document';
import problem from '../model/problem';
import system from '../model/system';

const CHANNEL = 'tagger';
const MAX_APPLY_ITEMS = 1000;
const logger = new Logger('tagger');
interface MindmapNodeDocument {
    _id: unknown;
    mapId: unknown;
    parentId: unknown | null;
    topic: unknown;
    tags: unknown;
}

interface SerializedMindmapNode {
    id: string;
    mapId: string;
    parentId: string | null;
    topic: string;
    tags: string[];
}

interface KnowledgeMapDocument {
    _id: ObjectId;
    title: unknown;
    visibility: unknown;
}

const mindmapNodes = db.collection<MindmapNodeDocument>('mindmap.nodes');
const knowledgeMaps = db.collection<KnowledgeMapDocument>('mindmap.maps');

function serializeMindmapNode(node: MindmapNodeDocument, expectedMapId: string): SerializedMindmapNode {
    if (node._id === null || node._id === undefined) throw new TypeError('mindmap node id must be present');
    const id = String(node._id);
    if (!id.trim()) throw new TypeError('mindmap node id must be non-empty');
    if (node.mapId === null || node.mapId === undefined || String(node.mapId) !== expectedMapId) {
        throw new TypeError(`mindmap node ${id} must belong to requested map ${expectedMapId}`);
    }
    if (typeof node.topic !== 'string' || !node.topic.trim() || node.topic !== node.topic.trim()) {
        throw new TypeError(`mindmap node ${id} topic must be a trimmed non-empty string`);
    }
    if (!Array.isArray(node.tags) || node.tags.some((tag) => typeof tag !== 'string' || !tag.trim() || tag !== tag.trim())) {
        throw new TypeError(`mindmap node ${id} tags must be an array of trimmed non-empty strings`);
    }
    if (new Set(node.tags).size !== node.tags.length) throw new TypeError(`mindmap node ${id} tags must be unique`);
    if (node.parentId === undefined) throw new TypeError(`mindmap node ${id} parentId must be present`);
    let parentId: string | null = null;
    if (node.parentId !== null) {
        parentId = String(node.parentId);
        if (!parentId.trim()) throw new TypeError(`mindmap node ${id} parentId must be null or non-empty`);
    }
    return { id, mapId: expectedMapId, parentId, topic: node.topic, tags: node.tags as string[] };
}

async function loadMindmap(mapIdInput: unknown) {
    const mapId = canonicalObjectId(mapIdInput, 'mapId');
    const mapDoc = await knowledgeMaps.findOne(
        { _id: new ObjectId(mapId), visibility: 'public' },
        { projection: { _id: 1, title: 1, visibility: 1 } },
    );
    if (!mapDoc) return null;
    if (typeof mapDoc.title !== 'string' || !mapDoc.title.trim() || mapDoc.title !== mapDoc.title.trim()) {
        throw new TypeError(`knowledge map ${mapId} title must be a trimmed non-empty string`);
    }
    if (mapDoc.visibility !== 'public') throw new TypeError(`knowledge map ${mapId} visibility must be public`);
    const nodes = await mindmapNodes
        .find({ mapId: new ObjectId(mapId) }, { projection: { _id: 1, mapId: 1, parentId: 1, topic: 1, tags: 1 } })
        .toArray();
    return {
        map: { id: mapId, title: mapDoc.title, visibility: 'public' as const },
        nodes: nodes.map((node) => serializeMindmapNode(node, mapId)),
    };
}

/** Domain the tool operates on. Client-supplied domains are ignored on purpose. */
function taggerDomain(): string {
    const d = system.get(`serviceToken.${CHANNEL}.domain`);
    return typeof d === 'string' && d ? d : 'system';
}

function denyProblemAcl(user: any) {
    Object.assign(user, {
        _permitPids: new Set<number>(),
        _authoredPids: new Set<number>(),
        _maintainedPids: new Set<number>(),
        _dataContributionPids: new Set<number>(),
        _tagContributionPids: new Set<number>(),
        _aclFencedPids: new Set<number>(),
        _ownsLegacyProblems: false,
        _problemAclDomainId: undefined,
        _problemAclLoaded: false,
    });
}

async function loadTaggerProblemAcl(user: any, domainId: string): Promise<void> {
    denyProblemAcl(user);
    try {
        const permits = (global.Hydro?.model as any)?.permits;
        if (typeof permits?.loadAclForUser !== 'function') throw new Error('permits.loadAclForUser is unavailable');
        const loaded = await permits.loadAclForUser(domainId, Number(user?._id) || 0);
        if (
            !(loaded?.permitPids instanceof Set) ||
            !(loaded?.authoredPids instanceof Set) ||
            !(loaded?.maintainedPids instanceof Set) ||
            !(loaded?.dataContributionPids instanceof Set) ||
            !(loaded?.tagContributionPids instanceof Set) ||
            !(loaded?.fencedPids instanceof Set) ||
            typeof loaded?.ownsLegacyProblems !== 'boolean'
        ) {
            throw new TypeError('permits.loadAclForUser returned an invalid ACL snapshot');
        }
        Object.assign(user, {
            _permitPids: loaded.permitPids,
            _authoredPids: loaded.authoredPids,
            _maintainedPids: loaded.maintainedPids,
            _dataContributionPids: loaded.dataContributionPids,
            _tagContributionPids: loaded.tagContributionPids,
            _aclFencedPids: loaded.fencedPids,
            _ownsLegacyProblems: loaded.ownsLegacyProblems,
            _problemAclDomainId: domainId,
            _problemAclLoaded: true,
        });
    } catch (error) {
        denyProblemAcl(user);
        logger.error('Tagger ACL preload failed domain=%s uid=%d error=%s', domainId, Number(user?._id) || 0, error);
        throw new PermissionError(PERM.PERM_CREATE_PROBLEM);
    }
}

/** trim / drop-empty / dedup / fold fullwidth comma. Accepts string[] or "a,b，c". */
function normalizeTags(input: any): string[] {
    let arr: any[];
    if (Array.isArray(input)) arr = input;
    else if (typeof input === 'string') arr = input.replace(/，/g, ',').split(',');
    else return [];
    const out: string[] = [];
    for (const raw of arr) {
        const t = String(raw ?? '')
            .replace(/，/g, ',')
            .trim();
        if (t && !out.includes(t)) out.push(t);
    }
    return out;
}

function validateExpectedTags(input: unknown): string[] {
    if (!Array.isArray(input)) throw new TypeError('expectedTag must be a string array');
    if (input.some((tag) => typeof tag !== 'string' || !tag || tag !== tag.trim())) {
        throw new TypeError('expectedTag entries must be trimmed non-empty strings');
    }
    if (new Set(input).size !== input.length) throw new TypeError('expectedTag entries must be unique');
    return [...input];
}

function canonicalObjectId(input: unknown, field: string): string {
    if (typeof input !== 'string' || !ObjectId.isValid(input)) throw new TypeError(`${field} must be a valid ObjectId`);
    const normalized = new ObjectId(input).toHexString();
    if (input.toLowerCase() !== normalized) throw new TypeError(`${field} must be a canonical ObjectId`);
    return normalized;
}

function canonicalNodeIds(input: unknown, field: string, required: boolean): string[] {
    if (!Array.isArray(input)) throw new TypeError(`${field} must be an array`);
    const ids = input.map((value, index) => canonicalObjectId(value, `${field}[${index}]`));
    if (required && ids.length === 0) throw new TypeError(`${field} must not be empty`);
    if (new Set(ids).size !== ids.length) throw new TypeError(`${field} must not contain duplicates`);
    return ids;
}

function objectIdString(value: unknown, field: string): string {
    if (value === null || value === undefined) throw new TypeError(`${field} must be present`);
    return canonicalObjectId(String(value), field);
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
    return left.length === right.length && left.every((value, index) => value === right[index]);
}

function canonicalProblemFields(pdoc: any) {
    return {
        knowledgeMapId: objectIdString(pdoc.knowledgeMapId, `problem ${pdoc.docId} knowledgeMapId`),
        knowledgeNodeIds: canonicalNodeIds(
            resolveProblemKnowledgeNodeIds(pdoc, `problem ${pdoc.docId}`),
            `problem ${pdoc.docId} knowledgeNodeIds`,
            false,
        ),
    };
}

/** problem.categories is stored as a YAML string OR a plain object; handle both. */
function readCategories(): Record<string, string[]> {
    let raw: any = system.get('problem.categories');
    if (typeof raw === 'string') {
        try {
            raw = yaml.load(raw);
        } catch {
            raw = null;
        }
    }
    const out: Record<string, string[]> = {};
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        for (const [cat, subs] of Object.entries(raw)) {
            const name = String(cat).trim();
            if (!name) continue;
            out[name] = Array.isArray(subs) ? subs.map((s) => String(s).trim()).filter(Boolean) : [];
        }
    }
    return out;
}

/**
 * Parse a problem `config` (YAML string or object) into audit-relevant facts.
 *
 * No config at all = default judging, treated as OK. Present-but-unparseable
 * is the actionable signal (`ok=false`).
 */
function auditConfig(raw: any): { ok: boolean; time: string | null; memory: string | null; scoreSum: number | null } {
    if (raw === undefined || raw === null || raw === '') {
        return { ok: true, time: null, memory: null, scoreSum: null };
    }
    let cfg: any = raw;
    if (typeof raw === 'string') {
        try {
            cfg = yaml.load(raw);
        } catch {
            return { ok: false, time: null, memory: null, scoreSum: null };
        }
    }
    if (!cfg || typeof cfg !== 'object') return { ok: false, time: null, memory: null, scoreSum: null };
    const time = cfg.time != null ? String(cfg.time) : null;
    const memory = cfg.memory != null ? String(cfg.memory) : null;
    // Only report a subtask total when EVERY subtask carries a numeric score —
    // configs that score on cases (subtask.score absent) would otherwise sum to a
    // misleading 0 and false-flag "总分≠100".
    let scoreSum: number | null = null;
    if (Array.isArray(cfg.subtasks) && cfg.subtasks.length) {
        let sum = 0;
        let allScored = true;
        for (const st of cfg.subtasks) {
            const s = Number(st?.score);
            if (Number.isFinite(s)) sum += s;
            else {
                allScored = false;
                break;
            }
        }
        scoreSum = allScored ? sum : null;
    }
    return { ok: true, time, memory, scoreSum };
}

// ─── base: service-token gate + worker-label resolution ──────────────────────

class TaggerApiHandler extends Handler {
    noCheckPermView = true;
    workerLabel = 'unknown';

    async prepare() {
        // Validates the token + binds `this.user` to the token's Hydro user
        // (capped by scopeMask), so the per-method `checkPerm` calls below run
        // against that user. Throws AuthTokenRejectedError (403 + JSON) on failure.
        const { doc } = await requireAuthToken(this, CHANNEL);
        const domainId = taggerDomain();
        if (doc.domainId !== domainId) {
            denyProblemAcl(this.user);
            logger.error('Tagger token domain mismatch configured=%s token=%s uid=%d', domainId, doc.domainId, Number(this.user?._id) || 0);
            throw new PermissionError(PERM.PERM_CREATE_PROBLEM);
        }
        await loadTaggerProblemAcl(this.user, domainId);
        // oplog reads "张三 renamed X→Y" via the bound user's uname.
        this.workerLabel = this.user.uname || `uid:${this.user._id}`;
    }

    async problemBankScope() {
        const domainId = taggerDomain();
        const aclUser = this.user as any;
        await problem.refreshProblemAcl(aclUser, domainId);
        if (aclUser._problemAclDomainId !== domainId || !problem.canBrowseProblemBank(aclUser)) {
            throw new PermissionError(PERM.PERM_CREATE_PROBLEM);
        }
        return problem.buildProblemBankScope(aclUser);
    }
}

// ─── GET /api/tagger/problems ────────────────────────────────────────────────

class TaggerProblemsHandler extends TaggerApiHandler {
    async get() {
        const scope = await this.problemBankScope();
        this.checkPerm(PERM.PERM_VIEW_PROBLEM);
        const domainId = taggerDomain();
        const pdocs = await problem
            .getMulti(domainId, { $and: [scope, { hidden: { $ne: true } }] }, [
                'docId',
                'pid',
                'title',
                'tag',
                'authoringMode',
                'managedAuthoring',
                'knowledgeMapId',
                'knowledgeNodeIds',
            ])
            .toArray();
        this.response.body = {
            domainId,
            problems: pdocs.map((p) => ({
                docId: p.docId,
                pid: p.pid || '',
                title: p.title || '',
                tag: Array.isArray(p.tag) ? p.tag : [],
                ...canonicalProblemFields(p),
            })),
        };
    }
}

// ─── GET /api/tagger/vocab ───────────────────────────────────────────────────

class TaggerVocabHandler extends TaggerApiHandler {
    async get() {
        const scope = await this.problemBankScope();
        this.checkPerm(PERM.PERM_VIEW_PROBLEM);
        const domainId = taggerDomain();
        const agg = await document.coll
            .aggregate([
                {
                    $match: {
                        domainId,
                        docType: document.TYPE_PROBLEM,
                        $and: [scope, { hidden: { $ne: true } }],
                    },
                },
                { $unwind: '$tag' },
                { $group: { _id: '$tag', count: { $sum: 1 } } },
            ])
            .toArray();
        const tagCounts: Record<string, number> = {};
        for (const row of agg) {
            const t = String((row as any)._id ?? '').trim();
            if (t) tagCounts[t] = (row as any).count;
        }
        this.response.body = { domainId, categories: readCategories(), tagCounts };
    }
}

// ─── GET /api/tagger/audit ───────────────────────────────────────────────────
// Read-only structural metadata for the desktop "题库体检" tab. Includes hidden
// problems (the "假上线" check needs the hidden flag); returns NO content — only
// non-sensitive counts/flags. The client runs the rule engine locally.

class TaggerAuditHandler extends TaggerApiHandler {
    async get() {
        // Returns HIDDEN problems too (the 假上线 check needs the flag). The
        // canonical author scope restricts those rows to owned/maintained docs;
        // a global hidden-view permission must not widen the problem bank.
        const scope = await this.problemBankScope();
        this.checkPerm(PERM.PERM_VIEW_PROBLEM);
        const domainId = taggerDomain();
        const pdocs = await problem
            .getMulti(domainId, scope, [
                'docId',
                'pid',
                'title',
                'tag',
                'hidden',
                'difficulty',
                'nSubmit',
                'nAccept',
                'config',
                'data',
                'authoringMode',
                'managedAuthoring',
                'knowledgeMapId',
                'knowledgeNodeIds',
            ])
            .toArray();
        this.response.body = {
            domainId,
            problems: pdocs.map((p) => {
                const c = auditConfig((p as any).config);
                return {
                    docId: p.docId,
                    pid: p.pid || '',
                    title: p.title || '',
                    hidden: (p as any).hidden === true,
                    tag: Array.isArray(p.tag) ? p.tag : [],
                    difficulty: Number((p as any).difficulty) || 0,
                    nSubmit: Number((p as any).nSubmit) || 0,
                    nAccept: Number((p as any).nAccept) || 0,
                    dataCount: Array.isArray((p as any).data) ? (p as any).data.length : 0,
                    configOk: c.ok,
                    scoreSum: c.scoreSum,
                    ...canonicalProblemFields(p),
                };
            }),
        };
    }
}

// ─── GET /api/tagger/mindmap ────────────────────────────────────────────────

class TaggerMindmapHandler extends TaggerApiHandler {
    @param('mapId', Types.String)
    async get(_args: any, mapId: string) {
        await this.problemBankScope();
        this.checkPerm(PERM.PERM_VIEW_PROBLEM);
        const domainId = taggerDomain();
        let canonicalMapId: string;
        try {
            canonicalMapId = canonicalObjectId(mapId, 'mapId');
        } catch {
            this.response.status = 400;
            this.response.body = { error: 'bad_mapId' };
            return;
        }
        const loaded = await loadMindmap(canonicalMapId);
        if (!loaded) {
            this.response.status = 404;
            this.response.body = { error: 'mindmap_not_found' };
            return;
        }
        this.response.body = {
            domainId,
            knowledgeMap: loaded.map,
            nodes: loaded.nodes,
        };
    }
}

// ─── GET /api/tagger/problem-context?docId=N ────────────────────────────────

class TaggerProblemContextHandler extends TaggerApiHandler {
    @param('docId', Types.UnsignedInt)
    async get(_args: any, docId: number) {
        const scope = await this.problemBankScope();
        this.checkPerm(PERM.PERM_VIEW_PROBLEM);
        const domainId = taggerDomain();
        const docs = await problem
            .getMulti(domainId, { $and: [scope, { docId, tag: { $in: ['L2', 'PAT甲级'] } }] }, [
                'docId',
                'pid',
                'title',
                'tag',
                'content',
                'authoringMode',
                'managedAuthoring',
                'knowledgeMapId',
                'knowledgeNodeIds',
            ])
            .toArray();
        const pdoc = docs[0];
        if (!pdoc) {
            this.response.status = 404;
            this.response.body = { error: 'problem_not_found' };
            return;
        }
        this.response.body = {
            domainId,
            problem: {
                docId: pdoc.docId,
                pid: pdoc.pid || '',
                title: pdoc.title || '',
                tag: Array.isArray(pdoc.tag) ? pdoc.tag : [],
                content: pdoc.content,
                ...canonicalProblemFields(pdoc),
            },
        };
    }
}

// ─── POST /api/tagger/apply (single edit + bulk-on-selection) ─────────────────

class TaggerApplyHandler extends TaggerApiHandler {
    @param('items', Types.Any)
    async post(_args: any, items: any) {
        this.checkPerm(PERM.PERM_EDIT_PROBLEM);
        if (!Array.isArray(items)) {
            this.response.status = 400;
            this.response.body = { error: 'items_must_be_array' };
            return;
        }
        if (items.length > MAX_APPLY_ITEMS) {
            this.response.status = 400;
            this.response.body = { error: 'too_many_items', max: MAX_APPLY_ITEMS };
            return;
        }
        const expectedTags: Array<string[] | undefined> = [];
        const canonicalEdits: Array<
            | {
                  knowledgeMapId: string;
                  knowledgeNodeIds: string[];
                  expectedKnowledgeMapId: string;
                  expectedKnowledgeNodeIds: string[];
              }
            | undefined
        > = [];
        for (let index = 0; index < items.length; index++) {
            const item = items[index];
            if (!item || typeof item !== 'object' || Array.isArray(item)) {
                this.response.status = 400;
                this.response.body = { error: 'bad_item', index };
                return;
            }
            if (item.mindmapOnly !== undefined) {
                this.response.status = 400;
                this.response.body = { error: 'mindmapOnly_removed', index };
                return;
            }
            const value = item.expectedTag;
            if (value === undefined || value === null) {
                expectedTags.push(undefined);
            } else {
                try {
                    expectedTags.push(validateExpectedTags(value));
                } catch {
                    this.response.status = 400;
                    this.response.body = { error: 'bad_expectedTag', index };
                    return;
                }
            }
            const canonicalFields = ['knowledgeMapId', 'knowledgeNodeIds', 'expectedKnowledgeMapId', 'expectedKnowledgeNodeIds'];
            const canonicalCount = canonicalFields.filter((field) => Object.hasOwn(item, field)).length;
            if (canonicalCount === 0) {
                canonicalEdits.push(undefined);
                continue;
            }
            if (
                canonicalCount !== canonicalFields.length ||
                expectedTags[index] === undefined ||
                Object.hasOwn(item, 'tag') ||
                Object.hasOwn(item, 'title')
            ) {
                this.response.status = 400;
                this.response.body = { error: 'bad_canonical_edit', index };
                return;
            }
            try {
                canonicalEdits.push({
                    knowledgeMapId: canonicalObjectId(item.knowledgeMapId, 'knowledgeMapId'),
                    knowledgeNodeIds: canonicalNodeIds(item.knowledgeNodeIds, 'knowledgeNodeIds', true),
                    expectedKnowledgeMapId: canonicalObjectId(item.expectedKnowledgeMapId, 'expectedKnowledgeMapId'),
                    expectedKnowledgeNodeIds: canonicalNodeIds(item.expectedKnowledgeNodeIds, 'expectedKnowledgeNodeIds', false),
                });
            } catch {
                this.response.status = 400;
                this.response.body = { error: 'bad_canonical_edit', index };
                return;
            }
        }
        const domainId = taggerDomain();
        const results: any[] = [];
        const changes: any[] = [];
        for (let index = 0; index < items.length; index++) {
            const item = items[index];
            const docId = Number(item?.docId);
            if (!Number.isSafeInteger(docId)) {
                results.push({ docId: item?.docId, ok: false, error: 'bad_docId' });
                continue;
            }
            const hasTag = item.tag !== undefined && item.tag !== null;
            const hasTitle = typeof item.title === 'string';
            const expectedTag = expectedTags[index];
            const canonicalEdit = canonicalEdits[index];
            if (!hasTag && !hasTitle && !canonicalEdit) {
                results.push({ docId, ok: false, error: 'nothing_to_change' });
                continue;
            }
            try {
                const old = await problem.get(domainId, docId, [
                    'domainId',
                    'docId',
                    'pid',
                    'owner',
                    'tag',
                    'title',
                    'problemKind',
                    'authoringMode',
                    'managedAuthoring',
                    'structureRevision',
                    'knowledgeMapId',
                    'knowledgeNodeIds',
                ]);
                const canEdit =
                    old && (canonicalEdit ? problem.canEditProblemTags(this.user as any, old) : problem.canMaintainProblem(this.user as any, old));
                if (!old || !canEdit) {
                    results.push({ docId, ok: false, error: 'not_found' });
                    continue;
                }
                const currentTags = validateExpectedTags(old.tag || []);
                if (expectedTag && !sameStrings(currentTags, expectedTag)) {
                    results.push({ docId, ok: false, error: 'tag_conflict' });
                    continue;
                }
                if (canonicalEdit) {
                    const currentCanonical = canonicalProblemFields(old);
                    if (
                        currentCanonical.knowledgeMapId !== canonicalEdit.expectedKnowledgeMapId ||
                        !sameStrings(currentCanonical.knowledgeNodeIds, canonicalEdit.expectedKnowledgeNodeIds)
                    ) {
                        results.push({ docId, ok: false, error: 'canonical_conflict' });
                        continue;
                    }
                    const preview = await problem.previewProgrammingTagNormalization({
                        domainId,
                        docId,
                        problemKind: old.problemKind,
                        structureRevision: old.structureRevision,
                        currentTags,
                        currentKnowledgeMapId: old.knowledgeMapId,
                        currentKnowledgeNodeIds: currentCanonical.knowledgeNodeIds,
                        targetKnowledgeMapId: canonicalEdit.knowledgeMapId,
                        selectedNodeIds: canonicalEdit.knowledgeNodeIds,
                    });
                    const applied = await problem.applyProgrammingTagNormalization({
                        domainId,
                        pid: docId,
                        user: this.user as any,
                        targetKnowledgeMapId: canonicalEdit.knowledgeMapId,
                        selectedNodeIds: canonicalEdit.knowledgeNodeIds,
                        previewFingerprint: preview.fingerprint,
                    });
                    changes.push({
                        docId,
                        pid: old.pid,
                        before: { tag: currentTags, ...currentCanonical },
                        after: {
                            tag: applied.preview.nextTags,
                            knowledgeMapId: String(applied.preview.knowledgeMapId),
                            knowledgeNodeIds: applied.preview.selectedNodeIds.map(String),
                        },
                    });
                } else {
                    if (hasTag && !sameStrings(normalizeTags(item.tag), currentTags)) {
                        results.push({ docId, ok: false, error: 'canonical_nodes_required' });
                        continue;
                    }
                    if (!hasTitle) {
                        results.push({ docId, ok: false, error: 'nothing_to_change' });
                        continue;
                    }
                    const title = String(item.title).trim();
                    if (!title) {
                        results.push({ docId, ok: false, error: 'empty_title' });
                        continue;
                    }
                    await problem.editAuthorized(domainId, docId, { title }, this.user as any);
                    changes.push({
                        docId,
                        pid: old.pid,
                        before: { tag: currentTags, title: old.title || '' },
                        after: { tag: currentTags, title },
                    });
                }
                results.push({ docId, ok: true });
            } catch (e: any) {
                if (e instanceof ProblemTagConflictError) {
                    results.push({ docId, ok: false, error: canonicalEdit ? 'canonical_conflict' : 'tag_conflict' });
                    continue;
                }
                results.push({ docId, ok: false, error: e?.message || 'edit_failed' });
            }
        }
        if (changes.length) {
            await OplogModel.log(this as any, 'tagger.apply', {
                worker: this.workerLabel,
                domainId,
                count: changes.length,
                changes,
            });
        }
        this.response.body = { results };
    }
}

// ─── POST /api/tagger/retag (inventory only) ─────────────────────────────────

class TaggerRetagHandler extends TaggerApiHandler {
    @param('from', Types.Any)
    @param('to', Types.Any, true)
    @param('dryRun', Types.Any, true)
    async post(_args: any, from: any, to: any, dryRun: any) {
        const scope = await this.problemBankScope();
        this.checkPerm(PERM.PERM_EDIT_PROBLEM);
        const fromTags = normalizeTags(from);
        if (!fromTags.length) {
            this.response.status = 400;
            this.response.body = { error: 'from_required' };
            return;
        }
        const toTag = to === null || to === undefined || to === '' ? null : String(to).replace(/，/g, ',').trim();
        if (toTag !== null && (!toTag || toTag.includes(','))) {
            this.response.status = 400;
            this.response.body = { error: 'bad_to' };
            return;
        }
        const isDryRun = dryRun === true || dryRun === 'true' || dryRun === 1;
        if (!isDryRun) {
            this.response.status = 409;
            this.response.body = {
                error: 'canonical_node_selection_required',
                message: 'Flat tag rewrites are disabled; select a knowledge map and canonical nodes per problem.',
            };
            return;
        }
        const domainId = taggerDomain();

        const pdocs = await problem
            .getMulti(domainId, { $and: [scope, { tag: { $in: fromTags }, hidden: { $ne: true } }] }, ['domainId', 'docId', 'pid', 'owner', 'tag'])
            .toArray();
        const affectedDocIds = pdocs.map((p) => p.docId);

        this.response.body = { dryRun: true, from: fromTags, to: toTag, count: affectedDocIds.length, affectedDocIds };
    }
}

export async function apply(ctx: Context) {
    ctx.Route('tagger_problems', '/api/tagger/problems', TaggerProblemsHandler);
    ctx.Route('tagger_vocab', '/api/tagger/vocab', TaggerVocabHandler);
    ctx.Route('tagger_audit', '/api/tagger/audit', TaggerAuditHandler);
    ctx.Route('tagger_mindmap', '/api/tagger/mindmap', TaggerMindmapHandler);
    ctx.Route('tagger_problem_context', '/api/tagger/problem-context', TaggerProblemContextHandler);
    ctx.Route('tagger_apply', '/api/tagger/apply', TaggerApplyHandler);
    ctx.Route('tagger_retag', '/api/tagger/retag', TaggerRetagHandler);
}
