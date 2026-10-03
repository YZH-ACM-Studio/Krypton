import * as React from 'react';
import { Check, Clock, Copy, Lock, Snowflake } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { StatusDot } from '@/components/ui/display';
import { Panel } from '@/components/ui/panel';
import { toast } from '@/components/ui/toast';
import { Difficulty, scoreTone, statusDisplay, Verdict } from '@/components/ui/verdict';
import { cn } from '@/lib/cn';
import { Specimen } from './foundations';

const TONE_TEXT = {
  danger: 'text-danger-fg',
  warning: 'text-warning-fg',
  success: 'text-success-fg',
} as const;

/** Old playground codes, expressed as §7.1 status numbers. There is no Partially Accepted status; the score row is Accepted. */
const VERDICT_ROWS: { status: number; score?: number }[] = [
  { status: 1 },
  { status: 2 },
  { status: 31 },
  { status: 3 },
  { status: 4 },
  { status: 5 },
  { status: 6 },
  { status: 7 },
  { status: 1, score: 60 },
  { status: 8 },
  { status: 0 },
  { status: 20 },
  { status: 9 },
];

export function Verdicts() {
  return (
    <>
      <Specimen label="评测结果" rule="AC 绿；WA/PE/FE 红；TLE/MLE/OLE 琥珀；RE 紫；CE 橙；评测中蓝 + 旋转；等待/取消/SE 灰。Verdict 内的分数为灰色；需要表达得分高低时，单独用 scoreTone 着色。">
        <div className="mb-4 flex items-center gap-4 text-sm">
          <span className={cn('tabular font-semibold', TONE_TEXT[scoreTone(0)])}>0</span>
          <span className={cn('tabular font-semibold', TONE_TEXT[scoreTone(60)])}>60</span>
          <span className={cn('tabular font-semibold', TONE_TEXT[scoreTone(100)])}>100</span>
        </div>
        <div className="grid gap-x-8 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
          {VERDICT_ROWS.map((row, index) => {
            const display = statusDisplay(row.status);
            return (
              <div key={`${row.status}-${index}`} className="flex items-center justify-between gap-3 border-b border-line-subtle pb-2">
                <Verdict status={row.status} score={row.score} />
                <Badge tone={display.tone} size="sm" className="font-mono">
                  {display.short}
                </Badge>
              </div>
            );
          })}
        </div>
      </Specimen>
      <Specimen label="难度" rule="难度是分类而不是状态，统一 outline 小号。">
        <div className="flex flex-wrap gap-2">
          {[1, 3, 5, 7, 9].map((level) => (
            <Difficulty key={level} level={level} />
          ))}
        </div>
      </Specimen>
    </>
  );
}

/* --------------------------------------------------------------- samples */

function writeClipboard(text: string): Promise<void> {
  const clipboard = navigator.clipboard;
  if (!clipboard || typeof clipboard.writeText !== 'function') {
    return Promise.reject(new TypeError('Clipboard API is unavailable'));
  }
  return clipboard.writeText(text);
}

function clipboardFailure(error: unknown): string {
  return error instanceof Error ? error.message : 'Clipboard write failed';
}

function SampleBox({ label, text }: { label: string; text: string }) {
  const [copied, setCopied] = React.useState(false);
  return (
    <div className="min-w-0 overflow-hidden rounded-md border border-line bg-surface-sunken">
      <div className="flex h-8 items-center justify-between border-b border-line-subtle px-3">
        <span className="text-xs font-medium text-fg-muted">{label}</span>
        <button
          type="button"
          onClick={() => {
            void writeClipboard(text).then(() => {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1200);
            }, (error: unknown) => {
              toast.error('无法复制样例', { description: clipboardFailure(error) });
            });
          }}
          className="inline-flex items-center gap-1 rounded-sm px-1 text-2xs text-fg-subtle transition-colors duration-(--dur-1) hover:text-fg"
        >
          {copied ? <Check className="size-3 text-success-fg" /> : <Copy className="size-3" />}
          {copied ? '已复制' : '复制'}
        </button>
      </div>
      <pre className="overflow-x-auto px-3 py-2.5 font-mono text-sm leading-relaxed text-fg">{text}</pre>
    </div>
  );
}

export function Samples() {
  return (
    <Specimen label="样例" rule="输入/输出并排（sm 以上），等宽、可复制、横向滚动不折行。">
      <div className="grid gap-3 sm:grid-cols-2">
        <SampleBox label="输入 #1" text={'5 3\n1 2 3 4 5\n1 3\n2 5\n1 5'} />
        <SampleBox label="输出 #1" text={'6\n14\n15'} />
      </div>
    </Specimen>
  );
}

/* ------------------------------------------------------------ scoreboard */

type Cell = { ac?: boolean; tries: number; time?: number; first?: boolean; frozen?: number } | null;

const BOARD: { rank: number; name: string; team: string; solved: number; penalty: number; cells: Cell[] }[] = [
  {
    rank: 1,
    name: '今天也要 AC',
    team: '计科 2401',
    solved: 5,
    penalty: 612,
    cells: [{ ac: true, tries: 1, time: 8, first: true }, { ac: true, tries: 2, time: 41 }, { ac: true, tries: 1, time: 77 }, { ac: true, tries: 3, time: 133, first: true }, { ac: true, tries: 1, time: 198 }, { tries: 4 }],
  },
  {
    rank: 2,
    name: '队名想不出来',
    team: '软工 2302',
    solved: 5,
    penalty: 704,
    cells: [{ ac: true, tries: 1, time: 11 }, { ac: true, tries: 1, time: 29, first: true }, { ac: true, tries: 2, time: 96 }, { ac: true, tries: 1, time: 160 }, { ac: true, tries: 2, time: 247 }, { tries: 0, frozen: 2 }],
  },
  {
    rank: 3,
    name: 'WA 到天明',
    team: '计科 2402',
    solved: 4,
    penalty: 455,
    cells: [{ ac: true, tries: 1, time: 15 }, { ac: true, tries: 3, time: 88 }, { ac: true, tries: 1, time: 102, first: true }, { tries: 2 }, { ac: true, tries: 1, time: 190, first: true }, null],
  },
  {
    rank: 4,
    name: 'O(1) 选手',
    team: '数学 2401',
    solved: 3,
    penalty: 301,
    cells: [{ ac: true, tries: 2, time: 22 }, { ac: true, tries: 1, time: 64 }, null, { tries: 5 }, { ac: true, tries: 1, time: 175 }, { tries: 0, frozen: 1 }],
  },
];

function ScoreCell({ cell, big }: { cell: Cell; big?: boolean }) {
  if (!cell) return <td className="h-12 border-b border-l border-line-subtle" />;
  const base = 'h-12 border-b border-l border-line-subtle text-center leading-tight tabular';
  const primary = cn('text-sm font-semibold', big && '3xl:text-md');
  const secondary = cn('text-2xs', big && '3xl:text-xs');
  if (cell.frozen) {
    return (
      <td className={cn(base, 'bg-info-soft text-info-fg')}>
        <div className={primary}>?</div>
        <div className={secondary}>
          {cell.tries + cell.frozen}
          {' '}
          次
        </div>
      </td>
    );
  }
  if (cell.ac) {
    return (
      <td className={cn(base, cell.first ? 'bg-success text-on-success' : 'bg-success-soft text-success-fg')}>
        <div className={primary}>
          +
          {cell.tries > 1 ? cell.tries - 1 : ''}
        </div>
        <div className={secondary}>{cell.time}</div>
      </td>
    );
  }
  if (cell.tries === 0) return <td className="h-12 border-b border-l border-line-subtle" />;
  return (
    <td className={cn(base, 'bg-danger-soft text-danger-fg')}>
      <div className={primary}>
        −
        {cell.tries}
      </div>
    </td>
  );
}

export function Scoreboard({ big }: { big?: boolean }) {
  const probs = ['A', 'B', 'C', 'D', 'E', 'F'];
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[42rem] border-separate border-spacing-0">
        <thead className="sticky top-0 z-20">
          <tr className={cn('text-xs text-fg-subtle', big && '3xl:text-sm')}>
            <th className="sticky left-0 z-10 h-9 w-12 border-b border-line bg-surface-sunken text-center font-medium">#</th>
            <th className="sticky left-12 z-10 border-b border-line bg-surface-sunken px-3 text-left font-medium">队伍</th>
            <th className="w-14 border-b border-line bg-surface-sunken text-right font-medium">题数</th>
            <th className="w-16 border-b border-line bg-surface-sunken px-3 text-right font-medium">罚时</th>
            {probs.map((problem) => (
              <th key={problem} className="w-16 border-b border-l border-line-subtle bg-surface-sunken text-center font-semibold text-fg-muted">
                {problem}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {BOARD.map((row) => (
            <tr key={row.rank} className="group">
              <td className={cn('sticky left-0 z-10 border-b border-line-subtle bg-surface text-center text-sm font-semibold tabular text-fg group-hover:bg-surface-hover', big && '3xl:text-md')}>
                {row.rank}
              </td>
              <td className="sticky left-12 z-10 border-b border-line-subtle bg-surface px-3 group-hover:bg-surface-hover">
                <div className={cn('truncate text-sm font-medium text-fg', big && '3xl:text-md')}>{row.name}</div>
                <div className={cn('truncate text-xs text-fg-subtle', big && '3xl:text-sm')}>{row.team}</div>
              </td>
              <td className={cn('border-b border-line-subtle text-right text-md font-semibold tabular text-fg', big && '3xl:text-lg')}>{row.solved}</td>
              <td className={cn('border-b border-line-subtle px-3 text-right text-sm tabular text-fg-muted', big && '3xl:text-md')}>{row.penalty}</td>
              {row.cells.map((cell, index) => (
                <ScoreCell key={`${row.rank}-${index}`} cell={cell} big={big} />
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ScoreboardSpec() {
  return (
    <Specimen label="ACM 榜单" rule="通过 success-soft；一血 success 实底；错误 danger-soft；封榜 info-soft + ?。前两列 sticky，窄屏横向滚动（不转卡片）。" stage={false}>
      <Panel
        flush
        title="2026 秋季校赛 · 第一场"
        description="封榜中 · 剩余 00:42:17"
        actions={(
          <Badge tone="info" dot>
            <Snowflake className="size-3" />
            已封榜
          </Badge>
        )}
      >
        <Scoreboard />
      </Panel>
    </Specimen>
  );
}

/* ---------------------------------------------------------- contest card */

function useCountdown(seconds: number) {
  const [left, setLeft] = React.useState(seconds);
  React.useEffect(() => {
    const timer = window.setInterval(() => setLeft((value) => (value > 0 ? value - 1 : 0)), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const hours = String(Math.floor(left / 3600)).padStart(2, '0');
  const minutes = String(Math.floor((left % 3600) / 60)).padStart(2, '0');
  const secs = String(left % 60).padStart(2, '0');
  return `${hours}:${minutes}:${secs}`;
}

export function ContestStatus() {
  const left = useCountdown(2537);
  return (
    <>
      <Specimen label="比赛卡片" rule="状态用脉冲点 + 文字，不用整卡变色。时间统一 tabular 等宽。" stage={false}>
        <div className="grid gap-4 md:grid-cols-3">
          {[
            { title: '2026 秋季校赛 · 第一场', status: '进行中', tone: 'success' as const, pulse: true, meta: `剩余 ${left}`, rule: 'ACM', n: 186 },
            { title: '算法设计 · 第 5 周作业', status: '即将开始', tone: 'info' as const, pulse: false, meta: '10 月 8 日 19:00', rule: 'OI', n: 92 },
            { title: '新生摸底赛', status: '已结束', tone: 'neutral' as const, pulse: false, meta: '9 月 21 日', rule: 'IOI', n: 341 },
          ].map((card) => (
            <article key={card.title} className="group flex flex-col gap-3 rounded-lg border border-line bg-surface p-4 shadow-xs transition-[border-color,box-shadow] duration-(--dur-2) hover:border-line-strong hover:shadow-sm">
              <div className="flex items-center gap-2 text-xs font-medium text-fg-muted">
                <StatusDot tone={card.tone} pulse={card.pulse} />
                {card.status}
                <Badge size="sm" variant="outline" className="ml-auto">
                  {card.rule}
                </Badge>
              </div>
              <h3 className="text-md font-semibold text-fg text-balance">{card.title}</h3>
              <div className="mt-auto flex items-center justify-between text-xs text-fg-subtle">
                <span className="inline-flex items-center gap-1 tabular">
                  <Clock className="size-3.5" />
                  {card.meta}
                </span>
                <span className="tabular">
                  {card.n}
                  {' '}
                  人
                </span>
              </div>
            </article>
          ))}
        </div>
      </Specimen>
      <Specimen label="考试计时条（short 视口贴顶）" rule="考试中唯一允许常驻的高亮条。剩余 ≤ 5 分钟转 warning，≤ 1 分钟转 danger；颜色切换不闪烁。" stage={false}>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-line bg-surface px-4 py-2.5 shadow-xs">
          <span className="inline-flex items-center gap-1.5 text-sm font-medium text-fg">
            <Lock className="size-4 text-fg-subtle" />
            考试模式
          </span>
          <span className="text-sm text-fg-muted">数据结构期中机考</span>
          <span className="ml-auto inline-flex items-center gap-2">
            <span className="text-xs text-fg-subtle">剩余</span>
            <span className="font-mono text-lg font-semibold tabular text-fg">{left}</span>
          </span>
          <Button type="button" size="sm" variant="primary">
            交卷
          </Button>
        </div>
      </Specimen>
    </>
  );
}
