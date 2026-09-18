import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EXAM_PAPER_FINALIZE_GRACE_MS } from '@hydrooj/common';
import { canEnterCourseExam, collectCourseExamVideos, computeCourseExamWatchState, COURSE_EXAM_ENTER_GRACE_MS, isCourseExamEnterClosed } from '../src/pages/course/course-exam-watch';
import type { CourseChapter, CourseExamBinding, CourseStudentVideo } from '../src/pages/course/types';

const uiRoot = resolve(import.meta.dirname, '..');
const hydroojRoot = resolve(uiRoot, '../hydrooj');
const catalogSource = readFileSync(resolve(uiRoot, '../../framework/framework/error-catalog.ts'), 'utf8');

function readUi(relative: string) {
  return readFileSync(resolve(uiRoot, relative), 'utf8');
}

function readHydrooj(relative: string) {
  return readFileSync(resolve(hydroojRoot, relative), 'utf8');
}

function studentVideo(partial: Partial<CourseStudentVideo> = {}): CourseStudentVideo {
  return {
    id: 'cv_abcdefghijklmnopqr1',
    title: '消防一',
    durationMs: 10_000,
    contentRevision: 1,
    playUrl: '/play/1',
    lastPosition: 0,
    coverageRatio: 0,
    completed: false,
    completedAt: null,
    ...partial,
  };
}

function chapter(partial: Partial<CourseChapter> & Pick<CourseChapter, '_id' | 'title'>): CourseChapter {
  return {
    content: '',
    pids: [1001],
    loosePids: [1001],
    videos: [],
    sections: [],
    completedPids: [],
    tids: [],
    progress: 0,
    doneCount: 0,
    totalCount: 1,
    ...partial,
  };
}

describe('course exam UI source contracts', () => {
  it('keeps completion-exam copy out of the “已证明看完” forbidden phrasing', () => {
    const editor = readUi('src/pages/course/editor.tsx');
    const detail = readUi('src/pages/course/detail.tsx');
    const settings = readUi('src/pages/course/course-exam-settings.tsx');
    const card = readUi('src/pages/course/course-exam-card.tsx');
    for (const source of [editor, detail, settings, card]) {
      expect(source).not.to.include('已证明看完');
    }
  });

  it('editor settings expose a course-level 结业考试 control, not a per-chapter 关联', () => {
    const editor = readUi('src/pages/course/editor.tsx');
    const settings = readUi('src/pages/course/course-exam-settings.tsx');
    const links = readUi('src/pages/course/chapter-links.tsx');
    expect(editor).to.include('结业考试');
    expect(editor).to.include('CourseExamSettings');
    expect(settings).to.include('rule=exam');
    expect(settings).to.include('全部章');
    expect(settings).to.include('指定章');
    expect(settings).to.include('整课百分比');
    expect(links).not.to.include('结业考试');
  });

  it('does not submit gate fields when no exam is selected', () => {
    const settings = readUi('src/pages/course/course-exam-settings.tsx');
    expect(settings).to.include('name="courseExamContestId"');
    expect(settings).to.match(/examId \? <input type="hidden" name="courseExamGate"/);
    expect(settings).to.match(/examId && gate === 'percent' \? <input type="hidden" name="courseExamPercent"/);
    expect(settings).to.match(/examId && gate === 'chapter' \? <input type="hidden" name="courseExamChapterId"/);
  });

  it('detail shows the locked/ready exam card with remaining-video copy and an exam-mode link', () => {
    const detail = readUi('src/pages/course/detail.tsx');
    const card = readUi('src/pages/course/course-exam-card.tsx');
    expect(detail).to.include('CourseExamCard');
    expect(card).to.include('还需看完');
    expect(card).to.include('/exam-mode/');
    expect(card).to.include('预览考试');
    expect(card).to.include('预览不能交卷');
    expect(card).to.include('学生需看完规定视频后才能参加');
    expect(card).to.match(/canManage \? \([\s\S]*预览考试/);
    expect(card).to.include('看完后才能参加考试');
    expect(card).to.include('老师还没开放视频，还不能参加考试');
    expect(card).to.include('state.locked && state.remaining === 0 && state.remainingVideos.length === 0');
    expect(card).not.to.include('还需看完 0');
    expect(card).to.include('canEnterCourseExam');
    expect(card).to.include('isCourseExamEnterClosed');
    expect(card).to.include('durationHours');
    expect(card).to.include('contest?.beginAt');
    expect(card).to.include('contest?.startAt');
    expect(card).to.include('考试已结束');
    expect(card).to.include('考试不存在');
    expect(card).to.include('!canEnter && windowClosed');
    expect(card).to.match(/canEnter \? \([\s\S]*进入考试/);
  });

  it('settings hint names binding rejects without new fields or courseGroupIds', () => {
    const settings = readUi('src/pages/course/course-exam-settings.tsx');
    expect(settings).to.include('绑定会被拒绝：client_required 考试、比赛分配名单、空试卷、没有已确认视频，或考试范围未覆盖课程班级。');
    expect(settings).not.to.include('courseGroupIds');
    expect(settings).not.to.include('已证明看完');
    expect([...settings.matchAll(/name="/g)]).to.have.lengthOf(4);
    expect(settings).to.include('name="courseExamContestId"');
    expect(settings).to.include('name="courseExamGate"');
    expect(settings).to.include('name="courseExamPercent"');
    expect(settings).to.include('name="courseExamChapterId"');
  });

  it('quoted Chinese-comma catalog keys stay quoted for the remaining-video sentence', () => {
    expect(catalogSource).to.include("'还不能参加考试，还需看完 {0} 个视频'");
    expect(catalogSource).to.include("'还需看完 {0} 个视频'");
    expect(catalogSource).to.include("'指定章节不存在，无法设置观看门槛'");
  });

  it('contest list UI is not a second courseExam filter', () => {
    const contest = readHydrooj('src/handler/contest.ts');
    const listStart = contest.indexOf('export class ContestListHandler');
    const listEnd = contest.indexOf('export class ContestDetailBaseHandler');
    const list = contest.slice(listStart, listEnd);
    expect(list).to.include('rule: { $in: rules }');
    expect(list).not.to.include('courseExam');
  });
});

describe('computeCourseExamWatchState', () => {
  const chapters: CourseChapter[] = [
    chapter({
      _id: 1,
      title: '一',
      videos: [
        studentVideo({ id: 'cv_chapter_confirmed01', title: '章确认片', completed: true, completedAt: '2026-09-01T00:00:00.000Z' }),
        studentVideo({ id: 'cv_chapter_unconfirm01', title: '未确认不应出现在学生投影' }),
      ],
      sections: [
        {
          _id: 11,
          title: '小节',
          content: '',
          pids: [2001],
          videos: [studentVideo({ id: 'cv_section_confirmed01', title: '节确认片', completed: true, completedAt: '2026-09-01T00:00:00.000Z' })],
          completedPids: [],
          progress: 0,
          doneCount: 0,
          totalCount: 1,
        },
      ],
    }),
    chapter({
      _id: 2,
      title: '二',
      videos: [studentVideo({ id: 'cv_chapter2_confirmed1', title: '第二章片' })],
    }),
  ];

  it('includes section videos, ignores problems, and uses floor for percent', () => {
    const all = collectCourseExamVideos(chapters, { contestId: 'exam', gate: 'all' });
    expect(all.map((video) => video.id)).to.deep.equal(['cv_chapter_confirmed01', 'cv_chapter_unconfirm01', 'cv_section_confirmed01', 'cv_chapter2_confirmed1']);
    const chapterScope = collectCourseExamVideos(chapters, { contestId: 'exam', gate: 'chapter', chapterId: 1 });
    expect(chapterScope).to.have.length(3);
    const percent66: CourseExamBinding = { contestId: 'exam', gate: 'percent', percent: 66 };
    const percent67: CourseExamBinding = { contestId: 'exam', gate: 'percent', percent: 67 };
    const percentPass = computeCourseExamWatchState(all.filter((video) => video.id !== 'cv_chapter_unconfirm01'), percent66);
    expect(Math.floor((100 * 2) / 3)).to.equal(66);
    expect(percentPass.locked).to.equal(false);
    const percentFail = computeCourseExamWatchState(all.filter((video) => video.id !== 'cv_chapter_unconfirm01'), percent67);
    expect(percentFail.locked).to.equal(true);
    expect(percentFail.remaining).to.be.greaterThan(0);
  });

  it('lets attended students enter and hides the link after the grace window', () => {
    const endAt = '2026-09-17T00:00:00.000Z';
    const endMs = Date.parse(endAt);
    expect(COURSE_EXAM_ENTER_GRACE_MS).to.equal(60_000);
    expect(COURSE_EXAM_ENTER_GRACE_MS).to.equal(EXAM_PAPER_FINALIZE_GRACE_MS);
    expect(canEnterCourseExam({ watchLocked: true, attend: true, endAt, now: endMs })).to.equal(true);
    expect(canEnterCourseExam({ watchLocked: false, attend: false, endAt, now: endMs })).to.equal(false);
    expect(canEnterCourseExam({
      watchLocked: false,
      attend: false,
      beginAt: '2026-09-16T00:00:00.000Z',
      endAt,
      now: endMs,
    })).to.equal(false);
    expect(canEnterCourseExam({
      watchLocked: true,
      attend: true,
      beginAt: '2026-09-16T00:00:00.000Z',
      endAt,
      now: endMs + 1,
    })).to.equal(true);
    expect(canEnterCourseExam({ watchLocked: false, attend: false, missing: true })).to.equal(false);
    expect(canEnterCourseExam({
      watchLocked: false,
      attend: false,
      endAt,
      now: endMs + COURSE_EXAM_ENTER_GRACE_MS + 1,
    })).to.equal(false);
    expect(canEnterCourseExam({
      watchLocked: true,
      attend: true,
      endAt,
      now: endMs + COURSE_EXAM_ENTER_GRACE_MS + 1,
    })).to.equal(false);
    expect(canEnterCourseExam({ watchLocked: true, attend: false })).to.equal(false);
    expect(canEnterCourseExam({ watchLocked: false, attend: false })).to.equal(true);
  });

  it('refuses a duration start that cannot get a full window', () => {
    const beginAt = '2026-09-18T00:00:00.000Z';
    const endAt = '2026-09-18T03:00:00.000Z';
    const durationHours = 1.5;
    const lastStart = Date.parse('2026-09-18T01:30:00.000Z');
    const startAt = '2026-09-18T01:00:00.000Z';
    const personalEnd = Date.parse('2026-09-18T02:30:00.000Z');
    expect(canEnterCourseExam({
      watchLocked: false,
      attend: false,
      beginAt,
      endAt,
      durationHours,
      now: lastStart,
    })).to.equal(true);
    expect(canEnterCourseExam({
      watchLocked: false,
      attend: false,
      beginAt,
      endAt,
      durationHours,
      now: lastStart + 1,
    })).to.equal(false);
    expect(canEnterCourseExam({
      watchLocked: true,
      attend: true,
      beginAt,
      endAt,
      durationHours,
      now: lastStart + 1,
    })).to.equal(false);
    expect(canEnterCourseExam({
      watchLocked: true,
      attend: true,
      beginAt,
      endAt,
      startAt,
      durationHours,
      now: personalEnd,
    })).to.equal(true);
    expect(canEnterCourseExam({
      watchLocked: true,
      attend: true,
      beginAt,
      endAt,
      startAt,
      durationHours,
      now: personalEnd + COURSE_EXAM_ENTER_GRACE_MS + 1,
    })).to.equal(false);
    expect(canEnterCourseExam({
      watchLocked: false,
      attend: false,
      beginAt,
      endAt,
      durationHours,
      now: Date.parse('2026-09-17T23:59:59.000Z'),
    })).to.equal(false);
    expect(isCourseExamEnterClosed({
      beginAt,
      endAt,
      durationHours,
      now: Date.parse('2026-09-17T23:59:59.000Z'),
    })).to.equal(false);
    expect(isCourseExamEnterClosed({
      beginAt,
      endAt,
      durationHours,
      now: lastStart + 1,
    })).to.equal(true);
    expect(isCourseExamEnterClosed({
      attend: true,
      beginAt,
      endAt,
      startAt,
      durationHours,
      now: personalEnd,
    })).to.equal(false);
    expect(isCourseExamEnterClosed({
      attend: true,
      beginAt,
      endAt,
      startAt,
      durationHours,
      now: personalEnd + COURSE_EXAM_ENTER_GRACE_MS + 1,
    })).to.equal(true);
  });

  it('fail-closes when the confirmed/student-visible list is empty', () => {
    const allGate: CourseExamBinding = { contestId: 'exam', gate: 'all' };
    const percentGate: CourseExamBinding = { contestId: 'exam', gate: 'percent', percent: 100 };
    const emptyAll = computeCourseExamWatchState([], allGate);
    const emptyPercent = computeCourseExamWatchState([], percentGate);
    expect(emptyAll).to.deep.equal({ locked: true, remaining: 0, remainingVideos: [] });
    expect(emptyPercent).to.deep.equal({ locked: true, remaining: 0, remainingVideos: [] });
  });
});
