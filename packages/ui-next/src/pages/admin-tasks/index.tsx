/**
 * /admin/tasks (admin-facing) — task management.
 *
 * Pages:
 *   - admin_tasks.html           → AdminTasksListPage
 *   - admin_tasks_edit.html      → AdminTasksEditPage (create + edit)
 *   - admin_tasks_assign.html    → AdminTasksAssignPage
 *   - admin_tasks_stats.html     → AdminTasksStatsPage
 *   - admin_tasks_scores.html    → AdminTasksScoresPage
 *   - admin_tasks_settings.html  → AdminTasksSettingsPage
 */
import { useMemo, useState } from 'react';
import {
  AlertCircle, ArrowLeft, ChevronRight, ClipboardList, Copy, FileDown, Flag,
  Layers, ListChecks, Loader2, Lock, Plus, Settings, Star, Tag, Trash2, Trophy,
  Users, X,
} from 'lucide-react';
import { useBootstrap } from '@/lib/bootstrap';
import { cn } from '@/lib/cn';
import { PRIV } from '@/lib/perms';
import { registerAdminNavSection } from '@/lib/admin-nav-registry';
import { AdminPage } from '@/components/admin/admin-page';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { FormField, FormRow, FormSection } from '@/components/ui/form';

// ─── Register admin nav ───────────────────────────────────────────────────

registerAdminNavSection({
  key: 'tasks',
  label: '任务系统',
  order: 35,
  requiredPriv: PRIV.PRIV_USER_PROFILE, // open to anyone with create-task perm; handler does fine-grained check
  items: [
    { key: 'tasks', label: '任务列表', href: '/admin/tasks', icon: ClipboardList, templateNames: ['admin_tasks.html', 'admin_tasks_edit.html', 'admin_tasks_assign.html', 'admin_tasks_stats.html'] },
    { key: 'scores', label: '比赛分数', href: '/admin/tasks/scores', icon: Trophy, templateNames: ['admin_tasks_scores.html'] },
    { key: 'settings', label: '系统设置', href: '/admin/tasks/settings', icon: Settings, templateNames: ['admin_tasks_settings.html'] },
  ],
});

// ─── Types ────────────────────────────────────────────────────────────────

interface TaskPoint {
  id: string;
  presetId: string;
  name: string;
  params: Record<string, any>;
}

interface TaskDoc {
  _id: string;
  domainId: string;
  title: string;
  description: string;
  tags: string[];
  points: TaskPoint[];
  condition: { type: 'all' } | { type: 'groups'; groups: { points: string[]; require: number }[] };
  access: { type: 'public' | 'user_group' | 'school'; targetId?: string };
  isActive: boolean;
  startDate: string | null;
  endDate: string | null;
  maxAssignments: number | null;
  currentAssignments: number;
  createdAt: string;
  createdBy: number;
}

interface PresetParam {
  name: string;
  label: string;
  type: string;
  required?: boolean;
  default?: any;
  options?: { value: string; label: string }[];
  helper?: string;
}

interface PresetSummary {
  id: string;
  name: string;
  description: string;
  params: PresetParam[];
}

interface SchoolRef { _id: string; name: string }
interface GroupRef { _id: string; schoolId: string; name: string }

// ─── Admin Tasks List ────────────────────────────────────────────────────

export function AdminTasksListPage() {
  const data = useBootstrap().page.data as {
    tasks: TaskDoc[];
    tagOptions: string[];
    canManage: boolean;
  };
  const [query, setQuery] = useState('');
  const [activeTag, setActiveTag] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data.tasks || []).filter((t) => {
      if (activeTag && !t.tags.includes(activeTag)) return false;
      if (q && !t.title.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [data.tasks, query, activeTag]);

  return (
    <AdminPage
      title="任务管理"
      description="创建并管理你的训练任务。任务点会根据用户的 OJ 提交、比赛参与情况自动判定。"
      actions={
        <div className="flex gap-2">
          <Button asChild variant="outline"><a href="/admin/tasks/scores"><Trophy className="mr-1 size-4" />比赛分数</a></Button>
          <Button asChild><a href="/admin/tasks/create"><Plus className="mr-1 size-4" />新建任务</a></Button>
        </div>
      }
    >
      <Card>
        <CardContent className="flex flex-wrap items-center gap-3">
          <Input placeholder="搜索任务标题…" value={query} onChange={(e) => setQuery(e.target.value)} className="max-w-sm" />
          {data.tagOptions?.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <Tag className="size-3.5 text-muted-foreground" />
              <button
                onClick={() => setActiveTag(null)}
                className={cn('rounded-md px-2 py-0.5 text-xs', activeTag === null ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/80')}
              >全部</button>
              {data.tagOptions.map((t) => (
                <button
                  key={t}
                  onClick={() => setActiveTag(t === activeTag ? null : t)}
                  className={cn('rounded-md px-2 py-0.5 text-xs', activeTag === t ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/80')}
                >{t}</button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>任务</TableHead>
                <TableHead>标签</TableHead>
                <TableHead>任务点</TableHead>
                <TableHead>认领</TableHead>
                <TableHead>状态</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-12 text-center text-sm text-muted-foreground">
                    {data.tasks.length === 0 ? '还没有任务，点击右上角"新建任务"开始创建' : '没有匹配的任务'}
                  </TableCell>
                </TableRow>
              ) : filtered.map((task) => (
                <TableRow key={task._id}>
                  <TableCell>
                    <div className="space-y-0.5">
                      <a href={`/admin/tasks/${task._id}/edit`} className="font-medium hover:underline">{task.title}</a>
                      <p className="line-clamp-1 text-xs text-muted-foreground">{task.description || '暂无描述'}</p>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {task.tags.map((t) => <Badge key={t} variant="secondary" className="text-[10px]">{t}</Badge>)}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="gap-1 text-[10px]"><Flag className="size-3" />{task.points.length}</Badge>
                    {task.condition.type === 'groups' && <Badge variant="outline" className="ml-1 text-[10px]">分组</Badge>}
                  </TableCell>
                  <TableCell className="text-xs">
                    {task.currentAssignments}
                    {task.maxAssignments && <span className="text-muted-foreground"> / {task.maxAssignments}</span>}
                  </TableCell>
                  <TableCell>
                    {task.isActive ? (
                      <Badge className="bg-emerald-500 text-white hover:bg-emerald-500/90">启用</Badge>
                    ) : <Badge variant="outline">停用</Badge>}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button asChild size="sm" variant="ghost"><a href={`/admin/tasks/${task._id}/stats`}>统计</a></Button>
                      <Button asChild size="sm" variant="ghost"><a href={`/admin/tasks/${task._id}/assign`}>分配</a></Button>
                      <Button asChild size="sm" variant="ghost"><a href={`/admin/tasks/${task._id}/edit`}>编辑</a></Button>
                      <form method="post" action="/admin/tasks" className="inline-block">
                        <input type="hidden" name="operation" value="clone" />
                        <input type="hidden" name="tid" value={task._id} />
                        <Button type="submit" size="sm" variant="ghost" title="复制"><Copy className="size-4" /></Button>
                      </form>
                      <form method="post" action="/admin/tasks" className="inline-block"
                        onSubmit={(e) => { if (!confirm(`确定删除任务"${task.title}"？这将一并删除所有用户的分配记录。`)) e.preventDefault(); }}
                      >
                        <input type="hidden" name="operation" value="delete" />
                        <input type="hidden" name="tid" value={task._id} />
                        <Button type="submit" size="sm" variant="ghost" className="text-destructive"><Trash2 className="size-4" /></Button>
                      </form>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </AdminPage>
  );
}

// ─── Admin Tasks Edit ─────────────────────────────────────────────────────

export function AdminTasksEditPage() {
  const data = useBootstrap().page.data as {
    task: TaskDoc | null;
    isEdit: boolean;
    presets: PresetSummary[];
    schools: SchoolRef[];
    userGroups: GroupRef[];
  };
  const initial = data.task;
  const [title, setTitle] = useState(initial?.title || '');
  const [description, setDescription] = useState(initial?.description || '');
  const [tagsCsv, setTagsCsv] = useState((initial?.tags || []).join(', '));
  const [isActive, setIsActive] = useState(initial?.isActive ?? true);
  const [startDate, setStartDate] = useState(initial?.startDate?.slice(0, 10) || '');
  const [endDate, setEndDate] = useState(initial?.endDate?.slice(0, 10) || '');
  const [maxAssignments, setMaxAssignments] = useState(initial?.maxAssignments?.toString() || '');
  const [accessType, setAccessType] = useState<'public' | 'user_group' | 'school'>(initial?.access.type || 'public');
  const [accessTargetId, setAccessTargetId] = useState(initial?.access.targetId || '');
  const [conditionType, setConditionType] = useState<'all' | 'groups'>(initial?.condition.type || 'all');
  const [groups, setGroups] = useState<{ points: string[]; require: number }[]>(
    initial?.condition.type === 'groups' ? initial.condition.groups : [],
  );
  const [points, setPoints] = useState<TaskPoint[]>(initial?.points || []);
  const [showPresetPicker, setShowPresetPicker] = useState(false);

  const presetMap = useMemo(() => Object.fromEntries(data.presets.map((p) => [p.id, p])), [data.presets]);

  function addPoint(preset: PresetSummary) {
    const id = `p_${Math.random().toString(36).slice(2, 10)}`;
    const params: Record<string, any> = {};
    for (const p of preset.params) {
      if (p.default !== undefined) params[p.name] = p.default;
    }
    setPoints([...points, { id, presetId: preset.id, name: preset.name, params }]);
    setShowPresetPicker(false);
  }
  function removePoint(i: number) {
    const removed = points[i];
    setPoints(points.filter((_, j) => j !== i));
    setGroups(groups.map((g) => ({ ...g, points: g.points.filter((p) => p !== removed.id) })));
  }
  function updatePoint(i: number, patch: Partial<TaskPoint>) {
    setPoints(points.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  }
  function updatePointParam(i: number, name: string, value: any) {
    updatePoint(i, { params: { ...points[i].params, [name]: value } });
  }

  return (
    <AdminPage
      title={data.isEdit ? '编辑任务' : '新建任务'}
      actions={<Button asChild variant="outline"><a href="/admin/tasks"><ArrowLeft className="mr-1 size-4" />返回列表</a></Button>}
    >
      <form method="post" className="space-y-6">
        <input type="hidden" name="points" value={JSON.stringify(points)} />
        <input type="hidden" name="condition" value={JSON.stringify(
          conditionType === 'all'
            ? { type: 'all' }
            : { type: 'groups', groups: groups.map((g) => ({ points: g.points, require: g.require })) },
        )} />
        <input type="hidden" name="access" value={JSON.stringify(
          accessType === 'public'
            ? { type: 'public' }
            : { type: accessType, targetId: accessTargetId },
        )} />
        <input type="hidden" name="isActive" value={isActive ? 'true' : 'false'} />

        <Card>
          <CardHeader><CardTitle className="text-sm">基本信息</CardTitle></CardHeader>
          <CardContent>
            <FormSection>
              <FormField label="任务名称" required>
                <Input name="title" value={title} onChange={(e) => setTitle(e.target.value)} required placeholder="例如：ICPC 2026 区域赛参赛资格" />
              </FormField>
              <FormField label="任务描述" hint="支持纯文本">
                <textarea
                  name="description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="min-h-[80px] w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  placeholder="说明这个任务的目的、奖励等"
                />
              </FormField>
              <FormRow columns={2}>
                <FormField label="标签" hint="逗号分隔，便于筛选">
                  <Input name="tags" value={tagsCsv} onChange={(e) => setTagsCsv(e.target.value)} placeholder="例如：ICPC, 2026, 资格审核" />
                </FormField>
                <FormField label="状态">
                  <label className="flex items-center gap-2 pt-2 text-sm">
                    <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
                    启用（用户可见可认领）
                  </label>
                </FormField>
              </FormRow>
              <FormRow columns={3}>
                <FormField label="开始日期">
                  <Input type="date" name="startDate" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                </FormField>
                <FormField label="结束日期">
                  <Input type="date" name="endDate" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
                </FormField>
                <FormField label="最大认领数" hint="留空=不限">
                  <Input type="number" min={1} name="maxAssignments" value={maxAssignments} onChange={(e) => setMaxAssignments(e.target.value)} />
                </FormField>
              </FormRow>
            </FormSection>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-sm">可见范围</CardTitle></CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {(['public', 'user_group', 'school'] as const).map((t) => (
                <button
                  type="button"
                  key={t}
                  onClick={() => { setAccessType(t); if (t === 'public') setAccessTargetId(''); }}
                  className={cn(
                    'rounded-md border px-3 py-1.5 text-sm',
                    accessType === t ? 'border-primary bg-primary text-primary-foreground' : 'bg-background hover:bg-muted',
                  )}
                >
                  {t === 'public' ? '所有人' : t === 'school' ? '限定学校' : '限定用户组'}
                </button>
              ))}
            </div>
            {accessType === 'school' && (
              <FormField label="选择学校" className="mt-3">
                <select
                  value={accessTargetId}
                  onChange={(e) => setAccessTargetId(e.target.value)}
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                  required
                >
                  <option value="">— 选择 —</option>
                  {data.schools.map((s) => (<option key={s._id} value={s._id}>{s.name}</option>))}
                </select>
              </FormField>
            )}
            {accessType === 'user_group' && (
              <FormField label="选择用户组" className="mt-3">
                <select
                  value={accessTargetId}
                  onChange={(e) => setAccessTargetId(e.target.value)}
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                  required
                >
                  <option value="">— 选择 —</option>
                  {data.userGroups.map((g) => {
                    const s = data.schools.find((s2) => s2._id === g.schoolId);
                    return (<option key={g._id} value={g._id}>{s ? `${s.name} / ` : ''}{g.name}</option>);
                  })}
                </select>
              </FormField>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm">任务点 ({points.length})</CardTitle>
              <Button type="button" size="sm" variant="outline" onClick={() => setShowPresetPicker(true)}>
                <Plus className="mr-1 size-4" />添加任务点
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {points.length === 0 ? (
              <div className="rounded-md border border-dashed py-8 text-center text-sm text-muted-foreground">
                <Flag className="mx-auto size-8 text-muted-foreground/40" />
                <p className="mt-2">点击"添加任务点"开始构建任务</p>
              </div>
            ) : (
              <div className="space-y-3">
                {points.map((point, i) => {
                  const preset = presetMap[point.presetId];
                  return (
                    <Card key={point.id} className="bg-muted/30">
                      <CardContent className="space-y-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1">
                            <Input
                              value={point.name}
                              onChange={(e) => updatePoint(i, { name: e.target.value })}
                              className="font-medium"
                            />
                            {preset && <p className="mt-1 text-xs text-muted-foreground">{preset.description}</p>}
                          </div>
                          <Button type="button" size="sm" variant="ghost" onClick={() => removePoint(i)}>
                            <X className="size-4" />
                          </Button>
                        </div>
                        {preset?.params && preset.params.length > 0 && (
                          <div className="grid gap-3 sm:grid-cols-2">
                            {preset.params.map((p) => (
                              <ParamInput
                                key={p.name}
                                spec={p}
                                value={point.params[p.name] ?? ''}
                                onChange={(v) => updatePointParam(i, p.name, v)}
                              />
                            ))}
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-sm">完成条件</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setConditionType('all')}
                className={cn(
                  'rounded-md border px-3 py-1.5 text-sm',
                  conditionType === 'all' ? 'border-primary bg-primary text-primary-foreground' : 'bg-background hover:bg-muted',
                )}
              >满足全部任务点</button>
              <button
                type="button"
                onClick={() => setConditionType('groups')}
                className={cn(
                  'rounded-md border px-3 py-1.5 text-sm',
                  conditionType === 'groups' ? 'border-primary bg-primary text-primary-foreground' : 'bg-background hover:bg-muted',
                )}
              >分组条件</button>
            </div>
            {conditionType === 'groups' && (
              <div className="space-y-3">
                {groups.map((g, i) => (
                  <Card key={i} className="bg-muted/30">
                    <CardContent className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium">分组 {i + 1}</span>
                        <Button type="button" size="sm" variant="ghost" onClick={() => setGroups(groups.filter((_, j) => j !== i))}>
                          <X className="size-4" />
                        </Button>
                      </div>
                      <FormRow columns={2}>
                        <FormField label="至少完成（个）">
                          <Input
                            type="number"
                            min={1}
                            value={g.require}
                            onChange={(e) => setGroups(groups.map((gg, j) => (j === i ? { ...gg, require: +e.target.value || 1 } : gg)))}
                          />
                        </FormField>
                      </FormRow>
                      <div className="space-y-1.5 text-sm">
                        <label className="text-xs text-muted-foreground">勾选属于此组的任务点：</label>
                        <div className="space-y-1">
                          {points.map((p) => (
                            <label key={p.id} className="flex items-center gap-2">
                              <input
                                type="checkbox"
                                checked={g.points.includes(p.id)}
                                onChange={(e) => {
                                  const newPoints = e.target.checked
                                    ? [...g.points, p.id]
                                    : g.points.filter((pp) => pp !== p.id);
                                  setGroups(groups.map((gg, j) => (j === i ? { ...gg, points: newPoints } : gg)));
                                }}
                              />
                              {p.name}
                            </label>
                          ))}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
                <Button
                  type="button" size="sm" variant="outline"
                  onClick={() => setGroups([...groups, { points: [], require: 1 }])}
                >
                  <Plus className="mr-1 size-4" />添加分组
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="flex justify-end gap-2">
          <Button asChild variant="outline"><a href="/admin/tasks">取消</a></Button>
          <Button type="submit"><ListChecks className="mr-1 size-4" />{data.isEdit ? '保存' : '创建'}</Button>
        </div>
      </form>

      {showPresetPicker && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setShowPresetPicker(false)}>
          <div className="max-h-[80vh] w-full max-w-3xl overflow-y-auto rounded-lg border bg-card shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="sticky top-0 flex items-center justify-between border-b bg-card px-5 py-3">
              <h3 className="font-semibold">选择任务点类型</h3>
              <Button size="sm" variant="ghost" onClick={() => setShowPresetPicker(false)}><X className="size-4" /></Button>
            </div>
            <div className="grid gap-2 p-5">
              {data.presets.map((p) => (
                <button
                  type="button"
                  key={p.id}
                  onClick={() => addPoint(p)}
                  className="rounded-md border bg-background p-3 text-left hover:border-primary hover:bg-accent"
                >
                  <div className="font-medium">{p.name}</div>
                  <div className="text-xs text-muted-foreground">{p.description}</div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </AdminPage>
  );
}

function ParamInput({ spec, value, onChange }: { spec: PresetParam; value: any; onChange: (v: any) => void }) {
  if (spec.type === 'select' || spec.type === 'pat_level' || spec.type === 'pat_season' || spec.type === 'gplt_level') {
    return (
      <FormField label={spec.label} hint={spec.helper} required={spec.required}>
        <select
          value={value || ''}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded-md border bg-background px-3 py-2 text-sm"
        >
          <option value="">—</option>
          {spec.options?.map((o) => (<option key={o.value} value={o.value}>{o.label}</option>))}
        </select>
      </FormField>
    );
  }
  if (spec.type === 'date') {
    return (
      <FormField label={spec.label} hint={spec.helper} required={spec.required}>
        <Input type="date" value={value || ''} onChange={(e) => onChange(e.target.value)} />
      </FormField>
    );
  }
  return (
    <FormField label={spec.label} hint={spec.helper || (spec.type === 'problem' ? '填入题目 ID' : spec.type === 'contest' ? '填入比赛 ObjectId' : spec.type === 'user_group' ? '填入用户组 ObjectId' : '')} required={spec.required}>
      <Input
        type={spec.type === 'number' ? 'number' : 'text'}
        value={value || ''}
        onChange={(e) => onChange(spec.type === 'number' ? +e.target.value : e.target.value)}
        placeholder={spec.default !== undefined ? String(spec.default) : ''}
      />
    </FormField>
  );
}

// ─── Admin Tasks Assign ──────────────────────────────────────────────────

interface AssignmentEntry {
  _id: string; userId: number; status: string; canCancel: boolean;
  assignedAt: string; note: string; progress: Record<string, any>;
}

export function AdminTasksAssignPage() {
  const data = useBootstrap().page.data as {
    task: TaskDoc;
    assignments: AssignmentEntry[];
    udict: Record<string, { _id: number; uname: string }>;
    schools: SchoolRef[];
    userGroups: GroupRef[];
  };

  const [scope, setScope] = useState<'uid' | 'user_group' | 'school'>('uid');
  const [uid, setUid] = useState('');
  const [targetId, setTargetId] = useState('');
  const [note, setNote] = useState('');

  return (
    <AdminPage
      title={`分配 — ${data.task.title}`}
      actions={<Button asChild variant="outline"><a href="/admin/tasks"><ArrowLeft className="mr-1 size-4" />返回列表</a></Button>}
    >
      <Card>
        <CardHeader><CardTitle className="text-sm">分配任务</CardTitle></CardHeader>
        <CardContent>
          <form method="post" className="space-y-3">
            <input type="hidden" name="operation" value="batch" />
            <input type="hidden" name="scope" value={scope} />
            <div className="flex gap-2">
              {(['uid', 'user_group', 'school'] as const).map((s) => (
                <button
                  type="button"
                  key={s}
                  onClick={() => setScope(s)}
                  className={cn('rounded-md border px-3 py-1.5 text-sm', scope === s ? 'border-primary bg-primary text-primary-foreground' : 'bg-background hover:bg-muted')}
                >
                  {s === 'uid' ? '单个用户' : s === 'user_group' ? '整个用户组' : '整个学校'}
                </button>
              ))}
            </div>
            {scope === 'uid' && (
              <FormField label="用户 UID" required>
                <Input name="uid" type="number" min={1} value={uid} onChange={(e) => setUid(e.target.value)} required />
              </FormField>
            )}
            {scope === 'user_group' && (
              <FormField label="用户组" required>
                <select name="targetId" value={targetId} onChange={(e) => setTargetId(e.target.value)} required className="w-full rounded-md border bg-background px-3 py-2 text-sm">
                  <option value="">— 选择 —</option>
                  {data.userGroups.map((g) => {
                    const s = data.schools.find((s2) => s2._id === g.schoolId);
                    return (<option key={g._id} value={g._id}>{s ? `${s.name} / ` : ''}{g.name}</option>);
                  })}
                </select>
              </FormField>
            )}
            {scope === 'school' && (
              <FormField label="学校" required>
                <select name="targetId" value={targetId} onChange={(e) => setTargetId(e.target.value)} required className="w-full rounded-md border bg-background px-3 py-2 text-sm">
                  <option value="">— 选择 —</option>
                  {data.schools.map((s) => (<option key={s._id} value={s._id}>{s.name}</option>))}
                </select>
              </FormField>
            )}
            <FormField label="备注" hint="可选 — 会显示给被分配的用户">
              <Input name="note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="例如：你们班今年的必做任务" />
            </FormField>
            <Button type="submit"><Users className="mr-1 size-4" />分配</Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">已分配 ({data.assignments.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {data.assignments.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">还没有分配记录</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>用户</TableHead>
                  <TableHead>来源</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>分配时间</TableHead>
                  <TableHead>备注</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.assignments.map((a) => {
                  const u = data.udict[a.userId];
                  return (
                    <TableRow key={a._id}>
                      <TableCell>{u?.uname || `uid:${a.userId}`}</TableCell>
                      <TableCell>{a.canCancel ? '自主认领' : '管理员分配'}</TableCell>
                      <TableCell>
                        {a.status === 'completed' ? <Badge className="bg-emerald-500 text-white">已完成</Badge>
                          : a.status === 'cancelled' ? <Badge variant="outline">已取消</Badge>
                          : <Badge className="bg-sky-500 text-white">进行中</Badge>}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{new Date(a.assignedAt).toLocaleString()}</TableCell>
                      <TableCell className="text-xs">{a.note || '—'}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </AdminPage>
  );
}

// ─── Admin Tasks Stats ───────────────────────────────────────────────────

interface AuditEntry {
  _id: string; assignmentId: string; pointId: string; adminUid: number;
  before: any; after: any; reason: string; createdAt: string;
}

export function AdminTasksStatsPage() {
  const data = useBootstrap().page.data as {
    task: TaskDoc;
    assignments: AssignmentEntry[];
    udict: Record<string, { _id: number; uname: string }>;
    audit: AuditEntry[];
    presets: PresetSummary[];
  };
  const total = data.assignments.length;
  const completed = data.assignments.filter((a) => a.status === 'completed').length;

  return (
    <AdminPage
      title={`统计 — ${data.task.title}`}
      actions={
        <div className="flex gap-2">
          <Button asChild variant="outline"><a href={`/admin/tasks/${data.task._id}/stats?format=csv`}><FileDown className="mr-1 size-4" />导出 CSV</a></Button>
          <Button asChild variant="outline"><a href="/admin/tasks"><ArrowLeft className="mr-1 size-4" />返回列表</a></Button>
        </div>
      }
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <Card><CardContent>
          <p className="text-xs text-muted-foreground">总分配</p>
          <p className="mt-1 text-2xl font-semibold">{total}</p>
        </CardContent></Card>
        <Card><CardContent>
          <p className="text-xs text-muted-foreground">已完成</p>
          <p className="mt-1 text-2xl font-semibold">{completed}</p>
        </CardContent></Card>
        <Card><CardContent>
          <p className="text-xs text-muted-foreground">完成率</p>
          <p className="mt-1 text-2xl font-semibold">{total > 0 ? Math.round((completed / total) * 100) : 0}%</p>
        </CardContent></Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-sm">用户进度</CardTitle></CardHeader>
        <CardContent className="p-0">
          {data.assignments.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">还没有人认领此任务</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>用户</TableHead>
                  <TableHead>完成进度</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>完成时间</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.assignments.map((a) => {
                  const u = data.udict[a.userId];
                  const done = data.task.points.filter((p) => a.progress?.[p.id]?.completed).length;
                  return (
                    <TableRow key={a._id}>
                      <TableCell>{u?.uname || `uid:${a.userId}`}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 w-24 overflow-hidden rounded-full bg-muted">
                            <div className={cn('h-full', a.status === 'completed' ? 'bg-emerald-500' : 'bg-sky-500')}
                              style={{ width: `${(done / data.task.points.length) * 100}%` }} />
                          </div>
                          <span className="text-xs text-muted-foreground">{done}/{data.task.points.length}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        {a.status === 'completed' ? <Badge className="bg-emerald-500 text-white">完成</Badge>
                          : a.status === 'cancelled' ? <Badge variant="outline">取消</Badge>
                          : <Badge className="bg-sky-500 text-white">进行中</Badge>}
                      </TableCell>
                      <TableCell className="text-xs">{(a as any).completedAt ? new Date((a as any).completedAt).toLocaleDateString() : '—'}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {data.audit.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-sm">审计日志（管理员覆盖记录）</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {data.audit.map((row) => (
              <div key={row._id} className="rounded-md border p-2 text-xs">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-[10px]">{row.pointId}</Badge>
                  <span>{row.after?.completed ? '判定完成' : '撤销完成'}</span>
                  <span className="ml-auto text-muted-foreground">{new Date(row.createdAt).toLocaleString()}</span>
                </div>
                {row.reason && <p className="mt-1 text-muted-foreground">原因：{row.reason}</p>}
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </AdminPage>
  );
}

// ─── Admin Tasks Scores ──────────────────────────────────────────────────

interface PatScore { _id: string; userId: number; level: string; year: number; season: string; score: number; createdAt: string }
interface GpltScore { _id: string; userId: number; level: string; year: number; score: number; rank: number | null; createdAt: string }
interface CspScore { _id: string; userId: number; round: number; score: number; createdAt: string }

interface DomainSettings {
  maxPatScore: number; maxGpltScore: number; maxCspScore: number;
}

export function AdminTasksScoresPage() {
  const data = useBootstrap().page.data as {
    tab: 'pat' | 'gplt' | 'csp';
    scores: any[];
    udict: Record<string, { _id: number; uname: string }>;
    settings: DomainSettings;
    level: string;
    year: number;
  };
  const tabs = [
    { key: 'pat', label: 'PAT 认证' },
    { key: 'gplt', label: '天梯赛' },
    { key: 'csp', label: 'CSP 认证' },
  ];

  return (
    <AdminPage
      title="比赛分数管理"
      description="录入 PAT / GPLT / CSP 等外部比赛成绩 — 这些分数会被任务点用作完成判定的输入。"
    >
      <div className="flex gap-2">
        {tabs.map((t) => (
          <a
            key={t.key}
            href={`/admin/tasks/scores?tab=${t.key}`}
            className={cn(
              'rounded-md border px-4 py-1.5 text-sm transition-colors',
              data.tab === t.key ? 'border-primary bg-primary text-primary-foreground' : 'bg-background hover:bg-muted',
            )}
          >{t.label}</a>
        ))}
      </div>

      {data.tab === 'pat' && <PatScoreTab scores={data.scores} udict={data.udict} settings={data.settings} />}
      {data.tab === 'gplt' && <GpltScoreTab scores={data.scores} udict={data.udict} settings={data.settings} />}
      {data.tab === 'csp' && <CspScoreTab scores={data.scores} udict={data.udict} settings={data.settings} />}
    </AdminPage>
  );
}

function PatScoreTab({ scores, udict, settings }: { scores: PatScore[]; udict: any; settings: DomainSettings }) {
  return (
    <>
      <Card>
        <CardHeader><CardTitle className="text-sm">添加 / 更新 PAT 成绩</CardTitle></CardHeader>
        <CardContent>
          <form method="post" action="/admin/tasks/scores?tab=pat" className="space-y-3">
            <input type="hidden" name="operation" value="pat" />
            <FormRow columns={4}>
              <FormField label="用户 UID" required>
                <Input name="userId" type="number" min={1} required />
              </FormField>
              <FormField label="等级" required>
                <select name="level" required className="w-full rounded-md border bg-background px-3 py-2 text-sm">
                  <option value="advanced">甲级</option>
                  <option value="basic">乙级</option>
                </select>
              </FormField>
              <FormField label="年份" required>
                <Input name="year" type="number" min={2010} max={2100} defaultValue={new Date().getFullYear()} required />
              </FormField>
              <FormField label="季节" required>
                <select name="season" required className="w-full rounded-md border bg-background px-3 py-2 text-sm">
                  <option value="spring">春季</option>
                  <option value="summer">夏季</option>
                  <option value="autumn">秋季</option>
                  <option value="winter">冬季</option>
                </select>
              </FormField>
            </FormRow>
            <FormRow columns={4}>
              <FormField label={`分数 (0-${settings.maxPatScore})`} required>
                <Input name="score" type="number" min={0} max={settings.maxPatScore} step={1} required />
              </FormField>
            </FormRow>
            <Button type="submit"><Plus className="mr-1 size-4" />保存</Button>
          </form>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-sm">已录入成绩 ({scores.length})</CardTitle></CardHeader>
        <CardContent className="p-0">
          {scores.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">还没有 PAT 成绩</p>
          ) : (
            <Table>
              <TableHeader><TableRow>
                <TableHead>用户</TableHead><TableHead>等级</TableHead><TableHead>年份</TableHead>
                <TableHead>季节</TableHead><TableHead>分数</TableHead><TableHead>录入时间</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {scores.map((s) => (
                  <TableRow key={s._id}>
                    <TableCell>{udict[s.userId]?.uname || `uid:${s.userId}`}</TableCell>
                    <TableCell>{s.level === 'advanced' ? '甲级' : '乙级'}</TableCell>
                    <TableCell>{s.year}</TableCell>
                    <TableCell>{{ spring: '春', summer: '夏', autumn: '秋', winter: '冬' }[s.season] || s.season}</TableCell>
                    <TableCell className="font-medium">{s.score}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{new Date(s.createdAt).toLocaleDateString()}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </>
  );
}

function GpltScoreTab({ scores, udict, settings }: { scores: GpltScore[]; udict: any; settings: DomainSettings }) {
  return (
    <>
      <Card>
        <CardHeader><CardTitle className="text-sm">添加 / 更新天梯赛成绩</CardTitle></CardHeader>
        <CardContent>
          <form method="post" action="/admin/tasks/scores?tab=gplt" className="space-y-3">
            <input type="hidden" name="operation" value="gplt" />
            <FormRow columns={4}>
              <FormField label="用户 UID" required><Input name="userId" type="number" min={1} required /></FormField>
              <FormField label="比赛级别" required>
                <select name="level" required className="w-full rounded-md border bg-background px-3 py-2 text-sm">
                  <option value="school">校赛</option>
                  <option value="national">国赛</option>
                </select>
              </FormField>
              <FormField label="年份" required><Input name="year" type="number" min={2010} max={2100} defaultValue={new Date().getFullYear()} required /></FormField>
              <FormField label={`分数 (0-${settings.maxGpltScore})`} required>
                <Input name="score" type="number" min={0} max={settings.maxGpltScore} step={1} required />
              </FormField>
            </FormRow>
            <FormField label="排名（可选）"><Input name="rank" type="number" min={1} /></FormField>
            <Button type="submit"><Plus className="mr-1 size-4" />保存</Button>
          </form>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-sm">已录入成绩 ({scores.length})</CardTitle></CardHeader>
        <CardContent className="p-0">
          {scores.length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">还没有天梯赛成绩</p> : (
            <Table>
              <TableHeader><TableRow>
                <TableHead>用户</TableHead><TableHead>级别</TableHead><TableHead>年份</TableHead>
                <TableHead>分数</TableHead><TableHead>排名</TableHead><TableHead>录入时间</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {scores.map((s) => (
                  <TableRow key={s._id}>
                    <TableCell>{udict[s.userId]?.uname || `uid:${s.userId}`}</TableCell>
                    <TableCell>{s.level === 'school' ? '校赛' : '国赛'}</TableCell>
                    <TableCell>{s.year}</TableCell>
                    <TableCell className="font-medium">{s.score}</TableCell>
                    <TableCell>{s.rank || '—'}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{new Date(s.createdAt).toLocaleDateString()}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </>
  );
}

function CspScoreTab({ scores, udict, settings }: { scores: CspScore[]; udict: any; settings: DomainSettings }) {
  return (
    <>
      <Card>
        <CardHeader><CardTitle className="text-sm">添加 / 更新 CSP 成绩</CardTitle></CardHeader>
        <CardContent>
          <form method="post" action="/admin/tasks/scores?tab=csp" className="space-y-3">
            <input type="hidden" name="operation" value="csp" />
            <FormRow columns={3}>
              <FormField label="用户 UID" required><Input name="userId" type="number" min={1} required /></FormField>
              <FormField label="认证次数（第几次）" required><Input name="round" type="number" min={1} max={100} required placeholder="例如 37" /></FormField>
              <FormField label={`分数 (0-${settings.maxCspScore})`} required>
                <Input name="score" type="number" min={0} max={settings.maxCspScore} step={1} required />
              </FormField>
            </FormRow>
            <Button type="submit"><Plus className="mr-1 size-4" />保存</Button>
          </form>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-sm">已录入成绩 ({scores.length})</CardTitle></CardHeader>
        <CardContent className="p-0">
          {scores.length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">还没有 CSP 成绩</p> : (
            <Table>
              <TableHeader><TableRow>
                <TableHead>用户</TableHead><TableHead>次数</TableHead><TableHead>分数</TableHead><TableHead>录入时间</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {scores.map((s) => (
                  <TableRow key={s._id}>
                    <TableCell>{udict[s.userId]?.uname || `uid:${s.userId}`}</TableCell>
                    <TableCell>第 {s.round} 次</TableCell>
                    <TableCell className="font-medium">{s.score}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{new Date(s.createdAt).toLocaleDateString()}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </>
  );
}

// ─── Admin Tasks Settings ────────────────────────────────────────────────

export function AdminTasksSettingsPage() {
  const data = useBootstrap().page.data as { settings: DomainSettings };
  return (
    <AdminPage
      title="任务系统设置"
      description="配置 PAT / GPLT / CSP 分数录入的上限。这些上限会被任务点的 minScore 校验时强制约束。"
    >
      <Card>
        <CardHeader><CardTitle className="text-sm">分数上限</CardTitle></CardHeader>
        <CardContent>
          <form method="post" className="space-y-3">
            <FormRow columns={3}>
              <FormField label="PAT 分数上限" hint="默认 100">
                <Input name="maxPatScore" type="number" min={0} defaultValue={data.settings.maxPatScore} />
              </FormField>
              <FormField label="天梯赛分数上限" hint="默认 290">
                <Input name="maxGpltScore" type="number" min={0} defaultValue={data.settings.maxGpltScore} />
              </FormField>
              <FormField label="CSP 分数上限" hint="默认 500">
                <Input name="maxCspScore" type="number" min={0} defaultValue={data.settings.maxCspScore} />
              </FormField>
            </FormRow>
            <Button type="submit"><Settings className="mr-1 size-4" />保存设置</Button>
          </form>
        </CardContent>
      </Card>
    </AdminPage>
  );
}
