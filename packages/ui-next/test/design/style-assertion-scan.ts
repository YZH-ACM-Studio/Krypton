export type StyleHitKind = 'source-class' | 'dom-class' | 'class-locator';

export interface StyleHit {
  line: number;
  kind: StyleHitKind;
  text: string;
}

export interface Intent {
  testFile: string;
  itName: string;
  sourceFile: string;
}

export const DOM_CLASS_WHITELIST: readonly string[] = [
  'min-h-0',
  'min-w-0',
  'flex-1',
  'shrink-0',
  'h-full',
  'w-full',
  'max-w-full',
  'overflow-hidden',
  'overflow-auto',
  'overflow-y-auto',
  'overflow-x-auto',
  'overscroll-contain',
  'sticky',
  'fixed',
  'absolute',
  'relative',
];

const WHITELIST = new Set<string>(DOM_CLASS_WHITELIST);

// Exact utilities only. A hyphenated form counts when it is listed here or matches a prefix below.
const BARE_UTILITIES = new Set<string>([
  'flex',
  'grid',
  'block',
  'inline',
  'inline-flex',
  'inline-block',
  'inline-grid',
  'hidden',
  'invisible',
  'visible',
  'contents',
  'sticky',
  'fixed',
  'absolute',
  'relative',
  'static',
  'truncate',
  'grow',
  'shrink',
  'shrink-0',
  'flex-1',
  'group',
  'peer',
  'uppercase',
  'lowercase',
  'italic',
  'underline',
  'border',
  'rounded',
  'shadow',
  'transition',
  'tabular-nums',
]);

// The hyphen is part of the match, so bare `from` / `content` / `to` are not utilities.
const UTILITY_PREFIXES: readonly string[] = [
  'pointer-events',
  'motion-reduce',
  'focus-visible',
  'motion-safe',
  'decoration',
  'line-clamp',
  'overscroll',
  'transition',
  'whitespace',
  'auto-cols',
  'auto-rows',
  'grid-cols',
  'grid-rows',
  'translate',
  'backdrop',
  'duration',
  'overflow',
  'tracking',
  'animate',
  'justify',
  'opacity',
  'outline',
  'rounded',
  'aspect',
  'border',
  'bottom',
  'cursor',
  'divide',
  'rotate',
  'scroll',
  'select',
  'shadow',
  'stroke',
  'basis',
  'break',
  'delay',
  'inset',
  'items',
  'order',
  'place',
  'right',
  'scale',
  'space',
  'touch',
  'content',
  'leading',
  'ease',
  'fill',
  'font',
  'from',
  'flex',
  'left',
  'ring',
  'self',
  'size',
  'snap',
  'text',
  'gap',
  'max-h',
  'max-w',
  'min-h',
  'min-w',
  'col',
  'row',
  'top',
  'via',
  'bg',
  'mb',
  'ml',
  'mr',
  'mt',
  'mx',
  'my',
  'pb',
  'pe',
  'pl',
  'pr',
  'ps',
  'pt',
  'px',
  'py',
  'to',
  'h',
  'm',
  'p',
  'w',
  'z',
];

const VARIANT_PREFIX = /^[^:\s]+:/;
const LEADING_DELIMITERS = /^["'`*+?(){]+/;
const TRAILING_DELIMITERS = /["'`}>/;,)*+?]+$/;
const ATTRIBUTE_NAME = /^[\w-]+=/;
const SOURCE_MARKER = '- 源文件：';
const SOURCE_CALLS = [
  'include(',
  'include.members(',
  'toContain(',
  'match(',
  'toMatch(',
  'contain(',
  'assert.match(',
  'assert.doesNotMatch(',
] as const;
const REGEX_STARTERS = new Set(['(', '[', '{', ',', ';', '=', '!', '?', ':', '&', '|', '~', '^']);

interface Literal {
  kind: 'string' | 'regex';
  body: string;
}

interface ReadResult {
  body: string;
  next: number;
}

interface TokenScan {
  utilities: string[];
  classValueHasUtility: boolean;
}

export function isUtilityToken(token: string): boolean {
  let rest = token;
  while (VARIANT_PREFIX.test(rest)) rest = rest.replace(VARIANT_PREFIX, '');
  while (rest.startsWith('!') || rest.startsWith('-')) rest = rest.slice(1);
  if (rest.length === 0) return false;
  if (BARE_UTILITIES.has(rest)) return true;
  return UTILITY_PREFIXES.some((prefix) => rest.startsWith(`${prefix}-`));
}

export function findStyleAssertions(testSource: string): StyleHit[] {
  const lines = testSource.split(/\r?\n/);
  const hits: StyleHit[] = [];
  let skipBorrowed = false;
  let inMembers = false;
  for (let index = 0; index < lines.length; index += 1) {
    if (skipBorrowed) {
      skipBorrowed = false;
      continue;
    }
    const line = lines[index] ?? '';
    if (line.includes('include.members(')) inMembers = true;
    const nextLine = lines[index + 1];
    const ownLiterals = extractLiterals(line);
    // members() arguments stay on their own lines; borrowing would hide every class but the first.
    const borrow = ownLiterals.length === 0
      && nextLine !== undefined
      && lineHasPendingLiteral(line)
      && !line.includes('include.members(');
    const literals = borrow ? extractLiterals(nextLine) : ownLiterals;
    if (borrow) skipBorrowed = true;
    let kind = classifyLine(line, literals);
    // The capture often sits on the borrowed line, so `className=\"(` is not on the call itself.
    if (borrow && nextLine !== undefined && isStructuralLocator(nextLine)) kind = 'class-locator';
    if (kind === null && inMembers && scanLiterals(literals).utilities.length > 0) kind = 'source-class';
    if (kind !== null) hits.push({ line: index + 1, kind, text: line.trim() });
    if (line.includes('])')) inMembers = false;
  }
  return hits;
}

export function parseIntents(markdown: string): Intent[] {
  const intents: Intent[] = [];
  let title: string | null = null;
  let sourceFile: string | null = null;
  const finish = (): void => {
    if (title === null) return;
    const splitAt = title.indexOf('::');
    if (splitAt < 0) throw new Error(`意图清单标题缺少 ::：${title}`);
    if (sourceFile === null) throw new Error(`意图清单标题缺少源文件：${title}`);
    intents.push({
      testFile: title.slice(0, splitAt).trim(),
      itName: title.slice(splitAt + 2).trim(),
      sourceFile,
    });
  };
  for (const line of markdown.split(/\r?\n/)) {
    if (line.startsWith('## ')) {
      finish();
      title = line.slice(3).trim();
      sourceFile = null;
      continue;
    }
    if (title === null) continue;
    const trimmed = line.trim();
    if (!trimmed.startsWith(SOURCE_MARKER)) continue;
    sourceFile = trimmed.slice(SOURCE_MARKER.length).replaceAll('`', '').trim();
  }
  finish();
  return intents;
}

function classifyLine(line: string, literals: readonly Literal[]): StyleHitKind | null {
  if (isStructuralLocator(line)) return 'class-locator';
  const tokens = scanLiterals(literals);
  if (isMethodLocator(line) && tokens.utilities.length > 0) return 'class-locator';
  if (isDomClassLine(line) && tokens.utilities.some((token) => !WHITELIST.has(token))) return 'dom-class';
  const sourceCall = isSourceCallLine(line) && tokens.utilities.length > 0;
  if (sourceCall || tokens.classValueHasUtility) return 'source-class';
  return null;
}

function lineHasPendingLiteral(line: string): boolean {
  return isSourceCallLine(line) || line.includes('toHaveClass(') || isMethodLocator(line);
}

function isStructuralLocator(line: string): boolean {
  return line.includes('className="(')
    || line.includes('className="([')
    || line.includes('className=\\"(');
}

function isMethodLocator(line: string): boolean {
  return line.includes('.indexOf(')
    || line.includes('.lastIndexOf(')
    || line.includes('.search(')
    || line.includes('.split(')
    || line.includes('.startsWith(')
    || line.includes('.endsWith(')
    || line.includes('classList.contains(')
    || line.includes('.querySelector(')
    || line.includes('.querySelectorAll(')
    || line.includes('.closest(');
}

function isDomClassLine(line: string): boolean {
  if (line.includes('toHaveClass(')) return true;
  if (!line.includes('.className')) return false;
  return line.includes('include(')
    || line.includes('toContain(')
    || line.includes('match(')
    || line.includes('toMatch(');
}

function isSourceCallLine(line: string): boolean {
  if (line.includes('.className') || line.includes('toHaveClass(')) return false;
  return SOURCE_CALLS.some((call) => line.includes(call));
}

function scanLiterals(literals: readonly Literal[]): TokenScan {
  const utilities: string[] = [];
  let classValueHasUtility = false;
  for (const literal of literals) {
    const cleaned = cleanLiteral(literal.body);
    let classValueOpen = false;
    for (const rawFragment of cleaned.split(/\s+/)) {
      if (rawFragment.length === 0) continue;
      if (classValueOpen) {
        const continued = consumeContinuation(rawFragment, utilities);
        if (continued.hit) classValueHasUtility = true;
        classValueOpen = continued.open;
        if (continued.open || !shouldReprocess(rawFragment)) continue;
      }
      const decision = consumeFragment(rawFragment, utilities);
      if (decision === 'class-open' || decision === 'class-open-hit') classValueOpen = true;
      if (decision === 'class-hit' || decision === 'class-open-hit') classValueHasUtility = true;
    }
  }
  return { utilities, classValueHasUtility };
}

function shouldReprocess(rawFragment: string): boolean {
  const token = stripDelimiters(rawFragment);
  return token.startsWith('<') || ATTRIBUTE_NAME.test(token);
}

function consumeContinuation(rawFragment: string, utilities: string[]): { open: boolean; hit: boolean } {
  if (shouldReprocess(rawFragment)) return { open: false, hit: false };
  const token = stripDelimiters(rawFragment);
  const hit = rememberUtilities(token, utilities);
  return { open: !/["'`}]/.test(rawFragment), hit };
}

type FragmentDecision = 'class-open' | 'class-open-hit' | 'class-hit' | 'skip';

function consumeFragment(rawFragment: string, utilities: string[]): FragmentDecision {
  const fragment = rawFragment.replace(LEADING_DELIMITERS, '');
  if (fragment.length === 0 || fragment.startsWith('<')) return 'skip';
  const attribute = ATTRIBUTE_NAME.exec(fragment);
  if (attribute) {
    const name = attribute[0].slice(0, -1);
    if (!isClassAttributeName(name)) return 'skip';
    const { value, closed } = readAttributeValue(fragment.slice(attribute[0].length));
    const hit = value.length > 0 && isUtilityToken(value);
    if (hit) utilities.push(value);
    if (!closed) return hit ? 'class-open-hit' : 'class-open';
    return hit ? 'class-hit' : 'skip';
  }
  const token = stripDelimiters(fragment);
  rememberUtilities(token, utilities);
  return 'skip';
}

const CLASS_SELECTOR = /^[A-Za-z][\w-]*(?:\.[A-Za-z_:][\w:[\]%-]*)+$/;

function rememberUtilities(token: string, utilities: string[]): boolean {
  if (token.length === 0) return false;
  let hit = false;
  if (isUtilityToken(token)) {
    utilities.push(token);
    hit = true;
  }
  if (!token.startsWith('.') && !CLASS_SELECTOR.test(token)) return hit;
  for (const part of token.split('.')) {
    const piece = stripDelimiters(part);
    if (piece.length === 0 || piece === token || !isUtilityToken(piece)) continue;
    utilities.push(piece);
    hit = true;
  }
  return hit;
}

function isClassAttributeName(name: string): boolean {
  return name === 'class' || name === 'className' || name.endsWith('ClassName');
}

function readAttributeValue(rest: string): { value: string; closed: boolean } {
  const quote = rest[0] ?? '';
  if (quote === '"' || quote === '\'' || quote === '`') {
    const closeAt = rest.indexOf(quote, 1);
    if (closeAt === -1) return { value: stripDelimiters(rest.slice(1)), closed: false };
    return { value: stripDelimiters(rest.slice(1, closeAt)), closed: true };
  }
  if (quote === '{') {
    const closeAt = rest.lastIndexOf('}');
    if (closeAt <= 0) return { value: stripDelimiters(rest.slice(1)), closed: false };
    return { value: stripDelimiters(rest.slice(1, closeAt)), closed: true };
  }
  return { value: stripDelimiters(rest), closed: true };
}

function stripDelimiters(value: string): string {
  return value.replace(LEADING_DELIMITERS, '').replace(TRAILING_DELIMITERS, '');
}

function cleanLiteral(body: string): string {
  // A template writes `\\s` so the RegExp source contains `\s`. Collapse pairs before matching metas.
  const normalized = collapseBackslashPairs(body);
  let cleaned = '';
  let index = 0;
  while (index < normalized.length) {
    const slice = normalized.slice(index);
    if (slice.startsWith('${')) {
      index = skipBraced(normalized, index + 1);
      cleaned += ' ';
      continue;
    }
    if (slice.startsWith('[\\s\\S]')) {
      index += 6;
      cleaned += ' ';
      continue;
    }
    if (slice.startsWith('[^')) {
      const closeAt = normalized.indexOf(']', index + 2);
      if (closeAt !== -1) {
        index = closeAt + 1;
        cleaned += ' ';
        continue;
      }
    }
    const escaped = normalized[index + 1] ?? '';
    if (normalized[index] === '\\' && (escaped === 's' || escaped === 'S' || escaped === 'b' || escaped === 'd' || escaped === 'w')) {
      index += 2;
      cleaned += ' ';
      continue;
    }
    if (slice.startsWith('(?:')) {
      index += 3;
      cleaned += ' ';
      continue;
    }
    if ((slice.startsWith('.*') || slice.startsWith('.+'))) {
      index += 2;
      cleaned += ' ';
      continue;
    }
    const ch = normalized[index] ?? '';
    if (ch === '|' || ch === '^' || ch === '$') {
      index += 1;
      cleaned += ' ';
      continue;
    }
    if (ch === '\\') {
      index += 1;
      continue;
    }
    cleaned += ch;
    index += 1;
  }
  return cleaned;
}

function collapseBackslashPairs(body: string): string {
  let current = body;
  while (current.includes('\\\\')) current = current.replaceAll('\\\\', '\\');
  return current;
}

function skipBraced(text: string, braceIndex: number): number {
  let depth = 0;
  let index = braceIndex;
  while (index < text.length) {
    const ch = text[index] ?? '';
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      index += 1;
      if (depth === 0) return index;
      continue;
    }
    index += 1;
  }
  return text.length;
}

function extractLiterals(line: string): Literal[] {
  const literals: Literal[] = [];
  let code = '';
  let index = 0;
  while (index < line.length) {
    const ch = line[index] ?? '';
    const next = line[index + 1] ?? '';
    if (ch === '\'' || ch === '"') {
      const read = readQuoted(line, index);
      literals.push({ kind: 'string', body: read.body });
      code += ch;
      index = advance(index, read.next);
      continue;
    }
    if (ch === '`') {
      const read = readTemplate(line, index);
      literals.push({ kind: 'string', body: read.body });
      code += ch;
      index = advance(index, read.next);
      continue;
    }
    if (ch === '/' && next === '/') break;
    if (ch === '/' && next === '*') {
      const end = line.indexOf('*/', index + 2);
      if (end < 0) break;
      code += ' ';
      index = end + 2;
      continue;
    }
    if (ch === '/' && canStartRegex(code)) {
      const read = readRegex(line, index);
      if (read) {
        literals.push({ kind: 'regex', body: read.body });
        code += '/';
        index = advance(index, read.next);
        continue;
      }
    }
    code += ch;
    index += 1;
  }
  return literals;
}

function advance(index: number, next: number): number {
  if (next <= index) throw new Error(`style-assertion-scan: literal reader did not advance at index ${index}`);
  return next;
}

function canStartRegex(code: string): boolean {
  let index = code.length - 1;
  while (index >= 0) {
    const ch = code[index] ?? '';
    if (ch !== ' ' && ch !== '\t') break;
    index -= 1;
  }
  if (index < 0) return true;
  return REGEX_STARTERS.has(code[index] ?? '');
}

function readQuoted(line: string, start: number): ReadResult {
  const quote = line[start] ?? '';
  let body = '';
  let index = start + 1;
  while (index < line.length) {
    const ch = line[index] ?? '';
    if (ch === '\\') {
      const escaped = line[index + 1];
      if (escaped === undefined) {
        body += '\\';
        break;
      }
      body += `\\${escaped}`;
      index += 2;
      continue;
    }
    if (ch === quote) return { body, next: index + 1 };
    body += ch;
    index += 1;
  }
  return { body, next: line.length };
}

function readTemplate(line: string, start: number): ReadResult {
  let body = '';
  let index = start + 1;
  while (index < line.length) {
    const ch = line[index] ?? '';
    if (ch === '\\') {
      const escaped = line[index + 1];
      if (escaped === undefined) {
        body += '\\';
        break;
      }
      body += `\\${escaped}`;
      index += 2;
      continue;
    }
    if (ch === '`') return { body, next: index + 1 };
    if (ch === '$' && line[index + 1] === '{') {
      const end = skipBraced(line, index + 1);
      body += line.slice(index, end);
      index = end;
      continue;
    }
    body += ch;
    index += 1;
  }
  return { body, next: line.length };
}

function readRegex(line: string, start: number): ReadResult | null {
  let body = '';
  let index = start + 1;
  let inClass = false;
  while (index < line.length) {
    const ch = line[index] ?? '';
    if (ch === '\\') {
      const escaped = line[index + 1];
      if (escaped === undefined) return null;
      body += `${ch}${escaped}`;
      index += 2;
      continue;
    }
    if (ch === '[') inClass = true;
    else if (ch === ']' && inClass) inClass = false;
    if (ch === '/' && !inClass) {
      let next = index + 1;
      while (next < line.length && /[a-z]/i.test(line[next] ?? '')) next += 1;
      return { body, next };
    }
    body += ch;
    index += 1;
  }
  return null;
}
