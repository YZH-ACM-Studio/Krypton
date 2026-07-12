import {
  ArrowLeft, Download, FileText, ListTree, Plus, Save, Trash2,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { MarkdownEditor } from '@/components/markdown-renderer';
import { ProblemPicker } from '@/components/problem-picker';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { FileUploader } from '@/components/uploader';
import { useBootstrap } from '@/lib/bootstrap';
import { cn } from '@/lib/cn';
import { ChapterOutline } from './chapter-outline';
import { useChapterQuery } from './chapter-query';
import type { ChapterDraft, CourseRecord } from './types';

type SaveState = 'idle' | 'dirty' | 'saving';

async function responseError(response: Response): Promise<string> {
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    const body = await response.json();
    const message = body?.error?.message || body?.message || body?.error;
    if (typeof message === 'string' && message.trim()) return message;
  }
  return `请求失败（${response.status} ${response.statusText || 'Unknown Error'}）`;
}

function initialChapterDrafts(serialized?: string): ChapterDraft[] {
  if (!serialized) return [];
  const parsed = JSON.parse(serialized);
  if (!Array.isArray(parsed)) throw new TypeError('Invalid course chapter payload');
  return parsed.map((chapter) => ({
    _id: Number(chapter._id),
    title: String(chapter.title || ''),
    content: String(chapter.content || ''),
    pids: Array.isArray(chapter.pids) ? chapter.pids.map(String) : [],
    tids: Array.isArray(chapter.tids) ? chapter.tids.map(String).join(',') : '',
  }));
}

export function CourseEditPage() {
  const bs = useBootstrap();
  const data = bs.page.data as {
    tdoc?: CourseRecord;
    chapters?: string;
    page_name: string;
    groups: Array<{ _id: string, name: string, archivedAt?: string | null }>;
    canManageFiles: boolean;
    files: CourseRecord[];
  };
  const isEdit = data.page_name === 'course_edit';
  const course = data.tdoc || {};
  const tid = String(course.docId || course._id || '');
  const parsedChapters = useMemo(() => initialChapterDrafts(data.chapters), [data.chapters]);
  const [chapters, setChapters] = useState<ChapterDraft[]>(
    parsedChapters.length
      ? parsedChapters
      : [{ _id: 1, title: '第一章', content: '', pids: [], tids: '' }],
  );
  const [selectedGroups, setSelectedGroups] = useState<Set<string>>(
    new Set((course.courseGroupIds || []).map(String)),
  );
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [saveError, setSaveError] = useState('');
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [courseFiles, setCourseFiles] = useState<CourseRecord[]>(data.files || []);
  const [fileError, setFileError] = useState('');
  const { activeId, selectChapter } = useChapterQuery(chapters);
  const activeChapter = chapters.find((chapter) => chapter._id === activeId) || chapters[0];

  useEffect(() => {
    if (saveState !== 'dirty') return undefined;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [saveState]);

  const markDirty = () => {
    setSaveError('');
    setSaveState((state) => (state === 'saving' ? state : 'dirty'));
  };

  const updateChapter = (chapterId: number, patch: Partial<ChapterDraft>) => {
    setChapters((current) => current.map((chapter) => (
      chapter._id === chapterId ? { ...chapter, ...patch } : chapter
    )));
    markDirty();
  };

  const addChapter = () => {
    const chapterId = Math.max(0, ...chapters.map((chapter) => chapter._id)) + 1;
    setChapters((current) => [...current, {
      _id: chapterId,
      title: `第 ${current.length + 1} 章`,
      content: '',
      pids: [],
      tids: '',
    }]);
    markDirty();
  };

  const moveChapter = (chapterId: number, direction: -1 | 1) => {
    setChapters((current) => {
      const from = current.findIndex((chapter) => chapter._id === chapterId);
      const to = from + direction;
      if (from < 0 || to < 0 || to >= current.length) return current;
      const next = [...current];
      [next[from], next[to]] = [next[to], next[from]];
      return next;
    });
    markDirty();
  };

  const removeChapter = (chapterId: number) => {
    if (chapters.length === 1) return;
    if (activeChapter._id === chapterId) {
      const index = chapters.findIndex((chapter) => chapter._id === chapterId);
      const replacement = chapters[index + 1] || chapters[index - 1];
      if (replacement) selectChapter(replacement._id, true);
    }
    setChapters((current) => current.filter((chapter) => chapter._id !== chapterId));
    markDirty();
  };

  const chaptersJson = JSON.stringify(chapters.map((chapter) => ({
    _id: chapter._id,
    title: chapter.title,
    ...(chapter.content ? { content: chapter.content } : {}),
    pids: chapter.pids,
    tids: chapter.tids.split(',').map((value) => value.trim()).filter(Boolean),
  })));
  const activeGroups = (data.groups || []).filter((group) => !group.archivedAt || selectedGroups.has(group._id));
  const formAction = isEdit ? `/course/${tid}/edit` : '/course/create';
  const fileEndpoint = isEdit ? `/course/${tid}/file` : '';

  const refreshFiles = async () => {
    if (!fileEndpoint) return;
    const response = await fetch(fileEndpoint, {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) throw new Error(await responseError(response));
    const body = await response.json();
    if (!Array.isArray(body?.files)) throw new Error('课件列表响应格式错误');
    setCourseFiles(body.files);
  };

  const deleteFile = async (filename: string) => {
    setFileError('');
    const body = new URLSearchParams({ operation: 'delete_files' });
    body.append('files', filename);
    try {
      const response = await fetch(fileEndpoint, {
        method: 'POST', body, credentials: 'same-origin',
      });
      if (!response.ok) throw new Error(await responseError(response));
      setCourseFiles((current) => current.filter((file) => file.name !== filename));
    } catch (error: any) {
      setFileError(error?.message || '课件删除失败');
    }
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaveError('');
    setSaveState('saving');
    try {
      const form = event.currentTarget;
      const response = await fetch(form.action, {
        method: 'POST',
        body: new URLSearchParams(new FormData(form) as any),
        credentials: 'same-origin',
      });
      if (!response.ok) throw new Error(await responseError(response));
      if (response.redirected) {
        setSaveState('idle');
        window.location.assign(response.url);
        return;
      }
      const body = await response.json();
      if (!body?.tid) throw new Error('课程保存成功响应缺少 tid');
      setSaveState('idle');
      window.location.assign(`/course/${body.tid}`);
    } catch (error: any) {
      setSaveError(error?.message || '课程保存失败');
      setSaveState('dirty');
    }
  };

  const selectFromMobile = (chapterId: number) => {
    selectChapter(chapterId);
    setOutlineOpen(false);
  };

  return (
    <main className="mx-auto w-full max-w-[90rem] space-y-5 pb-8">
      <header className="flex flex-wrap items-center gap-3 border-b border-border/70 pb-4">
        <Button asChild variant="ghost" size="icon" className="size-11">
          <a href={isEdit ? `/course/${tid}` : '/course'} aria-label="返回"><ArrowLeft className="size-4" /></a>
        </Button>
        <div className="min-w-0 flex-1">
          <p className="text-xs text-muted-foreground">课程工作区</p>
          <h1 className="mt-0.5 truncate text-2xl font-semibold tracking-tight">{isEdit ? `编辑 ${course.title}` : '新建课程'}</h1>
        </div>
        <Button
          type="button"
          variant="outline"
          className="min-h-11 gap-1.5 lg:hidden"
          onClick={() => setOutlineOpen(true)}
        ><ListTree className="size-4" />章节</Button>
        <div aria-live="polite" className="text-xs text-muted-foreground">
          {saveState === 'saving' ? '正在保存…' : saveState === 'dirty' ? '有未保存更改' : '已保存'}
        </div>
        <Button
          form="course-editor-form"
          type="submit"
          disabled={saveState === 'saving'}
          className="min-h-11 gap-1.5"
        ><Save className="size-4" />{saveState === 'saving' ? '保存中' : '保存课程'}</Button>
      </header>

      {saveError ? (
        <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">{saveError}</div>
      ) : null}

      <form
        id="course-editor-form"
        method="post"
        action={formAction}
        onSubmit={submit}
        onChange={markDirty}
        className="grid min-w-0 gap-6 lg:grid-cols-[15rem_minmax(0,1fr)_19rem]"
      >
        {isEdit ? <input type="hidden" name="tid" value={tid} /> : null}
        <input type="hidden" name="chapters" value={chaptersJson} />
        <input type="hidden" name="courseGroupIds" value={Array.from(selectedGroups).join(',')} />
        <input type="hidden" name="description" value={course.description || ''} />

        <aside className="hidden self-start lg:sticky lg:top-20 lg:block">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="text-xs font-semibold text-muted-foreground">章节目录</h2>
            <Button type="button" variant="ghost" size="sm" className="h-9 gap-1 px-2" onClick={addChapter}><Plus className="size-3.5" />添加</Button>
          </div>
          <ChapterOutline
            chapters={chapters}
            activeId={activeChapter._id}
            onSelect={selectChapter}
            onMove={moveChapter}
            onRemove={removeChapter}
          />
        </aside>

        <section className="min-w-0 space-y-6" aria-labelledby="active-chapter-title">
          <header className="border-b border-border/70 pb-4">
            <p className="text-xs tabular-nums text-muted-foreground">第 {chapters.findIndex((chapter) => chapter._id === activeChapter._id) + 1} 章</p>
            <h2 id="active-chapter-title" className="mt-1 text-xl font-semibold tracking-tight">章节内容</h2>
          </header>

          <label className="block space-y-1.5">
            <span className="text-sm font-medium">章节标题</span>
            <Input
              value={activeChapter.title}
              onChange={(event) => updateChapter(activeChapter._id, { title: event.target.value })}
              className="min-h-11"
              required
            />
          </label>

          <section data-course-slot="chapterContent" className="space-y-2" aria-labelledby="chapter-content-title">
            <div>
              <h3 id="chapter-content-title" className="text-sm font-medium">章节讲义</h3>
              <p className="mt-0.5 text-xs text-muted-foreground">支持 Markdown、代码块与图片。</p>
            </div>
            <MarkdownEditor
              key={activeChapter._id}
              value={activeChapter.content}
              onChange={(content) => updateChapter(activeChapter._id, { content })}
              minHeight={240}
            />
          </section>

          <section className="space-y-2" aria-labelledby="chapter-problems-title">
            <div>
              <h3 id="chapter-problems-title" className="text-sm font-medium">题目</h3>
              <p className="mt-0.5 text-xs text-muted-foreground">按当前顺序显示在章节中。</p>
            </div>
            <ProblemPicker value={activeChapter.pids} onChange={(pids) => updateChapter(activeChapter._id, { pids })} />
          </section>

          <section className="space-y-2" aria-labelledby="chapter-contests-title">
            <div>
              <h3 id="chapter-contests-title" className="text-sm font-medium">引用比赛或作业</h3>
              <p className="mt-0.5 text-xs text-muted-foreground">填写已创建内容的 id，多个 id 用逗号分隔。</p>
            </div>
            <Input
              value={activeChapter.tids}
              onChange={(event) => updateChapter(activeChapter._id, { tids: event.target.value })}
              className="min-h-11 font-mono text-xs"
              placeholder="65abc… , 65def…"
            />
            <a
              href="/contest/create"
              target="_blank"
              rel="noreferrer"
              className={cn(
                'inline-flex min-h-11 items-center text-xs font-medium text-primary hover:underline',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
              )}
            >前往比赛模块创建</a>
          </section>

          <div data-course-slot="quiz" />
        </section>

        <aside className={cn(
          'space-y-6 self-start border-t border-border/70 pt-6',
          'lg:sticky lg:top-20 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0',
        )}>
          <section className="space-y-4" aria-labelledby="course-settings-title">
            <h2 id="course-settings-title" className="text-sm font-semibold">课程设置</h2>
            <label className="block space-y-1.5">
              <span className="text-xs font-medium">课程名称</span>
              <Input name="title" defaultValue={course.title || ''} required className="min-h-11" />
            </label>
            <label className="block space-y-1.5">
              <span className="text-xs font-medium">学期</span>
              <Input name="term" defaultValue={course.term || ''} className="min-h-11" placeholder="如 2026 秋" />
            </label>
            <label className="block space-y-1.5">
              <span className="text-xs font-medium">课程简介</span>
              <MarkdownEditor name="content" value={course.content || ''} minHeight={180} />
            </label>
          </section>

          <section className="space-y-2" aria-labelledby="course-visibility-title">
            <div>
              <h2 id="course-visibility-title" className="text-sm font-semibold">可见班级</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">不选择时对全域用户开放。</p>
            </div>
            <div className="max-h-52 space-y-1 overflow-y-auto border-y border-border/70 py-2">
              {activeGroups.length ? activeGroups.map((group) => (
                <label
                  key={group._id}
                  className="flex min-h-11 items-center gap-2 rounded-md px-2 text-xs transition-colors duration-200 hover:bg-muted/60"
                >
                  <Checkbox
                    checked={selectedGroups.has(group._id)}
                    onChange={() => {
                      setSelectedGroups((current) => {
                        const next = new Set(current);
                        if (next.has(group._id)) next.delete(group._id); else next.add(group._id);
                        return next;
                      });
                      markDirty();
                    }}
                  />
                  <span>{group.name}{group.archivedAt ? '（已归档）' : ''}</span>
                </label>
              )) : <p className="px-2 py-3 text-xs text-muted-foreground">暂无班级。</p>}
            </div>
          </section>

          <section data-course-slot="files" className="space-y-3" aria-labelledby="course-files-editor-title">
            <div>
              <h2 id="course-files-editor-title" className="text-sm font-semibold">课程课件</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">学生按课程班级范围下载。</p>
            </div>
            {fileError ? <p role="alert" className="text-xs text-destructive">{fileError}</p> : null}
            {isEdit && data.canManageFiles ? (
              <FileUploader
                endpoint={fileEndpoint}
                maxFiles={10}
                uploadConcurrency={1}
                onBatchComplete={() => {
                  void refreshFiles().catch((error) => setFileError(error?.message || '课件列表刷新失败'));
                }}
              />
            ) : !isEdit ? (
              <p className="text-xs text-muted-foreground">先保存课程，再上传课件。</p>
            ) : null}
            {courseFiles.length ? (
              <div className="divide-y divide-border/70 border-y border-border/70">
                {courseFiles.map((file) => (
                  <div key={file.name} className="flex min-h-11 items-center gap-2 py-2 text-xs">
                    <FileText className="size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate font-medium">{file.name}</span>
                    <a
                      href={`/course/${tid}/file/${encodeURIComponent(file.name)}`}
                      className={cn(
                        'inline-flex size-10 items-center justify-center rounded-md hover:bg-muted',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                      )}
                      aria-label={`下载${file.name}`}
                    ><Download className="size-4" /></a>
                    {data.canManageFiles ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-10 text-destructive"
                        onClick={() => deleteFile(file.name)}
                        aria-label={`删除${file.name}`}
                      ><Trash2 className="size-4" /></Button>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}
          </section>
          <div data-course-slot="collaborators" />
        </aside>
      </form>

      <Sheet open={outlineOpen} onOpenChange={setOutlineOpen}>
        <SheetContent side="left" className="w-[23rem] max-w-[calc(100vw-1rem)]">
          <SheetHeader className="flex items-center justify-between gap-2 pr-12">
            <SheetTitle>章节目录</SheetTitle>
            <Button type="button" variant="ghost" size="sm" className="gap-1" onClick={addChapter}><Plus className="size-3.5" />添加</Button>
          </SheetHeader>
          <div className="overflow-y-auto p-4">
            <ChapterOutline
              chapters={chapters}
              activeId={activeChapter._id}
              onSelect={selectFromMobile}
              onMove={moveChapter}
              onRemove={removeChapter}
            />
          </div>
        </SheetContent>
      </Sheet>
    </main>
  );
}
