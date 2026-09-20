import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { SimpleSelect } from '@/components/ui/select';
import { cn } from '@/lib/cn';

export const PRACTICE_ROSTER_EXAM_STATES = ['not_started', 'in_progress', 'judging', 'finalized'] as const;
export type PracticeRosterExamState = (typeof PRACTICE_ROSTER_EXAM_STATES)[number];

export interface PracticeRosterExamFact {
  state: PracticeRosterExamState;
  attemptsUsed: number;
  score?: number;
  passed?: boolean;
}

export interface PracticeRosterExamMeta {
  title: string;
  passScore: number | null;
  attemptLimit: number;
}

export interface PracticeRosterMember {
  uid: number;
  uname: string;
  realName: string;
  studentId: string;
  groups: string[];
  groupIds: string[];
  done: number;
  total: number;
  completedPids: number[];
  exam?: PracticeRosterExamFact;
}

export interface PracticeRosterProblem {
  pid: number;
  title: string;
  pidLabel: string;
}

const UNGROUPED = '__ungrouped__';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function readPracticeRosterExamMeta(value: unknown): PracticeRosterExamMeta | null {
  if (value === undefined || value === null) return null;
  if (!isRecord(value)) throw new TypeError('rosterExam must be an object');
  const title = typeof value.title === 'string' && value.title.trim() ? value.title.trim() : '结业考试';
  if (value.passScore !== null && (typeof value.passScore !== 'number' || !Number.isInteger(value.passScore) || value.passScore < 1)) {
    throw new TypeError('rosterExam.passScore is invalid');
  }
  if (typeof value.attemptLimit !== 'number' || !Number.isInteger(value.attemptLimit) || value.attemptLimit < 1) {
    throw new TypeError('rosterExam.attemptLimit is invalid');
  }
  return {
    title,
    passScore: value.passScore === null ? null : value.passScore,
    attemptLimit: value.attemptLimit,
  };
}

export function readPracticeRosterExamFact(value: unknown, label = 'exam'): PracticeRosterExamFact {
  if (!isRecord(value)) throw new TypeError(`${label} must be an object`);
  if (!PRACTICE_ROSTER_EXAM_STATES.includes(value.state as PracticeRosterExamState)) {
    throw new TypeError(`${label}.state is invalid`);
  }
  if (typeof value.attemptsUsed !== 'number' || !Number.isInteger(value.attemptsUsed) || value.attemptsUsed < 0) {
    throw new TypeError(`${label}.attemptsUsed is invalid`);
  }
  const fact: PracticeRosterExamFact = {
    state: value.state as PracticeRosterExamState,
    attemptsUsed: value.attemptsUsed,
  };
  if (value.score !== undefined) {
    if (typeof value.score !== 'number' || !Number.isFinite(value.score)) throw new TypeError(`${label}.score is invalid`);
    if (fact.state !== 'finalized' && fact.state !== 'judging') {
      throw new TypeError(`${label}.score cannot appear before the paper is submitted`);
    }
    fact.score = value.score;
  }
  if (value.passed !== undefined) {
    if (typeof value.passed !== 'boolean') throw new TypeError(`${label}.passed is invalid`);
    if (fact.state !== 'finalized') throw new TypeError(`${label}.passed cannot appear before judging settles`);
    fact.passed = value.passed;
  }
  return fact;
}

function neutralizeCsvCell(value: unknown): string {
  let text = String(value ?? '');
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

function downloadCsv(filename: string, lines: string[]) {
  const blob = new Blob([`\uFEFF${lines.join('\r\n')}`], { type: 'text/csv;charset=utf-8' });
  const link = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(blob),
    download: filename,
  });
  link.click();
  URL.revokeObjectURL(link.href);
}

export interface PracticeRosterGroupColumn {
  id: string;
  name: string;
  memberCount: number;
  allDoneCount: number;
  averageDone: number;
}

export function rosterGroupColumns(members: readonly PracticeRosterMember[], visibleGroupIds?: readonly string[]): PracticeRosterGroupColumn[] {
  const allowed = visibleGroupIds?.length ? new Set(visibleGroupIds) : null;
  const columns = new Map<string, { name: string; uids: Set<number>; allDone: number; doneSum: number }>();
  let ungrouped = false;
  for (const member of members) {
    const ids = member.groupIds.filter((groupId) => !allowed || allowed.has(groupId));
    if (!ids.length) ungrouped = true;
    const names = member.groups;
    ids.forEach((groupId) => {
      const nameIndex = member.groupIds.indexOf(groupId);
      const current = columns.get(groupId) || { name: names[nameIndex] || groupId, uids: new Set<number>(), allDone: 0, doneSum: 0 };
      if (!current.uids.has(member.uid)) {
        current.uids.add(member.uid);
        current.doneSum += member.done;
        if (member.total > 0 && member.done >= member.total) current.allDone += 1;
      }
      columns.set(groupId, current);
    });
  }
  const result: PracticeRosterGroupColumn[] = [...columns.entries()].map(([id, column]) => ({
    id,
    name: column.name,
    memberCount: column.uids.size,
    allDoneCount: column.allDone,
    averageDone: column.uids.size ? column.doneSum / column.uids.size : 0,
  }));
  result.sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'));
  if (ungrouped) {
    const people = members.filter((member) => !member.groupIds.length);
    result.push({
      id: UNGROUPED,
      name: '未分组',
      memberCount: people.length,
      allDoneCount: people.filter((member) => member.total > 0 && member.done >= member.total).length,
      averageDone: people.length ? people.reduce((sum, member) => sum + member.done, 0) / people.length : 0,
    });
  }
  return result;
}

export function practiceRosterMatrixCell(
  members: readonly PracticeRosterMember[],
  groupId: string,
  pid: number,
): { completed: number; total: number } {
  const inGroup = members.filter((member) => (groupId === UNGROUPED ? member.groupIds.length === 0 : member.groupIds.includes(groupId)));
  return {
    completed: inGroup.filter((member) => member.completedPids.includes(pid)).length,
    total: inGroup.length,
  };
}

export function practiceRosterExamLabel(exam: PracticeRosterExamFact | undefined): string {
  if (!exam) return '—';
  if (exam.state === 'not_started') return '未开考';
  if (exam.state === 'in_progress') return '答题中';
  if (exam.state === 'judging') return '评测中';
  if (exam.passed === true) return '已及格';
  if (exam.passed === false) return '未及格';
  return '已交卷';
}

export function practiceRosterExamScoreText(exam: PracticeRosterExamFact | undefined): string {
  if (!exam || (exam.state !== 'finalized' && exam.state !== 'judging') || typeof exam.score !== 'number') return '—';
  return String(exam.score);
}

export function rosterExamGroupColumns(
  members: readonly PracticeRosterMember[],
  visibleGroupIds?: readonly string[],
): Array<PracticeRosterGroupColumn & { finalizedCount: number; passedCount: number; averageScore: number | null }> {
  const columns = rosterGroupColumns(members, visibleGroupIds);
  return columns.map((column) => {
    const inGroup = members.filter((member) => (column.id === UNGROUPED ? member.groupIds.length === 0 : member.groupIds.includes(column.id)));
    const settled = inGroup.filter((member) => member.exam?.state === 'finalized');
    const scores = settled.flatMap((member) => (typeof member.exam?.score === 'number' ? [member.exam.score] : []));
    return {
      ...column,
      finalizedCount: settled.length,
      passedCount: settled.filter((member) => member.exam?.passed === true).length,
      averageScore: scores.length ? scores.reduce((sum, score) => sum + score, 0) / scores.length : null,
    };
  });
}

export function PracticeRosterCard({
  members,
  problems,
  title,
  truncated,
  visibleGroupIds,
  exam,
  examWarning,
  className,
}: {
  members: PracticeRosterMember[];
  problems?: PracticeRosterProblem[];
  title: string;
  truncated?: boolean;
  visibleGroupIds?: string[];
  exam?: PracticeRosterExamMeta | null;
  examWarning?: string;
  className?: string;
}) {
  const [query, setQuery] = useState('');
  const [groupFilter, setGroupFilter] = useState('');
  const showProblems = Boolean(problems?.length) || members.some((member) => member.total > 0);
  const showExam = Boolean(exam) || members.some((member) => member.exam);
  const columns = useMemo(() => rosterGroupColumns(members, visibleGroupIds), [members, visibleGroupIds]);
  const examColumns = useMemo(() => (showExam ? rosterExamGroupColumns(members, visibleGroupIds) : []), [members, showExam, visibleGroupIds]);
  const keyword = query.trim().toLowerCase();
  const filtered = members.filter((member) => {
    if (groupFilter === UNGROUPED && member.groupIds.length) return false;
    if (groupFilter && groupFilter !== UNGROUPED && !member.groupIds.includes(groupFilter)) return false;
    if (!keyword) return true;
    return [member.uname, member.realName, member.studentId, ...(member.groups || [])].some((field) =>
      String(field || '')
        .toLowerCase()
        .includes(keyword),
    );
  });
  const matrixColumns = groupFilter ? columns.filter((column) => column.id === groupFilter) : columns;
  const columnCount = 4 + (showProblems ? 1 : 0) + (showExam ? 2 : 0);

  const exportMembers = () => {
    downloadCsv(`${title || '花名册'}-参加名单.csv`, [
      [
        '用户名',
        '真实姓名',
        '学号',
        '班级组',
        ...(showProblems ? ['已完成题数', '总题数', '完成率'] : []),
        ...(showExam ? ['结业考试', '分数', '是否及格'] : []),
      ].map(neutralizeCsvCell).join(','),
      ...filtered.map((member) =>
        [
          member.uname,
          member.realName,
          member.studentId,
          (member.groups || []).join(' / '),
          ...(showProblems
            ? [member.done, member.total, member.total > 0 ? `${Math.round((member.done / member.total) * 100)}%` : '-']
            : []),
          ...(showExam
            ? [
                practiceRosterExamLabel(member.exam),
                practiceRosterExamScoreText(member.exam),
                member.exam?.passed === true ? '是' : member.exam?.passed === false ? '否' : '-',
              ]
            : []),
        ]
          .map(neutralizeCsvCell)
          .join(','),
      ),
    ]);
  };

  const exportMatrix = () => {
    if (!problems?.length || !matrixColumns.length) return;
    downloadCsv(`${title || '花名册'}-每题完成人数.csv`, [
      ['题目', '题号', ...matrixColumns.map((column) => `${column.name}（完成/人数）`)].map(neutralizeCsvCell).join(','),
      ...problems.map((problem) =>
        [
          problem.title,
          problem.pidLabel,
          ...matrixColumns.map((column) => {
            const cell = practiceRosterMatrixCell(members, column.id, problem.pid);
            return `${cell.completed}/${cell.total}`;
          }),
        ]
          .map(neutralizeCsvCell)
          .join(','),
      ),
    ]);
  };

  const matrixMinWidthPx = 176 + matrixColumns.length * 96;

  return (
    <Card className={cn('mt-4 min-w-0', className)}>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="min-w-0 text-sm">参加名单</CardTitle>
          <span className="min-w-0 text-[10px] text-muted-foreground">
            共 {members.length} 人（仅教师可见）{truncated ? ' · 名单已截断' : ''}
          </span>
          <div className="min-w-0 flex-1" />
          <SimpleSelect
            value={groupFilter}
            onValueChange={setGroupFilter}
            className="h-8 w-44 min-w-0"
            ariaLabel="按用户组筛选"
            options={[{ value: '', label: '全部组' }, ...columns.map((column) => ({ value: column.id, label: column.name }))]}
          />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索用户名/姓名/学号/班级"
            className="h-8 w-56 min-w-0 max-w-full text-xs"
          />
          <Button variant="outline" size="sm" onClick={exportMembers} disabled={!filtered.length}>
            导出名单{keyword || groupFilter ? `（${filtered.length} 条）` : ''}
          </Button>
          {showProblems && problems?.length ? (
            <Button variant="outline" size="sm" onClick={exportMatrix} disabled={!matrixColumns.length}>
              导出每题完成人数
            </Button>
          ) : null}
        </div>
        {examWarning ? (
          <p role="alert" className="mt-2 text-[11px] text-amber-800 dark:text-amber-300">
            {examWarning}
          </p>
        ) : null}
        {columns.length ? (
          <ul className="mt-2 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
            {columns.map((column) => {
              const examColumn = examColumns.find((item) => item.id === column.id);
              const examSummary = showExam
                ? ` / 已交卷 ${examColumn?.finalizedCount || 0} 人${
                    exam && exam.passScore !== null ? ` / 及格 ${examColumn?.passedCount || 0} 人` : ''
                  } / 人均 ${examColumn?.averageScore == null ? '—' : examColumn.averageScore.toFixed(1)} 分`
                : '';
              const problemSummary = showProblems
                ? ` / 已全部完成 ${column.allDoneCount} 人 / 人均 ${column.averageDone.toFixed(1)} 题`
                : '';
              return (
                <li key={column.id} className="rounded-md border px-2 py-1">
                  {column.name}：{column.memberCount} 人{problemSummary}
                  {examSummary}
                </li>
              );
            })}
          </ul>
        ) : null}
      </CardHeader>
      <CardContent className="p-0">
        <ScrollArea className="max-h-[28rem]" orientation="both">
          <table className="w-full min-w-[640px] whitespace-nowrap text-sm">
            <thead className="sticky top-0 bg-card">
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="px-4 py-2 font-medium">用户名</th>
                <th className="px-4 py-2 font-medium">真实姓名</th>
                <th className="px-4 py-2 font-medium">学号</th>
                <th className="px-4 py-2 font-medium">班级组</th>
                {showProblems ? <th className="px-4 py-2 text-right font-medium">进度</th> : null}
                {showExam ? <th className="px-4 py-2 font-medium">{exam?.title || '结业考试'}</th> : null}
                {showExam ? <th className="px-4 py-2 text-right font-medium">分数</th> : null}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={columnCount} className="px-4 py-8 text-center text-xs text-muted-foreground">
                    {keyword || groupFilter ? '没有匹配的成员' : '还没有人在这份名单里'}
                  </td>
                </tr>
              ) : (
                filtered.map((member) => (
                  <tr key={member.uid} className="border-b last:border-0 hover:bg-muted/20">
                    <td className="px-4 py-2">{member.uname}</td>
                    <td className="px-4 py-2">{member.realName || <span className="text-xs text-muted-foreground">未绑定</span>}</td>
                    <td className="px-4 py-2 font-mono text-xs">{member.studentId || '—'}</td>
                    <td className="px-4 py-2 text-xs">{(member.groups || []).join(' / ') || '—'}</td>
                    {showProblems ? (
                      <td className="px-4 py-2 text-right font-mono text-xs tabular-nums">
                        {member.done}/{member.total}
                        <span className="ml-1 text-muted-foreground">
                          ({member.total > 0 ? Math.round((member.done / member.total) * 100) : 0}%)
                        </span>
                      </td>
                    ) : null}
                    {showExam ? <td className="px-4 py-2 text-xs">{practiceRosterExamLabel(member.exam)}</td> : null}
                    {showExam ? (
                      <td className="px-4 py-2 text-right font-mono text-xs tabular-nums">{practiceRosterExamScoreText(member.exam)}</td>
                    ) : null}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </ScrollArea>
        {problems?.length && matrixColumns.length ? (
          <div className="border-t">
            <p className="px-4 py-2 text-xs font-medium">每题完成人数</p>
            <ScrollArea className="max-h-[22rem]" orientation="both">
              <table className="w-full whitespace-nowrap text-sm" style={{ minWidth: matrixMinWidthPx }}>
                <thead className="sticky top-0 bg-card">
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="sticky left-0 z-20 min-w-44 max-w-44 bg-card px-4 py-2 font-medium">题目</th>
                    {matrixColumns.map((column) => (
                      <th key={column.id} className="min-w-24 px-4 py-2 text-right font-medium">
                        {column.name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {problems.map((problem) => (
                    <tr key={problem.pid} className="group border-b last:border-0 hover:bg-muted/20">
                      <td className="sticky left-0 z-10 min-w-44 max-w-44 bg-card px-4 py-2 group-hover:bg-muted/20">
                        <span className="block truncate text-sm">{problem.title}</span>
                        <span className="font-mono text-[11px] text-muted-foreground">{problem.pidLabel}</span>
                      </td>
                      {matrixColumns.map((column) => {
                        const cell = practiceRosterMatrixCell(members, column.id, problem.pid);
                        return (
                          <td key={column.id} className="px-4 py-2 text-right font-mono text-xs tabular-nums">
                            {cell.completed}/{cell.total}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollArea>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
