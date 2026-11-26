import { isOnePerPageKind } from '@hydrooj/common';
import type { ProblemKind } from '@hydrooj/common';
import {
  Braces,
  CircleCheck,
  CircleDot,
  Code2,
  FileCode2,
  Info,
  ListChecks,
  MessageSquare,
  TextCursorInput,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import type { MouseEvent } from 'react';
import { Button } from '@/components/ui/button';
import {
  cellClass,
  objectiveVerdictPending,
  sectionHref,
  type CellState,
  type DraftMap,
  type SetWorkspace,
  type WsDraft,
  type WsFlavor,
  type WsGroup,
  type WsItem,
  type WsKind,
} from './model';

export interface AnswerColumnProps {
  ws: SetWorkspace;
  currentKind: ProblemKind;
  currentPid: number | null;
  drafts: DraftMap;
  onNavigate?: (href: string) => void;
}

function navigateLink(event: MouseEvent<HTMLAnchorElement>, onNavigate?: (href: string) => void): void {
  if (!onNavigate || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const href = event.currentTarget.getAttribute('href');
  if (!href || href.startsWith('#')) return;
  event.preventDefault();
  onNavigate(href);
}

const KIND_ICON: Record<ProblemKind, LucideIcon> = {
  true_false: CircleCheck,
  single: CircleDot,
  multi: ListChecks,
  blank: TextCursorInput,
  program_fill: FileCode2,
  function: Braces,
  programming: Code2,
  subjective: MessageSquare,
};

interface LegendEntry {
  label: string;
  state: CellState;
  flagged: boolean;
}

function progressCaption(flavor: WsFlavor): string {
  switch (flavor) {
    case 'acm':
      return '通过 / 题数';
    case 'ioi':
    case 'oi':
      return '满分 / 题数';
    case 'homework':
    case 'paper':
      return '作答 / 题数';
    default: {
      const unexpected: never = flavor;
      throw new TypeError(`unknown flavor ${String(unexpected)}`);
    }
  }
}

function countsTowardProgress(flavor: WsFlavor, state: CellState): boolean {
  switch (flavor) {
    case 'acm':
    case 'ioi':
    case 'oi':
      return state === 'correct';
    case 'homework':
    case 'paper':
      return state !== 'empty';
    default: {
      const unexpected: never = flavor;
      throw new TypeError(`unknown flavor ${String(unexpected)}`);
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function compareCanonical(left: unknown, right: unknown): number {
  const a = JSON.stringify(left);
  const b = JSON.stringify(right);
  if (a === b) return 0;
  if (a === undefined) return -1;
  if (b === undefined) return 1;
  return a < b ? -1 : 1;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => canonicalize(item)).sort(compareCanonical);
  if (!isRecord(value)) return value;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) sorted[key] = canonicalize(value[key]);
  return sorted;
}

function canonicalJson(value: unknown): string {
  const json = JSON.stringify(canonicalize(value));
  if (typeof json !== 'string') throw new TypeError('canonical JSON is undefined');
  return json;
}

function answersNonEmpty(answers: WsDraft['answers']): boolean {
  return answers !== null && Object.keys(answers).length > 0;
}

function draftPending(draft: WsDraft | undefined): boolean {
  if (!draft || !answersNonEmpty(draft.answers)) return false;
  return canonicalJson(draft.answers) !== canonicalJson(draft.submittedAnswers ?? null);
}

function overlaysDraft(ws: SetWorkspace): boolean {
  if (ws.locked !== null) return false;
  if (ws.kind === 'homework') return true;
  return ws.kind === 'paper' && ws.phase === 'answering';
}

function journalState(item: WsItem): CellState {
  if (item.submits <= 0) return 'empty';
  if (item.score > 0 && item.lastScore !== null && item.lastScore >= item.score) return 'correct';
  if (item.lastScore !== null && item.lastScore > 0) return 'partial';
  return 'wrong';
}

function unlockedState(ws: SetWorkspace, item: WsItem, drafts: DraftMap): CellState {
  if (ws.officialRound !== undefined) {
    const official = drafts.get(item.pid);
    if (official?.version === undefined) return item.state;
    const results = item.feedback?.verdict === false ? [] : Object.values(official.judgeResult ?? {});
    if (results.length) return results.every((result) => result === 'correct') ? 'correct' : results.every((result) => result === 'wrong') ? 'wrong' : 'partial';
    return answersNonEmpty(official.answers) ? 'submitted' : 'empty';
  }
  if (objectiveVerdictPending(ws, item.kind)) {
    const draft = drafts.get(item.pid);
    if (draft && answersNonEmpty(draft.answers)) return 'submitted';
    if (item.state === 'correct' || item.state === 'wrong' || item.state === 'partial') return 'submitted';
    return item.state;
  }
  if (!overlaysDraft(ws) || isOnePerPageKind(item.kind) || !drafts.has(item.pid)) return item.state;
  const draft = drafts.get(item.pid);
  if (ws.kind === 'paper') return draft !== undefined && answersNonEmpty(draft.answers) ? 'draft' : 'empty';
  if (draftPending(draft)) return 'draft';
  if (item.state === 'draft') return journalState(item);
  return item.state;
}

function displayState(ws: SetWorkspace, item: WsItem, drafts: DraftMap): CellState {
  if (ws.locked !== null) return 'empty';
  return unlockedState(ws, item, drafts);
}

function progressState(ws: SetWorkspace, item: WsItem, drafts: DraftMap): CellState {
  if (ws.locked !== null) return item.state;
  return unlockedState(ws, item, drafts);
}

function progressCount(ws: SetWorkspace, items: readonly WsItem[], drafts: DraftMap): number {
  let count = 0;
  for (const item of items) {
    if (countsTowardProgress(ws.officialRound !== undefined ? 'paper' : ws.flavor, progressState(ws, item, drafts))) count += 1;
  }
  return count;
}

function selectGroup(ws: SetWorkspace, currentKind: ProblemKind): WsGroup | null {
  return ws.groups.find((group) => group.kind === currentKind) ?? ws.groups[0] ?? null;
}

function usesProblemQuery(ws: SetWorkspace, group: WsGroup): boolean {
  return ws.numbering === 'letter' || isOnePerPageKind(group.kind);
}

function queryPid(group: WsGroup, currentPid: number | null): number {
  if (currentPid !== null && group.items.some((entry) => entry.pid === currentPid)) return currentPid;
  const first = group.items[0];
  if (first === undefined) throw new TypeError(`group ${group.name} has no problem`);
  return first.pid;
}

function groupHref(ws: SetWorkspace, group: WsGroup, currentPid: number | null): string {
  if (!usesProblemQuery(ws, group)) return sectionHref(ws, 'problems', { kind: group.kind });
  return sectionHref(ws, 'problems', { q: queryPid(group, currentPid) });
}

function cellHref(ws: SetWorkspace, item: WsItem): string {
  if (ws.numbering === 'letter' || isOnePerPageKind(item.kind)) return sectionHref(ws, 'problems', { q: item.pid });
  return `#q-${item.label}`;
}

function cellText(ws: SetWorkspace, item: WsItem, index: number): string {
  if (ws.numbering === 'letter') return item.label;
  return String(index + 1);
}

function flagKey(tid: string, pid: number): string {
  return `ws-flag:${tid}:${pid}`;
}

function isFlagged(tid: string, pid: number): boolean {
  return localStorage.getItem(flagKey(tid, pid)) !== null;
}

function useFlagRevision(): void {
  const [, setRevision] = useState(0);
  useEffect(() => {
    const refresh = () => setRevision((value) => value + 1);
    window.addEventListener('ws-storage', refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener('ws-storage', refresh);
      window.removeEventListener('storage', refresh);
    };
  }, []);
}

function cellTone(state: CellState): string {
  if (state === 'empty') return 'text-fg-subtle';
  if (state === 'submitted') return 'text-fg';
  return '';
}

function footerLabel(total: number): string {
  return `当前 1 \u2013 ${total} 项，共 ${total} 项`;
}

function legendEntries(kind: WsKind): LegendEntry[] {
  const homework = kind === 'homework';
  const saved: LegendEntry = homework
    ? { label: '已作答未提交', state: 'draft', flagged: false }
    : { label: '已保存', state: 'draft', flagged: false };
  const entries: LegendEntry[] = [
    { label: '未作答', state: 'empty', flagged: false },
    saved,
  ];
  if (homework) entries.push({ label: '已提交', state: 'submitted', flagged: false });
  entries.push(
    { label: '正确', state: 'correct', flagged: false },
    { label: '错误', state: 'wrong', flagged: false },
    { label: '部分正确', state: 'partial', flagged: false },
    { label: '已标记', state: 'empty', flagged: true },
  );
  return entries;
}

function ProblemCell({
  ws,
  item,
  index,
  current,
  chip,
  drafts,
  onNavigate,
}: {
  ws: SetWorkspace;
  item: WsItem;
  index: number;
  current: boolean;
  chip: boolean;
  drafts: DraftMap;
  onNavigate?: (href: string) => void;
}) {
  const locked = ws.locked !== null;
  const state = displayState(ws, item, drafts);
  const flagged = isFlagged(ws.tid, item.pid);
  const className = [
    'inline-flex items-center justify-center rounded-sm font-mono text-xs',
    chip ? 'h-8 w-8 shrink-0' : 'h-8 w-full',
    cellTone(state),
    cellClass(state, flagged, current),
  ].filter((token) => token.length > 0).join(' ');
  const text = cellText(ws, item, index);
  if (locked) {
    return (
      <span className={className} aria-label={item.label}>
        {text}
      </span>
    );
  }
  return (
    <a className={className} href={cellHref(ws, item)} aria-label={item.label} onClick={(event) => navigateLink(event, onNavigate)}>
      {text}
    </a>
  );
}

function GroupRow({
  ws,
  group,
  current,
  currentPid,
  drafts,
  onNavigate,
}: {
  ws: SetWorkspace;
  group: WsGroup;
  current: boolean;
  currentPid: number | null;
  drafts: DraftMap;
  onNavigate?: (href: string) => void;
}) {
  const Icon = KIND_ICON[group.kind];
  const done = progressCount(ws, group.items, drafts);
  return (
    <a
      href={groupHref(ws, group, currentPid)}
      onClick={(event) => navigateLink(event, onNavigate)}
      aria-current={current ? 'true' : undefined}
      className={`flex items-center gap-2 px-4 py-2 text-sm text-fg hover:bg-surface-hover${current ? ' bg-surface-active font-semibold' : ''}`}
    >
      <Icon aria-hidden className="size-4 shrink-0 text-fg-muted" />
      <span className="min-w-0 flex-1 truncate">{group.name}</span>
      <span className="shrink-0 font-mono text-xs text-fg-muted tabular-nums">{done} / {group.items.length}</span>
    </a>
  );
}

function LegendButton({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <Button variant="ghost" size="sm" asChild>
      <span
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={onToggle}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          onToggle();
        }}
      >
        <Info aria-hidden />
        图例
      </span>
    </Button>
  );
}

function Legend({ kind }: { kind: WsKind }) {
  return (
    <div className="mx-4 mb-2.5 grid grid-cols-2 gap-x-2.5 gap-y-1.5 rounded-md bg-surface-sunken px-2.5 py-2 text-2xs text-fg-muted">
      {legendEntries(kind).map((entry) => (
        <span key={entry.label} className="flex items-center gap-1.5">
          <span
            aria-hidden
            className={['inline-block size-4 shrink-0', cellClass(entry.state, entry.flagged, false)].join(' ')}
          />
          {entry.label}
        </span>
      ))}
    </div>
  );
}

function CellList({
  ws,
  group,
  currentPid,
  chip,
  drafts,
  onNavigate,
}: {
  ws: SetWorkspace;
  group: WsGroup;
  currentPid: number | null;
  chip: boolean;
  drafts: DraftMap;
  onNavigate?: (href: string) => void;
}) {
  return group.items.map((item, index) => (
    <ProblemCell
      key={item.pid}
      ws={ws}
      item={item}
      index={index}
      current={item.pid === currentPid}
      chip={chip}
      drafts={drafts}
      onNavigate={onNavigate}
    />
  ));
}

export function AnswerColumn({ ws, currentKind, currentPid, drafts, onNavigate }: AnswerColumnProps) {
  useFlagRevision();
  const [legendOpen, setLegendOpen] = useState(false);
  const selected = selectGroup(ws, currentKind);
  const total = selected?.items.length ?? 0;
  return (
    <aside aria-label="题目总览" className="flex h-full min-h-0 w-60 shrink-0 flex-col border-r border-line bg-surface">
      <div className="flex items-center justify-between px-4 pt-3.5 pb-1.5 text-xs font-semibold text-fg-muted">
        <span>题目总览</span>
        <span>{progressCaption(ws.officialRound !== undefined ? 'paper' : ws.flavor)}</span>
      </div>
      <div className="flex flex-col">
        {ws.groups.map((group) => (
          <GroupRow
            key={group.kind}
            ws={ws}
            group={group}
            current={group.kind === currentKind}
            currentPid={currentPid}
            drafts={drafts}
            onNavigate={onNavigate}
          />
        ))}
      </div>
      {selected ? (
        <>
          <div className="mt-2 flex items-center justify-between gap-2 border-t border-line-subtle px-4 pt-3.5 pb-2">
            <span className="min-w-0 truncate text-xs font-semibold">{selected.name}</span>
            <LegendButton open={legendOpen} onToggle={() => setLegendOpen((open) => !open)} />
          </div>
          {legendOpen ? <Legend kind={ws.kind} /> : null}
          <div className="grid min-h-0 flex-1 grid-cols-5 content-start gap-2 overflow-y-auto px-4 pt-1 pb-3.5">
            <CellList ws={ws} group={selected} currentPid={currentPid} chip={false} drafts={drafts} onNavigate={onNavigate} />
          </div>
        </>
      ) : null}
      <p className="mt-auto border-t border-line-subtle px-4 py-2.5 text-center text-xs text-fg-subtle">
        {footerLabel(total)}
      </p>
    </aside>
  );
}

export function AnswerChips({ ws, currentKind, currentPid, drafts, onNavigate }: AnswerColumnProps) {
  useFlagRevision();
  const selected = selectGroup(ws, currentKind);
  if (!selected) return null;
  return (
    <div className="flex min-w-0 w-full gap-2 overflow-x-auto p-1 scrollbar-none">
      <CellList ws={ws} group={selected} currentPid={currentPid} chip drafts={drafts} onNavigate={onNavigate} />
    </div>
  );
}
