import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { BSON, MongoClient, ObjectId, type Document } from 'mongodb';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { LEGACY_CONTEST_RULES } from '@hydrooj/common';
import {
    applyMigration, assertMigrationConnection, migrationHash, mongoMigrateStore, planMigration, SET_MIGRATE_COLLECTIONS, verifyMigration,
    type MigrationSnapshot, type MigratePlan, type MigrateStore,
} from '../src/lib/set-migrate-tool';
import { runSetMigrateCommand } from '../src/commands/set-migrate';

const begin = new Date('2026-11-01T00:00:00Z');
const end = new Date('2026-11-01T02:00:00Z');
const now = new Date('2026-11-01T03:00:00Z');
function id(seconds: number, discriminator = 0): ObjectId {
    return new ObjectId(`${ObjectId.createFromTime(begin.getTime() / 1000 + seconds).toHexString().slice(0, 8)}${discriminator.toString(16).padStart(16, '0')}`);
}
function clone<T>(value: T): T { return BSON.EJSON.deserialize(BSON.EJSON.serialize(value)) as T; }
function fixtures(): { snapshot: MigrationSnapshot; tids: ObjectId[] } {
    const snapshot = Object.fromEntries(SET_MIGRATE_COLLECTIONS.map((collection) => [collection, []])) as MigrationSnapshot;
    const tids: ObjectId[] = [];
    for (const [index, rule] of LEGACY_CONTEST_RULES.entries()) {
        const tid = id(0, index + 1);
        tids.push(tid);
        const pid = index + 1;
        const rid = id(100, pid);
        const uid = 100 + pid;
        const detail: Document = { pid, rid, score: 100, status: 1 };
        const record: Document = { _id: rid, domainId: 'test', contest: tid, uid, pid, score: 100, status: 1, code: 'int main() {}', lang: 'cpp', judgeAt: new Date(begin.getTime() + 110_000) };
        if (rule === 'strictioi') {
            record.subtasks = { 1: { score: 100, status: 1 } };
            detail.subtasks = clone(record.subtasks);
        }
        const status: Document = { _id: id(0, 200 + pid), domainId: 'test', docType: 30, docId: tid, uid, attend: 1, journal: [clone(detail)], detail: { [pid]: clone(detail) }, score: 100 };
        const contest: Document = { _id: id(0, 300 + pid), domainId: 'test', docType: 30, docId: tid, rule, beginAt: begin, endAt: end, pids: [pid], owner: 42 };
        if (rule === 'homework') {
            contest.penaltySince = end;
            contest.penaltyRules = {};
            status.penaltyScore = 100;
            status.detail[pid].penaltyScore = 100;
            status.detail[pid].time = 100;
            status.time = 100;
        }
        if (rule === 'exam') {
            Object.assign(contest, { examAttemptLimit: 4, examPassScore: 60 });
            Object.assign(status, { startAt: begin, paperFinalizedAt: new Date(begin.getTime() + 200_000), examAttemptsUsed: 3, examJournalAfter: id(1) });
        }
        if (rule === 'acm') {
            Object.assign(status, { accept: 1, time: 100 });
            Object.assign(status.detail[pid], { real: 100, penalty: 0, naccept: 0, time: 100 });
        }
        if (rule === 'ledo') status.detail[pid].penaltyScore = 100;
        snapshot.document.push(contest, { _id: id(0, 400 + pid), docType: 10, domainId: 'test', docId: pid, problemKind: 'programming', config: 'type: default\n' });
        snapshot['document.status'].push(status);
        snapshot.record.push(record);
        snapshot['vigil.paper_draft'].push({ _id: id(0, 500 + pid), domainId: 'test', tid, uid, pid, answers: { main: 'draft-secret' }, updatedAt: now });
    }
    snapshot.document.push({ _id: id(0, 900), docType: 60, domainId: 'test', courseId: id(0, 901), homeworkIds: tids, content: 'untouched course links' });
    snapshot.document.push({ _id: id(0, 902), docType: 30, domainId: 'other', docId: id(0, 903), rule: 'oi', pids: [999] });
    return { snapshot, tids };
}
function memoryStore(input: MigrationSnapshot): MigrateStore & { data: MigrationSnapshot; writes: number } {
    return {
        data: clone(input), writes: 0, databaseName: 'set_migrate_test', connectionFingerprint: 'test-connection',
        async snapshot() { return clone(this.data); },
        async compareAndSwap(change) {
            const rows = this.data[change.collection];
            const index = rows.findIndex((row) => row._id.equals(change.id));
            const current = index < 0 ? null : rows[index];
            if (migrationHash(current) !== migrationHash(change.before)) return false;
            if (index < 0) rows.push(clone(change.after));
            else rows[index] = clone(change.after);
            this.writes += 1;
            return true;
        },
    };
}
function gates(plan: MigratePlan) {
    return { fingerprint: plan.fingerprint, backupConfirmed: plan.fingerprint, confirm: `APPLY:set-migrate:${plan.databaseName}:${plan.fingerprint}`, serviceStopped: true };
}
function plannedFixture() {
    const fixture = fixtures();
    const store = memoryStore(fixture.snapshot);
    const plan = planMigration(fixture.snapshot, { domainId: 'test', tids: fixture.tids }, store, now);
    return { ...fixture, store, plan };
}

describe('real legacy problem-set migration', () => {
    it('migrates all seven rules with original scores, current attempt ordinal, real record refs and unchanged drafts/course links', async () => {
        const { store, plan, snapshot } = plannedFixture();
        assert.deepEqual(plan.diagnostics, []);
        assert.equal(plan.participants.length, 7);
        const exam = plan.participants.find((row) => row.roundNo === 3)!;
        assert.equal(exam.missingRounds, 2);
        const draftHash = migrationHash(snapshot['vigil.paper_draft']);
        const result = await applyMigration(store, plan, gates(plan));
        assert.equal(result.written, 28);
        assert.equal(store.data['contest.rounds'].length, 7);
        assert.equal(store.data['contest.answers'].length, 0);
        assert.equal(migrationHash(store.data['vigil.paper_draft']), draftHash);
        for (const record of store.data.record) {
            assert.ok(record.setRoundId instanceof ObjectId);
            assert.deepEqual(record.setAcceptedAt, record._id.getTimestamp());
            assert.notDeepEqual(record.setAcceptedAt, record.judgeAt);
        }
        await verifyMigration(store, plan);
        assert.deepEqual(await applyMigration(store, plan, gates(plan)), { written: 0, kept: 28 });
    });
    it('does not create a round or formal answer for an attended user with only an unsent draft', async () => {
        const { snapshot, tids } = fixtures();
        const status = snapshot['document.status'][0];
        delete status.journal;
        delete status.detail;
        delete status.score;
        delete status.penaltyScore;
        delete status.time;
        snapshot.record = snapshot.record.filter((row) => !row.contest.equals(tids[0]));
        const store = memoryStore(snapshot);
        const plan = planMigration(snapshot, { domainId: 'test', tids: [tids[0]] }, store, now);
        assert.deepEqual(plan.diagnostics, []);
        assert.equal(plan.participants.length, 0);
        await applyMigration(store, plan, gates(plan));
        assert.equal(store.data['contest.rounds'].length, 0);
        assert.equal(store.data['contest.answers'].length, 0);
    });
    it('preserves each legacy selection policy with multiple attempts, weights, lateness and ACM penalties', () => {
        for (const [index, rule] of LEGACY_CONTEST_RULES.entries()) {
            const { snapshot, tids } = fixtures();
            const contest = snapshot.document.find((row) => row.docType === 30 && row.docId.equals(tids[index]))!;
            const status = snapshot['document.status'][index];
            const first = snapshot.record[index];
            const pid = first.pid;
            const second = { ...clone(first), _id: id(200, pid), score: 80, status: 2, judgeAt: new Date(begin.getTime() + 210_000) };
            contest.score = { [pid]: 50 };
            const journal = (record: Document) => ({ rid: record._id, pid, score: record.score, status: record.status,
                ...(record.subtasks ? { subtasks: clone(record.subtasks) } : {}) });
            let selected: Document = journal(second);
            let total = 40;
            if (rule === 'homework') {
                contest.penaltySince = new Date(begin.getTime() + 50_000);
                contest.penaltyRules = { 0: 0.5 };
                selected = { ...selected, penaltyScore: 20, time: 200 };
                status.penaltyScore = 20;
                total = 80; // Legacy homework.score is raw; penaltyScore is the effective total.
            }
            if (rule === 'exam') status.paperFinalizedAt = new Date(begin.getTime() + 300_000);
            if (rule === 'acm') {
                Object.assign(first, { score: 0, status: 2 });
                Object.assign(second, { score: 100, status: 1 });
                selected = { ...journal(second), real: 200, penalty: 1200, time: 1400 };
                Object.assign(status, { accept: 1, time: 1400 });
                total = 0;
            }
            if (rule === 'ioi') {
                selected = journal(first);
                total = 50;
            }
            if (rule === 'strictioi') {
                Object.assign(first, { score: 60, status: 2, subtasks: { a: { score: 60, status: 1 }, b: { score: 0, status: 2 } } });
                Object.assign(second, { score: 80, status: 2, subtasks: { a: { score: 40, status: 2 }, b: { score: 40, status: 1 } } });
                selected = { ...journal(second), score: 100, status: 1, subtasks: { a: { score: 60, status: 1 }, b: { score: 40, status: 1 } } };
                total = 50;
            }
            if (rule === 'ledo') {
                first.score = 80;
                second.score = 100;
                selected = { ...journal(second), penaltyScore: 95 };
                total = 47.5;
            }
            snapshot.record.push(second);
            status.journal = [journal(first), rule === 'strictioi' ? clone(selected) : journal(second)];
            status.detail = { [pid]: selected };
            status.score = total;
            const store = memoryStore(snapshot);
            const plan = planMigration(snapshot, { domainId: 'test', tids: [tids[index]] }, store, now);
            assert.deepEqual(plan.diagnostics, [], rule);
            assert.equal(plan.participants[0].total, rule === 'homework' ? 20 : rule === 'acm' ? 1 : total);
            assert.equal(plan.participants[0].scoreLocked, false);
        }
    });
    it('accepts the real empty legacy programming config without inventing config contents', () => {
        const { snapshot, tids } = fixtures();
        for (const doc of snapshot.document.filter((row) => row.docType === 10)) doc.config = '';
        const plan = planMigration(snapshot, { domainId: 'test', tids }, memoryStore(snapshot), now);
        assert.deepEqual(plan.diagnostics, []);
    });
    it('reconstructs the formally submitted objective Record and leaves the newer draft untouched', async () => {
        const { snapshot, tids } = fixtures();
        Object.assign(snapshot.document.find((row) => row.docType === 10 && row.docId === 1)!, { problemKind: 'single', config: { type: 'objective', answers: { q: ['A', 100, { kind: 'single' }] } } });
        snapshot.record[0].code = 'q: A\n';
        snapshot['vigil.paper_draft'][0].answers = { q: 'B' };
        const store = memoryStore(snapshot);
        const plan = planMigration(snapshot, { domainId: 'test', tids: [tids[0]] }, store, now);
        assert.deepEqual(plan.diagnostics, []);
        await applyMigration(store, plan, gates(plan));
        assert.deepEqual(store.data['contest.answers'][0].body, { q: 'A' });
        assert.deepEqual(store.data['vigil.paper_draft'][0].answers, { q: 'B' });
        const answer = store.data['contest.answers'][0];
        const accepted = store.data.record[0];
        assert.equal(answer.rid, accepted._id.toHexString());
        assert.equal(accepted.setAnswerVersion, answer.version);
        assert.equal(accepted.setAnswerOperationId, answer.operationId);
        assert.deepEqual(store.data['contest.answerOperations'][0].planned.changed, [Object.fromEntries(Object.entries(answer).filter(([key]) => !['_id', 'domainId', 'roundId'].includes(key)))]);
    });
    it('retains proven manual-pending submissions and their grading linkage', async () => {
        const { snapshot, tids } = fixtures();
        Object.assign(snapshot.document.find((row) => row.docType === 10 && row.docId === 1)!, { problemKind: 'subjective', config: '' });
        Object.assign(snapshot.record[0], { code: 'A written response', score: 0, status: 0, judgeAt: null, manualPending: true });
        const status = snapshot['document.status'][0];
        Object.assign(status, { score: 0, penaltyScore: 0 });
        Object.assign(status.journal[0], { score: 0, status: 0 });
        Object.assign(status.detail[1], { score: 0, status: 0, penaltyScore: 0 });
        const store = memoryStore(snapshot);
        const plan = planMigration(snapshot, { domainId: 'test', tids: [tids[0]] }, store, now);
        assert.deepEqual(plan.diagnostics, []);
        await applyMigration(store, plan, gates(plan));
        assert.equal(store.data.record[0].code, 'A written response');
        assert.equal(store.data.record[0].manualPending, true);
        assert.deepEqual(store.data['contest.answers'][0].body, { main: 'A written response' });
        assert.equal(store.data['contest.answers'][0].status, 0);
        assert.equal(store.data['contest.rounds'][0].judgePending, true);
        assert.equal(store.data['contest.rounds'][0].legacy.scoreLocked, false);
    });
    it('preserves official objective history needed by a later frozen scoreboard', async () => {
        const { snapshot, tids } = fixtures();
        Object.assign(snapshot.document.find((row) => row.docType === 10 && row.docId === 1)!, { problemKind: 'single', config: '' });
        snapshot.record[0].code = 'q: A\n';
        const second = { ...clone(snapshot.record[0]), _id: id(200, 1), code: 'q: B\n', score: 60, status: 2, judgeAt: new Date(begin.getTime() + 210_000) };
        snapshot.record.push(second);
        const status = snapshot['document.status'][0];
        const detail = { pid: 1, rid: second._id, score: 60, status: 2 };
        status.journal.push(detail);
        Object.assign(status, { score: 60, penaltyScore: 60, detail: { 1: { ...detail, penaltyScore: 60 } } });
        const store = memoryStore(snapshot);
        const plan = planMigration(snapshot, { domainId: 'test', tids: [tids[0]] }, store, now);
        assert.deepEqual(plan.diagnostics, []);
        await applyMigration(store, plan, gates(plan));
        assert.equal(store.data['contest.answers'][0].version, 2);
        assert.deepEqual(store.data['contest.answerOperations'].map((operation) => operation.planned.changed[0].body), [{ q: 'A' }, { q: 'B' }]);
        assert.deepEqual(store.data['contest.answerOperations'].map((operation) => operation.acceptedAt), [id(100, 1).getTimestamp(), second._id.getTimestamp()]);
    });
    it('diagnoses frozen non-latest answers, aggregate-only grades and records after the proved close', () => {
        for (const corrupt of [
            (snapshot: MigrationSnapshot) => {
                Object.assign(snapshot.document.find((row) => row.docType === 10 && row.docId === 4)!, { problemKind: 'single', config: '' });
                snapshot.record[3].code = 'q: A\n';
                const later = { ...clone(snapshot.record[3]), _id: id(200, 4), code: 'q: B\n', score: 0, status: 2, judgeAt: new Date(begin.getTime() + 210_000) };
                snapshot.record.push(later);
                snapshot['document.status'][3].journal.push({ rid: later._id, pid: 4, score: 0, status: 2 });
            },
            (snapshot: MigrationSnapshot) => {
                delete snapshot['document.status'][3].journal;
                delete snapshot['document.status'][3].detail;
                snapshot.record = snapshot.record.filter((row) => row.pid !== 4);
            },
            (snapshot: MigrationSnapshot) => { snapshot['document.status'][1].paperFinalizedAt = new Date(begin.getTime() + 50_000); },
        ]) {
            const { snapshot, tids } = fixtures();
            corrupt(snapshot);
            const plan = planMigration(snapshot, { domainId: 'test', tids }, memoryStore(snapshot), now);
            assert.ok(plan.diagnostics.length > 0);
        }
    });
    it('locks confirmed closed scores when judge completion is missing, and rejects such open rounds', () => {
        const { snapshot, tids } = fixtures();
        snapshot.record[0].judgeAt = null;
        const store = memoryStore(snapshot);
        const closed = planMigration(snapshot, { domainId: 'test', tids: [tids[0]] }, store, now);
        assert.deepEqual(closed.diagnostics, []);
        assert.equal(closed.participants[0].scoreLocked, true);
        const open = planMigration(snapshot, { domainId: 'test', tids: [tids[0]] }, store, new Date(begin.getTime() + 500_000));
        assert.equal(open.diagnostics[0].code, 'set_migrate_open_round_incomplete');
    });
    it('accepts ACM journals without unused points or subtasks but still rejects different verdicts', () => {
        const { snapshot, tids } = fixtures();
        const index = LEGACY_CONTEST_RULES.indexOf('acm');
        snapshot.record[index].subtasks = { 1: { score: 100, status: 1 } };
        const plan = () => planMigration(snapshot, { domainId: 'test', tids: [tids[index]] }, memoryStore(snapshot), now);
        assert.deepEqual(plan().diagnostics, []);
        snapshot['document.status'][index].journal[0].score = 0;
        assert.deepEqual(plan().diagnostics, []);
        snapshot['document.status'][index].journal[0].status = 2;
        assert.equal(plan().diagnostics[0].code, 'set_migrate_record_journal_conflict');
    });
    it('preserves weighted historical floating-point totals exactly and rejects real grade changes', () => {
        const { snapshot, tids } = fixtures();
        const index = LEGACY_CONTEST_RULES.indexOf('ioi');
        const pid = index + 1;
        const contest = snapshot.document.find((row) => row.docType === 30 && row.docId.equals(tids[index]))!;
        const status = snapshot['document.status'][index];
        contest.score = { [pid]: 7 };
        snapshot.record[index].score = 61;
        status.journal[0].score = 61;
        status.detail[pid].score = 61;
        status.score = (7 * 61) / 100;
        assert.notEqual(status.score, 61 * (7 / 100));
        const plan = () => planMigration(snapshot, { domainId: 'test', tids: [tids[index]] }, memoryStore(snapshot), now);
        assert.deepEqual(plan().diagnostics, []);
        assert.equal(plan().participants[0].total, status.score);
        status.score += 0.01;
        assert.equal(plan().diagnostics[0].code, 'set_migrate_stored_score_detail_conflict');
    });
    it('retains removed-question Records unchanged, locks closed grades, and rejects an incomplete open paper', async () => {
        const { snapshot, tids } = fixtures();
        const index = LEGACY_CONTEST_RULES.indexOf('ioi');
        const removed = { ...clone(snapshot.record[index]), _id: id(50, 999), pid: 999, score: 0, status: 2 };
        snapshot.record.push(removed);
        snapshot['document.status'][index].journal.unshift({ rid: removed._id, pid: 999, score: 0, status: 2 });
        const store = memoryStore(snapshot);
        const scope = { domainId: 'test', tids: [tids[index]] };
        const plan = planMigration(snapshot, scope, store, now);
        assert.deepEqual(plan.diagnostics, []);
        assert.equal(plan.participants[0].scoreLocked, true);
        assert.equal(plan.participants[0].total, 100);
        await applyMigration(store, plan, gates(plan));
        assert.deepEqual(store.data.record.find((row) => row._id.equals(removed._id)), removed);
        assert.deepEqual(store.data['contest.rounds'][0].legacy.incompleteReasons, ['record_outside_paper']);
        const open = planMigration(snapshot, scope, memoryStore(snapshot), new Date(begin.getTime() + 500_000));
        assert.equal(open.diagnostics[0].code, 'set_migrate_open_round_incomplete');
        removed._id = id(-100, 999);
        snapshot['document.status'][index].journal[0].rid = removed._id;
        assert.equal(planMigration(snapshot, scope, memoryStore(snapshot), now).diagnostics[0].code, 'set_migrate_record_time_conflict');
    });
    it('locks a closed exam with an old pid-0 waiting placeholder without repairing its historical zero grade', async () => {
        const { snapshot, tids } = fixtures();
        const index = LEGACY_CONTEST_RULES.indexOf('exam');
        const status = snapshot['document.status'][index];
        Object.assign(status, { score: 0, detail: {} });
        Object.assign(status.journal[0], { pid: 0, status: 0, score: 0 });
        const store = memoryStore(snapshot);
        const scope = { domainId: 'test', tids: [tids[index]] };
        const plan = planMigration(snapshot, scope, store, now);
        assert.deepEqual(plan.diagnostics, []);
        await applyMigration(store, plan, gates(plan));
        assert.equal(store.data['contest.rounds'][0].total, 0);
        assert.equal(store.data.record[index].score, 100);
        assert.deepEqual(store.data['contest.rounds'][0].legacy.incompleteReasons, ['exam_waiting_placeholder']);
        assert.deepEqual(store.data['document.status'][index].journal, status.journal);
        delete status.paperFinalizedAt;
        assert.equal(planMigration(snapshot, scope, memoryStore(snapshot), new Date(begin.getTime() + 500_000)).diagnostics[0].code, 'set_migrate_open_round_incomplete');
        status.paperFinalizedAt = new Date(begin.getTime() + 200_000);
        status.journal[0].pid = 999;
        assert.equal(planMigration(snapshot, scope, memoryStore(snapshot), now).diagnostics[0].code, 'set_migrate_record_journal_conflict');
    });
    it('rejects invalid historical problem IDs even when the round is closed', () => {
        for (const pid of ['corrupt', 0, -1, 1.5]) {
            const { snapshot, tids } = fixtures();
            const index = LEGACY_CONTEST_RULES.indexOf('ioi');
            const invalid: Document = { ...clone(snapshot.record[index]), _id: id(50, 999), pid };
            snapshot.record.push(invalid);
            snapshot['document.status'][index].journal.push({ rid: invalid._id, pid, score: invalid.score, status: invalid.status });
            const plan = planMigration(snapshot, { domainId: 'test', tids: [tids[index]] }, memoryStore(snapshot), now);
            assert.equal(plan.diagnostics[0].code, 'set_migrate_record_pid_invalid');
        }
    });
    it('rejects a closed exam Record outside its proven frozen paper even when it belongs to the pool', () => {
        const { snapshot, tids } = fixtures();
        const index = LEGACY_CONTEST_RULES.indexOf('exam');
        const contest = snapshot.document.find((row) => row.docType === 30 && row.docId.equals(tids[index]))!;
        contest.pids.push(999);
        contest.examPaperQuotas = { programming: 1 };
        const status = snapshot['document.status'][index];
        status.examPaperPids = [index + 1];
        snapshot.document.push({ _id: id(0, 1999), docType: 10, domainId: 'test', docId: 999, problemKind: 'programming', config: 'type: default\n' });
        const outside: Document = { ...clone(snapshot.record[index]), _id: id(50, 999), pid: 999 };
        snapshot.record.push(outside);
        status.journal.push({ rid: outside._id, pid: 999, score: outside.score, status: outside.status });
        const plan = planMigration(snapshot, { domainId: 'test', tids: [tids[index]] }, memoryStore(snapshot), now);
        assert.equal(plan.diagnostics[0].code, 'set_migrate_record_outside_paper');
    });
    it('preserves provable older submissions before a changed schedule as locked history, without rebinding their Records', async () => {
        const { snapshot, tids } = fixtures();
        const index = LEGACY_CONTEST_RULES.indexOf('ioi');
        const record = snapshot.record[index];
        const contest = snapshot.document.find((row) => row.docType === 30 && row.docId.equals(tids[index]))!;
        const status = snapshot['document.status'][index];
        status.startAt = begin;
        contest.beginAt = new Date(begin.getTime() + 300_000);
        const store = memoryStore(snapshot);
        const scope = { domainId: 'test', tids: [tids[index]] };
        const plan = planMigration(snapshot, scope, store, now);
        assert.deepEqual(plan.diagnostics, []);
        await applyMigration(store, plan, gates(plan));
        assert.deepEqual(store.data.record[index], record);
        assert.equal(store.data['contest.rounds'][0].total, 100);
        assert.deepEqual(store.data['contest.rounds'][0].legacy.incompleteReasons, ['record_before_current_window']);
        assert.equal(planMigration(snapshot, scope, memoryStore(snapshot), new Date(begin.getTime() + 500_000)).diagnostics[0].code, 'set_migrate_record_time_conflict');
        status.startAt = new Date(begin.getTime() + 200_000);
        assert.equal(planMigration(snapshot, scope, memoryStore(snapshot), now).diagnostics[0].code, 'set_migrate_record_time_conflict');
    });
    it('accepts a submission in the opening second despite fractional start timestamps', () => {
        const { snapshot, tids } = fixtures();
        const index = LEGACY_CONTEST_RULES.indexOf('ioi');
        const contest = snapshot.document.find((row) => row.docType === 30 && row.docId.equals(tids[index]))!;
        contest.beginAt = new Date(begin.getTime() + 100_500);
        snapshot['document.status'][index].startAt = begin;
        const plan = planMigration(snapshot, { domainId: 'test', tids: [tids[index]] }, memoryStore(snapshot), now);
        assert.deepEqual(plan.diagnostics, []);
        assert.equal(plan.participants[0].scoreLocked, false);
        assert.ok(plan.mutations.some((item) => item.collection === 'record' && item.id.equals(snapshot.record[index]._id)));
    });
    it('restores the selected formal answer without promoting older Records outside the current window', () => {
        const { snapshot, tids } = fixtures();
        const index = LEGACY_CONTEST_RULES.indexOf('ioi');
        const record = snapshot.record[index];
        const contest = snapshot.document.find((row) => row.docType === 30 && row.docId.equals(tids[index]))!;
        const status = snapshot['document.status'][index];
        Object.assign(snapshot.document.find((row) => row.docType === 10 && row.docId === record.pid)!, { problemKind: 'single', config: '' });
        record.code = 'q: A\n';
        const older: Document = { ...clone(record), _id: id(50, 999), score: 0, status: 2, code: 'q: B\n' };
        snapshot.record.push(older);
        status.journal.unshift({ rid: older._id, pid: older.pid, score: older.score, status: older.status });
        status.startAt = begin;
        contest.beginAt = new Date(begin.getTime() + 90_000);
        const plan = planMigration(snapshot, { domainId: 'test', tids: [tids[index]] }, memoryStore(snapshot), now);
        assert.deepEqual(plan.diagnostics, []);
        assert.equal(plan.participants[0].scoreLocked, true);
        assert.equal(plan.participants[0].total, 100);
        assert.ok(!plan.mutations.some((item) => item.collection === 'record' && item.id.equals(older._id)));
        const operations = plan.mutations.filter((item) => item.collection === 'contest.answerOperations');
        assert.equal(operations.length, 1);
        assert.deepEqual(operations[0].after.planned.changed[0].body, { q: 'A' });
    });
    it('reports malformed official bodies without exposing the answer in CLI diagnostics', () => {
        const { snapshot, tids } = fixtures();
        Object.assign(snapshot.document.find((row) => row.docType === 10 && row.docId === 1)!, { problemKind: 'single', config: '' });
        snapshot.record[0].code = 'q: [STUDENT_ANSWER_SECRET';
        const plan = planMigration(snapshot, { domainId: 'test', tids: [tids[0]] }, memoryStore(snapshot), now);
        assert.ok(plan.diagnostics[0].code.startsWith('set_migrate_official_body_parse_invalid:'));
        assert.ok(!JSON.stringify(plan.diagnostics).includes('STUDENT_ANSWER_SECRET'));
    });
    it('preserves a closed historical score with missing Records and refuses an incomplete open round', async () => {
        const { snapshot, tids } = fixtures();
        snapshot.record = snapshot.record.filter((row) => !row.contest.equals(tids[1]));
        const store = memoryStore(snapshot);
        const plan = planMigration(snapshot, { domainId: 'test', tids: [tids[1]] }, store, now);
        assert.deepEqual(plan.diagnostics, []);
        assert.equal(plan.participants[0].scoreLocked, true);
        await applyMigration(store, plan, gates(plan));
        assert.equal(store.data['contest.rounds'][0].total, 100);
        assert.equal(store.data['contest.rounds'][0].roundNo, 3);
        delete snapshot['document.status'][1].paperFinalizedAt;
        const openPlan = planMigration(snapshot, { domainId: 'test', tids: [tids[1]] }, store, new Date(begin.getTime() + 500_000));
        assert.equal(openPlan.diagnostics[0].code, 'set_migrate_open_round_incomplete');
    });
    it('uses the finalized team identity and leaves the roster and member attendance unchanged', async () => {
        const { snapshot, tids } = fixtures();
        const tid = tids[2];
        const contest = snapshot.document.find((row) => row.docType === 30 && row.docId.equals(tid))!;
        contest.participationMode = 'team';
        const memberStatus = snapshot['document.status'][2];
        const teamId = id(0, 1000);
        snapshot['contest.teams'].push({ _id: id(0, 1001), domainId: 'test', contestId: tid, teamId, active: true, memberUids: [memberStatus.uid], captainUid: memberStatus.uid });
        snapshot['contest.teamStatuses'].push({ ...clone(memberStatus), _id: id(0, 1002), contestId: tid, teamId, revision: 1 });
        snapshot.record[2].contestTeamId = teamId;
        const store = memoryStore(snapshot);
        const plan = planMigration(snapshot, { domainId: 'test', tids: [tid] }, store, now);
        assert.deepEqual(plan.diagnostics, []);
        await applyMigration(store, plan, gates(plan));
        assert.equal(store.data['contest.rounds'][0].participantKey, `t:${teamId.toHexString()}`);
        assert.equal(migrationHash(store.data['contest.teams']), migrationHash(snapshot['contest.teams']));
        assert.equal(migrationHash(store.data['document.status']), migrationHash(snapshot['document.status']));
    });
    it('rejects unknown rules, existing canonical config, ambiguous retakes and changed grades before writes', async () => {
        for (const corrupt of [
            (data: MigrationSnapshot) => { data.document[0].rule = 'unknown'; },
            (data: MigrationSnapshot) => { data.document[0].setConfig = { kept: true }; },
            (data: MigrationSnapshot) => { delete data['document.status'][1].examJournalAfter; },
            (data: MigrationSnapshot) => { data.record[0].score = 90; },
        ]) {
            const { snapshot, tids } = fixtures();
            corrupt(snapshot);
            const store = memoryStore(snapshot);
            const plan = planMigration(snapshot, { domainId: 'test', tids }, store, now);
            assert.ok(plan.diagnostics.length > 0);
            await assert.rejects(applyMigration(store, plan, gates(plan)), /set_migrate_plan_has_diagnostics/);
            assert.equal(store.writes, 0);
        }
    });
    it('requires exact confirmation and rejects target or non-target races and tampered plans', async () => {
        const { store, plan } = plannedFixture();
        await assert.rejects(applyMigration(store, plan, { ...gates(plan), serviceStopped: false }), /set_migrate_confirmation_required/);
        assert.equal(store.writes, 0);
        store.data.record.push(clone(store.data.record[0]));
        await assert.rejects(applyMigration(store, plan, gates(plan)), /set_migrate_duplicate_target/);
        assert.equal(store.writes, 0);
        store.data.record.pop();
        store.data.document[0].title = 'raced';
        await assert.rejects(applyMigration(store, plan, gates(plan)), /set_migrate_target_changed/);
        delete store.data.document[0].title;
        store.data['vigil.paper_draft'][0].answers = { main: 'raced' };
        await assert.rejects(applyMigration(store, plan, gates(plan)), /set_migrate_non_target_changed/);
        assert.equal(store.writes, 0);
        plan.mutations[0].after.score = 0;
        await assert.rejects(applyMigration(store, plan, gates(plan)), /set_migrate_fingerprint_invalid/);
    });
    it('stops on per-document CAS failure and can resume the exact partially applied plan', async () => {
        const { store, plan } = plannedFixture();
        const cas = store.compareAndSwap.bind(store);
        store.compareAndSwap = async (change) => store.writes === 3 ? false : cas(change);
        await assert.rejects(applyMigration(store, plan, gates(plan)), /set_migrate_cas_failed/);
        assert.equal(store.writes, 3);
        assert.equal(store.data.document[0].setConfig, undefined);
        store.compareAndSwap = cas;
        assert.deepEqual(await applyMigration(store, plan, gates(plan)), { written: 25, kept: 3 });
        store.data['contest.rounds'][0].total = 0;
        await assert.rejects(verifyMigration(store, plan), /set_migrate_target_changed/);
    });
    it('requires an explicit database in the URI and binds the report to that exact connection', () => {
        assert.throws(() => assertMigrationConnection('mongodb://127.0.0.1:27017', 'hydro'), /set_migrate_explicit_database_required/);
        assert.throws(() => assertMigrationConnection('mongodb://127.0.0.1:27017/other', 'hydro'), /set_migrate_explicit_database_required/);
        assert.throws(() => assertMigrationConnection('mongodb://127.0.0.1:27017/admin', 'admin'), /set_migrate_database_invalid/);
        assert.notEqual(assertMigrationConnection('mongodb://127.0.0.1:27017/isolated', 'isolated'), assertMigrationConnection('mongodb://127.0.0.1:27018/isolated', 'isolated'));
    });
    it('writes a private EJSON plan, applies it through CLI gates, and verifies with a durable audit', async () => {
        const { snapshot, tids } = fixtures();
        const store = memoryStore(snapshot);
        const uri = 'mongodb://127.0.0.1:27099/set_migrate_test';
        store.connectionFingerprint = assertMigrationConnection(uri, store.databaseName);
        const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'set-migrate-cli-'));
        const report = path.join(directory, 'plan.json');
        const dependencies = { connect: async () => ({ ...store, snapshot: store.snapshot.bind(store), compareAndSwap: store.compareAndSwap.bind(store), close: async () => {} }), now: () => now };
        try {
            const options = { uri, database: store.databaseName, domain: 'test', tids: tids.map(String).join(',') };
            const result = await runSetMigrateCommand('plan', report, options, dependencies);
            assert.equal(result.ok, true);
            assert.equal((await fs.stat(report)).mode & 0o777, 0o600);
            const fingerprint = result.fingerprint;
            await runSetMigrateCommand('apply', report, { ...options, actor: '42', fingerprint, backupConfirmed: fingerprint, confirm: `APPLY:set-migrate:${store.databaseName}:${fingerprint}`, serviceStopped: true }, dependencies);
            await runSetMigrateCommand('verify', report, options, dependencies);
            assert.equal((await fs.readFile(`${report}.events.jsonl`, 'utf8')).trim().split('\n').length, 3);
        } finally { await fs.rm(directory, { recursive: true, force: true }); }
    });
    it('runs plan/CAS/apply/verify against an isolated real MongoDB with all seven source schemas', { skip: !process.env.SET_MIGRATE_MONGO_BINARY }, async () => {
        const server = await MongoMemoryServer.create({ binary: { systemBinary: process.env.SET_MIGRATE_MONGO_BINARY }, instance: { dbName: 'set_migrate_isolated' } });
        const uri = server.getUri('set_migrate_isolated');
        const client = new MongoClient(uri);
        try {
            await client.connect();
            const db = client.db('set_migrate_isolated');
            const { snapshot, tids } = fixtures();
            for (const collection of SET_MIGRATE_COLLECTIONS) if (snapshot[collection].length) await db.collection(collection).insertMany(snapshot[collection]);
            const store = mongoMigrateStore(db, assertMigrationConnection(uri, db.databaseName));
            const before = await store.snapshot();
            const plan = planMigration(before, { domainId: 'test', tids }, store, now);
            assert.deepEqual(plan.diagnostics, []);
            await applyMigration(store, plan, gates(plan));
            await verifyMigration(store, plan);
            assert.equal(await db.collection('contest.rounds').countDocuments(), 7);
            assert.equal(await db.collection('record').countDocuments({ setRoundId: { $exists: true } }), 7);
            const result = await applyMigration(store, plan, gates(plan));
            assert.equal(result.written, 0);
            // Exact-root CAS rejects a new field added after the source read.
            const source = before.document[0];
            await db.collection('document').replaceOne({ _id: source._id }, { ...source, unexpected: 'concurrent' });
            assert.equal(await store.compareAndSwap({ collection: 'document', id: source._id, before: source, after: { ...source, title: 'must not write' } }), false);
        } finally { await client.close(); await server.stop(); }
    });
});
