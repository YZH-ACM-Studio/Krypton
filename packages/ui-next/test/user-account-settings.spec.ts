import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  isStudentIdentitySettingKey,
  settingFamilyLabel,
  settingHint,
  settingLabel,
  settingOptionLabel,
  shouldRenderAccountSetting,
} from '../src/pages/user-account-settings';

describe('account setting labels', () => {
  it('uses Chinese labels and hints for the preference and profile keys', () => {
    expect(settingLabel('viewLang')).to.equal('界面语言');
    expect(settingLabel('timeZone')).to.equal('时区');
    expect(settingLabel('rounded')).to.equal('圆角');
    expect(settingLabel('codeLang')).to.equal('默认编程语言');
    expect(settingLabel('preferredEditorType')).to.equal('编辑器布局');
    expect(settingLabel('unknown', '回退')).to.equal('回退');
    expect(settingHint('codeTemplate')).to.include('留空');
    expect(settingFamilyLabel('setting_display')).to.equal('显示');
    expect(settingFamilyLabel('setting_markdown')).to.equal('编辑器');
  });

  it('translates known option values and keeps unknown ones', () => {
    expect(settingOptionLabel('light', 'Light')).to.equal('浅色');
    expect(settingOptionLabel('0', 'Boy ♂')).to.equal('男');
    expect(settingOptionLabel('sv', 'Split View')).to.equal('分栏预览');
    expect(settingOptionLabel('zh_CN')).to.equal('简体中文');
    expect(settingOptionLabel('Source Code Pro')).to.equal('Source Code Pro');
  });

  it('hides roster identity fields from the student settings form', () => {
    expect(isStudentIdentitySettingKey('school')).to.equal(true);
    expect(isStudentIdentitySettingKey('studentId')).to.equal(true);
    expect(isStudentIdentitySettingKey('realName')).to.equal(true);
    expect(isStudentIdentitySettingKey('qq')).to.equal(false);
    expect(shouldRenderAccountSetting({ key: 'school', flag: 0 })).to.equal(false);
    expect(shouldRenderAccountSetting({ key: 'qq', flag: 1 })).to.equal(false);
    expect(shouldRenderAccountSetting({ key: 'qq', flag: 0 })).to.equal(true);
  });
});

describe('account settings page source', () => {
  const page = readFileSync(resolve(import.meta.dirname, '../src/pages/user-account.tsx'), 'utf8');
  const profile = readFileSync(resolve(import.meta.dirname, '../src/pages/user.tsx'), 'utf8');
  const paper = readFileSync(resolve(import.meta.dirname, '../src/pages/exam-mode/paper.tsx'), 'utf8');

  it('redesigns settings with MiniTabs and Chinese identity copy', () => {
    expect(page).to.include('MiniTabs');
    expect(page).to.include('StudentIdentityCard');
    expect(page).to.include('学号、姓名和学校只来自花名册绑定');
    expect(page).to.include('settingLabel');
    expect(page).to.include('shouldRenderAccountSetting');
    expect(page).to.include('Codeforces 用户名');
    expect(page).to.include('刷新分数');
    expect(page).to.include('未命名认证器');
    expect(page).not.to.include('setting_info: \'个人信息\'');
    expect(page).not.to.include('sm:grid-cols-[200px_1fr]');
    expect(page).not.to.include('Codeforces handle');
    expect(page).not.to.include('刷新 rating');
    expect(page).not.to.include("'Authenticator'");
  });

  it('does not display Hydro self-filled studentId or school on the public profile', () => {
    expect(profile).to.include('binding.studentId');
    expect(profile).to.include('binding.schoolName');
    expect(profile).not.to.include('udoc.studentId');
    expect(profile).not.to.include('udoc.school');
    expect(profile).not.to.include('udoc.realName');
  });

  it('exam paper overview reads examMode.student from userbind', () => {
    expect(paper).to.include('data.examMode?.student');
    expect(paper).not.to.include('ExamUser');
    expect(paper).not.to.include('(bs.user as ExamUser).studentId');
  });
});
