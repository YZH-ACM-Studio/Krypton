// @vitest-environment node
// A static import fails collection while src/pages/set-workspace/ranking-model.ts is absent.
import { describe, expect, it } from 'vitest';

const modelLoaders = import.meta.glob('../../src/pages/set-workspace/ranking-model.ts');
const MODEL_SOURCE = 'src/pages/set-workspace/ranking-model.ts';

const UID = 7;

interface RankingApi {
  parseBoard: (raw: unknown) => unknown;
  rankingSummary: (board: unknown, viewerId: number, teamMode: boolean) => unknown;
  filterRankingRows: (board: unknown, query: string) => unknown;
}

function readField(record: object, key: string): unknown {
  if (!(key in record)) return undefined;
  return Reflect.get(record, key) as unknown;
}

function asFunction<Fn extends (...args: never[]) => unknown>(value: unknown, key: string): Fn {
  expect(typeof value, key).toBe('function');
  if (typeof value !== 'function') throw new TypeError(`${key} must be a function`);
  return value as Fn;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function loadRanking(): Promise<RankingApi> {
  let load: unknown;
  for (const [key, candidate] of Object.entries(modelLoaders)) {
    if (key.endsWith(MODEL_SOURCE)) load = candidate;
  }
  expect(typeof load, `${MODEL_SOURCE} is missing`).toBe('function');
  if (typeof load !== 'function') throw new TypeError(`${MODEL_SOURCE} is missing`);
  const imported: unknown = await load();
  if (!isRecord(imported)) throw new TypeError(`${MODEL_SOURCE} must be a module`);
  return {
    parseBoard: asFunction<RankingApi['parseBoard']>(readField(imported, 'parseBoard'), 'parseBoard'),
    rankingSummary: asFunction<RankingApi['rankingSummary']>(readField(imported, 'rankingSummary'), 'rankingSummary'),
    filterRankingRows: asFunction<RankingApi['filterRankingRows']>(readField(imported, 'filterRankingRows'), 'filterRankingRows'),
  };
}

function cell(
  type: string,
  value: string | number,
  extras?: { raw?: unknown; team?: { name: string; captainUid: number; memberUids: number[] } },
): Record<string, unknown> {
  const result: Record<string, unknown> = { type, value };
  if (extras && 'raw' in extras) result.raw = extras.raw;
  if (extras?.team) result.team = extras.team;
  return result;
}

/** Same shape as sections.spec.tsx acmBoard(), including currentUserId 7 on the second data row. */
function acmBoard(): Record<string, unknown> {
  const header = [
    cell('rank', '名次'),
    cell('user', '选手'),
    cell('solved', '通过'),
    cell('time', '罚时'),
    cell('problem', 'A', { raw: 1001 }),
  ];
  const chen = [
    cell('rank', 1),
    cell('user', '陈思远', { raw: 8 }),
    cell('solved', 5),
    cell('time', 412),
    cell('record', '+', { raw: 'rid-chen' }),
  ];
  const self = [
    cell('rank', 2),
    cell('user', '张三', { raw: UID }),
    cell('solved', 3),
    cell('time', 214),
    cell('record', '-2', { raw: 'rid-self' }),
  ];
  return {
    rows: [header, chen, self],
    udict: {
      8: { _id: 8, uname: '陈思远' },
      [UID]: { _id: UID, uname: '张三' },
    },
    currentUserId: UID,
    scoreboardLocked: true,
  };
}

/** Hydro ACM: header type solved, data cell type time, value "accept\\nH:MM", no time header. */
function productionAcmBoard(): Record<string, unknown> {
  return {
    rows: [
      [
        cell('rank', '#'),
        cell('user', '选手'),
        cell('solved', '通过\n总时间'),
        cell('problem', 'A', { raw: 1001 }),
      ],
      [
        cell('rank', 2),
        cell('user', '张三', { raw: UID }),
        cell('time', '3\n0:03'),
        cell('record', '+', { raw: 'rid-self' }),
      ],
    ],
    udict: {
      [UID]: { _id: UID, uname: '张三' },
    },
    currentUserId: UID,
    scoreboardLocked: false,
  };
}

function absentViewerBoard(): Record<string, unknown> {
  const source = acmBoard();
  return { ...source, currentUserId: 99 };
}

function teamBoard(): Record<string, unknown> {
  const header = [
    cell('rank', '名次'),
    cell('string', '队伍'),
    cell('solved', '通过'),
    cell('time', '罚时'),
    cell('problem', 'A', { raw: 1001 }),
  ];
  const first = [
    cell('rank', 1),
    cell('string', '软工二队', {
      raw: 'team-other',
      team: { name: '软工二队', captainUid: 9, memberUids: [9] },
    }),
    cell('solved', 4),
    cell('time', 300),
    cell('record', '+', { raw: 'rid-other' }),
  ];
  const second = [
    cell('rank', 2),
    cell('string', '计科二队', {
      raw: 'team-second',
      team: { name: '计科二队', captainUid: 4, memberUids: [4] },
    }),
    cell('solved', 2),
    cell('time', 180),
    cell('record', '+', { raw: 'rid-second' }),
  ];
  const third = [
    cell('rank', 3),
    cell('string', '计科一队', {
      raw: 'team-ours',
      team: { name: '计科一队', captainUid: 8, memberUids: [8, UID] },
    }),
    cell('solved', 1),
    cell('time', 90),
    cell('record', '+1', { raw: 'rid-ours' }),
  ];
  return {
    rows: [header, first, second, third],
    udict: {
      4: { _id: 4, uname: '周宁' },
      8: { _id: 8, uname: '陈思远' },
      9: { _id: 9, uname: '林晓' },
      [UID]: { _id: UID, uname: '张三' },
    },
    scoreboardLocked: false,
  };
}

function scoreBoard(): Record<string, unknown> {
  const header = [
    cell('rank', '名次'),
    cell('user', '选手'),
    cell('total_score', '总分'),
    cell('problem', 'A', { raw: 1001 }),
  ];
  const other = [
    cell('rank', 1),
    cell('user', '林晓', { raw: 9 }),
    cell('total_score', 100),
    cell('record', 100, { raw: 'rid-lin' }),
  ];
  const self = [
    cell('rank', 2),
    cell('user', '张三', { raw: UID }),
    cell('total_score', 88),
    cell('record', 88, { raw: 'rid-self' }),
  ];
  return {
    rows: [header, other, self],
    udict: {
      9: { _id: 9, uname: '林晓' },
      [UID]: { _id: UID, uname: '张三' },
    },
    currentUserId: UID,
    scoreboardLocked: false,
  };
}

function directoryBoard(): Record<string, unknown> {
  const header = [
    cell('rank', '名次'),
    cell('user', '选手'),
    cell('solved', '通过'),
    cell('time', '罚时'),
  ];
  const chen = [
    cell('rank', 1),
    cell('user', 'cell-8', { raw: 8 }),
    cell('solved', 5),
    cell('time', 10),
  ];
  const alice = [
    cell('rank', 2),
    cell('user', 'cell-7', { raw: UID }),
    cell('solved', 3),
    cell('time', 20),
  ];
  const bob = [
    cell('rank', 3),
    cell('user', 'cell-9', { raw: 9 }),
    cell('solved', 1),
    cell('time', 30),
  ];
  const zhao = [
    cell('rank', 4),
    cell('user', 'cell-10', { raw: 10 }),
    cell('solved', 1),
    cell('time', 40),
  ];
  const bare = [
    cell('rank', 5),
    cell('user', 'cell-12', { raw: 12 }),
    cell('solved', 0),
    cell('time', 0),
  ];
  return {
    rows: [header, chen, alice, bob, zhao, bare],
    udict: {
      8: { _id: 8, uname: 'ChenSY' },
      [UID]: { _id: UID, uname: 'ZhangSan' },
      9: { _id: 9, uname: 'BobLee' },
      10: { _id: 10, uname: 'ZhaoLiu' },
    },
    studentDict: {
      8: { studentId: '250340008', realName: '陈思远' },
      [UID]: { studentId: '250340001', realName: 'Alice' },
      9: { studentId: '240100003', realName: '李四' },
      10: { studentId: '9925031', realName: '赵六' },
    },
    currentUserId: UID,
    scoreboardLocked: false,
  };
}

function rankOnlyBoard(rank: string | number): Record<string, unknown> {
  return {
    rows: [
      [cell('rank', '名次'), cell('user', '选手'), cell('solved', '通过')],
      [cell('rank', rank), cell('user', '张三', { raw: UID }), cell('solved', 1)],
    ],
    currentUserId: UID,
  };
}

function expectCell(actual: unknown, expected: { type: string; value: string | number; raw?: unknown; team: null }): void {
  expect(isRecord(actual), expected.type).toBe(true);
  if (!isRecord(actual)) throw new TypeError(`${expected.type} cell is missing`);
  expect(actual.type).toBe(expected.type);
  expect(actual.value).toBe(expected.value);
  expect(actual.raw).toBe(expected.raw);
  expect(actual.team).toBeNull();
}

function expectRow(actual: unknown, cells: Array<{ type: string; value: string | number; raw?: unknown; team: null }>): void {
  expect(Array.isArray(actual)).toBe(true);
  if (!Array.isArray(actual)) throw new TypeError('row is missing');
  expect(actual).toHaveLength(cells.length);
  cells.forEach((expected, index) => {
    expectCell(actual[index], expected);
  });
}

function expectEmptyMap(value: unknown, label: string): void {
  expect(value, label).toBeInstanceOf(Map);
  if (!(value instanceof Map)) throw new TypeError(label);
  expect(value.size).toBe(0);
}

describe('ranking model', () => {
  it('summarizes the second acm row for the viewer', async () => {
    const { parseBoard, rankingSummary } = await loadRanking();
    const board = parseBoard(acmBoard());
    expect(rankingSummary(board, UID, false)).toEqual({
      rowIndex: 1,
      rank: '2',
      total: 2,
      solved: '3',
      penalty: '214',
      score: null,
    });
  });

  it('splits a production acm solved cell into count and penalty', async () => {
    const { parseBoard, rankingSummary } = await loadRanking();
    const board = parseBoard(productionAcmBoard());
    expect(rankingSummary(board, UID, false)).toEqual({
      rowIndex: 0,
      rank: '2',
      total: 1,
      solved: '3',
      penalty: '0:03',
      score: null,
    });
  });

  it('returns null summary fields when the viewer is not on the board', async () => {
    const { parseBoard, rankingSummary } = await loadRanking();
    const board = parseBoard(absentViewerBoard());
    expect(rankingSummary(board, 99, false)).toEqual({
      rowIndex: null,
      rank: null,
      total: 2,
      solved: null,
      penalty: null,
      score: null,
    });
  });

  it('finds a team member on the third row only in team mode', async () => {
    const { parseBoard, rankingSummary } = await loadRanking();
    const board = parseBoard(teamBoard());
    expect(rankingSummary(board, UID, true)).toEqual({
      rowIndex: 2,
      rank: '3',
      total: 3,
      solved: '1',
      penalty: '90',
      score: null,
    });
    expect(rankingSummary(board, UID, false)).toEqual({
      rowIndex: null,
      rank: null,
      total: 3,
      solved: null,
      penalty: null,
      score: null,
    });
  });

  it('reads the total score cell on a non-acm board', async () => {
    const { parseBoard, rankingSummary } = await loadRanking();
    const board = parseBoard(scoreBoard());
    expect(rankingSummary(board, UID, false)).toEqual({
      rowIndex: 1,
      rank: '2',
      total: 2,
      solved: null,
      penalty: null,
      score: '88',
    });
  });

  it('filters rows by student id, name, and username', async () => {
    const { parseBoard, filterRankingRows } = await loadRanking();
    const board = parseBoard(directoryBoard());
    expect(filterRankingRows(board, ' 2503 ')).toEqual([0, 1, 3]);
    expect(filterRankingRows(board, '陈')).toEqual([0]);
    expect(filterRankingRows(board, ' ALICE ')).toEqual([1]);
    expect(filterRankingRows(board, 'boblee')).toEqual([2]);
    expect(filterRankingRows(board, 'CHENSY')).toEqual([0]);
    expect(filterRankingRows(board, '')).toEqual([0, 1, 2, 3, 4]);
    expect(filterRankingRows(board, '   ')).toEqual([0, 1, 2, 3, 4]);
    expect(filterRankingRows(board, '不存在')).toEqual([]);
  });

  it('parses the sections acm board fixture', async () => {
    const { parseBoard } = await loadRanking();
    const board = parseBoard(acmBoard());
    expect(isRecord(board)).toBe(true);
    if (!isRecord(board)) throw new TypeError('board is missing');
    expectRow(board.header, [
      { type: 'rank', value: '名次', team: null },
      { type: 'user', value: '选手', team: null },
      { type: 'solved', value: '通过', team: null },
      { type: 'time', value: '罚时', team: null },
      { type: 'problem', value: 'A', raw: 1001, team: null },
    ]);
    expect(Array.isArray(board.body)).toBe(true);
    if (!Array.isArray(board.body)) throw new TypeError('body is missing');
    expect(board.body).toHaveLength(2);
    expectRow(board.body[0], [
      { type: 'rank', value: 1, team: null },
      { type: 'user', value: '陈思远', raw: 8, team: null },
      { type: 'solved', value: 5, team: null },
      { type: 'time', value: 412, team: null },
      { type: 'record', value: '+', raw: 'rid-chen', team: null },
    ]);
    expectRow(board.body[1], [
      { type: 'rank', value: 2, team: null },
      { type: 'user', value: '张三', raw: UID, team: null },
      { type: 'solved', value: 3, team: null },
      { type: 'time', value: 214, team: null },
      { type: 'record', value: '-2', raw: 'rid-self', team: null },
    ]);
    expect(board.currentUserId).toBe(UID);
    expect(board.locked).toBe(true);
    expect(board.names).toBeInstanceOf(Map);
    if (!(board.names instanceof Map)) throw new TypeError('names');
    expect(board.names.size).toBe(2);
    expect(board.names.get('8')).toBe('陈思远');
    expect(board.names.get(String(UID))).toBe('张三');
    expectEmptyMap(board.students, 'students');
    expectEmptyMap(board.problems, 'problems');
  });

  it('shows a star for an unofficial rank', async () => {
    const { parseBoard, rankingSummary } = await loadRanking();
    for (const rank of [0, '0', '*'] as const) {
      const summary = rankingSummary(parseBoard(rankOnlyBoard(rank)), UID, false);
      expect(summary, `rank ${String(rank)}`).toEqual({
        rowIndex: 0,
        rank: '*',
        total: 1,
        solved: '1',
        penalty: null,
        score: null,
      });
    }
  });

  it('leaves summary fields null when their columns are missing', async () => {
    const { parseBoard, rankingSummary } = await loadRanking();
    const board = parseBoard({
      rows: [
        [cell('user', '选手'), cell('solved', '通过'), cell('time', '罚时')],
        [cell('user', '张三', { raw: UID }), cell('solved', 3), cell('time', 214)],
      ],
      currentUserId: UID,
    });
    expect(rankingSummary(board, UID, false)).toEqual({
      rowIndex: 0,
      rank: null,
      total: 1,
      solved: '3',
      penalty: '214',
      score: null,
    });
  });

  it('rejects a ranking payload that is not a board', async () => {
    const { parseBoard } = await loadRanking();
    expect(() => parseBoard(null)).toThrow(TypeError);
    expect(() => parseBoard({})).toThrow(TypeError);
    expect(() => parseBoard({ rows: [{ type: 'rank', value: 1 }] })).toThrow(TypeError);
    expect(() => parseBoard({ rows: [[{ value: 1 }]] })).toThrow(TypeError);
    expect(() => parseBoard({
      rows: [[cell('rank', 1)]],
      scoreboardLocked: 'yes',
    })).toThrow(TypeError);
    expect(() => parseBoard({
      rows: [[cell('rank', 1)]],
      studentDict: { 7: { studentId: 2503, realName: '张三' } },
    })).toThrow(TypeError);
  });

  it('matches a student id without caring about case', async () => {
    const { parseBoard, filterRankingRows } = await loadRanking();
    const board = parseBoard({
      rows: [
        [cell('rank', '名次'), cell('user', '选手')],
        [cell('rank', 1), cell('user', '甲', { raw: 8 })],
        [cell('rank', 2), cell('user', '乙', { raw: 9 })],
      ],
      udict: {
        8: { _id: 8, uname: 'jia' },
        9: { _id: 9, uname: 'yi' },
      },
      studentDict: {
        8: { studentId: 'AbC2503x', realName: '甲' },
        9: { studentId: 'ZZ9999', realName: '乙' },
      },
    });
    expect(filterRankingRows(board, 'abc2503')).toEqual([0]);
    expect(filterRankingRows(board, ' ABC2503 ')).toEqual([0]);
  });

  it('keeps a zero solve, penalty, or score instead of starring it', async () => {
    const { parseBoard, rankingSummary } = await loadRanking();
    const board = parseBoard({
      rows: [
        [
          cell('rank', '名次'),
          cell('user', '选手'),
          cell('solved', '通过'),
          cell('time', '罚时'),
          cell('total_score', '总分'),
        ],
        [
          cell('rank', 1),
          cell('user', '张三', { raw: UID }),
          cell('solved', 0),
          cell('time', '0'),
          cell('total_score', 0),
        ],
      ],
      currentUserId: UID,
    });
    expect(rankingSummary(board, UID, false)).toEqual({
      rowIndex: 0,
      rank: '1',
      total: 1,
      solved: '0',
      penalty: '0',
      score: '0',
    });
  });

  it('treats a missing lock flag as unlocked', async () => {
    const { parseBoard } = await loadRanking();
    const board = parseBoard({
      rows: [[cell('rank', '名次')], [cell('rank', 1)]],
    });
    expect(isRecord(board)).toBe(true);
    if (!isRecord(board)) throw new TypeError('board is missing');
    expect(board.locked).toBe(false);
  });

  it('does not filter by penalty text', async () => {
    const { parseBoard, filterRankingRows } = await loadRanking();
    const board = parseBoard(directoryBoard());
    expect(filterRankingRows(board, '30')).toEqual([]);
  });

  it('keeps a complete problem stat and rejects a half one', async () => {
    const { parseBoard } = await loadRanking();
    expect(() => parseBoard({
      rows: [[cell('rank', 1)]],
      pdict: { 1001: { nAccept: 3 } },
    })).toThrow(TypeError);
    const board = parseBoard({
      rows: [[cell('problem', 'A', { raw: 1001 })]],
      pdict: {
        1001: { nAccept: 4, nSubmit: 9 },
        1002: {},
      },
    });
    expect(isRecord(board)).toBe(true);
    if (!isRecord(board)) throw new TypeError('board is missing');
    expect(board.problems).toBeInstanceOf(Map);
    if (!(board.problems instanceof Map)) throw new TypeError('problems');
    expect(board.problems.size).toBe(1);
    expect(board.problems.get('1001')).toEqual({ nAccept: 4, nSubmit: 9 });
    expect(board.problems.has('1002')).toBe(false);
  });

  it('filters a team row by a member student id, name, or username', async () => {
    const { parseBoard, filterRankingRows } = await loadRanking();
    const raw = teamBoard();
    raw.udict = {
      4: { _id: 4, uname: 'ZhouNing' },
      8: { _id: 8, uname: 'ChenSY' },
      9: { _id: 9, uname: 'LinXiao' },
      [UID]: { _id: UID, uname: 'ZhangSan' },
    };
    raw.studentDict = {
      4: { studentId: '240100004', realName: '周宁' },
      8: { studentId: '250340008', realName: '陈思远' },
      9: { studentId: '9001', realName: '林晓' },
      [UID]: { studentId: 'StU2503', realName: '张三' },
    };
    const board = parseBoard(raw);
    expect(filterRankingRows(board, ' stu2503 ')).toEqual([2]);
    expect(filterRankingRows(board, '周宁')).toEqual([1]);
    expect(filterRankingRows(board, 'linxiao')).toEqual([0]);
  });
});

it('renders explicitly published student names and tolerates a ranking with no total or rank columns', async () => {
  const api = await loadRanking();
  const board = api.parseBoard({ rows: [[{ type: 'user', value: '考生' }], [{ type: 'user', value: '张同学', raw: 7 }]], udict: { 7: { uname: 'student7', displayName: '张同学' } } });
  expect(api.filterRankingRows(board, '张同学')).toEqual([0]);
  expect(api.rankingSummary(board, 7, false)).toMatchObject({ rank: null, score: null, solved: null });
});
