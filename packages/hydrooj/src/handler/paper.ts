/**
 * Paper-mode HTTP routes — answer-sheet save/lock/submit/finalize for
 * `exam`-rule contests. Backs the ui-next `/exam-mode/:tid` UI.
 *
 * Auth: normal browser users require `PERM_ATTEND_CONTEST`; Vigil client
 * sessions may enter through the client-bound access gate even when the
 * domain role does not grant the legacy permission.
 * Admin variants (force-submit, force-unlock) live under `handler/admin/`.
 *
 * See PRD §1.6 for submission semantics, §1.8 for the API list.
 */
import { ObjectId } from 'mongodb';
import yaml from 'js-yaml';
import {
    Context, Handler, NotFoundError, OplogModel, param, PERM,
    PermissionError, PRIV, route, Types, UserModel, ValidationError,
} from 'hydrooj';
import {
    PaperDraftModel, ProblemModel, problemFingerprint, spliceFillFunction,
    questionKindMap,
} from 'hydrooj';
import * as contest from '../model/contest';
import * as discussion from '../model/discussion';
import * as document from '../model/document';
import * as record from '../model/record';
import { ContestClientFinishedError } from '../error';
import { closeSessionOnVigil } from '../service/vigil-bridge';
import { ContestProblemListHandler, ContestPrintHandler, ContestScoreboardHandler } from './contest';
import { DiscussionDetailHandler } from './discussion';
import { ProblemDetailHandler } from './problem';
import { RecordDetailHandler } from './record';

class PaperBaseHandler extends Handler {
    tdoc: any;
    tid: ObjectId;

    @param('tid', Types.ObjectId)
    async _prepare(domainId: string, tid: ObjectId) {
        this.tid = tid;
        this.tdoc = await contest.get(domainId, tid);
        if (!this.tdoc) throw new NotFoundError('Contest');
        if (this.tdoc.rule !== 'exam') {
            throw new ValidationError('rule', null, 'Paper mode is only for exam-rule contests');
        }
        // ── Krypton: client-required gate ────────────────────────────
        // Paper mode's _prepare is its own (it doesn't extend
        // ContestDetailBaseHandler), so we apply the same gate here.
        const isAdminBypass = this.user.own(this.tdoc)
            || this.user.hasPerm(PERM.PERM_EDIT_CONTEST)
            || this.user.hasPriv(PRIV.PRIV_EDIT_SYSTEM);
        const hasAttendPerm = this.user.hasPerm(PERM.PERM_ATTEND_CONTEST);
        const vg = (global as any).Hydro?.model?.vigilguard;
        const sid = vg?.clientSessionKeyFromSession
            ? vg.clientSessionKeyFromSession((this as any).session)
            : ((this as any).session?.sessionId || (this as any).session?._id || '');
        const hasClientSession = !isAdminBypass && !!sid && vg?.isValidClientSessionForContest
            ? await vg.isValidClientSessionForContest(sid, domainId, tid, this.user._id)
            : false;

        if (!isAdminBypass && !hasAttendPerm && !hasClientSession) {
            throw new PermissionError(PERM.PERM_ATTEND_CONTEST);
        }

        if (!isAdminBypass) {
            if (vg?.effectiveContestAccess) {
                const result = await vg.effectiveContestAccess(
                    domainId, this.tdoc, this.user._id, sid,
                );
                if (!result.ok) {
                    // Paper UI surfaces the friendly /client-required-notice
                    // redirect through ContestClientRequiredError handling
                    // upstream; falling back to PERM_ATTEND_CONTEST is the
                    // simplest "deny" path here.
                    if (result.reason === 'scope_miss') {
                        throw new PermissionError(PERM.PERM_ATTEND_CONTEST);
                    }
                    if (result.reason === 'client_only') {
                        throw new PermissionError(PERM.PERM_ATTEND_CONTEST);
                    }
                }
            }
        }

        let tsdoc = await contest.getStatus(domainId, tid, this.user._id);
        if (!isAdminBypass && contest.isClientRequired(this.tdoc) && contest.isClientFinished(tsdoc)) {
            throw new ContestClientFinishedError();
        }
        if (!isAdminBypass && contest.isOngoing(this.tdoc, tsdoc)) {
            if (!tsdoc?.attend) {
                try {
                    await contest.attend(domainId, tid, this.user._id, { subscribe: 1 });
                } catch (e) {
                    tsdoc = await contest.getStatus(domainId, tid, this.user._id);
                    if (!tsdoc?.attend) throw e;
                }
                tsdoc = await contest.getStatus(domainId, tid, this.user._id);
            }
            if (tsdoc?.attend && !tsdoc.startAt) {
                await contest.setStatus(domainId, tid, this.user._id, { startAt: new Date() });
            }
        }
    }

    /** Resolve the contest's problem list to {pid, pdoc} map. */
    async getProblemDict(): Promise<Record<number, any>> {
        const pdict: Record<number, any> = {};
        await Promise.all((this.tdoc.pids as number[]).map(async (pid) => {
            const pdoc = await ProblemModel.get(this.tdoc.domainId, pid, undefined, true);
            if (pdoc) pdict[pid] = pdoc;
        }));
        return pdict;
    }

    isInWindow(): boolean {
        const now = Date.now();
        return now >= this.tdoc.beginAt.getTime() && now <= this.tdoc.endAt.getTime();
    }
}

type ExamModeSection = 'overview' | 'problems' | 'announcements' | 'discussion' | 'ranking' | 'print';

function tidOf(tdoc: any) {
    return String(tdoc?.docId || tdoc?._id || '');
}

function examModeContext(tdoc: any, section: ExamModeSection, contentTemplate: string, previewMode = false) {
    const tid = tidOf(tdoc);
    return {
        enabled: true,
        tid,
        section,
        contentTemplate,
        title: tdoc?.title || '',
        rule: tdoc?.rule || '',
        allowPrint: !!tdoc?.allowPrint,
        previewMode,
        // Surfaced so the exam top bar can render a "剩余时间" countdown
        // — see packages/ui-next/src/components/layout/exam-shell.tsx.
        beginAt: tdoc?.beginAt instanceof Date ? tdoc.beginAt.toISOString() : tdoc?.beginAt,
        endAt: tdoc?.endAt instanceof Date ? tdoc.endAt.toISOString() : tdoc?.endAt,
        urls: {
            overview: `/exam-mode/${tid}`,
            problems: `/exam-mode/${tid}/problems`,
            announcements: `/exam-mode/${tid}/announcements`,
            discussion: `/exam-mode/${tid}/discussion`,
            ranking: `/exam-mode/${tid}/ranking`,
            print: `/exam-mode/${tid}/print`,
            problem: `/exam-mode/${tid}/problem/__PID__`,
            record: `/exam-mode/${tid}/record/__RID__`,
            discussionDetail: `/exam-mode/${tid}/discussion/__DID__`,
            discussionCreate: `/exam-mode/${tid}/discussion/create`,
        },
    };
}

/** Resolve the student record for the current viewer, injected so the exam
 *  top bar can render `学号 + 姓名` next to the avatar. */
async function resolveExamModeStudent(handler: any, domainId: string): Promise<{ studentId: string; realName: string } | null> {
    const uid = handler?.user?._id;
    if (!uid) return null;
    const userbind = (global as any).Hydro?.model?.userbind;
    if (!userbind?.findStudentByUserId) return null;
    try {
        const rec = await userbind.findStudentByUserId(domainId, uid);
        if (!rec) return null;
        return {
            studentId: String(rec.studentId || ''),
            realName: String(rec.realName || ''),
        };
    } catch {
        return null;
    }
}

async function decorateExamMode(
    handler: Handler,
    tdoc: any,
    section: ExamModeSection,
    contentTemplate: string,
    previewMode = false,
) {
    handler.response.template = 'exam_contest.html';
    handler.response.body ||= {};
    handler.response.body.tdoc ||= tdoc;
    handler.response.body.previewMode ||= previewMode;
    handler.response.body.currentUserId ||= handler.user?._id;
    const ctx: any = examModeContext(tdoc, section, contentTemplate, previewMode);
    ctx.student = await resolveExamModeStudent(handler, tdoc.domainId);
    handler.response.body.examMode = ctx;
}

async function ensureExamModeAccess(handler: Handler, domainId: string, tid: ObjectId, tdoc: any) {
    const vg = (global as any).Hydro?.model?.vigilguard;
    const sessionKey = vg?.clientSessionKeyFromSession
        ? vg.clientSessionKeyFromSession((handler as any).session)
        : ((handler as any).session?.sessionId || (handler as any).session?._id || '');
    const isAdminBypass = handler.user.own(tdoc)
        || handler.user.hasPerm(PERM.PERM_EDIT_CONTEST)
        || handler.user.hasPriv(PRIV.PRIV_EDIT_SYSTEM);
    let previewMode = false;
    if (isAdminBypass && vg?.currentClientSession) {
        const sess = await vg.currentClientSession(sessionKey);
        previewMode = !sess || !sess.contestId?.equals?.(tdoc.docId);
    }
    if (!isAdminBypass && vg?.effectiveContestAccess) {
        const result = await vg.effectiveContestAccess(domainId, tdoc, handler.user._id, sessionKey);
        if (!result.ok) throw new PermissionError(PERM.PERM_ATTEND_CONTEST);
    }

    let tsdoc = await contest.getStatus(domainId, tid, handler.user._id);
    if (!isAdminBypass && contest.isClientRequired(tdoc) && contest.isClientFinished(tsdoc)) {
        throw new ContestClientFinishedError();
    }
    if (!isAdminBypass && contest.isOngoing(tdoc, tsdoc)) {
        if (!tsdoc?.attend) {
            await contest.attend(domainId, tid, handler.user._id, { subscribe: 1 });
            tsdoc = await contest.getStatus(domainId, tid, handler.user._id);
        }
        if (tsdoc?.attend && !tsdoc.startAt) {
            const startAt = new Date();
            await contest.setStatus(domainId, tid, handler.user._id, { startAt });
            tsdoc.startAt = startAt;
        }
    }
    return { previewMode, tsdoc, isAdminBypass };
}

// ─── Cell + grading helpers ──────────────────────────────────────────────

/** Compute correctness for a single objective question. */
function gradeObjective(
    answerSpec: any, studentAnswer: any,
): 'correct' | 'wrong' | 'partial' {
    if (!Array.isArray(answerSpec)) return 'wrong';
    const expected = answerSpec[0];
    if (Array.isArray(expected)) {
        // Multi-select.
        const exp = [...expected].sort();
        const got = Array.isArray(studentAnswer)
            ? [...studentAnswer].sort()
            : (typeof studentAnswer === 'string' ? [studentAnswer] : []);
        if (exp.length === got.length && exp.every((v, i) => v === got[i])) return 'correct';
        // Partial credit if some expected match but not all
        const setExp = new Set(exp);
        const setGot = new Set(got);
        const inter = [...setExp].filter((v) => setGot.has(v));
        const wrong = [...setGot].filter((v) => !setExp.has(v));
        if (inter.length > 0 && wrong.length === 0) return 'partial';
        return 'wrong';
    }
    // Single-select or blank
    const got = Array.isArray(studentAnswer) ? studentAnswer[0] : studentAnswer;
    if (String(expected).trim() === String(got || '').trim()) return 'correct';
    return 'wrong';
}

async function gradeObjectiveDraft(
    domainId: string, tid: ObjectId, uid: number, pid: number,
    pdoc: any, kindFilter?: string,
): Promise<Record<string, 'correct' | 'wrong' | 'partial'>> {
    const draft = await PaperDraftModel.getDraft(domainId, tid, pid, uid);
    if (!draft) return {};
    const config = typeof pdoc.config === 'object' ? pdoc.config : null;
    const answers = config?.answers || {};
    const kinds = questionKindMap(answers);
    const results: Record<string, 'correct' | 'wrong' | 'partial'> = {};
    for (const [key, kind] of Object.entries(kinds)) {
        if (kindFilter && kind !== kindFilter) continue;
        const studentAnswer = draft.answers?.[key];
        results[key] = gradeObjective(answers[key], studentAnswer);
    }
    if (Object.keys(results).length > 0) {
        await PaperDraftModel.setJudgeResults(domainId, tid, pid, uid, results);
    }
    return results;
}

// ─── GET /api/contests/:tid/paper ─────────────────────────────────────────

class PaperLayoutHandler extends PaperBaseHandler {
    async get({ domainId }: { domainId: string }) {
        const pdict = await this.getProblemDict();
        // Build the cell map: each entry describes one answerable slot.
        const cells: Array<{
            pid: number;
            questionKey: string | null;
            kind: string;
            score: number;
            prompt?: string;
        }> = [];
        for (const pid of this.tdoc.pids as number[]) {
            const pdoc = pdict[pid];
            if (!pdoc) continue;
            const config = typeof pdoc.config === 'object' ? pdoc.config : null;
            const type = config?.type || 'default';
            if (type === 'objective') {
                const kinds = questionKindMap(config?.answers);
                for (const [key, kind] of Object.entries(kinds)) {
                    const score = Array.isArray(config.answers?.[key]) ? config.answers[key][1] : 0;
                    const meta = Array.isArray(config.answers?.[key]) && config.answers[key].length >= 3
                        ? config.answers[key][2]
                        : undefined;
                    cells.push({
                        pid, questionKey: key, kind, score,
                        prompt: meta?.prompt,
                    });
                }
            } else if (type === 'fill_function') {
                cells.push({ pid, questionKey: null, kind: 'fill_function', score: pdoc.score || 100 });
            } else {
                cells.push({ pid, questionKey: null, kind: type === 'submit_answer' ? 'submit_answer' : 'default', score: pdoc.score || 100 });
            }
        }

        // Owner display name.
        let ownerInfo: any = null;
        try {
            const owner = await UserModel.getById(domainId, this.tdoc.owner);
            ownerInfo = owner ? { uid: owner._id, uname: owner.uname } : null;
        } catch {}

        // Broadcasts — clarification entries with owner=0 = admin broadcast.
        let broadcasts: any[] = [];
        try {
            const tcdocs = await (contest as any).getMultiClarification(domainId, this.tid);
            broadcasts = (tcdocs || [])
                .filter((c: any) => c.owner === 0)
                .map((c: any) => ({
                    _id: c._id,
                    content: c.content,
                    createdAt: c._id?.getTimestamp?.() || new Date(),
                    subject: c.subject,
                }))
                .sort((a: any, b: any) => (b.createdAt?.getTime?.() || 0) - (a.createdAt?.getTime?.() || 0));
        } catch {
            broadcasts = [];
        }

        // Scoreboard (best-effort).
        const allowRealtime = !!this.tdoc.realtimeScoreboard;
        const showScoreboard = !this.isInWindow() || allowRealtime;
        let scoreboard: Array<{ rank: number; uid: number; uname: string; realName?: string; studentId?: string; score: number }> = [];
        if (showScoreboard) {
            try {
                const tsdocs = await (contest as any).getMultiStatus(domainId, { docId: this.tid })
                    .sort({ score: -1 }).limit(100).toArray();
                const uids = tsdocs.map((t: any) => t.uid);
                const udict = uids.length > 0
                    ? await UserModel.getListForRender(domainId, uids, false).catch(() => ({}))
                    : {};
                scoreboard = tsdocs.map((t: any, i: number) => {
                    const u = (udict as any)[t.uid] || {};
                    return {
                        rank: i + 1, uid: t.uid, uname: u.uname || `UID ${t.uid}`,
                        realName: u.realName, studentId: u.studentId,
                        score: t.score || 0,
                    };
                });
            } catch {
                scoreboard = [];
            }
        }

        this.response.template = 'exam_paper.html';
        this.response.body = {
            tdoc: this.tdoc,
            pdict,
            cells,
            now: Date.now(),
            inWindow: this.isInWindow(),
            owner: ownerInfo,
            broadcasts,
            scoreboard,
            showScoreboard,
            allowSubmitByKind: !!this.tdoc.allowSubmitByKind,
        };
    }
}

// ─── GET /api/contests/:tid/paper/draft ───────────────────────────────────

class PaperDraftListHandler extends PaperBaseHandler {
    async get({ domainId }: { domainId: string }) {
        const drafts = await PaperDraftModel.getDraftsForUser(domainId, this.tid, this.user._id);
        const pdict = await this.getProblemDict();
        const staleness: Record<string, boolean> = {};
        const recordStatus: Record<string, string> = {};
        for (const draft of drafts) {
            const pdoc = pdict[draft.pid];
            if (!pdoc) continue;
            const config = typeof pdoc.config === 'object' ? pdoc.config : null;
            const currentFp = problemFingerprint(config);
            staleness[draft.pid] = currentFp !== draft.problemFingerprint;
        }

        // Look up most recent record per (tid, uid, pid) for programming-style cells.
        try {
            const rdocs = await (record as any).getUserInProblemMulti(domainId, this.user._id, {
                tid: this.tid, hidden: false,
            }).sort({ _id: -1 }).limit(200).toArray();
            for (const r of (rdocs || [])) {
                if (!recordStatus[String(r.pid)]) {
                    recordStatus[String(r.pid)] = String(r.status || '');
                }
            }
        } catch {}

        this.response.body = { drafts, staleness, recordStatus };
    }
}

// ─── PATCH /api/contests/:tid/paper/draft/:pid ────────────────────────────

class PaperDraftUpsertHandler extends PaperBaseHandler {
    @param('pid', Types.UnsignedInt)
    @param('answers', Types.Content, true)
    @param('code', Types.Content, true)
    @param('lang', Types.Name, true)
    async post(
        { domainId }: { domainId: string },
        pid: number, answersJson?: string, code?: string, lang?: string,
    ) {
        if (!this.isInWindow()) throw new ValidationError('contest', null, 'Contest not in active window');
        if (!(this.tdoc.pids as number[]).includes(pid)) {
            throw new ValidationError('pid', null, 'Problem is not part of this contest');
        }
        const pdoc = await ProblemModel.get(this.tdoc.domainId, pid);
        if (!pdoc) throw new NotFoundError('Problem');

        let parsedAnswers: Record<string, string | string[]> | undefined;
        if (answersJson) {
            try {
                parsedAnswers = JSON.parse(answersJson);
                if (typeof parsedAnswers !== 'object' || parsedAnswers === null) {
                    throw new Error('answers must be an object');
                }
            } catch (e: any) {
                throw new ValidationError('answers', null, e.message);
            }
        }

        const config = typeof pdoc.config === 'object' ? pdoc.config : null;
        const fp = problemFingerprint(config);
        const draft = await PaperDraftModel.upsertDraft(domainId, this.tid, pid, this.user._id, {
            answers: parsedAnswers,
            code,
            lang,
            problemFingerprint: fp,
        });
        this.response.body = { draft, fingerprintChanged: draft.problemFingerprint !== fp };
    }
}

// ─── POST /api/contests/:tid/paper/lock-kind ──────────────────────────────

class PaperLockKindHandler extends PaperBaseHandler {
    @param('kind', Types.Name)
    async post({ domainId }: { domainId: string }, kind: string) {
        if (!['single', 'multi', 'blank', 'fill_program'].includes(kind)) {
            throw new ValidationError('kind');
        }
        if (!this.isInWindow()) throw new ValidationError('contest', null, 'Contest not in active window');
        if (!this.tdoc.allowSubmitByKind) {
            throw new ValidationError(
                'allowSubmitByKind', null,
                'This contest does not allow per-kind submission. Use finalize to submit.',
            );
        }
        await PaperDraftModel.lockKindForUser(domainId, this.tid, this.user._id, kind as any);

        // Immediate grading for that kind across all objective problems.
        const pdict = await this.getProblemDict();
        const aggregateResults: Record<string, Record<string, 'correct' | 'wrong' | 'partial'>> = {};
        for (const pid of this.tdoc.pids as number[]) {
            const pdoc = pdict[pid];
            if (!pdoc) continue;
            const cfg = typeof pdoc.config === 'object' ? pdoc.config : null;
            if (cfg?.type !== 'objective') continue;
            const results = await gradeObjectiveDraft(domainId, this.tid, this.user._id, pid, pdoc, kind);
            if (Object.keys(results).length > 0) aggregateResults[pid] = results;
        }
        await OplogModel.log(this, 'paper.lock_kind', { tid: this.tid, kind });
        this.response.body = { kind, locked: true, judgeResults: aggregateResults };
    }
}

// ─── POST /api/contests/:tid/paper/submit-code/:pid ───────────────────────

class PaperSubmitCodeHandler extends PaperBaseHandler {
    @param('pid', Types.UnsignedInt)
    async post({ domainId }: { domainId: string }, pid: number) {
        if (!this.isInWindow()) throw new ValidationError('contest', null, 'Contest not in active window');
        const pdoc = await ProblemModel.get(this.tdoc.domainId, pid);
        if (!pdoc) throw new NotFoundError('Problem');
        const config = typeof pdoc.config === 'object' ? pdoc.config : null;
        const type = config?.type || 'default';
        if (!['default', 'fill_function'].includes(type)) {
            throw new ValidationError('type', null, 'Only default and fill_function problems support immediate submit');
        }

        const draft = await PaperDraftModel.getDraft(domainId, this.tid, pid, this.user._id);
        if (!draft || !draft.code) {
            throw new ValidationError('draft', null, 'No code saved yet — call save first');
        }
        const lang = draft.lang || (config?.langs?.[0]) || 'cpp';
        const finalCode = draft.code;

        const rid = await record.add(
            domainId, pid, this.user._id, lang, finalCode, true,
            { contest: this.tid, type: 'judge' },
        );
        this.response.body = { rid };
        await OplogModel.log(this, 'paper.submit_code', { tid: this.tid, pid, rid });
    }
}

// ─── POST /api/contests/:tid/paper/finalize ───────────────────────────────

export async function finalizePaperForUser(
    domainId: string,
    tid: ObjectId,
    uid: number,
    options: { tdoc?: any; meta?: any } = {},
): Promise<ObjectId[]> {
    const tdoc = options.tdoc || await contest.get(domainId, tid);
    if (!tdoc) throw new NotFoundError('Contest');
    if (tdoc.rule !== 'exam') return [];

    const drafts = await PaperDraftModel.getDraftsForUser(domainId, tid, uid);
    const pdict: Record<number, any> = {};
    await Promise.all((tdoc.pids as number[] || []).map(async (pid) => {
        const pdoc = await ProblemModel.get(tdoc.domainId, pid, undefined, true);
        if (pdoc) pdict[pid] = pdoc;
    }));

    const rids: ObjectId[] = [];
    const recordMeta = options.meta ? { meta: options.meta } : {};

    for (const draft of drafts) {
        const pdoc = pdict[draft.pid];
        if (!pdoc) continue;
        const config = typeof pdoc.config === 'object' ? pdoc.config : null;
        const type = config?.type || 'default';

        if (type === 'objective') {
            await gradeObjectiveDraft(domainId, tid, uid, draft.pid, pdoc);

            const yamlBody = yaml.dump(draft.answers || {});
            const rid = await record.add(
                domainId, draft.pid, uid, '_', yamlBody, true,
                { contest: tid, type: 'judge', ...recordMeta } as any,
            );
            rids.push(rid);
        } else if (type === 'fill_function') {
            const codeBody = draft.code || JSON.stringify(draft.answers || {});
            const lang = draft.lang || config?.template?.lang || 'cpp';
            const rid = await record.add(
                domainId, draft.pid, uid, lang, codeBody, true,
                { contest: tid, type: 'judge', ...recordMeta } as any,
            );
            rids.push(rid);
        } else if (type === 'default') {
            if (!draft.code) continue;
            const lang = draft.lang || config?.langs?.[0] || 'cpp';
            const rid = await record.add(
                domainId, draft.pid, uid, lang, draft.code, true,
                { contest: tid, type: 'judge', ...recordMeta } as any,
            );
            rids.push(rid);
        } else if (type === 'submit_answer') {
            const codeBody = draft.code || '';
            const rid = await record.add(
                domainId, draft.pid, uid, '_', codeBody, true,
                { contest: tid, type: 'judge', ...recordMeta } as any,
            );
            rids.push(rid);
        }
    }

    for (const rid of rids) {
        await contest.updateStatus(domainId, tid, uid, rid, 0);
    }
    return rids;
}

class PaperFinalizeHandler extends PaperBaseHandler {
    async post({ domainId }: { domainId: string }) {
        const now = Date.now();
        const grace = 60 * 1000;
        if (now > this.tdoc.endAt.getTime() + grace) {
            throw new ValidationError('contest', null, 'Contest finalize window has closed');
        }

        const rids = await finalizePaperForUser(domainId, this.tid, this.user._id, { tdoc: this.tdoc });
        const closedVigilSession = await this.closeVigilClientSession(domainId);
        await OplogModel.log(this, 'paper.finalize', { tid: this.tid, count: rids.length });
        this.response.body = { rids, count: rids.length, closedVigilSession };
    }

    private async closeVigilClientSession(domainId: string): Promise<boolean> {
        const vg = (global as any).Hydro?.model?.vigilguard;
        if (!vg?.currentClientSession) return false;
        const sid = vg.clientSessionKeyFromSession
            ? vg.clientSessionKeyFromSession((this as any).session)
            : ((this as any).session?.sessionId || (this as any).session?._id || '');
        const sess = await vg.currentClientSession(sid);
        if (!sess) return false;
        if (sess.domainId !== domainId || sess.uid !== this.user._id || !sess.contestId?.equals?.(this.tid)) {
            return false;
        }
        try {
            await closeSessionOnVigil(this.tid.toString(), sess.vigilSessionId, 'submitted');
            await vg.deleteClientSessionByVigilSessionId?.(sess.vigilSessionId);
            await OplogModel.log(this, 'vigil.session_close_requested', {
                tid: this.tid, sessionId: sess.vigilSessionId, closeReason: 'submitted',
            });
            return true;
        } catch (e: any) {
            await OplogModel.log(this, 'vigil.session_close_failed', {
                tid: this.tid, sessionId: sess.vigilSessionId, error: e?.message || String(e),
            });
            return false;
        }
    }
}

// ─── GET /exam-mode — home (eligible exams card grid) ────────────────────

class ExamModeHomeHandler extends Handler {
    async prepare() {
        this.checkPriv(PRIV.PRIV_USER_PROFILE);
    }

    /**
     * /exam-mode fallback (DESIGN §10.1 + Q7=c):
     *   - Admins (PRIV_EDIT_SYSTEM / PERM_EDIT_CONTEST): see a list of
     *     vigilEnabled contests they can preview the workspace for.
     *   - Other users: see a short explainer + bind / claim entrances.
     *
     * The "normal" Qt Client flow never lands here — Vigil's
     * `/vigil-launch` redirects straight to `/exam-mode/:tid`.
     */
    async get({ domainId }: { domainId: string }) {
        const isAdmin = this.user.hasPriv(PRIV.PRIV_EDIT_SYSTEM)
            || this.user.hasPerm(PERM.PERM_EDIT_CONTEST);

        let contests: any[] = [];
        if (isAdmin) {
            const cursor = contest.getMulti(domainId, { vigilEnabled: true } as any)
                .sort({ beginAt: -1 }).limit(50);
            const tdocs = await cursor.toArray();
            const now = Date.now();
            contests = tdocs.map((t: any) => ({
                _id: t._id,
                docId: t.docId,
                title: t.title,
                rule: t.rule,
                entryMode: t.entryMode || 'open',
                beginAt: t.beginAt,
                endAt: t.endAt,
                approvalMode: t.approvalMode,
                lockdownMode: !!t.lockdownMode,
                networkLockdownMode: !!t.networkLockdownMode,
                pids: t.pids || [],
                inWindow: t.beginAt.getTime() <= now && now <= t.endAt.getTime(),
            }));
        }

        this.response.template = 'exam_mode_home.html';
        this.response.body = {
            // legacy field for the existing ui-next `/exam-mode` page; tracks
            // the renamed "contests" view (all rules) — old name retained
            // for backward-compat with template references.
            exams: contests,
            contests,
            isAdmin,
            user: {
                name: this.user.uname,
                studentId: (this.user as any).studentId,
                realName: (this.user as any).realName,
            },
        };
    }
}

class ExamModeEntryHandler extends Handler {
    async prepare() {
        this.checkPriv(PRIV.PRIV_USER_PROFILE);
    }

    /**
     * Client workspace entry. Contest-style pages stay under
     * `/exam-mode/:tid/...` so the Qt client never falls back to the normal
     * OJ sidebar. Exam-rule paper answering keeps the existing paper workflow,
     * which already renders without the OJ sidebar.
     */
    @param('tid', Types.ObjectId)
    async get(domainId: string, tid: ObjectId) {
        const tdoc = await contest.get(domainId, tid);
        if (!tdoc) throw new NotFoundError('Contest');
        const { previewMode, isAdminBypass } = await ensureExamModeAccess(this, domainId, tid, tdoc);
        if (tdoc.rule === 'exam') {
            this.response.redirect = this.url('paper_layout', { tid });
            return;
        }

        // Before the start time, the client workspace may be open for check-in,
        // but students must not receive problem ids/titles in the bootstrap JSON.
        const hideProblemsBeforeStart = contest.isNotStarted(tdoc) && !isAdminBypass;
        const workspaceTdoc = hideProblemsBeforeStart
            ? { ...tdoc, pids: [], allowPrint: false }
            : tdoc;

        // Resolve problem dict so the workspace can render the problem list inline.
        const pdict: Record<number, any> = {};
        if (!hideProblemsBeforeStart) {
            await Promise.all((tdoc.pids as number[] || []).map(async (pid) => {
                const pdoc = await ProblemModel.get(tdoc.domainId, pid, undefined, true);
                if (pdoc) pdict[pid] = pdoc;
            }));
        }

        this.response.body = {
            tdoc: workspaceTdoc,
            pdict,
            previewMode,
            currentUserId: this.user._id,
            page_name: 'contest_workspace',
        };
        await decorateExamMode(this, tdoc, 'overview', 'contest_workspace.html', previewMode);
    }
}

/**
 * Common bounce: any /exam-mode sub-page that would touch a not-yet-
 * started contest's data should redirect to the overview rather than
 * letting the inherited base handler throw ContestNotLiveError (which
 * unwraps to the OJ-chrome error page and breaks the exam-shell).
 */
function bounceIfNotStarted(handler: any, tdoc: any, tid: ObjectId): boolean {
    if (tdoc && contest.isNotStarted(tdoc)) {
        handler.response.redirect = `/exam-mode/${tid.toHexString()}`;
        return true;
    }
    return false;
}

class ExamModeProblemListHandler extends ContestProblemListHandler {
    @param('tid', Types.ObjectId)
    async get(domainId: string, tid: ObjectId) {
        const { previewMode, tsdoc } = await ensureExamModeAccess(this, domainId, tid, this.tdoc);
        this.tsdoc = tsdoc;
        if (bounceIfNotStarted(this, this.tdoc, tid)) return;
        await super.get(domainId, tid);
        await decorateExamMode(this, this.tdoc, 'problems', 'contest_problemlist.html', previewMode);
    }
}

class ExamModeAnnouncementsHandler extends ContestProblemListHandler {
    @param('tid', Types.ObjectId)
    async get(domainId: string, tid: ObjectId) {
        const { previewMode, tsdoc } = await ensureExamModeAccess(this, domainId, tid, this.tdoc);
        this.tsdoc = tsdoc;
        if (bounceIfNotStarted(this, this.tdoc, tid)) return;
        await super.get(domainId, tid);
        await decorateExamMode(this, this.tdoc, 'announcements', 'exam_announcements.html', previewMode);
    }
}

class ExamModeProblemDetailHandler extends ProblemDetailHandler {
    @route('pid', Types.ProblemId, true)
    @param('tid', Types.ObjectId)
    async _prepare(domainId: string, pid: number | string, tid?: ObjectId) {
        if (!tid) throw new NotFoundError('Contest');
        const { tsdoc } = await ensureExamModeAccess(this, domainId, tid, this.tdoc);
        this.tsdoc = tsdoc;
        // If the student is *early* (auto-approved, walked in but the
        // contest start hasn't fired yet), `ProblemDetailHandler._prepare`
        // throws ContestNotLiveError → Hydro renders its default error
        // page, which doesn't extend the exam shell → student gets
        // dropped onto the bare OJ chrome. Instead, bounce back to the
        // exam-mode overview which IS wrapped in exam-shell and shows a
        // friendly "等待开始" view.
        if (this.tdoc && contest.isNotStarted(this.tdoc)) {
            this.response.redirect = `/exam-mode/${tid.toHexString()}`;
            return;
        }
        await super._prepare(domainId, pid, tid);
    }

    @param('tid', Types.ObjectId)
    async get(domainId: string, tid: ObjectId) {
        if (this.response.redirect) return;  // _prepare already bounced.
        await super.get(domainId, tid, false);
        const { previewMode } = await ensureExamModeAccess(this, domainId, tid, this.tdoc);
        await decorateExamMode(this, this.tdoc, 'problems', 'problem_detail.html', previewMode);
    }
}

class ExamModeScoreboardHandler extends ContestScoreboardHandler {
    @param('tid', Types.ObjectId)
    @param('view', Types.String, true)
    async get(domainId: string, tid: ObjectId, viewId = 'default') {
        if (bounceIfNotStarted(this, this.tdoc, tid)) return;
        await super.get(domainId, tid, viewId);
        if (this.response.template !== 'contest_scoreboard.html') return;
        const { previewMode } = await ensureExamModeAccess(this, domainId, tid, this.tdoc);
        await decorateExamMode(this, this.tdoc, 'ranking', 'contest_scoreboard.html', previewMode);
    }
}

class ExamModePrintHandler extends ContestPrintHandler {
    @param('tid', Types.ObjectId)
    async prepare({ domainId }, tid: ObjectId) {
        const { tsdoc } = await ensureExamModeAccess(this, domainId, tid, this.tdoc);
        this.tsdoc = tsdoc;
        if (bounceIfNotStarted(this, this.tdoc, tid)) return;
        await super.prepare({ domainId }, tid);
    }

    async get() {
        if (this.response.redirect) return;
        await super.get();
        const tid = this.tdoc.docId;
        const { previewMode } = await ensureExamModeAccess(this, this.tdoc.domainId, tid, this.tdoc);
        await decorateExamMode(this, this.tdoc, 'print', 'contest_print.html', previewMode);
    }
}

class ExamModeRecordDetailHandler extends RecordDetailHandler {
    @param('rid', Types.ObjectId)
    @param('download', Types.Boolean)
    @param('rev', Types.ObjectId, true)
    async get(domainId: string, rid: ObjectId, download = false, rev?: ObjectId) {
        await super.get(domainId, rid, download, rev);
        if (download) return;
        const tid = this.tdoc?.docId;
        if (!this.tdoc || !this.rdoc?.contest?.equals?.(tid)) throw new NotFoundError('Record');
        const { previewMode } = await ensureExamModeAccess(this, domainId, tid, this.tdoc);
        await decorateExamMode(this, this.tdoc, 'problems', 'record_detail.html', previewMode);
    }
}

class ExamModeDiscussionListHandler extends Handler {
    tdoc: any;

    @param('tid', Types.ObjectId)
    async prepare(domainId: string, tid: ObjectId) {
        this.checkPriv(PRIV.PRIV_USER_PROFILE);
        this.checkPerm(PERM.PERM_VIEW_DISCUSSION);
        this.tdoc = await contest.get(domainId, tid);
        if (!this.tdoc) throw new NotFoundError('Contest');
        await ensureExamModeAccess(this, domainId, tid, this.tdoc);
    }

    @param('tid', Types.ObjectId)
    @param('page', Types.PositiveInt, true)
    async get(domainId: string, tid: ObjectId, page = 1) {
        const vnode = await discussion.getVnode(domainId, document.TYPE_CONTEST, tid.toHexString(), this.user._id);
        const hidden = this.user.own(vnode) || this.user.hasPerm(PERM.PERM_EDIT_DISCUSSION) ? {} : { hidden: false };
        const [ddocs, dpcount] = await this.paginate(
            discussion.getMulti(domainId, { parentType: document.TYPE_CONTEST, parentId: tid, ...hidden }),
            page,
            'discussion',
        );
        const uids = ddocs.map((ddoc) => ddoc.owner);
        if (vnode?.owner) uids.push(vnode.owner);
        const udict = uids.length
            ? await UserModel.getListForRender(domainId, uids, this.user.hasPerm(PERM.PERM_VIEW_USER_PRIVATE_INFO))
            : {};
        this.response.body = {
            ddocs,
            dpcount,
            udict,
            page,
            vndict: { [document.TYPE_CONTEST]: { [tid.toHexString()]: vnode } },
            vnode,
            vnodes: [],
            page_name: 'discussion_node',
        };
        await decorateExamMode(this, this.tdoc, 'discussion', 'discussion_main_or_node.html', false);
    }
}

class ExamModeDiscussionCreateHandler extends Handler {
    tdoc: any;
    vnode: any;

    @param('tid', Types.ObjectId)
    async prepare(domainId: string, tid: ObjectId) {
        this.checkPriv(PRIV.PRIV_USER_PROFILE);
        this.checkPerm(PERM.PERM_CREATE_DISCUSSION);
        this.tdoc = await contest.get(domainId, tid);
        if (!this.tdoc) throw new NotFoundError('Contest');
        await ensureExamModeAccess(this, domainId, tid, this.tdoc);
        this.vnode = await discussion.getVnode(domainId, document.TYPE_CONTEST, tid.toHexString(), this.user._id);
    }

    async get() {
        this.response.body = { vnode: this.vnode };
        await decorateExamMode(this, this.tdoc, 'discussion', 'discussion_create.html', false);
    }

    @param('tid', Types.ObjectId)
    @param('title', Types.Title)
    @param('content', Types.Content)
    @param('highlight', Types.Boolean)
    @param('pin', Types.Boolean)
    async post(domainId: string, tid: ObjectId, title: string, content: string, highlight = false, pin = false) {
        await this.limitRate('add_discussion', 3600, 60);
        if (highlight) this.checkPerm(PERM.PERM_HIGHLIGHT_DISCUSSION);
        if (pin) this.checkPerm(PERM.PERM_PIN_DISCUSSION);
        const did = await discussion.add(
            domainId, document.TYPE_CONTEST, tid, this.user._id,
            title, content, this.request.ip, highlight, pin, this.vnode?.hidden ?? false,
        );
        this.response.body = { did };
        this.response.redirect = `/exam-mode/${tid.toHexString()}/discussion/${did.toHexString()}`;
    }
}

class ExamModeDiscussionDetailHandler extends DiscussionDetailHandler {
    tdoc: any;

    @param('tid', Types.ObjectId)
    async prepare(domainId: string, tid: ObjectId) {
        this.tdoc = await contest.get(domainId, tid);
        if (!this.tdoc) throw new NotFoundError('Contest');
        await ensureExamModeAccess(this, domainId, tid, this.tdoc);
        if (this.ddoc?.parentType !== document.TYPE_CONTEST || !(this.ddoc.parentId as any)?.equals?.(tid)) {
            throw new NotFoundError('Discussion');
        }
    }

    @param('did', Types.ObjectId)
    @param('page', Types.PositiveInt, true)
    async get(domainId: string, did: ObjectId, page = 1) {
        await super.get(domainId, did, page);
        await decorateExamMode(this, this.tdoc, 'discussion', 'discussion_detail.html', false);
    }
}

// ─── Route registration ───────────────────────────────────────────────────

export async function apply(ctx: Context) {
    ctx.Route('exam_mode_home', '/exam-mode', ExamModeHomeHandler, PRIV.PRIV_USER_PROFILE);
    ctx.Route('exam_mode_entry', '/exam-mode/:tid', ExamModeEntryHandler, PRIV.PRIV_USER_PROFILE);
    ctx.Route('exam_mode_problems', '/exam-mode/:tid/problems', ExamModeProblemListHandler, PRIV.PRIV_USER_PROFILE);
    ctx.Route('exam_mode_announcements', '/exam-mode/:tid/announcements', ExamModeAnnouncementsHandler, PRIV.PRIV_USER_PROFILE);
    ctx.Route('exam_mode_problem_detail', '/exam-mode/:tid/problem/:pid', ExamModeProblemDetailHandler, PRIV.PRIV_USER_PROFILE);
    await ctx.inject(['scoreboard'], ({ Route }) => {
        Route('exam_mode_ranking', '/exam-mode/:tid/ranking', ExamModeScoreboardHandler, PRIV.PRIV_USER_PROFILE);
        Route('exam_mode_ranking_view', '/exam-mode/:tid/ranking/:view', ExamModeScoreboardHandler, PRIV.PRIV_USER_PROFILE);
    });
    ctx.Route('exam_mode_print', '/exam-mode/:tid/print', ExamModePrintHandler, PRIV.PRIV_USER_PROFILE);
    ctx.Route('exam_mode_record_detail', '/exam-mode/:tid/record/:rid', ExamModeRecordDetailHandler, PRIV.PRIV_USER_PROFILE);
    ctx.Route('exam_mode_discussion', '/exam-mode/:tid/discussion', ExamModeDiscussionListHandler, PRIV.PRIV_USER_PROFILE);
    ctx.Route('exam_mode_discussion_create', '/exam-mode/:tid/discussion/create', ExamModeDiscussionCreateHandler, PRIV.PRIV_USER_PROFILE);
    ctx.Route('exam_mode_discussion_detail', '/exam-mode/:tid/discussion/:did', ExamModeDiscussionDetailHandler, PRIV.PRIV_USER_PROFILE);
    ctx.Route('paper_layout', '/paper/:tid', PaperLayoutHandler, PRIV.PRIV_USER_PROFILE);
    ctx.Route('paper_draft_list', '/paper/:tid/draft', PaperDraftListHandler, PRIV.PRIV_USER_PROFILE);
    ctx.Route('paper_draft_upsert', '/paper/:tid/draft/:pid', PaperDraftUpsertHandler, PRIV.PRIV_USER_PROFILE);
    ctx.Route('paper_lock_kind', '/paper/:tid/lock-kind', PaperLockKindHandler, PRIV.PRIV_USER_PROFILE);
    ctx.Route('paper_submit_code', '/paper/:tid/submit-code/:pid', PaperSubmitCodeHandler, PRIV.PRIV_USER_PROFILE);
    ctx.Route('paper_finalize', '/paper/:tid/finalize', PaperFinalizeHandler, PRIV.PRIV_USER_PROFILE);
}

apply.inject = ['server'] as const;
