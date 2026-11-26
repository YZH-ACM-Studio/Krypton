import { LRUCache } from 'lru-cache';
import { effectiveProblemKind, readStoredSetConfig, type ContestReplayFrame, type SetProblemFact } from '@hydrooj/common';
import { Logger } from '@hydrooj/utils';
import type { Tdoc } from '../interface';
import { localizedErrorText, ValidationError } from '../error';
import { parseProblemConfigObject } from '../lib/problem-config';
import { canUseSetCapability } from '../lib/set-permissions';
import { setProblemFact } from '../lib/set-problem-fact';
import { buildVirtualContestSnapshot } from '../lib/virtual-contest';
import {
    incompleteLegacyScore, legacyReplayScore, publicReplayRows, replayClock, replayOpponent, sameReplaySnapshot, setReplayScore, virtualReplayScore,
    type LegacyReplayStatus, type ReplayEntry, type ReplayRound,
} from '../lib/virtual-contest-replay';
import type { TeachActor } from '../lib/teach-permissions';
import * as contest from './contest';
import problem from './problem';
import { loadReplayRounds } from './set-round';
import user from './user';
import { virtualContestService, type VirtualContestAttemptDoc } from './virtual-contest';

const logger = new Logger('contest-replay');

async function loadSource(tdoc: Tdoc) {
    const { domainId, docId: tid } = tdoc;
    const config = tdoc.setConfig && readStoredSetConfig(tdoc);
    const statuses = contest.getMultiStatus(domainId, { docId: tid });
    const [official, rounds, problems] = await Promise.all([
        statuses.project<LegacyReplayStatus>(config ? { uid: 1, unrank: 1 } : {
            uid: 1, unrank: 1, startAt: 1, score: 1, accept: 1, time: 1, detail: 1,
            'journal.rid': 1, 'journal.pid': 1, 'journal.score': 1, 'journal.status': 1,
        }).toArray(),
        config ? loadReplayRounds(domainId, tid) : new Map<string, ReplayRound[]>(),
        problem.getMulti(domainId, { docId: { $in: tdoc.pids } }, config ? ['docId', 'problemKind', 'config'] : ['docId', 'problemKind']).toArray(),
    ]);
    if (problems.length !== new Set(tdoc.pids).size
        || problems.some((doc) => !tdoc.setPoints?.[doc.docId]?.excluded && effectiveProblemKind(doc) === 'subjective')) {
        throw new ValidationError('pid', null, localizedErrorText`比赛含缺失题目或主观题，无法重放榜单。`);
    }
    const facts = new Map<number, SetProblemFact>(config ? problems.map((doc) => [
        doc.docId, setProblemFact({ ...doc, config: parseProblemConfigObject(doc) }),
    ] as const) : []);
    const incomplete = new Set(config ? [] : official.filter((row) => incompleteLegacyScore(tdoc, row, contest.RULES[tdoc.rule])).map((row) => row.uid));
    return { official, rounds, facts, incomplete, codePids: new Set([...facts].filter(([, fact]) => fact.judged).map(([pid]) => pid)) };
}

// Seeking and following share short-lived official score inputs. Permissions, VP status and the time ceiling are read per request.
const sources = new LRUCache<string, ReturnType<typeof loadSource>>({ max: 8, ttl: 15_000 });
function sourceHistory(tdoc: Tdoc) {
    const key = JSON.stringify([tdoc.domainId, tdoc.docId, tdoc.setConfig?.revision, tdoc.rule, tdoc.pids, tdoc.score,
        tdoc.beginAt, tdoc.endAt, tdoc.duration, tdoc.lockAt, tdoc.unlocked]);
    const cached = sources.get(key);
    if (cached) return cached;
    const reading = loadSource(tdoc).catch((error) => {
        if (sources.peek(key) === reading) sources.delete(key);
        throw error;
    });
    sources.set(key, reading);
    return reading;
}

export async function readContestReplay(tdoc: Tdoc, mine: VirtualContestAttemptDoc, actor: TeachActor,
    requested?: number, now = new Date()): Promise<ContestReplayFrame> {
    const started = Date.now();
    const { domainId } = tdoc;
    const config = tdoc.setConfig && readStoredSetConfig(tdoc);
    const snapshot = buildVirtualContestSnapshot(tdoc);
    if (!sameReplaySnapshot(snapshot, mine.snapshot)) {
        throw new ValidationError('snapshot', null, localizedErrorText`比赛时间、题目或计分设置已变更，无法比较这次虚拟参赛。`);
    }
    const sourceLocked = contest.isLocked(tdoc, now);
    const publicLockAt = sourceLocked ? tdoc.lockAt : undefined;
    const clock = replayClock(mine, sourceLocked, requested, now, snapshot.lockOffsetMs);
    const [history, candidates, viewProblems] = await Promise.all([
        sourceHistory(tdoc), virtualContestService.listReplayOpponents(mine), canUseSetCapability(tdoc, actor, 'view'),
    ]);
    const columns = viewProblems ? mine.snapshot.pids : [];
    const paper = { facts: history.facts, codePids: history.codePids, pids: columns,
        weights: new Map(tdoc.pids.map((pid) => [pid, tdoc.score?.[pid] ?? 100])) };
    const rule = contest.RULES[snapshot.rule];
    const entries: ReplayEntry[] = [];
    let incomplete = 0;
    for (const status of history.official) {
        const rounds = history.rounds.get(`u:${status.uid}`) ?? [];
        const finalOnly = config ? rounds.some(({ round }) => round.legacy?.scoreLocked || round.legacy?.incompleteHistory
            || (round.legacy?.missingRounds ?? 0) > 0) : history.incomplete.has(status.uid);
        if (finalOnly) {
            incomplete++;
            if (!clock.final) continue;
        }
        const origin = config
            ? (config.settings.personalLimit.hours && rounds.length ? rounds[0].round.startedAt : tdoc.beginAt)
            : (tdoc.duration && status.startAt ? status.startAt : tdoc.beginAt);
        const score = config ? setReplayScore(tdoc, config.settings, rounds, origin, clock, paper, now, publicLockAt)
            : legacyReplayScore(tdoc, status, origin, tdoc.beginAt, clock, rule, columns, finalOnly, undefined, publicLockAt);
        entries.push({ ...score, uid: status.uid, source: 'official', unrank: status.unrank ?? false });
    }
    const virtualDoc = { ...tdoc, endAt: new Date(tdoc.beginAt.getTime() + snapshot.durationMs) };
    for (const attempt of [...candidates.filter((row) => replayOpponent(row, mine, snapshot)), mine]) {
        const stopAt = new Date(Math.min(attempt.endedAt?.getTime() ?? Infinity, attempt.endAt.getTime()));
        const score = config ? virtualReplayScore(virtualDoc, config.settings, attempt, clock, paper, now, rule)
            : legacyReplayScore(tdoc, { uid: attempt.uid, journal: attempt.journal }, attempt.startAt, attempt.startAt,
                clock, rule, columns, false, stopAt);
        entries.push({ ...score, uid: attempt.uid, source: attempt._id.equals(mine._id) ? 'self' : 'virtual', unrank: false });
    }
    const uids = [...new Set(entries.map((entry) => entry.uid))];
    const [users, realNames] = await Promise.all([user.getListForRender(domainId, uids, []), contest.getScoreboardStudentNames(tdoc, uids)]);
    const names = new Map(uids.map((uid) => [uid, realNames[uid] ?? users[uid]?.uname ?? `UID ${uid}`]));
    const mode = snapshot.rule === 'acm' ? 'acm' : config ? 'highest' : 'ioi';
    const hideTotals = config?.settings.experience?.hideTotalScore === true;
    const rows = publicReplayRows(entries, mode, hideTotals, names);
    if (Date.now() - started >= 500) {
        logger.warn('Slow replay domain=%s tid=%s rows=%d atMs=%d elapsedMs=%d', domainId, tdoc.docId, rows.length, clock.atMs, Date.now() - started);
    }
    return { atMs: clock.atMs, availableMs: clock.availableMs, durationMs: clock.durationMs, ended: clock.ended,
        frozen: clock.frozen, incomplete, rule: mode, hideTotals, pids: columns, rows };
}
