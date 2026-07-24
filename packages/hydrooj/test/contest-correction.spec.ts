import { expect } from 'chai';
import { readFileSync } from 'fs';
import { describe, it } from 'node:test';
import { resolve } from 'path';
import {
    canAccessPostContestPracticeRecord,
    canUsePostContestPractice,
    getContestSubmissionScope,
    getPostContestPracticeState,
    isPostContestPracticeRule,
    resolvePostContestProblemMode,
} from '../src/lib/contest-correction';
import { buildPersonalPracticeRecordQuery, buildPersonalPracticeStatusByPid } from '../src/lib/contest-problem-status';

class TimestampedRid {
    constructor(
        private readonly value: string,
        private readonly timestamp: Date,
    ) {}

    getTimestamp() {
        return this.timestamp;
    }

    toString() {
        return this.value;
    }
}

const beginAt = new Date('2026-07-24T01:00:00.000Z');
const endAt = new Date('2026-07-24T03:00:00.000Z');

function contestDoc(overrides: Record<string, unknown> = {}) {
    return {
        rule: 'acm',
        entryMode: 'open',
        beginAt,
        endAt,
        ...overrides,
    } as any;
}

describe('post-contest practice eligibility', () => {
    it('supports normal programming contest rules but not paper exams or homework', () => {
        for (const rule of ['acm', 'oi', 'ioi', 'ledo', 'strictioi']) {
            expect(isPostContestPracticeRule(rule)).to.equal(true);
        }
        expect(isPostContestPracticeRule('exam')).to.equal(false);
        expect(isPostContestPracticeRule('homework')).to.equal(false);
    });

    it('opens an ordinary contest at its global end time only for historical attendees', () => {
        const atEnd = new Date(endAt);
        expect(getPostContestPracticeState(contestDoc(), { attend: 1 }, atEnd)).to.deep.include({
            supported: true,
            open: true,
            eligible: true,
        });
        expect(canUsePostContestPractice(contestDoc(), { attend: 0 }, atEnd)).to.equal(false);
        expect(canUsePostContestPractice(contestDoc(), { attend: 1 }, new Date(endAt.getTime() - 1))).to.equal(false);
    });

    it('keeps client-required contests closed through the configured post-contest lockout', () => {
        const tdoc = contestDoc({
            entryMode: 'client_required',
            clientLoginBlockAfterMinutes: 45,
        });
        const beforeBlockEnd = new Date(endAt.getTime() + 45 * 60_000 - 1);
        const atBlockEnd = new Date(endAt.getTime() + 45 * 60_000);
        expect(getPostContestPracticeState(tdoc, { attend: 1 }, beforeBlockEnd)).to.deep.include({
            open: false,
            eligible: false,
        });
        expect(getPostContestPracticeState(tdoc, { attend: 1 }, atBlockEnd)).to.deep.include({
            open: true,
            eligible: true,
        });
    });

    it('uses the existing 30-minute client lockout default', () => {
        const tdoc = contestDoc({ entryMode: 'client_required' });
        const state = getPostContestPracticeState(tdoc, { attend: 1 }, new Date(endAt.getTime() + 30 * 60_000));
        expect(state.availableAt).to.deep.equal(new Date(endAt.getTime() + 30 * 60_000));
        expect(state.eligible).to.equal(true);
    });

    it('reuses the canonical contest lockout boundary', () => {
        const source = readFileSync(resolve(process.cwd(), 'packages/hydrooj/src/lib/contest-correction.ts'), 'utf8');
        expect(source).to.include('effectiveLockoutWindow(tdoc)');
        expect(source).not.to.include('DEFAULT_CLIENT_BLOCK_AFTER_MINUTES');
        const contestModelSource = readFileSync(resolve(process.cwd(), 'packages/hydrooj/src/model/contest.ts'), 'utf8');
        expect(contestModelSource).to.include("export { effectiveLockoutWindow } from '../lib/contest-lockout'");
    });

    it('fails closed on invalid persisted client lockout boundaries', () => {
        for (const invalid of [-1, 1.5, Number.NaN, '30']) {
            expect(() =>
                getPostContestPracticeState(
                    contestDoc({ entryMode: 'client_required', clientLoginBlockAfterMinutes: invalid }),
                    { attend: 1 },
                    endAt,
                ),
            ).to.throw('clientLoginBlockAfterMinutes must be a nonnegative safe integer');
        }
        expect(() =>
            getPostContestPracticeState(
                contestDoc({ entryMode: 'client_required', clientLoginBlockAfterMinutes: Number.MAX_SAFE_INTEGER }),
                { attend: 1 },
                endAt,
            ),
        ).to.throw('outside the supported Date range');
        expect(() =>
            getPostContestPracticeState(contestDoc({ entryMode: 'client_required', endAt: new Date('invalid') }), { attend: 1 }, endAt),
        ).to.throw('endAt must be a valid Date');
    });

    it('keeps legacy missing entryMode open but rejects explicit malformed modes', () => {
        expect(getPostContestPracticeState(contestDoc({ entryMode: undefined }), { attend: 1 }, endAt).eligible).to.equal(true);
        for (const entryMode of [null, '', 'garbage', 1]) {
            expect(() => getPostContestPracticeState(contestDoc({ entryMode }), { attend: 1 }, endAt)).to.throw(
                'Contest entryMode must be open or client_required.',
            );
        }
    });

    it('fails closed on malformed open contest time boundaries', () => {
        for (const invalid of [
            contestDoc({ beginAt: undefined }),
            contestDoc({ beginAt: new Date('invalid') }),
            contestDoc({ beginAt: endAt }),
            contestDoc({ beginAt: new Date(endAt.getTime() + 1) }),
        ]) {
            expect(() => getPostContestPracticeState(invalid, { attend: 1 }, endAt)).to.throw(/Contest beginAt/);
        }
    });

    it('authorizes only the attendee owner for records on contest problems', () => {
        const tdoc = contestDoc({ pids: [7, 8] });
        const context = { pid: 7, actorUid: 42, recordUid: 42 };
        expect(canAccessPostContestPracticeRecord(tdoc, { attend: 1 }, context, endAt)).to.equal(true);
        expect(canAccessPostContestPracticeRecord(tdoc, { attend: 0 }, context, endAt)).to.equal(false);
        expect(canAccessPostContestPracticeRecord(tdoc, { attend: 1 }, { ...context, pid: 9 }, endAt)).to.equal(false);
        expect(canAccessPostContestPracticeRecord(tdoc, { attend: 1 }, { ...context, recordUid: 43 }, endAt)).to.equal(false);
    });

    it('removes the contest id from post-contest personal records', () => {
        expect(getContestSubmissionScope(contestDoc(), { attend: 1 }, 'contest-id', new Date(endAt))).to.deep.equal({
            postContestPractice: true,
            recordContestId: undefined,
        });
        expect(getContestSubmissionScope(contestDoc(), { attend: 1 }, 'contest-id', new Date(endAt.getTime() - 1))).to.deep.equal({
            postContestPractice: false,
            recordContestId: 'contest-id',
        });
    });

    it('keeps live participants in contest mode and opens personal correction after the contest', () => {
        expect(
            resolvePostContestProblemMode(
                contestDoc(),
                { attend: 1, startAt: beginAt },
                { canManageContest: false, canViewDirectly: false, subjective: false },
                new Date(beginAt.getTime() + 1),
            ),
        ).to.equal('contest');
        expect(
            resolvePostContestProblemMode(
                contestDoc(),
                { attend: 1, startAt: beginAt },
                { canManageContest: false, canViewDirectly: false, subjective: false },
                new Date(endAt),
            ),
        ).to.equal('correction');
    });

    it('keeps hidden problems inaccessible to nonparticipants and during client lockout', () => {
        const hiddenProblem = { canManageContest: false, canViewDirectly: false, subjective: false };
        expect(resolvePostContestProblemMode(contestDoc(), { attend: 0 }, hiddenProblem, new Date(endAt))).to.equal('none');
        expect(
            resolvePostContestProblemMode(
                contestDoc({ entryMode: 'client_required' }),
                { attend: 1, startAt: beginAt },
                hiddenProblem,
                new Date(endAt),
            ),
        ).to.equal('none');
    });

    it('allows post-contest public viewing but excludes subjective correction', () => {
        expect(
            resolvePostContestProblemMode(
                contestDoc(),
                { attend: 0 },
                { canManageContest: false, canViewDirectly: true, subjective: false },
                new Date(endAt),
            ),
        ).to.equal('view');
        expect(
            resolvePostContestProblemMode(
                contestDoc(),
                { attend: 1, startAt: beginAt },
                { canManageContest: false, canViewDirectly: true, subjective: true },
                new Date(endAt),
            ),
        ).to.equal('view');
    });
});

describe('personal post-contest problem statuses', () => {
    it('labels accepted work by when the personal accepted record was created', () => {
        const statuses = buildPersonalPracticeStatusByPid(
            [
                { _id: new TimestampedRid('before-ac', new Date(beginAt.getTime() - 1)), pid: 1, status: 1 },
                { _id: new TimestampedRid('after-ac', new Date(endAt.getTime() + 1)), pid: 2, status: 1 },
                { _id: new TimestampedRid('other-ac', new Date(beginAt.getTime() + 1)), pid: 3, status: 1 },
            ],
            [1, 2, 3],
            beginAt,
            endAt,
        );
        expect(statuses).to.deep.equal({
            1: { rid: statuses[1].rid, status: 1, phase: 'before' },
            2: { rid: statuses[2].rid, status: 1, phase: 'after' },
            3: { rid: statuses[3].rid, status: 1, phase: 'other' },
        });
    });

    it('shows only post-contest non-accepted personal submissions', () => {
        const statuses = buildPersonalPracticeStatusByPid(
            [
                { _id: new TimestampedRid('before-wa', new Date(beginAt.getTime() - 1)), pid: 1, status: 2 },
                { _id: new TimestampedRid('after-wa', new Date(endAt.getTime() + 1)), pid: 2, status: 2 },
            ],
            [1, 2],
            beginAt,
            endAt,
        );
        expect(statuses[1]).to.equal(undefined);
        expect(statuses[2]).to.deep.equal({ rid: statuses[2].rid, status: 2, phase: 'after' });
    });

    it('keeps a personal accepted record sticky over newer non-accepted attempts', () => {
        const statuses = buildPersonalPracticeStatusByPid(
            [
                { _id: new TimestampedRid('older-ac', new Date(beginAt.getTime() - 1)), pid: 1, status: 1 },
                { _id: new TimestampedRid('newer-wa', new Date(endAt.getTime() + 1)), pid: 1, status: 2 },
            ],
            [1],
            beginAt,
            endAt,
        );
        expect(statuses[1]).to.deep.equal({ rid: statuses[1].rid, status: 1, phase: 'before' });
    });

    it('queries only ordinary records owned by the current user', () => {
        expect(buildPersonalPracticeRecordQuery(42, [2, 1, 2])).to.deep.equal({
            uid: 42,
            pid: { $in: [2, 1] },
            contest: { $exists: false },
            contestTeamId: { $exists: false },
            hackTarget: { $exists: false },
            input: { $exists: false },
        });
    });

    it('fails closed if contest, team, pretest, generate, or hack records reach the reducer', () => {
        const rid = new TimestampedRid('foreign-context', new Date(endAt.getTime() + 1));
        for (const foreign of [
            { _id: rid, pid: 1, status: 1, contest: 'other-contest' },
            { _id: rid, pid: 1, status: 1, contest: 'same-contest', contestTeamId: 'team' },
            { _id: rid, pid: 1, status: 1, contest: '000000000000000000000000' },
            { _id: rid, pid: 1, status: 1, contest: '000000000000000000000001' },
            { _id: rid, pid: 1, status: 1, contestTeamId: 'team' },
            { _id: rid, pid: 1, status: 1, hackTarget: 'target-rid' },
            { _id: rid, pid: 1, status: 1, input: 'self-test' },
        ]) {
            expect(() => buildPersonalPracticeStatusByPid([foreign], [1], beginAt, endAt)).to.throw('is not an ordinary personal submission');
        }
    });

    it('fails fast on malformed record facts', () => {
        expect(() =>
            buildPersonalPracticeStatusByPid([{ _id: new TimestampedRid('missing-status', endAt), pid: 1, status: undefined }], [1], beginAt, endAt),
        ).to.throw('Personal practice record 0 is malformed.');
    });
});

describe('post-contest submission integration', () => {
    it('uses the personal record scope for both judged submissions and pretests', () => {
        const source = readFileSync(resolve(process.cwd(), 'packages/hydrooj/src/handler/problem.ts'), 'utf8');
        expect(source).to.include('this.assertContestSubmissionContext(tid)');
        expect(source).to.include('!this.tdoc.pids.includes(this.pdoc.docId)');
        expect(source).to.include('contest: submissionScope.recordContestId');
        expect(source).to.include('contestContext: submissionScope.recordContestId');
        expect(source).to.include('else if (submissionScope.recordContestId)');
        expect(source).to.include('if (submissionScope.postContestPractice)');
    });

    it('uses an explicit flag instead of treating every legacy correction mode as personal practice', () => {
        const source = readFileSync(resolve(process.cwd(), 'packages/hydrooj/src/handler/problem.ts'), 'utf8');
        expect(source).to.include("const postContestPracticeActive = postContestProblemMode === 'correction'");
        expect(source).to.include('psdoc: !tid ? this.psdoc : personalPracticePsdoc');
        expect(source).to.include('postContestPracticeActive,');
    });
});
