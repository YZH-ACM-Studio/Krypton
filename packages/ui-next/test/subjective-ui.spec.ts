import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect } from 'chai';
import { describe, it } from 'node:test';

const root = resolve(import.meta.dirname, '..');

describe('P3.10 subjective editor and grading workspace', () => {
    it('registers one dedicated subjective create/edit component', () => {
        const handler = readFileSync(resolve(root, '../hydrooj/src/handler/problem.ts'), 'utf8');
        const resolver = readFileSync(resolve(root, 'src/pages/resolver.tsx'), 'utf8');
        const editor = readFileSync(resolve(root, 'src/pages/subjective-editor.tsx'), 'utf8');
        expect(handler).to.include('problem_create_subjective');
        expect(handler).to.include("'problem_edit_subjective.html'");
        expect(resolver).to.include("'problem_edit_subjective.html': SubjectiveProblemEditorPage");
        expect(editor).to.include('阅卷说明');
        expect(editor).not.to.include('正确答案');
        expect(editor).not.to.include('时间限制');
        expect(editor).not.to.include('内存限制');
    });

    it('uses the shared container grading route', () => {
        const resolver = readFileSync(resolve(root, 'src/pages/resolver.tsx'), 'utf8');
        const contest = readFileSync(resolve(root, 'src/pages/contest-manage.tsx'), 'utf8');
        const homework = readFileSync(resolve(root, 'src/pages/homework.tsx'), 'utf8');
        expect(resolver).to.include("'manual_grading.html': ManualGradingPage");
        expect(contest).to.include('/manage/grading/');
        expect(homework).to.include('/manage/grading/');
    });

    it('keeps the exam-mode student DOM implementation untouched', () => {
        const grading = readFileSync(resolve(root, 'src/pages/manual-grading.tsx'), 'utf8');
        const editor = readFileSync(resolve(root, 'src/pages/subjective-editor.tsx'), 'utf8');
        expect(grading).not.to.include('exam-mode/paper');
        expect(editor).not.to.include('exam-mode/paper');
    });

    it('shows only authorized maintainers a non-submitting direct-page preview', () => {
        const panel = readFileSync(resolve(root, 'src/components/objective-answer-panel.tsx'), 'utf8');
        const detail = readFileSync(resolve(root, 'src/pages/problem-detail.tsx'), 'utf8');
        expect(panel).to.include('previewOnly');
        expect(panel).to.include('主观题不能从独立题目页提交');
        expect(detail).to.include('canPreviewSubjective');
        expect(detail).to.include('previewOnly={isSubjective && !inContest}');
    });
});
