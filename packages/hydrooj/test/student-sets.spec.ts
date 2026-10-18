import { describe, it } from 'node:test';
import { expect } from 'chai';
import { ObjectId } from 'mongodb';
import type { ExamPaperQuotas } from '@hydrooj/common';
import type { Tdoc } from '../src/interface';
import {
    classifyWindow,
    flavorOf,
    pickDefaultTab,
    serializeContestRow,
    sortRunning,
    sortUpcoming,
} from '../src/lib/student-sets';

type ContestFlavor = 'paper' | 'acm' | 'ioi' | 'oi' | 'homework';

interface ContestRow {
    kind: 'exam' | 'homework';
    id: string;
    flavor: ContestFlavor;
    title: string;
    href: string;
    beginAt: string;
    endAt: string;
    dueAt: string | null;
    durationMinutes: number | null;
    startAt: string | null;
    personalEndAt: string | null;
    attended: boolean;
    clientRequired: boolean;
    team: boolean;
    problemCount: number;
    progress: { answered: number } | { accepted: number } | { score: number } | null;
    finalized: boolean;
    done: boolean;
}

interface TeamRow {
    kind: 'team';
    id: string;
    title: string;
    href: string;
    description: string;
    myState: 'none' | 'invited' | 'joined';
    inviteCount: number;
    memberCount: number | null;
}

interface ContestFields {
    docId: ObjectId;
    rule: string;
    title: string;
    beginAt: Date;
    endAt: Date;
    pids: number[];
    duration?: number;
    penaltySince?: Date;
    entryMode?: 'open' | 'client_required';
    participationMode?: 'individual' | 'team';
    examPaperQuotas?: ExamPaperQuotas;
}

interface StatusFixture {
    attend?: number;
    startAt?: Date;
    detail?: Record<number, { score?: number }>;
    accept?: number;
    score?: number;
    paperFinalizedAt?: Date;
    examPaperPids?: number[];
}

function at(clock: string): Date {
    return new Date(`2026-10-18T${clock}+08:00`);
}

function oid(n: number): ObjectId {
    return new ObjectId(n.toString(16).padStart(24, '0'));
}

function contestDoc(fields: ContestFields): Tdoc {
    const doc: Tdoc = {
        _id: fields.docId,
        docId: fields.docId,
        docType: 30,
        domainId: 'system',
        owner: 1,
        beginAt: fields.beginAt,
        endAt: fields.endAt,
        attend: 0,
        title: fields.title,
        content: '',
        rule: fields.rule,
        pids: fields.pids,
        duration: fields.duration ?? 0,
    };
    if (fields.penaltySince) doc.penaltySince = fields.penaltySince;
    if (fields.entryMode) doc.entryMode = fields.entryMode;
    if (fields.participationMode) doc.participationMode = fields.participationMode;
    if (fields.examPaperQuotas) doc.examPaperQuotas = fields.examPaperQuotas;
    return doc;
}

function loadRow(
    tdoc: Tdoc,
    tsdoc: StatusFixture | null,
    now: Date,
    draftCount: number | null = null,
    href?: string,
) {
    return serializeContestRow({
        tdoc,
        tsdoc,
        href: href ?? `/contest/${tdoc.docId.toHexString()}`,
        draftCount,
        now,
    });
}

function contestRow(overrides: Partial<ContestRow> & { id: string }): ContestRow {
    return {
        kind: 'homework',
        flavor: 'homework',
        title: overrides.id,
        href: `/homework/${overrides.id}`,
        beginAt: at('08:00:00').toISOString(),
        endAt: at('20:00:00').toISOString(),
        dueAt: null,
        durationMinutes: null,
        startAt: null,
        personalEndAt: null,
        attended: false,
        clientRequired: false,
        team: false,
        problemCount: 2,
        progress: { answered: 0 },
        finalized: false,
        done: false,
        ...overrides,
    };
}

function teamRow(id: string): TeamRow {
    return {
        kind: 'team',
        id,
        title: id,
        href: `/teams/${id}`,
        description: '',
        myState: 'none',
        inviteCount: 0,
        memberCount: null,
    };
}

describe('student sets model', () => {
    it('classifies an instant inside [beginAt, endAt) as running', () => {
        const beginAt = at('10:00:00');
        const endAt = at('12:00:00');
        expect(classifyWindow(beginAt, endAt, at('09:59:59'))).to.equal('upcoming');
        expect(classifyWindow(beginAt, endAt, beginAt)).to.equal('running');
        expect(classifyWindow(beginAt, endAt, at('11:00:00'))).to.equal('running');
        expect(classifyWindow(beginAt, endAt, endAt)).to.equal('ended');
        expect(classifyWindow(beginAt, endAt, at('12:00:01'))).to.equal('ended');
    });

    it('maps rules to flavors and rejects an unknown rule', () => {
        expect(flavorOf('exam')).to.equal('paper');
        expect(flavorOf('acm')).to.equal('acm');
        expect(flavorOf('ioi')).to.equal('ioi');
        expect(flavorOf('strictioi')).to.equal('ioi');
        expect(flavorOf('oi')).to.equal('oi');
        expect(flavorOf('ledo')).to.equal('oi');
        expect(flavorOf('homework')).to.equal('homework');
        expect(() => flavorOf('xyz')).to.throw(TypeError);
    });

    it('rounds homework duration and caps personal end at endAt', () => {
        const beginAt = at('09:00:00');
        const startAt = at('10:00:00');
        const endAt = at('10:30:00');
        const docId = oid(17);
        const capped = loadRow(
            contestDoc({
                docId,
                rule: 'homework',
                title: '限时作业',
                beginAt,
                endAt,
                pids: [1],
                duration: 0.75,
            }),
            { attend: 1, startAt, detail: {} },
            at('10:10:00'),
            null,
            '/homework/capped',
        );
        expect(capped.kind).to.equal('homework');
        expect(capped.flavor).to.equal('homework');
        expect(capped.id).to.equal(docId.toHexString());
        expect(capped.title).to.equal('限时作业');
        expect(capped.href).to.equal('/homework/capped');
        expect(capped.beginAt).to.equal(beginAt.toISOString());
        expect(capped.endAt).to.equal(endAt.toISOString());
        expect(capped.startAt).to.equal(startAt.toISOString());
        expect(capped.durationMinutes).to.equal(45);
        // 10:00 + 0.75h is 10:45, later than endAt, so the personal end is endAt.
        expect(capped.personalEndAt).to.equal(endAt.toISOString());
        expect(capped.attended).to.equal(true);
        expect(capped.progress).to.deep.equal({ answered: 0 });
        expect(capped.finalized).to.equal(false);
        expect(capped.clientRequired).to.equal(false);
        expect(capped.team).to.equal(false);

        const inside = loadRow(
            contestDoc({
                docId: oid(18),
                rule: 'homework',
                title: '半小时',
                beginAt,
                endAt: at('12:00:00'),
                pids: [1],
                duration: 0.5,
            }),
            { attend: 1, startAt, detail: {} },
            at('10:10:00'),
        );
        expect(inside.durationMinutes).to.equal(30);
        expect(inside.personalEndAt).to.equal(at('10:30:00').toISOString());

        const unlimited = loadRow(
            contestDoc({
                docId: oid(19),
                rule: 'homework',
                title: '不限时',
                beginAt,
                endAt: at('12:00:00'),
                pids: [1],
                duration: 0,
            }),
            { attend: 1, startAt, detail: {} },
            at('10:10:00'),
        );
        expect(unlimited.durationMinutes).to.equal(null);
        expect(unlimited.personalEndAt).to.equal(null);

        const notStarted = loadRow(
            contestDoc({
                docId: oid(20),
                rule: 'homework',
                title: '还没开始',
                beginAt,
                endAt: at('12:00:00'),
                pids: [1],
                duration: 0.75,
            }),
            null,
            at('10:10:00'),
        );
        expect(notStarted.durationMinutes).to.equal(45);
        expect(notStarted.startAt).to.equal(null);
        expect(notStarted.personalEndAt).to.equal(null);
        expect(notStarted.attended).to.equal(false);
    });

    it('treats a null or omitted homework duration as unlimited when the student has started', () => {
        const beginAt = at('09:00:00');
        const startAt = at('10:00:00');
        const endAt = at('12:00:00');
        const now = at('10:10:00');
        const nullDuration = contestDoc({
            docId: oid(26),
            rule: 'homework',
            title: '空时长',
            beginAt,
            endAt,
            pids: [1],
            duration: 1,
        });
        nullDuration.duration = null;
        const nullRow = loadRow(nullDuration, { attend: 1, startAt, detail: {} }, now);
        expect(nullRow.durationMinutes).to.equal(null);
        expect(nullRow.personalEndAt).to.equal(null);

        const stored = contestDoc({
            docId: oid(27),
            rule: 'homework',
            title: '缺时长',
            beginAt,
            endAt,
            pids: [1],
            duration: 1,
        });
        const { duration: _duration, ...omitted } = stored;
        const omittedRow = loadRow(omitted as Tdoc, { attend: 1, startAt, detail: {} }, now);
        expect(omittedRow.durationMinutes).to.equal(null);
        expect(omittedRow.personalEndAt).to.equal(null);
    });

    it('keeps dueAt only when a homework penalty is earlier than endAt', () => {
        const beginAt = at('08:00:00');
        const endAt = at('18:00:00');
        const now = at('12:00:00');
        const earlier = at('17:00:00');
        const base = {
            rule: 'homework',
            title: '作业',
            beginAt,
            endAt,
            pids: [1],
            duration: 0,
        };
        const later = loadRow(
            contestDoc({ ...base, docId: oid(21), penaltySince: at('19:00:00') }),
            null,
            now,
        );
        expect(later.dueAt).to.equal(null);
        const sameInstant = loadRow(
            contestDoc({ ...base, docId: oid(22), penaltySince: endAt }),
            null,
            now,
        );
        expect(sameInstant.dueAt).to.equal(null);
        const before = loadRow(
            contestDoc({ ...base, docId: oid(23), penaltySince: earlier }),
            null,
            now,
        );
        expect(before.dueAt).to.equal(earlier.toISOString());
        const missing = loadRow(contestDoc({ ...base, docId: oid(24) }), null, now);
        expect(missing.dueAt).to.equal(null);
        const contest = loadRow(
            contestDoc({
                ...base,
                docId: oid(25),
                rule: 'acm',
                title: '比赛',
                penaltySince: earlier,
            }),
            null,
            now,
        );
        expect(contest.dueAt).to.equal(null);
    });

    it('counts answered homework problems and completes the row when every problem is answered', () => {
        const beginAt = at('08:00:00');
        const endAt = at('18:00:00');
        const now = at('12:00:00');
        const doc = contestDoc({
            docId: oid(31),
            rule: 'homework',
            title: '两题',
            beginAt,
            endAt,
            pids: [1, 2],
            duration: 0,
        });
        const partial = loadRow(doc, { attend: 1, detail: { 1: {} } }, now, 9);
        expect(partial.problemCount).to.equal(2);
        expect(partial.progress).to.deep.equal({ answered: 1 });
        expect(partial.done).to.equal(false);

        const finished = loadRow(doc, { attend: 1, detail: { 1: {}, 2: {} } }, now, 9);
        expect(finished.progress).to.deep.equal({ answered: 2 });
        expect(finished.done).to.equal(true);

        const empty = loadRow(
            contestDoc({
                docId: oid(32),
                rule: 'homework',
                title: '空作业',
                beginAt,
                endAt,
                pids: [],
                duration: 0,
            }),
            { detail: {} },
            now,
        );
        expect(empty.problemCount).to.equal(0);
        expect(empty.progress).to.deep.equal({ answered: 0 });
        expect(empty.done).to.equal(false);

        const afterWindow = loadRow(doc, { attend: 1, detail: { 1: {} } }, at('19:00:00'));
        expect(afterWindow.done).to.equal(false);
    });

    it('marks a finalized paper done and reports contest progress only after attend', () => {
        const beginAt = at('08:00:00');
        const endAt = at('18:00:00');
        const startAt = at('10:00:00');
        const now = at('11:00:00');
        const paper = loadRow(
            contestDoc({
                docId: oid(41),
                rule: 'exam',
                title: '试卷',
                beginAt,
                endAt,
                pids: [3, 4],
                duration: 2,
            }),
            { attend: 1, startAt, detail: {}, paperFinalizedAt: at('10:40:00') },
            now,
            4,
        );
        expect(paper.kind).to.equal('exam');
        expect(paper.flavor).to.equal('paper');
        expect(paper.finalized).to.equal(true);
        expect(paper.done).to.equal(true);
        expect(paper.progress).to.equal(null);
        expect(paper.personalEndAt).to.equal(at('12:00:00').toISOString());

        const homework = loadRow(
            contestDoc({
                docId: oid(42),
                rule: 'homework',
                title: '作业',
                beginAt,
                endAt,
                pids: [1, 2],
                duration: 0,
            }),
            { attend: 1, detail: { 1: {} }, paperFinalizedAt: at('10:40:00') },
            now,
        );
        expect(homework.finalized).to.equal(false);
        expect(homework.done).to.equal(false);

        const acm = loadRow(
            contestDoc({
                docId: oid(43),
                rule: 'acm',
                title: 'ACM',
                beginAt,
                endAt,
                pids: [1, 2, 3],
                duration: 0,
            }),
            { attend: 1, detail: {}, accept: 3 },
            now,
        );
        expect(acm.flavor).to.equal('acm');
        expect(acm.kind).to.equal('exam');
        expect(acm.attended).to.equal(true);
        expect(acm.progress).to.deep.equal({ accepted: 3 });
        expect(acm.finalized).to.equal(false);
        expect(acm.done).to.equal(false);

        const missingAccept = loadRow(
            contestDoc({
                docId: oid(44),
                rule: 'acm',
                title: 'ACM',
                beginAt,
                endAt,
                pids: [1],
                duration: 0,
            }),
            { attend: 1, detail: {} },
            now,
        );
        expect(missingAccept.progress).to.deep.equal({ accepted: 0 });

        const absent = loadRow(
            contestDoc({
                docId: oid(45),
                rule: 'acm',
                title: 'ACM',
                beginAt,
                endAt,
                pids: [1],
                duration: 0,
            }),
            { attend: 0, detail: {}, accept: 3 },
            now,
        );
        expect(absent.attended).to.equal(false);
        expect(absent.progress).to.equal(null);

        const ioi = loadRow(
            contestDoc({
                docId: oid(46),
                rule: 'ioi',
                title: 'IOI',
                beginAt,
                endAt,
                pids: [1],
                duration: 0,
            }),
            { attend: 1, detail: {}, score: 80 },
            now,
        );
        expect(ioi.flavor).to.equal('ioi');
        expect(ioi.progress).to.deep.equal({ score: 80 });

        const strict = loadRow(
            contestDoc({
                docId: oid(47),
                rule: 'strictioi',
                title: 'Strict',
                beginAt,
                endAt,
                pids: [1],
                duration: 0,
            }),
            { attend: 1, detail: {} },
            now,
        );
        expect(strict.flavor).to.equal('ioi');
        expect(strict.progress).to.deep.equal({ score: 0 });

        const ledo = loadRow(
            contestDoc({
                docId: oid(48),
                rule: 'ledo',
                title: 'OI',
                beginAt,
                endAt,
                pids: [1],
                duration: 0,
            }),
            { attend: 0, detail: {}, score: 10 },
            now,
        );
        expect(ledo.flavor).to.equal('oi');
        expect(ledo.progress).to.equal(null);
    });

    it('counts draft answers only for a started paper that is not finalized', () => {
        const beginAt = at('08:00:00');
        const endAt = at('18:00:00');
        const startAt = at('10:00:00');
        const paper = {
            rule: 'exam',
            title: '试卷',
            beginAt,
            endAt,
            pids: [3, 4, 5],
            duration: 3,
        };
        const started = loadRow(
            contestDoc({ ...paper, docId: oid(51) }),
            { attend: 1, startAt, detail: {} },
            at('11:00:00'),
            2,
        );
        expect(started.finalized).to.equal(false);
        expect(started.problemCount).to.equal(3);
        expect(started.progress).to.deep.equal({ answered: 2 });
        expect(started.done).to.equal(false);

        const zeroDrafts = loadRow(
            contestDoc({ ...paper, docId: oid(52) }),
            { attend: 1, startAt, detail: {} },
            at('11:00:00'),
            0,
        );
        expect(zeroDrafts.progress).to.deep.equal({ answered: 0 });

        const notStarted = loadRow(
            contestDoc({ ...paper, docId: oid(53) }),
            { attend: 0, detail: {} },
            at('11:00:00'),
            2,
        );
        expect(notStarted.progress).to.equal(null);
        expect(notStarted.done).to.equal(false);
    });

    it('marks a personal deadline done at personalEndAt and not before', () => {
        const beginAt = at('08:00:00');
        const startAt = at('10:00:00');
        const endAt = at('18:00:00');
        const personalEnd = at('11:00:00');
        const justBefore = new Date(personalEnd.getTime() - 1);
        const timed = {
            beginAt,
            endAt,
            pids: [1, 2],
            duration: 1,
        };
        const paperDone = loadRow(
            contestDoc({ ...timed, docId: oid(61), rule: 'exam', title: '试卷' }),
            { attend: 1, startAt, detail: {} },
            personalEnd,
            1,
        );
        expect(paperDone.personalEndAt).to.equal(personalEnd.toISOString());
        expect(paperDone.durationMinutes).to.equal(60);
        expect(paperDone.done).to.equal(true);
        expect(paperDone.finalized).to.equal(false);
        expect(paperDone.progress).to.deep.equal({ answered: 1 });

        const paperOpen = loadRow(
            contestDoc({ ...timed, docId: oid(62), rule: 'exam', title: '试卷' }),
            { attend: 1, startAt, detail: {} },
            justBefore,
            1,
        );
        expect(paperOpen.done).to.equal(false);

        const homeworkDone = loadRow(
            contestDoc({ ...timed, docId: oid(63), rule: 'homework', title: '作业' }),
            { attend: 1, startAt, detail: { 1: {} } },
            personalEnd,
        );
        expect(homeworkDone.progress).to.deep.equal({ answered: 1 });
        expect(homeworkDone.done).to.equal(true);

        const homeworkOpen = loadRow(
            contestDoc({ ...timed, docId: oid(64), rule: 'homework', title: '作业' }),
            { attend: 1, startAt, detail: { 1: {} } },
            justBefore,
        );
        expect(homeworkOpen.done).to.equal(false);

        const rules = ['acm', 'ioi', 'oi', 'strictioi', 'ledo'];
        for (const [index, rule] of rules.entries()) {
            const reached = loadRow(
                contestDoc({ ...timed, docId: oid(70 + index), rule, title: rule }),
                { attend: 1, startAt, detail: {}, accept: 1, score: 1 },
                personalEnd,
            );
            expect(reached.done).to.equal(true);
            const waiting = loadRow(
                contestDoc({ ...timed, docId: oid(80 + index), rule, title: rule }),
                { attend: 1, startAt, detail: {}, accept: 1, score: 1 },
                justBefore,
            );
            expect(waiting.done).to.equal(false);
        }
    });

    it('counts an unstarted draw exam by its quota total', () => {
        const beginAt = at('08:00:00');
        const endAt = at('18:00:00');
        const quotas: ExamPaperQuotas = { single: 2, blank: 1 };
        const unstarted = loadRow(
            contestDoc({
                docId: oid(91),
                rule: 'exam',
                title: '抽卷',
                beginAt,
                endAt,
                pids: [1, 2, 3, 4, 5],
                duration: 0,
                examPaperQuotas: quotas,
            }),
            null,
            at('09:00:00'),
        );
        expect(unstarted.problemCount).to.equal(3);

        const started = loadRow(
            contestDoc({
                docId: oid(92),
                rule: 'exam',
                title: '抽卷',
                beginAt,
                endAt,
                pids: [1, 2, 3, 4, 5],
                duration: 2,
                examPaperQuotas: quotas,
            }),
            { attend: 1, startAt: at('10:00:00'), detail: {}, examPaperPids: [8, 9, 10] },
            at('11:00:00'),
            1,
        );
        expect(started.problemCount).to.equal(3);
        expect(started.progress).to.deep.equal({ answered: 1 });
    });

    it('copies client entry, team mode, and the given href', () => {
        const beginAt = at('08:00:00');
        const endAt = at('18:00:00');
        const row = loadRow(
            contestDoc({
                docId: oid(93),
                rule: 'acm',
                title: '团队',
                beginAt,
                endAt,
                pids: [1],
                duration: 0,
                entryMode: 'client_required',
                participationMode: 'team',
            }),
            null,
            at('12:00:00'),
            null,
            '/contest/team',
        );
        expect(row.clientRequired).to.equal(true);
        expect(row.team).to.equal(true);
        expect(row.href).to.equal('/contest/team');

        const open = loadRow(
            contestDoc({
                docId: oid(94),
                rule: 'acm',
                title: '个人',
                beginAt,
                endAt,
                pids: [1],
                duration: 0,
                entryMode: 'open',
                participationMode: 'individual',
            }),
            null,
            at('12:00:00'),
        );
        expect(open.clientRequired).to.equal(false);
        expect(open.team).to.equal(false);
    });

    it('puts team rows first, orders open homework by dueAt, and sinks finished rows', () => {
        const now = at('12:00:00');
        const rows: (ContestRow | TeamRow)[] = [
            contestRow({ id: 'b-later', dueAt: at('15:00:00').toISOString(), endAt: at('16:00:00').toISOString() }),
            teamRow('team-b'),
            contestRow({
                id: 'a-finished-late',
                done: true,
                endAt: at('19:00:00').toISOString(),
                dueAt: at('09:00:00').toISOString(),
            }),
            contestRow({ id: 'c-due', dueAt: at('13:00:00').toISOString(), endAt: at('22:00:00').toISOString() }),
            contestRow({
                id: 'q-tie',
                done: true,
                endAt: at('18:00:00').toISOString(),
                dueAt: at('09:00:00').toISOString(),
            }),
            teamRow('team-a'),
            contestRow({
                id: 'm-finished-early',
                done: true,
                endAt: at('08:00:00').toISOString(),
                dueAt: at('23:00:00').toISOString(),
            }),
            contestRow({ id: 'd-due', dueAt: at('13:00:00').toISOString(), endAt: at('21:00:00').toISOString() }),
            contestRow({
                id: 'exam-end',
                kind: 'exam',
                flavor: 'acm',
                dueAt: null,
                personalEndAt: null,
                endAt: at('14:00:00').toISOString(),
            }),
            contestRow({
                id: 'p-tie',
                done: true,
                endAt: at('18:00:00').toISOString(),
                dueAt: at('23:00:00').toISOString(),
            }),
        ];
        expect(sortRunning(rows, now).map((row) => row.id)).to.deep.equal([
            'team-a',
            'team-b',
            'c-due',
            'd-due',
            'exam-end',
            'b-later',
            'm-finished-early',
            'p-tie',
            'q-tie',
            'a-finished-late',
        ]);
    });

    it('orders open rows by personal end, then a future due, then endAt once the due has passed', () => {
        const now = at('12:00:00');
        const byPersonalEnd = sortRunning([
            contestRow({
                id: 'a-personal',
                personalEndAt: at('16:00:00').toISOString(),
                dueAt: at('13:00:00').toISOString(),
            }),
            contestRow({
                id: 'z-personal',
                personalEndAt: at('14:00:00').toISOString(),
                dueAt: at('17:00:00').toISOString(),
            }),
        ], now);
        expect(byPersonalEnd.map((row) => row.id)).to.deep.equal(['z-personal', 'a-personal']);

        const pastDue = sortRunning([
            contestRow({
                id: 'a-end',
                dueAt: at('10:00:00').toISOString(),
                endAt: at('18:00:00').toISOString(),
            }),
            contestRow({
                id: 'z-end',
                dueAt: at('11:00:00').toISOString(),
                endAt: at('15:00:00').toISOString(),
            }),
        ], now);
        expect(pastDue.map((row) => row.id)).to.deep.equal(['z-end', 'a-end']);
    });

    it('sorts upcoming rows by beginAt and breaks ties by id', () => {
        const rows = [
            contestRow({ id: 'a-late', kind: 'exam', flavor: 'acm', beginAt: at('11:00:00').toISOString() }),
            contestRow({ id: 'c-early', beginAt: at('10:00:00').toISOString() }),
            contestRow({ id: 'b-early', kind: 'exam', flavor: 'paper', beginAt: at('10:00:00').toISOString() }),
        ];
        expect(sortUpcoming(rows).map((row) => row.id)).to.deep.equal(['b-early', 'c-early', 'a-late']);
    });

    it('picks the first non-empty tab and falls back to practice', () => {
        expect(pickDefaultTab({ running: 1, upcoming: 4, practice: 9 })).to.equal('running');
        expect(pickDefaultTab({ running: 0, upcoming: 2, practice: 5 })).to.equal('upcoming');
        expect(pickDefaultTab({ running: 0, upcoming: 0, practice: 5 })).to.equal('practice');
        expect(pickDefaultTab({ running: 0, upcoming: 0, practice: 0 })).to.equal('practice');
    });
});
