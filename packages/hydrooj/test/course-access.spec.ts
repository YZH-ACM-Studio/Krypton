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
        const handler = readSrc('src/handler/course.ts');
        expect(handler).to.include('courseHidden: { $ne: true }');
        expect(handler).to.include('该课程已隐藏');
        expect(handler).to.include("@param('courseHidden', Types.Boolean, true)");
        expect(handler).to.include('courseHidden: Boolean(courseHidden)');
        expect(handler).to.include('courseHidden: isCourseHidden(this.tdoc)');
        const video = readSrc('src/handler/course-video.ts');
        expect(video).to.include('isCourseHidden(tdoc)');
        expect(video).to.include('该课程已隐藏');
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
