// A static import fails collection while src/pages/course/workbench/exam-tab.tsx is absent.
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { ChapterDraft, CourseExamBinding } from '../../src/pages/course/types.ts';
import type { CourseEditorPageData } from '../../src/pages/course/workbench/model.ts';

const tabLoaders = import.meta.glob('../../src/pages/course/workbench/exam-tab.tsx');
const TAB_SOURCE = 'src/pages/course/workbench/exam-tab.tsx';

const CONTEST_ID = '6aaccbf482d5641e9491a12b';
const CONTEST_TITLE = '实验室安全结业考试';
const PANEL_TITLE = '结业考试';
const PANEL_DESCRIPTION = '绑定一场整卷作答的考试作为结业考试，并设置学生看完多少视频后才能进入。';

const COURSE_EXAM_FIELD_NAMES = [
  'courseExamContestId',
  'courseExamGate',
  'courseExamPercent',
  'courseExamChapterId',
] as const;

type CourseExamFieldName = (typeof COURSE_EXAM_FIELD_NAMES)[number];

interface CourseExamTabProps {
  data: CourseEditorPageData;
  chapters: ChapterDraft[];
  onDirty: () => void;
  active: boolean;
}

function readField(record: object, key: string): unknown {
  if (!(key in record)) return undefined;
  return Reflect.get(record, key) as unknown;
}

function tabLoader(): (() => Promise<unknown>) | undefined {
  for (const [key, load] of Object.entries(tabLoaders)) {
    if (!key.endsWith(TAB_SOURCE)) continue;
    if (typeof load !== 'function') return undefined;
    return load as () => Promise<unknown>;
  }
  return undefined;
}

async function loadCourseExamTab(): Promise<(props: CourseExamTabProps) => ReactElement> {
  const load = tabLoader();
  expect(typeof load, `${TAB_SOURCE} is missing`).toBe('function');
  if (typeof load !== 'function') throw new TypeError(`${TAB_SOURCE} is missing`);
  const imported: unknown = await load();
  if (typeof imported !== 'object' || imported === null) throw new TypeError(`${TAB_SOURCE} must be a module`);
  const component = readField(imported, 'CourseExamTab');
  expect(typeof component, 'CourseExamTab').toBe('function');
  if (typeof component !== 'function') throw new TypeError('CourseExamTab must be a function');
  return component as (props: CourseExamTabProps) => ReactElement;
}

function chapter(id: number, title: string): ChapterDraft {
  return {
    _id: id,
    title,
    content: '',
    pids: [],
    videos: [],
    sections: [],
    tids: '',
  };
}

function pageData(exam: CourseExamBinding | null): CourseEditorPageData {
  const data: CourseEditorPageData = {
    page_name: 'course_edit',
    tdoc: {
      title: '实验室安全',
      ...(exam ? { courseExam: exam } : {}),
    },
    groupOptions: [],
    attachedGroups: [],
    canManageOwnGroups: false,
    canManageFiles: false,
    canCreateQuiz: false,
    files: [],
    mindmaps: [],
  };
  if (exam?.contestId) {
    data.courseExamContest = {
      docId: exam.contestId,
      title: CONTEST_TITLE,
    };
  }
  return data;
}

function courseChapters(): ChapterDraft[] {
  return [chapter(1, '第一章'), chapter(2, '第二章')];
}

function courseExamFields(form: HTMLFormElement): Partial<Record<CourseExamFieldName, string>> {
  const data = new FormData(form);
  const fields: Partial<Record<CourseExamFieldName, string>> = {};
  for (const name of COURSE_EXAM_FIELD_NAMES) {
    const value = data.get(name);
    if (typeof value === 'string') fields[name] = value;
  }
  return fields;
}

function formElement(container: HTMLElement): HTMLFormElement {
  const form = container.querySelector('form');
  if (!(form instanceof HTMLFormElement)) throw new TypeError('missing form');
  return form;
}

function isUnderHidden(node: HTMLElement): boolean {
  return node.closest('[hidden]') instanceof HTMLElement;
}

async function renderTab(active: boolean, exam: CourseExamBinding | null, onDirty: () => void) {
  const CourseExamTab = await loadCourseExamTab();
  const view = render(
    <form>
      <CourseExamTab
        data={pageData(exam)}
        chapters={courseChapters()}
        onDirty={onDirty}
        active={active}
      />
    </form>,
  );
  return { form: formElement(view.container) };
}

describe('course exam tab', () => {
  it('puts the old courseExam fields in the form for a percent gate', async () => {
    const { form } = await renderTab(true, {
      contestId: CONTEST_ID,
      gate: 'percent',
      percent: 80,
    }, vi.fn());

    const heading = screen.getByRole('heading', { name: PANEL_TITLE });
    expect(heading.textContent).toBe(PANEL_TITLE);
    expect(isUnderHidden(heading)).toBe(false);
    expect(screen.getByText(PANEL_DESCRIPTION).textContent).toBe(PANEL_DESCRIPTION);
    expect(screen.getByText(CONTEST_TITLE).textContent).toBe(CONTEST_TITLE);
    expect(screen.getByText('观看门槛').textContent).toBe('观看门槛');
    expect(courseExamFields(form)).toEqual({
      courseExamContestId: CONTEST_ID,
      courseExamGate: 'percent',
      courseExamPercent: '80',
    });
  });

  it('puts courseExamChapterId in the form for a chapter gate', async () => {
    const { form } = await renderTab(true, {
      contestId: CONTEST_ID,
      gate: 'chapter',
      chapterId: 2,
    }, vi.fn());

    expect(courseExamFields(form)).toEqual({
      courseExamContestId: CONTEST_ID,
      courseExamGate: 'chapter',
      courseExamChapterId: '2',
    });
  });

  it('submits only courseExamContestId when the course has no exam', async () => {
    const { form } = await renderTab(true, null, vi.fn());

    expect(screen.queryByText('观看门槛')).toBeNull();
    expect(courseExamFields(form)).toEqual({
      courseExamContestId: '',
    });
  });

  it('keeps the courseExam fields while the inactive tab stays hidden', async () => {
    const { form } = await renderTab(false, { contestId: CONTEST_ID, gate: 'all' }, vi.fn());

    const heading = screen.getByRole('heading', { name: PANEL_TITLE, hidden: true });
    expect(isUnderHidden(heading)).toBe(true);
    expect(courseExamFields(form)).toEqual({
      courseExamContestId: CONTEST_ID,
      courseExamGate: 'all',
    });
  });

  it('calls onDirty and adds courseExamPercent after the watch gate changes', async () => {
    const onDirty = vi.fn();
    const { form } = await renderTab(true, { contestId: CONTEST_ID, gate: 'all' }, onDirty);
    expect(onDirty).not.toHaveBeenCalled();

    const user = userEvent.setup();
    await user.click(screen.getByRole('radio', { name: /整课百分比/ }));

    expect(onDirty).toHaveBeenCalledTimes(1);
    expect(courseExamFields(form)).toEqual({
      courseExamContestId: CONTEST_ID,
      courseExamGate: 'percent',
      courseExamPercent: '100',
    });
  });
});
