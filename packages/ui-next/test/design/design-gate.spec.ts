// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

const PAGE = 'src/pages/x.tsx';
const UI = 'src/components/ui/x.tsx';
const UI_NESTED = 'src/components/ui/nested/x.tsx';
const UI_FILE = 'src/components/ui.tsx';
const NOT_UI = 'src/components/ui-extra/x.tsx';
const specDir = import.meta.dirname;
const packageRoot = resolve(specDir, '../..');

const RULE_TABLE = [
  ['DS001', false],
  ['DS002', false],
  ['DS003', false],
  ['DS004', true],
  ['DS005', true],
  ['DS006', true],
  ['DS007', false],
  ['DS009', false],
  ['DS010', true],
  ['DS011', false],
  ['DS012', false],
  ['DS013', false],
  ['DS014', false],
  ['DS015', true],
] as const;

interface Violation {
  file: string;
  line: number;
  rule: string;
  snippet: string;
}

interface Rise {
  file: string;
  rule: string;
  baseline: number;
  current: number;
}

interface Baseline {
  version: 1;
  files: Record<string, Partial<Record<string, number>>>;
}

interface OpenTag {
  line: number;
  text: string;
}

interface RuleInfo {
  id: string;
  description: string;
  exemptUi: boolean;
}

interface PageStructureSpec {
  widths: Array<'prose' | 'form' | 'wide' | 'full'>;
  workspace: 'required' | 'forbidden' | 'allowed';
  minPageHeaders: number;
}

interface GateModule {
  scanSource: (source: string, file: string) => Violation[];
  scanFile: (file: string) => Violation[];
  scanTree: () => object;
  scanOpenTags: (source: string, tag: string) => OpenTag[];
  compareToBaseline: (current: Baseline['files'], baseline: Baseline) => Rise[];
  lowerBaseline: (current: Baseline['files'], baseline: Baseline) => Baseline;
  rules: () => RuleInfo[];
}

interface HelpersModule {
  readSource: (file: string) => string;
  countMatches: (source: string, pattern: RegExp) => number;
  checkPageStructure: (source: string, spec: PageStructureSpec) => string[];
  expectPageStructure: (file: string, spec: PageStructureSpec) => void;
  expectGateClean: (files: string[]) => void;
  findOpenTags: (source: string, tag: string) => OpenTag[];
  checkExplicitButtonVariants: (source: string) => number[];
  expectExplicitButtonVariants: (files: string[]) => void;
}

function readField(record: object, key: string): unknown {
  return Object.entries(record).find(([entryKey]) => entryKey === key)?.[1];
}

function readStringField(record: object, key: string, label: string): string {
  const value = readField(record, key);
  if (typeof value !== 'string') {
    throw new TypeError(`${label}.${key} is not a string`);
  }
  return value;
}

function readNumberField(record: object, key: string, label: string): number {
  const value = readField(record, key);
  if (typeof value !== 'number') {
    throw new TypeError(`${label}.${key} is not a number`);
  }
  return value;
}

function readObject(value: unknown, label: string): object {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} is not an object`);
  }
  return value;
}

async function importRelative(relativePath: string): Promise<object> {
  const href = pathToFileURL(resolve(specDir, relativePath)).href;
  let loaded: unknown;
  try {
    loaded = await import(/* @vite-ignore */ href);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new TypeError(`${relativePath} is not loadable: ${message}`);
  }
  return readObject(loaded, relativePath);
}

function callExport(loaded: object, name: string, args: readonly unknown[]): unknown {
  const value = readField(loaded, name);
  if (typeof value !== 'function') {
    throw new TypeError(`${name} is not a function`);
  }
  return Reflect.apply(value, undefined, args);
}

function readViolation(value: unknown): Violation {
  const record = readObject(value, 'violation');
  return {
    file: readStringField(record, 'file', 'violation'),
    line: readNumberField(record, 'line', 'violation'),
    rule: readStringField(record, 'rule', 'violation'),
    snippet: readStringField(record, 'snippet', 'violation'),
  };
}

function readViolations(value: unknown, label: string): Violation[] {
  if (!Array.isArray(value)) {
    throw new TypeError(`${label} did not return an array`);
  }
  return value.map((item) => readViolation(item));
}

function readRises(value: unknown): Rise[] {
  if (!Array.isArray(value)) {
    throw new TypeError('compareToBaseline did not return an array');
  }
  return value.map((item) => {
    const record = readObject(item, 'compareToBaseline row');
    return {
      file: readStringField(record, 'file', 'compareToBaseline row'),
      rule: readStringField(record, 'rule', 'compareToBaseline row'),
      baseline: readNumberField(record, 'baseline', 'compareToBaseline row'),
      current: readNumberField(record, 'current', 'compareToBaseline row'),
    };
  });
}

function readBaseline(value: unknown): Baseline {
  const record = readObject(value, 'baseline');
  const version = readField(record, 'version');
  if (version !== 1) {
    throw new TypeError('baseline.version is not 1');
  }
  const files = readObject(readField(record, 'files'), 'baseline.files');
  const counts: Baseline['files'] = {};
  for (const [file, rules] of Object.entries(files)) {
    const ruleRecord = readObject(rules, `baseline.files.${file}`);
    const partial: Partial<Record<string, number>> = {};
    for (const [rule, count] of Object.entries(ruleRecord)) {
      if (typeof count !== 'number') {
        throw new TypeError(`baseline count for ${file} ${rule} is not a number`);
      }
      partial[rule] = count;
    }
    counts[file] = partial;
  }
  return { version: 1, files: counts };
}

function readRules(value: unknown): RuleInfo[] {
  if (!Array.isArray(value)) {
    throw new TypeError('RULES is not an array');
  }
  return value.map((item) => {
    const record = readObject(item, 'RULES entry');
    const exemptUi = readField(record, 'exemptUi');
    if (typeof exemptUi !== 'boolean') {
      throw new TypeError('RULES entry exemptUi is not a boolean');
    }
    return {
      id: readStringField(record, 'id', 'RULES entry'),
      description: readStringField(record, 'description', 'RULES entry'),
      exemptUi,
    };
  });
}

function readProblems(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw new TypeError('checkPageStructure did not return an array');
  }
  return value.map((item) => {
    if (typeof item !== 'string') {
      throw new TypeError('checkPageStructure problem is not a string');
    }
    return item;
  });
}

function readTags(value: unknown, label: string): OpenTag[] {
  if (!Array.isArray(value)) {
    throw new TypeError(`${label} did not return an array`);
  }
  return value.map((item) => {
    const record = readObject(item, label);
    return {
      line: readNumberField(record, 'line', label),
      text: readStringField(record, 'text', label),
    };
  });
}

function readLineNumbers(value: unknown): number[] {
  if (!Array.isArray(value)) {
    throw new TypeError('checkExplicitButtonVariants did not return an array');
  }
  return value.map((item) => {
    if (typeof item !== 'number') {
      throw new TypeError('checkExplicitButtonVariants entry is not a line number');
    }
    return item;
  });
}

function bindGate(loaded: object): GateModule {
  return {
    scanSource: (source, file) => readViolations(callExport(loaded, 'scanSource', [source, file]), 'scanSource'),
    scanFile: (file) => readViolations(callExport(loaded, 'scanFile', [file]), 'scanFile'),
    scanTree: () => readObject(callExport(loaded, 'scanTree', []), 'scanTree'),
    scanOpenTags: (source, tag) => readTags(callExport(loaded, 'scanOpenTags', [source, tag]), 'scanOpenTags'),
    compareToBaseline: (current, baseline) => readRises(callExport(loaded, 'compareToBaseline', [current, baseline])),
    lowerBaseline: (current, baseline) => readBaseline(callExport(loaded, 'lowerBaseline', [current, baseline])),
    rules: () => readRules(readField(loaded, 'RULES')),
  };
}

function bindHelpers(loaded: object): HelpersModule {
  return {
    readSource: (file) => {
      const value = callExport(loaded, 'readSource', [file]);
      if (typeof value !== 'string') {
        throw new TypeError('readSource did not return a string');
      }
      return value;
    },
    countMatches: (source, pattern) => {
      const value = callExport(loaded, 'countMatches', [source, pattern]);
      if (typeof value !== 'number') {
        throw new TypeError('countMatches did not return a number');
      }
      return value;
    },
    checkPageStructure: (source, spec) => readProblems(callExport(loaded, 'checkPageStructure', [source, spec])),
    expectPageStructure: (file, spec) => {
      callExport(loaded, 'expectPageStructure', [file, spec]);
    },
    expectGateClean: (files) => {
      callExport(loaded, 'expectGateClean', [files]);
    },
    findOpenTags: (source, tag) => readTags(callExport(loaded, 'findOpenTags', [source, tag]), 'findOpenTags'),
    checkExplicitButtonVariants: (source) => readLineNumbers(callExport(loaded, 'checkExplicitButtonVariants', [source])),
    expectExplicitButtonVariants: (files) => {
      callExport(loaded, 'expectExplicitButtonVariants', [files]);
    },
  };
}

let gatePromise: Promise<GateModule> | undefined;
let helpersPromise: Promise<HelpersModule> | undefined;

function loadGate(): Promise<GateModule> {
  gatePromise ??= importRelative('../../scripts/design-gate.mjs').then((loaded) => bindGate(loaded));
  return gatePromise;
}

function loadHelpers(): Promise<HelpersModule> {
  helpersPromise ??= importRelative('./helpers.ts').then((loaded) => bindHelpers(loaded));
  return helpersPromise;
}

function violations(scanSource: GateModule['scanSource'], source: string, file = PAGE): Violation[] {
  const found = scanSource(source, file);
  for (const item of found) {
    expect(item.file).toBe(file);
    expect(Number.isInteger(item.line)).toBe(true);
    expect(item.line).toBeGreaterThan(0);
  }
  return found;
}

function expectRule(
  scanSource: GateModule['scanSource'],
  source: string,
  rule: string,
  count: number,
  file = PAGE,
): void {
  const found = violations(scanSource, source, file);
  expect(found).toHaveLength(count);
  for (const item of found) {
    expect(item.rule).toBe(rule);
  }
}

function expectPageProblems(
  checkPageStructure: HelpersModule['checkPageStructure'],
  source: string,
  spec: PageStructureSpec,
): string[] {
  const problems = checkPageStructure(source, spec);
  expect(problems.length).toBeGreaterThan(0);
  for (const problem of problems) {
    expect(problem).toMatch(/\d/);
  }
  return problems;
}

function caughtError(run: () => void): Error {
  let thrown: unknown;
  try {
    run();
  } catch (error: unknown) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(Error);
  if (!(thrown instanceof Error)) {
    throw new TypeError('expected an Error');
  }
  return thrown;
}

function withRelativeFile(contents: string, run: (relativePath: string) => void): void {
  const relativePath = `test/design/.f03-${process.pid}-${randomUUID()}.tsx`;
  const absolutePath = resolve(packageRoot, relativePath);
  writeFileSync(absolutePath, contents);
  try {
    run(relativePath);
  } finally {
    rmSync(absolutePath, { force: true });
  }
}

function positiveCounts(value: object): Record<string, Record<string, number>> {
  const counts: Record<string, Record<string, number>> = {};
  for (const [file, rules] of Object.entries(value)) {
    const ruleRecord = readObject(rules, `scanTree ${file}`);
    const partial: Record<string, number> = {};
    for (const [rule, count] of Object.entries(ruleRecord)) {
      if (typeof count !== 'number' || !Number.isInteger(count) || count <= 0) {
        throw new TypeError(`scanTree count for ${file} ${rule} is not a positive integer`);
      }
      partial[rule] = count;
    }
    if (Object.keys(partial).length > 0) {
      counts[file] = partial;
    }
  }
  return counts;
}

function serializeCounts(files: Record<string, Record<string, number>>): string {
  const sortedFiles: Record<string, Record<string, number>> = {};
  for (const file of Object.keys(files).sort()) {
    const sortedRules: Record<string, number> = {};
    const rules = files[file] ?? {};
    for (const rule of Object.keys(rules).sort()) {
      const count = rules[rule] ?? 0;
      if (count > 0) {
        sortedRules[rule] = count;
      }
    }
    if (Object.keys(sortedRules).length > 0) {
      sortedFiles[file] = sortedRules;
    }
  }
  return `${JSON.stringify({ version: 1, files: sortedFiles }, null, 2)}\n`;
}

function padCounts(files: Record<string, Record<string, number>>): Record<string, Record<string, number>> {
  const padded: Record<string, Record<string, number>> = {};
  for (const [file, rules] of Object.entries(files)) {
    const next: Record<string, number> = {};
    for (const [rule, count] of Object.entries(rules)) {
      next[rule] = count + 1000;
    }
    padded[file] = next;
  }
  return padded;
}

function countViolations(files: Record<string, Record<string, number>>): number {
  let total = 0;
  for (const rules of Object.values(files)) {
    for (const count of Object.values(rules)) {
      total += count;
    }
  }
  return total;
}

function runDesignGate(args: readonly string[]): { status: number; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, ['scripts/design-gate.mjs', ...args], {
    cwd: packageRoot,
    encoding: 'utf8',
  });
  if (typeof result.status !== 'number' || typeof result.stdout !== 'string' || typeof result.stderr !== 'string') {
    throw new TypeError('design-gate did not return a status and string output');
  }
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function withMovedBaseline(run: (baselinePath: string) => void): void {
  const baselinePath = resolve(packageRoot, 'design-gate.baseline.json');
  const backupPath = `${baselinePath}.f03-backup-${process.pid}-${randomUUID()}`;
  const existed = existsSync(baselinePath);
  if (existed) {
    renameSync(baselinePath, backupPath);
  }
  try {
    run(baselinePath);
  } finally {
    rmSync(baselinePath, { force: true });
    if (existed) {
      renameSync(backupPath, baselinePath);
    }
  }
}

describe('design gate', () => {
  it('exports the rule table with the planned exemptUi flags', async () => {
    const { rules } = await loadGate();
    const table = rules();
    expect(table).toHaveLength(RULE_TABLE.length);
    expect(new Set(table.map((rule) => rule.id)).size).toBe(RULE_TABLE.length);
    for (const [id, exemptUi] of RULE_TABLE) {
      const rule = table.find((item) => item.id === id);
      expect(rule?.exemptUi).toBe(exemptUi);
    }
  });

  it('flags raw palette utilities as DS001 and still flags them under ui', async () => {
    const { scanSource } = await loadGate();
    expectRule(scanSource, '<div className="bg-amber-500 hover:text-red-600/80" />', 'DS001', 2);
    expectRule(scanSource, 'bg-brand text-fg', 'DS001', 0);
    expectRule(scanSource, 'bg-red-500', 'DS001', 1, UI);
  });

  it('flags legacy token utilities as DS002', async () => {
    const { scanSource } = await loadGate();
    expectRule(scanSource, 'text-muted-foreground bg-card border-border bg-primary/10', 'DS002', 4);
    expectRule(scanSource, 'ring-ring text-on-brand bg-surface-active', 'DS002', 0);
  });

  it('flags color literals as DS003 and ignores anchors', async () => {
    const { scanSource } = await loadGate();
    expectRule(scanSource, "style={{ color: '#ff4f4f' }}", 'DS003', 1);
    expectRule(scanSource, 'rgba(0,0,0,.1)', 'DS003', 1);
    expectRule(scanSource, 'href="#top"', 'DS003', 0);
  });

  it('flags arbitrary lengths as DS004 only outside src/components/ui', async () => {
    const { scanSource } = await loadGate();
    const source = 'w-[320px] p-[1.5rem] h-[calc(100%-2px)]';
    expectRule(scanSource, source, 'DS004', 3, PAGE);
    expectRule(scanSource, source, 'DS004', 0, UI);
    expectRule(scanSource, source, 'DS004', 0, UI_NESTED);
    expectRule(scanSource, source, 'DS004', 3, NOT_UI);
    expectRule(scanSource, source, 'DS004', 3, UI_FILE);
  });

  it('flags native controls as DS005 using brace, quote, and template boundaries', async () => {
    const { scanSource } = await loadGate();
    expectRule(scanSource, '<button onClick={() => a > b}>x</button>', 'DS005', 1);
    expectRule(scanSource, '<input\n  onChange={(e) => go(e)}\n  type="hidden"\n/>', 'DS005', 0);
    expectRule(scanSource, '<input type="text" />', 'DS005', 1);
    expectRule(scanSource, '<Button>x</Button>', 'DS005', 0);
    expectRule(scanSource, '<tablet />', 'DS005', 0);
    expectRule(scanSource, '<select />', 'DS005', 1);
    expectRule(scanSource, '<textarea />', 'DS005', 1);
    expectRule(scanSource, '<table>', 'DS005', 1);
    expectRule(scanSource, '<button/>', 'DS005', 1);
    expectRule(scanSource, '<input type="file" />', 'DS005', 0);
    expectRule(scanSource, "<input type='hidden' />", 'DS005', 0);
    expectRule(scanSource, "<input type='file' />", 'DS005', 0);
    expectRule(scanSource, '<input title="a > b" type="hidden" />', 'DS005', 0);
    expectRule(scanSource, '<input title=`a > b` type="hidden" />', 'DS005', 0);
    expectRule(scanSource, '<input type="text" title="a\\" />', 'DS005', 1);
    const quotedButton = violations(scanSource, '<button title="C:\\">open</button>');
    expect(quotedButton).toHaveLength(1);
    expect(quotedButton[0]?.rule).toBe('DS005');
    expect(quotedButton[0]?.line).toBe(1);
    expect(quotedButton[0]?.snippet).toContain('title="C:\\"');
    expect(quotedButton[0]?.snippet).not.toContain('open');
    expectRule(scanSource, '<button>x</button>', 'DS005', 0, UI);
    const found = violations(scanSource, 'const x = 1;\n<button>ok</button>');
    expect(found).toHaveLength(1);
    expect(found[0]?.rule).toBe('DS005');
    expect(found[0]?.line).toBe(2);
  });

  it('flags numeric durations as DS006 outside ui', async () => {
    const { scanSource } = await loadGate();
    expectRule(scanSource, 'duration-300 delay-150', 'DS006', 2);
    expectRule(scanSource, 'transition={{ duration: 0.3 }}', 'DS006', 1);
    expectRule(scanSource, 'duration-(--dur-2)', 'DS006', 0);
    expectRule(scanSource, 'duration-300 delay-150', 'DS006', 0, UI);
  });

  it('flags arbitrary z-index as DS007', async () => {
    const { scanSource } = await loadGate();
    expectRule(scanSource, 'z-[60]', 'DS007', 1);
    expectRule(scanSource, 'z-50', 'DS007', 0);
  });

  it('flags off-scale font sizes as DS009', async () => {
    const { scanSource } = await loadGate();
    expectRule(scanSource, 'text-base text-4xl text-[13px]', 'DS009', 3);
    expectRule(scanSource, 'text-md text-2xs text-3xl', 'DS009', 0);
  });

  it('flags dark variants as DS010 only outside src/components/ui', async () => {
    const { scanSource } = await loadGate();
    expectRule(scanSource, 'dark:bg-x', 'DS010', 1, PAGE);
    expectRule(scanSource, 'dark:bg-x', 'DS010', 0, UI);
    expectRule(scanSource, 'dark:bg-x', 'DS010', 0, UI_NESTED);
    expectRule(scanSource, 'dark:bg-x', 'DS010', 1, NOT_UI);
    expectRule(scanSource, 'dark:bg-x', 'DS010', 1, UI_FILE);
  });

  it('flags disallowed shadows as DS011', async () => {
    const { scanSource } = await loadGate();
    expectRule(scanSource, 'shadow-lg shadow-inner', 'DS011', 2);
    expectRule(scanSource, 'shadow-pop shadow-xs shadow-sm', 'DS011', 0);
  });

  it('flags disallowed radii as DS012', async () => {
    const { scanSource } = await loadGate();
    expectRule(scanSource, 'rounded rounded-2xl rounded-t-3xl rounded-[10px] rounded-t', 'DS012', 5);
    expectRule(scanSource, 'rounded-md rounded-t-xl rounded-full rounded-none rounded-sm', 'DS012', 0);
  });

  it('flags backdrop blur and gradients', async () => {
    const { scanSource } = await loadGate();
    expectRule(scanSource, 'backdrop-blur-md', 'DS013', 1);
    expectRule(scanSource, 'bg-gradient-to-r bg-linear-to-b', 'DS014', 2);
  });

  it('flags entrance and hover motion as DS015 outside ui', async () => {
    const { scanSource } = await loadGate();
    const sources = [
      'initial={{ opacity: 0, y: 8 }}',
      'initial={{ y: 4 }}',
      'initial={{ x: 1 }}',
      'whileHover={{ scale: 1.02 }}',
      'whileInView={{ opacity: 1 }}',
      'whileTap={{ scale: 0.98 }}',
    ];
    for (const source of sources) {
      expectRule(scanSource, source, 'DS015', 1, PAGE);
      expectRule(scanSource, source, 'DS015', 0, UI);
    }
    expectRule(scanSource, 'initial={false}', 'DS015', 0);
    expectRule(scanSource, 'whileHovering', 'DS015', 0);
  });

  it('honors ds-allow only for the named rule on that line or the previous line', async () => {
    const { scanSource } = await loadGate();
    expectRule(scanSource, '// ds-allow DS003: canvas\nconst c = "#ffffff";', 'DS003', 0);
    expectRule(scanSource, '// ds-allow DS001: x\nconst c = "#ffffff";', 'DS003', 1);
    expectRule(scanSource, 'const c = "#ffffff"; // ds-allow DS003: x', 'DS003', 0);
    expectRule(scanSource, '// ds-allow DS003: x\n\nconst c = "#ffffff";', 'DS003', 1);
    const mixed = violations(scanSource, 'bg-red-500 "#fff" // ds-allow DS003: x');
    expect(mixed.filter((item) => item.rule === 'DS001')).toHaveLength(1);
    expect(mixed.filter((item) => item.rule === 'DS003')).toHaveLength(0);
    expect(mixed).toHaveLength(1);
  });

  it('reports 1-based line numbers after normalizing CRLF', async () => {
    const { scanSource } = await loadGate();
    const found = violations(scanSource, 'a\nb\nbg-red-500');
    expect(found).toHaveLength(1);
    expect(found[0]?.rule).toBe('DS001');
    expect(found[0]?.line).toBe(3);
    expect(found[0]?.file).toBe(PAGE);
    const crlf = violations(scanSource, 'a\r\nbg-red-500');
    expect(crlf).toHaveLength(1);
    expect(crlf[0]?.line).toBe(2);
  });

  it('compareToBaseline returns only increases and treats missing files as zero', async () => {
    const { compareToBaseline } = await loadGate();
    expect(compareToBaseline(
      { a: { DS001: 3 } },
      { version: 1, files: { a: { DS001: 2 } } },
    )).toEqual([
      { file: 'a', rule: 'DS001', baseline: 2, current: 3 },
    ]);
    expect(compareToBaseline(
      { b: { DS003: 2 } },
      { version: 1, files: { a: { DS001: 2 } } },
    )).toEqual([
      { file: 'b', rule: 'DS003', baseline: 0, current: 2 },
    ]);
    expect(compareToBaseline(
      { a: { DS001: 1 } },
      { version: 1, files: { a: { DS001: 4, DS002: 1 } } },
    )).toEqual([]);
    expect(compareToBaseline(
      { a: { DS001: 5, DS002: 1 } },
      { version: 1, files: { a: { DS001: 4, DS002: 3 } } },
    )).toEqual([
      { file: 'a', rule: 'DS001', baseline: 4, current: 5 },
    ]);
  });

  it('lowerBaseline drops rules that reached zero and rejects increases', async () => {
    const { lowerBaseline } = await loadGate();
    expect(lowerBaseline(
      { a: { DS001: 1 } },
      { version: 1, files: { a: { DS001: 3, DS002: 2 } } },
    )).toEqual({ version: 1, files: { a: { DS001: 1 } } });
    expect(() => lowerBaseline(
      { a: { DS001: 4 } },
      { version: 1, files: { a: { DS001: 3 } } },
    )).toThrow(Error);
    expect(() => lowerBaseline(
      { a: { DS001: 4 } },
      { version: 1, files: { a: { DS001: 3 } } },
    )).toThrow(/can only go down/);
  });

  it('scanTree scans src and skips playground, design, and declaration files', async () => {
    const { scanTree } = await loadGate();
    const files = Object.keys(scanTree());
    expect(files.length).toBeGreaterThan(0);
    expect(files.some((file) => file.startsWith('src/playground/') || file.startsWith('src/design/'))).toBe(false);
    expect(files.some((file) => file.endsWith('.d.ts') || file.includes('\\'))).toBe(false);
    expect(files.some((file) => file.startsWith('src/'))).toBe(true);
  });

  it('scanFile reports the same violations as scanSource', async () => {
    const { scanFile, scanSource } = await loadGate();
    const source = 'bg-red-500\n';
    withRelativeFile(source, (relativePath) => {
      expect(scanFile(relativePath)).toEqual(scanSource(source, relativePath));
    });
  });

  it('package.json exposes design:gate', () => {
    const packageJson: unknown = JSON.parse(readFileSync(resolve(packageRoot, 'package.json'), 'utf8'));
    const root = readObject(packageJson, 'package.json');
    const scripts = readObject(readField(root, 'scripts'), 'package.json scripts');
    expect(readField(scripts, 'design:gate')).toBe('node scripts/design-gate.mjs');
  });

  it('checkPageStructure enforces page width, workspace, headers, and headings', async () => {
    const { checkPageStructure } = await loadHelpers();
    const widePage = '<Page width="wide"><PageHeader title="x" /></Page>';
    const wideSpec: PageStructureSpec = { widths: ['wide'], workspace: 'forbidden', minPageHeaders: 1 };
    expect(checkPageStructure(widePage, wideSpec)).toEqual([]);
    const wrongWidth = expectPageProblems(checkPageStructure, widePage, {
      widths: ['form'],
      workspace: 'forbidden',
      minPageHeaders: 1,
    });
    expect(wrongWidth.some((problem) => problem.includes('1'))).toBe(true);
    expect(checkPageStructure(widePage, {
      widths: ['wide', 'prose'],
      workspace: 'forbidden',
      minPageHeaders: 1,
    })).toEqual([]);
    expectPageProblems(checkPageStructure, widePage, {
      widths: ['wide'],
      workspace: 'forbidden',
      minPageHeaders: 2,
    });
    const missingWidth = expectPageProblems(
      checkPageStructure,
      '<Page><PageHeader title="x"/></Page>',
      wideSpec,
    );
    expect(missingWidth.some((problem) => problem.includes('缺少 width') && /\d/.test(problem))).toBe(true);
    expectPageProblems(checkPageStructure, `${widePage}<h1>Title</h1>`, wideSpec);
    expect(checkPageStructure('<Workspace><Toolbar/></Workspace>', {
      widths: [],
      workspace: 'required',
      minPageHeaders: 0,
    })).toEqual([]);
    const forbiddenWorkspace = expectPageProblems(checkPageStructure, '<Workspace><Toolbar/></Workspace>', {
      widths: [],
      workspace: 'forbidden',
      minPageHeaders: 0,
    });
    expect(forbiddenWorkspace.some((problem) => problem.includes('1'))).toBe(true);
    expect(checkPageStructure('<Workspace><Toolbar/></Workspace>', {
      widths: [],
      workspace: 'allowed',
      minPageHeaders: 0,
    })).toEqual([]);
    const missingWorkspace = expectPageProblems(checkPageStructure, '<Page width="wide"/>', {
      widths: ['wide'],
      workspace: 'required',
      minPageHeaders: 0,
    });
    expect(missingWorkspace.some((problem) => problem.includes('0'))).toBe(true);
    expect(checkPageStructure('<PageTabs/><PageHeaderLike/>', {
      widths: [],
      workspace: 'forbidden',
      minPageHeaders: 0,
    })).toEqual([]);
    const barePage = expectPageProblems(checkPageStructure, '<Page width="wide"></Page>', {
      widths: [],
      workspace: 'allowed',
      minPageHeaders: 0,
    });
    expect(barePage.some((problem) => problem.includes('1'))).toBe(true);
  });

  it('expectPageStructure throws the filename and checkPageStructure problems', async () => {
    const { checkPageStructure, expectPageStructure } = await loadHelpers();
    const source = '<Page><h1>Title</h1></Page>';
    const spec: PageStructureSpec = { widths: ['wide'], workspace: 'forbidden', minPageHeaders: 0 };
    const problems = checkPageStructure(source, spec);
    expect(problems.length).toBeGreaterThan(0);
    withRelativeFile(source, (relativePath) => {
      const error = caughtError(() => {
        expectPageStructure(relativePath, spec);
      });
      expect(error.message).toContain(relativePath);
      for (const problem of problems) {
        expect(error.message).toContain(problem);
      }
    });
  });

  it('findOpenTags reads one Button open tag and variant checks report its line', async () => {
    const { checkExplicitButtonVariants, findOpenTags } = await loadHelpers();
    const { scanOpenTags } = await loadGate();
    const source = '<Button\n  onClick={() => a > b}\n  variant="ghost"\n>x</Button><ButtonGroup>';
    const tags = findOpenTags(source, 'Button');
    expect(tags).toHaveLength(1);
    expect(tags[0]?.line).toBe(1);
    expect(tags[0]?.text).toContain('variant="ghost"');
    expect(tags[0]?.text).not.toContain('ButtonGroup');
    expect(scanOpenTags(source, 'Button')).toEqual(tags);
    expect(checkExplicitButtonVariants('<Button onClick={go}>x</Button>')).toEqual([1]);
    expect(checkExplicitButtonVariants('<Button variant="ghost" onClick={go}>x</Button>')).toEqual([]);
    expect(checkExplicitButtonVariants('<Button><Icon variant="ghost" /></Button>')).toEqual([1]);
    expect(checkExplicitButtonVariants('<Button variant="ghost">a</Button>\n<Button>b</Button>')).toEqual([2]);
    expect(checkExplicitButtonVariants('<ButtonGroup>x</ButtonGroup>')).toEqual([]);
    const quotedButton = '<Button title="a\\">save</Button>';
    const quotedTags = findOpenTags(quotedButton, 'Button');
    expect(quotedTags).toHaveLength(1);
    expect(quotedTags[0]?.line).toBe(1);
    expect(quotedTags[0]?.text).toContain('title="a\\"');
    expect(quotedTags[0]?.text).not.toContain('save');
    expect(scanOpenTags(quotedButton, 'Button')).toEqual(quotedTags);
    expect(checkExplicitButtonVariants(quotedButton)).toEqual([1]);
  });

  it('readSource, countMatches, expectGateClean, and expectExplicitButtonVariants follow the contract', async () => {
    const helpers = await loadHelpers();
    expect(helpers.countMatches('ababa', /a/g)).toBe(3);
    expect(helpers.countMatches('ababa', /a/g)).toBe(3);
    withRelativeFile('hello gate\n', (relativePath) => {
      expect(helpers.readSource(relativePath)).toBe('hello gate\n');
    });
    withRelativeFile('export const color = "bg-brand";\n', (relativePath) => {
      expect(() => {
        helpers.expectGateClean([relativePath]);
      }).not.toThrow();
      expect(() => {
        helpers.expectExplicitButtonVariants([relativePath]);
      }).not.toThrow();
    });
    withRelativeFile('export const color = "bg-red-500";\n', (relativePath) => {
      const error = caughtError(() => {
        helpers.expectGateClean([relativePath]);
      });
      expect(error.message).toContain(`${relativePath}:1 DS001`);
    });
    withRelativeFile('<Button onClick={go}>x</Button>\n', (relativePath) => {
      const error = caughtError(() => {
        helpers.expectExplicitButtonVariants([relativePath]);
      });
      expect(error.message).toContain(`${relativePath}:1`);
    });
    withRelativeFile('<Button variant="ghost">x</Button>\n', (relativePath) => {
      expect(() => {
        helpers.expectExplicitButtonVariants([relativePath]);
      }).not.toThrow();
    });
  });

  it('compareToBaseline does not report a count that stayed the same', async () => {
    const { compareToBaseline } = await loadGate();
    expect(compareToBaseline(
      { a: { DS001: 2, DS002: 1 } },
      { version: 1, files: { a: { DS001: 2, DS002: 3 } } },
    )).toEqual([]);
  });

  it('flags hsl, hsla, and oklch calls as DS003', async () => {
    const { scanSource } = await loadGate();
    expectRule(scanSource, 'oklch(0.5 0.1 200)', 'DS003', 1);
    expectRule(scanSource, 'hsla(0,0%,0%,.1)', 'DS003', 1);
    expectRule(scanSource, 'hsl(0 0% 0%)', 'DS003', 1);
  });

  it('flags radial and conic gradients as DS014', async () => {
    const { scanSource } = await loadGate();
    expectRule(scanSource, 'bg-radial-at-t bg-conic-to-r', 'DS014', 2);
  });

  it('flags sidebar token utilities as DS002', async () => {
    const { scanSource } = await loadGate();
    expectRule(scanSource, 'bg-sidebar text-sidebar-foreground', 'DS002', 2);
  });

  it('normalizes backslash paths before ui exemption and reported file paths', async () => {
    const { scanSource } = await loadGate();
    const page = scanSource('bg-red-500', 'src\\pages\\x.tsx');
    expect(page).toHaveLength(1);
    expect(page[0]?.file).toBe('src/pages/x.tsx');
    expect(page[0]?.rule).toBe('DS001');
    expect(scanSource('dark:bg-x', 'src\\components\\ui\\x.tsx')).toEqual([]);
  });

  it('countMatches rejects a RegExp without the g flag', async () => {
    const { countMatches } = await loadHelpers();
    expect(() => {
      countMatches('aa', /a/);
    }).toThrow(TypeError);
  });

  it('expectGateClean lists the file, line, rule, and snippet', async () => {
    const { expectGateClean } = await loadHelpers();
    withRelativeFile('export const color = "bg-red-500";\n', (relativePath) => {
      const error = caughtError(() => {
        expectGateClean([relativePath]);
      });
      expect(error.message).toContain(`${relativePath}:1 DS001 bg-red-500`);
    });
  });

  it('scanTree omits files with no remaining violations', async () => {
    const { scanTree } = await loadGate();
    const counts = scanTree();
    const files = Object.keys(counts);
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const rules = readObject(readField(counts, file), file);
      const ruleNames = Object.keys(rules);
      expect(ruleNames.length).toBeGreaterThan(0);
      for (const rule of ruleNames) {
        expect(readNumberField(rules, rule, file)).toBeGreaterThan(0);
      }
    }
  });

  it('flags logical inline-start and inline-end radii as DS012', async () => {
    const { scanSource } = await loadGate();
    expectRule(scanSource, 'rounded-s rounded-e', 'DS012', 2);
  });

  it('design-gate --file prints line, rule, and snippet and exits 1 when dirty', () => {
    withRelativeFile('bg-red-500\n', (relativePath) => {
      const result = spawnSync(process.execPath, ['scripts/design-gate.mjs', '--file', relativePath], {
        cwd: packageRoot,
        encoding: 'utf8',
      });
      expect(result.status).toBe(1);
      expect(result.stdout).toContain('1 DS001 bg-red-500');
    });
    withRelativeFile('bg-brand\n', (relativePath) => {
      const result = spawnSync(process.execPath, ['scripts/design-gate.mjs', '--file', relativePath], {
        cwd: packageRoot,
        encoding: 'utf8',
      });
      expect(result.status).toBe(0);
      expect(result.stdout).toBe('');
    });
  });

  it('fails closed when the baseline is missing, already exists, or would rise', async () => {
    const { scanTree } = await loadGate();
    expect(Object.keys(positiveCounts(scanTree())).length).toBeGreaterThan(0);
    withMovedBaseline((baselinePath) => {
      const missing = runDesignGate([]);
      expect(missing.status).toBe(2);
      expect(missing.stdout).toContain('design-gate: baseline missing, run --init');
      expect(existsSync(baselinePath)).toBe(false);

      const fresh = positiveCounts(scanTree());
      const created = runDesignGate(['--init']);
      expect(created.status).toBe(0);
      const createdText = readFileSync(baselinePath, 'utf8');
      expect(createdText.endsWith('\n')).toBe(true);
      expect(createdText).toBe(serializeCounts(fresh));

      const existing = runDesignGate(['--init']);
      expect(existing.status).toBe(2);
      expect(readFileSync(baselinePath, 'utf8')).toBe(createdText);

      const raised = serializeCounts({});
      writeFileSync(baselinePath, raised);
      const updated = runDesignGate(['--update']);
      expect(updated.status).toBe(1);
      expect(readFileSync(baselinePath, 'utf8')).toBe(raised);
      expect(`${updated.stdout}${updated.stderr}`).toContain('can only go down');

      const live = positiveCounts(scanTree());
      const padded = padCounts(live);
      writeFileSync(baselinePath, serializeCounts(padded));
      const ok = runDesignGate([]);
      expect(ok.status).toBe(0);
      expect(ok.stdout).toContain(
        `design-gate: ok (${Object.keys(padded).length} files, ${countViolations(padded)} violations in baseline)`,
      );
    });
  });

  it('does not let a longer ds-allow id exempt a shorter rule', async () => {
    const { scanSource } = await loadGate();
    expectRule(scanSource, '// ds-allow DS0030\nconst c = "#abc";', 'DS003', 1);
    expectRule(scanSource, '// ds-allow DS003\nconst c = "#abc";', 'DS003', 0);
  });
});
