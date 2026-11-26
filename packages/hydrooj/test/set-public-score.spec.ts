import { expect } from 'chai';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import { createDraftConfig, parseSetConfig } from '@hydrooj/common';
import { courseCompleteFromSet } from '../src/lib/set-public-score';

const handedIn = new Date('2026-09-16T00:00:00.000Z');
const closed = { setRoundId: 'round-1', setRoundClosedAt: handedIn, setJudgePending: false };

function configWithPass(passScore: number | null) {
    const draft = createDraftConfig('exam');
    return parseSetConfig({
        ...draft,
        publication: 'published',
        settings: { ...draft.settings, retake: { ...draft.settings.retake, passScore } },
    });
}

describe('course completion from a stored round', () => {
    it('treats a handed-in total against the configured pass line', () => {
        const setConfig = configWithPass(60);
        expect(courseCompleteFromSet({ setConfig }, { ...closed, score: 80 })).to.equal(true);
        expect(courseCompleteFromSet({ setConfig }, { ...closed, score: 60 })).to.equal(true);
        expect(courseCompleteFromSet({ setConfig }, { ...closed, score: 50 })).to.equal(false);
        expect(courseCompleteFromSet({ setConfig }, { score: 80 })).to.equal(false);
        expect(courseCompleteFromSet({ setConfig }, { ...closed, setJudgePending: true, score: 80 })).to.equal(false);
        expect(courseCompleteFromSet({ setConfig }, { paperFinalizedAt: handedIn, score: 80 })).to.equal(false);
        expect(courseCompleteFromSet({ setConfig }, { ...closed, setRoundClosedAt: new Date('invalid'), score: 80 })).to.equal(false);
        expect(courseCompleteFromSet({ setConfig }, { ...closed })).to.equal(false);
    });

    it('treats a null pass line as handed-in and a missing configuration as not this branch', () => {
        const setConfig = configWithPass(null);
        expect(setConfig.settings.retake.passScore).to.equal(null);
        expect(courseCompleteFromSet({ setConfig }, { ...closed, score: 0 })).to.equal(true);
        expect(courseCompleteFromSet({ setConfig }, { score: 80 })).to.equal(false);
        expect(courseCompleteFromSet({ setConfig }, { ...closed, setJudgePending: true, score: 80 })).to.equal(false);
        expect(courseCompleteFromSet({ setConfig }, { paperFinalizedAt: handedIn, score: 80 })).to.equal(false);
        expect(courseCompleteFromSet({ rule: 'exam', pids: [1, 2], examPassScore: 60 }, { ...closed, score: 80 })).to.equal(null);
        expect(courseCompleteFromSet(null, { ...closed, score: 80 })).to.equal(null);
    });

    it('does not complete a draft with stale status', () => {
        expect(courseCompleteFromSet({ setConfig: createDraftConfig('exam') }, { ...closed, score: 100 })).to.equal(false);
    });

    it('rejects a present but unusable configuration instead of guessing', () => {
        expect(() => courseCompleteFromSet({ setConfig: { nope: true } }, { ...closed, score: 80 }))
            .to.throw(TypeError, 'set_config_invalid');
    });

    it('does not score through legacy pass fields or contest rule tables', () => {
        const source = readFileSync(resolve(__dirname, '../src/lib/set-public-score.ts'), 'utf8');
        expect(source).to.include('courseCompleteFromSet');
        expect(source).to.include('readStoredSetConfig');
        expect(source).to.not.include('examPassScore');
        expect(source).to.not.include('RULES');
        expect(source).to.not.include('roundPassed');
    });
});
