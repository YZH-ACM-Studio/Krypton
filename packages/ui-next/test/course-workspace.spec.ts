import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { claimChapterProblemIds } from '../src/pages/course/chapter-draft.ts';
import { resolveChapterId, resolveSectionId, withChapterQuery } from '../src/pages/course/chapter-query.ts';
import { problemsForCourseMindmapNode } from '../src/pages/course/mindmap-state.ts';
import { courseMindmapProblemHref } from '../src/pages/course/mindmap.tsx';
import { courseAssignsUserGroups } from '../src/pages/course/types.ts';

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
    const students = readFileSync(resolve(root, 'src/pages/course/workbench/students-tab.tsx'), 'utf8');
    const settings = readFileSync(resolve(root, 'src/pages/course/workbench/settings-tab.tsx'), 'utf8');
    const chapterPanel = readFileSync(resolve(root, 'src/pages/course/workbench/chapter-panel.tsx'), 'utf8');
    for (const slot of ['chapterContent', 'files']) {
      expect(detail).to.include(`data-course-slot="${slot}"`);
    }
    expect(detail).to.include('data-course-slot="quiz"');
    expect(students).to.include('name="courseGroupIds"');
    expect(settings).to.include('CourseAssignForm');
    expect(settings).to.include('name="content"');
    expect(chapterPanel).to.include('CourseVideoEditor');
    const assign = readFileSync(resolve(root, 'src/pages/course/assign.tsx'), 'utf8');
    expect(assign).to.match(/new URLSearchParams\(\{\s*operation: 'assign',\s*expectedOwner:/);
    expect(assign).not.to.match(/URLSearchParams\([\s\S]*title:/);
    const list = readFileSync(resolve(root, 'src/pages/course/list.tsx'), 'utf8');
    expect(list).to.include('CourseAssignDialog');
    expect(list).to.include('分配');
    const outline = readFileSync(resolve(root, 'src/pages/course/chapter-outline.tsx'), 'utf8');
    expect(outline).to.include('添加小节');
    expect(outline).to.include('onAddSection');
  });

  it('uses server capabilities, true totals, enrollment status, and one active chapter', () => {
    const handler = readFileSync(resolve(root, '../hydrooj/src/handler/course.ts'), 'utf8');
    const list = readFileSync(resolve(root, 'src/pages/course/list.tsx'), 'utf8');
    const detail = readFileSync(resolve(root, 'src/pages/course/detail.tsx'), 'utf8');
    const students = readFileSync(resolve(root, 'src/pages/course/workbench/students-tab.tsx'), 'utf8');
    const settings = readFileSync(resolve(root, 'src/pages/course/workbench/settings-tab.tsx'), 'utf8');
    expect(handler).to.include('const [tdocs, tpcount, tcount]');
    expect(handler).to.include('canCreate,');
    expect(handler).to.include('canAssign,');
    expect(handler).to.include('async postAssign(');
    expect(handler).to.include('async postCopy(');
    expect(handler).to.include("@param('title', Types.Title, true)");
    expect(handler).to.match(/if \(this\.args\?\.operation \|\| this\.request\.body\?\.operation\) return;/);
    expect(handler).to.include('training.assignCourseOwnership');
    expect(handler).to.include('managedIds,');
    expect(handler).to.include('canManage,');
    expect(handler).to.include('tsdoc,');
    expect(list).to.include('Number(data.tcount)');
    expect(detail).to.include('const activeChapter = chapters.find');
    expect(detail).to.include('selectSection');
    expect(detail).to.include('本章小节');
    expect(detail).to.include('view=roster');
    expect(detail).to.include('布置收集');
    expect(detail).to.include('本课收集');
    // eslint-disable-next-line no-template-curly-in-string
    expect(detail).to.include('/admin/collect/create?fromCourse=${encodeURIComponent(tid)}');
    expect(handler).to.include('listByCourse');
    expect(detail).to.include('创建小测');
    expect(detail).not.to.include('创建本章小测');
    expect(handler).to.include("view === 'roster'");
    expect(handler).to.include('canViewRoster');
    expect(handler).to.include('loadCourseExamRoster');
    expect(handler).to.include('rosterExam');
    expect(detail).to.include('readPracticeRosterExamMeta');
    expect(detail).to.include('rosterExamWarning');
    expect(handler).to.include('courseHidden');
    expect(handler).to.include('existsByCourse');
    expect(handler).to.include('该课程已隐藏');
    expect(handler).to.include('课程仍有文件收集，不能删除');
    expect(students).to.include('对学生隐藏');
    expect(settings).to.include('name="operation" value="delete"');
    expect(settings).to.include('删除课程');
    expect(list).to.include('已隐藏');
    expect(list).to.include('courseAssignsUserGroups(course)');
    expect(detail).to.include('已对学生隐藏');
    expect(detail).to.include('!courseAssignsUserGroups(course) && data.canEnroll');
    expect(detail).to.include('!courseAssignsUserGroups(course) && data.tsdoc?.enroll');
    expect(detail).to.not.include('chapters.map((ch');
    expect(courseAssignsUserGroups({})).to.equal(false);
    expect(courseAssignsUserGroups({ courseGroupIds: [] })).to.equal(false);
    expect(courseAssignsUserGroups({ courseGroupIds: ['g1'] })).to.equal(true);
  });

  it('copies a saved course into a new document from the editor and detail', () => {
    const handler = readFileSync(resolve(root, '../hydrooj/src/handler/course.ts'), 'utf8');
    const settings = readFileSync(resolve(root, 'src/pages/course/workbench/settings-tab.tsx'), 'utf8');
    const detail = readFileSync(resolve(root, 'src/pages/course/detail.tsx'), 'utf8');
    expect(handler).to.include('async postCopy(');
    expect(handler).to.include("await oplog.log(this, 'course.copy'");
    expect(handler).to.include('copiedCourseTitle');
    expect(handler).to.include('canCreate: canCreateCourse(this.user)');
    expect(settings).to.include('复制为新课程');
    expect(settings).to.include("operation: 'copy'");
    expect(settings).to.include('data.canCreate');
    expect(settings).to.include('请先保存课程修改。复制使用已保存的章节');
    expect(detail).to.include('复制为新课程');
    expect(detail).to.include('name="operation" value="copy"');
    expect(detail).to.include('data.canManage && data.canCreate');
  });

  it('edits chapter markdown in the chapter panel and renders it on the detail page', () => {
    const panel = readFileSync(resolve(root, 'src/pages/course/workbench/chapter-panel.tsx'), 'utf8');
    const model = readFileSync(resolve(root, 'src/pages/course/workbench/model.ts'), 'utf8');
    const detail = readFileSync(resolve(root, 'src/pages/course/detail.tsx'), 'utf8');
    expect(panel).to.include('<MarkdownEditor');
    expect(panel).to.include('value={content}');
    expect(model).to.include('content: chapter.content');
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
      videos: [],
      sections: [
        { _id: 1, title: '引入', content: '', pids: ['13'], videos: [] },
        { _id: 2, title: '练习', content: '', pids: ['14'], videos: [] },
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
    const settings = readFileSync(resolve(root, 'src/pages/course/workbench/settings-tab.tsx'), 'utf8');
    const detail = readFileSync(resolve(root, 'src/pages/course/detail.tsx'), 'utf8');
    expect(handler).to.include('return `course/');
    expect(handler).to.include("ctx.Route('course_files', '/course/:tid/file'");
    expect(handler).to.include("ctx.Route('course_file_download', '/course/:tid/file/:filename'");
    expect(handler).to.include("@post('filename', Types.Filename)");
    expect(handler).to.include('listedCourseFile(tdoc, filename)');
    const download = handler.slice(handler.indexOf('class CourseFileDownloadHandler'));
    expect(download.indexOf('await assertCourseAccessible')).to.be.lessThan(download.indexOf('listedCourseFile(tdoc, filename)'));
    expect(training).to.include('assertProblemSet(tdoc)');
    const trainingManage = readFileSync(resolve(root, 'src/pages/training-manage.tsx'), 'utf8');
    const filesPage = trainingManage.slice(trainingManage.indexOf('export function TrainingFilesPage'));
    expect(filesPage.startsWith('export function TrainingFilesPage')).to.equal(true);
    expect(filesPage).to.include('value="upload_file"');
    expect(filesPage).to.include('value="delete_files"');
    expect(filesPage).to.include('name="file"');
    expect(filesPage).to.include('ProblemSetFilesPage');
    expect(filesPage).not.to.include('/training/');
    expect(filesPage).not.to.include('TrainingEditPage');
    expect(filesPage).not.to.include('ProblemSetManagePage');
    expect(training).to.include('throw new NotFoundError(localizedErrorText`file`)');
    expect(settings).to.include('<FileUploader');
    expect(settings).to.include('uploadConcurrency={1}');
    expect(uploader).to.include('limit: uploadConcurrency');
    expect(settings).to.include('void refreshFiles()');
    expect(settings).to.not.include('location.reload');
    expect(detail).to.include('encodeURIComponent(file.name)');
  });

  it('passes fromCourse and chapter into course quiz links', () => {
    const detail = readFileSync(resolve(root, 'src/pages/course/detail.tsx'), 'utf8');
    const menu = readFileSync(resolve(root, 'src/pages/course/workbench/add-content.tsx'), 'utf8');
    expect(detail).to.include('/homework/create?fromCourse=');
    expect(detail).to.match(/&chapter=\$\{activeChapter\._id\}/);
    expect(menu).to.include('/teach/new?');
    expect(menu).to.include('fromCourse: courseId');
    expect(menu).to.include('chapter: String(chapterId)');
    expect(menu).to.include('saved && !dirty');
    expect(menu).to.include('先保存课程修改');
    expect(detail).to.include('data.canCreateQuiz');
    const courseHandler = readFileSync(resolve(root, '../hydrooj/src/handler/course.ts'), 'utf8');
    expect(courseHandler).to.include('canCreateQuiz: canManage && canCreateCourseQuiz(this.user)');
    expect(courseHandler).to.include('canCreateQuiz: !!this.tdoc && canCreateCourseQuiz(this.user)');
  });

  it('submits fromCourse and chapter for a course quiz', () => {
    const create = readFileSync(resolve(root, 'src/pages/teach/new.tsx'), 'utf8');
    const forms = readFileSync(resolve(root, 'src/pages/teach/legacy-forms.ts'), 'utf8');
    const submit = create.slice(create.indexOf('function formBody'));
    const snapshotQuery = create.slice(create.indexOf('function snapshotQuery'), create.indexOf('function submittedRule'));
    const homeworkBody = forms.slice(forms.indexOf('export function homeworkFormBody'));
    expect(submit.startsWith('function formBody')).to.equal(true);
    expect(submit).to.include('homeworkFormBody(applyHomework(');
    expect(submit).to.include('fromCourse: args.fromCourse');
    expect(snapshotQuery).to.include("query.set('fromCourse', fromCourse.courseId)");
    expect(snapshotQuery).to.include("query.set('chapter', String(fromCourse.chapterId))");
    expect(homeworkBody).to.include("body.set('fromCourse', state.fromCourse.courseId)");
    expect(homeworkBody).to.include("body.set('chapter', String(state.fromCourse.chapterId))");
    const fallback = readFileSync(resolve(root, '../ui-default/templates/homework_edit.html'), 'utf8');
    expect(fallback).to.include('name="fromCourse"');
    expect(fallback).to.include('name="chapter"');
    expect(fallback).to.include('name="participantScopeMode"');
    expect(fallback).to.include('name="participantGroupIds"');
  });

  it('binds one public mindmap and keeps ordinary chapter requests lazy', () => {
    const handler = readFileSync(resolve(root, '../hydrooj/src/handler/course.ts'), 'utf8');
    const mindmapTab = readFileSync(resolve(root, 'src/pages/course/workbench/mindmap-tab.tsx'), 'utf8');
    const workbenchModel = readFileSync(resolve(root, 'src/pages/course/workbench/model.ts'), 'utf8');
    const detail = readFileSync(resolve(root, 'src/pages/course/detail.tsx'), 'utf8');
    const mindmap = readFileSync(resolve(root, 'src/pages/course/mindmap.tsx'), 'utf8');
    expect(handler).to.include("activeView === 'mindmap' ? courseMindmapForView");
    expect(handler).to.include('buildCourseMindmapView');
    expect(handler).to.include('getListViewableAuthorized');
    expect(handler).to.include('resolveProblemKnowledgeNodeIds');
    expect(mindmapTab).to.include('name="mindmapId"');
    expect(mindmapTab).to.include('不绑定知识导图');
    expect(mindmapTab).to.include('已公开');
    expect(mindmapTab).to.include('创建本课导图');
    expect(mindmapTab).to.include('从导图生成章节');
    expect(mindmapTab).to.include("operation: 'generate_chapters'");
    expect(workbenchModel).to.include('sourceMindmapNodeId');
    expect(mindmapTab).to.include('删除本课导图');
    expect(mindmapTab).to.include('请先保存课程');
    const mindmapEditor = readFileSync(resolve(root, 'src/pages/course/mindmap-editor.tsx'), 'utf8');
    expect(mindmapEditor).to.include('已不在本课');
    expect(mindmapEditor).to.include('请先保存导图');
    expect(mindmapEditor).to.include('请先保存节点');
    expect(mindmapEditor).to.include('if (rejectUnsaved()) return;');
    expect(mindmapEditor).to.include('if (id === selectedId) return;');
    expect(mindmapEditor).to.include('pinsInStoredOrder');
    expect(handler).to.include('staleReferencedProblemSetIds');
    expect(handler).to.include('liveReferencedPidsForCourseGet');
    expect(detail).to.include('staleReferencedProblemSetIds');
    expect(handler).to.include('course references an unavailable public mindmap');
    const editHandler = handler.slice(handler.indexOf('class CourseEditHandler'), handler.indexOf('class CourseFilesHandler'));
    expect(editHandler).to.include('canManageCourse(this.user, this.tdoc, PERM.PERM_EDIT_COURSE)');
    expect(editHandler).to.include('await assertCourseAccessible(authoritativeDomainId, this.user._id, this.tdoc)');
    expect(editHandler).to.include('await assertCourseAccessible(domainId, this.user._id, tdoc)');
    expect(editHandler).not.to.include('if (!this.user.own(this.tdoc)) this.checkPerm(PERM.PERM_EDIT_COURSE)');
    const filesHandler = handler.slice(handler.indexOf('class CourseFilesHandler'), handler.indexOf('class CourseFileDownloadHandler'));
    expect(filesHandler).to.include('canManageCourse(this.user, this.tdoc, PERM.PERM_EDIT_COURSE)');
    expect(filesHandler).to.include('await assertCourseAccessible(this.domainId, this.user._id, this.tdoc)');
    expect(readFileSync(resolve(root, '../hydrooj/src/lib/course-access.ts'), 'utf8')).to.include(
      'throw new TrainingNotFoundError(domainId, tdoc.docId)',
    );
    expect(handler).to.match(/Course editor found unavailable mindmap[\s\S]{0,400}throw new TypeError/);
    expect(detail).to.match(/\/course\/\$\{tid\}\?view=mindmap/);
    expect(detail).to.include('<CourseMindmapView');
    expect(detail).to.include('integrityControlled={data.integrityControlled === true}');
    expect(mindmap).to.include('collapsed={collapsed}');
    expect(mindmap).to.include('emphasizedIds={emphasizedIds}');
    expect(mindmap).to.match(/\?chapter=\$\{encodeURIComponent/);
    expect(mindmap).not.to.include('fetch(');
    expect(mindmap).not.to.include('loadNodeProblems');
    const videoStats = readFileSync(resolve(root, 'src/pages/course/video-stats.tsx'), 'utf8');
    expect(videoStats).to.include("data.rosterUnavailable === 'invalid_groups'");
    expect(videoStats).to.include('课程绑定的班级引用已失效，无法出观看名单');
    expect(videoStats).to.include('MiniTabs');
    expect(videoStats).to.include('搜索学号或姓名');
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
    expect(editor).to.match(/import\s*\{[^}]*\bSheet\b[^}]*\}\s*from\s*'@\/components\/ui\/sheet'/);
    expect(editor).to.include('大纲');
    expect(editor).to.include('<SheetBody');
  });
});
