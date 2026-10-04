import { useMemo, useState } from 'react';
import { effectiveProblemKind, PROBLEM_KINDS, type ProblemKind } from '@hydrooj/common';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Panel } from '@/components/ui/panel';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

export const EXAM_SCORE_KIND_LABEL: Record<ProblemKind, string> = {
  programming: '编程',
  single: '单选',
  multi: '多选',
  true_false: '判断',
  blank: '填空',
  subjective: '主观',
  program_fill: '程序填空',
  function: '函数',
};

export type ExamScorePdictRow = {
  problemKind?: unknown;
  title?: unknown;
  pid?: unknown;
};

export type ExamScoreRow = {
  pid: number;
  label: string;
  title: string;
  kind: ProblemKind;
  score: number;
};

export function examScoreWeight(scores: Record<string, number> | undefined, pid: number): number {
  const raw = scores?.[String(pid)] ?? scores?.[pid as unknown as string];
  return Number.isInteger(raw) && Number(raw) >= 1 ? Number(raw) : 100;
}

export function examScoreRows(pids: number[], pdict: Record<string, ExamScorePdictRow>, scores?: Record<string, number>): ExamScoreRow[] {
  return pids.map((pid) => {
    const pdoc = pdict[String(pid)] || {};
    return {
      pid,
      label: typeof pdoc.pid === 'string' || typeof pdoc.pid === 'number' ? String(pdoc.pid) : String(pid),
      title: typeof pdoc.title === 'string' && pdoc.title ? pdoc.title : `题目 ${pid}`,
      kind: effectiveProblemKind(pdoc),
      score: examScoreWeight(scores, pid),
    };
  });
}

export function filterExamScoreRows(rows: ExamScoreRow[], kind: ProblemKind | '', query: string): ExamScoreRow[] {
  const needle = query.trim().toLowerCase();
  return rows.filter((row) => {
    if (kind && row.kind !== kind) return false;
    if (!needle) return true;
    return row.label.toLowerCase().includes(needle) || row.title.toLowerCase().includes(needle) || String(row.pid).includes(needle);
  });
}

export function ContestExamScoreBatch({
  pids,
  pdict,
  scores,
}: {
  pids: number[];
  pdict: Record<string, ExamScorePdictRow>;
  scores?: Record<string, number>;
}) {
  const [kind, setKind] = useState<ProblemKind | ''>('');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<number[]>([]);
  const [batchScore, setBatchScore] = useState('2');
  const rows = useMemo(() => examScoreRows(pids, pdict, scores), [pdict, pids, scores]);
  const visible = useMemo(() => filterExamScoreRows(rows, kind, query), [kind, query, rows]);
  const selectedSet = new Set(selected);
  const visibleSelected = visible.filter((row) => selectedSet.has(row.pid));
  const allVisibleSelected = visible.length > 0 && visibleSelected.length === visible.length;
  const someVisibleSelected = visibleSelected.length > 0 && !allVisibleSelected;
  const counts = useMemo(() => {
    const next = Object.fromEntries(PROBLEM_KINDS.map((item) => [item, 0])) as Record<ProblemKind, number>;
    for (const row of rows) next[row.kind] += 1;
    return next;
  }, [rows]);

  const toggle = (pid: number, checked: boolean) => {
    setSelected((current) => (checked ? [...new Set([...current, pid])] : current.filter((id) => id !== pid)));
  };

  return (
    <Panel title="题目分值" description="只改这场考试里的分数，不改题库。按题型筛选后多选，再批量设分。">
      <div className="space-y-3">
        {pids.length ? (
          <>
            <div className="flex flex-wrap gap-1.5">
              <KindChip label="全部" count={pids.length} active={kind === ''} onClick={() => setKind('')} />
              {PROBLEM_KINDS.map((item) => (
                <KindChip
                  key={item}
                  label={EXAM_SCORE_KIND_LABEL[item]}
                  count={counts[item]}
                  active={kind === item}
                  onClick={() => setKind(item === kind ? '' : item)}
                />
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="筛选题号或标题" className="max-w-sm" />
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={!visible.length}
                onClick={() =>
                  setSelected(
                    allVisibleSelected
                      ? selected.filter((pid) => !visible.some((row) => row.pid === pid))
                      : [...new Set([...selected, ...visible.map((row) => row.pid)])],
                  )
                }
              >
                {allVisibleSelected ? '取消全选' : '全选当前筛选'}
              </Button>
              <form method="post" className="flex flex-wrap items-center gap-2">
                <input type="hidden" name="operation" value="set_scores" />
                <input type="hidden" name="pids" value={selected.join(',')} />
                <Input
                  name="score"
                  type="number"
                  min={1}
                  value={batchScore}
                  onChange={(event) => setBatchScore(event.target.value)}
                  className="w-20 text-right"
                  aria-label="批量分数"
                />
                <Button type="submit" variant="primary" size="sm" disabled={!selected.length}>
                  所选设为该分{selected.length ? `（${selected.length}）` : ''}
                </Button>
              </form>
            </div>
            <div className="min-w-0 overflow-x-auto">
              <Table density="compact">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">
                      <Checkbox
                        size="sm"
                        checked={allVisibleSelected}
                        indeterminate={someVisibleSelected}
                        onCheckedChange={(checked) =>
                          setSelected(
                            checked ? [...new Set([...selected, ...visible.map((row) => row.pid)])] : selected.filter((pid) => !visible.some((row) => row.pid === pid)),
                          )
                        }
                        aria-label="全选"
                      />
                    </TableHead>
                    <TableHead className="w-24">题号</TableHead>
                    <TableHead>标题</TableHead>
                    <TableHead className="w-24">题型</TableHead>
                    <TableHead className="text-right">分值</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visible.map((row) => (
                    <TableRow key={row.pid} data-state={selectedSet.has(row.pid) ? 'selected' : undefined}>
                      <TableCell>
                        <Checkbox
                          size="sm"
                          checked={selectedSet.has(row.pid)}
                          onCheckedChange={(checked) => toggle(row.pid, !!checked)}
                          aria-label={`选择 ${row.label}`}
                        />
                      </TableCell>
                      <TableCell className="font-mono text-xs">{row.label}</TableCell>
                      <TableCell className="min-w-0">
                        <span className="block min-w-0 line-clamp-1">{row.title}</span>
                      </TableCell>
                      <TableCell>
                        <Badge variant="soft" tone="neutral">{EXAM_SCORE_KIND_LABEL[row.kind]}</Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <form method="post" className="flex items-center justify-end gap-1">
                          <input type="hidden" name="operation" value="set_score" />
                          <input type="hidden" name="pid" value={row.pid} />
                          <Input name="score" type="number" min={1} defaultValue={row.score} className="w-20 text-right" />
                          <Button type="submit" size="sm" variant="ghost">
                            保存
                          </Button>
                        </form>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {visible.length !== pids.length ? <p className="text-xs text-fg-subtle">当前显示 {visible.length} / {pids.length} 道题</p> : null}
          </>
        ) : (
          <EmptyState compact title="该考试还没有题目" />
        )}
      </div>
    </Panel>
  );
}

function KindChip({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant={active ? 'soft' : 'secondary'}
      size="sm"
      onClick={onClick}
      aria-pressed={active}
      aria-label={`${label} ${count}`}
    >
      {label}
      <span className="tabular">{count}</span>
    </Button>
  );
}
