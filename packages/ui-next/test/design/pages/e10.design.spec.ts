// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { expectExplicitButtonVariants, expectGateClean, findOpenTags, readSource } from '../helpers.ts';

const STUDENT_CARD = 'src/pages/vigil/student-card.tsx';
const STUDENT_SHEET = 'src/pages/vigil/student-detail-sheet.tsx';
const EVENT_DIALOG = 'src/pages/vigil/event-detail-dialog.tsx';
const PLAYBACK_DIALOG = 'src/pages/vigil/recording-playback-dialog.tsx';
const MESSAGE_DIALOG = 'src/pages/vigil/send-message-dialog.tsx';
const LIVE_DIALOG = 'src/pages/vigil/live-player-dialog.tsx';
const DELETE_DIALOG = 'src/pages/vigil/recording-delete-dialog.tsx';
const CONFIRM_DIALOG = 'src/pages/vigil/confirm-action-dialog.tsx';

const LANE_FILES = [
  STUDENT_CARD,
  STUDENT_SHEET,
  EVENT_DIALOG,
  PLAYBACK_DIALOG,
  MESSAGE_DIALOG,
  LIVE_DIALOG,
  DELETE_DIALOG,
  CONFIRM_DIALOG,
] as const;

const DIALOG_FILES = [
  EVENT_DIALOG,
  PLAYBACK_DIALOG,
  MESSAGE_DIALOG,
  LIVE_DIALOG,
  DELETE_DIALOG,
  CONFIRM_DIALOG,
] as const;

const PLAYER_FILES = [LIVE_DIALOG, PLAYBACK_DIALOG] as const;

const PANEL_TOKENS = ['rounded-lg', 'border', 'border-line', 'bg-surface', 'shadow-xs'] as const;
const STATUS_NAMES = ['online', 'anomaly', 'offline', 'disconnected', 'locked', 'ended'] as const;
const TONE_NAMES = ['neutral', 'brand', 'success', 'warning', 'danger', 'info', 'violet', 'orange'] as const;
const BUTTON_VARIANTS = ['primary', 'secondary', 'soft', 'ghost', 'danger', 'danger-soft', 'link', 'default', 'outline', 'destructive'] as const;
const BUTTON_SIZES = ['sm', 'md', 'lg', 'default', 'icon'] as const;

// 八个文件都是组件：结构规格只有门禁，不写 expectPageStructure。
// legacy-intents T01–T04 没有这些源文件的条目。
// 在线 / 离线对应 status online / offline。告警、违规不是现有状态文案，tone 取值必须含 warning 与 danger。

type ButtonVariantName = (typeof BUTTON_VARIANTS)[number];
type ButtonSizeName = (typeof BUTTON_SIZES)[number];

function bindingRegion(source: string, name: string): string {
  const pattern = new RegExp(`(?:^|\\n)(?:export\\s+)?(?:async\\s+)?(?:function\\s+${name}\\b|const\\s+${name}\\b)`);
  const start = source.search(pattern);
  if (start < 0) return '';
  const from = source[start] === '\n' ? start + 1 : start;
  const rest = source.slice(from + 1);
  const next = rest.search(/\n(?:export\s+)?(?:async\s+)?(?:function\s|const\s|interface\s|type\s|class\s)/);
  return next < 0 ? source.slice(from) : source.slice(from, from + 1 + next);
}

function referencedNames(body: string): string[] {
  const names = new Set<string>();
  for (const match of body.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\b/g)) {
    const name = match[1];
    if (name) names.add(name);
  }
  return [...names];
}

function statusPillRegion(source: string): string {
  const seen = new Set<string>();
  const queue = ['StatusPill'];
  const parts: string[] = [];
  while (queue.length > 0) {
    const name = queue.pop();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    const region = bindingRegion(source, name);
    if (!region) continue;
    parts.push(region);
    for (const id of referencedNames(region)) {
      if (!seen.has(id)) queue.push(id);
    }
  }
  return parts.join('\n');
}

function parseStatusTones(region: string): Map<string, string> {
  const map = new Map<string, string>();
  const status = STATUS_NAMES.join('|');
  const tone = TONE_NAMES.join('|');
  for (const match of region.matchAll(new RegExp(`\\b(${status})\\s*:\\s*['"](${tone})['"]`, 'g'))) {
    const key = match[1];
    const value = match[2];
    if (key && value) map.set(key, value);
  }
  for (const match of region.matchAll(new RegExp(`===\\s*['"](${status})['"]\\s*\\?\\s*['"](${tone})['"]`, 'g'))) {
    const key = match[1];
    const value = match[2];
    if (key && value) map.set(key, value);
  }
  const lines = region.split('\n');
  let pending: string[] = [];
  for (const line of lines) {
    const caseMatch = /case\s+['"]([a-z]+)['"]\s*:/.exec(line);
    const caseStatus = caseMatch?.[1];
    if (caseStatus && (STATUS_NAMES as readonly string[]).includes(caseStatus)) pending.push(caseStatus);
    const toneMatch = new RegExp(`(?:return|=)\\s+['"](${tone})['"]`).exec(line);
    const toneName = toneMatch?.[1];
    if (toneName && pending.length > 0) {
      for (const key of pending) map.set(key, toneName);
      pending = [];
      continue;
    }
    if (/\breturn\b/.test(line) || /\bbreak\b/.test(line)) pending = [];
  }
  return map;
}

function knownButtonVariant(value: string | undefined): ButtonVariantName | undefined {
  if (value === undefined) return undefined;
  for (const variant of BUTTON_VARIANTS) {
    if (variant === value) return variant;
  }
  return undefined;
}

function knownButtonSize(value: string | undefined): ButtonSizeName | undefined {
  if (value === undefined) return undefined;
  for (const size of BUTTON_SIZES) {
    if (size === value) return size;
  }
  return undefined;
}

function attrLiteral(tag: string, name: string): string | undefined {
  const quoted = new RegExp(`${name}\\s*=\\s*["']([^"']+)["']`).exec(tag);
  if (quoted?.[1]) return quoted[1];
  const braced = new RegExp(`${name}\\s*=\\s*\\{\\s*["']([^"']+)["']\\s*\\}`).exec(tag);
  return braced?.[1];
}

function asciiClassStrings(tag: string): string[] {
  const chunks: string[] = [];
  for (const match of tag.matchAll(/['"`]([^'"`]*)['"`]/g)) {
    const text = match[1] ?? '';
    if (text.length === 0 || !/^[a-zA-Z0-9\s:/_[\]().-]+$/.test(text)) continue;
    chunks.push(text);
  }
  return chunks;
}

function studentCardRoot(source: string): string {
  const body = bindingRegion(source, 'StudentCard');
  const tags = [...findOpenTags(body, 'button'), ...findOpenTags(body, 'Button')];
  return tags.find((tag) => tag.text.includes('onClick') && tag.text.includes('onDoubleClick'))?.text ?? '';
}

function studentCardClass(tag: string): string {
  const own = asciiClassStrings(tag).join(' ');
  if (!tag.startsWith('<Button')) return cn(own);
  return cn(
    buttonVariants({
      variant: knownButtonVariant(attrLiteral(tag, 'variant')),
      size: knownButtonSize(attrLiteral(tag, 'size')),
    }),
    own,
  );
}

function classTokens(value: string): string[] {
  return value.split(/\s+/).filter((token) => token.length > 0);
}

function quotedClassText(source: string): string {
  const parts: string[] = [];
  for (const pattern of [/'([^']*)'/g, /"([^"]*)"/g] as const) {
    for (const match of source.matchAll(pattern)) {
      const text = match[1] ?? '';
      if (text.length > 0 && /^[a-zA-Z0-9\s:/_[\]().-]+$/.test(text)) parts.push(text);
    }
  }
  return parts.join(' ');
}

function hoverMotionTokens(value: string): string[] {
  return classTokens(value).filter((token) => (
    /^(?:[\w-]+:)*hover:(?:-?translate|scale|shadow)[\w./[\]-]*$/.test(token)
    || /^(?:[\w-]+:)*group-hover:(?:-?translate|scale|shadow)[\w./[\]-]*$/.test(token)
  ));
}

function importsDialog(source: string): boolean {
  return /import\s*\{[^}]*\bDialog\b[^}]*\}\s*from\s*['"]@\/components\/ui\/dialog['"]/.test(source);
}

function hasDestructiveConfirmDialog(source: string): boolean {
  return /confirmDialog\s*\(/.test(source) && /destructive\s*:\s*true/.test(source);
}

type VariantExpr = string | boolean;

// 危险分支把 confirmVariant 固定成 'destructive' 再求值。开标签里出现 danger 字符串不算通过。
function variantExpression(tag: string): string | null {
  const bracedAt = tag.search(/variant\s*=\s*\{/);
  const quotedAt = tag.search(/variant\s*=\s*["']/);
  if (bracedAt >= 0 && (quotedAt < 0 || bracedAt < quotedAt)) {
    const brace = tag.indexOf('{', bracedAt);
    let depth = 0;
    for (let index = brace; index < tag.length; index += 1) {
      const ch = tag[index];
      if (ch === '{') depth += 1;
      else if (ch === '}') {
        depth -= 1;
        if (depth === 0) return tag.slice(brace + 1, index).trim();
      }
    }
    return null;
  }
  const quoted = /variant\s*=\s*(["'])([^"']*)\1/.exec(tag);
  const literal = quoted?.[2];
  return literal === undefined ? null : `'${literal}'`;
}

function destructiveBranchVariant(expression: string): string | null {
  const parsed = evaluateVariantExpression(expression);
  return typeof parsed === 'string' ? parsed : null;
}

function evaluateVariantExpression(input: string): VariantExpr | null {
  let index = 0;

  function skip(): void {
    while (index < input.length && /\s/.test(input.charAt(index))) index += 1;
  }

  function parseTernary(): VariantExpr | null {
    const condition = parseOr();
    if (condition === null) return null;
    skip();
    if (input.charAt(index) !== '?') return condition;
    index += 1;
    const whenTrue = parseTernary();
    if (whenTrue === null) return null;
    skip();
    if (input.charAt(index) !== ':') return null;
    index += 1;
    const whenFalse = parseTernary();
    if (whenFalse === null || typeof condition !== 'boolean') return null;
    return condition ? whenTrue : whenFalse;
  }

  function parseOr(): VariantExpr | null {
    let left = parseAnd();
    if (left === null) return null;
    skip();
    while (input.slice(index, index + 2) === '||') {
      index += 2;
      const right = parseAnd();
      if (right === null || typeof left !== 'boolean' || typeof right !== 'boolean') return null;
      left = left || right;
      skip();
    }
    return left;
  }

  function parseAnd(): VariantExpr | null {
    let left = parseEquality();
    if (left === null) return null;
    skip();
    while (input.slice(index, index + 2) === '&&') {
      index += 2;
      const right = parseEquality();
      if (right === null || typeof left !== 'boolean' || typeof right !== 'boolean') return null;
      left = left && right;
      skip();
    }
    return left;
  }

  function parseEquality(): VariantExpr | null {
    let left = parseUnary();
    if (left === null) return null;
    skip();
    while (input.startsWith('===', index) || input.startsWith('!==', index)) {
      const op = input.startsWith('!==', index) ? '!==' : '===';
      index += op.length;
      const right = parseUnary();
      if (right === null) return null;
      left = op === '===' ? left === right : left !== right;
      skip();
    }
    return left;
  }

  function parseUnary(): VariantExpr | null {
    skip();
    if (input.charAt(index) === '!') {
      index += 1;
      const inner = parseUnary();
      if (typeof inner !== 'boolean') return null;
      return !inner;
    }
    return parsePrimary();
  }

  function parsePrimary(): VariantExpr | null {
    skip();
    const ch = input.charAt(index);
    if (ch === '(') {
      index += 1;
      const inner = parseTernary();
      skip();
      if (input.charAt(index) !== ')') return null;
      index += 1;
      return inner;
    }
    if (ch === "'" || ch === '"') {
      index += 1;
      const start = index;
      while (index < input.length && input.charAt(index) !== ch) index += 1;
      if (input.charAt(index) !== ch) return null;
      const value = input.slice(start, index);
      index += 1;
      return value;
    }
    const ident = /^[A-Za-z_][A-Za-z0-9_]*/.exec(input.slice(index));
    const name = ident?.[0];
    if (!name) return null;
    index += name.length;
    if (name === 'confirmVariant') return 'destructive';
    if (name === 'true') return true;
    if (name === 'false') return false;
    return null;
  }

  const value = parseTernary();
  skip();
  if (value === null || index !== input.length) return null;
  return value;
}

function confirmButtonResolvesDanger(tag: string): boolean {
  const expression = variantExpression(tag);
  if (expression === null) return false;
  return destructiveBranchVariant(expression) === 'danger';
}

function buttonBlocks(source: string): { tag: string; body: string }[] {
  const blocks: { tag: string; body: string }[] = [];
  let from = 0;
  for (const tag of findOpenTags(source, 'Button')) {
    const start = source.indexOf(tag.text, from);
    if (start < 0) continue;
    const after = start + tag.text.length;
    from = after;
    if (tag.text.endsWith('/>')) {
      blocks.push({ tag: tag.text, body: '' });
      continue;
    }
    const close = source.indexOf('</Button>', after);
    blocks.push({ tag: tag.text, body: close < 0 ? '' : source.slice(after, close) });
  }
  return blocks;
}

function playerKeepsBlack(source: string): boolean {
  const patterns = [
    /className\s*=\s*"([^"]*)"/g,
    /className\s*=\s*'([^']*)'/g,
    /className\s*=\s*\{`([^`]*)`\}/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const tokens = (match[1] ?? '').split(/\s+/);
      if (tokens.includes('bg-black') && (tokens.includes('min-h-0') || tokens.includes('flex-1'))) return true;
    }
  }
  return false;
}

function exactBlackSites(source: string): { text: string; index: number }[] {
  const sites: { text: string; index: number }[] = [];
  for (const match of source.matchAll(/(['"`])([^'"`]*)\1/g)) {
    const text = match[2] ?? '';
    if (!text.split(/\s+/).includes('bg-black')) continue;
    sites.push({ text, index: match.index ?? 0 });
  }
  return sites;
}

function enclosingFunction(source: string, index: number): string {
  const matches = [...source.slice(0, index).matchAll(/\bfunction\s+([A-Za-z0-9_]+)/g)];
  return matches[matches.length - 1]?.[1] ?? '';
}

function functionRendersVideoTag(source: string, name: string): boolean {
  if (!name) return false;
  return /<video(?=[\s>/])/.test(bindingRegion(source, name));
}

function openTagEnd(source: string, start: number): number {
  let quote = '';
  for (let index = start; index < source.length; index += 1) {
    const ch = source[index] ?? '';
    if (quote) {
      if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '>') return index;
  }
  return -1;
}

function elementInner(source: string, classIndex: number): string {
  const start = source.lastIndexOf('<', classIndex);
  if (start < 0) return '';
  const name = /^<([A-Za-z][A-Za-z0-9]*)/.exec(source.slice(start))?.[1];
  if (!name) return '';
  const openEnd = openTagEnd(source, start);
  if (openEnd < 0 || source[openEnd - 1] === '/') return '';
  const close = `</${name}>`;
  let depth = 1;
  let index = openEnd + 1;
  while (index < source.length && depth > 0) {
    const nextOpen = source.indexOf(`<${name}`, index);
    const nextClose = source.indexOf(close, index);
    if (nextClose < 0) return source.slice(openEnd + 1);
    const boundary = source[nextOpen + 1 + name.length] ?? '';
    const openOk = nextOpen >= 0 && nextOpen < nextClose && /[\s>/]/.test(boundary);
    if (openOk) {
      depth += 1;
      index = nextOpen + name.length + 1;
      continue;
    }
    depth -= 1;
    if (depth === 0) return source.slice(openEnd + 1, nextClose);
    index = nextClose + close.length;
  }
  return '';
}

function subtreeRendersVideo(source: string, inner: string, seen: Set<string>): boolean {
  if (/<video(?=[\s>/])/.test(inner)) return true;
  for (const match of inner.matchAll(/<([A-Z][A-Za-z0-9]*)(?=[\s/>])/g)) {
    const child = match[1];
    if (!child || seen.has(child)) continue;
    seen.add(child);
    if (functionRendersVideoTag(source, child) || subtreeRendersVideo(source, bindingRegion(source, child), seen)) return true;
  }
  return false;
}

// 纯黑只属于视频画面：播放器井、画中画，以及视频组件自己的全幅画面/遮罩。截屏灯箱和控制条不算。
function isVideoPictureBlack(file: string, source: string, index: number, text: string): boolean {
  if (!(PLAYER_FILES as readonly string[]).includes(file)) return false;
  const tokens = new Set(text.split(/\s+/));
  if (tokens.has('min-h-0') && tokens.has('flex-1')) return true;
  if (subtreeRendersVideo(source, elementInner(source, index), new Set())) return true;
  const owner = enclosingFunction(source, index);
  if (!functionRendersVideoTag(source, owner)) return false;
  const mask = tokens.has('absolute') && tokens.has('inset-0');
  const fullBleed = tokens.has('h-full') && tokens.has('w-full') && !tokens.has('border-t');
  return mask || fullBleed;
}

describe('e10 vigil cards, sheets and dialogs', () => {
  it('门禁零违规', () => {
    expectGateClean([...LANE_FILES]);
  });

  it('按钮显式写 variant', () => {
    expectExplicitButtonVariants([...LANE_FILES]);
  });

  it('状态徽标保持 StatusPill 导出名，内部用 Badge dot', () => {
    const source = readSource(STUDENT_CARD);
    const region = statusPillRegion(source);
    const badges = findOpenTags(region, 'Badge');
    const tones = parseStatusTones(region);
    expect({
      exported: source.includes('export function StatusPill'),
      badge: badges.length > 0 && badges.every((tag) => /\bdot\b/.test(tag.text)) && badges.some((tag) => /\btone\s*=/.test(tag.text)),
      online: tones.get('online') ?? '',
      offline: tones.get('offline') ?? '',
      warning: [...tones.values()].includes('warning'),
      danger: [...tones.values()].includes('danger'),
    }).toEqual({
      exported: true,
      badge: true,
      online: 'success',
      offline: 'neutral',
      warning: true,
      danger: true,
    });
  });

  it('学生卡片用 Panel 外观，悬停只变边框', () => {
    const source = readSource(STUDENT_CARD);
    const root = studentCardRoot(source);
    const merged = studentCardClass(root);
    const tokens = new Set(classTokens(merged));
    const missing = PANEL_TOKENS.filter((token) => !tokens.has(token));
    const hoverBorder = [...tokens].some((token) => token.startsWith('hover:border'));
    // secondary 自带 hover:bg-surface-hover。悬停只变边框，合并后只允许用 hover:bg-surface 抵消它。
    const hoverBackground = [...tokens].filter((token) => /(?:^|:)hover:bg-/.test(token) && token !== 'hover:bg-surface');
    const motion = hoverMotionTokens(`${merged} ${quotedClassText(bindingRegion(source, 'StudentCard'))}`);
    expect({ root: root.length > 0, missing, hoverBorder, hoverBackground, motion }).toEqual({
      root: true,
      missing: [],
      hoverBorder: true,
      hoverBackground: [],
      motion: [],
    });
    // md Button 的 [&_svg]:size-4 比图标自己的 size-* 更特异。占位图标必须用 important 保住 32px。
    const card = bindingRegion(source, 'StudentCard');
    expect(card).toMatch(/<ImageIcon[^>]*size-8!/);
    expect(card).toMatch(/focus-visible:ring-inset/);
  });

  it('对话框使用 Dialog 系列', () => {
    const problems: string[] = [];
    for (const file of DIALOG_FILES) {
      const source = readSource(file);
      if (!importsDialog(source)) problems.push(`${file} 未从 @/components/ui/dialog 导入 Dialog`);
      if (findOpenTags(source, 'Dialog').length === 0) problems.push(`${file} 未渲染 Dialog`);
    }
    expect(problems).toEqual([]);
  });

  it('危险确认使用 confirmDialog({ destructive: true }) 或 Button variant="danger"', () => {
    const problems: string[] = [];
    const confirm = readSource(CONFIRM_DIALOG);
    const submit = findOpenTags(confirm, 'Button').find((tag) => /type\s*=\s*["']submit["']/.test(tag.text));
    if (!hasDestructiveConfirmDialog(confirm) && (submit === undefined || !confirmButtonResolvesDanger(submit.text))) {
      problems.push('confirm-action-dialog 的确认按钮没有 variant="danger"，也没有 confirmDialog({ destructive: true })');
    }
    const remove = readSource(DELETE_DIALOG);
    const deleteButton = buttonBlocks(remove).find((block) => block.body.includes('删除'));
    if (!hasDestructiveConfirmDialog(remove) && (deleteButton === undefined || !confirmButtonResolvesDanger(deleteButton.tag))) {
      problems.push('recording-delete-dialog 的删除确认没有 variant="danger"，也没有 confirmDialog({ destructive: true })');
    }
    expect(problems).toEqual([]);
  });

  it('视频播放器容器保持 bg-black', () => {
    const problems = PLAYER_FILES.filter((file) => !playerKeepsBlack(readSource(file)));
    expect(problems).toEqual([]);
  });

  it('视频画面区域才允许纯黑', () => {
    const problems: string[] = [];
    for (const file of LANE_FILES) {
      const source = readSource(file);
      for (const site of exactBlackSites(source)) {
        if (!isVideoPictureBlack(file, source, site.index, site.text)) problems.push(`${file}: ${site.text.trim()}`);
      }
    }
    expect(problems).toEqual([]);
  });
});
