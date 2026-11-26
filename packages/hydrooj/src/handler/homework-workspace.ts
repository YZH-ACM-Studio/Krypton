import { ObjectId } from 'mongodb';
import { effectiveProblemKind } from '@hydrooj/common';
import { Logger } from '@hydrooj/utils';
import {
    ContestNotFoundError,
    localizedErrorText,
    ValidationError,
} from '../error';
import { selectKindSubmissions, type HomeworkKindDraft } from '../lib/homework-kind-submit';
import { parseProblemConfigObject, problemFingerprint } from '../lib/problem-config';
import { PERM } from '../model/builtin';
import * as contest from '../model/contest';
import { markManualPending } from '../model/manual-grade';
import { getDraftsForUser, markDraftSubmitted, upsertDraft } from '../model/paper-draft';
import problem from '../model/problem';
import record from '../model/record';
import { Handler, param, post, Types } from '../service/server';
import { assertHomeworkAccessOrHide } from './contest';

const logger = new Logger('homework-workspace');

const HOMEWORK_SUBMIT_KINDS = new Set(['true_false', 'single', 'multi', 'blank', 'subjective']);

function isAnswerRecord(value: unknown): value is Record<string, string | string[]> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    return Object.values(value).every((item) => {
        if (typeof item === 'string') return true;
        return Array.isArray(item) && item.every((part) => typeof part === 'string');
    });
}

function parseAnswers(raw: string): Record<string, string | string[]> {
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        throw new ValidationError('answers');
    }
    if (!isAnswerRecord(parsed)) throw new ValidationError('answers');
    return parsed;
}

class HomeworkWorkspaceHandler extends Handler {
    tdoc: any;

    tsdoc: any;

    @param('tid', Types.ObjectId)
    async prepare(_domainId: string, tid: ObjectId) {
        const domainId = String(this.domain?._id);
        this.tdoc = await contest.get(domainId, tid);
        if (!this.tdoc || this.tdoc.rule !== 'homework') throw new ContestNotFoundError(domainId, tid);
        await assertHomeworkAccessOrHide(domainId, this.tdoc, this.user);
        this.checkPerm(PERM.PERM_ATTEND_HOMEWORK);
        this.tsdoc = await contest.getStatus(domainId, tid, this.user._id);
    }

    protected domainId(): string {
        const domainId = this.domain?._id;
        if (typeof domainId !== 'string' || domainId === '') throw new TypeError('Homework workspace is missing its domain');
        return domainId;
    }

    protected assertCanAnswer() {
        // A missing status document is "not started" for a personal timer. isOngoing only
        // applies that rule when tsdoc is truthy.
        const status = this.tsdoc || {};
        if (!contest.isOngoing(this.tdoc, status)) {
            throw new ValidationError('tid', null, localizedErrorText`现在不能作答这份作业。`);
        }
    }
}

class HomeworkDraftListHandler extends HomeworkWorkspaceHandler {
    @param('tid', Types.ObjectId)
    async get(_domainId: string, tid: ObjectId) {
        const domainId = this.domainId();
        const allowed = new Set<number>(this.tdoc.pids || []);
        const rows = await getDraftsForUser(domainId, tid, this.user._id);
        this.response.body = {
            drafts: rows.filter((row) => allowed.has(row.pid)).map((row) => ({
                pid: row.pid,
                answers: row.answers,
                submittedAnswers: row.submittedAnswers ?? null,
                updatedAt: row.updatedAt.toISOString(),
            })),
        };
    }
}

class HomeworkDraftUpsertHandler extends HomeworkWorkspaceHandler {
    @param('tid', Types.ObjectId)
    @param('pid', Types.UnsignedInt)
    @post('answers', Types.String)
    async post(_domainId: string, tid: ObjectId, pid: number, answersJson: string) {
        this.assertCanAnswer();
        if (!Array.isArray(this.tdoc.pids) || !this.tdoc.pids.includes(pid)) throw new ValidationError('pid');
        const domainId = this.domainId();
        const pdoc = await problem.get(domainId, pid);
        const config = parseProblemConfigObject(pdoc);
        if (config?.type !== 'objective') throw new ValidationError('pid');
        const answers = parseAnswers(answersJson);
        const saved = await upsertDraft(domainId, tid, pid, this.user._id, {
            answers,
            problemFingerprint: problemFingerprint(config),
        });
        this.response.body = { ok: true, updatedAt: saved.updatedAt };
    }
}

class HomeworkSubmitKindHandler extends HomeworkWorkspaceHandler {
    @param('tid', Types.ObjectId)
    @post('kind', Types.Name)
    async post(_domainId: string, tid: ObjectId, kind: string) {
        if (!HOMEWORK_SUBMIT_KINDS.has(kind)) throw new ValidationError('kind');
        this.assertCanAnswer();
        const domainId = this.domainId();
        const uid = this.user._id;
        const pids: number[] = Array.isArray(this.tdoc.pids) ? this.tdoc.pids : [];
        const dict = await problem.getList(domainId, pids, true, true, problem.PROJECTION_PUBLIC);
        const rows = await getDraftsForUser(domainId, tid, uid);
        const allowed = new Set(pids);
        const drafts = new Map<number, HomeworkKindDraft>();
        for (const row of rows) {
            if (!allowed.has(row.pid)) continue;
            drafts.set(row.pid, {
                answers: row.answers ?? null,
                submittedAnswers: row.submittedAnswers ?? null,
            });
        }
        const selected = selectKindSubmissions({
            pids,
            kindOf: (pid) => {
                const pdoc = dict[pid];
                if (!pdoc) throw new ValidationError('pid');
                return effectiveProblemKind(pdoc);
            },
            drafts,
            kind,
        });
        if (this.tsdoc?.attend !== 1) await contest.attend(domainId, tid, uid);
        const rids: string[] = [];
        for (const item of selected) {
            const rid = await record.add(domainId, item.pid, uid, '_', item.code, true, {
                contest: tid,
                type: item.manual ? 'manual' : 'judge',
            });
            if (!(rid instanceof ObjectId)) throw new TypeError('record.add must return an ObjectId');
            if (item.manual) await markManualPending({ domainId, tid, pid: item.pid, uid, rid });
            else await contest.updateStatus(domainId, tid, uid, rid, item.pid);
            await markDraftSubmitted(domainId, tid, uid, item.pid, item.answers);
            rids.push(rid.toHexString());
        }
        logger.info('domain=%s uid=%d tid=%s kind=%s count=%d', domainId, uid, tid, kind, rids.length);
        this.response.body = { rids, count: rids.length };
    }
}

export async function apply(ctx) {
    ctx.Route('homework_draft_list', '/homework/:tid/draft', HomeworkDraftListHandler);
    ctx.Route('homework_draft_upsert', '/homework/:tid/draft/:pid', HomeworkDraftUpsertHandler);
    ctx.Route('homework_submit_kind', '/homework/:tid/submit-kind', HomeworkSubmitKindHandler);
}
