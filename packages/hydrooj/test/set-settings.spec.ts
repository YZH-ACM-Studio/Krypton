import { describe, it } from 'node:test';
import { expect } from 'chai';
import { createDraftConfig } from '@hydrooj/common';

import { planSetSettingsUpdate, postedSetContestOptions, setContestOptions } from '../src/lib/set-settings-edit';

describe('planSetSettingsUpdate', () => {
    const current = createDraftConfig('homework');

    it('rejects a code policy change after someone has started', () => {
        const nextSettings = { ...current.settings, codePolicy: 'acm' as const };
        expect(() => planSetSettingsUpdate(current, nextSettings, 1)).to.throw(TypeError, 'set_structure_locked');
    });

    it('keeps a feedback-only change after someone has started', () => {
        const nextSettings = {
            ...current.settings,
            feedback: {
                ...current.settings.feedback,
                objective: { ...current.settings.feedback.objective, when: 'after_deadline' as const },
            },
        };
        const result = planSetSettingsUpdate(current, nextSettings, 1);
        expect(result.setConfig.settings.feedback.objective.when).to.equal('after_deadline');
    });

    it('rejects a settings object that is not the settings schema', () => {
        expect(() => planSetSettingsUpdate(current, { nope: true }, 0)).to.throw();
    });

    it('advances the persisted revision and rejects an older editor', () => {
        const result = planSetSettingsUpdate(current, current.settings, 0, current.revision);
        expect(result.setConfig.revision).to.equal(current.revision + 1);
        expect(() => planSetSettingsUpdate(result.setConfig, current.settings, 0, current.revision))
            .to.throw('set_config_revision_conflict');
    });
});

describe('set contest options', () => {
    it('projects the existing runtime defaults and preserves explicit booleans', () => {
        expect(setContestOptions({})).to.deep.equal({
            allowVirtual: true, allowPostContestView: true, allowPostContestPractice: true, allowPostContestSubmit: true,
            allowViewCode: false, allowPrint: false,
        });
        expect(setContestOptions({ allowVirtual: false, allowPrint: true }).allowVirtual).to.equal(false);
        expect(setContestOptions({ allowVirtual: false, allowPrint: true }).allowPrint).to.equal(true);
    });

    it('accepts optional boolean edits and never forwards unknown settings', () => {
        expect(postedSetContestOptions({ allowPrint: true, unknown: true })).to.deep.equal({ allowPrint: true });
        expect(postedSetContestOptions({})).to.deep.equal({});
        expect(() => postedSetContestOptions({ allowPrint: 'true' })).to.throw(TypeError);
        expect(() => postedSetContestOptions({ allowVirtual: null })).to.throw(TypeError);
    });
});
