import { buildClientStructuredCodeSurface, type ClientStructuredCodeSegment } from '@hydrooj/common';
import { ArrowLeft, ArrowRight, CheckCircle2, Copy, Eye, EyeOff, FileCode2, PencilLine, Plus, Save, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { MarkdownEditor } from '@/components/markdown-renderer';
import { useProblemDataWriteGuard, type ProblemDataWriteGuardState } from '@/components/problem-data-write-guard';
import { StructuredRegionAuthorEditor, type AuthorLineRange, type AuthorLineSelection } from '@/components/structured-region-author-editor';
import { StructuredRegionInputs } from '@/components/structured-region-inputs';
import {
  StructuredProblemMetadataPanel,
  type KnowledgeMapOption,
  type KnowledgeMindmapOption,
  type StructuredProblemMetadataState,
} from '@/components/structured-problem-metadata-panel';
import { useFormDirtyState, useUnsavedChangesGuard } from '@/components/unsaved-changes-guard';
import { FileUploader } from '@/components/uploader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SimpleSelect } from '@/components/ui/select';
import { useBootstrap } from '@/lib/bootstrap';
import { readAntiAiMarkerDrafts, serializeAntiAiMarkerInput, type AntiAiMarkerDraft } from '@/lib/anti-ai-marker';
import { cn } from '@/lib/cn';
import { fetchHydroResponse, readHydroResponseError } from '@/lib/error-presenter';
import { readProblemSaveSuccess } from '@/lib/problem-save-response';
import { structuredCodeCompletionIssues, type StructuredAuthorStage, type StructuredCodeCompletionIssue } from '@/lib/structured-code-readiness';

interface StructuredEditorProblemDoc {
  antiAiMarkers?: unknown;
  pid?: string | number;
  docId?: string | number;
  title?: string;
  content?: string;
  structureLockedAt?: unknown;
  structureRevision?: number;
  codeEvaluationStatus?: string;
  difficulty?: string | number;
  hidden?: boolean;
  knowledgeMapId?: unknown;
  knowledgeNodeIds?: unknown[];
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
  problemAuthoringCapabilities?: { canDelete?: boolean };
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

function CasesEditor({
  cases,
  files,
  onChange,
  disabled = false,
}: {
  cases: CaseMeta[];
  files: TestdataFile[];
  onChange: (cases: CaseMeta[]) => void;
  disabled?: boolean;
}) {
  return (
    <section className="space-y-3 border-t border-border/70 pt-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">测试数据映射</h2>
          <p className="text-xs text-muted-foreground">输入与输出只能从当前题真实存在的文件中选择；同 basename 的 .in/.out 会自动提出配对。</p>
        </div>
        <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => onChange([...cases, { input: '', output: '' }])}>
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
            ariaLabel={`测试点 ${index + 1} 输入文件`}
            disabled={disabled}
          />
          <SimpleSelect
            value={item.output}
            onValueChange={(value) => onChange(cases.map((row, i) => (i === index ? { ...row, output: value } : row)))}
            options={caseFileOptions(files, item.output)}
            ariaLabel={`测试点 ${index + 1} 输出文件`}
            disabled={disabled}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            disabled={disabled}
            onClick={() => onChange(cases.filter((_, i) => i !== index))}
            aria-label="删除测试点"
          >
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
    Array.isArray(initial.cases)
      ? initial.cases.map((item: DraftCase) => ({ input: String(item.input || ''), output: String(item.output || '') }))
      : [],
  );
  const [testdataFiles, setTestdataFiles] = useState<TestdataFile[]>(() =>
    Array.isArray(data.testdata)
      ? data.testdata
          .map((file: TestdataFilePayload) => ({ name: String(file.name || ''), size: Number(file.size) || 0 }))
          .filter((file) => file.name)
      : [],
  );
  const [structureRevision, setStructureRevision] = useState(Number(pdoc.structureRevision) || 1);
  const [saving, setSaving] = useState(false);
  const [saveAction, setSaveAction] = useState<'save' | 'complete'>('save');
  const [cloning, setCloning] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [error, setError] = useState('');
  const persistedAntiAiMarkers = readAntiAiMarkerDrafts(pdoc.antiAiMarkers);
  const [antiAiMarkers, setAntiAiMarkers] = useState<AntiAiMarkerDraft[]>(() => persistedAntiAiMarkers);
  const [selection, setSelection] = useState<AuthorLineSelection | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const stagePanelRef = useRef<HTMLDivElement>(null);
  const compileMode = kind === 'function' || mode === 'compile';
  const draftCreation = isCreate && compileMode;
  const langOptions = Object.entries(data.langRange || {}).map(([value, label]) => ({ value, label: String(label) }));
  const cloneLangOptions = langOptions.filter((option) => option.value !== lang);
  const [cloneLang, setCloneLang] = useState('');
  const structureBlocked = regions.length === 0 || regions.some((region) => region.invalid) || publicRanges.some((range) => range.invalid);
  const [metadataState, setMetadataState] = useState<StructuredProblemMetadataState>({
    title: String(pdoc.title || ''),
    selectedKnowledgeCount: Array.isArray(pdoc.knowledgeNodeIds) ? pdoc.knowledgeNodeIds.length : 0,
    hasInvalidKnowledge: false,
  });
  const [completionIssues, setCompletionIssues] = useState<StructuredCodeCompletionIssue[]>([]);
  const [activeStage, setActiveStage] = useState<StructuredAuthorStage>('metadata');
  const stages = useMemo<{ id: StructuredAuthorStage; label: string }[]>(
    () =>
      draftCreation
        ? [{ id: 'metadata', label: '基础信息' }]
        : [
            { id: 'metadata', label: '题面与信息' },
            { id: 'template', label: '模板与作答区' },
            ...(compileMode ? [{ id: 'testdata' as const, label: '测试数据' }] : []),
            { id: 'review', label: '检查与完成' },
          ],
    [compileMode, draftCreation],
  );
  const activeStageIndex = Math.max(
    0,
    stages.findIndex((stage) => stage.id === activeStage),
  );
  const canDelete = !isCreate && data.problemAuthoringCapabilities?.canDelete === true;

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
  const readinessIssues = useMemo(
    () =>
      structuredCodeCompletionIssues({
        kind,
        compileMode,
        title: metadataState.title,
        source,
        lang,
        regions,
        publicRanges,
        selectedKnowledgeCount: metadataState.selectedKnowledgeCount,
        hasInvalidKnowledge: metadataState.hasInvalidKnowledge,
        cases,
        files: testdataFiles,
      }),
    [cases, compileMode, kind, lang, metadataState, publicRanges, regions, source, testdataFiles],
  );
  useEffect(() => {
    if (completionIssues.length) setCompletionIssues(readinessIssues);
  }, [completionIssues.length, readinessIssues]);
  useEffect(() => {
    if (!stages.some((stage) => stage.id === activeStage)) setActiveStage('metadata');
  }, [activeStage, stages]);
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
  const dirtyState = useFormDirtyState(formRef, JSON.stringify({ structuredConfig, antiAiMarkers }));
  const navigationGuard = useUnsavedChangesGuard(dirtyState.dirty || saving || cloning || deleting);
  const statementGuard = useProblemDataWriteGuard(data.statementWriteGuard, 'statement');
  const localRegionCounter = useRef(0);
  const nextLocalKey = (prefix: string) => {
    localRegionCounter.current += 1;
    return `${prefix}-${localRegionCounter.current}`;
  };
  const goToStage = (stage: StructuredAuthorStage) => {
    setActiveStage(stage);
    requestAnimationFrame(() => stagePanelRef.current?.scrollIntoView({ block: 'start' }));
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
    const requiresCompleteConfiguration = !draftCreation && (completing || !codeEvaluationDraft);
    if (requiresCompleteConfiguration) {
      const issues = structuredCodeCompletionIssues({
        kind,
        compileMode,
        title: metadataState.title,
        source,
        lang,
        regions,
        publicRanges,
        selectedKnowledgeCount: metadataState.selectedKnowledgeCount,
        hasInvalidKnowledge: metadataState.hasInvalidKnowledge,
        cases,
        files: testdataFiles,
      });
      if (issues.length) {
        setCompletionIssues(issues);
        setError(`还有 ${issues.length} 项配置需要处理，已定位到第一项。`);
        goToStage(issues[0].stage);
        return;
      }
    }
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
      const contentChanged = !isCreate && String(formData.get('content') || '') !== String(pdoc.content || '');
      const markerChanged = JSON.stringify(antiAiMarkers) !== JSON.stringify(persistedAntiAiMarkers);
      if (!isCreate && (markerChanged || (contentChanged && persistedAntiAiMarkers.length > 0))) {
        formData.set('antiAiMarkers', JSON.stringify(serializeAntiAiMarkerInput(antiAiMarkers)));
      }
      if (!draftCreation) formData.set('structuredConfig', JSON.stringify(structuredConfig));
      if (!isCreate) formData.set('expectedStructureRevision', String(structureRevision));
      if (completing) formData.set('completeCodeEvaluationDraft', 'true');
      const statementChanged = !isCreate && (markerChanged || contentChanged);
      const confirmation = statementChanged ? await statementGuard.confirm('保存题面勘误', 'statement-edit') : true;
      if (!confirmation) {
        setError('此题正在比赛或考试中使用，当前角色不能修改题面。');
        setSaving(false);
        setSaveAction('save');
        return;
      }
      if (typeof confirmation === 'string') formData.set('activeContainerConfirmation', confirmation);
      const response = await fetchHydroResponse(form.action || window.location.pathname, {
        method: 'POST',
        body: new URLSearchParams(formData as unknown as URLSearchParams),
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
    const canonicalFiles = files
      .map((file: TestdataFilePayload) => ({ name: String(file?.name || ''), size: Number(file?.size) || 0 }))
      .filter((file) => file.name);
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
      const response = await fetchHydroResponse(bs.urls.problems, {
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
      if (!response.ok) throw new Error(await readHydroResponseError(response, '克隆题目失败'));
      const ids = await response.json();
      if (!Array.isArray(ids) || !ids[0]) throw new Error('克隆响应缺少新题 ID');
      navigationGuard.allowNavigation();
      window.location.assign(`/p/${ids[0]}/edit`);
    } catch (caught) {
      setError((caught as { message?: string } | null)?.message || '克隆失败');
      setCloning(false);
    }
  };

  const deleteProblem = async () => {
    if (!canDelete || deleting) return;
    setDeleting(true);
    setError('');
    try {
      const formData = new FormData();
      formData.set('operation', 'delete');
      const response = await fetchHydroResponse(window.location.pathname, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
        body: new URLSearchParams(formData as unknown as URLSearchParams),
      });
      if (!response.ok) throw new Error(await readHydroResponseError(response, '删除题目失败'));
      navigationGuard.allowNavigation();
      window.location.assign(bs.urls.problems);
    } catch (caught) {
      setError((caught as { message?: string } | null)?.message || '删除题目失败');
      setDeleting(false);
    }
  };
  const reviewIssues = completionIssues.length ? completionIssues : readinessIssues;

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
        <span className="text-xs text-muted-foreground">
          第 {activeStageIndex + 1} / {stages.length} 步
        </span>
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
        inert={saving || cloning || deleting}
        aria-busy={saving || cloning || deleting}
        noValidate
        className="min-w-0"
      >
        <input type="hidden" name="editorProblemKind" value={kind} />
        <input type="hidden" name="structuredConfig" value={JSON.stringify(structuredConfig)} />
        {draftCreation ? <input type="hidden" name="codeEvaluationDraft" value="true" /> : null}

        <nav
          data-testid="structured-author-stage-nav"
          aria-label="出题步骤"
          className="mb-6 grid auto-cols-[minmax(11rem,1fr)] grid-flow-col overflow-x-auto border-y border-border/70"
        >
          {stages.map((stage, index) => (
            <Button
              key={stage.id}
              type="button"
              variant="ghost"
              className={cn(
                "relative min-h-14 justify-start gap-3 rounded-none px-3 text-left after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:content-['']",
                activeStage === stage.id
                  ? 'text-foreground after:bg-primary hover:bg-muted/40'
                  : 'text-muted-foreground after:bg-transparent hover:text-foreground',
              )}
              aria-current={activeStage === stage.id ? 'step' : undefined}
              onClick={() => goToStage(stage.id)}
            >
              <span
                aria-hidden="true"
                className={cn(
                  'grid size-7 shrink-0 place-items-center rounded-full border text-xs tabular-nums',
                  activeStage === stage.id ? 'border-foreground bg-foreground text-background' : 'border-border bg-background',
                )}
              >
                {index + 1}
              </span>
              <span className="whitespace-nowrap text-sm font-medium">{stage.label}</span>
            </Button>
          ))}
        </nav>

        <div ref={stagePanelRef} data-testid="structured-author-stage-panel" className="min-h-[32rem] scroll-mt-20">
          <section hidden={activeStage !== 'metadata'} data-stage="metadata" className="min-h-[32rem] space-y-5">
            <div>
              <h2 className="text-lg font-semibold">题面与基础信息</h2>
              <p className="mt-1 text-sm text-muted-foreground">先确定题型、标题与知识归属，再编写题面；所有输入都留在当前阶段。</p>
            </div>
            {kind === 'program_fill' ? (
              <section className="max-w-md space-y-2">
                <label className="text-xs font-medium" htmlFor="structured-mode-select">
                  评测方式
                </label>
                <SimpleSelect
                  id="structured-mode-select"
                  ariaLabel="评测方式"
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
              <section className="max-w-xl space-y-3 rounded-xl border border-border/70 p-4">
                <div>
                  <h3 className="text-sm font-semibold">先固定评测语言</h3>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    创建后立即获得真实题号，再上传测试数据并编辑模板。草稿始终隐藏，完成校验前不能提交或加入容器。
                  </p>
                </div>
                <SimpleSelect
                  value={lang}
                  onValueChange={setLang}
                  ariaLabel="评测语言"
                  options={langOptions.length ? langOptions : [{ value: '', label: '请选择语言' }]}
                />
              </section>
            ) : null}
            <div className={cn('grid items-start gap-6', !draftCreation && 'lg:grid-cols-[22rem_minmax(0,1fr)]')}>
              <StructuredProblemMetadataPanel
                pdoc={pdoc}
                isCreate={isCreate}
                locked={locked}
                knowledgeMaps={data.knowledgeMaps || []}
                mindmapOptions={data.knowledgeMindmapOptions || []}
                canUseCustomPid={data.canUseCustomPid === true}
                formDirty={dirtyState.dirty}
                onMetadataChange={dirtyState.recompute}
                onMetadataStateChange={setMetadataState}
                layout="inline"
                visibilityLockedReason={codeEvaluationDraft ? '完成题面、私有模板、区域与测试数据映射后，才能解除隐藏。' : undefined}
              />
              {!draftCreation ? (
                <section className="min-w-0 space-y-2">
                  <h3 className="text-sm font-semibold">题面</h3>
                  <MarkdownEditor
                    name="content"
                    value={pdoc.content || ''}
                    minHeight={500}
                    antiAiPath="content"
                    antiAiMarkers={antiAiMarkers}
                    onAntiAiMarkersChange={setAntiAiMarkers}
                  />
                </section>
              ) : null}
            </div>
          </section>

          {!draftCreation ? (
            <>
              <section hidden={activeStage !== 'template'} data-stage="template" className="min-h-[32rem] space-y-5">
                <fieldset disabled={locked} className="space-y-5">
                  <div>
                    <h2 className="text-lg font-semibold">{compileMode ? '语言、模板与作答区' : '模板与填空区'}</h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      直接框选完整源码中的{kind === 'function' ? '一行或多行' : '一整行'}，再标记学生可见范围与作答范围。
                    </p>
                  </div>
                  <div className="max-w-md space-y-2">
                    <label className="text-xs font-medium" htmlFor="structured-language-select">
                      {compileMode ? '评测语言' : '高亮语言'}
                    </label>
                    <SimpleSelect
                      id="structured-language-select"
                      ariaLabel={compileMode ? '评测语言' : '高亮语言'}
                      value={lang}
                      onValueChange={setLang}
                      disabled={locked || (compileMode && !isCreate)}
                      options={
                        !compileMode
                          ? [{ value: '', label: '不指定高亮语言' }, ...langOptions]
                          : langOptions.length
                            ? langOptions
                            : [{ value: lang, label: lang || '请选择语言' }]
                      }
                    />
                    {compileMode && !isCreate ? <p className="text-xs text-muted-foreground">评测语言创建后不可修改。</p> : null}
                  </div>
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
                    readOnly={locked}
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

                  <section className="space-y-3 border-t border-border/70 pt-5">
                    <div>
                      <h3 className="text-sm font-semibold">作答区域</h3>
                      <p className="text-xs text-muted-foreground">区域 ID 由服务端生成；展示与提交顺序固定按源码位置排列。</p>
                    </div>
                    {regions.map((region, index) => (
                      <div
                        key={region.key}
                        className={cn('space-y-3 rounded-lg border p-3', region.invalid && 'border-destructive bg-destructive/5')}
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium">区域 {index + 1}</span>
                          <span className="font-mono text-xs text-muted-foreground">
                            第 {region.startLine + 1}–{region.endLine} 行 · {region.id ? region.id : '保存后生成 ID'}
                          </span>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="ml-auto"
                            onClick={() => removeRegion(index)}
                            aria-label={`删除区域 ${index + 1}`}
                          >
                            <Trash2 className="size-4" />
                          </Button>
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
                                  setRegions((current) =>
                                    current.map((item, i) => (i === index ? { ...item, description: event.target.value } : item)),
                                  )
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

                  <details className="rounded-xl border border-border/70 p-4">
                    <summary className="min-h-11 cursor-pointer text-sm font-semibold">查看学生安全预览</summary>
                    <div className="mt-3 min-w-0">
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
                    </div>
                  </details>
                </fieldset>
              </section>

              {compileMode ? (
                <section hidden={activeStage !== 'testdata'} data-stage="testdata" className="min-h-[32rem] space-y-5">
                  <fieldset disabled={locked} className="space-y-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <h2 className="flex items-center gap-1.5 text-lg font-semibold">
                          <FileCode2 className="size-5" />
                          真实测试数据
                        </h2>
                        <p className="mt-1 text-sm text-muted-foreground">先上传真实文件，再在紧邻区域映射输入与输出；失败不会创建默认映射。</p>
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
                    <CasesEditor cases={cases} files={testdataFiles} onChange={setCases} disabled={locked} />
                    <Button asChild variant="ghost" size="sm">
                      <a href={`/p/${encodeURIComponent(pid)}/files?section=testdata`}>打开完整文件管理</a>
                    </Button>
                  </fieldset>
                </section>
              ) : null}

              <section hidden={activeStage !== 'review'} data-stage="review" className="min-h-[32rem] space-y-5">
                <div>
                  <h2 className="text-lg font-semibold">检查并完成</h2>
                  <p className="mt-1 text-sm text-muted-foreground">这里汇总服务端完成校验前可以确定的缺项；点击任一项直接回到对应阶段。</p>
                </div>
                {reviewIssues.length ? (
                  <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/[0.025] p-4">
                    <p className="text-sm font-semibold text-destructive">还有 {reviewIssues.length} 项需要处理</p>
                    <ul className="mt-3 space-y-1.5">
                      {reviewIssues.map((issue, index) => (
                        <li key={`${issue.stage}:${issue.message}:${index}`}>
                          <button
                            type="button"
                            className="min-h-11 text-left text-sm text-destructive underline-offset-4 hover:underline"
                            onClick={() => goToStage(issue.stage)}
                          >
                            {issue.message}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <div className="flex items-start gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/[0.035] p-4">
                    <CheckCircle2 className="mt-0.5 size-5 text-emerald-600" />
                    <div>
                      <p className="text-sm font-semibold">本地检查已通过</p>
                      <p className="mt-1 text-xs text-muted-foreground">点击完成后，服务端仍会重新校验结构版本、模板、知识标签和真实文件。</p>
                    </div>
                  </div>
                )}

                {compileMode && !isCreate && !codeEvaluationDraft && cloneLangOptions.length ? (
                  <section className="max-w-xl space-y-2 rounded-xl border border-border/70 p-4">
                    <h3 className="text-sm font-semibold">克隆为其他语言</h3>
                    <SimpleSelect
                      value={cloneLang}
                      onValueChange={setCloneLang}
                      ariaLabel="克隆目标语言"
                      options={[{ value: '', label: '选择目标语言' }, ...cloneLangOptions]}
                    />
                    <p className="text-xs text-muted-foreground">新题保持隐藏并物理复制测试数据；进入新题后再改写目标语言模板。</p>
                    <Button type="button" variant="outline" size="sm" disabled={cloning || !cloneLang} onClick={cloneForLanguage}>
                      <Copy className="size-3.5" />
                      {cloning ? '克隆中…' : '创建语言副本'}
                    </Button>
                  </section>
                ) : null}

                {canDelete ? (
                  <section className="rounded-xl border border-destructive/25 bg-destructive/[0.025] p-4" aria-labelledby="structured-danger-heading">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <h3 id="structured-danger-heading" className="text-sm font-semibold text-destructive">
                          删除题目
                        </h3>
                        <p className="mt-1 text-xs text-muted-foreground">服务器会先确认题目未被比赛或考试引用，再执行永久删除。</p>
                      </div>
                      {!showDeleteConfirm ? (
                        <Button type="button" variant="destructive" size="sm" onClick={() => setShowDeleteConfirm(true)}>
                          <Trash2 className="size-3.5" />
                          删除题目
                        </Button>
                      ) : (
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs font-medium text-destructive">确认删除这道题？此操作不可撤销。</span>
                          <Button type="button" variant="destructive" size="sm" disabled={deleting} onClick={deleteProblem}>
                            {deleting ? '删除中…' : '确认删除'}
                          </Button>
                          <Button type="button" variant="outline" size="sm" disabled={deleting} onClick={() => setShowDeleteConfirm(false)}>
                            取消
                          </Button>
                        </div>
                      )}
                    </div>
                  </section>
                ) : null}
              </section>
            </>
          ) : null}
        </div>

        <footer
          data-testid="structured-author-stage-actions"
          className="sticky bottom-0 z-20 mt-6 flex min-h-16 flex-wrap items-center justify-between gap-3 border-t border-border/70 bg-background/95 py-2 backdrop-blur"
        >
          <Button
            type="button"
            variant="outline"
            className="min-h-11"
            disabled={activeStageIndex === 0}
            onClick={() => goToStage(stages[Math.max(0, activeStageIndex - 1)].id)}
          >
            <ArrowLeft className="size-4" />
            上一步
          </Button>
          {activeStageIndex < stages.length - 1 ? (
            <Button
              type="button"
              className="min-h-11"
              onClick={(event) => {
                event.preventDefault();
                goToStage(stages[activeStageIndex + 1].id);
              }}
            >
              下一步
              <ArrowRight className="size-4" />
            </Button>
          ) : draftCreation ? (
            <Button type="submit" value="save" disabled={saving} className="min-h-11 gap-1.5">
              <Save className="size-4" />
              {saving ? '创建中…' : '创建草稿'}
            </Button>
          ) : codeEvaluationDraft && !locked ? (
            <div className="flex flex-wrap gap-2">
              <Button type="submit" value="save" variant="outline" disabled={saving} className="min-h-11 gap-1.5">
                <Save className="size-4" />
                {saving && saveAction === 'save' ? '保存中…' : '保存草稿'}
              </Button>
              <Button type="submit" value="complete" disabled={saving} className="min-h-11 gap-1.5">
                <CheckCircle2 className="size-4" />
                {saving && saveAction === 'complete' ? '校验中…' : '完成配置'}
              </Button>
            </div>
          ) : (
            <Button type="submit" value="save" disabled={saving} className="min-h-11 gap-1.5">
              <Save className="size-4" />
              {saving ? '保存中…' : '保存'}
            </Button>
          )}
        </footer>
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
