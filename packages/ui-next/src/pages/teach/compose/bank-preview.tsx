import { isBasicObjectiveKind } from '@hydrooj/common';
import type { TeachType } from '@hydrooj/common';
import { ExternalLink, Plus, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import { MarkdownView } from '@/components/markdown-renderer';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Switch } from '@/components/ui/switch';
import { toast } from '@/components/ui/toast';
import { TEACH_KIND_LABEL, parseTeachBankPreview } from '../model';
import type { TeachBankItem, TeachBankPreview, TeachObjectivePreview } from '../model';
import { getJson, postJson, teachApi } from '../api';

const SHARE_FALLBACK = '共享到学校题库失败';
const PREVIEW_FALLBACK = '题目预览加载失败';

function messageOf(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim() !== '') return error.message;
  return fallback;
}

function optionLetter(index: number): string | null {
  if (!Number.isInteger(index) || index < 0 || index > 25) return null;
  return String.fromCharCode(65 + index);
}

function sourceLabel(item: TeachBankItem): string {
  if (item.mine) return '我的题目';
  if (item.hidden && item.schoolShared) return `学校题库 · ${item.ownerName}共享的隐藏题`;
  if (!item.hidden) return '学校题库 · 公开题';
  return '学校题库 · 隐藏题';
}

function placeLabel(item: TeachBankItem, courseTitle: string | null): string {
  const titles = courseTitle ? [courseTitle, ...item.nodePath] : [...item.nodePath];
  return titles.filter((title) => title !== '').join(' › ');
}

function problemHref(item: TeachBankItem): string {
  const key = item.pid.trim() !== '' ? item.pid : String(item.docId);
  return `/p/${encodeURIComponent(key)}`;
}

function limitsLine(limits: TeachBankPreview['limits']): string | null {
  const parts: string[] = [];
  if (limits.timeMs !== null) parts.push(`时间限制 ${limits.timeMs} ms`);
  if (limits.memoryMb !== null) parts.push(`内存限制 ${limits.memoryMb} MiB`);
  return parts.length > 0 ? parts.join(' · ') : null;
}

function assertShareResult(payload: Record<string, unknown>, docId: number): void {
  const changed = payload.changed;
  const unchanged = payload.unchanged;
  if (!Array.isArray(changed) || !Array.isArray(unchanged)) {
    throw new TypeError('学校题库响应格式不正确');
  }
  const seen = [...changed, ...unchanged];
  if (!seen.includes(docId)) throw new TypeError(`学校题库响应没有题目 ${docId}`);
}

function AnswerLine({ label, marked }: { label: string; marked: boolean }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="text-fg">{label}</span>
      {marked ? <Badge tone="success" size="sm">标准答案</Badge> : null}
    </div>
  );
}

function ObjectiveView({ objective }: { objective: TeachObjectivePreview }): JSX.Element {
  if (objective.kind === 'true_false') {
    return (
      <div className="flex flex-col gap-1">
        <AnswerLine label="正确" marked={objective.answer} />
        <AnswerLine label="错误" marked={!objective.answer} />
      </div>
    );
  }
  if (objective.kind === 'blank') {
    return (
      <div className="flex items-start gap-2">
        <span className="min-w-0 flex-1 font-mono text-sm text-fg">{objective.answer}</span>
        <Badge tone="success" size="sm">标准答案</Badge>
      </div>
    );
  }
  if (objective.options.length > 26) {
    return <Alert tone="warning">选项超过 26 个，无法按字母显示。</Alert>;
  }
  const correct = new Set<number>(objective.kind === 'single' ? [objective.answerIndex] : objective.answerIndexes);
  const badge = objective.kind === 'single' ? '标准答案' : '正确';
  const outOfRange = [...correct].some((index) => index < 0 || index >= objective.options.length);
  if (outOfRange || objective.options.length === 0) {
    return <Alert tone="danger">标准答案超出选项范围。</Alert>;
  }
  const rows = objective.options.map((option, index) => {
    const letter = optionLetter(index);
    return { option, index, letter };
  });
  if (rows.some((row) => row.letter === null)) {
    return <Alert tone="warning">选项超过 26 个，无法按字母显示。</Alert>;
  }
  return (
    <ul className="flex flex-col gap-1">
      {rows.map((row) => (
        <li key={`${row.index}-${row.option}`} className="flex items-start gap-2 text-sm">
          <span className="w-5 shrink-0 font-medium text-fg">{row.letter}</span>
          <span className="min-w-0 flex-1 text-fg">{row.option}</span>
          {correct.has(row.index) ? <Badge tone="success" size="sm">{badge}</Badge> : null}
        </li>
      ))}
    </ul>
  );
}

function ObjectiveBlock({ preview }: { preview: TeachBankPreview }): JSX.Element | null {
  if (preview.objective && preview.objective.kind !== preview.item.kind) {
    return <Alert tone="danger">预览题型和标准答案不一致。</Alert>;
  }
  if (preview.objective) return <ObjectiveView objective={preview.objective} />;
  if (isBasicObjectiveKind(preview.item.kind)) {
    return <Alert tone="danger">这道客观题没有返回标准答案。</Alert>;
  }
  return null;
}

export function BankPreview({
  type,
  item,
  inPaper,
  locked,
  courseTitle,
  shareOverride,
  onSchoolShared,
  onSharePending,
  onPreviewItem,
  onAdd,
  onClose,
}: {
  type: TeachType;
  item: TeachBankItem;
  inPaper: boolean;
  locked: boolean;
  courseTitle: string | null;
  /** Last successful share in this pane. Absent until the teacher toggles, or the preview reports one. */
  shareOverride?: boolean;
  onSchoolShared: (docId: number, shared: boolean, posted: boolean) => void;
  onSharePending: (docId: number, pending: boolean) => void;
  onPreviewItem: (item: TeachBankItem) => void;
  onAdd: () => void;
  onClose: () => void;
}): JSX.Element {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [preview, setPreview] = useState<TeachBankPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [shared, setShared] = useState(shareOverride ?? item.schoolShared);
  const [sharing, setSharing] = useState(false);
  const confirmed = useRef(shareOverride ?? item.schoolShared);
  const sharingRef = useRef(false);
  const onSchoolSharedRef = useRef(onSchoolShared);
  const onSharePendingRef = useRef(onSharePending);
  const onPreviewItemRef = useRef(onPreviewItem);
  const shareOverrideRef = useRef(shareOverride);
  onSchoolSharedRef.current = onSchoolShared;
  onSharePendingRef.current = onSharePending;
  onPreviewItemRef.current = onPreviewItem;
  shareOverrideRef.current = shareOverride;
  const shown = preview?.item ?? item;
  const place = placeLabel(shown, courseTitle);
  const meta = [TEACH_KIND_LABEL[shown.kind], sourceLabel(shown), place].filter((part) => part !== '').join(' · ');
  const limits = preview ? limitsLine(preview.limits) : null;

  useEffect(() => {
    if (sharingRef.current) return;
    const next = shareOverride ?? item.schoolShared;
    confirmed.current = next;
    setShared(next);
  }, [item.docId, item.schoolShared, shareOverride]);

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const close = closeRef.current;
    if (close) close.focus({ preventScroll: true });
    else dialogRef.current?.focus({ preventScroll: true });
    return () => {
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setPreview(null);
    getPreview(type, item.docId)
      .then((parsed) => {
        if (cancelled) return;
        setPreview(parsed);
        onPreviewItemRef.current(parsed.item);
        if (sharingRef.current) return;
        const known = shareOverrideRef.current;
        const next = known ?? parsed.item.schoolShared;
        confirmed.current = next;
        setShared(next);
        if (known === undefined && parsed.item.schoolShared !== item.schoolShared) {
          onSchoolSharedRef.current(parsed.item.docId, parsed.item.schoolShared, false);
        }
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        console.error('teach bank preview failed', { type, docId: item.docId, error: caught });
        setError(messageOf(caught, PREVIEW_FALLBACK));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [type, item.docId]);

  async function toggleShare(next: boolean) {
    if (sharingRef.current) return;
    sharingRef.current = true;
    setSharing(true);
    setShared(next);
    onSharePendingRef.current(item.docId, true);
    try {
      const payload = await postJson(teachApi.schoolBank, { docIds: [item.docId], shared: next }, SHARE_FALLBACK);
      assertShareResult(payload, item.docId);
      confirmed.current = next;
      onSchoolSharedRef.current(item.docId, next, true);
      toast.success(next ? '已共享到学校题库' : '已取消共享');
    } catch (caught) {
      console.error('teach bank share failed', { docId: item.docId, shared: next, error: caught });
      setShared(confirmed.current);
      toast.error(messageOf(caught, SHARE_FALLBACK));
    } finally {
      sharingRef.current = false;
      setSharing(false);
      onSharePendingRef.current(item.docId, false);
    }
  }

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-label="题目预览"
      tabIndex={-1}
      className="absolute inset-0 z-10 flex min-h-0 flex-col bg-surface-raised outline-none"
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        event.stopPropagation();
        onClose();
      }}
    >
      <div className="flex items-start gap-2 border-b border-line px-3 py-3">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-fg">
            <span className="font-mono">{shown.pid}</span>
            {' '}
            {shown.title}
          </div>
          <p className="mt-1 text-xs text-fg-subtle">{meta}</p>
        </div>
        <Button ref={closeRef} type="button" variant="ghost" size="sm" iconOnly aria-label="关闭" onClick={onClose}>
          <X />
        </Button>
      </div>
      <ScrollArea className="min-h-0 flex-1" viewportLayout="block">
        <div className="flex flex-col gap-3 px-3 py-3">
          {loading ? <p className="text-sm text-fg-muted">正在加载题目…</p> : null}
          {error ? <Alert tone="danger">{error}</Alert> : null}
          {preview ? (
            <>
              <MarkdownView content={preview.content} />
              <ObjectiveBlock preview={preview} />
              {limits ? <p className="text-xs text-fg-subtle">{limits}</p> : null}
            </>
          ) : null}
        </div>
      </ScrollArea>
      <div className="flex flex-wrap items-center gap-2 border-t border-line px-3 py-2">
        <Button variant="ghost" size="sm" className="min-w-0" asChild>
          <a href={problemHref(shown)} target="_blank" rel="noopener noreferrer">
            <ExternalLink />
            在新标签页打开
          </a>
        </Button>
        {shown.mine ? (
          <span className="inline-flex items-center gap-2">
            <Switch
              size="sm"
              checked={shared}
              disabled={sharing}
              aria-label="共享到学校题库"
              onCheckedChange={(next) => {
                void toggleShare(next);
              }}
            />
            <span className="text-sm text-fg">共享到学校题库</span>
          </span>
        ) : null}
        <span className="flex-1" />
        {inPaper ? <span className="text-sm text-fg-muted">已经在试卷里</span> : (
          <Button type="button" variant="secondary" size="sm" disabled={locked} onClick={onAdd}>
            <Plus />
            加入试卷
          </Button>
        )}
      </div>
    </div>
  );
}

async function getPreview(type: TeachType, docId: number): Promise<TeachBankPreview> {
  const raw = await getJson(teachApi.bankPreview(type, docId), PREVIEW_FALLBACK);
  const parsed = parseTeachBankPreview(raw);
  if (parsed.item.docId !== docId) {
    throw new TypeError(`题目预览 ${parsed.item.docId} 与 ${docId} 不一致`);
  }
  return parsed;
}
