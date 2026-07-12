export const ADMIN_STATS_MAX_TIME_MS = 5_000;

export interface ContestStats {
    total: number;
    accepted: number;
    participants: number;
    byProblem: Array<{ pid: number; total: number; accepted: number }>;
    byHour: Array<{ hour: string; count: number }>;
    byLanguage: Array<{ language: string; count: number }>;
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
    return {
        total: Number(overall.total || 0),
        accepted: Number(overall.accepted || 0),
        participants: Number(overall.participants || 0),
        byProblem: (facet.byProblem || []).map((row) => ({
            pid: Number(row._id),
            total: Number(row.total || 0),
            accepted: Number(row.accepted || 0),
        })),
        byHour: (facet.byHour || []).map((row) => ({ hour: String(row._id), count: Number(row.count || 0) })),
        byLanguage: (facet.byLanguage || []).map((row) => ({ language: String(row._id), count: Number(row.count || 0) })),
    };
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

    return {
        enrollmentCount: identities.length,
        problemCount: uniquePids.length,
        byProblem: uniquePids.map((pid) => ({
            pid,
            completed: identities.reduce((count, member) => count + (acceptedByUid.get(member.uid)?.has(pid) ? 1 : 0), 0),
        })),
        progressDistribution: labels.map((label) => ({ label, count: distribution.get(label) || 0 })),
        members,
    };
}
