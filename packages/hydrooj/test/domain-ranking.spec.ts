import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { emptyUserExternalRatingState } from '../../krypton-external-rating/src/types';
import { rankingPublicRatings, rankingQuery, RankingQueryError, selectRankingPage, type RankingEntry } from '../src/lib/domain-ranking';

const SCHOOL = '111111111111111111111111';
const OTHER_SCHOOL = '222222222222222222222222';
const GROUP = '333333333333333333333333';
const OTHER_GROUP = '444444444444444444444444';

function entry(uid: number, patch: Partial<RankingEntry> = {}): RankingEntry {
    return { uid, uname: `user${uid}`, bio: '', rp: uid, rank: 10 - uid, nAccept: uid, ratings: {}, ...patch };
}

function query(raw: Record<string, unknown> = {}, admin = true) {
    return rankingQuery(raw, admin, ['problem', 'contest']);
}

describe('full domain ranking selection', () => {
    it('sorts the full result before pagination, preserves canonical rank and uses stable UID ties', () => {
        const rows = [entry(2, { rp: 10, rank: 8 }), entry(3, { rp: 10, rank: 8 }), entry(4, { rp: 90, rank: 1 })];
        const first = selectRankingPage(rows, query(), 1, 1);
        assert.deepEqual(first.rows.map((row) => [row.uid, row.rank]), [[4, 1]]);
        assert.equal(first.count, 3);
        assert.equal(first.pages, 3);
        assert.deepEqual(selectRankingPage(rows, query(), 2, 1).rows.map((row) => row.uid), [2]);
        assert.deepEqual(rows.map((row) => row.uid), [2, 3, 4]);
    });

    const numeric: Array<[string, Partial<RankingEntry>, Partial<RankingEntry>]> = [
        ['rank', { rank: 1 }, { rank: 5 }],
        ['rp', { rp: 10 }, { rp: 20 }],
        ['ac', { nAccept: 0 }, { nAccept: 10 }],
        ['rp:problem', { rpInfo: { problem: 0 } }, { rpInfo: { problem: 30 } }],
        ['rp:contest', { rpInfo: { contest: 10 } }, { rpInfo: { contest: 50 } }],
        ['codeforces', { ratings: { codeforces: 0 } }, { ratings: { codeforces: 2400 } }],
        ['nowcoder', { ratings: { nowcoder: 0 } }, { ratings: { nowcoder: 2000 } }],
    ];
    for (const [sort, low, high] of numeric) {
        it(`supports both directions for ${sort}`, () => {
            const rows = [entry(3, high), entry(2, low)];
            assert.deepEqual(selectRankingPage(rows, query({ sort, order: 'asc' }), 1, 100).rows.map((row) => row.uid), [2, 3]);
            assert.deepEqual(selectRankingPage(rows, query({ sort, order: 'desc' }), 1, 100).rows.map((row) => row.uid), [3, 2]);
        });
    }

    it('sorts usernames, student identities and bios naturally, keeping missing values last', () => {
        const rows = [entry(4), entry(3, { uname: '同学10', bio: '介绍10', student: { studentId: '10', realName: '乙', schoolId: SCHOOL, groupIds: [] } }),
            entry(2, { uname: '同学2', bio: '介绍2', student: { studentId: '2', realName: '甲', schoolId: SCHOOL, groupIds: [] } })];
        for (const sort of ['student', 'bio']) {
            assert.deepEqual(selectRankingPage(rows, query({ sort, order: 'asc' }), 1, 100).rows.map((row) => row.uid), [2, 3, 4]);
            assert.deepEqual(selectRankingPage(rows, query({ sort, order: 'desc' }), 1, 100).rows.map((row) => row.uid), [3, 2, 4]);
        }
        assert.deepEqual(selectRankingPage(rows.slice(1), query({ sort: 'user', order: 'asc' }), 1, 100).rows.map((row) => row.uid), [2, 3]);
        assert.deepEqual(selectRankingPage(rows.slice(1), query({ sort: 'user', order: 'desc' }), 1, 100).rows.map((row) => row.uid), [3, 2]);
    });

    it('never sorts by a hidden external rating, even for an administrator', () => {
        const hidden = emptyUserExternalRatingState();
        hidden.codeforces = { handle: 'private', publicShow: false, rating: 9999, fetchedAt: new Date('2026-11-01T00:00:00Z'), lastError: null };
        const visible = emptyUserExternalRatingState();
        visible.codeforces = { ...hidden.codeforces, publicShow: true, rating: 0 };
        const rows = [entry(2, { ratings: rankingPublicRatings(hidden) }), entry(3, { ratings: rankingPublicRatings(visible) })];
        for (const order of ['asc', 'desc']) {
            assert.deepEqual(selectRankingPage(rows, query({ sort: 'codeforces', order }), 1, 100).rows.map((row) => row.uid), [3, 2]);
        }
        assert.deepEqual(rows[0].ratings, {});
        assert.throws(() => rankingPublicRatings({ codeforces: { rating: 'bad' } }));
    });

    it('intersects search, school, group and binding before counting and paginating', () => {
        const rows = [entry(2, { uname: 'alice', student: { studentId: '2026001', realName: '李同学', schoolId: SCHOOL, groupIds: [GROUP] } }),
            entry(3, { student: { studentId: '2026002', realName: '李同学', schoolId: OTHER_SCHOOL, groupIds: [OTHER_GROUP] } }), entry(4)];
        for (const q of ['ALICE', '2', '2026001', '李同']) {
            assert.deepEqual(selectRankingPage(rows, query({ q, schoolId: SCHOOL, groupId: GROUP, binding: 'bound' }), 1, 100).rows.map((row) => row.uid), [2]);
        }
        assert.deepEqual(selectRankingPage(rows, query({ binding: 'unbound' }), 1, 100).rows.map((row) => row.uid), [4]);
        const empty = selectRankingPage(rows, query({ schoolId: SCHOOL, groupId: OTHER_GROUP }), 1, 100);
        assert.deepEqual(empty, { rows: [], count: 0, pages: 0 });
        assert.equal(selectRankingPage(rows, query({ q: '.*' }), 1, 100).count, 0);
    });

    it('rejects private filtering and student sorting for non-admins before data selection', () => {
        for (const raw of [{ q: '李' }, { schoolId: SCHOOL }, { groupId: GROUP }, { binding: 'unbound' }, { sort: 'student' }]) {
            assert.throws(() => query(raw, false), (error) => error instanceof RankingQueryError && error.forbidden);
        }
        assert.equal(query({ sort: 'rp:problem' }, false).sort, 'rp:problem');
        for (const raw of [{ sort: 'password' }, { sort: 'rp:hidden' }, { order: 'bad' }, { binding: 'invalid' }, { schoolId: 'other' }, { q: ['name'] }]) {
            assert.throws(() => query(raw), RankingQueryError);
        }
        assert.throws(() => selectRankingPage([], query(), 0, 100), RankingQueryError);
    });
});
