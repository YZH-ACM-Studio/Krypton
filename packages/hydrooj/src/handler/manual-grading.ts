import { ObjectId } from 'mongodb';
import { paperProblemMaximum, roundPaperPoints, effectiveProblemKind, type OfficialAnswer } from '@hydrooj/common';
import { Context } from '../context';
import { ContestNotFoundError, localizedErrorText, NotAssignedError, NotFoundError, PermissionError, ValidationError } from '../error';
import type { Tdoc } from '../interface';
import { withContestEditBoundary } from '../lib/contest-edit-boundary';
import { parseProblemConfigObject } from '../lib/problem-config';
import { storedSetConfigOrNull } from '../lib/set-publication';
import { canManageTeachContainer } from '../lib/teach-access';
import { PRIV } from '../model/builtin';
import * as contest from '../model/contest';
import { assertHomeworkAccess } from '../model/homework-access';
import { gradeLatestManualRecord, MANUAL_GRADE_RULES } from '../model/manual-grade';
import problem from '../model/problem';
import record from '../model/record';
import user from '../model/user';
import type { RoundDoc } from '../model/set-round';
import db from '../service/db';
import { Handler, param, Types } from '../service/server';
import { hideAssignRestrictedContest } from './contest';

export class ManualGradingHandler extends Handler {
    tdoc: Tdoc;

    @param('tid', Types.ObjectId)
    async _prepare(_domainId: string, tid: ObjectId) {
        const domainId = String(this.domain?._id);
        this.tdoc = await contest.get(domainId, tid);
        if (!this.tdoc) throw new NotFoundError(localizedErrorText`Contest`);
        const config = storedSetConfigOrNull(this.tdoc);
        if (config) {
            if (!canManageTeachContainer(this.user, config.purpose === 'homework' ? 'homework' : 'exam', this.tdoc)) {
                throw new PermissionError(PRIV.PRIV_EDIT_SYSTEM);
            }
            return;
        }
        if (!MANUAL_GRADE_RULES.includes(this.tdoc.rule as any)) throw new ValidationError('rule');
        if (this.tdoc.owner !== this.user._id && !this.user.hasPriv(PRIV.PRIV_EDIT_SYSTEM)) {
            if (this.tdoc.rule === 'homework') {
                try {
                    await assertHomeworkAccess(domainId, this.tdoc, this.user);
                } catch (error) {
                    if (error instanceof NotAssignedError || (error instanceof Error && error.name === 'NotAssignedError')) {
                        throw new ContestNotFoundError(domainId, tid);
                    }
                    throw error;
                }
            } else {
                await hideAssignRestrictedContest(domainId, this.tdoc, this.user);
            }
            throw new PermissionError(PRIV.PRIV_EDIT_SYSTEM);
        }
    }

    @param('pid', Types.UnsignedInt, true)
    @param('uid', Types.UnsignedInt, true)
    async get(_domainId: string, pid = 0, uid = 0) {
        const domainId = String(this.domain?._id);
        const configured = storedSetConfigOrNull(this.tdoc) !== null;
        const pdocs = (await Promise.all((this.tdoc.pids || []).map((problemId) => problem.get(domainId, problemId, undefined, true)))).filter(
            (pdoc) => pdoc && effectiveProblemKind(pdoc) === 'subjective',
        );
        const problems = pdocs.map((pdoc) => ({
            pid: pdoc.docId,
            title: pdoc.title,
            gradingInstructions: parseProblemConfigObject(pdoc)?.main?.gradingInstructions || '',
        }));
        const selectedPid = pid && problems.some((item) => item.pid === pid) ? pid : problems[0]?.pid;
        const body: any = {
            tdoc: { docId: this.tdoc.docId, title: this.tdoc.title, rule: this.tdoc.rule },
            roundHistory: configured,
            problems,
            pid: selectedPid || 0,
            uid: uid || 0,
            rows: [],
        };
        if (selectedPid) {
            const query: any = { contest: this.tdoc.docId, pid: selectedPid };
            if (configured) {
                Object.assign(query, {
                    setRoundId: { $exists: true },
                    $or: [{ manualPending: true }, { manualGrade: { $exists: true } }],
                });
            }
            if (uid) query.uid = uid;
            const rdocs = await record.getMulti(domainId, query).sort({ _id: -1 }).toArray();
            const roundIds = configured ? [...new Map(rdocs.map((rdoc) => [rdoc.setRoundId.toHexString(), rdoc.setRoundId])).values()] : [];
            const rounds = configured ? await db.collection<RoundDoc>('contest.rounds').find({
                domainId, tid: this.tdoc.docId, _id: { $in: roundIds },
            }).toArray() : [];
            const roundById = new Map(rounds.map((round) => [round._id.toHexString(), round]));
            const official = configured ? await db.collection<OfficialAnswer & { domainId: string; roundId: ObjectId }>('contest.answers')
                .find({ domainId, roundId: { $in: roundIds }, pid: selectedPid }).toArray() : [];
            const officialBodies = new Map(official.map((answer) => [`${answer.rid}:${answer.version}`, answer.body]));
            const latestByUid = new Map<string, (typeof rdocs)[number]>();
            for (const rdoc of rdocs) {
                if (configured && !officialBodies.has(`${rdoc._id.toHexString()}:${rdoc.setAnswerVersion}`)) continue;
                const key = configured ? `${rdoc.setRoundId}:${rdoc.contestTeamId ?? rdoc.uid}` : String(rdoc.uid);
                if (!latestByUid.has(key)) latestByUid.set(key, rdoc);
            }
            if (configured && [...latestByUid.values()].some((rdoc) => !roundById.has(rdoc.setRoundId.toHexString()))) {
                throw new TypeError('manual_round_missing');
            }
            const udict = await user.getListForRender(domainId, [...new Set([...latestByUid.values()].map((rdoc) => rdoc.uid))], false);
            body.rows = [...latestByUid.values()].map((rdoc) => {
                const locked = roundById.get(rdoc.setRoundId?.toHexString())?.legacy?.scoreLocked === true;
                const maximum = configured ? paperProblemMaximum(locked ? { score: this.tdoc.score } : this.tdoc, selectedPid, 100) : 100;
                return {
                    latestRid: String(rdoc._id),
                    uid: rdoc.uid,
                    uname: udict[rdoc.uid]?.uname || `UID ${rdoc.uid}`,
                    displayName: udict[rdoc.uid]?.displayName || '',
                    studentId: udict[rdoc.uid]?.studentId || '',
                    answer: manualAnswerText(configured ? officialBodies.get(`${rdoc._id.toHexString()}:${rdoc.setAnswerVersion}`) : rdoc.code, configured),
                    submittedAt: rdoc.setAcceptedAt ?? rdoc._id.getTimestamp(),
                    ...(configured ? {
                        roundId: rdoc.setRoundId.toHexString(),
                        roundNo: roundById.get(rdoc.setRoundId.toHexString())?.roundNo,
                        answerVersion: rdoc.setAnswerVersion,
                        closedAt: roundById.get(rdoc.setRoundId.toHexString())?.closedAt ?? null,
                        gradingLocked: locked || this.tdoc.setPoints?.[selectedPid]?.excluded === true,
                        excluded: !locked && this.tdoc.setPoints?.[selectedPid]?.excluded === true,
                        paperMax: maximum,
                    } : {}),
                    status: rdoc.status,
                    manualGrade: rdoc.manualGrade ? { ...rdoc.manualGrade, score: roundPaperPoints(rdoc.manualGrade.score / 100 * maximum), maxScore: maximum } : null,
                    expectedRevision: rdoc.manualGrade?.revision || 0,
                };
            });
        }
        this.response.body = body;
        this.response.template = 'manual_grading.html';
    }

    @param('pid', Types.UnsignedInt)
    @param('uid', Types.UnsignedInt)
    @param('latestRid', Types.ObjectId)
    @param('expectedRevision', Types.UnsignedInt)
    @param('score', Types.Float)
    @param('comment', Types.Content, true)
    @param('reason', Types.Content, true)
    @param('paperMax', Types.Float, true)
    async post(_domainId: string, pid: number, uid: number, latestRid: ObjectId, expectedRevision: number, score: number, comment = '', reason = '', paperMax?: number) {
        const domainId = String(this.domain?._id);
        await withContestEditBoundary(domainId, this.tdoc.docId, async () => {
            const current = await contest.get(domainId, this.tdoc.docId);
            const configured = storedSetConfigOrNull(current) !== null;
            const maximum = configured ? paperProblemMaximum(current, pid, 100) : 100;
            if (configured && (current.setPoints?.[pid]?.excluded || maximum !== paperMax || maximum <= 0)) {
                throw new ValidationError('score', null, localizedErrorText`该题计分设置已变化，请刷新批改页。`);
            }
            if (score < 0 || score > maximum || (configured && roundPaperPoints(score) !== score)) throw new ValidationError('score');
            const updated = await gradeLatestManualRecord({
                domainId: String(this.domain?._id),
                tid: this.tdoc.docId,
                pid,
                uid,
                latestRid,
                expectedRevision,
                score: configured ? score / maximum * 100 : score,
                comment,
                reason,
                actor: this.user._id,
            });
            this.response.body = {
                ok: true,
                latestRid: String(updated._id),
                manualGrade: { ...updated.manualGrade, score, maxScore: maximum },
                status: updated.status,
                score,
            };
        });
    }
}

function manualAnswerText(answers: unknown, configured: boolean): string {
    if (!configured) {
        if (typeof answers !== 'string') throw new TypeError('manual_answer_missing');
        return answers;
    }
    if (!answers || typeof answers !== 'object' || Array.isArray(answers)
        || Object.values(answers).some((answer) => typeof answer !== 'string')) throw new TypeError('manual_answer_invalid');
    const entries = Object.entries(answers);
    return entries.length === 1 ? entries[0][1] : entries.map(([key, value]) => `${key}\n${value}`).join('\n\n');
}

export async function apply(ctx: Context) {
    ctx.Route('manual_grading', '/manage/grading/:tid', ManualGradingHandler);
}
