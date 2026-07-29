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
import yaml from 'js-yaml';
import { ObjectId } from 'mongodb';
import { effectiveProblemKind, gradeObjectiveAnswer } from '@hydrooj/common';
import { Logger } from '@hydrooj/utils';
import {
    localizeErrorParameter,
    localizedErrorText,
    clientProblemConfig,
    Context,
    Handler,
    getProblemConfigErrorText,
    NotFoundError,
    OplogModel,
    PaperDraftModel,
    param,
    parseProblemConfigObject,
    parseStructuredRegionSubmission,
    PERM,
    PermissionError,
    PRIV,
    problemFingerprint,
    ProblemModel,
    questionKindMap,
    route,
    type LocalizedErrorText,
    Types,
    UserModel,
    validateCompiledStructuredConfig,
    validateStructuredCodeJudgeConfig,
    ValidationError,
} from 'hydrooj';
import { ContestClientFinishedError, ContestNotLiveError, ContestTeamConflictError } from '../error';
import { getPostContestPracticeState, isPostContestPracticeRule } from '../lib/contest-correction';
import { buildExamModeRecordCodePayload } from '../lib/exam-mode-record';
import * as contest from '../model/contest';
import * as contestTeam from '../model/contest-team';
import type { ContestTeamExamModeContext } from '../model/contest-team';
import * as contestTeamCode from '../model/contest-team-code';
import * as discussion from '../model/discussion';
import * as document from '../model/document';
import { markManualPending } from '../model/manual-grade';
import record from '../model/record';
import { ConnectionHandler, subscribe } from '../service/server';
import { closeSessionOnVigil } from '../service/vigil-bridge';
import { ContestPrintHandler, ContestProblemListHandler, ContestScoreboardHandler } from './contest';
import { DiscussionDetailHandler } from './discussion';
import { ProblemDetailHandler } from './problem';
import { RecordDetailHandler } from './record';

/**
 * Exam-mode renders problem statements inside ui-next at deep routes such as
 * `/exam-mode/:tid/problem/:pid`. The classic ProblemDetailHandler rewrites
 * `file://name` image attachments to the *relative* `./<docId>/file/name`,
 * which only resolves at the shallow `/p/:pid` depth — under the exam-mode URL
 * it resolves to `/exam-mode/:tid/problem/<docId>/file/name` and 404s, so the
 * problem images vanish. JSON / client-side navigations skip that rewrite
 * entirely and leave a raw `file://` src, which also can't load. And the paper
 * answer-sheet's getProblemDict() reads raw pdocs that are never rewritten.
 * Normalise BOTH forms to an absolute, domain-correct file URL so images render
 * regardless of page depth or load type.
 */
function absolutizeProblemFileUrls(handler: Handler, content: string, pdoc: any, tid: ObjectId | string): string {
    if (!content || !pdoc) return content;
    const docId = pdoc.docId;
    const tidHex = typeof tid === 'string' ? tid : tid.toHexString();
    // Absolute, domain-aware base, e.g. "/p/123/file/" or "/d/x/p/123/file/".
    // A plain alnum placeholder isn't URL-encoded by handler.url, so slicing it
    // back off yields a clean prefix.
    const ph = 'KRYPTONFILEPH';
    const sample = handler.url('problem_file_download', { pid: docId, filename: ph });
    const absBase = sample.slice(0, sample.lastIndexOf(ph));
    const withTid = (url: string) => `${url}${url.includes('?') ? '&' : '?'}tid=${tidHex}`;
    // 1) raw file:// — JSON-load path + getProblemDict's untouched raw pdoc.
    let out = content.replace(/file:\/\/([^ \n)\\"]+)/g, (str: string, fileinfo: string) => {
        let filename = fileinfo.split('?')[0];
        try {
            filename = decodeURIComponent(filename);
        } catch {
            /* keep encoded */
        }
        if (!pdoc.additional_file?.find((i: any) => i.name === filename)) return str;
        return withTid(`${absBase}${fileinfo}`);
    });
    // 2) relative ./<docId>/file/ — non-JSON path where super.get() already
    //    rewrote (and already appended ?tid=); only swap the prefix.
    const relPrefix = `./${docId}/file/`;
    if (out.includes(relPrefix)) out = out.split(relPrefix).join(absBase);
    return out;
}

function absolutizeProgrammingStatementFileUrls(handler: Handler, view: any, pdoc: any, tid: ObjectId | string): void {
    if (!view) return;
    for (const section of ['background', 'description', 'input', 'output', 'hints']) {
        if (typeof view[section]?.content === 'string') {
            view[section].content = absolutizeProblemFileUrls(handler, view[section].content, pdoc, tid);
        }
    }
    for (const item of view.examples?.items || []) {
        if (typeof item.note === 'string') item.note = absolutizeProblemFileUrls(handler, item.note, pdoc, tid);
    }
}

/**
 * pdoc.config 统一解析（见 lib/problem-config.ts parseProblemConfigObject）。
 * 此前 `typeof pdoc.config === 'object'` 的判断对字符串永远为 false，
 * objective/structured-code 的 cells 构建与 finalize 分流在生产从未生效
 * （PLAN P3.2 修复）。完整对象含标准答案，**只许服务端用**；发给
 * 客户端一律经 clientProblemConfig 净化。
 */
const parsedProblemConfig = parseProblemConfigObject;
const logger = new Logger('paper');

function localizedConfigValidation(field: string, detail: LocalizedErrorText) {
    return new ValidationError(field, null, detail);
}

function validatePaperRegionSubmission(
    pdoc: any,
    config: any,
    rawCode: string | undefined,
    context: { domainId: string; tid: ObjectId; uid: number; stage: string },
) {
    const effectiveKind = effectiveProblemKind(pdoc);
    if (!['program_fill', 'function'].includes(effectiveKind)) throw new ValidationError('problemKind');
    const kind = effectiveKind as 'program_fill' | 'function';
    try {
        validateStructuredCodeJudgeConfig(config, kind);
        validateCompiledStructuredConfig(effectiveKind, config);
        if (typeof rawCode !== 'string') throw new Error(`${kind}: region payload is required`);
        parseStructuredRegionSubmission(kind, config.template, rawCode);
    } catch (error: any) {
        logger.error(
            'Paper structured submission rejected stage=%s domain=%s tid=%s pid=%d kind=%s revision=%s uid=%d error=%o',
            context.stage,
            context.domainId,
            context.tid,
            pdoc.docId,
            kind,
            pdoc.structureRevision,
            context.uid,
            error,
        );
        const localizedDetail =
            error instanceof Error && error.message === `${kind}: region payload is required`
                ? localizedErrorText`${kind}: region payload is required`
                : getProblemConfigErrorText(error);
        if (localizedDetail) throw localizedConfigValidation('code', localizedDetail);
        throw localizeErrorParameter(new ValidationError('code', null, error.message), 2, 'The structured answer is invalid: {0}', error.message);
    }
    return { code: rawCode, lang: kind === 'program_fill' && config.mode === 'text' ? '_' : (config.template.lang as string) };
}

class PaperBaseHandler extends Handler {
    tdoc: any;
    tid: ObjectId;

    @param('tid', Types.ObjectId)
    async _prepare(_domainId: string, tid: ObjectId) {
        const authoritativeDomainId = String(this.domain?._id);
        this.tid = tid;
        this.tdoc = await contest.get(authoritativeDomainId, tid);
        if (!this.tdoc) throw new NotFoundError(localizedErrorText`Contest`);
        if (this.tdoc.rule !== 'exam') {
            throw new ValidationError('rule', null, localizedErrorText`Paper mode is only for exam-rule contests`);
        }
        // ── Krypton: client-required gate ────────────────────────────
        // Paper mode's _prepare is its own (it doesn't extend
        // ContestDetailBaseHandler), so we apply the same gate here.
        const isAdminBypass = this.user.own(this.tdoc) || this.user.hasPerm(PERM.PERM_EDIT_CONTEST) || this.user.hasPriv(PRIV.PRIV_EDIT_SYSTEM);
        const hasAttendPerm = this.user.hasPerm(PERM.PERM_ATTEND_CONTEST);
        const vg = (global as any).Hydro?.model?.vigilguard;
        const sid = vg?.clientSessionKeyFromSession
            ? vg.clientSessionKeyFromSession((this as any).session)
            : (this as any).session?.sessionId || (this as any).session?._id || '';
        const hasClientSession =
            !isAdminBypass && sid && vg?.isValidClientSessionForContest
                ? await vg.isValidClientSessionForContest(sid, authoritativeDomainId, tid, this.user._id)
                : false;

        if (!isAdminBypass && !hasAttendPerm && !hasClientSession) {
            throw new PermissionError(PERM.PERM_ATTEND_CONTEST);
        }

        if (!isAdminBypass) {
            if (vg?.effectiveContestAccess) {
                const result = await vg.effectiveContestAccess(authoritativeDomainId, this.tdoc, this.user._id, sid);
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

        let tsdoc = await contest.getStatus(authoritativeDomainId, tid, this.user._id);
        if (!isAdminBypass && contest.isClientRequired(this.tdoc) && contest.isClientFinished(tsdoc)) {
            throw new ContestClientFinishedError();
        }
        if (!isAdminBypass && contest.isOngoing(this.tdoc, tsdoc)) {
            if (!tsdoc?.attend) {
                try {
                    await contest.attend(authoritativeDomainId, tid, this.user._id, { subscribe: 1 });
                } catch (e) {
                    tsdoc = await contest.getStatus(authoritativeDomainId, tid, this.user._id);
                    if (!tsdoc?.attend) throw e;
                }
                tsdoc = await contest.getStatus(authoritativeDomainId, tid, this.user._id);
            }
            if (tsdoc?.attend && !tsdoc.startAt) {
                await contest.setStatus(authoritativeDomainId, tid, this.user._id, { startAt: new Date() });
            }
        }
    }

    /** Resolve the contest's problem list to {pid, pdoc} map. */
    async getProblemDict(): Promise<Record<number, any>> {
        const authoritativeDomainId = String(this.domain?._id);
        const pdict: Record<number, any> = {};
        await Promise.all(
            (this.tdoc.pids as number[]).map(async (pid) => {
                const pdoc = await ProblemModel.get(authoritativeDomainId, pid, undefined, true);
                if (!pdoc) return;
                // Raw pdoc → file:// image attachments are never rewritten; make them
                // absolute so they load under the deep /exam-mode/:tid/... routes.
                if (typeof pdoc.content === 'string') {
                    pdoc.content = absolutizeProblemFileUrls(this, pdoc.content, pdoc, this.tdoc.docId);
                }
                // 考试上下文不得下发原赛通过率（难度提示）——public 投影会带上它。
                delete pdoc.origStat;
                // 统一解析为完整 config 对象（服务端内部用；含标准答案）。
                pdoc.config = parsedProblemConfig(pdoc);
                pdict[pid] = pdoc;
            }),
        );
        return pdict;
    }

    /**
     * pdict 的客户端安全版：config 换成净化子集。原始 config 含
     * answers（标准答案），一旦考试里挂客观题会把答案直接发给考生
     * —— 任何 response.body 里的 pdict 必须走这里。
     */
    sanitizePdictForClient(pdict: Record<number, any>): Record<number, any> {
        const out: Record<number, any> = {};
        for (const [pid, pdoc] of Object.entries(pdict)) {
            out[pid] = { ...pdoc, config: clientProblemConfig(pdoc.config) };
        }
        return out;
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

function examModeContext(
    tdoc: any,
    section: ExamModeSection,
    contentTemplate: string,
    previewMode = false,
    teamContext: ContestTeamExamModeContext | null = null,
) {
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
            ...(teamContext ? { teamCodeSnapshots: `/exam-mode/${tid}/team-code` } : {}),
        },
        ...(teamContext || {}),
    };
}

async function resolveExamModeTeamContext(
    handler: Handler | ConnectionHandler,
    domainId: string,
    tdoc: any,
    isAdminBypass: boolean,
): Promise<ContestTeamExamModeContext | null> {
    if (contest.getParticipationMode(tdoc) !== 'team' || tdoc.rule !== 'acm') return null;
    const team = await contestTeam.getTeamByMember(domainId, tdoc.docId, handler.user._id);
    return contestTeam.buildExamModeTeamContext(team, handler.user._id, isAdminBypass);
}

/**
 * Resolve the student record for the current viewer, injected so the exam
 *  top bar can render `学号 + 姓名` next to the avatar.
 */
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
    teamContext: ContestTeamExamModeContext | null = null,
) {
    handler.response.template = 'exam_contest.html';
    handler.response.body ||= {};
    handler.response.body.tdoc ||= tdoc;
    handler.response.body.previewMode ||= previewMode;
    handler.response.body.currentUserId ||= handler.user?._id;
    const ctx: any = examModeContext(tdoc, section, contentTemplate, previewMode, teamContext);
    ctx.student = await resolveExamModeStudent(handler, tdoc.domainId);
    handler.response.body.examMode = ctx;
}

async function ensureExamModeAccess(handler: Handler | ConnectionHandler, domainId: string, tid: ObjectId, tdoc: any) {
    const vg = (global as any).Hydro?.model?.vigilguard;
    const sessionKey = vg?.clientSessionKeyFromSession
        ? vg.clientSessionKeyFromSession((handler as any).session)
        : (handler as any).session?.sessionId || (handler as any).session?._id || '';
    const isAdminBypass = handler.user.own(tdoc) || handler.user.hasPerm(PERM.PERM_EDIT_CONTEST) || handler.user.hasPriv(PRIV.PRIV_EDIT_SYSTEM);
    let previewMode = false;
    if (isAdminBypass && vg?.currentClientSession) {
        const sess = await vg.currentClientSession(sessionKey);
        previewMode = !sess || !sess.contestId?.equals?.(tdoc.docId);
    }
    if (!isAdminBypass && vg?.effectiveContestAccess) {
        const result = await vg.effectiveContestAccess(domainId, tdoc, handler.user._id, sessionKey);
        if (!result.ok) throw new PermissionError(PERM.PERM_ATTEND_CONTEST);
    }

    const teamContext = await resolveExamModeTeamContext(handler, domainId, tdoc, isAdminBypass);

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
    return { previewMode, tsdoc, isAdminBypass, teamContext };
}

async function redirectEndedProgrammingWorkspaceBeforeClientAccess(handler: Handler, domainId: string, tdoc: any, tid: ObjectId): Promise<boolean> {
    const isAdminBypass = handler.user.own(tdoc) || handler.user.hasPerm(PERM.PERM_EDIT_CONTEST) || handler.user.hasPriv(PRIV.PRIV_EDIT_SYSTEM);
    if (isAdminBypass || !isPostContestPracticeRule(tdoc?.rule) || !(tdoc?.endAt instanceof Date) || new Date() < tdoc.endAt) {
        return false;
    }
    const tsdoc = await contest.getStatus(domainId, tid, handler.user._id);
    return redirectEndedProgrammingWorkspace(handler, tdoc, tsdoc, tid, false);
}

// ─── Cell + grading helpers ──────────────────────────────────────────────

/** Compute correctness for a single objective question. */
function gradeObjective(answerSpec: any, studentAnswer: any): 'correct' | 'wrong' | 'partial' {
    return gradeObjectiveAnswer(answerSpec, studentAnswer).outcome;
}

async function gradeObjectiveDraft(
    domainId: string,
    tid: ObjectId,
    uid: number,
    pid: number,
    pdoc: any,
    kindFilter?: string,
): Promise<Record<string, 'correct' | 'wrong' | 'partial'>> {
    const draft = await PaperDraftModel.getDraft(domainId, tid, pid, uid);
    if (!draft) return {};
    const config = parsedProblemConfig(pdoc);
    const answers = config?.answers || {};
    const kinds = questionKindMap(answers);
    const results: Record<string, 'correct' | 'wrong' | 'partial'> = {};
    for (const [key, kind] of Object.entries(kinds)) {
        if (kindFilter && kind !== kindFilter) continue;
        // 主观题（Rev.12）不做即时判分——由比赛「阅卷」人工给分。
        if (kind === 'subjective') continue;
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
            const config = pdoc.config; // getProblemDict 已解析为完整对象
            const type = config?.type || 'default';
            if (type === 'objective') {
                const kinds = questionKindMap(config?.answers);
                for (const [key, kind] of Object.entries(kinds)) {
                    const score = Array.isArray(config.answers?.[key]) ? config.answers[key][1] : 0;
                    const meta = Array.isArray(config.answers?.[key]) && config.answers[key].length >= 3 ? config.answers[key][2] : undefined;
                    cells.push({
                        pid,
                        questionKey: key,
                        kind,
                        score,
                        prompt: meta?.prompt,
                    });
                }
            } else if (['program_fill', 'function'].includes(type)) {
                const kind = effectiveProblemKind(pdoc);
                cells.push({
                    pid,
                    questionKey: null,
                    kind: kind === 'program_fill' ? (config.mode === 'compile' ? 'program_fill_compile' : 'program_fill_text') : 'function',
                    score: pdoc.score || 100,
                });
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
                const tsdocs = await (contest as any).getMultiStatus(domainId, { docId: this.tid }).sort({ score: -1 }).limit(100).toArray();
                const uids = tsdocs.map((t: any) => t.uid);
                const udict = uids.length > 0 ? await UserModel.getListForRender(domainId, uids, false).catch(() => ({})) : {};
                scoreboard = tsdocs.map((t: any, i: number) => {
                    const u = (udict as any)[t.uid] || {};
                    return {
                        rank: i + 1,
                        uid: t.uid,
                        uname: u.uname || `UID ${t.uid}`,
                        realName: u.realName,
                        studentId: u.studentId,
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
            pdict: this.sanitizePdictForClient(pdict),
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
            const currentFp = problemFingerprint(pdoc.config); // getProblemDict 已解析
            staleness[draft.pid] = currentFp !== draft.problemFingerprint;
        }

        // Look up most recent record per (tid, uid, pid) for programming-style cells.
        try {
            const rdocs = await (record as any)
                .getUserInProblemMulti(domainId, this.user._id, {
                    tid: this.tid,
                    hidden: false,
                })
                .sort({ _id: -1 })
                .limit(200)
                .toArray();
            for (const r of rdocs || []) {
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
    async post({ domainId }: { domainId: string }, pid: number, answersJson?: string, code?: string, lang?: string) {
        if (!this.isInWindow()) throw new ValidationError('contest', null, localizedErrorText`Contest not in active window`);
        if (!(this.tdoc.pids as number[]).includes(pid)) {
            throw new ValidationError('pid', null, localizedErrorText`Problem is not part of this contest`);
        }
        // rawConfig=true + 自行解析：与 getProblemDict/finalize 的指纹口径
        // 一致（默认投影拿到的是 parseConfig 净化摘要，不含 answers，
        // 指纹永远对不上 —— 既有 bug，PLAN P3.2 一并修复）。
        const pdoc = await ProblemModel.get(this.tdoc.domainId, pid, undefined, true);
        if (!pdoc) throw new NotFoundError(localizedErrorText`Problem`);

        let parsedAnswers: Record<string, string | string[]> | undefined;
        if (answersJson) {
            try {
                parsedAnswers = JSON.parse(answersJson);
            } catch (e: any) {
                throw localizeErrorParameter(
                    new ValidationError('answers', null, e.message),
                    2,
                    'The answer data could not be parsed: {0}',
                    e.message,
                );
            }
            if (typeof parsedAnswers !== 'object' || parsedAnswers === null) {
                throw new ValidationError('answers', null, localizedErrorText`answers must be an object`);
            }
        }

        const config = parsedProblemConfig(pdoc);
        if (['program_fill', 'function'].includes(config?.type)) {
            const validated = validatePaperRegionSubmission(pdoc, config, code, {
                domainId,
                tid: this.tid,
                uid: this.user._id,
                stage: 'draft-save',
            });
            code = validated.code;
            lang = validated.lang;
        }
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
        if (!['single', 'multi', 'blank', 'fill_program', 'subjective'].includes(kind)) {
            throw new ValidationError('kind');
        }
        if (!this.isInWindow()) throw new ValidationError('contest', null, localizedErrorText`Contest not in active window`);
        if (!this.tdoc.allowSubmitByKind) {
            throw new ValidationError(
                'allowSubmitByKind',
                null,
                localizedErrorText`This contest does not allow per-kind submission. Use finalize to submit.`,
            );
        }
        const pdict = await this.getProblemDict();
        await PaperDraftModel.lockKindForUser(domainId, this.tid, this.user._id, kind as any);

        // Immediate grading for that kind across all objective problems.
        const aggregateResults: Record<string, Record<string, 'correct' | 'wrong' | 'partial'>> = {};
        for (const pid of this.tdoc.pids as number[]) {
            const pdoc = pdict[pid];
            if (!pdoc) continue;
            const cfg = pdoc.config; // getProblemDict 已解析
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
        if (!this.isInWindow()) throw new ValidationError('contest', null, localizedErrorText`Contest not in active window`);
        const pdoc = await ProblemModel.get(this.tdoc.domainId, pid, undefined, true);
        if (!pdoc) throw new NotFoundError(localizedErrorText`Problem`);
        const config = parsedProblemConfig(pdoc);
        const type = config?.type || 'default';
        if (!['default', 'program_fill', 'function'].includes(type)) {
            throw new ValidationError('type', null, localizedErrorText`Only default and structured-code problems support immediate submit`);
        }

        const draft = await PaperDraftModel.getDraft(domainId, this.tid, pid, this.user._id);
        if (!draft || !draft.code) {
            throw new ValidationError('draft', null, localizedErrorText`No code saved yet — call save first`);
        }
        const validated = ['program_fill', 'function'].includes(type)
            ? validatePaperRegionSubmission(pdoc, config, draft.code, {
                  domainId,
                  tid: this.tid,
                  uid: this.user._id,
                  stage: 'immediate-submit',
              })
            : null;
        const lang = validated?.lang || draft.lang || config?.langs?.[0] || 'cpp';
        const finalCode = validated?.code || draft.code;

        const rid = await record.add(domainId, pid, this.user._id, lang, finalCode, true, { contest: this.tid, type: 'judge' });
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
    const tdoc = options.tdoc || (await contest.get(domainId, tid));
    if (!tdoc) throw new NotFoundError(localizedErrorText`Contest`);
    if (tdoc.rule !== 'exam') return [];

    const drafts = await PaperDraftModel.getDraftsForUser(domainId, tid, uid);
    const pdict: Record<number, any> = {};
    await Promise.all(
        ((tdoc.pids as number[]) || []).map(async (pid) => {
            const pdoc = await ProblemModel.get(tdoc.domainId, pid, undefined, true);
            if (pdoc) pdict[pid] = pdoc;
        }),
    );
    const rids: ObjectId[] = [];
    const manualRids = new Set<string>();
    const recordMeta = options.meta ? { meta: options.meta } : {};

    for (const draft of drafts) {
        const pdoc = pdict[draft.pid];
        if (!pdoc) continue;
        const config = parsedProblemConfig(pdoc);
        const type = config?.type || 'default';

        if (type === 'objective') {
            const isSubjective = effectiveProblemKind(pdoc) === 'subjective';
            if (!isSubjective) await gradeObjectiveDraft(domainId, tid, uid, draft.pid, pdoc);
            const rawSubjectiveAnswer = draft.answers?.main;
            if (isSubjective && rawSubjectiveAnswer !== undefined && typeof rawSubjectiveAnswer !== 'string') {
                throw new ValidationError('answer', null, localizedErrorText`主观题答案必须是文本`);
            }
            const code = isSubjective ? (rawSubjectiveAnswer as string | undefined) || '' : yaml.dump(draft.answers || {});
            const rid = await record.add(domainId, draft.pid, uid, '_', code, true, {
                contest: tid,
                type: isSubjective ? 'manual' : 'judge',
                ...recordMeta,
            } as any);
            if (isSubjective) {
                manualRids.add(String(rid));
                await markManualPending({ domainId, tid, pid: draft.pid, uid, rid });
            }
            rids.push(rid);
        } else if (['program_fill', 'function'].includes(type)) {
            const validated = validatePaperRegionSubmission(pdoc, config, draft.code, {
                domainId,
                tid,
                uid,
                stage: 'finalize',
            });
            const rid = await record.add(domainId, draft.pid, uid, validated.lang, validated.code, true, {
                contest: tid,
                type: 'judge',
                ...recordMeta,
            } as any);
            rids.push(rid);
        } else if (type === 'default') {
            if (!draft.code) continue;
            const lang = draft.lang || config?.langs?.[0] || 'cpp';
            const rid = await record.add(domainId, draft.pid, uid, lang, draft.code, true, { contest: tid, type: 'judge', ...recordMeta } as any);
            rids.push(rid);
        } else if (type === 'submit_answer') {
            const codeBody = draft.code || '';
            const rid = await record.add(domainId, draft.pid, uid, '_', codeBody, true, { contest: tid, type: 'judge', ...recordMeta } as any);
            rids.push(rid);
        }
    }

    for (const rid of rids) {
        if (manualRids.has(String(rid))) continue;
        await contest.updateStatus(domainId, tid, uid, rid, 0);
    }
    return rids;
}

class PaperFinalizeHandler extends PaperBaseHandler {
    async post({ domainId }: { domainId: string }) {
        const now = Date.now();
        const grace = 60 * 1000;
        if (now > this.tdoc.endAt.getTime() + grace) {
            throw new ValidationError('contest', null, localizedErrorText`Contest finalize window has closed`);
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
            : (this as any).session?.sessionId || (this as any).session?._id || '';
        const sess = await vg.currentClientSession(sid);
        if (!sess) return false;
        if (sess.domainId !== domainId || sess.uid !== this.user._id || !sess.contestId?.equals?.(this.tid)) {
            return false;
        }
        try {
            await closeSessionOnVigil(this.tid.toString(), sess.vigilSessionId, 'submitted');
            await vg.deleteClientSessionByVigilSessionId?.(sess.vigilSessionId);
            await OplogModel.log(this, 'vigil.session_close_requested', {
                tid: this.tid,
                sessionId: sess.vigilSessionId,
                closeReason: 'submitted',
            });
            return true;
        } catch (e: any) {
            await OplogModel.log(this, 'vigil.session_close_failed', {
                tid: this.tid,
                sessionId: sess.vigilSessionId,
                error: e?.message || String(e),
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
    async get(_args: { domainId?: string }) {
        const authoritativeDomainId = String(this.domain?._id);
        const isAdmin = this.user.hasPriv(PRIV.PRIV_EDIT_SYSTEM) || this.user.hasPerm(PERM.PERM_EDIT_CONTEST);

        let contests: any[] = [];
        if (isAdmin) {
            const cursor = contest
                .getMulti(authoritativeDomainId, { vigilEnabled: true } as any)
                .sort({ beginAt: -1 })
                .limit(50);
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
    async get(_domainId: string, tid: ObjectId) {
        const authoritativeDomainId = String(this.domain?._id);
        const tdoc = await contest.get(authoritativeDomainId, tid);
        if (!tdoc) throw new NotFoundError(localizedErrorText`Contest`);
        if (await redirectEndedProgrammingWorkspaceBeforeClientAccess(this, authoritativeDomainId, tdoc, tid)) return;
        const { previewMode, tsdoc, isAdminBypass, teamContext } = await ensureExamModeAccess(this, authoritativeDomainId, tid, tdoc);
        if (tdoc.rule === 'exam') {
            this.response.redirect = this.url('paper_layout', { tid });
            return;
        }
        if (redirectEndedProgrammingWorkspace(this, tdoc, tsdoc, tid, isAdminBypass)) return;

        // Before the start time, the client workspace may be open for check-in,
        // but students must not receive problem ids/titles in the bootstrap JSON.
        const hideProblemsBeforeStart = contest.isNotStarted(tdoc) && !isAdminBypass;
        const workspaceTdoc = hideProblemsBeforeStart ? { ...tdoc, pids: [], allowPrint: false } : tdoc;

        // Resolve problem dict so the workspace can render the problem list inline.
        const pdict: Record<number, any> = {};
        if (!hideProblemsBeforeStart) {
            await Promise.all(
                ((tdoc.pids as number[]) || []).map(async (pid) => {
                    const pdoc = await ProblemModel.get(authoritativeDomainId, pid, undefined, true);
                    if (!pdoc) return;
                    // Absolutize file:// image attachments for the deep exam-mode route.
                    if (typeof pdoc.content === 'string') {
                        pdoc.content = absolutizeProblemFileUrls(this, pdoc.content, pdoc, tdoc.docId);
                    }
                    // 考试上下文不得下发原赛通过率（难度提示）。
                    delete pdoc.origStat;
                    // 净化 config：原始 YAML 串含标准答案，不下发。
                    pdoc.config = clientProblemConfig(parsedProblemConfig(pdoc));
                    pdict[pid] = pdoc;
                }),
            );
        }

        this.response.body = {
            tdoc: workspaceTdoc,
            pdict,
            previewMode,
            currentUserId: this.user._id,
            page_name: 'contest_workspace',
        };
        await decorateExamMode(this, tdoc, 'overview', 'contest_workspace.html', previewMode, teamContext);
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

function redirectEndedProgrammingWorkspace(handler: Handler, tdoc: any, tsdoc: any, tid: ObjectId, isAdminBypass: boolean): boolean {
    if (isAdminBypass || !isPostContestPracticeRule(tdoc?.rule) || !(tdoc?.endAt instanceof Date) || new Date() < tdoc.endAt) {
        return false;
    }
    const practice = getPostContestPracticeState(tdoc, tsdoc);
    if (!practice.open) throw new ContestNotLiveError(tid);
    handler.response.redirect = handler.url('contest_problemlist', { tid });
    return true;
}

class ExamModeProblemListHandler extends ContestProblemListHandler {
    // 考试壳不下发本场热度统计（P1.4 红线：exam-mode payload/DOM 不变）。
    protected liveStatsEnabled = false;
    protected latestProblemStatusesEnabled = true;

    @param('tid', Types.ObjectId)
    async get(_domainId: string, tid: ObjectId) {
        const authoritativeDomainId = this.authoritativeDomainId();
        if (await redirectEndedProgrammingWorkspaceBeforeClientAccess(this, authoritativeDomainId, this.tdoc, tid)) return;
        const { previewMode, tsdoc, isAdminBypass, teamContext } = await ensureExamModeAccess(this, authoritativeDomainId, tid, this.tdoc);
        this.tsdoc = tsdoc;
        if (bounceIfNotStarted(this, this.tdoc, tid)) return;
        if (redirectEndedProgrammingWorkspace(this, this.tdoc, tsdoc, tid, isAdminBypass)) return;
        await super.get(authoritativeDomainId, tid);
        await decorateExamMode(this, this.tdoc, 'problems', 'contest_problemlist.html', previewMode, teamContext);
    }
}

class ExamModeAnnouncementsHandler extends ContestProblemListHandler {
    // 同 ExamModeProblemListHandler：考试壳不带本场热度统计。
    protected liveStatsEnabled = false;

    @param('tid', Types.ObjectId)
    async get(_domainId: string, tid: ObjectId) {
        const authoritativeDomainId = this.authoritativeDomainId();
        const { previewMode, tsdoc, teamContext } = await ensureExamModeAccess(this, authoritativeDomainId, tid, this.tdoc);
        this.tsdoc = tsdoc;
        if (bounceIfNotStarted(this, this.tdoc, tid)) return;
        await super.get(authoritativeDomainId, tid);
        await decorateExamMode(this, this.tdoc, 'announcements', 'exam_announcements.html', previewMode, teamContext);
    }
}

class ExamModeProblemDetailHandler extends ProblemDetailHandler {
    @route('pid', Types.ProblemId, true)
    @param('tid', Types.ObjectId)
    async _prepare(_domainId: string, pid: number | string, tid?: ObjectId) {
        if (!tid) throw new NotFoundError(localizedErrorText`Contest`);
        const authoritativeDomainId = this.authoritativeDomainId();
        if (await redirectEndedProgrammingWorkspaceBeforeClientAccess(this, authoritativeDomainId, this.tdoc, tid)) return;
        const { tsdoc, isAdminBypass } = await ensureExamModeAccess(this, authoritativeDomainId, tid, this.tdoc);
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
        if (redirectEndedProgrammingWorkspace(this, this.tdoc, tsdoc, tid, isAdminBypass)) return;
        await super._prepare(authoritativeDomainId, pid, tid);
    }

    @param('tid', Types.ObjectId)
    async get(_domainId: string, tid: ObjectId) {
        const authoritativeDomainId = this.authoritativeDomainId();
        if (this.response.redirect) return; // _prepare already bounced.
        await super.get(authoritativeDomainId, tid, false);
        // super.get() rewrote file:// attachments to a *relative* ./<docId>/file/
        // path that breaks under the deep /exam-mode/:tid/problem/:pid URL (and
        // JSON loads leave raw file://). Re-absolutize so problem images load.
        const pdoc = this.response.body?.pdoc;
        if (pdoc && typeof pdoc.content === 'string') {
            pdoc.content = absolutizeProblemFileUrls(this, pdoc.content, pdoc, tid);
        }
        if (pdoc?.programmingStatementView) {
            absolutizeProgrammingStatementFileUrls(this, pdoc.programmingStatementView, pdoc, tid);
        }
        const { previewMode, teamContext } = await ensureExamModeAccess(this, authoritativeDomainId, tid, this.tdoc);
        await decorateExamMode(this, this.tdoc, 'problems', 'problem_detail.html', previewMode, teamContext);
    }
}

class ExamModeScoreboardHandler extends ContestScoreboardHandler {
    @param('tid', Types.ObjectId)
    @param('view', Types.String, true)
    async get(_domainId: string, tid: ObjectId, viewId = 'default') {
        const authoritativeDomainId = this.authoritativeDomainId();
        if (bounceIfNotStarted(this, this.tdoc, tid)) return;
        await super.get(authoritativeDomainId, tid, viewId);
        if (this.response.template !== 'contest_scoreboard.html') return;
        const { previewMode, teamContext } = await ensureExamModeAccess(this, authoritativeDomainId, tid, this.tdoc);
        await decorateExamMode(this, this.tdoc, 'ranking', 'contest_scoreboard.html', previewMode, teamContext);
    }
}

class ExamModePrintHandler extends ContestPrintHandler {
    @param('tid', Types.ObjectId)
    async prepare(_args: { domainId?: string }, tid: ObjectId) {
        const authoritativeDomainId = this.authoritativeDomainId();
        const { tsdoc } = await ensureExamModeAccess(this, authoritativeDomainId, tid, this.tdoc);
        this.tsdoc = tsdoc;
        if (bounceIfNotStarted(this, this.tdoc, tid)) return;
        await super.prepare({ domainId: authoritativeDomainId }, tid);
    }

    async get() {
        if (this.response.redirect) return;
        await super.get();
        const tid = this.tdoc.docId;
        const { previewMode, teamContext } = await ensureExamModeAccess(this, this.authoritativeDomainId(), tid, this.tdoc);
        await decorateExamMode(this, this.tdoc, 'print', 'contest_print.html', previewMode, teamContext);
    }
}

class ExamModeRecordDetailHandler extends RecordDetailHandler {
    @param('rid', Types.ObjectId)
    @param('download', Types.Boolean)
    @param('rev', Types.ObjectId, true)
    async get(_domainId: string, rid: ObjectId, download = false, rev?: ObjectId) {
        const authoritativeDomainId = this.authoritativeDomainId();
        const tid = this.tdoc?.docId;
        if (!this.tdoc || !this.rdoc?.contest?.equals?.(tid)) throw new NotFoundError(localizedErrorText`Record`);
        const { previewMode, teamContext } = await ensureExamModeAccess(this, authoritativeDomainId, tid, this.tdoc);
        if (rev) throw new PermissionError(PERM.PERM_VIEW_RECORD);
        if (download && teamContext && !teamContext.canEditCode) throw new PermissionError(PERM.PERM_READ_RECORD_CODE);
        await super.get(authoritativeDomainId, rid, download, rev);
        if (download) return;
        this.response.body = buildExamModeRecordCodePayload({
            ...this.response.body,
            ...(teamContext && !teamContext.canEditCode ? { examRecordDownloadAvailable: false } : {}),
        });
        await decorateExamMode(this, this.tdoc, 'problems', 'record_detail.html', previewMode, teamContext);
    }
}

class ExamModeDiscussionListHandler extends Handler {
    tdoc: any;

    @param('tid', Types.ObjectId)
    async prepare(_domainId: string, tid: ObjectId) {
        const authoritativeDomainId = String(this.domain?._id);
        this.checkPriv(PRIV.PRIV_USER_PROFILE);
        this.checkPerm(PERM.PERM_VIEW_DISCUSSION);
        this.tdoc = await contest.get(authoritativeDomainId, tid);
        if (!this.tdoc) throw new NotFoundError(localizedErrorText`Contest`);
        await ensureExamModeAccess(this, authoritativeDomainId, tid, this.tdoc);
    }

    @param('tid', Types.ObjectId)
    @param('page', Types.PositiveInt, true)
    async get(_domainId: string, tid: ObjectId, page = 1) {
        const authoritativeDomainId = String(this.domain?._id);
        const { previewMode, teamContext } = await ensureExamModeAccess(this, authoritativeDomainId, tid, this.tdoc);
        const vnode = await discussion.getVnode(authoritativeDomainId, document.TYPE_CONTEST, tid.toHexString(), this.user._id);
        const hidden = this.user.own(vnode) || this.user.hasPerm(PERM.PERM_EDIT_DISCUSSION) ? {} : { hidden: false };
        const [ddocs, dpcount] = await this.paginate(
            discussion.getMulti(authoritativeDomainId, { parentType: document.TYPE_CONTEST, parentId: tid, ...hidden }),
            page,
            'discussion',
        );
        const uids = ddocs.map((ddoc) => ddoc.owner);
        if (vnode?.owner) uids.push(vnode.owner);
        const udict = uids.length
            ? await UserModel.getListForRender(authoritativeDomainId, uids, this.user.hasPerm(PERM.PERM_VIEW_USER_PRIVATE_INFO))
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
        await decorateExamMode(this, this.tdoc, 'discussion', 'discussion_main_or_node.html', previewMode, teamContext);
    }
}

class ExamModeDiscussionCreateHandler extends Handler {
    tdoc: any;
    vnode: any;

    @param('tid', Types.ObjectId)
    async prepare(_domainId: string, tid: ObjectId) {
        const authoritativeDomainId = String(this.domain?._id);
        this.checkPriv(PRIV.PRIV_USER_PROFILE);
        this.checkPerm(PERM.PERM_CREATE_DISCUSSION);
        this.tdoc = await contest.get(authoritativeDomainId, tid);
        if (!this.tdoc) throw new NotFoundError(localizedErrorText`Contest`);
        await ensureExamModeAccess(this, authoritativeDomainId, tid, this.tdoc);
        this.vnode = await discussion.getVnode(authoritativeDomainId, document.TYPE_CONTEST, tid.toHexString(), this.user._id);
    }

    async get() {
        const tid = this.tdoc.docId;
        const { previewMode, teamContext } = await ensureExamModeAccess(this, String(this.domain?._id), tid, this.tdoc);
        this.response.body = { vnode: this.vnode };
        await decorateExamMode(this, this.tdoc, 'discussion', 'discussion_create.html', previewMode, teamContext);
    }

    @param('tid', Types.ObjectId)
    @param('title', Types.Title)
    @param('content', Types.Content)
    @param('highlight', Types.Boolean)
    @param('pin', Types.Boolean)
    async post(_domainId: string, tid: ObjectId, title: string, content: string, highlight = false, pin = false) {
        const authoritativeDomainId = String(this.domain?._id);
        await this.limitRate('add_discussion', 3600, 60);
        if (highlight) this.checkPerm(PERM.PERM_HIGHLIGHT_DISCUSSION);
        if (pin) this.checkPerm(PERM.PERM_PIN_DISCUSSION);
        const did = await discussion.add(
            authoritativeDomainId,
            document.TYPE_CONTEST,
            tid,
            this.user._id,
            title,
            content,
            this.request.ip,
            highlight,
            pin,
            this.vnode?.hidden ?? false,
        );
        this.response.body = { did };
        this.response.redirect = `/exam-mode/${tid.toHexString()}/discussion/${did.toHexString()}`;
    }
}

class ExamModeDiscussionDetailHandler extends DiscussionDetailHandler {
    tdoc: any;

    @param('tid', Types.ObjectId)
    async prepare(_domainId: string, tid: ObjectId) {
        const authoritativeDomainId = String(this.domain?._id);
        this.tdoc = await contest.get(authoritativeDomainId, tid);
        if (!this.tdoc) throw new NotFoundError(localizedErrorText`Contest`);
        await ensureExamModeAccess(this, authoritativeDomainId, tid, this.tdoc);
        if (this.ddoc?.parentType !== document.TYPE_CONTEST || !(this.ddoc.parentId as any)?.equals?.(tid)) {
            throw new NotFoundError(localizedErrorText`Discussion`);
        }
    }

    @param('did', Types.ObjectId)
    @param('page', Types.PositiveInt, true)
    async get(_domainId: string, did: ObjectId, page = 1) {
        await super.get(String(this.domain?._id), did, page);
        const { previewMode, teamContext } = await ensureExamModeAccess(this, String(this.domain?._id), this.tdoc.docId, this.tdoc);
        await decorateExamMode(this, this.tdoc, 'discussion', 'discussion_detail.html', previewMode, teamContext);
    }
}

/**
 * One lightweight invalidation channel shared by every team Exam Mode page.
 * It carries only the new team revision; the browser always reloads the
 * authoritative bootstrap instead of applying role state from the socket.
 */
class ExamModeTeamRoleConnectionHandler extends ConnectionHandler {
    domainId: string;
    contestId: ObjectId;
    teamId: ObjectId;

    @param('tid', Types.ObjectId)
    @param('teamId', Types.ObjectId)
    @param('teamRevision', Types.UnsignedInt)
    async prepare(_domainId: string, tid: ObjectId, bootstrapTeamId: ObjectId, bootstrapTeamRevision: number) {
        const authoritativeDomainId = String(this.domain?._id);
        this.domainId = authoritativeDomainId;
        const tdoc = await contest.get(authoritativeDomainId, tid);
        if (!tdoc) throw new NotFoundError(localizedErrorText`Contest`);
        let teamContext: ContestTeamExamModeContext | null;
        try {
            ({ teamContext } = await ensureExamModeAccess(this, authoritativeDomainId, tid, tdoc));
        } catch (error) {
            if (!(error instanceof ContestTeamConflictError)) throw error;
            logger.info('Team Exam Mode role socket access revoked domain=%s tid=%s uid=%d', authoritativeDomainId, tid.toHexString(), this.user._id);
            this.send({ teamRoleChanged: true, teamRevision: null });
            this.close(4003, 'Team Exam Mode access revoked');
            return;
        }
        if (!teamContext?.teamId) throw new PermissionError(PERM.PERM_ATTEND_CONTEST);
        this.contestId = tid;
        this.teamId = new ObjectId(teamContext.teamId);
        if (!bootstrapTeamId.equals(this.teamId) || bootstrapTeamRevision !== teamContext.teamInfo?.revision) {
            this.send({ teamRoleChanged: true, teamRevision: teamContext.teamInfo?.revision ?? null });
        }
    }

    @subscribe('contest/team-role-change')
    async onTeamRoleChange(payload: { after: contestTeam.ContestTeamDoc }) {
        if (!payload.after.contestId.equals(this.contestId) || !payload.after.teamId.equals(this.teamId)) return;
        this.send({ teamRoleChanged: true, teamRevision: payload.after.revision });
        if (!payload.after.active || !payload.after.memberUids.includes(this.user._id)) {
            this.close(4003, 'Team Exam Mode access revoked');
        }
    }

    @subscribe('contest/team-code-snapshot')
    async onTeamCodeSnapshot(payload: { domainId: string; contestId: ObjectId; teamId: ObjectId; targetUid: number; snapshotId: ObjectId }) {
        if (
            payload.domainId !== this.domainId ||
            !payload.contestId.equals(this.contestId) ||
            !payload.teamId.equals(this.teamId) ||
            payload.targetUid !== this.user._id
        ) {
            return;
        }
        const currentTeam = await contestTeam.getTeamByMember(this.domainId, this.contestId, this.user._id);
        if (!currentTeam?.active || !currentTeam.teamId.equals(this.teamId)) return;
        this.send({ teamCodeAvailable: true, snapshotId: payload.snapshotId.toHexString() });
        if (!(await contestTeamCode.markNotified(payload.snapshotId, this.user._id))) {
            logger.warn(
                'Team-code browser wake-up sent but state update was not applied domain=%s tid=%s team=%s target=%d snapshot=%s',
                this.domainId,
                this.contestId,
                this.teamId,
                this.user._id,
                payload.snapshotId,
            );
        }
    }
}

// ─── Route registration ───────────────────────────────────────────────────

export async function apply(ctx: Context) {
    ctx.Connection('exam_mode_team_role_conn', '/exam-mode/team-role-conn', ExamModeTeamRoleConnectionHandler, PRIV.PRIV_USER_PROFILE);
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
