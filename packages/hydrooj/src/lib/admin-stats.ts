export const ADMIN_STATS_MAX_TIME_MS = 5_000;
const DAY_MS = 24 * 60 * 60 * 1_000;
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1_000;

export function shanghaiDayWindow(days: number, now = new Date()) {
    if (!Number.isInteger(days) || days <= 0) throw new RangeError('days must be a positive integer');
    const shifted = new Date(now.getTime() + SHANGHAI_OFFSET_MS);
    const todayLocalAsUtc = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate());
    const firstLocalAsUtc = todayLocalAsUtc - (days - 1) * DAY_MS;
    return {
        since: new Date(firstLocalAsUtc - SHANGHAI_OFFSET_MS),
        days: Array.from({ length: days }, (_, index) => new Date(firstLocalAsUtc + index * DAY_MS).toISOString().slice(0, 10)),
    };
}

function passRate(accepted: number, total: number): number | null {
    return total > 0 ? accepted / total : null;
}

function average(values: number[]): number {
    if (!values.length) return 0;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values: number[]): number {
    if (!values.length) return 0;
    const sorted = values.slice().sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export interface UserStats {
    total: number;
    accepted: number;
    activeDays: number;
    passRate: number | null;
    byDay: Array<{ day: string; total: number; accepted: number }>;
}

export interface DashboardStats {
    total: number;
    accepted: number;
    participants: number;
    passRate: number | null;
    byDay: Array<{ day: string; total: number; accepted: number; activeUsers: number }>;
}

export interface ProblemStatsRow {
    pid: number;
    total: number;
    accepted: number;
    wrongAnswer: number;
    timeLimit: number;
    compileError: number;
}

export interface ContestStats {
    total: number;
    accepted: number;
    participants: number;
    passRate: number | null;
    submitsPerParticipant: number;
    byProblem: Array<{ pid: number; total: number; accepted: number }>;
    byHour: Array<{ hour: string; count: number; accepted: number }>;
    byLanguage: Array<{ language: string; count: number; percent: number }>;
}

export function contestStatsPipeline(domainId: string, contestId: unknown, acceptedStatus: number, timezone = 'Asia/Shanghai') {
    return [
        { $match: { domainId, contest: contestId } },
        {
            $facet: {
                overall: [
                    {
                        $group: {
                            _id: null,
                            total: { $sum: 1 },
                            accepted: { $sum: { $cond: [{ $eq: ['$status', acceptedStatus] }, 1, 0] } },
                            participantIds: { $addToSet: '$uid' },
                        },
                    },
                    { $project: { _id: 0, total: 1, accepted: 1, participants: { $size: '$participantIds' } } },
                ],
                byProblem: [
                    {
                        $group: {
                            _id: '$pid',
                            total: { $sum: 1 },
                            accepted: { $sum: { $cond: [{ $eq: ['$status', acceptedStatus] }, 1, 0] } },
                        },
                    },
                    { $sort: { _id: 1 } },
                ],
                byHour: [
                    {
                        $group: {
                            _id: {
                                $dateToString: {
                                    format: '%Y-%m-%dT%H',
                                    date: { $toDate: '$_id' },
                                    timezone,
                                },
                            },
                            count: { $sum: 1 },
                            accepted: { $sum: { $cond: [{ $eq: ['$status', acceptedStatus] }, 1, 0] } },
                        },
                    },
                    { $sort: { _id: 1 } },
                ],
                byLanguage: [
                    { $group: { _id: { $ifNull: ['$lang', 'unknown'] }, count: { $sum: 1 } } },
                    { $sort: { count: -1, _id: 1 } },
                ],
            },
        },
    ];
}

export function normalizeContestStats(rows: any[]): ContestStats {
    const facet = rows[0] || {};
    const overall = facet.overall?.[0] || {};
    const total = Number(overall.total || 0);
    const accepted = Number(overall.accepted || 0);
    const participants = Number(overall.participants || 0);
    return {
        total,
        accepted,
        participants,
        passRate: passRate(accepted, total),
        submitsPerParticipant: participants > 0 ? total / participants : 0,
        byProblem: (facet.byProblem || []).map((row) => ({
            pid: Number(row._id),
            total: Number(row.total || 0),
            accepted: Number(row.accepted || 0),
        })),
        byHour: (facet.byHour || []).map((row) => ({
            hour: String(row._id),
            count: Number(row.count || 0),
            accepted: Number(row.accepted || 0),
        })),
        byLanguage: (facet.byLanguage || []).map((row) => {
            const count = Number(row.count || 0);
            return {
                language: String(row._id),
                count,
                percent: total > 0 ? (count / total) * 100 : 0,
            };
        }),
    };
}

export function userStatsPipeline(
    domainId: string,
    uid: number,
    acceptedStatus: number,
    since: unknown,
    timezone = 'Asia/Shanghai',
) {
    const dayExpression = {
        $dateToString: { format: '%Y-%m-%d', date: { $toDate: '$_id' }, timezone },
    };
    return [
        { $match: { domainId, uid } },
        {
            $facet: {
                overall: [
                    {
                        $group: {
                            _id: null,
                            total: { $sum: 1 },
                            accepted: { $sum: { $cond: [{ $eq: ['$status', acceptedStatus] }, 1, 0] } },
                            days: { $addToSet: dayExpression },
                        },
                    },
                    { $project: { _id: 0, total: 1, accepted: 1, activeDays: { $size: '$days' } } },
                ],
                byDay: [
                    { $match: { _id: { $gte: since } } },
                    {
                        $group: {
                            _id: dayExpression,
                            total: { $sum: 1 },
                            accepted: { $sum: { $cond: [{ $eq: ['$status', acceptedStatus] }, 1, 0] } },
                        },
                    },
                    { $sort: { _id: 1 } },
                ],
            },
        },
    ];
}

export function normalizeUserStats(rows: any[], expectedDays: string[] = []): UserStats {
    const facet = rows[0] || {};
    const overall = facet.overall?.[0] || {};
    const total = Number(overall.total || 0);
    const accepted = Number(overall.accepted || 0);
    const byDay = new Map<string, any>((facet.byDay || []).map((row) => [String(row._id), row]));
    return {
        total,
        accepted,
        activeDays: Number(overall.activeDays || 0),
        passRate: passRate(accepted, total),
        byDay: (expectedDays.length ? expectedDays : Array.from(byDay.keys()).sort()).map((day) => ({
            day,
            total: Number(byDay.get(day)?.total || 0),
            accepted: Number(byDay.get(day)?.accepted || 0),
        })),
    };
}

export function groupUserStatsPipeline(domainId: string, uids: number[], acceptedStatus: number) {
    return [
        { $match: { domainId, uid: { $in: uids } } },
        {
            $group: {
                _id: '$uid',
                total: { $sum: 1 },
                accepted: { $sum: { $cond: [{ $eq: ['$status', acceptedStatus] }, 1, 0] } },
            },
        },
        { $sort: { _id: 1 } },
    ];
}

export function dashboardStatsPipeline(
    domainId: string,
    acceptedStatus: number,
    since: unknown,
    timezone = 'Asia/Shanghai',
) {
    return [
        { $match: { domainId } },
        {
            $facet: {
                overall: [
                    {
                        $group: {
                            _id: null,
                            total: { $sum: 1 },
                            accepted: { $sum: { $cond: [{ $eq: ['$status', acceptedStatus] }, 1, 0] } },
                            participantIds: { $addToSet: '$uid' },
                        },
                    },
                    { $project: { _id: 0, total: 1, accepted: 1, participants: { $size: '$participantIds' } } },
                ],
                byDay: [
                    { $match: { _id: { $gte: since } } },
                    {
                        $group: {
                            _id: {
                                $dateToString: {
                                    format: '%Y-%m-%d',
                                    date: { $toDate: '$_id' },
                                    timezone,
                                },
                            },
                            total: { $sum: 1 },
                            accepted: { $sum: { $cond: [{ $eq: ['$status', acceptedStatus] }, 1, 0] } },
                            participantIds: { $addToSet: '$uid' },
                        },
                    },
                    {
                        $project: {
                            _id: 1,
                            total: 1,
                            accepted: 1,
                            activeUsers: { $size: '$participantIds' },
                        },
                    },
                    { $sort: { _id: 1 } },
                ],
            },
        },
    ];
}

export function normalizeDashboardStats(rows: any[], expectedDays: string[] = []): DashboardStats {
    const facet = rows[0] || {};
    const overall = facet.overall?.[0] || {};
    const total = Number(overall.total || 0);
    const accepted = Number(overall.accepted || 0);
    const byDay = new Map<string, any>((facet.byDay || []).map((row) => [String(row._id), row]));
    return {
        total,
        accepted,
        participants: Number(overall.participants || 0),
        passRate: passRate(accepted, total),
        byDay: (expectedDays.length ? expectedDays : Array.from(byDay.keys()).sort()).map((day) => ({
            day,
            total: Number(byDay.get(day)?.total || 0),
            accepted: Number(byDay.get(day)?.accepted || 0),
            activeUsers: Number(byDay.get(day)?.activeUsers || 0),
        })),
    };
}

export function problemStatsPipeline(
    domainId: string,
    pids: number[],
    statuses: { accepted: number; wrongAnswer: number; timeLimit: number; compileError: number },
) {
    const countStatus = (status: number) => ({ $sum: { $cond: [{ $eq: ['$status', status] }, 1, 0] } });
    return [
        { $match: { domainId, pid: { $in: pids } } },
        {
            $group: {
                _id: '$pid',
                total: { $sum: 1 },
                accepted: countStatus(statuses.accepted),
                wrongAnswer: countStatus(statuses.wrongAnswer),
                timeLimit: countStatus(statuses.timeLimit),
                compileError: countStatus(statuses.compileError),
            },
        },
        { $sort: { _id: 1 } },
    ];
}

export function normalizeProblemStats(rows: any[]): ProblemStatsRow[] {
    return rows.map((row) => ({
        pid: Number(row._id),
        total: Number(row.total || 0),
        accepted: Number(row.accepted || 0),
        wrongAnswer: Number(row.wrongAnswer || 0),
        timeLimit: Number(row.timeLimit || 0),
        compileError: Number(row.compileError || 0),
    }));
}

export function trainingEnrollmentPipeline(domainId: string, trainingId: unknown) {
    return [
        { $match: { domainId, docType: 40, docId: trainingId, uid: { $gt: 1 }, enroll: 1 } },
        { $group: { _id: '$uid' } },
        { $sort: { _id: 1 } },
    ];
}

export function trainingAcceptedPairsPipeline(domainId: string, memberUids: number[], pids: number[], acceptedStatus: number) {
    return [
        {
            $match: {
                domainId,
                docType: 10,
                uid: { $in: memberUids },
                docId: { $in: pids },
                status: acceptedStatus,
            },
        },
        { $group: { _id: { uid: '$uid', pid: '$docId' } } },
        { $sort: { '_id.uid': 1, '_id.pid': 1 } },
    ];
}

export interface TrainingMemberIdentity {
    uid: number;
    uname: string;
    studentId?: string;
    realName?: string;
}

export interface TrainingStats {
    enrollmentCount: number;
    problemCount: number;
    averageProgress: number;
    medianProgress: number;
    byProblem: Array<{ pid: number; completed: number }>;
    progressDistribution: Array<{ label: string; count: number }>;
    members: Array<TrainingMemberIdentity & { done: number; total: number; progress: number }>;
}

function progressBucket(progress: number): string {
    if (progress === 0) return '0%';
    if (progress <= 25) return '1–25%';
    if (progress <= 50) return '26–50%';
    if (progress <= 75) return '51–75%';
    if (progress < 100) return '76–99%';
    return '100%';
}

export function buildTrainingStats(
    identities: TrainingMemberIdentity[],
    pids: number[],
    acceptedPairs: Array<{ uid: number; pid: number }>,
): TrainingStats {
    const uniquePids = Array.from(new Set(pids));
    const acceptedByUid = new Map<number, Set<number>>();
    for (const pair of acceptedPairs) {
        if (!uniquePids.includes(pair.pid)) continue;
        const done = acceptedByUid.get(pair.uid) || new Set<number>();
        done.add(pair.pid);
        acceptedByUid.set(pair.uid, done);
    }

    const members = identities.map((identity) => {
        const done = acceptedByUid.get(identity.uid)?.size || 0;
        const progress = uniquePids.length ? Math.round((done / uniquePids.length) * 100) : 100;
        return { ...identity, done, total: uniquePids.length, progress };
    }).sort((a, b) => b.progress - a.progress || a.uid - b.uid);

    const labels = ['0%', '1–25%', '26–50%', '51–75%', '76–99%', '100%'];
    const distribution = new Map(labels.map((label) => [label, 0]));
    for (const member of members) distribution.set(progressBucket(member.progress), (distribution.get(progressBucket(member.progress)) || 0) + 1);
    const progressValues = members.map((member) => member.progress);

    return {
        enrollmentCount: identities.length,
        problemCount: uniquePids.length,
        averageProgress: average(progressValues),
        medianProgress: median(progressValues),
        byProblem: uniquePids.map((pid) => ({
            pid,
            completed: identities.reduce((count, member) => count + (acceptedByUid.get(member.uid)?.has(pid) ? 1 : 0), 0),
        })),
        progressDistribution: labels.map((label) => ({ label, count: distribution.get(label) || 0 })),
        members,
    };
}
