// @vitest-environment node
// A static import fails collection while src/pages/course/node-editor/state.ts is absent.
import { beforeAll, describe, expect, it } from 'vitest';
import {
  MAX_INCLUDED,
  moveIntoMutation,
  moveMutation,
  nextProblemIds,
  parseCourseNodeEditorSnapshot as parseSnapshotDirect,
} from '../../src/pages/course/node-editor/state';

const stateLoaders = import.meta.glob('../../src/pages/course/node-editor/state.ts');
const STATE_SOURCE = 'src/pages/course/node-editor/state.ts';

const VERSION = '2026-10-16T00:00:00.000Z';
const MAP_ID = 'map-merged';
const ROOT_ID = 'graph-root';
const COURSE_ID = 'course-programming';
const LOOP_ID = 'node-loop';
const NESTED_ID = 'node-nested';
const ARRAY_ID = 'node-array';
const KID_ID = 'node-kid';
const COURSE_TITLE = '程序设计基础(I)';
const LOOP_DESCRIPTION = '先写循环条件，再写循环体。';

interface ParsedCourseNode {
  id: string;
  title: string;
  order: number;
  visibility: string;
  ownerUids: number[];
}

interface ParsedNode {
  _id: string;
  topic: string;
  parentId: string | null;
  tags: string[];
  problemIds: string[];
  description?: string;
  color?: string;
  order: number;
}

interface ParsedSnapshot {
  canEdit: boolean;
  courseNode: ParsedCourseNode;
  nodes: ParsedNode[];
  referenceCounts: Record<string, number>;
  config: {
    _id: string;
    title: string;
    rootNodeId: string;
    visibility: string;
    layoutDirection: string;
  };
}

let parseCourseNodeEditorSnapshot: (raw: unknown) => ParsedSnapshot = () => {
  throw new Error('parseCourseNodeEditorSnapshot was not loaded');
};

function readField(record: object, key: string): unknown {
  if (!(key in record)) return undefined;
  return Reflect.get(record, key);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function omitKey(record: Record<string, unknown>, key: string): Record<string, unknown> {
  const next: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(record)) {
    if (name !== key) next[name] = value;
  }
  return next;
}

function mindNode(
  id: string,
  parentId: string | null,
  order: number,
  topic: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    _id: id,
    mapId: MAP_ID,
    parentId,
    topic,
    tags: [],
    problemIds: [],
    order,
    createdAt: VERSION,
    updatedAt: VERSION,
    ...extra,
  };
}

function validRaw(canEdit = true): Record<string, unknown> {
  return {
    canEdit,
    courseNode: {
      id: COURSE_ID,
      title: COURSE_TITLE,
      order: 1,
      visibility: 'public',
      ownerUids: [3],
    },
    nodes: [
      mindNode(COURSE_ID, ROOT_ID, 1, COURSE_TITLE, {
        courseVisibility: 'public',
        ownerUids: [3],
      }),
      mindNode(LOOP_ID, COURSE_ID, 1, '循环结构', {
        description: LOOP_DESCRIPTION,
        color: 'sky',
        problemIds: ['11', '12'],
      }),
    ],
    referenceCounts: {
      [COURSE_ID]: 20,
      [LOOP_ID]: 17,
    },
    config: {
      _id: MAP_ID,
      title: '知识图谱',
      rootNodeId: ROOT_ID,
      visibility: 'public',
      layoutDirection: 'RIGHT',
      createdAt: VERSION,
      updatedAt: VERSION,
    },
  };
}

function replaceNode(raw: Record<string, unknown>, index: number, patch: Record<string, unknown>): Record<string, unknown> {
  const nodes = raw.nodes;
  if (!Array.isArray(nodes)) throw new Error('fixture nodes are missing');
  const current = nodes[index];
  if (!isRecord(current)) throw new Error('fixture node is missing');
  const nextNodes = nodes.slice();
  nextNodes[index] = { ...current, ...patch };
  return { ...raw, nodes: nextNodes };
}

async function loadParse(): Promise<(raw: unknown) => ParsedSnapshot> {
  let load: unknown;
  for (const [key, candidate] of Object.entries(stateLoaders)) {
    if (key.endsWith(STATE_SOURCE)) load = candidate;
  }
  expect(typeof load, `${STATE_SOURCE} is missing`).toBe('function');
  if (typeof load !== 'function') throw new TypeError(`${STATE_SOURCE} is missing`);
  const imported: unknown = await load();
  if (!isRecord(imported)) throw new TypeError(`${STATE_SOURCE} must be a module`);
  const parse = readField(imported, 'parseCourseNodeEditorSnapshot');
  expect(typeof parse, 'parseCourseNodeEditorSnapshot').toBe('function');
  if (typeof parse !== 'function') throw new TypeError('parseCourseNodeEditorSnapshot must be a function');
  return (raw: unknown) => {
    const parsed: unknown = parse(raw);
    if (!isRecord(parsed)) throw new TypeError('parseCourseNodeEditorSnapshot must return an object');
    return parsed as unknown as ParsedSnapshot;
  };
}

beforeAll(async () => {
  parseCourseNodeEditorSnapshot = await loadParse();
});

describe('course node editor snapshot', () => {
  it('reads a course subtree snapshot and keeps canEdit', () => {
    const editable = parseCourseNodeEditorSnapshot(validRaw(true));
    expect(editable.canEdit).toBe(true);
    expect(editable.courseNode).toMatchObject({
      id: COURSE_ID,
      title: COURSE_TITLE,
      order: 1,
      visibility: 'public',
      ownerUids: [3],
    });
    expect(editable.config).toMatchObject({
      _id: MAP_ID,
      rootNodeId: ROOT_ID,
      visibility: 'public',
      layoutDirection: 'RIGHT',
    });
    expect(editable.referenceCounts[COURSE_ID]).toBe(20);
    expect(editable.referenceCounts[LOOP_ID]).toBe(17);
    const loop = editable.nodes.find((node) => node._id === LOOP_ID);
    expect(loop).toMatchObject({
      topic: '循环结构',
      parentId: COURSE_ID,
      description: LOOP_DESCRIPTION,
      color: 'sky',
      problemIds: ['11', '12'],
      tags: [],
    });

    const hiddenRaw = validRaw(false);
    const courseNode = hiddenRaw.courseNode;
    if (!isRecord(courseNode)) throw new Error('fixture course node is missing');
    hiddenRaw.courseNode = { ...courseNode, visibility: 'hidden' };
    const readonly = parseCourseNodeEditorSnapshot(hiddenRaw);
    expect(readonly.canEdit).toBe(false);
    expect(readonly.courseNode.visibility).toBe('hidden');
    expect(readonly.nodes.map((node) => node._id)).toEqual([COURSE_ID, LOOP_ID]);
  });

  it('rejects a snapshot whose shape is wrong', () => {
    const parseSnapshot = parseCourseNodeEditorSnapshot;
    const valid = validRaw();
    const cases: unknown[] = [
      null,
      {},
      [],
      omitKey(valid, 'canEdit'),
      { ...valid, canEdit: 'true' },
      { ...valid, canEdit: 1 },
      omitKey(valid, 'courseNode'),
      omitKey(valid, 'nodes'),
      omitKey(valid, 'config'),
      omitKey(valid, 'referenceCounts'),
      { ...valid, nodes: {} },
      { ...valid, config: null },
      { ...valid, referenceCounts: null },
      { ...valid, referenceCounts: [] },
      {
        ...valid,
        referenceCounts: {
          [COURSE_ID]: '20',
          [LOOP_ID]: 17,
        },
      },
      {
        ...valid,
        referenceCounts: {
          [COURSE_ID]: Number.NaN,
          [LOOP_ID]: 17,
        },
      },
      {
        ...valid,
        courseNode: { id: '', title: COURSE_TITLE, order: 1, visibility: 'public', ownerUids: [3] },
      },
      {
        ...valid,
        courseNode: { id: COURSE_ID, title: COURSE_TITLE, order: 1, visibility: 'secret', ownerUids: [3] },
      },
      {
        ...valid,
        courseNode: { id: COURSE_ID, title: COURSE_TITLE, order: 1, visibility: 'public', ownerUids: [0] },
      },
      {
        ...valid,
        courseNode: { id: COURSE_ID, title: COURSE_TITLE, order: 1, visibility: 'public', ownerUids: '3' },
      },
      replaceNode(valid, 1, { topic: '' }),
      replaceNode(valid, 1, { problemIds: [11, 12] }),
      replaceNode(valid, 1, { tags: '循环' }),
      {
        ...valid,
        courseNode: { id: COURSE_ID, title: '', order: 1, visibility: 'public', ownerUids: [3] },
      },
      replaceNode(valid, 0, { parentId: 'not-the-graph-root' }),
    ];
    for (const raw of cases) {
      expect(() => parseSnapshot(raw)).toThrow();
    }
  });
});

describe('course node editor moves and collected problems', () => {
  it('drops a move onto itself, the course node, or a descendant, and appends after the target children', () => {
    const raw = validRaw();
    const nodes = raw.nodes;
    const counts = raw.referenceCounts;
    if (!Array.isArray(nodes) || !isRecord(counts)) throw new Error('fixture tree is missing');
    nodes.push(mindNode(NESTED_ID, LOOP_ID, 1, '循环体'));
    nodes.push(mindNode(ARRAY_ID, COURSE_ID, 2, '一维数组'));
    nodes.push(mindNode(KID_ID, ARRAY_ID, 1, '下标'));
    counts[NESTED_ID] = 0;
    counts[ARRAY_ID] = 1;
    counts[KID_ID] = 0;
    const snapshot = parseSnapshotDirect(raw);

    expect(moveIntoMutation(snapshot, LOOP_ID, LOOP_ID)).toBeNull();
    expect(moveIntoMutation(snapshot, COURSE_ID, ARRAY_ID)).toBeNull();
    expect(moveIntoMutation(snapshot, LOOP_ID, NESTED_ID)).toBeNull();
    expect(moveMutation(snapshot, LOOP_ID, { newParentId: NESTED_ID, targetIndex: 0 })).toBeNull();
    expect(moveIntoMutation(snapshot, LOOP_ID, ARRAY_ID)).toMatchObject({
      operation: 'move',
      body: {
        id: LOOP_ID,
        newParentId: ARRAY_ID,
        targetIndex: 1,
      },
    });
  });

  it('puts a node last among its siblings when dropped onto its current parent', () => {
    const snapshot = parseSnapshotDirect(validRaw());
    expect(moveIntoMutation(snapshot, LOOP_ID, COURSE_ID)).toMatchObject({
      operation: 'move',
      body: {
        id: LOOP_ID,
        newParentId: COURSE_ID,
        targetIndex: 0,
      },
    });
  });

  it('rejects a snapshot that omits one node reference count', () => {
    const raw = validRaw();
    const counts = raw.referenceCounts;
    if (!isRecord(counts)) throw new Error('fixture counts are missing');
    const remaining: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(counts)) {
      if (key !== LOOP_ID) remaining[key] = value;
    }
    raw.referenceCounts = remaining;
    expect(() => parseCourseNodeEditorSnapshot(raw)).toThrow('服务器未返回节点引用状态');
  });

  it('keeps collected problems at the cap and appends a new id while there is room', () => {
    const existing = Array.from({ length: MAX_INCLUDED }, (_, index) => String(index + 1));
    const capped = nextProblemIds(existing, ['extra']);
    expect(capped.overflow).toBe(true);
    expect(capped.ids).toEqual(existing);

    const room = existing.slice(0, MAX_INCLUDED - 1);
    const added = nextProblemIds(room, ['extra', 'extra']);
    expect(added.overflow).toBe(false);
    expect(added.ids).toEqual([...room, 'extra']);
  });
});
