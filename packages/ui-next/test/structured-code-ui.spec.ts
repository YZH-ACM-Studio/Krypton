import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

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

  it('keeps mode and compile language immutable after creation', () => {
    const editor = read('packages/ui-next/src/pages/structured-code-editors.tsx');
    expect(editor.match(/disabled=\{!isCreate\}/g)).to.have.length(1);
    expect(editor).to.include('disabled={compileMode && !isCreate}');
    expect(editor).to.include('评测方式创建后不可切换');
    expect(editor).to.include('评测语言创建后不可修改');
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
    expect(detail).to.include('!isObjective && !isStructuredAnswer');
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

describe('P3.21 shared structured-code workspace', () => {
  it('uses a full-height whole-line CodeMirror selector with accessible source states', () => {
    const editor = read('packages/ui-next/src/components/structured-region-author-editor.tsx');
    const workspace = read('packages/ui-next/src/pages/structured-code-editors.tsx');
    expect(editor).to.include('function selectedWholeLines(');
    expect(editor).to.include('startLine: start.number - 1');
    expect(editor).to.include('endLine: end.number');
    expect(editor).to.include("height: '100%'");
    expect(editor).to.include("'.cm-gutters': { minHeight: '100%' }");
    expect(editor).to.include('krypton-structured-line-public');
    expect(editor).to.include('krypton-structured-line-answer');
    expect(editor).to.match(/return `\$\{marker\} \$\{lineNo\}`/);
    expect(workspace).to.include('已扩展为完整行');
    expect(workspace).to.include('公开给学生');
    expect(workspace).to.include('设为私有');
  });

  it('keeps server ids opaque and derives region order only from source position', () => {
    const workspace = read('packages/ui-next/src/pages/structured-code-editors.tsx');
    expect(workspace).to.include("id: '',");
    expect(workspace).to.include('保存后生成 ID');
    expect(workspace).not.to.match(/<Input\s+value=\{region\.id\}/);
    expect(workspace).not.to.include('draggable');
    expect(workspace).not.to.include('reorderRegions');
    expect(workspace).not.to.include('region.order');
    expect(workspace).to.include('作答区标题（可选）');
    expect(workspace).to.include('局部要求（可选）');
  });

  it('maps ranges through CodeMirror changes and blocks invalid or overlapping results', () => {
    const editor = read('packages/ui-next/src/components/structured-region-author-editor.tsx');
    const ranges = read('packages/ui-next/src/lib/structured-code-ranges.ts');
    const workspace = read('packages/ui-next/src/pages/structured-code-editors.tsx');
    expect(editor).to.include('export function mapAuthorLineRanges');
    expect(ranges).to.include('changes.mapPos');
    expect(workspace).to.include('conflicted.add');
    expect(workspace).to.include('请删除后重新框选，系统不会猜测迁移');
    expect(workspace).to.include('disabled={saving || completionBlocked}');
    expect(workspace).to.include("sourceHash: sha256Text(source.replace(/\\r\\n?/g, '\\n'))");
  });

  it('shares the same safe region inputs across direct, contest, homework, exam, training, and course references', () => {
    const submit = read('packages/ui-next/src/pages/problem-submit.tsx');
    const exam = read('packages/ui-next/src/pages/exam-mode/paper.tsx');
    const inputs = read('packages/ui-next/src/components/structured-region-inputs.tsx');
    expect(submit).to.include('<StructuredRegionInputs');
    expect(submit).to.include('const tid = tdoc?.docId');
    expect(exam).to.include('<StructuredRegionInputs');
    expect(inputs).to.match(/segment\.title \|\| segment\.prompt \|\| `作答区 \$\{regionIndex \+ 1\}`/);
    expect(inputs).to.include('segment.description');
    expect(inputs).to.include('aria-label="连续代码作答区"');
    expect(submit).to.include('surface={surface}');
    expect(exam).to.include('surface={pdoc.config.template.surface}');
    expect(submit).not.to.include('template.source');
    expect(exam).not.to.include('template.source');
  });
});

describe('P3.22 code implementation authoring and student contract', () => {
  it('uses the product name while preserving the internal function kind and routes', () => {
    const hub = read('packages/ui-next/src/pages/problem-create-hub.tsx');
    const bank = read('packages/ui-next/src/pages/problems.tsx');
    const paper = read('packages/ui-next/src/components/paper/paper-shell.tsx');
    const workspace = read('packages/ui-next/src/pages/structured-code-editors.tsx');
    expect(hub).to.include('function: {');
    expect(hub).to.include("label: '代码实现题'");
    expect(hub).to.include('在公开代码骨架中完成函数、类或指定代码区域');
    expect(bank).to.include("function: '代码实现题'");
    expect(paper).to.include("function: '代码实现题'");
    expect(paper).to.include("function: '码'");
    expect(paper).not.to.include("function: '函'");
    expect(workspace).to.include("kind: 'program_fill' | 'function'");
    expect(workspace).to.include('代码实现题');
  });

  it('renders every multi-line region as a real empty CodeMirror editor in the safe continuous surface', () => {
    const inputs = read('packages/ui-next/src/components/structured-region-inputs.tsx');
    const submit = read('packages/ui-next/src/pages/problem-submit.tsx');
    const exam = read('packages/ui-next/src/pages/exam-mode/paper.tsx');
    expect(inputs).to.include('function StructuredRegionCodeEditor(');
    expect(inputs).to.include('new EditorView');
    expect(inputs).to.include('EditorState.readOnly.of(readOnly)');
    expect(inputs).to.include('structuredCodeLanguageExtension(lang)');
    expect(inputs).to.include("value={values[segment.id] || ''}");
    expect(inputs).not.to.include('<textarea');
    expect(submit).to.include('lang={config.template?.lang || lang}');
    expect(exam).to.include("lang={pdoc.config.template.lang || ''}");
  });

  it('keeps only optional title and description and makes source position the only order', () => {
    const workspace = read('packages/ui-next/src/pages/structured-code-editors.tsx');
    const lifecycle = read('packages/hydrooj/src/model/code-evaluation-lifecycle.ts');
    expect(workspace).to.include('作答区标题（可选）');
    expect(workspace).to.include('局部要求（可选）');
    expect(workspace).not.to.include('函数签名');
    expect(lifecycle).to.include("['id', 'startLine', 'endLine', 'title', 'description']");
    expect(lifecycle).not.to.include('allowEmptySignature');
    expect(lifecycle).not.to.include('region.order');
  });
});

describe('P3.23 program-fill authoring and student contract', () => {
  it('supports any number of strict single-line regions in both fixed modes', () => {
    const workspace = read('packages/ui-next/src/pages/structured-code-editors.tsx');
    expect(workspace).to.include('target.endLine !== target.startLine + 1');
    expect(workspace).not.to.include('只能设置一个区域');
    expect(workspace).to.include("mode: kind === 'program_fill' ? mode : 'function'");
    expect(workspace).to.include('...(compileMode ? { cases } : {})');
    expect(workspace).to.include('{compileMode ? (');
    expect(workspace).not.to.include('标准答案（单行）');
  });

  it('renders the server-safe continuous surface through the shared student component', () => {
    const inputs = read('packages/ui-next/src/components/structured-region-inputs.tsx');
    const submit = read('packages/ui-next/src/pages/problem-submit.tsx');
    const exam = read('packages/ui-next/src/pages/exam-mode/paper.tsx');
    expect(inputs).to.include('structured code surface contains duplicate region ids');
    expect(inputs).to.include('aria-label="连续代码作答区"');
    expect(inputs).to.include("segment.type === 'code'");
    expect(inputs).to.include('overflow-x-auto');
    expect(inputs).to.include('autoComplete="off"');
    expect(inputs).to.include('const regionIds = regions.map((region) => region.id)');
    expect(inputs).to.include('index + (event.shiftKey ? -1 : 1)');
    expect(inputs).to.include('target.focus()');
    expect(submit).to.include('surface={surface}');
    expect(exam).to.include('surface={pdoc.config.template.surface}');
    expect(submit).not.to.include('template.source');
    expect(exam).not.to.include('template.source');
  });

  it('keeps inline blanks single-line, source-ordered, keyboard reachable, and narrow-screen scrollable', () => {
    const inputs = read('packages/ui-next/src/components/structured-region-inputs.tsx');
    expect(inputs).to.include("const regions = surface.filter((segment) => segment.type === 'region')");
    expect(inputs).to.include('const regionIds = regions.map((region) => region.id)');
    expect(inputs).to.include('index + (event.shiftKey ? -1 : 1)');
    expect(inputs).to.include('event.preventDefault()');
    expect(inputs).to.include('target.focus()');
    expect(inputs).to.include("event.target.value.replace(/[\\r\\n]/g, '')");
    expect(inputs).to.include('className="h-9 min-h-9 min-w-[18rem] font-mono"');
    expect(inputs).to.include('overflow-x-auto');
  });

  it('reuses the same student surface for direct, contest/OI/homework, exam, training, and course entry points', () => {
    const direct = read('packages/ui-next/src/pages/problem-submit.tsx');
    const exam = read('packages/ui-next/src/pages/exam-mode/paper.tsx');
    const handler = read('packages/hydrooj/src/handler/problem.ts');
    const training = read('packages/ui-next/src/pages/training.tsx');
    const course = read('packages/ui-next/src/pages/course/detail.tsx');
    expect(direct).to.include('<StructuredRegionInputs');
    expect(exam).to.include('<StructuredRegionInputs');
    expect(handler).to.include("this.response.template = 'problem_submit.html'");
    expect(handler).to.include("'contest_detail_problem_submit'");
    expect(handler).to.include("'homework_detail_problem_submit'");
    expect(training).to.include('bs.urls.problemDetail');
    expect(course).to.match(/href=\{`\/p\/\$\{problem\.pid \|\| pid\}`\}/);
    expect(training).not.to.include('template.source');
    expect(course).not.to.include('template.source');
  });

  it('invalidates stale local region caches and never carries hidden old keys into an update', () => {
    const submit = read('packages/ui-next/src/pages/problem-submit.tsx');
    expect(submit).to.include('parseStructuredRegionDraft(saved, regionIds, singleLineRegion)');
    expect(submit).to.include('createEmptyStructuredRegionDraft(regionIds)');
    expect(submit).to.match(/const structureKey = isStructuredAnswer \? `:\$\{Number\(pdoc\.structureRevision\) \|\| 0\}` : ''/);
    expect(submit).to.include('Object.fromEntries(regionIds.map((currentId) =>');
    expect(submit).not.to.include('{ ...regionValues, [id]: value }');
  });
});
