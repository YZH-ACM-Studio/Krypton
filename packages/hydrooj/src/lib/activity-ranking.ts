import { NEWCOMER_DAYS, type ActivityBoard, type ActivityStanding } from '@hydrooj/common/activity-ranking';

/** Only publicly attributable solves enter this projection. A newly released earlier result can move both the day and the newcomer window. */
export function publicFirstSolves(rows: Iterable<{ uid: number; pid: number; day: number }>) {
    const users = new Map<number, Map<number, number>>();
    for (const { uid, pid, day } of rows) {
        let problems = users.get(uid);
        if (!problems) {
            problems = new Map();
            users.set(uid, problems);
        }
        const previous = problems.get(pid);
        if (previous === undefined || day < previous) problems.set(pid, day);
    }
    return users;
}

export function activityStandings(users: ReadonlyMap<number, ReadonlyMap<number, number>>, board: ActivityBoard,
    window: { start: number; end: number }, members: ReadonlySet<number>) {
    const rows: ActivityStanding[] = [];
    let earliest = Infinity;
    for (const [uid, problems] of users) {
        if (!members.has(uid)) continue;
        let first = Infinity;
        for (const day of problems.values()) first = Math.min(first, day);
        earliest = Math.min(earliest, first);
        const end = board === 'newcomers' ? Math.min(window.end, first + NEWCOMER_DAYS) : window.end;
        let solves = 0;
        const days = new Set<number>();
        for (const day of problems.values()) {
            if (day < window.start || day >= end) continue;
            solves++;
            days.add(day);
        }
        if (solves) rows.push({ uid, solves, activeDays: days.size, rank: 0 });
    }
    const metric = board === 'consistency' ? 'activeDays' : 'solves';
    rows.sort((a, b) => b[metric] - a[metric] || a.uid - b.uid);
    for (let i = 0; i < rows.length; i++) {
        rows[i].rank = i > 0 && rows[i][metric] === rows[i - 1][metric] ? rows[i - 1].rank : i + 1;
    }
    return { rows, earliest: Number.isFinite(earliest) ? earliest : null };
}
