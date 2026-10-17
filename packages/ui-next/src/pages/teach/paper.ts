/**
 * Pure paper model shared by the read-only problems tab and the composer.
 * Mutations return a new state and normalize it; they do not mutate the input.
 */
import { TEACH_KIND_ORDER, isTeachGroupedByKind } from '@hydrooj/common';
import type { ProblemKind, TeachType } from '@hydrooj/common';
import type { TeachContainerSummary, TeachPaper } from './model';

export interface PaperItem {
  docId: number;
  pid: string;
  title: string;
  kind: ProblemKind;
  score: number | null;
  hidden: boolean;
  stageId: number | null;
}

export interface PaperStage {
  id: number;
  title: string;
  requireIds: number[];
}

export interface PaperState {
  type: TeachType;
  rule: string;
  items: PaperItem[];
  stages: PaperStage[] | null;
  draw: boolean;
  quotas: Partial<Record<ProblemKind, number>>;
}

export interface PaperTarget {
  beforeDocId: number | null;
  stageId: number | null;
}

type PaperIssueCode = 'quota_exceeds_pool' | 'mixed_scores_in_draw' | 'quota_invalid';

export interface PaperIssue {
  kind: ProblemKind | null;
  issue: PaperIssueCode;
}

const SCORE_MIN = 1;
const SCORE_MAX = 1000;
const SUMMARY_SEP = ' \u00B7 ';
const SCORED_OI_RULES: readonly string[] = ['oi', 'ioi', 'strictioi'];

export const DEFAULT_KIND_SCORE: Readonly<Record<ProblemKind, number>> = Object.freeze({
  true_false: 2,
  single: 2,
  multi: 4,
  blank: 2,
  program_fill: 10,
  subjective: 10,
  function: 10,
  programming: 20,
});

function copyItem(item: PaperItem): PaperItem {
  return {
    docId: item.docId,
    pid: item.pid,
    title: item.title,
    kind: item.kind,
    score: item.score,
    hidden: item.hidden,
    stageId: item.stageId,
  };
}

function copyStages(stages: PaperStage[] | null): PaperStage[] | null {
  if (!stages) return null;
  return stages.map((stage) => ({
    id: stage.id,
    title: stage.title,
    requireIds: stage.requireIds.slice(),
  }));
}

function copyQuotas(quotas: Partial<Record<ProblemKind, number>>): Partial<Record<ProblemKind, number>> {
  return { ...quotas };
}

function kindRank(kind: ProblemKind): number {
  const index = TEACH_KIND_ORDER.indexOf(kind);
  return index === -1 ? TEACH_KIND_ORDER.length : index;
}

function stableSort(items: readonly PaperItem[], rankOf: (item: PaperItem) => number): PaperItem[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((left, right) => rankOf(left.item) - rankOf(right.item) || left.index - right.index)
    .map((entry) => entry.item);
}

function normalizeItems(state: PaperState, items: readonly PaperItem[]): PaperItem[] {
  const copied = items.map(copyItem);
  if (isTeachGroupedByKind(state.type)) return stableSort(copied, (item) => kindRank(item.kind));
  if (state.type !== 'practice') return copied;
  const stages = state.stages ?? [];
  const rank = new Map(stages.map((stage, index) => [stage.id, index]));
  const tail = stages.length;
  return stableSort(copied, (item) => {
    if (item.stageId === null) return tail;
    return rank.get(item.stageId) ?? tail;
  });
}

function finish(state: PaperState, items: readonly PaperItem[], patch?: Partial<Pick<PaperState, 'draw' | 'quotas'>>): PaperState {
  const next: PaperState = {
    type: state.type,
    rule: state.rule,
    items: [],
    stages: copyStages(state.stages),
    draw: patch?.draw ?? state.draw,
    quotas: copyQuotas(patch?.quotas ?? state.quotas),
  };
  next.items = normalizeItems(next, items);
  return next;
}

function countByKind(items: readonly PaperItem[]): Map<ProblemKind, number> {
  const counts = new Map<ProblemKind, number>();
  for (const item of items) counts.set(item.kind, (counts.get(item.kind) ?? 0) + 1);
  return counts;
}

function itemsByKind(items: readonly PaperItem[]): Map<ProblemKind, PaperItem[]> {
  const groups = new Map<ProblemKind, PaperItem[]>();
  for (const item of items) {
    const list = groups.get(item.kind);
    if (list) list.push(item);
    else groups.set(item.kind, [item]);
  }
  return groups;
}

function stageMap(stages: TeachPaper['stages']): Map<number, number> | null {
  if (!stages) return null;
  const map = new Map<number, number>();
  for (const stage of stages) {
    for (const docId of stage.pids) {
      const existing = map.get(docId);
      if (existing !== undefined && existing !== stage.id) throw new TypeError('paper_stage_conflict');
      map.set(docId, stage.id);
    }
  }
  return map;
}

function assertScore(score: number): void {
  if (!Number.isSafeInteger(score) || score < SCORE_MIN || score > SCORE_MAX) throw new RangeError('paper_score_invalid');
}

function assertQuota(count: number): void {
  if (!Number.isSafeInteger(count) || count < 0) throw new RangeError('paper_quota_invalid');
}

function requireItem(state: PaperState, docId: number): PaperItem {
  const found = state.items.find((item) => item.docId === docId);
  if (!found) throw new TypeError('paper_item_missing');
  return found;
}

function lastStageId(stages: PaperStage[] | null): number | null {
  if (!stages || stages.length === 0) return null;
  return stages[stages.length - 1]?.id ?? null;
}

function practiceStageId(state: PaperState, items: readonly PaperItem[], target: PaperTarget): number | null {
  if (target.stageId !== null) return target.stageId;
  if (target.beforeDocId !== null) {
    const before = items.find((item) => item.docId === target.beforeDocId);
    if (before && before.stageId !== null) return before.stageId;
  }
  return lastStageId(state.stages);
}

function lastMatchingIndex(items: readonly PaperItem[], match: (item: PaperItem) => boolean): number {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item && match(item)) return index;
  }
  return -1;
}

function placementIndex(items: readonly PaperItem[], placed: PaperItem, target: PaperTarget, grouped: boolean, practice: boolean): number {
  if (target.beforeDocId !== null) {
    const beforeIndex = items.findIndex((item) => item.docId === target.beforeDocId);
    const before = beforeIndex >= 0 ? items[beforeIndex] : undefined;
    if (before) {
      const kindOk = !grouped || before.kind === placed.kind;
      const stageOk = !practice || before.stageId === placed.stageId;
      if (kindOk && stageOk) return beforeIndex;
    }
  }
  if (grouped || practice) {
    const last = lastMatchingIndex(items, (item) => (grouped ? item.kind === placed.kind : item.stageId === placed.stageId));
    return last < 0 ? items.length : last + 1;
  }
  return items.length;
}

function insertAt(items: readonly PaperItem[], index: number, item: PaperItem): PaperItem[] {
  const next = items.slice();
  next.splice(index, 0, item);
  return next;
}

function uniformNumericScore(items: readonly PaperItem[]): number | null {
  if (items.length === 0) return null;
  const first = items[0]?.score;
  if (typeof first !== 'number') return null;
  for (const item of items) {
    if (item.score !== first) return null;
  }
  return first;
}

function scoresDiffer(items: readonly PaperItem[]): boolean {
  if (items.length === 0) return false;
  const first = items[0]?.score;
  return items.some((item) => item.score !== first);
}

function letterLabel(position: number): string {
  let value = position;
  let label = '';
  while (value > 0) {
    value -= 1;
    label = String.fromCharCode(65 + (value % 26)) + label;
    value = Math.floor(value / 26);
  }
  return label;
}

function drawnCount(state: PaperState): number {
  const counts = countByKind(state.items);
  let total = 0;
  for (const kind of TEACH_KIND_ORDER) {
    const quota = state.quotas[kind] ?? 0;
    if (quota >= 1 && (counts.get(kind) ?? 0) >= 1) total += quota;
  }
  return total;
}

function quotaChangedCount(before: Partial<Record<ProblemKind, number>>, after: Partial<Record<ProblemKind, number>>): number {
  let changes = 0;
  for (const kind of TEACH_KIND_ORDER) {
    const left = Object.hasOwn(before, kind) ? before[kind] : undefined;
    const right = Object.hasOwn(after, kind) ? after[kind] : undefined;
    if (left !== right) changes += 1;
  }
  return changes;
}

function wholePoolQuotas(items: readonly PaperItem[]): Partial<Record<ProblemKind, number>> {
  const counts = countByKind(items);
  const quotas: Partial<Record<ProblemKind, number>> = {};
  for (const kind of TEACH_KIND_ORDER) {
    const count = counts.get(kind) ?? 0;
    if (count > 0) quotas[kind] = count;
  }
  return quotas;
}

export function paperIsScored(state: PaperState): boolean {
  return state.type === 'homework' || state.type === 'exam' || SCORED_OI_RULES.includes(state.rule);
}

export function paperFromPayload(paper: TeachPaper, container: Pick<TeachContainerSummary, 'type' | 'rule'>): PaperState {
  const practice = container.type === 'practice';
  const stages = practice && paper.stages
    ? paper.stages.map((stage) => ({
      id: stage.id,
      title: stage.title,
      requireIds: stage.requireIds.slice(),
    }))
    : null;
  const staged = practice ? stageMap(paper.stages) : null;
  return {
    type: container.type,
    rule: container.rule,
    items: paper.problems.map((problem) => ({
      docId: problem.docId,
      pid: problem.pid,
      title: problem.title,
      kind: problem.kind,
      score: problem.score,
      hidden: problem.hidden,
      stageId: staged?.get(problem.docId) ?? null,
    })),
    stages,
    draw: paper.examPaperQuotas !== null,
    quotas: paper.examPaperQuotas === null ? {} : { ...paper.examPaperQuotas },
  };
}

export function normalizePaper(state: PaperState): PaperState {
  return finish(state, state.items);
}

export function defaultScoreFor(state: PaperState, kind: ProblemKind): number | null {
  if (!paperIsScored(state)) return null;
  // Prototype defScore: a scored OI paper always defaults a new problem to 100.
  if (state.type === 'oi') return 100;
  for (const item of state.items) {
    if (item.kind === kind && typeof item.score === 'number') return item.score;
  }
  const fallback = DEFAULT_KIND_SCORE[kind];
  if (typeof fallback !== 'number') throw new TypeError('paper_kind_invalid');
  return fallback;
}

export function insertItems(state: PaperState, items: readonly PaperItem[], target: PaperTarget): PaperState {
  const present = new Set(state.items.map((item) => item.docId));
  const scored = paperIsScored(state);
  const grouped = isTeachGroupedByKind(state.type);
  const practice = state.type === 'practice';
  let next: readonly PaperItem[] = state.items;
  for (const item of items) {
    if (present.has(item.docId)) continue;
    present.add(item.docId);
    const score = item.score === null && scored ? defaultScoreFor(state, item.kind) : item.score;
    const placed = copyItem({
      ...item,
      score,
      stageId: practice ? practiceStageId(state, next, target) : null,
    });
    next = insertAt(next, placementIndex(next, placed, target, grouped, practice), placed);
  }
  return finish(state, next);
}

export function moveItem(state: PaperState, docId: number, target: PaperTarget): PaperState {
  const item = requireItem(state, docId);
  const removed: PaperState = {
    ...state,
    items: state.items.filter((entry) => entry.docId !== docId),
  };
  return insertItems(removed, [copyItem(item)], target);
}

export function removeItem(state: PaperState, docId: number): PaperState {
  requireItem(state, docId);
  return finish(state, state.items.filter((item) => item.docId !== docId));
}

export function setItemScore(state: PaperState, docId: number, score: number): PaperState {
  assertScore(score);
  requireItem(state, docId);
  return finish(state, state.items.map((item) => (item.docId === docId ? { ...item, score } : item)));
}

export function setGroupScore(state: PaperState, kind: ProblemKind, score: number): PaperState {
  assertScore(score);
  return finish(state, state.items.map((item) => (item.kind === kind ? { ...item, score } : item)));
}

export function setQuota(state: PaperState, kind: ProblemKind, count: number): PaperState {
  assertQuota(count);
  return finish(state, state.items, { quotas: { ...state.quotas, [kind]: count } });
}

export function setDraw(state: PaperState, on: boolean): PaperState {
  const quotas = on && Object.keys(state.quotas).length === 0 ? wholePoolQuotas(state.items) : state.quotas;
  return finish(state, state.items, { draw: on, quotas });
}

export function paperPids(state: PaperState): number[] {
  return state.items.map((item) => item.docId);
}

export function paperScores(state: PaperState): Record<number, number> | null {
  if (!paperIsScored(state)) return null;
  const scores: Record<number, number> = {};
  for (const item of state.items) {
    if (typeof item.score === 'number') scores[item.docId] = item.score;
  }
  return scores;
}

export function paperQuotas(state: PaperState): Partial<Record<ProblemKind, number>> | null {
  if (state.type !== 'exam' || !state.draw) return null;
  const counts = countByKind(state.items);
  const quotas: Partial<Record<ProblemKind, number>> = {};
  for (const kind of TEACH_KIND_ORDER) {
    const quota = state.quotas[kind];
    if (quota === undefined || quota < 1) continue;
    if ((counts.get(kind) ?? 0) < 1) continue;
    quotas[kind] = quota;
  }
  return Object.keys(quotas).length > 0 ? quotas : null;
}

export function paperStagesForSave(state: PaperState): Array<{ id: number; title: string; requireIds: number[]; pids: number[] }> {
  const stages = state.stages ?? [];
  return stages.map((stage) => ({
    id: stage.id,
    title: stage.title,
    requireIds: stage.requireIds.slice(),
    pids: state.items.filter((item) => item.stageId === stage.id).map((item) => item.docId),
  }));
}

export function paperNumbering(state: PaperState): Map<number, string> {
  const letters = !isTeachGroupedByKind(state.type) && state.type !== 'practice';
  const labels = new Map<number, string>();
  state.items.forEach((item, index) => {
    labels.set(item.docId, letters ? letterLabel(index + 1) : String(index + 1));
  });
  return labels;
}

export function paperFullScore(state: PaperState): number | null {
  if (state.type === 'acm' || state.type === 'practice' || state.rule === 'ledo') return null;
  if (state.type === 'exam' && state.draw) {
    const groups = itemsByKind(state.items);
    let total = 0;
    for (const kind of TEACH_KIND_ORDER) {
      const quota = state.quotas[kind] ?? 0;
      if (quota < 1) continue;
      const group = groups.get(kind) ?? [];
      // A positive quota on an empty kind is quota_exceeds_pool, not an unknown score.
      if (group.length === 0) continue;
      const score = uniformNumericScore(group);
      if (score === null) return null;
      total += quota * score;
    }
    return total;
  }
  let total = 0;
  for (const item of state.items) {
    if (typeof item.score === 'number') total += item.score;
  }
  return total;
}

export function paperSummary(state: PaperState): string {
  const count = state.items.length;
  if (count === 0) return '还没有题目';
  if (state.type === 'exam' && state.draw) {
    const full = paperFullScore(state);
    const scoreText = full === null ? '\u2014' : String(full);
    return [`题库 ${count} 道`, `每人 ${drawnCount(state)} 道`, `满分 ${scoreText}`].join(SUMMARY_SEP);
  }
  if (state.type === 'acm') return [`共 ${count} 道`, `A\u2013${letterLabel(count)}`].join(SUMMARY_SEP);
  if (state.type === 'practice') {
    const stages = state.stages?.length ?? 0;
    if (stages === 1) return `共 ${count} 道`;
    return [`共 ${count} 道`, `${stages} 个阶段`].join(SUMMARY_SEP);
  }
  const full = paperFullScore(state);
  const scoreText = full === null ? '\u2014' : String(full);
  return [`共 ${count} 道`, `满分 ${scoreText}`].join(SUMMARY_SEP);
}

export function paperIssues(state: PaperState): PaperIssue[] {
  if (state.type !== 'exam' || !state.draw) return [];
  const counts = countByKind(state.items);
  const groups = itemsByKind(state.items);
  const issues: PaperIssue[] = [];
  let anyPositiveQuota = false;
  for (const kind of TEACH_KIND_ORDER) {
    const quota = state.quotas[kind] ?? 0;
    const count = counts.get(kind) ?? 0;
    if (quota >= 1) anyPositiveQuota = true;
    if (quota >= 1 && quota > count) issues.push({ kind, issue: 'quota_exceeds_pool' });
    if (quota >= 1 && count >= 1 && scoresDiffer(groups.get(kind) ?? [])) issues.push({ kind, issue: 'mixed_scores_in_draw' });
  }
  if (state.items.length > 0 && !anyPositiveQuota) issues.push({ kind: null, issue: 'quota_invalid' });
  return issues;
}

export function paperChangeCount(base: PaperState, next: PaperState): number {
  const baseIds = new Set(base.items.map((item) => item.docId));
  const nextIds = new Set(next.items.map((item) => item.docId));
  let added = 0;
  let removed = 0;
  for (const docId of nextIds) if (!baseIds.has(docId)) added += 1;
  for (const docId of baseIds) if (!nextIds.has(docId)) removed += 1;
  const baseById = new Map(base.items.map((item) => [item.docId, item]));
  let scoreChanges = 0;
  let stageChanged = false;
  for (const item of next.items) {
    const previous = baseById.get(item.docId);
    if (!previous) continue;
    if (previous.score !== item.score) scoreChanges += 1;
    if (previous.stageId !== item.stageId) stageChanged = true;
  }
  const baseOrder = base.items.filter((item) => nextIds.has(item.docId)).map((item) => item.docId);
  const nextOrder = next.items.filter((item) => baseIds.has(item.docId)).map((item) => item.docId);
  const orderChanged = baseOrder.length !== nextOrder.length || baseOrder.some((docId, index) => docId !== nextOrder[index]);
  const drawChanged = base.draw === next.draw ? 0 : 1;
  // Order and stage membership share one structural bit, so one move counts as 1.
  const structureChanged = orderChanged || stageChanged ? 1 : 0;
  return added + removed + scoreChanges + structureChanged + quotaChangedCount(base.quotas, next.quotas) + drawChanged;
}
