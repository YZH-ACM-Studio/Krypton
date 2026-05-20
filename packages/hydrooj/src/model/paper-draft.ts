/**
 * Paper draft store — the in-progress answer-sheet state for an exam-rule contest.
 *
 * Backing: MongoDB collection `vigil.paper_draft`, one document per
 * `(domainId, tid, uid, pid)`. Upserts are idempotent.
 *
 * Lifecycle:
 *   - student visits paper → reads all drafts (createIfMissing)
 *   - student edits + clicks save → upsertDraft
 *   - student locks a kind via paper UI → lockKind (appends to lockedKinds)
 *   - student finalizes / time expires / proctor force-submits → handlers
 *     read drafts, build records, then `clearDrafts(tid, uid)` (or keep for audit)
 *
 * The `problemFingerprint` field is computed from the problem's judging-affecting
 * config at draft-create time. Force-unlock (PRD §1.5) recomputes fingerprints,
 * so stale drafts can be detected on read and warned to the user.
 */
import { ObjectId } from 'mongodb';
import type { QuestionKind } from '@hydrooj/common';
import { Logger } from '@hydrooj/utils';
import db from '../service/db';

const logger = new Logger('paper-draft');

export interface PaperDraft {
    _id?: ObjectId;
    domainId: string;
    tid: ObjectId;
    pid: number;
    uid: number;
    /** For objective: questionKey -> studentAnswer. For fill_function: regionId -> source. */
    answers: Record<string, string | string[]>;
    /** For default / fill_function only — the staged code. */
    code?: string;
    lang?: string;
    /** Question kinds the student has clicked "submit this kind" on. */
    lockedKinds: QuestionKind[];
    /**
     * Immediate per-question grading results, populated when:
     *   - contest config `allowSubmitByKind=true` AND lock-kind is invoked → judge that kind's objective
     *   - finalize is called → grade all objective questions
     *
     * Keyed by questionKey for objective; value is 'correct' | 'wrong' | 'partial'.
     * For programming cells the result lives on the record (status field).
     */
    judgeResult?: Record<string, 'correct' | 'wrong' | 'partial'>;
    /** SHA-256 of problem judging fields at draft-create. */
    problemFingerprint: string;
    updatedAt: Date;
    createdAt: Date;
}

export const coll = db.collection<PaperDraft>('vigil.paper_draft');

let indexesEnsured = false;
async function ensureIndexes(): Promise<void> {
    if (indexesEnsured) return;
    indexesEnsured = true;
    await Promise.all([
        coll.createIndex({ domainId: 1, tid: 1, uid: 1, pid: 1 }, { unique: true }),
        coll.createIndex({ domainId: 1, tid: 1 }),
        coll.createIndex({ uid: 1, tid: 1 }),
    ]);
}

export interface UpsertDraftPayload {
    answers?: Record<string, string | string[]>;
    code?: string;
    lang?: string;
    problemFingerprint: string;
}

/**
 * Idempotent upsert. The `problemFingerprint` is captured on first save;
 * subsequent saves do NOT overwrite the original fingerprint (so a mid-exam
 * force-unlock is detectable). Caller is responsible for comparing the
 * stored fingerprint against the current one on load and reacting.
 */
export async function upsertDraft(
    domainId: string, tid: ObjectId, pid: number, uid: number, payload: UpsertDraftPayload,
): Promise<PaperDraft> {
    await ensureIndexes();
    const now = new Date();
    const setOnInsert: Partial<PaperDraft> = {
        _id: new ObjectId() as any,
        domainId,
        tid,
        pid,
        uid,
        lockedKinds: [],
        problemFingerprint: payload.problemFingerprint,
        createdAt: now,
    };
    const $set: Partial<PaperDraft> = { updatedAt: now };
    if (payload.answers !== undefined) $set.answers = payload.answers;
    if (payload.code !== undefined) $set.code = payload.code;
    if (payload.lang !== undefined) $set.lang = payload.lang;

    await coll.updateOne(
        { domainId, tid, pid, uid },
        { $set, $setOnInsert: setOnInsert as any },
        { upsert: true },
    );
    return (await coll.findOne({ domainId, tid, pid, uid }))!;
}

export async function getDraft(
    domainId: string, tid: ObjectId, pid: number, uid: number,
): Promise<PaperDraft | null> {
    await ensureIndexes();
    return await coll.findOne({ domainId, tid, pid, uid });
}

export async function getDraftsForUser(
    domainId: string, tid: ObjectId, uid: number,
): Promise<PaperDraft[]> {
    await ensureIndexes();
    return await coll.find({ domainId, tid, uid }).toArray();
}

/**
 * Append a kind to `lockedKinds` (idempotent). Returns the new locked list.
 * Locked kinds are still part of the draft body, but the UI must render them
 * read-only.
 *
 * The lock is at the (tid, uid, pid) granularity. The paper UI typically
 * iterates over all (tid, uid) drafts and locks the same kind on each.
 */
export async function lockKind(
    domainId: string, tid: ObjectId, pid: number, uid: number, kind: QuestionKind,
): Promise<QuestionKind[]> {
    await ensureIndexes();
    await coll.updateOne(
        { domainId, tid, pid, uid },
        { $addToSet: { lockedKinds: kind as any } as any, $set: { updatedAt: new Date() } },
    );
    const doc = await coll.findOne({ domainId, tid, pid, uid });
    return doc?.lockedKinds || [];
}

/** Lock a kind across every draft for `(tid, uid)`. */
export async function lockKindForUser(
    domainId: string, tid: ObjectId, uid: number, kind: QuestionKind,
): Promise<void> {
    await ensureIndexes();
    await coll.updateMany(
        { domainId, tid, uid },
        { $addToSet: { lockedKinds: kind as any } as any, $set: { updatedAt: new Date() } },
    );
}

/** Drop all drafts for `(tid, uid)`. Used after final submit succeeds. */
export async function clearDrafts(
    domainId: string, tid: ObjectId, uid: number,
): Promise<number> {
    await ensureIndexes();
    const res = await coll.deleteMany({ domainId, tid, uid });
    logger.info('cleared %d drafts for tid=%s uid=%d', res.deletedCount, tid, uid);
    return res.deletedCount || 0;
}

/** List drafts across the contest — used by time-expiry auto-finalize. */
export async function getDraftsForContest(
    domainId: string, tid: ObjectId,
): Promise<PaperDraft[]> {
    await ensureIndexes();
    return await coll.find({ domainId, tid }).toArray();
}

/** Save per-question judge results to the draft (merged with existing). */
export async function setJudgeResults(
    domainId: string, tid: ObjectId, pid: number, uid: number,
    results: Record<string, 'correct' | 'wrong' | 'partial'>,
): Promise<void> {
    await ensureIndexes();
    const $set: Record<string, any> = { updatedAt: new Date() };
    for (const [key, val] of Object.entries(results)) {
        $set[`judgeResult.${key}`] = val;
    }
    await coll.updateOne({ domainId, tid, pid, uid }, { $set });
}

export default {
    upsertDraft,
    getDraft,
    getDraftsForUser,
    lockKind,
    lockKindForUser,
    clearDrafts,
    getDraftsForContest,
    setJudgeResults,
    coll,
};
