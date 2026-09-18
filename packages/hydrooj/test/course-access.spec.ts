import { expect } from 'chai';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function readSrc(relative: string) {
    return readFileSync(resolve(__dirname, '..', relative), 'utf8');
}

describe('course hide and delete gates', () => {
    it('hides unpublished courses from students and keeps managers inside', () => {
        const access = readSrc('src/lib/course-access.ts');
        expect(access).to.include('export function isCourseHidden');
        expect(access).to.include('return tdoc.courseHidden === true');
        expect(access).to.include('if (isCourseHidden(tdoc)) return false');
        expect(access).to.include('export async function assertCourseAccessible');
        expect(access).to.include('throw new TrainingNotFoundError(domainId, tdoc.docId)');
        const handler = readSrc('src/handler/course.ts');
        expect(handler).not.to.include('Not a course');
        expect(handler).not.to.include('你不在该课程的可见范围内');
        expect(handler).to.include('rosterWarning');
        expect(handler).to.include('await assertCourseAccessible(');
        expect(handler).to.include('throw new TrainingNotFoundError(domainId, tid)');
        expect(handler).to.include('courseHidden: { $ne: true }');
        expect(handler).to.include('该课程已隐藏');
        expect(handler).to.include("@param('courseHidden', Types.Boolean, true)");
        expect(handler).to.include('courseHidden: Boolean(courseHidden)');
        expect(handler).to.include('courseHidden: isCourseHidden(this.tdoc)');
        const video = readSrc('src/handler/course-video.ts');
        expect(video).to.include('isCourseHidden(tdoc)');
        expect(video).to.include('该课程已隐藏');
        expect(video).to.include('throw new TrainingNotFoundError(domainId, tdoc.docId)');
        expect(video).to.include('throw new PermissionError(PERM.PERM_EDIT_COURSE)');
        const download = handler.slice(handler.indexOf('class CourseFileDownloadHandler'), handler.indexOf('export async function apply'));
        expect(download).to.include('isCourseHidden(tdoc)');
        expect(download).to.include('该课程已隐藏');
        expect(download).to.include('await assertCourseAccessible(domainId, this.user._id, tdoc)');
        expect(download).not.to.include('PERM.PERM_VIEW_TRAINING');
        const enroll = handler.slice(handler.indexOf('async postEnroll'), handler.indexOf('class CourseEditHandler'));
        expect(enroll).to.include('if (courseAssignsUserGroups(tdoc))');
        expect(enroll).to.include('指定用户组的课程不需要报名');
        expect(enroll).to.include('该课程已隐藏');
        expect(enroll).not.to.include('PERM.PERM_VIEW_TRAINING');
        expect(access).to.include('export function courseAssignsUserGroups');
        expect(handler).to.include('canEnroll: canDownloadFiles && !courseAssignsUserGroups(tdoc) && !tsdoc?.enroll');
        const editor = handler.slice(handler.indexOf('class CourseEditHandler'), handler.indexOf('class CourseFilesHandler'));
        const editorGet = editor.slice(editor.indexOf('async get('), editor.indexOf('async postUpdate('));
        expect(editorGet).to.include('listCourseMindmapOptions()');
        const integrity = readSrc('src/model/practice-integrity-access.ts');
        expect(integrity).to.include('isCourseHidden(tdoc)');
    });

    it('refuses to delete a course that still has file collections', () => {
        const handler = readSrc('src/handler/course.ts');
        expect(handler).to.include('existsByCourse');
        expect(handler).to.include('课程仍有文件收集，不能删除');
        expect(handler).to.include('deleteCourseVideoProgress');
        expect(handler).to.include('courseFilePrefix(domainId, tid)');
        const collect = readSrc('../krypton-collect/src/course-query.ts');
        expect(collect).to.include('export async function existsByCourse');
    });
});
