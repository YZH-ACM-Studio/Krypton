import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { ObjectId } from 'mongodb';
import { PRIV } from '@hydrooj/common';
import { CAUC_GPLT_2026_REGISTRATIONS } from '../src/lib/public-board-caucgplt-2026';

const Module = require('node:module') as { _load: (request: string, parent: { filename: string }, isMain: boolean) => unknown };
const handlerPath = require.resolve('../src/handler/public-board');
const ids = [11, 12, 13, 14].map((uid) => new ObjectId(uid.toString().padStart(24, '0')));
const students = Object.fromEntries([['250340065', '刘卓'], ['240340109', '徐硕'], ['240340138', '闵安迪'], ['260340153', '刘琪']]
    .map(([studentId, realName], index) => [index + 11, { _id: ids[index], studentId, realName }]));
const boardRows = [11, 12, 13, 14, 2].map((uid) => ({ uid, rank: uid === 13 ? null : uid }));
let currentRows = boardRows;
let published = true;
let scoreCalls: Array<{ domainId: string; options: { studentDocIds: ObjectId[]; level: string } }> = [];
let scores = [
    { studentDocId: ids[0], year: 2026, score: 188 },
    { studentDocId: ids[1], year: 2026, score: 0 },
    { studentDocId: ids[2], year: 2026, score: 299 },
    { studentDocId: ids[3], year: 2025, score: 155 },
];
const initialScores = scores;

interface BoardResponse {
    rows: Array<{ uid: number; college: string | null; major: string | null }>;
    nationalScores?: { year: number; byUid: Record<number, number> };
}

class TestHandler {
    headers: Record<string, string> = {};
    response = {
        body: {} as BoardResponse,
        template: '',
        addHeader: (name: string, value: string) => { this.headers[name] = value; },
    };

    constructor(readonly admin = false) {}

    user = {
        hasPriv: (priv: number) => this.admin && priv === PRIV.PRIV_EDIT_SYSTEM,
        // Ordinary teachers/contest managers must not qualify through a domain permission.
        hasPerm: () => true,
        own: () => true,
    };
}

let Handler: new (admin?: boolean) => TestHandler & { get(domainId: string, series: string, year: number): Promise<void> };
const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
    if (parent.filename === handlerPath) {
        if (request === '../model/builtin') return { PRIV };
        if (request === '../service/server') return { Handler: TestHandler, param: () => () => {}, Types: {} };
        if (request === '../error') return { NotFoundError: Error };
        if (request === '../model/contest') {
            return {
                get: async () => ({ rule: 'ioi', title: 'CAUC', pids: [], beginAt: new Date(0), endAt: new Date(1) }),
                getParticipationMode: () => 'individual',
                isDone: () => published,
                isLocked: () => false,
                getMultiStatus: () => ({ toArray: async () => [] }),
            };
        }
        if (request === '../lib/public-contest-board') {
            return {
                buildPublicBoard: () => ({ rows: currentRows, columns: [], maxScore: 295, awards: {} }),
                LUCKY_BIG_RANKS: [7, 77, 177],
                LUCKY_YUAN: { big: 50, small: 10 },
            };
        }
        if (request === '../model/problem') return { __esModule: true, default: { getList: async () => ({}) } };
        if (request === '../model/user') return { __esModule: true, default: { getList: async () => Object.fromEntries(boardRows.map(({ uid }) => [uid, { uname: `user${uid}` }])) } };
        if (request === '../service/student-directory') return { studentDirectory: () => ({ findStudentsByUserIds: async () => students }) };
    }
    return originalLoad.call(this, request, parent, isMain);
};
try {
    const module = require('../src/handler/public-board') as { apply(ctx: { Route(name: string, path: string, handler: typeof Handler): void }): Promise<void> };
    void module.apply({ Route: (_name, _path, handler) => { Handler = handler; } });
} finally {
    Module._load = originalLoad;
}

const hydroGlobal = global as unknown as { Hydro: { model: { tasks?: { listGpltScores: (domainId: string, options: { studentDocIds: ObjectId[]; level: string }) => Promise<typeof scores> } } } };

beforeEach(() => {
    currentRows = boardRows;
    published = true;
    scores = initialScores;
    scoreCalls = [];
    hydroGlobal.Hydro = { model: { tasks: { listGpltScores: async (domainId, options) => {
        scoreCalls.push({ domainId, options });
        return scores;
    } } } };
});

async function loadBoard(admin = false) {
    const handler = new Handler(admin);
    await handler.get('another-domain', 'caucgplt', 2026);
    return handler;
}

describe('public board registration and national-score projection', () => {
    it('keeps only the requested affiliation fields in the registration snapshot', () => {
        assert.equal(Object.keys(CAUC_GPLT_2026_REGISTRATIONS).length, 317);
        for (const [studentId, affiliation] of Object.entries(CAUC_GPLT_2026_REGISTRATIONS)) {
            assert.match(studentId, /^\d{9}$/);
            assert.deepEqual(Object.keys(affiliation).sort(), ['college', 'major']);
            assert.ok(affiliation.college && affiliation.major);
        }
    });

    it('returns affiliations publicly but neither reads nor serializes national scores for non-admins', async () => {
        delete hydroGlobal.Hydro.model.tasks;
        const handler = await loadBoard();
        assert.equal(handler.response.body.rows.find((row) => row.uid === 11)?.college, '计算机与人工智能学院');
        assert.equal(handler.response.body.rows.find((row) => row.uid === 11)?.major, '智能与计算机类');
        assert.equal(handler.response.body.rows.find((row) => row.uid === 13)?.college, '计算机与人工智能学院');
        assert.equal(handler.response.body.rows.find((row) => row.uid === 2)?.college, null);
        assert.equal(handler.response.body.rows.find((row) => row.uid === 2)?.major, null);
        assert.equal(Object.hasOwn(handler.response.body, 'nationalScores'), false);
        assert.equal(JSON.stringify(handler.response.body).includes('studentDocId'), false);
        assert.equal(scoreCalls.length, 0);
        assert.equal(handler.headers['Cache-Control'], 'private, no-store');
    });

    it('joins only 2026 national results to non-star students for system administrators', async () => {
        const handler = await loadBoard(true);
        assert.deepEqual(scoreCalls.map(({ domainId, options }) => ({ domainId, level: options.level, ids: options.studentDocIds.map(String) })), [
            { domainId: 'system', level: 'national', ids: [ids[0], ids[1], ids[3]].map(String) },
        ]);
        assert.deepEqual(handler.response.body.nationalScores, { year: 2026, byUid: { 11: 188, 12: 0 } });
        assert.equal(handler.headers['Cache-Control'], 'private, no-store');
    });

    it('does not query the entire score store for an empty eligible roster', async () => {
        currentRows = boardRows.filter((row) => row.uid === 13 || row.uid === 2);
        const handler = await loadBoard(true);
        assert.deepEqual(handler.response.body.nationalScores, { year: 2026, byUid: {} });
        assert.equal(scoreCalls.length, 0);
    });

    it('withholds both projections until results are published', async () => {
        published = false;
        const handler = await loadBoard(true);
        assert.equal(Object.hasOwn(handler.response.body, 'rows'), false);
        assert.equal(Object.hasOwn(handler.response.body, 'nationalScores'), false);
        assert.equal(scoreCalls.length, 0);
    });

    it('fails visibly when the administrator score reader is unavailable or fails', async () => {
        delete hydroGlobal.Hydro.model.tasks;
        await assert.rejects(loadBoard(true), /GPLT score reader is unavailable/);
        hydroGlobal.Hydro.model.tasks = { listGpltScores: async () => { throw new Error('score store unavailable'); } };
        await assert.rejects(loadBoard(true), /score store unavailable/);
    });

    it('rejects corrupt or duplicate national scores instead of silently choosing a value', async () => {
        scores = [initialScores[0], { ...initialScores[0], score: 199 }];
        await assert.rejects(loadBoard(true), /invalid or duplicate national score/);
        scores = [{ ...initialScores[0], score: Number.NaN }];
        await assert.rejects(loadBoard(true), /invalid or duplicate national score/);
    });
});
