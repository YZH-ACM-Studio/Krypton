import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { BootstrapProvider, type KryptonBootstrap } from '../src/lib/bootstrap.tsx';
import { AdminCollectEditPage } from '../src/pages/admin-collect/index.tsx';

const UID = 7;
const SCHOOL_A = 'school-a';
const SCHOOL_B = 'school-b';
const LIVE = 'group-live';
const OTHER = 'group-other';
const ARCHIVED = 'group-archived';
const DELETED = 'group-deleted';
const UNATTACHABLE = 'group-unattachable';

interface EditorGroup {
  _id: string;
  name: string;
  schoolId?: string;
  archivedAt?: string;
}

function savedGroups(): EditorGroup[] {
  return [
    { _id: LIVE, schoolId: SCHOOL_A, name: '一班' },
    { _id: OTHER, schoolId: SCHOOL_B, name: '二班' },
    { _id: ARCHIVED, schoolId: SCHOOL_A, name: '归档班', archivedAt: '2026-01-01T00:00:00.000Z' },
    { _id: DELETED, name: '已删除的组' },
  ];
}

function editData(groups: EditorGroup[]): unknown {
  return {
    request: {
      _id: 'collect-1',
      title: '实验报告',
      description: '',
      schoolId: SCHOOL_A,
      groupIds: [LIVE, DELETED],
      dueAt: '2026-10-08T12:00:00.000Z',
      status: 'draft',
      revision: 3,
      slots: [{ id: 'slot-1', title: '报告', required: true, allowedExt: ['pdf'], maxFiles: 1 }],
      collaboratorUids: [],
      maxFileBytes: 32 * 1024 * 1024,
      maxTotalBytes: 64 * 1024 * 1024,
      maxFiles: 5,
      ownerUid: UID,
      canEdit: true,
    },
    hasSubmissions: false,
    hasFiles: false,
    canEdit: true,
    schools: [
      { _id: SCHOOL_A, name: '学校甲' },
      { _id: SCHOOL_B, name: '学校乙' },
    ],
    groups,
    courses: [],
  };
}

function createPrefillData(): unknown {
  return {
    request: null,
    schools: [
      { _id: SCHOOL_A, name: '学校甲' },
      { _id: SCHOOL_B, name: '学校乙' },
    ],
    groups: [
      { _id: UNATTACHABLE, schoolId: SCHOOL_A, name: '不可挂班' },
      { _id: DELETED, name: '已删除的组' },
    ],
    courses: [],
    prefillGroupIds: [UNATTACHABLE, DELETED],
    prefillSchoolId: SCHOOL_A,
  };
}

function pageBootstrap(data: unknown): KryptonBootstrap {
  return {
    appName: 'Krypton',
    siteName: 'Krypton OJ',
    locale: 'zh_CN',
    theme: 'light',
    generatedAt: '2026-10-01T00:00:00.000Z',
    user: {
      id: UID,
      name: 'teacher',
      mail: '',
      signedIn: true,
      theme: 'light',
      viewLang: 'zh_CN',
      unreadMessages: 0,
      rp: 0,
      bio: '',
      priv: 0,
      role: 'teacher',
      tfa: false,
      authn: false,
      pinnedDomains: [],
      canBrowseProblemBank: false,
    },
    domain: { id: 'system', name: '主域', bulletin: '', avatar: '' },
    urls: { home: '/' } as KryptonBootstrap['urls'],
    udict: {},
    page: { templateName: 'admin_collect_edit.html', data },
  };
}

function renderEdit(groups: EditorGroup[]) {
  return render(
    <BootstrapProvider bootstrap={pageBootstrap(editData(groups))}>
      <AdminCollectEditPage />
    </BootstrapProvider>,
  );
}

function postedGroupIds(): string[] {
  const input = document.querySelector('input[type="hidden"][name="groupIds"]');
  if (!(input instanceof HTMLInputElement)) throw new Error('missing groupIds');
  return input.value.split(',').filter((id) => id.length > 0);
}

async function openAudience(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('tab', { name: '受众' }));
}

describe('collect edit deleted group', () => {
  it('renders a checked deleted group without schoolId and removes it when unchecked', async () => {
    const user = userEvent.setup();
    renderEdit(savedGroups());
    expect(screen.getByRole('heading', { name: '编辑文件收集' })).toBeInTheDocument();
    expect(postedGroupIds()).toEqual([LIVE, DELETED]);

    await openAudience(user);
    expect(screen.getByRole('checkbox', { name: '已删除的组' }), '没有 schoolId 的已删除组仍应显示').toBeChecked();
    expect(screen.getByRole('checkbox', { name: '学校甲 / 一班' })).toBeChecked();
    expect(screen.queryByRole('checkbox', { name: /归档班/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole('checkbox', { name: '已删除的组' }));
    expect(screen.getByRole('checkbox', { name: '已删除的组' })).not.toBeChecked();
    expect(postedGroupIds()).toEqual([LIVE]);
    expect(postedGroupIds()).not.toContain(DELETED);
  });

  it('keeps the deleted id when the school changes until the teacher unchecks it', async () => {
    const user = userEvent.setup();
    renderEdit(savedGroups());
    await openAudience(user);
    expect(screen.getByRole('checkbox', { name: '已删除的组' }), '没有 schoolId 的已删除组仍应显示').toBeChecked();

    await user.click(screen.getByRole('combobox', { name: /^学校/ }));
    await user.click(await screen.findByRole('option', { name: '学校乙' }));

    expect(postedGroupIds()).toEqual([DELETED]);
    expect(postedGroupIds()).not.toContain(LIVE);
    expect(screen.getByRole('checkbox', { name: '已删除的组' })).toBeChecked();
    expect(screen.queryByRole('checkbox', { name: '学校甲 / 一班' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('checkbox', { name: '已删除的组' }));
    expect(postedGroupIds()).toEqual([]);
    expect(postedGroupIds()).not.toContain(DELETED);
  });

  it('still rejects a row without schoolId when the name is not 已删除的组', () => {
    expect(() => renderEdit([...savedGroups(), { _id: 'group-ghost', name: '幽灵组' }])).toThrow('用户组学校格式不正确');
  });

  it('treats an empty schoolId on 已删除的组 as missing', async () => {
    const user = userEvent.setup();
    renderEdit(savedGroups().map((group) => (group._id === DELETED ? { ...group, schoolId: '' } : group)));
    await openAudience(user);
    expect(screen.getByRole('checkbox', { name: '已删除的组' }), '没有 schoolId 的已删除组仍应显示').toBeChecked();
    expect(postedGroupIds()).toContain(DELETED);
  });

  it('checks course prefill rows on create and drops them from groupIds when unchecked', async () => {
    const user = userEvent.setup();
    render(
      <BootstrapProvider bootstrap={pageBootstrap(createPrefillData())}>
        <AdminCollectEditPage />
      </BootstrapProvider>,
    );
    expect(screen.getByRole('heading', { name: '新建文件收集' })).toBeInTheDocument();
    expect(postedGroupIds()).toEqual([UNATTACHABLE, DELETED]);

    await openAudience(user);
    expect(screen.getByRole('checkbox', { name: '学校甲 / 不可挂班' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: '已删除的组' })).toBeChecked();

    await user.click(screen.getByRole('checkbox', { name: '学校甲 / 不可挂班' }));
    expect(postedGroupIds()).not.toContain(UNATTACHABLE);
    expect(postedGroupIds()).toContain(DELETED);

    await user.click(screen.getByRole('checkbox', { name: '已删除的组' }));
    expect(postedGroupIds()).not.toContain(UNATTACHABLE);
    expect(postedGroupIds()).not.toContain(DELETED);
  });
});
