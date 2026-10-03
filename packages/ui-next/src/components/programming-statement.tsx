import { ArrowDown, ArrowUp, CheckCircle2, CircleDashed, Eye, FileText, Plus, Trash2 } from 'lucide-react';
import { type ReactNode, useMemo, useState } from 'react';
import { MarkdownEditor, MarkdownView } from '@/components/markdown-renderer';
import { SampleCopyButton } from '@/components/sample-blocks';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Panel } from '@/components/ui/panel';
import { SimpleSelect } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import type { AntiAiMarkerClientMarker, AntiAiMarkerDraft } from '@/lib/anti-ai-marker';

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
    <section className="min-w-0 space-y-3">
      <h2 className="flex min-w-0 items-center gap-2 text-lg font-semibold">
        <span className="shrink-0 text-fg-subtle">{icon}</span>
        <span className="min-w-0">{title}</span>
      </h2>
      {children}
    </section>
  );
}

export function ProgrammingStatementView({
  statement,
  preferredLang,
  limits,
  antiAiMarkers = [],
}: {
  statement: ProgrammingStatementViewData;
  preferredLang?: string;
  limits: ReactNode;
  antiAiMarkers?: readonly AntiAiMarkerClientMarker[];
}) {
  return (
    <div className="min-w-0 space-y-8" data-programming-statement="structured-v1">
      {statement.background ? (
        <Section title="题目背景">
          <MarkdownView
            content={statement.background.content}
            preferredLang={preferredLang}
            antiAiPath="programmingStatement.background"
            antiAiMarkers={antiAiMarkers}
          />
        </Section>
      ) : null}
      <Section title="题目描述">
        {statement.description.state === 'present' ? (
          <MarkdownView
            content={statement.description.content}
            preferredLang={preferredLang}
            antiAiPath="programmingStatement.description"
            antiAiMarkers={antiAiMarkers}
          />
        ) : (
          <p className="text-sm text-warning-fg">题目描述尚未完成。</p>
        )}
      </Section>
      <Section title="输入格式">
        {statement.input.state === 'absent' ? (
          <p className="text-sm text-fg">本题无输入。</p>
        ) : statement.input.state === 'present' ? (
          <MarkdownView
            content={statement.input.content}
            preferredLang={preferredLang}
            antiAiPath="programmingStatement.input"
            antiAiMarkers={antiAiMarkers}
          />
        ) : (
          <p className="text-sm text-warning-fg">输入格式尚未决定。</p>
        )}
      </Section>
      <Section title="输出格式">
        {statement.output.state === 'absent' ? (
          <p className="text-sm text-fg">本题无输出。</p>
        ) : statement.output.state === 'present' ? (
          <MarkdownView
            content={statement.output.content}
            preferredLang={preferredLang}
            antiAiPath="programmingStatement.output"
            antiAiMarkers={antiAiMarkers}
          />
        ) : (
          <p className="text-sm text-warning-fg">输出格式尚未决定。</p>
        )}
      </Section>
      {statement.examples ? (
        <Section title="样例">
          <div className="space-y-4">
            {statement.examples.items.map((item, index) => (
              <article key={`${index}-${item.input}-${item.output}`} className="min-w-0 space-y-3">
                <header className="text-sm font-medium text-fg">样例 {index + 1}</header>
                <div className="grid min-w-0 gap-3 sm:grid-cols-2">
                  <div className="min-w-0 overflow-hidden rounded-md border border-line bg-surface-sunken">
                    <div className="flex h-8 items-center justify-between border-b border-line-subtle px-3">
                      <p className="min-w-0 text-xs font-medium text-fg-muted">输入</p>
                      <SampleCopyButton label={`样例 ${index + 1} 输入`} content={item.inputEmpty ? '' : item.input} />
                    </div>
                    <pre className="overflow-x-auto px-3 py-2.5 font-mono text-sm leading-relaxed">{item.inputEmpty ? '（空）' : item.input}</pre>
                  </div>
                  <div className="min-w-0 overflow-hidden rounded-md border border-line bg-surface-sunken">
                    <div className="flex h-8 items-center justify-between border-b border-line-subtle px-3">
                      <p className="min-w-0 text-xs font-medium text-fg-muted">输出</p>
                      <SampleCopyButton label={`样例 ${index + 1} 输出`} content={item.outputEmpty ? '' : item.output} />
                    </div>
                    <pre className="overflow-x-auto px-3 py-2.5 font-mono text-sm leading-relaxed">{item.outputEmpty ? '（空）' : item.output}</pre>
                  </div>
                </div>
                {item.note.trim() ? (
                  <div className="border-t border-line-subtle pt-3">
                    <MarkdownView
                      content={item.note}
                      preferredLang={preferredLang}
                      antiAiPath={`programmingStatement.examples.${index}.note`}
                      antiAiMarkers={antiAiMarkers}
                    />
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
          <MarkdownView
            content={statement.hints.content}
            preferredLang={preferredLang}
            antiAiPath="programmingStatement.hints"
            antiAiMarkers={antiAiMarkers}
          />
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
    <section id={`statement-${sectionKey}`} className="scroll-mt-6">
      <Panel
        as="div"
        title={
          <span className="inline-flex min-w-0 items-center gap-2">
            {state === 'undecided' ? (
              <CircleDashed className="size-4 shrink-0 text-warning-fg" />
            ) : (
              <CheckCircle2 className="size-4 shrink-0 text-success-fg" />
            )}
            <span className="min-w-0">{title}</span>
          </span>
        }
        actions={<SimpleSelect value={state} options={stateOptions(allowAbsent)} onValueChange={(value) => onState(value as StatementState)} />}
      >
        {state === 'present' ? children : null}
        {state === 'absent' ? <p className="text-sm text-fg-muted">已明确该区块不存在。</p> : null}
        {state === 'undecided' ? <p className="text-sm text-warning-fg">保存草稿可以保留，发布前必须决定。</p> : null}
      </Panel>
    </section>
  );
}

export function ProgrammingStatementEditor({
  value,
  onChange,
  filesBase,
  problemUrl,
  limitsPreview,
  authorizeImageUpload,
  antiAiMarkers = [],
  onAntiAiMarkersChange,
}: {
  value: ProgrammingStatementCanonical;
  onChange: (value: ProgrammingStatementCanonical) => void;
  filesBase?: string;
  problemUrl: string;
  limitsPreview?: ReactNode;
  authorizeImageUpload?: () => Promise<Record<string, string> | false>;
  antiAiMarkers?: AntiAiMarkerDraft[];
  onAntiAiMarkersChange?: (markers: AntiAiMarkerDraft[]) => void;
}) {
  const [pendingAbsent, setPendingAbsent] = useState<TextSectionKey | 'examples' | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const summary = useMemo(() => completion(value), [value]);
  const pasteUpload = filesBase
    ? {
        endpoint: filesBase,
        meta: { type: 'additional_file' },
        makeUrl: (filename: string) => `file://${filename}`,
        authorize: authorizeImageUpload,
      }
    : undefined;
  const previewFileUrl = (filename: string, original: string) => {
    const queryIndex = original.indexOf('?');
    const query = queryIndex >= 0 ? original.slice(queryIndex) : '';
    return `${problemUrl}/file/${encodeURIComponent(filename)}${query}`;
  };

  const setTextState = (key: TextSectionKey, state: StatementState) => {
    const current = value[key];
    const markerPath = `programmingStatement.${key}`;
    if (state === 'absent' && (current.content || antiAiMarkers.some((marker) => marker.anchor.path === markerPath))) {
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
    if (pendingAbsent === 'examples') {
      onAntiAiMarkersChange?.(antiAiMarkers.filter((marker) => !marker.anchor.path.startsWith('programmingStatement.examples.')));
      onChange({ ...value, examples: { state: 'absent', items: [] } });
    } else {
      onAntiAiMarkersChange?.(antiAiMarkers.filter((marker) => marker.anchor.path !== `programmingStatement.${pendingAbsent}`));
      onChange({ ...value, [pendingAbsent]: { state: 'absent', content: '' } });
    }
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
    const currentPath = `programmingStatement.examples.${index}.note`;
    const nextPath = `programmingStatement.examples.${next}.note`;
    onAntiAiMarkersChange?.(
      antiAiMarkers.map((marker) => {
        if (marker.anchor.path === currentPath) return { ...marker, anchor: { ...marker.anchor, path: nextPath } };
        if (marker.anchor.path === nextPath) return { ...marker, anchor: { ...marker.anchor, path: currentPath } };
        return marker;
      }),
    );
    onChange({ ...value, examples: { ...value.examples, items } });
  };
  const removeExample = (index: number) => {
    const deletedPath = `programmingStatement.examples.${index}.note`;
    if (antiAiMarkers.some((marker) => marker.anchor.path === deletedPath)) return;
    const nextMarkers = antiAiMarkers.map((marker) => {
      const match = /^programmingStatement\.examples\.(\d+)\.note$/.exec(marker.anchor.path);
      if (!match || Number(match[1]) <= index) return marker;
      return {
        ...marker,
        anchor: { ...marker.anchor, path: `programmingStatement.examples.${Number(match[1]) - 1}.note` },
      };
    });
    onAntiAiMarkersChange?.(nextMarkers);
    onChange({ ...value, examples: { ...value.examples, items: value.examples.items.filter((_, itemIndex) => itemIndex !== index) } });
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
      <Panel
        title={<span className="tabular">已决定 {summary.completed}/{summary.total} 个区块</span>}
        description={
          summary.missing.length
            ? `待决定：${summary.missing.map((item) => item.label).join('、')}`
            : '区块状态已全部决定；发布仍会校验正文、样例和评测限制。'
        }
        actions={
          <Button type="button" variant="secondary" onClick={() => setPreviewOpen(true)}>
            <Eye />
            完整题面预览
          </Button>
        }
      >
        {summary.missing.length ? (
          <div className="flex flex-wrap gap-1.5">
            {summary.missing.map((item) => (
              <Badge key={item.key} variant="outline">
                <a href={`#statement-${item.key}`} className="rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
                  {item.label}
                </a>
              </Badge>
            ))}
          </div>
        ) : null}
      </Panel>

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
          antiAiPath="programmingStatement.background"
          antiAiMarkers={antiAiMarkers}
          onAntiAiMarkersChange={onAntiAiMarkersChange}
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
          antiAiPath="programmingStatement.description"
          antiAiMarkers={antiAiMarkers}
          onAntiAiMarkersChange={onAntiAiMarkersChange}
          minHeight={320}
          pasteUpload={pasteUpload}
          previewFileUrl={previewFileUrl}
        />
      </EditorCard>
      <EditorCard sectionKey="input" title="输入格式" state={value.input.state} allowAbsent onState={(state) => setTextState('input', state)}>
        <MarkdownEditor
          value={value.input.content}
          onChange={(content) => setTextContent('input', content)}
          antiAiPath="programmingStatement.input"
          antiAiMarkers={antiAiMarkers}
          onAntiAiMarkersChange={onAntiAiMarkersChange}
          minHeight={220}
          pasteUpload={pasteUpload}
          previewFileUrl={previewFileUrl}
        />
      </EditorCard>
      <EditorCard sectionKey="output" title="输出格式" state={value.output.state} allowAbsent onState={(state) => setTextState('output', state)}>
        <MarkdownEditor
          value={value.output.content}
          onChange={(content) => setTextContent('output', content)}
          antiAiPath="programmingStatement.output"
          antiAiMarkers={antiAiMarkers}
          onAntiAiMarkersChange={onAntiAiMarkersChange}
          minHeight={220}
          pasteUpload={pasteUpload}
          previewFileUrl={previewFileUrl}
        />
      </EditorCard>
      <EditorCard sectionKey="examples" title="样例" state={value.examples.state} allowAbsent onState={setExamplesState}>
        <div className="space-y-4">
          {value.examples.items.map((item, index) => (
            <article key={index} className="min-w-0 overflow-hidden rounded-md bg-surface-sunken">
              <header className="flex min-w-0 items-center gap-2 border-b border-line-subtle px-3 py-2">
                <span className="min-w-0 text-sm font-medium text-fg">样例 {index + 1}</span>
                <div className="ml-auto flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    iconOnly
                    variant="ghost"
                    disabled={index === 0}
                    onClick={() => moveExample(index, -1)}
                    aria-label={`上移样例 ${index + 1}`}
                  >
                    <ArrowUp />
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    iconOnly
                    variant="ghost"
                    disabled={index === value.examples.items.length - 1}
                    onClick={() => moveExample(index, 1)}
                    aria-label={`下移样例 ${index + 1}`}
                  >
                    <ArrowDown />
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    iconOnly
                    variant="danger-soft"
                    onClick={() => removeExample(index)}
                    disabled={antiAiMarkers.some((marker) => marker.anchor.path === `programmingStatement.examples.${index}.note`)}
                    title={
                      antiAiMarkers.some((marker) => marker.anchor.path === `programmingStatement.examples.${index}.note`)
                        ? '请先删除该样例说明中的防 AI 标记'
                        : undefined
                    }
                    aria-label={`删除样例 ${index + 1}`}
                  >
                    <Trash2 />
                  </Button>
                </div>
              </header>
              <div className="grid min-w-0 gap-4 p-4 sm:grid-cols-2">
                {(['input', 'output'] as const).map((side) => {
                  const emptyKey = `${side}Empty` as const;
                  return (
                    <div key={side} className="space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <label className="text-sm font-medium text-fg">{side === 'input' ? '输入' : '输出'}</label>
                        <label className="flex items-center gap-2 text-xs text-fg-subtle">
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
              <div className="border-t border-line-subtle p-4">
                <p className="mb-2 text-sm font-medium text-fg">样例说明（可选 Markdown）</p>
                <MarkdownEditor
                  value={item.note}
                  onChange={(note) => updateExample(index, { note })}
                  antiAiPath={`programmingStatement.examples.${index}.note`}
                  antiAiMarkers={antiAiMarkers}
                  onAntiAiMarkersChange={onAntiAiMarkersChange}
                  minHeight={160}
                  pasteUpload={pasteUpload}
                  previewFileUrl={previewFileUrl}
                />
              </div>
            </article>
          ))}
          <Button
            type="button"
            variant="secondary"
            className="w-full"
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
            <Plus />
            新增样例
          </Button>
        </div>
      </EditorCard>
      <Panel title="时空限制" description="始终读取当前评测配置，不在题面中保存第二份限制。">
        {limitsPreview || <p className="text-sm text-warning-fg">请在评测配置中完成时间与内存限制。</p>}
      </Panel>
      <EditorCard sectionKey="hints" title="总提示" state={value.hints.state} allowAbsent onState={(state) => setTextState('hints', state)}>
        <MarkdownEditor
          value={value.hints.content}
          onChange={(content) => setTextContent('hints', content)}
          antiAiPath="programmingStatement.hints"
          antiAiMarkers={antiAiMarkers}
          onAntiAiMarkersChange={onAntiAiMarkersChange}
          minHeight={220}
          pasteUpload={pasteUpload}
          previewFileUrl={previewFileUrl}
        />
      </EditorCard>

      <Dialog open={pendingAbsent !== null} onOpenChange={(open) => !open && setPendingAbsent(null)}>
        <DialogContent size="md" onClose={() => setPendingAbsent(null)}>
          <DialogHeader>
            <DialogTitle>确认清空区块</DialogTitle>
          </DialogHeader>
          <DialogBody>
            <p className="text-sm text-fg-muted">
              切换为“明确没有”会永久清空{pendingAbsent ? SECTION_LABELS[pendingAbsent] : '该区块'}当前内容和防 AI 标记，保存后无法恢复。
            </p>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setPendingAbsent(null)}>
              取消
            </Button>
            <Button type="button" variant="danger" onClick={confirmAbsent}>
              清空并标记为无
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent size="xl" className="min-h-0 min-w-0" onClose={() => setPreviewOpen(false)}>
          <DialogHeader>
            <DialogTitle className="min-w-0">完整题面预览</DialogTitle>
          </DialogHeader>
          <DialogBody>
            <ProgrammingStatementView statement={preview} limits={limitsPreview || <p className="text-sm text-warning-fg">评测限制尚未完成。</p>} />
          </DialogBody>
        </DialogContent>
      </Dialog>
    </div>
  );
}
