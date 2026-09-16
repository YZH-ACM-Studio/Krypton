import { Check, ChevronRight, CircleX, Minus } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { buildObjectiveAnswerRows, isObjectiveRecordProblem } from '@/lib/objective-record';
import { cn } from '@/lib/cn';

export { isObjectiveRecordProblem };

function verdictCopy(status: number | undefined, score: number | undefined) {
  if (status === 1) return { label: '回答正确', tone: 'text-emerald-600 dark:text-emerald-400' };
  if (status === 2) return { label: score ? '部分正确' : '回答错误', tone: 'text-red-600 dark:text-red-400' };
  if (status === 31) return { label: '提交格式无效', tone: 'text-muted-foreground' };
  if (status === 0 || status === 20 || status === 21 || status === 22) return { label: '正在评测', tone: 'text-sky-600 dark:text-sky-400' };
  return { label: '评测结束', tone: 'text-foreground' };
}

function kindLabel(kind: string) {
  if (kind === 'multi') return '多选题';
  if (kind === 'true_false') return '判断题';
  if (kind === 'blank') return '填空题';
  if (kind === 'subjective') return '主观题';
  return '单选题';
}

function ResultMark({ row }: { row: { correct: boolean | null; unanswered: boolean } }) {
  if (row.unanswered) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        <Minus className="size-3.5" strokeWidth={1.75} />
        未作答
      </span>
    );
  }
  if (row.correct === true) {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
        <Check className="size-3.5" strokeWidth={2} />
        正确
      </span>
    );
  }
  if (row.correct === false) {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-red-600 dark:text-red-400">
        <CircleX className="size-3.5" strokeWidth={1.75} />
        错误
      </span>
    );
  }
  return <span className="text-xs text-muted-foreground">待出分</span>;
}

export function ObjectiveRecordResult({
  pdoc,
  rdoc,
  code,
  problemUrl,
  listHref,
  username,
  student,
  submittedAt,
}: {
  pdoc: { title?: unknown; content?: unknown; config?: unknown; problemKind?: unknown };
  rdoc: { status?: number; score?: number; testCases?: Array<{ id?: unknown; status?: unknown; score?: unknown }>; cases?: Array<{ id?: unknown; status?: unknown; score?: unknown }> };
  code: unknown;
  problemUrl: string;
  listHref: string;
  username: string;
  student: { studentId: string; realName: string } | null;
  submittedAt: string;
}) {
  const cases = rdoc.testCases || rdoc.cases || [];
  const rows = buildObjectiveAnswerRows({ pdoc, code, cases });
  const verdict = verdictCopy(rdoc.status, rdoc.score);
  const correctCount = rows.filter((row) => row.correct === true).length;

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <a href={listHref} className="hover:text-primary">
          记录
        </a>
        <ChevronRight className="size-3" />
        <span>客观题</span>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <Card>
          <CardContent className="flex flex-col gap-5 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">结果</p>
              <p className={cn('mt-1 text-2xl font-semibold tracking-tight', verdict.tone)}>{verdict.label}</p>
              <p className="mt-1 text-sm text-muted-foreground">{submittedAt}</p>
            </div>
            <div className="flex gap-6">
              <div>
                <p className="text-xs text-muted-foreground">得分</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums">{rdoc.score ?? '—'}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">答对</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums">
                  {correctCount}
                  <span className="text-sm font-normal text-muted-foreground">/{rows.length || '—'}</span>
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-xs text-muted-foreground">题目 / 用户</p>
            <a href={problemUrl} className="mt-1 block text-sm font-semibold leading-5 hover:text-primary">
              {typeof pdoc.title === 'string' ? pdoc.title : '客观题'}
            </a>
            <div className="mt-3 flex flex-wrap gap-2 border-t pt-3 text-xs">
              <span className="rounded-md bg-muted px-2.5 py-1 font-medium">{username}</span>
              {student?.studentId ? <span className="rounded-md bg-muted px-2.5 py-1 font-mono tabular-nums">{student.studentId}</span> : null}
              {student?.realName ? <span className="rounded-md bg-muted px-2.5 py-1">{student.realName}</span> : null}
            </div>
          </CardContent>
        </Card>
      </div>

      <section className="space-y-3">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-sm font-semibold">作答明细</h2>
          <p className="text-xs text-muted-foreground">不展示标准答案，只对照你提交的选项。</p>
        </div>
        {rows.length ? (
          <ul className="space-y-3">
            {rows.map((row, index) => (
              <li key={row.key}>
                <Card className={cn(row.correct === true && 'border-emerald-500/30', row.correct === false && !row.unanswered && 'border-red-500/30')}>
                  <CardContent className="space-y-3 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs tabular-nums text-muted-foreground">{index + 1}</span>
                          <Badge variant="outline" className="font-normal">
                            {kindLabel(row.kind)}
                          </Badge>
                          <ResultMark row={row} />
                        </div>
                        <p className="mt-2 text-sm font-medium leading-6">{row.prompt}</p>
                      </div>
                      {row.maxScore ? (
                        <p className="text-xs tabular-nums text-muted-foreground">
                          {row.score}/{row.maxScore}
                        </p>
                      ) : null}
                    </div>
                    <div className="rounded-lg bg-muted/40 px-3 py-2 text-sm">
                      <p className="text-[11px] text-muted-foreground">你的答案</p>
                      <p className="mt-0.5 leading-6">{row.selectedLabel}</p>
                    </div>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        ) : (
          <Card>
            <CardContent className="py-10 text-center text-sm text-muted-foreground">没有解析到作答内容。</CardContent>
          </Card>
        )}
      </section>
    </div>
  );
}
