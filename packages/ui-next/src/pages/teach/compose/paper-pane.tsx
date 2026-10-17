/**
 * Editable paper column. Rows and groups register with dnd-kit; the page owns DndContext.
 */
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { isTeachGroupedByKind, TEACH_ALLOWED_KINDS } from '@hydrooj/common';
import type { ProblemKind } from '@hydrooj/common';
import { GripVertical, X } from 'lucide-react';
import { useEffect, useRef, useState, type JSX, type ReactNode } from 'react';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Panel } from '@/components/ui/panel';
import { ScrollArea } from '@/components/ui/scroll-area';
import { KindTabs } from '@/components/teach/kind-tabs';
import type { ComposeAction, ComposeState } from '@/pages/teach/compose/draft';
import { TEACH_KIND_LABEL } from '@/pages/teach/model';
import { paperIsScored, paperIssues, paperNumbering } from '@/pages/teach/paper';
import type { PaperItem, PaperStage, PaperState } from '@/pages/teach/paper';

const HEADER_CLASS = 'flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-line-subtle px-4 py-3 text-sm tabular';
const SCORE_MIN = 1;
const SCORE_MAX = 1000;
const GROUP_HINT = '拖进来的题会自动放进对应题型组；在组内拖动可以调整顺序。把题拖回左边就是移出。';
const STAGE_HINT = '拖到哪个阶段，就加到哪个阶段。把题拖回左边就是移出。';
const FLAT_HINT = '拖到两题之间就插在那里，题号随顺序自动变。把题拖回左边就是移出。';
const EMPTY_DRAG = '从左边把题拖到这里，或点题目右侧的「+」。';
const STAGE_DROP = '拖题到这里';
const QUOTA_ALERT = '打开了随机抽题，但每组都是 0 道。';
const MIXED_BADGE = '抽题时本组必须同分';
const EXCEEDS_BADGE = '抽题数超过题数';

export function PaperPane({
  state,
  dispatch,
}: {
  state: ComposeState;
  dispatch: (action: ComposeAction) => void;
}): JSX.Element {
  const paper = state.current;
  const hint = footerHint(paper);
  const quotaInvalid = paperIssues(paper).some((issue) => issue.issue === 'quota_invalid');
  return (
    <section aria-label="试卷" className="flex h-full min-h-0 flex-col">
      <ScrollArea className="min-h-0 flex-1" viewportLayout="block">
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 p-4">
          {quotaInvalid ? <Alert tone="warning">{QUOTA_ALERT}</Alert> : null}
          {isTeachGroupedByKind(paper.type) ? (
            <GroupedPaper state={state} dispatch={dispatch} />
          ) : paper.type === 'practice' && (paper.stages?.length ?? 0) > 1 ? (
            <PracticeStages state={state} dispatch={dispatch} />
          ) : (
            <FlatPaper state={state} dispatch={dispatch} />
          )}
          {hint ? <p className="text-center text-xs text-fg-subtle">{hint}</p> : null}
        </div>
      </ScrollArea>
    </section>
  );
}

function GroupedPaper({
  state,
  dispatch,
}: {
  state: ComposeState;
  dispatch: (action: ComposeAction) => void;
}): JSX.Element {
  const paper = state.current;
  const allowed = TEACH_ALLOWED_KINDS[paper.type];
  assertAllowedKinds(paper, allowed);
  const active = requireActiveKind(state, allowed);
  const items = paper.items.filter((item) => item.kind === active);
  const counts: Partial<Record<ProblemKind, number>> = {};
  for (const kind of allowed) counts[kind] = paper.items.filter((item) => item.kind === kind).length;
  const numbers = paperNumbering(paper);
  return (
    <>
      <KindTabs
        kinds={allowed}
        counts={counts}
        value={active}
        onValueChange={(kind) => dispatch({ type: 'setActiveKind', kind })}
      />
      <PaperGroup dropId={`group:${active}`} kind={active} stageId={null}>
        {items.length > 0 || paper.draw ? (
          <GroupHeader paper={paper} kind={active} items={items} locked={state.locked} dispatch={dispatch} />
        ) : null}
        {items.length === 0 ? (
          <EmptyState compact title={`还没有${kindLabel(active)}。`} description={EMPTY_DRAG} />
        ) : (
          <ProblemList
            items={items}
            numbers={numbers}
            scored={paperIsScored(paper)}
            showKind={false}
            locked={state.locked}
            dispatch={dispatch}
          />
        )}
      </PaperGroup>
    </>
  );
}

function FlatPaper({
  state,
  dispatch,
}: {
  state: ComposeState;
  dispatch: (action: ComposeAction) => void;
}): JSX.Element {
  const paper = state.current;
  const scored = paperIsScored(paper);
  return (
    <PaperGroup dropId="group:flat" kind={null} stageId={null}>
      {paper.items.length === 0 ? (
        <EmptyState compact title="还没有题目。" description={EMPTY_DRAG} />
      ) : (
        <ProblemList
          items={paper.items}
          numbers={paperNumbering(paper)}
          scored={scored}
          showKind
          locked={state.locked}
          dispatch={dispatch}
        />
      )}
    </PaperGroup>
  );
}

function PracticeStages({
  state,
  dispatch,
}: {
  state: ComposeState;
  dispatch: (action: ComposeAction) => void;
}): JSX.Element {
  const paper = state.current;
  const stages = paper.stages ?? [];
  assertPracticeStages(paper, stages);
  const numbers = paperNumbering(paper);
  return (
    <>
      {stages.map((stage, index) => {
        const items = paper.items.filter((item) => item.stageId === stage.id);
        return (
          <PaperGroup key={stage.id} dropId={`group:stage-${stage.id}`} kind={null} stageId={stage.id}>
            <StageHeader index={index} stage={stage} stages={stages} />
            {items.length === 0 ? (
              <p className="px-4 py-2.5 text-sm text-fg-subtle">{STAGE_DROP}</p>
            ) : (
              <ProblemList
                items={items}
                numbers={numbers}
                scored={false}
                showKind
                locked={state.locked}
                dispatch={dispatch}
              />
            )}
          </PaperGroup>
        );
      })}
    </>
  );
}

function PaperGroup({
  dropId,
  kind,
  stageId,
  children,
}: {
  dropId: string;
  kind: ProblemKind | null;
  stageId: number | null;
  children: ReactNode;
}): JSX.Element {
  const { setNodeRef } = useDroppable({
    id: dropId,
    data: { to: 'paper', kind, stageId },
  });
  return (
    <div ref={setNodeRef} className="min-w-0">
      <Panel as="div" flush>
        {children}
      </Panel>
    </div>
  );
}

function GroupHeader({
  paper,
  kind,
  items,
  locked,
  dispatch,
}: {
  paper: PaperState;
  kind: ProblemKind;
  items: readonly PaperItem[];
  locked: boolean;
  dispatch: (action: ComposeAction) => void;
}): JSX.Element {
  const label = kindLabel(kind);
  const uniform = uniformScore(items);
  const draw = paper.draw;
  const quota = quotaOf(paper, kind);
  const subtotal = uniform !== null && draw ? quota * uniform : sumScores(items);
  const issues = paperIssues(paper).filter((issue) => issue.kind === kind);
  const mixed = issues.some((issue) => issue.issue === 'mixed_scores_in_draw');
  const exceeds = issues.some((issue) => issue.issue === 'quota_exceeds_pool');
  return (
    <div className={HEADER_CLASS}>
      <span className="font-medium">{label}</span>
      {draw ? (
        <span>
          {`${items.length} 道 \u00B7 每人抽 `}
          <CommitNumber
            label={`${label}每人抽题数`}
            value={quota}
            disabled={locked}
            allow={quotaAllowed}
            onCommit={(count) => dispatch({ type: 'setQuota', kind, count })}
          />
          {' 道'}
        </span>
      ) : (
        <span>{`${items.length} 道`}</span>
      )}
      {items.length === 0 ? (
        <span>{'每题 \u2014 分'}</span>
      ) : (
        <span>
          {'每题 '}
          <CommitNumber
            label={`${label}每题分值`}
            value={uniform}
            disabled={locked}
            allow={scoreAllowed}
            onCommit={(score) => dispatch({ type: 'setGroupScore', kind, score })}
          />
          {' 分'}
        </span>
      )}
      <span>{`小计 ${subtotal} 分`}</span>
      {mixed ? <Badge tone="warning" size="sm">{MIXED_BADGE}</Badge> : null}
      {exceeds ? <Badge tone="danger" size="sm">{EXCEEDS_BADGE}</Badge> : null}
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
}): JSX.Element {
  return (
    <div className={HEADER_CLASS}>
      <span className="font-medium">{`阶段 ${index + 1} \u00B7 ${stage.title}`}</span>
      <span className="text-xs text-fg-subtle">{prerequisiteLabel(stage, stages)}</span>
    </div>
  );
}

function ProblemList({
  items,
  numbers,
  scored,
  showKind,
  locked,
  dispatch,
}: {
  items: readonly PaperItem[];
  numbers: ReadonlyMap<number, string>;
  scored: boolean;
  showKind: boolean;
  locked: boolean;
  dispatch: (action: ComposeAction) => void;
}): JSX.Element {
  const ids = items.map((item) => paperDragId(item.docId));
  return (
    <SortableContext items={ids} strategy={verticalListSortingStrategy}>
      <div className="divide-y divide-line-subtle">
        {items.map((item) => (
          <ProblemRow
            key={item.docId}
            item={item}
            number={numberOf(numbers, item.docId)}
            scored={scored}
            showKind={showKind && item.kind !== 'programming'}
            locked={locked}
            dispatch={dispatch}
          />
        ))}
      </div>
    </SortableContext>
  );
}

function ProblemRow({
  item,
  number,
  scored,
  showKind,
  locked,
  dispatch,
}: {
  item: PaperItem;
  number: string;
  scored: boolean;
  showKind: boolean;
  locked: boolean;
  dispatch: (action: ComposeAction) => void;
}): JSX.Element {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition } = useSortable({
    id: paperDragId(item.docId),
    data: { from: 'paper', docId: item.docId },
    disabled: locked,
  });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className="flex min-w-0 items-center gap-3 px-4 py-2.5"
    >
      {locked ? null : (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          iconOnly
          aria-label="拖动排序"
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
        >
          <GripVertical />
        </Button>
      )}
      <span className="w-8 shrink-0 text-xs tabular text-fg-subtle">{number}</span>
      <span className="shrink-0 font-mono text-xs text-fg-subtle">{item.pid}</span>
      <span className="min-w-0 flex-1 truncate text-sm">{item.title}</span>
      {showKind ? <Badge variant="outline" size="sm" className="shrink-0">{kindLabel(item.kind)}</Badge> : null}
      {scored ? (
        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          <CommitNumber
            label={`${item.pid} 分值`}
            value={typeof item.score === 'number' ? item.score : null}
            disabled={locked}
            allow={scoreAllowed}
            onCommit={(score) => dispatch({ type: 'setItemScore', docId: item.docId, score })}
          />
          <span className="text-sm text-fg-muted">分</span>
        </span>
      ) : null}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        iconOnly
        aria-label={`移出 ${item.pid}`}
        disabled={locked}
        onClick={() => dispatch({ type: 'remove', docId: item.docId })}
      >
        <X />
      </Button>
    </div>
  );
}

function CommitNumber({
  label,
  value,
  disabled,
  allow,
  onCommit,
}: {
  label: string;
  value: number | null;
  disabled: boolean;
  allow: (value: number) => boolean;
  onCommit: (value: number) => void;
}): JSX.Element {
  const [draft, setDraft] = useState<string | null>(null);
  const draftRef = useRef<string | null>(null);
  const fieldRef = useRef<HTMLInputElement>(null);
  const shown = draft ?? (value === null ? '' : String(value));

  useEffect(() => {
    const node = fieldRef.current;
    if (!node) return undefined;
    const blockWheel = (event: WheelEvent) => {
      if (document.activeElement !== node) return;
      event.preventDefault();
      const scroller = node.closest('[data-radix-scroll-area-viewport]');
      if (scroller instanceof HTMLElement) scroller.scrollTop += event.deltaY;
    };
    node.addEventListener('wheel', blockWheel, { passive: false });
    return () => node.removeEventListener('wheel', blockWheel);
  }, []);

  function publish(next: string | null) {
    draftRef.current = next;
    setDraft(next);
  }

  function commit(text: string) {
    const parsed = parseWhole(text);
    publish(null);
    if (parsed === null || !allow(parsed) || parsed === value) return;
    onCommit(parsed);
  }

  return (
    <Input
      ref={fieldRef}
      size="sm"
      type="number"
      className="w-16"
      aria-label={label}
      disabled={disabled}
      value={shown}
      placeholder={value === null ? '\u2014' : undefined}
      onChange={(event) => publish(event.target.value)}
      onBlur={() => {
        const pending = draftRef.current;
        if (pending === null) return;
        commit(pending);
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        commit(draftRef.current ?? (value === null ? '' : String(value)));
      }}
    />
  );
}

function footerHint(paper: PaperState): string | null {
  if (paper.items.length === 0) return null;
  if (isTeachGroupedByKind(paper.type)) return GROUP_HINT;
  if (paper.type === 'practice' && (paper.stages?.length ?? 0) > 1) return STAGE_HINT;
  return FLAT_HINT;
}

function requireActiveKind(state: ComposeState, allowed: readonly ProblemKind[]): ProblemKind {
  const kind = state.activeKind;
  if (kind === null || !allowed.includes(kind)) throw new TypeError('paper_active_kind_invalid');
  return kind;
}

function assertAllowedKinds(paper: PaperState, allowed: readonly ProblemKind[]): void {
  for (const item of paper.items) {
    if (!allowed.includes(item.kind)) throw new TypeError(`paper_kind_not_allowed:${item.kind}`);
  }
}

function assertPracticeStages(paper: PaperState, stages: readonly PaperStage[]): void {
  const ids = new Set<number>();
  for (const stage of stages) {
    if (ids.has(stage.id)) throw new TypeError(`paper_stage_duplicate:${stage.id}`);
    ids.add(stage.id);
  }
  for (const item of paper.items) {
    if (item.stageId === null || !ids.has(item.stageId)) throw new TypeError(`paper_item_stage_invalid:${item.docId}`);
  }
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

function quotaOf(paper: PaperState, kind: ProblemKind): number {
  if (!Object.hasOwn(paper.quotas, kind)) return 0;
  const quota = paper.quotas[kind];
  if (typeof quota !== 'number' || !Number.isFinite(quota)) throw new TypeError('paper_quota_invalid');
  return quota;
}

function prerequisiteLabel(stage: PaperStage, stages: readonly PaperStage[]): string {
  if (stage.requireIds.length === 0) return '无先修';
  const names = stage.requireIds.map((id) => {
    const required = stages.find((entry) => entry.id === id);
    if (!required) throw new TypeError(`paper_stage_missing:${id}`);
    return `\u300C${required.title}\u300D`;
  });
  return `需先完成${names.join('\u3001')}`;
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

function paperDragId(docId: number): string {
  return `paper:${docId}`;
}

function scoreAllowed(value: number): boolean {
  return value >= SCORE_MIN && value <= SCORE_MAX;
}

function quotaAllowed(value: number): boolean {
  return value >= 0;
}

function parseWhole(text: string): number | null {
  const trimmed = text.trim();
  if (!/^-?\d+$/.test(trimmed)) return null;
  const value = Number(trimmed);
  if (!Number.isSafeInteger(value)) return null;
  return value;
}
