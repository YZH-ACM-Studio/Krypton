import type { ObjectId } from 'mongodb';

/**
 * AwardType — a competition award category. Preset 22 are seeded on first
 * boot; admin can add new types and adjust weights. `key` is the stable
 * machine id referenced on Award docs; `name` is the human label.
 */
export interface AwardType {
    _id: ObjectId;
    key: string;
    name: string;
    /** Base score multiplier (default 1.0). Per-type editable. */
    weight: number;
    /**
     * When true, the formula applies decayFactor^(liveRank-1) to the weight
     * before multiplying by baseScore. ICPC/CCPC use this; PAT/天梯赛 don't.
     */
    useRankDecay: boolean;
    /** Soft-delete flag. Hidden types still resolve on existing awards. */
    hidden: boolean;
    order: number;
    builtin: boolean;
}

/**
 * Per-award details on a person. Embedded in Person.awards[] rather than
 * stored as separate docs — most queries hit "give me one person's awards"
 * which is faster with embedded arrays at this scale (< 1k awards/person).
 */
export interface Award {
    /** References AwardType.key. */
    type: string;
    contest?: string;
    /** Display-only date string (admin input "2025-04" or "2025-04-13"). */
    date?: string;
    team?: string;
    liveRank?: number;
    schoolRank?: number;
    /**
     * 天梯赛 numeric score (0–290) — DISPLAY only, never affects ranking.
     * Single source of truth is `tasks.score_gplt`; this embedded value is now
     * a fallback. The leaderboard overlays the store value at read time (see
     * model.ts applyGpltStoreScores). For PAT it's the "实际考试得分".
     */
    score?: number;
    /**
     * 天梯赛 edition year (= 2015 + 届号), stamped by the one-time import so the
     * leaderboard can key the store lookup `(studentDocId, national, gpltYear)`
     * without re-parsing the contest name. See docs/PLAN-2026-06-07.
     */
    gpltYear?: number;
    teammates?: string[];
    /** Internal Hydro file URLs and / or external image URLs. */
    imageUrls?: string[];
    /** Index into imageUrls for the cover image; default 0. */
    coverIndex?: number;
}

/**
 * PersonRecord — one row on the rank board. Identity is a foreign key to
 * the userbind.students collection (`studentDocId`); name / school / OJ
 * stats are joined live, not duplicated here.
 */
export interface PersonRecord {
    _id: ObjectId;
    studentDocId: ObjectId;
    awards: Award[];
    employmentStatus?: string;
    createdAt: Date;
    updatedAt: Date;
    createdBy: number;
}

/**
 * GlobalConfig — single doc with `_id: 'global'`. baseScore and decayFactor
 * are referenced by the scoring formula at read-time.
 */
export interface RankBoardConfig {
    _id: 'global';
    baseScore: number;
    /**
     * Multiplier applied to each *subsequent* occurrence of the same
     * award type for a given person. The most recent award keeps full
     * weight; the second-most-recent gets `weight * decayFactor`, the
     * third `weight * decayFactor^2`, and so on — floored at `minRate`.
     *
     * Recommended: ~0.7 (each repeat keeps 70% of the previous).
     */
    decayFactor: number;
    /**
     * Floor multiplier — `decayFactor^N` is clamped to at least this
     * value so that repeat awards never decay to zero. Default 0.3
     * (every repeat is worth at least 30% of the full weight).
     */
    minRate?: number;
    updatedAt: Date;
}

/** Joined leaderboard row returned by listLeaderboard(). */
export interface LeaderboardRow {
    person: PersonRecord;
    student: {
        _id: ObjectId;
        studentId: string;
        realName: string;
        schoolId: ObjectId;
        schoolName: string;
        groupNames: string[];
        boundUserId: number | null;
    };
    user: {
        uname: string;
        nAccept: number;
        avatarUrl?: string;
    } | null;
    totalScore: number;
    awardCount: number;
    rank: number;
    /** Detailed per-award score breakdown for the detail drawer. */
    awardScores: number[];
}
