// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  expectExplicitButtonVariants,
  expectGateClean,
  expectPageStructure,
  findOpenTags,
  readSource,
} from '../helpers.ts';

const LANE_FILES = [
  'src/pages/auth.tsx',
  'src/pages/error.tsx',
  'src/pages/sudo.tsx',
  'src/pages/redeem.tsx',
  'src/components/redeem-dialog.tsx',
  'src/pages/misc.tsx',
  'src/pages/generic.tsx',
  'src/pages/spike-webview.tsx',
  'src/lib/sensitive.tsx',
] as const;

const AUTH = 'src/pages/auth.tsx';
const ERROR = 'src/pages/error.tsx';
const SUDO = 'src/pages/sudo.tsx';
const REDEEM_DIALOG = 'src/components/redeem-dialog.tsx';
const GENERIC = 'src/pages/generic.tsx';
const TOKENS = 'src/design/tokens.css';
const STYLES = 'src/styles.css';

const AUTH_PAGES = [
  'LoginPage',
  'RegisterPage',
  'LogoutPage',
  'LostPasswordPage',
  'RegisterMailSentPage',
  'LostPasswordMailSentPage',
  'LostPasswordWithCodePage',
  'UserDeletePendingPage',
  'ChangeMailSentPage',
] as const;

const SUDO_PAGES = ['SudoPage', 'SudoRedirectPage'] as const;
const ERROR_PAGES = ['ErrorPage', 'BsodPage'] as const;

// DS009 禁止 text-base。16px 是 text-lg（--fs-lg），不能照抄 legacy 清单里的 text-base。
const IOS_INPUT_PX = 16;

function functionBody(source: string, name: string): string {
  const marker = `function ${name}`;
  const start = source.indexOf(marker);
  if (start < 0) {
    return '';
  }
  const rest = source.slice(start);
  const next = rest.slice(marker.length).search(/\n(?:export )?function /);
  return next < 0 ? rest : rest.slice(0, marker.length + next);
}

function returnChunks(body: string): string[] {
  const indexes: number[] = [];
  for (const match of body.matchAll(/\breturn\s*(?:\(|<)/g)) {
    if (match.index !== undefined) {
      indexes.push(match.index);
    }
  }
  return indexes.map((start, index) => body.slice(start, indexes[index + 1] ?? body.length));
}

function attrValue(tag: string, name: string): string {
  const match = new RegExp(`\\b${name}=(?:"([^"]*)"|'([^']*)'|\\{["']([^"']*)["']\\})`).exec(tag);
  return match?.[1] ?? match?.[2] ?? match?.[3] ?? '';
}

function classTokens(tag: string): string[] {
  return attrValue(tag, 'className').split(/\s+/).filter((token) => token.length > 0);
}

function utilityFontPx(styles: string, tokens: string): Map<string, number> {
  const steps = new Map<string, number>();
  for (const match of tokens.matchAll(/--(fs-[a-z0-9]+):\s*(\d+(?:\.\d+)?)px/g)) {
    const name = match[1];
    const raw = match[2];
    if (name !== undefined && raw !== undefined) {
      steps.set(name, Number(raw));
    }
  }
  const sizes = new Map<string, number>();
  for (const match of styles.matchAll(/--(text-[a-z0-9]+):\s*var\(--(fs-[a-z0-9]+)\)/g)) {
    const utility = match[1];
    const step = match[2];
    const px = step === undefined ? undefined : steps.get(step);
    if (utility !== undefined && px !== undefined) {
      sizes.set(utility, px);
    }
  }
  return sizes;
}

function mobileFontPx(className: string, sizes: Map<string, number>): number | undefined {
  let px: number | undefined;
  for (const token of className.split(/\s+/)) {
    if (token.length === 0 || token.includes(':')) {
      continue;
    }
    const value = sizes.get(token);
    if (value !== undefined) {
      px = value;
    }
  }
  return px;
}

function assertShellForm(file: string, names: readonly string[]): void {
  const source = readSource(file);
  for (const name of names) {
    const chunks = returnChunks(functionBody(source, name));
    expect(chunks.length, name).toBeGreaterThan(0);
    for (const [index, chunk] of chunks.entries()) {
      const label = `${name}#${index + 1}`;
      expect(chunk, label).toMatch(/<Page\b[^>]*\swidth="form"/);
      expect(chunk, label).toMatch(/<PageHeader\b/);
      expect(chunk, label).toMatch(/<Panel\b/);
    }
  }
  expect(source, file).not.toMatch(/\bmin-h-dvh\b/);
  expect(source, file).not.toMatch(/\bplace-items-center\b/);
}

describe('s20 auth, error, sudo, redeem and small pages', () => {
  it('门禁零违规', () => {
    expectGateClean([...LANE_FILES]);
  });

  it('按钮显式写 variant', () => {
    expectExplicitButtonVariants([...LANE_FILES]);
  });

  it('页面结构 auth.tsx', () => {
    expectPageStructure(AUTH, {
      widths: ['form'],
      workspace: 'forbidden',
      minPageHeaders: 9,
    });
  });

  it('页面结构 error.tsx', () => {
    expectPageStructure(ERROR, {
      widths: ['form'],
      workspace: 'forbidden',
      minPageHeaders: 0,
    });
  });

  it('页面结构 sudo.tsx', () => {
    expectPageStructure(SUDO, {
      widths: ['form'],
      workspace: 'forbidden',
      minPageHeaders: 2,
    });
  });

  it('页面结构 redeem.tsx', () => {
    expectPageStructure('src/pages/redeem.tsx', {
      widths: ['form'],
      workspace: 'forbidden',
      minPageHeaders: 1,
    });
  });

  it('页面结构 misc.tsx', () => {
    expectPageStructure('src/pages/misc.tsx', {
      widths: ['wide'],
      workspace: 'forbidden',
      minPageHeaders: 1,
    });
  });

  it('页面结构 generic.tsx', () => {
    expectPageStructure(GENERIC, {
      widths: ['wide', 'prose', 'form'],
      workspace: 'forbidden',
      minPageHeaders: 1,
    });
  });

  it('页面结构 spike-webview.tsx', () => {
    expectPageStructure('src/pages/spike-webview.tsx', {
      widths: ['wide'],
      workspace: 'forbidden',
      minPageHeaders: 1,
    });
  });

  it('auth 每个导出页面是 Page width=form、PageHeader 和 Panel，且不做全屏居中', () => {
    assertShellForm(AUTH, AUTH_PAGES);
  });

  it('sudo 每个导出页面是 Page width=form、PageHeader 和 Panel，且不做全屏居中', () => {
    assertShellForm(SUDO, SUDO_PAGES);
  });

  it('登录主按钮是 primary 大按钮，窄屏撑满，sm 起按内容宽度', () => {
    const body = functionBody(readSource(AUTH), 'LoginPage');
    const matched = findOpenTags(body, 'Button').some((tag) => (
      attrValue(tag.text, 'type') === 'submit'
      && attrValue(tag.text, 'variant') === 'primary'
      && attrValue(tag.text, 'size') === 'lg'
      && classTokens(tag.text).includes('w-full')
      && classTokens(tag.text).includes('sm:w-auto')
    ));
    expect(matched).toBe(true);
  });

  it('错误页用 Page width=form 包住带 AlertTriangle 的 EmptyState，且不做全屏居中', () => {
    const source = readSource(ERROR);
    for (const name of ERROR_PAGES) {
      const chunks = returnChunks(functionBody(source, name));
      expect(chunks.length, name).toBeGreaterThan(0);
      for (const [index, chunk] of chunks.entries()) {
        const label = `${name}#${index + 1}`;
        expect(chunk, label).toMatch(/<Page\b[^>]*\swidth="form"/);
        expect(chunk, label).toMatch(/<EmptyState\b/);
        expect(chunk, label).toMatch(/icon=\{<AlertTriangle\b/);
      }
    }
    expect(source).not.toMatch(/\bmin-h-dvh\b/);
    expect(source).not.toMatch(/\bplace-items-center\b/);
  });

  it('错误页不用 PageHeader', () => {
    expect(readSource(ERROR)).not.toMatch(/<PageHeader\b/);
  });

  it('删除 MetricTile 并改用 Stat', () => {
    const src = readSource(GENERIC);
    expect(src).not.toMatch(/\bfunction MetricTile\b/);
    expect(src).not.toMatch(/<MetricTile\b/);
    expect(src).toMatch(/<Stat(?=[\s/>])/);
  });

  it('兑换码输入在手机上使用 16px，避免 iOS 聚焦放大', () => {
    const sizes = utilityFontPx(readSource(STYLES), readSource(TOKENS));
    expect(sizes.get('text-lg'), 'text-lg token').toBe(IOS_INPUT_PX);
    const tags = findOpenTags(readSource(REDEEM_DIALOG), 'Input');
    const input = tags.find((tag) => attrValue(tag.text, 'name') === 'code');
    expect(input, 'name=code').toBeDefined();
    const className = attrValue(input?.text ?? '', 'className');
    expect(className).not.toMatch(/\btext-base\b/);
    expect(mobileFontPx(className, sizes), className).toBe(IOS_INPUT_PX);
  });
});
