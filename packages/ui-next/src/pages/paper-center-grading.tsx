/**
 * 主观题阅卷（Rev.12）——按比赛批阅。
 *
 * 路由 /paper-center/grading/:tid（handler/paper-center.ts
 * PaperCenterGradingHandler）。可阅卷 = 题目 owner 或站点管理员；
 * 数据里只出现当前用户有权批阅的题目。
 *
 * 给分保存 = POST {rid, scores JSON} → 服务端校验范围、重算总分、
 * 回写 record score/status 并刷新比赛榜；全部小题给完分记录才离开
 * 「等待中」状态。分数可反复修改（覆盖 + oplog 审计）。
 */
import {
  ArrowLeft, CheckCircle2, ClipboardCheck, Loader2, Save,
} from 'lucide-react';
import { useState } from 'react';
import { MarkdownView } from '@/components/markdown-renderer';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useBootstrap } from '@/lib/bootstrap';

type R = Record<string, any>;

interface GradingRow {
  rid: string;
  uid: number;
  uname: string;
  realName?: string;
  studentId?: string;
  submittedAt: string;
  status: number;
  score: number;
  answers: Record<string, string>;
  manualScores: Record<string, number>;
  gradedBy?: number;
}

function StudentRowCard({
  tid, row, keys,
}: {
  tid: string;
  row: GradingRow;
  keys: Record<string, { score: number, prompt: string }>;
}) {
  const keyList = Object.keys(keys);
  const [scores, setScores] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const k of keyList) init[k] = row.manualScores[k] !== undefined ? String(row.manualScores[k]) : '';
    return init;
  });
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(Object.keys(row.manualScores).length >= keyList.length);
  const [err, setErr] = useState('');

  const save = async () => {
    const payload: Record<string, number> = {};
    for (const k of keyList) {
      if (scores[k] === '') continue; // 允许部分给分（记录保持等待中）
      const n = Number(scores[k]);
      if (!Number.isFinite(n) || n < 0 || n > keys[k].score) {
        setErr(`第 ${k} 题分数需在 0-${keys[k].score} 之间`);
        return;
      }
      payload[k] = n;
    }
    if (!Object.keys(payload).length) {
      setErr('还没有填写任何分数');
      return;
    }
    setBusy(true);
    setErr('');
    try {
      const form = new FormData();
      form.append('rid', row.rid);
      form.append('scores', JSON.stringify(payload));
      const res = await fetch(`/paper-center/grading/${tid}`, {
        method: 'POST',
        body: form,
        headers: { Accept: 'application/json' },
        credentials: 'same-origin',
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || body?.error) throw new Error(body?.error?.message || `保存失败（HTTP ${res.status}）`);
      setSaved(!!body.allGraded);
    } catch (e: any) {
      setErr(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{row.uname}</span>
          {row.realName ? <span className="text-xs text-muted-foreground">{row.realName}</span> : null}
          {row.studentId ? <span className="font-mono text-xs text-muted-foreground">{row.studentId}</span> : null}
          {saved
            ? <Badge variant="secondary" className="gap-1 text-[10px]"><CheckCircle2 className="size-3" />已评分</Badge>
            : <Badge variant="outline" className="text-[10px]">待评分</Badge>}
          <span className="ml-auto text-xs text-muted-foreground">
            当前总分 {row.score} · 提交于 {new Date(row.submittedAt).toLocaleString('zh-CN', { hour12: false })}
          </span>
        </div>
        {keyList.map((k) => (
          <div key={k} className="rounded-lg border">
            <div className="flex items-center gap-2 border-b bg-muted/40 px-3 py-1.5">
              <span className="text-xs font-medium">第 {k} 题</span>
              <span className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
                <Input
                  type="number"
                  min={0}
                  max={keys[k].score}
                  step="0.5"
                  value={scores[k]}
                  onChange={(e) => setScores((prev) => ({ ...prev, [k]: e.target.value }))}
                  className="h-7 w-20 text-right text-xs"
                  placeholder="给分"
                />
                / {keys[k].score} 分
              </span>
            </div>
            <div className="px-3 py-2">
              {row.answers[k]
                ? <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words text-sm">{row.answers[k]}</pre>
                : <p className="text-xs text-muted-foreground">（未作答）</p>}
            </div>
          </div>
        ))}
        {err ? <p className="text-xs text-red-600 dark:text-red-400">{err}</p> : null}
        <div className="flex justify-end">
          <Button size="sm" onClick={save} disabled={busy} className="gap-1.5">
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
            保存给分
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function PaperCenterGradingPage() {
  const bs = useBootstrap();
  const data = bs.page.data as {
    tdoc: R;
    problems: Array<{ pid: number, title: string, keys: Record<string, { score: number, prompt: string }> }>;
    rows?: GradingRow[];
    pid?: number;
  };
  const tid = String(data.tdoc?.docId || '');
  const problems = data.problems || [];
  const active = problems.find((p) => p.pid === data.pid) || null;

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center gap-2">
        <a href={`/contest/${tid}/management`} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary">
          <ArrowLeft className="size-3.5" />
          比赛管理
        </a>
        <ClipboardCheck className="size-5 text-primary" />
        <h1 className="text-xl font-semibold">主观题阅卷</h1>
        <span className="text-xs text-muted-foreground">{data.tdoc?.title}</span>
      </header>

      {problems.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            本场比赛没有你可批阅的主观题（阅卷需要是题目创建者或站点管理员）。
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {problems.map((p) => (
              <Button
                key={p.pid}
                asChild
                size="sm"
                variant={p.pid === data.pid ? 'default' : 'outline'}
              >
                <a href={`/paper-center/grading/${tid}?pid=${p.pid}`}>
                  #{p.pid} {p.title}（{Object.keys(p.keys).length} 道主观题）
                </a>
              </Button>
            ))}
          </div>

          {active ? (
            <>
              {Object.entries(active.keys).some(([, v]) => v.prompt) ? (
                <Card>
                  <CardContent className="space-y-3 p-4">
                    {Object.entries(active.keys).map(([k, v]) => (
                      <div key={k}>
                        <p className="mb-1 text-xs font-medium text-muted-foreground">第 {k} 题题干（{v.score} 分）</p>
                        {v.prompt ? <MarkdownView content={v.prompt} /> : <p className="text-xs text-muted-foreground">（无题干）</p>}
                      </div>
                    ))}
                  </CardContent>
                </Card>
              ) : null}
              {(data.rows || []).length === 0 ? (
                <Card>
                  <CardContent className="py-10 text-center text-sm text-muted-foreground">
                    该题还没有任何提交。
                  </CardContent>
                </Card>
              ) : (data.rows || []).map((row) => (
                <StudentRowCard key={row.rid} tid={tid} row={row} keys={active.keys} />
              ))}
            </>
          ) : (
            <Card>
              <CardContent className="py-8 text-center text-sm text-muted-foreground">
                选择上方题目开始阅卷。
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
