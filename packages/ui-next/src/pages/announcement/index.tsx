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
import {
  ArrowUpDown, BellRing, Calendar, ChevronDown, ChevronUp,
  Eye, EyeOff, GripVertical, Megaphone, Pencil, Pin, PinOff,
  Plus, Save, Tag, Trash2,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { FormField, FormRow } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { MiniTabs } from '@/components/ui/mini-tabs';
import { Pagination } from '@/components/ui/pagination';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { TableAction, TableActions } from '@/components/ui/table-actions';
import { DateTime } from '@/components/ui/datetime';
import { MarkdownEditor, MarkdownView } from '@/components/markdown-renderer';
import { AdminPage } from '@/components/admin/admin-page';
import { useBootstrap } from '@/lib/bootstrap';
import { registerAdminNavSection } from '@/lib/admin-nav-registry';
import { PRIV } from '@/lib/perms';
import { cn } from '@/lib/cn';

// Sidebar registration: 公告管理 lives under domainAdmin.
registerAdminNavSection({
  key: 'announce',
  label: '公告',
  order: 22,
  requiredAccess: 'domainAdmin',
  items: [
    { key: 'list', label: '公告列表', href: '/admin/announce', icon: Megaphone, templateNames: ['admin_announce_list.html'], requiredAccess: 'domainAdmin' },
    { key: 'categories', label: '分类管理', href: '/admin/announce/categories', icon: Tag, templateNames: ['admin_announce_categories.html'], requiredPriv: PRIV.PRIV_EDIT_SYSTEM },
  ],
});

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

function CategoryChip({ category, size = 'sm' }: {
  category: { name: string; color: string } | undefined;
  size?: 'sm' | 'md';
}) {
  if (!category) return null;
  const colorClass = COLOR_CLASSES[category.color] || COLOR_CLASSES.gray;
  return (
    <span className={cn(
      'inline-flex items-center rounded-md border font-medium',
      size === 'sm' ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-0.5 text-xs',
      colorClass,
    )}>
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
  };
  const catMap = new Map(data.categories.map((c) => [c.key, c]));
  const pcount = Math.max(1, Math.ceil(data.total / data.limit));

  const baseQuery = data.category ? `?category=${encodeURIComponent(data.category)}&` : '?';

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Megaphone className="size-5 text-primary" />
          <h1 className="text-xl font-semibold">公告</h1>
        </div>
      </header>

      <MiniTabs
        size="sm"
        value={data.category || 'all'}
        onValueChange={(v) => {
          window.location.href = v === 'all' ? '/announce' : `/announce?category=${encodeURIComponent(v)}`;
        }}
        items={[
          { value: 'all', label: '全部' },
          ...data.categories.map((c) => ({ value: c.key, label: c.name })),
        ]}
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
                    <a
                      href={`/announce/${doc._id}`}
                      className="flex items-center gap-3 px-5 py-3.5 transition-colors hover:bg-accent/40"
                    >
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
    <div className="mx-auto max-w-4xl space-y-5">
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
  const [editing, setEditing] = useState<AnnouncementDoc | null>(null);
  const [creating, setCreating] = useState(false);

  // Drag-and-drop reorder state — held locally; flushed on save.
  const [orderedIds, setOrderedIds] = useState<string[]>(() => data.docs.map((d) => d._id));
  const dragRef = useState<string | null>(null);

  const items = useMemo(() => {
    const map = new Map(data.docs.map((d) => [d._id, d]));
    const ordered = orderedIds.map((id) => map.get(id)).filter((d): d is AnnouncementDoc => !!d);
    // Append any docs not in orderedIds (e.g., a new one created since mount).
    for (const d of data.docs) if (!orderedIds.includes(d._id)) ordered.push(d);
    return ordered;
  }, [data.docs, orderedIds]);

  const handleSaveOrder = async () => {
    const form = new URLSearchParams();
    form.set('operation', 'reorder');
    for (const id of orderedIds) form.append('orderedIds', id);
    await fetch('/admin/announce', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
      body: form,
    });
    window.location.reload();
  };

  return (
    <AdminPage
      title={(
        <div className="flex items-center gap-2">
          <Megaphone className="size-5 text-primary" />
          <h1 className="text-xl font-semibold">公告管理</h1>
        </div>
      )}
      bypassPrivGate
      actions={(
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleSaveOrder} className="gap-1">
            <Save className="size-3.5" />
            保存顺序
          </Button>
          <Button onClick={() => setCreating(true)} className="gap-1">
            <Plus className="size-3.5" />
            新建公告
          </Button>
        </div>
      )}
    >
      <Card>
        <CardContent className="p-0">
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
              {items.map((doc, idx) => {
                const cat = catMap.get(doc.category);
                return (
                  <TableRow
                    key={doc._id}
                    draggable
                    onDragStart={() => { dragRef[1](doc._id); }}
                    onDragOver={(e) => { e.preventDefault(); }}
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
                    <TableCell>
                      {doc.pin ? <Pin className="size-4 text-amber-600" /> : null}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-[10px]">
                        {doc.scope === 'global' ? '全局' : '当前域'}
                      </Badge>
                    </TableCell>
                    <TableCell><CategoryChip category={cat} /></TableCell>
                    <TableCell className="text-sm font-medium">
                      <a href={`/announce/${doc._id}`} className="hover:text-primary">
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
                        <Badge variant="outline" className="gap-0.5 text-[10px]">已下线</Badge>
                      ) : (
                        <Badge variant="secondary" className="gap-0.5 text-[10px]">
                          <Eye className="size-2.5" />
                          已发布
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="pr-5">
                      <TableActions>
                        <TableAction onClick={() => setEditing(doc)} icon={Pencil}>编辑</TableAction>
                        <TableAction
                          formAction="/admin/announce"
                          hidden={{ operation: 'update', aid: doc._id, pin: doc.pin ? 'false' : 'true' }}
                          icon={doc.pin ? PinOff : Pin}
                        >
                          {doc.pin ? '取消置顶' : '置顶'}
                        </TableAction>
                        <TableAction
                          formAction="/admin/announce"
                          hidden={{ operation: 'delete', aid: doc._id }}
                          icon={Trash2}
                          variant="destructive"
                          confirm="确定删除？"
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

      {(creating || editing) && (
        <AnnouncementEditorDialog
          doc={editing}
          categories={data.categories}
          canEditGlobal={data.canEditGlobal}
          onClose={() => { setEditing(null); setCreating(false); }}
        />
      )}
    </AdminPage>
  );
}

function AnnouncementEditorDialog({
  doc, categories, canEditGlobal, onClose,
}: {
  doc: AnnouncementDoc | null;
  categories: Category[];
  canEditGlobal: boolean;
  onClose: () => void;
}) {
  const isNew = !doc;
  const [title, setTitle] = useState(doc?.title || '');
  const [content, setContent] = useState(doc?.content || '');
  const [category, setCategory] = useState(doc?.category || categories[0]?.key || 'announcement');
  const [scope, setScope] = useState<'global' | 'domain'>(doc?.scope || 'domain');
  const [pin, setPin] = useState(!!doc?.pin);
  const [hidden, setHidden] = useState(!!doc?.hidden);
  const [publishAt, setPublishAt] = useState(doc?.publishAt
    ? new Date(doc.publishAt).toISOString().slice(0, 16)
    : new Date().toISOString().slice(0, 16));
  const [unpublishAt, setUnpublishAt] = useState(doc?.unpublishAt
    ? new Date(doc.unpublishAt).toISOString().slice(0, 16)
    : '');

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="w-full sm:w-[760px]" onClose={onClose}>
        <DialogHeader>
          <DialogTitle>{isNew ? '新建公告' : '编辑公告'}</DialogTitle>
        </DialogHeader>
        <form method="post" action="/admin/announce" className="flex max-h-[80vh] flex-col">
          <input type="hidden" name="operation" value={isNew ? 'create' : 'update'} />
          {!isNew && <input type="hidden" name="aid" value={doc!._id} />}
          <input type="hidden" name="content" value={content} />
          <div className="krypton-scrollbar flex-1 space-y-4 overflow-y-auto p-5">
            <FormField label="标题" required htmlFor="ann-title">
              <Input id="ann-title" name="title" value={title} onChange={(e) => setTitle(e.target.value)} required />
            </FormField>
            <FormRow columns={2}>
              <FormField label="分类" required htmlFor="ann-cat">
                <select
                  id="ann-cat" name="category" value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                >
                  {categories.map((c) => (
                    <option key={c.key} value={c.key}>{c.name}</option>
                  ))}
                </select>
              </FormField>
              <FormField label="范围" htmlFor="ann-scope">
                <select
                  id="ann-scope" name="scope" value={scope}
                  onChange={(e) => setScope(e.target.value as 'global' | 'domain')}
                  disabled={!isNew}
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm disabled:opacity-60"
                >
                  <option value="domain">当前域</option>
                  {canEditGlobal && <option value="global">全局（全 OJ）</option>}
                </select>
              </FormField>
            </FormRow>
            <FormRow columns={2}>
              <FormField label="发布时间" htmlFor="ann-pub">
                <Input
                  id="ann-pub" name="publishAt" type="datetime-local"
                  value={publishAt} onChange={(e) => setPublishAt(e.target.value)}
                />
              </FormField>
              <FormField label="下线时间（可选）" htmlFor="ann-unpub">
                <Input
                  id="ann-unpub" name="unpublishAt" type="datetime-local"
                  value={unpublishAt} onChange={(e) => setUnpublishAt(e.target.value)}
                />
              </FormField>
            </FormRow>
            <div className="flex items-center gap-6">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox" name="pin" checked={pin}
                  onChange={(e) => setPin(e.target.checked)}
                  value="true"
                  className="size-4 rounded border accent-primary"
                />
                置顶
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox" name="hidden" checked={hidden}
                  onChange={(e) => setHidden(e.target.checked)}
                  value="true"
                  className="size-4 rounded border accent-primary"
                />
                隐藏（暂不公开）
              </label>
            </div>
            <FormField label="正文（Markdown）">
              <MarkdownEditor value={content} onChange={setContent} minHeight={320} />
            </FormField>
          </div>
          <div className="flex justify-end gap-2 border-t bg-muted/20 px-5 py-3">
            <Button type="button" variant="ghost" onClick={onClose}>取消</Button>
            <Button type="submit" className="gap-1">
              <Save className="size-3.5" />
              {isNew ? '创建' : '保存'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ─────────────────────────── Admin: categories ─────────────────────────── */

export function AdminAnnounceCategoriesPage() {
  const data = useBootstrap().page.data as { categories: Category[] };
  const [editing, setEditing] = useState<Category | null>(null);
  const [creating, setCreating] = useState(false);

  return (
    <AdminPage
      title={(
        <div className="flex items-center gap-2">
          <Tag className="size-5 text-primary" />
          <h1 className="text-xl font-semibold">公告分类</h1>
        </div>
      )}
      requiredPriv={PRIV.PRIV_EDIT_SYSTEM}
      actions={(
        <Button onClick={() => setCreating(true)} className="gap-1">
          <Plus className="size-3.5" />
          新增分类
        </Button>
      )}
    >
      <Card>
        <CardContent className="p-0">
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
                    {c.builtin && <Badge variant="secondary" className="text-[10px]">内建</Badge>}
                  </TableCell>
                  <TableCell className="pr-5">
                    <TableActions>
                      <TableAction onClick={() => setEditing(c)} icon={Pencil}>编辑</TableAction>
                      {!c.builtin && (
                        <TableAction
                          formAction="/admin/announce/categories"
                          hidden={{ operation: 'delete', key: c.key }}
                          icon={Trash2} variant="destructive"
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
          onClose={() => { setEditing(null); setCreating(false); }}
        />
      )}
    </AdminPage>
  );
}

function CategoryEditorDialog({
  category, onClose,
}: { category: Category | null; onClose: () => void }) {
  const isNew = !category;
  const [key, setKey] = useState(category?.key || '');
  const [name, setName] = useState(category?.name || '');
  const [color, setColor] = useState(category?.color || 'gray');
  const [order, setOrder] = useState(category?.order || 100);
  const [hidden, setHidden] = useState(!!category?.hidden);

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="w-full sm:w-[480px]" onClose={onClose}>
        <DialogHeader><DialogTitle>{isNew ? '新增分类' : '编辑分类'}</DialogTitle></DialogHeader>
        <form method="post" action="/admin/announce/categories" className="flex flex-col">
          <input type="hidden" name="operation" value="upsert" />
          <div className="space-y-4 p-5">
            <FormRow columns={2}>
              <FormField label="Key" required htmlFor="cat-key">
                <Input id="cat-key" name="key" value={key} onChange={(e) => setKey(e.target.value)} disabled={!isNew} required />
              </FormField>
              <FormField label="显示名称" required htmlFor="cat-name">
                <Input id="cat-name" name="name" value={name} onChange={(e) => setName(e.target.value)} required />
              </FormField>
            </FormRow>
            <FormRow columns={2}>
              <FormField label="配色" htmlFor="cat-color">
                <select id="cat-color" name="color" value={color}
                  onChange={(e) => setColor(e.target.value)}
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm">
                  {['gray', 'amber', 'blue', 'purple', 'green', 'rose', 'sky'].map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </FormField>
              <FormField label="排序" htmlFor="cat-order">
                <Input id="cat-order" name="order" type="number" value={order}
                  onChange={(e) => setOrder(Number(e.target.value) || 100)} />
              </FormField>
            </FormRow>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="hidden" value="true"
                checked={hidden} onChange={(e) => setHidden(e.target.checked)}
                className="size-4 rounded border accent-primary" />
              隐藏（仍可用于已有公告，但不出现在新建下拉里）
            </label>
            <div className="rounded-md border bg-muted/30 p-3">
              <p className="mb-2 text-xs text-muted-foreground">预览：</p>
              <CategoryChip category={{ name: name || '示例', color }} size="md" />
            </div>
          </div>
          <div className="flex justify-end gap-2 border-t bg-muted/20 px-5 py-3">
            <Button type="button" variant="ghost" onClick={onClose}>取消</Button>
            <Button type="submit">保存</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
