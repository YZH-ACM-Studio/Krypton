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

export const migrationScripts = [migrateV1];
