import { expect } from 'chai';
import { describe, it } from 'node:test';
import {
    matchesRecordConnectionScope,
    RECORD_GENERATE_CONTEST_ID,
    RECORD_PRETEST_CONTEST_ID,
} from '../src/lib/record-connection-scope';

describe('record list WebSocket scope', () => {
    const practiceScope = {
        domainId: 'system',
        pretest: false,
        all: false,
        allDomain: false,
    };

    it('matches the initial practice record query and rejects internal selftests', () => {
        expect(matchesRecordConnectionScope({ domainId: 'system' }, practiceScope)).to.equal(true);
        expect(
            matchesRecordConnectionScope(
                { domainId: 'system', contestId: RECORD_PRETEST_CONTEST_ID, input: ['sample'] },
                practiceScope,
            ),
        ).to.equal(false);
        expect(
            matchesRecordConnectionScope(
                { domainId: 'system', contestId: RECORD_GENERATE_CONTEST_ID },
                practiceScope,
            ),
        ).to.equal(false);
        expect(matchesRecordConnectionScope({ domainId: 'other' }, practiceScope)).to.equal(false);
    });

    it('only accepts the exact contest on ordinary contest connections', () => {
        const contestScope = { ...practiceScope, tid: '64b000000000000000000001' };
        expect(
            matchesRecordConnectionScope(
                { domainId: 'system', contestId: '64b000000000000000000001' },
                contestScope,
            ),
        ).to.equal(true);
        expect(matchesRecordConnectionScope({ domainId: 'system' }, contestScope)).to.equal(false);
        expect(
            matchesRecordConnectionScope(
                { domainId: 'system', contestId: RECORD_PRETEST_CONTEST_ID, input: ['sample'] },
                contestScope,
            ),
        ).to.equal(false);
    });

    it('reserves selftest records for explicit pretest connections', () => {
        const pretestScope = { ...practiceScope, pretest: true };
        expect(
            matchesRecordConnectionScope(
                { domainId: 'system', contestId: RECORD_PRETEST_CONTEST_ID, input: ['sample'] },
                pretestScope,
            ),
        ).to.equal(true);
        expect(matchesRecordConnectionScope({ domainId: 'system' }, pretestScope)).to.equal(false);
        expect(
            matchesRecordConnectionScope(
                { domainId: 'other', contestId: RECORD_PRETEST_CONTEST_ID, input: ['sample'] },
                { ...pretestScope, allDomain: true },
            ),
        ).to.equal(false);
    });

    it('keeps internal records out of expanded record-list scopes', () => {
        const allScope = { ...practiceScope, all: true };
        expect(
            matchesRecordConnectionScope(
                { domainId: 'system', contestId: '64b000000000000000000001' },
                allScope,
            ),
        ).to.equal(true);
        expect(
            matchesRecordConnectionScope(
                { domainId: 'system', contestId: RECORD_PRETEST_CONTEST_ID, input: ['sample'] },
                allScope,
            ),
        ).to.equal(false);

        const allDomainScope = { ...practiceScope, allDomain: true };
        expect(
            matchesRecordConnectionScope(
                { domainId: 'other', contestId: '64b000000000000000000001' },
                allDomainScope,
            ),
        ).to.equal(true);
        expect(
            matchesRecordConnectionScope(
                { domainId: 'other', contestId: RECORD_GENERATE_CONTEST_ID },
                allDomainScope,
            ),
        ).to.equal(false);
    });

    it('applies language and status filters, including waiting status zero', () => {
        const filteredScope = { ...practiceScope, lang: 'cc.cc17', status: 0 };
        expect(
            matchesRecordConnectionScope(
                { domainId: 'system', lang: 'cc.cc17', status: 0 },
                filteredScope,
            ),
        ).to.equal(true);
        expect(
            matchesRecordConnectionScope(
                { domainId: 'system', lang: 'cc.cc11', status: 0 },
                filteredScope,
            ),
        ).to.equal(false);
        expect(
            matchesRecordConnectionScope(
                { domainId: 'system', lang: 'cc.cc17', status: 1 },
                filteredScope,
            ),
        ).to.equal(false);
    });

    it('matches only the exact virtual attempt and never mixes VP into practice or contest scopes', () => {
        const virtualScope = { ...practiceScope, virtualAttemptId: '64b0000000000000000000aa' };
        expect(
            matchesRecordConnectionScope({ domainId: 'system', virtualAttemptId: '64b0000000000000000000aa' }, virtualScope),
        ).to.equal(true);
        expect(matchesRecordConnectionScope({ domainId: 'system' }, virtualScope)).to.equal(false);
        expect(
            matchesRecordConnectionScope({ domainId: 'system', contestId: '64b000000000000000000001' }, virtualScope),
        ).to.equal(false);
        expect(
            matchesRecordConnectionScope({ domainId: 'system', virtualAttemptId: '64b0000000000000000000aa' }, practiceScope),
        ).to.equal(false);
        expect(
            matchesRecordConnectionScope(
                { domainId: 'system', virtualAttemptId: '64b0000000000000000000aa' },
                { ...practiceScope, tid: '64b000000000000000000001' },
            ),
        ).to.equal(false);
        expect(
            matchesRecordConnectionScope({ domainId: 'system', virtualAttemptId: '64b0000000000000000000aa' }, { ...practiceScope, all: true }),
        ).to.equal(false);
    });
});
