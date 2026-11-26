import assert from 'node:assert/strict';
import { beforeEach, it } from 'node:test';
import { ObjectId } from 'mongodb';
import { createDraftConfig } from '@hydrooj/common';
import type { Tdoc } from '../src/interface';

const Module = require('module');
const originalLoad = Module._load;
let issued: { participantKey: string; paperPids: number[]; legacy?: { scoreLocked: boolean } }[];
const bank = { getList: async (_domain: string, pids: number[]) => Object.fromEntries(pids.map((pid) => [
    pid, { docId: pid, problemKind: 'programming', config: { type: 'default', maxScore: pid === 1 ? 10 : 100 } },
])) };
Module._load = function load(request: string, parent: NodeModule, main: boolean) {
    if (/\/set-paper-edit\.ts$|\/set-publish-facts\.ts$/.test(parent.filename)) {
        if (request === '../model/problem') return { __esModule: true, default: bank };
        if (request === '../service/db') return { __esModule: true, default: { collection: () => ({ find: () => ({ toArray: async () => issued }) }) } };
    }
    return originalLoad.call(this, request, parent, main);
};
let plan: typeof import('../src/lib/set-paper-edit').planPaperPointsEdit;
try {
    ({ planPaperPointsEdit: plan } = require('../src/lib/set-paper-edit'));
} finally {
    Module._load = originalLoad;
}

let doc: Tdoc;
let edit: { revision: number; target: number | null; points: Record<number, number>; excluded: number[]; quotas: { programming: number } | null };
const save = (fields: object = {}, pids = doc.pids) => plan(doc, pids, JSON.stringify({ ...edit, ...fields }), 17);
beforeEach(() => {
    const config = createDraftConfig('homework');
    config.publication = 'published';
    doc = { _id: new ObjectId(), docType: 30, title: '配分验证', content: '', owner: 17, attend: 0, rule: 'homework', duration: 0, domainId: 'test', docId: new ObjectId(), beginAt: new Date('2026-11-01'), endAt: new Date('2026-11-30'),
        pids: [1, 2, 3], score: { 1: 20, 2: 60, 3: 30 }, setConfig: config };
    edit = { revision: config.revision, target: null, points: { 1: 2, 2: 60, 3: 30 }, excluded: [], quotas: null };
    issued = [];
});

it('saves an advisory target without converting legacy marks, then adopts local marks after an explicit change', async () => {
    const hint = await save({ target: 100 });
    assert.equal(hint.patch?.setTargetScore, 100);
    assert.equal(hint.patch?.setPoints, undefined);
    assert.equal(hint.needsRecalc, false);
    const converted = await save({ points: { ...edit.points, 1: 20.05 } });
    assert.deepEqual(converted.patch?.setPoints?.[1], { rawMax: 10, points: 20.05 });
    assert.deepEqual(converted.patch?.setPoints?.[2], { rawMax: 100, points: 60, fromLegacyWeight: true });
    assert.deepEqual(doc.score, { 1: 20, 2: 60, 3: 30 });
    assert.deepEqual(converted.changedPids, [1]);
    await assert.rejects(save({ points: { ...edit.points, 1: 2.555 } }));
    await assert.rejects(save({ revision: 999, target: 100 }));
});

it('deduplicates impacted students, preserves locked grades and binds the reason to the current impact', async () => {
    issued = [{ participantKey: 'u:1', paperPids: [1, 2] }, { participantKey: 'u:1', paperPids: [1, 2] },
        { participantKey: 'u:2', paperPids: [2, 3] }, { participantKey: 'u:3', paperPids: [1, 3], legacy: { scoreLocked: true } }];
    edit.excluded = [1];
    const { confirmation } = await save();
    assert.ok(confirmation);
    assert.equal(confirmation.participants, 1);
    assert.equal(confirmation.locked, 1);
    assert.deepEqual(confirmation.changes, ['62 → 60']);
    await assert.rejects(save({ confirm: confirmation.fingerprint, reason: '  ' }));
    issued.push({ participantKey: 'u:4', paperPids: [1, 3] });
    const refreshed = await save({ confirm: confirmation.fingerprint, reason: '题意冲突' });
    assert.ok(refreshed.confirmation);
    assert.equal(refreshed.confirmation.participants, 2);
    const saved = await save({ confirm: refreshed.confirmation.fingerprint, reason: '题意冲突' });
    assert.equal(saved.audit?.reason, '题意冲突');
    assert.equal(saved.patch?.setConfig?.publication, 'published');
    assert.ok(saved.patch?.statusRecalcToken);
    assert.deepEqual(saved.patch.setPoints?.[1], { rawMax: 10, points: 2, excluded: true });
    assert.deepEqual(issued[0].paperPids, [1, 2]);
    assert.ok(saved.revision);
    doc = { ...doc, ...saved.patch };
    edit.revision = saved.revision;
    edit.excluded = [];
    const undo = await save();
    assert.deepEqual(undo.confirmation?.changes, ['30 → 32', '60 → 62']);
});

it('refuses a zero-point issued paper, an unreachable pass mark and physical removal of issued questions', async () => {
    issued = [{ participantKey: 'u:1', paperPids: [1] }];
    await assert.rejects(save({ excluded: [1] }));
    await assert.rejects(save({ points: { 2: 60, 3: 30 } }, [2, 3]));
    issued[0].paperPids = [1, 3];
    doc.setConfig.settings.retake.passScore = 32;
    await assert.rejects(save({ excluded: [1] }));
    doc.setConfig.settings.retake.passScore = 30;
    assert.ok((await save({ excluded: [1] })).confirmation);
});

it('allows a withdrawal and replacement or lower draw quota in the same edit', async () => {
    doc.setConfig.settings.draw = { ...doc.setConfig.settings.draw, enabled: true, redrawEachRound: false, quotas: { programming: 3 } };
    issued = [{ participantKey: 'u:1', paperPids: [1, 2, 3] }];
    edit.excluded = [1];
    edit.quotas = { programming: 3 };
    await assert.rejects(save());
    assert.ok((await save({ quotas: { programming: 2 } })).confirmation);
    assert.ok((await save({ points: { ...edit.points, 4: 15 } }, [1, 2, 3, 4])).confirmation);
    edit.excluded = [];
    await assert.rejects(save({ quotas: { programming: 2 } }));
    doc.setConfig.settings.codePolicy = 'acm';
    await assert.rejects(save());
});
