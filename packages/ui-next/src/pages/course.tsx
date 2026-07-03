/**
 * 课程模块（PLAN 2026-07-02 §10）——列表 / 详情 / 线性章节编辑器。
 * 课程与训练共用后端 docType 40（kind='course'），复用报名 / 进度跟踪。
 * 章节是线性目录（无 DAG 先修）；每章含题目 + 引用的比赛（引用制）。
 */
import { useState } from 'react';
import {
  ArrowLeft, BookMarked, ChevronDown, ChevronRight, GraduationCap, Plus, Save, Trophy, Users, X,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { MarkdownEditor, MarkdownView } from '@/components/markdown-renderer';
import { ProblemPicker } from '@/components/problem-picker';
import { Checkbox } from '@/components/ui/checkbox';
import { useBootstrap } from '@/lib/bootstrap';
import { formatPlainTextSummary } from '@/lib/format';

type R = Record<string, any>;

/* ─────────────────────────── 列表 ─────────────────────────── */

export function CoursePage() {
  const bs = useBootstrap();
  const data = bs.page.data as {
    tdocs: R[]; tsdict: Record<string, R>; canManage: boolean; q?: string;
  };
  const tdocs = data.tdocs || [];

  return (
    <div className="space-y-5">
      <header className="flex items-center gap-2">
        <GraduationCap className="size-5 text-primary" />
        <h1 className="text-xl font-semibold">课程</h1>
        <span className="ml-2 text-xs text-muted-foreground">共 {tdocs.length} 门</span>
        {data.canManage ? (
          <Button asChild size="sm" className="ml-auto gap-1">
            <a href="/course/create"><Plus className="size-3.5" />新建课程</a>
          </Button>
        ) : null}
      </header>

      {tdocs.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center text-sm text-muted-foreground">
            {data.canManage ? '还没有课程，点击右上角新建。' : '暂无对你开放的课程。'}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {tdocs.map((t) => {
            const tid = String(t.docId || t._id);
            const ts = data.tsdict[tid];
            const chapterCount = (t.dag || []).length;
            return (
              <Card key={tid} className="transition-colors hover:border-primary/40">
                <CardContent className="space-y-2.5 p-5">
                  <a href={`/course/${tid}`} className="block">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="text-sm font-semibold hover:text-primary">{t.title}</h3>
                      <BookMarked className="size-4 shrink-0 text-muted-foreground" />
                    </div>
                    {t.description || t.content ? (
                      <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                        {formatPlainTextSummary(t.description || t.content).slice(0, 100)}
                      </p>
                    ) : null}
                  </a>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge variant="secondary" className="text-[10px]">{chapterCount} 章</Badge>
                    {t.term ? <Badge variant="outline" className="text-[10px]">{t.term}</Badge> : null}
                    {(t.courseGroupIds || []).length > 0 ? (
                      <Badge variant="outline" className="gap-1 text-[10px]"><Users className="size-2.5" />限选</Badge>
                    ) : null}
                    {ts?.enroll ? <Badge className="bg-green-600/15 text-[10px] text-green-700 dark:text-green-400">已报名</Badge> : null}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────── 详情 ─────────────────────────── */

export function CourseDetailPage() {
  const bs = useBootstrap();
  const data = bs.page.data as {
    tdoc: R; chapters: R[]; pdict: Record<string, R>; cdict: Record<string, R>;
    udoc: R; canManage: boolean; tsdoc?: R;
  };
  const tdoc = data.tdoc || {};
  const tid = String(tdoc.docId || tdoc._id);
  const chapters = data.chapters || [];
  const [open, setOpen] = useState<Set<number>>(new Set(chapters.map((c) => c._id)));

  const toggle = (id: number) => setOpen((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="icon"><a href="/course"><ArrowLeft className="size-4" /></a></Button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-semibold">{tdoc.title}</h1>
          <p className="text-xs text-muted-foreground">
            {data.udoc?.uname ? `${data.udoc.uname} · ` : ''}{chapters.length} 章
            {tdoc.term ? ` · ${tdoc.term}` : ''}
          </p>
        </div>
        {data.canManage ? (
          <Button asChild variant="outline" size="sm"><a href={`/course/${tid}/edit`}>编辑课程</a></Button>
        ) : null}
        {!data.tsdoc?.enroll ? (
          <form method="post" action={`/course/${tid}`}>
            <input type="hidden" name="operation" value="enroll" />
            <Button type="submit" size="sm">报名</Button>
          </form>
        ) : null}
      </div>

      {tdoc.content ? (
        <Card><CardContent className="p-5"><MarkdownView content={tdoc.content} preferredLang={bs.locale} /></CardContent></Card>
      ) : null}

      <div className="space-y-3">
        {chapters.map((ch, idx) => {
          const isOpen = open.has(ch._id);
          return (
            <Card key={ch._id}>
              <CardHeader className="cursor-pointer py-3" onClick={() => toggle(ch._id)}>
                <CardTitle className="flex items-center gap-2 text-sm">
                  {isOpen ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                  <span className="text-muted-foreground">第 {idx + 1} 章</span>
                  {ch.title}
                  <span className="ml-auto flex items-center gap-2 text-xs font-normal text-muted-foreground">
                    <span>{ch.doneCount}/{ch.totalCount} 题</span>
                    <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full bg-primary" style={{ width: `${ch.progress}%` }} />
                    </div>
                  </span>
                </CardTitle>
              </CardHeader>
              {isOpen ? (
                <CardContent className="space-y-3 pt-0">
                  {ch.pids?.length ? (
                    <div>
                      <div className="mb-1.5 text-xs font-medium text-muted-foreground">题目</div>
                      <div className="flex flex-wrap gap-1.5">
                        {ch.pids.map((pid: number) => {
                          const p = data.pdict[String(pid)] || {};
                          return (
                            <a key={pid} href={`/p/${p.pid || pid}`} className="rounded border px-2 py-1 text-xs hover:border-primary hover:text-primary">
                              {p.title || `P${pid}`}
                            </a>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}
                  {ch.tids?.length ? (
                    <div>
                      <div className="mb-1.5 flex items-center gap-1 text-xs font-medium text-muted-foreground">
                        <Trophy className="size-3" />比赛
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {ch.tids.map((tcid: string) => {
                          const c = data.cdict[tcid] || {};
                          return (
                            <a key={tcid} href={`/contest/${tcid}`} className="rounded border px-2 py-1 text-xs hover:border-primary hover:text-primary">
                              {c.title || '比赛'}
                            </a>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}
                  {!ch.pids?.length && !ch.tids?.length ? (
                    <p className="text-xs text-muted-foreground">本章暂无内容。</p>
                  ) : null}
                </CardContent>
              ) : null}
            </Card>
          );
        })}
      </div>
    </div>
  );
}

/* ─────────────────────────── 编辑器 ─────────────────────────── */

interface ChapterDraft {
  _id: number;
  title: string;
  pids: string[];
  tids: string; // comma-separated contest ids (引用制)
}

export function CourseEditPage() {
  const bs = useBootstrap();
  const data = bs.page.data as {
    tdoc?: R; chapters?: string; page_name: string;
    groups: Array<{ _id: string; name: string; archivedAt?: string | null }>;
  };
  const isEdit = data.page_name === 'course_edit';
  const tdoc = data.tdoc || {};
  const tid = String(tdoc.docId || tdoc._id || '');

  const initialChapters: ChapterDraft[] = (() => {
    try {
      const parsed = JSON.parse(data.chapters || '[]');
      return parsed.map((c: any) => ({
        _id: c._id, title: c.title,
        pids: (c.pids || []).map((p: any) => String(p)),
        tids: (c.tids || []).join(','),
      }));
    } catch { return []; }
  })();

  const [chapters, setChapters] = useState<ChapterDraft[]>(
    initialChapters.length ? initialChapters : [{ _id: 1, title: '第一章', pids: [], tids: '' }],
  );
  const [selectedGroups, setSelectedGroups] = useState<Set<string>>(
    new Set((tdoc.courseGroupIds || []).map((g: any) => String(g))),
  );

  const nextId = () => Math.max(0, ...chapters.map((c) => c._id)) + 1;
  const addChapter = () => setChapters((p) => [...p, { _id: nextId(), title: `第 ${p.length + 1} 章`, pids: [], tids: '' }]);
  const removeChapter = (id: number) => setChapters((p) => p.filter((c) => c._id !== id));
  const updateChapter = (id: number, patch: Partial<ChapterDraft>) => setChapters((p) => p.map((c) => (c._id === id ? { ...c, ...patch } : c)));
  const moveChapter = (id: number, dir: -1 | 1) => setChapters((p) => {
    const i = p.findIndex((c) => c._id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= p.length) return p;
    const next = [...p];
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  });

  // 序列化章节 → 提交给后端的 JSON。
  const chaptersJson = JSON.stringify(chapters.map((c) => ({
    _id: c._id,
    title: c.title,
    pids: c.pids,
    tids: c.tids.split(',').map((s) => s.trim()).filter(Boolean),
  })));

  const activeGroups = data.groups.filter((g) => !g.archivedAt || selectedGroups.has(g._id));

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="icon"><a href={isEdit ? `/course/${tid}` : '/course'}><ArrowLeft className="size-4" /></a></Button>
        <h1 className="text-xl font-semibold">{isEdit ? '编辑课程' : '新建课程'}</h1>
      </div>

      <form method="post" action={isEdit ? `/course/${tid}/edit` : '/course/create'} className="space-y-5">
        {isEdit ? <input type="hidden" name="tid" value={tid} /> : null}
        <input type="hidden" name="chapters" value={chaptersJson} />
        <input type="hidden" name="courseGroupIds" value={Array.from(selectedGroups).join(',')} />

        <Card>
          <CardContent className="space-y-4 p-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">课程名称</label>
                <Input name="title" defaultValue={tdoc.title || ''} required placeholder="如 数据结构 2025 秋" />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">学期（可选）</label>
                <Input name="term" defaultValue={tdoc.term || ''} placeholder="如 2025 秋" />
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">课程简介（Markdown）</label>
              <MarkdownEditor name="content" value={tdoc.content || ''} minHeight={200} />
            </div>
            <input type="hidden" name="description" value={tdoc.description || ''} />

            <div className="space-y-1.5">
              <label className="text-sm font-medium">可见范围（班级）</label>
              <p className="text-xs text-muted-foreground">不选 = 全域可见；选中后仅对应班级学生可见并可报名。</p>
              <div className="grid grid-cols-2 gap-1 rounded-md border p-2 sm:grid-cols-3">
                {activeGroups.length === 0 ? (
                  <p className="col-span-full px-1 py-2 text-xs text-muted-foreground">暂无可选班级（在用户绑定管理中创建）。</p>
                ) : activeGroups.map((g) => (
                  <label key={g._id} className="flex items-center gap-1.5 rounded px-1.5 py-1 text-xs hover:bg-accent/40">
                    <Checkbox
                      checked={selectedGroups.has(g._id)}
                      onChange={() => setSelectedGroups((prev) => {
                        const next = new Set(prev);
                        if (next.has(g._id)) next.delete(g._id); else next.add(g._id);
                        return next;
                      })}
                    />
                    {g.name}{g.archivedAt ? '（已归档）' : ''}
                  </label>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* 章节 */}
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="text-base">章节目录</CardTitle>
            <Button type="button" variant="outline" size="sm" onClick={addChapter} className="gap-1">
              <Plus className="size-3.5" />添加章节
            </Button>
          </CardHeader>
          <CardContent className="space-y-3">
            {chapters.map((ch, idx) => (
              <div key={ch._id} className="space-y-2 rounded-md border bg-muted/20 p-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-muted-foreground">第 {idx + 1} 章</span>
                  <Input
                    value={ch.title}
                    onChange={(e) => updateChapter(ch._id, { title: e.target.value })}
                    className="h-8 flex-1"
                    placeholder="章节标题"
                  />
                  <Button type="button" variant="ghost" size="icon" className="size-7" disabled={idx === 0} onClick={() => moveChapter(ch._id, -1)}>↑</Button>
                  <Button type="button" variant="ghost" size="icon" className="size-7" disabled={idx === chapters.length - 1} onClick={() => moveChapter(ch._id, 1)}>↓</Button>
                  <Button type="button" variant="ghost" size="icon" className="size-7 text-destructive" disabled={chapters.length === 1} onClick={() => removeChapter(ch._id)}>
                    <X className="size-3.5" />
                  </Button>
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] text-muted-foreground">题目</label>
                  <ProblemPicker
                    value={ch.pids}
                    onChange={(v) => updateChapter(ch._id, { pids: v })}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] text-muted-foreground">
                    引用比赛（比赛 id，逗号分隔；先在
                    <a href="/contest/create" target="_blank" rel="noreferrer" className="mx-1 text-primary hover:underline">比赛模块</a>
                    创建再填 id）
                  </label>
                  <Input
                    value={ch.tids}
                    onChange={(e) => updateChapter(ch._id, { tids: e.target.value })}
                    className="h-8 font-mono text-xs"
                    placeholder="65abc… , 65def…"
                  />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <div className="flex justify-end gap-2">
          <Button asChild variant="ghost"><a href={isEdit ? `/course/${tid}` : '/course'}>取消</a></Button>
          <Button type="submit" className="gap-1"><Save className="size-4" />{isEdit ? '保存' : '创建课程'}</Button>
        </div>
      </form>
    </div>
  );
}
