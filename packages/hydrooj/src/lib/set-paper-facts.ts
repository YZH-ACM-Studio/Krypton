import { judgePointMaximum } from '@hydrooj/common';
import type ProblemModel from '../model/problem';
import { setProblemFact } from './set-problem-fact';

export async function loadPaperProblemFacts(model: Pick<typeof ProblemModel, 'getList'>, domainId: string, pids: number[]) {
    const docs = await model.getList(domainId, pids, true, true, ['docId', 'config', 'problemKind'], true);
    return new Map(pids.map((pid) => {
        const doc = docs[pid];
        if (!doc) throw new TypeError(`set_paper_problem_missing:${domainId}/${pid}`);
        const fact = setProblemFact(doc);
        return [pid, { ...fact, rawMax: judgePointMaximum(fact.kind, doc.config) }];
    }));
}
