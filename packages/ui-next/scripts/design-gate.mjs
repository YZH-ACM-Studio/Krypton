import { existsSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const packageRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const baselinePath = join(packageRoot, 'design-gate.baseline.json');

const NATIVE_TAGS = ['button', 'select', 'textarea', 'table', 'input'];
const INPUT_TYPE_EXEMPT = ['type="hidden"', "type='hidden'", 'type="file"', "type='file'"];

// `text-[…]` belongs to DS009 and `rounded-[…]` to DS012. DS004's lookahead keeps one token on one rule.
const RULE_DEFS = [
  {
    id: 'DS001',
    description: '原始色板工具类',
    exemptUi: false,
    patterns: [
      /(?<![\w-])(?:bg|text|border(?:-[xytrblse])?|ring(?:-offset)?|outline|from|via|to|fill|stroke|divide|decoration|caret|accent|shadow|placeholder)-(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone)-(?:50|100|200|300|400|500|600|700|800|900|950)(?:\/\d{1,3})?(?![\w-])/g,
    ],
  },
  {
    id: 'DS002',
    description: '旧 token 工具类',
    exemptUi: false,
    patterns: [
      /(?<![\w-])(?:bg|text|border(?:-[xytrblse])?|ring(?:-offset)?|outline|from|via|to|fill|stroke|divide|decoration|caret|shadow|placeholder)-(?:primary-foreground|primary|secondary-foreground|secondary|muted-foreground|muted|accent-foreground|accent|destructive-foreground|destructive|card-foreground|card|popover-foreground|popover|background|foreground|input|border|sidebar(?:-[a-z]+)*)(?:\/\d{1,3})?(?![\w-])/g,
    ],
  },
  {
    id: 'DS003',
    description: '颜色字面量',
    exemptUi: false,
    patterns: [
      /(?<![\w&])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3})(?![\w-])/g,
      /\b(?:rgba?|hsla?|oklch)\(/g,
    ],
  },
  {
    id: 'DS004',
    description: '长度任意值',
    exemptUi: true,
    patterns: [
      /(?<![\w-])(?!text-\[|rounded(?:-(?:[trblse]|tl|tr|bl|br|ss|se|es|ee))?-\[)[a-z][a-z0-9-]*-\[-?(?:\d+(?:\.\d+)?|\.\d+)(?:px|rem|em)\]/g,
      /\[calc\(/g,
    ],
  },
  {
    id: 'DS005',
    description: '原生 button、select、textarea、table 和非 hidden/file input',
    exemptUi: true,
    patterns: [],
  },
  {
    id: 'DS006',
    description: '数字时长',
    exemptUi: true,
    patterns: [
      /(?<![\w-])(?:duration|delay)-\d+(?![\w-])/g,
      /\b(?:duration|delay)\s*:\s*\d/g,
    ],
  },
  {
    id: 'DS007',
    description: '任意 z-index',
    exemptUi: false,
    patterns: [
      /(?<![\w-])z-\[/g,
    ],
  },
  {
    id: 'DS009',
    description: '非阶梯字号',
    exemptUi: false,
    patterns: [
      /(?<![\w-])text-(?:base|[4-9]xl|\[[^\]\s]*\])(?![\w-])/g,
    ],
  },
  {
    id: 'DS010',
    description: 'dark: 变体',
    exemptUi: true,
    patterns: [
      /(?<![\w-])dark:/g,
    ],
  },
  {
    id: 'DS011',
    description: '不允许的阴影',
    exemptUi: false,
    patterns: [
      /(?<![\w-])shadow-(?:md|lg|xl|2xl|inner)(?![\w-])/g,
    ],
  },
  {
    id: 'DS012',
    description: '不允许的圆角',
    exemptUi: false,
    patterns: [
      /(?<![\w-])rounded(?:-(?:[trblse]|tl|tr|bl|br|ss|se|es|ee))?(?:-(?:2xl|3xl|\[[^\]\s]*\]))?(?![\w[-])/g,
    ],
  },
  {
    id: 'DS013',
    description: 'backdrop-blur',
    exemptUi: false,
    patterns: [
      /(?<![\w-])backdrop-blur/g,
    ],
  },
  {
    id: 'DS014',
    description: '渐变背景',
    exemptUi: false,
    patterns: [
      /(?<![\w-])bg-(?:gradient|linear|radial|conic)-/g,
    ],
  },
  {
    id: 'DS015',
    description: '入场或悬停动画',
    exemptUi: true,
    patterns: [
      /initial=\{\{\s*(?:opacity:\s*0\b|[xy]:)/g,
      /\bwhile(?:Hover|InView|Tap)\b/g,
    ],
  },
];

export const RULES = RULE_DEFS.map((rule) => ({
  id: rule.id,
  description: rule.description,
  exemptUi: rule.exemptUi,
}));

function normalizeNewlines(source) {
  return source.replaceAll('\r\n', '\n');
}

function isUiSource(file) {
  return file === 'src/components/ui' || file.startsWith('src/components/ui/');
}

function lineAllowsRule(line, ruleId) {
  return new RegExp(`ds-allow ${ruleId}\\b`).test(line);
}

function isExemptLine(lines, lineIndex, ruleId) {
  const current = lines[lineIndex] ?? '';
  if (lineAllowsRule(current, ruleId)) {
    return true;
  }
  if (lineIndex <= 0) {
    return false;
  }
  return lineAllowsRule(lines[lineIndex - 1] ?? '', ruleId);
}

function collectMatches(pattern, text) {
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
  const expression = new RegExp(pattern.source, flags);
  const matches = [];
  for (let match = expression.exec(text); match !== null; match = expression.exec(text)) {
    matches.push(match[0]);
    if (match[0].length === 0) {
      expression.lastIndex += 1;
    }
  }
  return matches;
}

function isTagBoundary(char) {
  return char === '>' || char === '/' || /\s/.test(char);
}

// `>` ends the tag only at brace depth 0, outside quotes and template strings.
// JSX attribute quotes do not treat `\` as an escape. Strings opened inside `{` do.
function findOpenTagEnd(text, start) {
  let depth = 0;
  let quote = '';
  let quoteEscapes = false;
  for (let index = start + 1; index < text.length; index += 1) {
    const char = text[index];
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
      if (depth > 0) {
        depth -= 1;
      }
      continue;
    }
    if (char === '>' && depth === 0) {
      return index;
    }
  }
  return -1;
}

export function scanOpenTags(source, tag) {
  const text = normalizeNewlines(source);
  const needle = `<${tag}`;
  const tags = [];
  let from = 0;
  while (from < text.length) {
    const start = text.indexOf(needle, from);
    if (start < 0) {
      break;
    }
    const boundary = text[start + needle.length];
    if (boundary === undefined || !isTagBoundary(boundary)) {
      from = start + needle.length;
      continue;
    }
    const end = findOpenTagEnd(text, start);
    if (end < 0) {
      from = start + needle.length;
      continue;
    }
    const line = text.slice(0, start).split('\n').length;
    tags.push({
      line,
      text: text.slice(start, end + 1),
    });
    // A same-name tag can sit inside this open tag, for example inside `{() => <button>}`.
    from = start + needle.length;
  }
  return tags;
}

function isExemptInput(tagText) {
  return INPUT_TYPE_EXEMPT.some((token) => tagText.includes(token));
}

function collectNativeControlViolations(text, lines, file) {
  const violations = [];
  for (const tag of NATIVE_TAGS) {
    for (const open of scanOpenTags(text, tag)) {
      const lineIndex = open.line - 1;
      if (isExemptLine(lines, lineIndex, 'DS005')) {
        continue;
      }
      if (tag === 'input' && isExemptInput(open.text)) {
        continue;
      }
      violations.push({
        file,
        line: open.line,
        rule: 'DS005',
        snippet: open.text,
      });
    }
  }
  return violations;
}

function compareViolations(left, right) {
  if (left.line !== right.line) {
    return left.line - right.line;
  }
  if (left.rule < right.rule) {
    return -1;
  }
  if (left.rule > right.rule) {
    return 1;
  }
  return 0;
}

export function scanSource(source, file) {
  const normalizedFile = packageRelative(file).normalized;
  const text = normalizeNewlines(source);
  const lines = text.split('\n');
  const violations = [];
  const ui = isUiSource(normalizedFile);
  for (const rule of RULE_DEFS) {
    if (rule.exemptUi && ui) {
      continue;
    }
    if (rule.id === 'DS005') {
      violations.push(...collectNativeControlViolations(text, lines, normalizedFile));
      continue;
    }
    for (const [index, line] of lines.entries()) {
      if (isExemptLine(lines, index, rule.id)) {
        continue;
      }
      for (const pattern of rule.patterns) {
        for (const snippet of collectMatches(pattern, line)) {
          violations.push({
            file: normalizedFile,
            line: index + 1,
            rule: rule.id,
            snippet,
          });
        }
      }
    }
  }
  violations.sort(compareViolations);
  return violations;
}

function packageRelative(file) {
  const slash = file.replaceAll('\\', '/');
  if (slash.startsWith('/') || /^[A-Za-z]:/.test(slash)) {
    throw new TypeError(`design-gate: file must be relative to packages/ui-next: ${file}`);
  }
  const absolute = resolve(packageRoot, slash);
  const rootWithSep = packageRoot.endsWith(sep) ? packageRoot : `${packageRoot}${sep}`;
  if (absolute !== packageRoot && !absolute.startsWith(rootWithSep)) {
    throw new TypeError(`design-gate: file escapes packages/ui-next: ${file}`);
  }
  return {
    normalized: relative(packageRoot, absolute).split(sep).join('/'),
    absolute,
  };
}

export function scanFile(file) {
  const { normalized, absolute } = packageRelative(file);
  return scanSource(readFileSync(absolute, 'utf8'), normalized);
}

function isExcludedTreeFile(file) {
  return file.startsWith('src/playground/') || file.startsWith('src/design/');
}

export function scanTree() {
  const srcRoot = join(packageRoot, 'src');
  const entries = readdirSync(srcRoot, { recursive: true, encoding: 'utf8' });
  const counts = {};
  for (const entry of entries) {
    if (typeof entry !== 'string') {
      throw new TypeError('design-gate: readdir returned a non-string path');
    }
    const entryPath = entry.replaceAll('\\', '/');
    if (entryPath.endsWith('.d.ts') || (!entryPath.endsWith('.ts') && !entryPath.endsWith('.tsx'))) {
      continue;
    }
    const file = `src/${entryPath}`;
    if (isExcludedTreeFile(file)) {
      continue;
    }
    const absolute = join(srcRoot, entry);
    if (!statSync(absolute).isFile()) {
      continue;
    }
    const found = scanSource(readFileSync(absolute, 'utf8'), file);
    if (found.length === 0) {
      continue;
    }
    const rules = {};
    for (const item of found) {
      rules[item.rule] = (rules[item.rule] ?? 0) + 1;
    }
    counts[file] = rules;
  }
  return counts;
}

function ruleNames(currentRules, baselineRules) {
  return [...new Set([...Object.keys(currentRules), ...Object.keys(baselineRules)])].sort();
}

export function compareToBaseline(current, baseline) {
  const rises = [];
  const files = [...new Set([...Object.keys(current), ...Object.keys(baseline.files)])].sort();
  for (const file of files) {
    const currentRules = current[file] ?? {};
    const baselineRules = baseline.files[file] ?? {};
    for (const rule of ruleNames(currentRules, baselineRules)) {
      const currentCount = currentRules[rule] ?? 0;
      const baselineCount = baselineRules[rule] ?? 0;
      if (currentCount > baselineCount) {
        rises.push({
          file,
          rule,
          baseline: baselineCount,
          current: currentCount,
        });
      }
    }
  }
  return rises;
}

export function lowerBaseline(current, baseline) {
  if (compareToBaseline(current, baseline).length > 0) {
    throw new Error('design-gate: baseline can only go down');
  }
  const files = {};
  for (const file of Object.keys(baseline.files).sort()) {
    const baselineRules = baseline.files[file] ?? {};
    const currentRules = current[file] ?? {};
    const nextRules = {};
    for (const rule of Object.keys(baselineRules).sort()) {
      const next = currentRules[rule] ?? 0;
      if (next > 0) {
        nextRules[rule] = next;
      }
    }
    if (Object.keys(nextRules).length > 0) {
      files[file] = nextRules;
    }
  }
  return { version: 1, files };
}

function serializeBaseline(baseline) {
  const files = {};
  for (const file of Object.keys(baseline.files).sort()) {
    const rules = baseline.files[file] ?? {};
    const sortedRules = {};
    for (const rule of Object.keys(rules).sort()) {
      const count = rules[rule] ?? 0;
      if (count > 0) {
        sortedRules[rule] = count;
      }
    }
    if (Object.keys(sortedRules).length > 0) {
      files[file] = sortedRules;
    }
  }
  return `${JSON.stringify({ version: 1, files }, null, 2)}\n`;
}

function readBaseline() {
  const raw = readFileSync(baselinePath, 'utf8');
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`design-gate: baseline is not valid JSON: ${message}`);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new TypeError('design-gate: baseline is not an object');
  }
  if (parsed.version !== 1) {
    throw new TypeError('design-gate: baseline version is not 1');
  }
  if (typeof parsed.files !== 'object' || parsed.files === null || Array.isArray(parsed.files)) {
    throw new TypeError('design-gate: baseline.files is not an object');
  }
  const files = {};
  for (const [file, rules] of Object.entries(parsed.files)) {
    if (typeof rules !== 'object' || rules === null || Array.isArray(rules)) {
      throw new TypeError(`design-gate: baseline.files.${file} is not an object`);
    }
    const counts = {};
    for (const [rule, count] of Object.entries(rules)) {
      if (typeof count !== 'number' || !Number.isInteger(count) || count < 0) {
        throw new TypeError(`design-gate: baseline count for ${file} ${rule} is not a non-negative integer`);
      }
      if (count > 0) {
        counts[rule] = count;
      }
    }
    if (Object.keys(counts).length > 0) {
      files[file] = counts;
    }
  }
  return { version: 1, files };
}

function countBaselineViolations(baseline) {
  let total = 0;
  for (const rules of Object.values(baseline.files)) {
    for (const count of Object.values(rules)) {
      total += count;
    }
  }
  return total;
}

function printRises(rises) {
  for (const rise of rises) {
    console.log(`${rise.file} ${rise.rule} ${rise.baseline} -> ${rise.current}`);
  }
}

function runCheck() {
  if (!existsSync(baselinePath)) {
    console.log('design-gate: baseline missing, run --init');
    return 2;
  }
  const baseline = readBaseline();
  const rises = compareToBaseline(scanTree(), baseline);
  if (rises.length > 0) {
    printRises(rises);
    return 1;
  }
  const fileCount = Object.keys(baseline.files).length;
  const violations = countBaselineViolations(baseline);
  console.log(`design-gate: ok (${fileCount} files, ${violations} violations in baseline)`);
  return 0;
}

function runInit() {
  if (existsSync(baselinePath)) {
    console.error('design-gate: baseline already exists');
    return 2;
  }
  writeFileSync(baselinePath, serializeBaseline({ version: 1, files: scanTree() }));
  return 0;
}

function runUpdate() {
  if (!existsSync(baselinePath)) {
    console.error('design-gate: baseline missing, run --init');
    return 2;
  }
  const baseline = readBaseline();
  const current = scanTree();
  const rises = compareToBaseline(current, baseline);
  if (rises.length > 0) {
    printRises(rises);
    console.error('design-gate: baseline can only go down');
    return 1;
  }
  writeFileSync(baselinePath, serializeBaseline(lowerBaseline(current, baseline)));
  return 0;
}

function runFile(file) {
  const found = scanFile(file);
  for (const item of found) {
    console.log(`${item.line} ${item.rule} ${item.snippet.replaceAll(/\s+/g, ' ')}`);
  }
  return found.length > 0 ? 1 : 0;
}

function main(argv) {
  if (argv.length === 0) {
    return runCheck();
  }
  if (argv.length === 1 && argv[0] === '--init') {
    return runInit();
  }
  if (argv.length === 1 && argv[0] === '--update') {
    return runUpdate();
  }
  if (argv.length === 2 && argv[0] === '--file') {
    const file = argv[1];
    if (!file) {
      console.error('design-gate: --file requires a path');
      return 2;
    }
    return runFile(file);
  }
  console.error('design-gate: usage: node scripts/design-gate.mjs [--init | --update | --file <path>]');
  return 2;
}

function isDirectExecution() {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }
  const entryUrl = pathToFileURL(realpathSync(entry)).href;
  const moduleUrl = pathToFileURL(realpathSync(fileURLToPath(import.meta.url))).href;
  return entryUrl === moduleUrl;
}

if (isDirectExecution()) {
  const code = main(process.argv.slice(2));
  if (code !== 0) {
    process.exitCode = code;
  }
}
