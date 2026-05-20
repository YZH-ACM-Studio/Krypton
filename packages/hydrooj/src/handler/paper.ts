/**
 * Paper-mode HTTP routes — answer-sheet save/lock/submit/finalize for
 * `exam`-rule contests. Backs the ui-next `/exam-mode/:tid` UI.
 *
 * Auth: requires `PERM_ATTEND_CONTEST` plus contest time-window check.
 * Admin variants (force-submit, force-unlock) live under `handler/admin/`.
 *
 * See PRD §1.6 for submission semantics, §1.8 for the API list.
 */
import { ObjectId } from 'mongodb';
import yaml from 'js-yaml';
import {
    Context, Handler, NotFoundError, OplogModel, param, PERM,
    PRIV, Types, UserModel, ValidationError,
} from 'hydrooj';
import {
    PaperDraftModel, ProblemModel, problemFingerprint, spliceFillFunction,
    questionKindMap,
} from 'hydrooj';
import * as contest from '../model/contest';
import * as record from '../model/record';

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
        this.checkPerm(PERM.PERM_ATTEND_CONTEST);
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

class PaperFinalizeHandler extends PaperBaseHandler {
    async post({ domainId }: { domainId: string }) {
        const now = Date.now();
        const grace = 60 * 1000;
        if (now > this.tdoc.endAt.getTime() + grace) {
            throw new ValidationError('contest', null, 'Contest finalize window has closed');
        }

        const drafts = await PaperDraftModel.getDraftsForUser(domainId, this.tid, this.user._id);
        const pdict = await this.getProblemDict();
        const rids: ObjectId[] = [];

        for (const draft of drafts) {
            const pdoc = pdict[draft.pid];
            if (!pdoc) continue;
            const config = typeof pdoc.config === 'object' ? pdoc.config : null;
            const type = config?.type || 'default';

            if (type === 'objective') {
                // Grade locally too so the UI's judgeResult fills in.
                await gradeObjectiveDraft(domainId, this.tid, this.user._id, draft.pid, pdoc);

                const yamlBody = yaml.dump(draft.answers || {});
                const rid = await record.add(
                    domainId, draft.pid, this.user._id, '_', yamlBody, true,
                    { contest: this.tid, type: 'judge' },
                );
                rids.push(rid);
            } else if (type === 'fill_function') {
                const codeBody = draft.code || JSON.stringify(draft.answers || {});
                const lang = draft.lang || config?.template?.lang || 'cpp';
                const rid = await record.add(
                    domainId, draft.pid, this.user._id, lang, codeBody, true,
                    { contest: this.tid, type: 'judge' },
                );
                rids.push(rid);
            } else if (type === 'default') {
                if (!draft.code) continue;
                const lang = draft.lang || config?.langs?.[0] || 'cpp';
                const rid = await record.add(
                    domainId, draft.pid, this.user._id, lang, draft.code, true,
                    { contest: this.tid, type: 'judge' },
                );
                rids.push(rid);
            } else if (type === 'submit_answer') {
                const codeBody = draft.code || '';
                const rid = await record.add(
                    domainId, draft.pid, this.user._id, '_', codeBody, true,
                    { contest: this.tid, type: 'judge' },
                );
                rids.push(rid);
            }
        }

        for (const rid of rids) {
            await contest.updateStatus(domainId, this.tid, this.user._id, rid, 0);
        }

        await OplogModel.log(this, 'paper.finalize', { tid: this.tid, count: rids.length });
        this.response.body = { rids, count: rids.length };
    }
}

// ─── GET /exam-mode — home (eligible exams card grid) ────────────────────

class ExamModeHomeHandler extends Handler {
    async prepare() {
        this.checkPriv(PRIV.PRIV_USER_PROFILE);
    }

    async get({ domainId }: { domainId: string }) {
        const cursor = contest.getMulti(domainId, { rule: 'exam' }).sort({ beginAt: -1 }).limit(50);
        const tdocs = await cursor.toArray();
        const now = Date.now();
        const exams = tdocs.map((t: any) => ({
            _id: t._id,
            docId: t.docId,
            title: t.title,
            beginAt: t.beginAt,
            endAt: t.endAt,
            approvalMode: t.approvalMode,
            lockdownMode: t.lockdownMode,
            pids: t.pids || [],
            attended: !!(t.attend || 0),
            inWindow: t.beginAt.getTime() <= now && now <= t.endAt.getTime(),
        }));

        this.response.template = 'exam_mode_home.html';
        this.response.body = {
            exams,
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

    @param('tid', Types.ObjectId)
    async get({ }, tid: ObjectId) {
        this.response.redirect = this.url('paper_layout', { tid });
    }
}

// ─── Route registration ───────────────────────────────────────────────────

export async function apply(ctx: Context) {
    ctx.Route('exam_mode_home', '/exam-mode', ExamModeHomeHandler, PRIV.PRIV_USER_PROFILE);
    ctx.Route('exam_mode_entry', '/exam-mode/:tid', ExamModeEntryHandler, PRIV.PRIV_USER_PROFILE);
    ctx.Route('paper_layout', '/paper/:tid', PaperLayoutHandler, PERM.PERM_ATTEND_CONTEST);
    ctx.Route('paper_draft_list', '/paper/:tid/draft', PaperDraftListHandler, PERM.PERM_ATTEND_CONTEST);
    ctx.Route('paper_draft_upsert', '/paper/:tid/draft/:pid', PaperDraftUpsertHandler, PERM.PERM_ATTEND_CONTEST);
    ctx.Route('paper_lock_kind', '/paper/:tid/lock-kind', PaperLockKindHandler, PERM.PERM_ATTEND_CONTEST);
    ctx.Route('paper_submit_code', '/paper/:tid/submit-code/:pid', PaperSubmitCodeHandler, PERM.PERM_ATTEND_CONTEST);
    ctx.Route('paper_finalize', '/paper/:tid/finalize', PaperFinalizeHandler, PERM.PERM_ATTEND_CONTEST);
}

apply.inject = ['server'] as const;
