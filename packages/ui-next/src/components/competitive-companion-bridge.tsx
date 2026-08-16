import { useState } from 'react';
import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  buildCompanionTask,
  sendCompanionTask,
  type CompanionTest,
} from '@/lib/competitive-companion';

export function HydroCompanionMarkup({
  name,
  timeLimitMs,
  memoryLimitMb,
  tests,
}: {
  name: string;
  timeLimitMs: number;
  memoryLimitMb: number;
  tests: CompanionTest[];
}) {
  return (
    <div hidden aria-hidden="true" data-krypton-companion="hydro">
      <div className="section__title">{name}</div>
      {tests.flatMap((test, index) => [
        <div key={`${index}-in`} className="sample">
          <pre>
            <code>{test.input}</code>
          </pre>
        </div>,
        <div key={`${index}-out`} className="sample">
          <pre>
            <code>{test.output}</code>
          </pre>
        </div>,
      ])}
      <span className="icon-stopwatch">{timeLimitMs}ms</span>
      <span className="icon-comparison">{memoryLimitMb}MiB</span>
    </div>
  );
}

export function CompetitiveCompanionBridge({
  name,
  group,
  url,
  timeLimitMs,
  memoryLimitMb,
  tests,
}: {
  name: string;
  group: string;
  url: string;
  timeLimitMs: number;
  memoryLimitMb: number;
  tests: CompanionTest[];
}) {
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'failed'>('idle');
  const task = buildCompanionTask({ name, group, url, timeLimitMs, memoryLimitMb, tests });

  return (
    <div className="flex flex-col items-stretch gap-1 sm:items-end">
      <HydroCompanionMarkup name={task.name} timeLimitMs={task.timeLimit} memoryLimitMb={task.memoryLimit} tests={task.tests} />
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="gap-1"
        disabled={status === 'sending'}
        onClick={() => {
          setStatus('sending');
          void sendCompanionTask(task).then(
            () => setStatus('sent'),
            () => setStatus('failed'),
          );
        }}
      >
        <Download className="size-3.5" />
        {status === 'sending' ? '正在发送…' : status === 'sent' ? '已发送到 CPH' : status === 'failed' ? '发送失败' : '发送到 CPH'}
      </Button>
      <p className="max-w-64 text-[11px] leading-4 text-muted-foreground sm:text-right">
        {status === 'failed'
          ? '本机没有收到题目。请先打开 VS Code 里的 CPH，或用 Competitive Companion 右键加号选择 Hydro。'
          : 'Competitive Companion 请右键绿色加号，选择 Parse with → Hydro。也可点按钮直接发到本机 CPH。'}
      </p>
    </div>
  );
}
