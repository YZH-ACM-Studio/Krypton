/**
 * Problem Tagger — service-token-gated batch tag/title editor (OJ side).
 *
 * Powers the external Rust + Iced desktop tool (ecosystems/KryptonTagger) used
 * by a small team to clean up problem tags and titles. Auth is a per-worker
 * service token on channel `tagger` (NOT a Hydro login).
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
 *   POST /api/tagger/apply     { items:[{docId, tag?, title?}] }     → { results:[{docId, ok, error?}] }
 *   POST /api/tagger/retag     { from:[...], to:string|null, dryRun? } → { from, to, count, affectedDocIds }
 */
import yaml from 'js-yaml';
import {
    Context, Handler, OplogModel, param, Types, requireServiceToken,
} from 'hydrooj';
import * as document from '../model/document';
import problem from '../model/problem';
import system from '../model/system';
import { CreateError, ForbiddenError } from '../error';

const CHANNEL = 'tagger';
const MAX_APPLY_ITEMS = 1000;
// retag can touch the whole library; cap how many per-problem before/after rows
// we embed in a single oplog document so it can never approach mongo's 16MB
// limit. The full affectedDocIds list (compact) is always logged.
const OPLOG_CHANGE_CAP = 500;

// ServiceTokenError (from the shared lib) is NOT a UserFacingError, so it would
// surface as a 500 + HTML bsod. Re-throw token failures as this (403 + JSON) so
// the desktop client gets a clean, parseable error. Scoped to tagger — the
// shared service-token lib is untouched (Vigil unaffected).
const ServiceTokenRejectedError = CreateError(
    'ServiceTokenRejectedError', ForbiddenError, '服务令牌无效或缺失。',
);

/** Domain the tool operates on. Client-supplied domains are ignored on purpose. */
function taggerDomain(): string {
    const d = system.get(`serviceToken.${CHANNEL}.domain`);
    return typeof d === 'string' && d ? d : 'system';
}

/** trim / drop-empty / dedup / fold fullwidth comma. Accepts string[] or "a,b，c". */
function normalizeTags(input: any): string[] {
    let arr: any[];
    if (Array.isArray(input)) arr = input;
    else if (typeof input === 'string') arr = input.replace(/，/g, ',').split(',');
    else return [];
    const out: string[] = [];
    for (const raw of arr) {
        const t = String(raw ?? '').replace(/，/g, ',').trim();
        if (t && !out.includes(t)) out.push(t);
    }
    return out;
}

/** problem.categories is stored as a YAML string OR a plain object; handle both. */
function readCategories(): Record<string, string[]> {
    let raw: any = system.get('problem.categories');
    if (typeof raw === 'string') {
        try { raw = yaml.load(raw); } catch { raw = null; }
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

// ─── base: service-token gate + worker-label resolution ──────────────────────

class TaggerApiHandler extends Handler {
    noCheckPermView = true;
    workerLabel = 'unknown';

    async prepare() {
        try {
            requireServiceToken(this, CHANNEL);
        } catch {
            throw new ServiceTokenRejectedError();
        }
        // Resolve a human-readable operator name from the presented token so the
        // oplog reads "张三 renamed X→Y" rather than just a token prefix.
        const presented = this.request.headers['x-service-token'];
        const token = Array.isArray(presented) ? presented[0] : presented;
        const labels = system.get(`serviceToken.${CHANNEL}.labels`);
        if (token && labels && typeof labels === 'object' && (labels as any)[token]) {
            this.workerLabel = String((labels as any)[token]);
        } else if (token) {
            this.workerLabel = `token:${token.slice(0, 8)}`;
        }
    }
}

// ─── GET /api/tagger/problems ────────────────────────────────────────────────

class TaggerProblemsHandler extends TaggerApiHandler {
    async get() {
        const domainId = taggerDomain();
        const pdocs = await problem.getMulti(
            domainId, { hidden: { $ne: true } }, ['docId', 'pid', 'title', 'tag'],
        ).toArray();
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
        const domainId = taggerDomain();
        const agg = await document.coll.aggregate([
            { $match: { domainId, docType: document.TYPE_PROBLEM, hidden: { $ne: true } } },
            { $unwind: '$tag' },
            { $group: { _id: '$tag', count: { $sum: 1 } } },
        ]).toArray();
        const tagCounts: Record<string, number> = {};
        for (const row of agg) {
            const t = String((row as any)._id ?? '').trim();
            if (t) tagCounts[t] = (row as any).count;
        }
        this.response.body = { domainId, categories: readCategories(), tagCounts };
    }
}

// ─── POST /api/tagger/apply (single edit + bulk-on-selection) ─────────────────

class TaggerApplyHandler extends TaggerApiHandler {
    @param('items', Types.Any)
    async post(_args: any, items: any) {
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
        const domainId = taggerDomain();
        const results: any[] = [];
        const changes: any[] = [];
        for (const item of items) {
            const docId = Number(item?.docId);
            if (!Number.isSafeInteger(docId)) {
                results.push({ docId: item?.docId, ok: false, error: 'bad_docId' });
                continue;
            }
            const hasTag = item.tag !== undefined && item.tag !== null;
            const hasTitle = typeof item.title === 'string';
            if (!hasTag && !hasTitle) {
                results.push({ docId, ok: false, error: 'nothing_to_change' });
                continue;
            }
            const patch: Record<string, any> = {};
            if (hasTag) patch.tag = normalizeTags(item.tag);
            if (hasTitle) {
                const title = String(item.title).trim();
                if (!title) { results.push({ docId, ok: false, error: 'empty_title' }); continue; }
                patch.title = title;
            }
            try {
                const old = await problem.get(domainId, docId, ['docId', 'pid', 'tag', 'title']);
                if (!old) { results.push({ docId, ok: false, error: 'not_found' }); continue; }
                await problem.edit(domainId, docId, patch);
                changes.push({
                    docId,
                    pid: old.pid,
                    before: { tag: old.tag || [], title: old.title || '' },
                    after: {
                        tag: hasTag ? patch.tag : (old.tag || []),
                        title: hasTitle ? patch.title : (old.title || ''),
                    },
                });
                results.push({ docId, ok: true });
            } catch (e: any) {
                results.push({ docId, ok: false, error: e?.message || 'edit_failed' });
            }
        }
        if (changes.length) {
            await OplogModel.log(this as any, 'tagger.apply', {
                worker: this.workerLabel, domainId, count: changes.length, changes,
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
        const fromTags = normalizeTags(from);
        if (!fromTags.length) {
            this.response.status = 400;
            this.response.body = { error: 'from_required' };
            return;
        }
        const toTag = (to === null || to === undefined || to === '')
            ? null : String(to).replace(/，/g, ',').trim();
        if (toTag !== null && (!toTag || toTag.includes(','))) {
            this.response.status = 400;
            this.response.body = { error: 'bad_to' };
            return;
        }
        const isDryRun = dryRun === true || dryRun === 'true' || dryRun === 1;
        const domainId = taggerDomain();
        const fromSet = new Set(fromTags);

        const pdocs = await problem.getMulti(
            domainId, { tag: { $in: fromTags }, hidden: { $ne: true } }, ['docId', 'pid', 'tag'],
        ).toArray();
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
                await problem.edit(domainId, p.docId, { tag: after });
                changes.push({ docId: p.docId, pid: p.pid, before, after });
                edited++;
            } catch { /* skip individual failures; reported via count mismatch */ }
        }
        await OplogModel.log(this as any, 'tagger.retag', {
            worker: this.workerLabel, domainId, from: fromTags, to: toTag, count: edited,
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
    ctx.Route('tagger_apply', '/api/tagger/apply', TaggerApplyHandler);
    ctx.Route('tagger_retag', '/api/tagger/retag', TaggerRetagHandler);
}
