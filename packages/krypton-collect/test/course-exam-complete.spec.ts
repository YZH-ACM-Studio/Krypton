import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect } from 'chai';
import { describe, it } from 'node:test';

const handlerSource = readFileSync(resolve(__dirname, '../src/handler.ts'), 'utf8');
const helperSource = readFileSync(resolve(__dirname, '../src/course-exam-complete.ts'), 'utf8');
const modelSource = readFileSync(resolve(__dirname, '../src/model.ts'), 'utf8');

describe('collect optional course-exam-complete gate', () => {
    it('keeps the flag optional and fail-closed without a course or exam', () => {
        expect(modelSource).to.include('parseRequireCourseExamComplete');
        expect(modelSource).to.include('须先关联课程才能要求先完成结业考试');
        expect(helperSource).to.include('hasCompletedCourseExam');
        expect(helperSource).to.include('tryReadStoredCourseExam');
        expect(helperSource).to.include('须先完成课程结业考试才能提交');
        expect(helperSource).to.include('该课程未绑定结业考试，不能开启此门槛');
        expect(helperSource).not.to.match(/canEditCollect|PERM_EDIT_COURSE|role\s*===?\s*['"]default['"]/);
    });

    it('serializes the flag and student examGate from collect handlers', () => {
        expect(handlerSource).to.include('requireCourseExamComplete: doc.requireCourseExamComplete === true');
        expect(handlerSource).to.include('const hasExam = Boolean(');
        expect(handlerSource).to.include('examGate');
        expect(handlerSource).to.include('examLocked');
        expect(handlerSource).to.include('assertCanEnableRequireCourseExamComplete');
        expect(handlerSource).to.include('parseRequireCourseExamComplete(body.requireCourseExamComplete)');
    });
});
