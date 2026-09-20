import { useEffect, useRef, useState } from 'react';
import { BookMarked, ClipboardPlus, ExternalLink, Trophy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { MultiSelect } from '@/components/ui/multi-select';
import { fetchHydroResponse, readHydroResponseError } from '@/lib/error-presenter';

type ActivityKind = 'contest' | 'homework' | 'unknown';

interface ActivityOption {
  id: string;
  title: string;
  kind: ActivityKind;
}

interface ProblemSetOption {
  id: string;
  title: string;
  stages: Array<{ id: number; title: string }>;
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label}响应格式不正确`);
  return value as Record<string, unknown>;
}

function asId(value: unknown): string {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isSafeInteger(value)) return String(value);
  if (value && typeof value === 'object' && !Array.isArray(value) && typeof (value as { $oid?: unknown }).$oid === 'string') {
    return (value as { $oid: string }).$oid;
  }
  throw new TypeError('缺少有效 id');
}

function asTitle(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

async function readJson(path: string, fallback: string): Promise<Record<string, unknown>> {
  const response = await fetchHydroResponse(path, { credentials: 'same-origin', headers: { Accept: 'application/json' } }, fallback);
  if (!response.ok) throw new Error(await readHydroResponseError(response, fallback));
  return asRecord(await response.json(), fallback);
}

function parseActivityList(payload: Record<string, unknown>, kind: Exclude<ActivityKind, 'unknown'>): ActivityOption[] {
  if (!Array.isArray(payload.tdocs)) throw new TypeError('列表响应缺少 tdocs');
  return payload.tdocs.map((item) => {
    const rec = asRecord(item, kind);
    const id = asId(rec.docId ?? rec._id);
    return { id, title: asTitle(rec.title, id), kind };
  });
}

async function searchActivities(query: string): Promise<ActivityOption[]> {
  const q = encodeURIComponent(query);
  const [contests, homeworks] = await Promise.all([
    readJson(`/contest?q=${q}`, '搜索比赛失败'),
    readJson(`/homework?q=${q}`, '搜索作业失败'),
  ]);
  const merged = [...parseActivityList(homeworks, 'homework'), ...parseActivityList(contests, 'contest')];
  const seen = new Set<string>();
  return merged.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

async function loadActivity(id: string): Promise<ActivityOption> {
  const fallback: ActivityOption = { id, title: id, kind: 'unknown' };
  try {
    const homework = await readJson(`/homework/${encodeURIComponent(id)}`, '加载作业失败');
    const tdoc = asRecord(homework.tdoc, '作业');
    return { id, title: asTitle(tdoc.title, id), kind: 'homework' };
  } catch {
    // Homework and contest share ids; try the other face before giving up.
  }
  try {
    const contest = await readJson(`/contest/${encodeURIComponent(id)}`, '加载比赛失败');
    const tdoc = asRecord(contest.tdoc, '比赛');
    return { id, title: asTitle(tdoc.title, id), kind: 'contest' };
  } catch {
    return fallback;
  }
}

function parseStages(value: unknown): Array<{ id: number; title: string }> {
  if (!Array.isArray(value)) return [];
  return value.map((item, index) => {
    const rec = asRecord(item, `题集阶段[${index}]`);
    const id = Number(rec._id);
    if (!Number.isSafeInteger(id)) throw new TypeError(`题集阶段[${index}] 缺少 id`);
    return { id, title: asTitle(rec.title, `阶段 ${id}`) };
  });
}

async function searchProblemSets(query: string): Promise<ProblemSetOption[]> {
  const payload = await readJson(`/training?q=${encodeURIComponent(query)}`, '搜索题集失败');
  if (!Array.isArray(payload.tdocs)) throw new TypeError('题集响应缺少 tdocs');
  return payload.tdocs.map((item) => {
    const rec = asRecord(item, '题集');
    const id = asId(rec.docId ?? rec._id);
    return { id, title: asTitle(rec.title, id), stages: [] };
  });
}

async function loadProblemSet(id: string): Promise<ProblemSetOption> {
  const payload = await readJson(`/training/${encodeURIComponent(id)}`, '加载题集失败');
  const tdoc = asRecord(payload.tdoc, '题集');
  return { id, title: asTitle(tdoc.title, id), stages: parseStages(tdoc.dag) };
}

function kindLabel(kind: ActivityKind): string {
  if (kind === 'homework') return '作业';
  if (kind === 'contest') return '比赛';
  return '已挂入';
}

function ChapterActivityPicker({ value, onChange }: { value: string; onChange: (next: string) => void }) {
  const ids = value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  const cacheRef = useRef(new Map<string, ActivityOption>());
  const [options, setOptions] = useState<ActivityOption[]>([]);

  useEffect(() => {
    let cancelled = false;
    const missing = ids.filter((id) => !cacheRef.current.has(id));
    const sync = (extra: ActivityOption[] = []) => {
      for (const item of extra) cacheRef.current.set(item.id, item);
      setOptions(ids.map((id) => cacheRef.current.get(id) || { id, title: id, kind: 'unknown' }));
    };
    sync();
    if (!missing.length) return undefined;
    void Promise.all(missing.map(loadActivity)).then((loaded) => {
      if (!cancelled) sync(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [ids.join(',')]);

  return (
    <MultiSelect<ActivityOption>
      value={options}
      onChange={(next) => {
        for (const item of next) cacheRef.current.set(item.id, item);
        setOptions(next);
        onChange(next.map((item) => item.id).join(','));
      }}
      loadOptions={searchActivities}
      getKey={(item) => item.id}
      getLabel={(item) => item.title}
      getDescription={(item) => kindLabel(item.kind)}
      placeholder="搜索比赛或作业标题"
      emptyText="没有匹配的比赛或作业"
      minHeight={44}
    />
  );
}

function ChapterProblemSetPicker({
  problemSetId,
  stageIds,
  onChange,
}: {
  problemSetId: string;
  stageIds: string;
  onChange: (problemSetId: string, stageIds: string) => void;
}) {
  const [selected, setSelected] = useState<ProblemSetOption | null>(
    problemSetId ? { id: problemSetId, title: problemSetId, stages: [] } : null,
  );

  useEffect(() => {
    if (!problemSetId) {
      setSelected(null);
      return undefined;
    }
    let cancelled = false;
    void loadProblemSet(problemSetId)
      .then((item) => {
        if (!cancelled) setSelected(item);
      })
      .catch(() => {
        if (!cancelled) setSelected({ id: problemSetId, title: problemSetId, stages: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [problemSetId]);

  const selectedStages = (selected?.stages || []).filter((stage) =>
    stageIds
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
      .includes(String(stage.id)),
  );

  return (
    <div className="space-y-3">
      <MultiSelect<ProblemSetOption>
        value={selected ? [selected] : []}
        onChange={(next) => {
          const item = next[0] || null;
          setSelected(item);
          onChange(item ? item.id : '', '');
        }}
        loadOptions={searchProblemSets}
        getKey={(item) => item.id}
        getLabel={(item) => item.title}
        placeholder="搜索题集标题"
        emptyText="没有匹配的题集"
        maxItems={1}
        minHeight={44}
      />
      {selected?.stages.length ? (
        <MultiSelect<{ id: number; title: string }>
          options={selected.stages}
          value={selectedStages}
          onChange={(next) => onChange(selected.id, next.map((stage) => String(stage.id)).join(','))}
          getKey={(stage) => String(stage.id)}
          getLabel={(stage) => stage.title}
          placeholder="选择阶段，留空表示整集"
          emptyText="没有匹配的阶段"
          minHeight={44}
        />
      ) : selected ? (
        <p className="text-xs text-muted-foreground">未选阶段时，本章引用整本题集。</p>
      ) : null}
    </div>
  );
}

export function ChapterLinks({
  courseId,
  chapterId,
  tids,
  problemSetId,
  stageIds,
  onChangeTids,
  onChangeProblemSet,
  canCreateQuiz,
  quizNeedsSave,
}: {
  courseId: string;
  chapterId: number;
  tids: string;
  problemSetId: string;
  stageIds: string;
  onChangeTids: (tids: string) => void;
  onChangeProblemSet: (problemSetId: string, stageIds: string) => void;
  canCreateQuiz: boolean;
  quizNeedsSave: boolean;
}) {
  return (
    <div className="space-y-3">
      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
              <Trophy className="size-4" strokeWidth={1.75} />
            </span>
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-medium">比赛与作业</h3>
              <p className="mt-0.5 text-xs text-muted-foreground">把已经建好的比赛或作业挂到这一章，学生会在本章看到入口。</p>
            </div>
          </div>
          <ChapterActivityPicker value={tids} onChange={onChangeTids} />
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
            <a
              href="/contest/create"
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-11 items-center gap-1 font-medium text-primary hover:underline"
            >
              去创建比赛
              <ExternalLink className="size-3" strokeWidth={1.75} />
            </a>
            <a
              href="/homework/create"
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-11 items-center gap-1 font-medium text-primary hover:underline"
            >
              去创建作业
              <ExternalLink className="size-3" strokeWidth={1.75} />
            </a>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
              <BookMarked className="size-4" strokeWidth={1.75} />
            </span>
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-medium">引用题集</h3>
              <p className="mt-0.5 text-xs text-muted-foreground">题目仍留在题集里。可选若干阶段，留空则引用整集。</p>
            </div>
          </div>
          <ChapterProblemSetPicker problemSetId={problemSetId} stageIds={stageIds} onChange={onChangeProblemSet} />
        </CardContent>
      </Card>

      <section data-course-slot="quiz">
        {canCreateQuiz ? (
          <Card>
            <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div className="min-w-0">
                <h3 className="text-sm font-medium">本章小测</h3>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {quizNeedsSave ? '请先保存课程修改，再创建小测。' : '用本章题目生成一份作业，发给课程可见班级。'}
                </p>
              </div>
              {quizNeedsSave ? null : (
                <Button asChild type="button" className="min-h-11 gap-1.5">
                  <a href={`/homework/create?fromCourse=${encodeURIComponent(courseId)}&chapter=${chapterId}`}>
                    <ClipboardPlus className="size-4" strokeWidth={1.75} />
                    创建本章小测
                  </a>
                </Button>
              )}
            </CardContent>
          </Card>
        ) : !courseId ? (
          <p className="text-sm text-muted-foreground">保存课程后可创建小测。</p>
        ) : null}
      </section>
    </div>
  );
}
