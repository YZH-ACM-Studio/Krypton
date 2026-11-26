import { expect } from 'chai';
import { describe, it } from 'node:test';
import { createDraftConfig } from '../set-config';
import { assertSetCreateAllowed, publishDraftConfig, setAudienceConfirmed } from '../set-create';

const teacher = {
    privEditSystem: false,
    createHomework: true,
    createExam: true,
    createPractice: false,
};

function codeOf(run: () => void): string {
    try {
        run();
    } catch (error) {
        if (error instanceof TypeError) return error.message;
        throw error;
    }
    throw new Error('expected a TypeError');
}

describe('problem set create permission', () => {
    it('lets a teacher create homework and exam only', () => {
        expect(assertSetCreateAllowed(teacher, 'homework')).to.equal('homework');
        expect(assertSetCreateAllowed(teacher, 'exam')).to.equal('exam');
        expect(codeOf(() => assertSetCreateAllowed(teacher, 'contest'))).to.equal('set_create_kind_forbidden');
        expect(codeOf(() => assertSetCreateAllowed(teacher, 'practice'))).to.equal('set_create_kind_forbidden');
        expect(codeOf(() => assertSetCreateAllowed({ ...teacher, createPractice: true }, 'practice'))).to.equal(
            'set_create_kind_forbidden',
        );
        expect(codeOf(() => assertSetCreateAllowed({ ...teacher, createExam: false }, 'exam'))).to.equal('set_create_kind_forbidden');
    });

    it('lets a system editor create practice and contest', () => {
        const admin = { ...teacher, privEditSystem: true, createHomework: false, createExam: false, createPractice: false };
        expect(assertSetCreateAllowed(admin, 'contest')).to.equal('contest');
        expect(assertSetCreateAllowed(admin, 'practice')).to.equal('practice');
        expect(codeOf(() => assertSetCreateAllowed(admin, 'acm'))).to.equal('set_create_kind_invalid');
    });

    it('publishes only a confirmed draft', () => {
        const draft = createDraftConfig('homework');
        const facts = {
            beginAt: new Date('2026-11-10T00:00:00.000Z'),
            endAt: new Date('2026-11-10T04:00:00.000Z'),
            problemCount: 1,
            audienceConfirmed: true,
            problems: [{ kind: 'programming' as const, judged: true }],
            paperMax: 100,
        };
        expect(setAudienceConfirmed({ setAudienceConfirmed: true })).to.equal(true);
        expect(setAudienceConfirmed({ participantScopeMode: 'none' })).to.equal(false);
        expect(publishDraftConfig({ setConfig: draft }, facts).publication).to.equal('published');
        expect(codeOf(() => publishDraftConfig({ setConfig: { ...draft, publication: 'published' } }, facts))).to.equal(
            'set_publish_state_invalid',
        );
        expect(codeOf(() => publishDraftConfig({ setConfig: draft }, { ...facts, audienceConfirmed: false }))).to.equal(
            'set_config_audience_required',
        );
    });
});
