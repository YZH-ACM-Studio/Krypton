import { Bold, Code, CodeXml, Heading3, Italic, List, Sigma, Table2 } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { MarkdownView } from '@/components/markdown-renderer';
import { Button } from '@/components/ui/button';
import { MiniTabs } from '@/components/ui/mini-tabs';
import { SimpleSelect } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/cn';

type EditorMode = 'edit' | 'split' | 'preview';
type Format = 'heading' | 'bold' | 'italic' | 'code' | 'fence' | 'math' | 'displayMath' | 'list' | 'table';
type SnapshotKind = '进入页面' | '编辑快照' | '已保存';
interface Snapshot {
  id: string;
  value: string;
  kind: SnapshotKind;
  at: string;
}

const FORMATS = [
  { value: 'heading', label: '三级标题', icon: Heading3 },
  { value: 'bold', label: '加粗', icon: Bold },
  { value: 'italic', label: '斜体', icon: Italic },
  { value: 'code', label: '行内代码', icon: Code },
  { value: 'fence', label: '代码块', icon: CodeXml },
  { value: 'math', label: '行内公式', icon: Sigma },
  { value: 'displayMath', label: '独立公式', icon: Sigma },
  { value: 'list', label: '无序列表', icon: List },
  { value: 'table', label: '对比表格', icon: Table2 },
] as const;

function formatSelection(value: string, start: number, end: number, format: Format) {
  const selected = value.slice(start, end);
  let content = selected;
  let before = '';
  let after = '';
  let block = false;
  switch (format) {
    case 'heading':
      before = '### ';
      content ||= '小标题';
      block = true;
      break;
    case 'bold':
      before = '**';
      after = '**';
      content ||= '加粗文字';
      break;
    case 'italic':
      before = '*';
      after = '*';
      content ||= '斜体文字';
      break;
    case 'code':
      before = '`';
      after = '`';
      content ||= '代码';
      break;
    case 'fence':
      before = '```\n';
      after = '\n```';
      content ||= '代码';
      block = true;
      break;
    case 'math':
      before = '$';
      after = '$';
      content ||= 'x^2';
      break;
    case 'displayMath':
      before = '$$\n';
      after = '\n$$';
      content ||= 'x^2';
      block = true;
      break;
    case 'list':
      content = (selected || '列表项')
        .split('\n')
        .map((line) => `- ${line}`)
        .join('\n');
      block = true;
      break;
    case 'table':
      content = `| ${selected.replace(/\r?\n/g, ' ').replace(/\|/g, '\\|') || '项目'} | 说明 |\n| --- | --- |\n| 内容 | 内容 |`;
      block = true;
      break;
  }
  if (block && start > 0 && value[start - 1] !== '\n') before = `\n${before}`;
  if (block && end < value.length && value[end] !== '\n') after += '\n';
  return {
    value: value.slice(0, start) + before + content + after + value.slice(end),
    start: start + before.length,
    end: start + before.length + content.length,
  };
}

/** Snapshots are page-session editing aids. Only the parent CAS save publishes answers. */
export function WorkspaceSubjectiveEditor({
  value,
  onChange,
  disabled = false,
  savedValue,
  savedVersion,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  savedValue?: string;
  savedVersion?: number;
}) {
  const textarea = useRef<HTMLTextAreaElement>(null);
  const selection = useRef<{ start: number; end: number } | null>(null);
  const sequence = useRef(0);
  const [mode, setMode] = useState<EditorMode>('edit');
  const [expanded, setExpanded] = useState(false);
  const [snapshots, setSnapshots] = useState<Snapshot[]>(() => [
    { id: 'initial', value, kind: '进入页面', at: new Date().toLocaleTimeString('zh-CN', { hour12: false }) },
  ]);
  const remember = useCallback((text: string, kind: SnapshotKind) => {
    const snapshot: Snapshot = {
      id: `snapshot-${++sequence.current}`,
      value: text,
      kind,
      at: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
    };
    setSnapshots((current) => {
      const last = current[current.length - 1];
      if (last.value === text) return kind === '已保存' && last.kind !== kind ? [...current.slice(0, -1), { ...last, kind }] : current;
      return [...current, snapshot].slice(-20);
    });
  }, []);
  useEffect(() => {
    if (disabled) return;
    const timer = window.setTimeout(() => remember(value, '编辑快照'), 1500);
    return () => window.clearTimeout(timer);
  }, [value, disabled, remember]);
  useEffect(() => {
    if (savedValue !== undefined && savedVersion !== undefined && savedVersion > 0) remember(savedValue, '已保存');
  }, [savedValue, savedVersion, remember]);
  useLayoutEffect(() => {
    if (!selection.current || !textarea.current || mode === 'preview' || disabled) return;
    textarea.current.focus();
    textarea.current.setSelectionRange(selection.current.start, selection.current.end);
    selection.current = null;
  }, [value, mode, disabled]);

  const insertFormat = (format: Format) => {
    const input = textarea.current;
    if (disabled || mode === 'preview' || !input) return;
    remember(value, '编辑快照');
    const edited = formatSelection(value, input.selectionStart, input.selectionEnd, format);
    selection.current = { start: edited.start, end: edited.end };
    onChange(edited.value);
  };
  const restore = (id: string) => {
    if (disabled) return;
    const snapshot = snapshots.find((entry) => entry.id === id);
    if (!snapshot) throw new Error(`草稿快照 ${id} 不存在`);
    remember(value, '编辑快照');
    if (snapshot.value === value && mode === 'edit') {
      selection.current = null;
      textarea.current?.focus();
      textarea.current?.setSelectionRange(value.length, value.length);
      return;
    }
    selection.current = { start: snapshot.value.length, end: snapshot.value.length };
    setMode('edit');
    onChange(snapshot.value);
  };

  return (
    <div className="min-w-0 border border-line bg-surface" aria-label="主观题编辑器">
      <div className="flex flex-wrap items-center gap-1 border-b border-line bg-surface-sunken px-2 py-1.5">
        <div className="flex min-w-0 flex-wrap items-center gap-1" role="toolbar" aria-label="答案格式">
          {FORMATS.map(({ value: format, label, icon: Icon }) => (
            <Button
              key={format}
              variant="ghost"
              size="sm"
              aria-label={label}
              title={label}
              iconOnly
              disabled={disabled || mode === 'preview'}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => insertFormat(format)}
            >
              <Icon />
            </Button>
          ))}
        </div>
        <div className="ml-auto flex min-w-0 flex-wrap items-center gap-2">
          <MiniTabs
            aria-label="答案编辑模式"
            value={mode}
            onValueChange={(next) => {
              if (!disabled) remember(value, '编辑快照');
              setMode(next);
            }}
            items={[
              { value: 'edit', label: '编辑' },
              { value: 'split', label: '分栏预览' },
              { value: 'preview', label: '预览' },
            ]}
          />
          <Button variant="ghost" size="sm" className="w-16" aria-pressed={expanded} onClick={() => setExpanded((current) => !current)}>
            {expanded ? '收起' : '增高'}
          </Button>
        </div>
      </div>
      <div
        className={cn(
          'grid min-w-0 overflow-hidden',
          expanded ? 'h-128' : 'h-64',
          mode === 'split' ? 'grid-cols-1 grid-rows-2 md:grid-cols-2 md:grid-rows-1' : 'grid-cols-1',
        )}
      >
        <div hidden={mode === 'preview'} className={cn('min-h-0 min-w-0', mode === 'preview' && 'hidden')}>
          <Textarea
            ref={textarea}
            value={value}
            disabled={disabled}
            placeholder="在此作答（主观题）"
            aria-label="主观题答案"
            className="h-full min-h-0 resize-none rounded-none border-0 font-mono shadow-none"
            onChange={(event) => {
              if (!event.target.value && value) remember(value, '编辑快照');
              onChange(event.target.value);
            }}
            onBlur={() => {
              if (!disabled) remember(value, '编辑快照');
            }}
          />
        </div>
        {mode !== 'edit' ? (
          <div
            className={cn('min-h-0 min-w-0 overflow-auto p-4', mode === 'split' && 'border-t border-line md:border-t-0 md:border-l')}
            aria-label="答案预览"
          >
            {value.trim() ? <MarkdownView content={value} /> : <p className="text-sm text-fg-subtle">输入答案后在这里预览。</p>}
          </div>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-line bg-surface-sunken px-3 py-1.5 text-2xs text-fg-subtle">
        <span className="tabular">{`净字数 ${[...value.replace(/\s/g, '')].length}`}</span>
        <span className="tabular">{`行数 ${value.split('\n').length}`}</span>
        <SimpleSelect
          ariaLabel="恢复草稿快照"
          size="sm"
          className="ml-auto w-40"
          value=""
          disabled={disabled}
          onValueChange={restore}
          options={[
            { value: '', label: '恢复草稿快照', disabled: true },
            ...[...snapshots].reverse().map((snapshot) => ({
              value: snapshot.id,
              label: `${snapshot.kind} ${snapshot.at}`,
              hint: snapshot.value.slice(0, 40) || '空白答案',
            })),
          ]}
        />
        <span>快照仅保留在本页</span>
      </div>
    </div>
  );
}
