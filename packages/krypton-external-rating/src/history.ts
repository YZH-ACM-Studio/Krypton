/**
 * Persist official CF / Nowcoder contest rating points per Hydro uid + site.
 *
 * Identity is `{uid, site, contestId}`. Handle change and unset must not
 * delete existing points. Failed fetches and unrated null are not stored.
 */
import { ensureIndexes, historyColl, type ExternalRatingHistoryDoc } from './db';
import {
    EXTERNAL_RATING_MAX,
    EXTERNAL_RATING_MIN,
    EXTERNAL_RATING_SITES,
    ExternalRatingTypeError,
    isExternalRatingSiteId,
    type ExternalRatingSiteId,
} from './types';

export type { ExternalRatingHistoryDoc };

export const EXTERNAL_RATING_HISTORY_MAX_POINTS = 4096;

const HISTORY_POINT_KEYS = ['handle', 'contestId', 'contestName', 'ratedAt', 'rating', 'oldRating', 'rank'] as const;

export interface ExternalRatingHistoryPoint {
    handle: string;
    contestId: string;
    contestName?: string | null;
    ratedAt: Date;
    rating: number;
    oldRating?: number | null;
    rank?: number | null;
}

export interface ExternalRatingHistoryBySite {
    codeforces: ExternalRatingHistoryDoc[];
    nowcoder: ExternalRatingHistoryDoc[];
}

interface CanonicalHistoryPoint {
    handle: string;
    contestId: string;
    contestName: string | null;
    ratedAt: Date;
    rating: number;
    oldRating: number | null;
    rank: number | null;
}

function fail(field: string, message: string): never {
    throw new ExternalRatingTypeError(field, message);
}

function logStage(stage: string, uid: number, site: string, count: number): void {
    console.info(`krypton-external-rating.history stage=${stage} uid=${uid} site=${site} count=${count}`);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    if (value instanceof Date) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function assertUid(uid: unknown): number {
    if (typeof uid !== 'number' || !Number.isSafeInteger(uid) || uid <= 0) {
        fail('uid', 'uid must be a positive integer');
    }
    return uid;
}

function assertSite(site: unknown): ExternalRatingSiteId {
    if (!isExternalRatingSiteId(site)) fail('site', 'site must be codeforces or nowcoder');
    return site;
}

function assertSafeRating(value: unknown, field: string): number {
    if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
        fail(field, 'rating must be a safe integer');
    }
    if (value < EXTERNAL_RATING_MIN || value > EXTERNAL_RATING_MAX) {
        fail(field, 'rating is out of range');
    }
    return value;
}

function parseOptionalRating(value: unknown, field: string): number | null {
    if (value === undefined || value === null) return null;
    return assertSafeRating(value, field);
}

function parseOptionalRank(value: unknown, field: string): number | null {
    if (value === undefined || value === null) return null;
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
        fail(field, 'rank must be a non-negative safe integer or null');
    }
    return value;
}

function parseNonEmptyString(value: unknown, field: string): string {
    if (typeof value !== 'string') fail(field, `${field} must be a non-empty string`);
    const trimmed = value.trim();
    if (!trimmed) fail(field, `${field} must be a non-empty string`);
    return trimmed;
}

function parseRatedAt(value: unknown, field: string): Date {
    if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
        fail(field, 'ratedAt must be a valid Date');
    }
    return new Date(value.getTime());
}

function parseContestName(value: unknown, field: string): string | null {
    if (value === undefined || value === null) return null;
    if (typeof value !== 'string') fail(field, 'contestName must be a string or null');
    return value;
}

function parsePoint(value: unknown, index: number): CanonicalHistoryPoint {
    const field = `points[${index}]`;
    if (!isPlainObject(value)) fail(field, `${field} must be an object`);
    const allowed = new Set<string>(HISTORY_POINT_KEYS);
    for (const key of Object.keys(value)) {
        if (!allowed.has(key)) fail(`${field}.${key}`, `unknown field ${key}`);
    }
    return {
        handle: parseNonEmptyString(value.handle, `${field}.handle`),
        contestId: parseNonEmptyString(value.contestId, `${field}.contestId`),
        contestName: parseContestName(value.contestName, `${field}.contestName`),
        ratedAt: parseRatedAt(value.ratedAt, `${field}.ratedAt`),
        rating: assertSafeRating(value.rating, `${field}.rating`),
        oldRating: parseOptionalRating(value.oldRating, `${field}.oldRating`),
        rank: parseOptionalRank(value.rank, `${field}.rank`),
    };
}

function parsePoints(points: unknown): CanonicalHistoryPoint[] {
    if (!Array.isArray(points)) fail('points', 'points must be an array');
    if (points.length > EXTERNAL_RATING_HISTORY_MAX_POINTS) {
        fail('points', `history points exceed ${EXTERNAL_RATING_HISTORY_MAX_POINTS}`);
    }
    const parsed: CanonicalHistoryPoint[] = [];
    const seen = new Set<string>();
    for (let i = 0; i < points.length; i++) {
        const point = parsePoint(points[i], i);
        if (seen.has(point.contestId)) {
            fail(`points[${i}].contestId`, 'duplicate contestId in points');
        }
        seen.add(point.contestId);
        parsed.push(point);
    }
    return parsed;
}

function emptyBySite(): ExternalRatingHistoryBySite {
    return { codeforces: [], nowcoder: [] };
}

function partitionBySite(docs: ExternalRatingHistoryDoc[]): ExternalRatingHistoryBySite {
    const result = emptyBySite();
    for (const doc of docs) {
        if (!isExternalRatingSiteId(doc.site)) fail('site', 'stored history site is invalid');
        result[doc.site].push(doc);
    }
    return result;
}

async function findSorted(uid: number, site?: ExternalRatingSiteId): Promise<ExternalRatingHistoryDoc[]> {
    const filter = site === undefined ? { uid } : { uid, site };
    return await historyColl.find(filter).sort({ ratedAt: 1 }).toArray();
}

/**
 * Idempotent replace of each `{uid, site, contestId}`. Empty `points` is a
 * no-op and never deletes existing rows.
 */
export async function upsertPoints(
    uid: number,
    site: ExternalRatingSiteId,
    points: readonly ExternalRatingHistoryPoint[],
): Promise<void> {
    const id = assertUid(uid);
    const siteId = assertSite(site);
    const parsed = parsePoints(points);
    if (parsed.length === 0) {
        logStage('upsert', id, siteId, 0);
        return;
    }
    await ensureIndexes();
    const ingestedAt = new Date();
    const operations = parsed.map((point) => ({
        updateOne: {
            filter: { uid: id, site: siteId, contestId: point.contestId },
            update: {
                $set: {
                    uid: id,
                    site: siteId,
                    contestId: point.contestId,
                    handle: point.handle,
                    contestName: point.contestName,
                    ratedAt: point.ratedAt,
                    rating: point.rating,
                    oldRating: point.oldRating,
                    rank: point.rank,
                    ingestedAt,
                } satisfies ExternalRatingHistoryDoc,
            },
            upsert: true as const,
        },
    }));
    await historyColl.bulkWrite(operations);
    logStage('upsert', id, siteId, parsed.length);
}

export async function listHistory(uid: number): Promise<ExternalRatingHistoryBySite>;
export async function listHistory(uid: number, site: ExternalRatingSiteId): Promise<ExternalRatingHistoryDoc[]>;
export async function listHistory(
    uid: number,
    site?: ExternalRatingSiteId,
): Promise<ExternalRatingHistoryBySite | ExternalRatingHistoryDoc[]> {
    const id = assertUid(uid);
    if (site !== undefined) {
        const siteId = assertSite(site);
        await ensureIndexes();
        const docs = await findSorted(id, siteId);
        logStage('list', id, siteId, docs.length);
        return docs;
    }
    await ensureIndexes();
    const docs = await findSorted(id);
    const bySite = partitionBySite(docs);
    const count = EXTERNAL_RATING_SITES.reduce((total, key) => total + bySite[key].length, 0);
    logStage('list', id, 'all', count);
    return bySite;
}
