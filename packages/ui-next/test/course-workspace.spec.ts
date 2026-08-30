import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { claimChapterProblemIds } from '../src/pages/course/chapter-draft.ts';
import { resolveChapterId, resolveSectionId, withChapterQuery } from '../src/pages/course/chapter-query.ts';
import { problemsForCourseMindmapNode } from '../src/pages/course/mindmap-state.ts';
import { courseMindmapProblemHref } from '../src/pages/course/mindmap.tsx';

const root = resolve(import.meta.dirname, '..');

describe('p3.8 course workspace', () => {
  it('resolves valid chapters and canonicalizes missing or invalid deep links', () => {
    expect(resolveChapterId([2, 5, 9], '5')).to.equal(5);
    expect(resolveChapterId([2, 5, 9], '404')).to.equal(2);
    expect(resolveChapterId([2, 5, 9], null)).to.equal(2);
    expect(resolveChapterId([2, 5, 9], null, 5)).to.equal(5);
    expect(resolveChapterId([2, 5, 9], '404', 5)).to.equal(5);
    expect(resolveChapterId([0, 5], null, 5)).to.equal(5);
    expect(resolveChapterId([], '5')).to.equal(null);
    expect(withChapterQuery('https://oj.test/course/abc?q=x', 9)).to.equal('https://oj.test/course/abc?q=x&chapter=9');
    expect(resolveSectionId([1, 2], '2')).to.equal(2);
    expect(resolveSectionId([1, 2], '9')).to.equal(null);
    expect(resolveSectionId([1, 2], null)).to.equal(null);
    expect(withChapterQuery('https://oj.test/course/abc?chapter=9', 9, 2)).to.equal('https://oj.test/course/abc?chapter=9&section=2');
    expect(withChapterQuery('https://oj.test/course/abc?chapter=9&section=2', 9)).to.equal('https://oj.test/course/abc?chapter=9');
  });

  it('uses the shared chapter query protocol on training details', () => {
    const training = readFileSync(resolve(root, 'src/pages/training.tsx'), 'utf8');
    expect(training).to.include('useChapterQuery(dag, preferredNid)');
    expect(training).to.include('selectChapter(Number(rid))');
    expect(training).to.include('selectChapter(s._id)');
    expect(training).to.include('practiceProblemEntryUrl(base');
    expect(training).not.to.match(/if \(!integrityControlled\) return base/);
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
    expect(editor).to.include('CourseAssignForm');
    const assign = readFileSync(resolve(root, 'src/pages/course/assign.tsx'), 'utf8');
    expect(assign).to.match(/new URLSearchParams\(\{\s*operation: 'assign',\s*expectedOwner:/);
    expect(assign).not.to.match(/URLSearchParams\([\s\S]*title:/);
    const list = readFileSync(resolve(root, 'src/pages/course/list.tsx'), 'utf8');
    expect(list).to.include('CourseAssignDialog');
    expect(list).to.include('分配');
    expect(list).not.to.include('max-w-[76rem]');
    expect(detail).not.to.include('max-w-[76rem]');
    expect(editor).not.to.include('col-span-full');
    expect(editor).not.to.include('课程简介在页面底部整幅编辑');
    expect(editor).to.match(/<section className="min-w-0 space-y-7"[\s\S]*course-description-title[\s\S]*章节内容/);
  });

  it('uses server capabilities, true totals, enrollment status, and one active chapter', () => {
    const handler = readFileSync(resolve(root, '../hydrooj/src/handler/course.ts'), 'utf8');
    const list = readFileSync(resolve(root, 'src/pages/course/list.tsx'), 'utf8');
    const detail = readFileSync(resolve(root, 'src/pages/course/detail.tsx'), 'utf8');
    expect(handler).to.include('const [tdocs, tpcount, tcount]');
    expect(handler).to.include('canCreate,');
    expect(handler).to.include('canAssign,');
    expect(handler).to.include('async postAssign(');
    expect(handler).to.include("@param('title', Types.Title, true)");
    expect(handler).to.match(/if \(this\.args\?\.operation \|\| this\.request\.body\?\.operation\) return;/);
    expect(handler).to.include('training.assignCourseOwnership');
    expect(handler).to.include('managedIds,');
    expect(handler).to.include('canManage,');
    expect(handler).to.include('tsdoc,');
    expect(list).to.include('Number(data.tcount)');
    expect(detail).to.include('grid min-w-0 w-full gap-6');
    expect(detail).to.include('const activeChapter = chapters.find');
    expect(detail).to.include('selectSection');
    expect(detail).to.include('本章小节');
    expect(detail).to.not.include('chapters.map((ch');
  });

  it('edits and renders chapter markdown through the chapterContent slot', () => {
    const editor = readFileSync(resolve(root, 'src/pages/course/editor.tsx'), 'utf8');
    const detail = readFileSync(resolve(root, 'src/pages/course/detail.tsx'), 'utf8');
    expect(editor).to.include('key={activeChapter._id}');
    expect(editor).to.include('value={activeChapter.content}');
    expect(editor).to.include('{ content }');
    expect(editor).to.include('添加小节');
    expect(editor).to.include("from './chapter-draft'");
    expect(editor).to.include("claimChapterProblemIds(chapter, 'loose', pids)");
    expect(editor).to.include('claimChapterProblemIds(chapter, sectionId, pids)');
    expect(detail).to.include('content={activeChapter.content}');
    expect(detail).to.include('!course.content &&');
    expect(detail).to.include('!activeChapter.content');
    expect(detail).to.include('该小节暂无内容');
    expect(detail).to.match(/\{\(activeSection \? activeSection\.totalCount : activeChapter\.totalCount\) \? \(/);
    expect(detail).to.include('chapter._id === activeChapter?._id');
  });

  it('moves a claimed pid out of the other picker in the same chapter', () => {
    const chapter = {
      _id: 1,
      title: '第一章',
      content: '',
      pids: ['11', '12'],
      sections: [
        { _id: 1, title: '引入', content: '', pids: ['13'] },
        { _id: 2, title: '练习', content: '', pids: ['14'] },
      ],
      tids: '',
      problemSetId: '',
      stageIds: '',
    };
    expect(claimChapterProblemIds(chapter, 1, ['12', '13']).pids).to.deep.equal(['11']);
    expect(claimChapterProblemIds(chapter, 1, ['12', '13']).sections.map((section) => section.pids)).to.deep.equal([['12', '13'], ['14']]);
    expect(claimChapterProblemIds(chapter, 'loose', ['13', '11']).pids).to.deep.equal(['13', '11']);
    expect(claimChapterProblemIds(chapter, 'loose', ['13', '11']).sections.map((section) => section.pids)).to.deep.equal([[], ['14']]);
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
    expect(training).to.include('assertProblemSet(tdoc)');
    const trainingManage = readFileSync(resolve(root, 'src/pages/training-manage.tsx'), 'utf8');
    expect(trainingManage).to.include("Object.hasOwn(node, 'sections')");
    expect(trainingManage).to.include('题集阶段不支持小节');
    expect(training).to.include('throw new NotFoundError(localizedErrorText`file`)');
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

  it('binds one public mindmap and keeps ordinary chapter requests lazy', () => {
    const handler = readFileSync(resolve(root, '../hydrooj/src/handler/course.ts'), 'utf8');
    const editor = readFileSync(resolve(root, 'src/pages/course/editor.tsx'), 'utf8');
    const detail = readFileSync(resolve(root, 'src/pages/course/detail.tsx'), 'utf8');
    const mindmap = readFileSync(resolve(root, 'src/pages/course/mindmap.tsx'), 'utf8');
    expect(handler).to.include("activeView === 'mindmap' && tdoc.mindmapId");
    expect(handler).to.include('buildCourseMindmapView');
    expect(handler).to.include('getListViewableAuthorized');
    expect(handler).to.include('resolveProblemKnowledgeNodeIds');
    expect(editor).to.include('name="mindmapId"');
    expect(editor).to.include('不绑定知识导图');
    expect(editor).to.include('已公开');
    expect(detail).to.match(/\/course\/\$\{tid\}\?view=mindmap/);
    expect(detail).to.include('<CourseMindmapView');
    expect(detail).to.include('integrityControlled={data.integrityControlled === true}');
    expect(mindmap).to.include('collapsed={collapsed}');
    expect(mindmap).to.include('emphasizedIds={emphasizedIds}');
    expect(mindmap).to.match(/\?chapter=\$\{encodeURIComponent/);
    expect(mindmap).not.to.include('fetch(');
    expect(mindmap).not.to.include('loadNodeProblems');
  });

  it('attributes live-ref mindmap problems to the referencing course chapter', () => {
    const handler = readFileSync(resolve(root, '../hydrooj/src/handler/course.ts'), 'utf8');
    expect(handler).to.include('referencedPidsByChapter.get(chapter._id)');
    expect(handler).to.include('if (!chapters.length) continue');
  });

  it('keeps controlled course mindmap entries in an explicit chapter scope', () => {
    const problem = {
      domainId: 'system',
      docId: 11,
      pid: 'P11',
      title: '模拟',
      nodeIds: ['node-a'],
      chapters: [{ id: 3, title: '第三章' }],
    };
    expect(courseMindmapProblemHref('66b800000000000000000021', problem, true)).to.equal(
      '/p/P11?practiceContainerKind=course&practiceContainerId=66b800000000000000000021&practiceScopeKind=chapter&practiceScopeId=3',
    );
    expect(courseMindmapProblemHref('66b800000000000000000021', problem, false)).to.equal(
      '/p/P11?practiceContainerKind=course&practiceContainerId=66b800000000000000000021&practiceScopeKind=chapter&practiceScopeId=3',
    );
    expect(() => courseMindmapProblemHref('66b800000000000000000021', { ...problem, chapters: [] }, true)).to.throw('has no chapter scope');
  });

  it('lists a problem only on nodes directly selected by that problem', () => {
    const problems = [
      {
        domainId: 'system',
        docId: 11,
        pid: 'P11',
        title: '模拟',
        nodeIds: ['node-a', 'node-b'],
        chapters: [{ id: 1, title: '第一章' }],
      },
      {
        domainId: 'system',
        docId: 12,
        pid: 'P12',
        title: '其它',
        nodeIds: ['node-c'],
        chapters: [{ id: 2, title: '第二章' }],
      },
    ];
    expect(problemsForCourseMindmapNode(problems, 'node-a').map((problem) => problem.docId)).to.deep.equal([11]);
    expect(problemsForCourseMindmapNode(problems, 'node-b').map((problem) => problem.docId)).to.deep.equal([11]);
    expect(problemsForCourseMindmapNode(problems, 'ancestor')).to.deep.equal([]);
    expect(problemsForCourseMindmapNode(problems, null)).to.deep.equal([]);
  });

  it('keeps mobile outline drawers on shared Sheet with the same titles', () => {
    const detail = readFileSync(resolve(root, 'src/pages/course/detail.tsx'), 'utf8');
    const editor = readFileSync(resolve(root, 'src/pages/course/editor.tsx'), 'utf8');
    expect(detail).to.match(/import\s*\{[^}]*\bSheet\b[^}]*\}\s*from\s*'@\/components\/ui\/sheet'/);
    expect(detail).to.include('<SheetTitle>课程目录</SheetTitle>');
    expect(detail).to.include('<SheetBody');
    expect(detail).not.to.match(/<SheetContent[^>]*overflow-y-auto/);
    expect(editor).to.match(/import\s*\{[^}]*\bSheet\b[^}]*\}\s*from\s*'@\/components\/ui\/sheet'/);
    expect(editor).to.include('<SheetTitle>章节目录</SheetTitle>');
    expect(editor).to.include('<SheetBody');
    expect(editor).not.to.match(/<SheetContent[^>]*overflow-y-auto/);
  });
});
