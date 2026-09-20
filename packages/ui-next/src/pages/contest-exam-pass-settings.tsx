import { useMemo, useState } from 'react';
import {
  examDefinitePaperMax,
  examDrawUnitContributions,
  minProblemsToPass,
  parseExamAttemptLimit,
  parseExamPassScore,
  type ProblemKind,
} from '@hydrooj/common';
import { Input } from '@/components/ui/input';
import { examPaperScoreWeight } from './contest-exam-paper-pool';

export function ContestExamPassSettings({
  pids,
  scores,
  quotas,
  kinds,
  passScore,
  attemptLimit,
}: {
  pids: string[];
  scores: Record<string, number>;
  quotas?: Partial<Record<string, number>>;
  kinds: ReadonlyMap<string, ProblemKind>;
  passScore?: unknown;
  attemptLimit?: unknown;
}) {
  const [passText, setPassText] = useState(() => {
    try {
      const parsed = parseExamPassScore(passScore);
      return parsed === null ? '' : String(parsed);
    } catch {
      return '';
    }
  });
  const [limitText, setLimitText] = useState(() => {
    try {
      const parsed = parseExamAttemptLimit(attemptLimit);
      return parsed <= 1 ? '' : String(parsed);
    } catch {
      return '';
    }
  });

  const helper = useMemo(() => {
    const numericPids = pids.filter((id) => /^[1-9][0-9]*$/.test(id)).map(Number);
    const tdoc = {
      score: Object.fromEntries(numericPids.map((pid) => [pid, examPaperScoreWeight(scores, String(pid))])),
      examPaperQuotas: quotas && Object.keys(quotas).length ? quotas : undefined,
    };
    const kindMap = new Map<number, ProblemKind>();
    for (const pid of numericPids) {
      const kind = kinds.get(String(pid));
      if (kind) kindMap.set(pid, kind);
    }
    let pass: number | null = null;
    let limit = 1;
    let passError = '';
    let limitError = '';
    try {
      pass = parseExamPassScore(passText);
    } catch {
      passError = '及格分必须是 ≥1 的整数，或留空。';
    }
    try {
      limit = parseExamAttemptLimit(limitText);
    } catch {
      limitError = '补考次数必须是 ≥1 的整数，或留空表示只能考一次。';
    }
    let paperMax: number | null = null;
    let minCount: number | null = null;
    let mixedDraw = false;
    try {
      paperMax = examDefinitePaperMax(tdoc, numericPids, kindMap.size === numericPids.length ? kindMap : undefined);
      const units = examDrawUnitContributions(tdoc, numericPids, kindMap.size === numericPids.length ? kindMap : new Map());
      mixedDraw = Boolean(tdoc.examPaperQuotas) && units === null;
      if (pass !== null && units) minCount = minProblemsToPass(pass, units);
    } catch {
      paperMax = null;
    }
    const aboveMax = pass !== null && paperMax !== null && pass > paperMax;
    return { pass, limit, passError, limitError, paperMax, minCount, mixedDraw, aboveMax };
  }, [attemptLimit, kinds, limitText, passText, pids, quotas, scores]);

  return (
    <section className="min-w-0 space-y-3 rounded-xl border bg-muted/20 p-4">
      <div>
        <h3 className="text-sm font-medium">及格与补考</h3>
        <p className="text-xs text-muted-foreground">
          留空及格分则交卷即结束，不能补考。填写后不及格且次数未满、整场还够再开一轮时可再考。
        </p>
      </div>
      <div className="grid min-w-0 gap-3 sm:grid-cols-2">
        <label className="min-w-0 space-y-1.5">
          <span className="text-xs text-muted-foreground">及格分</span>
          <Input
            name="examPassScore"
            type="number"
            min={1}
            step={1}
            value={passText}
            onChange={(event) => setPassText(event.target.value)}
            placeholder="留空表示不设及格线"
          />
        </label>
        <label className="min-w-0 space-y-1.5">
          <span className="text-xs text-muted-foreground">最多考几次</span>
          <Input
            name="examAttemptLimit"
            type="number"
            min={1}
            step={1}
            value={limitText}
            onChange={(event) => setLimitText(event.target.value)}
            placeholder="留空或 1 表示只能考一次"
          />
        </label>
      </div>
      {helper.passError ? <p className="text-xs text-destructive">{helper.passError}</p> : null}
      {helper.limitError ? <p className="text-xs text-destructive">{helper.limitError}</p> : null}
      {helper.aboveMax ? <p className="text-xs text-destructive">及格分高于当前算得出的卷面满分，不能保存。</p> : null}
      {helper.mixedDraw ? (
        <p className="text-xs text-muted-foreground">抽卷后每人卷面不同，且同一题型本场分数不一致，不给出统一最少题数。</p>
      ) : null}
      {helper.pass !== null && !helper.passError ? (
        <div className="space-y-1 text-sm">
          {helper.paperMax !== null ? (
            <p>
              卷面满分 <span className="font-medium tabular-nums">{helper.paperMax}</span>
              {helper.minCount !== null ? (
                <>
                  ，至少全对 <span className="font-medium tabular-nums">{helper.minCount}</span> 题才够及格
                </>
              ) : (
                '，按当前分数凑不够及格分'
              )}
            </p>
          ) : (
            <p className="text-muted-foreground">抽卷后按该生卷面总分判定及格。</p>
          )}
          {helper.limit > 1 ? <p className="text-xs text-muted-foreground">不及格最多再开 {helper.limit - 1} 轮，含首次共 {helper.limit} 次。</p> : null}
        </div>
      ) : null}
    </section>
  );
}
