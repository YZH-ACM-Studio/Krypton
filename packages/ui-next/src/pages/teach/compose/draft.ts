/**
 * Composer draft: which paper is saved, which tab is open, and the lock.
 * Paper edits go through the paper model. A RangeError leaves the draft unchanged.
 */
import { TEACH_ALLOWED_KINDS, TEACH_KIND_ORDER, isTeachGroupedByKind } from '@hydrooj/common';
import type { ProblemKind, TeachStatus } from '@hydrooj/common';
import {
  insertItems,
  moveItem,
  removeItem,
  setDraw,
  setGroupScore,
  setItemScore,
  setQuota,
} from '../paper';
import type { PaperItem, PaperState, PaperTarget } from '../paper';

export interface ComposeState {
  base: PaperState;
  current: PaperState;
  activeKind: ProblemKind | null;
  locked: boolean;
  selection: number[];
}

export type ComposeAction =
  | { type: 'add'; items: PaperItem[]; target: PaperTarget }
  | { type: 'move'; docId: number; target: PaperTarget }
  | { type: 'remove'; docId: number }
  | { type: 'setItemScore'; docId: number; score: number }
  | { type: 'setGroupScore'; kind: ProblemKind; score: number }
  | { type: 'setQuota'; kind: ProblemKind; count: number }
  | { type: 'setDraw'; on: boolean }
  | { type: 'setActiveKind'; kind: ProblemKind }
  | { type: 'unlock' }
  | { type: 'select'; docId: number; on: boolean }
  | { type: 'clearSelection' }
  | { type: 'discard' }
  | { type: 'saved'; paper: PaperState };

function initialActiveKind(paper: PaperState): ProblemKind | null {
  if (!isTeachGroupedByKind(paper.type)) return null;
  const allowed = TEACH_ALLOWED_KINDS[paper.type];
  const present = new Set(paper.items.map((item) => item.kind));
  for (const kind of allowed) {
    if (present.has(kind)) return kind;
  }
  const first = allowed[0];
  if (first === undefined) throw new TypeError('teach_allowed_kinds_empty');
  return first;
}

export function initialComposeState(paper: PaperState, status: TeachStatus): ComposeState {
  return {
    base: paper,
    current: paper,
    activeKind: initialActiveKind(paper),
    locked: status === 'running' || status === 'ended',
    selection: [],
  };
}

function applyPaper(state: ComposeState, update: (paper: PaperState) => PaperState): ComposeState {
  let current: PaperState;
  try {
    current = update(state.current);
  } catch (error: unknown) {
    if (error instanceof RangeError) return state;
    throw error;
  }
  if (current === state.current) return state;
  return { ...state, current };
}

function selectDoc(state: ComposeState, docId: number, on: boolean): ComposeState {
  const selected = state.selection.includes(docId);
  if (on) {
    if (selected) return state;
    return { ...state, selection: [...state.selection, docId] };
  }
  if (!selected) return state;
  return { ...state, selection: state.selection.filter((id) => id !== docId) };
}

export function composeReducer(state: ComposeState, action: ComposeAction): ComposeState {
  if (state.locked && action.type !== 'setActiveKind' && action.type !== 'unlock' && action.type !== 'select' && action.type !== 'clearSelection') {
    return state;
  }
  switch (action.type) {
    case 'add':
      return applyPaper(state, (paper) => insertItems(paper, action.items, action.target));
    case 'move':
      return applyPaper(state, (paper) => moveItem(paper, action.docId, action.target));
    case 'remove':
      return applyPaper(state, (paper) => removeItem(paper, action.docId));
    case 'setItemScore':
      return applyPaper(state, (paper) => setItemScore(paper, action.docId, action.score));
    case 'setGroupScore':
      return applyPaper(state, (paper) => setGroupScore(paper, action.kind, action.score));
    case 'setQuota':
      return applyPaper(state, (paper) => setQuota(paper, action.kind, action.count));
    case 'setDraw':
      return applyPaper(state, (paper) => setDraw(paper, action.on));
    case 'setActiveKind':
      if (state.activeKind === action.kind) return state;
      return { ...state, activeKind: action.kind };
    case 'unlock':
      if (!state.locked) return state;
      return { ...state, locked: false };
    case 'select':
      return selectDoc(state, action.docId, action.on);
    case 'clearSelection':
      if (state.selection.length === 0) return state;
      return { ...state, selection: [] };
    case 'discard':
      if (state.current === state.base && state.selection.length === 0) return state;
      return { ...state, current: state.base, selection: [] };
    case 'saved':
      return { ...state, base: action.paper, current: action.paper };
    default: {
      const unexpected: never = action;
      throw new TypeError(`teach_compose_action_invalid:${String(unexpected)}`);
    }
  }
}

/** Kinds of problems added since prev that did not land on the tab that was open. */
export function landedKindsOutsideActive(prev: ComposeState, next: ComposeState): ProblemKind[] {
  const active = prev.activeKind;
  if (active === null) return [];
  const before = new Set(prev.current.items.map((item) => item.docId));
  const landed = new Set<ProblemKind>();
  for (const item of next.current.items) {
    if (before.has(item.docId) || item.kind === active) continue;
    landed.add(item.kind);
  }
  return TEACH_KIND_ORDER.filter((kind) => landed.has(kind));
}
