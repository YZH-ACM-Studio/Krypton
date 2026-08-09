import { fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { type ProgrammingStatementCanonical, ProgrammingStatementEditor } from '../src/components/programming-statement';
import type { AntiAiMarkerDraft } from '../src/lib/anti-ai-marker';

const initialStatement: ProgrammingStatementCanonical = {
  schemaVersion: 1,
  locale: 'zh-CN',
  background: { state: 'absent', content: '' },
  description: { state: 'present', content: '题目描述' },
  input: { state: 'absent', content: '' },
  output: { state: 'absent', content: '' },
  examples: {
    state: 'present',
    items: [
      { input: '1', inputEmpty: false, output: '2', outputEmpty: false, note: '第一说明' },
      { input: '3', inputEmpty: false, output: '4', outputEmpty: false, note: '第二说明' },
    ],
  },
  hints: { state: 'absent', content: '' },
};

const sampleMarker: AntiAiMarkerDraft = {
  id: 'marker_0001',
  anchor: { path: 'programmingStatement.examples.0.note', offset: 2, affinity: 'after' },
  injectionText: '隐藏提示',
  revision: 1,
};

function Harness({ withMarker = false }: { withMarker?: boolean }) {
  const [statement, setStatement] = useState(initialStatement);
  const [markers, setMarkers] = useState<AntiAiMarkerDraft[]>(withMarker ? [sampleMarker] : []);
  return (
    <>
      <ProgrammingStatementEditor
        value={statement}
        onChange={setStatement}
        problemUrl="/p/P1"
        antiAiMarkers={markers}
        onAntiAiMarkersChange={setMarkers}
      />
      <output aria-label="statement-state">{JSON.stringify(statement.examples.items)}</output>
      <output aria-label="marker-state">{JSON.stringify(markers)}</output>
    </>
  );
}

function EmptyBackgroundMarkerHarness() {
  const [statement, setStatement] = useState<ProgrammingStatementCanonical>({
    ...initialStatement,
    background: { state: 'present', content: '' },
  });
  const [markers, setMarkers] = useState<AntiAiMarkerDraft[]>([
    {
      id: 'marker_empty_background',
      anchor: { path: 'programmingStatement.background', offset: 0, affinity: 'after' },
      injectionText: '隐藏提示',
      revision: 1,
    },
  ]);
  return (
    <>
      <ProgrammingStatementEditor
        value={statement}
        onChange={setStatement}
        problemUrl="/p/P1"
        antiAiMarkers={markers}
        onAntiAiMarkersChange={setMarkers}
      />
      <output aria-label="background-state">{JSON.stringify(statement.background)}</output>
      <output aria-label="empty-background-marker-state">{JSON.stringify(markers)}</output>
    </>
  );
}

function noteEditor(sample: number): HTMLTextAreaElement {
  const article = screen.getByText(`样例 ${sample}`).closest('article');
  if (!article) throw new Error(`sample ${sample} article missing`);
  return within(article).getByPlaceholderText(/在此输入 Markdown 内容/) as HTMLTextAreaElement;
}

describe('structured statement anti-AI marker authoring', () => {
  it('keeps sample notes and marker paths aligned after reorder and a subsequent edit', () => {
    render(<Harness withMarker />);

    fireEvent.click(screen.getByRole('button', { name: '下移样例 1' }));

    expect(noteEditor(1)).toHaveValue('第二说明');
    expect(noteEditor(2)).toHaveValue('第一说明');
    expect(screen.getByLabelText('marker-state')).toHaveTextContent('programmingStatement.examples.1.note');
    fireEvent.change(noteEditor(1), { target: { value: '第二说明已修改' } });
    expect(screen.getByLabelText('statement-state')).toHaveTextContent('第二说明已修改');
    expect(screen.getByLabelText('statement-state')).toHaveTextContent('第一说明');
  });

  it('synchronizes the reused first note editor after deleting the first sample', () => {
    render(<Harness />);

    fireEvent.click(screen.getByRole('button', { name: '删除样例 1' }));

    expect(noteEditor(1)).toHaveValue('第二说明');
    fireEvent.change(noteEditor(1), { target: { value: '保留下来的说明' } });
    expect(screen.getByLabelText('statement-state')).toHaveTextContent('保留下来的说明');
    expect(screen.getByLabelText('statement-state')).not.toHaveTextContent('第一说明');
  });

  it('requires confirmation and removes a marker when an empty present section becomes absent', () => {
    render(<EmptyBackgroundMarkerHarness />);

    const background = screen.getByText('题目背景').closest('section');
    if (!background) throw new Error('background section missing');
    fireEvent.click(within(background).getByRole('combobox'));
    fireEvent.click(screen.getByRole('option', { name: '明确没有' }));

    expect(screen.getByRole('heading', { name: '确认清空区块' })).toBeInTheDocument();
    expect(screen.getByText(/当前内容和防 AI 标记/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '清空并标记为无' }));
    expect(screen.getByLabelText('background-state')).toHaveTextContent('"state":"absent"');
    expect(screen.getByLabelText('empty-background-marker-state')).toHaveTextContent('[]');
  });
});
