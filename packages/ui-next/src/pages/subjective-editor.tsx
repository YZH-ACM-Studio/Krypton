import { ArrowLeft, Save } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { PROBLEM_KIND_TO_SLUG } from '@hydrooj/common';
import { MarkdownEditor } from '@/components/markdown-renderer';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { useBootstrap } from '@/lib/bootstrap';
import { cn } from '@/lib/cn';

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
  const dirtyRef = useRef(false);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (dirtyRef.current) event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      const response = await fetch(event.currentTarget.action || window.location.pathname, {
        method: 'POST',
        body: new URLSearchParams(new FormData(event.currentTarget) as any),
        credentials: 'same-origin',
      });
      if (!response.ok) throw new Error(await errorMessage(response));
      dirtyRef.current = false;
      if (response.redirected) window.location.assign(response.url);
      else {
        const body = await response.json();
        if (!body?.pid) throw new Error('保存响应缺少 pid');
        window.location.assign(`/p/${body.pid}/edit`);
      }
    } catch (caught: any) {
      setError(caught?.message || '保存失败');
      setSaving(false);
    }
  };

  return (
    <main className="mx-auto w-full max-w-5xl space-y-5 pb-10">
      <header className="flex items-center gap-3 border-b border-border/70 pb-4">
        <Button asChild variant="ghost" size="icon" className="size-11">
          <a href={isCreate ? '/problem/create' : `/p/${pid}`} aria-label="返回"><ArrowLeft className="size-4" /></a>
        </Button>
        <div className="min-w-0 flex-1">
          <p className="text-xs text-muted-foreground">主观题编辑器</p>
          <h1 className="truncate text-2xl font-semibold tracking-tight">
            {isCreate ? '新建主观题' : `编辑 ${pdoc.title || '主观题'}`}
          </h1>
        </div>
        <Button type="submit" form="subjective-form" disabled={saving} className="min-h-11 gap-1.5">
          <Save className="size-4" />{saving ? '保存中…' : '保存'}
        </Button>
      </header>

      {locked ? (
        <p className="border-y border-amber-300 bg-amber-50 px-3 py-3 text-sm text-amber-900">
          该题结构已锁定；仍可修改标题、标签和可见性。题面或阅卷说明调整请克隆新题。
        </p>
      ) : null}
      {error ? <p role="alert" className="border-y border-destructive/40 px-3 py-3 text-sm text-destructive">{error}</p> : null}

      <form
        id="subjective-form"
        method="post"
        onSubmit={submit}
        onChange={() => { dirtyRef.current = true; }}
        className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]"
      >
        {locked ? <input type="hidden" name="metadataOnly" value="true" /> : (
          <>
            <input type="hidden" name="editorProblemKind" value={PROBLEM_KIND_TO_SLUG.subjective} />
            <input
              type="hidden"
              name="structuredConfig"
              value={JSON.stringify({ main: { gradingInstructions: instructions } })}
            />
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

        <aside className="space-y-5 lg:border-l lg:border-border/70 lg:pl-5">
          <label className="block space-y-1.5">
            <span className="text-xs font-medium">标题</span>
            <Input name="title" defaultValue={pdoc.title || ''} required className="min-h-11" />
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs font-medium">标签</span>
            <Input name="tag" defaultValue={(pdoc.tag || []).join(', ')} placeholder="用逗号分隔" className="min-h-11" />
          </label>
          {isCreate ? (
            <p className="border-y border-border/70 py-3 text-xs text-muted-foreground">新题首次保存固定为隐藏。</p>
          ) : (
            <label className="flex min-h-11 items-center gap-2 border-y border-border/70 py-2 text-sm">
              <Checkbox name="hidden" defaultChecked={!!pdoc.hidden} />
              <span>隐藏题目</span>
            </label>
          )}
        </aside>
      </form>
    </main>
  );
}
