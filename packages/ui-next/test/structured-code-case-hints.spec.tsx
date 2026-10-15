import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FunctionProblemEditorPage } from '../src/pages/structured-code-editors';

const fixture = vi.hoisted(() => ({ locked: false }));
vi.mock('../src/lib/bootstrap', () => ({
  useBootstrap: () => ({
    urls: { problems: '/p' },
    page: {
      data: {
        page_name: 'problem_edit_function',
        pdoc: {
          docId: 7,
          title: '旅客人数',
          content: '返回旅客人数。',
          structureRevision: 3,
          structureLockedAt: fixture.locked ? '2026-10-15' : undefined,
          codeEvaluationStatus: 'ready',
        },
        structuredConfig: {
          main: {
            mode: 'function',
            lang: 'c',
            source: 'int solve() {\n  return 1;\n}',
            publicRanges: [],
            regions: [{ id: 'r_abcdefghijkl', startLine: 0, endLine: 3 }],
            cases: [
              { input: '1.in', output: '1.out', hint: '检查零值。', hintPublic: true },
              { input: '2.in', output: '2.out', hint: '检查上限。', hintPublic: false },
            ],
          },
        },
        testdata: ['1.in', '1.out', '2.in', '2.out'].map((name) => ({ name })),
        langRange: { c: 'C' },
      },
    },
  }),
}));
vi.mock('../src/components/markdown-renderer', () => ({ MarkdownEditor: () => null }));
vi.mock('../src/components/structured-region-author-editor', () => ({ StructuredRegionAuthorEditor: () => null }));
vi.mock('../src/components/structured-region-inputs', () => ({ StructuredRegionInputs: () => null }));
vi.mock('../src/components/structured-problem-metadata-panel', () => ({ StructuredProblemMetadataPanel: () => null }));
vi.mock('../src/components/uploader', () => ({ FileUploader: () => null }));
vi.mock('../src/components/unsaved-changes-guard', () => ({
  useFormDirtyState: () => ({ dirty: false, recompute: vi.fn(), reset: vi.fn() }),
  useUnsavedChangesGuard: () => ({ allowNavigation: vi.fn() }),
}));
vi.mock('../src/components/problem-data-write-guard', () => ({
  useProblemDataWriteGuard: () => ({ notice: null, confirm: vi.fn(), appendToFormData: vi.fn() }),
}));

function submittedCases(container: HTMLElement) {
  const input = container.querySelector<HTMLInputElement>('input[name="structuredConfig"]');
  if (!input) throw new Error('Missing canonical structuredConfig form field');
  return JSON.parse(input.value).main.cases;
}

beforeEach(() => {
  fixture.locked = false;
});

describe('structured code case hints', () => {
  it('loads hints and visibility and includes edited values in the canonical save payload', () => {
    const { container } = render(<FunctionProblemEditorPage />);
    expect(submittedCases(container)).toEqual([
      { input: '1.in', output: '1.out', hint: '检查零值。', hintPublic: true },
      { input: '2.in', output: '2.out', hint: '检查上限。', hintPublic: false },
    ]);
    fireEvent.click(screen.getByRole('button', { name: /测试数据/ }));
    fireEvent.change(screen.getByLabelText('测试点 1 提示'), { target: { value: '注意人数为零时的返回值。' } });
    fireEvent.click(screen.getByRole('switch', { name: '测试点 2 提示对学生可见' }));
    expect(submittedCases(container)).toEqual([
      { input: '1.in', output: '1.out', hint: '注意人数为零时的返回值。', hintPublic: true },
      { input: '2.in', output: '2.out', hint: '检查上限。', hintPublic: true },
    ]);
  });

  it('keeps hint controls disabled with the existing structure lock', () => {
    fixture.locked = true;
    render(<FunctionProblemEditorPage />);
    fireEvent.click(screen.getByRole('button', { name: /测试数据/ }));
    expect(screen.getByLabelText('测试点 1 提示')).toBeDisabled();
    expect(screen.getByRole('switch', { name: '测试点 1 提示对学生可见' })).toBeDisabled();
  });
});
