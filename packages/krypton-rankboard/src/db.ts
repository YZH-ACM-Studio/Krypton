import { db } from 'hydrooj';
import type { AwardType, PersonRecord, RankBoardConfig } from './types';

export const awardTypesColl = db.collection<AwardType>('rankboard.award_types');
export const peopleColl = db.collection<PersonRecord>('rankboard.people');
export const configColl = db.collection<RankBoardConfig>('rankboard.config');

let indexesEnsured = false;

export async function ensureIndexes(): Promise<void> {
    if (indexesEnsured) return;
    indexesEnsured = true;
    await Promise.all([
        awardTypesColl.createIndex({ key: 1 }, { unique: true }),
        awardTypesColl.createIndex({ order: 1, hidden: 1 }),
        peopleColl.createIndex({ studentDocId: 1 }, { unique: true }),
        peopleColl.createIndex({ updatedAt: -1 }),
        configColl.createIndex({ _id: 1 }),
    ]);
}

/**
 * Preset 22 award types from the legacy CAUCOJRankBoard. Seeded on first
 * boot if `rankboard.award_types` is empty.
 */
export const PRESET_AWARD_TYPES: Array<Omit<AwardType, '_id'>> = [
    { key: 'icpc_gold', name: 'ICPC-金奖', weight: 6.0, useRankDecay: true, hidden: false, order: 10, builtin: true },
    { key: 'icpc_silver', name: 'ICPC-银奖', weight: 4.0, useRankDecay: true, hidden: false, order: 20, builtin: true },
    { key: 'icpc_bronze', name: 'ICPC-铜奖', weight: 2.0, useRankDecay: true, hidden: false, order: 30, builtin: true },
    { key: 'icpc_ec_gold', name: 'ICPC-EC-金奖', weight: 4.5, useRankDecay: true, hidden: false, order: 40, builtin: true },
    { key: 'icpc_ec_silver', name: 'ICPC-EC-银奖', weight: 3.5, useRankDecay: true, hidden: false, order: 50, builtin: true },
    { key: 'icpc_ec_bronze', name: 'ICPC-EC-铜奖', weight: 2.5, useRankDecay: true, hidden: false, order: 60, builtin: true },
    { key: 'ccpc_gold', name: 'CCPC-金奖', weight: 6.0, useRankDecay: true, hidden: false, order: 70, builtin: true },
    { key: 'ccpc_silver', name: 'CCPC-银奖', weight: 4.0, useRankDecay: true, hidden: false, order: 80, builtin: true },
    { key: 'ccpc_bronze', name: 'CCPC-铜奖', weight: 2.0, useRankDecay: true, hidden: false, order: 90, builtin: true },
    { key: 'baidu_gold', name: '百度之星-金奖', weight: 3.5, useRankDecay: false, hidden: false, order: 100, builtin: true },
    { key: 'baidu_silver', name: '百度之星-银奖', weight: 2.5, useRankDecay: false, hidden: false, order: 110, builtin: true },
    { key: 'baidu_bronze', name: '百度之星-铜奖', weight: 1.5, useRankDecay: false, hidden: false, order: 120, builtin: true },
    { key: 'pat_top', name: 'PAT-顶级', weight: 3.0, useRankDecay: false, hidden: false, order: 130, builtin: true },
    { key: 'pat_a', name: 'PAT-甲级', weight: 1.5, useRankDecay: false, hidden: false, order: 140, builtin: true },
    { key: 'pat_b', name: 'PAT-乙级', weight: 0.8, useRankDecay: false, hidden: false, order: 150, builtin: true },
    { key: 'ladder_team_special', name: '天梯赛-团队特等奖', weight: 3.0, useRankDecay: false, hidden: false, order: 160, builtin: true },
    { key: 'ladder_team_1', name: '天梯赛-团队一等奖', weight: 2.5, useRankDecay: false, hidden: false, order: 170, builtin: true },
    { key: 'ladder_team_2', name: '天梯赛-团队二等奖', weight: 1.8, useRankDecay: false, hidden: false, order: 180, builtin: true },
    { key: 'ladder_team_3', name: '天梯赛-团队三等奖', weight: 1.2, useRankDecay: false, hidden: false, order: 190, builtin: true },
    { key: 'ladder_individual_1', name: '天梯赛-个人一等奖', weight: 2.0, useRankDecay: false, hidden: false, order: 200, builtin: true },
    { key: 'ladder_individual_2', name: '天梯赛-个人二等奖', weight: 1.5, useRankDecay: false, hidden: false, order: 210, builtin: true },
    { key: 'ladder_individual_3', name: '天梯赛-个人三等奖', weight: 1.0, useRankDecay: false, hidden: false, order: 220, builtin: true },
];

export async function seedAwardTypesIfEmpty(): Promise<void> {
    const count = await awardTypesColl.estimatedDocumentCount();
    if (count > 0) return;
    await awardTypesColl.insertMany(
        PRESET_AWARD_TYPES.map((p) => ({ ...p } as AwardType)),
    );
}

export async function getConfig(): Promise<{ baseScore: number; decayFactor: number }> {
    const doc = await configColl.findOne({ _id: 'global' });
    if (!doc) return { baseScore: 100, decayFactor: 0.5 };
    return { baseScore: doc.baseScore, decayFactor: doc.decayFactor };
}

export async function setConfig(input: { baseScore: number; decayFactor: number }): Promise<void> {
    await configColl.updateOne(
        { _id: 'global' },
        {
            $set: {
                baseScore: input.baseScore,
                decayFactor: input.decayFactor,
                updatedAt: new Date(),
            },
            $setOnInsert: { _id: 'global' as const },
        },
        { upsert: true },
    );
}
