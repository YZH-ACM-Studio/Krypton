import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminCollectSigningPage } from '../src/pages/collect/signing';
import { filterSigningProgress, summarizeSigningProgress, type SigningProgressRow } from '../src/pages/collect/signing-progress';
import { downloadZip } from '../src/lib/download-zip';

function student(
  index: number,
  realName: string,
  status: SigningProgressRow['status'],
  uid: number | null,
  resignAllowed = false,
): SigningProgressRow {
  return {
    studentRecordId: String(index).padStart(24, '0'),
    studentId: `202600100${index}`,
    realName,
    uid,
    groupIds: index === 1 ? ['group-a', 'group-b'] : [index === 3 || index === 4 ? 'group-a' : 'group-b'],
    status,
    resignAllowed,
    signedAt: status === 'signed' ? '2026-10-26T10:00:00.000Z' : null,
    currentFileId: status === 'signed' ? `current-${index}` : null,
  };
}

const rows = [
  student(1, '张三', 'signed', 3),
  student(2, '李四', 'signed', null, true),
  student(3, '王五', 'unsigned', 5),
  student(4, '张六', 'unbound', null),
  student(5, 'Alex', 'pending', 7),
  student(6, '赵七', 'pending', null),
  student(7, '钱八', 'unbound', null),
];
const files = [
  { ...rows[0], fileId: 'current-1', filename: '张三_v2.pdf', version: 2, current: true, left: false },
  { ...rows[0], fileId: 'previous-1', filename: '张三_v1.pdf', version: 1, current: false, left: false },
  { ...rows[1], fileId: 'current-2', filename: '李四_v1.pdf', version: 1, current: true, left: false },
  { ...student(9, '已离组', 'signed', 9), fileId: 'left-9', filename: '已离组_v1.pdf', version: 1, current: true, left: true },
];
let canEdit = true;
const data = {
  schools: [{ id: 'school', name: '测试学校' }],
  groups: [
    { id: 'group-a', schoolId: 'school', name: '一班' },
    { id: 'group-b', schoolId: 'school', name: '二班' },
    { id: 'group-empty', schoolId: 'school', name: '空班' },
    { id: 'group-outside', schoolId: 'school', name: '其他活动的组' },
  ],
  request: {
    id: '0123456789abcdef01234567',
    title: '安全知情书',
    description: '',
    status: 'published',
    revision: 1,
    schoolId: 'school',
    groupIds: ['group-a', 'group-b', 'group-empty'],
    collaboratorUids: [],
    dueAt: '2026-11-30T15:59:00.000Z',
    publishedAt: '2026-10-26T10:00:00.000Z',
  },
  document: null,
  signUrl: '/collect/0123456789abcdef01234567/sign',
  sourceUrl: null,
  fileBaseUrl: '/admin/collect/0123456789abcdef01234567/sign/file/',
  progress: { rows, files },
};

vi.mock('../src/lib/bootstrap', () => ({ useBootstrap: () => ({ user: { priv: 1 }, page: { data: { ...data, canEdit } } }) }));
vi.mock('../src/lib/download-zip', () => ({ downloadZip: vi.fn(async () => {}) }));
beforeEach(() => {
  canEdit = true;
});

const ids = (selected: SigningProgressRow[]) => selected.map((row) => Number(row.studentRecordId));
async function select(label: string, option: string) {
  fireEvent.keyDown(screen.getByRole('combobox', { name: label }), { key: 'ArrowDown' });
  fireEvent.click(await screen.findByRole('option', { name: option }));
}

describe('signing roster statistics and filtering', () => {
  it('counts pending as unsigned, keeps reopened archives signed, and counts only unsigned unbound students', () => {
    expect(summarizeSigningProgress(rows)).toEqual({ total: 7, signed: 2, unsigned: 5, unboundUnsigned: 3 });
    expect(summarizeSigningProgress([])).toEqual({ total: 0, signed: 0, unsigned: 0, unboundUnsigned: 0 });
  });

  it('combines independent status, current binding, and trimmed case-insensitive identity searches', () => {
    expect(ids(filterSigningProgress(rows, '', 'unsigned', 'all'))).toEqual([3, 4, 5, 6, 7]);
    expect(ids(filterSigningProgress(rows, '', 'signed', 'all'))).toEqual([1, 2]);
    expect(ids(filterSigningProgress(rows, '', 'all', 'unbound'))).toEqual([2, 4, 6, 7]);
    expect(ids(filterSigningProgress(rows, '', 'unsigned', 'unbound'))).toEqual([4, 6, 7]);
    expect(ids(filterSigningProgress(rows, '', 'pending', 'all'))).toEqual([5, 6]);
    expect(ids(filterSigningProgress(rows, '', 'resign', 'all'))).toEqual([2]);
    expect(ids(filterSigningProgress(rows, ' ALEX ', 'pending', 'bound'))).toEqual([5]);
    expect(ids(filterSigningProgress(rows, ' 1003 ', 'all', 'all'))).toEqual([3]);
    expect(ids(filterSigningProgress(rows, '张', 'unsigned', 'unbound'))).toEqual([4]);
    expect(ids(filterSigningProgress(rows, '张', 'unsigned', 'bound'))).toEqual([]);
    expect(ids(filterSigningProgress(rows, '', 'all', 'all', 'group-a'))).toEqual([1, 3, 4]);
    expect(ids(filterSigningProgress(rows, '', 'all', 'all', 'group-b'))).toEqual([1, 2, 5, 6, 7]);
    expect(ids(filterSigningProgress(rows, '张', 'unsigned', 'unbound', 'group-a'))).toEqual([4]);
    expect(ids(filterSigningProgress(rows, '张', 'unsigned', 'unbound', 'group-b'))).toEqual([]);
  });
});

describe('signing management progress page', () => {
  it('keeps full-roster statistics while searching and combining filters, and clears them together', async () => {
    render(<AdminCollectSigningPage />);
    const stats = screen.getByRole('region', { name: '签署统计' });
    for (const [label, count] of [
      ['应签人数', '7'],
      ['已签署', '2'],
      ['未签署', '5'],
      ['其中未绑定账号', '3'],
    ]) {
      expect(within(within(stats).getByText(label).parentElement!).getByText(count)).toBeInTheDocument();
    }
    fireEvent.change(screen.getByRole('searchbox', { name: '搜索学生' }), { target: { value: '张' } });
    expect(screen.getByRole('status')).toHaveTextContent('显示 2 / 7 人');
    await select('签署状态', '未签署');
    await select('账号绑定', '未绑定账号');
    await select('用户组', '一班');
    expect(screen.getByRole('status')).toHaveTextContent('显示 1 / 7 人');
    expect(within(screen.getByRole('table')).getByText('张六')).toBeInTheDocument();
    expect(within(screen.getByRole('table')).queryByText('张三')).not.toBeInTheDocument();
    expect(within(within(stats).getByText('未签署').parentElement!).getByText('5')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '清除筛选' }));
    expect(screen.getByRole('searchbox')).toHaveValue('');
    expect(screen.getByRole('combobox', { name: '签署状态' })).toHaveTextContent('全部签署状态');
    expect(screen.getByRole('combobox', { name: '账号绑定' })).toHaveTextContent('全部绑定状态');
    expect(screen.getByRole('combobox', { name: '用户组' })).toHaveTextContent('全部用户组');
    expect(screen.getByRole('status')).toHaveTextContent('显示 7 / 7 人');
  });

  it('downloads matching roster and current PDFs together without narrowing either full archive download', async () => {
    render(<AdminCollectSigningPage />);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '张' } });
    fireEvent.click(screen.getByRole('button', { name: '下载筛选结果 ZIP' }));
    await waitFor(() => expect(downloadZip).toHaveBeenCalledTimes(1));
    const [name, entries] = vi.mocked(downloadZip).mock.calls[0];
    expect(name).toBe('安全知情书-筛选结果.zip');
    expect(entries.filter((entry) => entry.url).map((entry) => entry.url)).toEqual([`${data.fileBaseUrl}current-1`]);
    const manifest = entries.find((entry) => entry.name === '签署清单.json')?.content;
    if (typeof manifest !== 'string') throw new Error('Missing signing manifest');
    expect(JSON.parse(manifest).students.map((row: SigningProgressRow) => row.studentId)).toEqual(['2026001001', '2026001004']);
    const unsigned = entries.find((entry) => entry.name === '未签署.csv')?.content;
    expect(unsigned).toContain('张六');
    expect(unsigned).not.toContain('张三');
    expect(unsigned).not.toContain('赵七');
    expect(entries.find((entry) => entry.name === '待绑定.csv')?.content).toContain('张六');

    fireEvent.click(screen.getByRole('button', { name: '下载全部当前签署 ZIP' }));
    await waitFor(() => expect(downloadZip).toHaveBeenCalledTimes(2));
    expect(
      vi
        .mocked(downloadZip)
        .mock.calls[1][1].filter((entry) => entry.url)
        .map((entry) => entry.url),
    ).toEqual([`${data.fileBaseUrl}current-1`, `${data.fileBaseUrl}current-2`, `${data.fileBaseUrl}left-9`]);
    const fullManifest = vi.mocked(downloadZip).mock.calls[1][1].find((entry) => entry.name === '签署清单.json')?.content;
    if (typeof fullManifest !== 'string') throw new Error('Missing full signing manifest');
    expect(JSON.parse(fullManifest).students).toHaveLength(7);
    fireEvent.click(screen.getByRole('button', { name: '下载全部历史版本 ZIP' }));
    await waitFor(() => expect(downloadZip).toHaveBeenCalledTimes(3));
    expect(vi.mocked(downloadZip).mock.calls[2][1].filter((entry) => entry.url)).toHaveLength(4);
    expect(vi.mocked(downloadZip).mock.calls[2][1].find((entry) => entry.name === '待绑定.csv')?.content).toContain('赵七');
  });

  it('exports only the selected group while full downloads still contain the complete roster and departed archives', async () => {
    render(<AdminCollectSigningPage />);
    await select('用户组', '一班');
    fireEvent.click(screen.getByRole('button', { name: '下载筛选结果 ZIP' }));
    await waitFor(() => expect(downloadZip).toHaveBeenCalledOnce());
    const entries = vi.mocked(downloadZip).mock.calls[0][1];
    const manifest = entries.find((entry) => entry.name === '签署清单.json')?.content;
    if (typeof manifest !== 'string') throw new Error('Missing signing manifest');
    expect(JSON.parse(manifest).students.map((row: SigningProgressRow) => row.realName)).toEqual(['张三', '王五', '张六']);
    expect(entries.filter((entry) => entry.url).map((entry) => entry.url)).toEqual([`${data.fileBaseUrl}current-1`]);
    fireEvent.click(screen.getByRole('button', { name: '下载全部当前签署 ZIP' }));
    await waitFor(() => expect(downloadZip).toHaveBeenCalledTimes(2));
    const fullEntries = vi.mocked(downloadZip).mock.calls[1][1];
    const fullManifest = fullEntries.find((entry) => entry.name === '签署清单.json')?.content;
    if (typeof fullManifest !== 'string') throw new Error('Missing full signing manifest');
    expect(JSON.parse(fullManifest).students).toHaveLength(7);
    expect(fullEntries.filter((entry) => entry.url)).toHaveLength(3);
  });

  it('exports unsigned-only matches as lists, with no PDF or signed-unbound student in the waiting-to-bind list', async () => {
    render(<AdminCollectSigningPage />);
    await select('签署状态', '未签署');
    await select('账号绑定', '未绑定账号');
    await select('用户组', '二班');
    fireEvent.click(screen.getByRole('button', { name: '下载筛选结果 ZIP' }));
    await waitFor(() => expect(downloadZip).toHaveBeenCalledOnce());
    const entries = vi.mocked(downloadZip).mock.calls[0][1];
    expect(entries.some((entry) => entry.url)).toBe(false);
    const waiting = entries.find((entry) => entry.name === '待绑定.csv')?.content;
    expect(waiting).toContain('赵七');
    expect(waiting).not.toContain('李四');
    expect(waiting).not.toContain('张六');
  });

  it('offers only the activity groups, counts shared members once, and handles empty groups for collaborators', async () => {
    canEdit = false;
    render(<AdminCollectSigningPage />);
    fireEvent.keyDown(screen.getByRole('combobox', { name: '用户组' }), { key: 'ArrowDown' });
    expect(screen.queryByRole('option', { name: '其他活动的组' })).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole('option', { name: '二班' }));
    expect(screen.getByRole('status')).toHaveTextContent('显示 5 / 7 人');
    expect(within(screen.getByRole('table')).getAllByText('张三')).toHaveLength(1);
    await select('用户组', '空班');
    expect(screen.getByRole('status')).toHaveTextContent('显示 0 / 7 人');
    expect(screen.getByRole('button', { name: '下载筛选结果 ZIP' })).toBeDisabled();
    expect(screen.getAllByText('没有符合筛选条件的学生').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: '清除筛选' }));
    expect(screen.getByRole('status')).toHaveTextContent('显示 7 / 7 人');
  });

  it('shows an empty match and disables its download while retaining full downloads and collaborator limits', () => {
    canEdit = false;
    render(<AdminCollectSigningPage />);
    expect(screen.queryByRole('button', { name: '允许重签' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: '无人匹配' } });
    expect(screen.getByRole('status')).toHaveTextContent('显示 0 / 7 人');
    expect(screen.getAllByText('没有符合筛选条件的学生').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: '下载筛选结果 ZIP' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '下载全部当前签署 ZIP' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '提醒全部待签或重签学生' })).toBeInTheDocument();
  });
});
