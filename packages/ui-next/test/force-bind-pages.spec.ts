// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const workspaceRoot = resolve(import.meta.dirname, '../../..');

function source(path: string) {
  return readFileSync(resolve(workspaceRoot, path), 'utf8');
}

function sliceBetween(text: string, startMarker: string, endMarker: string) {
  const start = text.indexOf(startMarker);
  const end = text.indexOf(endMarker, start + startMarker.length);
  expect(start, `missing ${startMarker}`).to.be.at.least(0);
  expect(end, `missing ${endMarker} after ${startMarker}`).to.be.greaterThan(start);
  return text.slice(start, end);
}

function infersBindingFromProfile(text: string) {
  return /(?:bs\.user|user)\.studentId/.test(text) || /role\s*===\s*['"]teacher['"]/.test(text);
}

describe('force-bind bootstrap contracts', () => {
  const bootstrapTypes = source('packages/ui-next/src/lib/bootstrap.tsx');
  const bootstrapServer = source('packages/ui-next/index.ts');

  it('declares KryptonUser.bindRequired as an optional boolean', () => {
    const kryptonUser = sliceBetween(bootstrapTypes, 'export interface KryptonUser {', 'export interface KryptonDomain {');
    expect(kryptonUser).to.include('bindRequired?: boolean');
  });

  it('publishes bindRequired from handler.forceBindRequired with an exact true-check', () => {
    const userBlock = sliceBetween(bootstrapServer, 'user: {', 'domain: {');
    expect(userBlock).to.match(/bindRequired:\s*context\.handler\??\.forceBindRequired\s*===\s*true/);
    expect(userBlock).not.to.match(/bindRequired:\s*!!/);
    expect(userBlock).not.to.match(/bindRequired:[^\n]*studentId/);
    expect(userBlock).not.to.match(/bindRequired:[^\n]*teacher/);
  });
});

describe('force-bind homepage banner contracts', () => {
  const router = source('packages/ui-next/src/router.tsx');
  const examShell = source('packages/ui-next/src/components/layout/exam-shell.tsx');
  const appShell = sliceBetween(router, 'function AppShell()', 'function DefaultAppShell()');
  const defaultShell = sliceBetween(router, 'function DefaultAppShell()', 'const rootRoute');
  const standalone = router.match(/const STANDALONE_TEMPLATES = new Set\(\[([^\]]*)\]\)/)?.[1] ?? '';

  it('renders the bindRequired homepage banner inside DefaultAppShell', () => {
    expect(defaultShell).to.include('bindRequired');
    expect(defaultShell).to.match(/templateName\s*===\s*'main\.html'/);
    expect(defaultShell).to.include('/userbind');
    expect(defaultShell).to.match(/href=["']\/userbind["']/);
    expect(defaultShell).to.include('去绑定');
    expect(defaultShell).to.include('请先绑定学生身份');
    expect(defaultShell).to.include('请先绑定学生身份，才能使用题目、比赛和作业。');
  });

  it('keeps exam STANDALONE_TEMPLATES skipping DefaultAppShell so the banner cannot mount there', () => {
    expect(standalone).to.include('exam_mode_home.html');
    expect(standalone).to.include('exam_contest.html');
    expect(standalone).to.include('exam_paper.html');
    expect(appShell).to.include('STANDALONE_TEMPLATES.has');
    expect(appShell).to.include('<PageResolver />');
    expect(appShell).to.include('<DefaultAppShell />');
    expect(appShell).not.to.include('bindRequired');
    expect(appShell).not.to.include('去绑定');
    expect(appShell).not.to.include('请先绑定学生身份');
    expect(defaultShell).to.include('bindRequired');
    expect(examShell).not.to.include('bindRequired');
    expect(examShell).not.to.include('去绑定');
    expect(examShell).not.to.include('请先绑定学生身份，才能使用题目、比赛和作业。');
  });

  it('does not infer the homepage banner from studentId or role===\'teacher\'', () => {
    expect(infersBindingFromProfile(router)).to.equal(false);
    expect(router).not.to.include('user.studentId');
    expect(router).not.to.match(/role\s*===\s*['"]teacher['"]/);
  });
});

describe('force-bind userbind page contracts', () => {
  const userbind = source('packages/ui-next/src/pages/userbind/index.tsx');
  const userBindPage = sliceBetween(userbind, 'export function UserBindPage()', 'export function UserBindApplicationsPage()');

  it('tells students that a roster match binds immediately and labels the submit button 绑定', () => {
    expect(userBindPage).to.include('与花名册一致则立即绑定');
    expect(userBindPage).to.include('填写学校、学号和姓名。与花名册一致则立即绑定；对不上再提交管理员审核。');
    expect(userBindPage).to.match(/<(?:Button|button)\b[^>]*>\s*绑定\s*</);
    expect(userBindPage).not.to.include('由管理员审核通过后完成绑定');
    expect(userBindPage).not.to.match(/<(?:Button|button)\b[^>]*>\s*提交申请\s*</);
  });

  it('does not infer binding from studentId or role===\'teacher\'', () => {
    expect(infersBindingFromProfile(userBindPage)).to.equal(false);
    expect(userBindPage).not.to.include('user.studentId');
    expect(userBindPage).not.to.match(/role\s*===\s*['"]teacher['"]/);
  });
});
