import type { TeachTab } from '@hydrooj/common';
import { Download, PenLine, Trophy } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import type { Column } from '@/components/ui/data-table';
import { Progress } from '@/components/ui/display';
import { EmptyState } from '@/components/ui/empty-state';
import { SearchInput } from '@/components/ui/input';
import { Toolbar } from '@/components/ui/page';
import { Panel } from '@/components/ui/panel';
import { SimpleSelect } from '@/components/ui/select';
import { cn } from '@/lib/cn';
import { getJson, teachApi } from '@/pages/teach/api';
import {
  buildGrades,
  gradesCsv,
  parsePracticeRoster,
  parseScoreboard,
} from '@/pages/teach/grades-model';
import type { GradeColumn, GradeRow, PracticeRosterMember } from '@/pages/teach/grades-model';
import { parseTeachParticipants } from '@/pages/teach/model';
import type { TeachWorkbenchPayload } from '@/pages/teach/model';
import { paperFromPayload } from '@/pages/teach/paper';

const LOAD_FAILED = '读取成绩失败';

interface NamedGroup {
  id: string;
  name: string;
}

interface ReadyGrades {
  columns: GradeColumn[];
  rows: GradeRow[];
  groups: NamedGroup[];
  truncated: boolean;
}

type GradesPhase =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | ({ kind: 'ready' } & ReadyGrades);

function messageOf(error: unknown): string {
  if (error instanceof Error && error.message.trim() !== '') return error.message;
  return LOAD_FAILED;
}

function uniqueGroups(groups: readonly NamedGroup[]): NamedGroup[] {
  const known = new Map<string, string>();
  const ordered: NamedGroup[] = [];
  for (const group of groups) {
    const existing = known.get(group.id);
    if (existing === undefined) {
      known.set(group.id, group.name);
      ordered.push(group);
      continue;
    }
    if (existing !== group.name) throw new TypeError(`用户组 ${group.id} 的名称不一致`);
  }
  return ordered;
}

function rosterGroups(members: readonly PracticeRosterMember[]): NamedGroup[] {
  const pairs: NamedGroup[] = [];
  for (const member of members) {
    member.groupIds.forEach((id, index) => {
      const name = member.groups[index];
      if (name === undefined || name === '') throw new TypeError(`花名册用户组 ${id} 没有名称`);
      pairs.push({ id, name });
    });
  }
  return uniqueGroups(pairs);
}

async function loadGrades(payload: TeachWorkbenchPayload): Promise<ReadyGrades> {
  const paper = paperFromPayload(payload.paper, payload.container);
  if (payload.container.type === 'practice') {
    const raw = await getJson(`/problem-sets/${encodeURIComponent(payload.container.id)}/roster`, LOAD_FAILED);
    const roster = parsePracticeRoster(raw);
    const groups = rosterGroups(roster.members);
    const built = buildGrades({
      type: payload.container.type,
      rule: payload.container.rule,
      paper,
      participants: null,
      board: null,
      roster,
      groupsById: new Map(groups.map((group) => [group.id, group.name])),
    });
    return { ...built, groups };
  }
  const scoreboard = payload.container.links.scoreboard;
  if (scoreboard === null || scoreboard === '') throw new TypeError('成绩页缺少排行榜链接');
  const [participantsRaw, boardRaw] = await Promise.all([
    getJson(teachApi.participants(payload.container.type, payload.container.id), LOAD_FAILED),
    getJson(scoreboard, LOAD_FAILED),
  ]);
  const participants = parseTeachParticipants(participantsRaw);
  const groups = uniqueGroups(participants.groups);
  const built = buildGrades({
    type: payload.container.type,
    rule: payload.container.rule,
    paper,
    participants,
    board: parseScoreboard(boardRaw),
    roster: null,
    groupsById: new Map(groups.map((group) => [group.id, group.name])),
  });
  return { ...built, groups };
}

function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

function ActionLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Button variant="secondary" asChild>
      <a href={href}>{children}</a>
    </Button>
  );
}

function renderGradeCell(column: GradeColumn, row: GradeRow): ReactNode {
  const text = row.cells[column.key];
  if (typeof text !== 'string') throw new TypeError(`成绩单元格缺失：${column.key}`);
  const tone = row.tones[column.key] ?? null;
  const toneClass = tone === 'success' ? 'text-success-fg' : tone === 'danger' ? 'text-danger-fg' : undefined;
  if (column.key === 'studentId') return <span className="font-mono text-xs">{text}</span>;
  if (column.key === 'group') return <span className="text-fg-muted">{text}</span>;
  if (column.key === 'progress') {
    const value = Number(text);
    if (!Number.isFinite(value)) throw new TypeError('进度不是数字');
    return <Progress value={value} size="sm" tone={value >= 100 ? 'success' : 'brand'} />;
  }
  if (column.align === 'center' || toneClass) {
    return <span className={cn(column.align === 'center' && 'tabular', toneClass)}>{text}</span>;
  }
  return text;
}

function GradesTable({
  payload,
  grades,
}: {
  payload: TeachWorkbenchPayload;
  grades: ReadyGrades;
}) {
  const [groupId, setGroupId] = useState('all');
  const [query, setQuery] = useState('');
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return grades.rows.filter((row) => {
      if (groupId !== 'all' && !row.groupIds.includes(groupId)) return false;
      if (needle === '') return true;
      const haystack = `${row.studentId}\n${row.name}\n${row.searchText}`.toLowerCase();
      return haystack.includes(needle);
    });
  }, [grades.rows, groupId, query]);
  const columns: Column<GradeRow>[] = grades.columns.map((column) => ({
    key: column.key,
    header: column.header,
    align: column.align,
    cell: (row) => renderGradeCell(column, row),
  }));
  const gradingHref = payload.container.links.grading;
  const manageHref = payload.container.links.manage;
  const boardHref = payload.container.links.scoreboard;
  const showGrading = payload.container.type === 'exam' && payload.capabilities.canGrade && gradingHref !== null && gradingHref !== '';
  const showRescore = payload.container.type === 'exam' && manageHref !== null && manageHref !== '';
  const showBoard = payload.container.type !== 'practice' && boardHref !== null && boardHref !== '';

  return (
    <div className="flex flex-col gap-4">
      {grades.truncated ? <Alert tone="warning">名单已截断，下面不是全部学生。</Alert> : null}
      <Toolbar
        end={(
          <>
            {showGrading && gradingHref ? (
              <ActionLink href={gradingHref}>
                <PenLine />
                主观题阅卷
              </ActionLink>
            ) : null}
            {showRescore && manageHref ? <ActionLink href={manageHref}>批量改分</ActionLink> : null}
            {showBoard && boardHref ? (
              <ActionLink href={boardHref}>
                <Trophy />
                查看排行榜
              </ActionLink>
            ) : null}
            <Button
              type="button"
              variant="secondary"
              onClick={() => downloadCsv(`${payload.container.title}-成绩.csv`, gradesCsv(grades.columns, filtered))}
            >
              <Download />
              导出 CSV
            </Button>
          </>
        )}
      >
        <SimpleSelect
          ariaLabel="用户组"
          className="w-48"
          value={groupId}
          onValueChange={setGroupId}
          options={[
            { value: 'all', label: '全部用户组' },
            ...grades.groups.map((group) => ({ value: group.id, label: group.name })),
          ]}
        />
        <SearchInput
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="学号或姓名"
          aria-label="学号或姓名"
          className="w-64"
        />
      </Toolbar>
      <Panel flush footer={<p className="text-sm text-fg-subtle">{filtered.length} 人</p>}>
        <DataTable
          columns={columns}
          rows={filtered}
          rowKey={(row) => row.key}
          mobile="scroll"
          stickyHeader
          empty={<EmptyState compact title="没有符合条件的成绩" />}
        />
      </Panel>
    </div>
  );
}

export function GradesTab({ payload }: { payload: TeachWorkbenchPayload; onNavigateTab: (tab: TeachTab) => void }) {
  const [attempt, setAttempt] = useState(0);
  const [phase, setPhase] = useState<GradesPhase>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    setPhase({ kind: 'loading' });
    loadGrades(payload).then((grades) => {
      if (!cancelled) setPhase({ kind: 'ready', ...grades });
    }).catch((error: unknown) => {
      console.error('teach grades load failed', { type: payload.container.type, id: payload.container.id, error });
      if (!cancelled) setPhase({ kind: 'error', message: messageOf(error) });
    });
    return () => {
      cancelled = true;
    };
  }, [attempt, payload]);

  if (phase.kind === 'error') {
    return (
      <div className="flex flex-col items-start gap-3">
        <Alert tone="danger">{phase.message}</Alert>
        <Button type="button" variant="secondary" onClick={() => setAttempt((current) => current + 1)}>重试</Button>
      </div>
    );
  }
  if (phase.kind !== 'ready') return <p className="text-sm text-fg-muted">正在读取成绩…</p>;
  return <GradesTable payload={payload} grades={phase} />;
}
