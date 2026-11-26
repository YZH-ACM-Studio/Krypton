import { randomUUID } from 'node:crypto';
import { assertSetPublishable, contestProblemScoreWeight, examScoresForPool, parseContestProblemScores, setConfigMessage } from '@hydrooj/common';
import { localizedErrorText, ValidationError } from '../error';
import type { Tdoc } from '../interface';
import { planPaperPointsEdit } from './set-paper-edit';
import { storedSetConfigOrNull } from './set-publication';
import { loadSetPublishFacts } from './set-publish-facts';

/** Basic edits must leave a published set runnable with its canonical settings. */
export async function assertSetBasicEdit(current: Tdoc, patch: Partial<Tdoc>): Promise<void> {
    const config = storedSetConfigOrNull(current);
    if (!config) return;
    if (patch.rule !== undefined && patch.rule !== current.rule) {
        throw new ValidationError('rule', null, localizedErrorText`题目集类型不能在旧赛制表单中修改，请调整高级设置。`);
    }
    if (config.settings.codePolicy !== 'acm' && (
        (patch.pids && patch.pids.join(',') !== current.pids.join(','))
        || (patch.score && current.pids.some((pid) => contestProblemScoreWeight(current, pid) !== contestProblemScoreWeight(patch, pid)))
    )) throw new ValidationError('problemScores', null, localizedErrorText`请在「题目 → 编辑题目」中调整试卷或分值。`);
    if (config.publication === 'published') {
        try {
            assertSetPublishable(config, await loadSetPublishFacts({ ...current, ...patch }, config));
        } catch (error) {
            if (error instanceof TypeError) {
                const message = setConfigMessage(error.message);
                throw new ValidationError('setConfig', null, localizedErrorText`${message}`);
            }
            throw error;
        }
    }
}

/** Composer saves only the paper; synthetic edit-form dates must never become real settings. */
export async function planSetPaperEdit(current: Tdoc, pids: number[], rawScores?: string, paperEdit?: string, actor?: number) {
    const config = storedSetConfigOrNull(current);
    if (!config) throw new ValidationError('setConfig');
    if (paperEdit !== undefined) {
        if (rawScores !== undefined || !Number.isSafeInteger(actor)) throw new ValidationError('paperEdit');
        return planPaperPointsEdit(current, pids, paperEdit, actor!);
    }
    if (config.settings.codePolicy !== 'acm') {
        throw new ValidationError('paperEdit', null, localizedErrorText`请刷新教师组卷页，按卷内满分保存。`);
    }
    let score: Record<number, number>;
    try {
        score = examScoresForPool(rawScores
            ? parseContestProblemScores(JSON.parse(rawScores))
            : Object.fromEntries(pids.filter((pid) => current.score?.[pid] !== undefined).map((pid) => [pid, current.score[pid]])), pids);
    } catch {
        throw new ValidationError('problemScores', null, localizedErrorText`题目分数无效`);
    }
    await assertSetBasicEdit(current, { pids, score });
    const scoresChanged = pids.some((pid) => contestProblemScoreWeight(current, pid) !== score[pid]);
    const pidsChanged = current.pids.join(',') !== pids.join(',');
    const needsRecalc = scoresChanged || pidsChanged || Boolean(current.statusRecalcToken);
    return {
        patch: {
            pids, score,
            ...(scoresChanged ? { setConfig: { ...config, revision: config.revision + 1 } } : {}),
            ...(needsRecalc ? { statusRecalcToken: randomUUID() } : {}),
        },
        needsRecalc, confirmation: undefined, audit: undefined, revision: config.revision, changedPids: undefined,
    };
}
