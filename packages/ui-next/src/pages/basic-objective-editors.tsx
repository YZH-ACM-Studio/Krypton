import { ArrowLeft, CheckCircle2, CircleDot, ListChecks, Plus, Save, TextCursorInput, Trash2 } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { BASIC_OBJECTIVE_KIND, type BasicObjectiveKind } from '@hydrooj/common';
import { MarkdownEditor } from '@/components/markdown-renderer';
import { type ProblemDataWriteGuardState, useProblemDataWriteGuard } from '@/components/problem-data-write-guard';
import {
  StructuredProblemMetadataPanel,
  type KnowledgeMapOption,
  type KnowledgeMindmapOption,
  type StructuredProblemMetadataDocument,
} from '@/components/structured-problem-metadata-panel';
import { useFormDirtyState, useUnsavedChangesGuard } from '@/components/unsaved-changes-guard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useBootstrap } from '@/lib/bootstrap';
import { cn } from '@/lib/cn';
import { readProblemSaveSuccess } from '@/lib/problem-save-response';

interface ObjectiveProblemDocument extends StructuredProblemMetadataDocument {
  content?: string;
  structureLockedAt?: string | Date;
  structureRevision?: number;
}

interface StoredObjectiveMain {
  options?: string[];
  answerIndex?: unknown;
  answerIndexes?: number[];
  partialCreditPercent?: unknown;
  answer?: boolean | string;
}

interface ObjectiveEditorPageData {
  page_name?: string;
  pdoc?: ObjectiveProblemDocument;
  statementWriteGuard?: ProblemDataWriteGuardState;
  knowledgeMaps?: KnowledgeMapOption[];
  knowledgeMindmapOptions?: KnowledgeMindmapOption[];
  canUseCustomPid?: boolean;
  structuredConfig?: { main?: StoredObjectiveMain };
}

interface ObjectiveEditorConfig {
  main: Record<string, unknown>;
}

const KIND_META: Record<BasicObjectiveKind, { label: string; icon: typeof CircleDot }> = {
  [BASIC_OBJECTIVE_KIND.single]: { label: '单选题', icon: CircleDot },
  [BASIC_OBJECTIVE_KIND.multi]: { label: '多选题', icon: ListChecks },
  [BASIC_OBJECTIVE_KIND.trueFalse]: { label: '判断题', icon: CheckCircle2 },
  [BASIC_OBJECTIVE_KIND.blank]: { label: '填空题', icon: TextCursorInput },
};

async function responseMessage(response: Response): Promise<string> {
  if (response.status === 409) return '题目已被其他操作修改，或正在比赛/考试中使用；请重新载入。';
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    const body = await response.json();
    const message = body?.error?.message || body?.message || body?.error;
    if (typeof message === 'string' && message.trim()) return message;
  }
  return `保存失败（${response.status} ${response.statusText || 'Unknown Error'}）`;
}

function validateOptions(options: string[]): string {
  const normalized = options.map((option) => option.trim());
  if (normalized.length < 2) return '至少需要两个选项。';
  if (normalized.some((option) => !option)) return '选项不能为空。';
  if (new Set(normalized).size !== normalized.length) return '选项内容不能重复。';
  return '';
}

function ObjectiveEditorShell({
  kind,
  config,
  validationError,
  children,
}: {
  kind: BasicObjectiveKind;
  config: ObjectiveEditorConfig;
  validationError: string;
  children: React.ReactNode;
}) {
  const bs = useBootstrap();
  const data = bs.page.data as ObjectiveEditorPageData;
  const pdoc = data.pdoc || {};
  const isCreate = String(data.page_name || '').startsWith('problem_create_');
  const pid = String(pdoc.pid || pdoc.docId || '');
  const meta = KIND_META[kind];
  const Icon = meta.icon;
  const formRef = useRef<HTMLFormElement>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const locked = !!pdoc.structureLockedAt;
  const configKey = JSON.stringify(config);
  const dirtyState = useFormDirtyState(formRef, configKey);
  const navigationGuard = useUnsavedChangesGuard(dirtyState.dirty || saving);
  const statementGuard = useProblemDataWriteGuard(data.statementWriteGuard, 'statement');

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    if (!locked && validationError) {
      setError(validationError);
      return;
    }
    const form = event.currentTarget;
    const submittedSnapshot = dirtyState.snapshot();
    if (submittedSnapshot === null) {
      setError('无法读取当前表单，未发送保存请求。');
      return;
    }
    const formData = new FormData(form);
    const statementChanged = !isCreate && String(formData.get('content') || '') !== String(pdoc.content || '');
    const confirmation = statementChanged ? await statementGuard.confirm('保存题面勘误', 'statement-edit') : true;
    if (!confirmation) {
      setError('此题正在比赛或考试中使用，当前角色不能修改题面。');
      return;
    }
    if (typeof confirmation === 'string') formData.set('activeContainerConfirmation', confirmation);
    setSaving(true);
    try {
      const response = await fetch(form.action || window.location.pathname, {
        method: 'POST',
        body: new URLSearchParams(Array.from(formData, ([key, value]) => [key, String(value)])),
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) throw new Error(await responseMessage(response));
      const { destination } = await readProblemSaveSuccess(response, kind);
      if (dirtyState.snapshot() !== submittedSnapshot) {
        console.warn('Objective problem saved, but local form changed during request; navigation withheld', { destination });
        setError('服务器已保存提交时的版本，但保存过程中检测到新的本地修改；为避免丢失，未自动跳转。');
        setSaving(false);
        dirtyState.recompute();
        return;
      }
      dirtyState.markClean();
      navigationGuard.allowNavigation();
      window.location.assign(destination);
    } catch (caught) {
      const message = (caught as { message?: unknown } | null)?.message;
      setError(typeof message === 'string' && message ? message : '保存失败');
      setSaving(false);
    }
  };

  return (
    <main className="w-full min-w-0 space-y-5 pb-10">
      <header className="flex flex-wrap items-center gap-3 border-b border-border/70 pb-4">
        <Button asChild variant="ghost" size="icon" className="size-11">
          <a href={isCreate ? '/problem/create' : `/p/${pid}`} aria-label="返回">
            <ArrowLeft className="size-4" />
          </a>
        </Button>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Icon className="size-3.5" />
            单题编辑器
          </p>
          <h1 className="mt-0.5 truncate text-2xl font-semibold tracking-tight">
            {isCreate ? `新建${meta.label}` : `编辑 ${pdoc.title || meta.label}`}
          </h1>
        </div>
        <Button type="submit" form="basic-objective-form" className="min-h-11 gap-1.5" disabled={saving}>
          <Save className="size-4" />
          {saving ? '保存中…' : '保存'}
        </Button>
      </header>

      {locked ? (
        <p
          role="alert"
          className={cn(
            'border-y border-amber-300 bg-amber-50 px-3 py-3 text-sm text-amber-900',
            'dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200',
          )}
        >
          该题已有提交：题面勘误仍可保存，答案与评测结构保持锁定；结构调整请克隆新题。
        </p>
      ) : null}
      {statementGuard.notice}
      {error ? (
        <p role="alert" className="border-y border-destructive/40 bg-destructive/5 px-3 py-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <form
        ref={formRef}
        id="basic-objective-form"
        method="post"
        onSubmit={submit}
        onChange={dirtyState.recompute}
        inert={saving}
        aria-busy={saving}
        className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]"
      >
        <input type="hidden" name="editorProblemKind" value={kind} />
        <input type="hidden" name="structuredConfig" value={JSON.stringify(config)} />
        {!isCreate ? <input type="hidden" name="expectedStructureRevision" value={String(pdoc.structureRevision || '')} /> : null}

        <div className="min-w-0 space-y-6">
          <section className="space-y-4" aria-labelledby="objective-statement-title">
            <div>
              <h2 id="objective-statement-title" className="text-sm font-semibold">
                题面
              </h2>
              <p className="mt-0.5 text-xs text-muted-foreground">题面只保存在 content，不在选项配置中重复。</p>
            </div>
            <MarkdownEditor name="content" value={pdoc.content || ''} minHeight={300} />
          </section>

          <fieldset
            disabled={locked}
            className={cn('space-y-4 border-t border-border/70 pt-5', locked && 'opacity-60')}
            aria-labelledby="objective-answer-title"
          >
            <div>
              <h2 id="objective-answer-title" className="text-sm font-semibold">
                答案设置
              </h2>
              <p className="mt-0.5 text-xs text-muted-foreground">学生端不会收到标准答案或部分分配置。</p>
            </div>
            {children}
          </fieldset>
        </div>

        <StructuredProblemMetadataPanel
          pdoc={pdoc}
          isCreate={isCreate}
          locked={locked}
          knowledgeMaps={data.knowledgeMaps || []}
          mindmapOptions={data.knowledgeMindmapOptions || []}
          canUseCustomPid={data.canUseCustomPid === true}
          formDirty={dirtyState.dirty}
          onMetadataChange={dirtyState.recompute}
        />
      </form>
      {statementGuard.dialog}
      {navigationGuard.guardDialog}
    </main>
  );
}

function ChoiceRows({
  options,
  setOptions,
  selected,
  toggle,
  single,
}: {
  options: string[];
  setOptions: (next: string[], removedIndex?: number) => void;
  selected: Set<number>;
  toggle: (index: number) => void;
  single: boolean;
}) {
  return (
    <div className="space-y-2">
      {options.map((option, index) => (
        <div key={index} className="flex min-h-11 items-center gap-2">
          <label className="flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-md border border-border/70">
            <input
              type={single ? 'radio' : 'checkbox'}
              checked={selected.has(index)}
              onChange={() => toggle(index)}
              className="size-4 accent-primary"
              aria-label={`将选项 ${String.fromCharCode(65 + index)} 设为正确答案`}
            />
          </label>
          <span className="w-6 text-center font-mono text-xs text-muted-foreground">{String.fromCharCode(65 + index)}</span>
          <Input
            value={option}
            onChange={(event) => setOptions(options.map((value, i) => (i === index ? event.target.value : value)))}
            placeholder={`选项 ${String.fromCharCode(65 + index)}`}
            className="min-h-11 flex-1"
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-11 text-destructive"
            disabled={options.length <= 2}
            onClick={() =>
              setOptions(
                options.filter((_, i) => i !== index),
                index,
              )
            }
            aria-label={`删除选项 ${String.fromCharCode(65 + index)}`}
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        className="min-h-11 gap-1.5"
        disabled={options.length >= 26}
        onClick={() => setOptions([...options, ''])}
      >
        <Plus className="size-4" />
        添加选项
      </Button>
    </div>
  );
}

export function SingleProblemEditorPage() {
  const data = useBootstrap().page.data as ObjectiveEditorPageData;
  const main = data.structuredConfig?.main || {};
  const [options, setOptions] = useState<string[]>(main.options || ['', '']);
  const [answerIndex, setAnswerIndex] = useState<number>(Number(main.answerIndex) || 0);
  const safeAnswerIndex = Math.min(answerIndex, Math.max(0, options.length - 1));
  const config = useMemo(() => ({ main: { options, answerIndex: safeAnswerIndex } }), [options, safeAnswerIndex]);
  return (
    <ObjectiveEditorShell kind={BASIC_OBJECTIVE_KIND.single} config={config} validationError={validateOptions(options)}>
      <ChoiceRows
        options={options}
        setOptions={(next, removedIndex) => {
          setOptions(next);
          if (removedIndex === undefined) return;
          if (removedIndex < safeAnswerIndex) setAnswerIndex(safeAnswerIndex - 1);
          else if (removedIndex === safeAnswerIndex) setAnswerIndex(0);
        }}
        selected={new Set([safeAnswerIndex])}
        toggle={setAnswerIndex}
        single
      />
    </ObjectiveEditorShell>
  );
}

export function MultiProblemEditorPage() {
  const data = useBootstrap().page.data as ObjectiveEditorPageData;
  const main = data.structuredConfig?.main || {};
  const [options, setOptions] = useState<string[]>(main.options || ['', '']);
  const [answerIndexes, setAnswerIndexes] = useState<Set<number>>(new Set(main.answerIndexes || [0]));
  const [partialCreditPercent, setPartialCreditPercent] = useState<number>(Number(main.partialCreditPercent) || 0);
  const config = useMemo(
    () => ({
      main: { options, answerIndexes: [...answerIndexes].sort((a, b) => a - b), partialCreditPercent },
    }),
    [answerIndexes, options, partialCreditPercent],
  );
  const validationError =
    validateOptions(options) ||
    (!answerIndexes.size ? '至少选择一个正确项。' : '') ||
    (!Number.isInteger(partialCreditPercent) || partialCreditPercent < 0 || partialCreditPercent > 100 ? '部分分比例必须是 0–100 整数。' : '');
  const updateOptions = (next: string[], removedIndex?: number) => {
    setOptions(next);
    setAnswerIndexes(
      new Set(
        [...answerIndexes].flatMap((index) => {
          if (removedIndex === undefined) return index < next.length ? [index] : [];
          if (index === removedIndex) return [];
          return [index > removedIndex ? index - 1 : index];
        }),
      ),
    );
  };
  return (
    <ObjectiveEditorShell kind={BASIC_OBJECTIVE_KIND.multi} config={config} validationError={validationError}>
      <ChoiceRows
        options={options}
        setOptions={updateOptions}
        selected={answerIndexes}
        toggle={(index) =>
          setAnswerIndexes((current) => {
            const next = new Set(current);
            if (next.has(index)) next.delete(index);
            else next.add(index);
            return next;
          })
        }
        single={false}
      />
      <label className="block max-w-xs space-y-1.5 border-t border-border/70 pt-4">
        <span className="text-xs font-medium">正确真子集得分比例</span>
        <Input
          type="number"
          min={0}
          max={100}
          step={1}
          value={partialCreditPercent}
          onChange={(event) => setPartialCreditPercent(Number(event.target.value))}
          className="min-h-11"
        />
        <span className="block text-[11px] text-muted-foreground">全对 100；只选中正确项真子集时得此比例；任一错项即 0。</span>
      </label>
    </ObjectiveEditorShell>
  );
}

export function TrueFalseProblemEditorPage() {
  const data = useBootstrap().page.data as ObjectiveEditorPageData;
  const [answer, setAnswer] = useState<boolean>(data.structuredConfig?.main?.answer !== false);
  return (
    <ObjectiveEditorShell kind={BASIC_OBJECTIVE_KIND.trueFalse} config={{ main: { answer } }} validationError="">
      <div className="grid gap-2 sm:grid-cols-2">
        {[
          { value: true, label: '正确' },
          { value: false, label: '错误' },
        ].map((option) => (
          <label
            key={String(option.value)}
            className={cn(
              'flex min-h-11 cursor-pointer items-center gap-3 rounded-md border px-3 text-sm',
              answer === option.value ? 'border-primary bg-primary/5' : 'border-border/70',
            )}
          >
            <input type="radio" checked={answer === option.value} onChange={() => setAnswer(option.value)} className="size-4 accent-primary" />
            {option.label}
          </label>
        ))}
      </div>
    </ObjectiveEditorShell>
  );
}

export function BlankProblemEditorPage() {
  const data = useBootstrap().page.data as ObjectiveEditorPageData;
  const [answer, setAnswer] = useState<string>(String(data.structuredConfig?.main?.answer || ''));
  return (
    <ObjectiveEditorShell
      kind={BASIC_OBJECTIVE_KIND.blank}
      config={{ main: { answer } }}
      validationError={answer.trim() ? '' : '可接受答案不能为空。'}
    >
      <label className="block space-y-1.5">
        <span className="text-xs font-medium">唯一可接受答案</span>
        <textarea
          value={answer}
          onChange={(event) => setAnswer(event.target.value)}
          rows={5}
          className={cn(
            'min-h-28 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none',
            'focus-visible:ring-2 focus-visible:ring-ring',
          )}
        />
        <span className="block text-[11px] text-muted-foreground">判分前仅统一 CRLF 为 LF 并去除首尾空白；大小写敏感。</span>
      </label>
    </ObjectiveEditorShell>
  );
}
