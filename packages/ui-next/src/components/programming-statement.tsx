import { ArrowDown, ArrowUp, CheckCircle2, CircleDashed, Eye, FileText, Plus, Trash2 } from 'lucide-react';
import { type ReactNode, useMemo, useState } from 'react';
import { MarkdownEditor, MarkdownView } from '@/components/markdown-renderer';
import { SampleCopyButton } from '@/components/sample-blocks';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { SimpleSelect } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

export type StatementState = 'undecided' | 'present' | 'absent';

export interface ProgrammingStatementExample {
  input: string;
  inputEmpty: boolean;
  output: string;
  outputEmpty: boolean;
  note: string;
}

export interface ProgrammingStatementCanonical {
  schemaVersion: 1;
  locale: 'zh-CN';
  background: { state: StatementState; content: string };
  description: { state: 'undecided' | 'present'; content: string };
  input: { state: StatementState; content: string };
  output: { state: StatementState; content: string };
  examples: { state: StatementState; items: ProgrammingStatementExample[] };
  hints: { state: StatementState; content: string };
}

export interface ProgrammingStatementViewData {
  schemaVersion: 1;
  locale: 'zh-CN';
  background?: { content: string };
  description: { state: 'undecided' | 'present'; content: string };
  input: { state: StatementState; content: string };
  output: { state: StatementState; content: string };
  examples?: { items: ProgrammingStatementExample[] };
  hints?: { content: string };
  limits: { complete: boolean; time: unknown; memory: unknown };
}

export function emptyProgrammingStatement(): ProgrammingStatementCanonical {
  return {
    schemaVersion: 1,
    locale: 'zh-CN',
    background: { state: 'undecided', content: '' },
    description: { state: 'undecided', content: '' },
    input: { state: 'undecided', content: '' },
    output: { state: 'undecided', content: '' },
    examples: { state: 'undecided', items: [] },
    hints: { state: 'undecided', content: '' },
  };
}

export function structuredStatementSamples(view: ProgrammingStatementViewData | null | undefined) {
  return (view?.examples?.items || []).map((item, index) => ({
    id: index + 1,
    input: item.inputEmpty ? '' : item.input,
    output: item.outputEmpty ? '' : item.output,
  }));
}

function Section({ title, children, icon = <FileText className="size-4" /> }: { title: string; children: ReactNode; icon?: ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
        <span className="text-muted-foreground">{icon}</span>
        {title}
      </h2>
      {children}
    </section>
  );
}

export function ProgrammingStatementView({
  statement,
  preferredLang,
  limits,
}: {
  statement: ProgrammingStatementViewData;
  preferredLang?: string;
  limits: ReactNode;
}) {
  return (
    <div className="space-y-8" data-programming-statement="structured-v1">
      {statement.background ? (
        <Section title="题目背景">
          <MarkdownView content={statement.background.content} preferredLang={preferredLang} />
        </Section>
      ) : null}
      <Section title="题目描述">
        {statement.description.state === 'present' ? (
          <MarkdownView content={statement.description.content} preferredLang={preferredLang} />
        ) : (
          <p className="text-sm text-amber-600 dark:text-amber-400">题目描述尚未完成。</p>
        )}
      </Section>
      <Section title="输入格式">
        {statement.input.state === 'absent' ? (
          <p className="text-sm">本题无输入。</p>
        ) : statement.input.state === 'present' ? (
          <MarkdownView content={statement.input.content} preferredLang={preferredLang} />
        ) : (
          <p className="text-sm text-amber-600 dark:text-amber-400">输入格式尚未决定。</p>
        )}
      </Section>
      <Section title="输出格式">
        {statement.output.state === 'absent' ? (
          <p className="text-sm">本题无输出。</p>
        ) : statement.output.state === 'present' ? (
          <MarkdownView content={statement.output.content} preferredLang={preferredLang} />
        ) : (
          <p className="text-sm text-amber-600 dark:text-amber-400">输出格式尚未决定。</p>
        )}
      </Section>
      {statement.examples ? (
        <Section title="样例">
          <div className="space-y-4">
            {statement.examples.items.map((item, index) => (
              <article key={`${index}-${item.input}-${item.output}`} className="overflow-hidden rounded-xl border bg-muted/15">
                <header className="border-b px-4 py-2 text-sm font-medium">样例 {index + 1}</header>
                <div className="grid gap-px bg-border md:grid-cols-2">
                  <div className="bg-card p-4">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <p className="text-xs font-medium text-muted-foreground">输入</p>
                      <SampleCopyButton label={`样例 ${index + 1} 输入`} content={item.inputEmpty ? '' : item.input} />
                    </div>
                    <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-sm">{item.inputEmpty ? '（空）' : item.input}</pre>
                  </div>
                  <div className="bg-card p-4">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <p className="text-xs font-medium text-muted-foreground">输出</p>
                      <SampleCopyButton label={`样例 ${index + 1} 输出`} content={item.outputEmpty ? '' : item.output} />
                    </div>
                    <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-sm">{item.outputEmpty ? '（空）' : item.output}</pre>
                  </div>
                </div>
                {item.note.trim() ? (
                  <div className="border-t px-4 py-3">
                    <MarkdownView content={item.note} preferredLang={preferredLang} />
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        </Section>
      ) : null}
      <Section title="时空限制">{limits}</Section>
      {statement.hints ? (
        <Section title="提示">
          <MarkdownView content={statement.hints.content} preferredLang={preferredLang} />
        </Section>
      ) : null}
    </div>
  );
}

type TextSectionKey = 'background' | 'input' | 'output' | 'hints';

const SECTION_LABELS: Record<TextSectionKey | 'description' | 'examples', string> = {
  background: '题目背景',
  description: '题目描述',
  input: '输入格式',
  output: '输出格式',
  examples: '样例',
  hints: '总提示',
};

function completion(statement: ProgrammingStatementCanonical) {
  const entries = [
    ['background', statement.background.state],
    ['description', statement.description.state],
    ['input', statement.input.state],
    ['output', statement.output.state],
    ['examples', statement.examples.state],
    ['hints', statement.hints.state],
  ] as const;
  const missing = entries.filter(([, state]) => state === 'undecided').map(([key]) => ({ key, label: SECTION_LABELS[key] }));
  return { missing, completed: entries.length - missing.length, total: entries.length };
}

function stateOptions(allowAbsent: boolean) {
  return [
    { value: 'undecided', label: '尚未决定' },
    { value: 'present', label: '填写内容' },
    ...(allowAbsent ? [{ value: 'absent', label: '明确没有' }] : []),
  ];
}

function EditorCard({
  sectionKey,
  title,
  state,
  allowAbsent,
  onState,
  children,
}: {
  sectionKey: TextSectionKey | 'description' | 'examples';
  title: string;
  state: StatementState;
  allowAbsent: boolean;
  onState: (state: StatementState) => void;
  children: ReactNode;
}) {
  return (
    <section className="scroll-mt-6 overflow-hidden rounded-2xl border border-border/70 bg-card/35" id={`statement-${sectionKey}`}>
      <header className="flex flex-col gap-3 border-b border-border/60 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          {state === 'undecided' ? <CircleDashed className="size-4 text-amber-500" /> : <CheckCircle2 className="size-4 text-emerald-500" />}
          <h3 className="font-semibold">{title}</h3>
        </div>
        <SimpleSelect value={state} options={stateOptions(allowAbsent)} onValueChange={(value) => onState(value as StatementState)} />
      </header>
      {state === 'present' ? <div className="p-5">{children}</div> : null}
      {state === 'absent' ? <p className="px-5 py-4 text-sm text-muted-foreground">已明确该区块不存在。</p> : null}
      {state === 'undecided' ? <p className="px-5 py-4 text-sm text-amber-700 dark:text-amber-300">保存草稿可以保留，发布前必须决定。</p> : null}
    </section>
  );
}

export function ProgrammingStatementEditor({
  value,
  onChange,
  filesBase,
  problemUrl,
  limitsPreview,
}: {
  value: ProgrammingStatementCanonical;
  onChange: (value: ProgrammingStatementCanonical) => void;
  filesBase?: string;
  problemUrl: string;
  limitsPreview?: ReactNode;
}) {
  const [pendingAbsent, setPendingAbsent] = useState<TextSectionKey | 'examples' | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const summary = useMemo(() => completion(value), [value]);
  const pasteUpload = filesBase
    ? {
        endpoint: filesBase,
        meta: { type: 'additional_file' },
        makeUrl: (filename: string) => `file://${filename}`,
      }
    : undefined;
  const previewFileUrl = (filename: string, original: string) => {
    const queryIndex = original.indexOf('?');
    const query = queryIndex >= 0 ? original.slice(queryIndex) : '';
    return `${problemUrl}/file/${encodeURIComponent(filename)}${query}`;
  };

  const setTextState = (key: TextSectionKey, state: StatementState) => {
    const current = value[key];
    if (state === 'absent' && current.content) {
      setPendingAbsent(key);
      return;
    }
    onChange({ ...value, [key]: { state, content: state === 'absent' ? '' : current.content } });
  };
  const setExamplesState = (state: StatementState) => {
    if (state === 'absent' && value.examples.items.length) {
      setPendingAbsent('examples');
      return;
    }
    onChange({ ...value, examples: { state, items: state === 'absent' ? [] : value.examples.items } });
  };
  const confirmAbsent = () => {
    if (!pendingAbsent) return;
    if (pendingAbsent === 'examples') onChange({ ...value, examples: { state: 'absent', items: [] } });
    else onChange({ ...value, [pendingAbsent]: { state: 'absent', content: '' } });
    setPendingAbsent(null);
  };
  const setTextContent = (key: TextSectionKey, content: string) => onChange({ ...value, [key]: { ...value[key], content } });
  const updateExample = (index: number, patch: Partial<ProgrammingStatementExample>) => {
    const items = value.examples.items.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item));
    onChange({ ...value, examples: { ...value.examples, items } });
  };
  const moveExample = (index: number, direction: -1 | 1) => {
    const next = index + direction;
    if (next < 0 || next >= value.examples.items.length) return;
    const items = [...value.examples.items];
    [items[index], items[next]] = [items[next], items[index]];
    onChange({ ...value, examples: { ...value.examples, items } });
  };

  const preview: ProgrammingStatementViewData = {
    schemaVersion: 1,
    locale: 'zh-CN',
    ...(value.background.state === 'present' ? { background: { content: value.background.content } } : {}),
    description: { ...value.description },
    input: { ...value.input },
    output: { ...value.output },
    ...(value.examples.state === 'present' ? { examples: { items: value.examples.items } } : {}),
    ...(value.hints.state === 'present' ? { hints: { content: value.hints.content } } : {}),
    limits: { complete: false, time: null, memory: null },
  };

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-border/70 bg-muted/20 p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-semibold">
              已决定 {summary.completed}/{summary.total} 个区块
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {summary.missing.length
                ? `待决定：${summary.missing.map((item) => item.label).join('、')}`
                : '区块状态已全部决定；发布仍会校验正文、样例和评测限制。'}
            </p>
          </div>
          <Button type="button" variant="outline" className="gap-2" onClick={() => setPreviewOpen(true)}>
            <Eye className="size-4" />
            完整题面预览
          </Button>
        </div>
        {summary.missing.length ? (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {summary.missing.map((item) => (
              <Badge key={item.key} variant="outline">
                <a href={`#statement-${item.key}`} className="rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  {item.label}
                </a>
              </Badge>
            ))}
          </div>
        ) : null}
      </div>

      <EditorCard
        sectionKey="background"
        title="题目背景"
        state={value.background.state}
        allowAbsent
        onState={(state) => setTextState('background', state)}
      >
        <MarkdownEditor
          value={value.background.content}
          onChange={(content) => setTextContent('background', content)}
          minHeight={220}
          pasteUpload={pasteUpload}
          previewFileUrl={previewFileUrl}
        />
      </EditorCard>
      <EditorCard
        sectionKey="description"
        title="题目描述"
        state={value.description.state}
        allowAbsent={false}
        onState={(state) => onChange({ ...value, description: { ...value.description, state: state as 'undecided' | 'present' } })}
      >
        <MarkdownEditor
          value={value.description.content}
          onChange={(content) => onChange({ ...value, description: { ...value.description, content } })}
          minHeight={320}
          pasteUpload={pasteUpload}
          previewFileUrl={previewFileUrl}
        />
      </EditorCard>
      <EditorCard sectionKey="input" title="输入格式" state={value.input.state} allowAbsent onState={(state) => setTextState('input', state)}>
        <MarkdownEditor
          value={value.input.content}
          onChange={(content) => setTextContent('input', content)}
          minHeight={220}
          pasteUpload={pasteUpload}
          previewFileUrl={previewFileUrl}
        />
      </EditorCard>
      <EditorCard sectionKey="output" title="输出格式" state={value.output.state} allowAbsent onState={(state) => setTextState('output', state)}>
        <MarkdownEditor
          value={value.output.content}
          onChange={(content) => setTextContent('output', content)}
          minHeight={220}
          pasteUpload={pasteUpload}
          previewFileUrl={previewFileUrl}
        />
      </EditorCard>
      <EditorCard sectionKey="examples" title="样例" state={value.examples.state} allowAbsent onState={setExamplesState}>
        <div className="space-y-4">
          {value.examples.items.map((item, index) => (
            <article key={index} className="overflow-hidden rounded-xl border">
              <header className="flex items-center gap-2 border-b bg-muted/25 px-4 py-3">
                <span className="font-medium">样例 {index + 1}</span>
                <div className="ml-auto flex gap-1">
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    disabled={index === 0}
                    onClick={() => moveExample(index, -1)}
                    aria-label={`上移样例 ${index + 1}`}
                  >
                    <ArrowUp className="size-4" />
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    disabled={index === value.examples.items.length - 1}
                    onClick={() => moveExample(index, 1)}
                    aria-label={`下移样例 ${index + 1}`}
                  >
                    <ArrowDown className="size-4" />
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    onClick={() =>
                      onChange({
                        ...value,
                        examples: { ...value.examples, items: value.examples.items.filter((_, itemIndex) => itemIndex !== index) },
                      })
                    }
                    aria-label={`删除样例 ${index + 1}`}
                  >
                    <Trash2 className="size-4 text-destructive" />
                  </Button>
                </div>
              </header>
              <div className="grid gap-4 p-4 md:grid-cols-2">
                {(['input', 'output'] as const).map((side) => {
                  const emptyKey = `${side}Empty` as const;
                  return (
                    <div key={side} className="space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <label className="text-sm font-medium">{side === 'input' ? '输入' : '输出'}</label>
                        <label className="flex items-center gap-2 text-xs text-muted-foreground">
                          <Checkbox
                            checked={item[emptyKey]}
                            onCheckedChange={(checked) => updateExample(index, { [emptyKey]: checked, ...(checked ? { [side]: '' } : {}) })}
                          />
                          该侧为空
                        </label>
                      </div>
                      <Textarea
                        value={item[side]}
                        disabled={item[emptyKey]}
                        className="min-h-32 font-mono"
                        onChange={(event) => updateExample(index, { [side]: event.target.value })}
                      />
                    </div>
                  );
                })}
              </div>
              <div className="border-t p-4">
                <p className="mb-2 text-sm font-medium">样例说明（可选 Markdown）</p>
                <MarkdownEditor
                  value={item.note}
                  onChange={(note) => updateExample(index, { note })}
                  minHeight={160}
                  pasteUpload={pasteUpload}
                  previewFileUrl={previewFileUrl}
                />
              </div>
            </article>
          ))}
          <Button
            type="button"
            variant="outline"
            className="w-full gap-2"
            onClick={() =>
              onChange({
                ...value,
                examples: {
                  ...value.examples,
                  items: [...value.examples.items, { input: '', inputEmpty: false, output: '', outputEmpty: false, note: '' }],
                },
              })
            }
          >
            <Plus className="size-4" />
            新增样例
          </Button>
        </div>
      </EditorCard>
      <section className="rounded-2xl border border-border/70 bg-card/35 p-5">
        <h3 className="font-semibold">时空限制</h3>
        <p className="mt-1 text-sm text-muted-foreground">始终读取当前评测配置，不在题面中保存第二份限制。</p>
        <div className="mt-4">{limitsPreview || <p className="text-sm text-amber-600">请在评测配置中完成时间与内存限制。</p>}</div>
      </section>
      <EditorCard sectionKey="hints" title="总提示" state={value.hints.state} allowAbsent onState={(state) => setTextState('hints', state)}>
        <MarkdownEditor
          value={value.hints.content}
          onChange={(content) => setTextContent('hints', content)}
          minHeight={220}
          pasteUpload={pasteUpload}
          previewFileUrl={previewFileUrl}
        />
      </EditorCard>

      <Dialog open={pendingAbsent !== null} onOpenChange={(open) => !open && setPendingAbsent(null)}>
        <DialogContent className="w-full sm:w-[480px]" onClose={() => setPendingAbsent(null)}>
          <DialogHeader>
            <DialogTitle>确认清空区块</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 p-5">
            <p className="text-sm leading-6 text-muted-foreground">
              切换为“明确没有”会永久清空{pendingAbsent ? SECTION_LABELS[pendingAbsent] : '该区块'}当前内容，保存后无法恢复。
            </p>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setPendingAbsent(null)}>
                取消
              </Button>
              <Button type="button" variant="destructive" onClick={confirmAbsent}>
                清空并标记为无
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-h-[88vh] w-full overflow-y-auto sm:w-[900px]" onClose={() => setPreviewOpen(false)}>
          <DialogHeader>
            <DialogTitle>完整题面预览</DialogTitle>
          </DialogHeader>
          <div className="p-6">
            <ProgrammingStatementView statement={preview} limits={limitsPreview || <p className="text-sm text-amber-600">评测限制尚未完成。</p>} />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
