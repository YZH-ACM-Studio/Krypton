/**
 * Crawler import API — token-gated problem ingestion for the desktop crawler tool.
 *
 * Auth = auth-token channel `crawler` on a user-bound token (the crawl + AI parse
 * happen client-side on a networked machine; only ingestion touches the OJ). The
 * bound user must have PERM_CREATE_PROBLEM. Problems are created HIDDEN (no judge
 * testdata yet) and unhidden by the testdata step once data is attached.
 *
 *   POST /api/crawler/problem  {title, content(=Hydro markdown), sourceUrl, source?,
 *                               pid?, cid?, problemId?, timeLimit?, memoryLimit?}
 *      → create (hidden) or, if sourceUrl already imported, refresh the statement.
 *        Records crawler.imported (dedup + the cid/problemId key for testdata match).
 *   POST /api/crawler/testdata {items:[{cid, problemId, cases:[{input,output}]}]}
 *      → match each (cid,problemId) → docId via crawler.imported, write .in/.out +
 *        config.yaml via addTestdata, then unhide.
 *
 * See docs/PLAN-2026-06-11-crawler-tool.md.
 */
import yaml from 'js-yaml';
import { ObjectId } from 'mongodb';
import {
    Context, Handler, OplogModel, param, PERM, PermissionError, Types,
} from 'hydrooj';
import { ForbiddenError } from '../error';
import { requireAuthToken } from '../lib/auth-token';
import { Logger } from '../logger';
import problem from '../model/problem';
import db from '../service/db';

const CHANNEL = 'crawler';
const importColl = db.collection('crawler.imported');
const logger = new Logger('crawler');

function normTime(s: string): string {
    const t = String(s || '').replace(/\s/g, '').toLowerCase();
    return /\d+ms$/.test(t) ? t : (/^\d+$/.test(t) ? `${t}ms` : '1000ms');
}
function normMemory(s: string): string {
    const m = String(s || '').replace(/\s/g, '').toLowerCase().replace(/kb$/, 'k').replace(/mb$/, 'm');
    return /^\d+[km]$/.test(m) ? m : '256m';
}

// ─── base: token gate (channel `crawler`, must be user-bound) ────────────────

function denyProblemAcl(user: any) {
    Object.assign(user, {
        _permitPids: new Set<number>(),
        _maintainedPids: new Set<number>(),
        _aclFencedPids: new Set<number>(),
        _problemAclDomainId: undefined,
        _problemAclLoaded: false,
    });
}

async function loadCrawlerProblemAcl(user: any, domainId: string): Promise<void> {
    denyProblemAcl(user);
    try {
        const permits = (global.Hydro?.model as any)?.permits;
        if (typeof permits?.loadAclForUser !== 'function') throw new Error('permits.loadAclForUser is unavailable');
        const loaded = await permits.loadAclForUser(domainId, Number(user?._id) || 0);
        if (!(loaded?.permitPids instanceof Set)
            || !(loaded?.maintainedPids instanceof Set)
            || !(loaded?.fencedPids instanceof Set)) {
            throw new TypeError('permits.loadAclForUser returned an invalid ACL snapshot');
        }
        Object.assign(user, {
            _permitPids: loaded.permitPids,
            _maintainedPids: loaded.maintainedPids,
            _aclFencedPids: loaded.fencedPids,
            _problemAclDomainId: domainId,
            _problemAclLoaded: true,
        });
        problem.assertProblemAclDomain(user, domainId);
    } catch (error) {
        denyProblemAcl(user);
        logger.error(
            'Crawler ACL preload failed domain=%s uid=%d error=%s',
            domainId, Number(user?._id) || 0, error,
        );
        throw new PermissionError(PERM.PERM_CREATE_PROBLEM);
    }
}

async function requireMaintainedProblem(domainId: string, docId: number, user: any) {
    // Token handlers replace the HTTP user after the normal handler/create
    // preload. Reload here before every target write batch so fences/revokes
    // that land during a long crawler request take effect before the next batch.
    await loadCrawlerProblemAcl(user, domainId);
    const pdoc = await problem.get(domainId, docId);
    if (!pdoc || !problem.canMaintainProblem(user, pdoc)) {
        throw new PermissionError(PERM.PERM_CREATE_PROBLEM);
    }
    return pdoc;
}

class CrawlerApiHandler extends Handler {
    noCheckPermView = true;
    crawlerDomain = 'system';

    async prepare() {
        const { doc } = await requireAuthToken(this, CHANNEL);
        // Problems carry an owner; a pure service token (no bound user) must not import.
        if (doc.uid == null) throw new ForbiddenError('入库需要绑定用户的令牌');
        this.crawlerDomain = doc.domainId || 'system';
        await loadCrawlerProblemAcl(this.user, this.crawlerDomain);
    }
}

// ─── POST /api/crawler/problem ───────────────────────────────────────────────

class CrawlerProblemHandler extends CrawlerApiHandler {
    @param('title', Types.String)
    @param('content', Types.Content)
    @param('sourceUrl', Types.String)
    @param('source', Types.String, true)
    @param('pid', Types.String, true)
    @param('cid', Types.Int, true)
    @param('problemId', Types.String, true)
    @param('timeLimit', Types.String, true)
    @param('memoryLimit', Types.String, true)
    async post(
        _args: any, title: string, content: string, sourceUrl: string,
        source: string, pid: string, cid: number, problemId: string,
        timeLimit: string, memoryLimit: string,
    ) {
        this.checkPerm(PERM.PERM_CREATE_PROBLEM);
        const domainId = this.crawlerDomain;
        const t = title.trim();
        const url = sourceUrl.trim();
        if (!t || !content.trim() || !url) {
            this.response.status = 400;
            this.response.body = { error: 'title/content/sourceUrl required' };
            return;
        }

        const existing = await importColl.findOne({ domainId, sourceUrl: url });
        if (existing) {
            // re-crawl → refresh the statement in place (no duplicate)
            const pdoc = await requireMaintainedProblem(domainId, existing.docId, this.user);
            await problem.editAuthorized(
                domainId,
                existing.docId,
                { title: t, content },
                this.user,
                {},
                { expectedStructureRevision: pdoc.structureRevision },
            );
            await importColl.updateOne(
                { _id: existing._id },
                { $set: { updatedAt: new Date(), timeLimit: timeLimit || '', memoryLimit: memoryLimit || '' } },
            );
            await OplogModel.log(this as any, 'crawler.update', {
                worker: this.user.uname, docId: existing.docId, sourceUrl: url,
            });
            this.response.body = { pid: existing.pid, docId: existing.docId, updated: true };
            return;
        }

        const realPid = (pid || '').trim();
        // Create HIDDEN atomically (no judge testdata yet). Passing meta.hidden
        // avoids a create-visible-then-flip window that would briefly publish +
        // ES-index the problem (and leave it permanently visible if the flip threw).
        const docId = await problem.add(domainId, realPid, t, content, this.user._id, [], {
            hidden: true,
            problemKind: 'programming',
        });
        try {
            await importColl.insertOne({
                _id: new ObjectId(),
                domainId,
                docId,
                pid: realPid,
                source: (source || '').trim(),
                sourceUrl: url,
                cid: Number.isInteger(cid) ? cid : null,
                problemId: (problemId || '').trim() || null,
                timeLimit: timeLimit || '',
                memoryLimit: memoryLimit || '',
                createdBy: this.user._id,
                createdAt: new Date(),
            });
        } catch (e: any) {
            // Lost a concurrent race on the same sourceUrl (unique index): drop the
            // duplicate problem we just created and return the winner's refreshed row.
            if (e?.code === 11000) {
                try {
                    await problem.del(domainId, docId);
                } catch (cleanupError) {
                    logger.error(
                        'Crawler duplicate cleanup failed domain=%s docId=%d error=%s',
                        domainId, docId, cleanupError,
                    );
                    throw cleanupError;
                }
                const winner = await importColl.findOne({ domainId, sourceUrl: url });
                if (winner) {
                    const pdoc = await requireMaintainedProblem(domainId, winner.docId, this.user);
                    await problem.editAuthorized(
                        domainId,
                        winner.docId,
                        { title: t, content },
                        this.user,
                        {},
                        { expectedStructureRevision: pdoc.structureRevision },
                    );
                    this.response.body = { pid: winner.pid, docId: winner.docId, updated: true };
                    return;
                }
            }
            throw e;
        }
        await OplogModel.log(this as any, 'crawler.create', {
            worker: this.user.uname, docId, pid: realPid, sourceUrl: url, source,
        });
        this.response.body = { pid: realPid, docId, updated: false };
    }
}

// ─── POST /api/crawler/testdata ──────────────────────────────────────────────

class CrawlerTestdataHandler extends CrawlerApiHandler {
    @param('items', Types.Any)
    async post(_args: any, items: any) {
        this.checkPerm(PERM.PERM_CREATE_PROBLEM);
        const domainId = this.crawlerDomain;
        if (!Array.isArray(items)) {
            this.response.status = 400;
            this.response.body = { error: 'items_must_be_array' };
            return;
        }
        const results: any[] = [];
        let unhidden = 0;
        for (const item of items) {
            const cid = Number(item?.cid);
            const problemId = String(item?.problemId ?? '').trim();
            if (!Number.isInteger(cid) && !problemId) {
                // an all-null key would match an arbitrary unkeyed problem — refuse.
                results.push({ cid, problemId, ok: false, error: 'unkeyed' });
                continue;
            }
            const rawCases = Array.isArray(item?.cases) ? item.cases : [];
            // drop blank cases (both input & output empty) so we never unhide junk.
            const cases = rawCases.filter(
                (c: any) => c && (String(c.input ?? '') !== '' || String(c.output ?? '') !== ''),
            );
            // eslint-disable-next-line no-await-in-loop
            const rec = await importColl.findOne({
                domainId,
                cid: Number.isInteger(cid) ? cid : null,
                problemId: problemId || null,
            });
            if (!rec) {
                results.push({ cid, problemId, ok: false, error: 'not_found' });
                continue;
            }
            if (!cases.length) {
                results.push({ cid, problemId, ok: false, error: 'no_valid_cases' });
                continue;
            }
            try {
                // eslint-disable-next-line no-await-in-loop
                await requireMaintainedProblem(domainId, rec.docId, this.user);
                const yamlCases: { input: string, output: string }[] = [];
                // eslint-disable-next-line no-await-in-loop
                await problem.withAuthorizedStructuralWriteClaim(
                    domainId,
                    rec.docId,
                    this.user,
                    'crawler-testdata-replace',
                    async (claim) => {
                        const cur = await problem.get(domainId, rec.docId);
                        if (!cur) throw new PermissionError(PERM.PERM_CREATE_PROBLEM);
                        // Clean replace under one durable claim. Revocation cannot
                        // interleave between storage, config mirror, and publish.
                        const oldNames = ((cur as any).data || []).map((d: any) => d.name).filter(Boolean);
                        if (oldNames.length) {
                            await problem.delTestdataWithClaim(claim, oldNames, this.user._id);
                        }
                        for (let i = 0; i < cases.length; i++) {
                            const inName = `${i + 1}.in`;
                            const outName = `${i + 1}.out`;
                            // eslint-disable-next-line no-await-in-loop
                            await problem.addTestdataWithClaim(
                                claim, inName, String(cases[i]?.input ?? ''), this.user._id,
                            );
                            // eslint-disable-next-line no-await-in-loop
                            await problem.addTestdataWithClaim(
                                claim, outName, String(cases[i]?.output ?? ''), this.user._id,
                            );
                            yamlCases.push({ input: inName, output: outName });
                        }
                        const config = {
                            time: normTime(rec.timeLimit),
                            memory: normMemory(rec.memoryLimit),
                            subtasks: [{ score: 100, type: 'min', cases: yamlCases }],
                        };
                        await problem.addTestdataWithClaim(
                            claim, 'config.yaml', yaml.dump(config), this.user._id,
                        );
                        await problem.editWithClaim(claim, { hidden: false });
                    },
                );
                unhidden++;
                results.push({ cid, problemId, docId: rec.docId, ok: true, cases: yamlCases.length });
            } catch (e: any) {
                results.push({
                    cid,
                    problemId,
                    ok: false,
                    error: e instanceof PermissionError ? 'not_found' : (e?.message || 'failed'),
                });
            }
        }
        await OplogModel.log(this as any, 'crawler.testdata', {
            worker: this.user.uname, ok: results.filter((r) => r.ok).length, unhidden,
        });
        this.response.body = { results };
    }
}

async function ensureCrawlerIndexes() {
    await db.ensureIndexes(
        importColl,
        { key: { domainId: 1, sourceUrl: 1 }, name: 'src', unique: true },
        { key: { domainId: 1, cid: 1, problemId: 1 }, name: 'key' },
    );
}

export async function apply(ctx: Context) {
    ensureCrawlerIndexes().catch((e) => {
        console.error('[crawler] ensureIndexes failed:', e);
    });
    // Token-gated (channel `crawler`); no PRIV gate — prepare() enforces.
    ctx.Route('crawler_problem', '/api/crawler/problem', CrawlerProblemHandler);
    ctx.Route('crawler_testdata', '/api/crawler/testdata', CrawlerTestdataHandler);
}
