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
    /** Manual override for an unusual scoring case; if set, replaces formula. */
    score?: number;
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
    decayFactor: number;
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
    } | null;
    totalScore: number;
    awardCount: number;
    rank: number;
    /** Detailed per-award score breakdown for the detail drawer. */
    awardScores: number[];
}
