import { type ComponentProps } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import {
  StructuredProblemMetadataPanel,
  type KnowledgeMapOption,
  type KnowledgeMindmapOption,
} from '../../src/components/structured-problem-metadata-panel';
import { ObjectiveSheet } from '../../src/pages/teach/compose/objective-sheet';

const KNOWLEDGE_HINT = '选择这道题属于的知识点。';
const TRANSITIONAL_HINT = '过渡期只能选公开导图的知识点。';
const MAP_PICKER = '所属知识导图';
const CHOOSE_MAP = '请选择所属导图';
const KNOWLEDGE_PLACEHOLDER = '从知识导图选择，可多选';
const HIDDEN_PATH = '程序设计基础(I) / 六、数组 / 一维数组';
const PUBLIC_PATH = '操作系统 / 进程';
const DECOY_PATH = '面向对象程序设计 / 类';

const GRAPH: KnowledgeMapOption = { id: 'map-graph', title: '知识图谱', visibility: 'public' };
const OTHER: KnowledgeMapOption = { id: 'map-other', title: '另一张图', visibility: 'public' };

const HIDDEN_NODE = { id: 'node-array', mapId: GRAPH.id, label: HIDDEN_PATH };
const PUBLIC_NODE = { id: 'node-process', mapId: GRAPH.id, label: PUBLIC_PATH };

type SheetProps = ComponentProps<typeof ObjectiveSheet>;

function mindmapOption(id: string, map: KnowledgeMapOption, label: string): KnowledgeMindmapOption {
  return {
    id,
    mapId: map.id,
    mapTitle: map.title,
    label,
    tags: [],
  };
}

function sheetProps(overrides: Partial<SheetProps> = {}): SheetProps {
  return {
    open: true,
    type: 'exam',
    initialKind: 'single',
    defaultScore: () => 3,
    knowledgeOptions: [PUBLIC_NODE, HIDDEN_NODE],
    defaultNodeId: HIDDEN_NODE.id,
    onCreated: () => {},
    onOpenChange: () => {},
    ...overrides,
  };
}

function findLabel(name: string): HTMLLabelElement {
  const found = [...document.querySelectorAll('label')].find((label) => {
    return (label.textContent ?? '').replace(/\*/g, '').replace(/\s+/g, '') === name;
  });
  if (!(found instanceof HTMLLabelElement)) throw new TypeError(`missing label ${name}`);
  return found;
}

function knowledgeControl(): HTMLElement {
  const id = findLabel('知识点').getAttribute('for');
  if (!id) throw new TypeError('missing knowledge field');
  const control = document.getElementById(id);
  if (!(control instanceof HTMLElement)) throw new TypeError('missing knowledge control');
  return control;
}

function knowledgeMapInput(): HTMLInputElement {
  const field = document.querySelector('input[name="knowledgeMapId"]');
  if (!(field instanceof HTMLInputElement)) throw new TypeError('missing knowledgeMapId');
  return field;
}

function optionPattern(label: string): RegExp {
  return new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
}

function renderPanel(maps: KnowledgeMapOption[], options: KnowledgeMindmapOption[]) {
  return render(
    <StructuredProblemMetadataPanel
      pdoc={{ title: '数组题' }}
      isCreate
      locked={false}
      knowledgeMaps={maps}
      mindmapOptions={options}
      canUseCustomPid={false}
      formDirty={false}
      onMetadataChange={() => {}}
    />,
  );
}

describe('merged knowledge pickers', () => {
  it('selects a knowledge point under a hidden course node', () => {
    render(<ObjectiveSheet {...sheetProps()} />);

    expect(knowledgeControl().textContent ?? '').toContain(HIDDEN_PATH);
    expect(document.body.textContent ?? '').toContain(`挂到知识点「${HIDDEN_PATH}」`);
    expect(screen.getByText(KNOWLEDGE_HINT)).toBeInTheDocument();
    expect(screen.queryByText(TRANSITIONAL_HINT)).toBeNull();
  });

  it('hides the map picker and shows course-node paths when one map remains', async () => {
    const user = userEvent.setup();
    const hidden = mindmapOption(HIDDEN_NODE.id, GRAPH, HIDDEN_PATH);
    const published = mindmapOption(PUBLIC_NODE.id, GRAPH, PUBLIC_PATH);
    const decoy = mindmapOption('node-class', OTHER, DECOY_PATH);
    renderPanel([GRAPH], [published, hidden, decoy]);

    await user.click(screen.getByPlaceholderText(KNOWLEDGE_PLACEHOLDER));

    const hiddenOption = screen.getByRole('button', { name: optionPattern(HIDDEN_PATH) });
    const publicOption = screen.getByRole('button', { name: optionPattern(PUBLIC_PATH) });
    expect(hiddenOption.textContent ?? '').toContain(HIDDEN_PATH);
    expect(hiddenOption.textContent ?? '').not.toContain(`知识图谱 / ${HIDDEN_PATH}`);
    expect(publicOption.textContent ?? '').toContain(PUBLIC_PATH);
    expect(publicOption.textContent ?? '').not.toContain(`知识图谱 / ${PUBLIC_PATH}`);
    expect(screen.queryByRole('button', { name: optionPattern(DECOY_PATH) })).toBeNull();
    expect(knowledgeMapInput().value).toBe(GRAPH.id);
    expect(screen.queryByRole('combobox', { name: MAP_PICKER })).toBeNull();
    expect(screen.queryByText(CHOOSE_MAP)).toBeNull();
  });

  it('keeps the map picker when more than one map is available', () => {
    renderPanel(
      [GRAPH, OTHER],
      [
        mindmapOption(HIDDEN_NODE.id, GRAPH, HIDDEN_PATH),
        mindmapOption('node-class', OTHER, DECOY_PATH),
      ],
    );

    const picker = screen.getByRole('combobox', { name: MAP_PICKER });
    expect(picker.textContent ?? '').toContain(CHOOSE_MAP);
  });
});
