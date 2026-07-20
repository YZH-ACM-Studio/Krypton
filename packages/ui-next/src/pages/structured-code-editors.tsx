import { ArrowDown, ArrowLeft, ArrowUp, CheckCircle2, Copy, FileCode2, GripVertical, Plus, Save, Trash2 } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { MarkdownEditor } from '@/components/markdown-renderer';
import { useProblemDataWriteGuard } from '@/components/problem-data-write-guard';
import { StructuredRegionAuthorEditor, type AuthorLineSelection } from '@/components/structured-region-author-editor';
import { StructuredRegionInputs } from '@/components/structured-region-inputs';
import { StructuredProblemMetadataPanel, type KnowledgeMindmapOption } from '@/components/structured-problem-metadata-panel';
import { useFormDirtyState, useUnsavedChangesGuard } from '@/components/unsaved-changes-guard';
import { FileUploader } from '@/components/uploader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SimpleSelect } from '@/components/ui/select';
import { useBootstrap } from '@/lib/bootstrap';
import { cn } from '@/lib/cn';
import { readProblemSaveSuccess } from '@/lib/problem-save-response';

type R = Record<string, any>;
interface RegionMeta {
  key: string;
  id: string;
  startLine: number;
  endLine: number;
  order: number;
  signature: string;
  description: string;
  prompt: string;
  anchor: string;
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

function selectedSource(source: string, region: Pick<RegionMeta, 'startLine' | 'endLine'>) {
  const lines = source.split('\n');
  if (region.startLine < 0 || region.endLine <= region.startLine || region.endLine > lines.length) return null;
  return lines.slice(region.startLine, region.endLine).join('\n');
}

function reorderRegions(regions: RegionMeta[], from: number, to: number) {
  if (from === to || from < 0 || to < 0 || from >= regions.length || to >= regions.length) return regions;
  const next = [...regions];
  const [region] = next.splice(from, 1);
  next.splice(to, 0, region);
  return next.map((item, order) => ({ ...item, order }));
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
  const data = bs.page.data as R;
  const pdoc = data.pdoc || {};
  const initial = data.structuredConfig?.main || {};
  const isCreate = String(data.page_name || '').startsWith('problem_create_');
  const locked = !!pdoc.structureLockedAt;
  const pid = String(pdoc.pid || pdoc.docId || '');
  const codeEvaluationDraft = pdoc.codeEvaluationStatus === 'draft';
  const [mode, setMode] = useState<'text' | 'compile'>(initial.mode === 'compile' ? 'compile' : 'text');
  const [lang, setLang] = useState(String(initial.lang || ''));
  const [source, setSource] = useState(String(initial.source || ''));
  const [regions, setRegions] = useState<RegionMeta[]>(() => {
    if (!Array.isArray(initial.regions)) return [];
    return initial.regions.map((item: R, index: number) => {
      const startLine = Number(item.startLine);
      const endLine = Number(item.endLine);
      const range = { startLine, endLine };
      return {
        key: String(item.id || `new-${index}`),
        id: String(item.id || ''),
        startLine,
        endLine,
        order: Number.isSafeInteger(item.order) ? Number(item.order) : index,
        signature: String(item.signature || ''),
        description: String(item.description || ''),
        prompt: String(item.prompt || ''),
        anchor: selectedSource(String(initial.source || ''), range) || '',
        invalid: selectedSource(String(initial.source || ''), range) === null,
      };
    });
  });
  const [cases, setCases] = useState<CaseMeta[]>(() =>
    Array.isArray(initial.cases) ? initial.cases.map((item: R) => ({ input: String(item.input || ''), output: String(item.output || '') })) : [],
  );
  const [testdataFiles, setTestdataFiles] = useState<TestdataFile[]>(() =>
    Array.isArray(data.testdata)
      ? data.testdata.map((file: R) => ({ name: String(file.name || ''), size: Number(file.size) || 0 })).filter((file) => file.name)
      : [],
  );
  const [structureRevision, setStructureRevision] = useState(Number(pdoc.structureRevision) || 1);
  const [saving, setSaving] = useState(false);
  const [saveAction, setSaveAction] = useState<'save' | 'complete'>('save');
  const [cloning, setCloning] = useState(false);
  const [error, setError] = useState('');
  const [selection, setSelection] = useState<AuthorLineSelection | null>(null);
  const [draggedRegion, setDraggedRegion] = useState<number | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const compileMode = kind === 'function' || mode === 'compile';
  const draftCreation = isCreate && compileMode;
  const langOptions = Object.entries(data.langRange || {}).map(([value, label]) => ({ value, label: String(label) }));
  const cloneLangOptions = langOptions.filter((option) => option.value !== lang);
  const [cloneLang, setCloneLang] = useState('');
  const structureBlocked = regions.length === 0 || regions.some((region) => region.invalid || (kind === 'function' && !region.signature.trim()));
  const completionBlocked = compileMode && structureBlocked;

  const structuredConfig = useMemo(
    () => ({
      main: draftCreation
        ? { mode: kind === 'program_fill' ? 'compile' : 'function', lang }
        : {
            mode: kind === 'program_fill' ? mode : 'function',
            lang,
            source,
            regions: regions.map((region) => ({
              id: region.id,
              startLine: region.startLine,
              endLine: region.endLine,
              order: region.order,
              ...(kind === 'function'
                ? { signature: region.signature, ...(region.description ? { description: region.description } : {}) }
                : region.prompt
                  ? { prompt: region.prompt }
                  : {}),
            })),
            ...(compileMode ? { cases } : {}),
          },
    }),
    [cases, compileMode, draftCreation, kind, lang, mode, regions, source],
  );
  const previewSkeleton = useMemo(() => {
    if (kind !== 'program_fill' || regions.some((region) => region.invalid)) return undefined;
    const regionByLine = new Map(regions.map((region) => [region.startLine, region.id || region.key]));
    return source.split('\n').map((code, line) => {
      const regionId = regionByLine.get(line);
      return regionId ? { regionId } : { code };
    });
  }, [kind, regions, source]);
  const dirtyState = useFormDirtyState(formRef, JSON.stringify(structuredConfig));
  const navigationGuard = useUnsavedChangesGuard(dirtyState.dirty || saving || cloning);
  const statementGuard = useProblemDataWriteGuard(data.statementWriteGuard, 'statement');
  const localRegionCounter = useRef(0);

  const updateSource = (nextSource: string) => {
    setSource(nextSource);
    setRegions((current) =>
      current.map((region) => {
        const currentSelection = selectedSource(nextSource, region);
        return { ...region, invalid: currentSelection === null || currentSelection !== region.anchor };
      }),
    );
  };

  const addSelectedRegion = () => {
    if (!selection) {
      setError('请先在完整模板中框选至少一行。');
      return;
    }
    if (kind === 'program_fill' && selection.endLine !== selection.startLine + 1) {
      setError('程序填空区域只能选择一整行。');
      return;
    }
    if (regions.some((region) => region.startLine < selection.endLine && selection.startLine < region.endLine)) {
      setError('所选完整行与已有区域重叠，请重新框选。');
      return;
    }
    const anchor = selectedSource(source, selection);
    if (anchor === null) {
      setError('所选行已超出当前模板，请重新框选。');
      return;
    }
    localRegionCounter.current += 1;
    setRegions((current) => [
      ...current,
      {
        key: `new-${localRegionCounter.current}`,
        id: '',
        startLine: selection.startLine,
        endLine: selection.endLine,
        order: current.length,
        signature: '',
        description: '',
        prompt: '',
        anchor,
        invalid: false,
      },
    ]);
    setError('');
  };

  const removeRegion = (index: number) => {
    setRegions((current) => current.filter((_, regionIndex) => regionIndex !== index).map((region, order) => ({ ...region, order })));
  };

  const moveRegion = (index: number, delta: number) => {
    setRegions((current) => reorderRegions(current, index, index + delta));
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
        body: new URLSearchParams(formData as any),
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
    } catch (caught: any) {
      setError(caught?.message || '保存失败');
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
    const canonicalFiles = files.map((file: R) => ({ name: String(file?.name || ''), size: Number(file?.size) || 0 })).filter((file) => file.name);
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
    } catch (caught: any) {
      setError(caught?.message || '克隆失败');
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
            {isCreate ? `新建${kind === 'program_fill' ? '程序填空题' : '函数题'}` : `编辑 ${pdoc.title || '题目'}`}
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
                completionBlocked ? (kind === 'function' ? '请先修复失效区域并填写所有函数签名' : '请先设置至少一个有效的单行填空区') : undefined
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
                      {kind === 'function' ? '一行或多行' : '一整行'}，再设为{kind === 'function' ? '函数区' : '填空区'}
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
                  <StructuredRegionAuthorEditor
                    lang={lang}
                    source={source}
                    regions={regions.map((region) => ({
                      key: region.key,
                      startLine: region.startLine,
                      endLine: region.endLine,
                      invalid: region.invalid,
                    }))}
                    onSourceChange={updateSource}
                    onSelectionChange={setSelection}
                  />
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/30 px-3 py-2.5">
                    <div className="text-xs text-muted-foreground">
                      {selection ? (
                        <>
                          将使用第 {selection.startLine + 1}–{selection.endLine} 行{selection.expanded ? '（已自动扩展到完整行）' : ''}
                        </>
                      ) : (
                        '请先拖动选择至少一行源码'
                      )}
                    </div>
                    <Button type="button" variant="outline" size="sm" disabled={!selection} onClick={addSelectedRegion}>
                      <Plus className="size-3.5" />
                      设为{kind === 'function' ? '函数区' : '填空区'}
                    </Button>
                  </div>
                </section>

                <section className="space-y-3 border-t border-border/70 pt-5">
                  <div>
                    <h2 className="text-sm font-semibold">作答区域</h2>
                    <p className="text-xs text-muted-foreground">区域 ID 由服务端生成；拖拽卡片只调整学生作答顺序，不会移动源码。</p>
                  </div>
                  {regions.map((region, index) => (
                    <div
                      key={region.key}
                      className={cn('space-y-3 rounded-lg border p-3', region.invalid && 'border-destructive bg-destructive/5')}
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={() => {
                        if (draggedRegion === null) return;
                        setRegions((current) => reorderRegions(current, draggedRegion, index));
                        setDraggedRegion(null);
                      }}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          draggable
                          onDragStart={() => setDraggedRegion(index)}
                          onDragEnd={() => setDraggedRegion(null)}
                          className="cursor-grab rounded p-1 text-muted-foreground active:cursor-grabbing"
                          aria-label={`拖拽调整区域 ${index + 1} 顺序`}
                        >
                          <GripVertical className="size-4" />
                        </button>
                        <span className="text-sm font-medium">区域 {index + 1}</span>
                        <span className="font-mono text-xs text-muted-foreground">
                          第 {region.startLine + 1}–{region.endLine} 行 · {region.id ? region.id : '保存后生成 ID'}
                        </span>
                        <div className="ml-auto flex">
                          <Button type="button" variant="ghost" size="icon" onClick={() => moveRegion(index, -1)} aria-label="上移">
                            <ArrowUp className="size-4" />
                          </Button>
                          <Button type="button" variant="ghost" size="icon" onClick={() => moveRegion(index, 1)} aria-label="下移">
                            <ArrowDown className="size-4" />
                          </Button>
                          <Button type="button" variant="ghost" size="icon" onClick={() => removeRegion(index)} aria-label="删除">
                            <Trash2 className="size-4" />
                          </Button>
                        </div>
                      </div>
                      {kind === 'function' ? (
                        <div className="grid gap-2 sm:grid-cols-2">
                          <label className="space-y-1.5">
                            <span className="text-xs font-medium">函数签名（必填）</span>
                            <Input
                              value={region.signature}
                              onChange={(event) =>
                                setRegions((current) => current.map((item, i) => (i === index ? { ...item, signature: event.target.value } : item)))
                              }
                              placeholder="例如 int solve(int n)"
                              className="font-mono"
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
                  <div className="border-y border-border/70 py-4">
                    <p className="mb-3 text-xs font-medium text-muted-foreground">学生输入预览（不展示后台完整模板）</p>
                    <StructuredRegionInputs
                      regions={regions.map((region) => ({
                        id: region.id || region.key,
                        signature: region.signature,
                        description: region.description,
                        prompt: region.prompt,
                      }))}
                      values={{}}
                      onChange={() => {}}
                      singleLine={kind === 'program_fill'}
                      skeleton={kind === 'program_fill' ? previewSkeleton : undefined}
                      readOnly
                    />
                  </div>
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
          mindmapOptions={(data.knowledgeMindmapOptions || []) as KnowledgeMindmapOption[]}
          canUseCustomPid={data.canUseCustomPid === true}
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
