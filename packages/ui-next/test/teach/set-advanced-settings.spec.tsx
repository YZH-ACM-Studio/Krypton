import { createDraftConfig, SET_DEFAULT_PERMISSIONS, SET_EXPERIENCE_DEFAULTS } from '@hydrooj/common';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { confirmDialog } from '@/components/ui/dialog';
import { SetAdvancedSettings } from '../../src/pages/teach/tabs/set-advanced-settings';
import { settingsRequest, draftOf, parseResponse } from '../../src/pages/teach/tabs/set-settings-model';

const transport = vi.hoisted(() => ({ getJson: vi.fn(), postJson: vi.fn() }));
vi.mock('@/components/ui/dialog', async (original) => ({
  ...(await original<typeof import('@/components/ui/dialog')>()),
  confirmDialog: vi.fn().mockResolvedValue(true),
}));
vi.mock('@/pages/teach/api', () => transport);
vi.mock('@/lib/bootstrap', () => ({ useBootstrap: () => ({ locale: 'zh-CN', user: { viewLang: 'zh-CN' } }) }));
vi.mock('@/components/markdown-renderer', () => ({
  MarkdownEditor: ({ value, onChange }: { value: string; onChange: (value: string) => void }) => (
    <textarea aria-label="说明编辑器" value={value} onChange={(event) => onChange(event.currentTarget.value)} />
  ),
}));

function response() {
  return {
    settings: createDraftConfig('homework').settings,
    revision: 3,
    lockAt: null,
    basic: { title: '函数实验', content: '', beginAt: '2099-11-01T00:00:12.345Z', endAt: '2099-11-21T23:59:23.456Z', hidden: false, maintainer: [] },
    langs: [],
    languageOptions: [{ value: 'cc', label: 'C++' }],
    groups: [{ _id: '64b000000000000000000001', name: '一班', attachable: true }],
  };
}
beforeEach(() => {
  transport.getJson.mockReset().mockResolvedValue(response());
  transport.postJson.mockReset().mockImplementation(async (_url, body) => ({ ...body, revision: body.expectedRevision + 1 }));
});
async function open(tab = '基本信息') {
  render(<SetAdvancedSettings type="homework" id="abc" />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole('tab', { name: tab }));
  return user;
}
const saved = () => waitFor(() => expect(screen.getByText('所有更改已保存')).toBeVisible(), { timeout: 2500 });

describe('problem set settings autosave', () => {
  it('does not write on load and saves a title with the current revision without losing time precision', async () => {
    await open();
    expect(transport.postJson).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('题目集名称'), { target: { value: '函数实验二' } });
    await saved();
    expect(transport.postJson.mock.calls[0][1]).toMatchObject({
      expectedRevision: 3,
      basic: { title: '函数实验二', beginAt: '2099-11-01T00:00:12.345Z', endAt: '2099-11-21T23:59:23.456Z' },
    });
    expect(screen.queryByRole('button', { name: /保存高级设置|保存这一段/ })).toBeNull();
  });
  it('serializes saves and retains edits made while an earlier request is in flight', async () => {
    let resolve!: (value: unknown) => void;
    transport.postJson.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    await open();
    fireEvent.change(screen.getByLabelText('题目集名称'), { target: { value: '第一版' } });
    await waitFor(() => expect(transport.postJson).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText('题目集名称'), { target: { value: '第二版' } });
    await act(async () => resolve({ ...transport.postJson.mock.calls[0][1], revision: 4 }));
    expect(screen.getByLabelText('题目集名称')).toHaveValue('第二版');
    await saved();
    expect(transport.postJson.mock.calls[1][1]).toMatchObject({ expectedRevision: 4, basic: { title: '第二版' } });
  });
  it('keeps failed edits, exposes retry, and never announces a failed save as success', async () => {
    transport.postJson.mockRejectedValueOnce(new Error('网络中断'));
    const user = await open();
    fireEvent.change(screen.getByLabelText('题目集名称'), { target: { value: '保留这次输入' } });
    expect(await screen.findByRole('alert')).toHaveTextContent('网络中断');
    expect(screen.getByLabelText('题目集名称')).toHaveValue('保留这次输入');
    expect(screen.getByRole('status')).toHaveTextContent('保存未完成');
    await user.click(screen.getByRole('button', { name: '重试保存' }));
    await saved();
  });
  it('discards failed edits before a slow reload so they cannot be autosaved again', async () => {
    transport.postJson.mockRejectedValueOnce(new Error('网络中断'));
    const user = await open();
    fireEvent.change(screen.getByLabelText('题目集名称'), { target: { value: '放弃这次输入' } });
    await screen.findByRole('alert');
    let finishRead!: (value: unknown) => void;
    transport.getJson.mockImplementationOnce(() => new Promise((resolve) => { finishRead = resolve; }));
    await user.click(screen.getByRole('button', { name: '重新读取' }));
    expect(await screen.findByText('正在读取设置…')).toBeVisible();
    vi.useFakeTimers();
    try {
      await act(() => vi.advanceTimersByTimeAsync(1200));
      expect(transport.postJson).toHaveBeenCalledTimes(1);
      await act(async () => finishRead(response()));
      expect(screen.getByLabelText('题目集名称')).toHaveValue('函数实验');
      expect(screen.getByText('所有更改已保存')).toBeVisible();
    } finally {
      vi.useRealTimers();
    }
  });
  it('groups feedback and only publishes grades through the explicit action', async () => {
    const value = response();
    value.settings.feedback.objective.when = 'after_release';
    transport.getJson.mockResolvedValue(value);
    const user = await open('成绩与反馈');
    await user.click(screen.getByRole('switch', { name: '隐藏测试点详情' }));
    await saved();
    expect(transport.postJson.mock.calls[0][1].settings.feedback.gradesReleased).toBe(false);
    await user.click(screen.getByRole('button', { name: '发布成绩' }));
    await saved();
    expect(transport.postJson.mock.calls[1][1]).toMatchObject({ expectedRevision: 4, settings: { feedback: { gradesReleased: true } } });
  });
  it('retains grade publication when another setting is edited while publishing', async () => {
    const value = response();
    value.settings.feedback.objective.when = 'after_release';
    transport.getJson.mockResolvedValue(value);
    let finishPublish!: (value: unknown) => void;
    transport.postJson.mockImplementationOnce(() => new Promise((resolve) => { finishPublish = resolve; }));
    const user = await open('成绩与反馈');
    await user.click(screen.getByRole('button', { name: '发布成绩' }));
    await user.click(screen.getByRole('switch', { name: '隐藏测试点详情' }));
    await act(async () => finishPublish({ ...transport.postJson.mock.calls[0][1], revision: 4 }));
    await saved();
    expect(transport.postJson.mock.calls[1][1]).toMatchObject({
      expectedRevision: 4,
      settings: { feedback: { gradesReleased: true }, experience: { hideTestCases: true } },
    });
  });
  it('keeps automatic student saving off by default and places it under advanced rules', async () => {
    const user = await open();
    expect(screen.queryByRole('switch', { name: '结束前自动保存答案' })).toBeNull();
    await user.click(screen.getByRole('tab', { name: '高级规则' }));
    expect(screen.getByRole('switch', { name: '结束前自动保存答案' })).not.toBeChecked();
    await user.click(screen.getByRole('switch', { name: '结束前自动保存答案' }));
    await saved();
    expect(transport.postJson.mock.calls[0][1].settings.experience).toEqual({ ...SET_EXPERIENCE_DEFAULTS, autoSaveBeforeEnd: true });
  });
  it('adds group permissions without replacing unrelated settings', async () => {
    const user = await open('用户组权限');
    await user.click(screen.getByRole('combobox', { name: '选择用户组' }));
    await user.click(screen.getByRole('option', { name: '一班' }));
    await user.click(screen.getByRole('button', { name: '添加授权' }));
    expect(screen.getByRole('heading', { name: '一班' })).toBeVisible();
    await saved();
    expect(transport.postJson.mock.calls[0][1].settings.authorization.groups).toEqual([
      { groupId: '64b000000000000000000001', problems: 'answer', records: 'self', scoreboard: true, afterEnd: true },
    ]);
    expect(transport.postJson.mock.calls[0][1].settings.codePolicy).toBe(response().settings.codePolicy);
  });
  it('distinguishes inherited rules from saved defaults and can activate the displayed defaults without changing a field', async () => {
    const user = await open('用户组权限');
    expect(screen.getByText('沿用题目集规则')).toBeVisible();
    expect(screen.getByRole('combobox', { name: '选择用户组' })).toHaveTextContent('选择用户组');
    expect(transport.postJson).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: '启用分组授权' }));
    expect(screen.getByText('分组授权待保存')).toBeVisible();
    await saved();
    expect(transport.postJson.mock.calls[0][1].settings.authorization).toEqual({ defaults: SET_DEFAULT_PERMISSIONS, groups: [] });
    expect(screen.getByText('已启用分组授权')).toBeVisible();
  });
  it('edits only the selected group and preserves the defaults when switching or removing it', async () => {
    const group = { ...SET_DEFAULT_PERMISSIONS, groupId: response().groups[0]._id, records: 'list' };
    transport.getJson.mockResolvedValue({
      ...response(), settings: { ...response().settings, authorization: { defaults: SET_DEFAULT_PERMISSIONS, groups: [group] } },
    });
    const user = await open('用户组权限');
    expect(screen.getByRole('button', { name: '一班' })).toHaveAccessibleDescription('可看他人提交列表');
    await user.click(screen.getByRole('button', { name: '一班' }));
    expect(screen.getByRole('radio', { name: /列出所有/ })).toBeChecked();
    expect(transport.postJson).not.toHaveBeenCalled();
    await user.click(screen.getByRole('radio', { name: /查看所有明细与代码/ }));
    await user.click(screen.getByRole('button', { name: '默认权限' }));
    expect(screen.getByRole('button', { name: '一班' })).toHaveAccessibleDescription('可看他人详情与代码');
    expect(screen.getByRole('radio', { name: /仅看自己/ })).toBeChecked();
    await saved();
    expect(transport.postJson.mock.calls[0][1].settings.authorization).toEqual({
      defaults: SET_DEFAULT_PERMISSIONS, groups: [{ ...group, records: 'details' }],
    });
    await user.click(screen.getByRole('button', { name: '一班' }));
    vi.mocked(confirmDialog).mockResolvedValueOnce(false);
    await user.click(screen.getByRole('button', { name: '移除授权' }));
    expect(screen.getByRole('heading', { name: '一班' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: '移除授权' }));
    await saved();
    expect(transport.postJson.mock.calls[1][1].settings.authorization).toEqual({ defaults: SET_DEFAULT_PERMISSIONS, groups: [] });
  });
  it('rejects incomplete time ranges, duplicate late tiers and empty draw quotas before writing', () => {
    const initial = parseResponse(response());
    const draft = draftOf(initial);
    expect(() => settingsRequest({ ...draft, basic: { ...initial.basic!, endAt: null } }, initial)).toThrow('完整');
    expect(() =>
      settingsRequest(
        {
          ...draft,
          settings: { ...draft.settings, late: { enabled: true, onTimeAt: new Date(), rules: {} } },
          tiers: [
            { hours: '0', coefficient: '0.8' },
            { hours: '0', coefficient: '0.6' },
          ],
        },
        initial,
      ),
    ).toThrow('重复');
    expect(() =>
      settingsRequest(
        { ...draft, settings: { ...draft.settings, draw: { enabled: true, quotas: {}, redrawEachRound: true, allowRepeatAcrossRounds: true } } },
        initial,
      ),
    ).toThrow();
  });
  it('preserves and clears the scoreboard lock through autosave', async () => {
    transport.getJson.mockResolvedValue({ ...response(), lockAt: '2099-11-20T10:00:12.345Z' });
    await open('成绩与反馈');
    fireEvent.change(screen.getByLabelText('封榜开始'), { target: { value: '' } });
    await saved();
    expect(transport.postJson.mock.calls[0][1].lockAt).toBeNull();
  });
});
