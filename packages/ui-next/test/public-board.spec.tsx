import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BootstrapProvider, type KryptonBootstrap } from '../src/lib/bootstrap';
import { boardZones, formatBoardSeconds, PublicBoardPage } from '../src/pages/public-board';

interface Row {
  uid: number;
  rank: number | null;
  place: number;
  score: number;
  passed: number;
  seconds: number;
  ak: boolean;
  award: 0 | 1 | 2 | 3;
  lucky: 'big' | 'small' | null;
  cells: Array<{ score: number; seconds: number | null; full: boolean; firstBlood: boolean } | null>;
  uname: string;
  studentId: string | null;
  realName: string | null;
  college: string | null;
  major: string | null;
}

const full = (seconds: number, firstBlood = false) => ({ score: 10, seconds, full: true, firstBlood });

/** Fixture rows are listed in board order without ties, so the overall place is the uid. */
function row(uid: number, rank: number | null, overrides: Partial<Row> = {}): Row {
  return {
    uid,
    rank,
    place: uid,
    score: 10,
    passed: 1,
    seconds: 600,
    ak: false,
    award: 0,
    lucky: null,
    cells: [full(600), null, null],
    uname: `user${uid}`,
    studentId: `2503${uid}`,
    realName: `选手${uid}`,
    college: '计算机与人工智能学院',
    major: '计算机科学与技术',
    ...overrides,
  };
}

const HEADER = {
  overline: 'CAUC · GPLT 2026',
  title: '2026 年中国民航大学程序设计天梯竞赛',
  beginAt: '2026-10-11T10:20:00Z',
  endAt: '2026-10-11T13:20:00Z',
  problemCount: 3,
};

const ROWS: Row[] = [
  row(1, 1, { score: 60, passed: 3, ak: true, award: 1, cells: [full(100, true), { score: 20, seconds: 200, full: true, firstBlood: false }, { score: 30, seconds: 4000, full: true, firstBlood: true }] }),
  row(2, null, { score: 40, passed: 2, cells: [full(90), { score: 20, seconds: 300, full: true, firstBlood: true }, null] }),
  row(3, 2, { score: 25, passed: 2, award: 2, cells: [full(700), { score: 15, seconds: 900, full: false, firstBlood: false }, null] }),
  row(4, 3, { award: 3 }),
  row(5, 4, { award: 3, lucky: null }),
  row(6, 5),
  // Place 7 is official rank 6, because the star at place 2 counts for 幸运柒.
  row(7, 6, { lucky: 'big' }),
  row(8, 7),
  row(9, 8, { score: 0, passed: 0, seconds: 0, cells: [{ score: 0, seconds: null, full: false, firstBlood: false }, null, null], realName: null, studentId: null, college: null, major: null }),
];

const PUBLISHED = {
  board: { ...HEADER, published: true, maxScore: 60, entrants: ROWS.length },
  columns: [
    { pid: 101, label: 'A', title: '万恶之源', maxScore: 10, nAccept: 8, nSubmit: 11 },
    { pid: 102, label: 'B', title: '计数', maxScore: 20, nAccept: 2, nSubmit: 5 },
    { pid: 103, label: 'C', title: '网络', maxScore: 30, nAccept: 1, nSubmit: 1 },
  ],
  rows: ROWS,
  awards: { denominator: 8, percents: [5, 10, 15], quotas: [1, 1, 2], counts: [1, 1, 2], minScores: [60, 25, 10] },
  lucky: { bigRanks: [7, 77, 177], yuan: { big: 50, small: 10 } },
};

function renderBoard(data: unknown) {
  const bootstrap = {
    appName: 'Krypton',
    siteName: 'Krypton',
    locale: 'zh-CN',
    theme: 'light',
    generatedAt: '2026-10-12T00:00:00Z',
    user: { id: 0, name: 'Guest', signedIn: false },
    domain: { id: 'system', name: '主域', bulletin: '', avatar: '' },
    urls: {},
    udict: {},
    page: { templateName: 'public_board.html', data },
  } as unknown as KryptonBootstrap;
  return render(<BootstrapProvider bootstrap={bootstrap}><PublicBoardPage /></BootstrapProvider>);
}

const bodyRows = () => screen.getAllByRole('row').filter((element) => element.closest('tbody'));
const zoneOrder = () => bodyRows().map((element) => element.getAttribute('data-zone') ?? `uid:${element.getAttribute('data-uid')}`);

describe('public contest board page', () => {
  it('shows only the title and a notice before the results are published', () => {
    renderBoard({ board: { ...HEADER, published: false } });
    expect(screen.getByRole('heading', { level: 1 }).textContent).to.equal(HEADER.title);
    expect(screen.getByText('成绩尚未公布。')).not.to.equal(null);
    expect(screen.queryByRole('table')).to.equal(null);
    expect(screen.queryByRole('button', { name: '评奖规则' })).to.equal(null);
  });

  it('draws one award line where each tier starts and keeps a star inside the tier it ranks in', () => {
    renderBoard(PUBLISHED);
    expect(zoneOrder()).to.deep.equal([
      't1', 'uid:1', 'uid:2',
      't2', 'uid:3',
      't3', 'uid:4', 'uid:5',
      'rest', 'uid:6', 'uid:7', 'uid:8',
      'none', 'uid:9',
    ]);
    const firstLine = bodyRows()[0];
    expect(firstLine.textContent).to.include('一等奖');
    expect(firstLine.textContent).to.include('1 人 · 最低 60 分');
  });

  it('marks the star, AK, awards and lucky places on their rows', () => {
    renderBoard(PUBLISHED);
    const ak = screen.getByText('选手1').closest('tr')!;
    expect(within(ak).getByTitle('AK：比赛时间内全部题目满分')).not.to.equal(null);
    expect(within(ak).getByText('一等奖')).not.to.equal(null);
    const star = screen.getByText('选手2').closest('tr')!;
    expect(within(star).getAllByRole('cell')[0].textContent).to.equal('*');
    expect(within(star).getByText('打星')).not.to.equal(null);
    expect(within(star).queryByText(/等奖/)).to.equal(null);
    const lucky = screen.getByText('选手7').closest('tr')!;
    expect(within(lucky).getAllByRole('cell')[0].textContent).to.equal('6');
    expect(within(lucky).getByTitle('幸运柒 · 含打星总排第 7 名 · 大吉 50 元').textContent).to.equal('柒大吉#7');
    expect(screen.getByText('选手8').closest('tr')!.textContent).not.to.include('大吉');
    expect(screen.getByText('选手3').closest('tr')!.textContent).to.include('二等奖');
  });

  it('shows the student id and handle under the name, and falls back to the handle without a student record', () => {
    renderBoard(PUBLISHED);
    expect(screen.getByText('25033 · user3')).not.to.equal(null);
    const unbound = screen.getByText('user9').closest('tr')!;
    expect(within(unbound).queryByText(/·/)).to.equal(null);
  });

  it('colours problem cells by result and keeps the scoreboard clock', () => {
    renderBoard(PUBLISHED);
    const header = screen.getAllByRole('columnheader').map((cell) => cell.textContent);
    expect(header).to.deep.equal(['#', '选手', '学院 / 专业', '奖项', '总分', '过题', '总时间', 'A8/11', 'B2/5', 'C1/1']);
    const top = screen.getByText('选手1').closest('tr')!;
    const cells = top.querySelectorAll('[data-cell]');
    expect([...cells].map((cell) => cell.getAttribute('data-cell'))).to.deep.equal(['first-blood', 'full', 'first-blood']);
    expect(cells[2].textContent).to.equal('3001:06:40');
    const partial = screen.getByText('选手3').closest('tr')!.querySelectorAll('[data-cell]');
    expect(partial[1].getAttribute('data-cell')).to.equal('partial');
    const zero = screen.getByText('user9').closest('tr')!.querySelector('[data-cell]')!;
    expect(zero.getAttribute('data-cell')).to.equal('zero');
    expect(zero.textContent).to.equal('0');
  });

  it('shows college and major publicly without a national score column', () => {
    renderBoard(PUBLISHED);
    const student = screen.getByText('选手1').closest('tr')!;
    expect(within(student).getByText('计算机与人工智能学院')).toBeInTheDocument();
    expect(within(student).getByText('计算机科学与技术')).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: /国赛/ })).toBeNull();
    expect(within(screen.getByText('user9').closest('tr')!).getAllByRole('cell')[2].textContent).toBe('——');
    expect(bodyRows()[0].querySelector('td')?.colSpan).toBe(10);
  });

  it('shows administrator national scores only for official entrants and preserves a real zero', () => {
    renderBoard({ ...PUBLISHED, nationalScores: { year: 2026, byUid: { 1: 188, 2: 299, 3: 0 } } });
    expect(screen.getByRole('columnheader', { name: '2026 国赛' })).toBeInTheDocument();
    const scores = [1, 2, 3, 4].map((uid) => within(screen.getByText(`选手${uid}`).closest('tr')!).getAllByRole('cell')[5].textContent);
    expect(scores).toEqual(['188', '—', '0', '—']);
    expect(screen.queryByText('299')).toBeNull();
    expect(bodyRows()[0].querySelector('td')?.colSpan).toBe(11);
    fireEvent.click(screen.getByRole('tab', { name: /打星/ }));
    expect(zoneOrder()).toEqual(['uid:2']);
    expect(screen.queryByText('188')).toBeNull();
  });

  it('filters by award, hides empty tabs and drops the award lines while filtering', () => {
    renderBoard(PUBLISHED);
    expect(screen.getByRole('tab', { name: /打星/ })).not.to.equal(null);
    expect(screen.getByRole('tab', { name: /AK/ })).not.to.equal(null);
    fireEvent.click(screen.getByRole('tab', { name: /三等奖/ }));
    expect(zoneOrder()).to.deep.equal(['uid:4', 'uid:5']);
    fireEvent.click(screen.getByRole('tab', { name: /幸运柒/ }));
    expect(zoneOrder()).to.deep.equal(['uid:7']);
  });

  it('omits the AK and 打星 tabs when nobody has them', () => {
    renderBoard({ ...PUBLISHED, rows: ROWS.filter((item) => item.rank !== null).map((item) => ({ ...item, ak: false })) });
    expect(screen.queryByRole('tab', { name: /打星/ })).to.equal(null);
    expect(screen.queryByRole('tab', { name: /AK/ })).to.equal(null);
  });

  it('searches by name, student id or handle', () => {
    renderBoard(PUBLISHED);
    const search = screen.getByRole('searchbox', { name: '搜索选手' });
    fireEvent.change(search, { target: { value: '25035' } });
    expect(zoneOrder()).to.deep.equal(['uid:5']);
    fireEvent.change(search, { target: { value: 'USER9' } });
    expect(zoneOrder()).to.deep.equal(['uid:9']);
    fireEvent.change(search, { target: { value: '没有这个人' } });
    expect(screen.getByText('没有符合条件的选手。')).not.to.equal(null);
  });

  it('hides the per-problem clock with the switch', () => {
    renderBoard(PUBLISHED);
    const top = () => screen.getByText('选手1').closest('tr')!.querySelectorAll('[data-cell]')[0];
    expect(top().textContent).to.equal('1000:01:40');
    fireEvent.click(screen.getByRole('switch', { name: '每题用时' }));
    expect(top().textContent).to.equal('10');
  });

  it('opens the rules with the quotas worked out for this contest', () => {
    renderBoard(PUBLISHED);
    fireEvent.click(screen.getByRole('button', { name: '评奖规则' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog.textContent).to.include('以过题 ≥ 1 的 8 人为基数（含打星）');
    expect(dialog.textContent).to.include('共 1 / 1 / 2 人');
    expect(dialog.textContent).to.include('按含打星的总排名：第 7、77、177 名为大吉，50 元');
    expect(dialog.textContent).to.include('不占正式名次、不获奖，名额顺延给正式选手；参与幸运柒');
    expect(dialog.textContent).to.include('3 题全部满分');
  });
});

describe('public board helpers', () => {
  it('formats the board clock past 24 hours', () => {
    expect(formatBoardSeconds(0)).to.equal('00:00:00');
    expect(formatBoardSeconds(90061)).to.equal('25:01:01');
  });

  it('puts a leading star into the first official zone', () => {
    expect(boardZones([row(1, null, { score: 99 }), row(2, 1, { award: 1 }), row(3, 2)])).to.deep.equal(['t1', 't1', 'rest']);
  });

  it('keeps a zero-score star with the rows that did not pass', () => {
    expect(boardZones([row(1, 1), row(2, null, { passed: 0, score: 0 })])).to.deep.equal(['rest', 'none']);
  });
});
