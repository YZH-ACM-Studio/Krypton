// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  expectExplicitButtonVariants,
  expectGateClean,
  expectPageStructure,
  findOpenTags,
  readSource,
} from '../helpers.ts';

const ACCOUNTS = 'src/pages/admin-accounts.tsx';
const TOKENS = 'src/pages/authtoken/index.tsx';

const LANE_FILES = [ACCOUNTS, TOKENS] as const;

const SHELL = {
  widths: [],
  workspace: 'forbidden' as const,
  minPageHeaders: 0,
};

const STACK_MOBILE = /mobile=(?:"stack"|'stack'|\{["']stack["']\})/;
const LEGACY_TABLE = /<Table(?:Head|Body|Row|Cell|Header)?(?=[\s>/])/g;
const DESTRUCTIVE_OPTION = /destructive\s*:\s*true\b|destructive\s*:\s*destructive\b|\{\s*destructive\s*[,}]/;

interface ButtonRecord {
  open: string;
  onClick: string;
  children: string;
}

interface DangerEntry {
  name: string;
  source: string;
  matches(button: ButtonRecord): boolean;
}

function endOfDelimited(source: string, start: number, openChar: string, closeChar: string): number {
  let depth = 0;
  let quote: '"' | "'" | '`' | '' = '';
  for (let index = start; index < source.length; index += 1) {
    const char = source[index] ?? '';
    if (quote === '"') {
      if (char === '\\') {
        index += 1;
        continue;
      }
      if (char === '"') quote = '';
      continue;
    }
    if (quote === "'") {
      if (char === '\\') {
        index += 1;
        continue;
      }
      if (char === "'") quote = '';
      continue;
    }
    if (quote === '`') {
      if (char === '\\') {
        index += 1;
        continue;
      }
      if (char === '`') {
        quote = '';
        continue;
      }
      if (char === '$' && source[index + 1] === '{') {
        const end = endOfDelimited(source, index + 1, '{', '}');
        if (end < 0) return -1;
        index = end;
      }
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }
    if (char === openChar) depth += 1;
    else if (char === closeChar) {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function findOpenTagEnd(source: string, start: number): number {
  let depth = 0;
  let quote = '';
  let quoteEscapes = false;
  for (let index = start + 1; index < source.length; index += 1) {
    const char = source[index] ?? '';
    if (quote) {
      if (quoteEscapes && char === '\\') {
        index += 1;
        continue;
      }
      if (char === quote) {
        quote = '';
        quoteEscapes = false;
      }
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      quoteEscapes = depth > 0 || char === '`';
      continue;
    }
    if (char === '{') {
      depth += 1;
      continue;
    }
    if (char === '}') {
      if (depth > 0) depth -= 1;
      continue;
    }
    if (char === '>' && depth === 0) return index;
  }
  return -1;
}

function readBraced(source: string, openIndex: number): string {
  const end = endOfDelimited(source, openIndex, '{', '}');
  if (end < 0) return '';
  return source.slice(openIndex + 1, end);
}

function readUntilSemicolon(source: string, start: number): string {
  let paren = 0;
  let brace = 0;
  let bracket = 0;
  let quote: '"' | "'" | '`' | '' = '';
  for (let index = start; index < source.length; index += 1) {
    const char = source[index] ?? '';
    if (quote === '"') {
      if (char === '\\') {
        index += 1;
        continue;
      }
      if (char === '"') quote = '';
      continue;
    }
    if (quote === "'") {
      if (char === '\\') {
        index += 1;
        continue;
      }
      if (char === "'") quote = '';
      continue;
    }
    if (quote === '`') {
      if (char === '\\') {
        index += 1;
        continue;
      }
      if (char === '`') {
        quote = '';
        continue;
      }
      if (char === '$' && source[index + 1] === '{') {
        const end = endOfDelimited(source, index + 1, '{', '}');
        if (end < 0) return source.slice(start);
        index = end;
      }
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }
    if (char === '(') paren += 1;
    else if (char === ')') paren = Math.max(0, paren - 1);
    else if (char === '{') brace += 1;
    else if (char === '}') brace = Math.max(0, brace - 1);
    else if (char === '[') bracket += 1;
    else if (char === ']') bracket = Math.max(0, bracket - 1);
    else if (char === ';' && paren === 0 && brace === 0 && bracket === 0) {
      return source.slice(start, index);
    }
  }
  return source.slice(start);
}

function indexOfBinding(source: string, pattern: string): number {
  let from = 0;
  while (from < source.length) {
    const index = source.indexOf(pattern, from);
    if (index < 0) return -1;
    const before = index === 0 ? '' : (source[index - 1] ?? '');
    if (before === '' || /[^A-Za-z0-9_$]/.test(before)) return index;
    from = index + pattern.length;
  }
  return -1;
}

function nextCodeBrace(source: string, start: number): number {
  let paren = 0;
  let quote: '"' | "'" | '`' | '' = '';
  for (let index = start; index < source.length; index += 1) {
    const char = source[index] ?? '';
    if (quote === '"') {
      if (char === '\\') {
        index += 1;
        continue;
      }
      if (char === '"') quote = '';
      continue;
    }
    if (quote === "'") {
      if (char === '\\') {
        index += 1;
        continue;
      }
      if (char === "'") quote = '';
      continue;
    }
    if (quote === '`') {
      if (char === '\\') {
        index += 1;
        continue;
      }
      if (char === '`') {
        quote = '';
        continue;
      }
      if (char === '$' && source[index + 1] === '{') {
        const end = endOfDelimited(source, index + 1, '{', '}');
        if (end < 0) return -1;
        index = end;
      }
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }
    if (char === '(') paren += 1;
    else if (char === ')') paren = Math.max(0, paren - 1);
    else if (char === '{' && paren === 0) return index;
  }
  return -1;
}

function sliceBinding(source: string, name: string): string {
  const fn = indexOfBinding(source, `function ${name}`);
  if (fn >= 0) {
    const paren = source.indexOf('(', fn + `function ${name}`.length);
    if (paren < 0) return '';
    const paramsEnd = endOfDelimited(source, paren, '(', ')');
    if (paramsEnd < 0) return '';
    const brace = nextCodeBrace(source, paramsEnd + 1);
    if (brace < 0) return '';
    return readBraced(source, brace);
  }
  const decl = indexOfBinding(source, `const ${name} =`);
  if (decl < 0) return '';
  const paren = source.indexOf('(', decl + `const ${name} =`.length);
  let arrowAt = source.indexOf('=>', decl);
  if (paren >= 0 && paren < arrowAt) {
    const paramsEnd = endOfDelimited(source, paren, '(', ')');
    if (paramsEnd >= 0) arrowAt = source.indexOf('=>', paramsEnd);
  }
  if (arrowAt < 0) return '';
  let index = arrowAt + 2;
  while (source[index] === ' ' || source[index] === '\n' || source[index] === '\r') index += 1;
  if (source[index] === '{') return readBraced(source, index);
  return readUntilSemicolon(source, index);
}

function regionFrom(source: string, marker: string): string {
  const start = source.indexOf(marker);
  if (start < 0) return '';
  const next = source.slice(start).search(/\n(?:export )?function /);
  if (next < 0) return source.slice(start);
  return source.slice(start, start + next);
}

function buttonRecords(source: string): ButtonRecord[] {
  const records: ButtonRecord[] = [];
  let from = 0;
  while (from < source.length) {
    const start = source.indexOf('<Button', from);
    if (start < 0) break;
    const boundary = source[start + '<Button'.length] ?? '';
    if (!/[\s>/]/.test(boundary)) {
      from = start + '<Button'.length;
      continue;
    }
    const openEnd = findOpenTagEnd(source, start);
    if (openEnd < 0) break;
    const open = source.slice(start, openEnd + 1);
    const onClickAt = open.indexOf('onClick=');
    let onClick = '';
    if (onClickAt >= 0) {
      const brace = open.indexOf('{', onClickAt);
      if (brace >= 0) onClick = readBraced(open, brace);
    }
    const close = source.indexOf('</Button>', openEnd);
    const children = close < 0 ? '' : source.slice(openEnd + 1, close);
    records.push({ open, onClick, children });
    from = close < 0 ? openEnd + 1 : close + '</Button>'.length;
  }
  return records;
}

function variantExpression(openTag: string): string | null {
  const at = openTag.search(/\bvariant=/);
  if (at < 0) return null;
  const after = openTag.slice(at + 'variant='.length);
  const quote = after[0] ?? '';
  if (quote === '"' || quote === "'") {
    const end = after.indexOf(quote, 1);
    return end < 0 ? null : after.slice(1, end);
  }
  if (quote === '{') return readBraced(after, 0);
  return null;
}

function isDangerSoft(openTag: string): boolean {
  const value = variantExpression(openTag);
  return value !== null && value.includes('danger-soft');
}

function hasDestructiveConfirmCall(source: string): boolean {
  for (const match of source.matchAll(/confirmDialog\s*\(/g)) {
    const start = match.index ?? 0;
    if (DESTRUCTIVE_OPTION.test(source.slice(start, start + 800))) return true;
  }
  return false;
}

function handlerConfirms(source: string, expr: string, seen: Set<string>): boolean {
  if (hasDestructiveConfirmCall(expr)) return true;
  const names = new Set<string>();
  for (const match of expr.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\s*\(/g)) {
    names.add(match[1] ?? '');
  }
  const trimmed = expr.trim();
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(trimmed)) names.add(trimmed);
  for (const name of names) {
    if (name === 'confirmDialog' || seen.has(name)) continue;
    seen.add(name);
    const body = sliceBinding(source, name);
    if (body.length > 0 && handlerConfirms(source, body, seen)) return true;
  }
  return false;
}

function simpleActionConfirmIsGuarded(source: string): boolean {
  const body = sliceBinding(source, 'simpleAction');
  if (!body.includes('confirmDialog')) return true;
  const gated = /if\s*\([^)]*\bdestructive\b[^)]*\)/.test(body)
    || /destructive\s*&&[\s\S]{0,240}confirmDialog\s*\(/.test(body)
    || /destructive\s*\?[\s\S]{0,240}confirmDialog\s*\(/.test(body);
  return gated && hasDestructiveConfirmCall(body);
}

function stackListProblems(source: string, marker: string): string[] {
  const region = regionFrom(source, marker);
  if (region.length === 0) return [`缺少「${marker}」`];
  const problems: string[] = [];
  const tags = findOpenTags(region, 'DataTable');
  if (tags.length === 0) problems.push(`${marker} 之后缺少 <DataTable`);
  for (const tag of tags) {
    if (!STACK_MOBILE.test(tag.text)) problems.push(`${marker} 的 DataTable 未写 mobile="stack"`);
  }
  const legacy = region.match(LEGACY_TABLE) ?? [];
  for (const tag of legacy) problems.push(`${marker} 仍使用 ${tag}`);
  return problems;
}

function actionBarHasBorder(source: string, name: string): boolean {
  const body = sliceBinding(source, name);
  return /<DialogBody\b[\s\S]*<\/DialogBody>[\s\S]*?\bborder-t\b/.test(body);
}

const DANGER_ENTRIES: DangerEntry[] = [
  {
    name: '禁用账号',
    source: ACCOUNTS,
    matches: (button) => button.onClick.includes("simpleAction('disable'") || button.onClick.includes('simpleAction("disable"'),
  },
  {
    name: '替换密码',
    source: ACCOUNTS,
    matches: (button) => /\bchangePassword\b/.test(button.onClick),
  },
  {
    name: '撤销 session',
    source: ACCOUNTS,
    matches: (button) => button.onClick.includes('revoke_sessions'),
  },
  {
    name: '撤销 API token',
    source: ACCOUNTS,
    matches: (button) => button.onClick.includes('revoke_api_tokens'),
  },
  {
    name: '撤销全部访问凭据',
    source: ACCOUNTS,
    matches: (button) => button.onClick.includes("'revoke_all'") || button.onClick.includes('"revoke_all"'),
  },
  {
    name: '撤销令牌',
    source: TOKENS,
    matches: (button) => button.children.includes('撤销') && /\.revoked\b/.test(button.open),
  },
  {
    name: '批量禁用',
    source: ACCOUNTS,
    matches: (button) => button.open.includes("action === 'disable'") || button.open.includes('action === "disable"'),
  },
];

function clickClosure(source: string, expr: string, seen: Set<string>): string {
  let text = expr;
  const names = new Set<string>();
  for (const match of expr.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\s*\(/g)) {
    names.add(match[1] ?? '');
  }
  const trimmed = expr.trim();
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(trimmed)) names.add(trimmed);
  for (const name of names) {
    if (name === 'confirmDialog' || seen.has(name)) continue;
    seen.add(name);
    const body = sliceBinding(source, name);
    if (body.length === 0) continue;
    text += `\n${clickClosure(source, body, seen)}`;
  }
  return text;
}

function destructiveConfirmCount(source: string): number {
  let count = 0;
  for (const match of source.matchAll(/confirmDialog\s*\(/g)) {
    const start = match.index ?? 0;
    if (DESTRUCTIVE_OPTION.test(source.slice(start, start + 800))) count += 1;
  }
  return count;
}

function tokenRevokeProblem(source: string, onClick: string): string | null {
  // 只跟随入口实际调用的函数。RevokeDialog 里另写 confirmDialog 不算入口自己的那一次确认。
  const closure = clickClosure(source, onClick, new Set());
  const confirms = destructiveConfirmCount(closure);
  const revokes = /operation\s*:\s*['"]revoke['"]/.test(closure);
  const opensDialog = /\bsetRevokeTarget\s*\(/.test(closure);
  if (opensDialog && !revokes) {
    return '撤销令牌 的入口只调用 setRevokeTarget 打开自定义对话框，吊销不在这次点击里；对话框内再 confirmDialog 会变成第二次确认';
  }
  if (confirms !== 1) {
    return `撤销令牌 的入口路径应恰好一次 confirmDialog({ destructive: true })，当前 ${confirms} 次`;
  }
  if (!revokes) return '撤销令牌 的入口在确认后没有直接吊销';
  if (opensDialog) return '撤销令牌 的入口在 confirmDialog 之外还打开了自定义撤销对话框';
  return null;
}

function stripWrappingParens(expr: string): string {
  let text = expr.trim();
  while (text.startsWith('(') && endOfDelimited(text, 0, '(', ')') === text.length - 1) {
    text = text.slice(1, -1).trim();
  }
  return text;
}

function splitTopLevel(expr: string, op: '||' | '&&'): string[] | null {
  const parts: string[] = [];
  let depth = 0;
  let quote: '"' | "'" | '`' | '' = '';
  let last = 0;
  for (let index = 0; index < expr.length; index += 1) {
    const char = expr[index] ?? '';
    if (quote) {
      if (char === '\\') {
        index += 1;
        continue;
      }
      if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }
    if (char === '(' || char === '[' || char === '{') depth += 1;
    else if (char === ')' || char === ']' || char === '}') depth = Math.max(0, depth - 1);
    else if (depth === 0 && expr.startsWith(op, index)) {
      parts.push(expr.slice(last, index));
      last = index + op.length;
      index += op.length - 1;
    }
  }
  if (parts.length === 0) return null;
  parts.push(expr.slice(last));
  return parts;
}

function splitTernary(expr: string): { cond: string; yes: string; no: string } | null {
  let depth = 0;
  let quote: '"' | "'" | '`' | '' = '';
  let mark = -1;
  for (let index = 0; index < expr.length; index += 1) {
    const char = expr[index] ?? '';
    if (quote) {
      if (char === '\\') {
        index += 1;
        continue;
      }
      if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }
    if (char === '(' || char === '[' || char === '{') depth += 1;
    else if (char === ')' || char === ']' || char === '}') depth = Math.max(0, depth - 1);
    else if (depth === 0 && char === '?' && expr[index + 1] !== '.' && expr[index + 1] !== '?') {
      mark = index;
      break;
    }
  }
  if (mark < 0) return null;
  depth = 0;
  quote = '';
  let nested = 0;
  for (let index = mark + 1; index < expr.length; index += 1) {
    const char = expr[index] ?? '';
    if (quote) {
      if (char === '\\') {
        index += 1;
        continue;
      }
      if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }
    if (char === '(' || char === '[' || char === '{') depth += 1;
    else if (char === ')' || char === ']' || char === '}') depth = Math.max(0, depth - 1);
    else if (depth === 0 && char === '?' && expr[index + 1] !== '.' && expr[index + 1] !== '?') nested += 1;
    else if (depth === 0 && char === ':') {
      if (nested === 0) {
        return { cond: expr.slice(0, mark), yes: expr.slice(mark + 1, index), no: expr.slice(index + 1) };
      }
      nested -= 1;
    }
  }
  return null;
}

function evalCond(expr: string, action: string): 'yes' | 'no' | 'maybe' {
  const trimmed = stripWrappingParens(expr);
  const orParts = splitTopLevel(trimmed, '||');
  if (orParts) {
    const parts = orParts.map((part) => evalCond(part, action));
    if (parts.includes('yes')) return 'yes';
    if (parts.every((part) => part === 'no')) return 'no';
    return 'maybe';
  }
  const andParts = splitTopLevel(trimmed, '&&');
  if (andParts) {
    const parts = andParts.map((part) => evalCond(part, action));
    if (parts.includes('no')) return 'no';
    if (parts.every((part) => part === 'yes')) return 'yes';
    return 'maybe';
  }
  const eq = trimmed.match(/^action\s*===\s*(['"])([A-Za-z0-9_]+)\1$/);
  if (eq) return eq[2] === action ? 'yes' : 'no';
  const ne = trimmed.match(/^action\s*!==\s*(['"])([A-Za-z0-9_]+)\1$/);
  if (ne) return ne[2] === action ? 'no' : 'yes';
  const includes = trimmed.match(/^\[([\s\S]*)\]\s*\.includes\(\s*action\s*\)$/);
  if (includes) {
    const items = [...(includes[1] ?? '').matchAll(/(['"])([A-Za-z0-9_]+)\1/g)].map((match) => match[2] ?? '');
    return items.includes(action) ? 'yes' : 'no';
  }
  return 'maybe';
}

function evalDangerSoft(expr: string, action: string): 'yes' | 'no' | 'maybe' {
  const trimmed = stripWrappingParens(expr);
  if (trimmed === "'danger-soft'" || trimmed === '"danger-soft"') return 'yes';
  if ((trimmed.startsWith("'") && trimmed.endsWith("'")) || (trimmed.startsWith('"') && trimmed.endsWith('"'))) return 'no';
  const tern = splitTernary(trimmed);
  if (!tern) return 'maybe';
  const cond = evalCond(tern.cond, action);
  if (cond === 'yes') return evalDangerSoft(tern.yes, action);
  if (cond === 'no') return evalDangerSoft(tern.no, action);
  const whenTrue = evalDangerSoft(tern.yes, action);
  const whenFalse = evalDangerSoft(tern.no, action);
  if (whenTrue === 'yes' && whenFalse === 'yes') return 'yes';
  if (whenTrue === 'no' && whenFalse === 'no') return 'no';
  return 'maybe';
}

function assignedExpression(source: string, name: string): string {
  const decl = indexOfBinding(source, `const ${name} =`);
  if (decl < 0) return '';
  const eq = source.indexOf('=', decl + `const ${name}`.length);
  if (eq < 0) return '';
  const head = source.slice(eq + 1, eq + 80);
  if (/^\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_][A-Za-z0-9_]*)\s*=>/.test(head)) return sliceBinding(source, name);
  return readUntilSemicolon(source, eq + 1).trim();
}

function resolvedVariant(scope: string, openTag: string): string | null {
  const raw = variantExpression(openTag);
  if (raw === null) return null;
  const ident = raw.trim();
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(ident)) {
    const value = assignedExpression(scope, ident);
    if (value.length > 0) return value;
  }
  return raw;
}

function guardTexts(source: string, callIndex: number): string {
  const conds: string[] = [];
  const re = /\bif\s*\(/g;
  for (const match of source.slice(0, callIndex).matchAll(re)) {
    const open = (match.index ?? 0) + match[0].length - 1;
    const close = endOfDelimited(source, open, '(', ')');
    if (close < 0 || close >= callIndex) conds.push(source.slice(open, callIndex));
    else conds.push(source.slice(open, close + 1));
  }
  return conds.join('\n');
}

function destructiveConfirmGatedBy(source: string, action: string): boolean {
  for (const match of source.matchAll(/confirmDialog\s*\(/g)) {
    const start = match.index ?? 0;
    if (!DESTRUCTIVE_OPTION.test(source.slice(start, start + 800))) continue;
    if (new RegExp(`['"]${action}['"]`).test(guardTexts(source, start))) return true;
  }
  return false;
}

function bulkDisableProblem(source: string, onClick: string): string | null {
  const dialog = sliceBinding(source, 'BulkActionDialog');
  const names = new Set<string>();
  for (const match of onClick.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\s*\(/g)) {
    names.add(match[1] ?? '');
  }
  const parts = [onClick];
  for (const name of names) {
    if (name === 'confirmDialog') continue;
    const body = sliceBinding(dialog, name);
    if (body.length > 0) parts.push(body);
  }
  const path = parts.join('\n');
  const gated = /action\s*===\s*['"]disable['"]\s*&&[\s\S]{0,900}?confirmDialog\s*\(/.test(path)
    || /if\s*\(\s*action\s*===\s*['"]disable['"][\s\S]{0,900}?confirmDialog\s*\(/.test(path)
    || /action\s*===\s*['"]disable['"]\s*\?[\s\S]{0,900}?confirmDialog\s*\(/.test(path);
  if (!gated || !hasDestructiveConfirmCall(path)) {
    return '批量禁用 的提交没有在 action === \'disable\' 时调用 confirmDialog({ destructive: true })';
  }
  return null;
}

function entryConfirmProblem(source: string, entry: DangerEntry, onClick: string): string | null {
  if (entry.name === '撤销令牌') return tokenRevokeProblem(source, onClick);
  if (entry.name === '批量禁用') return bulkDisableProblem(source, onClick);
  if (!handlerConfirms(source, onClick, new Set())) {
    return `${entry.name} 没有 confirmDialog({ destructive: true })`;
  }
  return null;
}

describe('m02 accounts and auth tokens', () => {
  it('门禁零违规', () => {
    expectGateClean([...LANE_FILES]);
  });

  it('按钮显式写 variant', () => {
    expectExplicitButtonVariants([...LANE_FILES]);
  });

  it('页面结构 admin-accounts.tsx', () => {
    expectPageStructure(ACCOUNTS, SHELL);
    expect(findOpenTags(readSource(ACCOUNTS), 'PageHeader')).toEqual([]);
  });

  it('页面结构 authtoken/index.tsx', () => {
    expectPageStructure(TOKENS, SHELL);
    expect(findOpenTags(readSource(TOKENS), 'PageHeader')).toEqual([]);
  });

  it('签发令牌对话框的操作条在 DialogBody 之后并带 border-t', () => {
    expect(actionBarHasBorder(readSource(TOKENS), 'IssueDialog')).toBe(true);
  });

  it('创建账号对话框的操作条在 DialogBody 之后并带 border-t', () => {
    expect(actionBarHasBorder(readSource(ACCOUNTS), 'CreateAccountDialog')).toBe(true);
  });

  it('账号列表使用 DataTable mobile="stack"', () => {
    expect(stackListProblems(readSource(ACCOUNTS), '账号列表')).toEqual([]);
  });

  it('令牌列表使用 DataTable mobile="stack"', () => {
    expect(stackListProblems(readSource(TOKENS), '签发、撤销、续期')).toEqual([]);
  });

  it('禁用、重置和吊销的入口是 danger-soft', () => {
    const byFile = new Map<string, ButtonRecord[]>();
    const problems: string[] = [];
    for (const entry of DANGER_ENTRIES) {
      let buttons = byFile.get(entry.source);
      if (buttons === undefined) {
        buttons = buttonRecords(readSource(entry.source));
        byFile.set(entry.source, buttons);
      }
      const matched = buttons.filter((button) => entry.matches(button));
      if (matched.length === 0) {
        problems.push(`找不到${entry.name}的入口按钮`);
        continue;
      }
      for (const button of matched) {
        if (!isDangerSoft(button.open)) {
          const variant = variantExpression(button.open) ?? '缺少 variant';
          problems.push(`${entry.name} 的入口不是 danger-soft（当前 ${variant}）`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it('危险确认使用 confirmDialog({ destructive: true })，非危险 simpleAction 不被一起确认', () => {
    const accounts = readSource(ACCOUNTS);
    const tokens = readSource(TOKENS);
    const problems: string[] = [];
    if (!simpleActionConfirmIsGuarded(accounts)) {
      problems.push('simpleAction 的 confirmDialog 必须只在 destructive 分支里，并且带 destructive: true');
    }
    const byFile = new Map<string, string>([[ACCOUNTS, accounts], [TOKENS, tokens]]);
    const buttonsByFile = new Map<string, ButtonRecord[]>();
    for (const entry of DANGER_ENTRIES) {
      const source = byFile.get(entry.source) ?? '';
      let buttons = buttonsByFile.get(entry.source);
      if (buttons === undefined) {
        buttons = buttonRecords(source);
        buttonsByFile.set(entry.source, buttons);
      }
      const matched = buttons.filter((button) => entry.matches(button));
      if (matched.length === 0) {
        problems.push(`找不到${entry.name}的入口按钮`);
        continue;
      }
      for (const button of matched) {
        const problem = entryConfirmProblem(source, entry, button.onClick);
        if (problem !== null) problems.push(problem);
      }
    }
    expect(problems).toEqual([]);
  });

  it('批量强制退出这条吊销在 force_logout 时用 danger-soft，并 confirmDialog({ destructive: true })', () => {
    // 批量提交按钮同时服务禁用和强制退出。只匹配 action === 'disable' 时，force_logout 可以一直是 primary 且不做破坏性确认。
    const dialog = sliceBinding(readSource(ACCOUNTS), 'BulkActionDialog');
    const problems: string[] = [];
    expect(dialog).toContain("force_logout: '批量强制退出'");
    expect(dialog).toContain('password');
    const submitButtons = buttonRecords(dialog).filter((button) => /\bsubmit\s*\(/.test(button.onClick));
    if (submitButtons.length === 0) problems.push('找不到批量提交按钮');
    for (const button of submitButtons) {
      const variant = resolvedVariant(dialog, button.open);
      if (variant === null) {
        problems.push('批量提交按钮缺少 variant');
        continue;
      }
      const covered = evalDangerSoft(variant, 'force_logout');
      if (covered !== 'yes') problems.push(`批量强制退出的入口不是 danger-soft（force_logout 判定 ${covered}：${variant.trim()}）`);
    }
    const submit = sliceBinding(dialog, 'submit');
    if (!destructiveConfirmGatedBy(submit, 'force_logout')) {
      problems.push('批量强制退出没有在 force_logout 时调用 confirmDialog({ destructive: true })');
    }
    expect(problems).toEqual([]);
  });

  it('保留禁用、替换密码和吊销的现有确认逻辑', () => {
    const accounts = readSource(ACCOUNTS);
    const tokens = readSource(TOKENS);
    expect(accounts).toContain('可逆禁用并撤销全部访问凭据；题目、提交、消息和其他业务数据不会删除。');
    expect(accounts).toMatch(/simpleAction\(\s*'disable'[\s\S]*?,\s*true\s*\)/);
    expect(accounts).toContain('account.isAdmin || account.uid === bs.user.id');
    expect(accounts).toContain('替换密码，并撤销该账号全部登录 session、恢复 token 与 API/工具 token。');
    expect(accounts).toMatch(/confirmLabel:\s*'替换密码'[\s\S]{0,80}destructive:\s*true/);
    expect(accounts).toContain('__newPassword');
    expect(accounts).toContain('目标账号将在所有已登录设备退出。');
    expect(accounts).toContain('撤销与目标账号绑定的 API/工具访问凭据。');
    expect(accounts).toContain('同时撤销 session、恢复 token 与 API/工具 token。');
    expect(accounts).toContain('requirePassword !== false');
    expect(accounts).toContain('当前管理员密码');
    expect(sliceBinding(accounts, 'SensitiveActionDialog')).toContain('password');
    expect(sliceBinding(accounts, 'BulkActionDialog')).toContain('password');
    expect(tokens).toContain('确认撤销');
    expect(tokens).toContain('撤销立即生效且不可恢复');
    expect(tokens).toContain("operation: 'revoke'");
    expect(tokens).toContain('disabled={t.revoked}');
  });
});
