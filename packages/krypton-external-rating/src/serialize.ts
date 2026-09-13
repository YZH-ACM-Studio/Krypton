/**
 * Client-safe projections of CF / Nowcoder rating snapshots.
 * Viewer flags are supplied by the caller; they are never read from a client payload.
 */
import {
    EXTERNAL_RATING_SITES,
    parseUserExternalRatingState,
    type ExternalRatingSitePrivilegedView,
    type ExternalRatingSitePublicView,
    type ExternalRatingSiteSnapshot,
    type ExternalRatingSiteId,
    type UserExternalRatingPrivilegedView,
    type UserExternalRatingState,
} from './types';

export interface ExternalRatingViewer {
    isSelf: boolean;
    isTeacherOrAdmin: boolean;
}

export type ExternalRatingOwnerView = UserExternalRatingPrivilegedView;

export type ExternalRatingPublicSiteView = ExternalRatingSitePublicView & { stale?: true };

export type ExternalRatingPublicView = {
    [K in ExternalRatingSiteId]?: ExternalRatingPublicSiteView;
};

export type ExternalRatingRankingView = {
    [K in ExternalRatingSiteId]?: number | null;
};

export type ExternalRatingProfileView = ExternalRatingOwnerView | ExternalRatingPublicView;

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return value != null && typeof value === 'object' && !Array.isArray(value);
}

function requireState(state: UserExternalRatingState): UserExternalRatingState {
    if (state == null) {
        throw new TypeError('external rating state must be an object');
    }
    return parseUserExternalRatingState(state);
}

function serializeFetchedAt(fetchedAt: Date | null): string | null {
    return fetchedAt ? fetchedAt.toISOString() : null;
}

function isPublicShow(snapshot: ExternalRatingSiteSnapshot): boolean {
    return snapshot.publicShow === true;
}

function serializeOwnerSite(snapshot: ExternalRatingSiteSnapshot): ExternalRatingSitePrivilegedView {
    return {
        handle: snapshot.handle,
        rating: snapshot.rating,
        fetchedAt: serializeFetchedAt(snapshot.fetchedAt),
        lastError: snapshot.lastError,
        publicShow: isPublicShow(snapshot),
    };
}

function serializePublicSite(snapshot: ExternalRatingSiteSnapshot): ExternalRatingPublicSiteView {
    const view: ExternalRatingPublicSiteView = {
        handle: snapshot.handle,
        rating: snapshot.rating,
        fetchedAt: serializeFetchedAt(snapshot.fetchedAt),
    };
    if (snapshot.lastError != null) view.stale = true;
    return view;
}

/** Full snapshot for the user themselves and teachers/admins. Includes lastError. */
export function serializeOwnerOrTeacher(state: UserExternalRatingState): ExternalRatingOwnerView {
    const snapshot = requireState(state);
    return {
        codeforces: serializeOwnerSite(snapshot.codeforces),
        nowcoder: serializeOwnerSite(snapshot.nowcoder),
    };
}

/**
 * Strangers only see sites with publicShow === true.
 * Missing/false publicShow omits the site. lastError is never sent; a generic
 * stale flag is used when a same-handle refresh failed after a successful snapshot.
 */
export function serializePublic(state: UserExternalRatingState): ExternalRatingPublicView {
    const snapshot = requireState(state);
    const view: ExternalRatingPublicView = {};
    for (const site of EXTERNAL_RATING_SITES) {
        const siteState = snapshot[site];
        if (!isPublicShow(siteState)) continue;
        view[site] = serializePublicSite(siteState);
    }
    return view;
}

/** Ranking only gets rating numbers for opted-in sites. Hidden sites are omitted. */
export function serializeRanking(state: UserExternalRatingState): ExternalRatingRankingView {
    const snapshot = requireState(state);
    const view: ExternalRatingRankingView = {};
    for (const site of EXTERNAL_RATING_SITES) {
        const siteState = snapshot[site];
        if (!isPublicShow(siteState)) continue;
        view[site] = siteState.rating;
    }
    return view;
}

/**
 * Profile serializer. Callers pass server-computed { isSelf, isTeacherOrAdmin }.
 * If neither flag is strictly true, the public projection is used.
 */
export function serializeForViewer(
    state: UserExternalRatingState,
    viewer: ExternalRatingViewer,
): ExternalRatingProfileView {
    if (!isPlainObject(viewer)) {
        throw new TypeError('external rating viewer must be { isSelf, isTeacherOrAdmin } from the caller');
    }
    if (viewer.isSelf === true || viewer.isTeacherOrAdmin === true) {
        return serializeOwnerOrTeacher(state);
    }
    return serializePublic(state);
}
