import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const workspaceRoot = resolve(import.meta.dirname, '../../..');

function read(relative: string) {
  return readFileSync(resolve(workspaceRoot, relative), 'utf8');
}

describe('P3.25 structured programming statement UI contract', () => {
  it('uses one safe structured view in both normal and Exam Mode layouts', () => {
    const detail = read('packages/ui-next/src/pages/problem-detail.tsx');
    const view = read('packages/ui-next/src/components/programming-statement.tsx');

    expect(detail.match(/<ProgrammingStatementView/g)).to.have.length(2);
    expect(detail).to.include('structuredStatementSamples(structuredStatement)');
    expect(view).to.include('data-programming-statement="structured-v1"');
    expect(view).to.include('<Section title="题目描述">');
    expect(view).to.include('<Section title="输入格式">');
    expect(view).to.include('<Section title="输出格式">');
    expect(view).to.include('<Section title="样例">');
    expect(view).to.include('<Section title="时空限制">{limits}</Section>');
    expect(view).to.include('本题无输入。');
    expect(view).to.include('本题无输出。');
  });

  it('keeps one ordered card editor with explicit tri-state clearing and simple example controls', () => {
    const editor = read('packages/ui-next/src/components/programming-statement.tsx');

    for (const section of ['background', 'description', 'input', 'output', 'examples', 'hints']) {
      expect(editor).to.include(`sectionKey="${section}"`);
      expect(editor).to.include(`#statement-${'${item.key}'}`);
    }
    expect(editor).to.include('<DialogTitle>确认清空区块</DialogTitle>');
    expect(editor).to.include('清空并标记为无');
    expect(editor).to.include('moveExample(index, -1)');
    expect(editor).to.include('moveExample(index, 1)');
    expect(editor).to.include('新增样例');
    expect(editor).not.to.include('sortable');
    expect(editor).not.to.include('drag');
  });

  it('packages the canonical JSON beside the readable Markdown projection', () => {
    const packaging = read('packages/ui-next/src/lib/problem-package.ts');

    expect(packaging).to.include('name: `${folder}/problem.md`');
    expect(packaging).to.include('name: `${folder}/programming-statement.json`');
    expect(packaging).to.include('JSON.stringify(pdoc.programmingStatement, null, 2)');
  });

  it('uses live server limits and rewrites structured attachment URLs in normal and Exam Mode responses', () => {
    const editor = read('packages/ui-next/src/pages/problem-edit.tsx');
    const handler = read('packages/hydrooj/src/handler/problem.ts');
    const paper = read('packages/hydrooj/src/handler/paper.ts');

    expect(editor).to.include('const statementLimits = data.programmingStatementLimits');
    expect(editor).to.include('limitsPreview={statementLimitsPreview}');
    expect(handler).to.include('this.response.body.programmingStatementLimits = programmingStatementLimits(rawPdoc.config)');
    expect(handler).to.include('statementView[section].content = rewriteFileUrls(statementView[section].content)');
    const legacyJsonGuard = handler.indexOf('if (!this.request.json || args[2]) {');
    const legacyContentRewrite = handler.indexOf(
      'this.response.body.pdoc.content = rewriteFileUrls(this.response.body.pdoc.content)',
      legacyJsonGuard,
    );
    const structuredViewRewrite = handler.indexOf('const statementView = this.response.body.pdoc.programmingStatementView', legacyContentRewrite);
    expect(legacyJsonGuard).to.be.greaterThan(-1);
    expect(legacyContentRewrite).to.be.greaterThan(legacyJsonGuard);
    expect(structuredViewRewrite).to.be.greaterThan(legacyContentRewrite);
    expect(paper).to.include('absolutizeProgrammingStatementFileUrls(this, pdoc.programmingStatementView, pdoc, tid)');
  });
});
