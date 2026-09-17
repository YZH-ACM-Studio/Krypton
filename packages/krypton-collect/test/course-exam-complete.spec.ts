import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect } from 'chai';
import { describe, it } from 'node:test';

const Module = require('module');
const framework = require('../../../framework/framework');

const handlerSource = readFileSync(resolve(__dirname, '../src/handler.ts'), 'utf8');
const helperSource = readFileSync(resolve(__dirname, '../src/course-exam-complete.ts'), 'utf8');
const querySource = readFileSync(resolve(__dirname, '../src/course-query.ts'), 'utf8');
const indexSource = readFileSync(resolve(__dirname, '../index.ts'), 'utf8');
const modelSource = readFileSync(resolve(__dirname, '../src/model.ts'), 'utf8');

const helperPath = require.resolve('../src/course-exam-complete.ts');
const errorsPath = require.resolve('../src/errors.ts');
const originalLoad = Module._load;
const hydroojStub = {
    ...framework,
    resolveCourseExamCompletion: async () => ({ complete: false, lockKind: 'open' }),
    TrainingModel: { async get() { throw Object.assign(new Error('missing'), { name: 'TrainingNotFoundError' }); } },
    TrainingNotFoundError: class TrainingNotFoundError extends Error { name = 'TrainingNotFoundError'; },
    tryReadStoredCourseExam: () => null,
};

Module._load = function load(request: string, parent: NodeModule, isMain: boolean) {
    const filename = parent?.filename;
    if ((filename === helperPath || filename === errorsPath) && request === 'hydrooj') {
        return hydroojStub;
    }
    return originalLoad.call(this, request, parent, isMain);
};

let mapCourseExamCompletionToCollectGate: (
    result: { complete: boolean; lockKind: string },
    contestId: { toHexString(): string },
) => { required: boolean; locked: boolean; examHref?: string; message?: string };
try {
    delete require.cache[helperPath];
    delete require.cache[errorsPath];
    ({ mapCourseExamCompletionToCollectGate } = require(helperPath));
} finally {
    Module._load = originalLoad;
}

const contestId = { toHexString: () => '66c0000000000000000000aa' };

describe('collect optional course-exam-complete gate', () => {
    it('keeps the flag optional and fail-closed without a course or exam', () => {
        expect(modelSource).to.include('parseRequireCourseExamComplete');
        expect(modelSource).to.include('须先关联课程才能要求先完成结业考试');
        expect(helperSource).to.include('resolveCourseExamCompletion');
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

    it('exports existsRequiringCourseExam and uses the hydrooj completion adapter', () => {
        expect(indexSource).to.match(/export \{[^}]*existsRequiringCourseExam[^}]*\} from '\.\/src\/course-query'/);
        expect(querySource).to.include('export async function existsRequiringCourseExam');
        expect(querySource).to.include('requireCourseExamComplete: true');
        expect(querySource).to.include("status: { $in: ['draft', 'published', 'closed'] }");
        expect(querySource).not.to.include('courseGroupIds');
        expect(helperSource).to.include('resolveCourseExamCompletion');
        expect(helperSource).not.to.include('(hydrooj as any).resolveCourseExamCompletion');
        expect(helperSource).not.to.include('hasCompletedCourseExam');
        expect(helperSource).to.include('考试已结束且未参加，无法提交');
        expect(helperSource).not.to.match(/COURSE_EXAM_FINALIZE_GRACE|endAt\s*\+|60_000|shouldSettleCourseExam/);
    });

    it('maps hydrooj completion lock kinds to collect examGate messages', () => {
        expect(mapCourseExamCompletionToCollectGate({ complete: true, lockKind: 'none' }, contestId)).to.deep.equal({
            required: true,
            locked: false,
            examHref: '/exam-mode/66c0000000000000000000aa',
        });
        expect(mapCourseExamCompletionToCollectGate({ complete: false, lockKind: 'open' }, contestId)).to.deep.equal({
            required: true,
            locked: true,
            examHref: '/exam-mode/66c0000000000000000000aa',
            message: '须先完成课程结业考试才能提交',
        });
        expect(mapCourseExamCompletionToCollectGate({ complete: false, lockKind: 'never_attended_closed' }, contestId)).to.deep.equal({
            required: true,
            locked: true,
            message: '考试已结束且未参加，无法提交',
        });
        expect(mapCourseExamCompletionToCollectGate({ complete: false, lockKind: 'closed_incomplete' }, contestId)).to.deep.equal({
            required: true,
            locked: true,
            message: '考试已结束且未能交卷，无法提交',
        });
        expect(mapCourseExamCompletionToCollectGate({ complete: false, lockKind: 'missing_contest' }, contestId)).to.deep.equal({
            required: true,
            locked: true,
            message: '该收集要求先完成结业考试，但课程未绑定考试',
        });
        expect(() => mapCourseExamCompletionToCollectGate({ complete: false, lockKind: 'none' }, contestId)).to.throw(TypeError);
    });
});
