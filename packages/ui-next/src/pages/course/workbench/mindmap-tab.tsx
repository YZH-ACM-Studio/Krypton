import { type JSX, useEffect, useRef, useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { alertDialog, confirmDialog } from '@/components/ui/dialog';
import { FormField } from '@/components/ui/form';
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

interface EditorCourseNode {
  id: string;
  title: string;
  visibility: 'public' | 'hidden';
  canEdit: boolean;
}

interface BoundCourseNode {
  id: string;
  title: string;
  canEdit: boolean;
}

const PANEL_DESCRIPTION = '绑定一个课程节点后，可以用它的知识点生成章节，学生在课程页看到这门课的知识点导图。';
const UNBOUND_LABEL = '不绑定';
const HIDDEN_HINT = '隐藏';
const GENERATE_LABEL = '从知识点生成章节';
const EDIT_LABEL = '编辑这门课的知识点';
const LOCKED_NOTE = '只有负责教师和管理员能编辑这门课的知识点';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readNodeId(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${field} must be a node id`);
  return value;
}

function readTitle(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${field} must be a string`);
  return value;
}

function readEditorCourseNode(value: unknown, index: number): EditorCourseNode {
  if (!isRecord(value)) throw new TypeError(`courseNodes[${index}] must be an object`);
  const field = `courseNodes[${index}]`;
  const visibility = value.visibility;
  if (visibility !== 'public' && visibility !== 'hidden') throw new TypeError(`${field}.visibility is invalid`);
  if (typeof value.canEdit !== 'boolean') throw new TypeError(`${field}.canEdit must be a boolean`);
  return {
    id: readNodeId(value.id, `${field}.id`),
    title: readTitle(value.title, `${field}.title`),
    visibility,
    canEdit: value.canEdit,
  };
}

function readCourseNodes(value: unknown): EditorCourseNode[] {
  if (!Array.isArray(value)) throw new TypeError('courseNodes must be an array');
  const nodes = value.map((node, index) => readEditorCourseNode(node, index));
  if (new Set(nodes.map((node) => node.id)).size !== nodes.length) throw new TypeError('courseNodes contains a duplicate id');
  return nodes;
}

function readBoundCourseNode(value: unknown): BoundCourseNode | null {
  if (value === null) return null;
  if (!isRecord(value)) throw new TypeError('boundCourseNode must be an object');
  if (typeof value.canEdit !== 'boolean') throw new TypeError('boundCourseNode.canEdit must be a boolean');
  return {
    id: readNodeId(value.id, 'boundCourseNode.id'),
    title: readTitle(value.title, 'boundCourseNode.title'),
    canEdit: value.canEdit,
  };
}

function hasBindingKeys(value: Record<string, unknown>): boolean {
  return Object.hasOwn(value, 'courseNodes') && Object.hasOwn(value, 'boundCourseNode');
}

/**
 * Props win when they already carry the editor GET fields. Otherwise the course
 * editor parser dropped them, and the raw page payload on window still has them.
 * A missing key is not "unbound": unbound is `boundCourseNode: null`.
 * When both sources omit the keys, return null so the tab does not submit an empty binding.
 */
function editorBindingSource(data: CourseEditorPageData): Record<string, unknown> | null {
  const props = data as CourseEditorPageData & Record<string, unknown>;
  if (hasBindingKeys(props)) return props;
  const pageData = window.__KRYPTON_BOOTSTRAP__?.page?.data;
  if (isRecord(pageData) && hasBindingKeys(pageData)) return pageData;
  return null;
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
  const bindingSource = editorBindingSource(data);
  const courseNodes = bindingSource ? readCourseNodes(bindingSource.courseNodes) : [];
  const bound = bindingSource ? readBoundCourseNode(bindingSource.boundCourseNode) : null;
  const [selectedNodeId, setSelectedNodeId] = useState(bound ? bound.id : '');
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

  const generateChaptersFromMindmap = async () => {
    if (!isEdit || !bound || !claim()) return;
    try {
      const accepted = await confirmDialog('根节点的下一层会变成章，再下一层变成小节，更深的内容写进小节正文。已有视频、题目或收集的章节会保留。', {
        title: '从知识点生成章节',
        confirmLabel: '生成',
      });
      if (!accepted) {
        release();
        return;
      }
      setActionError('');
      const response = await postCourseOperation(tid, new URLSearchParams({ operation: 'generate_chapters' }), '从知识点生成章节失败');
      const body: unknown = await response.json();
      const replaced = readReplacedChapters(body);
      if (replaced) onChaptersReplaced(replaced);
      const { summary, notices } = readGenerateResult(body);
      await alertDialog([summary, ...notices].join('\n'), { title: '章节已按导图更新', confirmLabel: '查看章节' });
      window.location.assign(`/course/${tid}/edit`);
    } catch (error) {
      setActionError(reportActionError(tid, 'generate', error, '从知识点生成章节失败'));
      release();
    }
  };

  if (!bindingSource) {
    return (
      <div ref={rootRef} id="course-mindmap-settings" hidden={!active}>
        <Panel title="知识点" description={PANEL_DESCRIPTION}>
          <Alert tone="danger">课程编辑页缺少课程节点</Alert>
        </Panel>
      </div>
    );
  }

  return (
    <div ref={rootRef} id="course-mindmap-settings" hidden={!active}>
      <Panel title="知识点" description={PANEL_DESCRIPTION}>
        <div className="flex flex-col gap-3">
          <FormField label="课程节点" htmlFor="course-knowledge-node">
            <SimpleSelect
              id="course-knowledge-node"
              name="knowledgeCourseNodeId"
              value={selectedNodeId}
              onValueChange={(value) => {
                setSelectedNodeId(value);
                setSaveState('dirty');
                onDirty();
              }}
              options={[
                { value: '', label: UNBOUND_LABEL },
                ...courseNodes.map((node) => ({
                  value: node.id,
                  label: node.title,
                  ...(node.visibility === 'hidden' ? { hint: HIDDEN_HINT } : {}),
                })),
              ]}
              ariaLabel="课程节点"
            />
          </FormField>
          {isEdit && bound ? (
            <div className="flex flex-col items-start gap-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={locked}
                title={unsaved ? '请先保存课程' : GENERATE_LABEL}
                onClick={() => void generateChaptersFromMindmap()}
              >
                {GENERATE_LABEL}
              </Button>
              {bound.canEdit ? (
                <a
                  href={`/mindmap/${bound.id}/edit`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sm text-brand-fg underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  {EDIT_LABEL}
                </a>
              ) : (
                <p className="text-xs text-fg-subtle">{LOCKED_NOTE}</p>
              )}
            </div>
          ) : null}
          {actionError ? <Alert tone="danger">{actionError}</Alert> : null}
        </div>
      </Panel>
    </div>
  );
}
