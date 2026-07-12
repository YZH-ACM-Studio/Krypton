import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect } from 'chai';
import { describe, it } from 'node:test';
import { STATUS, STATUS_CODES, STATUS_TEXTS } from '@hydrooj/common';

const root = resolve(__dirname, '..');

describe('P3.10 subjective lifecycle contract', () => {
    it('defines manual graded as a completed non-failure status', () => {
        expect(STATUS.STATUS_MANUAL_GRADED).to.equal(12);
        expect(STATUS_TEXTS[12]).to.equal('Manual Graded');
        expect(STATUS_CODES[12]).not.to.be.oneOf(['fail', 'pending', 'progress']);
        const scoreboard = readFileSync(resolve(root, '../scoreboard-xcpcio/index.ts'), 'utf8');
        expect(scoreboard).to.include('[STATUS.STATUS_MANUAL_GRADED]');
    });

    it('creates manual records as waiting but already judged and never queues them', () => {
        const source = readFileSync(resolve(root, 'src/model/record.ts'), 'utf8');
        expect(source).to.include("if (args.type === 'manual')");
        expect(source).to.include('data.manualPending = true');
        expect(source).to.include('data.judgeAt = new Date()');
        expect(source).to.include('addTask = false');
    });

    it('excludes manual records from reset, direct rejudge, and stuck queue semantics', () => {
        const record = readFileSync(resolve(root, 'src/model/record.ts'), 'utf8');
        const problem = readFileSync(resolve(root, 'src/handler/problem.ts'), 'utf8');
        const judgeops = readFileSync(resolve(root, 'src/handler/judgeops.ts'), 'utf8');
        expect(record).to.include('人工阅卷记录不能重判');
        expect(problem).to.include('manualGrade: { $exists: false }');
        expect(judgeops).to.include('manualPending: { $ne: true }');
        expect(judgeops).to.include('manualGrade: { $exists: false }');
    });

    it('removes the composite subjective score scheme and old grading route', () => {
        const types = readFileSync(resolve(root, '../common/types.ts'), 'utf8');
        const config = readFileSync(resolve(root, 'src/lib/problem-config.ts'), 'utf8');
        const paperCenter = readFileSync(resolve(root, 'src/handler/paper-center.ts'), 'utf8');
        expect(types).not.to.include('subjective?:');
        expect(config).not.to.include('mergeSubjectiveScores');
        expect(paperCenter).not.to.include('/paper-center/grading');
    });

    it('authorizes only the container owner or a site administrator to grade', () => {
        const source = readFileSync(resolve(root, 'src/handler/manual-grading.ts'), 'utf8');
        expect(source).to.include('this.tdoc.owner !== this.user._id');
        expect(source).to.include('this.user.hasPriv(PRIV.PRIV_EDIT_SYSTEM)');
        expect(source).not.to.include('this.user.own(this.tdoc)');
        expect(source).not.to.include('getMaintainableAuthorized');
    });

    it('uses raw manual records in exam and only allows the three scoring rules', () => {
        const paper = readFileSync(resolve(root, 'src/handler/paper.ts'), 'utf8');
        const problem = readFileSync(resolve(root, 'src/handler/problem.ts'), 'utf8');
        expect(paper).to.include("effectiveProblemKind(pdoc) === 'subjective'");
        expect(paper).to.include("type: isSubjective ? 'manual' : 'judge'");
        expect(paper).to.include("typeof rawSubjectiveAnswer !== 'string'");
        expect(problem).to.include("['exam', 'homework', 'oi'].includes(this.tdoc.rule)");
    });
});
