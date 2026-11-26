import { effectiveProblemKind, homeworkKindRevealsVerdict, STATUS, type ProblemKind } from '@hydrooj/common';
import type { ScoreboardRow } from '../interface';
import { storedSetConfigOrNull } from './set-publication';

const PENDING = '待评测';

export function homeworkShowsObjectiveVerdict(tdoc: { rule?: unknown; homeworkShowObjectiveVerdict?: unknown }): boolean {
    if (storedSetConfigOrNull(tdoc)) return true;
    if (tdoc.rule !== 'homework') return true;
    const value = tdoc.homeworkShowObjectiveVerdict;
    if (value === undefined || value === true) return true;
    if (value === false) return false;
    throw new TypeError('homeworkShowObjectiveVerdict must be a boolean');
}

export function concealHomeworkObjectiveFromStudent(
    tdoc: { rule?: unknown; homeworkShowObjectiveVerdict?: unknown } | null | undefined,
    privileged: boolean,
): boolean {
    if (!tdoc || tdoc.rule !== 'homework' || privileged) return false;
    return !homeworkShowsObjectiveVerdict(tdoc);
}

export function homeworkObjectiveVerdictOpen(
    tdoc: { rule?: unknown; homeworkShowObjectiveVerdict?: unknown },
    kind: ProblemKind,
    privileged: boolean,
): boolean {
    if (privileged || homeworkKindRevealsVerdict(kind)) return true;
    return homeworkShowsObjectiveVerdict(tdoc);
}

export async function loadHomeworkProblemKinds(domainId: string, pids: readonly number[]): Promise<Map<number, ProblemKind>> {
    // Hydro loads TypeScript through the CJS register hook. A native dynamic
    // import() does not resolve extensionless .ts files.
    const problem = require('../model/problem').default as typeof import('../model/problem').default;
    const dict = await problem.getList(domainId, [...pids], true, true, ['docId', 'problemKind']);
    const kinds = new Map<number, ProblemKind>();
    for (const pid of pids) {
        const doc = dict[pid];
        kinds.set(pid, doc ? effectiveProblemKind(doc) : 'blank');
    }
    return kinds;
}

export function concealObjectiveRecord<T extends { status?: number; score?: number }>(rdoc: T): T {
    const next = {
        ...rdoc,
        status: STATUS.STATUS_WAITING,
    };
    delete next.score;
    delete (next as { subtasks?: unknown }).subtasks;
    delete (next as { testCases?: unknown }).testCases;
    delete (next as { judgeTexts?: unknown }).judgeTexts;
    delete (next as { compilerTexts?: unknown }).compilerTexts;
    return next;
}

function penaltyOf(value: unknown): number {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value !== 'string') return 0;
    const head = value.split('\n')[0]?.split('/')[0]?.trim() ?? '';
    if (head === '' || head === PENDING) return 0;
    const parsed = Number(head);
    return Number.isFinite(parsed) ? parsed : 0;
}

/** Homework board times are `hours:minutes`, with the seconds already dropped. */
function boardMinutes(value: unknown): number {
    if (typeof value !== 'string') return 0;
    const line = value.split('\n').at(-1)?.trim() ?? '';
    const match = /^(\d+):(\d{2})$/.exec(line);
    if (!match) return 0;
    return Number(match[1]) * 60 + Number(match[2]);
}

function formatBoardMinutes(minutes: number): string {
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return `${hours}:${String(rest).padStart(2, '0')}`;
}

function problemColumns(header: ScoreboardRow): Array<{ index: number; pid: number }> {
    const columns: Array<{ index: number; pid: number }> = [];
    header.forEach((cell, index) => {
        if (cell?.type !== 'problem' || typeof cell.raw !== 'number' || !Number.isSafeInteger(cell.raw)) return;
        columns.push({ index, pid: cell.raw });
    });
    return columns;
}

/** Student homework board: objective cells become 待评测 and rank uses only function and programming scores. */
export function maskHomeworkObjectiveScoreboard(rows: ScoreboardRow[], kinds: ReadonlyMap<number, ProblemKind>): ScoreboardRow[] {
    const header = rows[0];
    if (!header) return rows;
    const columns = problemColumns(header);
    const totalIndex = header.findIndex((cell) => cell?.type === 'total_score');
    const timeIndex = header.findIndex((cell) => cell?.type === 'time');
    const rankIndex = header.findIndex((cell) => cell?.type === 'rank');
    const ranked: Array<{ row: ScoreboardRow; visible: number }> = [];
    const starred: ScoreboardRow[] = [];
    for (const source of rows.slice(1)) {
        const row = source.map((cell) => ({ ...cell })) as ScoreboardRow;
        let visible = 0;
        let visibleMinutes = 0;
        for (const column of columns) {
            const kind = kinds.get(column.pid) ?? 'blank';
            const cell = row[column.index];
            if (homeworkKindRevealsVerdict(kind)) {
                visible += penaltyOf(cell?.value);
                visibleMinutes += boardMinutes(cell?.value);
                continue;
            }
            const text = cell?.value == null ? '' : String(cell.value).trim();
            row[column.index] = { type: 'record', value: text === '' ? '' : PENDING };
        }
        const star = rankIndex >= 0 && String(source[rankIndex]?.value) === '*';
        if (totalIndex >= 0 && !star) row[totalIndex] = { ...row[totalIndex], type: row[totalIndex]?.type ?? 'total_score', value: String(visible) };
        if (timeIndex >= 0) {
            row[timeIndex] = {
                ...row[timeIndex],
                type: 'time',
                value: formatBoardMinutes(visibleMinutes),
                raw: visibleMinutes * 60,
            };
        }
        if (star) starred.push(row);
        else ranked.push({ row, visible });
    }
    ranked.sort((left, right) => right.visible - left.visible);
    let place = 0;
    let previous: number | null = null;
    ranked.forEach((item, index) => {
        if (previous === null || item.visible !== previous) {
            place = index + 1;
            previous = item.visible;
        }
        if (rankIndex >= 0) item.row[rankIndex] = { ...item.row[rankIndex], type: 'rank', value: String(place) };
    });
    return [header, ...ranked.map((item) => item.row), ...starred];
}
