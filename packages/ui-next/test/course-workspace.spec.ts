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
    expect(withChapterQuery('https://oj.test/course/abc?q=x', 9)).to.equal('https://oj.test/course/abc?q=x&chapter=9');
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
    expect(handler).to.include('canCreate,');
    expect(handler).to.include('managedIds,');
    expect(handler).to.include('canManage,');
    expect(handler).to.include('tsdoc,');
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

  it('uses protected course file routes without reloading the editor draft', () => {
    const handler = readFileSync(resolve(root, '../hydrooj/src/handler/course.ts'), 'utf8');
    const training = readFileSync(resolve(root, '../hydrooj/src/handler/training.ts'), 'utf8');
    const uploader = readFileSync(resolve(root, 'src/components/uploader.tsx'), 'utf8');
    const editor = readFileSync(resolve(root, 'src/pages/course/editor.tsx'), 'utf8');
    const detail = readFileSync(resolve(root, 'src/pages/course/detail.tsx'), 'utf8');
    expect(handler).to.include('return `course/');
    expect(handler).to.include("ctx.Route('course_files', '/course/:tid/file'");
    expect(handler).to.include("ctx.Route('course_file_download', '/course/:tid/file/:filename'");
    expect(handler).to.include("@post('filename', Types.Filename)");
    expect(handler).to.include('listedCourseFile(tdoc, filename)');
    expect(training).to.include('assertNotCourse(tdoc)');
    expect(training).to.include("throw new NotFoundError('file')");
    expect(editor).to.include('<FileUploader');
    expect(editor).to.include('uploadConcurrency={1}');
    expect(uploader).to.include('limit: uploadConcurrency');
    expect(editor).to.include('void refreshFiles()');
    expect(editor).to.not.include('window.location.reload');
    expect(detail).to.include('encodeURIComponent(file.name)');
  });

  it('connects both quiz slots to the course-homework prefill route', () => {
    const detail = readFileSync(resolve(root, 'src/pages/course/detail.tsx'), 'utf8');
    const editor = readFileSync(resolve(root, 'src/pages/course/editor.tsx'), 'utf8');
    for (const source of [detail, editor]) {
      expect(source).to.include('/homework/create?fromCourse=');
      expect(source).to.match(/&chapter=\$\{activeChapter\._id\}/);
    }
    expect(detail).to.include('data.canCreateQuiz');
    expect(editor).to.include("isEdit && data.canCreateQuiz && saveState === 'idle'");
    expect(editor).to.include('请先保存课程修改');
  });

  it('keeps course context and participant groups in the homework form post', () => {
    const homework = readFileSync(resolve(root, 'src/pages/homework-manage.tsx'), 'utf8');
    const fallback = readFileSync(resolve(root, '../ui-default/templates/homework_edit.html'), 'utf8');
    expect(homework).to.include('name="fromCourse"');
    expect(homework).to.include('name="chapter"');
    expect(homework).to.include('name="participantScopeMode"');
    expect(homework).to.include('name="participantGroupIds"');
    expect(homework).to.include('data.courseContext');
    expect(fallback).to.include('name="fromCourse"');
    expect(fallback).to.include('name="participantScopeMode"');
    expect(fallback).to.include('name="participantGroupIds"');
  });
});
