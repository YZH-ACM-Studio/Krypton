import { CheckCircle2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Page, PageHeader } from '@/components/ui/page';
import { MiniTabs } from '@/components/ui/mini-tabs';
import { Alert } from '@/components/ui/alert';
import { getJson } from '@/pages/teach/api';
import { EmptyState } from '@/components/ui/empty-state';
import { useBootstrap } from '@/lib/bootstrap';
import { fetchHydroResponse, readHydroResponseError } from '@/lib/error-presenter';

interface ManualGrade {
  score?: string | number;
  comment?: string;
  revision?: number;
}

interface ManualGradingRow {
  uid: string | number;
  latestRid: string;
  manualGrade?: ManualGrade | null;
  displayName?: string;
  uname?: string;
  studentId?: string | number;
  answer?: string;
  roundNo?: number;
  answerVersion?: number;
  closedAt?: string | null;
  gradingLocked?: boolean;
  paperMax?: number;
  excluded?: boolean;
}

interface ManualGradingProblem {
  pid: number;
  title?: string;
  gradingInstructions?: string;
}

interface ManualGradingPageData {
  tdoc?: { rule?: string; title?: string };
  problems?: ManualGradingProblem[];
  rows?: ManualGradingRow[];
  pid?: string | number;
  uid?: string | number;
  roundHistory?: boolean;
}

function parseGradeResponse(value: unknown): ManualGrade {
  if (!value || typeof value !== 'object' || !('manualGrade' in value) || !value.manualGrade || typeof value.manualGrade !== 'object') { throw new Error('保存评分响应缺少评分结果。'); }
  const grade = value.manualGrade;
  if (
    !('score' in grade) ||
    typeof grade.score !== 'number' ||
    !Number.isFinite(grade.score) ||
    !('revision' in grade) ||
    typeof grade.revision !== 'number' ||
    !Number.isSafeInteger(grade.revision) ||
    grade.revision < 1 ||
    ('comment' in grade && typeof grade.comment !== 'string')
  ) { throw new Error('保存评分响应格式无效。'); }
  return {
    score: grade.score,
    revision: grade.revision,
    comment: 'comment' in grade && typeof grade.comment === 'string' ? grade.comment : undefined,
  };
}

function GradeRow({ row, pid, endpoint }: { row: ManualGradingRow; pid: number; endpoint: string }) {
  const [grade, setGrade] = useState<ManualGrade | null | undefined>(row.manualGrade);
  const [score, setScore] = useState(String(row.manualGrade?.score ?? ''));
  const [comment, setComment] = useState(String(row.manualGrade?.comment || ''));
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const revision = Number(grade?.revision || 0);
  const maximum = row.paperMax ?? 100;

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      const body = new URLSearchParams({
        pid: String(pid),
        uid: String(row.uid),
        latestRid: row.latestRid,
        expectedRevision: String(revision),
        ...(row.paperMax == null ? {} : { paperMax: String(row.paperMax) }),
        score,
        comment,
        reason,
      });
      const response = await fetchHydroResponse(endpoint, {
        method: 'POST',
        body,
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) throw new Error(await readHydroResponseError(response, '保存评分失败'));
      setGrade(parseGradeResponse(await response.json()));
      setReason('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <article className="space-y-4 border-t border-line py-5 first:border-t-0">
      <header>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="min-w-0 break-words text-md font-semibold text-fg">{row.displayName || row.uname}</h2>
          {row.studentId ? (
            <Badge variant="soft" className="shrink-0">
              {row.studentId}
            </Badge>
          ) : null}
          {row.roundNo ? (
            <Badge variant="soft">
              第 {row.roundNo} 轮 · 答案版本 {row.answerVersion}
            </Badge>
          ) : null}
          {row.roundNo ? <span className="text-xs text-fg-subtle">{row.closedAt ? '已交卷' : '作答中'}</span> : null}
          <span className="ml-auto shrink-0 font-mono text-xs text-fg-subtle tabular">{row.latestRid.slice(-8)}</span>
        </div>
      </header>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
        <div className="max-h-[min(70vh,36rem)] min-w-0 overflow-y-auto whitespace-pre-wrap rounded-md border border-line bg-surface-sunken p-4 text-sm text-fg">
          {row.answer || <span className="text-fg-muted">未填写答案</span>}
        </div>
        <div className="min-w-0 lg:sticky lg:top-20 lg:self-start lg:rounded-lg lg:border lg:border-line lg:bg-surface lg:p-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
            <label className="flex min-w-0 flex-col gap-1.5">
              <span className="text-xs font-medium text-fg-subtle">{`得分（0–${maximum}）`}</span>
              <Input type="number" min={0} max={maximum} step="0.01" value={score} onChange={(e) => setScore(e.target.value)} disabled={row.gradingLocked} />
            </label>
            <label className="flex min-w-0 flex-col gap-1.5">
              <span className="text-xs font-medium text-fg-subtle">评语</span>
              <Input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="可选" disabled={row.gradingLocked} />
            </label>
          </div>
          {revision > 0 ? (
            <label className="mt-3 flex min-w-0 flex-col gap-1.5">
              <span className="text-xs font-medium text-fg-subtle">改分原因</span>
              <Input value={reason} onChange={(e) => setReason(e.target.value)} required placeholder="改分时必填" disabled={row.gradingLocked} />
            </label>
          ) : null}
          {row.gradingLocked ? <p className="mt-3 text-sm text-fg-muted">{row.excluded ? '本卷已剔除此题。' : '历史轮次记录不完整，保留原评分。'}</p> : null}
          {error ? (
            <p role="alert" className="mt-3 text-sm text-danger-fg">
              {error}
            </p>
          ) : null}
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <span className="min-w-0 break-words text-xs text-fg-subtle tabular">
              {grade ? `已评分 ${grade.score}/${maximum} · 第 ${grade.revision} 次评分` : '等待首次评分'}
            </span>
            <Button
              type="button"
              variant="soft"
              onClick={save}
              disabled={row.gradingLocked || !score || (revision > 0 && !reason.trim())}
              loading={saving}
              className="shrink-0"
            >
              <CheckCircle2 />
              {revision ? '保存改分' : '提交评分'}
            </Button>
          </div>
        </div>
      </div>
    </article>
  );
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('批改数据格式无效。');
  return value as Record<string, unknown>;
}
export function parseManualGradingData(payload: unknown): ManualGradingPageData {
  const raw = record(payload);
  if (!Array.isArray(raw.problems) || !Array.isArray(raw.rows)) throw new Error('批改数据缺少题目或学生答案。');
  const problems = raw.problems.map((value): ManualGradingProblem => {
    const row = record(value);
    if (
      typeof row.pid !== 'number' ||
      !Number.isSafeInteger(row.pid) ||
      typeof row.title !== 'string' ||
      (row.gradingInstructions !== undefined && typeof row.gradingInstructions !== 'string')
    ) { throw new Error('批改题目无效。'); }
    return { pid: row.pid, title: row.title, gradingInstructions: row.gradingInstructions };
  });
  const rows = raw.rows.map((value): ManualGradingRow => {
    const row = record(value);
    if ((typeof row.uid !== 'number' && typeof row.uid !== 'string') || typeof row.latestRid !== 'string') throw new Error('批改答案身份无效。');
    for (const key of ['displayName', 'uname', 'answer']) { if (row[key] !== undefined && typeof row[key] !== 'string') throw new Error('批改答案内容无效。'); }
    if (row.paperMax !== undefined && (typeof row.paperMax !== 'number' || !Number.isFinite(row.paperMax) || row.paperMax < 0)) throw new Error('卷面满分无效。');
    if (row.gradingLocked !== undefined && typeof row.gradingLocked !== 'boolean') throw new Error('批改锁定状态无效。');
    for (const key of ['roundNo', 'answerVersion']) { if (row[key] !== undefined && (typeof row[key] !== 'number' || !Number.isSafeInteger(row[key]))) throw new Error('批改版本无效。'); }
    if (row.closedAt !== undefined && row.closedAt !== null && typeof row.closedAt !== 'string') throw new Error('交卷时间无效。');
    if (row.studentId !== undefined && typeof row.studentId !== 'string' && typeof row.studentId !== 'number') throw new Error('学号无效。');
    const manualGrade = row.manualGrade == null ? row.manualGrade : record(row.manualGrade);
    if (
      manualGrade &&
      ((typeof manualGrade.score !== 'number' && typeof manualGrade.score !== 'string') ||
        typeof manualGrade.revision !== 'number' ||
        (manualGrade.comment !== undefined && typeof manualGrade.comment !== 'string'))
    ) { throw new Error('评分数据无效。'); }
    return {
      uid: row.uid,
      latestRid: row.latestRid,
      ...(typeof row.displayName === 'string' ? { displayName: row.displayName } : {}),
      ...(typeof row.uname === 'string' ? { uname: row.uname } : {}),
      ...(typeof row.answer === 'string' ? { answer: row.answer } : {}),
      ...(typeof row.studentId === 'string' || typeof row.studentId === 'number' ? { studentId: row.studentId } : {}),
      ...(typeof row.paperMax === 'number' ? { paperMax: row.paperMax } : {}),
      ...(row.excluded === true ? { excluded: true } : {}),
      ...(typeof row.roundNo === 'number' ? { roundNo: row.roundNo } : {}),
      ...(typeof row.answerVersion === 'number' ? { answerVersion: row.answerVersion } : {}),
      ...(typeof row.closedAt === 'string' || row.closedAt === null ? { closedAt: row.closedAt } : {}),
      gradingLocked: row.gradingLocked === true,
      manualGrade: manualGrade
        ? {
            score: typeof manualGrade.score === 'number' || typeof manualGrade.score === 'string' ? manualGrade.score : undefined,
            comment: typeof manualGrade.comment === 'string' ? manualGrade.comment : undefined,
            revision: typeof manualGrade.revision === 'number' ? manualGrade.revision : undefined,
          }
        : null,
    };
  });
  if (raw.pid !== undefined && typeof raw.pid !== 'number' && typeof raw.pid !== 'string') throw new Error('批改题号无效。');
  const tdoc = raw.tdoc == null ? null : record(raw.tdoc);
  return {
    problems,
    rows,
    pid: raw.pid,
    roundHistory: raw.roundHistory === true,
    tdoc: tdoc && typeof tdoc.title === 'string' ? { title: tdoc.title } : undefined,
  };
}

export function ManualGradingPanel({ endpoint, initialData }: { endpoint: string; initialData?: ManualGradingPageData }) {
  const [data, setData] = useState(initialData ?? null);
  const [pid, setPid] = useState('');
  const [uid, setUid] = useState('');
  const [filter, setFilter] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!initialData);
  const [queryVersion, setQueryVersion] = useState(0);
  useEffect(() => {
    if (initialData && !pid && !filter && queryVersion === 0) return;
    let active = true;
    setLoading(true);
    setError(null);
    const query = new URLSearchParams();
    if (pid) query.set('pid', pid);
    if (filter) query.set('uid', filter);
    getJson(`${endpoint}?${query}`, '无法读取待批改答案。')
      .then((raw) => {
        const next = parseManualGradingData(raw);
        if (active) setData(next);
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : '无法读取待批改答案。');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [endpoint, pid, filter, queryVersion, initialData]);
  const currentPid = Number(data?.pid ?? 0);
  const problems = data?.problems ?? [];
  const rows = data?.rows ?? [];
  const instructions = problems.find((item) => item.pid === currentPid)?.gradingInstructions;
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <p className="text-sm text-fg-muted">按题目批改每名学生的正式答案，评分自动计入对应轮次。</p>
      <div className="flex min-w-0 flex-wrap items-end justify-between gap-3">
        {problems.length ? (
          <MiniTabs
            aria-label="主观题筛选"
            value={String(currentPid)}
            onValueChange={setPid}
            items={problems.map((item) => ({ value: String(item.pid), label: item.title }))}
          />
        ) : null}
        <form
          onSubmit={(event) => {
            event.preventDefault();
            setFilter(uid);
            setQueryVersion((value) => value + 1);
          }}
          className="flex min-w-0 flex-wrap items-end gap-2"
        >
          <label className="flex min-w-0 flex-col gap-2 text-sm text-fg-muted">
            学生 UID
            <Input
              aria-label="学生 UID"
              type="number"
              min={1}
              value={uid}
              onChange={(event) => setUid(event.currentTarget.value)}
              placeholder="留空查看全部"
            />
          </label>
          <Button type="submit" variant="secondary">
            筛选
          </Button>
        </form>
      </div>
      {error ? (
        <Alert
          tone="danger"
          action={
            <Button variant="secondary" onClick={() => setQueryVersion((value) => value + 1)}>
              重试
            </Button>
          }
        >
          {error}
        </Alert>
      ) : null}
      {loading ? (
        <p role="status" className="text-sm text-fg-muted">
          正在读取答案…
        </p>
      ) : error ? null : (
        <>
          {instructions ? (
            <section className="border-y border-line py-4">
              <h2 className="text-sm font-semibold text-fg">阅卷说明</h2>
              <p className="mt-2 whitespace-pre-wrap text-sm text-fg-muted">{instructions}</p>
            </section>
          ) : null}
          <section>
            {rows.length ? (
              rows.map((row) => <GradeRow key={row.latestRid} row={row} pid={currentPid} endpoint={endpoint} />)
            ) : (
              <EmptyState compact title={problems.length ? '当前筛选下暂无提交' : '没有需要人工批改的主观题'} />
            )}
          </section>
        </>
      )}
    </div>
  );
}

export function ManualGradingPage() {
  const bootstrap = useBootstrap();
  const [data] = useState(() => parseManualGradingData(bootstrap.page.data));
  return (
    <Page width="wide">
      <PageHeader title={data.tdoc?.title ?? '人工阅卷'} />
      <ManualGradingPanel endpoint={window.location.pathname} initialData={data} />
    </Page>
  );
}
