import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { useEffect, type ComponentProps } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReactFlowProvider, useReactFlow, type Node as FlowNode, type ReactFlowProps } from '@xyflow/react';
import { MindmapCanvas } from '../../src/pages/mindmap/canvas.tsx';
import type { MindmapConfig, MindmapNode } from '../../src/pages/mindmap/types.ts';

const VERSION = '2026-10-21T06:32:00.000Z';
const TOPIC: Record<string, string> = {
  root: '知识图谱',
  n1: '循环结构',
  n2: '数组',
  'n2-child': '一维数组',
  'n2-leaf': '下标',
  n3: '函数',
};

const captured = vi.hoisted(() => ({
  onNodeDragStop: null as ReactFlowProps['onNodeDragStop'] | null,
  onNodesChange: null as ReactFlowProps['onNodesChange'] | null,
  intersections: [] as FlowNode[],
  intersectionReads: 0,
  fitViewOptions: null as ReactFlowProps['fitViewOptions'] | null,
  fitViewCalls: [] as Array<{ maxZoom?: number } | undefined>,
}));

vi.mock('@xyflow/react', async () => {
  const actual = await vi.importActual<typeof import('@xyflow/react')>('@xyflow/react');
  return {
    ...actual,
    ReactFlow: (props: ReactFlowProps) => {
      captured.onNodeDragStop = props.onNodeDragStop ?? null;
      captured.onNodesChange = props.onNodesChange ?? null;
      captured.fitViewOptions = props.fitViewOptions ?? null;
      return <actual.ReactFlow {...props} />;
    },
    useReactFlow: () => {
      const flow = actual.useReactFlow();
      return {
        ...flow,
        fitView: (options?: { maxZoom?: number }) => {
          captured.fitViewCalls.push(options);
          return flow.fitView(options);
        },
        getIntersectingNodes: () => {
          captured.intersectionReads += 1;
          return captured.intersections;
        },
      };
    },
  };
});

/** Read through a call so a reset to null between renders does not narrow the captured options away. */
function fitOptionsMaxZoom(): number | undefined {
  return captured.fitViewOptions?.maxZoom;
}

function FlowStoreProbe({ bucket }: { bucket: { getNodes: (() => FlowNode[]) | null } }) {
  const { getNodes } = useReactFlow();
  useEffect(() => {
    bucket.getNodes = getNodes;
  }, [bucket, getNodes]);
  return null;
}

function makeNode(id: string, parentId: string | null, order: number): MindmapNode {
  const topic = TOPIC[id];
  if (!topic) throw new Error(`missing topic for ${id}`);
  return {
    _id: id,
    mapId: 'map-1',
    parentId,
    topic,
    tags: [],
    problemIds: [],
    order,
    createdAt: VERSION,
    updatedAt: VERSION,
  };
}

function sampleNodes(): MindmapNode[] {
  return [
    makeNode('root', null, 0),
    makeNode('n1', 'root', 1),
    makeNode('n2', 'root', 2),
    makeNode('n2-child', 'n2', 1),
    makeNode('n2-leaf', 'n2-child', 1),
    makeNode('n3', 'root', 3),
  ];
}

function sampleConfig(): MindmapConfig {
  return {
    _id: 'map-1',
    title: '知识图谱',
    rootNodeId: 'root',
    visibility: 'public',
    layoutDirection: 'RIGHT',
    createdAt: VERSION,
    updatedAt: VERSION,
  };
}

function renderCanvas(extra: Record<string, unknown> = {}, selectedId: string | null = null) {
  const onSelect = vi.fn();
  const props: ComponentProps<typeof MindmapCanvas> = {
    nodes: sampleNodes(),
    config: sampleConfig(),
    selectedId,
    onSelect,
    collapsed: new Set<string>(),
  };
  Object.assign(props, extra);
  const view = render(
    <ReactFlowProvider>
      <div style={{ width: 960, height: 640 }}>
        <MindmapCanvas {...props} />
      </div>
    </ReactFlowProvider>,
  );
  return { ...view, onSelect };
}

function canvasElement(): HTMLElement {
  const flow = document.querySelector('.react-flow');
  if (!(flow instanceof HTMLElement)) throw new Error('canvas is missing');
  return flow;
}

function nodeById(id: string): HTMLElement {
  const node = canvasElement().querySelector(`.react-flow__node[data-id="${id}"]`);
  if (!(node instanceof HTMLElement)) throw new Error(`canvas node missing: ${id}`);
  return node;
}

function renameInput(id: string): HTMLInputElement | null {
  const input = nodeById(id).querySelector('input');
  return input instanceof HTMLInputElement ? input : null;
}

function requireRenameInput(id: string): HTMLInputElement {
  const input = renameInput(id);
  expect(input).toBeInstanceOf(HTMLInputElement);
  if (!(input instanceof HTMLInputElement)) throw new Error(`rename field is missing on ${id}`);
  return input;
}

function press(target: HTMLElement, key: string): boolean {
  return fireEvent.keyDown(target, { key, code: key });
}

function focusCanvas(): HTMLElement {
  const flow = canvasElement();
  const host = flow.parentElement instanceof HTMLElement ? flow.parentElement : flow;
  for (const candidate of [host, flow]) {
    candidate.focus();
    if (document.activeElement === candidate) return candidate;
  }
  expect(document.activeElement).toBe(flow);
  return flow;
}

function flowNodeStub(id: string): FlowNode {
  return {
    id,
    type: 'mindmap',
    position: { x: 0, y: 0 },
    data: { topic: TOPIC[id] ?? id },
    width: 160,
    height: 44,
    measured: { width: 160, height: 44 },
  };
}

async function shown(): Promise<void> {
  await waitFor(() => {
    expect(nodeById('n1').textContent).toContain(TOPIC.n1);
    expect(nodeById('n2').textContent).toContain(TOPIC.n2);
    expect(nodeById('n3').textContent).toContain(TOPIC.n3);
  });
}

async function stopDrag(id: string, x: number, y: number): Promise<void> {
  const stop = captured.onNodeDragStop;
  expect(typeof stop).toBe('function');
  if (typeof stop !== 'function') return;
  const node = flowNodeStub(id);
  node.position = { x, y };
  await act(async () => {
    stop(new MouseEvent('mouseup') as never, node, [node]);
  });
}

async function displace(id: string, x: number, y: number): Promise<void> {
  const change = captured.onNodesChange;
  expect(typeof change).toBe('function');
  if (typeof change !== 'function') return;
  await act(async () => {
    change([
      {
        id,
        type: 'position',
        position: { x, y },
        dragging: true,
      },
    ]);
  });
}

afterEach(() => {
  captured.onNodeDragStop = null;
  captured.onNodesChange = null;
  captured.intersections = [];
  captured.intersectionReads = 0;
  captured.fitViewOptions = null;
  captured.fitViewCalls = [];
});

describe('mindmap canvas editing', () => {
  it('stays read-only when editable is omitted', async () => {
    const onRenameStart = vi.fn();
    const onRenameCommit = vi.fn();
    const onRenameCancel = vi.fn();
    const onKeyCommand = vi.fn();
    const onMoveInto = vi.fn();
    renderCanvas({ onRenameStart, onRenameCommit, onRenameCancel, onKeyCommand, onMoveInto });
    await shown();

    expect(nodeById('n1').classList.contains('draggable')).toBe(false);
    expect(nodeById('n2').classList.contains('draggable')).toBe(false);
    fireEvent.doubleClick(nodeById('n2'));
    expect(renameInput('n1')).toBeNull();
    expect(renameInput('n2')).toBeNull();
    expect(onRenameStart).not.toHaveBeenCalled();
    press(canvasElement(), 'Tab');
    press(canvasElement(), 'Enter');
    press(canvasElement(), 'Delete');
    press(canvasElement(), 'Backspace');
    expect(onKeyCommand).not.toHaveBeenCalled();
    expect(onRenameCommit).not.toHaveBeenCalled();
    expect(onRenameCancel).not.toHaveBeenCalled();
    expect(onMoveInto).not.toHaveBeenCalled();
  });

  it('stays read-only when editable is false', async () => {
    const onRenameStart = vi.fn();
    const onKeyCommand = vi.fn();
    renderCanvas({
      editable: false,
      renamingId: 'n1',
      onRenameStart,
      onKeyCommand,
      counts: { n1: 12 },
    });
    await shown();

    expect(nodeById('n1').classList.contains('draggable')).toBe(false);
    expect(renameInput('n1')).toBeNull();
    fireEvent.doubleClick(nodeById('n2'));
    expect(onRenameStart).not.toHaveBeenCalled();
    press(canvasElement(), 'Tab');
    expect(onKeyCommand).not.toHaveBeenCalled();
    expect(nodeById('n1').textContent).toContain('12');
  });

  it('shows the current title in a focused rename field and commits enter', async () => {
    const onRenameCommit = vi.fn();
    const onRenameCancel = vi.fn();
    const onKeyCommand = vi.fn();
    renderCanvas({
      editable: true,
      renamingId: 'n1',
      onRenameCommit,
      onRenameCancel,
      onKeyCommand,
    });
    await shown();

    const input = await waitFor(() => {
      const field = requireRenameInput('n1');
      expect(field.value).toBe(TOPIC.n1);
      expect(document.activeElement).toBe(field);
      expect(field.selectionStart).toBe(0);
      expect(field.selectionEnd).toBe(field.value.length);
      return field;
    });
    expect(renameInput('n2')).toBeNull();

    fireEvent.change(input, { target: { value: '新名' } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
    expect(onRenameCommit).toHaveBeenCalledTimes(1);
    expect(onRenameCommit).toHaveBeenCalledWith('n1', '新名');
    expect(onRenameCancel).not.toHaveBeenCalled();
    expect(onKeyCommand).not.toHaveBeenCalled();
  });

  it('cancels rename on escape', async () => {
    const onRenameCommit = vi.fn();
    const onRenameCancel = vi.fn();
    renderCanvas({ editable: true, renamingId: 'n1', onRenameCommit, onRenameCancel });
    await shown();
    const input = requireRenameInput('n1');
    input.focus();
    fireEvent.change(input, { target: { value: '临时' } });
    fireEvent.keyDown(input, { key: 'Escape', code: 'Escape' });
    expect(onRenameCancel).toHaveBeenCalledTimes(1);
    expect(onRenameCommit).not.toHaveBeenCalled();
  });

  it.each(['', '   '])('cancels a blank title %j on enter', async (title) => {
    const onRenameCommit = vi.fn();
    const onRenameCancel = vi.fn();
    renderCanvas({ editable: true, renamingId: 'n1', onRenameCommit, onRenameCancel });
    await shown();
    const input = requireRenameInput('n1');
    fireEvent.change(input, { target: { value: title } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
    expect(onRenameCancel).toHaveBeenCalledTimes(1);
    expect(onRenameCommit).not.toHaveBeenCalled();
  });

  it('cancels rename when the field blurs', async () => {
    const onRenameCommit = vi.fn();
    const onRenameCancel = vi.fn();
    renderCanvas({ editable: true, renamingId: 'n1', onRenameCommit, onRenameCancel });
    await shown();
    const input = requireRenameInput('n1');
    fireEvent.change(input, { target: { value: '未提交' } });
    fireEvent.blur(input);
    expect(onRenameCancel).toHaveBeenCalledTimes(1);
    expect(onRenameCommit).not.toHaveBeenCalled();
  });

  it('starts rename when a node is double-clicked', async () => {
    const onRenameStart = vi.fn();
    renderCanvas({ editable: true, onRenameStart });
    await shown();
    fireEvent.doubleClick(nodeById('n2'));
    expect(onRenameStart).toHaveBeenCalledTimes(1);
    expect(onRenameStart).toHaveBeenCalledWith('n2');
    expect(renameInput('n2')).toBeNull();
  });

  it('runs child, sibling, and delete commands from the focused canvas', async () => {
    const onKeyCommand = vi.fn();
    renderCanvas({ editable: true, onKeyCommand }, 'n1');
    await shown();
    const canvas = focusCanvas();

    expect(press(canvas, 'Tab')).toBe(false);
    expect(onKeyCommand).toHaveBeenLastCalledWith('child', 'n1');
    expect(press(canvas, 'Enter')).toBe(false);
    expect(onKeyCommand).toHaveBeenLastCalledWith('sibling', 'n1');
    expect(press(canvas, 'Delete')).toBe(false);
    expect(onKeyCommand).toHaveBeenLastCalledWith('delete', 'n1');
    expect(press(canvas, 'Backspace')).toBe(false);
    expect(onKeyCommand).toHaveBeenLastCalledWith('delete', 'n1');
    expect(onKeyCommand).toHaveBeenCalledTimes(4);
    expect(nodeById('n1').isConnected).toBe(true);
  });

  it('ignores keyboard commands when the canvas is not focused', async () => {
    const onKeyCommand = vi.fn();
    renderCanvas({ editable: true, onKeyCommand }, 'n1');
    await shown();
    const outside = document.createElement('button');
    document.body.append(outside);
    try {
      outside.focus();
      press(outside, 'Tab');
      press(outside, 'Enter');
      press(outside, 'Delete');
      press(outside, 'Backspace');
      expect(onKeyCommand).not.toHaveBeenCalled();
    } finally {
      outside.remove();
    }
  });

  it('ignores keyboard commands when no node is selected', async () => {
    const onKeyCommand = vi.fn();
    renderCanvas({ editable: true, onKeyCommand }, null);
    await shown();
    const canvas = focusCanvas();
    press(canvas, 'Tab');
    press(canvas, 'Enter');
    press(canvas, 'Delete');
    expect(onKeyCommand).not.toHaveBeenCalled();
  });

  it('keeps a selected node on its layout position when arrow right is pressed', async () => {
    const onMoveInto = vi.fn();
    renderCanvas({ editable: true, onMoveInto }, 'n2');
    await shown();
    const node = nodeById('n2');
    fireEvent.click(node);
    node.focus();
    expect(document.activeElement).toBe(node);
    expect(node.classList.contains('draggable')).toBe(true);
    const before = node.style.transform;
    expect(before).not.toBe('');
    press(node, 'ArrowRight');
    expect(onMoveInto).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(nodeById('n2').style.transform).toBe(before);
    });
  });

  it('keeps measured size when a position change follows a dimensions change', async () => {
    const bucket: { getNodes: (() => FlowNode[]) | null } = { getNodes: null };
    const onSelect = vi.fn();
    const props: ComponentProps<typeof MindmapCanvas> = {
      nodes: sampleNodes(),
      config: sampleConfig(),
      selectedId: null,
      onSelect,
      collapsed: new Set<string>(),
    };
    Object.assign(props, { editable: true });
    render(
      <ReactFlowProvider>
        <FlowStoreProbe bucket={bucket} />
        <div style={{ width: 960, height: 640 }}>
          <MindmapCanvas {...props} />
        </div>
      </ReactFlowProvider>,
    );
    await shown();
    const read = bucket.getNodes;
    expect(typeof read).toBe('function');
    if (typeof read !== 'function') return;
    const before = read().find((item) => item.id === 'n2');
    expect(before?.position).not.toEqual({ x: 640, y: 80 });

    const change = captured.onNodesChange;
    expect(typeof change).toBe('function');
    if (typeof change !== 'function') return;
    await act(async () => {
      change([{ id: 'n2', type: 'dimensions', dimensions: { width: 160, height: 44 } }]);
    });
    await act(async () => {
      change([{ id: 'n2', type: 'position', position: { x: 640, y: 80 }, dragging: true }]);
    });
    await waitFor(() => {
      const node = read().find((item) => item.id === 'n2');
      expect(node?.measured?.width).toBe(160);
      expect(node?.position).toEqual({ x: 640, y: 80 });
    });
  });

  it('moves a node onto another node but not onto a descendant or empty space', async () => {
    const onMoveInto = vi.fn();
    renderCanvas({ editable: true, onMoveInto });
    await shown();
    expect(nodeById('n2').classList.contains('draggable')).toBe(true);

    captured.intersections = [flowNodeStub('n3')];
    captured.intersectionReads = 0;
    await stopDrag('n2', 640, 80);
    expect(captured.intersectionReads).toBeGreaterThan(0);
    expect(onMoveInto).toHaveBeenCalledTimes(1);
    expect(onMoveInto).toHaveBeenCalledWith('n2', 'n3');

    for (const targetId of ['n2-child', 'n2-leaf']) {
      onMoveInto.mockClear();
      const before = nodeById('n2').style.transform;
      captured.intersections = [flowNodeStub(targetId)];
      captured.intersectionReads = 0;
      await stopDrag('n2', 720, 120);
      expect(captured.intersectionReads).toBeGreaterThan(0);
      expect(onMoveInto).not.toHaveBeenCalled();
      await waitFor(() => {
        expect(nodeById('n2').style.transform).toBe(before);
        expect(nodeById('n2').style.transform).not.toContain('720px');
      });
    }

    onMoveInto.mockClear();
    const before = nodeById('n2').style.transform;
    captured.intersections = [];
    captured.intersectionReads = 0;
    await stopDrag('n2', 800, 160);
    expect(captured.intersectionReads).toBeGreaterThan(0);
    expect(onMoveInto).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(nodeById('n2').style.transform).toBe(before);
      expect(nodeById('n2').style.transform).not.toContain('800px');
    });
  });

  it('caps the fit-to-window zoom only when fitMaxZoom is given', async () => {
    renderCanvas({ fitMaxZoom: 1 });
    await shown();
    expect(fitOptionsMaxZoom()).toBe(1);
    await waitFor(() => {
      expect(captured.fitViewCalls.length).toBeGreaterThan(0);
    }, { timeout: 15000 });
    for (const call of captured.fitViewCalls) expect(call?.maxZoom).toBe(1);

    cleanup();
    captured.fitViewOptions = null;
    captured.fitViewCalls = [];
    renderCanvas();
    await shown();
    expect(fitOptionsMaxZoom()).toBeUndefined();
    await waitFor(() => {
      expect(captured.fitViewCalls.length).toBeGreaterThan(0);
    }, { timeout: 15000 });
    for (const call of captured.fitViewCalls) expect(call?.maxZoom).toBeUndefined();
  }, 20000);

  it('shows a problem count after the node name', async () => {
    renderCanvas({ counts: { n1: 12 } });
    await shown();
    const node = nodeById('n1');
    const text = node.textContent ?? '';
    expect(text.indexOf('12')).toBeGreaterThan(text.indexOf(TOPIC.n1));
    const count = [...node.querySelectorAll('*')].find(
      (element) => element instanceof HTMLElement && element.childElementCount === 0 && element.textContent?.trim() === '12',
    );
    expect(count).toBeInstanceOf(HTMLElement);
    if (!(count instanceof HTMLElement)) return;
    expect(count).toHaveClass('tabular');
    expect(nodeById('n2').textContent ?? '').not.toContain('12');
    expect(nodeById('n3').textContent ?? '').not.toContain('12');
  });

  it('shows a zero problem count after the node name', async () => {
    renderCanvas({ counts: { n1: 0, n2: 4 } });
    await shown();
    const node = nodeById('n1');
    const text = node.textContent ?? '';
    expect(text.indexOf('0')).toBeGreaterThan(text.indexOf(TOPIC.n1));
    const count = [...node.querySelectorAll('*')].find(
      (element) => element instanceof HTMLElement && element.childElementCount === 0 && element.textContent?.trim() === '0',
    );
    expect(count).toBeInstanceOf(HTMLElement);
    if (!(count instanceof HTMLElement)) return;
    expect(count).toHaveClass('tabular');
    expect(nodeById('n2').textContent ?? '').toContain('4');
    expect(nodeById('n3').textContent ?? '').not.toContain('0');
  });

  it('shows the rename field when renamingId is set after layout', async () => {
    const nodes = sampleNodes();
    const config = sampleConfig();
    const collapsed = new Set<string>();
    const onSelect = vi.fn();
    const onRenameCommit = vi.fn();
    const onRenameCancel = vi.fn();
    function tree(renamingId: string | null) {
      return (
        <ReactFlowProvider>
          <div style={{ width: 960, height: 640 }}>
            <MindmapCanvas
              nodes={nodes}
              config={config}
              selectedId="n2"
              onSelect={onSelect}
              collapsed={collapsed}
              editable
              renamingId={renamingId}
              onRenameCommit={onRenameCommit}
              onRenameCancel={onRenameCancel}
            />
          </div>
        </ReactFlowProvider>
      );
    }
    const view = render(tree(null));
    await shown();
    expect(renameInput('n2')).toBeNull();
    view.rerender(tree('n2'));
    const input = await waitFor(() => {
      const field = requireRenameInput('n2');
      expect(field.value).toBe(TOPIC.n2);
      return field;
    });
    expect(document.activeElement).toBe(input);
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(input.value.length);
    expect(renameInput('n1')).toBeNull();
  });

  it('ignores canvas commands while the rename field is focused', async () => {
    const onKeyCommand = vi.fn();
    const onRenameCommit = vi.fn();
    const onRenameCancel = vi.fn();
    renderCanvas(
      {
        editable: true,
        renamingId: 'n1',
        onKeyCommand,
        onRenameCommit,
        onRenameCancel,
      },
      'n1',
    );
    await shown();
    const input = requireRenameInput('n1');
    input.focus();
    const host = canvasElement().parentElement;
    if (!(host instanceof HTMLElement)) throw new Error('canvas host is missing');
    expect(document.activeElement).toBe(input);
    expect(host.contains(input)).toBe(true);
    fireEvent.keyDown(host, { key: 'Tab', code: 'Tab' });
    fireEvent.keyDown(host, { key: 'Enter', code: 'Enter' });
    fireEvent.keyDown(host, { key: 'Delete', code: 'Delete' });
    fireEvent.keyDown(host, { key: 'Backspace', code: 'Backspace' });
    expect(onKeyCommand).not.toHaveBeenCalled();
    expect(onRenameCommit).not.toHaveBeenCalled();
    expect(onRenameCancel).not.toHaveBeenCalled();
  });

  it('does not reparent when editing is off', async () => {
    const onMoveInto = vi.fn();
    renderCanvas({ editable: false, onMoveInto });
    await shown();
    captured.intersections = [flowNodeStub('n3')];
    captured.intersectionReads = 0;
    await stopDrag('n2', 640, 80);
    expect(captured.intersectionReads).toBe(0);
    expect(onMoveInto).not.toHaveBeenCalled();
  });

  it('does not drop a node onto itself', async () => {
    const onMoveInto = vi.fn();
    renderCanvas({ editable: true, onMoveInto });
    await shown();

    captured.intersections = [flowNodeStub('n2')];
    await stopDrag('n2', 640, 80);
    expect(onMoveInto).not.toHaveBeenCalled();

    captured.intersections = [flowNodeStub('n2'), flowNodeStub('n3')];
    await stopDrag('n2', 640, 80);
    expect(onMoveInto).toHaveBeenCalledTimes(1);
    expect(onMoveInto).toHaveBeenCalledWith('n2', 'n3');
  });

  it('moves a node onto its ancestor', async () => {
    const onMoveInto = vi.fn();
    renderCanvas({ editable: true, onMoveInto });
    await shown();
    captured.intersections = [flowNodeStub('root')];
    await stopDrag('n2', 480, 40);
    expect(onMoveInto).toHaveBeenCalledTimes(1);
    expect(onMoveInto).toHaveBeenCalledWith('n2', 'root');
  });

  it('snaps a node back when it is dropped on empty space', async () => {
    const onMoveInto = vi.fn();
    renderCanvas({ editable: true, onMoveInto });
    await shown();
    const before = nodeById('n2').style.transform;
    expect(before).not.toBe('');
    await displace('n2', 4000, 3200);
    await waitFor(() => {
      expect(nodeById('n2').style.transform).toContain('4000px');
    });
    captured.intersections = [];
    await stopDrag('n2', 4000, 3200);
    expect(onMoveInto).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(nodeById('n2').style.transform).toBe(before);
      expect(nodeById('n2').style.transform).not.toContain('4000px');
    });
  });
});
