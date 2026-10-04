// @vitest-environment jsdom
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { BootstrapProvider, type KryptonBootstrap } from '../../../src/lib/bootstrap.tsx';
import { TrainingDetailPage, TrainingPage } from '../../../src/pages/training.tsx';

const PAGE = 'src/pages/training.tsx';
const packageRoot = resolve(import.meta.dirname, '../../..');
const SET_TITLE = '题集长标题甲';
const STAGE_SELECTED = '已选阶段长标题';
const STAGE_IDLE = '未选阶段长标题';
// 20 字前缀 + 20 个「甲」= 40 个汉字，覆盖审查要求的单行章节按钮。
const LONG_CHAPTER = `章节名称超长需要在单行按钮里用省略号收起${'甲'.repeat(20)}`;
const LONG_PROBLEM = '题面标题长到会盖住旁边的章节名和状态徽标';
// 章节按钮是 size sm 的 text-xs，一个汉字按 0.75rem（12px）计。
const HAN_PX = 12;
const SM_BREAKPOINT = 640;
const CHAPTER_TEXT_WIDTH = [...LONG_CHAPTER].length * HAN_PX;
// 结果行比章节名全文窄，用来覆盖 ≥640px 横向排列时被外层裁切的情况。
const NARROW_ROW_WIDTH = CHAPTER_TEXT_WIDTH - HAN_PX;

interface StageNode {
  _id: number;
  title: string;
  requireNids: number[];
  pids: number[];
}

function classTokens(element: Element): string[] {
  return (element.getAttribute('class') ?? '').split(/\s+/).filter((token) => token.length > 0);
}

function directText(element: Element): string {
  let text = '';
  for (const node of element.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) text += node.textContent ?? '';
  }
  return text.trim();
}

function makeBootstrap(data: unknown): KryptonBootstrap {
  return {
    appName: 'Krypton',
    siteName: 'Krypton OJ',
    locale: 'zh_CN',
    theme: 'light',
    generatedAt: '2026-10-04T00:00:00.000Z',
    user: {
      id: 7,
      name: 'student',
      mail: '',
      signedIn: false,
      theme: 'light',
      viewLang: 'zh_CN',
      unreadMessages: 0,
      rp: 0,
      bio: '',
      priv: 0,
      role: 'default',
      tfa: false,
      authn: false,
      pinnedDomains: [],
      canBrowseProblemBank: false,
    },
    domain: { id: 'system', name: '主域', bulletin: '', avatar: '' },
    urls: {
      home: '/',
      training: '/training',
      trainingDetail: '/training/__TID__',
      problemDetail: '/p/__PID__',
    } as KryptonBootstrap['urls'],
    udict: {},
    page: { templateName: 'training.html', data },
  };
}

function stageNode(id: number, title: string, pids: number[]): StageNode {
  return { _id: id, title, requireNids: [], pids };
}

function renderPage(data: unknown, page: typeof TrainingPage | typeof TrainingDetailPage): void {
  render(createElement(BootstrapProvider, { bootstrap: makeBootstrap(data) }, createElement(page)));
}

function detailData(): unknown {
  const selected = stageNode(1, STAGE_SELECTED, [101]);
  const idle = stageNode(2, STAGE_IDLE, []);
  return {
    tdoc: {
      docId: '42',
      title: '题集详情标题',
      dag: [selected, idle],
    },
    ndict: { 1: selected, 2: idle },
    nsdict: {
      1: { isProgress: true, isOpen: true, progress: 40, donePids: [] },
      2: { isOpen: true, progress: 0, donePids: [] },
    },
    pdict: { 101: { docId: 101, pid: 'P1001', title: 'A+B' } },
    psdict: {},
    tsdoc: {},
  };
}

function listData(): unknown {
  return {
    page: 1,
    tpcount: 1,
    q: '',
    tdocs: [{
      docId: '42',
      title: SET_TITLE,
      dag: [stageNode(1, '入门', [1])],
    }],
    tsdict: {},
  };
}

function searchData(): unknown {
  const chapter = stageNode(1, LONG_CHAPTER, [101]);
  return {
    tdoc: { docId: '42', title: '题集详情标题', dag: [chapter] },
    ndict: { 1: chapter },
    nsdict: { 1: { isOpen: true, progress: 0, donePids: [] } },
    pdict: { 101: { docId: 101, pid: 'P9LONG', title: LONG_PROBLEM } },
    psdict: {},
    tsdoc: {},
  };
}

function panelByHeading(name: string): HTMLElement {
  const heading = screen.getByRole('heading', { name });
  const panel = heading.closest('[data-slot="panel"]');
  if (!(panel instanceof HTMLElement)) throw new TypeError(`${name}面板不存在`);
  return panel;
}

function stageButton(title: string): HTMLElement {
  return within(panelByHeading('阶段')).getByRole('button', { name: new RegExp(title) });
}

function titleElements(root: ParentNode, text: string): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>('*')].filter((element) => directText(element) === text);
}

function expectClampedTitles(root: ParentNode, text: string): void {
  const found = titleElements(root, text);
  expect(found.length, text).toBeGreaterThan(0);
  const problems = found
    .filter((element) => {
      const tokens = classTokens(element);
      return !tokens.includes('min-w-0') || !tokens.includes('line-clamp-2');
    })
    .map((element) => `${element.tagName} ${element.getAttribute('class') ?? ''}`);
  expect(problems, text).toEqual([]);
}

function chapterNameElement(button: HTMLElement, title: string): HTMLElement {
  const spans = [...button.querySelectorAll('span')].filter((element) => (element.textContent ?? '').includes(title));
  const innermost = spans.filter((element) => !spans.some((other) => other !== element && element.contains(other)));
  expect(innermost.length, title).toBe(1);
  const element = innermost[0];
  if (!(element instanceof HTMLElement)) throw new TypeError('章节名元素不存在');
  return element;
}

function resultRow(button: HTMLElement): HTMLElement {
  const row = button.parentElement?.parentElement;
  if (!(row instanceof HTMLElement) || !classTokens(row).includes('sm:flex-row')) {
    throw new TypeError('搜题结果行不存在');
  }
  return row;
}

/** 横向 flex 子项要能窄于自身全文，才能在行宽里出现省略号，而不是把字撑出外层 overflow。 */
function flexItemCanNarrow(tokens: string[]): boolean {
  return tokens.includes('min-w-0') && !tokens.includes('shrink-0');
}

describe('p06 problem set stage selection and long titles', () => {
  beforeEach(() => {
    localStorage.clear();
    window.history.replaceState(null, '', '/training/42');
  });

  it('选中阶段项的 class 含 bg-surface-active 与 font-medium，不含 hover:bg-surface-hover', async () => {
    renderPage(detailData(), TrainingDetailPage);

    const selected = stageButton(STAGE_SELECTED);
    const idle = stageButton(STAGE_IDLE);
    expect(classTokens(selected), selected.getAttribute('class') ?? '').toEqual(expect.arrayContaining(['bg-surface-active', 'font-medium']));
    expect(classTokens(selected), selected.getAttribute('class') ?? '').not.toContain('hover:bg-surface-hover');
    expect(classTokens(idle), idle.getAttribute('class') ?? '').toContain('hover:bg-surface-hover');
    expect(classTokens(idle), idle.getAttribute('class') ?? '').not.toContain('bg-surface-active');
    expect(classTokens(within(selected).getByText('进行中')), '阶段状态').toContain('shrink-0');

    await userEvent.click(idle);

    const nowSelected = stageButton(STAGE_IDLE);
    const nowIdle = stageButton(STAGE_SELECTED);
    expect(classTokens(nowSelected), nowSelected.getAttribute('class') ?? '').toEqual(expect.arrayContaining(['bg-surface-active', 'font-medium']));
    expect(classTokens(nowSelected), nowSelected.getAttribute('class') ?? '').not.toContain('hover:bg-surface-hover');
    expect(classTokens(nowIdle), nowIdle.getAttribute('class') ?? '').toContain('hover:bg-surface-hover');
    expect(classTokens(nowIdle), nowIdle.getAttribute('class') ?? '').not.toContain('bg-surface-active');
  });

  it('题集卡片标题含 min-w-0 与 line-clamp-2，徽标 shrink-0', () => {
    renderPage(listData(), TrainingPage);
    expectClampedTitles(document.body, SET_TITLE);
    const title = titleElements(document.body, SET_TITLE)[0];
    if (!title?.parentElement) throw new TypeError('题集标题不存在');
    expect(classTokens(within(title.parentElement).getByText('未开始')), '题集徽标').toContain('shrink-0');
  });

  it('题集列表标题含 min-w-0 与 line-clamp-2', async () => {
    renderPage(listData(), TrainingPage);
    await userEvent.click(screen.getByRole('tab', { name: '列表视图' }));
    expectClampedTitles(document.body, SET_TITLE);
  });

  it('阶段标题含 min-w-0 与 line-clamp-2', () => {
    renderPage(detailData(), TrainingDetailPage);
    expectClampedTitles(document.body, STAGE_SELECTED);
    expectClampedTitles(document.body, STAGE_IDLE);
  });

  it('搜题结果里不少于 40 个汉字的章节名可收缩并省略，按钮不再用 max-w-48', async () => {
    expect([...LONG_CHAPTER].length).toBeGreaterThanOrEqual(40);
    renderPage(searchData(), TrainingDetailPage);
    await userEvent.type(screen.getByRole('textbox', { name: '搜索当前题集中的题目' }), 'P9LONG');

    const search = panelByHeading('题集内搜题');
    const chapterButton = within(search).getByRole('button', { name: LONG_CHAPTER });
    const chapterName = chapterNameElement(chapterButton, LONG_CHAPTER);
    const nameTokens = classTokens(chapterName);
    const buttonTokens = classTokens(chapterButton);
    expect({
      minW0: nameTokens.includes('min-w-0'),
      truncate: nameTokens.includes('truncate'),
      clamp: nameTokens.includes('line-clamp-2'),
      cap12rem: buttonTokens.includes('max-w-48'),
      buttonMinW0: buttonTokens.includes('min-w-0'),
      buttonMaxWFull: buttonTokens.includes('max-w-full'),
      title: chapterButton.getAttribute('title'),
    }, `${chapterName.getAttribute('class') ?? ''} | ${chapterButton.getAttribute('class') ?? ''}`).toEqual({
      minW0: true,
      truncate: true,
      clamp: false,
      cap12rem: false,
      buttonMinW0: true,
      buttonMaxWFull: true,
      title: LONG_CHAPTER,
    });

    const problemTitle = titleElements(search, LONG_PROBLEM);
    expect(problemTitle.length, LONG_PROBLEM).toBeGreaterThan(0);
    expectClampedTitles(search, LONG_PROBLEM);
  });

  it('视口不小于 640px 且结果行窄于章节名全文时，章节名在行内省略而不是被外层裁切', async () => {
    expect(CHAPTER_TEXT_WIDTH).toBeGreaterThan(NARROW_ROW_WIDTH);
    window.innerWidth = SM_BREAKPOINT;
    renderPage(searchData(), TrainingDetailPage);
    await userEvent.type(screen.getByRole('textbox', { name: '搜索当前题集中的题目' }), 'P9LONG');

    const search = panelByHeading('题集内搜题');
    const chapterButton = within(search).getByRole('button', { name: LONG_CHAPTER });
    const chapterName = chapterNameElement(chapterButton, LONG_CHAPTER);
    const row = resultRow(chapterButton);
    const column = chapterButton.parentElement;
    if (!(column instanceof HTMLElement)) throw new TypeError('章节列不存在');
    row.style.width = `${NARROW_ROW_WIDTH}px`;
    row.style.flexDirection = 'row';

    const nameTokens = classTokens(chapterName);
    const buttonTokens = classTokens(chapterButton);
    const columnTokens = classTokens(column);
    expect(Number.parseInt(row.style.width, 10), '结果行宽度').toBe(NARROW_ROW_WIDTH);
    expect({
      viewport: window.innerWidth,
      rowWidth: Number.parseInt(row.style.width, 10),
      textWidth: CHAPTER_TEXT_WIDTH,
      horizontal: classTokens(row).includes('sm:flex-row') && row.style.flexDirection === 'row',
      columnCanNarrow: flexItemCanNarrow(columnTokens),
      buttonCanNarrow: flexItemCanNarrow(buttonTokens),
      nameEllipsis: nameTokens.includes('min-w-0') && nameTokens.includes('truncate') && !nameTokens.includes('line-clamp-2'),
    }, `${column.getAttribute('class') ?? ''} | ${chapterButton.getAttribute('class') ?? ''}`).toEqual({
      viewport: SM_BREAKPOINT,
      rowWidth: NARROW_ROW_WIDTH,
      textWidth: CHAPTER_TEXT_WIDTH,
      horizontal: true,
      columnCanNarrow: true,
      buttonCanNarrow: true,
      nameEllipsis: true,
    });
  });

  it('门禁零违规', () => {
    const result = spawnSync(process.execPath, ['scripts/design-gate.mjs', '--file', PAGE], {
      cwd: packageRoot,
      encoding: 'utf8',
    });
    expect(result.status, result.stderr || result.stdout).toBe(0);
  });
});
