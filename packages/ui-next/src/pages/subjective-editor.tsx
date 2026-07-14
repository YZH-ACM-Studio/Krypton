import { ArrowLeft, Save } from 'lucide-react';
import { useRef, useState } from 'react';
import { PROBLEM_KIND_TO_SLUG } from '@hydrooj/common';
import { MarkdownEditor } from '@/components/markdown-renderer';
import { StructuredProblemMetadataPanel, type KnowledgeMindmapOption } from '@/components/structured-problem-metadata-panel';
import { useFormDirtyState, useUnsavedChangesGuard } from '@/components/unsaved-changes-guard';
import { Button } from '@/components/ui/button';
import { useBootstrap } from '@/lib/bootstrap';
import { cn } from '@/lib/cn';
import { readProblemSaveSuccess } from '@/lib/problem-save-response';

type R = Record<string, any>;

async function errorMessage(response: Response) {
  if (response.status === 409) return '题目结构已被锁定或已发生变更，请重新载入后克隆新题修改。';
  const body = await response.json().catch(() => null);
  return body?.error?.message || body?.message || `保存失败（HTTP ${response.status}）`;
}

export function SubjectiveProblemEditorPage() {
  const data = useBootstrap().page.data as R;
  const pdoc = data.pdoc || {};
  const isCreate = String(data.page_name || '').startsWith('problem_create_');
  const locked = !!pdoc.structureLockedAt;
  const pid = String(pdoc.pid || pdoc.docId || '');
  const [instructions, setInstructions] = useState(String(data.structuredConfig?.main?.gradingInstructions || ''));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const formRef = useRef<HTMLFormElement>(null);
  const dirtyState = useFormDirtyState(formRef, instructions);
  const navigationGuard = useUnsavedChangesGuard(dirtyState.dirty || saving);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const submittedSnapshot = dirtyState.snapshot();
    if (submittedSnapshot === null) {
      setError('无法读取当前表单，未发送保存请求。');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const response = await fetch(form.action || window.location.pathname, {
        method: 'POST',
        body: new URLSearchParams(new FormData(form) as any),
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) throw new Error(await errorMessage(response));
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
    } catch (caught: any) {
      setError(caught?.message || '保存失败');
      setSaving(false);
    }
  };

  return (
    <main className="w-full min-w-0 space-y-5 pb-10">
      <header className="flex items-center gap-3 border-b border-border/70 pb-4">
        <Button asChild variant="ghost" size="icon" className="size-11">
          <a href={isCreate ? '/problem/create' : `/p/${pid}`} aria-label="返回">
            <ArrowLeft className="size-4" />
          </a>
        </Button>
        <div className="min-w-0 flex-1">
          <p className="text-xs text-muted-foreground">主观题编辑器</p>
          <h1 className="truncate text-2xl font-semibold tracking-tight">{isCreate ? '新建主观题' : `编辑 ${pdoc.title || '主观题'}`}</h1>
        </div>
        <Button type="submit" form="subjective-form" disabled={saving} className="min-h-11 gap-1.5">
          <Save className="size-4" />
          {saving ? '保存中…' : '保存'}
        </Button>
      </header>

      {locked ? (
        <p className="border-y border-amber-300 bg-amber-50 px-3 py-3 text-sm text-amber-900">
          该题结构已锁定；仍可修改标题、标签和可见性。题面或阅卷说明调整请克隆新题。
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="border-y border-destructive/40 px-3 py-3 text-sm text-destructive">
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
        className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]"
      >
        {locked ? (
          <input type="hidden" name="metadataOnly" value="true" />
        ) : (
          <>
            <input type="hidden" name="editorProblemKind" value={PROBLEM_KIND_TO_SLUG.subjective} />
            <input type="hidden" name="structuredConfig" value={JSON.stringify({ main: { gradingInstructions: instructions } })} />
            {!isCreate ? <input type="hidden" name="expectedStructureRevision" value={pdoc.structureRevision} /> : null}
          </>
        )}

        <fieldset disabled={locked} className={cn('min-w-0 space-y-6', locked && 'opacity-60')}>
          <section className="space-y-3">
            <div>
              <h2 className="text-sm font-semibold">题面</h2>
              <p className="text-xs text-muted-foreground">学生作答内容原样保存，提交后进入人工待评。</p>
            </div>
            <MarkdownEditor name="content" value={pdoc.content || ''} minHeight={320} />
          </section>
          <section className="space-y-2 border-t border-border/70 pt-5">
            <h2 className="text-sm font-semibold">阅卷说明</h2>
            <textarea
              value={instructions}
              onChange={(event) => setInstructions(event.target.value)}
              rows={7}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              placeholder="仅阅卷教师可见，例如评分要点、扣分规则。"
            />
          </section>
        </fieldset>

        <StructuredProblemMetadataPanel
          pdoc={pdoc}
          isCreate={isCreate}
          locked={locked}
          mindmapOptions={(data.knowledgeMindmapOptions || []) as KnowledgeMindmapOption[]}
          canUseCustomPid={data.canUseCustomPid === true}
          onMetadataChange={dirtyState.recompute}
        />
      </form>
      {navigationGuard.guardDialog}
    </main>
  );
}
