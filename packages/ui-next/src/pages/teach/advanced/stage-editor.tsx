import { Component, useEffect, useState, type ErrorInfo, type ReactElement, type ReactNode } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { MultiSelect } from '@/components/ui/multi-select';
import { toast } from '@/components/ui/toast';
import { useUnsavedChangesGuard } from '@/components/unsaved-changes-guard';
import { practiceFormBody, type PracticeFormState, type PracticeStage } from '../legacy-forms';
import type { TeachWorkbenchPayload } from '../model';
import { useLegacySnapshot, useWorkbenchDirty, type AnyLegacySnapshot } from '../settings-kit';

const MOVE_PROBLEMS = '先在「编辑题目」里把这一阶段的题移走';
const TITLE_PLACEHOLDER = '阶段名称';
const PREREQ_PLACEHOLDER = '无先修';

function cloneStage(stage: PracticeStage): PracticeStage {
  return {
    id: stage.id,
    title: stage.title,
    requireIds: [...stage.requireIds],
    pids: [...stage.pids],
  };
}

function sameStages(left: readonly PracticeStage[], right: readonly PracticeStage[]): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function duplicateStageId(stages: readonly PracticeStage[]): boolean {
  const seen = new Set<number>();
  for (const stage of stages) {
    if (seen.has(stage.id)) return true;
    seen.add(stage.id);
  }
  return false;
}

function nextStageId(stages: readonly PracticeStage[]): number {
  let max = 0;
  const seen = new Set<number>();
  for (const stage of stages) {
    if (!Number.isSafeInteger(stage.id) || stage.id <= 0 || seen.has(stage.id)) {
      throw new TypeError('阶段编号无效。');
    }
    seen.add(stage.id);
    if (stage.id > max) max = stage.id;
  }
  const next = max + 1;
  if (!Number.isSafeInteger(next)) throw new TypeError('阶段编号无效。');
  return next;
}

function liveStageIds(stages: readonly PracticeStage[]): Set<number> {
  const ids = new Set<number>();
  for (const stage of stages) ids.add(stage.id);
  return ids;
}

/** Keep prerequisites that still point at another remaining stage, including ones listed later. */
function retainedRequireIds(requireIds: readonly number[], selfId: number, liveIds: ReadonlySet<number>): number[] {
  const kept: number[] = [];
  const seen = new Set<number>();
  for (const id of requireIds) {
    if (id === selfId || !liveIds.has(id) || seen.has(id)) continue;
    seen.add(id);
    kept.push(id);
  }
  return kept;
}

function mergeStages(draft: readonly PracticeStage[], latest: readonly PracticeStage[]): PracticeStage[] {
  if (draft.length === 0) throw new TypeError('练习至少要留一个阶段。');
  const latestById = new Map<number, PracticeStage>();
  for (const stage of latest) {
    if (!Number.isSafeInteger(stage.id) || stage.id <= 0 || latestById.has(stage.id)) {
      throw new TypeError('阶段编号无效。');
    }
    latestById.set(stage.id, stage);
  }
  const liveIds = liveStageIds(draft);
  const seen = new Set<number>();
  return draft.map((stage) => {
    if (!Number.isSafeInteger(stage.id) || stage.id <= 0 || seen.has(stage.id)) {
      throw new TypeError('阶段编号无效。');
    }
    seen.add(stage.id);
    const saved = latestById.get(stage.id);
    return {
      id: stage.id,
      title: stage.title,
      requireIds: retainedRequireIds(stage.requireIds, stage.id, liveIds),
      pids: saved ? [...saved.pids] : [],
    };
  });
}

const MISSING_DIRTY_PROVIDER = 'useWorkbenchDirty must be used inside WorkbenchDirtyProvider';

function AdvancedDirtySync({ dirty }: { dirty: boolean }): null {
  const { setTabDirty } = useWorkbenchDirty();
  useEffect(() => {
    setTabDirty('advanced', dirty);
    return () => setTabDirty('advanced', false);
  }, [dirty, setTabDirty]);
  return null;
}

class OptionalAdvancedDirty extends Component<{ dirty: boolean }, { skipped: boolean }> {
  state = { skipped: false };

  static getDerivedStateFromError(error: unknown): { skipped: boolean } | null {
    if (error instanceof Error && error.message === MISSING_DIRTY_PROVIDER) return { skipped: true };
    return null;
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    if (error instanceof Error && error.message === MISSING_DIRTY_PROVIDER) return;
    console.error('teach stage dirty sync failed', { error, info });
  }

  render(): ReactNode {
    if (this.state.skipped) return null;
    return <AdvancedDirtySync dirty={this.props.dirty} />;
  }
}

function messageOf(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim() !== '') return error.message;
  return fallback;
}

function SnapshotProblem({
  message,
  onRetry,
  retrying,
}: {
  message: string;
  onRetry: () => void;
  retrying: boolean;
}): ReactElement {
  return (
    <Alert
      tone="danger"
      action={(
        <Button type="button" variant="secondary" size="sm" onClick={onRetry} disabled={retrying}>
          重试
        </Button>
      )}
    >
      {message}
    </Alert>
  );
}

function PracticeStageEditor({ practiceId }: { practiceId: string }): ReactElement {
  const legacy = useLegacySnapshot();
  const [draft, setDraft] = useState<PracticeStage[] | null>(null);
  const [baseline, setBaseline] = useState<PracticeStage[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const practice = legacy.snapshot?.kind === 'practice' ? legacy.snapshot.value : null;
  const aligned = practice?.tid === practiceId ? practice : null;
  const duplicated = aligned ? duplicateStageId(aligned.state.stages) : false;
  const snapshotError = legacy.status === 'error'
    ? (legacy.error && legacy.error.trim() !== '' ? legacy.error : '题目集设置没有加载出来。')
    : null;

  useEffect(() => {
    if (!aligned || duplicated) return;
    const next = aligned.state.stages.map(cloneStage);
    setBaseline(next);
    setDraft((current) => current ?? next.map(cloneStage));
    setError(null);
  }, [aligned, duplicated]);

  const dirty = draft !== null && baseline !== null && !sameStages(draft, baseline);
  const guard = useUnsavedChangesGuard(dirty);

  const onRetry = () => {
    if (retrying) return;
    setRetrying(true);
    void legacy.reload().catch((caught: unknown) => {
      console.error('teach stage reload failed', { id: practiceId, error: caught });
    }).finally(() => {
      setRetrying(false);
    });
  };

  const onAdd = () => {
    if (!draft || saving) return;
    try {
      const id = nextStageId(draft);
      setDraft([...draft, { id, title: '', requireIds: [], pids: [] }]);
      setError(null);
    } catch (caught) {
      console.error('teach stage add failed', { id: practiceId, error: caught });
      setError(messageOf(caught, '不能添加阶段。'));
    }
  };

  const onDelete = (id: number) => {
    if (saving) return;
    setDraft((current) => {
      if (!current || current.length <= 1) return current;
      const target = current.find((stage) => stage.id === id);
      if (!target || target.pids.length > 0) return current;
      return current
        .filter((stage) => stage.id !== id)
        .map((stage) => ({ ...stage, requireIds: stage.requireIds.filter((req) => req !== id) }));
    });
  };

  const onSave = async () => {
    if (!draft || saving) return;
    setSaving(true);
    setError(null);
    const written: { stages: PracticeStage[] | null } = { stages: null };
    try {
      await legacy.save((latest: AnyLegacySnapshot) => {
        if (latest.kind !== 'practice' || latest.value.tid !== practiceId) {
          throw new TypeError('这份阶段数据不属于当前练习。');
        }
        const stages = mergeStages(draft, latest.value.state.stages);
        written.stages = stages;
        const state: PracticeFormState = { ...latest.value.state, stages };
        return practiceFormBody(state);
      });
      // POST and the following refresh both finished. A thrown save stops above, so a failed POST never replaces the draft.
      if (written.stages) {
        const saved = written.stages.map(cloneStage);
        setDraft(saved);
        setBaseline(saved.map(cloneStage));
      }
      toast.success('阶段已保存');
    } catch (caught) {
      console.error('teach stage save failed', { id: practiceId, error: caught });
      setError(messageOf(caught, '保存失败。'));
    } finally {
      setSaving(false);
    }
  };

  const banner = snapshotError ?? error;
  let body: ReactElement;
  if (!draft) {
    if (snapshotError) {
      body = <SnapshotProblem message={snapshotError} onRetry={onRetry} retrying={retrying} />;
    } else if (legacy.status === 'loading' || (aligned && !duplicated)) {
      body = <p className="text-sm text-fg-muted">正在加载阶段。</p>;
    } else if (!practice) {
      body = <Alert tone="danger">阶段编辑只用于练习。</Alert>;
    } else if (!aligned) {
      body = <Alert tone="danger">这份阶段数据不属于当前练习。</Alert>;
    } else {
      body = <Alert tone="danger">阶段编号重复，不能编辑。</Alert>;
    }
  } else {
    body = (
      <>
        {banner ? (
          snapshotError
            ? <SnapshotProblem message={snapshotError} onRetry={onRetry} retrying={retrying} />
            : <Alert tone="danger">{banner}</Alert>
        ) : null}
        <div className="divide-y divide-line-subtle">
          {draft.map((stage, index) => {
            const number = index + 1;
            const earlier = draft.slice(0, index);
            const earlierIds = new Set(earlier.map((item) => item.id));
            const liveIds = liveStageIds(draft);
            const retained = retainedRequireIds(stage.requireIds, stage.id, liveIds);
            const selected = retained
              .map((id) => draft.find((item) => item.id === id))
              .filter((item): item is PracticeStage => item !== undefined);
            const blocked = stage.pids.length > 0;
            const positionLabel = (item: PracticeStage): string => {
              const position = draft.findIndex((row) => row.id === item.id) + 1;
              return `阶段 ${position}`;
            };
            const searchLabel = (item: PracticeStage): string => {
              const title = item.title.trim();
              const base = positionLabel(item);
              return title ? `${base} ${title}` : base;
            };
            return (
              <div key={stage.id} className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 py-3">
                <span className="shrink-0 text-sm font-medium text-fg">
                  {`阶段 ${number}`}
                  <span className="sr-only">，</span>
                </span>
                <div className="min-w-0 flex-1 basis-48">
                  <Input
                    value={stage.title}
                    placeholder={TITLE_PLACEHOLDER}
                    aria-label={`阶段 ${number} 名称`}
                    disabled={saving}
                    onChange={(event) => {
                      const title = event.target.value;
                      setDraft((current) => current?.map((item) => (item.id === stage.id ? { ...item, title } : item)) ?? null);
                    }}
                  />
                </div>
                <div className="flex min-w-0 flex-1 basis-48 flex-wrap items-center gap-1">
                  <MultiSelect
                    className="min-w-0 flex-1"
                    options={earlier}
                    value={selected}
                    disabled={saving}
                    onChange={(next) => {
                      const chosen: number[] = [];
                      const seen = new Set<number>();
                      for (const item of next) {
                        if (seen.has(item.id)) continue;
                        seen.add(item.id);
                        chosen.push(item.id);
                      }
                      setDraft((current) => {
                        if (!current) return null;
                        const ids = liveStageIds(current);
                        return current.map((row) => {
                          if (row.id !== stage.id) return row;
                          return { ...row, requireIds: retainedRequireIds(chosen, row.id, ids) };
                        });
                      });
                    }}
                    getKey={(item) => String(item.id)}
                    getLabel={searchLabel}
                    placeholder={PREREQ_PLACEHOLDER}
                    emptyText="没有匹配的阶段"
                  />
                </div>
                <span className="shrink-0 text-sm text-fg-muted tabular">{`${stage.pids.length} 道题`}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  iconOnly
                  className="shrink-0"
                  aria-label={`删除阶段 ${number}`}
                  disabled={blocked || draft.length === 1 || saving}
                  onClick={() => onDelete(stage.id)}
                >
                  <Trash2 />
                </Button>
                {blocked ? <p className="text-xs text-fg-subtle">{MOVE_PROBLEMS}</p> : null}
              </div>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" variant="ghost" size="sm" onClick={onAdd} disabled={saving}>
            <Plus />
            加一个阶段
          </Button>
          <Button type="button" variant="secondary" onClick={() => void onSave()} disabled={saving} loading={saving}>
            保存阶段
          </Button>
        </div>
      </>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {body}
      {guard.guardDialog}
      <OptionalAdvancedDirty dirty={dirty} />
    </div>
  );
}

export function StageEditorSection({ payload }: { payload: TeachWorkbenchPayload }): ReactElement {
  if (payload.container.type !== 'practice') {
    return <Alert tone="danger">阶段编辑只用于练习。</Alert>;
  }
  return <PracticeStageEditor practiceId={payload.container.id} />;
}
