import { createHash } from 'crypto';
import { localizedErrorText, db, NotFoundError, ObjectId, UserModel } from 'hydrooj';
import { awardTypesColl, getConfig, importBatchesColl, peopleColl, seedAwardTypesIfEmpty, setConfig } from './db';
import type { Award, AwardType, ImportBatch, LeaderboardRow, PersonRecord } from './types';

const studentsColl = db.collection<any>('userbind.students');
const schoolsColl = db.collection<any>('userbind.schools');
const userGroupsColl = db.collection<any>('userbind.user_groups');

/**
 * 荣誉榜是 system-domain 单域插件。Every identity join and write must
 * resolve through this authoritative domain.
 */
export const RANKBOARD_DOMAIN = 'system';

/* ─── award types ─── */

export async function listAwardTypes(opts: { includeHidden?: boolean } = {}): Promise<AwardType[]> {
    await seedAwardTypesIfEmpty();
    const filter = opts.includeHidden ? {} : { hidden: { $ne: true } };
    return await awardTypesColl.find(filter).sort({ order: 1 }).toArray();
}

export async function upsertAwardType(input: {
    key: string;
    name: string;
    weight: number;
    useRankDecay: boolean;
    order: number;
    hidden?: boolean;
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

function personObjectId(id: ObjectId | string): ObjectId {
    return typeof id === 'string' ? new ObjectId(id) : id;
}

/** Bulk scope guard used by every list/batch path. */
async function listScopedPeople(filter: Record<string, unknown> = {}): Promise<PersonRecord[]> {
    const people = await peopleColl
        .find(filter as any)
        .sort({ updatedAt: -1 })
        .toArray();
    if (!people.length) return [];
    const studentIds = people.map((person) => person.studentDocId);
    const students = await studentsColl
        .find({
            _id: { $in: studentIds },
            domainId: RANKBOARD_DOMAIN,
        })
        .toArray();
    const validStudentIds = new Set(students.map((student: any) => String(student._id)));
    return people.filter((person) => validStudentIds.has(String(person.studentDocId)));
}

/** Single-person scope guard shared by admin reads and every personId write. */
async function getScopedPersonOrNull(id: ObjectId | string): Promise<PersonRecord | null> {
    const _id = personObjectId(id);
    const person = await peopleColl.findOne({ _id });
    if (!person) return null;
    const student = await studentsColl.findOne({
        _id: person.studentDocId,
        domainId: RANKBOARD_DOMAIN,
    });
    return student ? person : null;
}

async function requireScopedPerson(id: ObjectId | string): Promise<PersonRecord> {
    const person = await getScopedPersonOrNull(id);
    if (!person) throw new NotFoundError(localizedErrorText`person`, String(id));
    return person;
}

export async function listPeople(): Promise<PersonRecord[]> {
    return await listScopedPeople();
}

export async function getPerson(id: ObjectId | string): Promise<PersonRecord | null> {
    return await getScopedPersonOrNull(id);
}

export async function getPersonByStudent(studentDocId: ObjectId | string): Promise<PersonRecord | null> {
    const sid = personObjectId(studentDocId);
    const student = await studentsColl.findOne({ _id: sid, domainId: RANKBOARD_DOMAIN });
    if (!student) return null;
    const person = await peopleColl.findOne({ studentDocId: sid });
    return person ? await getScopedPersonOrNull(person._id) : null;
}

export async function createPerson(input: {
    studentDocId: ObjectId | string;
    createdBy: number;
    employmentStatus?: string;
    awards?: Award[];
}): Promise<PersonRecord> {
    const sid = typeof input.studentDocId === 'string' ? new ObjectId(input.studentDocId) : input.studentDocId;
    // Central invariant for every caller, including batch import: a rankboard
    // person may only reference a userbind student that actually resolves in
    // the system domain. Missing and outer-domain IDs intentionally share the
    // same not-found response.
    const student = await studentsColl.findOne({ _id: sid, domainId: RANKBOARD_DOMAIN });
    if (!student) throw new NotFoundError(localizedErrorText`student`, String(sid));
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

export async function updatePerson(id: ObjectId | string, patch: Partial<Pick<PersonRecord, 'awards' | 'employmentStatus'>>): Promise<void> {
    const person = await requireScopedPerson(id);
    await peopleColl.updateOne({ _id: person._id, studentDocId: person.studentDocId }, { $set: { ...patch, updatedAt: new Date() } });
}

export async function deletePerson(id: ObjectId | string): Promise<void> {
    const person = await requireScopedPerson(id);
    await peopleColl.deleteOne({ _id: person._id, studentDocId: person.studentDocId });
}

export async function addAward(id: ObjectId | string, award: Award): Promise<void> {
    const person = await requireScopedPerson(id);
    await peopleColl.updateOne(
        { _id: person._id, studentDocId: person.studentDocId },
        { $push: { awards: award } as any, $set: { updatedAt: new Date() } },
    );
}

export async function updateAwardAt(id: ObjectId | string, index: number, award: Award): Promise<void> {
    const person = await requireScopedPerson(id);
    const setObj: Record<string, any> = { updatedAt: new Date() };
    setObj[`awards.${index}`] = award;
    await peopleColl.updateOne({ _id: person._id, studentDocId: person.studentDocId }, { $set: setObj });
}

export async function removeAwardAt(id: ObjectId | string, index: number): Promise<void> {
    const person = await requireScopedPerson(id);
    const next = (person.awards || []).filter((_, i) => i !== index);
    await peopleColl.updateOne({ _id: person._id, studentDocId: person.studentDocId }, { $set: { awards: next, updatedAt: new Date() } });
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
    /** 可选姓名列 — createMissing 自动建档时必需（PLAN §5）。 */
    realName?: string;
}

export interface BatchImportReport {
    ok: number;
    notFound: string[]; // studentId for which no student doc exists
    unknownType: string[]; // award type key not found
    errors: Array<{ line: number; reason: string }>;
    /** createMissing 开启时自动建档的学生数。 */
    createdStudents: number;
    /** 本次导入创建的批次 ID（用于审计/回滚）。 */
    batchId?: string;
}

export interface BatchImportOptions {
    /** 未匹配学号自动在 userbind 建档（需 TSV 带姓名列 + 指定学校）。 */
    createMissing?: boolean;
    schoolId?: ObjectId;
}

function batchContentHash(rows: BatchImportRow[]): string {
    // Normalized, order-sensitive hash — the same TSV re-pasted verbatim
    // hits the same hash; reordering rows is treated as a different batch.
    // realName 不参与（它只影响建档、不影响奖项内容——补姓名列重贴同一批
    // 奖不应绕过幂等拒绝）。
    const normalized = rows.map(({ realName, ...rest }) => rest);
    return createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}

/**
 * TSV batch import (PLAN 2026-07-02 §5/§6):
 *
 *   studentId TAB awardType TAB contest TAB date TAB liveRank TAB schoolRank TAB team TAB teammates(comma-sep) TAB 姓名(可选)
 *
 * Every run is recorded as an ImportBatch; identical content (same hash,
 * not rolled back) is rejected — the old path pushed duplicate awards on
 * every re-run. Awards carry `importBatchId` for one-click rollback.
 * With `createMissing`, rows whose 学号 has no student record get a record
 * created via userbind's importStudents (full validation reused) first.
 */
export async function importAwardsBatch(rows: BatchImportRow[], actor: number, opts: BatchImportOptions = {}): Promise<BatchImportReport> {
    const domainId = RANKBOARD_DOMAIN;
    const report: BatchImportReport = {
        ok: 0,
        notFound: [],
        unknownType: [],
        errors: [],
        createdStudents: 0,
    };
    const contentHash = batchContentHash(rows);
    const batchId = new ObjectId();

    // 批次文档先落库（pending，okCount=0）再逐行导入：中途崩溃时已入库的
    // 奖项仍带 batchId、批次可见可回滚，contentHash 也占位挡住重导。
    // 配合 partial unique index，并发双提交同内容时第二个 insert 直接
    // E11000，check-then-insert 的竞态窗口关闭。
    const dup = await importBatchesColl.findOne({ contentHash, rolledBack: false });
    if (dup) {
        report.errors.push({
            line: 0,
            reason: `相同内容的批次已于 ${dup.createdAt.toISOString().slice(0, 16)} 导入过（批次 ${dup._id}）；如需重新导入请先回滚该批次`,
        });
        return report;
    }
    const batchDoc: ImportBatch = {
        _id: batchId,
        actor,
        createdAt: new Date(),
        source: 'tsv',
        contentHash,
        rowCount: rows.length,
        okCount: 0,
        createdStudents: 0,
        report: { ok: 0, notFound: [], unknownType: [], errors: [] },
        rolledBack: false,
    };
    try {
        await importBatchesColl.insertOne(batchDoc as any);
    } catch (e: any) {
        if (e?.code === 11000) {
            report.errors.push({ line: 0, reason: '相同内容的批次刚刚已被导入（并发提交），本次已跳过' });
            return report;
        }
        throw e;
    }

    const types = await listAwardTypes({ includeHidden: true });
    const typeKeys = new Set(types.map((t) => t.key));

    try {
        // createMissing 预处理：把查不到档案且带姓名的行先批量建档，复用
        // userbind 的 importStudents（校验/查重/自动绑定全在里面）。
        if (opts.createMissing && opts.schoolId) {
            const userbind = (global as any).Hydro?.model?.userbind;
            if (userbind?.importStudents) {
                const missing: Array<{ studentId: string; realName: string }> = [];
                const seen = new Set<string>();
                for (const row of rows) {
                    if (!row.studentId || !row.realName || seen.has(row.studentId)) continue;
                    seen.add(row.studentId);
                    const exists = await studentsColl.findOne({ domainId, studentId: row.studentId });
                    if (!exists) missing.push({ studentId: row.studentId, realName: row.realName.trim() });
                }
                if (missing.length > 0) {
                    const r = await userbind.importStudents(domainId, opts.schoolId, missing, actor);
                    report.createdStudents = r?.inserted ?? 0;
                }
            }
        }

        for (const [idx, row] of rows.entries()) {
            if (!row.studentId || !row.type) {
                report.errors.push({ line: idx + 1, reason: 'missing studentId or type' });
                continue;
            }
            if (!typeKeys.has(row.type)) {
                report.unknownType.push(row.type);
                continue;
            }
            const student = await studentsColl.findOne({ domainId, studentId: row.studentId });
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
                importBatchId: batchId,
            };
            // Ensure a person row exists, then push the award.
            const personId = (
                await createPerson({
                    studentDocId: student._id,
                    createdBy: actor,
                })
            )._id;
            await addAward(personId, award);
            report.ok++;
        }
    } catch (e) {
        // importStudents 抛异常（如学校不存在）或中途 mongo 故障：若没落任何
        // 数据就删掉占位批次（否则 contentHash 被永久占用、同 TSV 无法重导），
        // 然后把异常抛给上层（对抗性审查 G3/焦点 B）。已落部分奖项则保留批次
        // 供回滚。
        if (report.ok === 0 && report.createdStudents === 0) {
            await importBatchesColl.deleteOne({ _id: batchId }).catch(() => {
                /* best-effort */
            });
        }
        throw e;
    }

    if (report.ok === 0 && report.createdStudents === 0) {
        // 没落任何数据 → 删掉占位批次，释放 contentHash 让修正后的重导通过。
        await importBatchesColl.deleteOne({ _id: batchId });
        return report;
    }
    await importBatchesColl.updateOne(
        { _id: batchId },
        {
            $set: {
                okCount: report.ok,
                createdStudents: report.createdStudents,
                report: {
                    ok: report.ok,
                    notFound: report.notFound,
                    unknownType: report.unknownType,
                    errors: report.errors,
                },
            },
        },
    );
    report.batchId = String(batchId);
    return report;
}

/** 批次列表（审计视图），新→旧。 */
export async function listImportBatches(limit = 50): Promise<ImportBatch[]> {
    return await importBatchesColl.find({}).sort({ createdAt: -1 }).limit(limit).toArray();
}

/**
 * 回滚一个导入批次：从所有 people 的 awards 数组里 pull 掉带该 batchId 的
 * 奖项，标记批次 rolledBackAt。批次导入时自动建的 person 行若因此变空，
 * 保留不删（人工加入的空档案与之无法区分；空行不计分、admin 可手动删）。
 */
export async function rollbackImportBatch(batchId: ObjectId, actor: number): Promise<{ pulled: number }> {
    const batch = await importBatchesColl.findOne({ _id: batchId });
    if (!batch) throw new NotFoundError(localizedErrorText`ImportBatch`);
    if (batch.rolledBackAt) return { pulled: 0 };
    const scopedPeople = await listScopedPeople({ 'awards.importBatchId': batchId });
    const scopedPersonIds = scopedPeople.map((person) => person._id);
    const res = scopedPersonIds.length
        ? await peopleColl.updateMany(
              { _id: { $in: scopedPersonIds }, 'awards.importBatchId': batchId },
              { $pull: { awards: { importBatchId: batchId } } as any, $set: { updatedAt: new Date() } },
          )
        : { modifiedCount: 0 };
    await importBatchesColl.updateOne({ _id: batchId }, { $set: { rolledBack: true, rolledBackAt: new Date(), rolledBackBy: actor } });
    return { pulled: res.modifiedCount };
}

/* ─── scoring + leaderboard ─── */

/**
 * Computes the ranking-score contribution of one award.
 *
 * Derived from the legacy `CAUCOJRankBoard` algorithm (see
 * `dev/CAUCOJRankBoard/index.ts:233-248`) but with the ICPC/CCPC live-rank
 * decay deliberately **removed**:
 *
 *   score = weight × baseScore   (for every award type)
 *
 * Rationale: the original `weight * decayFactor^(liveRank-1)` decay
 * collapsed to 0 once `liveRank` was filled with real region/national
 * ranks (e.g. 47, 87) — which is how it ends up populated in production
 * today. The legacy OJ's screenshots produced non-zero ICPC scores only
 * because `liveRank` was empty back then; admins have since filled it in,
 * breaking the formula. We honor the displayed semantics (every award
 * worth its full weight) rather than the literal old code path.
 *
 * `award.liveRank` / `award.schoolRank` are preserved on the doc for UI
 * display ("现场 #87", "校内 #60") but no longer affect the score.
 * `award.score` (PAT exam grade) is also ignored — it's displayed
 * separately as the "实际考试得分".
 */
export function computeAwardScore(_award: Award, type: AwardType, baseScore: number, _decayFactor: number): number {
    return type.weight * baseScore;
}

/**
 * Parse the 天梯赛 edition year from an award's contest name. Prefers the
 * "YYYY年" prefix; falls back to the "第N届" edition (year = 2015 + N). Used
 * only as a fallback before the migration stamps `award.gpltYear`.
 */
export function gpltYearFromContest(contest?: string): number | null {
    if (!contest) return null;
    const m = contest.match(/(\d{4})\s*年/);
    if (m) return Number.parseInt(m[1], 10);
    const ed = contest.match(/第\s*(\d+)\s*届/);
    if (ed) return 2015 + Number.parseInt(ed[1], 10);
    return null;
}

/**
 * Overlay the 天梯赛 numeric score from tasks.score_gplt (national level)
 * onto each `ladder_*` award that does not already have an embedded score.
 * Honor-board edits persist; the store only fills empty display scores.
 * Mutates in place; does NOT affect ranking (computeAwardScore ignores
 * award.score). If the tasks plugin / helper is absent, embedded scores are
 * kept. See docs/PLAN-2026-06-07.
 */
export async function applyGpltStoreScores(people: PersonRecord[]): Promise<void> {
    const tasksModel = (global as any).Hydro?.model?.tasks;
    if (!tasksModel?.listGpltScores) return;
    const studentDocIds = people.map((p) => p.studentDocId);
    if (!studentDocIds.length) return;
    let docs: Array<{ studentDocId: ObjectId; year: number; score: number }> = [];
    try {
        docs = await tasksModel.listGpltScores('system', { studentDocIds, level: 'national' });
    } catch {
        return;
    }
    const scoreMap = new Map<string, number>();
    for (const d of docs) scoreMap.set(`${String(d.studentDocId)}:${d.year}`, d.score);
    for (const p of people) {
        for (const award of p.awards || []) {
            if (!String(award.type).startsWith('ladder_')) continue;
            if (award.score != null) continue;
            const year = (award as any).gpltYear ?? gpltYearFromContest(award.contest);
            if (year == null) continue;
            const s = scoreMap.get(`${String(p.studentDocId)}:${year}`);
            if (s != null) award.score = s;
        }
    }
}

/** Resolve a list of people into joined leaderboard rows. */
export async function listLeaderboard(): Promise<LeaderboardRow[]> {
    const [people, awardTypes, config] = await Promise.all([listPeople(), listAwardTypes({ includeHidden: true }), getConfig()]);
    const typeMap = new Map(awardTypes.map((t) => [t.key, t]));

    // Overlay empty 天梯赛 numeric scores from the tasks store; honor-board
    // edits already on the award are kept.
    await applyGpltStoreScores(people);

    // Pull student + school + groups + udoc in bulk.
    const studentIds = people.map((p) => p.studentDocId);
    const students = studentIds.length
        ? await studentsColl
              .find({
                  _id: { $in: studentIds },
                  domainId: RANKBOARD_DOMAIN,
              })
              .toArray()
        : [];
    const studentMap = new Map<string, any>(students.map((s) => [String(s._id), s]));

    const schoolIds = Array.from(new Set(students.map((s) => String(s.schoolId)))).filter(Boolean);
    const schools = schoolIds.length ? await schoolsColl.find({ _id: { $in: schoolIds.map((id) => new ObjectId(id)) } }).toArray() : [];
    const schoolMap = new Map<string, any>(schools.map((s) => [String(s._id), s]));

    const allGroupIds: ObjectId[] = [];
    for (const s of students) {
        for (const g of s.groupIds || []) allGroupIds.push(g);
    }
    const groups = allGroupIds.length ? await userGroupsColl.find({ _id: { $in: allGroupIds } }).toArray() : [];
    const groupMap = new Map<string, any>(groups.map((g) => [String(g._id), g]));

    const uids = students.map((s) => s.boundUserId).filter((u) => u && u > 0) as number[];
    const udocs = uids.length ? await UserModel.getList('system', uids) : {};

    const rows: LeaderboardRow[] = people.map((person) => {
        const student = studentMap.get(String(person.studentDocId));
        const school = student ? schoolMap.get(String(student.schoolId)) : null;
        const groupNames: string[] = student
            ? ((student.groupIds || []).map((gid: ObjectId) => groupMap.get(String(gid))?.name).filter((n: string | undefined) => !!n) as string[])
            : [];
        const udoc = student?.boundUserId ? (udocs as any)[student.boundUserId] : null;
        // Legacy algorithm: each award is independent (no occurrence grouping).
        let totalScore = 0;
        const awardScores: number[] = (person.awards || []).map((award) => {
            const t = typeMap.get(award.type);
            if (!t) return 0;
            const s = computeAwardScore(award, t, config.baseScore, config.decayFactor);
            totalScore += s;
            return s;
        });
        return {
            person,
            student: student
                ? {
                      _id: student._id,
                      studentId: student.studentId,
                      realName: student.realName,
                      schoolId: student.schoolId,
                      schoolName: school?.name || '—',
                      groupNames,
                      boundUserId: student.boundUserId,
                      enrollmentYear: student.enrollmentYear ?? null,
                  }
                : {
                      _id: person.studentDocId,
                      studentId: '—',
                      realName: '（学生档案已删除）',
                      schoolId: person.studentDocId,
                      schoolName: '—',
                      groupNames: [],
                      boundUserId: null,
                      enrollmentYear: null,
                  },
            user: udoc
                ? {
                      uname: udoc.uname,
                      nAccept: udoc.nAccept || 0,
                      avatarUrl: (udoc as any).avatarUrl || '',
                  }
                : null,
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

/**
 * 画廊内联上传（PLAN §7）：把一张已上传的图片 URL 挂到指定奖项上。
 * 用 $addToSet 原子追加（并发两位教师传图不会互相覆盖）；`expectType`
 * 非空时作为写条件（`awards.<i>.type` 必须匹配），把 TOCTOU 校验做成
 * 原子写——错位/回滚导致 index 指向别的奖时 matched=0，返回 null 让上层
 * 回 409（对抗性审查 G8）。
 */
export async function addAwardImage(
    personId: ObjectId,
    awardIndex: number,
    url: string,
    setCover = false,
    expectType?: string,
    replace = false,
): Promise<string[] | null> {
    const scopedPerson = await requireScopedPerson(personId);
    const award = scopedPerson.awards?.[awardIndex];
    if (!award || (expectType && award.type !== expectType)) return null;
    const filter: Record<string, unknown> = {
        _id: scopedPerson._id,
        studentDocId: scopedPerson.studentDocId,
        [`awards.${awardIndex}`]: { $exists: true },
    };
    if (expectType) filter[`awards.${awardIndex}.type`] = expectType;
    const imageUrlsPath = `awards.${awardIndex}.imageUrls`;
    const coverIndexPath = `awards.${awardIndex}.coverIndex`;
    const currentImageUrls = award.imageUrls;
    if (currentImageUrls != null && !Array.isArray(currentImageUrls)) {
        throw new Error(`Rankboard award imageUrls is not an array: person=${personId} awardIndex=${awardIndex}`);
    }

    let res;
    if (replace) {
        res = await peopleColl.updateOne(filter as any, {
            $set: {
                [imageUrlsPath]: [url],
                [coverIndexPath]: 0,
                updatedAt: new Date(),
            } as any,
        });
    } else if (Array.isArray(currentImageUrls)) {
        res = await peopleColl.updateOne(filter as any, {
            $addToSet: { [imageUrlsPath]: url } as any,
            $set: { updatedAt: new Date() },
        });
    } else {
        // Legacy imports may have null/missing imageUrls. Initialize only while
        // it is still null; if another request won that race, append normally.
        res = await peopleColl.updateOne({ ...filter, [imageUrlsPath]: null } as any, {
            $set: { [imageUrlsPath]: [url], updatedAt: new Date() } as any,
        });
        if (!res.matchedCount) {
            res = await peopleColl.updateOne(filter as any, {
                $addToSet: { [imageUrlsPath]: url } as any,
                $set: { updatedAt: new Date() },
            });
        }
    }
    if (!res.matchedCount) return null;

    // Read and verify the committed array. A matched write without the URL is
    // an integrity failure, never a successful empty response.
    const person = await getScopedPersonOrNull(scopedPerson._id);
    const imageUrls = person?.awards?.[awardIndex]?.imageUrls;
    if (!Array.isArray(imageUrls) || !imageUrls.includes(url)) {
        throw new Error(`Rankboard image write postcondition failed: person=${personId} awardIndex=${awardIndex} url=${url}`);
    }
    if (setCover && !replace) {
        const coverIndex = imageUrls.indexOf(url);
        const coverResult = await peopleColl.updateOne({ ...filter, [imageUrlsPath]: imageUrls } as any, {
            $set: { [coverIndexPath]: coverIndex, updatedAt: new Date() } as any,
        });
        if (!coverResult.matchedCount) {
            throw new Error(`Rankboard image cover write failed: person=${personId} awardIndex=${awardIndex} url=${url}`);
        }
    }
    return imageUrls;
}

/* ─── 荣誉照片墙 (PLAN 2026-07-02 §7) ─── */

export interface GalleryMember {
    personId: string;
    realName: string;
    studentId: string;
    /** 该成员对应奖项在其 awards 数组中的下标 — 图片上传的写入目标。 */
    awardIndex: number;
    /** 天梯赛个人数字分（store 覆盖后），仅 ladder 卡片有意义。 */
    score?: number;
}

interface GalleryCardBase {
    year: number | null;
    /** ladder = 奖项类型名（天梯赛-团队一等奖）；icpc = 比赛名。 */
    title: string;
    typeKey: string;
    typeName: string;
    team: string | null;
    contest: string | null;
    members: GalleryMember[];
    imageUrls: string[];
    coverIndex: number;
    /** 上传照片时写入哪条奖项（组内第一个成员的对应奖项）。 */
    uploadTarget: { personId: string; awardIndex: number };
}

export type GalleryTeamRankStatus = 'confirmed' | 'missing' | 'conflict';
export type LadderGalleryCard = GalleryCardBase & { kind: 'ladder' };
export type IcpcGalleryCard = GalleryCardBase & {
    kind: 'icpc';
    /** ICPC/CCPC 现场队伍排名；异常态必须为 null。 */
    teamRank: number | null;
    teamRankStatus: GalleryTeamRankStatus;
};
export type GalleryCard = LadderGalleryCard | IcpcGalleryCard;
export interface GalleryYearBucket {
    year: number | null;
    ladder: LadderGalleryCard[];
    icpc: IcpcGalleryCard[];
}

/**
 * 按年聚合获奖卡片：天梯赛 = 团队奖按 (year, type, team) 去重合并成员；
 * ICPC/CCPC = 按 (year, contest, team) 一队一卡。年份读取时派生
 * `gpltYear ?? parseInt(date)`（生产数据 ICPC/CCPC 100% 有 date，天梯有
 * gpltYear），两者皆缺进 year=null 分组。照片取组内所有成员奖项的并集。
 */
export async function buildGallery(): Promise<{ years: GalleryYearBucket[] }> {
    const [people, awardTypes] = await Promise.all([listPeople(), listAwardTypes({ includeHidden: true })]);
    await applyGpltStoreScores(people);
    const typeMap = new Map(awardTypes.map((t) => [t.key, t]));

    const studentIds = people.map((p) => p.studentDocId);
    const students = studentIds.length
        ? await studentsColl
              .find({
                  _id: { $in: studentIds },
                  domainId: RANKBOARD_DOMAIN,
              })
              .toArray()
        : [];
    const studentMap = new Map<string, any>(students.map((s) => [String(s._id), s]));

    const awardYear = (a: Award): number | null => {
        if (a.gpltYear) return a.gpltYear;
        const y = a.date ? Number.parseInt(String(a.date).slice(0, 4), 10) : Number.NaN;
        return Number.isInteger(y) && y >= 2000 && y <= 2100 ? y : gpltYearFromContest(a.contest);
    };

    const cards = new Map<string, GalleryCard>();
    const teamRankStates = new Map<string, { values: Set<number>; missing: boolean; invalid: boolean }>();
    // 记录哪些卡片的封面来自奖项上显式设置的 coverIndex——显式封面一旦
    // 选定就不再被后续奖项的默认首图覆盖。
    const coverExplicit = new Set<string>();
    for (const p of people) {
        const student = studentMap.get(String(p.studentDocId));
        (p.awards || []).forEach((a, awardIndex) => {
            const isLadderTeam = String(a.type).startsWith('ladder_team');
            const isIcpc = /^(?:icpc|ccpc)/.test(String(a.type));
            if (!isLadderTeam && !isIcpc) return;
            const hasTeamRank = Number.isInteger(a.liveRank) && a.liveRank! > 0;
            const hasRawTeamRank = a.liveRank != null;
            const year = awardYear(a);
            const t = typeMap.get(a.type);
            // ICPC key 必须含奖级（a.type）：同场比赛里 team 都为空的金奖队和
            // 铜奖队成员否则会混进同一张卡（对抗性审查 #5）。
            const key = isLadderTeam ? `L|${year}|${a.type}|${a.team || ''}` : `I|${year}|${a.contest || ''}|${a.type}|${a.team || ''}`;
            let teamRankState: { values: Set<number>; missing: boolean; invalid: boolean } | undefined;
            if (isIcpc) {
                teamRankState = teamRankStates.get(key);
                if (!teamRankState) {
                    teamRankState = { values: new Set<number>(), missing: false, invalid: false };
                    teamRankStates.set(key, teamRankState);
                }
                if (hasTeamRank) teamRankState.values.add(a.liveRank!);
                else if (hasRawTeamRank) teamRankState.invalid = true;
                else teamRankState.missing = true;
            }
            let card = cards.get(key);
            if (!card) {
                const cardBase: GalleryCardBase = {
                    year,
                    title: isLadderTeam ? t?.name || a.type : a.contest || t?.name || a.type,
                    typeKey: a.type,
                    typeName: t?.name || a.type,
                    team: a.team || null,
                    contest: a.contest || null,
                    members: [],
                    imageUrls: [],
                    coverIndex: 0,
                    uploadTarget: { personId: String(p._id), awardIndex },
                };
                card = isLadderTeam ? { ...cardBase, kind: 'ladder' } : { ...cardBase, kind: 'icpc', teamRank: null, teamRankStatus: 'missing' };
                cards.set(key, card);
            }
            if (teamRankState) {
                if (card.kind !== 'icpc') {
                    throw new Error(`Rankboard gallery team-rank state attached to ${card.kind} card: ${key}`);
                }
                if (teamRankState.invalid || teamRankState.values.size > 1) {
                    card.teamRank = null;
                    card.teamRankStatus = 'conflict';
                } else if (teamRankState.missing || teamRankState.values.size === 0) {
                    card.teamRank = null;
                    card.teamRankStatus = 'missing';
                } else {
                    card.teamRank = teamRankState.values.values().next().value!;
                    card.teamRankStatus = 'confirmed';
                }
            }
            card.members.push({
                personId: String(p._id),
                realName: student?.realName || '（档案已删）',
                studentId: student?.studentId || '—',
                awardIndex,
                ...(isLadderTeam && a.score != null ? { score: a.score } : {}),
            });
            const explicitCover = a.coverIndex != null;
            for (const [i, url] of (a.imageUrls || []).entries()) {
                const isThisAwardCover = i === (a.coverIndex ?? 0);
                const dupIndex = card.imageUrls.indexOf(url);
                if (dupIndex < 0) card.imageUrls.push(url);
                const urlIndex = dupIndex < 0 ? card.imageUrls.length - 1 : dupIndex;
                // 封面优先级：显式 coverIndex > 卡片第一张图。显式封面选定后
                // 不被后续奖项的默认首图覆盖；即便封面图与已有图重复（dedupe
                // 跳过 push），仍按其在卡片里的下标记录封面（对抗性审查 #4）。
                if (isThisAwardCover && !coverExplicit.has(key) && (explicitCover || urlIndex === 0)) {
                    card.coverIndex = urlIndex;
                    if (explicitCover) coverExplicit.add(key);
                }
            }
        });
    }

    const byYear = new Map<string, GalleryYearBucket>();
    for (const card of cards.values()) {
        const yk = card.year == null ? 'unknown' : String(card.year);
        let bucket = byYear.get(yk);
        if (!bucket) {
            bucket = { year: card.year, ladder: [], icpc: [] };
            byYear.set(yk, bucket);
        }
        if (card.kind === 'ladder') bucket.ladder.push(card);
        else bucket.icpc.push(card);
    }
    const years = [...byYear.values()].sort((a, b) => {
        if (a.year == null) return 1;
        if (b.year == null) return -1;
        return b.year - a.year;
    });
    for (const y of years) {
        // 奖级高的排前面（order 小 = 奖级高），同级按队名稳定排序。
        y.ladder.sort(
            (a, b) => (typeMap.get(a.typeKey)?.order ?? 999) - (typeMap.get(b.typeKey)?.order ?? 999) || (a.team || '').localeCompare(b.team || ''),
        );
        y.icpc.sort(
            (a, b) => (typeMap.get(a.typeKey)?.order ?? 999) - (typeMap.get(b.typeKey)?.order ?? 999) || (a.title || '').localeCompare(b.title || ''),
        );
    }
    return { years };
}

export { getConfig, setConfig };
