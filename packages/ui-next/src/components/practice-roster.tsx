import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { SimpleSelect } from '@/components/ui/select';

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
}

export interface PracticeRosterProblem {
  pid: number;
  title: string;
  pidLabel: string;
}

const UNGROUPED = '__ungrouped__';

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

export function PracticeRosterCard({
  members,
  problems,
  title,
  truncated,
  visibleGroupIds,
}: {
  members: PracticeRosterMember[];
  problems?: PracticeRosterProblem[];
  title: string;
  truncated?: boolean;
  visibleGroupIds?: string[];
}) {
  const [query, setQuery] = useState('');
  const [groupFilter, setGroupFilter] = useState('');
  const columns = useMemo(() => rosterGroupColumns(members, visibleGroupIds), [members, visibleGroupIds]);
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

  const exportMembers = () => {
    downloadCsv(`${title || '花名册'}-参加名单.csv`, [
      ['用户名', '真实姓名', '学号', '班级组', '已完成题数', '总题数', '完成率'].map(neutralizeCsvCell).join(','),
      ...filtered.map((member) =>
        [
          member.uname,
          member.realName,
          member.studentId,
          (member.groups || []).join(' / '),
          member.done,
          member.total,
          member.total > 0 ? `${Math.round((member.done / member.total) * 100)}%` : '-',
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

  return (
    <Card className="mt-4">
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="text-sm">参加名单</CardTitle>
          <span className="text-[10px] text-muted-foreground">
            共 {members.length} 人（仅教师可见）{truncated ? ' · 名单已截断' : ''}
          </span>
          <div className="flex-1" />
          <SimpleSelect
            value={groupFilter}
            onValueChange={setGroupFilter}
            className="h-8 w-44"
            ariaLabel="按用户组筛选"
            options={[{ value: '', label: '全部组' }, ...columns.map((column) => ({ value: column.id, label: column.name }))]}
          />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索用户名/姓名/学号/班级"
            className="h-8 w-56 text-xs"
          />
          <Button variant="outline" size="sm" onClick={exportMembers} disabled={!filtered.length}>
            导出名单{keyword || groupFilter ? `（${filtered.length} 条）` : ''}
          </Button>
          {problems?.length ? (
            <Button variant="outline" size="sm" onClick={exportMatrix} disabled={!matrixColumns.length}>
              导出每题完成人数
            </Button>
          ) : null}
        </div>
        {columns.length ? (
          <ul className="mt-2 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
            {columns.map((column) => (
              <li key={column.id} className="rounded-md border px-2 py-1">
                {column.name}：{column.memberCount} 人 / 已全部完成 {column.allDoneCount} 人 / 人均 {column.averageDone.toFixed(1)} 题
              </li>
            ))}
          </ul>
        ) : null}
      </CardHeader>
      <CardContent className="p-0">
        <ScrollArea className="max-h-[28rem]" orientation="both">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-card">
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="px-4 py-2 font-medium">用户名</th>
                <th className="px-4 py-2 font-medium">真实姓名</th>
                <th className="px-4 py-2 font-medium">学号</th>
                <th className="px-4 py-2 font-medium">班级组</th>
                <th className="px-4 py-2 text-right font-medium">进度</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-xs text-muted-foreground">
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
                    <td className="px-4 py-2 text-right font-mono text-xs tabular-nums">
                      {member.done}/{member.total}
                      <span className="ml-1 text-muted-foreground">({member.total > 0 ? Math.round((member.done / member.total) * 100) : 0}%)</span>
                    </td>
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
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-card">
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="px-4 py-2 font-medium">题目</th>
                    {matrixColumns.map((column) => (
                      <th key={column.id} className="px-4 py-2 text-right font-medium">
                        {column.name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {problems.map((problem) => (
                    <tr key={problem.pid} className="border-b last:border-0">
                      <td className="px-4 py-2">
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
