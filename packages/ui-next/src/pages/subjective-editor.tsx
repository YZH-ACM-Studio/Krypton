import { Archive, ArrowLeft, Save } from 'lucide-react';
import { useRef, useState } from 'react';
import { PROBLEM_KIND_TO_SLUG } from '@hydrooj/common';
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
import { confirmFormSubmit } from '@/components/ui/dialog';
import { Page, PageHeader } from '@/components/ui/page';
import { Textarea } from '@/components/ui/textarea';
import { useBootstrap } from '@/lib/bootstrap';
import { readAntiAiMarkerDrafts, serializeAntiAiMarkerInput, type AntiAiMarkerDraft } from '@/lib/anti-ai-marker';
import { cn } from '@/lib/cn';
import { fetchHydroResponse, readHydroResponseError } from '@/lib/error-presenter';
import { readProblemSaveSuccess } from '@/lib/problem-save-response';

interface SubjectiveProblemDocument extends StructuredProblemMetadataDocument {
  antiAiMarkers?: unknown;
  archivedAt?: unknown;
  content?: string;
  structureLockedAt?: string | Date;
  structureRevision?: number;
}

interface SubjectiveEditorPageData {
  page_name?: string;
  pdoc?: SubjectiveProblemDocument;
  structuredConfig?: { main?: { gradingInstructions?: string } };
  statementWriteGuard?: ProblemDataWriteGuardState;
  knowledgeMaps?: KnowledgeMapOption[];
  knowledgeMindmapOptions?: KnowledgeMindmapOption[];
  canUseCustomPid?: boolean;
  problemAuthoringCapabilities?: { canArchive?: boolean };
}

export function SubjectiveProblemEditorPage() {
  const bs = useBootstrap();
  const data = bs.page.data as SubjectiveEditorPageData;
  const pdoc = data.pdoc || {};
  const isCreate = String(data.page_name || '').startsWith('problem_create_');
  const locked = !!pdoc.structureLockedAt;
  const canArchive = !isCreate && data.problemAuthoringCapabilities?.canArchive === true && !pdoc.archivedAt;
  const pid = String(pdoc.pid || pdoc.docId || '');
  const [instructions, setInstructions] = useState(String(data.structuredConfig?.main?.gradingInstructions || ''));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const persistedAntiAiMarkers = readAntiAiMarkerDrafts(pdoc.antiAiMarkers);
  const [antiAiMarkers, setAntiAiMarkers] = useState<AntiAiMarkerDraft[]>(() => persistedAntiAiMarkers);
  const formRef = useRef<HTMLFormElement>(null);
  const dirtyState = useFormDirtyState(formRef, JSON.stringify({ instructions, antiAiMarkers }));
  const navigationGuard = useUnsavedChangesGuard(dirtyState.dirty || saving);
  const statementGuard = useProblemDataWriteGuard(data.statementWriteGuard, 'statement');

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
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
    setError('');
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
      const { destination } = await readProblemSaveSuccess(response, PROBLEM_KIND_TO_SLUG.subjective);
      if (dirtyState.snapshot() !== submittedSnapshot) {
        console.warn('Subjective problem saved, but local form changed during request; navigation withheld', { destination });
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
    <Page width="full">
      <PageHeader
        title={isCreate ? '新建主观题' : `编辑 ${pdoc.title || '主观题'}`}
        description="主观题编辑器"
        actions={(
          <>
            <Button asChild variant="ghost" size="sm" iconOnly>
              <a href={isCreate ? '/problem/create' : `/p/${pid}`} aria-label="返回">
                <ArrowLeft />
              </a>
            </Button>
            <Button type="submit" form="subjective-form" variant="primary" disabled={saving}>
              <Save />
              {saving ? '保存中…' : '保存'}
            </Button>
          </>
        )}
      />

      {locked ? (
        <p className="border-y border-warning-line bg-warning-soft px-3 py-3 text-sm text-warning-fg">
          该题已有提交：题面勘误仍可保存，阅卷说明与答案结构保持锁定；结构调整请克隆新题。
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
        id="subjective-form"
        method="post"
        onSubmit={submit}
        onChange={dirtyState.recompute}
        inert={saving}
        aria-busy={saving}
        className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,18rem)]"
      >
        <input type="hidden" name="editorProblemKind" value={PROBLEM_KIND_TO_SLUG.subjective} />
        <input type="hidden" name="structuredConfig" value={JSON.stringify({ main: { gradingInstructions: instructions } })} />
        {!isCreate ? <input type="hidden" name="expectedStructureRevision" value={pdoc.structureRevision ?? 0} /> : null}

        <div className="min-w-0 space-y-6">
          <section className="space-y-3">
            <div>
              <h2 className="text-sm font-semibold">题面</h2>
              <p className="text-xs text-fg-subtle">学生作答内容原样保存，提交后进入人工待评。</p>
            </div>
            <MarkdownEditor
              name="content"
              value={pdoc.content || ''}
              minHeight={320}
              antiAiPath={isCreate ? undefined : 'content'}
              antiAiMarkers={antiAiMarkers}
              onAntiAiMarkersChange={isCreate ? undefined : setAntiAiMarkers}
            />
          </section>
          <fieldset disabled={locked} className={cn('space-y-2 border-t border-line pt-5', locked && 'disabled:opacity-45')}>
            <h2 className="text-sm font-semibold">阅卷说明</h2>
            <Textarea
              value={instructions}
              onChange={(event) => setInstructions(event.target.value)}
              rows={7}
              placeholder="仅阅卷教师可见，例如评分要点、扣分规则。"
            />
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
          <input type="hidden" name="reason" value="Archived from subjective editor" />
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
  );
}
