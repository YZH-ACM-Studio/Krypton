import { ObjectId } from 'mongodb';
import { isDeepStrictEqual } from 'node:util';
import type { Context } from '../context';
import { ValidationError } from '../error';
import type { ContestStat, RecordDoc, Tdoc } from '../interface';
import db from '../service/db';
import type { ContestTeamDoc } from './contest-team';

export interface TeamContestJournalEntry {
    rid: ObjectId;
    pid: number;
    status: number;
    score: number;
    subtasks?: Record<number, any>;
    lang?: string;
}

export interface TeamContestStatusDoc extends ContestStat {
    _id: ObjectId;
    domainId: string;
    contestId: ObjectId;
    teamId: ObjectId;
    revision: number;
    journal: TeamContestJournalEntry[];
    score: number;
    accept: number;
    time: number;
    createdAt: Date;
    updatedAt: Date;
}

export interface TeamScoreboardEntry {
    team: ContestTeamDoc;
    status: TeamContestStatusDoc;
}

export function firstAcceptedRidByProblem(statuses: TeamContestStatusDoc[], acceptedStatus: number): Record<number, string> {
    const first: Record<number, string> = {};
    for (const status of statuses) {
        for (const detail of Object.values(status.detail || {}) as Array<{ pid: number; rid?: ObjectId; status: number }>) {
            if (detail.status !== acceptedStatus || !(detail.rid instanceof ObjectId)) continue;
            const rid = detail.rid.toHexString();
            if (!first[detail.pid] || rid < first[detail.pid]) first[detail.pid] = rid;
        }
    }
    return first;
}

export function matchesFirstAcceptedRid(rid: ObjectId, first: string | number | undefined): boolean {
    if (typeof first === 'string') return rid.toHexString() === first;
    return typeof first === 'number' && rid.getTimestamp().getTime() === first;
}

type CalculateStats = (tdoc: Tdoc, journal: TeamContestJournalEntry[]) => ContestStat & { accept?: number; time?: number };

export const coll = db.collection<TeamContestStatusDoc>('contest.teamStatuses');

export function mergeScoreboardEntries(tdoc: Tdoc, teams: ContestTeamDoc[], statuses: TeamContestStatusDoc[]): TeamScoreboardEntry[] {
    const teamById = new Map(teams.map((team) => [team.teamId.toHexString(), team]));
    for (const status of statuses) {
        if (!teamById.has(status.teamId.toHexString())) {
            throw new Error(`Team contest status references missing team ${tdoc.domainId}/${tdoc.docId}/${status.teamId}.`);
        }
    }
    const statusByTeam = new Map(statuses.map((status) => [status.teamId.toHexString(), status]));
    return teams
        .filter((team) => team.active || statusByTeam.has(team.teamId.toHexString()))
        .map((team) => ({
            team,
            status:
                statusByTeam.get(team.teamId.toHexString()) ||
                ({
                    _id: team.teamId,
                    domainId: tdoc.domainId,
                    contestId: tdoc.docId,
                    teamId: team.teamId,
                    revision: 0,
                    journal: [],
                    score: 0,
                    accept: 0,
                    time: 0,
                    detail: {},
                    display: {},
                    createdAt: team.createdAt,
                    updatedAt: team.updatedAt,
                } as TeamContestStatusDoc),
        }))
        .sort(
            (left, right) =>
                (right.status.accept || 0) - (left.status.accept || 0) ||
                (left.status.time || 0) - (right.status.time || 0) ||
                left.team.nameKey.localeCompare(right.team.nameKey) ||
                left.team.teamId.toHexString().localeCompare(right.team.teamId.toHexString()),
        );
}

function sameId(left: ObjectId, right: ObjectId): boolean {
    return left instanceof ObjectId && right instanceof ObjectId && left.equals(right);
}

export function assertTeamContestRecord(tdoc: Tdoc, rdoc: RecordDoc): asserts rdoc is RecordDoc & { contest: ObjectId; contestTeamId: ObjectId } {
    if (!(rdoc.contest instanceof ObjectId) || !sameId(rdoc.contest, tdoc.docId)) throw new ValidationError('contest');
    if (!(rdoc.contestTeamId instanceof ObjectId)) throw new ValidationError('contestTeamId');
    if (!Number.isSafeInteger(rdoc.uid) || rdoc.uid <= 0 || !Number.isSafeInteger(rdoc.pid)) throw new ValidationError('record');
}

export function journalEntryFromRecord(rdoc: RecordDoc): TeamContestJournalEntry {
    if (!(rdoc._id instanceof ObjectId)) throw new ValidationError('rid');
    return {
        rid: rdoc._id,
        pid: rdoc.pid,
        status: rdoc.status,
        score: rdoc.score || 0,
        subtasks: rdoc.subtasks,
        lang: rdoc.lang,
    };
}

function sortedJournal(journal: TeamContestJournalEntry[]): TeamContestJournalEntry[] {
    return [...journal].sort(
        (left, right) =>
            left.rid.getTimestamp().getTime() - right.rid.getTimestamp().getTime() ||
            left.rid.toHexString().localeCompare(right.rid.toHexString()),
    );
}

function sameScoringSnapshot(left: RecordDoc, right: RecordDoc): boolean {
    return (
        left._id instanceof ObjectId &&
        right._id instanceof ObjectId &&
        left._id.equals(right._id) &&
        left.contest instanceof ObjectId &&
        right.contest instanceof ObjectId &&
        left.contest.equals(right.contest) &&
        left.contestTeamId instanceof ObjectId &&
        right.contestTeamId instanceof ObjectId &&
        left.contestTeamId.equals(right.contestTeamId) &&
        left.uid === right.uid &&
        left.pid === right.pid &&
        left.status === right.status &&
        left.score === right.score &&
        left.lang === right.lang &&
        isDeepStrictEqual(left.subtasks, right.subtasks)
    );
}

export function buildNextStatus(
    current: TeamContestStatusDoc | null,
    tdoc: Tdoc,
    teamId: ObjectId,
    entry: TeamContestJournalEntry,
    calculateStats: CalculateStats,
    now = new Date(),
): Omit<TeamContestStatusDoc, '_id' | 'revision'> {
    const journal = sortedJournal([...(current?.journal || []).filter((item) => !item.rid.equals(entry.rid)), entry]);
    const stats = calculateStats(tdoc, journal);
    return {
        domainId: tdoc.domainId,
        contestId: tdoc.docId,
        teamId,
        journal,
        ...stats,
        score: Number(stats.accept || 0),
        accept: Number(stats.accept || 0),
        time: Number(stats.time || 0),
        createdAt: current?.createdAt || now,
        updatedAt: now,
    };
}

export async function updateFromRecord(tdoc: Tdoc, rdoc: RecordDoc, calculateStats: CalculateStats): Promise<TeamContestStatusDoc> {
    assertTeamContestRecord(tdoc, rdoc);
    const entry = journalEntryFromRecord(rdoc);
    for (;;) {
        const current = await coll.findOne({ domainId: tdoc.domainId, contestId: tdoc.docId, teamId: rdoc.contestTeamId });
        const next = buildNextStatus(current, tdoc, rdoc.contestTeamId, entry, calculateStats);
        if (current) {
            const updated = await coll.findOneAndUpdate(
                { _id: current._id, revision: current.revision },
                { $set: next, $inc: { revision: 1 } },
                { returnDocument: 'after' },
            );
            if (updated) return updated;
            continue;
        }
        const created = { _id: new ObjectId(), revision: 1, ...next } as TeamContestStatusDoc;
        try {
            await coll.insertOne(created);
            return created;
        } catch (error: any) {
            if (error?.code === 11000) continue;
            throw error;
        }
    }
}

export async function synchronizeFromRecord(
    tdoc: Tdoc,
    rid: ObjectId,
    loadRecord: (rid: ObjectId) => Promise<RecordDoc | null>,
    calculateStats: CalculateStats,
): Promise<{ status: TeamContestStatusDoc; record: RecordDoc & { contestTeamId: ObjectId } }> {
    let current = await loadRecord(rid);
    if (!current) throw new ValidationError('record');
    for (;;) {
        const updated = await updateFromRecord(tdoc, current, calculateStats);
        const latest = await loadRecord(rid);
        if (!latest) throw new ValidationError('record');
        if (sameScoringSnapshot(current, latest)) return { status: updated, record: latest as RecordDoc & { contestTeamId: ObjectId } };
        current = latest;
    }
}

export async function recalculateOne(tdoc: Tdoc, teamId: ObjectId, calculateStats: CalculateStats): Promise<TeamContestStatusDoc | null> {
    for (;;) {
        const current = await coll.findOne({ domainId: tdoc.domainId, contestId: tdoc.docId, teamId });
        if (!current) return null;
        const journal = sortedJournal(current.journal || []);
        const stats = calculateStats(tdoc, journal);
        const updated = await coll.findOneAndUpdate(
            { _id: current._id, revision: current.revision },
            {
                $set: {
                    journal,
                    ...stats,
                    score: Number(stats.accept || 0),
                    accept: Number(stats.accept || 0),
                    time: Number(stats.time || 0),
                    updatedAt: new Date(),
                },
                $inc: { revision: 1 },
            },
            { returnDocument: 'after' },
        );
        if (updated) return updated;
    }
}

export async function recalculateAll(tdoc: Tdoc, calculateStats: CalculateStats): Promise<void> {
    const teamIds = await coll.distinct('teamId', { domainId: tdoc.domainId, contestId: tdoc.docId });
    await Promise.all(teamIds.map((teamId) => recalculateOne(tdoc, teamId, calculateStats)));
}

export function getMulti(domainId: string, contestId: ObjectId) {
    return coll.find({ domainId, contestId });
}

export async function get(domainId: string, contestId: ObjectId, teamId: ObjectId): Promise<TeamContestStatusDoc | null> {
    return await coll.findOne({ domainId, contestId, teamId });
}

export async function apply(ctx: Context) {
    await ctx.db.ensureIndexes(
        coll,
        { key: { domainId: 1, contestId: 1, teamId: 1 }, name: 'contestTeamStatusIdentity', unique: true },
        { key: { domainId: 1, contestId: 1, accept: -1, time: 1, teamId: 1 }, name: 'contestTeamStatusRank' },
    );
    ctx.on('domain/delete', (domainId) => coll.deleteMany({ domainId }));
    ctx.on('contest/del', (domainId, contestId) => coll.deleteMany({ domainId, contestId }));
}

global.Hydro.model.contestTeamStatus = {
    coll,
    assertTeamContestRecord,
    journalEntryFromRecord,
    buildNextStatus,
    firstAcceptedRidByProblem,
    matchesFirstAcceptedRid,
    mergeScoreboardEntries,
    updateFromRecord,
    synchronizeFromRecord,
    recalculateOne,
    recalculateAll,
    getMulti,
    get,
};
