import { randomInt } from 'crypto';
import { ObjectId } from 'mongodb';
import { activePaperPids, effectiveProblemKind, readStoredSetConfig, type ProblemKind } from '@hydrooj/common';
import { Logger } from '@hydrooj/utils';
import { ContestAlreadyAttendedError, localizedErrorText, ValidationError } from '../error';
import { withContestEditBoundary } from '../lib/contest-edit-boundary';
import { parseRoundTid, parseSaveBody } from '../lib/set-answer-request';
import { withSetParticipantBoundary } from '../lib/set-participant-boundary';
import { assertSetParticipation } from '../lib/set-participation-access';
import { loadSetStudentState, setAnswerResponse } from '../lib/set-student-state';
import { confirmVigilContestAttendance } from '../lib/vigil-integration-attendance';
import { PRIV } from '../model/builtin';
import * as contest from '../model/contest';
import { getParticipationMode, isTeamBatchFinalizationPending } from '../model/contest-participation';
import * as contestTeam from '../model/contest-team';
import { withContestTeamBoundary } from '../model/contest-team-gate';
import ProblemModel from '../model/problem';
import { handInRound, openOrResumeRound, participantKey, projectParticipantStatus, readParticipantRound, saveOfficialKind, wasOfficialSaveAccepted } from '../model/set-round';
import { Handler } from '../service/server';

const logger = new Logger('set-answer');

function object(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requestBody(handler: Handler): Record<string, unknown> {
    if (!object(handler.request.body)) throw new ValidationError('body');
    return handler.request.body;
}

function requestedRound(body: Record<string, unknown>): ObjectId {
    if (typeof body.roundId !== 'string' || !/^[0-9a-f]{24}$/i.test(body.roundId)) {
        throw new ValidationError('roundId', null, localizedErrorText`请重新打开当前作答轮次。`);
    }
    return new ObjectId(body.roundId);
}

type Loaded = Awaited<ReturnType<SetRoundHandler['load']>>;

async function persistProjection(loaded: Loaded, changedRoundId: ObjectId) {
    const projection = await projectParticipantStatus(loaded.domainId, loaded.tid, loaded.uid, loaded.contestTeamId, changedRoundId);
    await contest.persistSetParticipantStatus(loaded.domainId, loaded.tid, loaded.uid, loaded.contestTeamId, projection);
}

class SetRoundHandler extends Handler {
    routeId() {
        // Body/query values cannot replace a route's authorization target.
        return parseRoundTid(this.request.params);
    }

    async load(writing: boolean, starting = false) {
        this.checkPriv(PRIV.PRIV_USER_PROFILE);
        const domainId = this.domain._id;
        const tid = this.routeId();
        const tdoc = await contest.get(domainId, tid);
        const config = readStoredSetConfig(tdoc);
        const access = await assertSetParticipation(this, tdoc, writing, false, starting);
        if (isTeamBatchFinalizationPending(tdoc)) throw new ValidationError('round', null, localizedErrorText`队伍还没有定版，不能开始。`);
        let contestTeamId: ObjectId | null = null;
        if (getParticipationMode(tdoc) === 'team') {
            const team = await contestTeam.getTeamByMember(domainId, tid, this.user._id);
            if (!team) throw new ValidationError('round', null, localizedErrorText`你还没有加入队伍。`);
            if (writing && team.captainUid !== this.user._id) throw new ValidationError('team', null, localizedErrorText`请由队长开始、保存或结束团队作答。`);
            contestTeamId = team.teamId;
        }
        return { domainId, tid, tdoc, config, contestTeamId, uid: this.user._id, hasClient: access.hasClient };
    }

    async run<T>(writing: boolean, work: (loaded: Loaded) => Promise<T>, starting = false): Promise<T> {
        const tdoc = await contest.get(this.domain._id, this.routeId());
        const execute = async () => {
            const loaded = await this.load(writing, starting);
            return withSetParticipantBoundary(loaded.domainId, loaded.tid, participantKey(loaded.uid, loaded.contestTeamId), () => work(loaded));
        };
        return getParticipationMode(tdoc) === 'team'
            ? withContestTeamBoundary(this.domain._id, tdoc.docId, execute) : execute();
    }
}

class SetRoundStartHandler extends SetRoundHandler {
    async post() {
        return withContestEditBoundary(this.domain._id, this.routeId(), () => this.run(true, async (loaded) => {
            const { beginAt, endAt } = loaded.tdoc;
            if (!(beginAt instanceof Date) || !(endAt instanceof Date)) throw new ValidationError('time');
            const poolPids = activePaperPids(loaded.tdoc.pids, loaded.tdoc.setPoints);
            const poolKinds = new Map<number, ProblemKind>();
            for (const pid of poolPids) {
                const pdoc = await ProblemModel.get(loaded.domainId, pid, undefined, true);
                if (!pdoc) throw new ValidationError('pid');
                poolKinds.set(pid, effectiveProblemKind(pdoc));
            }
            const round = await openOrResumeRound({
                domainId: loaded.domainId, tid: loaded.tid, uid: loaded.uid, contestTeamId: loaded.contestTeamId,
                settings: loaded.config.settings, beginAt, endAt, now: new Date(), poolPids, poolKinds,
                ...(loaded.tdoc.setPoints ? { issuedWithPaperPoints: true } : {}),
                randomInt: (maxExclusive) => randomInt(maxExclusive),
            });
            const status = await contest.getStatus(loaded.domainId, loaded.tid, loaded.uid);
            if (!status?.attend) {
                try {
                    await contest.attend(loaded.domainId, loaded.tid, loaded.uid);
                } catch (error) {
                    if (!(error instanceof ContestAlreadyAttendedError)) throw error;
                }
                const confirmed = await contest.getStatus(loaded.domainId, loaded.tid, loaded.uid);
                if (!confirmed?.attend) throw new Error(`Problem set attendance was not persisted for ${loaded.domainId}/${loaded.tid}/${loaded.uid}.`);
            }
            if (loaded.hasClient) {
                await confirmVigilContestAttendance(this, loaded.domainId, loaded.tid.toHexString(), loaded.uid, !status?.attend);
            }
            await persistProjection(loaded, round._id);
            logger.info('problem set round start domain=%s tid=%s uid=%d round=%d', loaded.domainId, loaded.tid.toHexString(), loaded.uid, round.roundNo);
            this.response.body = { roundId: round._id.toHexString(), roundNo: round.roundNo,
                paperPids: round.paperPids, startedAt: round.startedAt.toISOString() };
        }, true));
    }
}

class SetRoundSaveHandler extends SetRoundHandler {
    async post() {
        const body = parseSaveBody(requestBody(this));
        return this.run(true, async (loaded) => {
            const request = {
                domainId: loaded.domainId, tid: loaded.tid, uid: loaded.uid, contestTeamId: loaded.contestTeamId,
                roundId: body.roundId, kind: body.kind, operationId: body.operationId, items: body.items,
            };
            try {
                const round = await readParticipantRound(loaded.domainId, loaded.tid, loaded.uid, loaded.contestTeamId, body.roundId);
                if (!round) throw new ValidationError('roundId');
                const saved = await saveOfficialKind({ ...request, round, settings: loaded.config.settings,
                    now: new Date(), finalEnd: loaded.tdoc.endAt });
                await persistProjection(loaded, round._id);
                const state = await loadSetStudentState(loaded.tdoc, loaded.uid, loaded.contestTeamId);
                // A retry acknowledges its own round, never a newer round's answers.
                const matchingDrafts = state.round?._id.equals(round._id)
                    && Object.entries(saved.versions).every(([pid, version]) => state.answers.find((answer) => answer.pid === Number(pid))?.version === version);
                this.response.body = { ...saved, ...(matchingDrafts ? { drafts: state.answers } : {}) };
            } catch (error) {
                // Stay under the participant lock so no same-request writer can be accepted between this check and the response.
                if (await wasOfficialSaveAccepted(request)) throw error;
                const transport = this.resolveErrorTransport(error, 'api');
                logger.error('problem set save rejected domain=%s tid=%s uid=%d round=%s operation=%s error=%s trace=%s',
                    loaded.domainId, loaded.tid, loaded.uid, body.roundId, body.operationId,
                    error instanceof Error ? error.message : String(error), transport.traceId ?? '');
                this.response.body = { accepted: false, error: transport.error };
            }
        });
    }
}

class SetRoundAnswersHandler extends SetRoundHandler {
    async get() {
        return this.run(false, async (loaded) => {
            this.response.body = setAnswerResponse(await loadSetStudentState(loaded.tdoc, loaded.uid, loaded.contestTeamId));
        });
    }
}

class SetRoundHandInHandler extends SetRoundHandler {
    async post() {
        const roundId = requestedRound(requestBody(this));
        return this.run(true, async (loaded) => {
            const round = await readParticipantRound(loaded.domainId, loaded.tid, loaded.uid, loaded.contestTeamId, roundId);
            if (!round) throw new ValidationError('roundId');
            await handInRound(round, loaded.config.settings, new Date(), loaded.tdoc.endAt);
            await persistProjection(loaded, round._id);
            logger.info('problem set hand-in domain=%s tid=%s uid=%d round=%s', loaded.domainId, loaded.tid.toHexString(), loaded.uid, round._id.toHexString());
            this.response.body = { closed: true, roundId: round._id.toHexString() };
        });
    }
}

export async function apply(ctx: { Route: (name: string, path: string, HandlerClass: typeof Handler, priv?: number) => void }) {
    for (const prefix of ['paper', 'homework', 'contest'] as const) {
        ctx.Route(`set_round_start_${prefix}`, `/${prefix}/:tid/round/start`, SetRoundStartHandler, PRIV.PRIV_USER_PROFILE);
        ctx.Route(`set_round_save_${prefix}`, `/${prefix}/:tid/round/save`, SetRoundSaveHandler, PRIV.PRIV_USER_PROFILE);
        ctx.Route(`set_round_answers_${prefix}`, `/${prefix}/:tid/round/answers`, SetRoundAnswersHandler, PRIV.PRIV_USER_PROFILE);
        ctx.Route(`set_round_hand_in_${prefix}`, `/${prefix}/:tid/round/hand-in`, SetRoundHandInHandler, PRIV.PRIV_USER_PROFILE);
    }
}
