import { Check, CircleX, Minus } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { Panel } from '@/components/ui/panel';
import { scoreTone } from '@/components/ui/verdict';
import { buildObjectiveAnswerRows, isObjectiveRecordProblem } from '@/lib/objective-record';
import { cn } from '@/lib/cn';

export { isObjectiveRecordProblem };

const SCORE_TONE_CLASS = {
  danger: 'text-danger-fg',
  warning: 'text-warning-fg',
  success: 'text-success-fg',
} as const;

function verdictCopy(status: number | undefined, score: number | undefined) {
  if (status === 1) return { label: '回答正确', tone: 'text-success-fg' };
  if (status === 2) return { label: score ? '部分正确' : '回答错误', tone: score ? 'text-warning-fg' : 'text-danger-fg' };
  if (status === 31) return { label: '提交格式无效', tone: 'text-fg-muted' };
  if (status === 0 || status === 20 || status === 21 || status === 22) return { label: '正在评测', tone: 'text-info-fg' };
  return { label: '评测结束', tone: 'text-fg' };
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
      <span className="inline-flex items-center gap-1.5 text-xs text-fg-subtle">
        <Minus className="size-3.5" strokeWidth={1.75} />
        未作答
      </span>
    );
  }
  if (row.correct === true) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-success-fg">
        <Check className="size-3.5" strokeWidth={2} />
        正确
      </span>
    );
  }
  if (row.correct === false) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-danger-fg">
        <CircleX className="size-3.5" strokeWidth={1.75} />
        错误
      </span>
    );
  }
  return <span className="text-xs text-fg-subtle">待出分</span>;
}

export function ObjectiveRecordResult({
  pdoc,
  rdoc,
  code,
  problemUrl,
  username,
  student,
  submittedAt,
}: {
  pdoc: { title?: unknown; content?: unknown; config?: unknown; problemKind?: unknown };
  rdoc: { status?: number; score?: number; testCases?: Array<{ id?: unknown; status?: unknown; score?: unknown }>; cases?: Array<{ id?: unknown; status?: unknown; score?: unknown }> };
  code: unknown;
  problemUrl: string;
  username: string;
  student: { studentId: string; realName: string } | null;
  submittedAt: string;
}) {
  const cases = rdoc.testCases || rdoc.cases || [];
  const rows = buildObjectiveAnswerRows({ pdoc, code, cases });
  const verdict = verdictCopy(rdoc.status, rdoc.score);
  const correctCount = rows.filter((row) => row.correct === true).length;
  const paperFull = rows.reduce((sum, row) => sum + row.maxScore, 0);
  const full = paperFull > 0 ? paperFull : 100;
  const scoreClass = typeof rdoc.score === 'number' ? SCORE_TONE_CLASS[scoreTone(rdoc.score, full)] : 'text-fg';

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <Panel className="min-w-0">
          <div className="flex min-w-0 flex-col flex-wrap gap-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="text-xs font-medium text-fg-subtle">结果</p>
              <p className={cn('mt-1 break-words text-lg font-semibold', verdict.tone)}>{verdict.label}</p>
              <p className="mt-1 break-words text-sm text-fg-muted">{submittedAt}</p>
            </div>
            <div className="flex flex-wrap gap-6">
              <div>
                <p className="text-xs text-fg-subtle">得分</p>
                <p className={cn('mt-1 text-lg font-semibold tabular', scoreClass)}>{rdoc.score ?? '—'}</p>
              </div>
              <div>
                <p className="text-xs text-fg-subtle">答对</p>
                <p className="mt-1 text-lg font-semibold tabular text-fg">
                  {correctCount}
                  <span className="text-sm font-normal text-fg-subtle">/{rows.length || '—'}</span>
                </p>
              </div>
            </div>
          </div>
        </Panel>
        <Panel className="min-w-0">
          <p className="text-xs text-fg-subtle">题目 / 用户</p>
          <a href={problemUrl} className="mt-1 block break-words text-sm font-semibold text-fg hover:text-brand-fg">
            {typeof pdoc.title === 'string' ? pdoc.title : '客观题'}
          </a>
          <div className="mt-3 flex flex-wrap gap-2 border-t border-line pt-3 text-xs">
            <span className="break-words rounded-md bg-surface-active px-2.5 py-1 font-medium text-fg">{username}</span>
            {student?.studentId ? <span className="break-words rounded-md bg-surface-active px-2.5 py-1 font-mono tabular">{student.studentId}</span> : null}
            {student?.realName ? <span className="break-words rounded-md bg-surface-active px-2.5 py-1 text-fg">{student.realName}</span> : null}
          </div>
        </Panel>
      </div>

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="break-words text-lg font-semibold text-fg">作答明细</h2>
          <p className="break-words text-xs text-fg-subtle">不展示标准答案，只对照你提交的选项。</p>
        </div>
        {rows.length ? (
          <ul className="flex flex-col gap-3">
            {rows.map((row, index) => (
              <li key={row.key}>
                <Panel>
                  <div className="flex flex-col gap-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs tabular text-fg-subtle">{index + 1}</span>
                          <Badge variant="outline" size="sm">
                            {kindLabel(row.kind)}
                          </Badge>
                          <ResultMark row={row} />
                        </div>
                        <p className="mt-2 text-sm font-medium text-fg">{row.prompt}</p>
                      </div>
                      {row.maxScore ? (
                        <p className="text-xs tabular text-fg-subtle">
                          <span className={cn('font-semibold', SCORE_TONE_CLASS[scoreTone(row.score, row.maxScore)])}>{row.score}</span>
                          /{row.maxScore}
                        </p>
                      ) : null}
                    </div>
                    <div className="rounded-md bg-surface-sunken px-3 py-2 text-sm">
                      <p className="text-2xs text-fg-subtle">你的答案</p>
                      <p className="mt-0.5 text-fg">{row.selectedLabel}</p>
                    </div>
                  </div>
                </Panel>
              </li>
            ))}
          </ul>
        ) : (
          <Panel>
            <EmptyState compact title="没有解析到作答内容。" />
          </Panel>
        )}
      </section>
    </div>
  );
}
