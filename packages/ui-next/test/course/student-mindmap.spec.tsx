import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CourseMindmapView } from '../../src/pages/course/mindmap.tsx';
import type { CourseMindmapData } from '../../src/pages/course/types.ts';

const COURSE_ID = '64b8000000000000000000c1';
const COURSE_NODE_ID = '64b8000000000000000000d1';
const ARRAY_ID = '64b8000000000000000000e1';
const LOOP_ID = '64b8000000000000000000e2';
const COURSE_TITLE = '程序设计基础(I)';
const ARRAY_TITLE = '一维数组';
const LOOP_TITLE = '循环';
const ABSENT_TITLE = '操作系统';

interface StudentMindmapNode {
  id: string;
  parentId: string | null;
  title: string;
  order: number;
  description?: string;
}

interface StudentMindmapProblem {
  domainId: string;
  docId: number;
  pid: string;
  title: string;
  nodeIds: string[];
  chapters: Array<{ id: number; title: string }>;
}

/** Shape returned by courseMindmapForView: no map config, nodes use id and title. */
interface StudentMindmapPayload {
  courseNode: { id: string; title: string; visibility: 'public' | 'hidden' };
  nodes: StudentMindmapNode[];
  problems: StudentMindmapProblem[];
  usedNodeIds: string[];
}

function studentPayload(): StudentMindmapPayload {
  const nodes: StudentMindmapNode[] = [
    { id: ARRAY_ID, parentId: null, title: ARRAY_TITLE, order: 0, description: '下标从 0 开始' },
    { id: LOOP_ID, parentId: null, title: LOOP_TITLE, order: 1 },
  ];
  const problems: StudentMindmapProblem[] = [
    {
      domainId: 'system',
      docId: 12,
      pid: 'P12',
      title: '数组求和题',
      nodeIds: [ARRAY_ID],
      chapters: [{ id: 1, title: '第一章' }],
    },
  ];
  return {
    courseNode: { id: COURSE_NODE_ID, title: COURSE_TITLE, visibility: 'public' },
    nodes,
    problems,
    usedNodeIds: [ARRAY_ID],
  };
}

function renderStudent(payload: StudentMindmapPayload | null): void {
  render(
    <CourseMindmapView
      tid={COURSE_ID}
      data={payload as unknown as CourseMindmapData | null}
      canManage={false}
      integrityControlled={false}
    />,
  );
}

describe('course student mindmap', () => {
  it('renders the nodes from the student mindmap payload', async () => {
    renderStudent(studentPayload());
    expect(await screen.findByText(ARRAY_TITLE)).toBeInTheDocument();
    expect(screen.getByText(LOOP_TITLE)).toBeInTheDocument();
    expect(screen.queryByText(ABSENT_TITLE)).toBeNull();
  });

  it('renders no payload nodes when the course mindmap is absent', () => {
    renderStudent(null);
    expect(screen.queryByText(ARRAY_TITLE)).toBeNull();
    expect(screen.queryByText(LOOP_TITLE)).toBeNull();
  });
});
