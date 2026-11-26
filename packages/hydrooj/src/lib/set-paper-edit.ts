import { createHash, randomUUID } from 'node:crypto';
import {
    activePaperPids, assertExamPaperPoolSatisfiesQuotas, assertSetPublishable, examPaperQuotasEqual,
    paperMaximum, paperProblemMaximum, parseExamPaperQuotas, readStoredSetConfig, roundPaperPoints,
    setConfigMessage, validPaperPoints, type SetPaperPoints,
} from '@hydrooj/common';
import { localizedErrorText, ValidationError } from '../error';
import type { Tdoc } from '../interface';
import type { RoundDoc } from '../model/set-round';
import db from '../service/db';
import ProblemModel from '../model/problem';
import { loadPaperProblemFacts } from './set-paper-facts';
import { loadSetPublishFacts } from './set-publish-facts';

function reject(message: string): never {
    throw new ValidationError('problemScores', null, localizedErrorText`${message}`);
}

function object(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

interface ImpactRound { participantKey: string; paperPids: number[]; legacy?: { scoreLocked?: boolean } }

export function paperEditImpact(rounds: ImpactRound[], old: SetPaperPoints, next: SetPaperPoints, changed: Set<number>,
    passScore: number | null) {
    const participants = new Set<string>();
    const changes = new Set<string>();
    let locked = 0;
    for (const round of rounds) {
        if (!round.paperPids.some((pid) => changed.has(pid))) continue;
        if (round.paperPids.some((pid) => !next[pid])) reject('已发卷里的题目不能移出，请使用「剔除」，以便保留原卷和作答。');
        if (round.legacy?.scoreLocked) {
            locked++;
            continue;
        }
        const before = paperMaximum(old, round.paperPids);
        const after = paperMaximum(next, round.paperPids);
        if (after === 0) reject('这次修改会使已发试卷的满分变为 0，请保留至少一道有效计分题。');
        if (passScore !== null && after < passScore) reject(`有已发试卷修改后满分为 ${after}，低于当前及格线 ${passScore}。请先调整及格线。`);
        participants.add(round.participantKey);
        changes.add(`${before} → ${after}`);
    }
    return { participants: participants.size, changes: [...changes].sort(), locked, passScore };
}

/** Runs under the contest edit boundary shared with round issuance. Confirmation is bound to the same change and impact. */
export async function planPaperPointsEdit(doc: Tdoc, pids: number[], json: string, actor: number) {
    let input: unknown;
    try {
        input = JSON.parse(json);
    } catch {
        reject('试卷配分格式无效。');
    }
    const config = readStoredSetConfig(doc);
    if (config.settings.codePolicy === 'acm') reject('ACM 按通过题数和罚时排名。');
    if (!object(input) || !object(input.points) || !Array.isArray(input.excluded) || !Number.isSafeInteger(input.revision)
        || Object.keys(input).some((k) => !['revision', 'points', 'excluded', 'target', 'quotas', 'confirm', 'reason'].includes(k))) reject('试卷配分格式无效。');
    const target = input.target;
    if (target !== null && (typeof target !== 'number' || target <= 0 || !Number.isSafeInteger(Math.round(target * 100))
        || roundPaperPoints(target) !== target)) reject('目标总分须为正数，最多两位小数。');
    const posted = input.points;
    const pool = new Set(pids);
    const excluded = new Set(input.excluded);
    if (pool.size !== pids.length || excluded.size !== input.excluded.length || [...excluded].some((pid) => !pool.has(pid))
        || Object.keys(posted).length !== pool.size || !pids.every((pid) => Object.hasOwn(posted, pid))) reject('配分必须与卷内题目一一对应。');
    const all = [...new Set([...pids, ...doc.pids])];
    const facts = await loadPaperProblemFacts(ProblemModel, doc.domainId, all);
    const previous: SetPaperPoints = {};
    for (const pid of doc.pids) {
        const rawMax = facts.get(pid)!.rawMax;
        previous[pid] = doc.setPoints?.[pid] ?? { rawMax, points: paperProblemMaximum(doc, pid, rawMax) };
    }
    const next: SetPaperPoints = {};
    for (const pid of pids) {
        const value = posted[pid];
        const rawMax = previous[pid]?.rawMax ?? facts.get(pid)!.rawMax;
        if (typeof value !== 'number' || (value !== previous[pid]?.points && !validPaperPoints(value)) || (rawMax === 0 && value !== 0)) {
            reject(`题目 ${pid} 的卷内满分无效，请检查分值和原题的评测满分。`);
        }
        const fromLegacyWeight = !excluded.has(pid) && previous[pid]?.points === value
            && (!doc.setPoints || previous[pid].fromLegacyWeight === true);
        next[pid] = { rawMax, points: value, ...(excluded.has(pid) ? { excluded: true } : {}), ...(fromLegacyWeight ? { fromLegacyWeight: true } : {}) };
    }
    const changed = new Set(all.filter((pid) => previous[pid]?.points !== next[pid]?.points || previous[pid]?.excluded !== next[pid]?.excluded));
    const draw = config.settings.draw;
    const quotas = input.quotas == null ? null : parseExamPaperQuotas(input.quotas);
    if (draw.enabled !== (quotas !== null)) reject('抽题设置已变化，请重新打开组卷页。');
    const quotaChanged = !examPaperQuotasEqual(draw.quotas, quotas);
    const edited = changed.size > 0 || quotaChanged || pids.join(',') !== doc.pids.join(',') || (doc.setTargetScore ?? null) !== target;
    if (edited && input.revision !== config.revision) reject('试卷已被修改，请刷新后再保存。');
    const settings = quotaChanged ? { ...config.settings, draw: { ...draw, quotas } } : config.settings;
    const revision = config.revision + Number(edited);
    const candidate = { ...doc, pids, setPoints: next, setConfig: { ...config, settings, revision } };
    const rounds = changed.size || quotaChanged ? await db.collection<RoundDoc>('contest.rounds')
        .find({ domainId: doc.domainId, tid: doc.docId }, { projection: { paperPids: 1, participantKey: 1, legacy: 1 } }).toArray() : [];
    const withdrawal = [...changed].some((pid) => next[pid]?.excluded && !previous[pid]?.excluded);
    if (rounds.length && pids.join(',') !== doc.pids.join(',') && !withdrawal) {
        reject('已有学生开卷，只有在剔题时可以同时调整题池。');
    }
    if (quotaChanged && rounds.length && !withdrawal) {
        reject('已有学生开卷，只能在剔题时一并调整抽题数。');
    }
    const impact = paperEditImpact(rounds, previous, next, changed, settings.retake.passScore);
    try {
        if (quotas) assertExamPaperPoolSatisfiesQuotas(activePaperPids(pids, next), new Map([...facts].map(([pid, f]) => [pid, f.kind])), quotas);
        if (config.publication === 'published') {
            assertSetPublishable(candidate.setConfig, await loadSetPublishFacts(candidate, candidate.setConfig, facts));
        }
    } catch (error) {
        if (!(error instanceof TypeError)) throw error;
        if (error.message === 'exam_paper_pool_short') reject('剩余题目不够抽取。请补充同题型题目或下调该题型抽题数，再一起保存。');
        reject(setConfigMessage(error.message));
    }
    let reason = '';
    if (rounds.length && changed.size) {
        const fingerprint = createHash('sha256').update(JSON.stringify([doc.docId, revision, next, quotas, impact])).digest('hex');
        if (input.confirm !== fingerprint) return { confirmation: { ...impact, fingerprint } } as const;
        reason = typeof input.reason === 'string' ? input.reason.trim() : '';
        if (!reason || reason.length > 500) reject('请输入 1 至 500 字的修改理由。');
    }
    const needsRecalc = changed.size > 0 || Boolean(doc.statusRecalcToken);
    const patch: Partial<Tdoc> = {
        pids, setConfig: candidate.setConfig, setTargetScore: typeof target === 'number' ? target : null,
        ...(changed.size ? { setPoints: next, score: Object.fromEntries(Object.entries(doc.score ?? {}).filter(([pid]) => pool.has(Number(pid)))) } : {}),
        ...(needsRecalc ? { statusRecalcToken: randomUUID() } : {}),
    };
    const audit = reason ? { domainId: doc.domainId, contestId: doc.docId, operator: actor, revision,
        changed: [...changed].map((pid) => ({ pid, before: previous[pid], after: next[pid] })), reason, impact } : null;
    return { patch, needsRecalc, audit, revision, changedPids: doc.statusRecalcToken ? all : [...changed] } as const;
}
