import { describe, it } from 'node:test';
import { expect } from 'chai';
import {
    canApplyInheritedPracticeEnforcement,
    combineInheritedPracticeEnforcement,
    emptyInheritedPracticeEnforcement,
    inheritedPracticeEnforcementIsActive,
} from '../src/lib/practice-enforcement';

describe('inherited practice enforcement', () => {
    it('applies on the problem bank and homework, but not contests or virtual participation', () => {
        expect(canApplyInheritedPracticeEnforcement({})).to.equal(true);
        expect(canApplyInheritedPracticeEnforcement({ tdoc: null })).to.equal(true);
        expect(canApplyInheritedPracticeEnforcement({ tdoc: { rule: 'homework' } })).to.equal(true);
        expect(canApplyInheritedPracticeEnforcement({ tdoc: { rule: 'acm' } })).to.equal(false);
        expect(canApplyInheritedPracticeEnforcement({ tdoc: { rule: 'exam' } })).to.equal(false);
        expect(canApplyInheritedPracticeEnforcement({ tdoc: { rule: 'homework' }, virtualAttempt: { _id: 1 } })).to.equal(false);
    });

    it('ORs only the two inherited booleans and never invents anti-AI injection', () => {
        expect(combineInheritedPracticeEnforcement([])).to.deep.equal(emptyInheritedPracticeEnforcement());
        expect(
            combineInheritedPracticeEnforcement([
                { prohibitExternalCodeInjection: true, removeIndependentSubmitForm: false },
                { prohibitExternalCodeInjection: false, removeIndependentSubmitForm: true },
            ]),
        ).to.deep.equal({ prohibitExternalCodeInjection: true, removeIndependentSubmitForm: true });
        expect(inheritedPracticeEnforcementIsActive({ prohibitExternalCodeInjection: false, removeIndependentSubmitForm: false })).to.equal(false);
        expect(inheritedPracticeEnforcementIsActive({ prohibitExternalCodeInjection: true, removeIndependentSubmitForm: false })).to.equal(true);
    });
});
