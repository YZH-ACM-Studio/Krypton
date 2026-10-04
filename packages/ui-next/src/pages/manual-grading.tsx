import { CheckCircle2 } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Page, PageHeader } from '@/components/ui/page';
import { PageTabs } from '@/components/ui/page-tabs';
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
}

interface ManualGradeResponse {
  manualGrade?: ManualGrade | null;
  error?: { message?: string };
}

function GradeRow({ row, pid }: { row: ManualGradingRow; pid: number }) {
  const [grade, setGrade] = useState<ManualGrade | null | undefined>(row.manualGrade);
  const [score, setScore] = useState(String(row.manualGrade?.score ?? ''));
  const [comment, setComment] = useState(String(row.manualGrade?.comment || ''));
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const revision = Number(grade?.revision || 0);

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      const body = new URLSearchParams({
        pid: String(pid),
        uid: String(row.uid),
        latestRid: row.latestRid,
        expectedRevision: String(revision),
        score,
        comment,
        reason,
      });
      const response = await fetchHydroResponse(window.location.pathname, {
        method: 'POST',
        body,
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) throw new Error(await readHydroResponseError(response, '保存评分失败'));
      const result = (await response.json().catch(() => null)) as ManualGradeResponse | null;
      if (result?.error) throw new Error('保存评分响应包含错误标记');
      setGrade(result!.manualGrade);
      setReason('');
    } catch (caught) {
      const message = (caught as { message?: unknown } | null)?.message;
      setError(typeof message === 'string' && message ? message : '保存失败');
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
              <span className="text-xs font-medium text-fg-subtle">得分（0–100）</span>
              <Input type="number" min={0} max={100} value={score} onChange={(e) => setScore(e.target.value)} />
            </label>
            <label className="flex min-w-0 flex-col gap-1.5">
              <span className="text-xs font-medium text-fg-subtle">评语</span>
              <Input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="可选" />
            </label>
          </div>
          {revision > 0 ? (
            <label className="mt-3 flex min-w-0 flex-col gap-1.5">
              <span className="text-xs font-medium text-fg-subtle">改分原因</span>
              <Input value={reason} onChange={(e) => setReason(e.target.value)} required placeholder="改分时必填" />
            </label>
          ) : null}
          {error ? (
            <p role="alert" className="mt-3 text-sm text-danger-fg">
              {error}
            </p>
          ) : null}
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <span className="min-w-0 break-words text-xs text-fg-subtle tabular">
              {grade ? `已评分 ${grade.score}/100 · revision ${grade.revision}` : '等待首次评分'}
            </span>
            <Button
              type="button"
              variant="soft"
              onClick={save}
              disabled={!score || (revision > 0 && !reason.trim())}
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

export function ManualGradingPage() {
  const data = useBootstrap().page.data as ManualGradingPageData;
  const problems = data.problems || [];
  const rows = data.rows || [];
  const pid = Number(data.pid || 0);
  const instructions = problems.find((item) => item.pid === pid)?.gradingInstructions;

  return (
    <Page width="wide">
      <PageHeader
        title={data.tdoc?.title || '人工阅卷'}
        description="仅显示每名学生当前最新提交；陈旧窗口保存会返回冲突。"
        meta={
          <span>
            {data.tdoc?.rule} · 容器阅卷
          </span>
        }
        tabs={
          problems.length ? (
            <PageTabs
              aria-label="主观题筛选"
              value={String(pid)}
              items={problems.map((item) => ({
                value: String(item.pid),
                label: item.title,
                href: data.uid ? `?pid=${item.pid}&uid=${encodeURIComponent(String(data.uid))}` : `?pid=${item.pid}`,
              }))}
            />
          ) : undefined
        }
      />

      <form method="get" className="flex max-w-md flex-wrap items-end gap-2">
        <input type="hidden" name="pid" value={pid || ''} />
        <label className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span className="text-xs font-medium text-fg-subtle">按学生 UID 筛选</span>
          <Input name="uid" type="number" min={1} defaultValue={data.uid || ''} placeholder="留空查看全部学生" />
        </label>
        <Button type="submit" variant="secondary">
          筛选
        </Button>
      </form>

      {instructions ? (
        <section className="border-y border-line py-4">
          <h2 className="text-sm font-semibold text-fg">阅卷说明</h2>
          <div className="mt-2 max-w-prose whitespace-pre-wrap text-sm text-fg-muted text-pretty">{instructions}</div>
        </section>
      ) : null}

      <section>
        {rows.length ? (
          rows.map((row) => <GradeRow key={row.latestRid} row={row} pid={pid} />)
        ) : (
          <EmptyState compact title={problems.length ? '当前筛选下暂无提交' : '此容器没有主观题'} />
        )}
      </section>
    </Page>
  );
}
