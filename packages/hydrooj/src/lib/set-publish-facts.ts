import {
    activePaperPids, drawnPaperRange, examPaperQuotaTotal, paperProblemMaximum,
    readStoredSetConfig, roundPaperPoints, setAudienceConfirmed, type ProblemKind, type SetConfig, type SetPublishFacts,
} from '@hydrooj/common';
import type { Tdoc } from '../interface';
import { ValidationError } from '../error';
import ProblemModel from '../model/problem';
import { loadPaperProblemFacts } from './set-paper-facts';

/** Publishing and editing a published set validate the paper that will actually be issued. */
export async function loadSetPublishFacts(doc: Tdoc, config: SetConfig = readStoredSetConfig(doc),
    known?: Awaited<ReturnType<typeof loadPaperProblemFacts>>): Promise<SetPublishFacts> {
    if (!Array.isArray(doc.pids) || new Set(doc.pids).size !== doc.pids.length
        || doc.pids.some((pid) => !Number.isSafeInteger(pid) || pid <= 0)) throw new ValidationError('pids');
    const pids = activePaperPids(doc.pids, doc.setPoints);
    const facts = known ?? await loadPaperProblemFacts(ProblemModel, doc.domainId, pids);
    const problems = pids.map((pid) => {
        const fact = facts.get(pid);
        if (!fact) throw new ValidationError('pids');
        return fact;
    });
    const poolKinds = new Map<number, ProblemKind>(pids.map((pid, i) => [pid, problems[i].kind]));
    const score = Object.fromEntries(pids.map((pid, i) => [pid, paperProblemMaximum(doc, pid, problems[i].rawMax)]));
    const quotas = config.settings.draw.enabled ? config.settings.draw.quotas : undefined;
    const paperRange = drawnPaperRange(problems.map((problem, i) => ({ kind: problem.kind, points: score[pids[i]] })), quotas ?? null);
    const maximum = config.settings.codePolicy === 'acm' ? quotas ? examPaperQuotaTotal(quotas) : pids.length
        : paperRange && paperRange.min === paperRange.max ? paperRange.min : null;
    return {
        beginAt: doc.beginAt, endAt: doc.endAt, problemCount: pids.length,
        audienceConfirmed: setAudienceConfirmed(doc), problems, poolPids: pids, poolKinds, score, paperRange: config.settings.codePolicy === 'acm' ? undefined : paperRange,
        paperMax: maximum === null ? null : roundPaperPoints(maximum),
    };
}
