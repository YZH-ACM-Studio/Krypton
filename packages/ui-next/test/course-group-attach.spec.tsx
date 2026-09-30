import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BootstrapProvider, type KryptonBootstrap } from '../src/lib/bootstrap.tsx';
import { CourseEditPage } from '../src/pages/course/editor.tsx';
import type { GroupRefView } from '../src/pages/course/types.ts';

const OWN = 'group-own';
const SCHOOL = 'group-school';
const ARCHIVED = 'group-archived';
const UNKNOWN = 'group-unknown';
const DEDUP = 'group-dedup';
const REMOVABLE = 'group-removable';
const COMBO = 'group-combo';
const DELETED = 'group-deleted';

function group(partial: Omit<GroupRefView, 'schoolName'> & { schoolName?: string | null }): GroupRefView {
  return { schoolName: '学校甲', ...partial };
}

const own = group({ _id: OWN, name: '算法班', state: 'active', kind: 'own', attachable: true });
const school = group({ _id: SCHOOL, name: '学校班', state: 'active', kind: 'school', attachable: true });
const archived = group({ _id: ARCHIVED, name: '归档可见班', state: 'archived', kind: 'school', attachable: true });
const unknown = group({ _id: UNKNOWN, name: '未知来源', state: 'active', kind: 'unknown', attachable: true });
const dedup = group({ _id: DEDUP, name: '去重班', state: 'active', kind: 'school', attachable: true });
const removable = group({
  _id: REMOVABLE,
  name: '同事班',
  state: 'active',
  kind: 'other-teacher',
  attachable: false,
});
const combo = group({ _id: COMBO, name: '我的旧班', state: 'archived', kind: 'own', attachable: false });
const deleted = group({
  _id: DELETED,
  name: null,
  schoolName: null,
  state: 'deleted',
  kind: 'unknown',
  attachable: false,
});

function editorData(canManageOwnGroups: boolean): unknown {
  return {
    page_name: 'course_edit',
    tdoc: {
      _id: 'course-1',
      docId: 'course-1',
      title: '测试课程',
      courseGroupIds: [OWN, UNKNOWN, DEDUP, DELETED, COMBO, REMOVABLE],
    },
    groupOptions: [own, school, archived, unknown, dedup, dedup],
    attachedGroups: [deleted, combo, removable, own, dedup],
    canManageOwnGroups,
    canManageFiles: false,
    canCreate: false,
    canCreateQuiz: false,
    canAssign: false,
    files: [],
    mindmaps: [],
  };
}

function pageBootstrap(data: unknown, role: string): KryptonBootstrap {
  return {
    appName: 'Krypton',
    siteName: 'Krypton OJ',
    locale: 'zh_CN',
    theme: 'light',
    generatedAt: '2026-09-30T00:00:00.000Z',
    user: {
      id: 7,
      name: 'teacher',
      mail: '',
      signedIn: true,
      theme: 'light',
      viewLang: 'zh_CN',
      unreadMessages: 0,
      rp: 0,
      bio: '',
      priv: 0,
      role,
      tfa: false,
      authn: false,
      pinnedDomains: [],
      canBrowseProblemBank: false,
    },
    domain: { id: 'system', name: '主域', bulletin: '', avatar: '' },
    urls: { home: '/' } as KryptonBootstrap['urls'],
    udict: {},
    page: { templateName: 'course_edit.html', data },
  };
}

function renderEditor(role: string, canManageOwnGroups: boolean) {
  return render(
    <BootstrapProvider bootstrap={pageBootstrap(editorData(canManageOwnGroups), role)}>
      <CourseEditPage />
    </BootstrapProvider>,
  );
}

function postedGroupIds(): string[] {
  const input = document.querySelector('#course-editor-form input[type="hidden"][name="courseGroupIds"]');
  if (!(input instanceof HTMLInputElement)) throw new Error('missing courseGroupIds');
  return input.value.split(',').filter((id) => id.length > 0);
}

function chipNodes(match: (text: string) => boolean): HTMLElement[] {
  return screen.queryAllByText((_, element) => {
    if (!element || !element.classList.contains('truncate') || element.closest('button')) return false;
    return match(element.textContent ?? '');
  });
}

function menuButtons(name: string | RegExp): HTMLElement[] {
  return screen.queryAllByRole('button', { name }).filter((button) => button.closest('#course-editor-form') == null);
}

function removeButtonForChip(match: (text: string) => boolean): HTMLButtonElement {
  const nodes = chipNodes(match);
  if (nodes.length !== 1) throw new Error(`expected one chip, found ${nodes.length}`);
  const button = nodes[0]?.parentElement?.querySelector('button[aria-label="移除"]');
  if (!(button instanceof HTMLButtonElement)) throw new Error('missing chip remove button');
  return button;
}

async function openGroupMenu(user: ReturnType<typeof userEvent.setup>) {
  const hidden = document.querySelector('#course-editor-form input[type="hidden"][name="courseGroupIds"]');
  if (!(hidden instanceof HTMLInputElement)) throw new Error('missing courseGroupIds');
  const input = hidden.parentElement?.querySelector('input:not([type="hidden"])');
  if (!(input instanceof HTMLInputElement)) throw new Error('missing group search');
  await user.click(input);
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(JSON.stringify({ published: null, draft: null }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    ),
  );
});

describe('course editor group attach', () => {
  it('renders every course group label from server fields', async () => {
    const user = userEvent.setup();
    renderEditor('default', true);
    expect(chipNodes((text) => text === '算法班（我的）')).toHaveLength(1);
    expect(chipNodes((text) => text === '同事班（仅可移除）')).toHaveLength(1);
    expect(chipNodes((text) => text === '我的旧班（我的）（已归档）（仅可移除）')).toHaveLength(1);
    expect(chipNodes((text) => text === '未知来源')).toHaveLength(1);
    await openGroupMenu(user);
    expect(menuButtons('归档可见班（已归档）')).toHaveLength(1);
    const schoolOption = menuButtons('学校班');
    expect(schoolOption).toHaveLength(1);
    expect(schoolOption[0]?.textContent ?? '').not.toContain('学校甲');
    expect(screen.queryByText('学校甲')).not.toBeInTheDocument();
  });

  it('shows an archived group that is not selected', async () => {
    const user = userEvent.setup();
    renderEditor('default', false);
    expect(postedGroupIds()).not.toContain(ARCHIVED);
    await openGroupMenu(user);
    expect(menuButtons(/归档可见班/)).toHaveLength(1);
  });

  it('dedupes groupOptions and attachedGroups by _id', async () => {
    const user = userEvent.setup();
    renderEditor('teacher', false);
    expect(postedGroupIds().filter((id) => id === DEDUP)).toEqual([DEDUP]);
    expect(chipNodes((text) => text === '去重班')).toHaveLength(1);
    await openGroupMenu(user);
    expect(menuButtons('去重班')).toHaveLength(1);
  });

  it('removes a deleted group labeled 已删除的组 and does not leave it selectable', async () => {
    const user = userEvent.setup();
    renderEditor('default', true);
    expect(chipNodes((text) => text === '已删除的组').map((node) => node.textContent)).toEqual(['已删除的组']);
    const before = postedGroupIds();
    expect(before).toContain(DELETED);
    await user.click(removeButtonForChip((text) => text === '已删除的组'));
    expect(chipNodes((text) => text === '已删除的组')).toHaveLength(0);
    expect(postedGroupIds()).toEqual(before.filter((id) => id !== DELETED));
    await openGroupMenu(user);
    expect(menuButtons('已删除的组')).toHaveLength(0);
    expect(screen.queryByText('已删除的组')).not.toBeInTheDocument();
  });

  it('keeps an attached unattachable group visible after it is unchecked', async () => {
    const user = userEvent.setup();
    renderEditor('teacher', false);
    const before = postedGroupIds();
    expect(before).toContain(REMOVABLE);
    await user.click(removeButtonForChip((text) => text.startsWith('同事班')));
    expect(postedGroupIds()).toEqual(before.filter((id) => id !== REMOVABLE));
    await openGroupMenu(user);
    expect(menuButtons(/同事班/)).toHaveLength(1);
  });

  it('shows 管理我的用户组 only when canManageOwnGroups is true', () => {
    const nonTeacher = renderEditor('default', true);
    expect(screen.getByRole('link', { name: '管理我的用户组' })).toHaveAttribute('href', '/user-groups');
    nonTeacher.unmount();

    const teacher = renderEditor('teacher', true);
    expect(screen.getByRole('link', { name: '管理我的用户组' })).toHaveAttribute('href', '/user-groups');
    teacher.unmount();

    renderEditor('teacher', false);
    expect(screen.queryByRole('link', { name: '管理我的用户组' })).not.toBeInTheDocument();
  });
});
