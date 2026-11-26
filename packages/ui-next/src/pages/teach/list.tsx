import { teachPath } from '@hydrooj/common';
import type { TeachStatus, TeachType } from '@hydrooj/common';
import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import { CalendarDays, Copy, FileSpreadsheet, List, MoreHorizontal, Plus } from 'lucide-react';
import { useBootstrap } from '@/lib/bootstrap';
import { downloadBlob } from '@/lib/download-zip';
import { examServerClock } from '@/lib/exam-server-clock';
import { formatRelativeTime } from '@/lib/format';
import { buildXlsx } from '@/lib/xlsx';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { DataTable, type Column } from '@/components/ui/data-table';
import { StatusDot } from '@/components/ui/display';
import { EmptyState } from '@/components/ui/empty-state';
import { SearchInput } from '@/components/ui/input';
import { Menu } from '@/components/ui/menu';
import { MiniTabs, type MiniTabItem } from '@/components/ui/mini-tabs';
import { Page, PageHeader, Toolbar } from '@/components/ui/page';
import { Pagination } from '@/components/ui/pagination';
import { Panel } from '@/components/ui/panel';
import { SimpleSelect } from '@/components/ui/select';
import { getJson } from './api';
import { CopyDialog } from './copy-dialog';
import { loadGrades } from './grades-load';
import type { ReadyGrades } from './grades-load';
import { summarySheets } from './grades-summary';
import {
  formatTeachWindow,
  parseTeachListPayload,
  parseTeachWorkbenchPayload,
  TEACH_STATUS_LABEL,
} from './model';
import type { TeachListPayload, TeachListRow, TeachSharedRow } from './model';
import { SharedPreviewDialog, teachSetTypeLabel } from './shared-preview-dialog';
import { CalendarView } from '../problem-sets/calendar-view';
import { PracticeCard } from '../problem-sets/practice-card';

const MINE_DESCRIPTION = '你创建或协作管理的练习、作业、考试和比赛。';
const SHARED_DESCRIPTION = '其他老师在学校内共享的题目集。点「使用」会复制一份完全属于你的，时间和学生要重新填。';

const TYPE_FILTERS = [
  ['all', '全部'],
  ['practice', '练习'],
  ['homework', '作业'],
  ['exam', '考试'],
  ['contest', '比赛'],
] as const;

const STATUS_OPTIONS = [
  { value: 'all', label: '全部状态' },
  { value: 'upcoming', label: '即将开始' },
  { value: 'running', label: '进行中' },
  { value: 'ended', label: '已结束' },
  { value: 'open', label: '不限时' },
] as const;

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;
const SUMMARY_LOAD_FAILED = '读取这份题目集失败。';
const SUMMARY_PICKS_KEY = 'krypton:teach-summary-picks';
const VIEW_KEY = 'krypton:teach-sets-view';

function initialView(): 'list' | 'calendar' {
  if (window.location.hash === '#calendar') return 'calendar';
  try {
    return localStorage.getItem(VIEW_KEY) === 'calendar' ? 'calendar' : 'list';
  } catch (error) {
    console.warn('teacher set view preference unavailable', error);
    return 'list';
  }
}

const ROLE_LABEL: Record<TeachListRow['role'], string> = {
  owner: '所有者',
  maintainer: '协作者',
  admin: '管理员',
};

type ListType = TeachListPayload['filter']['type'];
type ListStatus = TeachListPayload['filter']['status'];
type ListScope = TeachListPayload['scope'];

interface SummaryPick {
  type: 'homework' | 'exam';
  id: string;
  title: string;
}

interface ListQuery {
  scope: ListScope;
  type: ListType;
  status: ListStatus;
  q: string;
  page?: number;
}

interface PreviewTarget {
  type: TeachType;
  id: string;
}

function isListStatus(value: string): value is ListStatus {
  return STATUS_OPTIONS.some((option) => option.value === value);
}

function listHref(query: ListQuery): string {
  const params = new URLSearchParams();
  params.set('scope', query.scope);
  if (query.type !== 'all') params.set('type', query.type);
  if (query.status !== 'all') params.set('status', query.status);
  if (query.q !== '') params.set('q', query.q);
  if (query.page !== undefined) params.set('page', String(query.page));
  return `/teach?${params.toString()}`;
}

function currentQuery(payload: TeachListPayload, page?: number): ListQuery {
  return {
    scope: payload.scope,
    type: payload.filter.type,
    status: payload.filter.status,
    q: payload.filter.q,
    page,
  };
}

function hasActiveFilter(payload: TeachListPayload): boolean {
  return payload.filter.type !== 'all' || payload.filter.status !== 'all' || payload.filter.q !== '';
}

function canCreateAny(flags: TeachListPayload['canCreate']): boolean {
  return flags.practice || flags.homework || flags.exam || flags.acm || flags.oi;
}

function createdDay(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) throw new TypeError('teach_created_at_invalid');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function problemSummary(row: { problemCount: number; drawCount: number | null; stageCount?: number | null }): string {
  if (row.drawCount !== null) return `题库 ${row.problemCount} · 每人 ${row.drawCount}`;
  if (typeof row.stageCount === 'number' && row.stageCount > 1) return `${row.problemCount} · ${row.stageCount} 个阶段`;
  return String(row.problemCount);
}

function windowText(row: Pick<TeachListRow, 'type' | 'beginAt' | 'endAt' | 'durationMinutes'>): string {
  return formatTeachWindow({
    type: row.type,
    beginAt: row.beginAt,
    endAt: row.endAt,
    durationMinutes: row.durationMinutes,
  }, new Date());
}

function copyHref(type: TeachType, id: string): string {
  return `/teach/new?copy=${encodeURIComponent(type)}:${encodeURIComponent(id)}`;
}

function studentHref(type: TeachType, id: string): string {
  if (type === 'practice') return `/problem-sets/${encodeURIComponent(id)}`;
  if (type === 'homework') return `/homework/${encodeURIComponent(id)}`;
  return `/contest/${encodeURIComponent(id)}`;
}

function openStudent(type: TeachType, id: string) {
  window.open(studentHref(type, id), '_blank', 'noopener,noreferrer');
}

function roleLabel(role: TeachListRow['role']): string {
  const label = ROLE_LABEL[role];
  if (label === undefined) throw new TypeError(`teach_role_invalid:${String(role)}`);
  return label;
}

function isSummaryRow(row: TeachListRow): row is TeachListRow & { type: 'homework' | 'exam' } {
  return row.type === 'homework' || row.type === 'exam';
}

function readSummaryPick(value: unknown): SummaryPick | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const type = Reflect.get(value, 'type');
  const id = Reflect.get(value, 'id');
  const title = Reflect.get(value, 'title');
  if (type !== 'homework' && type !== 'exam') return null;
  if (typeof id !== 'string' || id === '') return null;
  if (typeof title !== 'string') return null;
  return { type, id, title };
}

function readSummaryPicks(): SummaryPick[] {
  try {
    const raw = sessionStorage.getItem(SUMMARY_PICKS_KEY);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const picks: SummaryPick[] = [];
    for (const item of parsed) {
      const pick = readSummaryPick(item);
      if (pick === null) return [];
      picks.push(pick);
    }
    return picks;
  } catch {
    return [];
  }
}

function writeSummaryPicks(picks: readonly SummaryPick[]): void {
  if (picks.length === 0) {
    sessionStorage.removeItem(SUMMARY_PICKS_KEY);
    return;
  }
  sessionStorage.setItem(SUMMARY_PICKS_KEY, JSON.stringify(picks));
}

function summaryKey(row: Pick<SummaryPick, 'type' | 'id'>): string {
  return `${row.type}:${row.id}`;
}

function failureText(error: unknown): string {
  if (error instanceof Error && error.message !== '') return error.message;
  throw error;
}

function summaryFilename(serverNow: number): string {
  const shifted = new Date(serverNow + SHANGHAI_OFFSET_MS);
  const year = shifted.getUTCFullYear();
  const month = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const day = String(shifted.getUTCDate()).padStart(2, '0');
  return `题目集总表-${year}${month}${day}.xlsx`;
}

function CountLabel({ label, count }: { label: string; count: number }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span>{label}</span>
      <span className="inline-block w-5 text-right text-xs tabular text-fg-subtle">{count}</span>
    </span>
  );
}

function StatusMark({ status }: { status: TeachStatus }) {
  const label = TEACH_STATUS_LABEL[status];
  if (status === 'open') return <span>{label}</span>;
  let dot: ReactNode;
  if (status === 'running') dot = <StatusDot tone="success" pulse />;
  else if (status === 'upcoming') dot = <StatusDot tone="info" />;
  else if (status === 'ended') dot = <StatusDot />;
  else throw new TypeError(`teach_status_invalid:${String(status)}`);
  return (
    <span className="inline-flex items-center gap-1.5">
      {dot}
      {label}
    </span>
  );
}

function mineTitle(row: TeachListRow): ReactNode {
  return (
    <div className="min-w-0">
      <div className="flex min-w-0">
        <a href={teachPath(row.type, row.id)} className="min-w-0 truncate font-medium text-fg hover:underline">
          {row.title}
        </a>
        {/* 窄屏卡片会拆掉这个链接，标题变成直接文本。跟在同一行的零宽字符让该容器的文本不等于标题，避免和桌面链接一起被 getByText 命中。 */}
        {'\u200B'}
      </div>
      <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <Badge variant="outline" size="sm">{teachSetTypeLabel(row.type, row.rule, row.setPurpose)}</Badge>
        <span className="text-xs text-fg-subtle">{`创建于 ${createdDay(row.createdAt)}`}</span>
        {row.shared ? <Badge size="sm">学校共享中</Badge> : null}
        {row.setPublication === 'draft' ? <Badge size="sm" tone="warning">草稿 · 未发布</Badge> : null}
      </div>
    </div>
  );
}

function stopCardActivation(event: ReactMouseEvent<HTMLButtonElement>) {
  event.preventDefault();
  event.stopPropagation();
}

function RowMenu({ row }: { row: TeachListRow }) {
  return (
    <div className="relative z-10">
    <Menu
      label="更多操作"
      placement="bottom-end"
      trigger={(props) => (
        <Button
          variant="ghost"
          size="sm"
          iconOnly
          aria-label="更多操作"
          {...props}
          type="button"
          onClickCapture={(event: ReactMouseEvent<HTMLButtonElement>) => {
            // 堆叠卡片是 <a>。捕获阶段停掉点击，卡片上的原生监听才收不到。
            stopCardActivation(event);
            props.onClick();
          }}
          onClick={stopCardActivation}
        >
          <MoreHorizontal />
        </Button>
      )}
      items={[
        { label: '打开工作台', href: teachPath(row.type, row.id) },
        { label: '学生视角', onSelect: () => openStudent(row.type, row.id) },
        { label: '复制为新题目集', href: copyHref(row.type, row.id) },
      ]}
    />
    </div>
  );
}

function SummaryCheckbox({
  checked,
  disabled,
  label,
  onCheckedChange,
}: {
  checked: boolean;
  disabled: boolean;
  label: string;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <span
      className="relative z-10 inline-flex"
      onClick={(event) => {
        event.stopPropagation();
        // The stack card is one link. preventDefault also cancels the checkbox
        // action and leaves the controlled property stale, so drop href until
        // the click's default action has passed.
        const link = event.currentTarget.closest('a');
        if (!(link instanceof HTMLAnchorElement)) return;
        const href = link.getAttribute('href');
        if (href === null) return;
        link.removeAttribute('href');
        window.setTimeout(() => {
          link.setAttribute('href', href);
        }, 0);
      }}
    >
      <Checkbox
        size="sm"
        checked={checked}
        disabled={disabled}
        aria-label={label}
        onCheckedChange={onCheckedChange}
      />
    </span>
  );
}

function selectColumn(
  selectedKeys: ReadonlySet<string>,
  onToggle: (row: TeachListRow, checked: boolean) => void,
  exporting: boolean,
): Column<TeachListRow> {
  return {
    key: 'select',
    header: <span className="sr-only">选择</span>,
    width: '2.75rem',
    stackRole: 'row',
    cell: (row) => {
      const graded = isSummaryRow(row);
      return (
        <SummaryCheckbox
          checked={graded && selectedKeys.has(summaryKey(row))}
          disabled={exporting || !graded}
          label={graded ? `选择${row.title}` : `${row.title}不能导出总表`}
          onCheckedChange={(checked) => {
            if (graded) onToggle(row, checked);
          }}
        />
      );
    },
  };
}

function mineColumns(
  selectedKeys: ReadonlySet<string>,
  onToggle: (row: TeachListRow, checked: boolean) => void,
  exporting: boolean,
): Column<TeachListRow>[] {
  return [
    selectColumn(selectedKeys, onToggle, exporting),
    {
      key: 'title',
      header: '题目集',
      stackRole: 'title',
      cell: (row) => mineTitle(row),
    },
    {
      key: 'status',
      header: '状态',
      width: '7rem',
      stackRole: 'meta',
      cell: (row) => <StatusMark status={row.status} />,
    },
    {
      key: 'time',
      header: '时间',
      hideBelow: 'lg',
      cell: (row) => <span className="tabular text-sm text-fg-muted">{windowText(row)}</span>,
    },
    {
      key: 'audience',
      header: '给谁做',
      cell: (row) => <span className="block max-w-full truncate text-fg-muted">{row.audience}</span>,
    },
    {
      key: 'problems',
      header: '题目',
      width: '9rem',
      cell: (row) => <span className="tabular text-sm">{problemSummary(row)}</span>,
    },
    {
      key: 'participants',
      header: '参与',
      width: '6rem',
      cell: (row) => <span className="tabular text-sm">{`${row.participantCount} 人`}</span>,
    },
    {
      key: 'role',
      header: '我的角色',
      width: '6rem',
      cell: (row) => <span className="text-sm text-fg-muted">{roleLabel(row.role)}</span>,
    },
    {
      key: 'actions',
      header: '操作',
      width: '4rem',
      align: 'right',
      cell: (row) => <RowMenu row={row} />,
    },
  ];
}

function SharedTitle({ row }: { row: TeachSharedRow }) {
  return (
    <div className="min-w-0">
      <div className="truncate font-medium text-fg">{row.title}</div>
      <div className="mt-1">
        <Badge variant="outline" size="sm">{teachSetTypeLabel(row.type, row.rule, row.setPurpose)}</Badge>
      </div>
    </div>
  );
}

function sharedColumns(locale: string, onPreview: (row: TeachSharedRow) => void): Column<TeachSharedRow>[] {
  return [
    {
      key: 'title',
      header: '题目集',
      stackRole: 'title',
      cell: (row) => <SharedTitle row={row} />,
    },
    {
      key: 'owner',
      header: '共享者',
      width: '8rem',
      cell: (row) => <span className="text-sm">{row.ownerName}</span>,
    },
    {
      key: 'problems',
      header: '题目',
      width: '9rem',
      cell: (row) => <span className="tabular text-sm">{problemSummary(row)}</span>,
    },
    {
      key: 'time',
      header: '原来的时间',
      hideBelow: 'lg',
      cell: (row) => <span className="tabular text-sm text-fg-muted">{windowText(row)}</span>,
    },
    {
      key: 'sharedAt',
      header: '共享于',
      width: '8rem',
      cell: (row) => <span className="whitespace-nowrap text-sm text-fg-muted">{sharedAtLabel(row.sharedAt, locale)}</span>,
    },
    {
      key: 'actions',
      header: '操作',
      align: 'right',
      cell: (row) => (
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button variant="secondary" size="sm" type="button" onClick={() => onPreview(row)}>预览</Button>
          <Button variant="secondary" size="sm" asChild>
            <a href={copyHref(row.type, row.id)}>
              <Copy />
              使用这个题目集
            </a>
          </Button>
        </div>
      ),
    },
  ];
}

function ListEmpty({ payload, creatable }: { payload: TeachListPayload; creatable: boolean }) {
  if (hasActiveFilter(payload)) {
    return (
      <EmptyState
        title="没有匹配的题目集"
        action={(
          <Button variant="secondary" asChild>
            <a href={`/teach?scope=${payload.scope}`}>清除筛选</a>
          </Button>
        )}
      />
    );
  }
  if (payload.scope === 'shared') return <EmptyState title="还没有老师共享题目集" />;
  return (
    <EmptyState
      title="还没有题目集"
      description="新建一个练习、作业、考试或比赛。"
      action={creatable ? (
        <Button variant="secondary" asChild>
          <a href="/teach/new">
            <Plus />
            新建题目集
          </a>
        </Button>
      ) : null}
    />
  );
}

function PracticeCards({ payload, onPreview }: {
  payload: TeachListPayload;
  onPreview: (row: TeachSharedRow) => void;
}) {
  if (!payload.practiceCards) throw new TypeError('teacher practice cards are missing');
  return (
    <div className="grid w-full min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {payload.practiceCards.map((card) => {
        if (payload.scope === 'shared') {
          const row = payload.sharedRows.find((item) => item.type === 'practice' && item.id === card.id);
          if (!row) throw new TypeError(`teacher shared practice is missing: ${card.id}`);
          return (
            <PracticeCard
              key={card.id}
              row={card}
              footer={(
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs text-fg-subtle">{row.ownerName} 共享</span>
                <div className="flex flex-wrap gap-2">
                  <Button variant="secondary" size="sm" type="button" onClick={() => onPreview(row)}>预览</Button>
                  <Button variant="secondary" size="sm" asChild>
                    <a href={copyHref(row.type, row.id)}><Copy />使用这个题目集</a>
                  </Button>
                </div>
              </div>
            )} />
          );
        }
        const row = payload.rows.find((item) => item.type === 'practice' && item.id === card.id);
        if (!row) throw new TypeError(`teacher practice is missing: ${card.id}`);
        return (
          <PracticeCard
            key={card.id}
            row={{ ...card, participantCount: row.participantCount }}
            footer={(
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0 text-xs text-fg-subtle">
                <p className="truncate">{roleLabel(row.role)} · {row.audience}</p>
                <p className="mt-1">创建于 {createdDay(row.createdAt)}{row.shared ? ' · 学校共享中' : ''}</p>
              </div>
              <RowMenu row={row} />
            </div>
          )} />
        );
      })}
    </div>
  );
}

function typeTabs(payload: TeachListPayload): MiniTabItem<ListType>[] {
  return TYPE_FILTERS.map(([value, label]) => ({
    value,
    label: <CountLabel label={label} count={payload.typeCounts[value]} />,
    href: listHref({ ...currentQuery(payload), type: value }),
  }));
}

function sharedAtLabel(iso: string, locale: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) throw new TypeError('teach_shared_at_invalid');
  if (Math.abs(Date.now() - date.getTime()) >= WEEK_MS) {
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${date.getFullYear()}-${month}-${day} ${hours}:${minutes}`;
  }
  return formatRelativeTime(iso, locale);
}

function scopeTabs(payload: TeachListPayload): MiniTabItem<ListScope>[] {
  const kept = currentQuery(payload);
  const items: MiniTabItem<ListScope>[] = [
    { value: 'mine', label: '我的', href: listHref({ ...kept, scope: 'mine' }) },
    { value: 'shared', label: '学校共享', href: listHref({ ...kept, scope: 'shared' }) },
  ];
  if (payload.canSeeAll) {
    items.push({ value: 'all', label: '全部', href: listHref({ ...kept, scope: 'all' }) });
  }
  return items;
}

export function TeachListPage() {
  const bootstrap = useBootstrap();
  const payload = parseTeachListPayload(bootstrap.page.data);
  const [view, setView] = useState<'list' | 'calendar'>(() => payload.filter.type === 'practice' ? 'list' : initialView());
  const calendar = view === 'calendar';
  const [copyOpen, setCopyOpen] = useState(false);
  const [preview, setPreview] = useState<PreviewTarget | null>(null);
  const [selected, setSelected] = useState<SummaryPick[]>(readSummaryPicks);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const exportingRef = useRef(false);
  // Anchor the server clock once per page load; reading it at click time would cancel the elapsed time.
  const serverClock = useMemo(() => examServerClock(bootstrap.generatedAt), [bootstrap.generatedAt]);
  useEffect(() => {
    writeSummaryPicks(selected);
  }, [selected]);
  if (payload.scope === 'all' && !payload.canSeeAll) throw new TypeError('teach_scope_forbidden');

  const creatable = canCreateAny(payload.canCreate);
  const shared = payload.scope === 'shared';
  const rowsEmpty = shared ? payload.sharedRows.length === 0 : payload.rows.length === 0;
  const query = currentQuery(payload);
  const selectedKeys = new Set(selected.map((item) => summaryKey(item)));
  const selectionActive = !calendar && !shared && selected.length > 0;

  function toggleSummary(row: TeachListRow, checked: boolean) {
    if (!isSummaryRow(row)) return;
    const key = summaryKey(row);
    setSelected((current) => {
      const without = current.filter((item) => summaryKey(item) !== key);
      if (!checked) return without;
      if (current.some((item) => summaryKey(item) === key)) return current;
      return [...without, { type: row.type, id: row.id, title: row.title }];
    });
  }

  function clearSummary() {
    setSelected([]);
    setExportError(null);
  }

  async function exportSummary(): Promise<void> {
    if (exportingRef.current || selected.length === 0) return;
    const batch = selected.map((item) => {
      const live = payload.rows.find((row) => row.type === item.type && row.id === item.id);
      if (live === undefined || !isSummaryRow(live)) return item;
      return { type: live.type, id: live.id, title: live.title };
    });
    exportingRef.current = true;
    setExporting(true);
    setExportError(null);
    try {
      const loaded: Array<{ title: string; grades: ReadyGrades }> = [];
      for (const item of batch) {
        try {
          const raw = await getJson(teachPath(item.type, item.id), SUMMARY_LOAD_FAILED);
          const grades = await loadGrades(parseTeachWorkbenchPayload(raw));
          loaded.push({ title: item.title, grades });
        } catch (error: unknown) {
          const message = failureText(error);
          console.error('teach summary export failed', { type: item.type, id: item.id, error });
          setExportError(`${item.title}：${message}`);
          return;
        }
      }
      const blob = await buildXlsx(summarySheets(loaded));
      downloadBlob(summaryFilename(serverClock.now()), blob);
    } catch (error: unknown) {
      console.error('teach summary export failed', { error });
      setExportError(failureText(error));
    } finally {
      exportingRef.current = false;
      setExporting(false);
    }
  }

  return (
    <Page width="wide">
      <PageHeader
        title="题目集"
        description={shared ? SHARED_DESCRIPTION : MINE_DESCRIPTION}
        actions={(
          <>
            <MiniTabs
              aria-label="题目集视图"
              value={view}
              onValueChange={(next) => {
                setView(next);
                try {
                  localStorage.setItem(VIEW_KEY, next);
                } catch (error) {
                  console.warn('teacher set view preference could not be saved', error);
                }
              }}
              items={[
                { value: 'list', label: '列表', icon: List },
                { value: 'calendar', label: '日历', icon: CalendarDays },
              ]}
            />
            <Button variant="secondary" type="button" onClick={() => setCopyOpen(true)}>
              <Copy />
              从已有复制
            </Button>
            {creatable ? (
              <Button variant={selectionActive ? 'secondary' : 'primary'} asChild>
                <a href="/teach/new">
                  <Plus />
                  新建题目集
                </a>
              </Button>
            ) : null}
          </>
        )}
      />
      <Toolbar
        end={(
          <MiniTabs
            aria-label="范围"
            value={payload.scope}
            items={scopeTabs(payload)}
          />
        )}
      >
        <form method="get" action="/teach">
          <input type="hidden" name="scope" value={payload.scope} />
          <input type="hidden" name="type" value={payload.filter.type} />
          <input type="hidden" name="status" value={payload.filter.status} />
          <SearchInput
            name="q"
            placeholder="搜索标题"
            aria-label="搜索标题"
            defaultValue={payload.filter.q}
            className="w-56 max-w-full"
          />
        </form>
        <MiniTabs
          aria-label="类型"
          value={payload.filter.type}
          items={typeTabs(payload)}
        />
        {shared ? null : (
          <SimpleSelect
            className="w-32"
            ariaLabel="状态"
            value={payload.filter.status}
            options={STATUS_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
            onValueChange={(next) => {
              if (!isListStatus(next)) throw new TypeError(`teach_status_invalid:${next}`);
              window.location.assign(listHref({ ...query, status: next }));
            }}
          />
        )}
        {shared && payload.filter.status !== 'all' && !rowsEmpty ? (
          <Button variant="secondary" asChild>
            <a href="/teach?scope=shared">清除筛选</a>
          </Button>
        ) : null}
      </Toolbar>
      {selectionActive ? (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <span className="min-w-0 text-sm tabular text-fg">{`已选 ${selected.length} 项`}</span>
            <Button
              variant="primary"
              type="button"
              className="shrink-0"
              loading={exporting}
              onClick={() => {
                void exportSummary();
              }}
            >
              <FileSpreadsheet />
              导出总表
            </Button>
            <Button
              variant="ghost"
              type="button"
              className="shrink-0"
              disabled={exporting}
              onClick={clearSummary}
            >
              清除
            </Button>
          </div>
          {exportError !== null ? <Alert tone="danger">{exportError}</Alert> : null}
        </div>
      ) : null}
      {calendar ? <CalendarView key={listHref(query)} endpoint={listHref(query)} teacher /> : payload.filter.type === 'practice' ? (
        <>
          {rowsEmpty ? <Panel flush><ListEmpty payload={payload} creatable={creatable} /></Panel> : (
            <PracticeCards payload={payload} onPreview={(row) => setPreview({ type: row.type, id: row.id })} />
          )}
          {payload.pageCount > 1 ? (
            <Pagination current={payload.page} total={payload.pageCount} baseUrl={listHref(query)} summary={`共 ${payload.total.toLocaleString('zh-CN')} 个`} />
          ) : null}
        </>
      ) : (
        <Panel
          flush
          footer={payload.pageCount > 1 ? (
            <Pagination
              current={payload.page}
              total={payload.pageCount}
              baseUrl={listHref(query)}
              summary={`共 ${payload.total.toLocaleString('zh-CN')} 个`}
            />
          ) : undefined}
        >
          {rowsEmpty ? <ListEmpty payload={payload} creatable={creatable} /> : null}
          {!rowsEmpty && shared ? (
            <DataTable
              mobile="stack"
              rows={payload.sharedRows}
              rowKey={(row) => `${row.type}:${row.id}`}
              columns={sharedColumns(bootstrap.locale, (row) => setPreview({ type: row.type, id: row.id }))}
            />
          ) : null}
          {!rowsEmpty && !shared ? (
            <DataTable
              mobile="stack"
              rows={payload.rows}
              rowKey={(row) => `${row.type}:${row.id}`}
              rowHref={(row) => teachPath(row.type, row.id)}
              columns={mineColumns(selectedKeys, toggleSummary, exporting)}
            />
          ) : null}
        </Panel>
      )}
      <CopyDialog open={copyOpen} onOpenChange={setCopyOpen} />
      <SharedPreviewDialog
        open={preview !== null}
        onOpenChange={(next) => {
          if (!next) setPreview(null);
        }}
        type={preview?.type ?? 'practice'}
        id={preview?.id ?? ''}
      />
    </Page>
  );
}
