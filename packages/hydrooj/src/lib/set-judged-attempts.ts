import { ObjectId } from 'mongodb';
import { STATUS, type CodeAttempt, type OfficialAnswer } from '@hydrooj/common';

const pending = new Set<number>([
    STATUS.STATUS_WAITING, STATUS.STATUS_JUDGING, STATUS.STATUS_COMPILING, STATUS.STATUS_FETCHED,
]);
const excluded = new Set<number>([STATUS.STATUS_CANCELED, STATUS.STATUS_IGNORED]);

export function isJudgedSetStatus(status: number): boolean {
    return !pending.has(status) && !excluded.has(status);
}

function object(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function date(value: unknown): value is Date {
    return value instanceof Date && Number.isFinite(value.getTime());
}

export function setRecordAcceptedAt(rid: unknown, value: unknown): Date {
    if (!(rid instanceof ObjectId)) throw new TypeError('set_record_invalid');
    const acceptedAt = value === undefined ? rid.getTimestamp() : value;
    if (!date(acceptedAt)) throw new TypeError('set_record_accepted_at_invalid');
    return acceptedAt;
}

/** Judge completion controls eligibility; the accepted submission controls ordering and lateness. */
export function judgedSetAttempts(rows: readonly unknown[]): CodeAttempt[] {
    const attempts: CodeAttempt[] = [];
    for (const row of rows) {
        if (!object(row)) throw new TypeError('set_record_invalid');
        if (row.setAnswerVersion !== undefined) continue;
        if (typeof row.status !== 'number' || !Number.isInteger(row.status)) throw new TypeError('set_record_status_invalid');
        if (!isJudgedSetStatus(row.status) || row.judgeAt == null) continue;
        if (!date(row.judgeAt) || !(row._id instanceof ObjectId)) throw new TypeError('set_record_invalid');
        if (typeof row.pid !== 'number' || !Number.isSafeInteger(row.pid) || row.pid <= 0) throw new TypeError('set_record_pid_invalid');
        const acceptedAt = setRecordAcceptedAt(row._id, row.setAcceptedAt);
        if (typeof row.score !== 'number' || !Number.isFinite(row.score)) throw new TypeError('set_record_score_invalid');
        const subtasks: Record<string, { score: number; status: number }> = {};
        if (row.subtasks != null) {
            if (!object(row.subtasks)) throw new TypeError('set_record_subtasks_invalid');
            for (const [key, subtask] of Object.entries(row.subtasks)) {
                if (!object(subtask) || typeof subtask.score !== 'number' || !Number.isFinite(subtask.score)
                    || typeof subtask.status !== 'number' || !Number.isInteger(subtask.status)) {
                    throw new TypeError('set_record_subtasks_invalid');
                }
                subtasks[key] = { score: subtask.score, status: subtask.status };
            }
        }
        attempts.push({
            pid: row.pid, acceptedAt, score: row.score, status: row.status,
            recordId: row._id.toHexString(), ...(row.subtasks == null ? {} : { subtasks }),
        });
    }
    return attempts;
}

export function hasPendingSetAttempts(rows: readonly unknown[], answers: readonly OfficialAnswer[] = []): boolean {
    return rows.some((row) => {
        if (!object(row) || typeof row.status !== 'number' || !pending.has(row.status)) return false;
        if (row.setAnswerVersion === undefined) return true;
        const rid = row._id instanceof ObjectId ? row._id.toHexString() : null;
        return rid !== null && answers.some((answer) => answer.rid === rid
            && answer.version === row.setAnswerVersion);
    });
}

/** The grading Record survives interruptions between its CAS and the answer projection. */
export function answersWithManualGrades<T extends Pick<OfficialAnswer, 'pid' | 'version' | 'rid' | 'rawScore' | 'status'>>(
    saved: readonly T[], records: readonly unknown[],
): T[] {
    const byRid = new Map<string, Record<string, unknown>>();
    for (const row of records) if (object(row) && row._id instanceof ObjectId) byRid.set(row._id.toHexString(), row);
    return saved.map((answer) => {
        if (!answer.rid) return answer;
        const row = byRid.get(answer.rid);
        if (!row || row.setAnswerVersion !== answer.version || row.pid !== answer.pid) throw new Error('set_answer_record_mismatch');
        if (typeof row.status !== 'number' || !Number.isInteger(row.status)) throw new TypeError('set_answer_grade_invalid');
        if (pending.has(row.status)) return answer;
        if (!date(row.judgeAt) || typeof row.score !== 'number' || !Number.isFinite(row.score)
            || row.score < 0 || (row.manualGrade != null && row.score > 100)) throw new TypeError('set_answer_grade_invalid');
        return { ...answer, rawScore: row.score, status: row.status };
    });
}
