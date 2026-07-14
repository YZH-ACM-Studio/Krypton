/**
 * Problem Tagger — service-token-gated batch tag/title editor (OJ side).
 *
 * Powers the Rust + Iced desktop cleanup tool (ecosystems/KryptonTagger) and
 * the TypeScript DeepSeek auto-tagger (ecosystems/KryptonAutoTaggerAgent).
 * Auth is a per-worker service token on channel `tagger` (NOT a Hydro login).
 * See docs/PLAN-2026-06-08-problem-tagger.md.
 *
 * Blast radius is bounded BY CONSTRUCTION: every write goes through
 * ProblemModel.edit with a patch that can only contain `tag` and/or `title`
 * (which also fires `problem/edit` → Elasticsearch reindex). content / hidden /
 * pid / difficulty / testdata are physically unreachable through these routes.
 *
 * Endpoints (all require X-Service-Token, channel `tagger`, fixed domain):
 *   GET  /api/tagger/problems  → { domainId, problems: [{docId, pid, title, tag[]}] }  (excludes hidden)
 *   GET  /api/tagger/vocab     → { domainId, categories: {cat:[sub...]}, tagCounts: {tag:n} }
 *   GET  /api/tagger/mindmap   → live mindmap node/tag hierarchy
 *   GET  /api/tagger/problem-context?docId=N → one in-scope problem statement
 *   POST /api/tagger/apply     { items:[{docId, tag?, title?, expectedTag?, mindmapOnly?}] } → per-item results
 *   POST /api/tagger/retag     { from:[...], to:string|null, dryRun? } → { from, to, count, affectedDocIds }
 */
import yaml from 'js-yaml';
import { Context, db, Handler, OplogModel, param, PERM, PermissionError, Types } from 'hydrooj';
import { requireAuthToken } from '../lib/auth-token';
import { Logger } from '../logger';
import { ProblemTagConflictError } from '../error';
import * as document from '../model/document';
import problem from '../model/problem';
import system from '../model/system';

const CHANNEL = 'tagger';
const MAX_APPLY_ITEMS = 1000;
const logger = new Logger('tagger');
// retag can touch the whole library; cap how many per-problem before/after rows
// we embed in a single oplog document so it can never approach mongo's 16MB
// limit. The full affectedDocIds list (compact) is always logged.
const OPLOG_CHANGE_CAP = 500;
interface MindmapNodeDocument {
    _id: unknown;
    parentId: unknown | null;
    topic: unknown;
    tags: unknown;
}

interface SerializedMindmapNode {
    id: string;
    parentId: string | null;
    topic: string;
    tags: string[];
}

const mindmapNodes = db.collection<MindmapNodeDocument>('mindmap.nodes');

function serializeMindmapNode(node: MindmapNodeDocument): SerializedMindmapNode {
    if (node._id === null || node._id === undefined) throw new TypeError('mindmap node id must be present');
    const id = String(node._id);
    if (!id.trim()) throw new TypeError('mindmap node id must be non-empty');
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
    return { id, parentId, topic: node.topic, tags: node.tags as string[] };
}

async function loadMindmapNodes() {
    const nodes = await mindmapNodes.find({}, { projection: { _id: 1, parentId: 1, topic: 1, tags: 1 } }).toArray();
    return nodes.map(serializeMindmapNode);
}

function buildMindmapTagPolicy(nodes: SerializedMindmapNode[]) {
    const byId = new Map<string, SerializedMindmapNode>();
    const nodeIdsByTag = new Map<string, string[]>();
    for (const node of nodes) {
        if (byId.has(node.id)) throw new TypeError(`duplicate mindmap node id: ${node.id}`);
        byId.set(node.id, node);
        for (const tag of node.tags) nodeIdsByTag.set(tag, [...(nodeIdsByTag.get(tag) || []), node.id]);
    }
    const roots = nodes.filter((node) => node.parentId === null);
    if (roots.length !== 1) throw new TypeError(`mindmap must contain exactly one root, found ${roots.length}`);

    const ancestorTagsById = new Map<string, string[]>();
    const ancestorTags = (nodeId: string): string[] => {
        const cached = ancestorTagsById.get(nodeId);
        if (cached) return cached;
        const node = byId.get(nodeId);
        if (!node) throw new TypeError(`unknown mindmap node: ${nodeId}`);
        const path: SerializedMindmapNode[] = [];
        const seen = new Set([nodeId]);
        let parentId = node.parentId;
        while (parentId !== null) {
            if (seen.has(parentId)) throw new TypeError(`mindmap contains a cycle at ${parentId}`);
            seen.add(parentId);
            const parent = byId.get(parentId);
            if (!parent) throw new TypeError(`mindmap node ${nodeId} has unknown parent ${parentId}`);
            path.unshift(parent);
            parentId = parent.parentId;
        }
        const tags = [...new Set(path.flatMap((parent) => parent.tags))];
        ancestorTagsById.set(nodeId, tags);
        return tags;
    };
    for (const node of nodes) ancestorTags(node.id);

    return {
        allowedTags: new Set(nodeIdsByTag.keys()),
        isHierarchyClosed(tags: string[]) {
            const current = new Set(tags);
            return [...current].every((tag) => {
                const nodeIds = nodeIdsByTag.get(tag);
                return !nodeIds || nodeIds.some((nodeId) => ancestorTags(nodeId).every((parentTag) => current.has(parentTag)));
            });
        },
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
        _aclFencedPids: new Set<number>(),
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
            !(loaded?.fencedPids instanceof Set)
        ) {
            throw new TypeError('permits.loadAclForUser returned an invalid ACL snapshot');
        }
        Object.assign(user, {
            _permitPids: loaded.permitPids,
            _authoredPids: loaded.authoredPids,
            _maintainedPids: loaded.maintainedPids,
            _aclFencedPids: loaded.fencedPids,
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
        const pdocs = await problem.getMulti(domainId, { $and: [scope, { hidden: { $ne: true } }] }, ['docId', 'pid', 'title', 'tag']).toArray();
        this.response.body = {
            domainId,
            problems: pdocs.map((p) => ({
                docId: p.docId,
                pid: p.pid || '',
                title: p.title || '',
                tag: Array.isArray(p.tag) ? p.tag : [],
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
            .getMulti(domainId, scope, ['docId', 'pid', 'title', 'tag', 'hidden', 'difficulty', 'nSubmit', 'nAccept', 'config', 'data'])
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
                };
            }),
        };
    }
}

// ─── GET /api/tagger/mindmap ────────────────────────────────────────────────

class TaggerMindmapHandler extends TaggerApiHandler {
    async get() {
        await this.problemBankScope();
        this.checkPerm(PERM.PERM_VIEW_PROBLEM);
        const domainId = taggerDomain();
        this.response.body = {
            domainId,
            nodes: await loadMindmapNodes(),
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
            .getMulti(domainId, { $and: [scope, { docId, tag: { $in: ['L2', 'PAT甲级'] } }] }, ['docId', 'pid', 'title', 'tag', 'content'])
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
        const mindmapOnly: boolean[] = [];
        const mindmapFinalTags: Array<string[] | undefined> = [];
        for (let index = 0; index < items.length; index++) {
            const mindmapValue = items[index]?.mindmapOnly;
            if (mindmapValue !== undefined && typeof mindmapValue !== 'boolean') {
                this.response.status = 400;
                this.response.body = { error: 'bad_mindmapOnly', index };
                return;
            }
            mindmapOnly.push(mindmapValue === true);
            if (mindmapValue === true) {
                try {
                    mindmapFinalTags.push(validateExpectedTags(items[index]?.tag));
                } catch {
                    this.response.status = 400;
                    this.response.body = { error: 'bad_mindmapTag', index };
                    return;
                }
            } else {
                mindmapFinalTags.push(undefined);
            }
            const value = items[index]?.expectedTag;
            if (value === undefined || value === null) {
                expectedTags.push(undefined);
                continue;
            }
            try {
                expectedTags.push(validateExpectedTags(value));
            } catch {
                this.response.status = 400;
                this.response.body = { error: 'bad_expectedTag', index };
                return;
            }
        }
        for (let index = 0; index < items.length; index++) {
            if (mindmapOnly[index] && (expectedTags[index] === undefined || items[index]?.tag === undefined || items[index]?.tag === null)) {
                this.response.status = 400;
                this.response.body = { error: 'mindmapOnly_requires_tag_and_expectedTag', index };
                return;
            }
        }
        const mindmapPolicy = mindmapOnly.some(Boolean) ? buildMindmapTagPolicy(await loadMindmapNodes()) : undefined;
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
            if (!hasTag && !hasTitle) {
                results.push({ docId, ok: false, error: 'nothing_to_change' });
                continue;
            }
            const patch: Record<string, any> = {};
            if (hasTag) patch.tag = mindmapFinalTags[index] || normalizeTags(item.tag);
            if (hasTitle) {
                const title = String(item.title).trim();
                if (!title) {
                    results.push({ docId, ok: false, error: 'empty_title' });
                    continue;
                }
                patch.title = title;
            }
            if (mindmapOnly[index]) {
                const removedTags = expectedTag!.filter((tag) => !patch.tag.includes(tag));
                if (removedTags.length) {
                    results.push({ docId, ok: false, error: 'mindmap_only_cannot_remove_tags' });
                    continue;
                }
                const addedTags = patch.tag.filter((tag: string) => !expectedTag!.includes(tag));
                if (addedTags.some((tag: string) => !mindmapPolicy!.allowedTags.has(tag))) {
                    results.push({ docId, ok: false, error: 'tag_not_in_mindmap' });
                    continue;
                }
                if (!mindmapPolicy!.isHierarchyClosed(patch.tag)) {
                    results.push({ docId, ok: false, error: 'mindmap_parent_missing' });
                    continue;
                }
            }
            try {
                const old = await problem.get(domainId, docId, ['domainId', 'docId', 'pid', 'owner', 'tag', 'title']);
                if (!old || !problem.canMaintainProblem(this.user as any, old)) {
                    results.push({ docId, ok: false, error: 'not_found' });
                    continue;
                }
                await problem.editAuthorized(domainId, docId, patch, this.user as any, {}, expectedTag === undefined ? {} : { expectedTag });
                changes.push({
                    docId,
                    pid: old.pid,
                    before: { tag: old.tag || [], title: old.title || '' },
                    after: {
                        tag: hasTag ? patch.tag : old.tag || [],
                        title: hasTitle ? patch.title : old.title || '',
                    },
                });
                results.push({ docId, ok: true });
            } catch (e: any) {
                if (e instanceof ProblemTagConflictError) {
                    results.push({ docId, ok: false, error: 'tag_conflict' });
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

// ─── POST /api/tagger/retag (global rename / merge / delete) ──────────────────

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
        const domainId = taggerDomain();
        const fromSet = new Set(fromTags);

        const pdocs = await problem
            .getMulti(domainId, { $and: [scope, { tag: { $in: fromTags }, hidden: { $ne: true } }] }, ['domainId', 'docId', 'pid', 'owner', 'tag'])
            .toArray();
        const affectedDocIds = pdocs.map((p) => p.docId);

        if (isDryRun) {
            this.response.body = { dryRun: true, from: fromTags, to: toTag, count: affectedDocIds.length, affectedDocIds };
            return;
        }

        const changes: any[] = [];
        let edited = 0;
        for (const p of pdocs) {
            const before = Array.isArray(p.tag) ? p.tag : [];
            const kept = before.filter((t) => !fromSet.has(t));
            const after = toTag && !kept.includes(toTag) ? [...kept, toTag] : kept;
            try {
                await problem.editAuthorized(domainId, p.docId, { tag: after }, this.user as any);
                changes.push({ docId: p.docId, pid: p.pid, before, after });
                edited++;
            } catch (error) {
                logger.error('Tagger retag edit failed domain=%s docId=%d uid=%d error=%s', domainId, p.docId, Number(this.user?._id) || 0, error);
                throw error;
            }
        }
        await OplogModel.log(this as any, 'tagger.retag', {
            worker: this.workerLabel,
            domainId,
            from: fromTags,
            to: toTag,
            count: edited,
            affectedDocIds,
            changes: changes.slice(0, OPLOG_CHANGE_CAP),
            changesTruncated: changes.length > OPLOG_CHANGE_CAP,
        });
        this.response.body = { from: fromTags, to: toTag, count: edited, affectedDocIds };
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
