import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ManualGradingPanel, parseManualGradingData } from '../src/pages/manual-grading';

const initial = {
  pid: 3,
  problems: [{ pid: 3, title: '简答题' }],
  rows: [{ uid: 7, latestRid: 'record-7', displayName: '张同学', answer: '学生答案', roundNo: 2, answerVersion: 3 }],
};
const fetchMock = vi.fn<typeof fetch>();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

describe('embedded grading', () => {
  it('writes to the grading endpoint and retains record and grade revision when revising', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ manualGrade: { score: 80, revision: 1, comment: '正确' } }), { headers: { 'Content-Type': 'application/json' } }),
    );
    render(<ManualGradingPanel endpoint="/homework/set-1/grading" initialData={initial} />);
    fireEvent.change(screen.getByLabelText('得分（0–100）'), { target: { value: '80' } });
    await userEvent.setup().click(screen.getByRole('button', { name: '提交评分' }));
    expect(await screen.findByText('已评分 80/100 · 第 1 次评分')).toBeVisible();
    expect(fetchMock.mock.calls[0][0]).toBe('/homework/set-1/grading');
    const body = fetchMock.mock.calls[0][1]?.body;
    expect(body).toBeInstanceOf(URLSearchParams);
    expect(String(body)).toContain('latestRid=record-7');
    expect(String(body)).toContain('expectedRevision=0');
    expect(screen.getByRole('button', { name: '保存改分' })).toBeDisabled();
    expect(screen.getByText('第 2 轮 · 答案版本 3')).toBeVisible();
  });

  it('keeps the score input after a malformed success response and honors locked history', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { headers: { 'Content-Type': 'application/json' } }));
    const view = render(<ManualGradingPanel endpoint="/exam/set-1/grading" initialData={initial} />);
    fireEvent.change(screen.getByLabelText('得分（0–100）'), { target: { value: '60' } });
    await userEvent.setup().click(screen.getByRole('button', { name: '提交评分' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('缺少评分结果');
    expect(screen.getByLabelText('得分（0–100）')).toHaveValue(60);
    view.unmount();
    render(
      <ManualGradingPanel
        endpoint="/exam/set-1/grading"
        initialData={{ ...initial, rows: [{ ...initial.rows[0], gradingLocked: true, manualGrade: { score: 50, revision: 1 } }] }}
      />,
    );
    expect(screen.getByLabelText('得分（0–100）')).toBeDisabled();
    expect(screen.getByText('历史轮次记录不完整，保留原评分。')).toBeVisible();
  });

  it('rejects malformed answer data at the response boundary', () => {
    expect(() => parseManualGradingData({ ...initial, rows: [{ ...initial.rows[0], answer: { private: true } }] })).toThrow('内容无效');
  });

  it('reloads all students after clearing a filter on the standalone page', async () => {
    const filtered = { ...initial, rows: [{ ...initial.rows[0], answer: '筛选后的答案' }] };
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify(filtered), { headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify(initial), { headers: { 'Content-Type': 'application/json' } }));
    render(<ManualGradingPanel endpoint="/homework/set-1/grading" initialData={initial} />);
    const user = userEvent.setup();
    fireEvent.change(screen.getByLabelText('学生 UID'), { target: { value: '7' } });
    await user.click(screen.getByRole('button', { name: '筛选' }));
    expect(await screen.findByText('筛选后的答案')).toBeVisible();
    fireEvent.change(screen.getByLabelText('学生 UID'), { target: { value: '' } });
    await user.click(screen.getByRole('button', { name: '筛选' }));
    expect(await screen.findByText('学生答案')).toBeVisible();
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual(['/homework/set-1/grading?uid=7', '/homework/set-1/grading?']);
  });
});
