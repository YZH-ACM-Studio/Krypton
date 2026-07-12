import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect } from 'chai';
import { describe, it } from 'node:test';

const root = resolve(import.meta.dirname, '..');

describe('P3.9 dedicated basic objective editors', () => {
    it('registers every route-template-component tuple without GenericPage fallback', () => {
        const handler = readFileSync(resolve(root, '../hydrooj/src/handler/problem.ts'), 'utf8');
        const resolver = readFileSync(resolve(root, 'src/pages/resolver.tsx'), 'utf8');
        for (const [kindProperty, suffix] of [
            ['single', 'single'], ['multi', 'multi'], ['trueFalse', 'true_false'], ['blank', 'blank'],
        ]) {
            expect(handler).to.include(`problemKindToSlug(BASIC_OBJECTIVE_KIND.${kindProperty})`);
            expect(handler).to.include(`problem_edit_${suffix}.html`);
            expect(resolver).to.include(`'problem_edit_${suffix}.html':`);
        }
        expect(handler).not.to.include("const BASIC_OBJECTIVE_KINDS = ['single'");
        expect(readFileSync(resolve(root, 'src/pages/basic-objective-editors.tsx'), 'utf8'))
            .not.to.include("type BasicKind = 'single'");
    });

    it('keeps fields independent while sharing only the neutral editor shell', () => {
        const source = readFileSync(resolve(root, 'src/pages/basic-objective-editors.tsx'), 'utf8');
        for (const component of [
            'SingleProblemEditorPage', 'MultiProblemEditorPage',
            'TrueFalseProblemEditorPage', 'BlankProblemEditorPage',
        ]) expect(source).to.include(`function ${component}`);
        expect(source).to.include('partialCreditPercent');
        expect(source).to.include('answerIndexes');
        expect(source).to.include('true-false-answer');
        expect(source).to.include('大小写敏感');
        expect(source).to.include('name="expectedStructureRevision"');
        expect(source).to.include('name="metadataOnly"');
        expect(source).to.include('<fieldset disabled={locked}');
        expect(source).to.include('disabled={locked}');
        expect(source).to.include('disabled={saving}');
        expect(source).to.include('response.status === 409');
    });

    it('does not touch the exam-mode student DOM implementation', () => {
        const source = readFileSync(resolve(root, 'src/pages/basic-objective-editors.tsx'), 'utf8');
        expect(source).not.to.include('exam-mode');
        expect(source).not.to.include('PaperCell');
    });

    it('reuses the existing direct/contest/homework and exam submission paths', () => {
        const detail = readFileSync(resolve(root, 'src/pages/problem-detail.tsx'), 'utf8');
        const panel = readFileSync(resolve(root, 'src/components/objective-answer-panel.tsx'), 'utf8');
        const paper = readFileSync(resolve(root, '../hydrooj/src/handler/paper.ts'), 'utf8');
        expect(detail).to.include('<ObjectiveAnswerPanel');
        expect(detail).to.include('const contestQS = tid ?');
        expect(panel).to.include('lang: \'_\'');
        expect(paper).to.include('clientProblemConfig(pdoc.config)');
        expect(paper).to.include('questionKey: key');
    });
});
