import { useEffect, useRef } from 'react';
import { isTeachGroupedByKind, TEACH_KIND_ORDER } from '@hydrooj/common';
import type { ProblemKind } from '@hydrooj/common';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { Panel } from '@/components/ui/panel';
import { KindTabs } from '@/components/teach/kind-tabs';
import { TEACH_KIND_LABEL } from '@/pages/teach/model';
import { paperIsScored, paperNumbering } from '@/pages/teach/paper';
import type { PaperItem, PaperStage, PaperState } from '@/pages/teach/paper';

const HEADER_CLASS = 'flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-line-subtle px-4 py-3 text-sm tabular';
const EMPTY_TITLE = '还没有题目';
const EMPTY_DESCRIPTION = '点「编辑题目」从题库里加题。';
const DRAW_MISMATCH = '抽题时本组必须同分';

export function PaperView({
  state,
  activeKind,
  onActiveKindChange,
}: {
  state: PaperState;
  activeKind: ProblemKind | null;
  onActiveKindChange: (kind: ProblemKind) => void;
}) {
  if (state.items.length === 0) return <PaperEmpty />;
  if (isTeachGroupedByKind(state.type)) {
    return <GroupedPaper state={state} activeKind={activeKind} onActiveKindChange={onActiveKindChange} />;
  }
  if (state.type === 'practice' && (state.stages?.length ?? 0) > 1) return <PracticeStages state={state} />;
  return <FlatPaper state={state} />;
}

function PaperEmpty() {
  return <EmptyState compact title={EMPTY_TITLE} description={EMPTY_DESCRIPTION} />;
}

function GroupedPaper({
  state,
  activeKind,
  onActiveKindChange,
}: {
  state: PaperState;
  activeKind: ProblemKind | null;
  onActiveKindChange: (kind: ProblemKind) => void;
}) {
  const occupied = occupiedKinds(state.items);
  const shown = shownKind(occupied, activeKind);
  const reported = useRef<ProblemKind | null>(null);
  useEffect(() => {
    if (shown === null || shown === activeKind) {
      reported.current = null;
      return;
    }
    // A parent that ignores the callback, or passes a new one each render, must still be told once.
    if (reported.current === shown) return;
    reported.current = shown;
    onActiveKindChange(shown);
  }, [shown, activeKind, onActiveKindChange]);

  if (shown === null) return <PaperEmpty />;
  const items = state.items.filter((item) => item.kind === shown);
  const counts: Partial<Record<ProblemKind, number>> = {};
  for (const kind of occupied) counts[kind] = state.items.filter((item) => item.kind === kind).length;
  return (
    <div className="grid min-w-0 gap-3">
      <KindTabs
        kinds={occupied}
        counts={counts}
        value={shown}
        onValueChange={onActiveKindChange}
      />
      <Panel flush>
        <GroupHeader state={state} kind={shown} items={items} />
        <ProblemRows items={items} numbers={paperNumbering(state)} showKind={false} showScore />
      </Panel>
    </div>
  );
}

function FlatPaper({ state }: { state: PaperState }) {
  return (
    <Panel flush>
      <ProblemRows
        items={state.items}
        numbers={paperNumbering(state)}
        showKind
        showScore={paperIsScored(state)}
      />
    </Panel>
  );
}

function PracticeStages({ state }: { state: PaperState }) {
  const stages = state.stages ?? [];
  assertItemStages(state, stages);
  const numbers = paperNumbering(state);
  return (
    <div className="grid min-w-0 gap-3">
      {stages.map((stage, index) => (
        <Panel key={stage.id} flush>
          <StageHeader index={index} stage={stage} stages={stages} />
          <ProblemRows
            items={state.items.filter((item) => item.stageId === stage.id)}
            numbers={numbers}
            showKind
            showScore={false}
          />
        </Panel>
      ))}
    </div>
  );
}

function GroupHeader({
  state,
  kind,
  items,
}: {
  state: PaperState;
  kind: ProblemKind;
  items: readonly PaperItem[];
}) {
  const draw = state.draw;
  const uniform = uniformScore(items);
  const quota = quotaOf(state.quotas, kind);
  // A drawable group with one score contributes quota × score. Mixed scores have no single draw value, so the subtotal stays the sum.
  const subtotal = uniform !== null && draw ? quota * uniform : sumScores(items);
  const countLine = draw ? `${items.length} 道 \u00B7 每人抽 ${quota} 道` : `${items.length} 道`;
  const perQuestion = uniform === null ? '每题 不同' : `每题 ${uniform} 分`;
  return (
    <div className={HEADER_CLASS}>
      <span className="font-medium">{kindLabel(kind)}</span>
      <span>{countLine}</span>
      <span>{perQuestion}</span>
      <span>{`小计 ${subtotal} 分`}</span>
      {draw && uniform === null ? <Badge tone="warning" size="sm">{DRAW_MISMATCH}</Badge> : null}
    </div>
  );
}

function StageHeader({
  index,
  stage,
  stages,
}: {
  index: number;
  stage: PaperStage;
  stages: readonly PaperStage[];
}) {
  return (
    <div className={HEADER_CLASS}>
      <span className="font-medium">{`阶段 ${index + 1} \u00B7 ${stage.title}`}</span>
      <span className="text-xs text-fg-subtle">{prerequisiteLabel(stage, stages)}</span>
    </div>
  );
}

function ProblemRows({
  items,
  numbers,
  showKind,
  showScore,
}: {
  items: readonly PaperItem[];
  numbers: ReadonlyMap<number, string>;
  showKind: boolean;
  showScore: boolean;
}) {
  return (
    <div className="divide-y divide-line-subtle">
      {items.map((item) => (
        <div key={item.docId} className="flex min-w-0 items-center gap-3 px-4 py-2.5">
          <span className="w-8 shrink-0 text-xs tabular text-fg-subtle">{numberOf(numbers, item.docId)}</span>
          <span className="shrink-0 font-mono text-xs text-fg-subtle">{item.pid}</span>
          <span className="min-w-0 truncate text-sm">{item.title}</span>
          {showKind && item.kind !== 'programming' ? (
            <Badge variant="outline" size="sm">{kindLabel(item.kind)}</Badge>
          ) : null}
          {showScore ? (
            <span className="ml-auto shrink-0 tabular text-sm text-fg-muted">{scoreLabel(item.score)}</span>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function occupiedKinds(items: readonly PaperItem[]): ProblemKind[] {
  const present = new Set<ProblemKind>();
  for (const item of items) {
    if (!TEACH_KIND_ORDER.includes(item.kind)) throw new TypeError(`paper_kind_invalid:${String(item.kind)}`);
    present.add(item.kind);
  }
  return TEACH_KIND_ORDER.filter((kind) => present.has(kind));
}

function shownKind(occupied: readonly ProblemKind[], activeKind: ProblemKind | null): ProblemKind | null {
  if (occupied.length === 0) return null;
  if (activeKind !== null && occupied.includes(activeKind)) return activeKind;
  const first = occupied[0];
  return first ?? null;
}

function uniformScore(items: readonly PaperItem[]): number | null {
  const first = items[0]?.score;
  if (typeof first !== 'number' || !Number.isFinite(first)) return null;
  for (const item of items) {
    if (item.score !== first) return null;
  }
  return first;
}

function sumScores(items: readonly PaperItem[]): number {
  let total = 0;
  for (const item of items) {
    if (typeof item.score === 'number' && Number.isFinite(item.score)) total += item.score;
  }
  return total;
}

function quotaOf(quotas: PaperState['quotas'], kind: ProblemKind): number {
  if (!Object.hasOwn(quotas, kind)) return 0;
  const quota = quotas[kind];
  if (typeof quota !== 'number' || !Number.isFinite(quota)) throw new TypeError('paper_quota_invalid');
  return quota;
}

function assertItemStages(state: PaperState, stages: readonly PaperStage[]): void {
  const ids = new Set(stages.map((stage) => stage.id));
  for (const item of state.items) {
    if (item.stageId === null || !ids.has(item.stageId)) throw new TypeError(`paper_item_stage_invalid:${item.docId}`);
  }
}

function prerequisiteLabel(stage: PaperStage, stages: readonly PaperStage[]): string {
  if (stage.requireIds.length === 0) return '无先修';
  const names = stage.requireIds.map((id) => {
    const required = stages.find((entry) => entry.id === id);
    if (!required) throw new TypeError(`paper_stage_missing:${id}`);
    return `「${required.title}」`;
  });
  return `需先完成${names.join('、')}`;
}

function numberOf(numbers: ReadonlyMap<number, string>, docId: number): string {
  const label = numbers.get(docId);
  if (label === undefined) throw new TypeError(`paper_number_missing:${docId}`);
  return label;
}

function kindLabel(kind: ProblemKind): string {
  if (!Object.hasOwn(TEACH_KIND_LABEL, kind)) throw new TypeError(`paper_kind_invalid:${String(kind)}`);
  return TEACH_KIND_LABEL[kind];
}

function scoreLabel(score: number | null): string {
  if (typeof score !== 'number' || !Number.isFinite(score)) return '\u2014';
  return `${score} 分`;
}
