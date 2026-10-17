import { isTeachGroupedByKind, TEACH_KIND_ORDER } from '@hydrooj/common';
import type { ProblemKind, TeachType } from '@hydrooj/common';
import { useEffect, useState } from 'react';
import { Copy } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/display';
import { DescriptionList } from '@/components/ui/panel';
import { getJson, teachApi } from './api';
import {
  formatTeachWindow,
  OI_RULE_LABEL,
  parseTeachCopySource,
  TEACH_KIND_LABEL,
  TEACH_TYPE_LABEL,
} from './model';
import type { TeachCopySource } from './model';

const PREVIEW_FAILED = '这份题目集现在预览不了。';

interface SharedPreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  type: TeachType;
  id: string;
}

type PreviewPhase =
  | { kind: 'loading' }
  | { kind: 'ready'; source: TeachCopySource }
  | { kind: 'error'; message: string };

interface PreviewState {
  key: string;
  phase: PreviewPhase;
}

function previewErrorText(error: unknown): string {
  if (error instanceof TypeError) return PREVIEW_FAILED;
  if (error instanceof Error && error.message.trim() !== '') return error.message;
  return PREVIEW_FAILED;
}

export function teachSetTypeLabel(type: TeachType, rule: string): string {
  const base = TEACH_TYPE_LABEL[type];
  if (type !== 'oi') return base;
  const ruleLabel = OI_RULE_LABEL[rule];
  if (ruleLabel === undefined) throw new TypeError(`teach_oi_rule_invalid:${rule}`);
  return `${base} · ${ruleLabel}`;
}

function problemCountText(source: TeachCopySource): string {
  const pool = source.problems.length;
  if (source.examPaperQuotas === null) return `${pool} 道`;
  let each = 0;
  for (const value of Object.values(source.examPaperQuotas)) {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
      throw new TypeError('teach_quota_invalid');
    }
    each += value;
  }
  return `题库 ${pool} 道，每人 ${each} 道`;
}

function problemGroups(source: TeachCopySource): Array<{ kind: ProblemKind | null; problems: TeachCopySource['problems'] }> {
  if (!isTeachGroupedByKind(source.type)) {
    return [{ kind: null, problems: source.problems }];
  }
  const buckets = new Map<ProblemKind, TeachCopySource['problems']>();
  for (const problem of source.problems) {
    const existing = buckets.get(problem.kind);
    if (existing) existing.push(problem);
    else buckets.set(problem.kind, [problem]);
  }
  const groups: Array<{ kind: ProblemKind | null; problems: TeachCopySource['problems'] }> = [];
  for (const kind of TEACH_KIND_ORDER) {
    const problems = buckets.get(kind);
    if (!problems) continue;
    groups.push({ kind, problems });
    buckets.delete(kind);
  }
  if (buckets.size > 0) throw new TypeError('teach_problem_kind_invalid');
  return groups;
}

function PreviewProblems({ source }: { source: TeachCopySource }) {
  const groups = problemGroups(source);
  if (groups.every((group) => group.problems.length === 0)) return null;
  return (
    <div className="flex flex-col gap-4">
      {groups.map((group) => (
        <section key={group.kind ?? 'flat'}>
          {group.kind ? <h3 className="mb-1 text-sm font-medium text-fg">{TEACH_KIND_LABEL[group.kind]}</h3> : null}
          <ul className="divide-y divide-line-subtle">
            {group.problems.map((problem) => (
              <li key={problem.docId} className="flex min-w-0 items-baseline gap-3 py-2">
                <span className="shrink-0 font-mono text-xs text-fg-subtle">{problem.pid}</span>
                <span className="min-w-0 truncate text-sm text-fg">{problem.title}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function assertPreviewRenderable(source: TeachCopySource): void {
  teachSetTypeLabel(source.type, source.rule);
  formatTeachWindow({
    type: source.type,
    beginAt: source.beginAt,
    endAt: source.endAt,
    durationMinutes: source.durationMinutes,
  }, new Date());
  problemCountText(source);
  problemGroups(source);
}

function PreviewBody({ phase }: { phase: PreviewPhase }) {
  if (phase.kind === 'loading') return <Skeleton className="h-40 w-full" />;
  if (phase.kind === 'error') return <Alert tone="danger">{phase.message}</Alert>;
  const source = phase.source;
  return (
    <div className="flex flex-col gap-4">
      <DescriptionList
        items={[
          { term: '类型', detail: teachSetTypeLabel(source.type, source.rule) },
          {
            term: '原来的时间',
            detail: formatTeachWindow({
              type: source.type,
              beginAt: source.beginAt,
              endAt: source.endAt,
              durationMinutes: source.durationMinutes,
            }, new Date()),
          },
          { term: '题目数', detail: problemCountText(source) },
        ]}
      />
      <PreviewProblems source={source} />
    </div>
  );
}

export function SharedPreviewDialog({ open, onOpenChange, type, id }: SharedPreviewDialogProps) {
  const requestKey = open && id !== '' ? `${type}:${id}` : '';
  const [state, setState] = useState<PreviewState>({ key: '', phase: { kind: 'loading' } });
  const phase: PreviewPhase = state.key === requestKey ? state.phase : { kind: 'loading' };
  const source = phase.kind === 'ready' ? phase.source : null;

  useEffect(() => {
    if (!open || id === '') {
      setState((current) => (
        current.key === '' && current.phase.kind === 'loading'
          ? current
          : { key: '', phase: { kind: 'loading' } }
      ));
      return undefined;
    }
    const key = `${type}:${id}`;
    let cancelled = false;
    setState({ key, phase: { kind: 'loading' } });
    const run = async () => {
      try {
        const raw = await getJson(teachApi.copyable(type, id), PREVIEW_FAILED);
        if (cancelled) return;
        const next = parseTeachCopySource(raw);
        if (next.type !== type || next.id !== id) throw new TypeError('teach_preview_identity_mismatch');
        assertPreviewRenderable(next);
        if (cancelled) return;
        setState({ key, phase: { kind: 'ready', source: next } });
      } catch (error: unknown) {
        if (cancelled) return;
        console.error('teach shared preview failed', { type, id, error });
        setState({ key, phase: { kind: 'error', message: previewErrorText(error) } });
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [open, type, id]);

  const title = source?.title ?? '题目集';
  const description = source ? `${source.ownerName} 共享 · ${teachSetTypeLabel(source.type, source.rule)}` : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        <DialogBody>
          <PreviewBody phase={phase} />
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" type="button" onClick={() => onOpenChange(false)}>关闭</Button>
          <Button variant="primary" asChild>
            <a href={`/teach/new?copy=${encodeURIComponent(type)}:${encodeURIComponent(id)}`}>
              <Copy />
              使用这个题目集
            </a>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
