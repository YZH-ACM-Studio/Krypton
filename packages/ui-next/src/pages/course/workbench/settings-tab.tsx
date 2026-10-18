import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Copy, Trash2 } from 'lucide-react';
import { MarkdownEditor } from '@/components/markdown-renderer';
import { PracticeIntegrityPolicyPanel } from '@/components/practice-integrity-policy-panel';
import { FileUploader } from '@/components/uploader';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { confirmDialog } from '@/components/ui/dialog';
import { FormField } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Panel } from '@/components/ui/panel';
import { useBootstrap } from '@/lib/bootstrap';
import { getJson, postForm } from '@/pages/teach/api';
import { CourseAssignForm } from '../assign';
import { CourseFileRow } from '../course-file-row';
import type { ChapterDraft, CourseFile, CourseRecord } from '../types';
import type { CourseEditorPageData } from './model';

const DELETE_FORM_ID = 'course-settings-delete-form';
const COPY_NOTE = '复制出一门新课程：章节、讲义、题目和视频文件都会带过来，学生的观看和成绩不复制。';
const DELETE_MESSAGE = '课件、视频和观看记录会一并删除，不能恢复。';
const SAVE_FIRST_COPY = '请先保存课程修改。复制使用已保存的章节，不会带走未保存草稿、课件、报名或真实性策略。';

function dueAtInputValue(raw: unknown): string {
  if (!raw) return '';
  const date = new Date(raw instanceof Date ? raw : String(raw));
  if (Number.isNaN(date.getTime())) return '';
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function courseIdOf(course: CourseRecord | undefined): string {
  const id = course?.docId ?? course?._id;
  if (id === undefined || id === null || id === '') return '';
  return String(id);
}

function savedCourse(data: CourseEditorPageData, courseId: string): boolean {
  return data.page_name === 'course_edit' && courseId !== '';
}

function errorText(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

function readCourseFiles(value: unknown): CourseFile[] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new TypeError('课件列表响应格式错误');
  const files = Reflect.get(value, 'files') as unknown;
  if (!Array.isArray(files)) throw new TypeError('课件列表响应格式错误');
  return files.map((file) => {
    if (typeof file !== 'object' || file === null || Array.isArray(file)) throw new TypeError('课件列表响应格式错误');
    const name = Reflect.get(file, 'name') as unknown;
    if (typeof name !== 'string' || name === '') throw new TypeError('课件列表响应格式错误');
    const size = Reflect.get(file, 'size') as unknown;
    if (size !== undefined && typeof size !== 'number') throw new TypeError('课件列表响应格式错误');
    return size === undefined ? { name } : { name, size };
  });
}

function readCopiedCourseId(body: Record<string, unknown>): string {
  const tid = body.tid;
  if (typeof tid !== 'string' || tid === '') throw new Error('课程复制成功响应缺少 tid');
  return tid;
}

function formSnapshot(form: HTMLFormElement): string {
  const entries: string[] = [];
  for (const [name, value] of new FormData(form).entries()) {
    const text = typeof value === 'string' ? value : `${value.name}:${value.size}`;
    entries.push(JSON.stringify([name, text]));
  }
  entries.sort();
  return entries.join('\n');
}

export function CourseSettingsTab({
  data,
  onDirty,
  active,
}: {
  data: CourseEditorPageData;
  chapters: ChapterDraft[];
  onDirty(): void;
  active: boolean;
}) {
  const bootstrap = useBootstrap();
  const course = data.tdoc;
  const courseId = courseIdOf(course);
  const saved = savedCourse(data, courseId);
  const editAction = `/course/${courseId}/edit`;
  const fileEndpoint = saved ? `/course/${courseId}/file` : '';
  const rootRef = useRef<HTMLDivElement>(null);
  const cleanSnapshot = useRef('');
  const [courseFiles, setCourseFiles] = useState<CourseFile[]>(data.files);
  const [fileError, setFileError] = useState('');
  const [copyError, setCopyError] = useState('');
  const [copying, setCopying] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  useLayoutEffect(() => {
    const form = rootRef.current?.closest('form');
    if (!(form instanceof HTMLFormElement)) return;
    cleanSnapshot.current = formSnapshot(form);
    const onEdit = () => {
      if (formSnapshot(form) !== cleanSnapshot.current) {
        setCopyError(SAVE_FIRST_COPY);
        return;
      }
      setCopyError((current) => (current === SAVE_FIRST_COPY ? '' : current));
    };
    form.addEventListener('input', onEdit, true);
    form.addEventListener('change', onEdit, true);
    return () => {
      form.removeEventListener('input', onEdit, true);
      form.removeEventListener('change', onEdit, true);
    };
  }, []);
  const deleteTitle = course?.title?.trim() || '该课程';
  const ownerId = Number(course?.owner);
  const expectedOwner = Number(data.expectedOwner || (Number.isFinite(ownerId) ? ownerId : 0) || 0);
  const initialOwner = data.ownerUser || (Number.isSafeInteger(ownerId) && ownerId > 0 ? { _id: ownerId } : null);

  const refreshFiles = async () => {
    if (!fileEndpoint) return;
    const files = readCourseFiles(await getJson(fileEndpoint, '课件列表刷新失败'));
    setCourseFiles(files);
  };

  const deleteFile = async (filename: string) => {
    if (!fileEndpoint) return;
    const accepted = await confirmDialog('删除后不能恢复。', {
      title: `删除课件「${filename}」？`,
      confirmLabel: '删除',
      destructive: true,
    });
    if (!accepted) return;
    setFileError('');
    const body = new URLSearchParams({ operation: 'delete_files' });
    body.append('files', filename);
    try {
      await postForm(fileEndpoint, body, '课件删除失败');
      setCourseFiles((current) => current.filter((file) => file.name !== filename));
    } catch (error) {
      console.error(error);
      setFileError(errorText(error, '课件删除失败'));
    }
  };

  const copyCourse = async () => {
    if (!saved || data.canCreate !== true || copying) return;
    const form = rootRef.current?.closest('form');
    if (!(form instanceof HTMLFormElement)) throw new TypeError('课程表单不存在');
    if (formSnapshot(form) !== cleanSnapshot.current) {
      setCopyError(SAVE_FIRST_COPY);
      return;
    }
    setCopyError('');
    setCopying(true);
    try {
      const body = await postForm(editAction, new URLSearchParams({ operation: 'copy' }), '课程复制失败');
      window.location.assign(`/course/${readCopiedCourseId(body)}/edit`);
    } catch (error) {
      console.error(error);
      setCopyError(errorText(error, '课程复制失败'));
      setCopying(false);
    }
  };

  const deleteCourse = () => {
    if (copying || confirmingDelete) return;
    setConfirmingDelete(true);
    void confirmDialog(DELETE_MESSAGE, {
      title: `删除课程「${deleteTitle}」？`,
      confirmLabel: '删除',
      destructive: true,
    })
      .then((accepted) => {
        if (!accepted) return;
        const form = document.getElementById(DELETE_FORM_ID);
        if (!(form instanceof HTMLFormElement)) throw new TypeError('课程删除表单不存在');
        form.submit();
      })
      .finally(() => {
        setConfirmingDelete(false);
      });
  };

  return (
    <>
      <div ref={rootRef} hidden={!active} className="flex max-w-3xl flex-col gap-6">
        <Panel title="基本信息">
          <div className="flex flex-col gap-4">
            <FormField inline label="标题" htmlFor="course-settings-title">
              <Input
                id="course-settings-title"
                name="title"
                defaultValue={course?.title || ''}
                required={active}
                onChange={() => onDirty()}
              />
            </FormField>
            <FormField inline label="学期" htmlFor="course-settings-term">
              <Input
                id="course-settings-term"
                name="term"
                defaultValue={course?.term || ''}
                placeholder="2026 秋"
                onChange={() => onDirty()}
              />
            </FormField>
            <FormField inline label="视频截止" htmlFor="course-settings-video-due">
              <Input
                id="course-settings-video-due"
                type="datetime-local"
                name="courseVideoDueAt"
                defaultValue={dueAtInputValue(course?.courseVideoDueAt)}
                onChange={() => onDirty()}
              />
            </FormField>
            <FormField inline label="课程简介">
              <MarkdownEditor name="content" value={course?.content || ''} minHeight={160} onChange={() => onDirty()} />
            </FormField>
          </div>
        </Panel>

        <Panel title="协作者">
          {saved && data.canAssign ? (
            <CourseAssignForm
              domainId={bootstrap.domain.id}
              action={editAction}
              expectedOwner={expectedOwner}
              initialOwner={initialOwner}
              initialMaintainers={data.maintainerUsers || []}
            />
          ) : (
            <p className="text-sm text-fg-muted">{saved ? '你不能修改这门课的协作者。' : '先保存课程，再指定协作者。'}</p>
          )}
        </Panel>

        {saved ? (
          <Panel title="真实性训练策略">
            <PracticeIntegrityPolicyPanel containerKind="course" containerId={courseId} />
          </Panel>
        ) : null}

        <Panel title="课件">
          <div className="flex flex-col gap-3">
            {fileError ? <Alert tone="danger">{fileError}</Alert> : null}
            {saved && data.canManageFiles ? (
              <FileUploader
                endpoint={fileEndpoint}
                maxFiles={10}
                uploadConcurrency={1}
                onBatchComplete={() => {
                  void refreshFiles().catch((error: unknown) => {
                    console.error(error);
                    setFileError(errorText(error, '课件列表刷新失败'));
                  });
                }}
              />
            ) : !saved ? (
              <p className="text-sm text-fg-muted">先保存课程，再上传课件。</p>
            ) : null}
            {courseFiles.length ? (
              <div className="flex flex-col gap-0.5">
                {courseFiles.map((file) => (
                  <div key={file.name} className="flex min-h-12 items-center gap-1 rounded-md pr-2">
                    <div className="min-w-0 flex-1">
                      <ul>
                        <CourseFileRow
                          name={file.name}
                          downloadHref={`/course/${courseId}/file/${encodeURIComponent(file.name)}`}
                          previewHref={`/course/${courseId}/file/${encodeURIComponent(file.name)}?preview=1`}
                        />
                      </ul>
                    </div>
                    {data.canManageFiles ? (
                      <Button
                        type="button"
                        variant="danger-soft"
                        size="sm"
                        iconOnly
                        className="shrink-0"
                        aria-label={`删除${file.name}`}
                        onClick={() => {
                          void deleteFile(file.name);
                        }}
                      >
                        <Trash2 aria-hidden="true" />
                      </Button>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </Panel>

        <Panel title="复制课程">
          <div className="flex flex-col gap-3">
            {copyError ? <Alert tone="danger">{copyError}</Alert> : null}
            <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
              <p className="min-w-0 flex-1 text-sm text-fg-muted">{COPY_NOTE}</p>
              <Button
                type="button"
                variant="secondary"
                className="shrink-0"
                disabled={!saved || data.canCreate !== true}
                loading={copying}
                onClick={() => {
                  void copyCourse();
                }}
              >
                <Copy aria-hidden="true" />
                复制为新课程
              </Button>
            </div>
          </div>
        </Panel>

        <Panel title="危险操作">
          {saved ? (
            <div className="flex min-w-0 items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-sm text-fg">删除这门课程</p>
                {confirmingDelete ? null : <p className="mt-0.5 text-xs text-fg-subtle">{DELETE_MESSAGE}</p>}
              </div>
              <Button type="button" variant="danger-soft" className="shrink-0" disabled={copying} onClick={deleteCourse}>
                <Trash2 aria-hidden="true" />
                删除课程
              </Button>
            </div>
          ) : (
            <p className="text-sm text-fg-muted">先保存课程，再删除。</p>
          )}
        </Panel>
      </div>
      {saved && typeof document !== 'undefined'
        ? createPortal(
            <form id={DELETE_FORM_ID} method="post" action={editAction}>
              <input type="hidden" name="operation" value="delete" />
            </form>,
            document.body,
          )
        : null}
    </>
  );
}
