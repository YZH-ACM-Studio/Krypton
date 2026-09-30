import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { BootstrapProvider, type KryptonBootstrap } from '../src/lib/bootstrap.tsx';
import { CoursePage } from '../src/pages/course/list.tsx';
import { PageResolver } from '../src/pages/resolver.tsx';
import { TeacherUserGroupDetailPage, TeacherUserGroupsPage } from '../src/pages/userbind/teacher-groups.tsx';

interface DetailGroup {
  _id: string;
  name: string;
  schoolId: string;
  schoolName: string;
  archived: boolean;
}

interface DetailMember {
  _id: string;
  studentId: string;
  realName: string;
  bound: boolean;
  deletable: boolean;
}

interface DetailCandidate {
  _id: string;
  studentId: string;
  realName: string;
  bound: boolean;
}

interface ImportReport {
  created: number;
  attached: number;
  alreadyMember: number;
  autoBound: number;
  alreadyBound: number;
  failed: Array<{ studentId: string; reason: string }>;
  autoBindSkipped: Array<{ studentId: string; reason: string }>;
}

interface DetailFixture {
  group: DetailGroup;
  members: DetailMember[];
  candidates: DetailCandidate[];
  q: string;
  importReport: ImportReport | null;
}

interface ListFixture {
  schools: Array<{ _id: string; name: string }>;
  groups: Array<{
    _id: string;
    name: string;
    schoolId: string;
    schoolName: string;
    archived: boolean;
    memberCount: number;
  }>;
  noScopeMessage: string | null;
}

function pageBootstrap(templateName: string, data: unknown): KryptonBootstrap {
  return {
    appName: 'Krypton',
    siteName: 'Krypton OJ',
    locale: 'zh_CN',
    theme: 'light',
    generatedAt: '2026-09-30T00:00:00.000Z',
    user: {
      id: 7,
      name: 'student',
      mail: '',
      signedIn: true,
      theme: 'light',
      viewLang: 'zh_CN',
      unreadMessages: 0,
      rp: 0,
      bio: '',
      priv: 0,
      role: 'default',
      tfa: false,
      authn: false,
      pinnedDomains: [],
      canBrowseProblemBank: false,
    },
    domain: { id: 'system', name: '主域', bulletin: '', avatar: '' },
    urls: { home: '/' } as KryptonBootstrap['urls'],
    udict: {},
    page: { templateName, data },
  };
}

function listPayload(noScopeMessage: string | null = null): ListFixture {
  return {
    noScopeMessage,
    schools: [
      { _id: 'school-1', name: '民航大学' },
      { _id: 'school-2', name: '另一所学校' },
    ],
    groups: [
      { _id: 'group-1', name: '计网1班', schoolId: 'school-1', schoolName: '民航大学', archived: false, memberCount: 4 },
      { _id: 'group-2', name: '已结课班', schoolId: 'school-1', schoolName: '民航大学', archived: true, memberCount: 0 },
    ],
  };
}

function detailPayload(patch: Partial<DetailFixture> = {}): DetailFixture {
  return {
    group: {
      _id: 'group-1',
      name: '计网1班',
      schoolId: 'school-1',
      schoolName: '民航大学',
      archived: false,
    },
    members: [
      { _id: 'rec-1', studentId: '20240001', realName: '张三', bound: false, deletable: false },
      { _id: 'rec-2', studentId: '20240002', realName: '李四', bound: true, deletable: true },
    ],
    candidates: [{ _id: 'rec-3', studentId: '20240003', realName: '王五', bound: false }],
    q: '王',
    importReport: null,
    ...patch,
  };
}

const importReport: ImportReport = {
  created: 2,
  attached: 5,
  alreadyMember: 7,
  autoBound: 11,
  alreadyBound: 13,
  failed: [{ studentId: '20240009', reason: '姓名不一致' }],
  autoBindSkipped: [{ studentId: '20240010', reason: '学号已被占用' }],
};

function renderList(data: unknown) {
  return render(
    <BootstrapProvider bootstrap={pageBootstrap('teacher_user_groups.html', data)}>
      <TeacherUserGroupsPage />
    </BootstrapProvider>,
  );
}

function renderDetail(data: unknown) {
  return render(
    <BootstrapProvider bootstrap={pageBootstrap('teacher_user_group_detail.html', data)}>
      <TeacherUserGroupDetailPage />
    </BootstrapProvider>,
  );
}

function operationValue(form: Element | null): string | null {
  return form?.querySelector('input[name="operation"]')?.getAttribute('value') ?? null;
}

function exactText(name: string): RegExp {
  return new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);
}

async function expectConfirmBeforeSubmit(triggerName: string, dialogName: string, confirmName: string, message: string) {
  const user = userEvent.setup();
  const submit = vi.spyOn(HTMLFormElement.prototype, 'submit').mockImplementation(() => {});
  const prevented: boolean[] = [];
  const onSubmit = (event: Event) => {
    prevented.push(event.defaultPrevented);
  };
  document.addEventListener('submit', onSubmit);
  try {
    await user.click(screen.getByRole('button', { name: exactText(triggerName) }));
    const dialog = screen.getByRole('dialog', { name: dialogName });
    expect(dialog).toHaveTextContent(message);
    expect(prevented).toEqual([true]);
    expect(submit).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: exactText('取消') }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(submit).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: exactText(triggerName) }));
    await user.click(screen.getByRole('button', { name: exactText(confirmName) }));
    expect(submit).toHaveBeenCalledTimes(1);
  } finally {
    document.removeEventListener('submit', onSubmit);
    submit.mockRestore();
  }
}

describe('teacher user group list', () => {
  it('renders only the hint when noScopeMessage is non-empty', () => {
    renderList(listPayload('范围提示-仅此一句'));
    expect(screen.getByText('范围提示-仅此一句')).toBeInTheDocument();
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByText('计网1班')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('学校')).not.toBeInTheDocument();
  });

  it('shows the create form and group table when noScopeMessage is null', () => {
    renderList(listPayload(null));
    const create = screen.getByRole('button', { name: '创建用户组' }).closest('form');
    expect(create?.getAttribute('method')).toBe('post');
    expect(create?.getAttribute('action')).toBe('/user-groups');
    expect(operationValue(create)).toBe('create');
    expect(screen.getByLabelText('用户组名称')).toHaveAttribute('name', 'name');
    const school = screen.getByLabelText('学校');
    expect(school).toHaveAttribute('name', 'schoolId');
    expect(school).toHaveValue('');
    expect(within(school).getByRole('option', { name: '民航大学' })).toHaveAttribute('value', 'school-1');
    expect(within(school).getByRole('option', { name: '另一所学校' })).toHaveAttribute('value', 'school-2');
    expect(within(school).getByRole('option', { name: '选择学校' })).toBeDisabled();

    const active = screen.getByRole('row', { name: /计网1班/ });
    expect(within(active).getByRole('link', { name: '计网1班' })).toHaveAttribute('href', '/user-groups/group-1');
    expect(within(active).getByText('民航大学')).toBeInTheDocument();
    expect(within(active).getByText('4')).toBeInTheDocument();
    expect(within(active).getByText('未归档')).toBeInTheDocument();

    const archived = screen.getByRole('row', { name: /已结课班/ });
    expect(within(archived).getByRole('link', { name: '已结课班' })).toHaveAttribute('href', '/user-groups/group-2');
    expect(within(archived).getByText('0')).toBeInTheDocument();
    expect(within(archived).getByText('已归档')).toBeInTheDocument();
  });

  it('treats an empty noScopeMessage as absent and still shows the form', () => {
    renderList(listPayload(''));
    expect(screen.getByRole('button', { name: '创建用户组' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '计网1班' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '范围提示-仅此一句' })).not.toBeInTheDocument();
  });

  it('rejects a list payload that omits noScopeMessage', () => {
    const payload = listPayload(null);
    expect(() => renderList({ schools: payload.schools, groups: payload.groups })).toThrow(/noScopeMessage/);
  });

  it('rejects a noScopeMessage that is not a string or null', () => {
    expect(() => renderList({ ...listPayload(null), noScopeMessage: 1 })).toThrow(/noScopeMessage/);
  });
});

describe('teacher user group detail', () => {
  it('shows 删除这条记录 only when deletable is true, not when the record is unbound', () => {
    renderDetail(detailPayload());
    const unbound = screen.getByRole('row', { name: /20240001/ });
    expect(within(unbound).getByText('未绑定')).toBeInTheDocument();
    expect(within(unbound).queryByRole('button', { name: '删除这条记录' })).not.toBeInTheDocument();
    const removable = within(unbound).getByRole('checkbox', { name: '移出 20240001 张三' });
    expect(removable).toHaveAttribute('name', 'studentRecordIds');
    expect(removable).toHaveAttribute('value', 'rec-1');
    expect(removable).toHaveAttribute('form', 'teacher-group-remove-members');

    const deletable = screen.getByRole('row', { name: /20240002/ });
    expect(within(deletable).getByText('已绑定')).toBeInTheDocument();
    const trigger = within(deletable).getByRole('button', { name: exactText('删除这条记录') });
    const form = trigger.closest('form');
    expect(form?.getAttribute('action')).toBe('/user-groups/group-1');
    expect(operationValue(form)).toBe('deleteStudent');
    expect(form?.querySelector('input[name="studentRecordId"]')?.getAttribute('value')).toBe('rec-2');
  });

  it('rejects a member whose deletable is not boolean', () => {
    const payload = detailPayload();
    expect(() =>
      renderDetail({
        ...payload,
        members: [{ ...payload.members[0], deletable: 'yes' }, payload.members[1]],
      }),
    ).toThrow(/deletable/);
  });

  it('asks before deleting the group, and only then submits', async () => {
    renderDetail(detailPayload());
    const form = screen.getByRole('button', { name: exactText('删除用户组') }).closest('form');
    expect(form?.getAttribute('action')).toBe('/user-groups/group-1');
    expect(operationValue(form)).toBe('delete');
    await expectConfirmBeforeSubmit('删除用户组', '删除用户组', '确认删除用户组', '确认删除用户组「计网1班」？该操作无法恢复。');
  });

  it('asks before deleting a student record, and only then submits', async () => {
    renderDetail(detailPayload());
    await expectConfirmBeforeSubmit(
      '删除这条记录',
      '删除学生记录',
      '确认删除记录',
      '确认删除学生记录「20240002 李四」？该操作无法恢复。',
    );
  });

  it('asks before clearing members, and only then submits', async () => {
    renderDetail(detailPayload());
    const form = screen.getByRole('button', { name: exactText('清空成员') }).closest('form');
    expect(operationValue(form)).toBe('clearMembers');
    await expectConfirmBeforeSubmit(
      '清空成员',
      '清空成员',
      '确认清空成员',
      '确认清空用户组「计网1班」的全部成员？学生记录不会被删除。',
    );
  });

  it('archives directly and swaps to unarchive when the group is archived', async () => {
    const user = userEvent.setup();
    const prevented: boolean[] = [];
    const onSubmit = (event: Event) => {
      prevented.push(event.defaultPrevented);
    };
    document.addEventListener('submit', onSubmit);
    try {
      const view = renderDetail(detailPayload());
      const archiveForm = screen.getByRole('button', { name: exactText('归档') }).closest('form');
      expect(operationValue(archiveForm)).toBe('archive');
      await user.click(screen.getByRole('button', { name: exactText('归档') }));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(prevented).toEqual([false]);

      view.rerender(
        <BootstrapProvider
          bootstrap={pageBootstrap(
            'teacher_user_group_detail.html',
            detailPayload({
              group: { _id: 'group-1', name: '计网1班', schoolId: 'school-1', schoolName: '民航大学', archived: true },
            }),
          )}
        >
          <TeacherUserGroupDetailPage />
        </BootstrapProvider>,
      );
      const unarchiveForm = screen.getByRole('button', { name: exactText('取消归档') }).closest('form');
      expect(operationValue(unarchiveForm)).toBe('unarchive');
      expect(screen.queryByRole('button', { name: exactText('归档') })).not.toBeInTheDocument();
    } finally {
      document.removeEventListener('submit', onSubmit);
    }
  });

  it('posts rename, remove, search, add, and import with the contract field names', () => {
    renderDetail(detailPayload());
    const rename = screen.getByRole('button', { name: '保存名称' }).closest('form');
    expect(rename?.getAttribute('method')).toBe('post');
    expect(rename?.getAttribute('action')).toBe('/user-groups/group-1');
    expect(operationValue(rename)).toBe('rename');
    expect(screen.getByLabelText('用户组名称')).toHaveAttribute('name', 'name');
    expect(screen.getByLabelText('用户组名称')).toHaveValue('计网1班');

    const remove = screen.getByRole('button', { name: '移出选中成员' }).closest('form');
    expect(remove?.getAttribute('id')).toBe('teacher-group-remove-members');
    expect(operationValue(remove)).toBe('remove');

    const search = screen.getByRole('button', { name: '搜索' }).closest('form');
    expect(search?.getAttribute('method')).toBe('get');
    expect(search?.getAttribute('action')).toBe('/user-groups/group-1');
    expect(screen.getByLabelText('搜索学生')).toHaveAttribute('name', 'q');
    expect(screen.getByLabelText('搜索学生')).toHaveValue('王');

    const add = screen.getByRole('button', { name: '加入选中学生' }).closest('form');
    expect(add?.getAttribute('method')).toBe('post');
    expect(add?.getAttribute('action')).toBe('/user-groups/group-1');
    expect(operationValue(add)).toBe('add');
    const candidate = screen.getByRole('checkbox', { name: '加入 20240003 王五' });
    expect(candidate).toHaveAttribute('name', 'studentRecordIds');
    expect(candidate).toHaveAttribute('value', 'rec-3');
    expect(candidate.closest('form')).toBe(add);
    expect(within(screen.getByRole('row', { name: /20240003/ })).getByText('未绑定')).toBeInTheDocument();

    const importForm = screen.getByRole('button', { name: '导入' }).closest('form');
    expect(operationValue(importForm)).toBe('importText');
    expect(screen.getByLabelText('学号和姓名')).toHaveAttribute('name', 'text');
    expect(screen.queryByRole('heading', { name: '导入结果' })).not.toBeInTheDocument();
  });

  it('renders importReport counts and the failed and skipped rows', () => {
    renderDetail(detailPayload({ importReport }));
    expect(screen.getByRole('heading', { name: '导入结果' })).toBeInTheDocument();
    expect(screen.getByText('新建 2')).toBeInTheDocument();
    expect(screen.getByText('加入已有 5')).toBeInTheDocument();
    expect(screen.getByText('已是成员 7')).toBeInTheDocument();
    expect(screen.getByText('自动绑定 11')).toBeInTheDocument();
    expect(screen.getByText('已经绑定 13')).toBeInTheDocument();
    const failed = screen.getByRole('table', { name: '导入失败' });
    expect(within(failed).getByText('20240009')).toBeInTheDocument();
    expect(within(failed).getByText('姓名不一致')).toBeInTheDocument();
    const skipped = screen.getByRole('table', { name: '自动绑定跳过' });
    expect(within(skipped).getByText('20240010')).toBeInTheDocument();
    expect(within(skipped).getByText('学号已被占用')).toBeInTheDocument();
  });
});

describe('teacher user group entry points', () => {
  it('puts 我的用户组 at the top of the course list without a teacher role check', () => {
    render(
      <BootstrapProvider bootstrap={pageBootstrap('course_main.html', {})}>
        <CoursePage />
      </BootstrapProvider>,
    );
    const link = screen.getByRole('link', { name: '我的用户组' });
    const heading = screen.getByRole('heading', { name: '课程' });
    expect(link).toHaveAttribute('href', '/user-groups');
    expect(link.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('maps the two teacher group templates onto the teacher pages', () => {
    const view = render(
      <BootstrapProvider bootstrap={pageBootstrap('teacher_user_groups.html', listPayload(null))}>
        <PageResolver />
      </BootstrapProvider>,
    );
    expect(screen.getByRole('link', { name: '计网1班' })).toHaveAttribute('href', '/user-groups/group-1');
    expect(screen.queryByRole('button', { name: '删除用户组' })).not.toBeInTheDocument();

    view.rerender(
      <BootstrapProvider bootstrap={pageBootstrap('teacher_user_group_detail.html', detailPayload())}>
        <PageResolver />
      </BootstrapProvider>,
    );
    expect(screen.getByRole('button', { name: '删除用户组' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '创建用户组' })).not.toBeInTheDocument();
  });
});
