import { Archive, ArrowLeft, CheckCircle2, CircleDot, ListChecks, Plus, Save, TextCursorInput, Trash2 } from 'lucide-react';
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
import { Checkbox } from '@/components/ui/checkbox';
import { confirmFormSubmit } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Page, PageHeader } from '@/components/ui/page';
import { RadioGroupItem } from '@/components/ui/radio-group';
import { Textarea } from '@/components/ui/textarea';
import { useBootstrap } from '@/lib/bootstrap';
import { readAntiAiMarkerDrafts, serializeAntiAiMarkerInput, type AntiAiMarkerDraft } from '@/lib/anti-ai-marker';
import { cn } from '@/lib/cn';
import { fetchHydroResponse, readHydroResponseError } from '@/lib/error-presenter';
import { readProblemSaveSuccess } from '@/lib/problem-save-response';

interface ObjectiveProblemDocument extends StructuredProblemMetadataDocument {
  antiAiMarkers?: unknown;
  archivedAt?: unknown;
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
  problemAuthoringCapabilities?: { canArchive?: boolean };
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
  const persistedAntiAiMarkers = readAntiAiMarkerDrafts(pdoc.antiAiMarkers);
  const [antiAiMarkers, setAntiAiMarkers] = useState<AntiAiMarkerDraft[]>(() => persistedAntiAiMarkers);
  const locked = !!pdoc.structureLockedAt;
  const canArchive = !isCreate && data.problemAuthoringCapabilities?.canArchive === true && !pdoc.archivedAt;
  const configKey = JSON.stringify({ config, antiAiMarkers });
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
    const contentChanged = !isCreate && String(formData.get('content') || '') !== String(pdoc.content || '');
    const markerChanged = JSON.stringify(antiAiMarkers) !== JSON.stringify(persistedAntiAiMarkers);
    if (!isCreate && (markerChanged || (contentChanged && persistedAntiAiMarkers.length > 0))) {
      try {
        formData.set('antiAiMarkers', JSON.stringify(serializeAntiAiMarkerInput(antiAiMarkers)));
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : '防 AI 标记无法保存');
        return;
      }
    }
    const statementChanged = !isCreate && (markerChanged || contentChanged);
    const confirmation = statementChanged ? await statementGuard.confirm('保存题面勘误', 'statement-edit') : true;
    if (!confirmation) {
      setError('此题正在比赛或考试中使用，当前角色不能修改题面。');
      return;
    }
    if (typeof confirmation === 'string') formData.set('activeContainerConfirmation', confirmation);
    setSaving(true);
    try {
      const response = await fetchHydroResponse(form.action || window.location.pathname, {
        method: 'POST',
        body: new URLSearchParams(Array.from(formData, ([key, value]) => [key, String(value)])),
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) {
        throw new Error(
          await readHydroResponseError(response, response.status === 409 ? '题目已被其他操作修改，或正在比赛/考试中使用；请重新载入' : '保存失败'),
        );
      }
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
    <main className="w-full min-w-0">
      <Page width="form">
      <PageHeader
        title={isCreate ? `新建${meta.label}` : `编辑 ${pdoc.title || meta.label}`}
        description={(
          <span className="inline-flex items-center gap-1.5">
            <Icon className="size-3.5 shrink-0 text-fg-subtle" aria-hidden="true" />
            单题编辑器
          </span>
        )}
        actions={(
          <>
            <Button asChild variant="ghost" size="sm" iconOnly>
              <a href={isCreate ? '/problem/create' : `/p/${pid}`} aria-label="返回">
                <ArrowLeft />
              </a>
            </Button>
            <Button type="submit" form="basic-objective-form" variant="primary" disabled={saving}>
              <Save />
              {saving ? '保存中…' : '保存'}
            </Button>
          </>
        )}
      />

      {locked ? (
        <p className="border-y border-warning-line bg-warning-soft px-3 py-3 text-sm text-warning-fg">
          该题已有提交：题面勘误仍可保存，答案与评测结构保持锁定；结构调整请克隆新题。
        </p>
      ) : null}
      {statementGuard.notice}
      {error ? (
        <p role="alert" className="break-words border-y border-danger-line bg-danger-soft px-3 py-3 text-sm text-danger-fg">
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
        className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,18rem)]"
      >
        <input type="hidden" name="editorProblemKind" value={kind} />
        <input type="hidden" name="structuredConfig" value={JSON.stringify(config)} />
        {!isCreate ? <input type="hidden" name="expectedStructureRevision" value={String(pdoc.structureRevision ?? 0)} /> : null}

        <div className="min-w-0 space-y-6">
          <section className="space-y-4" aria-labelledby="objective-statement-title">
            <div>
              <h2 id="objective-statement-title" className="text-sm font-semibold">
                题面
              </h2>
              <p className="mt-0.5 text-xs text-fg-subtle">题面只保存在 content，不在选项配置中重复。</p>
            </div>
            <MarkdownEditor
              name="content"
              value={pdoc.content || ''}
              minHeight={300}
              antiAiPath={isCreate ? undefined : 'content'}
              antiAiMarkers={antiAiMarkers}
              onAntiAiMarkersChange={isCreate ? undefined : setAntiAiMarkers}
            />
          </section>

          <fieldset
            disabled={locked}
            className={cn('space-y-4 border-t border-line pt-5', locked && 'disabled:opacity-45')}
            aria-labelledby="objective-answer-title"
          >
            <div>
              <h2 id="objective-answer-title" className="text-sm font-semibold">
                答案设置
              </h2>
              <p className="mt-0.5 text-xs text-fg-subtle">学生端不会收到标准答案或部分分配置。</p>
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
      {!isCreate && canArchive ? (
        <form
          method="post"
          action={String(bs.urls.problems || '/p')}
          className="rounded-lg border border-warning-line bg-warning-soft p-4"
          onSubmit={(event) => {
            void confirmFormSubmit(
              event,
              `归档题目「${pdoc.title || pid}」？归档后将强制隐藏。`,
              { destructive: true },
            );
          }}
        >
          <input type="hidden" name="operation" value="archive" />
          <input type="hidden" name="pid" value={String(pdoc.docId)} />
          <input type="hidden" name="reason" value="Archived from objective editor" />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold">归档题目</h3>
              <p className="mt-1 text-xs text-fg-subtle">归档后强制隐藏。可从题库归档列表继续查看。</p>
            </div>
            <Button type="submit" variant="danger-soft" size="sm">
              <Archive />
              归档
            </Button>
          </div>
        </form>
      ) : null}
      {statementGuard.dialog}
      {navigationGuard.guardDialog}
      </Page>
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
        <div key={index} className="flex min-h-12 min-w-0 items-center gap-2">
          {single ? (
            <RadioGroupItem
              checked={selected.has(index)}
              onChange={() => toggle(index)}
              aria-label={`将选项 ${String.fromCharCode(65 + index)} 设为正确答案`}
              wrapperClassName="size-10 shrink-0 items-center justify-center rounded-md border border-line"
            />
          ) : (
            <label className="flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-md border border-line">
              <Checkbox
                checked={selected.has(index)}
                onCheckedChange={() => toggle(index)}
                aria-label={`将选项 ${String.fromCharCode(65 + index)} 设为正确答案`}
              />
            </label>
          )}
          <span className="w-6 shrink-0 text-center font-mono text-xs text-fg-subtle">{String.fromCharCode(65 + index)}</span>
          <Input
            value={option}
            onChange={(event) => setOptions(options.map((value, i) => (i === index ? event.target.value : value)))}
            placeholder={`选项 ${String.fromCharCode(65 + index)}`}
            className="min-w-0 flex-1"
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            iconOnly
            disabled={options.length <= 2}
            onClick={() =>
              setOptions(
                options.filter((_, i) => i !== index),
                index,
              )
            }
            aria-label={`删除选项 ${String.fromCharCode(65 + index)}`}
          >
            <Trash2 />
          </Button>
        </div>
      ))}
      <Button type="button" variant="secondary" disabled={options.length >= 26} onClick={() => setOptions([...options, ''])}>
        <Plus />
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
      <label className="block max-w-xs space-y-1.5 border-t border-line pt-4">
        <span className="text-xs font-medium">正确真子集得分比例</span>
        <Input
          type="number"
          min={0}
          max={100}
          step={1}
          value={partialCreditPercent}
          onChange={(event) => setPartialCreditPercent(Number(event.target.value))}
        />
        <span className="block text-2xs text-fg-subtle">全对 100；只选中正确项真子集时得此比例；任一错项即 0。</span>
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
          <RadioGroupItem
            key={String(option.value)}
            checked={answer === option.value}
            onChange={() => setAnswer(option.value)}
            label={option.label}
            wrapperClassName={cn(
              'min-h-12 w-full items-center rounded-md border px-3 py-2',
              answer === option.value ? 'border-brand bg-brand-soft/60' : 'border-line',
            )}
          />
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
        <Textarea value={answer} onChange={(event) => setAnswer(event.target.value)} rows={5} />
        <span className="block text-2xs text-fg-subtle">判分前仅统一 CRLF 为 LF 并去除首尾空白；大小写敏感。</span>
      </label>
    </ObjectiveEditorShell>
  );
}
