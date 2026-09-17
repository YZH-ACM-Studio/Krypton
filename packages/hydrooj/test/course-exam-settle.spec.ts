import { expect } from 'chai';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import { COURSE_EXAM_FINALIZE_GRACE_MS, shouldSettleCourseExam } from '../src/lib/course-exam-complete';

const hydroojRoot = resolve(__dirname, '..');

function readHydrooj(relative: string) {
    return readFileSync(resolve(hydroojRoot, relative), 'utf8');
}

function extractExportedFunction(source: string, name: string) {
    const start = source.search(new RegExp(`export async function ${name}\\b`));
    if (start < 0) throw new Error(`missing ${name}`);
    const header = source.slice(start);
    const body = header.match(/\)\s*(?::[^{=]+)?\{/);
    if (!body || body.index == null) throw new Error(`missing body for ${name}`);
    const brace = start + body.index + body[0].lastIndexOf('{');
    let depth = 0;
    for (let i = brace; i < source.length; i++) {
        if (source[i] === '{') depth++;
        else if (source[i] === '}') {
            depth--;
            if (depth === 0) return source.slice(start, i + 1);
        }
    }
    throw new Error(`unclosed ${name}`);
}

describe('course exam settle-on-read', () => {
    it('settles only an attended incomplete paper after the grace window', () => {
        const ready = { complete: false, attend: true, started: true, windowClosed: true, examRule: true, hasPids: true };
        expect(shouldSettleCourseExam(ready)).to.equal(true);
        expect(shouldSettleCourseExam({ ...ready, complete: true })).to.equal(false);
        expect(shouldSettleCourseExam({ ...ready, attend: false })).to.equal(false);
        expect(shouldSettleCourseExam({ ...ready, started: false })).to.equal(false);
        expect(shouldSettleCourseExam({ ...ready, windowClosed: false })).to.equal(false);
        expect(shouldSettleCourseExam({ ...ready, examRule: false })).to.equal(false);
        expect(shouldSettleCourseExam({ ...ready, hasPids: false })).to.equal(false);
    });

    it('hasCompletedCourseExam calls resolve so collect settle-on-read happens automatically', () => {
        const gate = readHydrooj('src/lib/course-exam-gate.ts');
        const hasCompleted = extractExportedFunction(gate, 'hasCompletedCourseExam');
        const resolve = extractExportedFunction(gate, 'resolveCourseExamCompletion');
        expect(hasCompleted).to.include('resolveCourseExamCompletion');
        expect(hasCompleted).to.match(/return\s+\w+\.complete/);
        expect(hasCompleted).not.to.include('isCourseExamCompleteFromStatus');
        expect(resolve).to.include('shouldSettleCourseExam');
        expect(resolve).to.include('isCourseExamEnded');
        expect(resolve).to.include('started');
        expect(resolve).to.include('hasPids');
        expect(resolve).to.include('finalizePaperForUser');
        expect(resolve).to.include("await import('../handler/paper')");
        expect(resolve).to.include('stage=settle-on-read');
    });

    it('settles only through finalizePaperForUser after re-reading paperFinalizedAt', () => {
        const gate = readHydrooj('src/lib/course-exam-gate.ts');
        const complete = readHydrooj('src/lib/course-exam-complete.ts');
        const resolve = extractExportedFunction(gate, 'resolveCourseExamCompletion');
        const statusAt = resolve.indexOf('contest.getStatus');
        const finalizedAt = resolve.indexOf('paperFinalizedAt');
        const finalizeAt = resolve.indexOf('finalizePaperForUser');
        expect(statusAt).to.be.at.least(0);
        expect(finalizedAt).to.be.greaterThan(statusAt);
        expect(finalizeAt).to.be.greaterThan(finalizedAt);
        expect(resolve).not.to.include('setStatus');
        expect(resolve).not.to.include('updateStatus');
        expect(resolve).not.to.match(/try\s*\{[\s\S]*finalizePaperForUser[\s\S]*catch/);
        expect(complete).not.to.include("from '../handler/paper'");
        expect(complete).not.to.include('await import');
        expect(complete).not.to.include('setStatus');
        expect(complete).not.to.include('collection(');
        expect(gate).not.to.match(/course\.examComplete|examCompletions|exam\.completions/);
        expect(complete).not.to.match(/course\.examComplete|examCompletions|exam\.completions/);
    });

    it('shares the 60s finalize grace with PaperFinalizeHandler', () => {
        const paper = readHydrooj('src/handler/paper.ts');
        const complete = readHydrooj('src/lib/course-exam-complete.ts');
        expect(complete).to.include('export const COURSE_EXAM_FINALIZE_GRACE_MS = 60_000');
        expect(COURSE_EXAM_FINALIZE_GRACE_MS).to.equal(60_000);
        expect(paper).to.include("import { COURSE_EXAM_FINALIZE_GRACE_MS } from '../lib/course-exam-complete'");
        expect(paper).to.include('this.tdoc.endAt.getTime() + COURSE_EXAM_FINALIZE_GRACE_MS');
        expect(paper).not.to.include('const grace = 60 * 1000');
        const handlerStart = paper.indexOf('class PaperFinalizeHandler');
        const handler = paper.slice(handlerStart, paper.indexOf('private async closeVigilClientSession', handlerStart));
        expect(handler).to.include('COURSE_EXAM_FINALIZE_GRACE_MS');
        expect(handler).not.to.include('finalizePaperForUser =');
    });
});
