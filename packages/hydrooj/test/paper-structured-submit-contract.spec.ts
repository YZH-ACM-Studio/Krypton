import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect } from 'chai';
import { describe, it } from 'node:test';

const root = resolve(__dirname, '..');
const source = readFileSync(resolve(root, 'src/handler/paper.ts'), 'utf8');

describe('P3.11 paper structured submit contract', () => {
    it('uses one fail-fast validator for draft save, immediate submit, and finalize', () => {
        expect(source).to.include('function validatePaperRegionSubmission(');
        for (const stage of ['draft-save', 'immediate-submit', 'finalize']) {
            expect(source).to.include(`stage: '${stage}'`);
        }
        expect(source).to.include('parseStructuredRegionSubmission(kind, config.template, rawCode)');
        expect(source).to.include('validateStructuredCodeJudgeConfig(config');
    });

    it('validates before every fill-function Record insertion', () => {
        const immediateStart = source.indexOf('class PaperSubmitCodeHandler');
        const finalizeStart = source.indexOf('export async function finalizePaperForUser');
        const immediate = source.slice(immediateStart, finalizeStart);
        const finalize = source.slice(finalizeStart, source.indexOf('class PaperFinalizeHandler'));
        expect(immediate.indexOf("stage: 'immediate-submit'")).to.be.lessThan(immediate.indexOf('record.add('));
        expect(finalize.indexOf("stage: 'finalize'")).to.be.lessThan(
            finalize.indexOf('record.add(', finalize.indexOf("['fill_function', 'function'].includes(type)")),
        );
    });

    it('separates objective text program-fill from compile program-fill cells', () => {
        expect(source).to.include("? 'program_fill_compile'");
        expect(source).to.include("if (!['single', 'multi', 'blank', 'fill_program', 'subjective'].includes(kind))");
    });

    it('logs stage, domain, container, problem, kind, revision, and user on rejection', () => {
        expect(source).to.include('stage=%s domain=%s tid=%s pid=%d kind=%s revision=%s uid=%d');
    });

    it('validates text program-fill before draft save, kind lock, and finalize', () => {
        expect(source).to.include('function validatePaperTextProgramFillSubmission(');
        for (const stage of ['draft-save', 'lock-kind', 'finalize-preflight']) {
            expect(source).to.include(`stage: '${stage}'`);
        }
        const lockStart = source.indexOf('class PaperLockKindHandler');
        const lockEnd = source.indexOf('class PaperSubmitCodeHandler');
        const lock = source.slice(lockStart, lockEnd);
        expect(lock.indexOf("stage: 'lock-kind'")).to.be.lessThan(lock.indexOf('lockKindForUser('));
    });

    it('preflights every text program-fill before finalize performs any write', () => {
        const finalizeStart = source.indexOf('export async function finalizePaperForUser');
        const finalizeEnd = source.indexOf('class PaperFinalizeHandler');
        const finalize = source.slice(finalizeStart, finalizeEnd);
        const preflight = finalize.indexOf('preflightPaperTextProgramFillDrafts(drafts, pdict');
        expect(preflight).to.be.greaterThan(-1);
        expect(preflight).to.be.lessThan(finalize.indexOf('const rids:'));
        expect(preflight).to.be.lessThan(finalize.indexOf('gradeObjectiveDraft('));
        expect(preflight).to.be.lessThan(finalize.indexOf('record.add('));
    });
});
