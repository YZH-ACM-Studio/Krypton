import { buildClientStructuredCodeSurface, type ClientStructuredCodeSegment } from '@hydrooj/common';
import { ArrowLeft, CheckCircle2, Copy, Eye, EyeOff, FileCode2, PencilLine, Plus, Save, Trash2 } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { MarkdownEditor } from '@/components/markdown-renderer';
import { useProblemDataWriteGuard, type ProblemDataWriteGuardState } from '@/components/problem-data-write-guard';
import { StructuredRegionAuthorEditor, type AuthorLineRange, type AuthorLineSelection } from '@/components/structured-region-author-editor';
import { StructuredRegionInputs } from '@/components/structured-region-inputs';
import { StructuredProblemMetadataPanel, type KnowledgeMapOption, type KnowledgeMindmapOption } from '@/components/structured-problem-metadata-panel';
import { useFormDirtyState, useUnsavedChangesGuard } from '@/components/unsaved-changes-guard';
import { FileUploader } from '@/components/uploader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SimpleSelect } from '@/components/ui/select';
import { useBootstrap } from '@/lib/bootstrap';
import { cn } from '@/lib/cn';
import { readProblemSaveSuccess } from '@/lib/problem-save-response';
import { sha256Text } from '@/lib/sha256';

interface StructuredEditorProblemDoc {
  pid?: string | number;
  docId?: string | number;
  title?: string;
  content?: string;
  structureLockedAt?: unknown;
  structureRevision?: number;
  codeEvaluationStatus?: string;
}
interface DraftLineRange {
  startLine?: unknown;
  endLine?: unknown;
}
interface DraftRegion extends DraftLineRange {
  id?: unknown;
  title?: unknown;
  description?: unknown;
  prompt?: unknown;
}
interface DraftCase {
  input?: unknown;
  output?: unknown;
}
interface StructuredMainDraft {
  mode?: string;
  lang?: string;
  source?: string;
  publicRanges?: DraftLineRange[];
  regions?: DraftRegion[];
  cases?: DraftCase[];
}
interface TestdataFilePayload {
  name?: unknown;
  size?: unknown;
}
interface StructuredEditorPageData {
  page_name?: string;
  pdoc?: StructuredEditorProblemDoc;
  structuredConfig?: { main?: StructuredMainDraft };
  testdata?: TestdataFilePayload[];
  langRange?: Record<string, string>;
  knowledgeMaps?: KnowledgeMapOption[];
  knowledgeMindmapOptions?: KnowledgeMindmapOption[];
  canUseCustomPid?: unknown;
  statementWriteGuard?: ProblemDataWriteGuardState;
}
interface RegionMeta {
  key: string;
  id: string;
  startLine: number;
  endLine: number;
  title: string;
  description: string;
  prompt: string;
  invalid: boolean;
}
interface PublicRangeMeta {
  key: string;
  startLine: number;
  endLine: number;
  invalid: boolean;
}
interface CaseMeta {
  input: string;
  output: string;
}
interface TestdataFile {
  name: string;
  size?: number;
}

async function responseMessage(response: Response) {
  if (response.status === 409) return '题目已被其他操作修改，或正在比赛/考试中使用；请重新载入。';
  const body = await response.json().catch(() => null);
  return body?.error?.message || body?.message || `保存失败（HTTP ${response.status}）`;
}

function validSourceRange(source: string, range: Pick<RegionMeta, 'startLine' | 'endLine'>) {
  return range.startLine >= 0 && range.endLine > range.startLine && range.endLine <= source.split('\n').length;
}

function overlaps(left: { startLine: number; endLine: number }, right: { startLine: number; endLine: number }) {
  return left.startLine < right.endLine && right.startLine < left.endLine;
}

function subtractPublicRanges(ranges: PublicRangeMeta[], removal: { startLine: number; endLine: number }): PublicRangeMeta[] {
  return ranges.flatMap((range) => {
    if (!overlaps(range, removal)) return [range];
    const next: PublicRangeMeta[] = [];
    if (range.startLine < removal.startLine) next.push({ ...range, endLine: removal.startLine });
    if (removal.endLine < range.endLine) {
      next.push({
        ...range,
        key: next.length ? `${range.key}:right:${removal.startLine}:${removal.endLine}` : range.key,
        startLine: removal.endLine,
      });
    }
    return next;
  });
}

function mergePublicRanges(ranges: PublicRangeMeta[]): PublicRangeMeta[] {
  const sorted = [...ranges].sort((a, b) => a.startLine - b.startLine || a.endLine - b.endLine);
  const result: PublicRangeMeta[] = [];
  for (const range of sorted) {
    const previous = result.at(-1);
    if (previous && !previous.invalid && !range.invalid && range.startLine <= previous.endLine) {
      previous.endLine = Math.max(previous.endLine, range.endLine);
    } else result.push({ ...range });
  }
  return result;
}

function caseFileOptions(files: TestdataFile[], current: string) {
  const options = [{ value: '', label: '选择已上传文件' }, ...files.map((file) => ({ value: file.name, label: file.name }))];
  if (current && !files.some((file) => file.name === current)) options.push({ value: current, label: `已缺失 · ${current}` });
  return options;
}

function proposeCasePairs(cases: CaseMeta[], files: TestdataFile[]): CaseMeta[] {
  const names = new Set(files.map((file) => file.name));
  const used = new Set(cases.flatMap((item) => [item.input, item.output]).filter(Boolean));
  const proposed = [...cases];
  for (const input of [...names].filter((name) => name.toLowerCase().endsWith('.in')).sort()) {
    const output = `${input.slice(0, -3)}.out`;
    if (!names.has(output) || used.has(input) || used.has(output)) continue;
    proposed.push({ input, output });
    used.add(input);
    used.add(output);
  }
  return proposed;
}

function CasesEditor({ cases, files, onChange }: { cases: CaseMeta[]; files: TestdataFile[]; onChange: (cases: CaseMeta[]) => void }) {
  return (
    <section className="space-y-3 border-t border-border/70 pt-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">测试数据映射</h2>
          <p className="text-xs text-muted-foreground">输入与输出只能从当前题真实存在的文件中选择；同 basename 的 .in/.out 会自动提出配对。</p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => onChange([...cases, { input: '', output: '' }])}>
          <Plus className="size-3.5" />
          添加测试点
        </Button>
      </div>
      {cases.map((item, index) => (
        <div key={index} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
          <SimpleSelect
            value={item.input}
            onValueChange={(value) => onChange(cases.map((row, i) => (i === index ? { ...row, input: value } : row)))}
            options={caseFileOptions(files, item.input)}
          />
          <SimpleSelect
            value={item.output}
            onValueChange={(value) => onChange(cases.map((row, i) => (i === index ? { ...row, output: value } : row)))}
            options={caseFileOptions(files, item.output)}
          />
          <Button type="button" variant="ghost" size="icon" onClick={() => onChange(cases.filter((_, i) => i !== index))} aria-label="删除测试点">
            <Trash2 className="size-4" />
          </Button>
        </div>
      ))}
      {!cases.length ? <p className="text-sm text-muted-foreground">尚未映射测试点；上传配对文件或手动添加一行。</p> : null}
      {cases.some((item) => !files.some((file) => file.name === item.input) || !files.some((file) => file.name === item.output)) ? (
        <p role="alert" className="text-sm text-destructive">
          映射中存在缺失文件，保存或完成前必须重新选择。
        </p>
      ) : null}
    </section>
  );
}

function StructuredCodeEditor({ kind }: { kind: 'program_fill' | 'function' }) {
  const bs = useBootstrap();
  const data = bs.page.data as StructuredEditorPageData;
  const pdoc: StructuredEditorProblemDoc = data.pdoc || {};
  const initial: StructuredMainDraft = data.structuredConfig?.main || {};
  const isCreate = String(data.page_name || '').startsWith('problem_create_');
  const locked = !!pdoc.structureLockedAt;
  const pid = String(pdoc.pid || pdoc.docId || '');
  const codeEvaluationDraft = pdoc.codeEvaluationStatus === 'draft';
  const [mode, setMode] = useState<'text' | 'compile'>(initial.mode === 'compile' ? 'compile' : 'text');
  const [lang, setLang] = useState(String(initial.lang || ''));
  const [source, setSource] = useState(String(initial.source || ''));
  const [publicRanges, setPublicRanges] = useState<PublicRangeMeta[]>(() =>
    Array.isArray(initial.publicRanges)
      ? initial.publicRanges.map((item: DraftLineRange, index: number) => ({
          key: `public-${index}`,
          startLine: Number(item.startLine),
          endLine: Number(item.endLine),
          invalid: !validSourceRange(String(initial.source || ''), {
            startLine: Number(item.startLine),
            endLine: Number(item.endLine),
          }),
        }))
      : [],
  );
  const [regions, setRegions] = useState<RegionMeta[]>(() => {
    if (!Array.isArray(initial.regions)) return [];
    return initial.regions
      .map((item: DraftRegion, index: number) => {
        const startLine = Number(item.startLine);
        const endLine = Number(item.endLine);
        return {
          key: String(item.id || `new-${index}`),
          id: String(item.id || ''),
          startLine,
          endLine,
          title: String(item.title || ''),
          description: String(item.description || ''),
          prompt: String(item.prompt || ''),
          invalid: !validSourceRange(String(initial.source || ''), { startLine, endLine }),
        };
      })
      .sort((a, b) => a.startLine - b.startLine || a.endLine - b.endLine || a.key.localeCompare(b.key));
  });
  const [cases, setCases] = useState<CaseMeta[]>(() =>
    Array.isArray(initial.cases) ? initial.cases.map((item: DraftCase) => ({ input: String(item.input || ''), output: String(item.output || '') })) : [],
  );
  const [testdataFiles, setTestdataFiles] = useState<TestdataFile[]>(() =>
    Array.isArray(data.testdata)
      ? data.testdata.map((file: TestdataFilePayload) => ({ name: String(file.name || ''), size: Number(file.size) || 0 })).filter((file) => file.name)
      : [],
  );
  const [structureRevision, setStructureRevision] = useState(Number(pdoc.structureRevision) || 1);
  const [saving, setSaving] = useState(false);
  const [saveAction, setSaveAction] = useState<'save' | 'complete'>('save');
  const [cloning, setCloning] = useState(false);
  const [error, setError] = useState('');
  const [selection, setSelection] = useState<AuthorLineSelection | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const compileMode = kind === 'function' || mode === 'compile';
  const draftCreation = isCreate && compileMode;
  const langOptions = Object.entries(data.langRange || {}).map(([value, label]) => ({ value, label: String(label) }));
  const cloneLangOptions = langOptions.filter((option) => option.value !== lang);
  const [cloneLang, setCloneLang] = useState('');
  const structureBlocked = regions.length === 0 || regions.some((region) => region.invalid) || publicRanges.some((range) => range.invalid);
  const completionBlocked = compileMode && structureBlocked;

  const structuredConfig = useMemo(
    () => ({
      main: draftCreation
        ? { mode: kind === 'program_fill' ? 'compile' : 'function', lang }
        : {
            mode: kind === 'program_fill' ? mode : 'function',
            lang,
            source,
            publicRanges: publicRanges.map(({ startLine, endLine }) => ({ startLine, endLine })),
            regions: regions.map((region) => ({
              id: region.id,
              startLine: region.startLine,
              endLine: region.endLine,
              ...(kind === 'function'
                ? {
                    ...(region.title ? { title: region.title } : {}),
                    ...(region.description ? { description: region.description } : {}),
                  }
                : region.prompt
                  ? { prompt: region.prompt }
                  : {}),
            })),
            ...(compileMode ? { cases } : {}),
          },
    }),
    [cases, compileMode, draftCreation, kind, lang, mode, publicRanges, regions, source],
  );
  const previewSurface = useMemo<ClientStructuredCodeSegment[]>(() => {
    if (structureBlocked) return [];
    try {
      return buildClientStructuredCodeSurface({
        source,
        publicRanges,
        regions: regions.map((region) => ({
          id: region.id || region.key,
          startLine: region.startLine,
          endLine: region.endLine,
          ...(region.title ? { title: region.title } : {}),
          ...(region.description ? { description: region.description } : {}),
          ...(region.prompt ? { prompt: region.prompt } : {}),
        })),
      });
    } catch {
      return [];
    }
  }, [publicRanges, regions, source, structureBlocked]);
  const dirtyState = useFormDirtyState(formRef, JSON.stringify(structuredConfig));
  const navigationGuard = useUnsavedChangesGuard(dirtyState.dirty || saving || cloning);
  const statementGuard = useProblemDataWriteGuard(data.statementWriteGuard, 'statement');
  const localRegionCounter = useRef(0);
  const nextLocalKey = (prefix: string) => {
    localRegionCounter.current += 1;
    return `${prefix}-${localRegionCounter.current}`;
  };

  const updateSource = (nextSource: string, mappedRanges: AuthorLineRange[]) => {
    setSource(nextSource);
    const mappedByKey = new Map(mappedRanges.map((range) => [range.key, range]));
    const nextPublic = publicRanges.map((range) => ({ ...range, ...mappedByKey.get(range.key) }));
    const nextRegions = regions.map((region) => ({ ...region, ...mappedByKey.get(region.key) }));
    const all = [...nextPublic, ...nextRegions];
    const conflicted = new Set<string>();
    for (let left = 0; left < all.length; left++) {
      for (let right = left + 1; right < all.length; right++) {
        if (overlaps(all[left], all[right])) {
          conflicted.add(all[left].key);
          conflicted.add(all[right].key);
        }
      }
    }
    setPublicRanges(nextPublic.map((range) => ({ ...range, invalid: !!range.invalid || conflicted.has(range.key) })));
    setRegions(
      nextRegions
        .map((region) => ({ ...region, invalid: !!region.invalid || conflicted.has(region.key) }))
        .sort((a, b) => a.startLine - b.startLine || a.endLine - b.endLine || a.key.localeCompare(b.key)),
    );
  };

  const requireSelection = () => {
    if (!selection) {
      setError('请先在完整模板中框选至少一行。');
      return null;
    }
    if (!validSourceRange(source, selection)) {
      setError('所选行已超出当前模板，请重新框选。');
      return null;
    }
    return selection;
  };

  const ensureNoPartialRegion = (target: AuthorLineSelection) => {
    const partial = regions.find((region) => overlaps(region, target) && (target.startLine > region.startLine || region.endLine > target.endLine));
    if (partial) {
      setError('选择只覆盖了现有作答区的一部分；请完整选择该区域，或先删除后重新标记。');
      return false;
    }
    return true;
  };

  const markPublic = () => {
    const target = requireSelection();
    if (!target || !ensureNoPartialRegion(target)) return;
    setRegions((current) => current.filter((region) => !overlaps(region, target)));
    const key = nextLocalKey('public-new');
    setPublicRanges((current) =>
      mergePublicRanges([...subtractPublicRanges(current, target), { key, startLine: target.startLine, endLine: target.endLine, invalid: false }]),
    );
    setError('');
  };

  const markAnswer = () => {
    const target = requireSelection();
    if (!target) return;
    if (kind === 'program_fill' && target.endLine !== target.startLine + 1) {
      setError('程序填空区域只能选择一整行。');
      return;
    }
    if (regions.some((region) => overlaps(region, target))) {
      setError('所选完整行与已有作答区重叠，请重新框选。');
      return;
    }
    setPublicRanges((current) => subtractPublicRanges(current, target));
    const key = nextLocalKey('new');
    setRegions((current) =>
      [
        ...current,
        {
          key,
          id: '',
          startLine: target.startLine,
          endLine: target.endLine,
          title: '',
          description: '',
          prompt: '',
          invalid: false,
        },
      ].sort((a, b) => a.startLine - b.startLine || a.endLine - b.endLine || a.key.localeCompare(b.key)),
    );
    setError('');
  };

  const markPrivate = () => {
    const target = requireSelection();
    if (!target || !ensureNoPartialRegion(target)) return;
    setPublicRanges((current) => subtractPublicRanges(current, target));
    setRegions((current) => current.filter((region) => !overlaps(region, target)));
    setError('');
  };

  const removeRegion = (index: number) => {
    setRegions((current) => current.filter((_, regionIndex) => regionIndex !== index));
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const completing = submitter?.value === 'complete';
    const submittedSnapshot = dirtyState.snapshot();
    if (submittedSnapshot === null) {
      setError('无法读取当前表单，未发送保存请求。');
      return;
    }
    setSaveAction(completing ? 'complete' : 'save');
    setSaving(true);
    setError('');
    try {
      const formData = new FormData(form);
      if (!draftCreation) {
        formData.set(
          'structuredConfig',
          JSON.stringify({
            ...structuredConfig,
            main: { ...structuredConfig.main, sourceHash: sha256Text(source.replace(/\r\n?/g, '\n')) },
          }),
        );
      }
      if (!isCreate) formData.set('expectedStructureRevision', String(structureRevision));
      if (completing) formData.set('completeCodeEvaluationDraft', 'true');
      const statementChanged = !isCreate && String(formData.get('content') || '') !== String(pdoc.content || '');
      const confirmation = statementChanged ? await statementGuard.confirm('保存题面勘误', 'statement-edit') : true;
      if (!confirmation) {
        setError('此题正在比赛或考试中使用，当前角色不能修改题面。');
        setSaving(false);
        setSaveAction('save');
        return;
      }
      if (typeof confirmation === 'string') formData.set('activeContainerConfirmation', confirmation);
      const response = await fetch(form.action || window.location.pathname, {
        method: 'POST',
        body: new URLSearchParams(formData as unknown as URLSearchParams),
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) throw new Error(await responseMessage(response));
      const { destination } = await readProblemSaveSuccess(response, kind);
      if (dirtyState.snapshot() !== submittedSnapshot) {
        console.warn('Structured code problem saved, but local form changed during request; navigation withheld', { destination });
        setError('服务器已保存提交时的版本，但保存过程中检测到新的本地修改；为避免丢失，未自动跳转。');
        setSaving(false);
        setSaveAction('save');
        dirtyState.recompute();
        return;
      }
      dirtyState.markClean();
      navigationGuard.allowNavigation();
      window.location.assign(destination);
    } catch (caught) {
      setError((caught as { message?: string } | null)?.message || '保存失败');
      setSaving(false);
      setSaveAction('save');
    }
  };

  const acceptUploadedFile = (filename: string, responseBody?: Record<string, unknown>) => {
    const revision = Number(responseBody?.structureRevision);
    const files = responseBody?.testdata;
    if (!Number.isSafeInteger(revision) || revision < 1 || !Array.isArray(files)) {
      console.error('Structured testdata upload response missing canonical file state', { filename, responseBody });
      setError('文件已上传，但服务端未返回最新结构版本与文件清单；为避免覆盖并发修改，请重新载入。');
      return;
    }
    const canonicalFiles = files.map((file: TestdataFilePayload) => ({ name: String(file?.name || ''), size: Number(file?.size) || 0 })).filter((file) => file.name);
    setStructureRevision(revision);
    setTestdataFiles(canonicalFiles);
    setCases((current) => proposeCasePairs(current, canonicalFiles));
    setError('');
  };

  const cloneForLanguage = async () => {
    if (!cloneLang) {
      setError('请选择克隆后的目标语言。');
      return;
    }
    setCloning(true);
    setError('');
    try {
      const response = await fetch(bs.urls.problems, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: new URLSearchParams({
          operation: 'copy',
          pids: String(pdoc.docId),
          target: String(bs.domain.id),
          hidden: 'true',
          cloneLang,
        }),
      });
      if (!response.ok) throw new Error(await responseMessage(response));
      const ids = await response.json();
      if (!Array.isArray(ids) || !ids[0]) throw new Error('克隆响应缺少新题 ID');
      navigationGuard.allowNavigation();
      window.location.assign(`/p/${ids[0]}/edit`);
    } catch (caught) {
      setError((caught as { message?: string } | null)?.message || '克隆失败');
      setCloning(false);
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
          <p className="text-xs text-muted-foreground">代码评测单题编辑器</p>
          <h1 className="truncate text-2xl font-semibold tracking-tight">
            {isCreate ? `新建${kind === 'program_fill' ? '程序填空题' : '代码实现题'}` : `编辑 ${pdoc.title || '题目'}`}
          </h1>
        </div>
        {codeEvaluationDraft && !locked ? (
          <div className="flex flex-wrap gap-2">
            <Button type="submit" value="save" form="structured-code-form" variant="outline" disabled={saving} className="min-h-11 gap-1.5">
              <Save className="size-4" />
              {saving && saveAction === 'save' ? '保存中…' : '保存草稿'}
            </Button>
            <Button
              type="submit"
              value="complete"
              form="structured-code-form"
              disabled={saving || completionBlocked}
              className="min-h-11 gap-1.5"
              title={
                completionBlocked
                  ? kind === 'function'
                    ? '请先设置至少一个有效作答区并修复失效区间'
                    : '请先设置至少一个有效的单行填空区'
                  : undefined
              }
            >
              <CheckCircle2 className="size-4" />
              {saving && saveAction === 'complete' ? '校验中…' : '完成配置'}
            </Button>
          </div>
        ) : (
          <Button
            type="submit"
            value="save"
            form="structured-code-form"
            disabled={saving || (!locked && !draftCreation && structureBlocked)}
            className="min-h-11 gap-1.5"
            title={!locked && !draftCreation && structureBlocked ? '请先设置并修复所有作答区域' : undefined}
          >
            <Save className="size-4" />
            {saving ? '保存中…' : draftCreation ? '创建草稿' : '保存'}
          </Button>
        )}
      </header>

      {locked ? (
        <p className="border-y border-amber-300 bg-amber-50 px-3 py-3 text-sm text-amber-900">
          该题已有提交：题面勘误仍可保存，私有模板、作答区域和测试映射保持锁定。
        </p>
      ) : null}
      {statementGuard.notice}
      {codeEvaluationDraft ? (
        <p className="border-y border-sky-300 bg-sky-50 px-3 py-3 text-sm text-sky-900 dark:border-sky-900 dark:bg-sky-950/30 dark:text-sky-100">
          当前是隐藏的代码评测草稿。可以反复保存；“完成配置”会在一个服务端 CAS 中重查模板、区域、测试点与真实文件。
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="border-y border-destructive/40 px-3 py-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <form
        ref={formRef}
        id="structured-code-form"
        method="post"
        onSubmit={submit}
        onChange={dirtyState.recompute}
        inert={saving || cloning}
        aria-busy={saving || cloning}
        className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_19rem]"
      >
        <input type="hidden" name="editorProblemKind" value={kind} />
        <input type="hidden" name="structuredConfig" value={JSON.stringify(structuredConfig)} />
        {draftCreation ? <input type="hidden" name="codeEvaluationDraft" value="true" /> : null}

        <div className="min-w-0 space-y-6">
          {!draftCreation ? (
            <section className="space-y-3">
              <h2 className="text-sm font-semibold">题面</h2>
              <MarkdownEditor name="content" value={pdoc.content || ''} minHeight={300} />
            </section>
          ) : null}

          <fieldset disabled={locked} className={cn('space-y-6', locked && 'opacity-60')}>
            {kind === 'program_fill' ? (
              <section className="space-y-3 border-t border-border/70 pt-5">
                <h2 className="text-sm font-semibold">评测方式</h2>
                <SimpleSelect
                  value={mode}
                  onValueChange={(value) => setMode(value as 'text' | 'compile')}
                  disabled={!isCreate}
                  options={[
                    { value: 'text', label: '文本比对' },
                    { value: 'compile', label: '拼接编译' },
                  ]}
                />
                {!isCreate ? <p className="text-xs text-muted-foreground">评测方式创建后不可切换。</p> : null}
              </section>
            ) : null}

            {draftCreation ? (
              <section className="space-y-4 border-t border-border/70 pt-5">
                <div className="space-y-1">
                  <h2 className="text-sm font-semibold">先固定评测语言</h2>
                  <p className="text-xs text-muted-foreground">
                    创建后立即获得真实题号，再在同一工作区上传测试数据并编辑题面与模板。草稿始终隐藏，完成校验前不能提交或加入任何容器。
                  </p>
                </div>
                <SimpleSelect
                  value={lang}
                  onValueChange={setLang}
                  options={langOptions.length ? langOptions : [{ value: '', label: '请选择语言' }]}
                />
              </section>
            ) : (
              <>
                <section className="space-y-3 border-t border-border/70 pt-5">
                  <div>
                    <h2 className="text-sm font-semibold">{compileMode ? '语言与完整模板' : '完整模板'}</h2>
                    <p className="text-xs text-muted-foreground">
                      {compileMode ? '评测语言创建后不可修改。' : '语言仅用于代码高亮，可以留空或之后调整。'}直接框选完整源码中的
                      {kind === 'function' ? '一行或多行' : '一整行'}，再设为{kind === 'function' ? '作答区' : '填空区'}
                      ；所选标准内容只在作者与评测链中可见。
                    </p>
                  </div>
                  <SimpleSelect
                    value={lang}
                    onValueChange={setLang}
                    disabled={compileMode && !isCreate}
                    options={
                      !compileMode
                        ? [{ value: '', label: '不指定高亮语言' }, ...langOptions]
                        : langOptions.length
                          ? langOptions
                          : [{ value: lang, label: lang || '请选择语言' }]
                    }
                  />
                  <div className="grid items-start gap-4 xl:grid-cols-2">
                    <div className="min-w-0 space-y-3">
                      <StructuredRegionAuthorEditor
                        lang={lang}
                        source={source}
                        ranges={[
                          ...publicRanges.map((range) => ({ ...range, state: 'public' as const })),
                          ...regions.map((region) => ({
                            key: region.key,
                            startLine: region.startLine,
                            endLine: region.endLine,
                            state: 'answer' as const,
                            invalid: region.invalid,
                          })),
                        ]}
                        onSourceChange={updateSource}
                        onSelectionChange={setSelection}
                      />
                      <div className="space-y-2 rounded-xl border bg-muted/25 p-3">
                        <div className="text-xs text-muted-foreground">
                          {selection ? (
                            <>
                              已选择第 {selection.startLine + 1}–{selection.endLine} 行{selection.expanded ? '（已扩展为完整行）' : ''}
                            </>
                          ) : (
                            '拖动正文或左侧行号选择连续完整行'
                          )}
                        </div>
                        <div className="flex flex-wrap gap-2" aria-label="源码可见性操作">
                          <Button type="button" variant="outline" size="sm" disabled={!selection} onClick={markPublic}>
                            <Eye className="size-3.5" />
                            公开给学生
                          </Button>
                          <Button type="button" variant="outline" size="sm" disabled={!selection} onClick={markAnswer}>
                            <PencilLine className="size-3.5" />
                            设为{kind === 'function' ? '作答区' : '填空区'}
                          </Button>
                          <Button type="button" variant="outline" size="sm" disabled={!selection} onClick={markPrivate}>
                            <EyeOff className="size-3.5" />
                            设为私有
                          </Button>
                        </div>
                        <p className="text-[11px] text-muted-foreground">行号前“公 / 答 / 私 / !”与行背景同时标记状态，不只依赖颜色。</p>
                      </div>
                    </div>
                    <aside className="min-w-0 space-y-3 rounded-xl border bg-muted/15 p-3" aria-label="学生实时预览">
                      <div>
                        <h3 className="text-sm font-semibold">学生实时预览</h3>
                        <p className="text-xs text-muted-foreground">只使用安全序列化结果；私有行、标准答案与坐标不会出现在这里。</p>
                      </div>
                      {structureBlocked ? (
                        <p role="alert" className="rounded-lg border border-destructive/30 p-3 text-sm text-destructive">
                          请先设置至少一个有效作答区，并修复失效或交叠区间。
                        </p>
                      ) : (
                        <StructuredRegionInputs
                          surface={previewSurface}
                          values={{}}
                          onChange={() => {}}
                          lang={lang}
                          singleLine={kind === 'program_fill'}
                          readOnly
                        />
                      )}
                    </aside>
                  </div>
                </section>

                <section className="space-y-3 border-t border-border/70 pt-5">
                  <div>
                    <h2 className="text-sm font-semibold">作答区域</h2>
                    <p className="text-xs text-muted-foreground">区域 ID 由服务端生成；展示与提交顺序固定按源码位置排列。</p>
                  </div>
                  {regions.map((region, index) => (
                    <div key={region.key} className={cn('space-y-3 rounded-lg border p-3', region.invalid && 'border-destructive bg-destructive/5')}>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium">区域 {index + 1}</span>
                        <span className="font-mono text-xs text-muted-foreground">
                          第 {region.startLine + 1}–{region.endLine} 行 · {region.id ? region.id : '保存后生成 ID'}
                        </span>
                        <div className="ml-auto flex">
                          <Button type="button" variant="ghost" size="icon" onClick={() => removeRegion(index)} aria-label="删除">
                            <Trash2 className="size-4" />
                          </Button>
                        </div>
                      </div>
                      {kind === 'function' ? (
                        <div className="grid gap-2 sm:grid-cols-2">
                          <label className="space-y-1.5">
                            <span className="text-xs font-medium">作答区标题（可选）</span>
                            <Input
                              value={region.title}
                              onChange={(event) =>
                                setRegions((current) => current.map((item, i) => (i === index ? { ...item, title: event.target.value } : item)))
                              }
                              placeholder={`例如 作答区 ${index + 1}`}
                            />
                          </label>
                          <label className="space-y-1.5">
                            <span className="text-xs font-medium">局部要求（可选）</span>
                            <Input
                              value={region.description}
                              onChange={(event) =>
                                setRegions((current) => current.map((item, i) => (i === index ? { ...item, description: event.target.value } : item)))
                              }
                              placeholder="说明输入、输出或约束"
                            />
                          </label>
                        </div>
                      ) : (
                        <Input
                          value={region.prompt}
                          onChange={(event) =>
                            setRegions((current) => current.map((item, i) => (i === index ? { ...item, prompt: event.target.value } : item)))
                          }
                          placeholder="填写提示（可选）"
                        />
                      )}
                      {region.invalid ? (
                        <p role="alert" className="text-xs text-destructive">
                          模板修改已使这个区域坐标失效；请删除后重新框选，系统不会猜测迁移。
                        </p>
                      ) : null}
                    </div>
                  ))}
                  {!regions.length ? <p className="text-sm text-muted-foreground">尚未设置作答区域。</p> : null}
                </section>
                {compileMode ? (
                  <>
                    <section className="space-y-3 border-t border-border/70 pt-5">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <h2 className="flex items-center gap-1.5 text-sm font-semibold">
                            <FileCode2 className="size-4" />
                            真实测试数据
                          </h2>
                          <p className="text-xs text-muted-foreground">可一次选择多个文件；上传直接写入当前题，失败不会创建空文件或默认映射。</p>
                        </div>
                        <span className="text-xs text-muted-foreground">结构版本 {structureRevision}</span>
                      </div>
                      <FileUploader
                        endpoint={`/p/${encodeURIComponent(pid)}/files`}
                        fieldName="file"
                        meta={{ type: 'testdata' }}
                        maxFileSize={null}
                        maxFiles={null}
                        uploadConcurrency={1}
                        retryOnFailure={false}
                        onUploaded={acceptUploadedFile}
                      />
                      {testdataFiles.length ? (
                        <div className="flex flex-wrap gap-1.5" aria-label="已上传测试数据">
                          {testdataFiles.map((file) => (
                            <span key={file.name} className="rounded-md border border-border/70 px-2 py-1 font-mono text-xs">
                              {file.name}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <p className="text-sm text-muted-foreground">尚未上传测试数据文件。</p>
                      )}
                      <Button asChild variant="ghost" size="sm">
                        <a href={`/p/${encodeURIComponent(pid)}/files?section=testdata`}>打开完整文件管理</a>
                      </Button>
                    </section>
                    <CasesEditor cases={cases} files={testdataFiles} onChange={setCases} />
                  </>
                ) : null}
              </>
            )}
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
          visibilityLockedReason={codeEvaluationDraft ? '完成题面、私有模板、区域与测试数据映射后，才能解除隐藏。' : undefined}
        >
          {compileMode && !isCreate && !codeEvaluationDraft && cloneLangOptions.length ? (
            <div className="space-y-2 border-y py-3">
              <p className="text-xs font-medium">克隆为其他语言</p>
              <SimpleSelect value={cloneLang} onValueChange={setCloneLang} options={[{ value: '', label: '选择目标语言' }, ...cloneLangOptions]} />
              <p className="text-xs text-muted-foreground">新题保持隐藏并物理复制测试数据；进入新题后再改写目标语言模板。</p>
              <Button type="button" variant="outline" size="sm" disabled={cloning || !cloneLang} onClick={cloneForLanguage}>
                <Copy className="size-3.5" />
                {cloning ? '克隆中…' : '创建语言副本'}
              </Button>
            </div>
          ) : null}
        </StructuredProblemMetadataPanel>
      </form>
      {statementGuard.dialog}
      {navigationGuard.guardDialog}
    </main>
  );
}

export function ProgramFillProblemEditorPage() {
  return <StructuredCodeEditor kind="program_fill" />;
}

export function FunctionProblemEditorPage() {
  return <StructuredCodeEditor kind="function" />;
}
