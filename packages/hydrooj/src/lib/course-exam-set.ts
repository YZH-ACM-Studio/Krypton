import { planRoundEntry, readStoredSetConfig, roundPassed, roundPersonalEnd, selectRound } from '@hydrooj/common';
import { Logger } from '@hydrooj/utils';
import type { ObjectId } from 'mongodb';
import { localizedErrorText, ValidationError } from '../error';
import * as contest from '../model/contest';
import { getParticipationMode, isTeamBatchFinalizationPending } from '../model/contest-participation';
import { getTeamByMember } from '../model/contest-team';
import { withContestTeamBoundary } from '../model/contest-team-gate';
import { acknowledgeParticipantStatus, handInRound, participantKey, projectParticipantStatus, readSettledParticipantStatus, settleParticipantRounds } from '../model/set-round';
import { courseCompleteFromSet } from './set-public-score';
import { withSetParticipantBoundary } from './set-participant-boundary';

export { canShowFormalSetScore as canShowFormalCourseScore } from './set-round-score-visible';

const logger = new Logger('course-set-round');

/** Course gates and cards read the same whole-round result as the grade book. */
export async function loadFormalCourseExamState(domainId: string, tid: ObjectId, uid: number, now = new Date()) {
    return withSetParticipantBoundary(domainId, tid, participantKey(uid), async () => {
        const tdoc = await contest.get(domainId, tid);
        const config = readStoredSetConfig(tdoc);
        if (config.publication !== 'published') throw new ValidationError('contest', null, localizedErrorText`请先发布题目集。`);
        const projection = await readSettledParticipantStatus(domainId, tid, uid, null, now);
        const rounds = await settleParticipantRounds(domainId, tid, uid, null, now);
        const current = rounds.find((round) => round.state === 'open') ?? rounds.at(-1) ?? null;
        const chosen = selectRound(config.settings, rounds);
        const entry = planRoundEntry(config.settings, { beginAt: tdoc.beginAt, endAt: tdoc.endAt, now }, rounds);
        const fullWindowRequired = current ? config.settings.retake.requireFullWindow : config.settings.personalLimit.requireFullWindow;
        const startUntil = fullWindowRequired && config.settings.personalLimit.hours !== null
            ? new Date(tdoc.endAt.getTime() - config.settings.personalLimit.hours * 3_600_000) : tdoc.endAt;
        const windowClosed = current ? current.state === 'closed' : now >= tdoc.endAt;
        return {
            tdoc,
            config,
            current,
            chosen,
            projection,
            complete: courseCompleteFromSet(tdoc, projection) === true,
            canRetake: current?.state === 'closed' && entry.action === 'open',
            windowClosed,
            ended: now >= tdoc.endAt || (!current && entry.action === 'deny' && entry.code === 'set_round_window_short'),
            attemptsUsed: rounds.reduce((maximum, round) => Math.max(maximum, round.roundNo), 0),
            entry: {
                canEnter: entry.action !== 'deny',
                windowClosed: entry.action === 'deny' && (windowClosed || entry.code === 'set_round_window_short'),
                closesAt: current?.state === 'open' ? roundPersonalEnd(config.settings, tdoc.endAt, current.startedAt).toISOString() : null,
                nextStartUntil: entry.action === 'open' ? startUntil.toISOString() : null,
            },
        };
    });
}

/** Old privileged and student finalizers close accepted work without reading drafts. */
export async function finalizeFormalSetForUser(domainId: string, tid: ObjectId, uid: number, forced = false, now = new Date()): Promise<void> {
    await withContestTeamBoundary(domainId, tid, async () => {
        const tdoc = await contest.get(domainId, tid);
        const config = readStoredSetConfig(tdoc);
        if (config.publication !== 'published') throw new ValidationError('contest', null, localizedErrorText`请先发布题目集。`);
        if (isTeamBatchFinalizationPending(tdoc)) throw new ValidationError('contestTeamId');
        const team = getParticipationMode(tdoc) === 'team' ? await getTeamByMember(domainId, tid, uid) : null;
        if (getParticipationMode(tdoc) === 'team' && !team) throw new ValidationError('contestTeamId');
        const teamId = team?.teamId ?? null;
        await withSetParticipantBoundary(domainId, tid, participantKey(uid, teamId), async () => {
            const rounds = await settleParticipantRounds(domainId, tid, uid, teamId, now);
            const current = rounds.find((round) => round.state === 'open') ?? rounds.at(-1);
            if (!current) {
                if (!forced) throw new ValidationError('contest', null, localizedErrorText`请先开始作答。`);
                logger.info('formal round finalize skipped domain=%s tid=%s uid=%d stage=unstarted forced=true', domainId, tid.toHexString(), uid);
                return;
            }
            await handInRound(current, forced ? { ...config.settings, earlyHandIn: true } : config.settings, now, tdoc.endAt);
            const projection = await projectParticipantStatus(domainId, tid, uid, teamId);
            await contest.persistSetParticipantStatus(domainId, tid, uid, teamId, projection);
            await acknowledgeParticipantStatus(domainId, tid, uid, teamId);
            logger.info('formal round finalized domain=%s tid=%s uid=%d round=%s forced=%s passed=%s',
                domainId, tid.toHexString(), uid, current._id.toHexString(), forced,
                roundPassed(config.settings, projection.score));
        });
    });
}
