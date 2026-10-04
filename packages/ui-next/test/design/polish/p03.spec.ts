import { createElement } from 'react';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BootstrapProvider, type KryptonBootstrap } from '../../../src/lib/bootstrap';
import { RecordDetailPage } from '../../../src/pages/records';

function recordDetailBootstrap(): KryptonBootstrap {
  return {
    appName: 'Krypton',
    siteName: 'Krypton OJ',
    locale: 'zh-CN',
    theme: 'light',
    generatedAt: '2026-10-04T00:00:00.000Z',
    user: { id: 7, name: 'student', signedIn: true } as KryptonBootstrap['user'],
    domain: { id: 'system', name: '主域', bulletin: '', avatar: '' },
    urls: {
      home: '/',
      problems: '/p',
      contests: '/contest',
      homework: '/homework',
      training: '/training',
      ranking: '/ranking',
      discussions: '/discuss',
      domains: '/domain',
      messages: '/home/messages',
      login: '/login',
      register: '/register',
      logout: '/logout',
      settings: '/home/settings',
      security: '/home/security',
      files: '/file',
      records: '/record',
      domainDashboard: '/domain/dashboard',
      domainPermission: '/domain/permission',
      manage: '/manage',
      status: '/manage/status',
      problemDetail: '/p/{pid}',
      contestDetail: '/contest/{tid}',
      homeworkDetail: '/homework/{tid}',
      trainingDetail: '/training/{tid}',
      discussionDetail: '/discuss/{did}',
      discussionNode: '/discuss/node/{name}',
      userDetail: '/user/{UID}',
      recordDetail: '/record/{rid}',
    },
    udict: {},
    page: {
      templateName: 'record_detail.html',
      data: {
        langs: { 'cc.cc17': { display: 'C++ 17' } },
        udoc: { _id: 7, uname: 'student' },
        pdoc: {
          title: '子任务分数',
          // parseConfig 只下发 type 与 maxScore，不会带 subtasks。
          // 整题满分 100；这个 min 子任务自己的满分是 30，全过时记录 score 也是 30。
          config: {
            type: 'default',
            maxScore: 100,
          },
        },
        rdoc: {
          _id: '507f1f77bcf86cd799439011',
          pid: 1001,
          uid: 7,
          status: 1,
          score: 30,
          lang: 'cc.cc17',
          subtasks: {
            1: { score: 30, status: 1, type: 'min' },
          },
        },
      },
    },
  };
}

function renderRecordDetail() {
  render(createElement(BootstrapProvider, { bootstrap: recordDetailBootstrap() }, createElement(RecordDetailPage)));
}

describe('p03 record subtask score tone', () => {
  it('子任务满分 30、得分 30 时，分数元素 class 含 text-success-fg', () => {
    renderRecordDetail();
    const panel = screen.getByRole('heading', { name: '子任务' }).closest('[data-slot="panel"]');
    if (!(panel instanceof HTMLElement)) {
      throw new TypeError('子任务面板缺失');
    }
    const score = within(panel).getByText('30');
    expect(score.textContent).toBe('30');
    expect(score.classList.contains('text-success-fg')).toBe(true);
  });
});
