import type { Collection, Document, ObjectId } from 'mongodb';
import { STATUS } from '@hydrooj/common/status';

interface UserStatisticsScope {
    domainId: string;
    uid: number;
}

export interface UserRecordStatistics {
    _id: UserStatisticsScope;
    nSubmit: number;
    nAccept: number;
}

export function userRecordStatisticsPipeline(excludedContests: readonly ObjectId[], scope?: UserStatisticsScope): Document[] {
    return [
        {
            $match: {
                ...(scope ? { domainId: scope.domainId } : {}),
                uid: { $gte: 0, ...(scope ? { $eq: scope.uid } : {}) },
                contest: { $nin: excludedContests },
                status: { $ne: STATUS.STATUS_CANCELED },
            },
        },
        {
            $group: {
                _id: { domainId: '$domainId', pid: '$pid', uid: '$uid' },
                nSubmit: { $sum: 1 },
                nAccept: { $max: { $cond: [{ $eq: ['$status', STATUS.STATUS_ACCEPTED] }, 1, 0] } },
            },
        },
        {
            $group: {
                _id: { domainId: '$_id.domainId', uid: '$_id.uid' },
                nSubmit: { $sum: '$nSubmit' },
                nAccept: { $sum: '$nAccept' },
            },
        },
    ];
}

export async function getUserRecordStatistics(
    collection: Pick<Collection, 'aggregate'>,
    excludedContests: readonly ObjectId[],
    scope: UserStatisticsScope,
): Promise<Pick<UserRecordStatistics, 'nSubmit' | 'nAccept'>> {
    const statistics = await collection.aggregate<UserRecordStatistics>(
        userRecordStatisticsPipeline(excludedContests, scope),
        { maxTimeMS: 5000 },
    ).next();
    // An empty aggregation means this user has no counted submissions; query errors propagate.
    return statistics ? { nSubmit: statistics.nSubmit, nAccept: statistics.nAccept } : { nSubmit: 0, nAccept: 0 };
}
