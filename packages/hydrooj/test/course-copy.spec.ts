import { expect } from 'chai';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { resolve } from 'node:path';
import { copiedCourseTitle } from '../src/lib/course-copy';

function readSrc(relative: string) {
    return readFileSync(resolve(__dirname, '..', relative), 'utf8');
}

describe('course copy title', () => {
    it('appends a suffix and truncates to the title length gate', () => {
        expect(copiedCourseTitle('  操作系统  ')).to.equal('操作系统（副本）');
        expect(copiedCourseTitle('')).to.equal(null);
        expect(copiedCourseTitle('   ')).to.equal(null);
        const long = '字'.repeat(64);
        const copied = copiedCourseTitle(long);
        expect(copied).to.equal(`${'字'.repeat(60)}（副本）`);
        expect(copied && copied.length).to.equal(64);
    });
});

describe('course copy write path', () => {
    it('copies the saved course through create permission and revalidates chapters', () => {
        const handler = readSrc('src/handler/course.ts');
        expect(handler).to.include('async postCopy(');
        expect(handler).to.include("await oplog.log(this, 'course.copy'");
        expect(handler).to.include('copiedCourseTitle');
        expect(handler).to.include('parseChaptersJson(authoritativeDomainId, JSON.stringify(courseChapterEditorPayload(this.tdoc)))');
        expect(handler).to.include('PERM.PERM_CREATE_COURSE');
        expect(handler).to.include("this.url('course_edit', { tid: newTid })");
        const postCopy = handler.slice(handler.indexOf('async postCopy('), handler.indexOf('async postDelete('));
        expect(postCopy).to.include("kind: 'course'");
        expect(postCopy).to.include('assertProblemBankSelection');
        expect(postCopy).to.include('training.getPids(this.tdoc.dag || [])');
        expect(postCopy).not.to.include('pin:');
        expect(postCopy).not.to.include('maintainer');
        expect(postCopy).not.to.include('files:');
    });
});
