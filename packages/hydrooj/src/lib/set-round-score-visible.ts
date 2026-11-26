import type { SetConfig } from '@hydrooj/common';
import type { Tdoc } from '../interface';
import ProblemModel from '../model/problem';
import type { RoundDoc } from '../model/set-round';
import { parseProblemConfigObject } from './problem-config';
import { setPermissionsFor } from './set-permissions';
import { setProblemFact } from './set-problem-fact';
import { getSetResultVisibility } from './set-result-visibility';

/** A personal total is visible only if every problem on the selected paper can reveal its score. */
export async function canShowFormalSetScore(tdoc: Tdoc, config: SetConfig, round: RoundDoc | null, uid: number, now = new Date()): Promise<boolean> {
    if (!round?.paperPids.length || config.settings.experience?.hideTotalScore) return false;
    const permissions = await setPermissionsFor(tdoc, uid);
    if (permissions && (permissions.problems === 'hidden' || (!permissions.afterEnd && now >= tdoc.endAt))) return false;
    const clock = { now, endAt: tdoc.endAt, roundClosedAt: round.closedAt };
    const visible = (fact: ReturnType<typeof setProblemFact>) => getSetResultVisibility(config.settings, fact, clock).score;
    const objective = visible({ kind: 'single', judged: false });
    if (objective === visible({ kind: 'programming', judged: true })) return objective;
    const problems = await ProblemModel.getMulti(tdoc.domainId, { docId: { $in: round.paperPids } }, ['docId', 'problemKind', 'config']).toArray();
    if (problems.length !== round.paperPids.length) throw new Error(`set_round_problem_missing: ${tdoc.domainId}/${tdoc.docId}/${round.roundNo}`);
    return problems.every((problem) => visible(setProblemFact({ ...problem, config: parseProblemConfigObject(problem) })));
}
