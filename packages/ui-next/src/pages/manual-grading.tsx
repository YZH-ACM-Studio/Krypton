import { CheckCircle2, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useBootstrap } from '@/lib/bootstrap';

type R = Record<string, any>;

function GradeRow({ row, pid }: { row: R; pid: number }) {
  const [grade, setGrade] = useState<R | null>(row.manualGrade);
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
      const response = await fetch(window.location.pathname, {
        method: 'POST',
        body,
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      });
      const result = await response.json().catch(() => null);
      if (!response.ok || result?.error) {
        throw new Error(result?.error?.message || `保存失败（HTTP ${response.status}）`);
      }
      setGrade(result.manualGrade);
      setReason('');
    } catch (caught: any) {
      setError(caught?.message || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <article className="space-y-4 border-t border-border/70 py-5 first:border-t-0">
      <header>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-base font-semibold">{row.displayName || row.uname}</h2>
          {row.studentId ? <Badge variant="outline">{row.studentId}</Badge> : null}
          <span className="ml-auto font-mono text-xs text-muted-foreground">{row.latestRid.slice(-8)}</span>
        </div>
      </header>
      <div className="space-y-4">
        <div className="whitespace-pre-wrap rounded-md border bg-muted/20 p-4 text-sm leading-6">
          {row.answer || <span className="text-muted-foreground">未填写答案</span>}
        </div>
        <div className="grid gap-3 sm:grid-cols-[8rem_minmax(0,1fr)]">
          <label className="space-y-1">
            <span className="text-xs font-medium">得分（0–100）</span>
            <Input type="number" min={0} max={100} value={score} onChange={(e) => setScore(e.target.value)} />
          </label>
          <label className="space-y-1">
            <span className="text-xs font-medium">评语</span>
            <Input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="可选" />
          </label>
        </div>
        {revision > 0 ? (
          <label className="block space-y-1">
            <span className="text-xs font-medium">改分原因</span>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} required placeholder="改分时必填" />
          </label>
        ) : null}
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-muted-foreground">{grade ? `已评分 ${grade.score}/100 · revision ${grade.revision}` : '等待首次评分'}</span>
          <Button onClick={save} disabled={saving || !score || (revision > 0 && !reason.trim())} className="gap-1.5">
            {saving ? <RefreshCw className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
            {revision ? '保存改分' : '提交评分'}
          </Button>
        </div>
      </div>
    </article>
  );
}

export function ManualGradingPage() {
  const data = useBootstrap().page.data as R;
  const problems: R[] = data.problems || [];
  const rows: R[] = data.rows || [];
  const pid = Number(data.pid || 0);

  return (
    <main className="mx-auto w-full max-w-6xl space-y-5 pb-10">
      <header className="space-y-1 border-b border-border/70 pb-4">
        <p className="text-xs text-muted-foreground">{data.tdoc?.rule} · 容器阅卷</p>
        <h1 className="text-2xl font-semibold tracking-tight">{data.tdoc?.title || '人工阅卷'}</h1>
        <p className="text-sm text-muted-foreground">仅显示每名学生当前最新提交；陈旧窗口保存会返回冲突。</p>
      </header>

      <nav className="flex flex-wrap gap-2" aria-label="主观题筛选">
        {problems.map((item) => (
          <Button key={item.pid} asChild variant={item.pid === pid ? 'default' : 'outline'}>
            <a href={`?pid=${item.pid}`}>{item.title}</a>
          </Button>
        ))}
      </nav>

      <form method="get" className="flex max-w-md items-end gap-2">
        <input type="hidden" name="pid" value={pid || ''} />
        <label className="min-w-0 flex-1 space-y-1">
          <span className="text-xs font-medium">按学生 UID 筛选</span>
          <Input name="uid" type="number" min={1} defaultValue={data.uid || ''} placeholder="留空查看全部学生" />
        </label>
        <Button type="submit" variant="outline">
          筛选
        </Button>
      </form>

      {problems.find((item) => item.pid === pid)?.gradingInstructions ? (
        <section className="border-y border-border/70 py-4">
          <h2 className="text-sm font-semibold">阅卷说明</h2>
          <div className="mt-2 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
            {problems.find((item) => item.pid === pid)?.gradingInstructions}
          </div>
        </section>
      ) : null}

      <section className="space-y-4">
        {rows.length ? (
          rows.map((row) => <GradeRow key={row.latestRid} row={row} pid={pid} />)
        ) : (
          <p className="border-y border-border/70 py-12 text-center text-sm text-muted-foreground">
            {problems.length ? '当前筛选下暂无提交' : '此容器没有主观题'}
          </p>
        )}
      </section>
    </main>
  );
}
