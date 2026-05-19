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
    PRIV, Types, ValidationError,
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
            const pdoc = await ProblemModel.get(this.tdoc.domainId, pid);
            if (pdoc) pdict[pid] = pdoc;
        }));
        return pdict;
    }

    isInWindow(): boolean {
        const now = Date.now();
        return now >= this.tdoc.beginAt.getTime() && now <= this.tdoc.endAt.getTime();
    }
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
                // default / submit_answer / interactive — treat as "编程" cell
                cells.push({ pid, questionKey: null, kind: type === 'submit_answer' ? 'submit_answer' : 'default', score: pdoc.score || 100 });
            }
        }
        this.response.template = 'exam_paper.html';
        this.response.body = {
            tdoc: this.tdoc,
            pdict,
            cells,
            now: Date.now(),
            inWindow: this.isInWindow(),
        };
    }
}

// ─── GET /api/contests/:tid/paper/draft ───────────────────────────────────

class PaperDraftListHandler extends PaperBaseHandler {
    async get({ domainId }: { domainId: string }) {
        const drafts = await PaperDraftModel.getDraftsForUser(domainId, this.tid, this.user._id);
        const pdict = await this.getProblemDict();
        const staleness: Record<string, boolean> = {};
        for (const draft of drafts) {
            const pdoc = pdict[draft.pid];
            if (!pdoc) continue;
            const config = typeof pdoc.config === 'object' ? pdoc.config : null;
            const currentFp = problemFingerprint(config);
            staleness[draft.pid] = currentFp !== draft.problemFingerprint;
        }
        this.response.body = { drafts, staleness };
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
        await PaperDraftModel.lockKindForUser(domainId, this.tid, this.user._id, kind as any);
        this.response.body = { kind, locked: true };
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
        const finalCode = type === 'fill_function'
            // For fill_function, the spliced source is computed at judger side
            // (it gets the raw `{regionId: content}` JSON). To avoid double-work
            // here, just submit the JSON-as-code.
            ? draft.code
            : draft.code;

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
        // Allow finalize within window or briefly after endAt (grace period 60s).
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
                // Assemble YAML compatible with hydrojudge's existing `objective` judger.
                // Format: { key: answer }
                const yamlBody = yaml.dump(draft.answers || {});
                const rid = await record.add(
                    domainId, draft.pid, this.user._id, '_', yamlBody, true,
                    { contest: this.tid, type: 'judge' },
                );
                rids.push(rid);
            } else if (type === 'fill_function') {
                // Code field is JSON of {regionId -> content}; pass through.
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

        // Notify contest model for stat updates.
        for (const rid of rids) {
            await contest.updateStatus(domainId, this.tid, this.user._id, rid, 0);
        }

        // Drafts are kept for audit (PRD §3.4 design note: never cleared automatically).
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
        // List all exam-rule contests in this domain that the user can attend.
        // Reuse the existing contest listing (filtering on rule=exam).
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

// ─── GET /exam-mode/:tid — redirect to /paper/:tid (single entry point) ──

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
