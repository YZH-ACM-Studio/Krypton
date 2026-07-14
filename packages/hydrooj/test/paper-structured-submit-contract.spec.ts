import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect } from 'chai';
import { describe, it } from 'node:test';

const root = resolve(__dirname, '..');
const source = readFileSync(resolve(root, 'src/handler/paper.ts'), 'utf8');
const vigilSource = readFileSync(resolve(root, 'src/handler/vigil-integration.ts'), 'utf8');

describe('P3.19 paper structured submit contract', () => {
    it('uses one fail-fast validator for draft save, immediate submit, and finalize', () => {
        expect(source).to.include('function validatePaperRegionSubmission(');
        for (const stage of ['draft-save', 'immediate-submit', 'finalize']) {
            expect(source).to.include(`stage: '${stage}'`);
        }
        expect(source).to.include('parseStructuredRegionSubmission(kind, config.template, rawCode)');
        expect(source).to.include('validateStructuredCodeJudgeConfig(config');
    });

    it('validates before every program-fill/function Record insertion', () => {
        const immediateStart = source.indexOf('class PaperSubmitCodeHandler');
        const finalizeStart = source.indexOf('export async function finalizePaperForUser');
        const immediate = source.slice(immediateStart, finalizeStart);
        const finalize = source.slice(finalizeStart, source.indexOf('class PaperFinalizeHandler'));
        expect(immediate.indexOf("stage: 'immediate-submit'")).to.be.lessThan(immediate.indexOf('record.add('));
        expect(finalize.indexOf("stage: 'finalize'")).to.be.lessThan(
            finalize.indexOf('record.add(', finalize.indexOf("['program_fill', 'function'].includes(type)")),
        );
    });

    it('separates canonical text and compile program-fill cells without objective main compatibility', () => {
        expect(source).to.include("config.mode === 'compile' ? 'program_fill_compile' : 'program_fill_text'");
        expect(source).to.include("if (!['single', 'multi', 'blank', 'fill_program', 'subjective'].includes(kind))");
        expect(source).not.to.include('validatePaperTextProgramFillSubmission');
        expect(source).not.to.include('preflightPaperTextProgramFillDrafts');
    });

    it('logs stage, domain, container, problem, kind, revision, and user on rejection', () => {
        expect(source).to.include('stage=%s domain=%s tid=%s pid=%d kind=%s revision=%s uid=%d');
    });

    it('uses the same exact region-map code path for text and compile modes', () => {
        expect(source).to.include("['program_fill', 'function'].includes(config?.type)");
        expect(source).to.include("kind === 'program_fill' && config.mode === 'text' ? '_' :");
        expect(source).not.to.include("config.subType === 'program_fill_text'");
    });

    it('never reconstructs structured code from objective answers during normal or Vigil finalization', () => {
        expect(source).to.include('validatePaperRegionSubmission(pdoc, config, draft.code,');
        expect(source).not.to.include('draft.code || JSON.stringify(draft.answers');
        expect(vigilSource).to.include('finalizePaperForUser(domainId, tid, ojUserId');
        expect(vigilSource).not.to.include('draft.code || JSON.stringify(draft.answers');
    });
});
