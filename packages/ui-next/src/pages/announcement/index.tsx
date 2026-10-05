/**
 * krypton-announcement React pages.
 *
 * Templates → components:
 *   announce_list.html             → AnnounceListPage
 *   announce_detail.html           → AnnounceDetailPage
 *   admin_announce_list.html       → AdminAnnounceListPage
 *   admin_announce_categories.html → AdminAnnounceCategoriesPage
 */
import { useEffect, useMemo, useState } from 'react';
import { ArrowUpDown, Calendar, Eye, EyeOff, GripVertical, Pencil, Pin, PinOff, Plus, Save, Trash2 } from 'lucide-react';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { FormField, FormRow } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { MiniTabs } from '@/components/ui/mini-tabs';
import { Page, PageHeader } from '@/components/ui/page';
import { Pagination } from '@/components/ui/pagination';
import { SimpleSelect } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { TableAction, TableActions } from '@/components/ui/table-actions';
import { DateTime } from '@/components/ui/datetime';
import { MarkdownEditor, MarkdownView } from '@/components/markdown-renderer';
import { ModuleWorkspace, type ModuleWorkspaceNavItem } from '@/components/management/module-workspace';
import { Switch } from '@/components/ui/switch';
import { useBootstrap } from '@/lib/bootstrap';
import { PRIV } from '@/lib/perms';
import { fetchHydroResponse, readHydroResponseError } from '@/lib/error-presenter';

interface Category {
  _id: string;
  key: string;
  name: string;
  color: string;
  order: number;
  hidden: boolean;
  builtin: boolean;
}

interface AnnouncementDoc {
  _id: string;
  scope: 'global' | 'domain';
  domainId: string;
  owner: number;
  title: string;
  content: string;
  category: string;
  hidden: boolean;
  pin: boolean;
  sortOrder: number;
  publishAt: string;
  unpublishAt: string | null;
  views: number;
  createdAt: string;
  updatedAt: string;
}

const CATEGORY_TONE: Record<string, BadgeTone> = {
  gray: 'neutral',
  amber: 'warning',
  blue: 'info',
  purple: 'violet',
  green: 'success',
  rose: 'danger',
  sky: 'info',
};

function categoryTone(color: string): BadgeTone {
  return CATEGORY_TONE[color] ?? 'neutral';
}

const ANNOUNCEMENT_WORKSPACE_NAV: Array<ModuleWorkspaceNavItem & { systemOnly: boolean }> = [
  {
    key: 'announcements',
    label: '公告',
    href: '/admin/announce',
    templateNames: ['admin_announce_list.html', 'admin_announce_edit.html'],
    systemOnly: false,
  },
  {
    key: 'categories',
    label: '分类',
    href: '/admin/announce/categories',
    templateNames: ['admin_announce_categories.html'],
    systemOnly: true,
  },
];

function announcementWorkspaceNav(canManageCategories: boolean): ModuleWorkspaceNavItem[] {
  return ANNOUNCEMENT_WORKSPACE_NAV.filter((item) => canManageCategories || !item.systemOnly).map(({ systemOnly: _systemOnly, ...item }) => item);
}

function CategoryChip({ category, size = 'sm' }: { category: { name: string; color: string } | undefined; size?: 'sm' | 'md' }) {
  if (!category) return null;
  return (
    <Badge tone={categoryTone(category.color)} variant="outline" size={size === 'sm' ? 'sm' : 'md'} className="max-w-24 min-w-0">
      <span className="min-w-0 truncate">{category.name}</span>
    </Badge>
  );
}

/* ─────────────────────────── Public list ─────────────────────────── */

export function AnnounceListPage() {
  const bs = useBootstrap();
  const data = bs.page.data as {
    docs: AnnouncementDoc[];
    total: number;
    page: number;
    limit: number;
    category: string;
    categories: Category[];
    sort?: 'asc' | 'desc';
  };
  const catMap = new Map(data.categories.map((c) => [c.key, c]));
  const pcount = Math.max(1, Math.ceil(data.total / data.limit));
  const currentSort = data.sort === 'asc' ? 'asc' : 'desc';

  // Preserve current filters when building pagination / sort-toggle URLs.
  const parts: string[] = [];
  if (data.category) parts.push(`category=${encodeURIComponent(data.category)}`);
  if (currentSort === 'asc') parts.push('sort=asc');
  const baseQuery = parts.length ? `?${parts.join('&')}&` : '?';

  const toggleSortUrl = () => {
    const np: string[] = [];
    if (data.category) np.push(`category=${encodeURIComponent(data.category)}`);
    if (currentSort === 'desc') np.push('sort=asc'); // otherwise omit (= desc default)
    return np.length ? `/announce?${np.join('&')}` : '/announce';
  };

  return (
    <Page width="wide">
      <PageHeader
        title="公告"
        actions={(
          <Button asChild variant="secondary" size="sm">
            <a href={toggleSortUrl()}>
              <ArrowUpDown />
              {currentSort === 'desc' ? '最新优先' : '最早优先'}
            </a>
          </Button>
        )}
      />

      <div className="min-w-0 max-w-full overflow-x-auto">
        <MiniTabs
          size="sm"
          className="max-w-full overflow-x-auto"
          value={data.category || 'all'}
          onValueChange={(v) => {
            const q: string[] = [];
            if (v !== 'all') q.push(`category=${encodeURIComponent(v)}`);
            if (currentSort === 'asc') q.push('sort=asc');
            window.location.href = q.length ? `/announce?${q.join('&')}` : '/announce';
          }}
          items={[{ value: 'all', label: '全部' }, ...data.categories.map((c) => ({ value: c.key, label: c.name }))]}
        />
      </div>

      <Card className="min-w-0">
        <CardContent className="p-0">
          {data.docs.length === 0 ? (
            <p className="py-12 text-center text-sm text-fg-muted">暂无公告</p>
          ) : (
            <ul className="divide-y divide-line">
              {data.docs.map((doc) => {
                const cat = catMap.get(doc.category);
                return (
                  <li key={doc._id} className="min-w-0">
                    <a href={`/announce/${doc._id}`} className="flex min-w-0 items-center gap-3 px-5 py-3.5 transition-colors hover:bg-surface-hover">
                      {doc.pin ? <Pin className="size-3.5 shrink-0 text-warning-fg" /> : <span className="size-3.5 shrink-0" />}
                      <CategoryChip category={cat} />
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">{doc.title}</span>
                      <span className="shrink-0 text-xs text-fg-subtle">
                        <DateTime value={doc.publishAt} mode="date" />
                      </span>
                    </a>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {pcount > 1 && (
        <div className="flex justify-center">
          <Pagination current={data.page} total={pcount} baseUrl={baseQuery} />
        </div>
      )}
    </Page>
  );
}

/* ─────────────────────────── Detail ─────────────────────────── */

export function AnnounceDetailPage() {
  const bs = useBootstrap();
  const data = bs.page.data as {
    doc: AnnouncementDoc;
    category: Category | null;
  };
  return (
    <Page width="prose">
      <PageHeader
        title={data.doc.title}
        meta={(
          <>
            {data.doc.pin ? <Pin className="size-3.5 shrink-0 text-warning-fg" /> : null}
            <CategoryChip category={data.category || undefined} size="md" />
            <span className="min-w-0 break-words">
              <DateTime value={data.doc.publishAt} />
            </span>
            <span className="inline-flex items-center gap-1 tabular">
              <Eye className="size-3.5" />
              {data.doc.views}
            </span>
          </>
        )}
        actions={(
          <Button variant="ghost" size="sm" asChild>
            <a href="/announce">
              <ArrowUpDown className="rotate-90" />
              返回公告列表
            </a>
          </Button>
        )}
      />
      <Card className="min-w-0 overflow-x-auto">
        <CardContent>
          <MarkdownView content={data.doc.content} />
        </CardContent>
      </Card>
    </Page>
  );
}

/* ─────────────────────────── Admin: list + editor ─────────────────────────── */

interface AdminListBody {
  docs: AnnouncementDoc[];
  categories: Category[];
  canEditGlobal: boolean;
}

export function AdminAnnounceListPage() {
  const data = useBootstrap().page.data as AdminListBody;
  const catMap = new Map(data.categories.map((c) => [c.key, c]));

  // Drag-and-drop reorder state — held locally; flushed on save.
  const [orderedIds, setOrderedIds] = useState<string[]>(() => data.docs.map((d) => d._id));
  const dragRef = useState<string | null>(null);
  const [savingOrder, setSavingOrder] = useState(false);
  const [orderError, setOrderError] = useState<string | null>(null);

  const items = useMemo(() => {
    const map = new Map(data.docs.map((d) => [d._id, d]));
    const ordered = orderedIds.map((id) => map.get(id)).filter((d): d is AnnouncementDoc => !!d);
    // Append any docs not in orderedIds (e.g., a new one created since mount).
    for (const d of data.docs) if (!orderedIds.includes(d._id)) ordered.push(d);
    return ordered;
  }, [data.docs, orderedIds]);

  const handleSaveOrder = async () => {
    if (savingOrder) return;
    setSavingOrder(true);
    setOrderError(null);
    const form = new URLSearchParams();
    form.set('operation', 'reorder');
    for (const id of orderedIds) form.append('orderedIds', id);
    try {
      const response = await fetchHydroResponse('/admin/announce', {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
        body: form,
      });
      if (!response.ok) throw new Error(await readHydroResponseError(response, '保存顺序失败'));
      window.location.reload();
    } catch (error) {
      setOrderError(error instanceof Error ? error.message : String(error));
      setSavingOrder(false);
    }
  };

  return (
    <ModuleWorkspace
      moduleTitle="公告管理"
      title="公告"
      description="集中维护当前域公告；系统管理员还可以发布全站公告和管理分类。"
      navItems={announcementWorkspaceNav(data.canEditGlobal)}
      activeKey="announcements"
      bypassPrivGate
      actions={
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => void handleSaveOrder()} className="min-h-10" disabled={savingOrder}>
            <Save />
            {savingOrder ? '保存中…' : '保存顺序'}
          </Button>
          <Button asChild variant="primary" className="min-h-10">
            <a href="/admin/announce/new">
              <Plus />
              新建公告
            </a>
          </Button>
        </div>
      }
    >
      {orderError ? (
        <p role="alert" className="rounded-lg border border-danger-line bg-danger-soft px-4 py-3 text-sm text-danger-fg">
          {orderError}
        </p>
      ) : null}
      <Card>
        <CardContent className="overflow-x-auto p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10 pl-5" />
                <TableHead className="w-14">置顶</TableHead>
                <TableHead className="w-20">范围</TableHead>
                <TableHead className="w-24">分类</TableHead>
                <TableHead>标题</TableHead>
                <TableHead className="w-32">发布时间</TableHead>
                <TableHead className="w-24">状态</TableHead>
                <TableHead className="w-32 pr-5 text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((doc) => {
                const cat = catMap.get(doc.category);
                return (
                  <TableRow
                    key={doc._id}
                    draggable
                    onDragStart={() => {
                      dragRef[1](doc._id);
                    }}
                    onDragOver={(e) => {
                      e.preventDefault();
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      const from = dragRef[0];
                      if (!from || from === doc._id) return;
                      const fromIdx = orderedIds.indexOf(from);
                      const toIdx = orderedIds.indexOf(doc._id);
                      if (fromIdx === -1 || toIdx === -1) return;
                      const next = [...orderedIds];
                      next.splice(fromIdx, 1);
                      next.splice(toIdx, 0, from);
                      setOrderedIds(next);
                    }}
                  >
                    <TableCell className="pl-5">
                      <GripVertical className="size-3.5 cursor-grab text-fg-subtle" />
                    </TableCell>
                    <TableCell>{doc.pin ? <Pin className="size-4 text-warning-fg" /> : null}</TableCell>
                    <TableCell>
                      <Badge variant="outline" tone="neutral" size="sm">
                        {doc.scope === 'global' ? '全局' : '当前域'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <CategoryChip category={cat} />
                    </TableCell>
                    <TableCell className="text-sm font-medium">
                      <a href={`/announce/${doc._id}`} className="inline-flex min-h-10 min-w-0 items-center text-fg hover:text-brand-fg">
                        {doc.title}
                      </a>
                    </TableCell>
                    <TableCell className="text-xs text-fg-subtle">
                      <DateTime value={doc.publishAt} mode="date" />
                    </TableCell>
                    <TableCell>
                      {doc.hidden ? (
                        <Badge tone="danger" size="sm">
                          <EyeOff className="size-3" />
                          隐藏
                        </Badge>
                      ) : new Date(doc.publishAt) > new Date() ? (
                        <Badge tone="info" size="sm">
                          <Calendar className="size-3" />
                          定时
                        </Badge>
                      ) : doc.unpublishAt && new Date(doc.unpublishAt) <= new Date() ? (
                        <Badge tone="neutral" size="sm">
                          已下线
                        </Badge>
                      ) : (
                        <Badge tone="success" size="sm">
                          <Eye className="size-3" />
                          已发布
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="pr-5">
                      <TableActions>
                        <TableAction href={`/admin/announce/${doc._id}/edit`} icon={Pencil} className="min-h-10">
                          编辑
                        </TableAction>
                        <TableAction
                          formAction={`/admin/announce/${doc._id}/edit`}
                          hidden={{ operation: 'update', aid: doc._id, pin: doc.pin ? 'false' : 'true' }}
                          icon={doc.pin ? PinOff : Pin}
                          className="min-h-10"
                        >
                          {doc.pin ? '取消置顶' : '置顶'}
                        </TableAction>
                        <TableAction
                          formAction={`/admin/announce/${doc._id}/edit`}
                          hidden={{ operation: 'delete', aid: doc._id }}
                          icon={Trash2}
                          variant="destructive"
                          className="min-h-10"
                          confirm="确定要删除这条公告吗？该操作无法撤销。"
                        >
                          删除
                        </TableAction>
                      </TableActions>
                    </TableCell>
                  </TableRow>
                );
              })}
              {items.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="py-12 text-center text-sm text-fg-muted">
                    暂无公告，点击右上角新建。
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </ModuleWorkspace>
  );
}

/* ─────────────────────────── Admin: editor (full page) ─────────────────────────── */

interface EditorBody {
  doc: AnnouncementDoc | null;
  categories: Category[];
  canEditGlobal: boolean;
}

const ANNOUNCE_EDITOR_MIN_HEIGHT = 480;
const ANNOUNCE_EDITOR_MIN_HEIGHT_SHORT = 240;
const SHORT_MARKDOWN_QUERY = '(max-height: 56rem)';

/** datetime-local and the server both read `YYYY-MM-DDTHH:mm` as local time. */
function toDateTimeLocalValue(value: string | Date): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  if (!Number.isFinite(date.getTime())) {
    throw new RangeError(`公告时间无效: ${String(value)}`);
  }
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function useShortScreenMarkdownMinHeight(): number {
  const [minHeight, setMinHeight] = useState(ANNOUNCE_EDITOR_MIN_HEIGHT);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia(SHORT_MARKDOWN_QUERY);
    const apply = () => setMinHeight(media.matches ? ANNOUNCE_EDITOR_MIN_HEIGHT_SHORT : ANNOUNCE_EDITOR_MIN_HEIGHT);
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, []);
  return minHeight;
}

export function AdminAnnounceEditorPage() {
  const bs = useBootstrap();
  const data = bs.page.data as EditorBody;
  const uid = bs.user.id;
  const markdownMinHeight = useShortScreenMarkdownMinHeight();
  const isNew = !data.doc;
  const [title, setTitle] = useState(data.doc?.title || '');
  const [content, setContent] = useState(data.doc?.content || '');
  const [category, setCategory] = useState(data.doc?.category || data.categories[0]?.key || 'announcement');
  const [scope, setScope] = useState<'global' | 'domain'>(data.doc?.scope || 'domain');
  const [pin, setPin] = useState(!!data.doc?.pin);
  const [hidden, setHidden] = useState(!!data.doc?.hidden);
  const [publishAt, setPublishAt] = useState(() => toDateTimeLocalValue(data.doc?.publishAt || new Date()));
  const [unpublishAt, setUnpublishAt] = useState(() => (data.doc?.unpublishAt ? toDateTimeLocalValue(data.doc.unpublishAt) : ''));

  return (
    <ModuleWorkspace
      moduleTitle="公告管理"
      title={isNew ? '新建公告' : '编辑公告'}
      description={isNew ? '撰写正文并设置发布范围与时间。' : '修改公告内容和发布设置，保存后立即按现有可见性规则生效。'}
      navItems={announcementWorkspaceNav(data.canEditGlobal)}
      activeKey="announcements"
      bypassPrivGate
      actions={
        <Button asChild variant="secondary" className="min-h-10">
          <a href="/admin/announce">返回列表</a>
        </Button>
      }
    >
      <form method="post" action={isNew ? '/admin/announce' : `/admin/announce/${data.doc!._id}/edit`} className="space-y-5">
        <input type="hidden" name="operation" value={isNew ? 'create' : 'update'} />
        {!isNew && <input type="hidden" name="aid" value={data.doc!._id} />}
        <input type="hidden" name="content" value={content} />
        {/* Explicit booleans preserve the existing update contract when a
            checkbox is cleared; unchecked native checkboxes submit nothing. */}
        <input type="hidden" name="pin" value={pin ? 'true' : 'false'} />
        <input type="hidden" name="hidden" value={hidden ? 'true' : 'false'} />

        <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1fr)_20rem] xl:items-start">
          <Card className="min-w-0">
            <CardHeader>
              <CardTitle className="text-lg">公告内容</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <FormField label="标题" required htmlFor="ann-title">
                <Input id="ann-title" name="title" value={title} onChange={(e) => setTitle(e.target.value)} required className="min-h-10" />
              </FormField>
              <FormField label="正文（Markdown）">
                <MarkdownEditor
                  value={content}
                  onChange={setContent}
                  minHeight={markdownMinHeight}
                  pasteUpload={{
                    endpoint: '/file',
                    makeUrl: (filename) => `/file/${uid}/${filename}?noDisposition=1`,
                  }}
                />
              </FormField>
            </CardContent>
          </Card>

          <div className="min-w-0 space-y-5">
            <Card className="min-w-0">
              <CardHeader>
                <CardTitle className="text-lg">发布设置</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <FormField label="分类" required htmlFor="ann-cat">
                  <SimpleSelect
                    id="ann-cat"
                    name="category"
                    value={category}
                    onValueChange={setCategory}
                    className="min-h-10"
                    contentClassName="[&_[role=option]]:min-h-10"
                    options={data.categories.map((c) => ({ value: c.key, label: c.name }))}
                  />
                </FormField>
                <FormField label="范围" htmlFor="ann-scope">
                  <SimpleSelect
                    id="ann-scope"
                    name="scope"
                    value={scope}
                    onValueChange={(v) => setScope(v as 'global' | 'domain')}
                    disabled={!isNew}
                    className="min-h-10"
                    contentClassName="[&_[role=option]]:min-h-10"
                    options={[{ value: 'domain', label: '当前域' }, ...(data.canEditGlobal ? [{ value: 'global', label: '全局（全 OJ）' }] : [])]}
                  />
                </FormField>
                <FormField label="发布时间" htmlFor="ann-pub">
                  <Input
                    id="ann-pub"
                    name="publishAt"
                    type="datetime-local"
                    value={publishAt}
                    onChange={(e) => setPublishAt(e.target.value)}
                    className="min-h-10 min-w-0 w-full"
                  />
                </FormField>
                <FormField label="下线时间（可选）" htmlFor="ann-unpub">
                  <Input
                    id="ann-unpub"
                    name="unpublishAt"
                    type="datetime-local"
                    value={unpublishAt}
                    onChange={(e) => setUnpublishAt(e.target.value)}
                    className="min-h-10 min-w-0 w-full"
                  />
                </FormField>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">展示状态</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <label className="flex min-h-10 cursor-pointer items-center gap-2 text-sm">
                  <Switch checked={pin} onChange={(e) => setPin(e.target.checked)} />
                  置顶
                </label>
                <label className="flex min-h-10 cursor-pointer items-center gap-2 text-sm">
                  <Switch checked={hidden} onChange={(e) => setHidden(e.target.checked)} />
                  隐藏（暂不公开）
                </label>
              </CardContent>
            </Card>
          </div>
        </div>

        <div className="sticky bottom-0 z-20 -mx-1 flex min-w-0 flex-wrap justify-end gap-2 border-t border-line bg-bg px-1 pt-4 pb-4">
          <Button type="button" variant="ghost" asChild className="min-h-10">
            <a href="/admin/announce">取消</a>
          </Button>
          <Button type="submit" variant="primary" className="min-h-10">
            <Save />
            {isNew ? '创建' : '保存'}
          </Button>
        </div>
      </form>
    </ModuleWorkspace>
  );
}

/* ─────────────────────────── Admin: categories ─────────────────────────── */

export function AdminAnnounceCategoriesPage() {
  const data = useBootstrap().page.data as { categories: Category[] };
  const [editing, setEditing] = useState<Category | null>(null);
  const [creating, setCreating] = useState(false);

  return (
    <ModuleWorkspace
      moduleTitle="公告管理"
      title="分类"
      description="维护公告分类的名称、配色、显示状态和排序。内建分类不可删除。"
      navItems={announcementWorkspaceNav(true)}
      activeKey="categories"
      requiredPriv={PRIV.PRIV_EDIT_SYSTEM}
      actions={
        <Button variant="primary" onClick={() => setCreating(true)} className="min-h-10">
          <Plus />
          新增分类
        </Button>
      }
    >
      <Card>
        <CardContent className="overflow-x-auto p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-5">显示</TableHead>
                <TableHead>名称</TableHead>
                <TableHead className="w-24">key</TableHead>
                <TableHead className="w-24">配色</TableHead>
                <TableHead className="w-20">顺序</TableHead>
                <TableHead className="w-20">内建</TableHead>
                <TableHead className="w-32 pr-5 text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.categories.map((c) => (
                <TableRow key={c._id}>
                  <TableCell className="pl-5">
                    <CategoryChip category={c} />
                  </TableCell>
                  <TableCell className="text-sm font-medium">{c.name}</TableCell>
                  <TableCell className="font-mono text-xs text-fg-subtle">{c.key}</TableCell>
                  <TableCell className="text-xs text-fg-subtle">{c.color}</TableCell>
                  <TableCell className="text-xs tabular text-fg-subtle">{c.order}</TableCell>
                  <TableCell>
                    {c.builtin && (
                      <Badge tone="neutral" variant="outline" size="sm">
                        内建
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="pr-5">
                    <TableActions>
                      <TableAction onClick={() => setEditing(c)} icon={Pencil} className="min-h-10">
                        编辑
                      </TableAction>
                      {!c.builtin && (
                        <TableAction
                          formAction="/admin/announce/categories"
                          hidden={{ operation: 'delete', key: c.key }}
                          icon={Trash2}
                          variant="destructive"
                          className="min-h-10"
                          confirm="确定删除分类？"
                        >
                          删除
                        </TableAction>
                      )}
                    </TableActions>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {(creating || editing) && (
        <CategoryEditorDialog
          category={editing}
          onClose={() => {
            setEditing(null);
            setCreating(false);
          }}
        />
      )}
    </ModuleWorkspace>
  );
}

function CategoryEditorDialog({ category, onClose }: { category: Category | null; onClose: () => void }) {
  const isNew = !category;
  const [key, setKey] = useState(category?.key || '');
  const [name, setName] = useState(category?.name || '');
  const [color, setColor] = useState(category?.color || 'gray');
  const [order, setOrder] = useState(category?.order || 100);
  const [hidden, setHidden] = useState(!!category?.hidden);

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent size="md" onClose={onClose}>
        <DialogHeader>
          <DialogTitle>{isNew ? '新增分类' : '编辑分类'}</DialogTitle>
        </DialogHeader>
        <form method="post" action="/admin/announce/categories" className="flex flex-col">
          <DialogBody className="space-y-4 p-5">
            <input type="hidden" name="operation" value="upsert" />
            <FormRow columns={2}>
              <FormField label="Key" required htmlFor="cat-key">
                <Input id="cat-key" name="key" value={key} onChange={(e) => setKey(e.target.value)} disabled={!isNew} required className="min-h-10" />
              </FormField>
              <FormField label="显示名称" required htmlFor="cat-name">
                <Input id="cat-name" name="name" value={name} onChange={(e) => setName(e.target.value)} required className="min-h-10" />
              </FormField>
            </FormRow>
            <FormRow columns={2}>
              <FormField label="配色" htmlFor="cat-color">
                <SimpleSelect
                  id="cat-color"
                  name="color"
                  value={color}
                  onValueChange={setColor}
                  className="min-h-10"
                  contentClassName="[&_[role=option]]:min-h-10"
                  options={['gray', 'amber', 'blue', 'purple', 'green', 'rose', 'sky'].map((c) => ({
                    value: c,
                    label: c,
                  }))}
                />
              </FormField>
              <FormField label="排序" htmlFor="cat-order">
                <Input
                  id="cat-order"
                  name="order"
                  type="number"
                  value={order}
                  onChange={(e) => setOrder(Number(e.target.value) || 100)}
                  className="min-h-10"
                />
              </FormField>
            </FormRow>
            <label className="flex min-h-10 min-w-0 cursor-pointer items-start gap-2 text-sm">
              <Switch name="hidden" value="true" checked={hidden} onChange={(e) => setHidden(e.target.checked)} className="mt-0.5 shrink-0" />
              <span className="min-w-0 break-words leading-5">隐藏（仍可用于已有公告，但不出现在新建下拉里）</span>
            </label>
            <div className="rounded-md border border-line bg-surface-sunken p-3">
              <p className="mb-2 text-xs text-fg-subtle">预览：</p>
              <CategoryChip category={{ name: name || '示例', color }} size="md" />
            </div>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose} className="min-h-10">
              取消
            </Button>
            <Button type="submit" variant="primary" className="min-h-10">
              保存
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
