import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect } from 'chai';
import { describe, it } from 'node:test';
import { readProblemConfigUploadSuccess, readProblemSaveSuccess } from '../src/lib/problem-save-response.ts';

const workspaceRoot = resolve(import.meta.dirname, '../../..');

function read(relative: string) {
  return readFileSync(resolve(workspaceRoot, relative), 'utf8');
}

async function captureFailure(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (error) {
    return error;
  }
  return null;
}

describe('P3.16 structured metadata and unsaved-navigation contracts', () => {
  it('shares one metadata panel across all seven structured editors', () => {
    const basic = read('packages/ui-next/src/pages/basic-objective-editors.tsx');
    const subjective = read('packages/ui-next/src/pages/subjective-editor.tsx');
    const code = read('packages/ui-next/src/pages/structured-code-editors.tsx');
    const panel = read('packages/ui-next/src/components/structured-problem-metadata-panel.tsx');
    const handler = read('packages/hydrooj/src/handler/problem.ts');

    for (const editor of [basic, subjective, code]) {
      expect(editor).to.include('<StructuredProblemMetadataPanel');
      expect(editor).not.to.include('name="tag"');
    }
    expect(panel).to.include('name="title"');
    expect(panel).to.include('pattern=".*\\S.*"');
    expect(panel).to.include('name="knowledgeNodeIds"');
    expect(panel).to.include('name="difficulty"');
    expect(panel).to.include('onValueChange={onMetadataChange}');
    expect(panel).to.include('name="hidden"');
    expect(panel).to.include('题目结构已锁定；本侧元数据仍可保存，但题号不可修改。');
    expect(panel).to.include('{canUseCustomPid ? (');
    expect(panel).to.include('<details');
    expect(panel).not.to.include('name="tag"');
    expect(basic).not.to.include('name="correct-option"');
    expect(basic).not.to.include('name="true-false-answer"');
    expect(handler.match(/@post\('difficulty', Types\.UnsignedInt/g)).to.have.length(2);
  });

  it('uses the shared custom guard in every editor workspace without mutating browser history', () => {
    const pages = [
      'packages/ui-next/src/pages/basic-objective-editors.tsx',
      'packages/ui-next/src/pages/subjective-editor.tsx',
      'packages/ui-next/src/pages/structured-code-editors.tsx',
      'packages/ui-next/src/pages/problem-edit.tsx',
      'packages/ui-next/src/pages/problem-config-editor.tsx',
    ].map(read);
    const guard = read('packages/ui-next/src/components/unsaved-changes-guard.tsx');

    for (const page of pages) {
      expect(page).to.include('useUnsavedChangesGuard');
      expect(page).not.to.include("addEventListener('beforeunload'");
      expect(page).not.to.include('window.confirm');
    }
    expect(guard).to.include("addEventListener('beforeunload'");
    expect(guard).to.include("addEventListener('click', interceptLink, true)");
    expect(guard).to.include("addEventListener('navigate', interceptTraversal)");
    expect(guard).to.include("event.navigationType !== 'traverse'");
    expect(guard).to.include('precommitHandler: async () =>');
    expect(guard).to.include('handler: () => window.location.reload()');
    expect(guard).to.include("event.signal.addEventListener('abort', abortDecision, { once: true })");
    expect(guard).to.include("if (current?.type === 'traverse' && current !== next) current.resolve(false)");
    expect(guard).to.include('replacePending(nextPending)');
    expect(guard).not.to.include('pendingRef.current ||');
    expect(guard).not.to.include('history.pushState');
    expect(guard).to.include('继续编辑');
    expect(guard).to.include('放弃更改并离开');
  });

  it('derives dirty state from reversible canonical snapshots instead of one-way change flags', () => {
    const guard = read('packages/ui-next/src/components/unsaved-changes-guard.tsx');
    const config = read('packages/ui-next/src/pages/problem-config-editor.tsx');

    expect(guard).to.include('current !== baselineRef.current');
    expect(guard).to.include('baselineRef.current = current');
    expect(guard).to.include('return { dirty, recompute, markClean, snapshot }');
    expect(config).to.include('const dirty = currentYaml !== savedYaml');
    expect(config).to.include('const submittedYaml = currentYaml');
    expect(config).to.include('setSavedYaml(submittedYaml)');
    expect(config).not.to.include('if (editVersion.current === savedVersion) setSavedYaml');
    expect(config).not.to.include('setDirty(true)');
    expect(config).not.to.include('localStorage');
    expect(guard).not.to.include('localStorage');
  });

  it('validates a complete save response and rejects concurrent local edits before clearing dirty state', () => {
    const editors = [
      read('packages/ui-next/src/pages/basic-objective-editors.tsx'),
      read('packages/ui-next/src/pages/subjective-editor.tsx'),
      read('packages/ui-next/src/pages/structured-code-editors.tsx'),
    ];

    for (const editor of editors) {
      const responseCheck = editor.indexOf('if (!response.ok)');
      const destinationCheck = editor.indexOf('readProblemSaveSuccess(response', responseCheck);
      const concurrentCheck = editor.indexOf('dirtyState.snapshot() !== submittedSnapshot', destinationCheck);
      const markClean = editor.indexOf('dirtyState.markClean()', concurrentCheck);
      const allowNavigation = editor.indexOf('navigationGuard.allowNavigation()', markClean);
      expect(responseCheck).to.be.greaterThan(-1);
      expect(destinationCheck).to.be.greaterThan(responseCheck);
      expect(concurrentCheck).to.be.greaterThan(destinationCheck);
      expect(markClean).to.be.greaterThan(concurrentCheck);
      expect(allowNavigation).to.be.greaterThan(markClean);
      expect(editor).to.include('inert={saving');
    }
  });

  it('enforces knowledge-node and derived-tag atomicity at the model write boundary', () => {
    const model = read('packages/hydrooj/src/model/problem.ts');
    const access = read('packages/hydrooj/src/model/problem-access.ts');
    const guard = read('packages/hydrooj/src/model/structured-problem-metadata.ts');
    const guardStart = guard.indexOf('export async function canonicalizeStructuredKnowledgePatch(');
    const editStart = model.indexOf('static async editWithClaim(');
    const editEnd = model.indexOf('static async editAuthorized(', editStart);
    const edit = model.slice(editStart, editEnd);
    const rawEditStart = model.indexOf('static async edit(');
    const rawEditEnd = model.indexOf('static async beginAuthorizedWriteClaim(', rawEditStart);
    const rawEdit = model.slice(rawEditStart, rawEditEnd);
    const createStart = model.indexOf('static async addWithId(');
    const createEnd = model.indexOf('static async createManagedProgrammingDraft(', createStart);
    const create = model.slice(createStart, createEnd);
    const cloneStart = model.indexOf('static async copy(');
    const cloneEnd = model.indexOf('static push<', cloneStart);
    const clone = model.slice(cloneStart, cloneEnd);

    expect(guardStart).to.be.greaterThan(-1);
    expect(guard).to.include('materializeKnowledgeMindmapTags($set.knowledgeNodeIds)');
    expect(guard).to.include("'incomplete-knowledge-pair'");
    expect(guard).to.include("'tag-mismatch'");
    expect(guard).to.include("'problem-kind-mutation'");
    expect(edit).to.include('const knowledgePairRequired = await canonicalizeStructuredKnowledgePatch(current, $set, $unset, claim');
    expect(edit).to.include('requireKnowledgePair: knowledgePairRequired');
    expect(rawEdit).to.include('const knowledgePairRequired = await canonicalizeStructuredKnowledgePatch(current, $set, $unset, rawEditContext');
    expect(rawEdit).to.include('requireKnowledgePair: knowledgePairRequired');
    expect(create).to.include('args.knowledgeNodeIds = meta.knowledgeNodeIds ?? []');
    expect(create.match(/canonicalizeStructuredKnowledgePatch\(/g)).to.have.length(2);
    expect(create).to.include("{ requireKnowledgePair: problemKind !== 'programming' }");
    expect(clone).to.include('cloneKnowledge = await materializeKnowledgeMindmapTags(original.knowledgeNodeIds ?? [])');
    expect(clone).to.include('cloneKnowledge?.tags ?? original.tag');
    expect(access.match(/canonicalizeStructuredKnowledgePatch\(/g)).to.have.length(2);
    expect(model.match(/assertNoCanonicalProblemPrimitiveMutation\(/g)).to.have.length(3);
  });

  it('rejects login redirects and other ambiguous 2xx responses before reporting a save', async () => {
    const previousWindow = (globalThis as any).window;
    (globalThis as any).window = { location: { href: 'https://oj.example/p/P7/edit', origin: 'https://oj.example' } };
    try {
      const headers = { 'content-type': 'application/json; charset=utf-8' };
      const saved = await readProblemSaveSuccess(
        new Response(JSON.stringify({ ok: true, pid: 'P7', problemKind: 'single', url: '/p/P7' }), { headers }),
        'single',
      );
      expect(saved).to.deep.equal({ pid: 'P7', destination: 'https://oj.example/p/P7' });

      const login = await captureFailure(() =>
        readProblemSaveSuccess(new Response(JSON.stringify({ url: '/login?redirect=/p/P7/edit' }), { headers }), 'single'),
      );
      expect(login).to.be.instanceOf(Error);
      expect((login as Error).message).to.equal('保存响应缺少明确的成功标记');

      await readProblemConfigUploadSuccess(
        new Response(JSON.stringify({ ok: true, operation: 'upload_file', type: 'testdata', filename: 'config.yaml' }), { headers }),
      );
      const ambiguousUpload = await captureFailure(() =>
        readProblemConfigUploadSuccess(new Response(JSON.stringify({ url: '/login' }), { headers })),
      );
      expect(ambiguousUpload).to.be.instanceOf(Error);

      const handler = read('packages/hydrooj/src/handler/problem.ts');
      expect(handler).to.include("this.back({ ok: true, operation: 'upload_file', type, filename })");
      expect(handler.match(/this\.response\.body = \{ ok: true, pid: responsePid, problemKind \}/g)).to.have.length(2);
      expect(handler).to.include('codeEvaluationStatus: pdoc.codeEvaluationStatus');
      expect(handler).to.include('structureRevision: pdoc.structureRevision');
    } finally {
      (globalThis as any).window = previousWindow;
    }
  });
});
