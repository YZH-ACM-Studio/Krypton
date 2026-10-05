// @vitest-environment node
import { createElement } from 'react';
import { JSDOM } from 'jsdom';
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { BootstrapProvider, type KryptonBootstrap } from '@/lib/bootstrap';
import { ExamPaperPage } from '@/pages/exam-mode/paper';
import {
  expectExplicitButtonVariants,
  expectGateClean,
  findOpenTags,
  readSource,
} from '../helpers.ts';

const INDEX = 'src/pages/exam-mode/index.tsx';
const CONTEST = 'src/pages/exam-mode/contest.tsx';
const WORKSPACE = 'src/pages/exam-mode/workspace.tsx';
const PAPER = 'src/pages/exam-mode/paper.tsx';
const NOTICE = 'src/pages/client-required-notice.tsx';

const LANE_FILES = [INDEX, CONTEST, WORKSPACE, PAPER, NOTICE] as const;
const SHELL_FILES = [INDEX, CONTEST, WORKSPACE, PAPER] as const;
const CARD_PARTS = ['Card', 'CardContent', 'CardHeader', 'CardTitle'] as const;

// 结构规格五份都是「组件：只要求门禁零违规」。通用规格写明组件文件不写 expectPageStructure。
// legacy-intents T01–T04 没有这五份源文件的条目。
// client_required_notice.html 不在 STANDALONE_TEMPLATES 里，页面画在 AppShell 中。
// 原型 G 的 min-h-dvh 居中只适用于不在 AppShell 里的独立页，这里不锁那层壳。

function functionBody(source: string, name: string): string {
  const match = new RegExp(`(?:export )?function ${name}\\b`).exec(source);
  if (match?.index === undefined) return '';
  const rest = source.slice(match.index);
  const next = rest.slice(match[0].length).search(/\n(?:export )?function /);
  return next < 0 ? rest : rest.slice(0, match[0].length + next);
}

function importsName(source: string, name: string, moduleId: string): boolean {
  const pattern = /import\s*\{([\s\S]*?)\}\s*from\s*['"]([^'"]+)['"]/g;
  for (const match of source.matchAll(pattern)) {
    if (match[2] === moduleId && new RegExp(`\\b${name}\\b`).test(match[1] ?? '')) return true;
  }
  return false;
}

function expectUsesPanel(source: string, name: string): void {
  expect(importsName(source, 'Panel', '@/components/ui/panel'), name).toBe(true);
  const body = functionBody(source, name);
  if (body.length > 0) {
    expect(findOpenTags(body, 'Panel').length, name).toBeGreaterThan(0);
    for (const tag of CARD_PARTS) {
      expect(findOpenTags(body, tag).length, `${name} ${tag}`).toBe(0);
    }
    return;
  }
  expect(source, name).not.toMatch(new RegExp(`<${name}\\b`));
  expect(findOpenTags(source, 'Panel').length, name).toBeGreaterThan(0);
}

function importedFrom(source: string, name: string): string {
  const pattern = /import\s*\{([\s\S]*?)\}\s*from\s*['"]([^'"]+)['"]/g;
  for (const match of source.matchAll(pattern)) {
    if (new RegExp(`\\b${name}\\b`).test(match[1] ?? '')) return match[2] ?? '';
  }
  return '';
}

function classTokens(tagText: string): string[] {
  const match = /\bclassName=(?:"([^"]*)"|'([^']*)'|\{([\s\S]*?)\})/.exec(tagText);
  const quoted = match?.[1] ?? match?.[2];
  const raw = quoted ?? [...(match?.[3] ?? '').matchAll(/['"`]([^'"`]*)['"`]/g)].map((item) => item[1] ?? '').join(' ');
  return raw.split(/\s+/).filter((token) => token.length > 0);
}

function ctaButton(source: string): string {
  return findOpenTags(source, 'Button').find((tag) => /\bonClick=\{\s*onCta\s*\}/.test(tag.text))?.text ?? '';
}

// 小于 md。题号格 size-12 = 48px，条内 gap-2 = 8px，p-2.5 = 10px。
const NARROW_WIDTH = 360;
const CELL_PX = 48;
const CELL_GAP_PX = 8;
const CELL_PAD_PX = 20;

interface PaperCellFixture {
  pid: number;
  questionKey: string;
  kind: 'single' | 'multi';
  score: number;
}

interface ConfirmView {
  title: string;
  message: string;
  label: string;
  variant: string | null;
}

let domInstalled = false;

function assignGlobal(key: string, value: unknown): void {
  const current = Object.getOwnPropertyDescriptor(globalThis, key);
  if (current && current.writable !== true && current.set === undefined) {
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    return;
  }
  (globalThis as unknown as Record<string, unknown>)[key] = value;
}

function installDom(): void {
  if (!domInstalled) {
    const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
    const view = dom.window;
    assignGlobal('window', view);
    assignGlobal('document', view.document);
    assignGlobal('navigator', view.navigator);
    assignGlobal('HTMLElement', view.HTMLElement);
    assignGlobal('HTMLInputElement', view.HTMLInputElement);
    assignGlobal('HTMLButtonElement', view.HTMLButtonElement);
    assignGlobal('HTMLMetaElement', view.HTMLMetaElement);
    assignGlobal('Element', view.Element);
    assignGlobal('Node', view.Node);
    assignGlobal('DocumentFragment', view.DocumentFragment);
    assignGlobal('SVGElement', view.SVGElement);
    assignGlobal('localStorage', view.localStorage);
    assignGlobal('MutationObserver', view.MutationObserver);
    assignGlobal('getComputedStyle', view.getComputedStyle.bind(view));
    assignGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    assignGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => view.setTimeout(() => callback(Date.now()), 0));
    assignGlobal('cancelAnimationFrame', (handle: number) => {
      view.clearTimeout(handle);
    });
    view.ResizeObserver = class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    } as unknown as typeof view.ResizeObserver;
    view.IntersectionObserver = class {
      readonly root = null;
      readonly rootMargin = '';
      readonly thresholds: readonly number[] = [];
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
      takeRecords(): IntersectionObserverEntry[] {
        return [];
      }
    } as unknown as typeof view.IntersectionObserver;
    view.Element.prototype.scrollIntoView = () => undefined;
    view.Element.prototype.hasPointerCapture = () => false;
    view.Element.prototype.setPointerCapture = () => undefined;
    view.Element.prototype.releasePointerCapture = () => undefined;
    assignGlobal('ResizeObserver', view.ResizeObserver);
    assignGlobal('IntersectionObserver', view.IntersectionObserver);
    domInstalled = true;
  }
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: NARROW_WIDTH });
  window.matchMedia = ((query: string) => {
    const max = /max-width:\s*(\d+)px/.exec(query);
    const min = /min-width:\s*(\d+)px/.exec(query);
    const matches = max !== null ? NARROW_WIDTH <= Number(max[1]) : min !== null ? NARROW_WIDTH >= Number(min[1]) : false;
    return {
      matches,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    };
  }) as unknown as typeof window.matchMedia;
  const fetchImpl = async (input: RequestInfo | URL): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.includes('/draft')) {
      return new Response(JSON.stringify({ drafts: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response('not found', { status: 404 });
  };
  assignGlobal('fetch', fetchImpl);
}

function domTokens(element: Element): string[] {
  return (element.getAttribute('class') ?? '').split(/\s+/).filter((token) => token.length > 0);
}

function shownBelowMd(element: Element): boolean {
  let node: Element | null = element;
  while (node) {
    const tokens = domTokens(node);
    if (tokens.includes('hidden') && !tokens.some((token) => token.startsWith('max-md:'))) return false;
    node = node.parentElement;
  }
  return true;
}

function paperCells(): PaperCellFixture[] {
  const cells: PaperCellFixture[] = Array.from({ length: 12 }, (_, index) => ({
    pid: index + 1,
    questionKey: 'q',
    kind: 'single',
    score: 1,
  }));
  cells.push({ pid: 13, questionKey: 'q', kind: 'multi', score: 1 });
  return cells;
}

function paperBootstrap(overrides: Record<string, unknown>): KryptonBootstrap {
  const now = Date.now();
  const cells = paperCells();
  const pdict: Record<number, { docId: number; title: string; content: string; config: { type: string; options: Record<string, string[]> } }> = {};
  for (const cell of cells) {
    pdict[cell.pid] = {
      docId: cell.pid,
      title: `题 ${cell.pid}`,
      content: '',
      config: { type: 'objective', options: { q: ['对', '错'] } },
    };
  }
  return {
    appName: 'Krypton',
    siteName: 'Krypton OJ',
    locale: 'zh-CN',
    theme: 'light',
    generatedAt: new Date(now).toISOString(),
    user: { id: 7, name: 'student', signedIn: true } as KryptonBootstrap['user'],
    domain: { id: 'system', name: '主域', bulletin: '', avatar: '' },
    urls: { home: '/' } as KryptonBootstrap['urls'],
    udict: {},
    page: {
      templateName: 'exam_paper.html',
      data: {
        tdoc: {
          docId: 'T1000',
          _id: 'T1000',
          title: '结业考试',
          beginAt: new Date(now - 60_000).toISOString(),
          endAt: new Date(now + 3_600_000).toISOString(),
          rule: 'exam',
          owner: 1,
        },
        pdict,
        cells,
        now,
        inWindow: true,
        canFinalize: true,
        paperStarted: true,
        paperFinalized: false,
        canStartPaper: false,
        paperPreview: false,
        owner: null,
        broadcasts: [],
        scoreboard: [],
        showScoreboard: false,
        allowSubmitByKind: true,
        ...overrides,
      },
    },
  };
}

function renderPaper(hash: string, overrides: Record<string, unknown> = {}): void {
  installDom();
  window.location.hash = hash;
  render(createElement(BootstrapProvider, { bootstrap: paperBootstrap(overrides) }, createElement(ExamPaperPage)));
}

function narrowCellRow(): HTMLElement {
  const rows = [...document.querySelectorAll('div')].filter((element) => {
    if (!(element instanceof HTMLElement) || !shownBelowMd(element)) return false;
    const tokens = domTokens(element);
    if (!tokens.includes('overflow-x-auto') || !tokens.includes('min-w-0')) return false;
    const track = element.firstElementChild;
    return track instanceof HTMLElement && domTokens(track).includes('w-max');
  });
  expect(rows.length).toBe(1);
  return rows[0] as HTMLElement;
}

function rowContentWidth(row: HTMLElement): number {
  const buttons = [...row.querySelectorAll('button')].filter((button) => button instanceof HTMLButtonElement);
  expect(buttons.length).toBeGreaterThan(8);
  for (const button of buttons) {
    const tokens = domTokens(button);
    expect(tokens).toContain('size-12');
    expect(tokens).toContain('shrink-0');
  }
  return buttons.length * CELL_PX + (buttons.length - 1) * CELL_GAP_PX + CELL_PAD_PX;
}

// Radix viewport 的内层是 display:table。不关掉它时，题号条按内容把父级撑开，min-w-0 不生效。
function narrowRowUsedWidth(row: HTMLElement): number {
  const content = rowContentWidth(row);
  const viewport = row.closest('[data-radix-scroll-area-viewport]');
  if (!(viewport instanceof HTMLElement)) return content;
  const klass = viewport.getAttribute('class') ?? '';
  const optsOutOfTable = klass.includes('[&>div]:!block') || klass.includes('[&>div]:!flex');
  const rootTokens = viewport.parentElement ? domTokens(viewport.parentElement) : [];
  const parentCanShrink = rootTokens.includes('min-w-0') || rootTokens.includes('overflow-hidden');
  if (!optsOutOfTable || !parentCanShrink) return content;
  return Math.min(content, NARROW_WIDTH);
}

function page() {
  return within(document.body);
}

function shownByRole(role: 'button' | 'tab', name: RegExp): HTMLElement {
  const matches = page().getAllByRole(role, { name }).filter((element) => element instanceof HTMLElement && shownBelowMd(element));
  expect(matches.length).toBeGreaterThan(0);
  return matches[0] as HTMLElement;
}

async function enabledControl(role: 'button' | 'tab', name: RegExp): Promise<HTMLElement> {
  let control: HTMLElement | null = null;
  await waitFor(() => {
    control = shownByRole(role, name);
    expect((control as HTMLButtonElement).disabled).toBe(false);
  });
  return control as HTMLElement | null ?? shownByRole(role, name);
}

async function readOpenConfirm(): Promise<ConfirmView> {
  const dialog = await page().findByRole('dialog');
  const title = dialog.querySelector('[data-slot="dialog-title"]')?.textContent?.replace(/\s+/g, '') ?? '';
  const message = dialog.querySelector('[data-slot="dialog-description"]')?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  const buttons = [...dialog.querySelectorAll('[data-slot="dialog-footer"] [data-slot="button"]')];
  const confirm = buttons.find((button) => (button.textContent ?? '').replace(/\s+/g, '') !== '取消');
  expect(confirm).toBeTruthy();
  return {
    title,
    message,
    label: (confirm?.textContent ?? '').replace(/\s+/g, ''),
    variant: confirm?.getAttribute('data-variant') ?? null,
  };
}

function expectActionConfirm(view: ConfirmView, action: string, destructive: boolean): void {
  expect(view.title.includes('？'), view.title).toBe(true);
  expect(view.title, view.title).toContain(action);
  expect(view.label, view.label).not.toBe('确认');
  expect(view.label, view.label).not.toBe('确定');
  expect(view.label, view.label).toContain(action);
  expect(view.variant).toBe(destructive ? 'danger' : 'primary');
}

describe('e02 exam-mode pages and client-required notice', () => {
  afterEach(() => {
    cleanup();
  });

  it('门禁零违规', () => {
    expectGateClean([...LANE_FILES]);
  });

  it('按钮显式写 variant', () => {
    expectExplicitButtonVariants([...LANE_FILES]);
  });

  it('考试壳内页面的 h1 改为 h2 text-lg font-semibold', () => {
    for (const file of SHELL_FILES) {
      expect(readSource(file), file).not.toMatch(/<h1(?=[\s>/])/);
    }
    expect(readSource(INDEX)).toMatch(/<h2\s+className="text-lg font-semibold"\s*>\s*考试入口\s*<\/h2>/);
    expect(readSource(CONTEST)).toMatch(/<h2\s+className="text-lg font-semibold"\s*>\s*公告与答疑\s*<\/h2>/);
    expect(readSource(WORKSPACE)).toMatch(/<h2\s+className="text-lg font-semibold"\s*>\s*\{tdoc\.title\}\s*<\/h2>/);
  });

  it('考试卡片改为 Panel', () => {
    expectUsesPanel(readSource(INDEX), 'ExamCard');
  });

  it('答疑卡片改为 Panel', () => {
    expectUsesPanel(readSource(CONTEST), 'ClarificationCard');
  });

  it('考试入口大按钮保留 h-14', () => {
    // 类名在 onClick={onCta} 的按钮上。paper 仍渲染 OverviewSection 时也要读到那个 className，不能只确认标签还在。
    const paper = readSource(PAPER);
    const delegates = /<OverviewSection\b/.test(paper);
    const specifier = delegates ? importedFrom(paper, 'OverviewSection') : '';
    if (delegates) expect(specifier).not.toBe('');
    const file = specifier.startsWith('@/') ? `src/${specifier.slice(2)}.tsx` : PAPER;
    const host = delegates ? functionBody(readSource(file), 'OverviewSection') : paper;
    const button = ctaButton(host);
    expect(button.length).toBeGreaterThan(0);
    expect(classTokens(button)).toContain('h-14');
  });

  it('客户端提示内容用 EmptyState，图标是 MonitorSmartphone', () => {
    const src = readSource(NOTICE);
    expect(importsName(src, 'EmptyState', '@/components/ui/empty-state')).toBe(true);
    expect(importsName(src, 'MonitorSmartphone', 'lucide-react')).toBe(true);
    const tags = findOpenTags(src, 'EmptyState');
    expect(tags.length).toBeGreaterThan(0);
    expect(tags.some((tag) => /icon=\{\s*<MonitorSmartphone\b/.test(tag.text))).toBe(true);
    expect(src).toContain('该时间段禁止普通网页登录');
    expect(src).toContain('你目前处于一场客户端强制比赛的管控时段，普通浏览器访问已被暂时关闭。');
    expect(src).toContain('请通过指定的 Qt 客户端进入比赛。');
    expect(src).toContain('触发的比赛');
    expect(src).toContain('预计解除时间');
    expect(src).toContain('如何进入');
    expect(src).toContain('打开监考用的 Qt 客户端');
    expect(src).toContain('输入学号 / 姓名，等待审批');
    expect(src).toContain('审批通过后客户端会自动打开比赛工作台');
    expect(src).toContain('退出登录');
    expect(src).toContain('绑定 / 认领账号');
    expect(src).toContain('href="/logout"');
    expect(src).toContain('href="/userbind"');
  });

  it('窄屏题号条宽度不超过视口，不随 ScrollArea 表格内容撑开', async () => {
    renderPaper('#problems');
    await waitFor(() => {
      expect((shownByRole('button', /^交卷$/) as HTMLButtonElement).disabled).toBe(false);
    });
    const row = narrowCellRow();
    const content = rowContentWidth(row);
    expect(content).toBeGreaterThan(NARROW_WIDTH);
    expect(narrowRowUsedWidth(row)).toBeLessThanOrEqual(NARROW_WIDTH);
  });

  it('交卷确认框写明动作，不用 confirmDialog 的默认标题和确认按钮', async () => {
    renderPaper('#problems');
    fireEvent.click(await enabledControl('button', /^交卷$/));
    const view = await readOpenConfirm();
    expect(view.message).toContain('确认交卷？交卷后将不能再编辑答案。');
    expectActionConfirm(view, '交卷', true);
  });

  it('提交本类确认框写明动作，不用 confirmDialog 的默认标题和确认按钮', async () => {
    renderPaper('#problems');
    fireEvent.click(await enabledControl('button', /提交「单选」/));
    const view = await readOpenConfirm();
    expect(view.message).toContain('确认提交「单选」类的全部答案？提交后将立即批改并锁定该类，无法再修改。');
    expectActionConfirm(view, '提交', true);
  });

  it('开始答题确认框写明动作，不用默认确认按钮', async () => {
    renderPaper('#overview', { paperStarted: false, canStartPaper: true, canFinalize: false, allowSubmitByKind: false });
    fireEvent.click(page().getByRole('button', { name: '开始答题' }));
    const view = await readOpenConfirm();
    expect(view.message).toContain('开始后将按个人时长计时，试卷不能重抽。确定开始答题？');
    expectActionConfirm(view, '开始', false);
  });

  it('未保存时切换题类的确认框写明动作，不用默认标题和确认按钮', async () => {
    renderPaper('#problems');
    await enabledControl('button', /^交卷$/);
    const radio = page().getAllByRole('radio').find((element) => element instanceof HTMLInputElement && !element.disabled && shownBelowMd(element));
    expect(radio).toBeTruthy();
    fireEvent.click(radio as HTMLInputElement);
    fireEvent.click(shownByRole('tab', /^多/));
    const view = await readOpenConfirm();
    expect(view.message).toContain('当前题目还有未保存的修改，切换 tab 将不会自动保存。确定要切换吗？');
    expect(view.title.includes('？'), view.title).toBe(true);
    expect(view.title.includes('切换') || view.title.includes('未保存'), view.title).toBe(true);
    expect(view.label, view.label).not.toBe('确认');
    expect(view.label, view.label).not.toBe('确定');
    expect(view.label, view.label).toContain('切换');
  });
});
