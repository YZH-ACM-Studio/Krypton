import { endSaveDue, saveEndCodeDrafts } from './end-save';
import { parseDraftList, SAVE_HAS_NEW_EDITS } from './answers';
import { isOnePerPageKind } from '@hydrooj/common';
import { Lock, Monitor, PenLine, type LucideIcon } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { useMediaQuery } from '@/components/ui/media';
import { useBootstrap } from '@/lib/bootstrap';
import { useExamNow } from '@/lib/exam-server-clock';
import { durationText, formatMoment } from '@/pages/problem-sets/model';
import { getJson, postForm, postJson } from '@/pages/teach/api';
import { AnswerChips, AnswerColumn } from './answer-column';
import {
  firstOpenTarget, parseSetWorkspace, parseWorkspaceProblems, readSection, sectionHref,
} from './model';
import type {
  DraftMap, OpenTarget, SectionQuery, SetWorkspace, WorkspaceProblem, WsDraft, WsGroup, WsItem,
} from './model';
import { ObjectiveKindPage } from './objective-page';
import type { ObjectiveAnswerActions } from './objective-page';
import { WorkspaceOverview } from './overview';
import { ProgramProblemPage } from './program-page';
import {
  ClarifySection, NoticeSection, PrintSection, RankingSection, RecordsSection,
} from './sections';
import { SetWorkspaceShell } from './shell';

const MINUTE_MS = 60_000;
const COLUMN_COLLAPSED = '1';
const NARROW_QUERY = '(max-width: 1023px)';
const DRAFT_FALLBACK = '加载草稿失败。';
const START_FALLBACK = '开始作答失败。';
const ATTEND_FALLBACK = '开始做作业失败。';
const FINALIZE_FALLBACK = '交卷失败。';
const UNSAVED_NOTE = '还有未保存的修改。请先保存本题型答案，或放弃这些修改后再交卷。交卷不会自动保存。';
const CLIENT_TITLE = '请在机房客户端进入';
const CLIENT_NOTE = '这场考试只能在机房电脑上的 Krypton 客户端里作答';
const NEED_START = '点「开始作答」后才能看到题目';
const NEED_ATTEND = '点「开始做作业」后才能看到题目';
const CONTEST_LOCK = '报名后，比赛开始时这里出现题目';
const VIEW_CLOSED = '比赛结束后不能查看题目。';

interface ObjectiveFocus {
  mode: 'objective';
  group: WsGroup;
  currentPid: number | null;
}

interface ProgramFocus {
  mode: 'program';
  group: WsGroup;
  item: WsItem;
}

type ProblemFocus = ObjectiveFocus | ProgramFocus;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function pageRecord(raw: unknown): Record<string, unknown> {
  if (!isRecord(raw)) throw new TypeError('page data must be an object');
  return raw;
}

function field(record: Record<string, unknown>, key: string): unknown {
  if (!Object.hasOwn(record, key)) return undefined;
  return Reflect.get(record, key) as unknown;
}

function errorText(error: unknown): string {
  if (error instanceof Error && error.message !== '') return error.message;
  throw error;
}

function parseLangRange(raw: unknown): Record<string, string> {
  if (raw === undefined) return {};
  if (!isRecord(raw)) throw new TypeError('langRange must be an object of strings');
  const range: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value !== 'string') throw new TypeError(`langRange.${key} must be a string`);
    range[key] = value;
  }
  return range;
}

function shouldLoadDrafts(ws: SetWorkspace): boolean {
  if (!ws.urls.draftList || ws.locked !== null) return false;
  if (ws.kind === 'paper' && ws.mode !== 'preview' && ws.window.startAt === null) return false;
  return true;
}

function columnStorageKey(tid: string): string {
  return `ws-col:${tid}`;
}

function storageDetail(detail: unknown): { key: string; value: unknown } | null {
  if (!isRecord(detail) || !Object.hasOwn(detail, 'key') || !Object.hasOwn(detail, 'value')) return null;
  const key = detail.key;
  if (typeof key !== 'string') return null;
  return { key, value: detail.value };
}

function useColumnCollapsed(tid: string): boolean {
  const key = columnStorageKey(tid);
  const [collapsed, setCollapsed] = useState(() => window.localStorage.getItem(key) === COLUMN_COLLAPSED);
  useEffect(() => {
    setCollapsed(window.localStorage.getItem(key) === COLUMN_COLLAPSED);
    const onCustom = (event: Event) => {
      if (!(event instanceof CustomEvent)) return;
      const detail = storageDetail(event.detail);
      if (!detail || detail.key !== key) return;
      setCollapsed(detail.value === COLUMN_COLLAPSED);
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key !== key) return;
      setCollapsed(event.newValue === COLUMN_COLLAPSED);
    };
    window.addEventListener('ws-storage', onCustom);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener('ws-storage', onCustom);
      window.removeEventListener('storage', onStorage);
    };
  }, [key]);
  return collapsed;
}

function personallyTimed(ws: SetWorkspace): boolean {
  const minutes = ws.window.durationMinutes;
  return minutes !== null && minutes > 0;
}

function requireMinutes(ws: SetWorkspace): number {
  const minutes = ws.window.durationMinutes;
  if (minutes === null || minutes <= 0) throw new TypeError('personal duration is missing');
  return minutes;
}

function windowRemaining(ws: SetWorkspace, now: number): number {
  const endAt = Date.parse(ws.window.endAt);
  if (!Number.isFinite(endAt)) throw new TypeError('endAt is not a timestamp');
  return endAt - now;
}

function limitTooShort(ws: SetWorkspace, now: number): boolean {
  if (!personallyTimed(ws)) return false;
  return windowRemaining(ws, now) < requireMinutes(ws) * MINUTE_MS;
}

function startDialogText(ws: SetWorkspace, now: number): string {
  const minutes = requireMinutes(ws);
  const endLabel = formatMoment(ws.window.endAt, now);
  if (limitTooShort(ws, now)) {
    return `现在开始只剩 ${durationText(Math.max(0, windowRemaining(ws, now)))}，${endLabel} 统一截止。`;
  }
  return `开始后计时 ${minutes} 分钟，中途不能暂停；${endLabel} 统一截止。`;
}

function locate(ws: SetWorkspace, pid: number): { group: WsGroup; item: WsItem } | null {
  for (const group of ws.groups) {
    const item = group.items.find((candidate) => candidate.pid === pid);
    if (item) return { group, item };
  }
  return null;
}

function objectiveFocus(group: WsGroup, currentPid: number | null): ObjectiveFocus {
  return { mode: 'objective', group, currentPid };
}

function programFocus(group: WsGroup, item: WsItem): ProgramFocus {
  return { mode: 'program', group, item };
}

function focusForGroup(group: WsGroup, currentPid: number | null): ProblemFocus | null {
  if (isOnePerPageKind(group.kind)) {
    const picked = currentPid === null ? undefined : group.items.find((item) => item.pid === currentPid);
    const item = picked ?? group.items[0];
    if (!item) return null;
    return programFocus(group, item);
  }
  return objectiveFocus(group, currentPid);
}

function focusForTarget(ws: SetWorkspace, target: OpenTarget): ProblemFocus {
  if (target.q !== null) {
    const found = locate(ws, target.q);
    if (!found) throw new TypeError(`open target ${target.q} is missing`);
    return programFocus(found.group, found.item);
  }
  const group = ws.groups.find((candidate) => candidate.kind === target.kind);
  if (!group) throw new TypeError(`open target kind ${target.kind} is missing`);
  const focus = focusForGroup(group, null);
  if (!focus) throw new TypeError(`open target kind ${target.kind} has no problems`);
  return focus;
}

function resolveFocus(ws: SetWorkspace, query: SectionQuery): ProblemFocus | null {
  if (query.q !== null) {
    const found = locate(ws, query.q);
    if (found) {
      if (isOnePerPageKind(found.item.kind)) return programFocus(found.group, found.item);
      return objectiveFocus(found.group, found.item.pid);
    }
  }
  if (query.kind !== null) {
    const group = ws.groups.find((candidate) => candidate.kind === query.kind);
    if (group) return focusForGroup(group, null);
  }
  const target = firstOpenTarget(ws);
  if (target) return focusForTarget(ws, target);
  const first = ws.groups[0];
  if (!first) return null;
  return focusForGroup(first, null);
}

function LockScreen({
  icon: Icon,
  title,
  description,
  action,
  error,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
  error?: string | null;
}): ReactElement {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center">
      <div className="grid justify-items-center gap-3">
        <EmptyState icon={<Icon aria-hidden="true" />} title={title} description={description} action={action} />
        {error ? <Alert tone="danger" className="max-w-sm">{error}</Alert> : null}
      </div>
    </div>
  );
}

function LockedProblems({
  ws,
  now,
  attendError,
  attendPending,
  startError,
  startPending,
  onStart,
  onAttend,
}: {
  ws: SetWorkspace;
  now: number;
  attendError: string | null;
  attendPending: boolean;
  startError: string | null;
  startPending: boolean;
  onStart: () => void;
  onAttend: () => void;
}): ReactElement {
  const reason = ws.locked?.reason;
  if (!reason) throw new TypeError('locked problem list is missing a reason');
  if (reason !== 'client_only' && ws.action.invitationRequired) {
    return <LockScreen icon={Lock} title="输入邀请码后参加" action={<Button variant="primary" asChild><a href={sectionHref(ws, 'overview')}>去概览输入邀请码</a></Button>} />;
  }
  if (reason !== 'client_only' && ws.officialRound !== undefined && ws.team?.role === 'member') {
    return <LockScreen icon={Lock} title="等待队长开始作答" description="队员跟随队长的作答轮次，可以查看团队答卷。" />;
  }
  const opened = formatMoment(ws.window.beginAt, now);
  switch (reason) {
    case 'not_started':
      return <LockScreen icon={Lock} title="开始后才能看到题目" description={opened} />;
    case 'not_open':
      return <LockScreen icon={Lock} title="开放后才能看到题目" description={opened} />;
    case 'need_start':
      return (
        <LockScreen
          icon={Lock}
          title={NEED_START}
          error={startError}
          action={(
            <Button type="button" variant="primary" disabled={!ws.action.canStart} loading={startPending} onClick={onStart}>
              开始作答
            </Button>
          )}
        />
      );
    case 'need_attend':
      if (ws.kind === 'homework') {
        return (
          <LockScreen
            icon={Lock}
            title={NEED_ATTEND}
            error={attendError}
            action={(
              <Button type="button" variant="primary" loading={attendPending} onClick={onAttend}>
                开始做作业
              </Button>
            )}
          />
        );
      }
      if (ws.kind === 'contest') {
        return (
          <LockScreen
            icon={Lock}
            title={CONTEST_LOCK}
            action={(
              <Button variant="secondary" asChild>
                <a href={sectionHref(ws, 'overview')}>去概览报名</a>
              </Button>
            )}
          />
        );
      }
      throw new TypeError(`need_attend is not defined for ${ws.kind}`);
    case 'client_only':
      return <LockScreen icon={Monitor} title={CLIENT_TITLE} description={CLIENT_NOTE} />;
    case 'view_closed':
      return <LockScreen icon={Lock} title={VIEW_CLOSED} />;
    default: {
      const unexpected: never = reason;
      throw new TypeError(`unknown lock ${String(unexpected)}`);
    }
  }
}

function ConfirmDialog({
  title,
  description,
  confirmLabel,
  pending,
  error,
  onClose,
  onConfirm,
  discardLabel,
  onDiscard,
}: {
  title: string;
  description: string;
  confirmLabel: string;
  pending: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: () => void;
  discardLabel?: string;
  onDiscard?: () => void;
}): ReactElement {
  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {error ? <DialogBody><Alert tone="danger">{error}</Alert></DialogBody> : null}
        <DialogFooter>
          <Button type="button" variant="secondary" disabled={pending} onClick={onClose}>取消</Button>
          {onDiscard ? <Button type="button" variant="secondary" disabled={pending} onClick={onDiscard}>{discardLabel}</Button> : null}
          <Button type="button" variant="primary" loading={pending} onClick={onConfirm}>{confirmLabel}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function sectionBody(ws: SetWorkspace, section: SectionQuery['section']): ReactElement | null {
  switch (section) {
    case 'overview':
      return <WorkspaceOverview ws={ws} />;
    case 'records':
      return <RecordsSection ws={ws} />;
    case 'ranking':
      return <RankingSection ws={ws} />;
    case 'notice':
      return <NoticeSection ws={ws} />;
    case 'clar':
      return <ClarifySection ws={ws} />;
    case 'print':
      return <PrintSection ws={ws} />;
    case 'problems':
      return null;
    default: {
      const unexpected: never = section;
      throw new TypeError(`unknown section ${String(unexpected)}`);
    }
  }
}

function ProblemBody({
  ws,
  focus,
  problems,
  langRange,
  drafts,
  onDraftsChange,
  registerObjectiveAnswers,
}: {
  ws: SetWorkspace;
  focus: ProblemFocus;
  problems: Map<number, WorkspaceProblem>;
  langRange: Record<string, string>;
  drafts: DraftMap;
  onDraftsChange: (drafts: DraftMap) => void;
  registerObjectiveAnswers: (actions: ObjectiveAnswerActions) => () => void;
}): ReactElement {
  if (focus.mode === 'objective') {
    return (
      <ObjectiveKindPage
        key={ws.tid}
        ws={ws}
        group={focus.group}
        problems={problems}
        drafts={drafts}
        onDraftsChange={onDraftsChange}
        registerObjectiveAnswers={registerObjectiveAnswers}
      />
    );
  }
  return (
    <ProgramProblemPage
      key={`${ws.tid}:${ws.officialRound?.id ?? 'legacy'}:${focus.item.pid}`}
      ws={ws}
      item={focus.item}
      problems={problems}
      langRange={langRange}
      drafts={drafts}
      onDraftsChange={onDraftsChange}
      registerObjectiveAnswers={registerObjectiveAnswers}
    />
  );
}

export function SetWorkspacePage(): ReactElement {
  const bootstrap = useBootstrap();
  const now = useExamNow(bootstrap.generatedAt);
  const data = pageRecord(bootstrap.page.data);
  const ws = parseSetWorkspace(field(data, 'workspace'));
  const problems = parseWorkspaceProblems(field(data, 'workspaceProblems'));
  const langRange = parseLangRange(field(data, 'langRange'));
  const query = readSection(window.location.search);
  const collapsed = useColumnCollapsed(ws.tid);
  const narrow = useMediaQuery(NARROW_QUERY);
  const [drafts, setDrafts] = useState<Map<number, WsDraft>>(() => new Map());
  const [draftsLoaded, setDraftsLoaded] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [startOpen, setStartOpen] = useState(false);
  const [startPending, setStartPending] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [finalizeOpen, setFinalizeOpen] = useState(false);
  const [finalizePending, setFinalizePending] = useState(false);
  const [finalizeError, setFinalizeError] = useState<string | null>(null);
  const [finalizeUnsaved, setFinalizeUnsaved] = useState(false);
  const [switchHref, setSwitchHref] = useState<string | null>(null);
  const [switchPending, setSwitchPending] = useState(false);
  const [switchError, setSwitchError] = useState<string | null>(null);
  const [attendPending, setAttendPending] = useState(false);
  const [attendError, setAttendError] = useState<string | null>(null);
  const startLock = useRef(false);
  const finalizeLock = useRef(false);
  const attendLock = useRef(false);
  const switchLock = useRef(false);
  const objectiveAnswers = useRef<ObjectiveAnswerActions | null>(null);
  const endSaved = useRef(false);
  const endSaving = useRef(false);
  const [endSaveState, setEndSaveState] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle');
  const [endSaveError, setEndSaveError] = useState('');
  async function saveBeforeEnd() {
    if (endSaving.current || !endSaveDue(ws, now)) return;
    endSaving.current = true;
    endSaved.current = true;
    setEndSaveState('saving'); setEndSaveError('');
    try {
      const actions = objectiveAnswers.current;
      if (actions?.hasUnsaved() && !await actions.save()) throw new Error(SAVE_HAS_NEW_EDITS);
      await saveEndCodeDrafts(ws, postJson);
      setEndSaveState('saved');
    } catch (cause) {
      console.error('End of round save failed', { tid: ws.tid, round: ws.officialRound?.id, cause });
      setEndSaveState('failed'); setEndSaveError(errorText(cause));
    } finally { endSaving.current = false; }
  }
  const endSaveRef = useRef(saveBeforeEnd);
  endSaveRef.current = saveBeforeEnd;
  useEffect(() => {
    if (endSaveDue(ws, now) && !endSaved.current && (draftsLoaded || !ws.urls.draftList)) void endSaveRef.current();
  }, [ws, now, draftsLoaded]);

  const registerObjectiveAnswers = useCallback((actions: ObjectiveAnswerActions) => {
    objectiveAnswers.current = actions;
    return () => {
      if (objectiveAnswers.current === actions) objectiveAnswers.current = null;
    };
  }, []);
  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!objectiveAnswers.current?.hasUnsaved()) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);
  const draftUrl = shouldLoadDrafts(ws) ? ws.urls.draftList : null;

  useEffect(() => {
    if (!draftUrl) return undefined;
    let alive = true;
    getJson(draftUrl, DRAFT_FALLBACK).then((raw) => {
      if (!alive) return;
      if (ws.officialRound !== undefined) {
        if (!isRecord(raw) || raw.roundId !== (ws.officialRound?.id ?? null)) throw new TypeError('作答轮次已变化，请刷新页面。');
      }
      const loaded = parseDraftList(raw);
      if (ws.officialRound !== undefined && [...loaded.values()].some((draft) => draft.version === undefined)) throw new TypeError('正式答案缺少版本，请刷新页面。');
      setDrafts(loaded);
      setDraftsLoaded(true);
      setDraftError(null);
    }).catch((error: unknown) => {
      if (!alive) return;
      setDraftError(errorText(error));
    });
    return () => {
      alive = false;
    };
  }, [draftUrl]);

  const onDraftsChange = (next: DraftMap) => {
    setDrafts(new Map(next));
  };

  const confirmStart = () => {
    if (startLock.current) return;
    startLock.current = true;
    setStartPending(true);
    setStartError(null);
    const url = ws.urls.start;
    const body = ws.kind === 'homework' ? new URLSearchParams({ operation: 'start' }) : new URLSearchParams();
    void (async () => {
      try {
        if (!url) throw new TypeError('start url is missing');
        if (ws.officialRound !== undefined) await postJson(url, {}, START_FALLBACK);
        else await postForm(url, body, START_FALLBACK);
        window.location.assign(sectionHref(ws, 'problems'));
      } catch (error) {
        startLock.current = false;
        setStartPending(false);
        setStartError(errorText(error));
      }
    })();
  };

  const confirmFinalize = (discard = false) => {
    if (finalizeLock.current) return;
    finalizeLock.current = true;
    setFinalizePending(true);
    setFinalizeError(null);
    const url = ws.urls.finalize;
    void (async () => {
      try {
        if (!url) throw new TypeError('finalize url is missing');
        if (discard) objectiveAnswers.current?.discard();
        if (objectiveAnswers.current?.hasUnsaved()) {
          finalizeLock.current = false;
          setFinalizePending(false);
          setFinalizeUnsaved(true);
          setFinalizeError(UNSAVED_NOTE);
          return;
        }
        setFinalizeUnsaved(false);
        if (ws.officialRound !== undefined) {
          if (!ws.officialRound) throw new Error('当前作答轮次已变化，请刷新页面。');
          await postJson(url, { roundId: ws.officialRound.id }, FINALIZE_FALLBACK);
        } else await postForm(url, new URLSearchParams(), FINALIZE_FALLBACK);
        window.location.assign(sectionHref(ws, 'overview'));
      } catch (error) {
        finalizeLock.current = false;
        setFinalizePending(false);
        setFinalizeError(errorText(error));
      }
    })();
  };

  const navigateProblem = (href: string) => {
    if (!objectiveAnswers.current?.hasUnsaved()) {
      window.location.assign(href);
      return;
    }
    setSwitchError(null);
    setSwitchHref(href);
  };

  const confirmSwitch = (save: boolean) => {
    if (switchLock.current || !switchHref) return;
    switchLock.current = true;
    setSwitchPending(true);
    setSwitchError(null);
    const href = switchHref;
    void (async () => {
      try {
        const actions = objectiveAnswers.current;
        if (!actions) throw new Error('答题状态已变化，请继续作答后重试。');
        if (save) {
          if (!await actions.save()) {
            setSwitchError(SAVE_HAS_NEW_EDITS);
            return;
          }
        } else actions.discard();
        window.location.assign(href);
      } catch (error) {
        setSwitchError(errorText(error));
      } finally {
        switchLock.current = false;
        setSwitchPending(false);
      }
    })();
  };

  const startHomework = () => {
    if (attendLock.current) return;
    attendLock.current = true;
    setAttendPending(true);
    setAttendError(null);
    const url = ws.urls.attend;
    void (async () => {
      try {
        if (!url) throw new TypeError('attend url is missing');
        await postForm(url, new URLSearchParams({ operation: 'attend' }), ATTEND_FALLBACK);
        window.location.assign(sectionHref(ws, 'problems'));
      } catch (error) {
        attendLock.current = false;
        setAttendPending(false);
        setAttendError(errorText(error));
      }
    })();
  };

  const other = sectionBody(ws, query.section);
  const focus = other === null && ws.locked === null ? resolveFocus(ws, query) : null;
  const columnProps = focus
    ? {
      ws,
      currentKind: focus.group.kind,
      currentPid: focus.mode === 'program' ? focus.item.pid : focus.currentPid,
      drafts,
      onNavigate: navigateProblem,
    }
    : null;
  const answered = `${ws.totals.answered} / ${ws.totals.problemCount}`;

  let body: ReactElement;
  if (other) body = other;
  else if (ws.locked) {
    body = (
      <LockedProblems
        ws={ws}
        now={now}
        attendError={attendError}
        attendPending={attendPending}
        startError={startError}
        startPending={startPending}
        onStart={() => {
          setStartError(null);
          if (personallyTimed(ws)) {
            setStartOpen(true);
            return;
          }
          confirmStart();
        }}
        onAttend={startHomework}
      />
    );
  } else if (draftUrl && !draftsLoaded) {
    body = <LockScreen icon={PenLine} title={draftError ? '无法读取已保存答案' : '正在读取已保存答案'} />;
  } else if (!focus) {
    body = <LockScreen icon={PenLine} title="还没有题目" />;
  } else {
    body = (
      <ProblemBody
        ws={ws}
        focus={focus}
        problems={problems}
        langRange={langRange}
        drafts={drafts}
        onDraftsChange={onDraftsChange}
        registerObjectiveAnswers={registerObjectiveAnswers}
      />
    );
  }

  return (
    <SetWorkspaceShell
      ws={ws}
      section={query.section}
      onNavigate={navigateProblem}
      column={columnProps && !collapsed ? <AnswerColumn {...columnProps} /> : null}
      onFinalize={() => {
        const unsaved = objectiveAnswers.current?.hasUnsaved() ?? false;
        setFinalizeUnsaved(unsaved);
        setFinalizeError(unsaved ? UNSAVED_NOTE : null);
        setFinalizeOpen(true);
      }}
    >
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {draftError ? <Alert tone="danger">{draftError}</Alert> : null}
        {ws.rules?.autoSaveBeforeEnd && ws.action.canSubmit ? <div className="shrink-0 px-3 py-2 text-xs text-fg-muted" role="status">
          {endSaveState === 'saving' ? '正在保存截止前答案…' : endSaveState === 'saved' ? '截止前答案已保存，之后的修改请手动保存。' : endSaveState === 'failed' ? <Alert tone="danger" action={<Button size="sm" variant="secondary" disabled={!endSaveDue(ws, now)} onClick={() => { void saveBeforeEnd(); }}>重试</Button>}>{endSaveError}</Alert> : '已启用结束前保存：保持页面打开，截止前 30 秒保存届时未提交的答案。'}
        </div> : null}
        {columnProps && narrow ? (
          <div className="shrink-0 border-b border-line bg-surface px-3 py-2">
            <AnswerChips {...columnProps} />
          </div>
        ) : null}
        {body}
      </div>
      {startOpen ? (
        <ConfirmDialog
          title="开始作答？"
          description={startDialogText(ws, now)}
          confirmLabel="开始作答"
          pending={startPending}
          error={startError}
          onClose={() => { if (!startPending) setStartOpen(false); }}
          onConfirm={confirmStart}
        />
      ) : null}
      {finalizeOpen ? (
        <ConfirmDialog
          title="交卷？"
          description={`交卷后不能再修改答案。已作答 ${answered}。`}
          confirmLabel="交卷"
          pending={finalizePending}
          error={finalizeError}
          onClose={() => { if (!finalizePending) setFinalizeOpen(false); }}
          onConfirm={() => confirmFinalize()}
          discardLabel="放弃并交卷"
          onDiscard={finalizeUnsaved ? () => confirmFinalize(true) : undefined}
        />
      ) : null}
      {switchHref ? (
        <Dialog open onOpenChange={(open) => { if (!open && !switchPending) setSwitchHref(null); }}>
          <DialogContent showCloseButton={false}>
            <DialogHeader>
              <DialogTitle>还有未保存的答案</DialogTitle>
              <DialogDescription>切换前，请保存本题型答案或放弃修改。</DialogDescription>
            </DialogHeader>
            {switchError ? <DialogBody><Alert tone="danger">{switchError}</Alert></DialogBody> : null}
            <DialogFooter>
              <Button type="button" variant="primary" loading={switchPending} onClick={() => confirmSwitch(true)}>保存并切换</Button>
              <Button type="button" variant="secondary" disabled={switchPending} onClick={() => confirmSwitch(false)}>放弃修改并切换</Button>
              <Button type="button" variant="secondary" disabled={switchPending} onClick={() => setSwitchHref(null)}>继续作答</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </SetWorkspaceShell>
  );
}
