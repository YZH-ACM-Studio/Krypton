// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { isBoundStudentFromPayload } from '../src/pages/user-account-external-rating.ts';

describe('user account external rating bound flag', () => {
  it('names the bound flag externalRatingBound and treats only exact true as bound', () => {
    expect(isBoundStudentFromPayload({ externalRatingBound: true })).to.equal(true);
    expect(isBoundStudentFromPayload({ externalRatingBound: false })).to.equal(false);
    expect(isBoundStudentFromPayload({ externalRatingBound: 'true' })).to.equal(false);
    expect(isBoundStudentFromPayload({ bound: true })).to.equal(false);
    expect(isBoundStudentFromPayload({ studentBinding: { bound: true } })).to.equal(false);
    expect(isBoundStudentFromPayload({ externalRating: { bound: true } })).to.equal(false);
    expect(isBoundStudentFromPayload(null)).to.equal(false);
    expect(isBoundStudentFromPayload(undefined)).to.equal(false);
    expect(isBoundStudentFromPayload([])).to.equal(false);
  });
});
