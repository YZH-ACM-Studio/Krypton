import type { CAC } from 'cac';
import { ObjectId } from 'mongodb';

interface ContestRecalcStatusDependencies {
    loadContest(): Promise<typeof import('../model/contest')>;
}

async function defaultLoadContest(): Promise<typeof import('../model/contest')> {
    const { loadAddonCommandContext } = require('../loader') as typeof import('../loader');
    await loadAddonCommandContext();
    return require('../model/contest') as typeof import('../model/contest');
}

export async function runContestRecalcStatusCommand(
    domainIdInput: string,
    tidInput: string,
    dependencies: ContestRecalcStatusDependencies = { loadContest: defaultLoadContest },
): Promise<{ ok: true; domainId: string; tid: string; rule: string; rows: Array<{ uid: number; score: number; journal: number }> }> {
    const domainId = typeof domainIdInput === 'string' ? domainIdInput.trim() : '';
    if (!domainId) throw new TypeError('contest_recalc_domain_invalid');
    if (typeof tidInput !== 'string' || !ObjectId.isValid(tidInput)) throw new TypeError('contest_recalc_tid_invalid');
    const tid = new ObjectId(tidInput);
    const contest = await dependencies.loadContest();
    const tdoc = await contest.get(domainId, tid);
    if (!tdoc) throw new TypeError('contest_recalc_not_found');
    const updated = await contest.recalcStatus(domainId, tid);
    const rows = (updated || []).flatMap((tsdoc) => {
        if (!tsdoc || typeof tsdoc !== 'object' || !Number.isSafeInteger(tsdoc.uid)) return [];
        return [
            {
                uid: tsdoc.uid,
                score: typeof tsdoc.score === 'number' ? tsdoc.score : 0,
                journal: Array.isArray(tsdoc.journal) ? tsdoc.journal.length : 0,
            },
        ];
    });
    return {
        ok: true,
        domainId,
        tid: tid.toHexString(),
        rule: tdoc.rule,
        rows,
    };
}

export function register(
    cli: CAC,
    dependencies: ContestRecalcStatusDependencies = { loadContest: defaultLoadContest },
): void {
    cli.command('contest:recalc-status <domainId> <tid>').action(async (domainId: string, tid: string) => {
        const result = await runContestRecalcStatusCommand(domainId, tid, dependencies);
        process.stdout.write(`${JSON.stringify(result)}\n`);
    });
}
