/**
 * Migration of legacy CAUCOJRankBoard data into the new schema.
 *
 *   rankboard.people  (legacy: { username, studentInfo, awards, ojProblems, ... })
 *   rankboard.config  (legacy: { weights: Record<typeName, weight>, params: { baseScore, decayFactor } })
 *
 * Strategy:
 *   1. Read legacy `rankboard.people` (matching the legacy domainId).
 *   2. For each legacy person, try to match a userbind student by (studentId, realName).
 *      Parse `studentInfo` which is "学号 姓名" format. On match, port awards
 *      and employmentStatus into the new schema keyed by studentDocId.
 *      Unmatched rows are written to a CSV report saved in system settings.
 *   3. Read legacy `rankboard.config` → set baseScore/decayFactor and
 *      align weights (by name → award type key) where possible.
 *
 * Defensive: if no legacy collections exist this is a no-op.
 */
import { Logger } from '@hydrooj/utils';
import type { Context } from 'hydrooj';
import { db, ObjectId, oncePerSetting } from 'hydrooj';
import { awardTypesColl, configColl, peopleColl, seedAwardTypesIfEmpty } from './db';

const logger = new Logger('rankboard.migration');
const MIGRATION_FLAG = 'rankboard.migration_v1_done';
const MIGRATION_FLAG_V2 = 'rankboard.migration_v2_done';

/**
 * Map of legacy award type names → new award_type.key. Covers:
 *   1. Direct name match for all 22 preset types.
 *   2. Legacy "全国" variants from old CAUC data (e.g. "天梯赛-团队全国一等奖")
 *      which omit "全国" in the new naming.
 *   3. "PAT甲级满分" → new pat_a_perfect type (created by v2).
 */
const NAME_TO_KEY: Record<string, string> = {
    'ICPC-金奖': 'icpc_gold',
    'ICPC-银奖': 'icpc_silver',
    'ICPC-铜奖': 'icpc_bronze',
    'ICPC-EC-金奖': 'icpc_ec_gold',
    'ICPC-EC-银奖': 'icpc_ec_silver',
    'ICPC-EC-铜奖': 'icpc_ec_bronze',
    'CCPC-金奖': 'ccpc_gold',
    'CCPC-银奖': 'ccpc_silver',
    'CCPC-铜奖': 'ccpc_bronze',
    '百度之星-金奖': 'baidu_gold',
    '百度之星-银奖': 'baidu_silver',
    '百度之星-铜奖': 'baidu_bronze',
    'PAT-顶级': 'pat_top',
    'PAT-甲级': 'pat_a',
    'PAT-乙级': 'pat_b',
    '天梯赛-团队特等奖': 'ladder_team_special',
    '天梯赛-团队一等奖': 'ladder_team_1',
    '天梯赛-团队二等奖': 'ladder_team_2',
    '天梯赛-团队三等奖': 'ladder_team_3',
    '天梯赛-个人一等奖': 'ladder_individual_1',
    '天梯赛-个人二等奖': 'ladder_individual_2',
    '天梯赛-个人三等奖': 'ladder_individual_3',
    // Legacy "全国" variants
    '天梯赛-团队全国特等奖': 'ladder_team_special',
    '天梯赛-团队全国一等奖': 'ladder_team_1',
    '天梯赛-团队全国二等奖': 'ladder_team_2',
    '天梯赛-团队全国三等奖': 'ladder_team_3',
    '天梯赛-个人全国一等奖': 'ladder_individual_1',
    '天梯赛-个人全国二等奖': 'ladder_individual_2',
    '天梯赛-个人全国三等奖': 'ladder_individual_3',
    // New type introduced by v2
    'PAT甲级满分': 'pat_a_perfect',
};

const KNOWN_KEYS = new Set(Object.values(NAME_TO_KEY));

interface LegacyPerson {
    _id: ObjectId;
    domainId?: string;
    username: string;
    studentInfo: string;
    ojProblems?: number;
    awards?: any[];
    userId?: number;
    uname?: string;
    employmentStatus?: string;
}

interface LegacyConfig {
    _id?: ObjectId;
    domainId?: string;
    weights?: Record<string, number>;
    params?: { baseScore: number; decayFactor: number };
}

async function legacyCollExists(name: string): Promise<boolean> {
    try {
        const colls = await db.db.listCollections({ name }).toArray();
        return colls.length > 0;
    } catch {
        return false;
    }
}

function parseStudentInfo(info: string): { studentId: string; realName: string } {
    const parts = String(info || '').trim().split(/\s+/);
    if (parts.length < 2) return { studentId: parts[0] || '', realName: '' };
    return { studentId: parts[0], realName: parts.slice(1).join(' ') };
}

async function migrateV1(_ctx: Context): Promise<void> {
    return await oncePerSetting(MIGRATION_FLAG, async () => {
        await seedAwardTypesIfEmpty();
        const studentsColl = db.collection<any>('userbind.students');

        // Legacy people
        if (await legacyCollExists('rankboard.people')) {
            const legacyPeople = db.collection<LegacyPerson>('rankboard.people' as any);
            const total = await legacyPeople.countDocuments();
            if (total === 0) {
                logger.info('legacy rankboard.people empty — skipping');
            } else {
                logger.info('migrating %d legacy people', total);
                const unmatched: Array<{ legacyId: string; studentInfo: string; reason: string }> = [];
                const cursor = legacyPeople.find({});
                let imported = 0;
                for await (const old of cursor) {
                    const parsed = parseStudentInfo(old.studentInfo);
                    if (!parsed.studentId || !parsed.realName) {
                        unmatched.push({ legacyId: String(old._id), studentInfo: old.studentInfo, reason: 'unparseable' });
                        continue;
                    }
                    const student = await studentsColl.findOne({
                        studentId: parsed.studentId, realName: parsed.realName,
                    });
                    if (!student) {
                        unmatched.push({ legacyId: String(old._id), studentInfo: old.studentInfo, reason: 'no_match' });
                        continue;
                    }
                    const existing = await peopleColl.findOne({ studentDocId: student._id });
                    if (existing) continue;
                    await peopleColl.insertOne({
                        _id: new ObjectId(),
                        studentDocId: student._id,
                        awards: (old.awards || []).map((a: any) => ({
                            type: a.type,
                            contest: a.contest,
                            date: a.date,
                            team: a.team,
                            liveRank: a.liveRank,
                            schoolRank: a.schoolRank,
                            score: a.score,
                            teammates: a.teammates,
                            imageUrls: a.imageUrls,
                            coverIndex: 0,
                        })),
                        employmentStatus: old.employmentStatus,
                        createdAt: new Date(),
                        updatedAt: new Date(),
                        createdBy: 1,
                    });
                    imported++;
                }
                logger.info('imported %d people, %d unmatched', imported, unmatched.length);
                if (unmatched.length) {
                    const csv = ['legacyId,studentInfo,reason']
                        .concat(unmatched.map((u) => `${u.legacyId},"${u.studentInfo.replace(/"/g, '""')}",${u.reason}`))
                        .join('\n');
                    await global.Hydro.model.system.set('rankboard.migration_v1_unmatched_csv', csv);
                }
            }
        }

        // Legacy config — pull baseScore/decayFactor; weights remapped by name match.
        if (await legacyCollExists('rankboard.config')) {
            const legacyCfg = db.collection<LegacyConfig>('rankboard.config' as any);
            const old = await legacyCfg.findOne({});
            if (old) {
                if (old.params?.baseScore != null || old.params?.decayFactor != null) {
                    await configColl.updateOne(
                        { _id: 'global' as const },
                        {
                            $set: {
                                baseScore: old.params?.baseScore ?? 100,
                                decayFactor: old.params?.decayFactor ?? 0.5,
                                updatedAt: new Date(),
                            },
                            $setOnInsert: { _id: 'global' as const },
                        },
                        { upsert: true },
                    );
                }
                if (old.weights) {
                    for (const [name, weight] of Object.entries(old.weights)) {
                        // Try to match by exact name → existing type.
                        await awardTypesColl.updateOne({ name }, { $set: { weight } });
                    }
                }
            }
        }
    });
}

/**
 * v2: fix three bugs introduced by v1.
 *
 *   1. Award types stored as Chinese display names (e.g. "ICPC-银奖") instead
 *      of stable keys (e.g. "icpc_silver"), so the leaderboard couldn't look
 *      them up in award_types → scores all 0.
 *   2. Legacy `awards[].imageUrl` (singular string) was read as `imageUrls`
 *      (plural array) during v1, dropping every image.
 *   3. Old-schema docs (with `studentInfo` and no `studentDocId`) were left
 *      in the collection alongside their new-schema copies → 96 dead docs.
 *
 * Also seeds the new `pat_a_perfect` award type referenced by the name map.
 *
 * Image salvage joins old → new by `studentDocId` (resolved through
 * userbind.students by parsing the legacy `studentInfo` "学号 姓名" string),
 * then matches individual awards by (contest, date, team) and copies the
 * legacy `imageUrl` into the new `imageUrls` array.
 */
async function migrateV2(_ctx: Context): Promise<void> {
    return await oncePerSetting(MIGRATION_FLAG_V2, async () => {
        const studentsColl = db.collection<any>('userbind.students');

        // 1. Seed the new pat_a_perfect award type (idempotent upsert).
        await awardTypesColl.updateOne(
            { key: 'pat_a_perfect' },
            {
                $set: {
                    name: 'PAT-甲级满分',
                    weight: 2.5,
                    useRankDecay: false,
                    order: 145,
                    hidden: false,
                },
                $setOnInsert: { key: 'pat_a_perfect', builtin: false },
            },
            { upsert: true },
        );

        // 2. Salvage images from old-schema docs to new-schema docs.
        const oldDocs = await peopleColl.find({
            studentDocId: { $exists: false } as any,
            studentInfo: { $exists: true } as any,
        } as any).toArray() as any[];
        logger.info('found %d legacy docs to salvage', oldDocs.length);

        let imagesRestored = 0;
        for (const old of oldDocs) {
            const parsed = parseStudentInfo(old.studentInfo);
            if (!parsed.studentId || !parsed.realName) continue;
            const student = await studentsColl.findOne({
                studentId: parsed.studentId, realName: parsed.realName,
            });
            if (!student) continue;
            const newDoc = await peopleColl.findOne({ studentDocId: student._id }) as any;
            if (!newDoc) continue;

            const newAwards = (newDoc.awards || []) as any[];
            let dirty = false;
            for (const oldAward of (old.awards || []) as any[]) {
                const oldImg = oldAward.imageUrl || (Array.isArray(oldAward.imageUrls) ? oldAward.imageUrls[0] : null);
                if (!oldImg) continue;
                const match = newAwards.find((a: any) => a.contest === oldAward.contest
                    && a.date === oldAward.date
                    && (a.team || null) === (oldAward.team || null));
                if (!match) continue;
                if (!Array.isArray(match.imageUrls) || match.imageUrls.length === 0) {
                    match.imageUrls = [oldImg];
                    match.coverIndex = 0;
                    dirty = true;
                    imagesRestored++;
                }
            }
            if (dirty) {
                await peopleColl.updateOne(
                    { _id: newDoc._id },
                    { $set: { awards: newAwards, updatedAt: new Date() } },
                );
            }
        }
        logger.info('restored %d award images', imagesRestored);

        // 3. Translate award.type from Chinese names to keys across all
        //    remaining new-schema docs.
        const cursor = peopleColl.find({ studentDocId: { $exists: true } });
        let updated = 0;
        const unmatched = new Set<string>();
        for await (const doc of cursor as any) {
            const awards = (doc.awards || []) as any[];
            let dirty = false;
            for (const award of awards) {
                const t = award.type;
                if (!t) continue;
                if (KNOWN_KEYS.has(t)) continue; // already a key
                const mapped = NAME_TO_KEY[t];
                if (mapped) {
                    award.type = mapped;
                    dirty = true;
                } else {
                    unmatched.add(t);
                }
            }
            if (dirty) {
                await peopleColl.updateOne(
                    { _id: doc._id },
                    { $set: { awards, updatedAt: new Date() } },
                );
                updated++;
            }
        }
        logger.info('translated award types on %d docs', updated);
        if (unmatched.size) {
            const list = [...unmatched].join('\n');
            logger.warn('unmatched award type names: %s', list);
            await global.Hydro.model.system.set(
                'rankboard.migration_v2_unmatched_types',
                list,
            );
        }

        // 4. Delete leftover old-schema docs.
        const delRes = await peopleColl.deleteMany({
            studentDocId: { $exists: false } as any,
        } as any);
        logger.info('deleted %d leftover old-schema docs', delRes.deletedCount);
    });
}

/**
 * v3: backfill `award_types.weight` from the legacy `rankboard.config.weights`.
 *
 * v1 tried to do this via exact-name match on `award_types.name` — but the
 * legacy config uses "全国" variants (e.g. "天梯赛-个人全国一等奖") and the
 * PRESET names omit them ("天梯赛-个人一等奖"). PAT names differ similarly
 * ("PAT甲级满分" vs "PAT-甲级"). The mismatch left ladder/PAT types at PRESET
 * defaults, badly under-weighting people with many ladder awards.
 *
 * v3 reuses `NAME_TO_KEY` (already correct in v2) to push every legacy
 * weight onto the matching `award_types.key`.
 */
async function migrateV3(_ctx: Context): Promise<void> {
    const V3_FLAG = 'rankboard.migration_v3_done';
    return await oncePerSetting(V3_FLAG, async () => {
        // Source of truth for legacy weights — try the production rankboard.config
        // first; admins may have edited it. Falls back to no-op if absent.
        if (!await legacyCollExists('rankboard.config')) {
            logger.info('v3: legacy rankboard.config not present, skipping');
            return;
        }
        const legacyCfg = db.collection<LegacyConfig>('rankboard.config' as any);
        const old = await legacyCfg.findOne({});
        if (!old?.weights) {
            logger.info('v3: legacy weights map empty, skipping');
            return;
        }
        let updated = 0;
        for (const [oldName, key] of Object.entries(NAME_TO_KEY)) {
            const w = (old.weights as any)[oldName];
            if (w == null) continue;
            const r = await awardTypesColl.updateOne({ key }, { $set: { weight: w } });
            if (r.modifiedCount) updated++;
        }
        logger.info('v3: backfilled %d award_type weights from legacy config', updated);
    });
}

export const migrationScripts = [migrateV1, migrateV2, migrateV3];
