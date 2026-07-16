/**
 * krypton-announcement React pages.
 *
 * Templates → components:
 *   announce_list.html             → AnnounceListPage
 *   announce_detail.html           → AnnounceDetailPage
 *   admin_announce_list.html       → AdminAnnounceListPage
 *   admin_announce_categories.html → AdminAnnounceCategoriesPage
 */
import { useMemo, useState } from 'react';
import { ArrowUpDown, Calendar, Eye, EyeOff, GripVertical, Megaphone, Pencil, Pin, PinOff, Plus, Save, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { FormField, FormRow } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { MiniTabs } from '@/components/ui/mini-tabs';
import { Pagination } from '@/components/ui/pagination';
import { SimpleSelect } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { TableAction, TableActions } from '@/components/ui/table-actions';
import { DateTime } from '@/components/ui/datetime';
import { MarkdownEditor, MarkdownView } from '@/components/markdown-renderer';
import { ModuleWorkspace, type ModuleWorkspaceNavItem } from '@/components/management/module-workspace';
import { Checkbox } from '@/components/ui/checkbox';
import { useBootstrap } from '@/lib/bootstrap';
import { PRIV } from '@/lib/perms';
import { cn } from '@/lib/cn';

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

const COLOR_CLASSES: Record<string, string> = {
  gray: 'bg-muted text-muted-foreground border-border',
  amber: 'bg-amber-100 text-amber-900 border-amber-300 dark:bg-amber-950/40 dark:text-amber-200 dark:border-amber-700/50',
  blue: 'bg-blue-100 text-blue-900 border-blue-300 dark:bg-blue-950/40 dark:text-blue-200 dark:border-blue-700/50',
  purple: 'bg-purple-100 text-purple-900 border-purple-300 dark:bg-purple-950/40 dark:text-purple-200 dark:border-purple-700/50',
  green: 'bg-emerald-100 text-emerald-900 border-emerald-300 dark:bg-emerald-950/40 dark:text-emerald-200 dark:border-emerald-700/50',
  rose: 'bg-rose-100 text-rose-900 border-rose-300 dark:bg-rose-950/40 dark:text-rose-200 dark:border-rose-700/50',
  sky: 'bg-sky-100 text-sky-900 border-sky-300 dark:bg-sky-950/40 dark:text-sky-200 dark:border-sky-700/50',
};

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
  return ANNOUNCEMENT_WORKSPACE_NAV
    .filter((item) => canManageCategories || !item.systemOnly)
    .map(({ systemOnly: _systemOnly, ...item }) => item);
}

function CategoryChip({ category, size = 'sm' }: { category: { name: string; color: string } | undefined; size?: 'sm' | 'md' }) {
  if (!category) return null;
  const colorClass = COLOR_CLASSES[category.color] || COLOR_CLASSES.gray;
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md border font-medium',
        size === 'sm' ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-0.5 text-xs',
        colorClass,
      )}
    >
      {category.name}
    </span>
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
    <div className="w-full space-y-5">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Megaphone className="size-5 text-primary" />
          <h1 className="text-xl font-semibold">公告</h1>
        </div>
        <Button asChild variant="outline" size="sm">
          <a href={toggleSortUrl()} className="gap-1.5">
            <ArrowUpDown className="size-3.5" />
            {currentSort === 'desc' ? '最新优先' : '最早优先'}
          </a>
        </Button>
      </header>

      <MiniTabs
        size="sm"
        value={data.category || 'all'}
        onValueChange={(v) => {
          const q: string[] = [];
          if (v !== 'all') q.push(`category=${encodeURIComponent(v)}`);
          if (currentSort === 'asc') q.push('sort=asc');
          window.location.href = q.length ? `/announce?${q.join('&')}` : '/announce';
        }}
        items={[{ value: 'all', label: '全部' }, ...data.categories.map((c) => ({ value: c.key, label: c.name }))]}
      />

      <Card>
        <CardContent className="p-0">
          {data.docs.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">暂无公告</p>
          ) : (
            <ul className="divide-y">
              {data.docs.map((doc) => {
                const cat = catMap.get(doc.category);
                return (
                  <li key={doc._id}>
                    <a href={`/announce/${doc._id}`} className="flex items-center gap-3 px-5 py-3.5 transition-colors hover:bg-accent/40">
                      {doc.pin ? <Pin className="size-3.5 shrink-0 text-amber-600" /> : <span className="size-3.5 shrink-0" />}
                      <CategoryChip category={cat} />
                      <span className="flex-1 truncate text-sm font-medium">{doc.title}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">
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
    </div>
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
    <div className="w-full space-y-5">
      <Button variant="ghost" size="sm" asChild>
        <a href="/announce" className="gap-1.5">
          <ArrowUpDown className="size-3.5 rotate-90" />
          返回公告列表
        </a>
      </Button>
      <Card>
        <CardHeader className="space-y-2 border-b">
          <div className="flex items-center gap-2">
            {data.doc.pin && <Pin className="size-4 text-amber-600" />}
            <CategoryChip category={data.category || undefined} size="md" />
            <span className="text-xs text-muted-foreground">
              <DateTime value={data.doc.publishAt} />
            </span>
            <span className="ml-auto text-xs text-muted-foreground">
              <Eye className="mr-1 inline size-3" />
              {data.doc.views}
            </span>
          </div>
          <CardTitle className="text-2xl">{data.doc.title}</CardTitle>
        </CardHeader>
        <CardContent className="p-6">
          <MarkdownView content={data.doc.content} />
        </CardContent>
      </Card>
    </div>
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
      const response = await fetch('/admin/announce', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
        body: form,
      });
      if (!response.ok) {
        const detail = (await response.text()).trim();
        throw new Error(detail || `保存顺序失败（HTTP ${response.status}）`);
      }
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
          <Button variant="outline" onClick={() => void handleSaveOrder()} className="min-h-10 gap-1" disabled={savingOrder}>
            <Save className="size-3.5" />
            {savingOrder ? '保存中…' : '保存顺序'}
          </Button>
          <Button asChild className="min-h-10 gap-1">
            <a href="/admin/announce/new">
              <Plus className="size-3.5" />
              新建公告
            </a>
          </Button>
        </div>
      }
    >
      {orderError ? <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">{orderError}</p> : null}
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
                      <GripVertical className="size-3.5 cursor-grab text-muted-foreground" />
                    </TableCell>
                    <TableCell>{doc.pin ? <Pin className="size-4 text-amber-600" /> : null}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-[10px]">
                        {doc.scope === 'global' ? '全局' : '当前域'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <CategoryChip category={cat} />
                    </TableCell>
                    <TableCell className="text-sm font-medium">
                      <a href={`/announce/${doc._id}`} className="inline-flex min-h-10 items-center hover:text-primary">
                        {doc.title}
                      </a>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      <DateTime value={doc.publishAt} mode="date" />
                    </TableCell>
                    <TableCell>
                      {doc.hidden ? (
                        <Badge variant="destructive" className="gap-0.5 text-[10px]">
                          <EyeOff className="size-2.5" />
                          隐藏
                        </Badge>
                      ) : new Date(doc.publishAt) > new Date() ? (
                        <Badge variant="outline" className="gap-0.5 text-[10px]">
                          <Calendar className="size-2.5" />
                          定时
                        </Badge>
                      ) : doc.unpublishAt && new Date(doc.unpublishAt) <= new Date() ? (
                        <Badge variant="outline" className="gap-0.5 text-[10px]">
                          已下线
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="gap-0.5 text-[10px]">
                          <Eye className="size-2.5" />
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
                  <TableCell colSpan={8} className="py-12 text-center text-sm text-muted-foreground">
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

export function AdminAnnounceEditorPage() {
  const bs = useBootstrap();
  const data = bs.page.data as EditorBody;
  const uid = bs.user.id;
  const isNew = !data.doc;
  const [title, setTitle] = useState(data.doc?.title || '');
  const [content, setContent] = useState(data.doc?.content || '');
  const [category, setCategory] = useState(data.doc?.category || data.categories[0]?.key || 'announcement');
  const [scope, setScope] = useState<'global' | 'domain'>(data.doc?.scope || 'domain');
  const [pin, setPin] = useState(!!data.doc?.pin);
  const [hidden, setHidden] = useState(!!data.doc?.hidden);
  const [publishAt, setPublishAt] = useState(
    data.doc?.publishAt ? new Date(data.doc.publishAt).toISOString().slice(0, 16) : new Date().toISOString().slice(0, 16),
  );
  const [unpublishAt, setUnpublishAt] = useState(data.doc?.unpublishAt ? new Date(data.doc.unpublishAt).toISOString().slice(0, 16) : '');

  return (
    <ModuleWorkspace
      moduleTitle="公告管理"
      title={isNew ? '新建公告' : '编辑公告'}
      description={isNew ? '撰写正文并设置发布范围与时间。' : '修改公告内容和发布设置，保存后立即按现有可见性规则生效。'}
      navItems={announcementWorkspaceNav(data.canEditGlobal)}
      activeKey="announcements"
      bypassPrivGate
      actions={
        <Button asChild variant="outline" className="min-h-10">
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

        <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1fr)_22rem] xl:items-start">
          <Card className="min-w-0">
            <CardHeader>
              <CardTitle className="text-base">公告内容</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <FormField label="标题" required htmlFor="ann-title">
                <Input id="ann-title" name="title" value={title} onChange={(e) => setTitle(e.target.value)} required className="min-h-10" />
              </FormField>
              <FormField label="正文（Markdown）">
                <MarkdownEditor
                  value={content}
                  onChange={setContent}
                  minHeight={480}
                  pasteUpload={{
                    endpoint: '/file',
                    makeUrl: (filename) => `/file/${uid}/${filename}`,
                  }}
                />
              </FormField>
            </CardContent>
          </Card>

          <div className="space-y-5">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">发布设置</CardTitle>
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
                    className="min-h-10"
                  />
                </FormField>
                <FormField label="下线时间（可选）" htmlFor="ann-unpub">
                  <Input
                    id="ann-unpub"
                    name="unpublishAt"
                    type="datetime-local"
                    value={unpublishAt}
                    onChange={(e) => setUnpublishAt(e.target.value)}
                    className="min-h-10"
                  />
                </FormField>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">展示状态</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <label className="flex min-h-10 cursor-pointer items-center gap-2 text-sm">
                  <Checkbox checked={pin} onChange={(e) => setPin(e.target.checked)} />
                  置顶
                </label>
                <label className="flex min-h-10 cursor-pointer items-center gap-2 text-sm">
                  <Checkbox checked={hidden} onChange={(e) => setHidden(e.target.checked)} />
                  隐藏（暂不公开）
                </label>
              </CardContent>
            </Card>
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t pt-4">
          <Button type="button" variant="ghost" asChild className="min-h-10">
            <a href="/admin/announce">取消</a>
          </Button>
          <Button type="submit" className="min-h-10 gap-1">
            <Save className="size-3.5" />
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
        <Button onClick={() => setCreating(true)} className="min-h-10 gap-1">
          <Plus className="size-3.5" />
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
                  <TableCell className="font-mono text-xs text-muted-foreground">{c.key}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{c.color}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{c.order}</TableCell>
                  <TableCell>
                    {c.builtin && (
                      <Badge variant="secondary" className="text-[10px]">
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
      <DialogContent className="w-full sm:w-[480px]" onClose={onClose}>
        <DialogHeader>
          <DialogTitle>{isNew ? '新增分类' : '编辑分类'}</DialogTitle>
        </DialogHeader>
        <form method="post" action="/admin/announce/categories" className="flex flex-col">
          <input type="hidden" name="operation" value="upsert" />
          <div className="space-y-4 p-5">
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
                <Input id="cat-order" name="order" type="number" value={order} onChange={(e) => setOrder(Number(e.target.value) || 100)} className="min-h-10" />
              </FormField>
            </FormRow>
            <label className="flex min-h-10 cursor-pointer items-center gap-2 text-sm">
              <Checkbox name="hidden" value="true" checked={hidden} onChange={(e) => setHidden(e.target.checked)} />
              隐藏（仍可用于已有公告，但不出现在新建下拉里）
            </label>
            <div className="rounded-md border bg-muted/30 p-3">
              <p className="mb-2 text-xs text-muted-foreground">预览：</p>
              <CategoryChip category={{ name: name || '示例', color }} size="md" />
            </div>
          </div>
          <div className="flex justify-end gap-2 border-t bg-muted/20 px-5 py-3">
            <Button type="button" variant="ghost" onClick={onClose} className="min-h-10">
              取消
            </Button>
            <Button type="submit" className="min-h-10">保存</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
