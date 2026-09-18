import { expect } from 'chai';
import { ObjectId } from 'mongodb';
import { describe, it } from 'node:test';
import { drawExamPaperPids, examJournalFloorFilter, examStatusAcceptsJournalRid, readExamPaperQuotas } from '../src/lib/exam-paper';

describe('hydrooj exam-paper re-export', () => {
    it('draws with the default CSPRNG and re-exports quota reads', () => {
        expect(readExamPaperQuotas(undefined)).to.equal(null);
        const kinds = new Map([
            [1, 'single' as const],
            [2, 'single' as const],
        ]);
        const drawn = drawExamPaperPids([1, 2], kinds, { single: 1 });
        expect(drawn).to.have.length(1);
        expect([1, 2]).to.include(drawn[0]);
    });

    it('ignores exam journal rids at or before the start floor', () => {
        const floor = new ObjectId();
        const older = ObjectId.createFromTime(floor.getTimestamp().getTime() / 1000 - 10);
        const newer = new ObjectId();
        expect(examStatusAcceptsJournalRid(null, newer)).to.equal(true);
        expect(examStatusAcceptsJournalRid({}, newer)).to.equal(true);
        expect(examStatusAcceptsJournalRid({ examJournalAfter: floor }, floor)).to.equal(false);
        expect(examStatusAcceptsJournalRid({ examJournalAfter: floor }, older)).to.equal(false);
        expect(examStatusAcceptsJournalRid({ examJournalAfter: floor }, newer)).to.equal(true);
        expect(examJournalFloorFilter({ examJournalAfter: floor })).to.deep.equal({ examJournalAfter: floor });
        expect(examJournalFloorFilter({})).to.deep.equal({ examJournalAfter: { $exists: false } });
    });
});
