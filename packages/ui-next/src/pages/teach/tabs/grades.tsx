import { teachApi } from '@/pages/teach/api';
import { RapidPassControls, RapidPassMark, useRapidPassReview } from '@/pages/teach/rapid-pass';
import { ManualGradingPanel } from '@/pages/manual-grading';
import { MiniTabs } from '@/components/ui/mini-tabs';
import type { RapidPassEvidence, TeachTab } from '@hydrooj/common';
import { Download, FileSpreadsheet, Trophy } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
import { participantRecordsUrl } from '@/lib/record-navigation';
import { useBootstrap } from '@/lib/bootstrap';
import { downloadBlob } from '@/lib/download-zip';
import { buildXlsx } from '@/lib/xlsx';
import { gradesSheet, loadGrades } from '@/pages/teach/grades-load';
import type { ReadyGrades } from '@/pages/teach/grades-load';
import { gradesCsv, practicePassCounts } from '@/pages/teach/grades-model';
import type { GradeColumn, GradeRow, PracticePassProblem, PracticeRosterMember } from '@/pages/teach/grades-model';
import type { TeachWorkbenchPayload } from '@/pages/teach/model';

const LOAD_FAILED = '读取成绩失败';
const EXPORT_FAILED = '导出 Excel 失败。';
const DASH = '\u2014';
const DOT = '\u00B7';

type GradesPhase =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | ({ kind: 'ready' } & ReadyGrades);

function messageOf(error: unknown): string {
  if (error instanceof Error && error.message.trim() !== '') return error.message;
  return LOAD_FAILED;
}

function exportFailure(error: unknown): string {
  if (error instanceof Error && error.message.trim() !== '') return error.message;
  return EXPORT_FAILED;
}

function numericCell(text: string): number | null {
  const trimmed = text.trim();
  if (!/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

function matrixStat(rows: readonly GradeRow[], key: string, full: number | null): string {
  let sum = 0;
  let got = 0;
  for (const row of rows) {
    const text = row.cells[key];
    if (typeof text !== 'string') throw new TypeError(`成绩单元格缺失：${key}`);
    const value = numericCell(text);
    sum += value ?? 0;
    if (full !== null && value !== null && value === full) got += 1;
  }
  const average = rows.length === 0 ? '0.0' : (sum / rows.length).toFixed(1);
  return `满分 ${got}/${rows.length} ${DOT} 均 ${average}`;
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

function PinFirstColumn({ header = false, children }: { header?: boolean; children: ReactNode }) {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const cell = ref.current?.closest('th, td');
    if (!(cell instanceof HTMLElement)) return;
    cell.classList.add('sticky', 'left-0', header ? 'bg-surface-sunken' : 'bg-surface', header ? 'z-30' : 'z-10');
    if (!header) cell.classList.add('group-hover:bg-surface-hover');
    cell.style.zIndex = header ? '30' : '10';
  });
  return <span ref={ref} className="sticky left-0">{children}</span>;
}

function renderProblemHeader(column: GradeColumn, rows: readonly GradeRow[]): ReactNode {
  const matrix = column.matrix;
  return (
    <span className="inline-flex min-w-24 flex-col items-center gap-0.5 whitespace-normal font-normal">
      <span className="font-semibold text-fg">{matrix?.title ?? column.header}</span>
      {matrix?.subtitle ? <span className="max-w-36 truncate text-fg-subtle">{matrix.subtitle}</span> : null}
      {column.counts && <span className="tabular text-fg-subtle" title="按题累计，每名选手或队伍每题只计一次通过">全场通过 {column.counts.nAccept} · 提交 {column.counts.nSubmit} 次</span>}
      {matrix && <span className="text-fg-subtle">{matrixStat(rows, column.key, matrix.full)}</span>}
    </span>
  );
}

function renderHeader(column: GradeColumn, rows: readonly GradeRow[]): ReactNode {
  if (column.key === 'student') {
    return <PinFirstColumn header>学生</PinFirstColumn>;
  }
  if (column.matrix || column.counts) return renderProblemHeader(column, rows);
  return column.header;
}

function renderMatrixScore(column: GradeColumn, row: GradeRow, text: string): ReactNode {
  if (text === DASH) return <span className="text-fg-subtle">{DASH}</span>;
  const attempt = row.attempts[column.key];
  if (!attempt) throw new TypeError(`成绩提交次数缺失：${column.key}`);
  const tone = row.tones[column.key] ?? null;
  const toneClass = tone === 'success' ? 'text-success-fg' : tone === 'danger' ? 'text-danger-fg' : 'text-fg';
  return (
    <span className="inline-flex flex-col items-center leading-tight">
      <span className={cn('tabular', toneClass)}>{text}</span>
      <span className="text-xs text-fg-subtle">
        {`${attempt.submits} 次`}
        {attempt.late ? (
          <>
            {` ${DOT} `}
            <span className="text-warning-fg">迟</span>
          </>
        ) : null}
      </span>
    </span>
  );
}

function renderStudent(row: GradeRow, evidence?: RapidPassEvidence): ReactNode {
  return (
    <PinFirstColumn>
      <span className="block font-medium text-fg">{row.name}</span>
      {evidence ? <RapidPassMark evidence={evidence} /> : null}
      {row.studentId !== '' ? <span className="block font-mono text-xs text-fg-muted">{row.studentId}</span> : null}
    </PinFirstColumn>
  );
}

function renderGradeCell(column: GradeColumn, row: GradeRow, evidence?: RapidPassEvidence): ReactNode {
  const text = row.cells[column.key];
  if (typeof text !== 'string') throw new TypeError(`成绩单元格缺失：${column.key}`);
  if (column.key === 'student') return renderStudent(row, evidence);
  if (column.key === 'name' && evidence) return <>{text}<RapidPassMark evidence={evidence} /></>;
  if (text === DASH) return <span className="text-fg-subtle">{DASH}</span>;
  if (column.matrix) return renderMatrixScore(column, row, text);
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

function practiceRowUid(key: string): number {
  if (!key.startsWith('user:')) throw new TypeError(`练习成绩行键无效：${key}`);
  const uid = Number(key.slice('user:'.length));
  if (!Number.isSafeInteger(uid)) throw new TypeError(`练习成绩行键无效：${key}`);
  return uid;
}

function practicePassPercent(count: number, people: number): number {
  if (people <= 0) return 0;
  return Math.round((count * 100) / people);
}

function PracticePassPanel({
  members,
  problems,
}: {
  members: readonly PracticeRosterMember[];
  problems: readonly PracticePassProblem[];
}) {
  const counts = useMemo(() => practicePassCounts(members, problems), [members, problems]);
  const people = members.length;
  return (
    <Panel title="每题通过人数" description={`共 ${people} 人`}>
      <div className="flex flex-col gap-3">
        {counts.map((row, index) => {
          const percent = practicePassPercent(row.count, people);
          const name = row.title === '' ? row.label : `${row.label} ${DOT} ${row.title}`;
          return (
            <div key={`${row.pid}:${index}`} className="flex min-w-0 items-center gap-3">
              <span className="min-w-0 flex-1 truncate text-sm">{name}</span>
              <div className="w-36 shrink-0">
                <Progress value={percent} size="sm" tone={people > 0 && row.count === people ? 'success' : 'brand'} />
              </div>
              <span className="w-12 shrink-0 text-right text-sm tabular">{row.count}</span>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

function GradesTable({
  payload,
  grades,
}: {
  payload: TeachWorkbenchPayload;
  grades: ReadyGrades;
}) {
  const recordsBase = useBootstrap().urls.records;
  const { container } = payload;
  const purpose = container.setPurpose ?? container.rule;
  const reviewUrl = (purpose === 'homework' || purpose === 'exam') && container.participationMode !== 'team'
    ? teachApi.rapidPasses(container.type, container.id) : null;
  const rapid = useRapidPassReview(reviewUrl);
  const [groupId, setGroupId] = useState('all');
  const [query, setQuery] = useState('');
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const exportingRef = useRef(false);
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return grades.rows.filter((row) => {
      if (groupId !== 'all' && !row.groupIds.includes(groupId)) return false;
      if (needle === '') return true;
      const haystack = `${row.studentId}\n${row.name}\n${row.searchText}`.toLowerCase();
      return haystack.includes(needle);
    });
  }, [grades.rows, groupId, query]);
  const practice = grades.practice;
  const practiceMembers = useMemo(() => {
    if (practice === null) return null;
    return filtered.map((row) => {
      const member = practice.membersByUid.get(practiceRowUid(row.key));
      if (!member) throw new TypeError(`练习成绩缺少成员 ${row.key}`);
      return member;
    });
  }, [filtered, practice]);
  const columns: Column<GradeRow>[] = grades.columns.map((column) => ({
    key: column.key,
    header: renderHeader(column, filtered),
    align: column.align,
    cell: (row) => {
      const content = renderGradeCell(column, row, rapid.review?.signals.get(row.key));
      if (payload.container.type === 'practice' || !row.key.startsWith('user:')) return content;
      if (column.key !== 'student' && column.key !== 'total' && !column.key.startsWith('problem:')) return content;
      let href = participantRecordsUrl(recordsBase, payload.container.id, row.key.slice(5), payload.container.type);
      if (column.key.startsWith('problem:')) href += `&pid=${encodeURIComponent(column.key.slice(8))}`;
      return <a href={href} className="block hover:text-brand-fg hover:underline">{content}</a>;
    },
  }));
  const manageHref = payload.container.links.manage;
  const boardHref = payload.container.links.scoreboard;
  const showRescore = payload.container.type === 'exam' && manageHref !== null && manageHref !== '';
  const showBoard = payload.container.type !== 'practice' && boardHref !== null && boardHref !== '';
  const showExcel = payload.container.type === 'homework' || payload.container.type === 'exam';

  async function exportExcel(): Promise<void> {
    if (exportingRef.current) return;
    exportingRef.current = true;
    setExporting(true);
    setExportError(null);
    try {
      const sheet = gradesSheet(payload.container.title, grades.columns, filtered);
      const blob = await buildXlsx([sheet]);
      downloadBlob(`${payload.container.title}-成绩.xlsx`, blob);
    } catch (error: unknown) {
      console.error('teach grades excel export failed', { type: payload.container.type, id: payload.container.id, error });
      setExportError(exportFailure(error));
    } finally {
      exportingRef.current = false;
      setExporting(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {reviewUrl ? <RapidPassControls state={rapid} /> : null}
      {grades.truncated ? <Alert tone="warning">名单已截断，下面不是全部学生。</Alert> : null}
      {exportError !== null ? <Alert tone="danger">{exportError}</Alert> : null}
      <Toolbar
        end={(
          <>
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
            {showExcel ? (
              <Button
                type="button"
                variant="secondary"
                loading={exporting}
                onClick={() => {
                  void exportExcel();
                }}
              >
                <FileSpreadsheet />
                导出 Excel
              </Button>
            ) : null}
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
      {practice !== null && practiceMembers !== null ? (
        <PracticePassPanel members={practiceMembers} problems={practice.problems} />
      ) : null}
    </div>
  );
}

function GradeResults({ payload }: { payload: TeachWorkbenchPayload; onNavigateTab: (tab: TeachTab) => void }) {
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

export function GradesTab(props: { payload: TeachWorkbenchPayload; onNavigateTab: (tab: TeachTab) => void }) {
  const [view, setView] = useState<'results' | 'grading'>('results');
  const grading = props.payload.capabilities.canGrade ? props.payload.container.links.grading : null;
  return <div className="flex min-w-0 flex-col gap-5">
    {grading ? <MiniTabs aria-label="成绩与批改" value={view} onValueChange={setView} items={[{ value: 'results', label: '成绩' }, { value: 'grading', label: '批改' }]} /> : null}
    {view === 'grading' && grading ? <ManualGradingPanel endpoint={grading} /> : <GradeResults {...props} />}
  </div>;
}
