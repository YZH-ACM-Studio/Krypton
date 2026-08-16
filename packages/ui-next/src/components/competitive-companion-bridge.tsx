import { useState } from 'react';
import { Download, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { SimpleSelect } from '@/components/ui/select';
import {
  buildCompanionTask,
  importContestCompanionTasks,
  mapCompanionLanguage,
  readCompanionSourceFile,
  sendCompanionTask,
  sendCompanionTasks,
  submitCompanionSolution,
  type CompanionContestEligibility,
  type CompanionContestProblemRef,
  type CompanionTest,
} from '@/lib/competitive-companion';
import { COMMON_LANG_OPTIONS, resolveLangs } from '@/lib/multi-select-presets';

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
  canSubmitBack = false,
  submitUrl,
  allowedLangs = [],
  tid,
  practiceContextId,
  recordDetailUrl,
}: {
  name: string;
  group: string;
  url: string;
  timeLimitMs: number;
  memoryLimitMb: number;
  tests: CompanionTest[];
  canSubmitBack?: boolean;
  submitUrl?: string;
  allowedLangs?: string[];
  tid?: string;
  practiceContextId?: string;
  recordDetailUrl?: (rid: string) => string;
}) {
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'failed'>('idle');
  const [error, setError] = useState<string | null>(null);
  const task = buildCompanionTask({ name, group, url, timeLimitMs, memoryLimitMb, tests });

  return (
    <div className="flex flex-col items-stretch gap-1 sm:items-end">
      <HydroCompanionMarkup name={task.name} timeLimitMs={task.timeLimit} memoryLimitMb={task.memoryLimit} tests={task.tests} />
      <div className="flex flex-wrap items-center justify-end gap-1">
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="gap-1"
          disabled={status === 'sending'}
          onClick={() => {
            setStatus('sending');
            setError(null);
            void sendCompanionTask(task).then(
              () => setStatus('sent'),
              (cause: unknown) => {
                setStatus('failed');
                setError(cause instanceof Error && cause.message ? cause.message : '发送失败');
              },
            );
          }}
        >
          <Download className="size-3.5" />
          {status === 'sending' ? '正在发送…' : status === 'sent' ? '已发送到 CPH' : status === 'failed' ? '发送失败' : '发送到 CPH'}
        </Button>
        {canSubmitBack && submitUrl ? (
          <CompanionSubmitBack
            submitUrl={submitUrl}
            allowedLangs={allowedLangs}
            tid={tid}
            practiceContextId={practiceContextId}
            recordDetailUrl={recordDetailUrl}
          />
        ) : null}
      </div>
      <p className="max-w-72 text-[11px] leading-4 text-muted-foreground sm:text-right">
        {status === 'failed'
          ? error || '本机没有收到题目。请先打开 VS Code 里的 CPH，或用 Competitive Companion 右键加号选择 Hydro。'
          : 'Competitive Companion 请右键绿色加号，选择 Parse with → Hydro。也可点按钮直接发到本机 CPH。'}
      </p>
    </div>
  );
}

export function ContestCompanionBridge({
  eligibility,
  contestTitle,
  origin,
  problems,
}: {
  eligibility: CompanionContestEligibility;
  contestTitle: string;
  origin: string;
  problems: CompanionContestProblemRef[];
}) {
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'failed'>('idle');
  const [detail, setDetail] = useState<string | null>(null);
  if (!eligibility.allowed) return null;

  return (
    <div className="flex flex-col items-stretch gap-1 sm:items-end">
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="gap-1"
        disabled={status === 'sending'}
        onClick={() => {
          setStatus('sending');
          setDetail(null);
          void importContestCompanionTasks({ eligibility, contestTitle, origin, problems })
            .then(async ({ tasks, skipped }) => {
              await sendCompanionTasks(tasks);
              const skipNote = skipped.length ? `，跳过 ${skipped.length} 道非编程题` : '';
              setDetail(`已导入 ${tasks.length} 题${skipNote}`);
              setStatus('sent');
            })
            .catch((cause: unknown) => {
              setStatus('failed');
              setDetail(cause instanceof Error && cause.message ? cause.message : '整场导入失败');
            });
        }}
      >
        <Download className="size-3.5" />
        {status === 'sending' ? '正在导入…' : status === 'sent' ? '已整场导入' : status === 'failed' ? '导入失败' : '整场导入 CPH'}
      </Button>
      <p className="max-w-72 text-[11px] leading-4 text-muted-foreground sm:text-right">
        {detail || '仅个人 ACM / IOI 赛可以把整场题目一次发到本机 CPH。请先打开 CPH。'}
      </p>
    </div>
  );
}

export function CompanionSubmitBack({
  submitUrl,
  allowedLangs,
  tid,
  practiceContextId,
  recordDetailUrl,
}: {
  submitUrl: string;
  allowedLangs: string[];
  tid?: string;
  practiceContextId?: string;
  recordDetailUrl?: (rid: string) => string;
}) {
  const [open, setOpen] = useState(false);
  const [fileName, setFileName] = useState<string>('');
  const [code, setCode] = useState('');
  const [lang, setLang] = useState(allowedLangs.find((item) => item && item !== '_') || 'cc.cc17');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const restrictedLangs = allowedLangs.filter((item) => item && item !== '_');
  const langOptions = restrictedLangs.length ? resolveLangs(restrictedLangs) : COMMON_LANG_OPTIONS;

  return (
    <>
      <Button type="button" size="sm" variant="outline" className="gap-1" onClick={() => setOpen(true)}>
        <Upload className="size-3.5" />
        回传提交
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>从 CPH 回传提交</DialogTitle>
          </DialogHeader>
          <DialogBody className="space-y-3 px-6 py-4">
            <p className="text-sm text-muted-foreground">
              CPH 自带的 Submit 只支持 Codeforces / CSES，不会把代码交到本站。请选择本题在 CPH
              里打开的源码文件，本站会用当前登录会话提交到原来的评测入口。
            </p>
            <label className="block space-y-1 text-sm">
              <span className="font-medium">源码文件</span>
              <input
                type="file"
                className="block w-full text-xs file:mr-2 file:rounded-md file:border file:border-border file:bg-background file:px-2 file:py-1"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  setError(null);
                  setCode('');
                  setFileName('');
                  if (!file) return;
                  void readCompanionSourceFile(file).then(
                    (text) => {
                      setCode(text);
                      setFileName(file.name);
                      const mapped = mapCompanionLanguage({ filename: file.name, allowedLangs });
                      if ('lang' in mapped) setLang(mapped.lang);
                      else setError(mapped.reason);
                    },
                    (cause: unknown) => {
                      setError(cause instanceof Error && cause.message ? cause.message : '读取源码失败');
                    },
                  );
                }}
              />
              {fileName ? <span className="text-xs text-muted-foreground">{fileName}</span> : null}
            </label>
            <label className="block space-y-1 text-sm">
              <span className="font-medium">语言</span>
              <SimpleSelect
                value={lang}
                onValueChange={setLang}
                options={langOptions.length ? langOptions : [{ value: lang, label: lang || '请选择语言' }]}
                placeholder="选择语言"
              />
            </label>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
                取消
              </Button>
              <Button
                type="button"
                disabled={busy}
                onClick={() => {
                  setBusy(true);
                  setError(null);
                  void submitCompanionSolution({
                    submitUrl,
                    lang,
                    code,
                    origin: window.location.origin,
                    tid,
                    practiceContextId,
                  }).then(
                    (result) => {
                      window.location.href = result.rid && recordDetailUrl ? recordDetailUrl(result.rid) : result.url;
                    },
                    (cause: unknown) => {
                      setBusy(false);
                      setError(cause instanceof Error && cause.message ? cause.message : '回传提交失败');
                    },
                  );
                }}
              >
                {busy ? '正在提交…' : '提交到本站'}
              </Button>
            </div>
          </DialogBody>
        </DialogContent>
      </Dialog>
    </>
  );
}
