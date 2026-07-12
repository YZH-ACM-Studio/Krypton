import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect } from 'chai';
import { describe, it } from 'node:test';

const root = resolve(import.meta.dirname, '..');
const workspaceRoot = resolve(root, '../..');

function read(relative: string) {
  return readFileSync(resolve(workspaceRoot, relative), 'utf8');
}

describe('P3.11 structured code UI contract', () => {
  it('registers dedicated program-fill and function create routes and editors', () => {
    const handler = read('packages/hydrooj/src/handler/problem.ts');
    const resolver = read('packages/ui-next/src/pages/resolver.tsx');
    expect(handler).to.include("'problem_edit_program_fill.html'");
    expect(handler).to.include("'problem_edit_function.html'");
    expect(handler).to.include("'problem_create_program_fill'");
    expect(handler).to.include("'problem_create_function'");
    expect(resolver).to.include("'problem_edit_program_fill.html': ProgramFillProblemEditorPage");
    expect(resolver).to.include("'problem_edit_function.html': FunctionProblemEditorPage");
  });

  it('keeps mode and language immutable after creation', () => {
    const editor = read('packages/ui-next/src/pages/structured-code-editors.tsx');
    expect(editor.match(/disabled=\{!isCreate\}/g)).to.have.length(2);
    expect(editor).to.include('评测方式创建后不可切换');
    expect(editor).to.include('语言创建后不可修改');
  });

  it('renders sanitized region inputs without the private source in student pages', () => {
    const submit = read('packages/ui-next/src/pages/problem-submit.tsx');
    const exam = read('packages/ui-next/src/pages/exam-mode/paper.tsx');
    const detail = read('packages/ui-next/src/pages/problem-detail.tsx');
    expect(submit).to.include('<StructuredRegionInputs');
    expect(exam).to.include('<StructuredRegionInputs');
    expect(submit).not.to.include('template.source');
    expect(exam).not.to.include('template.source');
    expect(exam).not.to.include('<RegionEditor');
    expect(exam).to.include('regionContents: parseSavedRegionContents(pdict[d.pid], d.code)');
    expect(exam).to.include("'program_fill_compile'");
    expect(exam).to.include('if (!response.ok) throw new Error');
    expect(exam).to.include('if (!Array.isArray(body?.drafts)) throw new Error');
    expect(exam).to.include("useState<'loading' | 'ready' | 'error'>('loading')");
    expect(exam).to.include('disabled={!inWindow || !draftReady}');
    expect(exam).to.include('服务端草稿尚未成功加载，禁止保存');
    expect(exam).to.include('已阻止作答、保存和交卷');
    expect(detail).to.include('!isObjective && !isStructuredCompile');
  });

  it('offers a hidden physical clone with an explicit different target language', () => {
    const editor = read('packages/ui-next/src/pages/structured-code-editors.tsx');
    const handler = read('packages/hydrooj/src/handler/problem.ts');
    const model = read('packages/hydrooj/src/model/problem.ts');
    expect(editor).to.include('cloneLang');
    expect(editor).to.include('创建语言副本');
    expect(handler).to.include("@param('cloneLang', Types.Name, true)");
    expect(model).to.include('cloneStructuredProblemForLanguage');
  });
});
