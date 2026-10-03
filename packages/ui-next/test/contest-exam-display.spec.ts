// @vitest-environment jsdom
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  canSubmitProblemMode,
  examContestId,
  filterOfficialScoreboardRows,
  getContestProblemStatus,
  getPersonalPracticeStatus,
  isExamRule,
  isUnofficialScoreboardRank,
  officialOnlyFromLocation,
  postContestProblemEntryUrl,
  prioritizeCurrentScoreboardRows,
  scoreboardScoreColor,
  type ScoreboardDisplayCell,
  scoreboardParticipantColumn,
  scoreboardRowMatches,
} from '../src/lib/contest-exam-display.ts';
import { renderScoreboardImage, type ScoreboardImageModel } from '../src/lib/scoreboard-image-export.ts';

describe('getContestProblemStatus', () => {
  it('returns null for null, undefined, and empty string', () => {
    expect(getContestProblemStatus(null)).to.equal(null);
    expect(getContestProblemStatus(undefined)).to.equal(null);
    expect(getContestProblemStatus('')).to.equal(null);
  });

  it('treats status zero as waiting rather than missing', () => {
    expect(getContestProblemStatus(0)).to.deep.equal({ label: '等待中', title: 'Waiting', code: 'pending' });
  });

  it('maps well-known verdicts to label, title, and code', () => {
    expect(getContestProblemStatus(1)).to.deep.equal({ label: 'AC', title: 'Accepted', code: 'pass' });
    expect(getContestProblemStatus(2)).to.deep.equal({ label: 'WA', title: 'Wrong Answer', code: 'fail' });
    expect(getContestProblemStatus(7)?.code).to.equal('fail');
    expect(getContestProblemStatus(12)?.code).to.equal('pass');
    expect(getContestProblemStatus(20)).to.deep.equal({ label: '评测中', title: 'Running', code: 'progress' });
    expect(getContestProblemStatus(30)?.code).to.equal('ignored');
    expect(getContestProblemStatus(32)?.code).to.equal('pass');
  });

  it('coerces numeric strings before lookup', () => {
    expect(getContestProblemStatus('2')).to.deep.equal({ label: 'WA', title: 'Wrong Answer', code: 'fail' });
  });

  it('flags non-integer input as an invalid status', () => {
    expect(getContestProblemStatus(1.5)).to.deep.equal({
      label: '状态异常',
      title: 'Invalid contest status: 1.5',
      code: 'fail',
    });
    expect(getContestProblemStatus('abc')).to.deep.equal({
      label: '状态异常',
      title: 'Invalid contest status: abc',
      code: 'fail',
    });
  });

  it('renders unknown integer codes with the numeric value', () => {
    expect(getContestProblemStatus(99)).to.deep.equal({
      label: '未知 99',
      title: 'Unknown contest status: 99',
      code: 'fail',
    });
    expect(getContestProblemStatus(-1)?.label).to.equal('未知 -1');
  });
});

describe('getPersonalPracticeStatus', () => {
  it('returns null for missing snapshots and missing statuses', () => {
    expect(getPersonalPracticeStatus(null)).to.equal(null);
    expect(getPersonalPracticeStatus(undefined)).to.equal(null);
    expect(getPersonalPracticeStatus({ status: null, phase: 'before' })).to.equal(null);
  });

  it('passes non-pass verdicts through untouched regardless of phase', () => {
    expect(getPersonalPracticeStatus({ status: 2, phase: 'before' })).to.deep.equal({ label: 'WA', title: 'Wrong Answer', code: 'fail' });
    expect(getPersonalPracticeStatus({ status: 20, phase: 'after' })?.code).to.equal('progress');
  });

  it('relabels pre-contest passes with the pre-contest wording', () => {
    expect(getPersonalPracticeStatus({ status: 1, phase: 'before' })).to.deep.equal({
      label: '个人已通过（赛前）',
      title: 'Accepted before this contest',
      code: 'pass',
    });
  });

  it('relabels other passes but keeps the original title', () => {
    expect(getPersonalPracticeStatus({ status: 1, phase: 'after' })).to.deep.equal({ label: '已通过', title: 'Accepted', code: 'pass' });
    expect(getPersonalPracticeStatus({ status: 1, phase: 'other' })?.label).to.equal('已通过');
  });

  it('applies the same relabeling to every pass-coded verdict', () => {
    expect(getPersonalPracticeStatus({ status: 12, phase: 'before' })?.title).to.equal('Accepted before this contest');
    expect(getPersonalPracticeStatus({ status: 12, phase: 'after' })?.label).to.equal('已通过');
  });

  it('does not mutate the shared status table', () => {
    getPersonalPracticeStatus({ status: 1, phase: 'before' });
    expect(getContestProblemStatus(1)).to.deep.equal({ label: 'AC', title: 'Accepted', code: 'pass' });
  });
});

describe('isExamRule and examContestId', () => {
  it('accepts only the exact exam rule string', () => {
    expect(isExamRule('exam')).to.equal(true);
    expect(isExamRule('Exam')).to.equal(false);
    expect(isExamRule('exam ')).to.equal(false);
    expect(isExamRule(['exam'])).to.equal(false);
  });

  it('reads docId or integer _id without String() fallback', () => {
    expect(examContestId({ docId: '6aacef7ef6e8b68176be808b' })).to.equal('6aacef7ef6e8b68176be808b');
    expect(examContestId({ _id: 42 })).to.equal('42');
    expect(examContestId({ docId: { toString: () => 'forged' } })).to.equal('');
  });
});

describe('postContestProblemEntryUrl', () => {
  const base = {
    rule: 'acm',
    clientRequired: false,
    practiceSupported: true,
    practiceOpen: true,
    ended: true,
    detailUrl: '/contest/abc',
    contestId: 'abc',
  };

  it('always routes exam-rule contests into exam mode', () => {
    expect(postContestProblemEntryUrl({ ...base, rule: 'exam', clientRequired: false, ended: false })).to.equal('/exam-mode/abc');
  });

  it('uri-encodes the contest id', () => {
    expect(postContestProblemEntryUrl({ ...base, rule: 'exam', contestId: 'a b/c' })).to.equal('/exam-mode/a%20b%2Fc');
  });

  it('keeps client-required contests in exam mode until practice is available', () => {
    expect(postContestProblemEntryUrl({ ...base, clientRequired: true, practiceSupported: false })).to.equal('/exam-mode/abc');
    expect(postContestProblemEntryUrl({ ...base, clientRequired: true, ended: false })).to.equal('/exam-mode/abc');
    expect(postContestProblemEntryUrl({ ...base, clientRequired: true, practiceOpen: false })).to.equal('/exam-mode/abc');
  });

  it('routes client-required contests to problems once ended with open practice', () => {
    expect(postContestProblemEntryUrl({ ...base, clientRequired: true })).to.equal('/contest/abc/problems');
  });

  it('routes ordinary contests straight to the problems page', () => {
    expect(postContestProblemEntryUrl({ ...base, ended: false, practiceOpen: false })).to.equal('/contest/abc/problems');
  });
});

describe('canSubmitProblemMode', () => {
  it('allows the three submitting modes', () => {
    expect(canSubmitProblemMode('normal')).to.equal(true);
    expect(canSubmitProblemMode('contest')).to.equal(true);
    expect(canSubmitProblemMode('correction')).to.equal(true);
  });

  it('rejects everything else', () => {
    expect(canSubmitProblemMode('view')).to.equal(false);
    expect(canSubmitProblemMode('')).to.equal(false);
    expect(canSubmitProblemMode(undefined)).to.equal(false);
    expect(canSubmitProblemMode(null)).to.equal(false);
  });
});

describe('scoreboardParticipantColumn', () => {
  it('prefers an explicit user-typed column', () => {
    const header: ScoreboardDisplayCell[] = [{ type: 'rank' }, { type: 'total' }, { type: 'user' }];
    expect(scoreboardParticipantColumn(header, false)).to.equal(2);
    expect(scoreboardParticipantColumn(header, true)).to.equal(2);
  });

  it('recognizes a user column at index zero', () => {
    expect(scoreboardParticipantColumn([{ type: 'user' }], false)).to.equal(0);
  });

  it('falls back to column one only for team mode with enough columns', () => {
    const header: ScoreboardDisplayCell[] = [{ type: 'rank' }, { type: 'team' }];
    expect(scoreboardParticipantColumn(header, true)).to.equal(1);
    expect(scoreboardParticipantColumn(header, false)).to.equal(-1);
    expect(scoreboardParticipantColumn([{ type: 'rank' }], true)).to.equal(-1);
    expect(scoreboardParticipantColumn([], true)).to.equal(-1);
  });
});

describe('scoreboardRowMatches', () => {
  const row: ScoreboardDisplayCell[] = [
    { type: 'rank', raw: 1 },
    { type: 'user', raw: 42 },
  ];

  it('matches on stringified equality of the raw cell value', () => {
    expect(scoreboardRowMatches(row, 1, 42)).to.equal(true);
    expect(scoreboardRowMatches(row, 1, '42')).to.equal(true);
    expect(scoreboardRowMatches(row, 1, 43)).to.equal(false);
  });

  it('accepts a participant id of zero', () => {
    expect(scoreboardRowMatches([{ raw: 0 }], 0, 0)).to.equal(true);
  });

  it('rejects unusable columns and ids', () => {
    expect(scoreboardRowMatches(row, -1, 42)).to.equal(false);
    expect(scoreboardRowMatches(row, 1, null)).to.equal(false);
    expect(scoreboardRowMatches(row, 1, undefined)).to.equal(false);
  });

  it('rejects rows with missing cells or empty raw values', () => {
    expect(scoreboardRowMatches(row, 5, 42)).to.equal(false);
    expect(scoreboardRowMatches([{ type: 'user' }], 0, 42)).to.equal(false);
    expect(scoreboardRowMatches([{ raw: null }], 0, 'null')).to.equal(false);
  });
});

describe('prioritizeCurrentScoreboardRows', () => {
  const rowFor = (id: number): ScoreboardDisplayCell[] => [{ type: 'rank' }, { type: 'user', raw: id }];

  it('moves matching rows to the front, keeping both groups in order', () => {
    const rows = [rowFor(1), rowFor(2), rowFor(3), rowFor(2)];
    expect(prioritizeCurrentScoreboardRows(rows, 1, 2)).to.deep.equal([rowFor(2), rowFor(2), rowFor(1), rowFor(3)]);
  });

  it('returns the original array reference when nothing matches', () => {
    const rows = [rowFor(1), rowFor(3)];
    expect(prioritizeCurrentScoreboardRows(rows, 1, 99)).to.equal(rows);
    expect(prioritizeCurrentScoreboardRows(rows, -1, 1)).to.equal(rows);
    expect(prioritizeCurrentScoreboardRows(rows, 1, null)).to.equal(rows);
  });

  it('handles empty scoreboards', () => {
    const rows: ScoreboardDisplayCell[][] = [];
    expect(prioritizeCurrentScoreboardRows(rows, 1, 1)).to.equal(rows);
  });
});

const packageRoot = resolve(import.meta.dirname, '..');

const SCORE_SOLID = {
  danger: 'oklch(0.53 0.19 25)',
  warning: 'oklch(0.78 0.14 95)',
  success: 'oklch(0.53 0.15 152)',
} as const;

function setScoreSolids(): void {
  document.documentElement.style.setProperty('--danger-solid', SCORE_SOLID.danger);
  document.documentElement.style.setProperty('--warning-solid', SCORE_SOLID.warning);
  document.documentElement.style.setProperty('--success-solid', SCORE_SOLID.success);
}

function clearScoreSolids(): void {
  document.documentElement.style.removeProperty('--danger-solid');
  document.documentElement.style.removeProperty('--warning-solid');
  document.documentElement.style.removeProperty('--success-solid');
}

function designGateReport(relativePath: string): { status: number; output: string } {
  const result = spawnSync(process.execPath, ['scripts/design-gate.mjs', '--file', relativePath], {
    cwd: packageRoot,
    encoding: 'utf8',
  });
  if (typeof result.status !== 'number' || typeof result.stdout !== 'string' || typeof result.stderr !== 'string') {
    throw new TypeError('design-gate did not return a status and string output');
  }
  return { status: result.status, output: `${result.stdout}${result.stderr}`.trim() };
}

function expectDesignGateClean(relativePath: string): void {
  const report = designGateReport(relativePath);
  expect(`${relativePath}\nstatus=${report.status}\n${report.output}`).to.equal(`${relativePath}\nstatus=0\n`);
}

describe('scoreboardScoreColor', () => {
  it('uses the normalized percentage supplied by the scoreboard contract', () => {
    setScoreSolids();
    expect(scoreboardScoreColor(0)).to.equal(SCORE_SOLID.danger);
    expect(scoreboardScoreColor(50)).to.equal(SCORE_SOLID.warning);
    expect(scoreboardScoreColor(100)).to.equal(SCORE_SOLID.success);
  });

  it('keeps every partial score below 100 on the warning tone', () => {
    setScoreSolids();
    expect(scoreboardScoreColor(0.4)).to.equal(SCORE_SOLID.warning);
    expect(scoreboardScoreColor(99)).to.equal(SCORE_SOLID.warning);
    expect(scoreboardScoreColor(99.9)).to.equal(SCORE_SOLID.warning);
  });

  it('clamps out-of-range values and ignores invalid values', () => {
    setScoreSolids();
    expect(scoreboardScoreColor(-20)).to.equal(SCORE_SOLID.danger);
    expect(scoreboardScoreColor(140)).to.equal(SCORE_SOLID.success);
    expect(scoreboardScoreColor(undefined)).to.equal(undefined);
    expect(scoreboardScoreColor('not-a-score')).to.equal(undefined);
  });

  it('returns the fallback hex when the tone token is missing', () => {
    clearScoreSolids();
    expect(scoreboardScoreColor(0)).to.equal('#d73a3a');
    expect(scoreboardScoreColor(50)).to.equal('#e0a526');
    expect(scoreboardScoreColor(100)).to.equal('#1f9d55');
  });
});

describe('scoreboard colour design gate', () => {
  it('accepts contest-exam-display.ts and scoreboard-image-export.ts', () => {
    expectDesignGateClean('src/lib/contest-exam-display.ts');
    expectDesignGateClean('src/lib/scoreboard-image-export.ts');
  });
});

describe('official-only scoreboard filter', () => {
  it('hides 0 / "0" / * ranks and keeps numeric official rows', () => {
    expect(isUnofficialScoreboardRank(0)).to.equal(true);
    expect(isUnofficialScoreboardRank('0')).to.equal(true);
    expect(isUnofficialScoreboardRank('*')).to.equal(true);
    expect(isUnofficialScoreboardRank('1')).to.equal(false);
    const rows: ScoreboardDisplayCell[][] = [
      [
        { type: 'rank', value: '1' },
        { type: 'user', raw: 12 },
      ],
      [
        { type: 'rank', value: '0' },
        { type: 'user', raw: 11 },
      ],
      [
        { type: 'rank', value: '*' },
        { type: 'user', raw: 13 },
      ],
      [
        { type: 'rank', value: 2 },
        { type: 'user', raw: 14 },
      ],
    ];
    expect(filterOfficialScoreboardRows(rows).map((row) => row[1]?.raw)).to.deep.equal([12, 14]);
  });

  it('reads official-only from hash and falls back to local storage', () => {
    expect(officialOnlyFromLocation('#filter=rank')).to.equal(true);
    expect(officialOnlyFromLocation('#official')).to.equal(true);
    expect(officialOnlyFromLocation('#filter=all')).to.equal(false);
    expect(officialOnlyFromLocation('', '1')).to.equal(true);
    expect(officialOnlyFromLocation('', '0')).to.equal(false);
  });
});

interface CanvasPaint {
  op: 'fillRect' | 'strokeRect' | 'fillText';
  fill: string;
  stroke: string;
  text?: string;
}

const EXPORT_TOKENS = {
  '--bg': 'token-bg',
  '--surface': 'token-surface',
  '--surface-sunken': 'token-surface-sunken',
  '--fg': 'token-fg',
  '--fg-muted': 'token-fg-muted',
  '--fg-subtle': 'token-fg-subtle',
  '--warning-fg': 'token-warning-fg',
  '--success-fg': 'token-success-fg',
  '--success-soft': 'token-success-soft',
  '--success-solid': 'token-success-solid',
  '--line': 'token-line',
  '--line-strong': 'token-line-strong',
  '--line-subtle': 'token-line-subtle',
} as const;

const FROZEN_SNAPSHOT_LABEL = '封榜快照 · 未包含封榜后的真实结果';
const REALTIME_SNAPSHOT_LABEL = '实时排行榜';

function setExportTokens(): void {
  for (const [name, value] of Object.entries(EXPORT_TOKENS)) {
    document.documentElement.style.setProperty(name, value);
  }
}

function clearExportTokens(): void {
  for (const name of Object.keys(EXPORT_TOKENS)) {
    document.documentElement.style.removeProperty(name);
  }
}

function scoreboardPaintModel(snapshotMode: ScoreboardImageModel['snapshotMode']): ScoreboardImageModel {
  return {
    title: '比赛甲',
    generatedAt: '2026-10-02 12:00:00',
    snapshotMode,
    columns: [{ type: 'rank', label: '排名' }],
    rows: [
      { cells: [{ text: 'even-cell', color: 'cell-explicit' }] },
      { cells: [{ text: 'odd-cell' }] },
      { cells: [{ text: 'blood-cell', firstBlood: true }] },
    ],
  };
}

async function paintScoreboard(model: ScoreboardImageModel): Promise<CanvasPaint[]> {
  const paints: CanvasPaint[] = [];
  const proto = HTMLCanvasElement.prototype;
  const previousGetContext = proto.getContext;
  const toBlobDescriptor = Object.getOwnPropertyDescriptor(proto, 'toBlob');
  proto.getContext = function getContext(kind: string) {
    if (kind !== '2d') return null;
    let fillStyle = '';
    let strokeStyle = '';
    return {
      get fillStyle() {
        return fillStyle;
      },
      set fillStyle(value: string) {
        fillStyle = String(value);
      },
      get strokeStyle() {
        return strokeStyle;
      },
      set strokeStyle(value: string) {
        strokeStyle = String(value);
      },
      font: '',
      textAlign: 'left' as CanvasTextAlign,
      textBaseline: 'alphabetic' as CanvasTextBaseline,
      measureText(text: string) {
        return { width: Array.from(text).length * 8 } as TextMetrics;
      },
      scale() {},
      fillRect() {
        paints.push({ op: 'fillRect', fill: fillStyle, stroke: strokeStyle });
      },
      strokeRect() {
        paints.push({ op: 'strokeRect', fill: fillStyle, stroke: strokeStyle });
      },
      fillText(text: string) {
        paints.push({ op: 'fillText', fill: fillStyle, stroke: strokeStyle, text });
      },
    } as unknown as CanvasRenderingContext2D;
  } as typeof proto.getContext;
  proto.toBlob = ((callback: BlobCallback) => {
    callback(new Blob(['png'], { type: 'image/png' }));
  }) as typeof proto.toBlob;
  try {
    await renderScoreboardImage(model);
    return paints;
  } finally {
    proto.getContext = previousGetContext;
    if (toBlobDescriptor) Object.defineProperty(proto, 'toBlob', toBlobDescriptor);
    else Reflect.deleteProperty(proto, 'toBlob');
  }
}

function fillTextColor(paints: CanvasPaint[], text: string): string {
  const matches = paints.filter((paint) => paint.op === 'fillText' && paint.text === text);
  expect(matches.length).to.equal(1);
  const match = matches[0];
  if (!match) throw new TypeError(`missing painted text ${text}`);
  return match.fill;
}

describe('scoreboard image export colours', () => {
  it('paints each scoreboard region from its colour token', async () => {
    setExportTokens();
    try {
      const frozen = await paintScoreboard(scoreboardPaintModel('frozen'));
      const fills = frozen.filter((paint) => paint.op === 'fillRect').map((paint) => paint.fill);
      const strokes = frozen.filter((paint) => paint.op === 'strokeRect').map((paint) => paint.stroke);
      expect(fills).to.deep.equal([
        EXPORT_TOKENS['--bg'],
        EXPORT_TOKENS['--surface-sunken'],
        EXPORT_TOKENS['--surface'],
        EXPORT_TOKENS['--surface-sunken'],
        EXPORT_TOKENS['--success-soft'],
      ]);
      expect(strokes).to.deep.equal([
        EXPORT_TOKENS['--line-strong'],
        EXPORT_TOKENS['--line'],
        EXPORT_TOKENS['--line'],
        EXPORT_TOKENS['--line'],
      ]);
      expect(fillTextColor(frozen, '比赛甲')).to.equal(EXPORT_TOKENS['--fg']);
      expect(fillTextColor(frozen, '生成时间：2026-10-02 12:00:00')).to.equal(EXPORT_TOKENS['--fg-muted']);
      expect(fillTextColor(frozen, FROZEN_SNAPSHOT_LABEL)).to.equal(EXPORT_TOKENS['--warning-fg']);
      expect(fillTextColor(frozen, '共 3 行')).to.equal(EXPORT_TOKENS['--fg-subtle']);
      expect(fillTextColor(frozen, '排名')).to.equal(EXPORT_TOKENS['--fg-subtle']);
      expect(fillTextColor(frozen, 'even-cell')).to.equal('cell-explicit');
      expect(fillTextColor(frozen, 'odd-cell')).to.equal(EXPORT_TOKENS['--fg']);
      expect(fillTextColor(frozen, 'blood-cell')).to.equal(EXPORT_TOKENS['--fg']);

      const realtime = await paintScoreboard(scoreboardPaintModel('realtime'));
      expect(fillTextColor(realtime, REALTIME_SNAPSHOT_LABEL)).to.equal(EXPORT_TOKENS['--success-fg']);
    } finally {
      clearExportTokens();
    }
  });

  it('paints the original hex fallback when a colour token is missing', async () => {
    clearExportTokens();
    const frozen = await paintScoreboard(scoreboardPaintModel('frozen'));
    const fills = frozen.filter((paint) => paint.op === 'fillRect').map((paint) => paint.fill);
    const strokes = frozen.filter((paint) => paint.op === 'strokeRect').map((paint) => paint.stroke);
    expect(fills).to.deep.equal(['#f8fafc', '#172033', '#ffffff', '#f1f5f9', '#dcfce7']);
    expect(strokes).to.deep.equal(['#334155', '#cbd5e1', '#cbd5e1', '#cbd5e1']);
    expect(fillTextColor(frozen, '比赛甲')).to.equal('#0f172a');
    expect(fillTextColor(frozen, '生成时间：2026-10-02 12:00:00')).to.equal('#475569');
    expect(fillTextColor(frozen, FROZEN_SNAPSHOT_LABEL)).to.equal('#b45309');
    expect(fillTextColor(frozen, '共 3 行')).to.equal('#64748b');
    expect(fillTextColor(frozen, '排名')).to.equal('#f8fafc');
    expect(fillTextColor(frozen, 'even-cell')).to.equal('cell-explicit');
    expect(fillTextColor(frozen, 'odd-cell')).to.equal('#0f172a');
    expect(fillTextColor(frozen, 'blood-cell')).to.equal('#0f172a');

    const realtime = await paintScoreboard(scoreboardPaintModel('realtime'));
    expect(fillTextColor(realtime, REALTIME_SNAPSHOT_LABEL)).to.equal('#047857');
  });
});
