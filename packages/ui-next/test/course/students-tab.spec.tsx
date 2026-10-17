import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentType } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { ChapterDraft, GroupRefView } from '../../src/pages/course/types.ts';
import type { CourseEditorPageData } from '../../src/pages/course/workbench/model.ts';

// A static import fails collection while students-tab.tsx is absent.
const tabLoaders = import.meta.glob('../../src/pages/course/workbench/students-tab.tsx');

const TAB_SOURCE = 'src/pages/course/workbench/students-tab.tsx';
const OWN = 'group-own';
const SCHOOL = 'group-school';
const ARCHIVED = 'group-archived';
const DELETED = 'group-deleted';
const DELETED_IDLE = 'group-deleted-idle';
const REMOVABLE = 'group-removable';
const COMBO = 'group-combo';
const NUMERIC = '101';
const CLASS_TITLE = '班级';
const CLASS_DESCRIPTION = '指定后只有这些用户组里已绑定的学生能看到和进入这门课；不指定则全站可见。';
const VISIBILITY_TITLE = '可见性';
const HIDE_LABEL = '对学生隐藏';
const HIDE_DESCRIPTION = '隐藏后学生看不到这门课，也不能进入；你和协作者仍然可以编辑。';
/** Old editor order: mergeCourseGroupOptions, then drop unselected deleted groups. Not the stored id list. */
const SELECTED_GROUPS = `${OWN},${NUMERIC},${DELETED},${COMBO}`;
const WITH_SCHOOL = `${SCHOOL},${SELECTED_GROUPS}`;
const WITHOUT_DELETED = `${SCHOOL},${OWN},${NUMERIC},${COMBO}`;

interface CourseStudentsTabProps {
  data: CourseEditorPageData;
  chapters: ChapterDraft[];
  onDirty: () => void;
  active: boolean;
}

interface RenderedStudents {
  container: HTMLElement;
  onDirty: ReturnType<typeof vi.fn>;
  unmount: () => void;
}

const CHAPTERS: ChapterDraft[] = [
  {
    _id: 1,
    title: '第 1 章',
    content: '',
    pids: [],
    videos: [],
    sections: [],
    tids: '',
  },
];

function group(partial: Omit<GroupRefView, 'schoolName'> & { schoolName?: string | null }): GroupRefView {
  return { schoolName: '学校甲', ...partial };
}

const own = group({ _id: OWN, name: '算法班', state: 'active', kind: 'own', attachable: true });
const school = group({ _id: SCHOOL, name: '学校班', state: 'active', kind: 'school', attachable: true });
const archived = group({ _id: ARCHIVED, name: '归档可见班', state: 'archived', kind: 'school', attachable: true });
const numeric = group({ _id: NUMERIC, name: '一班', state: 'active', kind: 'school', attachable: true });
const deleted = group({
  _id: DELETED,
  name: '已删但仍选中',
  schoolName: null,
  state: 'deleted',
  kind: 'unknown',
  attachable: false,
});
const deletedIdle = group({
  _id: DELETED_IDLE,
  name: '已删未选中',
  schoolName: null,
  state: 'deleted',
  kind: 'unknown',
  attachable: false,
});
const removable = group({
  _id: REMOVABLE,
  name: '同事班',
  state: 'active',
  kind: 'other-teacher',
  attachable: false,
});
const combo = group({
  _id: COMBO,
  name: '我的旧班',
  state: 'archived',
  kind: 'own',
  attachable: false,
});

const groupOptions: GroupRefView[] = [school, own, archived, numeric, deletedIdle, school];
const attachedGroups: GroupRefView[] = [deleted, combo, removable, own];

function readField(record: object, key: string): unknown {
  if (!(key in record)) return undefined;
  return Reflect.get(record, key) as unknown;
}

function asComponent(value: unknown): ComponentType<CourseStudentsTabProps> {
  expect(typeof value, 'CourseStudentsTab').toBe('function');
  if (typeof value !== 'function') throw new TypeError('CourseStudentsTab must be a function');
  return value as ComponentType<CourseStudentsTabProps>;
}

async function loadStudentsTab(): Promise<ComponentType<CourseStudentsTabProps>> {
  let load: unknown;
  for (const [key, candidate] of Object.entries(tabLoaders)) {
    if (key.endsWith(TAB_SOURCE)) load = candidate;
  }
  expect(typeof load, `${TAB_SOURCE} is missing`).toBe('function');
  if (typeof load !== 'function') throw new TypeError(`${TAB_SOURCE} is missing`);
  const imported: unknown = await load();
  if (typeof imported !== 'object' || imported === null) throw new TypeError(`${TAB_SOURCE} must be a module`);
  return asComponent(readField(imported, 'CourseStudentsTab'));
}

function pageData(course: { courseGroupIds?: Array<string | number>; courseHidden?: boolean }): CourseEditorPageData {
  return {
    page_name: 'course_edit',
    tdoc: {
      _id: 'course-1',
      docId: 'course-1',
      title: '测试课程',
      ...course,
    },
    groupOptions,
    attachedGroups,
    canManageOwnGroups: false,
    canManageFiles: false,
    canCreateQuiz: false,
    files: [],
    mindmaps: [],
  };
}

function formOf(container: HTMLElement): HTMLFormElement {
  const form = container.querySelector('form');
  if (!(form instanceof HTMLFormElement)) throw new TypeError('missing form');
  return form;
}

function posted(container: HTMLElement, name: string): string[] {
  const values: string[] = [];
  for (const value of new FormData(formOf(container)).getAll(name)) {
    if (typeof value !== 'string') throw new TypeError(`${name} must be a string field`);
    values.push(value);
  }
  return values;
}

function studentsRoot(container: HTMLElement): HTMLElement {
  const root = formOf(container).firstElementChild;
  if (!(root instanceof HTMLElement)) throw new TypeError('missing students tab');
  return root;
}

function expectTabFrame(root: HTMLElement, active: boolean): void {
  expect(root.hidden).toBe(!active);
  expect(root.classList.contains('flex')).toBe(true);
  expect(root.classList.contains('max-w-3xl')).toBe(true);
  expect(root.classList.contains('flex-col')).toBe(true);
  expect(root.classList.contains('gap-6')).toBe(true);
}

function groupSearch(container: HTMLElement): HTMLInputElement {
  const input = formOf(container).querySelector('input:not([type="hidden"]):not([role="switch"])');
  if (!(input instanceof HTMLInputElement)) throw new TypeError('missing group search');
  return input;
}

async function renderStudents(
  course: { courseGroupIds?: Array<string | number>; courseHidden?: boolean },
  active = true,
): Promise<RenderedStudents> {
  const CourseStudentsTab = await loadStudentsTab();
  const onDirty = vi.fn();
  const view = render(
    <form>
      <CourseStudentsTab data={pageData(course)} chapters={CHAPTERS} onDirty={onDirty} active={active} />
    </form>,
  );
  return { container: view.container, onDirty, unmount: view.unmount };
}

describe('course students tab', () => {
  it('posts courseGroupIds as one comma-separated field in the old editor order', async () => {
    const user = userEvent.setup();
    const view = await renderStudents({
      courseGroupIds: [COMBO, OWN, OWN, DELETED, 101],
    });

    expect(posted(view.container, 'courseGroupIds')).toEqual([SELECTED_GROUPS]);
    expect(posted(view.container, 'courseHidden')).toEqual(['false']);
    expect(view.onDirty).not.toHaveBeenCalled();
    expectTabFrame(studentsRoot(view.container), true);
    expect(screen.getByRole('heading', { name: CLASS_TITLE })).toBeInTheDocument();
    expect(screen.getByText(CLASS_DESCRIPTION)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: VISIBILITY_TITLE })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: HIDE_LABEL })).not.toBeChecked();
    expect(screen.getByText(HIDE_DESCRIPTION)).toBeInTheDocument();
    expect(screen.getByText('算法班（我的）')).toBeInTheDocument();
    expect(screen.getByText('一班')).toBeInTheDocument();
    expect(screen.getByText('已删除的组')).toBeInTheDocument();
    expect(screen.getByText('我的旧班（我的）（已归档）（仅可移除）')).toBeInTheDocument();
    expect(screen.queryByText('学校甲')).not.toBeInTheDocument();
    expect(screen.queryByText('已删但仍选中')).not.toBeInTheDocument();
    expect(screen.queryByText('已删未选中')).not.toBeInTheDocument();

    await user.click(groupSearch(view.container));
    expect(screen.getAllByRole('button', { name: '学校班' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: '归档可见班（已归档）' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: '同事班（仅可移除）' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: '已删除的组' })).toHaveLength(1);
    expect(screen.queryAllByRole('button', { name: '已删未选中' })).toHaveLength(0);
    expect(screen.getByRole('button', { name: '学校班' }).textContent ?? '').not.toContain('学校甲');
    expect(view.onDirty).not.toHaveBeenCalled();
  });

  it('posts an empty courseGroupIds and courseHidden false when neither is set', async () => {
    const omitted = await renderStudents({});
    expect(posted(omitted.container, 'courseGroupIds')).toEqual(['']);
    expect(posted(omitted.container, 'courseHidden')).toEqual(['false']);
    expect(screen.getByRole('switch', { name: HIDE_LABEL })).not.toBeChecked();
    expect(omitted.onDirty).not.toHaveBeenCalled();
    omitted.unmount();

    const explicit = await renderStudents({ courseGroupIds: [], courseHidden: false });
    expect(posted(explicit.container, 'courseGroupIds')).toEqual(['']);
    expect(posted(explicit.container, 'courseHidden')).toEqual(['false']);
    expect(explicit.onDirty).not.toHaveBeenCalled();
  });

  it('keeps both fields in the form while the inactive tab is hidden', async () => {
    const view = await renderStudents({
      courseGroupIds: [COMBO, OWN, DELETED, 101],
      courseHidden: true,
    }, false);

    expectTabFrame(studentsRoot(view.container), false);
    expect(posted(view.container, 'courseGroupIds')).toEqual([SELECTED_GROUPS]);
    expect(posted(view.container, 'courseHidden')).toEqual(['true']);
    expect(view.onDirty).not.toHaveBeenCalled();
  });

  it('updates the posted classes and calls onDirty when the selection changes', async () => {
    const user = userEvent.setup();
    const view = await renderStudents({
      courseGroupIds: [COMBO, OWN, DELETED, 101],
    });

    await user.click(groupSearch(view.container));
    await user.click(screen.getByRole('button', { name: '学校班' }));
    expect(posted(view.container, 'courseGroupIds')).toEqual([WITH_SCHOOL]);
    expect(view.onDirty).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: '已删除的组' }));
    expect(posted(view.container, 'courseGroupIds')).toEqual([WITHOUT_DELETED]);
    expect(screen.queryByRole('button', { name: '已删除的组' })).not.toBeInTheDocument();
    expect(screen.queryByText('已删除的组')).not.toBeInTheDocument();
    expect(view.onDirty).toHaveBeenCalledTimes(2);
  });

  it('updates courseHidden and calls onDirty when the switch changes', async () => {
    const user = userEvent.setup();
    const view = await renderStudents({ courseGroupIds: [OWN] });
    const hide = screen.getByRole('switch', { name: HIDE_LABEL });

    expect(posted(view.container, 'courseGroupIds')).toEqual([OWN]);
    expect(posted(view.container, 'courseHidden')).toEqual(['false']);
    await user.click(hide);
    expect(hide).toBeChecked();
    expect(posted(view.container, 'courseHidden')).toEqual(['true']);
    expect(posted(view.container, 'courseGroupIds')).toEqual([OWN]);
    expect(view.onDirty).toHaveBeenCalledTimes(1);

    await user.click(hide);
    expect(hide).not.toBeChecked();
    expect(posted(view.container, 'courseHidden')).toEqual(['false']);
    expect(view.onDirty).toHaveBeenCalledTimes(2);
  });
});
