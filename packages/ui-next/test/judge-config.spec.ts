// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { JudgeCase, JudgeConfig } from '../src/lib/judge-config';
import {
  assignSequentialIds,
  autoPair,
  classify,
  emptyConfig,
  flattenCases,
  formatMemory,
  formatTime,
  joinMemory,
  joinTime,
  parseJudgeConfig,
  parseMemoryMB,
  parseTimeMS,
  serializeJudgeConfig,
  splitMemory,
  splitTime,
  validateConfig,
} from '../src/lib/judge-config';

const CASE_1: JudgeCase = { input: '1.in', output: '1.out' };
const CASE_2: JudgeCase = { input: '2.in', output: '2.out' };
const FILES_12 = new Set(['1.in', '1.out', '2.in', '2.out']);

describe('parseTimeMS', () => {
  it('returns null for nullish, empty, and whitespace-only input', () => {
    expect(parseTimeMS(null)).to.equal(null);
    expect(parseTimeMS(undefined)).to.equal(null);
    expect(parseTimeMS('')).to.equal(null);
    expect(parseTimeMS('   ')).to.equal(null);
  });

  it('parses seconds and milliseconds suffixes', () => {
    expect(parseTimeMS('1s')).to.equal(1000);
    expect(parseTimeMS('1500ms')).to.equal(1500);
    expect(parseTimeMS('0.5s')).to.equal(500);
  });

  it('treats bare numbers as milliseconds', () => {
    expect(parseTimeMS('500')).to.equal(500);
    expect(parseTimeMS('0')).to.equal(0);
  });

  it('rounds fractional milliseconds to the nearest integer', () => {
    expect(parseTimeMS('1.4')).to.equal(1);
    expect(parseTimeMS('1.5')).to.equal(2);
    expect(parseTimeMS('0.0015s')).to.equal(2);
  });

  it('accepts long-form second units, spacing, and mixed case', () => {
    expect(parseTimeMS('2 seconds')).to.equal(2000);
    expect(parseTimeMS('3 sec')).to.equal(3000);
    expect(parseTimeMS(' 1S ')).to.equal(1000);
  });

  it('accepts a leading-dot decimal and negative values', () => {
    expect(parseTimeMS('.5s')).to.equal(500);
    expect(parseTimeMS('-1s')).to.equal(-1000);
  });

  it('rejects unknown units, exponents, and garbage', () => {
    expect(parseTimeMS('1m')).to.equal(null);
    expect(parseTimeMS('1e3')).to.equal(null);
    expect(parseTimeMS('fast')).to.equal(null);
  });
});

describe('parseMemoryMB', () => {
  it('returns null for nullish and empty input', () => {
    expect(parseMemoryMB(null)).to.equal(null);
    expect(parseMemoryMB(undefined)).to.equal(null);
    expect(parseMemoryMB('  ')).to.equal(null);
  });

  it('parses every supported unit into megabytes', () => {
    expect(parseMemoryMB('256m')).to.equal(256);
    expect(parseMemoryMB('256mb')).to.equal(256);
    expect(parseMemoryMB('512k')).to.equal(0.5);
    expect(parseMemoryMB('512kb')).to.equal(0.5);
    expect(parseMemoryMB('1g')).to.equal(1024);
    expect(parseMemoryMB('2gb')).to.equal(2048);
    expect(parseMemoryMB('1048576b')).to.equal(1);
  });

  it('treats bare numbers as megabytes', () => {
    expect(parseMemoryMB('128')).to.equal(128);
  });

  it('handles fractional and negative values', () => {
    expect(parseMemoryMB('0.5g')).to.equal(512);
    expect(parseMemoryMB('-1g')).to.equal(-1024);
  });

  it('rejects unknown units and garbage', () => {
    expect(parseMemoryMB('256t')).to.equal(null);
    expect(parseMemoryMB('lots')).to.equal(null);
  });
});

describe('formatTime', () => {
  it('returns an empty string for nullish and non-finite input', () => {
    expect(formatTime(null)).to.equal('');
    expect(formatTime(undefined)).to.equal('');
    expect(formatTime(Number.NaN)).to.equal('');
    expect(formatTime(Number.POSITIVE_INFINITY)).to.equal('');
  });

  it('honors an explicit preferred unit', () => {
    expect(formatTime(1500, 'ms')).to.equal('1500ms');
    expect(formatTime(1234.6, 'ms')).to.equal('1235ms');
    expect(formatTime(1500, 's')).to.equal('1.5s');
    expect(formatTime(500, 's')).to.equal('0.5s');
  });

  it('auto-selects seconds only for whole-second values', () => {
    expect(formatTime(2000)).to.equal('2s');
    expect(formatTime(1000)).to.equal('1s');
    expect(formatTime(1500)).to.equal('1500ms');
    expect(formatTime(500)).to.equal('500ms');
    expect(formatTime(0)).to.equal('0ms');
  });
});

describe('formatMemory', () => {
  it('returns an empty string for nullish and non-finite input', () => {
    expect(formatMemory(null)).to.equal('');
    expect(formatMemory(undefined)).to.equal('');
    expect(formatMemory(Number.NaN)).to.equal('');
  });

  it('honors an explicit preferred unit', () => {
    expect(formatMemory(0.5, 'k')).to.equal('512k');
    expect(formatMemory(2048, 'g')).to.equal('2g');
    expect(formatMemory(512, 'g')).to.equal('0.5g');
    expect(formatMemory(256.4, 'm')).to.equal('256m');
  });

  it('auto-selects gigabytes only for whole-gigabyte values', () => {
    expect(formatMemory(1024)).to.equal('1g');
    expect(formatMemory(2048)).to.equal('2g');
    expect(formatMemory(1536)).to.equal('1536m');
  });

  it('auto-selects kilobytes for sub-megabyte values and megabytes otherwise', () => {
    expect(formatMemory(0.5)).to.equal('512k');
    expect(formatMemory(0.25)).to.equal('256k');
    expect(formatMemory(256)).to.equal('256m');
    expect(formatMemory(0)).to.equal('0m');
  });
});

describe('splitTime', () => {
  it('falls back to an empty value with seconds for missing or invalid input', () => {
    expect(splitTime(undefined)).to.deep.equal({ value: '', unit: 's' });
    expect(splitTime(null)).to.deep.equal({ value: '', unit: 's' });
    expect(splitTime('')).to.deep.equal({ value: '', unit: 's' });
    expect(splitTime('garbage')).to.deep.equal({ value: '', unit: 's' });
  });

  it('splits value and unit for the picker', () => {
    expect(splitTime('1500ms')).to.deep.equal({ value: '1500', unit: 'ms' });
    expect(splitTime('2s')).to.deep.equal({ value: '2', unit: 's' });
    expect(splitTime(' 0.5 S ')).to.deep.equal({ value: '0.5', unit: 's' });
  });

  it('defaults bare numbers to seconds, unlike parseTimeMS which assumes ms', () => {
    // Documented asymmetry: '250' means 250ms to parseTimeMS but the picker
    // shows it as 250 seconds.
    expect(splitTime('250')).to.deep.equal({ value: '250', unit: 's' });
  });

  it('rejects long-form units accepted by parseTimeMS', () => {
    expect(splitTime('2 seconds')).to.deep.equal({ value: '', unit: 's' });
  });
});

describe('splitMemory', () => {
  it('falls back to an empty value with megabytes for missing or invalid input', () => {
    expect(splitMemory(undefined)).to.deep.equal({ value: '', unit: 'm' });
    expect(splitMemory('')).to.deep.equal({ value: '', unit: 'm' });
    expect(splitMemory('huge')).to.deep.equal({ value: '', unit: 'm' });
  });

  it('splits value and unit, folding long unit forms', () => {
    expect(splitMemory('256m')).to.deep.equal({ value: '256', unit: 'm' });
    expect(splitMemory('512kb')).to.deep.equal({ value: '512', unit: 'k' });
    expect(splitMemory('2gb')).to.deep.equal({ value: '2', unit: 'g' });
    expect(splitMemory('64')).to.deep.equal({ value: '64', unit: 'm' });
  });

  it('collapses the bytes unit to megabytes, changing the magnitude', () => {
    // Documented quirk: '100b' (100 bytes) splits to 100 with unit 'm'; the
    // byte suffix has no picker unit, so the raw value is reinterpreted.
    expect(splitMemory('100b')).to.deep.equal({ value: '100', unit: 'm' });
  });
});

describe('joinTime and joinMemory', () => {
  it('returns undefined for empty or whitespace-only values', () => {
    expect(joinTime('', 's')).to.equal(undefined);
    expect(joinTime('   ', 'ms')).to.equal(undefined);
    expect(joinMemory('', 'm')).to.equal(undefined);
    expect(joinMemory('  ', 'g')).to.equal(undefined);
  });

  it('concatenates value and unit', () => {
    expect(joinTime('2', 's')).to.equal('2s');
    expect(joinTime('1500', 'ms')).to.equal('1500ms');
    expect(joinMemory('256', 'm')).to.equal('256m');
    expect(joinMemory('1', 'g')).to.equal('1g');
  });
});

describe('emptyConfig', () => {
  it('returns a default-typed config as a fresh object each call', () => {
    expect(emptyConfig()).to.deep.equal({ type: 'default' });
    expect(emptyConfig()).to.not.equal(emptyConfig());
  });
});

describe('parseJudgeConfig', () => {
  it('returns an empty config without error for blank input', () => {
    const result = parseJudgeConfig('');
    expect(result.config).to.deep.equal({ type: 'default' });
    expect(result.error).to.equal(undefined);
    expect(parseJudgeConfig('   \n  ').config).to.deep.equal({ type: 'default' });
  });

  it('returns an empty config for non-object yaml documents', () => {
    expect(parseJudgeConfig('null').config).to.deep.equal({ type: 'default' });
    expect(parseJudgeConfig('just a string').config).to.deep.equal({ type: 'default' });
    expect(parseJudgeConfig('42').config).to.deep.equal({ type: 'default' });
  });

  it('reports a parse error and an empty config for malformed yaml', () => {
    const result = parseJudgeConfig('key: [1, 2');
    expect(result.config).to.deep.equal({ type: 'default' });
    expect(result.error).to.be.a('string');
    expect(result.error!.length).to.be.greaterThan(0);
  });

  it('parses scalar fields and coerces numeric time and memory to strings', () => {
    const { config } = parseJudgeConfig('time: 1000\nmemory: 256\nchecker: chk.cc\nchecker_type: testlib\n');
    expect(config.type).to.equal('default');
    expect(config.time).to.equal('1000');
    expect(config.memory).to.equal('256');
    expect(config.checker).to.equal('chk.cc');
    expect(config.checker_type).to.equal('testlib');
  });

  it('keeps only known score modes', () => {
    expect(parseJudgeConfig('score: max\n').config.score).to.equal('max');
    expect(parseJudgeConfig('score: avg\n').config.score).to.equal(undefined);
  });

  it('stringifies langs entries and drops non-array langs', () => {
    expect(parseJudgeConfig('langs:\n  - cc\n  - 42\n').config.langs).to.deep.equal(['cc', '42']);
    expect(parseJudgeConfig('langs: cc\n').config.langs).to.equal(undefined);
  });

  it('keeps float tolerances only when they are numbers', () => {
    const { config } = parseJudgeConfig('checker_type: float\nfloat_relative: 0.001\nfloat_absolute: "0.1"\n');
    expect(config.float_relative).to.equal(0.001);
    expect(config.float_absolute).to.equal(undefined);
  });

  it('filters limit-rate maps down to positive finite numbers', () => {
    const { config } = parseJudgeConfig(
      'time_limit_rate:\n  cc: 1\n  py: 3.5\n  zero: 0\n  neg: -2\n  bad: abc\n',
    );
    expect(config.time_limit_rate).to.deep.equal({ cc: 1, py: 3.5 });
  });

  it('omits a limit-rate map whose entries are all invalid', () => {
    const { config } = parseJudgeConfig('memory_limit_rate:\n  cc: 0\n  py: nope\n');
    expect(config.memory_limit_rate).to.equal(undefined);
  });

  it('normalizes cases, honoring the in/out aliases and coercing values to strings', () => {
    const { config } = parseJudgeConfig('cases:\n  - in: 1.in\n    out: 1.out\n  - input: 2\n    output: 2.out\n    time: 500\n');
    expect(config.cases).to.deep.equal([
      { input: '1.in', output: '1.out' },
      { input: '2', output: '2.out', time: '500' },
    ]);
  });

  it('keeps a case that has only an input, filling the output with an empty string', () => {
    const { config } = parseJudgeConfig('cases:\n  - input: a.in\n');
    expect(config.cases).to.deep.equal([{ input: 'a.in', output: '' }]);
  });

  it('drops case entries that are not objects or have neither input nor output', () => {
    const { config } = parseJudgeConfig('cases:\n  - loose string\n  - {}\n  - hint: orphan hint\n  - input: 1.in\n    output: 1.out\n');
    expect(config.cases).to.deep.equal([{ input: '1.in', output: '1.out' }]);
  });

  it('parses hint and video metadata with boolean coercion', () => {
    const { config } = parseJudgeConfig(
      'cases:\n  - input: 1.in\n    output: 1.out\n    hint: careful\n    hintPublic: 1\n    videoUrl: https://v.example\n    videoPublic: false\n',
    );
    expect(config.cases).to.deep.equal([
      {
        input: '1.in',
        output: '1.out',
        hint: 'careful',
        hintPublic: true,
        videoUrl: 'https://v.example',
        videoPublic: false,
      },
    ]);
  });

  it('ignores empty-string and non-string hints', () => {
    const { config } = parseJudgeConfig('cases:\n  - input: 1.in\n    output: 1.out\n    hint: ""\n  - input: 2.in\n    output: 2.out\n    hint: 5\n');
    expect(config.cases![0].hint).to.equal(undefined);
    expect(config.cases![1].hint).to.equal(undefined);
  });

  it('parses subtasks with sequential fallback ids', () => {
    const { config } = parseJudgeConfig(
      'subtasks:\n  - cases:\n      - input: 1.in\n        output: 1.out\n  - id: 9\n    cases:\n      - input: 2.in\n        output: 2.out\n  - cases: []\n',
    );
    expect(config.subtasks!.map((s) => s.id)).to.deep.equal([1, 9, 3]);
  });

  it('falls back to a positional id when the declared id is not a number', () => {
    const { config } = parseJudgeConfig('subtasks:\n  - id: "7"\n    cases: []\n');
    expect(config.subtasks![0].id).to.equal(1);
  });

  it('keeps only known subtask score modes and numeric scores', () => {
    const { config } = parseJudgeConfig(
      'subtasks:\n  - score: 40\n    type: min\n    cases: []\n  - score: "60"\n    type: avg\n    cases: []\n',
    );
    expect(config.subtasks![0].score).to.equal(40);
    expect(config.subtasks![0].type).to.equal('min');
    expect(config.subtasks![1].score).to.equal(undefined);
    expect(config.subtasks![1].type).to.equal(undefined);
  });

  it('coerces subtask dependency lists to finite numbers', () => {
    const { config } = parseJudgeConfig('subtasks:\n  - if: [1, "2", bad]\n    cases: []\n');
    expect(config.subtasks![0].if).to.deep.equal([1, 2]);
  });

  it('defaults a subtask without a cases list to an empty array', () => {
    const { config } = parseJudgeConfig('subtasks:\n  - score: 100\n');
    expect(config.subtasks![0].cases).to.deep.equal([]);
  });
});

describe('serializeJudgeConfig', () => {
  it('emits only the type line for an empty config', () => {
    expect(serializeJudgeConfig(emptyConfig())).to.equal('type: default\n');
    expect(serializeJudgeConfig({ type: 'default', cases: [] })).to.equal('type: default\n');
  });

  it('omits the implicit default type when other fields are present', () => {
    const out = serializeJudgeConfig({ type: 'default', time: '1s' });
    expect(out).to.equal('time: 1s\n');
  });

  it('emits a non-default type', () => {
    expect(serializeJudgeConfig({ type: 'objective' })).to.equal('type: objective\n');
  });

  it('prefers subtasks over cases when both are set', () => {
    const config: JudgeConfig = {
      type: 'default',
      cases: [CASE_1],
      subtasks: [{ id: 1, cases: [CASE_2] }],
    };
    const { config: back } = parseJudgeConfig(serializeJudgeConfig(config));
    expect(back.subtasks).to.deep.equal([{ id: 1, cases: [{ input: '2.in', output: '2.out' }] }]);
    expect(back.cases).to.equal(undefined);
  });

  it('fills missing subtask ids from the position, not the next free id', () => {
    const config: JudgeConfig = {
      type: 'default',
      subtasks: [{ id: 5, cases: [CASE_1] }, { cases: [CASE_2] }],
    };
    const { config: back } = parseJudgeConfig(serializeJudgeConfig(config));
    expect(back.subtasks!.map((s) => s.id)).to.deep.equal([5, 2]);
  });

  it('drops empty langs and empty limit-rate maps', () => {
    const out = serializeJudgeConfig({ type: 'default', langs: [], time_limit_rate: {}, memory_limit_rate: {} });
    expect(out).to.equal('type: default\n');
  });

  it('omits falsy per-case extras but keeps an explicit videoPublic false', () => {
    const config: JudgeConfig = {
      type: 'default',
      cases: [{ input: '1.in', output: '1.out', time: '', hint: '', hintPublic: false, videoPublic: false }],
    };
    const { config: back } = parseJudgeConfig(serializeJudgeConfig(config));
    expect(back.cases).to.deep.equal([{ input: '1.in', output: '1.out', videoPublic: false }]);
  });

  it('round-trips a full config through serialize and parse', () => {
    const config: JudgeConfig = {
      type: 'default',
      time: '1s',
      memory: '256m',
      checker: 'chk.cc',
      checker_type: 'testlib',
      score: 'min',
      langs: ['cc.cc14o', 'py.py3'],
      time_limit_rate: { 'py.py3': 3 },
      subtasks: [
        { id: 1, score: 40, type: 'min', cases: [CASE_1] },
        {
          id: 2,
          score: 60,
          type: 'sum',
          time: '2s',
          memory: '512m',
          if: [1],
          cases: [{ input: '2.in', output: '2.out', hint: 'watch overflow', hintPublic: true, videoUrl: 'https://v.example', videoPublic: false }],
        },
      ],
    };
    const { config: back, error } = parseJudgeConfig(serializeJudgeConfig(config));
    expect(error).to.equal(undefined);
    // parseJudgeConfig always materializes the program-file keys, so the
    // round-tripped object carries them as explicit undefined.
    expect(back).to.deep.equal({ ...config, interactor: undefined, user: undefined, manager: undefined, filename: undefined });
  });

  it('round-trips an interactive config', () => {
    const config: JudgeConfig = { type: 'interactive', interactor: 'interactor.cc', cases: [CASE_1] };
    const { config: back } = parseJudgeConfig(serializeJudgeConfig(config));
    expect(back.type).to.equal('interactive');
    expect(back.interactor).to.equal('interactor.cc');
    expect(back.cases).to.deep.equal([CASE_1]);
  });

  it('preserves comments when only scalar fields change', () => {
    const source = '# judge tuned by hand\ntime: 1s\nmemory: 256m\ncases:\n  - input: 1.in\n    output: 1.out\n';
    const { config } = parseJudgeConfig(source);
    const out = serializeJudgeConfig({ ...config, time: '2s' }, { preserveSource: source });
    expect(out).to.include('# judge tuned by hand');
    expect(out).to.include('time: 2s');
    expect(out).to.include('memory: 256m');
  });

  it('deletes removed scalar fields in the preserved document', () => {
    const source = '# judge tuned by hand\ntime: 1s\nmemory: 256m\ncases:\n  - input: 1.in\n    output: 1.out\n';
    const { config } = parseJudgeConfig(source);
    const out = serializeJudgeConfig({ ...config, memory: undefined }, { preserveSource: source });
    expect(out).to.include('# judge tuned by hand');
    expect(out).to.not.include('memory');
  });

  it('discards comments when the case structure changes', () => {
    const source = '# judge tuned by hand\ntime: 1s\ncases:\n  - input: 1.in\n    output: 1.out\n';
    const { config } = parseJudgeConfig(source);
    const out = serializeJudgeConfig({ ...config, cases: [...config.cases!, CASE_2] }, { preserveSource: source });
    expect(out).to.not.include('#');
    const { config: back } = parseJudgeConfig(out);
    expect(back.cases).to.deep.equal([CASE_1, CASE_2]);
  });

  it('falls back to full serialization when preserveSource is not a mapping', () => {
    const out = serializeJudgeConfig({ type: 'default', time: '3s' }, { preserveSource: 'just a plain scalar' });
    expect(out).to.equal('time: 3s\n');
  });
});

describe('classify', () => {
  it('classifies extension-based inputs and outputs with their stems', () => {
    expect(classify('1.in')).to.deep.equal({ kind: 'input', stem: '1' });
    expect(classify('3.out')).to.deep.equal({ kind: 'output', stem: '3' });
    expect(classify('5.ans')).to.deep.equal({ kind: 'output', stem: '5' });
    expect(classify('7.input')).to.deep.equal({ kind: 'input', stem: '7' });
    expect(classify('7.output')).to.deep.equal({ kind: 'output', stem: '7' });
  });

  it('uses only the basename of a path', () => {
    expect(classify('testdata/deep/3.out')).to.deep.equal({ kind: 'output', stem: '3' });
  });

  it('strips data, test, and case prefixes from the stem', () => {
    expect(classify('test1.in')).to.deep.equal({ kind: 'input', stem: '1' });
    expect(classify('case_2.in')).to.deep.equal({ kind: 'input', stem: '2' });
    expect(classify('data-7.ans')).to.deep.equal({ kind: 'output', stem: '7' });
  });

  it('classifies input/output basename prefixes with any extension', () => {
    expect(classify('input01.txt')).to.deep.equal({ kind: 'input', stem: '01' });
    expect(classify('output01.txt')).to.deep.equal({ kind: 'output', stem: '01' });
  });

  it('classifies unrelated files as other with an empty stem', () => {
    expect(classify('readme.md')).to.deep.equal({ kind: 'other', stem: '' });
    expect(classify('checker.cpp')).to.deep.equal({ kind: 'other', stem: '' });
  });
});

describe('autoPair', () => {
  it('pairs matching stems and reports nothing else', () => {
    const result = autoPair(['1.in', '1.out', '2.in', '2.out']);
    expect(result.pairs).to.deep.equal([CASE_1, CASE_2]);
    expect(result.unpairedInputs).to.deep.equal([]);
    expect(result.unpairedOutputs).to.deep.equal([]);
    expect(result.others).to.deep.equal([]);
  });

  it('orders pairs by natural stem sort so 10 follows 2', () => {
    const result = autoPair(['test10.in', 'test10.out', 'test2.in', 'test2.out', 'test1.in', 'test1.out']);
    expect(result.pairs.map((p) => p.input)).to.deep.equal(['test1.in', 'test2.in', 'test10.in']);
  });

  it('pairs .in with .ans and mixed naming schemes', () => {
    const result = autoPair(['1.in', '1.ans', 'input02.txt', 'output02.txt']);
    expect(result.pairs).to.deep.equal([
      { input: '1.in', output: '1.ans' },
      { input: 'input02.txt', output: 'output02.txt' },
    ]);
  });

  it('keeps original filename casing in pairs', () => {
    const result = autoPair(['A.IN', 'a.out']);
    expect(result.pairs).to.deep.equal([{ input: 'A.IN', output: 'a.out' }]);
  });

  it('reports unpaired inputs and outputs separately', () => {
    const result = autoPair(['1.in', '2.in', '1.out', '3.out']);
    expect(result.pairs).to.deep.equal([CASE_1]);
    expect(result.unpairedInputs).to.deep.equal(['2.in']);
    expect(result.unpairedOutputs).to.deep.equal(['3.out']);
  });

  it('routes config files and judge programs to others', () => {
    const result = autoPair(['config.yaml', 'sub/config.yml', 'checker.cpp', 'interactor.py', 'validator.cc', 'user.cc', 'readme.md', '1.in', '1.out']);
    expect(result.pairs).to.deep.equal([CASE_1]);
    expect(result.others).to.deep.equal(['config.yaml', 'sub/config.yml', 'checker.cpp', 'interactor.py', 'validator.cc', 'user.cc', 'readme.md']);
  });

  it('silently drops a later file whose stem was already claimed', () => {
    // Documented quirk: '1.in' and 'test1.in' normalize to the same stem;
    // the second file is neither paired nor listed as unpaired or other.
    const result = autoPair(['1.in', 'test1.in', '1.out']);
    expect(result.pairs).to.deep.equal([CASE_1]);
    expect(result.unpairedInputs).to.deep.equal([]);
    expect(result.unpairedOutputs).to.deep.equal([]);
    expect(result.others).to.deep.equal([]);
  });

  it('returns all-empty results for an empty file list', () => {
    expect(autoPair([])).to.deep.equal({ pairs: [], unpairedInputs: [], unpairedOutputs: [], others: [] });
  });
});

describe('validateConfig', () => {
  it('accepts a flat config whose files all exist', () => {
    expect(validateConfig({ type: 'default', cases: [CASE_1, CASE_2] }, FILES_12)).to.deep.equal([]);
  });

  it('flags missing input and output files as errors', () => {
    const issues = validateConfig({ type: 'default', cases: [{ input: 'a.in', output: 'a.out' }] }, new Set(['a.in']));
    expect(issues).to.deep.equal([{ level: 'error', message: '输出文件不存在: a.out', subtaskId: undefined }]);
  });

  it('warns when a default-typed config has no cases at all', () => {
    const issues = validateConfig(emptyConfig(), new Set());
    expect(issues).to.deep.equal([{ level: 'warning', message: '尚未配置测试用例' }]);
  });

  it('does not demand cases for non-default problem types', () => {
    expect(validateConfig({ type: 'objective' }, new Set())).to.deep.equal([]);
  });

  it('attaches the subtask id to case-file errors', () => {
    const issues = validateConfig({ type: 'default', subtasks: [{ id: 7, cases: [CASE_1] }] }, new Set());
    expect(issues.map((i) => i.subtaskId)).to.deep.equal([7, 7]);
    expect(issues.every((i) => i.level === 'error')).to.equal(true);
  });

  it('warns about duplicate subtask ids', () => {
    const issues = validateConfig(
      { type: 'default', subtasks: [{ id: 1, cases: [CASE_1] }, { id: 1, cases: [CASE_2] }] },
      FILES_12,
    );
    expect(issues).to.deep.equal([{ level: 'warning', message: '重复的 subtask id: 1' }]);
  });

  it('warns about a subtask with no cases', () => {
    const issues = validateConfig({ type: 'default', subtasks: [{ id: 1, cases: [] }] }, new Set());
    expect(issues).to.deep.equal([{ level: 'warning', message: 'Subtask 1 没有测试用例', subtaskId: 1 }]);
  });

  it('warns when subtask scores do not sum to 100', () => {
    const issues = validateConfig(
      { type: 'default', subtasks: [{ id: 1, score: 40, cases: [CASE_1] }, { id: 2, score: 50, cases: [CASE_2] }] },
      FILES_12,
    );
    expect(issues).to.deep.equal([{ level: 'warning', message: '总分为 90，不是 100' }]);
  });

  it('accepts scores summing to exactly 100 and skips the check when no scores are set', () => {
    expect(
      validateConfig(
        { type: 'default', subtasks: [{ id: 1, score: 40, cases: [CASE_1] }, { id: 2, score: 60, cases: [CASE_2] }] },
        FILES_12,
      ),
    ).to.deep.equal([]);
    expect(
      validateConfig({ type: 'default', subtasks: [{ id: 1, cases: [CASE_1] }] }, FILES_12),
    ).to.deep.equal([]);
  });

  it('flags dependencies on unknown subtasks', () => {
    const issues = validateConfig(
      { type: 'default', subtasks: [{ id: 1, if: [99], cases: [CASE_1] }] },
      FILES_12,
    );
    expect(issues).to.deep.equal([{ level: 'error', message: 'Subtask 1 依赖未知 subtask 99', subtaskId: 1 }]);
  });

  it('detects a self-dependency as a cycle', () => {
    const issues = validateConfig(
      { type: 'default', subtasks: [{ id: 1, if: [1], cases: [CASE_1] }] },
      FILES_12,
    );
    expect(issues).to.deep.equal([{ level: 'error', message: 'Subtask 依赖存在循环' }]);
  });

  it('detects a two-node dependency cycle', () => {
    const issues = validateConfig(
      { type: 'default', subtasks: [{ id: 1, if: [2], cases: [CASE_1] }, { id: 2, if: [1], cases: [CASE_2] }] },
      FILES_12,
    );
    expect(issues).to.deep.equal([{ level: 'error', message: 'Subtask 依赖存在循环' }]);
  });

  it('accepts an acyclic dependency chain', () => {
    expect(
      validateConfig(
        { type: 'default', subtasks: [{ id: 1, cases: [CASE_1] }, { id: 2, if: [1], cases: [CASE_2] }] },
        FILES_12,
      ),
    ).to.deep.equal([]);
  });

  it('warns when a float checker has no tolerance configured', () => {
    const issues = validateConfig({ type: 'default', checker_type: 'float', cases: [CASE_1] }, FILES_12);
    expect(issues).to.deep.equal([{ level: 'warning', message: 'Float checker 未指定误差精度' }]);
    expect(
      validateConfig({ type: 'default', checker_type: 'float', float_absolute: 0.001, cases: [CASE_1] }, FILES_12),
    ).to.deep.equal([]);
  });

  it('requires an interactor for interactive problems', () => {
    expect(validateConfig({ type: 'interactive' }, new Set())).to.deep.equal([
      { level: 'error', message: '交互题缺少 interactor 文件' },
    ]);
    expect(validateConfig({ type: 'interactive', interactor: 'i.cc' }, new Set())).to.deep.equal([]);
  });

  it('requires both user and manager for communication problems', () => {
    expect(validateConfig({ type: 'communication', user: 'u.cc' }, new Set())).to.deep.equal([
      { level: 'error', message: '通信题需要 user 与 manager 文件' },
    ]);
    expect(validateConfig({ type: 'communication', user: 'u.cc', manager: 'm.cc' }, new Set())).to.deep.equal([]);
  });
});

describe('assignSequentialIds', () => {
  it('fills missing ids with the 1-based position and keeps explicit ids', () => {
    const input = [{ cases: [] }, { id: 5, cases: [] }, { cases: [] }];
    expect(assignSequentialIds(input).map((s) => s.id)).to.deep.equal([1, 5, 3]);
  });

  it('returns new objects without mutating the input', () => {
    const input = [{ cases: [] }];
    const result = assignSequentialIds(input);
    expect(result[0]).to.not.equal(input[0]);
    expect(input[0]).to.deep.equal({ cases: [] });
  });
});

describe('flattenCases', () => {
  it('concatenates cases across subtasks in order', () => {
    const config: JudgeConfig = {
      type: 'default',
      cases: [{ input: 'ignored.in', output: 'ignored.out' }],
      subtasks: [{ id: 1, cases: [CASE_1] }, { id: 2, cases: [CASE_2] }],
    };
    expect(flattenCases(config)).to.deep.equal([CASE_1, CASE_2]);
  });

  it('falls back to the flat cases list when subtasks are absent or empty', () => {
    expect(flattenCases({ type: 'default', cases: [CASE_1] })).to.deep.equal([CASE_1]);
    expect(flattenCases({ type: 'default', subtasks: [], cases: [CASE_1] })).to.deep.equal([CASE_1]);
  });

  it('returns an empty list when there is nothing to flatten', () => {
    expect(flattenCases(emptyConfig())).to.deep.equal([]);
  });
});
