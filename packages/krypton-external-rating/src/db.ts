/**
 * Mongo collection for CF / Nowcoder contest rating history.
 *
 * Collection: `externalRating.history`. History is not stored on `user.externalRating`.
 */
import { db } from 'hydrooj';
import type { Collection } from 'mongodb';
import type { ExternalRatingSiteId } from './types';

export interface ExternalRatingHistoryDoc {
    uid: number;
    site: ExternalRatingSiteId;
    handle: string;
    contestId: string;
    contestName: string | null;
    ratedAt: Date;
    rating: number;
    oldRating: number | null;
    rank: number | null;
    ingestedAt: Date;
}

export const historyColl: Collection<ExternalRatingHistoryDoc> = db.collection<ExternalRatingHistoryDoc>('externalRating.history');

let indexesEnsured = false;

export async function ensureIndexes(): Promise<void> {
    if (indexesEnsured) return;
    try {
        await Promise.all([
            // uid/site/contestId are always present, so uniqueness is a full unique — not a partial.
            // Mongo partial indexes cannot use $exists:false / $ne / $not / $or.
            historyColl.createIndex({ uid: 1, site: 1, contestId: 1 }, { unique: true }),
            historyColl.createIndex({ uid: 1, site: 1, ratedAt: 1 }),
        ]);
        indexesEnsured = true;
    } catch (error) {
        indexesEnsured = false;
        throw error;
    }
}
