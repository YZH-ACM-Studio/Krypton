/**
 * 我的题目（PLAN 2026-07-02 §4）——出题人的工作台。
 * 题库列表对学生隐藏（题库白名单模式）后，出过题的用户在这里管理
 * 自己 own 的题：列表 + 建题入口。数据来自 ProblemMineHandler
 * （/problem/mine，只查 owner=自己）。勾选后批量共享到学校题库。
 */
import { useRef, useState, useSyncExternalStore } from 'react';
import { BookOpen, Eye, EyeOff, Pencil } from 'lucide-react';
import { ProblemMineCreateAction } from '@/components/problem-mine-create-action';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { EmptyState } from '@/components/ui/empty-state';
import { Page, PageHeader } from '@/components/ui/page';
import { Pagination } from '@/components/ui/pagination';
import { Panel } from '@/components/ui/panel';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from '@/components/ui/toast';
import { useBootstrap } from '@/lib/bootstrap';
import { fetchHydroResponse, readHydroResponseError } from '@/lib/error-presenter';

const MD_UP_QUERY = '(min-width: 768px)';
const SCHOOL_BANK_PATH = '/problem/school-bank';
const SHARE_FAILURE = '共享到学校题库失败';

function subscribeMdUp(onChange: () => void) {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {};
  const media = window.matchMedia(MD_UP_QUERY);
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
}

function mdUpMatches() {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(MD_UP_QUERY).matches;
}

function useMdUp() {
  return useSyncExternalStore(subscribeMdUp, mdUpMatches, () => false);
}

interface OwnedProblem {
  docId: string | number;
  pid?: string | number;
  title?: string;
  tag?: string[];
  hidden?: boolean;
  nAccept?: number;
  nSubmit?: number;
}

interface MineRow {
  problem: OwnedProblem;
  docId: number;
  label: string;
  shared: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function integerDocId(value: unknown): number {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value;
  if (typeof value === 'string' && /^(?:0|[1-9]\d*)$/.test(value)) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed)) return parsed;
  }
  throw new TypeError('题目编号必须是整数');
}

/** 缺字段、null、undefined 都是未共享。其它形状不能当成空列表。 */
function readSchoolBankDocIds(data: unknown): number[] {
  if (!isRecord(data) || !Object.hasOwn(data, 'schoolBankDocIds')) return [];
  const value = data.schoolBankDocIds;
  if (value == null) return [];
  if (!Array.isArray(value)) throw new TypeError('学校题库共享标记格式不正确');
  const ids: number[] = [];
  for (const item of value) {
    if (typeof item !== 'number' || !Number.isSafeInteger(item) || item < 0) {
      throw new TypeError('学校题库共享标记格式不正确');
    }
    ids.push(item);
  }
  return ids;
}

function problemLabel(problem: OwnedProblem, docId: number): string {
  if (problem.pid) return String(problem.pid);
  return `P${docId}`;
}

function problemHref(problem: OwnedProblem, docId: number) {
  return `/p/${problem.pid || docId}`;
}

function shareResult(payload: unknown): void {
  if (!isRecord(payload)) throw new TypeError('学校题库响应格式不正确');
  for (const key of ['changed', 'unchanged']) {
    const value = payload[key];
    if (!Array.isArray(value)) throw new TypeError('学校题库响应格式不正确');
    for (const item of value) {
      if (typeof item !== 'number' || !Number.isSafeInteger(item)) {
        throw new TypeError('学校题库响应格式不正确');
      }
    }
  }
}

async function postJson(path: string, body: Record<string, unknown>, fallback: string): Promise<Record<string, unknown>> {
  const response = await fetchHydroResponse(path, {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  }, fallback);
  if (!response.ok) throw new Error(await readHydroResponseError(response, fallback));
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error('服务器返回了无法解析的响应');
  }
  if (!isRecord(payload)) throw new Error('服务器返回了无法解析的响应');
  return payload;
}

function failureText(error: unknown): string {
  if (error instanceof Error && error.message.trim() !== '') return error.message;
  return SHARE_FAILURE;
}

function ProblemVisibilityBadge({ hidden }: { hidden?: boolean }) {
  return hidden ? (
    <Badge tone="warning" size="sm">
      <EyeOff className="size-3" aria-hidden="true" />
      隐藏
    </Badge>
  ) : (
    <Badge tone="success" size="sm">
      <Eye className="size-3" aria-hidden="true" />
      可见
    </Badge>
  );
}

function SharedBadge() {
  return <Badge size="sm">已共享</Badge>;
}

function ProblemTitleBlock({ problem, docId }: { problem: OwnedProblem; docId: number }) {
  return (
    <>
      <a href={problemHref(problem, docId)} className="block min-w-0 truncate text-sm font-medium text-fg hover:text-brand-fg hover:underline">
        {problem.title}
      </a>
      <div className="mt-1 flex min-w-0 flex-wrap gap-1">
        {(problem.tag || []).slice(0, 4).map((tag: string) => (
          <Badge key={tag} variant="outline" size="sm" className="h-auto! max-w-full min-w-0 shrink! whitespace-normal! break-words py-0.5">
            {tag}
          </Badge>
        ))}
      </div>
    </>
  );
}

function ProblemSelectBox({
  label,
  checked,
  disabled,
  onCheckedChange,
}: {
  label: string;
  checked: boolean;
  disabled: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <Checkbox
      size="sm"
      checked={checked}
      disabled={disabled}
      aria-label={`选择 ${label}`}
      onCheckedChange={onCheckedChange}
    />
  );
}

function ShareActions({
  count,
  pending,
  onShare,
  onUnshare,
}: {
  count: number;
  pending: boolean;
  onShare: () => void;
  onUnshare: () => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-2 sm:flex sm:items-center">
      <span className="text-sm text-fg-muted tabular">已选 {count} 道</span>
      <Button type="button" variant="secondary" size="sm" disabled={pending} onClick={onShare}>
        共享到学校题库
      </Button>
      <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={onUnshare}>
        取消共享
      </Button>
    </div>
  );
}

export function ProblemMinePage() {
  const bs = useBootstrap();
  const raw = bs.page.data;
  const data = raw as {
    pdocs: OwnedProblem[];
    page: number;
    pcount: number;
    ppcount: number;
    canCreate: boolean;
  };
  const pdocs = data.pdocs || [];
  const page = data.page || 1;
  const pageCount = data.ppcount || 1;
  const mdUp = useMdUp();
  const sharedIds = new Set(readSchoolBankDocIds(raw));
  const rows: MineRow[] = pdocs.map((problem) => {
    const docId = integerDocId(problem.docId);
    return {
      problem,
      docId,
      label: problemLabel(problem, docId),
      shared: sharedIds.has(docId),
    };
  });
  const pageIds: number[] = [];
  for (const row of rows) {
    if (!pageIds.includes(row.docId)) pageIds.push(row.docId);
  }
  const [selected, setSelected] = useState<ReadonlySet<number>>(() => new Set());
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const selectedIds = pageIds.filter((id) => selected.has(id));
  const allChecked = pageIds.length > 0 && selectedIds.length === pageIds.length;
  const someChecked = selectedIds.length > 0 && !allChecked;

  function setChecked(docId: number, checked: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(docId);
      else next.delete(docId);
      return next;
    });
  }

  function setPageChecked(checked: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      for (const id of pageIds) {
        if (checked) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }

  async function updateShare(shared: boolean): Promise<void> {
    if (pendingRef.current) return;
    const docIds = pageIds.filter((id) => selected.has(id));
    if (docIds.length === 0) return;
    pendingRef.current = true;
    setPending(true);
    try {
      const payload = await postJson(SCHOOL_BANK_PATH, { docIds, shared }, SHARE_FAILURE);
      shareResult(payload);
      toast.success(shared ? `已共享 ${docIds.length} 道` : `已取消共享 ${docIds.length} 道`);
      window.location.reload();
    } catch (error) {
      console.error(SHARE_FAILURE, error);
      pendingRef.current = false;
      setPending(false);
      toast.error(failureText(error));
    }
  }

  return (
    <Page width="wide">
      <PageHeader
        title={(
          <span className="inline-flex min-w-0 items-center gap-2">
            <BookOpen className="size-5 shrink-0 text-fg-subtle" aria-hidden="true" />
            <span className="min-w-0 truncate">我的题目</span>
          </span>
        )}
        meta={<span className="tabular">共 {data.pcount ?? pdocs.length} 题</span>}
        actions={<ProblemMineCreateAction allowed={data.canCreate === true} />}
      />

      <Panel
        flush
        actions={selectedIds.length > 0 ? (
          <ShareActions
            count={selectedIds.length}
            pending={pending}
            onShare={() => { void updateShare(true); }}
            onUnshare={() => { void updateShare(false); }}
          />
        ) : undefined}
      >
        {rows.length === 0 ? (
          <EmptyState
            title="你还没有参与出题。"
            description={data.canCreate ? '点击右上角「新建题目」开始。' : undefined}
          />
        ) : (
          mdUp ? (
            <Table density="flush">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox
                      size="sm"
                      checked={allChecked}
                      indeterminate={someChecked}
                      disabled={pending}
                      aria-label="选择本页全部题目"
                      onCheckedChange={setPageChecked}
                    />
                  </TableHead>
                  <TableHead className="w-28">ID</TableHead>
                  <TableHead>标题</TableHead>
                  <TableHead className="w-36 text-center">状态</TableHead>
                  <TableHead className="w-28 text-right">通过 / 提交</TableHead>
                  <TableHead className="w-28 text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={String(row.docId)}>
                    <TableCell>
                      <ProblemSelectBox
                        label={row.label}
                        checked={selected.has(row.docId)}
                        disabled={pending}
                        onCheckedChange={(checked) => setChecked(row.docId, checked)}
                      />
                    </TableCell>
                    <TableCell className="font-mono text-xs">{row.label}</TableCell>
                    <TableCell className="min-w-0">
                      <ProblemTitleBlock problem={row.problem} docId={row.docId} />
                    </TableCell>
                    <TableCell className="text-center">
                      <span className="inline-flex flex-wrap items-center justify-center gap-1">
                        <ProblemVisibilityBadge hidden={row.problem.hidden} />
                        {row.shared ? <SharedBadge /> : null}
                      </span>
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs text-fg-subtle tabular">
                      {row.problem.nAccept ?? 0} / {row.problem.nSubmit ?? 0}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button asChild variant="secondary" size="sm">
                        <a href={`${problemHref(row.problem, row.docId)}/edit`}>
                          <Pencil />
                          编辑
                        </a>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <ul className="flex flex-col gap-3 p-3">
              {rows.map((row) => (
                <li key={String(row.docId)} className="grid grid-cols-1 gap-3 rounded-lg border border-line bg-surface p-4">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 flex-1 items-center justify-between gap-2">
                      <span className="shrink-0 text-xs text-fg-subtle">ID</span>
                      <span className="min-w-0 truncate font-mono text-xs text-fg">{row.label}</span>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {row.shared ? <SharedBadge /> : null}
                      <ProblemSelectBox
                        label={row.label}
                        checked={selected.has(row.docId)}
                        disabled={pending}
                        onCheckedChange={(checked) => setChecked(row.docId, checked)}
                      />
                    </div>
                  </div>
                  <div className="min-w-0">
                    <ProblemTitleBlock problem={row.problem} docId={row.docId} />
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="shrink-0 text-xs text-fg-subtle">状态</span>
                    <ProblemVisibilityBadge hidden={row.problem.hidden} />
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="shrink-0 text-xs text-fg-subtle">通过 / 提交</span>
                    <span className="font-mono text-xs text-fg-subtle tabular">
                      {row.problem.nAccept ?? 0} / {row.problem.nSubmit ?? 0}
                    </span>
                  </div>
                  <Button asChild variant="secondary" size="sm" className="w-full">
                    <a href={`${problemHref(row.problem, row.docId)}/edit`}>
                      <Pencil />
                      编辑
                    </a>
                  </Button>
                </li>
              ))}
            </ul>
          )
        )}
      </Panel>

      <Pagination current={page} total={pageCount} baseUrl="/problem/mine" />
    </Page>
  );
}
