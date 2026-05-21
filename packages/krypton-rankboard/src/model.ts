import { ObjectId, UserModel, db } from 'hydrooj';
import {
    awardTypesColl, peopleColl, seedAwardTypesIfEmpty, getConfig, setConfig,
} from './db';
import type {
    Award, AwardType, LeaderboardRow, PersonRecord,
} from './types';

const studentsColl = db.collection<any>('userbind.students');
const schoolsColl = db.collection<any>('userbind.schools');
const userGroupsColl = db.collection<any>('userbind.user_groups');

/* ─── award types ─── */

export async function listAwardTypes(opts: { includeHidden?: boolean } = {}): Promise<AwardType[]> {
    await seedAwardTypesIfEmpty();
    const filter = opts.includeHidden ? {} : { hidden: { $ne: true } };
    return await awardTypesColl.find(filter).sort({ order: 1 }).toArray();
}

export async function upsertAwardType(input: {
    key: string; name: string; weight: number; useRankDecay: boolean;
    order: number; hidden?: boolean;
}): Promise<void> {
    await awardTypesColl.updateOne(
        { key: input.key },
        {
            $set: {
                name: input.name,
                weight: input.weight,
                useRankDecay: !!input.useRankDecay,
                order: input.order,
                hidden: !!input.hidden,
            },
            $setOnInsert: { key: input.key, builtin: false },
        },
        { upsert: true },
    );
}

export async function deleteAwardType(key: string): Promise<{ ok: boolean; reason?: string }> {
    const t = await awardTypesColl.findOne({ key });
    if (!t) return { ok: false, reason: 'not_found' };
    // In-use check: any person.awards[].type === key → soft-delete instead of hard.
    const inUse = await peopleColl.findOne({ 'awards.type': key });
    if (inUse) {
        await awardTypesColl.updateOne({ key }, { $set: { hidden: true } });
        return { ok: false, reason: 'soft_hidden' };
    }
    if (t.builtin) {
        await awardTypesColl.updateOne({ key }, { $set: { hidden: true } });
        return { ok: false, reason: 'soft_hidden' };
    }
    await awardTypesColl.deleteOne({ key });
    return { ok: true };
}

/* ─── people ─── */

export async function listPeople(): Promise<PersonRecord[]> {
    return await peopleColl.find({}).sort({ updatedAt: -1 }).toArray();
}

export async function getPerson(id: ObjectId | string): Promise<PersonRecord | null> {
    const _id = typeof id === 'string' ? new ObjectId(id) : id;
    return await peopleColl.findOne({ _id });
}

export async function getPersonByStudent(studentDocId: ObjectId | string): Promise<PersonRecord | null> {
    const sid = typeof studentDocId === 'string' ? new ObjectId(studentDocId) : studentDocId;
    return await peopleColl.findOne({ studentDocId: sid });
}

export async function createPerson(input: {
    studentDocId: ObjectId | string;
    createdBy: number;
    employmentStatus?: string;
    awards?: Award[];
}): Promise<PersonRecord> {
    const sid = typeof input.studentDocId === 'string' ? new ObjectId(input.studentDocId) : input.studentDocId;
    const existing = await peopleColl.findOne({ studentDocId: sid });
    if (existing) return existing;
    const doc: PersonRecord = {
        _id: new ObjectId(),
        studentDocId: sid,
        awards: input.awards || [],
        employmentStatus: input.employmentStatus,
        createdAt: new Date(),
        updatedAt: new Date(),
        createdBy: input.createdBy,
    };
    await peopleColl.insertOne(doc);
    return doc;
}

export async function updatePerson(
    id: ObjectId | string,
    patch: Partial<Pick<PersonRecord, 'awards' | 'employmentStatus'>>,
): Promise<void> {
    const _id = typeof id === 'string' ? new ObjectId(id) : id;
    await peopleColl.updateOne({ _id }, { $set: { ...patch, updatedAt: new Date() } });
}

export async function deletePerson(id: ObjectId | string): Promise<void> {
    const _id = typeof id === 'string' ? new ObjectId(id) : id;
    await peopleColl.deleteOne({ _id });
}

export async function addAward(id: ObjectId | string, award: Award): Promise<void> {
    const _id = typeof id === 'string' ? new ObjectId(id) : id;
    await peopleColl.updateOne(
        { _id },
        { $push: { awards: award } as any, $set: { updatedAt: new Date() } },
    );
}

export async function updateAwardAt(id: ObjectId | string, index: number, award: Award): Promise<void> {
    const _id = typeof id === 'string' ? new ObjectId(id) : id;
    const setObj: Record<string, any> = { updatedAt: new Date() };
    setObj[`awards.${index}`] = award;
    await peopleColl.updateOne({ _id }, { $set: setObj });
}

export async function removeAwardAt(id: ObjectId | string, index: number): Promise<void> {
    const _id = typeof id === 'string' ? new ObjectId(id) : id;
    const person = await peopleColl.findOne({ _id });
    if (!person) return;
    const next = (person.awards || []).filter((_, i) => i !== index);
    await peopleColl.updateOne({ _id }, { $set: { awards: next, updatedAt: new Date() } });
}

/* ─── batch import ─── */

export interface BatchImportRow {
    studentId: string;
    type: string;
    contest?: string;
    date?: string;
    team?: string;
    liveRank?: number;
    schoolRank?: number;
    teammates?: string[];
}

export interface BatchImportReport {
    ok: number;
    notFound: string[];   // studentId for which no student doc exists
    unknownType: string[];  // award type key not found
    errors: Array<{ line: number; reason: string }>;
}

/**
 * Parse a TSV / line-based batch import:
 *
 *   studentId TAB awardType TAB contest TAB date TAB liveRank TAB schoolRank TAB teammates(comma-sep)
 *
 * Returns the per-row outcomes for the admin preview UI.
 */
export async function importAwardsBatch(
    rows: BatchImportRow[],
    actor: number,
): Promise<BatchImportReport> {
    const report: BatchImportReport = { ok: 0, notFound: [], unknownType: [], errors: [] };
    const types = await listAwardTypes({ includeHidden: true });
    const typeKeys = new Set(types.map((t) => t.key));

    for (const [idx, row] of rows.entries()) {
        if (!row.studentId || !row.type) {
            report.errors.push({ line: idx + 1, reason: 'missing studentId or type' });
            continue;
        }
        if (!typeKeys.has(row.type)) {
            report.unknownType.push(row.type);
            continue;
        }
        const student = await studentsColl.findOne({ studentId: row.studentId });
        if (!student) {
            report.notFound.push(row.studentId);
            continue;
        }
        const award: Award = {
            type: row.type,
            contest: row.contest,
            date: row.date,
            team: row.team,
            liveRank: row.liveRank,
            schoolRank: row.schoolRank,
            teammates: row.teammates,
        };
        // Ensure a person row exists, then push the award.
        const personId = (await createPerson({
            studentDocId: student._id, createdBy: actor,
        }))._id;
        await addAward(personId, award);
        report.ok++;
    }
    return report;
}

/* ─── scoring + leaderboard ─── */

export function computeAwardScore(
    award: Award, type: AwardType, baseScore: number, decayFactor: number,
): number {
    if (award.score != null && Number.isFinite(award.score)) return award.score;
    let w = type.weight;
    if (type.useRankDecay && award.liveRank && award.liveRank > 0) {
        w *= Math.pow(decayFactor, Math.max(0, award.liveRank - 1));
    }
    return w * baseScore;
}

/** Resolve a list of people into joined leaderboard rows. */
export async function listLeaderboard(): Promise<LeaderboardRow[]> {
    const [people, awardTypes, config] = await Promise.all([
        listPeople(),
        listAwardTypes({ includeHidden: true }),
        getConfig(),
    ]);
    const typeMap = new Map(awardTypes.map((t) => [t.key, t]));

    // Pull student + school + groups + udoc in bulk.
    const studentIds = people.map((p) => p.studentDocId);
    const students = studentIds.length
        ? await studentsColl.find({ _id: { $in: studentIds } }).toArray()
        : [];
    const studentMap = new Map<string, any>(students.map((s) => [String(s._id), s]));

    const schoolIds = Array.from(new Set(students.map((s) => String(s.schoolId)))).filter(Boolean);
    const schools = schoolIds.length
        ? await schoolsColl.find({ _id: { $in: schoolIds.map((id) => new ObjectId(id)) } }).toArray()
        : [];
    const schoolMap = new Map<string, any>(schools.map((s) => [String(s._id), s]));

    const allGroupIds: ObjectId[] = [];
    for (const s of students) {
        for (const g of s.groupIds || []) allGroupIds.push(g);
    }
    const groups = allGroupIds.length
        ? await userGroupsColl.find({ _id: { $in: allGroupIds } }).toArray()
        : [];
    const groupMap = new Map<string, any>(groups.map((g) => [String(g._id), g]));

    const uids = students.map((s) => s.boundUserId).filter((u) => u && u > 0) as number[];
    const udocs = uids.length ? await UserModel.getList('system', uids) : {};

    const rows: LeaderboardRow[] = people.map((person) => {
        const student = studentMap.get(String(person.studentDocId));
        const school = student ? schoolMap.get(String(student.schoolId)) : null;
        const groupNames: string[] = student
            ? (student.groupIds || [])
                .map((gid: ObjectId) => groupMap.get(String(gid))?.name)
                .filter((n: string | undefined) => !!n) as string[]
            : [];
        const udoc = student?.boundUserId ? (udocs as any)[student.boundUserId] : null;
        let totalScore = 0;
        const awardScores: number[] = [];
        for (const award of person.awards || []) {
            const t = typeMap.get(award.type);
            const s = t ? computeAwardScore(award, t, config.baseScore, config.decayFactor) : 0;
            awardScores.push(s);
            totalScore += s;
        }
        return {
            person,
            student: student ? {
                _id: student._id,
                studentId: student.studentId,
                realName: student.realName,
                schoolId: student.schoolId,
                schoolName: school?.name || '—',
                groupNames,
                boundUserId: student.boundUserId,
            } : {
                _id: person.studentDocId,
                studentId: '—',
                realName: '（学生档案已删除）',
                schoolId: person.studentDocId,
                schoolName: '—',
                groupNames: [],
                boundUserId: null,
            },
            user: udoc ? { uname: udoc.uname, nAccept: udoc.nAccept || 0 } : null,
            totalScore,
            awardCount: (person.awards || []).length,
            rank: 0, // assigned below
            awardScores,
        };
    });

    rows.sort((a, b) => b.totalScore - a.totalScore);
    let lastScore = -Infinity;
    let lastRank = 0;
    rows.forEach((r, idx) => {
        if (r.totalScore !== lastScore) {
            lastRank = idx + 1;
            lastScore = r.totalScore;
        }
        r.rank = lastRank;
    });
    return rows;
}

export { getConfig, setConfig };
