/**
 * Lock-on-begin invariant (PRD §1.5).
 *
 * Once `now >= contest.beginAt` for any `exam`-rule contest containing problem P,
 * its judging-affecting fields (`config.template`, `config.answers`,
 * `config.regions`, `config.checker`, `config.cases`, `config.subtasks`) are
 * read-only for non-superadmins. The teacher must explicitly force-unlock to
 * edit, which triggers a full rejudge of related records.
 *
 * This module exposes the predicate; callers integrate it at the handler
 * layer (see `handler/problem.ts` for the editing routes, and admin endpoints
 * for force-unlock).
 */
import { ObjectId } from 'mongodb';
import db from '../service/db';
import * as document from '../model/document';

const TYPE_CONTEST = document.TYPE_CONTEST;

/**
 * Return the list of currently-locked exam contest ids that reference `pid`.
 * "Locked" = exam-rule and `now >= beginAt` (regardless of whether endAt has
 * passed — even after endAt, edits would invalidate existing records, so we
 * keep the lock until an explicit force-unlock + rejudge).
 */
export async function lockingExamContests(
    domainId: string, pid: number,
): Promise<ObjectId[]> {
    const now = new Date();
    const cursor = db.collection('document').find({
        domainId,
        docType: TYPE_CONTEST,
        rule: 'exam',
        pids: pid,
        beginAt: { $lte: now },
    }, { projection: { _id: 1, docId: 1 } });
    const docs = await cursor.toArray();
    return docs.map((d) => (d as any).docId);
}

export async function isProblemLockedByExam(
    domainId: string, pid: number,
): Promise<boolean> {
    const ids = await lockingExamContests(domainId, pid);
    return ids.length > 0;
}

export class ExamLockError extends Error {
    code = 423; // Locked
    constructor(public pid: number, public lockingTids: ObjectId[]) {
        super(`Problem ${pid} is locked by ${lockingTids.length} active/past exam contest(s); force-unlock required to edit.`);
        this.name = 'ExamLockError';
    }
}

/**
 * Throws ExamLockError unless `bypassExamLock` (set by a force-unlock path) is true.
 *
 * Patch keys that are judging-affecting; non-affecting fields (title, content,
 * tags, difficulty, score) can pass even when locked. The caller is expected
 * to filter `patch` before calling, or to pre-check via `isProblemLockedByExam`.
 */
export async function assertProblemEditable(
    domainId: string, pid: number, patch: { config?: any; [k: string]: any },
    bypassExamLock = false,
): Promise<void> {
    if (bypassExamLock) return;
    // Only block if the patch touches judging-affecting fields.
    if (!patch.config) return;
    const lockingTids = await lockingExamContests(domainId, pid);
    if (lockingTids.length > 0) throw new ExamLockError(pid, lockingTids);
}
