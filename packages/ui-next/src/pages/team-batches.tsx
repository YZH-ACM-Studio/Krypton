import { useId, useState } from 'react';
import { Plus, Users } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Breadcrumb } from '@/components/ui/breadcrumb';
import { Button } from '@/components/ui/button';
import { DataTable, type Column } from '@/components/ui/data-table';
import { Dialog } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Page, PageHeader } from '@/components/ui/page';
import { Pagination } from '@/components/ui/pagination';
import { Panel } from '@/components/ui/panel';
import { TableAction, TableActions } from '@/components/ui/table-actions';
import { Textarea } from '@/components/ui/textarea';
import {
  TEAM_DIALOG_BUTTON_CLASS,
  TEAM_DIALOG_CONTROL_CLASS,
  TEAM_DIALOG_TEXTAREA_CLASS,
  TeamDialogBody,
  TeamDialogContent,
  TeamDialogField,
  TeamDialogFooter,
} from '@/components/team-dialog';
import { useBootstrap } from '@/lib/bootstrap';
import { useExamNow } from '@/lib/exam-server-clock';

const PAGE_TITLE = '组队批次';
const PAGE_DESCRIPTION = '学生在「题目集」里看到开放中的批次并自己组队';
const EMPTY_TITLE = '还没有组队批次';
const CREATE_LABEL = '新建批次';
const SELF_MARK = '（你）';
const OBJECT_ID = /^[a-f0-9]{24}$/i;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

interface TeamBatchRow {
  batchId: string;
  name: string;
  status: 'open' | 'closed';
  revision: number;
  createdAt: string;
  teamCount: number;
  memberCount: number;
  createdBy: number;
  creatorName: string;
}

interface TeamBatchesPageData {
  batches: TeamBatchRow[];
  page: number;
  pageCount: number;
  canManage: boolean;
}

function invalid(path: string): never {
  throw new TypeError(`team_batches_invalid:${path}`);
}

function asRecord(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) invalid(path);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) invalid(path);
  return value as Record<string, unknown>;
}

function readRequired(record: Record<string, unknown>, key: string, parent: string): unknown {
  const path = parent === '' ? key : `${parent}.${key}`;
  if (!Object.hasOwn(record, key)) invalid(path);
  return record[key];
}

function readString(record: Record<string, unknown>, key: string, parent: string): string {
  const value = readRequired(record, key, parent);
  if (typeof value !== 'string') invalid(parent === '' ? key : `${parent}.${key}`);
  return value;
}

function readBoolean(record: Record<string, unknown>, key: string, parent: string): boolean {
  const value = readRequired(record, key, parent);
  if (typeof value !== 'boolean') invalid(parent === '' ? key : `${parent}.${key}`);
  return value;
}

function readCount(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) invalid(path);
  return value;
}

function readPage(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) invalid(path);
  return value;
}

function readBatchId(value: unknown, path: string): string {
  if (typeof value !== 'string' || !OBJECT_ID.test(value)) invalid(path);
  return value;
}

function readStatus(value: unknown, path: string): 'open' | 'closed' {
  if (value === 'open' || value === 'closed') return value;
  invalid(path);
}

function readInstant(value: unknown, path: string): string {
  if (typeof value !== 'string' || !ISO_INSTANT.test(value) || !Number.isFinite(Date.parse(value))) invalid(path);
  return value;
}

function readBatch(value: unknown, path: string): TeamBatchRow {
  const record = asRecord(value, path);
  return {
    batchId: readBatchId(readRequired(record, 'batchId', path), `${path}.batchId`),
    name: readString(record, 'name', path),
    status: readStatus(readRequired(record, 'status', path), `${path}.status`),
    revision: readCount(readRequired(record, 'revision', path), `${path}.revision`),
    createdAt: readInstant(readRequired(record, 'createdAt', path), `${path}.createdAt`),
    teamCount: readCount(readRequired(record, 'teamCount', path), `${path}.teamCount`),
    memberCount: readCount(readRequired(record, 'memberCount', path), `${path}.memberCount`),
    createdBy: readCount(readRequired(record, 'createdBy', path), `${path}.createdBy`),
    creatorName: readString(record, 'creatorName', path),
  };
}

function readBatches(value: unknown): TeamBatchRow[] {
  if (!Array.isArray(value)) invalid('batches');
  const seen = new Set<string>();
  return value.map((item, index) => {
    const row = readBatch(item, `batches[${index}]`);
    if (seen.has(row.batchId)) invalid(`batches[${index}].batchId`);
    seen.add(row.batchId);
    return row;
  });
}

function parseTeamBatchesPage(raw: unknown): TeamBatchesPageData {
  const record = asRecord(raw, '');
  const capabilities = asRecord(readRequired(record, 'capabilities', ''), 'capabilities');
  return {
    batches: readBatches(readRequired(record, 'batches', '')),
    page: readPage(readRequired(record, 'page', ''), 'page'),
    pageCount: readCount(readRequired(record, 'pageCount', ''), 'pageCount'),
    canManage: readBoolean(capabilities, 'canManage', 'capabilities'),
  };
}

/** Same calendar rule as C3 `formatDate`: same year `MM/DD`, otherwise `YYYY-MM-DD`. */
function formatDate(iso: string, now: number): string {
  const date = new Date(iso);
  const current = new Date(now);
  if (!Number.isFinite(date.getTime()) || !Number.isFinite(current.getTime())) {
    throw new TypeError('team_batches_invalid:createdAt');
  }
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  if (date.getFullYear() === current.getFullYear()) return `${month}/${day}`;
  return `${date.getFullYear()}-${month}-${day}`;
}

function batchColumns(uid: number, now: number): Column<TeamBatchRow>[] {
  return [
    {
      key: 'name',
      header: '名称',
      stackRole: 'title',
      cell: (row) => <span className="block min-w-0 truncate font-medium">{row.name}</span>,
    },
    {
      key: 'status',
      header: '状态',
      stackRole: 'meta',
      cell: (row) => (
        <Badge tone={row.status === 'open' ? 'success' : 'neutral'}>
          {row.status === 'open' ? '开放中' : '已结束'}
        </Badge>
      ),
    },
    {
      key: 'teams',
      header: '队伍',
      align: 'right',
      cell: (row) => <span className="tabular">{row.teamCount}</span>,
    },
    {
      key: 'members',
      header: '人数',
      align: 'right',
      cell: (row) => <span className="tabular">{row.memberCount}</span>,
    },
    {
      key: 'creator',
      header: '创建者',
      cell: (row) => (
        <span className="block min-w-0 truncate text-fg-muted">
          {row.creatorName}
          {row.createdBy === uid ? SELF_MARK : null}
        </span>
      ),
    },
    {
      key: 'created',
      header: '创建',
      cell: (row) => <span className="tabular text-fg-muted">{formatDate(row.createdAt, now)}</span>,
    },
    {
      key: 'actions',
      header: '操作',
      cell: (row) => (
        <TableActions>
          <TableAction href={`/teams/${row.batchId}/manage`}>查看</TableAction>
          {row.status === 'open' ? (
            <TableAction
              formAction={`/teams/${row.batchId}`}
              confirm={`关闭「${row.name}」后，学生不能再组队或调整队伍。`}
              hidden={{ operation: 'close', expectedRevision: row.revision }}
            >
              关闭组队
            </TableAction>
          ) : null}
        </TableActions>
      ),
    },
  ];
}

function CreateBatchDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const titleId = useId();
  const descriptionId = useId();
  const nameId = useId();
  const descriptionFieldId = useId();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <TeamDialogContent
        titleId={titleId}
        descriptionId={descriptionId}
        title={CREATE_LABEL}
        description="填写名称和说明。创建后，开放中的批次会出现在学生的题目集里。"
        icon={<Users className="size-5" />}
        onClose={() => onOpenChange(false)}
      >
        <form method="post" action="/teams" className="flex min-h-0 flex-1 flex-col">
          <input type="hidden" name="operation" value="create" />
          <TeamDialogBody>
            <TeamDialogField htmlFor={nameId} label="名称" hint="1–64 个字符">
              <Input
                id={nameId}
                name="name"
                required
                maxLength={64}
                autoFocus
                placeholder="例如：2026 暑期留校赛组队"
                className={TEAM_DIALOG_CONTROL_CLASS}
              />
            </TeamDialogField>
            <TeamDialogField htmlFor={descriptionFieldId} label="说明" hint="可选，最多 500 个字符">
              <Textarea
                id={descriptionFieldId}
                name="description"
                maxLength={500}
                placeholder="组队用途、截止安排等"
                className={TEAM_DIALOG_TEXTAREA_CLASS}
              />
            </TeamDialogField>
          </TeamDialogBody>
          <TeamDialogFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} className={TEAM_DIALOG_BUTTON_CLASS}>
              取消
            </Button>
            <Button type="submit" variant="primary" className={TEAM_DIALOG_BUTTON_CLASS}>
              创建批次
            </Button>
          </TeamDialogFooter>
        </form>
      </TeamDialogContent>
    </Dialog>
  );
}

export function TeamBatchesPage() {
  const bs = useBootstrap();
  const data = parseTeamBatchesPage(bs.page.data);
  const now = useExamNow(bs.generatedAt);
  const [createOpen, setCreateOpen] = useState(false);

  return (
    <Page width="wide">
      <PageHeader
        breadcrumb={<Breadcrumb items={[{ label: '教学' }, { label: PAGE_TITLE }]} />}
        title={PAGE_TITLE}
        description={PAGE_DESCRIPTION}
        actions={data.canManage ? (
          <Button type="button" variant="primary" onClick={() => setCreateOpen(true)}>
            <Plus />
            {CREATE_LABEL}
          </Button>
        ) : null}
      />
      <Panel
        flush
        footer={data.pageCount > 1 ? (
          <Pagination current={data.page} total={data.pageCount} baseUrl="/teams" />
        ) : undefined}
      >
        {data.batches.length === 0 ? (
          <EmptyState
            icon={<Users />}
            title={EMPTY_TITLE}
            description="点「新建批次」，学生就能在题目集里自己组队。"
          />
        ) : (
          <DataTable mobile="stack" rows={data.batches} rowKey={(row) => row.batchId} columns={batchColumns(bs.user.id, now)} />
        )}
      </Panel>
      {data.canManage ? <CreateBatchDialog open={createOpen} onOpenChange={setCreateOpen} /> : null}
    </Page>
  );
}
