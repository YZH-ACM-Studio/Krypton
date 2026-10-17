import { type JSX, useEffect, useRef, useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { alertDialog, confirmDialog } from '@/components/ui/dialog';
import { Panel } from '@/components/ui/panel';
import { SimpleSelect } from '@/components/ui/select';
import { fetchHydroResponse, readHydroResponseError } from '@/lib/error-presenter';
import type { ChapterDraft } from '../types';
import { type CourseEditorPageData, initialChapterDrafts } from './model';

type MindmapSaveState = 'idle' | 'dirty';

export interface CourseMindmapTabProps {
  data: CourseEditorPageData;
  chapters: ChapterDraft[];
  onDirty: () => void;
  active: boolean;
  onChaptersReplaced: (next: ChapterDraft[]) => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function courseId(data: CourseEditorPageData): string {
  const course = data.tdoc;
  const raw = course?.docId ?? course?._id ?? '';
  return String(raw);
}

function actionMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  if (isRecord(error) && typeof error.message === 'string' && error.message) return error.message;
  return fallback;
}

/** Same summary rules as the previous course editor. */
function readGenerateResult(body: unknown): { summary: string; notices: string[] } {
  if (!isRecord(body)) return { summary: '章节已按导图更新。', notices: [] };
  const notices = Array.isArray(body.notices) && body.notices.every((item) => typeof item === 'string') ? body.notices : [];
  if (typeof body.createdChapters !== 'number' || typeof body.createdSections !== 'number') {
    return { summary: '章节已按导图更新。', notices };
  }
  if (body.createdChapters === 0 && body.createdSections === 0) return { summary: '已按导图更新现有章节。', notices };
  return { summary: `已新增 ${body.createdChapters} 章、${body.createdSections} 节。`, notices };
}

/**
 * The live generate response has counts and notices only. Replace drafts when a
 * future payload actually includes them; otherwise the caller keeps the old reload.
 */
function readReplacedChapters(body: unknown): ChapterDraft[] | null {
  if (!isRecord(body) || !Object.hasOwn(body, 'chapters')) return null;
  const raw = body.chapters;
  const serialized = typeof raw === 'string' ? raw : Array.isArray(raw) ? JSON.stringify(raw) : null;
  if (!serialized) throw new TypeError('Invalid course chapter payload');
  const next = initialChapterDrafts(serialized);
  if (next.length === 0) throw new TypeError('Invalid course chapter payload');
  return next;
}

async function postCourseOperation(tid: string, body: URLSearchParams, fallback: string): Promise<Response> {
  if (!tid) throw new TypeError('课程编号无效');
  const response = await fetchHydroResponse(`/course/${tid}/edit`, {
    method: 'POST',
    body,
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new Error(await readHydroResponseError(response, fallback));
  return response;
}

function reportActionError(courseIdValue: string, action: string, error: unknown, fallback: string): string {
  console.error(`course mindmap ${action} failed`, { courseId: courseIdValue, error });
  return actionMessage(error, fallback);
}

/** Stable picture of the course form. Files use name:size:type; other fields use name plus the string. */
function formSignature(form: HTMLFormElement): string {
  const parts: string[] = [];
  for (const [name, value] of new FormData(form).entries()) {
    if (typeof value === 'string') parts.push(`${name}=${value}`);
    else parts.push(`${name}:${value.size}:${value.type}`);
  }
  return parts.join('\u0000');
}

export function CourseMindmapTab({
  data,
  chapters,
  onDirty,
  active,
  onChaptersReplaced,
}: CourseMindmapTabProps): JSX.Element {
  const tid = courseId(data);
  const isEdit = data.page_name === 'course_edit';
  const ownedMindmap = data.courseOwnedMindmap;
  const [selectedMindmapId, setSelectedMindmapId] = useState(String(data.tdoc?.mindmapId || ''));
  const [saveState, setSaveState] = useState<MindmapSaveState>('idle');
  const [formDirty, setFormDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const baselineRef = useRef<string | null>(null);
  const pendingRef = useRef(false);
  const unsaved = saveState === 'dirty' || formDirty;
  const locked = unsaved || busy;

  const formChangedNow = (): boolean => {
    const form = rootRef.current?.closest('form');
    const baseline = baselineRef.current;
    if (!(form instanceof HTMLFormElement) || baseline === null) return false;
    return formSignature(form) !== baseline;
  };

  useEffect(() => {
    const form = rootRef.current?.closest('form');
    if (!(form instanceof HTMLFormElement)) return undefined;
    if (baselineRef.current === null) baselineRef.current = formSignature(form);
    let frame = 0;
    const compare = () => {
      const baseline = baselineRef.current;
      if (baseline === null) return;
      setFormDirty(formSignature(form) !== baseline);
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(compare);
    };
    form.addEventListener('input', schedule);
    form.addEventListener('change', schedule);
    // Chapter edits and tab switches land in this commit. Hidden selects do not emit input/change.
    compare();
    return () => {
      cancelAnimationFrame(frame);
      form.removeEventListener('input', schedule);
      form.removeEventListener('change', schedule);
    };
  }, [chapters, active]);

  const claim = (): boolean => {
    const changed = formChangedNow();
    if (saveState !== 'idle' || formDirty || changed || pendingRef.current) {
      if (changed) setFormDirty(true);
      return false;
    }
    pendingRef.current = true;
    setBusy(true);
    return true;
  };

  const release = () => {
    pendingRef.current = false;
    setBusy(false);
  };

  const createOwnedMindmap = async () => {
    if (!isEdit || !claim()) return;
    try {
      if (data.tdoc?.mindmapId) {
        const accepted = await confirmDialog('创建后会解除当前公开导图绑定，学生将看到新的本课导图。公开导图本身不会被修改。', {
          title: '创建本课导图',
          confirmLabel: '创建',
        });
        if (!accepted) {
          release();
          return;
        }
      }
      setActionError('');
      const response = await postCourseOperation(tid, new URLSearchParams({ operation: 'create_mindmap' }), '本课导图创建失败');
      window.location.assign(response.redirected ? response.url : `/course/${tid}/mindmap`);
    } catch (error) {
      setActionError(reportActionError(tid, 'create', error, '本课导图创建失败'));
      release();
    }
  };

  const deleteOwnedMindmap = async () => {
    if (!isEdit || !ownedMindmap || !claim()) return;
    try {
      const mapTitle = ownedMindmap.title.trim() || '本课导图';
      const accepted = await confirmDialog('节点和钉选都会删掉，不能恢复。题目本身不会删除，之后可以再绑定公开导图。', {
        title: `删除本课导图「${mapTitle}」？`,
        confirmLabel: '删除',
        destructive: true,
      });
      if (!accepted) {
        release();
        return;
      }
      setActionError('');
      const response = await postCourseOperation(
        tid,
        new URLSearchParams({ operation: 'delete_mindmap', expectedUpdatedAt: ownedMindmap.updatedAt }),
        '本课导图删除失败',
      );
      window.location.assign(response.redirected ? response.url : `/course/${tid}/edit`);
    } catch (error) {
      setActionError(reportActionError(tid, 'delete', error, '本课导图删除失败'));
      release();
    }
  };

  const generateChaptersFromMindmap = async () => {
    if (!isEdit || !ownedMindmap || !claim()) return;
    try {
      const accepted = await confirmDialog('根节点的下一层会变成章，再下一层变成小节，更深的内容写进小节正文。已有视频、题目或收集的章节会保留。', {
        title: '从导图生成章节',
        confirmLabel: '生成',
      });
      if (!accepted) {
        release();
        return;
      }
      setActionError('');
      const response = await postCourseOperation(tid, new URLSearchParams({ operation: 'generate_chapters' }), '从导图生成章节失败');
      const body: unknown = await response.json();
      const replaced = readReplacedChapters(body);
      if (replaced) onChaptersReplaced(replaced);
      const { summary, notices } = readGenerateResult(body);
      await alertDialog([summary, ...notices].join('\n'), { title: '章节已按导图更新', confirmLabel: '查看章节' });
      window.location.assign(`/course/${tid}/edit`);
    } catch (error) {
      setActionError(reportActionError(tid, 'generate', error, '从导图生成章节失败'));
      release();
    }
  };

  return (
    <div ref={rootRef} hidden={!active}>
      <Panel title="导图">
        <div className="flex flex-col gap-3">
          {isEdit && ownedMindmap ? (
            <div className="flex flex-col gap-3">
              <p className="min-w-0 break-words text-sm font-medium text-fg">{ownedMindmap.title}</p>
              <p className="text-sm text-fg-muted">这是本课专属导图。学生进入课程就能看到当前结构。要改绑公开导图，需要先删除它。</p>
              <input type="hidden" name="mindmapId" value={ownedMindmap._id} />
              <div className="flex flex-wrap gap-2">
                <Button asChild type="button" variant="secondary" size="sm">
                  <a href={`/course/${tid}/mindmap`}>编辑本课导图</a>
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={locked}
                  title={unsaved ? '请先保存课程' : '从导图生成章节'}
                  onClick={() => void generateChaptersFromMindmap()}
                >
                  从导图生成章节
                </Button>
                <Button type="button" variant="danger-soft" size="sm" disabled={locked} onClick={() => void deleteOwnedMindmap()}>
                  删除本课导图
                </Button>
              </div>
              <p className="text-sm text-fg-muted">生成后可以在对应章节上传视频。已有视频或题目的章节不会被删掉。</p>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <SimpleSelect
                name="mindmapId"
                value={selectedMindmapId}
                onValueChange={(value) => {
                  setSelectedMindmapId(value);
                  setSaveState('dirty');
                  onDirty();
                }}
                options={[
                  { value: '', label: '不绑定知识导图' },
                  ...(data.mindmaps || []).map((map) => ({ value: map._id, label: `${map.title} · 已公开` })),
                ]}
                ariaLabel="选择课程知识导图"
              />
              {isEdit ? (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={locked}
                  title={unsaved ? '请先保存课程' : '创建本课导图'}
                  onClick={() => void createOwnedMindmap()}
                >
                  创建本课导图
                </Button>
              ) : (
                <p className="text-sm text-fg-muted">保存课程后才能创建本课导图。</p>
              )}
            </div>
          )}
          {actionError ? <Alert tone="danger">{actionError}</Alert> : null}
        </div>
      </Panel>
    </div>
  );
}
