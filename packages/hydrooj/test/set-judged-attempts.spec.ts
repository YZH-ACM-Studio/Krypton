import assert from 'node:assert/strict';
import { it } from 'node:test';
import { ObjectId } from 'mongodb';
import { createDraftConfig, codeScoreForProblem, STATUS } from '@hydrooj/common';
import { judgedSetAttempts, hasPendingSetAttempts } from '../src/lib/set-judged-attempts';
import { withSetParticipantBoundary } from '../src/lib/set-participant-boundary';

const at = (seconds: number) => new Date(seconds * 1000);
const row = (seconds: number, score = 100) => ({ _id: ObjectId.createFromTime(seconds), pid: 1, score,
    status: score === 100 ? STATUS.STATUS_ACCEPTED : STATUS.STATUS_WRONG_ANSWER, judgeAt: at(seconds + 10) });

it('orders delayed grading by accepted submission time and charges lateness at acceptance', () => {
    const settings = createDraftConfig('homework').settings;
    settings.codePolicy = 'last';
    const attempts = judgedSetAttempts([
        { ...row(100), judgeAt: at(400), setAcceptedAt: at(100.5) },
        { ...row(200, 0), judgeAt: at(210), setAcceptedAt: at(200.5) },
    ]);
    assert.equal(codeScoreForProblem(settings, attempts)?.score, 0);
    settings.codePolicy = 'highest';
    settings.late = { enabled: true, onTimeAt: at(300), rules: { 0: 0.5 } };
    assert.equal(codeScoreForProblem(settings, attempts)?.score, 100);
    assert.equal(+judgedSetAttempts([row(100)])[0].acceptedAt, +at(100));
});

it('does not score pending or canceled Records and rejects malformed terminal facts', () => {
    assert.deepEqual(judgedSetAttempts([
        { ...row(1), status: STATUS.STATUS_JUDGING }, { ...row(2), status: STATUS.STATUS_CANCELED },
        { ...row(3), judgeAt: null }, { ...row(4), setAnswerVersion: 1 },
    ]), []);
    assert.throws(() => judgedSetAttempts([{ ...row(1), setAcceptedAt: 'bad' }]), /accepted_at_invalid/);
    assert.throws(() => judgedSetAttempts([{ ...row(1), score: Number.NaN }]), /score_invalid/);
    assert.throws(() => judgedSetAttempts([{ ...row(1), subtasks: { a: { score: '1', status: 1 } } }]), /subtasks_invalid/);
});

it('only the current manual-answer Record can hold the round pending', () => {
    const old = { ...row(1, 0), setAnswerVersion: 1, status: STATUS.STATUS_WAITING };
    const current = { ...row(2), setAnswerVersion: 2 };
    const answer = { pid: 1, version: 2, operationId: 'save', acceptedAt: at(2), body: {}, rawScore: 100,
        rid: current._id.toHexString(), status: STATUS.STATUS_ACCEPTED };
    assert.equal(hasPendingSetAttempts([old, current], [answer]), false);
    assert.equal(hasPendingSetAttempts([old, { ...current, status: STATUS.STATUS_WAITING }], [answer]), true);
});

it('allows nested participant operations while keeping other async callers serialized', async () => {
    const tid = new ObjectId();
    const trace: string[] = [];
    let release!: () => void;
    const wait = new Promise<void>((resolve) => { release = resolve; });
    const first = withSetParticipantBoundary('d', tid, 'u:1', async () => {
        await withSetParticipantBoundary('d', tid, 'u:1', async () => { trace.push('nested'); });
        await wait;
        trace.push('first');
    });
    const second = withSetParticipantBoundary('d', tid, 'u:1', async () => { trace.push('second'); });
    await Promise.resolve();
    assert.deepEqual(trace, ['nested']);
    release();
    await Promise.all([first, second]);
    assert.deepEqual(trace, ['nested', 'first', 'second']);
});

it('does not let a detached callback reuse ownership after the original participant operation completed', async () => {
    const tid = new ObjectId();
    const trace: string[] = [];
    let trigger!: () => void;
    const startLater = new Promise<void>((resolve) => { trigger = resolve; });
    let later!: Promise<void>;
    await withSetParticipantBoundary('d', tid, 'u:1', async () => {
        later = startLater.then(() => withSetParticipantBoundary('d', tid, 'u:1', async () => { trace.push('late'); }));
    });
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const owner = withSetParticipantBoundary('d', tid, 'u:1', async () => {
        trace.push('owner');
        await blocked;
        trace.push('owner-done');
    });
    trigger();
    await Promise.resolve();
    await Promise.resolve();
    assert.deepEqual(trace, ['owner']);
    release();
    await Promise.all([owner, later]);
    assert.deepEqual(trace, ['owner', 'owner-done', 'late']);
});

it('waits for already entered nested work even when its parent did not await it', async () => {
    const tid = new ObjectId();
    const trace: string[] = [];
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    let nested!: Promise<void>;
    const owner = withSetParticipantBoundary('d', tid, 'u:1', async () => {
        nested = withSetParticipantBoundary('d', tid, 'u:1', async () => {
            trace.push('nested');
            await blocked;
            trace.push('nested-done');
        });
    });
    const next = withSetParticipantBoundary('d', tid, 'u:1', async () => { trace.push('next'); });
    await Promise.resolve();
    await Promise.resolve();
    assert.deepEqual(trace, ['nested']);
    release();
    await Promise.all([owner, nested, next]);
    assert.deepEqual(trace, ['nested', 'nested-done', 'next']);
});
