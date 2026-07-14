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

describe('P3.17 code evaluation draft workspace', () => {
  it('creates a real hidden draft before rendering statement, template, or testdata controls', () => {
    const editor = read('packages/ui-next/src/pages/structured-code-editors.tsx');
    expect(editor).to.include('const draftCreation = isCreate && compileMode');
    expect(editor).to.include('main: draftCreation');
    expect(editor).to.include("? { mode: kind === 'program_fill' ? 'compile' : 'function', lang }");
    expect(editor).to.include('name="codeEvaluationDraft" value="true"');
    expect(editor).to.include("draftCreation ? '创建草稿' : '保存'");
    expect(editor).to.include('{!draftCreation ? (');
  });

  it('maps cases only through selectors backed by the canonical uploaded file list', () => {
    const editor = read('packages/ui-next/src/pages/structured-code-editors.tsx');
    const casesStart = editor.indexOf('function CasesEditor(');
    const casesEnd = editor.indexOf('function StructuredCodeEditor(', casesStart);
    const casesEditor = editor.slice(casesStart, casesEnd);
    expect(casesEditor).to.include('<SimpleSelect');
    expect(casesEditor).to.include('caseFileOptions(files, item.input)');
    expect(casesEditor).to.include('caseFileOptions(files, item.output)');
    expect(casesEditor).not.to.include('<Input');
    expect(editor).to.include('<FileUploader');
    expect(editor).to.include('uploadConcurrency={1}');
    expect(editor).to.include('retryOnFailure={false}');
    expect(editor).to.include('proposeCasePairs(current, canonicalFiles)');
  });

  it('uses explicit save-draft and atomic completion actions with the latest upload revision', () => {
    const editor = read('packages/ui-next/src/pages/structured-code-editors.tsx');
    expect(editor).to.include("formData.set('expectedStructureRevision', String(structureRevision))");
    expect(editor).to.include("formData.set('completeCodeEvaluationDraft', 'true')");
    expect(editor).to.include('保存草稿');
    expect(editor).to.include('完成配置');
    expect(editor).to.include('服务端未返回最新结构版本与文件清单');
    expect(editor).to.include('visibilityLockedReason=');
  });

  it('parses successful upload JSON so the workspace receives canonical revision and files', () => {
    const uploader = read('packages/ui-next/src/components/uploader.tsx');
    expect(uploader).to.include("headers: { Accept: 'application/json' }");
    expect(uploader).to.include('getResponseData: (xhr) =>');
    expect(uploader).to.include('onUploaded?.(file.name, response?.body');
  });
});

describe('P3.18 function authoring and student contract', () => {
  it('uses a whole-line CodeMirror selector with explicit expansion and region highlighting', () => {
    const editor = read('packages/ui-next/src/components/structured-region-author-editor.tsx');
    const workspace = read('packages/ui-next/src/pages/structured-code-editors.tsx');
    expect(editor).to.include('function selectedWholeLines(');
    expect(editor).to.include('startLine: start.number - 1');
    expect(editor).to.include('endLine: end.number');
    expect(editor).to.include('krypton-region-line-invalid');
    expect(workspace).to.include('已自动扩展到完整行');
    expect(workspace).to.include("设为{kind === 'function' ? '函数区' : '填空区'}");
  });

  it('never lets authors type region ids and reorders answers without moving source', () => {
    const workspace = read('packages/ui-next/src/pages/structured-code-editors.tsx');
    expect(workspace).to.include("id: '',");
    expect(workspace).to.include('保存后生成 ID');
    expect(workspace).not.to.match(/<Input\s+value=\{region\.id\}/);
    expect(workspace).to.include('draggable');
    expect(workspace).to.include('reorderRegions(current, draggedRegion, index)');
    expect(workspace).to.include('函数签名（必填）');
    expect(workspace).to.include('局部要求（可选）');
  });

  it('marks edited source anchors invalid and blocks completion until reselected', () => {
    const workspace = read('packages/ui-next/src/pages/structured-code-editors.tsx');
    expect(workspace).to.include('currentSelection === null || currentSelection !== region.anchor');
    expect(workspace).to.include('请删除后重新框选，系统不会猜测迁移');
    expect(workspace).to.include('disabled={saving || completionBlocked}');
  });

  it('shares the same safe region inputs across direct, contest, homework, exam, training, and course references', () => {
    const submit = read('packages/ui-next/src/pages/problem-submit.tsx');
    const exam = read('packages/ui-next/src/pages/exam-mode/paper.tsx');
    const inputs = read('packages/ui-next/src/components/structured-region-inputs.tsx');
    expect(submit).to.include('<StructuredRegionInputs');
    expect(submit).to.include('const tid = tdoc?.docId');
    expect(exam).to.include('<StructuredRegionInputs');
    expect(inputs).to.include('region.signature || region.prompt');
    expect(inputs).to.include('region.description');
    expect(submit).not.to.include('template.source');
    expect(exam).not.to.include('template.source');
  });
});
