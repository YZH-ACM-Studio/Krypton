import {
    issuedPaperMaximum, planRoundEntry, readStoredSetConfig, selectRound,
} from '@hydrooj/common';
import type { ObjectId } from 'mongodb';
import type { Tdoc } from '../interface';
import ProblemModel from '../model/problem';
import RecordModel from '../model/record';
import { getOfficialAnswers, participantKey, settleParticipantRounds, type RoundDoc } from '../model/set-round';
import { withSetParticipantBoundary } from './set-participant-boundary';
import { loadPaperProblemFacts } from './set-paper-facts';
import { getSetResultVisibility } from './set-result-visibility';
import type { DraftFacts, JournalFacts, SetWorkspaceInput } from './set-workspace';
import { setPermissionsFor } from './set-permissions';

export interface SavedAnswerView {
    pid: number;
    answers: Record<string, string | string[]>;
    submittedAnswers: Record<string, string | string[]>;
    version: number;
    judgeResult?: Record<string, 'correct' | 'wrong' | 'partial'>;
    score?: number;
}

function answerBody(value: unknown): Record<string, string | string[]> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('set_answer_body_invalid');
    const out: Record<string, string | string[]> = {};
    for (const [key, answer] of Object.entries(value)) {
        if (typeof answer === 'string') out[key] = answer;
        else if (Array.isArray(answer) && answer.every((part) => typeof part === 'string')) out[key] = [...answer];
        else throw new TypeError('set_answer_body_invalid');
    }
    return out;
}

/** Load formal answers once for both the workspace and the save/reload response. */
export async function loadSetStudentState(tdoc: Tdoc, uid: number, teamId?: ObjectId | null, now = new Date()) {
    return withSetParticipantBoundary(tdoc.domainId, tdoc.docId, participantKey(uid, teamId), async () => {
        const config = readStoredSetConfig(tdoc);
        const permissions = await setPermissionsFor(tdoc, uid);
        const rounds = await settleParticipantRounds(tdoc.domainId, tdoc.docId, uid, teamId, now);
        const round = rounds.find((entry) => entry.state === 'open') ?? rounds[rounds.length - 1] ?? null;
        const selected = selectRound(config.settings, rounds) as RoundDoc | null;
        const pids = [...new Set([...(round?.paperPids ?? []), ...(selected?.paperPids ?? [])])];
        const problemFacts = await loadPaperProblemFacts(ProblemModel, tdoc.domainId, pids);
        const visibility = (source: RoundDoc, pid: number) => {
            const fact = problemFacts.get(pid);
            if (!fact) throw new TypeError('set_round_problem_missing');
            return getSetResultVisibility(config.settings, fact, { now, endAt: tdoc.endAt, roundClosedAt: source.closedAt });
        };
        const answers: SavedAnswerView[] = [];
        const drafts = new Map<number, DraftFacts>();
        const journal = new Map<number, JournalFacts>();
        if (round) {
            for (const answer of await getOfficialAnswers(tdoc.domainId, round)) {
                if (!round.paperPids.includes(answer.pid)) throw new TypeError('set_round_answer_scope');
                const body = answerBody(answer.body);
                const visible = visibility(round, answer.pid);
                const score = round.detail?.[answer.pid]?.score;
                const result: SavedAnswerView = {
                    pid: answer.pid, answers: body, submittedAnswers: body, version: answer.version,
                    ...(visible.details && answer.judgeResult && Object.keys(answer.judgeResult).length ? { judgeResult: answer.judgeResult } : {}),
                    ...(visible.score && typeof score === 'number' ? { score } : {}),
                };
                answers.push(result);
                drafts.set(answer.pid, { ...result, code: null, judgeResult: result.judgeResult ?? null });
            }
            const records = await RecordModel.coll.find({ domainId: tdoc.domainId, setRoundId: round._id })
                .project({ pid: 1, status: 1 }).toArray();
            for (const record of records) {
                if (!round.paperPids.includes(record.pid)) throw new TypeError('set_round_record_scope');
                const visible = visibility(round, record.pid);
                const detail = round.detail?.[record.pid];
                journal.set(record.pid, {
                    submits: (journal.get(record.pid)?.submits ?? 0) + 1,
                    lastStatus: visible.verdict ? detail?.status ?? null : null,
                    lastScore: visible.score ? detail?.score ?? null : null,
                });
            }
        }
        const canStart = planRoundEntry(config.settings, { beginAt: tdoc.beginAt, endAt: tdoc.endAt, now }, rounds);
        const inaccessible = permissions?.problems === 'hidden' || (permissions?.afterEnd === false && now >= tdoc.endAt);
        const showScore = !inaccessible && !config.settings.experience?.hideTotalScore && selected !== null && selected.paperPids.every((pid) => (!selected.legacy?.scoreLocked && tdoc.setPoints?.[pid]?.excluded) || visibility(selected, pid).score);
        const officialRound: SetWorkspaceInput['officialRound'] = round ? {
            id: round._id.toHexString(), roundNo: round.roundNo, startedAt: round.startedAt, closedAt: round.closedAt,
            ...(round.legacy?.scoreLocked ? { scoreLocked: true } : {}),
        } : null;
        return {
            permissions,
            round,
            rounds,
            pids: inaccessible ? [] : round?.paperPids ?? [],
            answers: inaccessible ? [] : answers,
            drafts,
            journal,
            officialRound,
            canRetakeRound: !!round && round.state === 'closed' && canStart.action === 'open',
            officialResult: {
                score: showScore ? selected.total : null,
                ...(showScore && config.settings.codePolicy !== 'acm'
                    ? { maxPoints: issuedPaperMaximum(tdoc, selected, (pid) => problemFacts.get(pid)?.rawMax) } : {}),
                accepted: showScore ? selected.accept ?? 0 : null,
                showScore,
            },
        };
    });
}

export function setWorkspaceState(state: Awaited<ReturnType<typeof loadSetStudentState>> | null) {
    return {
        permissions: state?.permissions ?? null,
        drafts: state?.drafts ?? new Map<number, DraftFacts>(),
        journal: state?.journal ?? new Map<number, JournalFacts>(),
        officialRound: state?.officialRound ?? null,
        canRetakeRound: state?.canRetakeRound ?? false,
        officialResult: state?.officialResult ?? { score: null, accepted: null, showScore: false },
    };
}

export function setAnswerResponse(state: Awaited<ReturnType<typeof loadSetStudentState>>) {
    return {
        roundId: state.officialRound?.id ?? null,
        roundNo: state.officialRound?.roundNo ?? null,
        closedAt: state.officialRound?.closedAt?.toISOString() ?? null,
        drafts: state.answers,
    };
}
