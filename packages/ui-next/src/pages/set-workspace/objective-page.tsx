import { Difficulty } from '@/components/ui/verdict';
import { homeworkKindRevealsVerdict, type ProblemKind } from '@hydrooj/common';
import { Flag, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import type { ObjectiveClientQuestion } from '@/components/objective-answer-panel';
import { MarkdownView } from '@/components/markdown-renderer';
import { BlankRenderer, FillProgramRenderer, MultiChoiceRenderer, SingleChoiceRenderer } from '@/components/paper/paper-shell';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Spinner } from '@/components/ui/display';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/toast';
import { useBootstrap } from '@/lib/bootstrap';
import type { GenericUserDoc } from '@/lib/bootstrap';
import { useExamNow } from '@/lib/exam-server-clock';
import { createRequestId } from '@/lib/request-id';
import { formatMoment } from '@/pages/problem-sets/model';
import { parseDraftList, SAVE_HAS_NEW_EDITS, saveRejection, validateSaveItems } from '@/pages/set-workspace/answers';
import type { DraftMap, SetWorkspace, WorkspaceProblem, WsDraft, WsGroup, WsItem } from '@/pages/set-workspace/model';
import { postForm, postJson } from '@/pages/teach/api';
import { WorkspaceSubjectiveEditor } from './subjective-editor';

const SAVE_FALLBACK = '保存答案失败。';
const SAVE_SHAPE = '保存返回的数据格式不对。';
const SAVE_PENDING = '正在保存答案，请稍后再操作。';

export interface ObjectiveAnswerActions {
  hasUnsaved: () => boolean;
  save: () => Promise<boolean>;
  discard: () => void;
}

/** 收起为 `1`，展开则删除键。答题卡标记同样：有值即已标记。 */
const COLUMN_COLLAPSED = '1';
const FLAG_MARK = '1';
const ENDED_NOTE = '答题已结束，仅供题目浏览';
const CORNER_NOTE = '交卷在右上角';
const LOCK_NOTE = '提交后这一题型不能再修改。';
const SINGLE_LOCK_NOTE = '判断题和单选题会一起锁定。';
const GRADE_FALLBACK = '判分失败。';
const GRADE_SHAPE = '判分返回的数据格式不对。';
const SUBJECTIVE_NOTE = '主观题需要人工阅卷，验题不判分。';

type AnswerMap = Record<string, string | string[]>;
type LockKind = 'single' | 'multi' | 'blank';
type VerifyOutcome = 'correct' | 'partial' | 'wrong';

interface QuestionGrade {
  outcome: VerifyOutcome;
  score: number;
}

function columnKey(tid: string): string {
  return `ws-col:${tid}`;
}

function flagKey(tid: string, pid: number): string {
  return `ws-flag:${tid}:${pid}`;
}

function writeStorage(key: string, value: string | null): void {
  if (value === null) window.localStorage.removeItem(key);
  else window.localStorage.setItem(key, value);
  window.dispatchEvent(new CustomEvent('ws-storage', { detail: { key, value } }));
}

function copyAnswers(answers: AnswerMap): AnswerMap {
  const copy: AnswerMap = {};
  for (const [key, value] of Object.entries(answers)) {
    copy[key] = Array.isArray(value) ? [...value] : value;
  }
  return copy;
}

function storedAnswers(drafts: DraftMap, pid: number): AnswerMap {
  const saved = drafts.get(pid)?.answers;
  return saved ? copyAnswers(saved) : {};
}

function seedAnswers(group: WsGroup, drafts: DraftMap): Map<number, AnswerMap> {
  const map = new Map<number, AnswerMap>();
  for (const item of group.items) map.set(item.pid, storedAnswers(drafts, item.pid));
  return map;
}

function sameAnswers(left: AnswerMap, right: AnswerMap): boolean {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  for (const key of leftKeys) {
    const a = left[key];
    const b = right[key];
    if (Array.isArray(a) || Array.isArray(b)) {
      if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
      for (let index = 0; index < a.length; index += 1) {
        if (a[index] !== b[index]) return false;
      }
    } else if (a !== b) return false;
  }
  return true;
}

function answerFilled(value: string | string[] | undefined): boolean {
  if (value === undefined) return false;
  if (Array.isArray(value)) return value.length > 0;
  return value.trim() !== '';
}

function problemAnswered(answers: AnswerMap | undefined): boolean {
  if (!answers) return false;
  return Object.values(answers).some((value) => answerFilled(value));
}

function asChoice(value: string | string[] | undefined): string | null {
  if (typeof value !== 'string' || value === '') return null;
  return value;
}

function asList(value: string | string[] | undefined): string[] {
  return Array.isArray(value) ? value : [];
}

function asText(value: string | string[] | undefined): string {
  return typeof value === 'string' ? value : '';
}

function paperLockKind(kind: ProblemKind): LockKind | null {
  if (kind === 'true_false' || kind === 'single') return 'single';
  if (kind === 'multi') return 'multi';
  if (kind === 'blank') return 'blank';
  return null;
}

function kindLocked(ws: SetWorkspace, kind: ProblemKind): boolean {
  const mapped = paperLockKind(kind);
  if (!mapped || !ws.paper) return false;
  return ws.paper.lockedKinds.includes(mapped);
}

function pageReadOnly(ws: SetWorkspace): boolean {
  return ws.locked !== null || !ws.action.canSubmit;
}

function verifyObjectiveUrl(ws: SetWorkspace): string | null {
  if (ws.mode !== 'preview') return null;
  const url = ws.urls.verifyObjective;
  if (typeof url !== 'string' || url.length === 0) return null;
  return url;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isVerifyOutcome(value: unknown): value is VerifyOutcome {
  return value === 'correct' || value === 'partial' || value === 'wrong';
}

function parseVerifyGrade(body: Record<string, unknown>): ReadonlyMap<string, QuestionGrade> {
  if (!isPlainRecord(body.results)) throw new TypeError(GRADE_SHAPE);
  if (!Array.isArray(body.skipped) || body.skipped.some((item) => typeof item !== 'string')) {
    throw new TypeError(GRADE_SHAPE);
  }
  const results = new Map<string, QuestionGrade>();
  for (const [key, value] of Object.entries(body.results)) {
    if (!isPlainRecord(value)) throw new TypeError(GRADE_SHAPE);
    const { outcome, score } = value;
    if (!isVerifyOutcome(outcome) || typeof score !== 'number' || !Number.isFinite(score)) {
      throw new TypeError(GRADE_SHAPE);
    }
    results.set(key, { outcome, score });
  }
  return results;
}

function requireProblem(problems: Map<number, WorkspaceProblem>, pid: number): WorkspaceProblem {
  const problem = problems.get(pid);
  if (!problem) throw new TypeError(`workspace problem ${pid} is missing`);
  if (!problem.questions) throw new TypeError(`workspace problem ${pid} has no objective questions`);
  return problem;
}

function ownerName(raw: Record<string, unknown>, udict: Record<string, GenericUserDoc>): string | null {
  const named = (uid: number): string | null => {
    const name = udict[String(uid)]?.uname;
    return typeof name === 'string' && name.trim() ? name : null;
  };
  const owner = raw.owner;
  if (typeof owner === 'number' && Number.isInteger(owner)) return named(owner);
  if (typeof owner !== 'object' || owner === null || Array.isArray(owner)) return null;
  const record = owner as Record<string, unknown>;
  const direct = record.uname ?? record.name;
  if (typeof direct === 'string' && direct.trim()) return direct;
  const uid = record.uid ?? record._id;
  if (typeof uid === 'number' && Number.isInteger(uid)) return named(uid);
  return null;
}

function errorText(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  throw error instanceof Error ? error : new TypeError('request failed without a message');
}

function savedVersions(raw: unknown, pids: number[]): Map<number, number> {
  if (!isPlainRecord(raw) || !isPlainRecord(raw.versions)) throw new TypeError(SAVE_SHAPE);
  const expected = new Set(pids);
  const returned = new Set<number>();
  for (const list of [raw.changed, raw.unchanged]) {
    if (!Array.isArray(list)) throw new TypeError(SAVE_SHAPE);
    for (const pid of list) {
      if (typeof pid !== 'number' || !expected.has(pid) || returned.has(pid)) throw new TypeError(SAVE_SHAPE);
      returned.add(pid);
    }
  }
  if (returned.size !== expected.size || Object.keys(raw.versions).length !== expected.size) throw new TypeError(SAVE_SHAPE);
  const versions = new Map<number, number>();
  for (const pid of pids) {
    const version = raw.versions[String(pid)];
    if (typeof version !== 'number' || !Number.isSafeInteger(version) || version < 0) throw new TypeError(SAVE_SHAPE);
    versions.set(pid, version);
  }
  return versions;
}

function overlayTouched(base: AnswerMap, local: AnswerMap, touched: ReadonlySet<string> | undefined): AnswerMap {
  if (!touched || touched.size === 0) return copyAnswers(base);
  const merged = copyAnswers(base);
  for (const key of touched) {
    if (!Object.hasOwn(local, key)) continue;
    const value = local[key];
    if (value === undefined) continue;
    merged[key] = Array.isArray(value) ? [...value] : value;
  }
  return merged;
}

function readOnlyNote(ws: SetWorkspace, now: number): string {
  if (ws.officialRound !== undefined && ws.phase === 'submitted') return '本轮已结束，仅显示已保存答案和已公布的结果。';
  if (ws.kind === 'paper' && ws.phase === 'submitted') {
    return `已交卷，${formatMoment(ws.window.endAt, now)} 后公布成绩`;
  }
  if (ws.phase === 'answering' && !ws.action.canSubmit) return '当前仅可查看题目，不能作答。';
  return ENDED_NOTE;
}

function scoreSummary(group: WsGroup): string {
  const count = group.items.length;
  if (group.scoreEach === null) {
    const sum = group.items.reduce((total, item) => total + item.score, 0);
    return `${count} 题 · 共 ${sum} 分`;
  }
  return `${count} 题 · 每题 ${group.scoreEach} 分`;
}

function LegacyChoiceInput({
  kind,
  value,
  disabled,
  onChange,
}: {
  kind: 'single' | 'multi';
  value: string | string[];
  disabled: boolean;
  onChange: (next: string | string[]) => void;
}) {
  if (kind === 'multi') {
    const display = Array.isArray(value) ? value.join('') : value || '';
    return (
      <div className="flex flex-col gap-1">
        <Input
          value={display}
          disabled={disabled}
          onChange={(event) => {
            const letters = Array.from(new Set(event.target.value.toUpperCase().replace(/[^A-Z]/g, '').split(''))).sort();
            onChange(letters);
          }}
          placeholder="输入选项字母组合，如 ACD"
          className="max-w-56 font-mono"
        />
        <p className="text-2xs text-fg-subtle">本题选项在题面正文中，请对照正文输入选项字母。</p>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1">
      <Input
        value={Array.isArray(value) ? value[0] || '' : value || ''}
        disabled={disabled}
        onChange={(event) => {
          const raw = event.target.value;
          onChange(/^[a-z]$/.test(raw) ? raw.toUpperCase() : raw);
        }}
        placeholder="选项题填选项字母（如 A）；填空题直接填答案"
        className="max-w-72"
      />
      <p className="text-2xs text-fg-subtle">本题未配置结构化选项，请对照题面正文作答。</p>
    </div>
  );
}

function outcomeBadge(outcome: VerifyOutcome): ReactElement {
  if (outcome === 'correct') return <Badge tone="success" variant="soft" size="sm">正确</Badge>;
  if (outcome === 'wrong') return <Badge tone="danger" variant="soft" size="sm">错误</Badge>;
  return <Badge tone="info" variant="soft" size="sm">部分正确</Badge>;
}

function ObjectiveQuestion({
  pid,
  question,
  answers,
  disabled,
  grade,
  verifyMode,
  savedAnswers,
  savedVersion,
  onChange,
}: {
  pid: number;
  question: ObjectiveClientQuestion;
  answers: AnswerMap;
  disabled: boolean;
  grade: QuestionGrade | null;
  verifyMode: boolean;
  savedAnswers: AnswerMap;
  savedVersion?: number;
  onChange: (key: string, value: string | string[]) => void;
}) {
  const current = answers[question.key];
  let control: ReactElement;
  if (question.kind === 'single' && !question.choices?.length) {
    control = <LegacyChoiceInput kind="single" value={current ?? ''} disabled={disabled} onChange={(next) => onChange(question.key, next)} />;
  } else if (question.kind === 'single') {
    control = (
      <div className={question.presentation === 'truefalse' ? 'max-w-xl [&_[role=radiogroup]]:grid! [&_[role=radiogroup]]:grid-cols-2 [&_[role=radiogroup]]:gap-3!' : undefined}>
        <SingleChoiceRenderer
          name={`ws-${pid}-${question.key}`}
          value={asChoice(current)}
          options={question.choices ?? []}
          disabled={disabled}
          onChange={(next) => onChange(question.key, next)}
        />
      </div>
    );
  } else if (question.kind === 'multi' && !question.choices?.length) {
    control = <LegacyChoiceInput kind="multi" value={current ?? []} disabled={disabled} onChange={(next) => onChange(question.key, next)} />;
  } else if (question.kind === 'multi') {
    control = (
      <MultiChoiceRenderer
        value={asList(current)}
        options={question.choices ?? []}
        disabled={disabled}
        onChange={(next) => onChange(question.key, next)}
      />
    );
  } else if (question.kind === 'blank') {
    control = <BlankRenderer value={asText(current)} disabled={disabled} onChange={(next) => onChange(question.key, next)} />;
  } else if (question.kind === 'fill_program') {
    control = <FillProgramRenderer value={asText(current)} disabled={disabled} onChange={(next) => onChange(question.key, next)} />;
  } else if (question.kind === 'subjective') {
    control = (
      <WorkspaceSubjectiveEditor
        value={asText(current)}
        disabled={disabled}
        savedValue={asText(savedAnswers[question.key])}
        savedVersion={savedVersion}
        onChange={(next) => onChange(question.key, next)}
      />
    );
  } else {
    control = (
      <Alert tone="danger">
        <span className="block min-w-0 break-words">{`未知题型 ${question.kind}，不能作答。`}</span>
      </Alert>
    );
  }
  return (
    <div className="flex min-w-0 flex-col gap-3">
      {question.prompt ? <MarkdownView content={question.prompt} className="min-w-0" /> : null}
      {control}
      {verifyMode && question.kind === 'subjective' ? <p className="text-sm text-fg-muted">{SUBJECTIVE_NOTE}</p> : null}
      {grade ? (
        <div className="flex flex-wrap items-center gap-2">
          {outcomeBadge(grade.outcome)}
          <Badge variant="outline" size="sm">
            <span className="tabular">{`得分 ${grade.score}`}</span>
          </Badge>
        </div>
      ) : null}
    </div>
  );
}

function officialItem(item: WsItem, draft: WsDraft | undefined): WsItem {
  if (draft?.version === undefined) return item;
  const results = Object.values(draft.judgeResult ?? {});
  const state = results.length > 0
    ? results.every((value) => value === 'correct') ? 'correct' : results.every((value) => value === 'wrong') ? 'wrong' : 'partial'
    : Object.keys(draft.answers ?? {}).length > 0 ? 'submitted' : 'empty';
  return { ...item, state, lastScore: item.feedback?.score === false ? null : draft.score ?? null };
}

function verdictBadge(item: WsItem, verdictVisible: boolean): ReactElement | null {
  if (!verdictVisible) return null;
  if (item.state === 'correct' || item.state === 'wrong' || item.state === 'partial') return outcomeBadge(item.state);
  return null;
}

function ProblemBlock({
  ws,
  item,
  problem,
  answers,
  disabled,
  saving,
  error,
  flagged,
  hideVerdict,
  verifyMode,
  questionGrades,
  author,
  savedAnswers,
  savedVersion,
  onChange,
  onToggleFlag,
}: {
  ws: SetWorkspace;
  item: WsItem;
  problem: WorkspaceProblem;
  answers: AnswerMap;
  disabled: boolean;
  saving: boolean;
  error: string | null;
  flagged: boolean;
  hideVerdict: boolean;
  verifyMode: boolean;
  questionGrades: ReadonlyMap<string, QuestionGrade> | undefined;
  author: string | null;
  savedAnswers: AnswerMap;
  savedVersion?: number;
  onChange: (key: string, value: string | string[]) => void;
  onToggleFlag: () => void;
}) {
  const questions = problem.questions;
  if (!questions) throw new TypeError(`workspace problem ${item.pid} has no objective questions`);
  const edited = !verifyMode && hideVerdict && item.submits > 0;
  const concealed = !verifyMode && (item.feedback ? !item.feedback.verdict : !ws.objectiveVerdictVisible && !homeworkKindRevealsVerdict(item.kind));
  const answered = Object.values(answers).some((value) => Array.isArray(value) ? value.length > 0 : value !== '');
  return (
    <article id={`q-${item.label}`} className="scroll-mt-12 border-b border-line-subtle px-4 py-5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-sm font-semibold text-fg">{item.label}</span>
        <Badge variant="outline" size="sm">{item.excluded ? '已剔除' : `分数 ${item.score}`}</Badge>
        {ws.rules?.showDifficulty && typeof problem.raw.difficulty === 'number' ? <Difficulty level={problem.raw.difficulty} /> : null}
        {concealed && (answered || item.state !== 'empty') ? <Badge variant="soft" size="sm">待评测</Badge> : null}
        {concealed || hideVerdict || verifyMode ? null : verdictBadge(item, ws.verdictVisible)}
        {edited ? <Badge tone="warning" variant="soft" size="sm">已修改，未保存</Badge> : null}
        {!hideVerdict && !verifyMode && item.lastScore !== null ? <Badge variant="outline" size="sm">得分 {item.lastScore}</Badge> : null}
        {saving ? <Spinner className="size-3.5 text-fg-muted" aria-label="正在保存答案" /> : null}
        <div className="ml-auto flex items-center gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onToggleFlag}>
            <Flag aria-hidden="true" />
            {flagged ? '已标记' : '标记'}
          </Button>
          {author ? <span className="text-xs text-fg-subtle">作者 {author}</span> : null}
        </div>
      </div>
      {problem.content ? <MarkdownView content={problem.content} className="mt-3 min-w-0" /> : null}
      <div className="mt-3 flex flex-col gap-4">
        {questions.map((question) => (
          <ObjectiveQuestion
            key={`${ws.tid}:${ws.officialRound?.id ?? 'legacy'}:${question.key}`}
            pid={item.pid}
            question={question}
            answers={answers}
            disabled={disabled}
            grade={verifyMode && question.kind !== 'subjective' ? questionGrades?.get(question.key) ?? null : null}
            verifyMode={verifyMode}
            savedAnswers={savedAnswers}
            savedVersion={savedVersion}
            onChange={onChange}
          />
        ))}
      </div>
      {error ? (
        <Alert tone="danger" className="mt-3">
          <span className="block min-w-0 break-words">{error}</span>
        </Alert>
      ) : null}
    </article>
  );
}

export function ObjectiveKindPage({
  ws,
  group,
  problems,
  drafts,
  onDraftsChange,
  registerFlush,
  registerObjectiveAnswers,
}: {
  ws: SetWorkspace;
  group: WsGroup;
  problems: Map<number, WorkspaceProblem>;
  drafts: DraftMap;
  onDraftsChange: (drafts: DraftMap) => void;
  registerFlush?: (flush: () => Promise<boolean>) => () => void;
  registerObjectiveAnswers?: (actions: ObjectiveAnswerActions) => () => void;
}): ReactElement {
  const bootstrap = useBootstrap();
  const now = useExamNow(bootstrap.generatedAt);
  const verifyUrl = verifyObjectiveUrl(ws);
  const readOnly = pageReadOnly(ws);
  const lockedKind = kindLocked(ws, group.kind);
  const inputsDisabled = verifyUrl === null && (readOnly || lockedKind);
  const [answers, setAnswers] = useState(() => seedAnswers(group, drafts));
  const [errors, setErrors] = useState<ReadonlyMap<number, string>>(() => new Map());
  const [questionGrades, setQuestionGrades] = useState<ReadonlyMap<number, ReadonlyMap<string, QuestionGrade>>>(() => new Map());
  const [grading, setGrading] = useState(false);
  const [savingPids, setSavingPids] = useState<ReadonlySet<number>>(() => new Set());
  const [flaggedPids, setFlaggedPids] = useState<ReadonlySet<number>>(() => {
    const flagged = new Set<number>();
    for (const item of group.items) {
      if (window.localStorage.getItem(flagKey(ws.tid, item.pid)) !== null) flagged.add(item.pid);
    }
    return flagged;
  });
  const [collapsed, setCollapsed] = useState(() => window.localStorage.getItem(columnKey(ws.tid)) === COLUMN_COLLAPSED);
  const [lockOpen, setLockOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const answersRef = useRef(answers);
  answersRef.current = answers;
  const draftsRef = useRef(drafts);
  draftsRef.current = drafts;
  const onDraftsChangeRef = useRef(onDraftsChange);
  onDraftsChangeRef.current = onDraftsChange;
  const wsRef = useRef(ws);
  wsRef.current = ws;
  const touchedKeysRef = useRef(new Map<number, Set<string>>());
  const versionsRef = useRef(new Map([...drafts].map(([pid, draft]) => [pid, draft.version ?? 0])));
  const pendingSaveRef = useRef<{ operationId: string; roundId: string; kind: ProblemKind; items: Array<{ pid: number; body: AnswerMap; baseVersion: number }> } | null>(null);
  const savedAnswersRef = useRef(new Map<number, AnswerMap>());
  const savingRef = useRef(false);
  const aliveRef = useRef(true);
  const gradeGenRef = useRef(new Map<number, number>());
  const gradingRef = useRef(false);
  const savedAnswer = (pid: number): AnswerMap => savedAnswersRef.current.get(pid) ?? storedAnswers(draftsRef.current, pid);
  const unsavedItems = () => group.items.filter((item) => !item.excluded && !sameAnswers(answersRef.current.get(item.pid) ?? {}, savedAnswer(item.pid)));
  const groupKey = `${ws.tid}:${ws.officialRound?.id ?? 'legacy'}:${group.kind}:${group.items.map((item) => item.pid).join(',')}`;
  const seededKey = useRef(groupKey);
  if (seededKey.current !== groupKey) {
    seededKey.current = groupKey;
    touchedKeysRef.current.clear();
    const seeded = new Map(group.items.map((item) => [item.pid, copyAnswers(savedAnswer(item.pid))]));
    answersRef.current = seeded;
    setAnswers(seeded);
    setErrors(new Map());
    setQuestionGrades(new Map());
    gradeGenRef.current.clear();
    gradingRef.current = false;
    setGrading(false);
    setFlaggedPids(() => {
      const flagged = new Set<number>();
      for (const item of group.items) {
        if (window.localStorage.getItem(flagKey(ws.tid, item.pid)) !== null) flagged.add(item.pid);
      }
      return flagged;
    });
  }

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  useEffect(() => {
    for (const [pid, draft] of drafts) {
      if (draft.version !== undefined) versionsRef.current.set(pid, draft.version);
    }
    setAnswers((prev) => {
      const next = new Map(prev);
      let changed = false;
      for (const item of group.items) {
        const incoming = savedAnswersRef.current.get(item.pid) ?? storedAnswers(drafts, item.pid);
        const merged = overlayTouched(incoming, prev.get(item.pid) ?? {}, touchedKeysRef.current.get(item.pid));
        const current = prev.get(item.pid) ?? {};
        if (!sameAnswers(current, merged)) {
          next.set(item.pid, merged);
          changed = true;
        }
      }
      if (changed) answersRef.current = next;
      return changed ? next : prev;
    });
  }, [drafts, group]);

  const setError = (pid: number, message: string | null) => {
    if (!aliveRef.current) return;
    setErrors((prev) => {
      const next = new Map(prev);
      if (message === null) next.delete(pid);
      else next.set(pid, message);
      return next;
    });
  };

  const saveAnswers = async (): Promise<boolean> => {
    if (savingRef.current) throw new Error(SAVE_PENDING);
    if (verifyUrl || inputsDisabled) throw new Error('当前不能保存答案。');
    if (!pendingSaveRef.current && unsavedItems().length === 0) return true;
    const url = ws.urls.saveAnswers;
    const roundId = ws.officialRound?.id;
    if (!url || !roundId) throw new Error('当前没有可保存的作答轮次，请刷新页面。');
    savingRef.current = true;
    setSubmitting(true);
    try {
      if (!pendingSaveRef.current) {
        const items = unsavedItems().map(({ pid }) => ({
          pid,
          body: copyAnswers(answersRef.current.get(pid) ?? {}),
          baseVersion: versionsRef.current.get(pid) ?? 0,
        }));
        if (items.length === 0) return true;
        validateSaveItems(items);
        pendingSaveRef.current = { operationId: createRequestId(), roundId, kind: group.kind, items };
      }
      const request = pendingSaveRef.current;
      setSavingPids(new Set(request.items.map((item) => item.pid)));
      const response = await postJson(url, request, SAVE_FALLBACK);
      const rejected = saveRejection(response);
      if (rejected !== null) {
        pendingSaveRef.current = null;
        for (const item of request.items) setError(item.pid, rejected);
        throw new Error(rejected);
      }
      const versions = savedVersions(response, request.items.map((item) => item.pid));
      const officialDrafts = Object.hasOwn(response, 'drafts') ? parseDraftList(response) : null;
      if (!aliveRef.current) return false;
      const nextDrafts = new Map(draftsRef.current);
      for (const item of request.items) {
        const version = versions.get(item.pid);
        if (version === undefined) throw new TypeError(SAVE_SHAPE);
        const official = officialDrafts?.get(item.pid);
        if (officialDrafts && (!official || official.version !== version || !official.answers)) throw new TypeError(SAVE_SHAPE);
        const accepted = official?.answers ?? item.body;
        versionsRef.current.set(item.pid, version);
        savedAnswersRef.current.set(item.pid, copyAnswers(accepted));
        if (sameAnswers(answersRef.current.get(item.pid) ?? {}, item.body)) {
          const updated = new Map(answersRef.current);
          updated.set(item.pid, copyAnswers(accepted));
          answersRef.current = updated;
          setAnswers(updated);
        }
        if (sameAnswers(answersRef.current.get(item.pid) ?? {}, accepted)) touchedKeysRef.current.delete(item.pid);
        nextDrafts.set(item.pid, official ?? { answers: copyAnswers(accepted), submittedAnswers: copyAnswers(accepted), version });
        setError(item.pid, null);
      }
      pendingSaveRef.current = null;
      draftsRef.current = nextDrafts;
      onDraftsChangeRef.current(nextDrafts);
      return unsavedItems().length === 0;
    } catch (error) {
      for (const item of pendingSaveRef.current?.items ?? []) setError(item.pid, errorText(error));
      throw error;
    } finally {
      savingRef.current = false;
      if (aliveRef.current) {
        setSavingPids(new Set());
        setSubmitting(false);
      }
    }
  };

  const discardAnswers = () => {
    if (pendingSaveRef.current) throw new Error('上次保存结果尚未确认，请先重试保存。');
    if (savingRef.current) throw new Error(SAVE_PENDING);
    touchedKeysRef.current.clear();
    const restored = new Map(group.items.map((item) => [item.pid, copyAnswers(savedAnswer(item.pid))]));
    answersRef.current = restored;
    setAnswers(restored);
    setErrors(new Map());
  };

  const hasUnsaved = () => verifyUrl === null && (savingRef.current || pendingSaveRef.current !== null || unsavedItems().length > 0);
  useEffect(() => registerObjectiveAnswers?.({ hasUnsaved, save: saveAnswers, discard: discardAnswers }));
  useEffect(() => registerFlush?.(async () => !hasUnsaved()));

  const onSave = () => {
    void saveAnswers().catch((error: unknown) => toast.error(errorText(error)));
  };

  const updateAnswer = (pid: number, key: string, value: string | string[]) => {
    if (inputsDisabled || (submitting && !savingRef.current)) return;
    const current = copyAnswers(answersRef.current.get(pid) ?? {});
    current[key] = value;
    const next = new Map(answersRef.current);
    next.set(pid, current);
    answersRef.current = next;
    const touched = touchedKeysRef.current.get(pid) ?? new Set<string>();
    touched.add(key);
    touchedKeysRef.current.set(pid, touched);
    setAnswers(next);
    if (verifyObjectiveUrl(wsRef.current)) {
      gradeGenRef.current.set(pid, (gradeGenRef.current.get(pid) ?? 0) + 1);
      setQuestionGrades((prev) => {
        if (!prev.has(pid)) return prev;
        const nextGrades = new Map(prev);
        nextGrades.delete(pid);
        return nextGrades;
      });
      setError(pid, null);
    }
  };

  const gradeAnswered = () => {
    const url = verifyObjectiveUrl(wsRef.current);
    if (!url || gradingRef.current) return;
    const jobs: Array<{ pid: number; answers: AnswerMap; gen: number }> = [];
    for (const item of group.items) {
      const current = copyAnswers(answersRef.current.get(item.pid) ?? {});
      if (!problemAnswered(current)) continue;
      const gen = (gradeGenRef.current.get(item.pid) ?? 0) + 1;
      gradeGenRef.current.set(item.pid, gen);
      jobs.push({ pid: item.pid, answers: current, gen });
    }
    if (jobs.length === 0) return;
    gradingRef.current = true;
    setGrading(true);
    void Promise.all(jobs.map(async (job) => {
      try {
        const body = await postForm(url, new URLSearchParams({
          pid: String(job.pid),
          answers: JSON.stringify(job.answers),
        }), GRADE_FALLBACK);
        if (!aliveRef.current || gradeGenRef.current.get(job.pid) !== job.gen) return;
        const parsed = parseVerifyGrade(body);
        if (!aliveRef.current || gradeGenRef.current.get(job.pid) !== job.gen) return;
        setQuestionGrades((prev) => {
          const nextGrades = new Map(prev);
          nextGrades.set(job.pid, parsed);
          return nextGrades;
        });
        setError(job.pid, null);
      } catch (error) {
        if (!aliveRef.current || gradeGenRef.current.get(job.pid) !== job.gen) return;
        setQuestionGrades((prev) => {
          if (!prev.has(job.pid)) return prev;
          const nextGrades = new Map(prev);
          nextGrades.delete(job.pid);
          return nextGrades;
        });
        setError(job.pid, errorText(error));
      }
    })).finally(() => {
      gradingRef.current = false;
      if (aliveRef.current) setGrading(false);
    });
  };

  const toggleFlag = (pid: number) => {
    const key = flagKey(ws.tid, pid);
    const nextFlagged = window.localStorage.getItem(key) === null;
    writeStorage(key, nextFlagged ? FLAG_MARK : null);
    setFlaggedPids((prev) => {
      const next = new Set(prev);
      if (nextFlagged) next.add(pid);
      else next.delete(pid);
      return next;
    });
  };

  const toggleColumn = () => {
    const key = columnKey(ws.tid);
    const nextCollapsed = window.localStorage.getItem(key) !== COLUMN_COLLAPSED;
    writeStorage(key, nextCollapsed ? COLUMN_COLLAPSED : null);
    setCollapsed(nextCollapsed);
  };

  const pending = Math.max(unsavedItems().length, pendingSaveRef.current?.items.length ?? 0);
  const answered = group.items.filter((item) => problemAnswered(answers.get(item.pid))).length;
  const lockKind = paperLockKind(group.kind);
  const canLock = ws.kind === 'paper' && ws.paper?.submitByKind === true && lockKind !== null && !lockedKind;

  const runConfirmed = async () => {
    try {
      if (!await saveAnswers()) {
        toast.info(SAVE_HAS_NEW_EDITS);
        return;
      }
      setSubmitting(true);
      if (!lockKind) throw new TypeError(`kind ${group.kind} cannot be locked`);
      const url = ws.urls.lockKind;
      if (!url) throw new TypeError('lockKind is missing');
      await postForm(url, new URLSearchParams({ kind: lockKind }), '提交本题型失败。');
      window.location.reload();
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      if (aliveRef.current) setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-line-subtle bg-surface px-3 py-2">
          <Button type="button" variant="ghost" size="sm" iconOnly aria-label="收起或展开题目总览" onClick={toggleColumn}>
            {collapsed ? <PanelLeftOpen aria-hidden="true" /> : <PanelLeftClose aria-hidden="true" />}
          </Button>
          <span className="text-sm font-semibold text-fg">{group.name}</span>
          <span className="text-xs text-fg-muted">{scoreSummary(group)}</span>
        </div>
        {group.items.map((item) => {
          const problem = requireProblem(problems, item.pid);
          return (
            <ProblemBlock
              key={item.pid}
              ws={ws}
              item={officialItem(item, drafts.get(item.pid))}
              problem={problem}
              answers={answers.get(item.pid) ?? {}}
              disabled={item.excluded === true || inputsDisabled || (submitting && !savingRef.current)}
              saving={savingPids.has(item.pid)}
              error={errors.get(item.pid) ?? null}
              flagged={flaggedPids.has(item.pid)}
              hideVerdict={!sameAnswers(answers.get(item.pid) ?? {}, savedAnswer(item.pid))}
              verifyMode={verifyUrl !== null}
              questionGrades={questionGrades.get(item.pid)}
              author={ownerName(problem.raw, bootstrap.udict)}
              savedAnswers={savedAnswer(item.pid)}
              savedVersion={versionsRef.current.get(item.pid)}
              onChange={(key, value) => updateAnswer(item.pid, key, value)}
              onToggleFlag={() => toggleFlag(item.pid)}
            />
          );
        })}
      </div>
      {verifyUrl ? (
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-line bg-surface px-4 py-2 text-sm">
          <p className="min-w-0 text-fg-muted tabular">{`已作答 ${answered} / ${group.items.length}`}</p>
          <Button
            type="button"
            variant="primary"
            size="sm"
            disabled={answered === 0 || grading}
            onClick={gradeAnswered}
          >
            {`判分（${answered} 道）`}
          </Button>
        </div>
      ) : readOnly ? (
        <div className="flex shrink-0 items-center justify-center border-t border-line bg-surface px-4 py-2 text-sm text-fg-subtle">
          {readOnlyNote(ws, now)}
        </div>
      ) : ws.kind === 'homework' ? (
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-line bg-surface px-4 py-2 text-sm">
          <p className="min-w-0 text-fg-muted">
            {`已作答 ${answered} / ${group.items.length}${pending > 0 ? ` · 还有 ${pending} 道题的修改未保存` : ''}`}
          </p>
          <Button
            type="button"
            variant="primary"
            size="sm"
            disabled={pending === 0 || submitting || inputsDisabled}
            onClick={onSave}
          >
            {pending > 0 ? `保存本题型答案（${pending} 道）` : '保存本题型答案'}
          </Button>
        </div>
      ) : (
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-line bg-surface px-4 py-2 text-sm">
          <p className="min-w-0 text-fg-muted">{`已作答 ${ws.totals.answered} / ${ws.totals.problemCount}${pending > 0 ? ` · 还有 ${pending} 道题的修改未保存` : ''}`}</p>
          <Button
            type="button"
            variant="primary"
            size="sm"
            disabled={pending === 0 || submitting || inputsDisabled}
            onClick={onSave}
          >
            {pending > 0 ? `保存本题型答案（${pending} 道）` : '保存本题型答案'}
          </Button>
          {canLock ? (
            <Button type="button" variant="secondary" size="sm" disabled={submitting} onClick={() => setLockOpen(true)}>
              {`提交${group.name}`}
            </Button>
          ) : (
            ws.action.canFinalize ? <span className="text-fg-subtle">{CORNER_NOTE}</span> : null
          )}
        </div>
      )}
      <Dialog open={lockOpen} onOpenChange={(open) => { if (!submitting) setLockOpen(open); }}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>{`提交${group.name}？`}</DialogTitle>
            <DialogDescription>
              {LOCK_NOTE}
              {lockKind === 'single' ? SINGLE_LOCK_NOTE : null}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="secondary" disabled={submitting} onClick={() => setLockOpen(false)}>
              取消
            </Button>
            <Button
              type="button"
              variant="primary"
              disabled={submitting}
              onClick={() => {
                setLockOpen(false);
                void runConfirmed();
              }}
            >
              提交
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
