import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect } from 'chai';
import { describe, it } from 'node:test';
import { resolveChapterId, withChapterQuery } from '../src/pages/course/chapter-query.ts';

const root = resolve(import.meta.dirname, '..');

describe('P3.8 course workspace', () => {
    it('resolves valid chapters and canonicalizes missing or invalid deep links', () => {
        expect(resolveChapterId([2, 5, 9], '5')).to.equal(5);
        expect(resolveChapterId([2, 5, 9], '404')).to.equal(2);
        expect(resolveChapterId([2, 5, 9], null)).to.equal(2);
        expect(resolveChapterId([], '5')).to.equal(null);
        expect(withChapterQuery('https://oj.test/course/abc?q=x', 9))
            .to.equal('https://oj.test/course/abc?q=x&chapter=9');
    });

    it('keeps list, detail, and editor in focused files with explicit extension slots', () => {
        expect(() => readFileSync(resolve(root, 'src/pages/course.tsx'))).to.throw();
        const detail = readFileSync(resolve(root, 'src/pages/course/detail.tsx'), 'utf8');
        const editor = readFileSync(resolve(root, 'src/pages/course/editor.tsx'), 'utf8');
        for (const slot of ['chapterContent', 'files', 'quiz']) {
            expect(detail).to.include(`data-course-slot="${slot}"`);
            expect(editor).to.include(`data-course-slot="${slot}"`);
        }
        expect(editor).to.include('data-course-slot="collaborators"');
    });

    it('uses server capabilities, true totals, enrollment status, and one active chapter', () => {
        const handler = readFileSync(resolve(root, '../hydrooj/src/handler/course.ts'), 'utf8');
        const list = readFileSync(resolve(root, 'src/pages/course/list.tsx'), 'utf8');
        const detail = readFileSync(resolve(root, 'src/pages/course/detail.tsx'), 'utf8');
        expect(handler).to.include('const [tdocs, tpcount, tcount]');
        expect(handler).to.include('canCreate, managedIds');
        expect(handler).to.include('canManage, tsdoc');
        expect(list).to.include('Number(data.tcount)');
        expect(detail).to.include('const activeChapter = chapters.find');
        expect(detail).to.not.include('chapters.map((ch');
    });

    it('edits and renders chapter markdown through the chapterContent slot', () => {
        const editor = readFileSync(resolve(root, 'src/pages/course/editor.tsx'), 'utf8');
        const detail = readFileSync(resolve(root, 'src/pages/course/detail.tsx'), 'utf8');
        expect(editor).to.include('key={activeChapter._id}');
        expect(editor).to.include('value={activeChapter.content}');
        expect(editor).to.include('{ content }');
        expect(detail).to.include('content={activeChapter.content}');
        expect(detail).to.include('!course.content && !activeChapter.content');
    });
});
