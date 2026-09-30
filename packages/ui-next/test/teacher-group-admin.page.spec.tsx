import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { BootstrapProvider, type KryptonBootstrap } from '../src/lib/bootstrap.tsx';
import { AdminUserbindGroupDetailPage, AdminUserbindGroupsPage, AdminUserbindSchoolDetailPage } from '../src/pages/userbind/index.tsx';

interface Ownership {
  ownerUid: number | null;
  ownerName: string | null;
  teacherAttachable: boolean;
}

interface GroupRow extends Ownership {
  _id: string;
  name: string;
  schoolId: string;
}

function renderPage(templateName: string, page: ReactElement, data: Record<string, unknown>) {
  const bootstrap: KryptonBootstrap = {
    appName: 'Krypton',
    siteName: 'Krypton OJ',
    locale: 'zh_CN',
    theme: 'light',
    generatedAt: '2026-09-30T00:00:00.000Z',
    user: { id: 2, name: 'root', signedIn: true, priv: 1 } as KryptonBootstrap['user'],
    domain: { id: 'system', name: '主域', bulletin: '', avatar: '' },
    urls: { home: '/' } as KryptonBootstrap['urls'],
    udict: {},
    page: { templateName, data },
  };
  return render(<BootstrapProvider bootstrap={bootstrap}>{page}</BootstrapProvider>);
}

function renderGroups(groups: GroupRow[]) {
  return renderPage('admin_userbind_groups.html', <AdminUserbindGroupsPage />, {
    schools: [{ _id: 'school-1', name: '中国民航大学' }],
    groups,
  });
}

function renderGroupDetail(group: Ownership & { _id: string; name: string }) {
  return renderPage('admin_userbind_group_detail.html', <AdminUserbindGroupDetailPage />, {
    group,
    school: { _id: 'school-1', name: '中国民航大学' },
    members: [],
    memberTotal: 0,
    page: 1,
    membersLimit: 50,
    unboundMemberCount: 0,
    groupTokens: [],
    searchResults: [],
    q: '',
    importReport: null,
    tab: 'overview',
  });
}

function renderSchool(staff: Array<{ uid: number; uname: string }>) {
  return renderPage('admin_userbind_school_detail.html', <AdminUserbindSchoolDetailPage />, {
    school: { _id: 'school-1', name: '中国民航大学' },
    staff,
    groups: [],
    groupTotal: 0,
    groupPage: 1,
    groupLimit: 20,
    groupQuery: '',
    students: [],
    studentTotal: 0,
    studentPage: 1,
    studentLimit: 50,
    studentQuery: '',
    schoolTokens: [],
    importSearchResults: [],
    importQ: '',
    tab: 'links',
    importReport: null,
  });
}

function typeCell(rowName: string): HTMLElement {
  const headers = screen.getAllByRole('columnheader').map((header) => header.textContent ?? '');
  const index = headers.indexOf('类型');
  if (index < 0) throw new Error('missing 类型 column');
  const row = screen.getByRole('row', { name: new RegExp(rowName) });
  const cell = within(row).getAllByRole('cell')[index];
  if (!cell) throw new Error(`missing 类型 cell for ${rowName}`);
  return cell;
}

function formOf(control: HTMLElement): HTMLFormElement {
  const form = control.closest('form');
  if (!(form instanceof HTMLFormElement)) throw new Error('control is not in a form');
  return form;
}

function fieldValue(form: HTMLFormElement, name: string): string {
  const input = [...form.querySelectorAll('input')].find((node) => node.name === name);
  if (!(input instanceof HTMLInputElement)) throw new Error(`missing ${name}`);
  return input.value;
}

function ownershipRegion(): HTMLElement {
  return screen.getByRole('region', { name: '用户组归属' });
}

describe('admin user group list', () => {
  it('labels a teacher group with the owner name and does not mark it open to teachers', () => {
    renderGroups([
      {
        _id: 'g-teacher',
        name: '计网1班',
        schoolId: 'school-1',
        ownerUid: 12,
        ownerName: '张老师',
        teacherAttachable: true,
      },
    ]);

    const cell = typeCell('计网1班');
    expect(within(cell).getByText('老师组 · 张老师')).toBeInTheDocument();
    expect(within(cell).queryByText('学校组')).not.toBeInTheDocument();
    expect(within(cell).queryByText('开放给老师')).not.toBeInTheDocument();
  });

  it('labels a teacher group without an owner name as 老师组 when ownerName is null', () => {
    renderGroups([
      {
        _id: 'g-null-name',
        name: '无名组',
        schoolId: 'school-1',
        ownerUid: 15,
        ownerName: null,
        teacherAttachable: false,
      },
    ]);

    const cell = typeCell('无名组');
    expect(within(cell).getByText('老师组')).toBeInTheDocument();
    expect(within(cell).queryByText(/老师组 ·/)).not.toBeInTheDocument();
    expect(within(cell).queryByText('15')).not.toBeInTheDocument();
    expect(within(cell).queryByText(/null|未知/)).not.toBeInTheDocument();
  });

  it('labels a teacher group without an owner name as 老师组 when ownerName is empty', () => {
    renderGroups([
      {
        _id: 'g-blank-name',
        name: '空名组',
        schoolId: 'school-1',
        ownerUid: 16,
        ownerName: '',
        teacherAttachable: false,
      },
    ]);

    const cell = typeCell('空名组');
    expect(within(cell).getByText('老师组')).toBeInTheDocument();
    expect(within(cell).queryByText(/老师组 ·/)).not.toBeInTheDocument();
  });

  it('labels an open school group and shows the teacher mark', () => {
    renderGroups([
      {
        _id: 'g-open',
        name: '校队',
        schoolId: 'school-1',
        ownerUid: null,
        ownerName: null,
        teacherAttachable: true,
      },
    ]);

    const cell = typeCell('校队');
    expect(within(cell).getByText('学校组')).toBeInTheDocument();
    expect(within(cell).getByText('开放给老师')).toBeInTheDocument();
    expect(within(cell).queryByText(/老师组/)).not.toBeInTheDocument();
  });

  it('labels a closed school group without the teacher mark', () => {
    renderGroups([
      {
        _id: 'g-closed',
        name: '年级组',
        schoolId: 'school-1',
        ownerUid: null,
        ownerName: null,
        teacherAttachable: false,
      },
    ]);

    const cell = typeCell('年级组');
    expect(within(cell).getByText('学校组')).toBeInTheDocument();
    expect(within(cell).queryByText('开放给老师')).not.toBeInTheDocument();
  });
});

describe('admin user group detail', () => {
  it('shows the attach switch for a school group and does not offer owner transfer', () => {
    renderGroupDetail({
      _id: 'g-school',
      name: '校队',
      ownerUid: null,
      ownerName: null,
      teacherAttachable: true,
    });

    const region = ownershipRegion();
    const toggle = within(region).getByRole('switch', { name: '开放给老师' });
    const form = formOf(toggle);
    expect(toggle).toBeChecked();
    expect(toggle).not.toHaveAttribute('name');
    expect(fieldValue(form, 'operation')).toBe('setTeacherAttachable');
    expect(fieldValue(form, 'value')).toBe('true');
    expect(within(region).queryByRole('button', { name: '转移所有者' })).not.toBeInTheDocument();
    expect(within(region).queryByRole('button', { name: '改为学校组' })).not.toBeInTheDocument();
    expect(within(region).queryByLabelText('新所有者 UID')).not.toBeInTheDocument();
  });

  it('posts false when a school group is not open to teachers', () => {
    renderGroupDetail({
      _id: 'g-school',
      name: '年级组',
      ownerUid: null,
      ownerName: null,
      teacherAttachable: false,
    });

    const region = ownershipRegion();
    const toggle = within(region).getByRole('switch', { name: '开放给老师' });
    expect(toggle).not.toBeChecked();
    expect(fieldValue(formOf(toggle), 'value')).toBe('false');
    expect(within(region).queryByRole('button', { name: '转移所有者' })).not.toBeInTheDocument();
  });

  it('updates the posted attach value when the switch is toggled', async () => {
    const user = userEvent.setup();
    renderGroupDetail({
      _id: 'g-school',
      name: '校队',
      ownerUid: null,
      ownerName: null,
      teacherAttachable: true,
    });

    const toggle = within(ownershipRegion()).getByRole('switch', { name: '开放给老师' });
    const form = formOf(toggle);
    await user.click(toggle);
    expect(toggle).not.toBeChecked();
    expect(fieldValue(form, 'operation')).toBe('setTeacherAttachable');
    expect(fieldValue(form, 'value')).toBe('false');
  });

  it('shows the owner and transfer form for a teacher group and hides the attach switch', () => {
    renderGroupDetail({
      _id: 'g-teacher',
      name: '计网1班',
      ownerUid: 12,
      ownerName: '张老师',
      teacherAttachable: true,
    });

    const region = ownershipRegion();
    expect(within(region).getByText('所有者：张老师（UID 12）')).toBeInTheDocument();
    expect(within(region).queryByRole('switch', { name: '开放给老师' })).not.toBeInTheDocument();
    expect(within(region).queryByText('开放给老师')).not.toBeInTheDocument();
    const transfer = formOf(within(region).getByRole('button', { name: '转移所有者' }));
    expect(fieldValue(transfer, 'operation')).toBe('transferOwner');
    expect(within(region).getByLabelText('新所有者 UID')).toHaveAttribute('name', 'ownerUid');
    const clear = formOf(within(region).getByRole('button', { name: '改为学校组' }));
    expect(fieldValue(clear, 'operation')).toBe('clearOwner');
  });

  it('shows only the owner uid when ownerName is null', () => {
    renderGroupDetail({
      _id: 'g-teacher',
      name: '无名组',
      ownerUid: 15,
      ownerName: null,
      teacherAttachable: false,
    });

    const region = ownershipRegion();
    expect(within(region).getByText('所有者：UID 15')).toBeInTheDocument();
    expect(within(region).queryByText(/null|未知|老师组 ·/)).not.toBeInTheDocument();
    expect(within(region).queryByRole('switch', { name: '开放给老师' })).not.toBeInTheDocument();
  });

  it('shows only the owner uid when ownerName is empty', () => {
    renderGroupDetail({
      _id: 'g-teacher',
      name: '空名组',
      ownerUid: 16,
      ownerName: '',
      teacherAttachable: false,
    });

    const region = ownershipRegion();
    expect(within(region).getByText('所有者：UID 16')).toBeInTheDocument();
    expect(within(region).queryByText('（UID 16）')).not.toBeInTheDocument();
  });

  it('asks for confirmation before clearing the owner', async () => {
    const user = userEvent.setup();
    const submit = vi.spyOn(HTMLFormElement.prototype, 'submit').mockImplementation(() => {});
    renderGroupDetail({
      _id: 'g-teacher',
      name: '计网1班',
      ownerUid: 12,
      ownerName: '张老师',
      teacherAttachable: false,
    });

    await user.click(within(ownershipRegion()).getByRole('button', { name: '改为学校组' }));
    const dialog = screen.getByRole('dialog', { name: '改为学校组确认' });
    expect(dialog).toHaveTextContent('确认把用户组「计网1班」改为学校组？');
    expect(submit).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole('button', { name: '取消' }));
    expect(submit).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await user.click(within(ownershipRegion()).getByRole('button', { name: '改为学校组' }));
    await user.click(within(screen.getByRole('dialog', { name: '改为学校组确认' })).getByRole('button', { name: '改为学校组' }));
    expect(submit).toHaveBeenCalledTimes(1);
  });
});

describe('admin school staff', () => {
  it('lists teachers and posts an add form with uid', () => {
    renderSchool([
      { uid: 12, uname: '张老师' },
      { uid: 7, uname: '' },
    ]);

    const region = screen.getByRole('region', { name: '本校教师' });
    expect(within(region).getByText('张老师')).toBeInTheDocument();
    expect(within(region).getByText('UID 12')).toBeInTheDocument();
    expect(within(region).getByText('UID 7')).toBeInTheDocument();
    expect(within(region).queryByText(/未知|用户7|未命名/)).not.toBeInTheDocument();

    const named = within(region).getByText('张老师').closest('li');
    if (!(named instanceof HTMLElement)) throw new Error('missing named staff row');
    expect(fieldValue(formOf(within(named).getByRole('button', { name: '移除' })), 'operation')).toBe('removeStaff');
    expect(fieldValue(formOf(within(named).getByRole('button', { name: '移除' })), 'uid')).toBe('12');

    const blank = within(region).getByText('UID 7').closest('li');
    if (!(blank instanceof HTMLElement)) throw new Error('missing blank staff row');
    expect(fieldValue(formOf(within(blank).getByRole('button', { name: '移除' })), 'uid')).toBe('7');

    const add = formOf(within(region).getByRole('button', { name: '添加教师' }));
    expect(fieldValue(add, 'operation')).toBe('addStaff');
    expect(within(region).getByLabelText('用户 UID')).toHaveAttribute('name', 'uid');
  });

  it('shows an empty staff list without a remove button', () => {
    renderSchool([]);

    const region = screen.getByRole('region', { name: '本校教师' });
    expect(within(region).getByText('还没有本校教师。')).toBeInTheDocument();
    expect(within(region).queryByRole('button', { name: '移除' })).not.toBeInTheDocument();
    expect(fieldValue(formOf(within(region).getByRole('button', { name: '添加教师' })), 'operation')).toBe('addStaff');
  });

  it('asks for confirmation before removing a teacher', async () => {
    const user = userEvent.setup();
    const submit = vi.spyOn(HTMLFormElement.prototype, 'submit').mockImplementation(() => {});
    renderSchool([{ uid: 12, uname: '张老师' }]);

    const region = screen.getByRole('region', { name: '本校教师' });
    await user.click(within(region).getByRole('button', { name: '移除' }));
    const dialog = screen.getByRole('dialog', { name: '移除确认' });
    expect(dialog).toHaveTextContent('确认将「张老师」（UID 12）从本校教师名单中移除？');
    expect(submit).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole('button', { name: '取消' }));
    expect(submit).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await user.click(within(region).getByRole('button', { name: '移除' }));
    await user.click(within(screen.getByRole('dialog', { name: '移除确认' })).getByRole('button', { name: '移除' }));
    expect(submit).toHaveBeenCalledTimes(1);
  });
});
