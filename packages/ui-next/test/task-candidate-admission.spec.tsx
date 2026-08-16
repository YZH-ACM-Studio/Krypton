import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { BootstrapProvider, type KryptonBootstrap } from '../src/lib/bootstrap.tsx';
import { AdminTasksCandidatesPage } from '../src/pages/admin-tasks/index.tsx';

const taskId = '6a13ccf5dadec1f0af7f7152';

function assignment(_id: string, userId: number, status: 'qualified' | 'admitted' | 'completed') {
  return {
    _id,
    userId,
    status,
    canCancel: false,
    assignedAt: '2026-08-16T08:00:00.000Z',
    completedAt: status === 'completed' ? '2026-08-16T08:30:00.000Z' : null,
    qualifiedAt: '2026-08-16T08:05:00.000Z',
    admittedAt: status === 'admitted' ? '2026-08-16T08:20:00.000Z' : null,
    admissionNote: '',
    note: '',
    progress: {},
  };
}

function renderCandidates() {
  const bootstrap: KryptonBootstrap = {
    appName: 'Krypton',
    siteName: 'Krypton OJ',
    locale: 'zh_CN',
    theme: 'light',
    generatedAt: '2026-08-16T08:40:00.000Z',
    user: { id: 2, name: 'root', signedIn: true, priv: 0 } as KryptonBootstrap['user'],
    domain: { id: 'system', name: '主域', bulletin: '', avatar: '' },
    urls: {} as KryptonBootstrap['urls'],
    udict: {},
    page: {
      templateName: 'admin_tasks_candidates.html',
      data: {
        task: {
          _id: taskId,
          domainId: 'system',
          title: '留校候选任务',
          description: '',
          tags: [],
          graph: { nodes: [], edges: [] },
          access: { type: 'public' },
          isActive: true,
          startDate: null,
          endDate: null,
          claimStartAt: null,
          claimEndAt: null,
          maxAssignments: null,
          currentAssignments: 3,
          admissionMode: 'quota',
          quota: null,
          createdAt: '2026-08-16T08:00:00.000Z',
          createdBy: 2,
        },
        assignments: [
          assignment('6a13d56edadec1f0af7f7225', 101, 'qualified'),
          assignment('6a13d56edadec1f0af7f7226', 102, 'admitted'),
          assignment('6a13d56edadec1f0af7f7227', 103, 'completed'),
        ],
        udict: {
          101: { _id: 101, uname: 'qualified-user' },
          102: { _id: 102, uname: 'admitted-user' },
          103: { _id: 103, uname: 'completed-user' },
        },
        studentByUid: {},
        schools: [],
        userGroups: [],
        counts: { qualified: 1, admitted: 1, completed: 1 },
        presets: [],
      },
    },
  };

  render(
    <BootstrapProvider bootstrap={bootstrap}>
      <AdminTasksCandidatesPage />
    </BootstrapProvider>,
  );
}

function checkboxFor(username: string) {
  const row = screen.getByText(username).closest('tr');
  if (!row) throw new Error(`Missing candidate row: ${username}`);
  return within(row).getByRole('checkbox');
}

describe('task candidate admission actions', () => {
  it('only offers operations valid for the selected assignment state', async () => {
    const user = userEvent.setup();
    renderCandidates();

    await user.click(checkboxFor('qualified-user'));
    expect(screen.getByRole('button', { name: '批量录取' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '确认录取并生效' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '撤销录取' })).not.toBeInTheDocument();

    await user.click(checkboxFor('qualified-user'));
    await user.click(checkboxFor('admitted-user'));
    expect(screen.queryByRole('button', { name: '批量录取' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '确认录取并生效' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '撤销录取' })).toBeInTheDocument();
  });

  it('rejects a mixed-state selection instead of sending a partial batch', async () => {
    const user = userEvent.setup();
    renderCandidates();

    await user.click(checkboxFor('qualified-user'));
    await user.click(checkboxFor('admitted-user'));

    expect(screen.getByText('所选人员状态不一致，请按状态分批操作。')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '批量录取' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '确认录取并生效' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '撤销录取' })).not.toBeInTheDocument();
  });
});
