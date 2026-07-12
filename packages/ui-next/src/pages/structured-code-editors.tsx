import { ArrowDown, ArrowLeft, ArrowUp, Copy, Plus, Save, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { MarkdownEditor } from '@/components/markdown-renderer';
import { StructuredRegionInputs } from '@/components/structured-region-inputs';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { SimpleSelect } from '@/components/ui/select';
import { useBootstrap } from '@/lib/bootstrap';
import { cn } from '@/lib/cn';

type R = Record<string, any>;
interface RegionMeta { id: string, prompt: string }
interface CaseMeta { input: string, output: string }

async function responseMessage(response: Response) {
  if (response.status === 409) return '题目结构已锁定或已被其他窗口修改，请重新载入。';
  const body = await response.json().catch(() => null);
  return body?.error?.message || body?.message || `保存失败（HTTP ${response.status}）`;
}

function move<T>(items: T[], index: number, delta: number) {
  const target = index + delta;
  if (target < 0 || target >= items.length) return items;
  const next = [...items];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

function CasesEditor({ cases, onChange }: { cases: CaseMeta[], onChange: (cases: CaseMeta[]) => void }) {
  return (
    <section className="space-y-3 border-t border-border/70 pt-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">测试数据映射</h2>
          <p className="text-xs text-muted-foreground">填写已上传的输入/输出文件名；发布前服务端会逐一核对。</p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onChange([...cases, { input: '', output: '' }])}
        >
          <Plus className="size-3.5" />添加测试点
        </Button>
      </div>
      {cases.map((item, index) => (
        <div key={index} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
          <Input
            value={item.input}
            onChange={(event) => onChange(cases.map((row, i) => (
              i === index ? { ...row, input: event.target.value } : row
            )))}
            placeholder="1.in"
          />
          <Input
            value={item.output}
            onChange={(event) => onChange(cases.map((row, i) => (
              i === index ? { ...row, output: event.target.value } : row
            )))}
            placeholder="1.out"
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => onChange(cases.filter((_, i) => i !== index))}
            aria-label="删除测试点"
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      ))}
      {!cases.length ? <p className="text-sm text-destructive">编译评测至少需要一个测试点。</p> : null}
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
  const [mode, setMode] = useState<'text' | 'compile'>(initial.mode === 'compile' ? 'compile' : 'text');
  const [answer, setAnswer] = useState(String(initial.answer || ''));
  const [lang, setLang] = useState(String(initial.lang || ''));
  const [markerSource, setMarkerSource] = useState(String(initial.markerSource || ''));
  const [regions, setRegions] = useState<RegionMeta[]>(() => {
    if (kind === 'program_fill') return [{ id: 'main', prompt: String(initial.regions?.[0]?.prompt || '') }];
    return Array.isArray(initial.regions)
      ? initial.regions.map((item: R) => ({ id: String(item.id || ''), prompt: String(item.prompt || '') }))
      : [];
  });
  const [cases, setCases] = useState<CaseMeta[]>(() => Array.isArray(initial.cases)
    ? initial.cases.map((item: R) => ({ input: String(item.input || ''), output: String(item.output || '') }))
    : []);
  const [saving, setSaving] = useState(false);
  const [cloning, setCloning] = useState(false);
  const [error, setError] = useState('');
  const dirtyRef = useRef(false);
  const compileMode = kind === 'function' || mode === 'compile';
  const langOptions = Object.entries(data.langRange || {}).map(([value, label]) => ({ value, label: String(label) }));
  const cloneLangOptions = langOptions.filter((option) => option.value !== lang);
  const [cloneLang, setCloneLang] = useState('');

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (dirtyRef.current) event.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);

  const structuredConfig = useMemo(() => ({
    main: kind === 'program_fill' && !compileMode
      ? { mode: 'text', answer }
      : { mode: kind === 'program_fill' ? 'compile' : 'function', lang, markerSource, regions, cases },
  }), [answer, cases, compileMode, kind, lang, markerSource, regions]);

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
      if (!response.ok) throw new Error(await responseMessage(response));
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
          operation: 'copy', pids: String(pdoc.docId), target: String(bs.domain.id),
          hidden: 'true', cloneLang,
        }),
      });
      if (!response.ok) throw new Error(await responseMessage(response));
      const ids = await response.json();
      if (!Array.isArray(ids) || !ids[0]) throw new Error('克隆响应缺少新题 ID');
      window.location.assign(`/p/${ids[0]}/edit`);
    } catch (caught: any) {
      setError(caught?.message || '克隆失败');
      setCloning(false);
    }
  };

  return (
    <main className="mx-auto w-full max-w-6xl space-y-5 pb-10">
      <header className="flex flex-wrap items-center gap-3 border-b border-border/70 pb-4">
        <Button asChild variant="ghost" size="icon" className="size-11">
          <a href={isCreate ? '/p' : `/p/${pid}`} aria-label="返回"><ArrowLeft className="size-4" /></a>
        </Button>
        <div className="min-w-0 flex-1">
          <p className="text-xs text-muted-foreground">代码评测单题编辑器</p>
          <h1 className="truncate text-2xl font-semibold tracking-tight">
            {isCreate ? `新建${kind === 'program_fill' ? '程序填空题' : '函数题'}` : `编辑 ${pdoc.title || '题目'}`}
          </h1>
        </div>
        <Button type="submit" form="structured-code-form" disabled={saving} className="min-h-11 gap-1.5">
          <Save className="size-4" />{saving ? '保存中…' : '保存'}
        </Button>
      </header>

      {locked ? (
        <p className="border-y border-amber-300 bg-amber-50 px-3 py-3 text-sm text-amber-900">
          结构已锁定；仅可修改标题、标签和可见性。
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="border-y border-destructive/40 px-3 py-3 text-sm text-destructive">{error}</p>
      ) : null}

      <form
        id="structured-code-form"
        method="post"
        onSubmit={submit}
        onChange={() => { dirtyRef.current = true; }}
        className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_19rem]"
      >
        {locked ? <input type="hidden" name="metadataOnly" value="true" /> : (
          <>
            <input type="hidden" name="editorProblemKind" value={kind} />
            <input type="hidden" name="structuredConfig" value={JSON.stringify(structuredConfig)} />
            {!isCreate ? <input type="hidden" name="expectedStructureRevision" value={pdoc.structureRevision} /> : null}
          </>
        )}

        <fieldset disabled={locked} className={cn('min-w-0 space-y-6', locked && 'opacity-60')}>
          <section className="space-y-3">
            <h2 className="text-sm font-semibold">题面</h2>
            <MarkdownEditor name="content" value={pdoc.content || ''} minHeight={300} />
          </section>

          {kind === 'program_fill' ? (
            <section className="space-y-3 border-t border-border/70 pt-5">
              <h2 className="text-sm font-semibold">评测方式</h2>
              <SimpleSelect
                value={mode}
                onValueChange={(value) => setMode(value as 'text' | 'compile')}
                disabled={!isCreate}
                options={[{ value: 'text', label: '文本比对' }, { value: 'compile', label: '拼接编译' }]}
              />
              {!isCreate ? <p className="text-xs text-muted-foreground">评测方式创建后不可切换。</p> : null}
            </section>
          ) : null}

          {!compileMode ? (
            <section className="space-y-2 border-t border-border/70 pt-5">
              <h2 className="text-sm font-semibold">标准答案（单行）</h2>
              <Input
                value={answer}
                onChange={(event) => setAnswer(event.target.value.replace(/[\r\n]/g, ''))}
                className="font-mono"
              />
            </section>
          ) : (
            <>
              <section className="space-y-3 border-t border-border/70 pt-5">
                <div>
                  <h2 className="text-sm font-semibold">语言与完整模板</h2>
                  <p className="text-xs text-muted-foreground">
                    语言创建后不可修改。用成对 marker 标记学生填写区域，marker 行不会进入编译源码。
                  </p>
                </div>
                <SimpleSelect
                  value={lang}
                  onValueChange={setLang}
                  disabled={!isCreate}
                  options={langOptions.length ? langOptions : [{ value: lang, label: lang || '请选择语言' }]}
                />
                <textarea
                  value={markerSource}
                  onChange={(event) => setMarkerSource(event.target.value)}
                  rows={18}
                  spellCheck={false}
                  className="w-full rounded-md border bg-background p-3 font-mono text-xs"
                  placeholder={'// @krypton-region main\ni++\n// @krypton-endregion main'}
                />
              </section>

              <section className="space-y-3 border-t border-border/70 pt-5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-semibold">可填写 regions</h2>
                    <p className="text-xs text-muted-foreground">ID 必须与模板 marker 一一对应；顺序决定学生答题顺序。</p>
                  </div>
                  {kind === 'function' ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setRegions([
                        ...regions,
                        { id: `region${regions.length + 1}`, prompt: '' },
                      ])}
                    >
                      <Plus className="size-3.5" />添加
                    </Button>
                  ) : null}
                </div>
                {regions.map((region, index) => (
                  <div key={`${region.id}-${index}`} className="grid gap-2 sm:grid-cols-[10rem_1fr_auto]">
                    <Input
                      value={region.id}
                      disabled={kind === 'program_fill'}
                      onChange={(event) => setRegions(regions.map((item, i) => (
                        i === index ? { ...item, id: event.target.value } : item
                      )))}
                      className="font-mono"
                    />
                    <Input
                      value={region.prompt}
                      onChange={(event) => setRegions(regions.map((item, i) => (
                        i === index ? { ...item, prompt: event.target.value } : item
                      )))}
                      placeholder="函数签名或填写说明"
                    />
                    {kind === 'function' ? (
                      <div className="flex">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => setRegions(move(regions, index, -1))}
                          aria-label="上移"
                        ><ArrowUp className="size-4" /></Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => setRegions(move(regions, index, 1))}
                          aria-label="下移"
                        ><ArrowDown className="size-4" /></Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => setRegions(regions.filter((_, i) => i !== index))}
                          aria-label="删除"
                        ><Trash2 className="size-4" /></Button>
                      </div>
                    ) : null}
                  </div>
                ))}
                <div className="border-y border-border/70 py-4">
                  <p className="mb-3 text-xs font-medium text-muted-foreground">学生输入预览（不展示后台完整模板）</p>
                  <StructuredRegionInputs regions={regions} values={{}} onChange={() => {}} singleLine={kind === 'program_fill'} readOnly />
                </div>
              </section>
              <CasesEditor cases={cases} onChange={setCases} />
            </>
          )}
        </fieldset>

        <aside className="space-y-5 lg:border-l lg:border-border/70 lg:pl-5">
          <label className="block space-y-1.5">
            <span className="text-xs font-medium">标题</span>
            <Input name="title" defaultValue={pdoc.title || ''} required />
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs font-medium">题目编号</span>
            <Input
              name="pid"
              defaultValue={typeof pdoc.pid === 'string' ? pdoc.pid : ''}
              placeholder="留空自动分配"
              disabled={locked}
            />
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs font-medium">标签</span>
            <Input name="tag" defaultValue={(pdoc.tag || []).join(', ')} />
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs font-medium">难度 1–10</span>
            <Input
              name="difficulty"
              type="number"
              min={1}
              max={10}
              defaultValue={pdoc.difficulty || ''}
              disabled={locked}
            />
          </label>
          {isCreate ? <p className="border-y py-3 text-xs text-muted-foreground">新题首次保存固定为隐藏。</p> : (
            <label className="flex min-h-11 items-center gap-2 border-y py-2 text-sm">
              <Checkbox name="hidden" defaultChecked={!!pdoc.hidden} />
              <span>隐藏题目</span>
            </label>
          )}
          {compileMode && !isCreate ? (
            <div className="space-y-2 border-y py-3 text-xs text-muted-foreground">
              <p>测试数据文件：{(data.testdata || []).length} 个</p>
              <Button asChild variant="outline" size="sm"><a href={`/p/${pid}/files`}>管理测试数据</a></Button>
            </div>
          ) : null}
          {compileMode && !isCreate && cloneLangOptions.length ? (
            <div className="space-y-2 border-y py-3">
              <p className="text-xs font-medium">克隆为其他语言</p>
              <SimpleSelect
                value={cloneLang}
                onValueChange={setCloneLang}
                options={[{ value: '', label: '选择目标语言' }, ...cloneLangOptions]}
              />
              <p className="text-xs text-muted-foreground">
                新题保持隐藏并物理复制测试数据；进入新题后再改写目标语言模板。
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={cloning || !cloneLang}
                onClick={cloneForLanguage}
              >
                <Copy className="size-3.5" />{cloning ? '克隆中…' : '创建语言副本'}
              </Button>
            </div>
          ) : null}
        </aside>
      </form>
    </main>
  );
}

export function ProgramFillProblemEditorPage() {
  return <StructuredCodeEditor kind="program_fill" />;
}

export function FunctionProblemEditorPage() {
  return <StructuredCodeEditor kind="function" />;
}
