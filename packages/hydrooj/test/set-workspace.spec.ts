import { describe, it } from 'node:test';
import { expect } from 'chai';
import { ObjectId } from 'mongodb';
import { createDraftConfig, EXAM_PAPER_FINALIZE_GRACE_MS, EXAM_PAPER_HOUR_MS, STATUS, type ProblemKind } from '@hydrooj/common';
import type { Tdoc } from '../src/interface';
import {
    buildSetWorkspace,
    workspaceInfo,
    workspacePhase,
    type DraftFacts,
    type JournalFacts,
    type SetWorkspaceInput,
} from '../src/lib/set-workspace';

type Workspace = ReturnType<typeof buildSetWorkspace>;
type LockReason = NonNullable<Workspace['locked']>['reason'];
type PaperFacts = NonNullable<SetWorkspaceInput['paperFacts']>;

interface DocFields {
    docId?: ObjectId;
    rule: string;
    beginAt: Date;
    endAt: Date;
    title?: string;
    content?: string;
    pids?: number[];
    duration?: number;
    entryMode?: 'open' | 'client_required';
    participationMode?: 'individual' | 'team';
    penaltySince?: Date;
    lockAt?: Date;
    examShowVerdict?: boolean;
    homeworkShowObjectiveVerdict?: boolean;
    examPassScore?: number;
    examAttemptLimit?: number;
}

function at(clock: string): Date {
    return new Date(`2026-10-18T${clock}+08:00`);
}

function on(day: string, clock: string): Date {
    return new Date(`2026-10-${day}T${clock}+08:00`);
}

function oid(n: number): ObjectId {
    return new ObjectId(n.toString(16).padStart(24, '0'));
}

function contestDoc(fields: DocFields): Tdoc {
    const docId = fields.docId ?? oid(1);
    const doc: Tdoc = {
        _id: docId,
        docId,
        docType: 30,
        domainId: 'system',
        owner: 1,
        beginAt: fields.beginAt,
        endAt: fields.endAt,
        attend: 0,
        title: fields.title ?? '集合',
        content: fields.content ?? '说明',
        rule: fields.rule,
        pids: fields.pids ?? [],
        duration: fields.duration ?? 0,
    };
    if (fields.penaltySince) doc.penaltySince = fields.penaltySince;
    if (fields.entryMode) doc.entryMode = fields.entryMode;
    if (fields.participationMode) doc.participationMode = fields.participationMode;
    if (fields.lockAt) doc.lockAt = fields.lockAt;
    if (fields.examShowVerdict !== undefined) doc.examShowVerdict = fields.examShowVerdict;
    if (fields.homeworkShowObjectiveVerdict !== undefined) doc.homeworkShowObjectiveVerdict = fields.homeworkShowObjectiveVerdict;
    if (fields.examPassScore !== undefined) doc.examPassScore = fields.examPassScore;
    if (fields.examAttemptLimit !== undefined) doc.examAttemptLimit = fields.examAttemptLimit;
    return doc;
}

function statusOf(fields: { attend?: number; startAt?: Date; paperFinalizedAt?: Date } | null): Record<string, unknown> | null {
    if (fields === null) return null;
    const out: Record<string, unknown> = {};
    if (fields.attend !== undefined) out.attend = fields.attend;
    if (fields.startAt !== undefined) out.startAt = fields.startAt;
    if (fields.paperFinalizedAt !== undefined) out.paperFinalizedAt = fields.paperFinalizedAt;
    return out;
}

function problem(pid: number, kind: ProblemKind, title: string, score: number) {
    return { pid, title, kind, score };
}

function draft(overrides: Partial<DraftFacts> = {}): DraftFacts {
    return {
        answers: null,
        submittedAnswers: null,
        code: null,
        judgeResult: null,
        ...overrides,
    };
}

function journal(overrides: Partial<JournalFacts> = {}): JournalFacts {
    return {
        submits: 0,
        lastStatus: null,
        lastScore: null,
        ...overrides,
    };
}

function paperFacts(overrides: Partial<PaperFacts> = {}): PaperFacts {
    return {
        score: null,
        passed: null,
        judging: false,
        passScore: null,
        attemptLimit: null,
        attemptsUsed: 0,
        canRetake: false,
        submitByKind: false,
        lockedKinds: [],
        ...overrides,
    };
}

function urls(overrides: Partial<SetWorkspaceInput['urls']> = {}): SetWorkspaceInput['urls'] {
    return {
        back: '/training',
        manage: null,
        overview: '/homework/000000000000000000000001',
        problem: null,
        submit: '/p/__PID__/submit?tid=000000000000000000000001',
        submitCode: null,
        recordDetail: '/record/__RID__?tid=000000000000000000000001',
        records: '/record?tid=000000000000000000000001&uidOrName=7',
        ranking: null,
        clarify: null,
        print: null,
        start: null,
        attend: null,
        draftList: null,
        draftUpsert: null,
        submitKind: null,
        lockKind: null,
        finalize: null,
        virtual: null,
        practice: null,
        teamProblem: null,
        pretest: null,
        ...overrides,
    };
}

function input(overrides: Partial<SetWorkspaceInput> = {}): SetWorkspaceInput {
    return {
        kind: 'homework',
        tdoc: contestDoc({ rule: 'homework', beginAt: at('08:00:00'), endAt: at('20:00:00') }),
        tsdoc: statusOf({ attend: 1 }),
        now: at('10:00:00'),
        mode: 'browser',
        problems: [],
        drafts: new Map(),
        journal: new Map(),
        paperFacts: null,
        canAttend: false,
        canUnrank: false,
        canShowScoreboard: false,
        postContestPracticeOpen: false,
        postContestViewClosed: false,
        virtualAvailable: false,
        canClarify: false,
        team: null,
        announcements: [],
        clarifications: [],
        student: { name: '林晓', studentId: '240101' },
        urls: urls(),
        ...overrides,
    };
}

function built(overrides: Partial<SetWorkspaceInput> = {}) {
    const value = input(overrides);
    const ws = buildSetWorkspace(value);
    expect(ws.phase).to.equal(workspacePhase(value));
    return { value, ws };
}

function expectLocked(ws: Workspace, reason: LockReason | null) {
    if (reason === null) expect(ws.locked).to.equal(null);
    else expect(ws.locked).to.deep.equal({ reason });
}

function titlesOf(ws: Workspace): string[] {
    return ws.groups.flatMap((group) => group.items.map((row) => row.title));
}

function itemOf(ws: Workspace, pid: number) {
    const found = ws.groups.flatMap((group) => group.items).find((row) => row.pid === pid);
    if (!found) throw new Error(`missing pid ${pid}`);
    return found;
}

function urlField(source: Workspace['urls'], key: string): unknown {
    for (const [name, value] of Object.entries(source)) {
        if (name === key) return value;
    }
    return undefined;
}

function verifyEndpoint(tid: string, teachType: string, action: 'objective' | 'submit'): string {
    return `/teach/${teachType}/${tid}/verify/${action}`;
}

function expectWorkspaceUrls(
    ws: Workspace,
    links: SetWorkspaceInput['urls'],
    verifyObjective: string | null,
    verifySubmit: string | null,
) {
    expect(urlField(ws.urls, 'verifyObjective')).to.equal(verifyObjective);
    expect(urlField(ws.urls, 'verifySubmit')).to.equal(verifySubmit);
    const actual: Record<string, unknown> = Object.fromEntries(Object.entries(ws.urls));
    expect(actual).to.deep.equal({
        ...links,
        verifyObjective,
        verifySubmit,
    });
}

const openHomework = { rule: 'homework', beginAt: at('08:00:00'), endAt: at('20:00:00') };
const accepted = journal({ submits: 2, lastStatus: STATUS.STATUS_ACCEPTED, lastScore: 10 });

describe('set workspace phase and lock', () => {
    it('locks a future homework as not_open and blanks every title', () => {
        const { ws } = built({
            now: at('10:00:00'),
            tdoc: contestDoc({
                rule: 'homework',
                beginAt: on('19', '08:00:00'),
                endAt: on('19', '20:00:00'),
                pids: [2, 3],
            }),
            problems: [problem(2, 'true_false', '判断', 5), problem(3, 'single', '单选', 5)],
            tsdoc: statusOf({ attend: 1 }),
        });
        expect(ws.phase).to.equal('upcoming');
        expect(ws.flavor).to.equal('homework');
        expectLocked(ws, 'not_open');
        expect(titlesOf(ws)).to.deep.equal(['', '']);
        expect(ws.groups.map((group) => group.items.map((row) => row.label))).to.deep.equal([['1-1'], ['2-1']]);
    });

    it('locks a future contest as not_started', () => {
        const ws = built({
            kind: 'contest',
            now: at('10:00:00'),
            tdoc: contestDoc({ rule: 'acm', beginAt: on('19', '08:00:00'), endAt: on('19', '20:00:00') }),
            tsdoc: statusOf(null),
        }).ws;
        expect(ws.phase).to.equal('upcoming');
        expectLocked(ws, 'not_started');
    });

    it('keeps a timed homework ready until the student starts', () => {
        const ready = built({
            tdoc: contestDoc({ ...openHomework, duration: 1 }),
            tsdoc: statusOf(null),
            urls: urls({ start: '/homework/1' }),
        }).ws;
        expect(ready.phase).to.equal('ready');
        expectLocked(ready, 'need_start');
        expect(ready.action).to.deep.equal({
            canStart: true,
            canFinalize: false,
            canAttend: false,
            canUnrank: false,
            canSubmit: false,
            attended: false,
            canRetake: false,
        });

        const withoutStart = built({
            tdoc: contestDoc({ ...openHomework, duration: 1 }),
            tsdoc: statusOf(null),
            urls: urls({ start: null }),
        }).ws;
        expect(withoutStart.phase).to.equal('ready');
        expect(withoutStart.action.canStart).to.equal(false);

        const preview = built({
            mode: 'preview',
            tdoc: contestDoc({ ...openHomework, duration: 1, title: '预览题' }),
            problems: [problem(1, 'single', '预览题', 5)],
            tsdoc: statusOf(null),
            urls: urls({ start: '/homework/1' }),
        }).ws;
        expect(preview.phase).to.equal('ready');
        expectLocked(preview, null);
        expect(preview.action.canStart).to.equal(false);
        expect(titlesOf(preview)).to.deep.equal(['预览题']);

        const started = built({
            tdoc: contestDoc({ ...openHomework, duration: 1 }),
            tsdoc: statusOf({ attend: 1, startAt: at('09:30:00') }),
        }).ws;
        expect(started.phase).to.equal('answering');
        expectLocked(started, null);
        expect(started.action.canStart).to.equal(false);
    });

    it('submits a timed homework once the personal deadline is reached', () => {
        const startAt = at('10:00:00');
        const reached = new Date(startAt.getTime() + EXAM_PAPER_HOUR_MS);
        const base = {
            tdoc: contestDoc({ ...openHomework, duration: 1 }),
            tsdoc: statusOf({ attend: 1, startAt }),
        };
        expect(built({ ...base, now: new Date(reached.getTime() - 1) }).ws.phase).to.equal('answering');
        const submitted = built({ ...base, now: reached }).ws;
        expect(submitted.phase).to.equal('submitted');
        expectLocked(submitted, null);
    });

    it('requires attend before an untimed homework opens the problems', () => {
        const tdoc = contestDoc(openHomework);
        const absent = built({ tdoc, tsdoc: statusOf(null) }).ws;
        expect(absent.phase).to.equal('ready');
        expectLocked(absent, 'need_attend');
        expect(absent.action.attended).to.equal(false);
        expect(absent.action.canSubmit).to.equal(false);

        const enrolled = built({ tdoc, tsdoc: statusOf({ attend: 1 }) }).ws;
        expect(enrolled.phase).to.equal('answering');
        expectLocked(enrolled, null);
        expect(enrolled.action).to.deep.equal({
            canStart: false,
            canFinalize: false,
            canAttend: false,
            canUnrank: false,
            canSubmit: true,
            attended: true,
            canRetake: false,
        });

        const zero = built({ tdoc, tsdoc: statusOf({ attend: 0 }) }).ws;
        expect(zero.phase).to.equal('ready');
        expectLocked(zero, 'need_attend');
        expect(zero.action.attended).to.equal(false);
    });

    it('keeps an unregistered individual acm ready and passes canAttend through', () => {
        const { ws } = built({
            kind: 'contest',
            tdoc: contestDoc({ rule: 'acm', beginAt: at('08:00:00'), endAt: at('20:00:00'), participationMode: 'individual' }),
            tsdoc: statusOf(null),
            canAttend: true,
            canUnrank: true,
        });
        expect(ws.phase).to.equal('ready');
        expect(ws.flavor).to.equal('acm');
        expectLocked(ws, 'need_attend');
        expect(ws.action.canAttend).to.equal(true);
        expect(ws.action.canUnrank).to.equal(true);
        expect(ws.action.attended).to.equal(false);
    });

    it('still asks an acm with a personal limit to attend, then answers after attend', () => {
        const tdoc = contestDoc({ rule: 'acm', beginAt: at('08:00:00'), endAt: at('20:00:00'), duration: 1 });
        const waiting = built({ kind: 'contest', tdoc, tsdoc: statusOf(null) }).ws;
        expect(waiting.phase).to.equal('ready');
        expectLocked(waiting, 'need_attend');

        const started = built({
            kind: 'contest',
            tdoc,
            // Default now is 10:00; a 09:00 start with a 1-hour limit ends exactly now (submitted).
            tsdoc: statusOf({ attend: 1, startAt: at('09:30:00') }),
        }).ws;
        expect(started.phase).to.equal('answering');
        expectLocked(started, null);

        const startAt = at('10:00:00');
        const submitted = built({
            kind: 'contest',
            tdoc,
            tsdoc: statusOf({ attend: 1, startAt }),
            now: new Date(startAt.getTime() + EXAM_PAPER_HOUR_MS),
        }).ws;
        expect(submitted.phase).to.equal('submitted');
        expectLocked(submitted, null);

        const unregistered = built({
            kind: 'contest',
            tdoc,
            tsdoc: statusOf({ attend: 0, startAt }),
            now: new Date(startAt.getTime() + EXAM_PAPER_HOUR_MS),
        }).ws;
        expect(unregistered.phase).to.equal('ready');
        expectLocked(unregistered, 'need_attend');
    });

    it('submits a finalized paper before the window ends and hides the verdict', () => {
        const problems = [problem(11, 'single', '单选', 5), problem(12, 'true_false', '判断', 5)];
        const { ws } = built({
            kind: 'paper',
            tdoc: contestDoc({
                rule: 'exam',
                beginAt: at('08:00:00'),
                endAt: at('20:00:00'),
                examShowVerdict: false,
                pids: [11, 12],
            }),
            tsdoc: statusOf({ startAt: at('09:00:00'), paperFinalizedAt: at('09:30:00') }),
            problems,
            drafts: new Map([[11, draft({ answers: { a: 'B' }, judgeResult: { q1: 'correct' } })]]),
            paperFacts: paperFacts({ score: 88 }),
        });
        expect(ws.phase).to.equal('submitted');
        expect(ws.flavor).to.equal('paper');
        expect(ws.numbering).to.equal('pta');
        expect(ws.verdictVisible).to.equal(false);
        expectLocked(ws, null);
        expect(itemOf(ws, 11).state).to.equal('submitted');
        expect(itemOf(ws, 11).title).to.equal('单选');
        expect(itemOf(ws, 12).state).to.equal('empty');
        expect(ws.totals.showScore).to.equal(false);
        expect(ws.totals.score).to.equal(88);
        expect(ws.paper).to.deep.equal(paperFacts({ score: 88 }));
    });

    it('closes a started paper after the finalize grace and not before', () => {
        const startAt = at('10:00:00');
        const personalEnd = startAt.getTime() + EXAM_PAPER_HOUR_MS;
        const base = {
            kind: 'paper' as const,
            tdoc: contestDoc({ rule: 'exam', beginAt: at('08:00:00'), endAt: at('20:00:00'), duration: 1 }),
            tsdoc: statusOf({ startAt }),
            paperFacts: paperFacts(),
        };
        expect(built({ ...base, now: new Date(personalEnd + 30_000) }).ws.phase).to.equal('answering');
        expect(built({ ...base, now: new Date(personalEnd + EXAM_PAPER_FINALIZE_GRACE_MS + 1) }).ws.phase).to.equal('submitted');
    });

    it('keeps an unstarted paper ready until the student starts', () => {
        const ws = built({
            kind: 'paper',
            tdoc: contestDoc({ rule: 'exam', beginAt: at('08:00:00'), endAt: at('20:00:00'), duration: 0 }),
            tsdoc: statusOf(null),
            urls: urls({ start: '/paper/1/start' }),
            paperFacts: paperFacts(),
        }).ws;
        expect(ws.phase).to.equal('ready');
        expectLocked(ws, 'need_start');
        expect(ws.action.canStart).to.equal(true);
        expect(ws.action.canFinalize).to.equal(false);
    });

    it('ends the contest at endAt even when the paper was finalized', () => {
        const ws = built({
            kind: 'paper',
            now: on('20', '10:00:00'),
            tdoc: contestDoc({
                rule: 'exam',
                beginAt: on('19', '08:00:00'),
                endAt: on('19', '20:00:00'),
                pids: [11],
            }),
            tsdoc: statusOf({ startAt: on('19', '09:00:00'), paperFinalizedAt: on('19', '18:00:00') }),
            problems: [problem(11, 'single', '单选', 5)],
            drafts: new Map([[11, draft({ judgeResult: { q1: 'correct' } })]]),
            paperFacts: paperFacts({ score: 1 }),
        }).ws;
        expect(ws.phase).to.equal('ended');
        expect(ws.verdictVisible).to.equal(true);
        expect(itemOf(ws, 11).state).to.equal('correct');
    });

    it('keeps an ended unstarted paper objective empty', () => {
        const ws = built({
            kind: 'paper',
            now: on('20', '10:00:00'),
            tdoc: contestDoc({
                rule: 'exam',
                beginAt: on('19', '08:00:00'),
                endAt: on('19', '20:00:00'),
                pids: [11],
            }),
            tsdoc: statusOf(null),
            problems: [problem(11, 'single', '单选', 5)],
            paperFacts: paperFacts(),
        }).ws;
        expect(ws.phase).to.equal('ended');
        expect(ws.verdictVisible).to.equal(true);
        expect(itemOf(ws, 11).state).to.equal('empty');
        expect(ws.totals.answered).to.equal(0);
    });

    it('locks the browser out of a live client-required contest and unlocks preview', () => {
        const tdoc = contestDoc({ ...openHomework, entryMode: 'client_required', title: '机房' });
        const problems = [problem(1, 'single', '可见题', 5)];
        const browser = built({
            tdoc,
            problems,
            tsdoc: statusOf({ attend: 1 }),
            mode: 'browser',
        }).ws;
        expect(browser.phase).to.equal('answering');
        expectLocked(browser, 'client_only');
        expect(titlesOf(browser)).to.deep.equal(['']);
        expect(browser.action.canSubmit).to.equal(false);

        const preview = built({
            tdoc,
            problems,
            tsdoc: statusOf({ attend: 1 }),
            mode: 'preview',
        }).ws;
        expect(preview.phase).to.equal('answering');
        expectLocked(preview, null);
        expect(titlesOf(preview)).to.deep.equal(['可见题']);

        const client = built({
            tdoc,
            problems,
            tsdoc: statusOf({ attend: 1 }),
            mode: 'client',
        }).ws;
        expectLocked(client, null);
        expect(titlesOf(client)).to.deep.equal(['可见题']);

        const ended = built({
            mode: 'browser',
            now: on('20', '10:00:00'),
            tdoc: contestDoc({
                rule: 'homework',
                beginAt: on('19', '08:00:00'),
                endAt: on('19', '20:00:00'),
                entryMode: 'client_required',
            }),
            problems,
            tsdoc: statusOf({ attend: 1 }),
        }).ws;
        expect(ended.phase).to.equal('ended');
        expectLocked(ended, null);
        expect(titlesOf(ended)).to.deep.equal(['可见题']);
    });

    it('locks a closed post-contest view', () => {
        const contest = built({
            kind: 'contest',
            now: on('20', '10:00:00'),
            tdoc: contestDoc({
                rule: 'acm',
                beginAt: on('19', '08:00:00'),
                endAt: on('19', '20:00:00'),
                title: '已结束',
            }),
            problems: [problem(1, 'programming', 'A 题', 100)],
            tsdoc: statusOf({ attend: 1 }),
            postContestViewClosed: true,
        }).ws;
        expect(contest.phase).to.equal('ended');
        expectLocked(contest, 'view_closed');
        expect(titlesOf(contest)).to.deep.equal(['']);

        const open = built({
            kind: 'contest',
            now: on('20', '10:00:00'),
            tdoc: contestDoc({ rule: 'acm', beginAt: on('19', '08:00:00'), endAt: on('19', '20:00:00') }),
            problems: [problem(1, 'programming', 'A 题', 100)],
            tsdoc: statusOf({ attend: 1 }),
            postContestViewClosed: false,
        }).ws;
        expect(open.phase).to.equal('ended');
        expectLocked(open, null);
        expect(titlesOf(open)).to.deep.equal(['A 题']);

        const homework = built({
            now: on('20', '10:00:00'),
            tdoc: contestDoc({ rule: 'homework', beginAt: on('19', '08:00:00'), endAt: on('19', '20:00:00') }),
            tsdoc: statusOf({ attend: 1 }),
            postContestViewClosed: true,
        }).ws;
        expect(homework.phase).to.equal('ended');
        expectLocked(homework, 'view_closed');
    });
});

describe('set workspace groups', () => {
    it('letters an acm into one programming group and leaves maxScore empty', () => {
        const { ws } = built({
            kind: 'contest',
            tdoc: contestDoc({ rule: 'acm', beginAt: at('08:00:00'), endAt: at('20:00:00'), pids: [1, 2, 3] }),
            tsdoc: statusOf({ attend: 1 }),
            problems: [
                problem(1, 'true_false', '甲', 100),
                problem(2, 'programming', '乙', 50),
                problem(3, 'function', '丙', 25),
            ],
            journal: new Map([[1, accepted]]),
        });
        expect(ws.numbering).to.equal('letter');
        expect(ws.flavor).to.equal('acm');
        expect(ws.groups).to.deep.equal([
            {
                kind: 'programming',
                no: null,
                name: '题目',
                scoreEach: null,
                items: [
                    {
                        pid: 1,
                        label: 'A',
                        title: '甲',
                        kind: 'true_false',
                        score: 100,
                        state: 'correct',
                        submits: 2,
                        lastScore: 10,
                    },
                    {
                        pid: 2,
                        label: 'B',
                        title: '乙',
                        kind: 'programming',
                        score: 50,
                        state: 'empty',
                        submits: 0,
                        lastScore: null,
                    },
                    {
                        pid: 3,
                        label: 'C',
                        title: '丙',
                        kind: 'function',
                        score: 25,
                        state: 'empty',
                        submits: 0,
                        lastScore: null,
                    },
                ],
            },
        ]);
        expect(ws.totals).to.deep.equal({
            problemCount: 3,
            maxScore: null,
            answered: 1,
            score: null,
            accepted: 1,
            showScore: true,
        });
        expect(ws.verdictVisible).to.equal(true);
    });

    it('uses the shared score as scoreEach for a letter group', () => {
        const ws = built({
            kind: 'contest',
            tdoc: contestDoc({ rule: 'ioi', beginAt: at('08:00:00'), endAt: at('20:00:00') }),
            tsdoc: statusOf({ attend: 1 }),
            problems: [problem(1, 'programming', '甲', 100), problem(2, 'programming', '乙', 100)],
        }).ws;
        expect(ws.flavor).to.equal('ioi');
        expect(ws.numbering).to.equal('letter');
        expect(ws.groups[0].scoreEach).to.equal(100);
        expect(ws.groups[0].no).to.equal(null);
        expect(ws.groups[0].name).to.equal('题目');
    });

    it('orders homework kinds by pta number and labels inside each kind', () => {
        const { ws } = built({
            tdoc: contestDoc({ ...openHomework, pids: [1, 2, 3, 4] }),
            problems: [
                problem(1, 'programming', '编程', 30),
                problem(2, 'true_false', '判断一', 10),
                problem(3, 'single', '单选', 20),
                problem(4, 'true_false', '判断二', 10),
            ],
        });
        expect(ws.numbering).to.equal('pta');
        expect(ws.groups.map((group) => ({ kind: group.kind, no: group.no, name: group.name, scoreEach: group.scoreEach }))).to.deep.equal([
            { kind: 'true_false', no: 1, name: '判断题', scoreEach: 10 },
            { kind: 'single', no: 2, name: '单选题', scoreEach: 20 },
            { kind: 'programming', no: 7, name: '编程题', scoreEach: 30 },
        ]);
        expect(ws.groups.flatMap((group) => group.items.map((row) => [row.pid, row.label]))).to.deep.equal([
            [2, '1-1'],
            [4, '1-2'],
            [3, '2-1'],
            [1, '7-1'],
        ]);
        expect(ws.totals.maxScore).to.equal(70);
        expect(ws.totals.problemCount).to.equal(4);
        expect(ws.totals.answered).to.equal(0);
        expect(ws.totals.score).to.equal(0);
        expect(ws.totals.accepted).to.equal(null);
        expect(ws.totals.showScore).to.equal(true);
    });

    it('leaves scoreEach empty when scores inside a kind differ, including zero', () => {
        const mixed = built({
            problems: [problem(1, 'single', '甲', 5), problem(2, 'single', '乙', 8)],
        }).ws;
        expect(mixed.groups[0].scoreEach).to.equal(null);

        const zeros = built({
            problems: [problem(1, 'blank', '空', 0), problem(2, 'blank', '白', 0)],
        }).ws;
        expect(zeros.groups[0].scoreEach).to.equal(0);
    });

    it('maps each contest rule onto flavor and numbering', () => {
        const cases: Array<[string, SetWorkspaceInput['kind'], string, 'pta' | 'letter']> = [
            ['homework', 'homework', 'homework', 'pta'],
            ['exam', 'paper', 'paper', 'pta'],
            ['acm', 'contest', 'acm', 'letter'],
            ['ioi', 'contest', 'ioi', 'letter'],
            ['strictioi', 'contest', 'ioi', 'letter'],
            ['oi', 'contest', 'oi', 'letter'],
            ['ledo', 'contest', 'oi', 'letter'],
        ];
        for (const [rule, kind, flavor, numbering] of cases) {
            const ws = built({
                kind,
                tdoc: contestDoc({ rule, beginAt: at('08:00:00'), endAt: at('20:00:00') }),
            }).ws;
            expect(ws.kind, rule).to.equal(kind);
            expect(ws.flavor, rule).to.equal(flavor);
            expect(ws.numbering, rule).to.equal(numbering);
        }
        expect(() =>
            built({
                kind: 'contest',
                tdoc: contestDoc({ rule: 'xyz', beginAt: at('08:00:00'), endAt: at('20:00:00') }),
            }),
        ).to.throw(TypeError);
        expect(() => workspaceInfo('contest', contestDoc({ rule: 'xyz', beginAt: at('08:00:00'), endAt: at('20:00:00') }))).to.throw(TypeError);
    });
});

describe('set workspace item state', () => {
    it('keeps a matching homework draft accepted and a changed draft unsubmitted', () => {
        const problems = [problem(8, 'single', '单选', 10)];
        const same = built({
            problems,
            drafts: new Map([[8, draft({ answers: { a: 'B' }, submittedAnswers: { a: 'B' } })]]),
            journal: new Map([[8, accepted]]),
        }).ws;
        expect(itemOf(same, 8)).to.deep.equal({
            pid: 8,
            label: '2-1',
            title: '单选',
            kind: 'single',
            score: 10,
            state: 'correct',
            submits: 2,
            lastScore: 10,
        });
        expect(same.verdictVisible).to.equal(true);
        expect(same.totals).to.deep.equal({
            problemCount: 1,
            maxScore: 10,
            answered: 1,
            score: 10,
            accepted: null,
            showScore: true,
        });

        const changed = built({
            problems,
            drafts: new Map([[8, draft({ answers: { a: 'C' }, submittedAnswers: { a: 'B' }, judgeResult: { q1: 'wrong' } })]]),
            journal: new Map([[8, accepted]]),
        }).ws;
        expect(itemOf(changed, 8).state).to.equal('draft');
        expect(changed.totals.score).to.equal(10);
        expect(changed.totals.answered).to.equal(1);
    });

    it('compares homework drafts with sorted keys and sorted answer arrays', () => {
        const problems = [problem(8, 'multi', '多选', 10)];
        const reordered = built({
            problems,
            drafts: new Map([[8, draft({ answers: { b: '1', a: ['B', 'A'] }, submittedAnswers: { a: ['A', 'B'], b: '1' } })]]),
            journal: new Map([[8, accepted]]),
        }).ws;
        expect(itemOf(reordered, 8).state).to.equal('correct');

        const fresh = built({
            problems,
            drafts: new Map([[8, draft({ answers: { a: 'B' }, submittedAnswers: null })]]),
            journal: new Map([[8, accepted]]),
        }).ws;
        expect(itemOf(fresh, 8).state).to.equal('draft');

        const cleared = built({
            problems,
            drafts: new Map([[8, draft({ answers: null, submittedAnswers: { a: 'B' } })]]),
            journal: new Map([[8, accepted]]),
        }).ws;
        expect(itemOf(cleared, 8).state).to.equal('correct');
    });

    it('maps the remaining homework journal onto partial, wrong, and empty', () => {
        const ws = built({
            problems: [
                problem(1, 'single', '部分', 5),
                problem(2, 'single', '错误', 5),
                problem(3, 'single', '未交', 5),
                problem(4, 'single', '空记录', 5),
            ],
            journal: new Map<number, JournalFacts>([
                [1, journal({ submits: 1, lastStatus: STATUS.STATUS_WRONG_ANSWER, lastScore: 3 })],
                [2, journal({ submits: 1, lastStatus: STATUS.STATUS_WRONG_ANSWER, lastScore: 0 })],
                [4, journal({ submits: 0, lastStatus: null, lastScore: null })],
            ]),
        }).ws;
        expect(itemOf(ws, 1).state).to.equal('partial');
        expect(itemOf(ws, 2).state).to.equal('wrong');
        expect(itemOf(ws, 3).state).to.equal('empty');
        expect(itemOf(ws, 3).submits).to.equal(0);
        expect(itemOf(ws, 3).lastScore).to.equal(null);
        expect(itemOf(ws, 4).state).to.equal('empty');
        expect(ws.totals.score).to.equal(3);
        expect(ws.totals.answered).to.equal(2);
    });

    it('scores ioi and oi from lastScore and keeps acm pass or wrong', () => {
        const problems = [problem(1, 'programming', '甲', 10), problem(2, 'programming', '乙', 20)];
        const ioi = built({
            kind: 'contest',
            tdoc: contestDoc({ rule: 'ioi', beginAt: at('08:00:00'), endAt: at('20:00:00') }),
            tsdoc: statusOf({ attend: 1 }),
            problems,
            journal: new Map<number, JournalFacts>([
                [1, journal({ submits: 1, lastStatus: STATUS.STATUS_WRONG_ANSWER, lastScore: 4 })],
                [2, journal({ submits: 1, lastStatus: STATUS.STATUS_ACCEPTED, lastScore: 20 })],
            ]),
        }).ws;
        expect(itemOf(ioi, 1).state).to.equal('partial');
        expect(itemOf(ioi, 2).state).to.equal('correct');
        expect(ioi.totals).to.deep.equal({
            problemCount: 2,
            maxScore: 30,
            answered: 2,
            score: 24,
            accepted: null,
            showScore: true,
        });

        const acm = built({
            kind: 'contest',
            tdoc: contestDoc({ rule: 'acm', beginAt: at('08:00:00'), endAt: at('20:00:00') }),
            tsdoc: statusOf({ attend: 1 }),
            problems,
            drafts: new Map([[1, draft({ answers: { a: 'B' } })]]),
            journal: new Map([[2, journal({ submits: 4, lastStatus: STATUS.STATUS_WRONG_ANSWER, lastScore: 20 })]]),
        }).ws;
        expect(itemOf(acm, 1).state).to.equal('empty');
        expect(itemOf(acm, 2).state).to.equal('wrong');
        expect(acm.totals.score).to.equal(null);
        expect(acm.totals.accepted).to.equal(0);
        expect(acm.totals.maxScore).to.equal(null);

        const oi = built({
            kind: 'contest',
            tdoc: contestDoc({ rule: 'ledo', beginAt: at('08:00:00'), endAt: at('20:00:00') }),
            tsdoc: statusOf({ attend: 1 }),
            problems: [problem(1, 'programming', '甲', 10)],
            journal: new Map([[1, journal({ submits: 1, lastStatus: STATUS.STATUS_WRONG_ANSWER, lastScore: 1 })]]),
        }).ws;
        expect(oi.flavor).to.equal('oi');
        expect(itemOf(oi, 1).state).to.equal('partial');
        expect(oi.totals.score).to.equal(1);
        expect(oi.totals.accepted).to.equal(null);
    });

    it('shows paper drafts before finalize and journal only for program kinds', () => {
        const problems = [problem(1, 'single', '单选', 5), problem(2, 'function', '函数', 15)];
        const open = {
            kind: 'paper' as const,
            tdoc: contestDoc({ rule: 'exam', beginAt: at('08:00:00'), endAt: at('20:00:00'), pids: [1, 2] }),
            tsdoc: statusOf({ startAt: at('09:00:00') }),
            problems,
            paperFacts: paperFacts(),
        };
        const drafted = built({
            ...open,
            drafts: new Map([
                [1, draft({ answers: { a: 'A' } })],
                [2, draft({ code: 'int f(){return 1;}', answers: null })],
            ]),
            journal: new Map([[1, accepted], [2, accepted]]),
        }).ws;
        expect(drafted.phase).to.equal('answering');
        expect(itemOf(drafted, 1).state).to.equal('draft');
        expect(itemOf(drafted, 2).state).to.equal('draft');
        expect(drafted.action.canFinalize).to.equal(true);
        expect(drafted.verdictVisible).to.equal(true);

        const judged = built({
            ...open,
            drafts: new Map([[2, draft({ code: '', answers: null })]]),
            journal: new Map([[2, accepted]]),
        }).ws;
        expect(itemOf(judged, 1).state).to.equal('empty');
        expect(itemOf(judged, 2).state).to.equal('correct');

        const hidden = built({
            ...open,
            tdoc: contestDoc({
                rule: 'exam',
                beginAt: at('08:00:00'),
                endAt: at('20:00:00'),
                examShowVerdict: false,
                pids: [1, 2],
            }),
            journal: new Map([[2, accepted]]),
        }).ws;
        expect(hidden.verdictVisible).to.equal(false);
        expect(itemOf(hidden, 2).state).to.equal('empty');
    });

    it('aggregates a finalized paper by judgeResult and reveals it in preview', () => {
        const problems = [
            problem(1, 'single', '全对', 5),
            problem(2, 'multi', '全错', 5),
            problem(3, 'blank', '混合', 5),
            problem(4, 'subjective', '未判', 5),
            problem(5, 'function', '函数', 20),
        ];
        const visible = built({
            kind: 'paper',
            tdoc: contestDoc({ rule: 'exam', beginAt: at('08:00:00'), endAt: at('20:00:00'), pids: [1, 2, 3, 4, 5] }),
            tsdoc: statusOf({ startAt: at('09:00:00'), paperFinalizedAt: at('09:40:00') }),
            problems,
            drafts: new Map([
                [1, draft({ judgeResult: { q1: 'correct', q2: 'correct' } })],
                [2, draft({ judgeResult: { q1: 'wrong', q2: 'wrong' } })],
                [3, draft({ judgeResult: { q1: 'correct', q2: 'partial' } })],
                [5, draft({ judgeResult: { q1: 'wrong' } })],
            ]),
            journal: new Map([[5, accepted]]),
            paperFacts: paperFacts({ score: 30 }),
        }).ws;
        expect(visible.phase).to.equal('submitted');
        expect(visible.verdictVisible).to.equal(true);
        expect(itemOf(visible, 1).state).to.equal('correct');
        expect(itemOf(visible, 2).state).to.equal('wrong');
        expect(itemOf(visible, 3).state).to.equal('partial');
        expect(itemOf(visible, 4).state).to.equal('submitted');
        expect(itemOf(visible, 5).state).to.equal('correct');
        expect(visible.totals.showScore).to.equal(true);
        expect(visible.totals.score).to.equal(30);
        expect(visible.totals.maxScore).to.equal(40);
        expect(visible.totals.accepted).to.equal(null);

        const hidden = built({
            kind: 'paper',
            mode: 'browser',
            tdoc: contestDoc({
                rule: 'exam',
                beginAt: at('08:00:00'),
                endAt: at('20:00:00'),
                examShowVerdict: false,
            }),
            tsdoc: statusOf({ startAt: at('09:00:00'), paperFinalizedAt: at('09:40:00') }),
            problems: [problem(5, 'programming', '编程', 20)],
            drafts: new Map([[5, draft({ code: 'int main(){return 0;}' })]]),
            journal: new Map([[5, accepted]]),
            paperFacts: paperFacts({ score: 0 }),
        }).ws;
        expect(hidden.verdictVisible).to.equal(false);
        expect(itemOf(hidden, 5).state).to.equal('submitted');
        expect(hidden.totals.showScore).to.equal(false);

        const preview = built({
            kind: 'paper',
            mode: 'preview',
            tdoc: contestDoc({
                rule: 'exam',
                beginAt: at('08:00:00'),
                endAt: at('20:00:00'),
                examShowVerdict: false,
            }),
            tsdoc: statusOf({ startAt: at('09:00:00'), paperFinalizedAt: at('09:40:00') }),
            problems: [problem(1, 'single', '单选', 5)],
            drafts: new Map([[1, draft({ judgeResult: { q1: 'wrong' } })]]),
            paperFacts: paperFacts({ score: 0 }),
        }).ws;
        expect(preview.verdictVisible).to.equal(true);
        expect(itemOf(preview, 1).state).to.equal('wrong');
        expect(preview.totals.showScore).to.equal(true);
    });
});

describe('set workspace totals and action', () => {
    it('sums homework lastScore and ignores nulls', () => {
        const ws = built({
            problems: [problem(1, 'single', '甲', 4), problem(2, 'single', '乙', 6), problem(3, 'blank', '丙', 8)],
            journal: new Map<number, JournalFacts>([
                [1, journal({ submits: 1, lastStatus: STATUS.STATUS_ACCEPTED, lastScore: 10 })],
                [2, journal({ submits: 1, lastStatus: STATUS.STATUS_WRONG_ANSWER, lastScore: null })],
            ]),
        }).ws;
        expect(ws.totals).to.deep.equal({
            problemCount: 3,
            maxScore: 18,
            answered: 2,
            score: 10,
            accepted: null,
            showScore: true,
        });
    });

    it('shows a paper score only after submit when the verdict and score exist', () => {
        const answering = built({
            kind: 'paper',
            tdoc: contestDoc({ rule: 'exam', beginAt: at('08:00:00'), endAt: at('20:00:00') }),
            tsdoc: statusOf({ startAt: at('09:00:00') }),
            problems: [problem(1, 'single', '甲', 5)],
            paperFacts: paperFacts({ score: 7 }),
        }).ws;
        expect(answering.phase).to.equal('answering');
        expect(answering.totals.showScore).to.equal(false);
        expect(answering.totals.score).to.equal(7);

        const ended = built({
            kind: 'paper',
            now: on('20', '10:00:00'),
            tdoc: contestDoc({ rule: 'exam', beginAt: on('19', '08:00:00'), endAt: on('19', '20:00:00') }),
            tsdoc: statusOf({ startAt: on('19', '09:00:00') }),
            paperFacts: paperFacts({ score: 0 }),
        }).ws;
        expect(ended.phase).to.equal('ended');
        expect(ended.verdictVisible).to.equal(true);
        expect(ended.totals.showScore).to.equal(true);
        expect(ended.totals.score).to.equal(0);
    });

    it('gates start, finalize, submit, and retake', () => {
        const answeringHomework = built({
            problems: [problem(1, 'single', '甲', 5)],
            urls: urls({ start: '/homework/1' }),
        }).ws;
        expect(answeringHomework.action.canStart).to.equal(false);
        expect(answeringHomework.action.canSubmit).to.equal(true);
        expect(answeringHomework.action.canFinalize).to.equal(false);

        const previewHomework = built({ mode: 'preview' }).ws;
        expect(previewHomework.action.canSubmit).to.equal(false);

        const paper = built({
            kind: 'paper',
            mode: 'browser',
            tdoc: contestDoc({ rule: 'exam', beginAt: at('08:00:00'), endAt: at('20:00:00') }),
            tsdoc: statusOf({ startAt: at('09:00:00') }),
            paperFacts: paperFacts({ canRetake: true }),
            urls: urls({ finalize: '/paper/1/finalize' }),
        }).ws;
        expect(paper.phase).to.equal('answering');
        expect(paper.action.canFinalize).to.equal(true);
        expect(paper.action.canRetake).to.equal(true);
        expect(paper.action.canSubmit).to.equal(true);

        const previewPaper = built({
            kind: 'paper',
            mode: 'preview',
            tdoc: contestDoc({ rule: 'exam', beginAt: at('08:00:00'), endAt: at('20:00:00') }),
            tsdoc: statusOf({ startAt: at('09:00:00') }),
            paperFacts: paperFacts({ canRetake: false }),
        }).ws;
        expect(previewPaper.action.canFinalize).to.equal(false);
        expect(previewPaper.action.canSubmit).to.equal(false);
        expect(previewPaper.action.canRetake).to.equal(false);

        const practice = built({
            kind: 'contest',
            now: on('20', '10:00:00'),
            tdoc: contestDoc({ rule: 'acm', beginAt: on('19', '08:00:00'), endAt: on('19', '20:00:00') }),
            tsdoc: statusOf({ attend: 1 }),
            postContestPracticeOpen: true,
            postContestViewClosed: true,
        }).ws;
        expect(practice.phase).to.equal('ended');
        expectLocked(practice, 'view_closed');
        expect(practice.action.canSubmit).to.equal(true);

        const previewPractice = built({
            kind: 'contest',
            mode: 'preview',
            now: on('20', '10:00:00'),
            tdoc: contestDoc({ rule: 'acm', beginAt: on('19', '08:00:00'), endAt: on('19', '20:00:00') }),
            tsdoc: statusOf({ attend: 1 }),
            postContestPracticeOpen: true,
        }).ws;
        expect(previewPractice.action.canSubmit).to.equal(false);

        const homeworkEnded = built({
            now: on('20', '10:00:00'),
            tdoc: contestDoc({ rule: 'homework', beginAt: on('19', '08:00:00'), endAt: on('19', '20:00:00') }),
            tsdoc: statusOf({ attend: 1 }),
            postContestPracticeOpen: true,
        }).ws;
        expect(homeworkEnded.action.canSubmit).to.equal(false);

        const noPractice = built({
            kind: 'contest',
            now: on('20', '10:00:00'),
            tdoc: contestDoc({ rule: 'oi', beginAt: on('19', '08:00:00'), endAt: on('19', '20:00:00') }),
            tsdoc: statusOf({ attend: 1 }),
            postContestPracticeOpen: false,
        }).ws;
        expect(noPractice.action.canSubmit).to.equal(false);
    });
});

describe('workspaceInfo', () => {
    it('describes an acm contest with the penalty rule', () => {
        const beginAt = at('13:00:00');
        const endAt = at('17:00:00');
        const info = workspaceInfo(
            'contest',
            contestDoc({ rule: 'acm', beginAt, endAt, participationMode: 'individual' }),
        );
        expect(info).to.deep.equal([
            { label: '类型', text: '考试 · ACM' },
            { label: '时间', range: [beginAt.toISOString(), endAt.toISOString()] },
            { label: '赛制', text: 'ACM · 每次错误提交罚时 20 分钟' },
            { label: '参赛', text: '个人赛' },
        ]);
    });

    it('adds team, client entry, and lock rows only when those fields are set', () => {
        const beginAt = at('13:00:00');
        const endAt = at('17:00:00');
        const lockAt = at('16:00:00');
        const info = workspaceInfo(
            'contest',
            contestDoc({
                rule: 'acm',
                beginAt,
                endAt,
                participationMode: 'team',
                entryMode: 'client_required',
                lockAt,
                duration: 5,
            }),
        );
        expect(info).to.deep.equal([
            { label: '类型', text: '考试 · ACM' },
            { label: '时间', range: [beginAt.toISOString(), endAt.toISOString()] },
            { label: '赛制', text: 'ACM · 每次错误提交罚时 20 分钟' },
            { label: '参赛', text: '团队赛' },
            { label: '进入方式', text: '机房客户端' },
            { label: '封榜', at: lockAt.toISOString() },
        ]);
    });

    it('names ioi and oi rules, including strictioi and ledo', () => {
        const beginAt = at('13:00:00');
        const endAt = at('17:00:00');
        const range = [beginAt.toISOString(), endAt.toISOString()];
        expect(workspaceInfo('contest', contestDoc({ rule: 'strictioi', beginAt, endAt }))).to.deep.equal([
            { label: '类型', text: '考试 · IOI' },
            { label: '时间', range },
            { label: '赛制', text: 'IOI · 按测试点给分' },
            { label: '参赛', text: '个人赛' },
        ]);
        expect(workspaceInfo('contest', contestDoc({ rule: 'ledo', beginAt, endAt }))).to.deep.equal([
            { label: '类型', text: '考试 · OI' },
            { label: '时间', range },
            { label: '赛制', text: 'OI · 结束后公布成绩' },
            { label: '参赛', text: '个人赛' },
        ]);
    });

    it('lists homework open range, due, late close, and personal limit', () => {
        const beginAt = at('08:00:00');
        const endAt = at('20:00:00');
        const dueAt = at('18:00:00');
        // C2 要求 info 行 text/at/range 三选一，迟交只放 text，把 endAt 的 ISO 写进句子。
        const late = workspaceInfo(
            'homework',
            contestDoc({
                rule: 'homework',
                beginAt,
                endAt,
                penaltySince: dueAt,
                duration: 0.75,
                pids: [1, 2, 3],
            }),
        );
        expect(late).to.deep.equal([
            { label: '类型', text: '作业' },
            { label: '开放', range: [beginAt.toISOString(), endAt.toISOString()] },
            { label: '截止', at: dueAt.toISOString() },
            { label: '迟交', text: `到 ${endAt.toISOString()}，按老师设置扣分` },
            { label: '个人限时', text: '45 分钟，开始后计时' },
        ]);

        const plain = workspaceInfo('homework', contestDoc({ rule: 'homework', beginAt, endAt, duration: 0 }));
        expect(plain).to.deep.equal([
            { label: '类型', text: '作业' },
            { label: '开放', range: [beginAt.toISOString(), endAt.toISOString()] },
        ]);

        const noLate = workspaceInfo(
            'homework',
            contestDoc({ rule: 'homework', beginAt, endAt, penaltySince: endAt }),
        );
        expect(noLate.map((row) => row.label)).to.deep.equal(['类型', '开放']);
    });

    it('lists paper type, limit, problem count, verdict, pass line, and attempts', () => {
        const beginAt = at('14:00:00');
        const endAt = at('16:30:00');
        const full = workspaceInfo(
            'paper',
            contestDoc({
                rule: 'exam',
                beginAt,
                endAt,
                duration: 2,
                pids: [1, 2],
                examPassScore: 60,
                examAttemptLimit: 3,
            }),
        );
        expect(full).to.deep.equal([
            { label: '类型', text: '考试 · 试卷' },
            { label: '开放', range: [beginAt.toISOString(), endAt.toISOString()] },
            { label: '个人限时', text: '120 分钟，开始后计时' },
            { label: '题目', text: '2 题' },
            { label: '对错', text: '提交后显示' },
            { label: '及格线', text: '60 分' },
            { label: '可考次数', text: '最多 3 次' },
        ]);

        const hidden = workspaceInfo(
            'paper',
            contestDoc({
                rule: 'exam',
                beginAt,
                endAt,
                pids: [9],
                examShowVerdict: false,
            }),
        );
        expect(hidden).to.deep.equal([
            { label: '类型', text: '考试 · 试卷' },
            { label: '开放', range: [beginAt.toISOString(), endAt.toISOString()] },
            { label: '题目', text: '1 题' },
            { label: '对错', text: '只显示分数' },
        ]);

        const drawn = contestDoc({
            rule: 'exam',
            beginAt,
            endAt,
            pids: [1, 2, 3],
        });
        drawn.examPaperQuotas = { single: 1 };
        expect(workspaceInfo('paper', drawn).find((row) => row.label === '题目')?.text).to.equal('1 题');

        const unstarted = contestDoc({
            rule: 'exam',
            beginAt,
            endAt,
            pids: [],
        });
        unstarted.examPaperQuotas = { single: 1 };
        expect(workspaceInfo('paper', unstarted).find((row) => row.label === '题目')?.text).to.equal('1 题');
    });
});

describe('set workspace payload fields', () => {
    it('rewrites description file urls and copies caller fields', () => {
        const docId = oid(9);
        const beginAt = at('08:00:00');
        const endAt = at('12:00:00');
        const startAt = at('09:00:00');
        const dueAt = at('11:00:00');
        const lockAt = at('11:30:00');
        const announcements = [{ id: 'a1', subject: '公告', content: '正文', createdAt: beginAt.toISOString() }];
        const clarifications = [
            {
                id: 'c1',
                subject: '提问',
                content: '这题什么意思',
                createdAt: beginAt.toISOString(),
                replies: [{ content: '看题面', createdAt: startAt.toISOString() }],
            },
        ];
        const student = { name: '林晓', studentId: null };
        const team = { teamName: '红队', role: 'captain' as const };
        const links = urls({
            back: null,
            overview: '/exam-mode/abc',
            manage: '/teach/acm/abc',
            start: '/paper/abc/start',
        });
        const { value, ws } = built({
            kind: 'homework',
            mode: 'client',
            tdoc: contestDoc({
                docId,
                rule: 'homework',
                title: '第四周',
                content: '看 (file://guide.pdf) 和 <img src="file://pic.png"> 以及 file://skip.bin',
                beginAt,
                endAt,
                duration: 0.75,
                penaltySince: dueAt,
                lockAt,
                pids: [1],
            }),
            tsdoc: statusOf({ attend: 1, startAt }),
            now: at('09:10:00'),
            student,
            team,
            announcements,
            clarifications,
            urls: links,
            problems: [problem(1, 'single', '单选', 5)],
        });
        expect(ws.tid).to.equal(docId.toHexString());
        expect(ws.title).to.equal('第四周');
        expect(ws.mode).to.equal('client');
        expect(ws.description).to.equal(
            `看 (./${docId.toHexString()}/file/public/guide.pdf) 和 <img src="./${docId.toHexString()}/file/public/pic.png"> 以及 file://skip.bin`,
        );
        const fileContent = '看 (file://guide.pdf) 和 <img src="file://pic.png"> 以及 file://skip.bin';
        const publicFile = (prefix: string) => `看 (${prefix}guide.pdf) 和 <img src="${prefix}pic.png"> 以及 file://skip.bin`;
        const descriptionOf = (kind: 'homework' | 'paper' | 'contest', rule: string) => built({
            kind,
            mode: 'browser',
            tdoc: contestDoc({
                docId,
                rule,
                title: '说明图',
                content: fileContent,
                beginAt,
                endAt,
            }),
        }).ws.description;
        const sameDir = `./${docId.toHexString()}/file/public/`;
        expect(descriptionOf('homework', 'homework')).to.equal(publicFile(sameDir));
        expect(descriptionOf('contest', 'acm')).to.equal(publicFile(sameDir));
        expect(descriptionOf('paper', 'exam')).to.equal(publicFile(`../contest/${docId.toHexString()}/file/public/`));
        expect(ws.student).to.deep.equal(student);
        expect(ws.team).to.deep.equal(team);
        expect(ws.announcements).to.deep.equal(announcements);
        expect(ws.clarifications).to.deep.equal(clarifications);
        expect(ws.paper).to.equal(null);
        expectWorkspaceUrls(ws, links, null, null);
        expect(ws.info).to.deep.equal(workspaceInfo(value.kind, value.tdoc));
        expect(ws.window).to.deep.equal({
            beginAt: beginAt.toISOString(),
            endAt: endAt.toISOString(),
            dueAt: dueAt.toISOString(),
            durationMinutes: 45,
            startAt: startAt.toISOString(),
            personalEndAt: new Date(startAt.getTime() + 0.75 * EXAM_PAPER_HOUR_MS).toISOString(),
            lockAt: lockAt.toISOString(),
        });
    });

    it('caps personal end at endAt and drops an absent due date', () => {
        const beginAt = at('08:00:00');
        const endAt = at('10:20:00');
        const startAt = at('10:00:00');
        const ws = built({
            kind: 'contest',
            tdoc: contestDoc({
                rule: 'acm',
                beginAt,
                endAt,
                duration: 0.75,
                penaltySince: at('09:00:00'),
            }),
            tsdoc: statusOf({ attend: 1, startAt }),
            now: at('10:05:00'),
        }).ws;
        expect(ws.window.dueAt).to.equal(null);
        expect(ws.window.durationMinutes).to.equal(45);
        expect(ws.window.personalEndAt).to.equal(endAt.toISOString());
        expect(ws.window.lockAt).to.equal(null);
        expect(ws.window.startAt).to.equal(startAt.toISOString());

        const unlimited = built({
            tdoc: contestDoc({ rule: 'homework', beginAt, endAt: at('20:00:00'), duration: 0 }),
            tsdoc: statusOf({ attend: 1, startAt }),
        }).ws;
        expect(unlimited.window.durationMinutes).to.equal(null);
        expect(unlimited.window.personalEndAt).to.equal(null);
        expect(unlimited.window.dueAt).to.equal(null);
    });

    it('hides objective homework verdicts and keeps function and programming scores', () => {
        const journalMap = new Map<number, JournalFacts>([
            [1, journal({ submits: 1, lastStatus: STATUS.STATUS_ACCEPTED, lastScore: 100 })],
            [2, journal({ submits: 1, lastStatus: STATUS.STATUS_ACCEPTED, lastScore: 40 })],
        ]);
        const drafts = new Map<number, DraftFacts>([
            [1, draft({ answers: { main: 'B' }, submittedAnswers: { main: 'B' } })],
        ]);
        const hidden = built({
            tdoc: contestDoc({ ...openHomework, homeworkShowObjectiveVerdict: false }),
            problems: [
                problem(1, 'true_false', '判断', 100),
                problem(2, 'programming', '编程', 100),
            ],
            journal: journalMap,
            drafts,
        }).ws;
        expect(hidden.objectiveVerdictVisible).to.equal(false);
        expect(itemOf(hidden, 1)).to.include({ state: 'submitted', lastScore: null, submits: 0 });
        expect(itemOf(hidden, 2)).to.include({ state: 'correct', lastScore: 40 });
        expect(hidden.totals.score).to.equal(40);
        expect(hidden.totals.maxScore).to.equal(100);
        expect(hidden.totals.showScore).to.equal(true);

        const shown = built({
            problems: [problem(1, 'true_false', '判断', 100)],
            journal: new Map([[1, journal({ submits: 1, lastStatus: STATUS.STATUS_ACCEPTED, lastScore: 100 })]]),
        }).ws;
        expect(shown.objectiveVerdictVisible).to.equal(true);
        expect(itemOf(shown, 1).state).to.equal('correct');

        const preview = built({
            mode: 'preview',
            tdoc: contestDoc({ ...openHomework, homeworkShowObjectiveVerdict: false }),
            problems: [problem(1, 'single', '单选', 100)],
            journal: new Map([[1, journal({ submits: 1, lastStatus: STATUS.STATUS_ACCEPTED, lastScore: 100 })]]),
        }).ws;
        expect(preview.objectiveVerdictVisible).to.equal(true);
        expect(itemOf(preview, 1).state).to.equal('correct');
    });
});

describe('set workspace verify urls', () => {
    function previewLinks(docId: ObjectId, rule: string, kind: SetWorkspaceInput['kind']) {
        const links = urls({ overview: `/workspace/${docId.toHexString()}` });
        const ws = built({
            kind,
            mode: 'preview',
            tdoc: contestDoc({
                docId,
                rule,
                title: rule,
                beginAt: at('08:00:00'),
                endAt: at('20:00:00'),
            }),
            urls: links,
        }).ws;
        return { links, ws, tid: docId.toHexString() };
    }

    it('points a preview homework at the homework verify endpoints', () => {
        const { links, ws, tid } = previewLinks(oid(21), 'homework', 'homework');
        expectWorkspaceUrls(
            ws,
            links,
            verifyEndpoint(tid, 'homework', 'objective'),
            verifyEndpoint(tid, 'homework', 'submit'),
        );
    });

    it('points a preview exam at the exam verify endpoints', () => {
        const { links, ws, tid } = previewLinks(oid(22), 'exam', 'paper');
        expectWorkspaceUrls(
            ws,
            links,
            verifyEndpoint(tid, 'exam', 'objective'),
            verifyEndpoint(tid, 'exam', 'submit'),
        );
    });

    it('points a preview acm contest at the acm verify endpoints', () => {
        const { links, ws, tid } = previewLinks(oid(23), 'acm', 'contest');
        expectWorkspaceUrls(
            ws,
            links,
            verifyEndpoint(tid, 'acm', 'objective'),
            verifyEndpoint(tid, 'acm', 'submit'),
        );
    });

    it('points an ioi preview at the oi verify endpoints', () => {
        const { links, ws, tid } = previewLinks(oid(26), 'ioi', 'contest');
        expectWorkspaceUrls(
            ws,
            links,
            verifyEndpoint(tid, 'oi', 'objective'),
            verifyEndpoint(tid, 'oi', 'submit'),
        );
    });

    it('points a strictioi preview at the oi verify endpoints', () => {
        const { links, ws, tid } = previewLinks(oid(27), 'strictioi', 'contest');
        expectWorkspaceUrls(
            ws,
            links,
            verifyEndpoint(tid, 'oi', 'objective'),
            verifyEndpoint(tid, 'oi', 'submit'),
        );
    });

    it('points a ledo preview at the oi verify endpoints', () => {
        const { links, ws, tid } = previewLinks(oid(28), 'ledo', 'contest');
        expectWorkspaceUrls(
            ws,
            links,
            verifyEndpoint(tid, 'oi', 'objective'),
            verifyEndpoint(tid, 'oi', 'submit'),
        );
    });

    it('replaces caller verify urls in a preview', () => {
        const docId = oid(29);
        const links = urls({
            overview: `/workspace/${docId.toHexString()}`,
            verifyObjective: '/teach/practice/wrong/verify/objective',
            verifySubmit: '/teach/practice/wrong/verify/submit',
        });
        const ws = built({
            kind: 'homework',
            mode: 'preview',
            tdoc: contestDoc({
                docId,
                rule: 'homework',
                title: 'homework',
                beginAt: at('08:00:00'),
                endAt: at('20:00:00'),
            }),
            urls: links,
        }).ws;
        expectWorkspaceUrls(
            ws,
            links,
            verifyEndpoint(docId.toHexString(), 'homework', 'objective'),
            verifyEndpoint(docId.toHexString(), 'homework', 'submit'),
        );
    });

    it('drops caller verify urls for a browser student', () => {
        const docId = oid(30);
        const links = urls({
            overview: `/homework/${docId.toHexString()}`,
            verifyObjective: '/teach/homework/wrong/verify/objective',
            verifySubmit: '/teach/homework/wrong/verify/submit',
        });
        const ws = built({
            mode: 'browser',
            tdoc: contestDoc({ ...openHomework, docId }),
            urls: links,
        }).ws;
        expectWorkspaceUrls(ws, links, null, null);
    });

    it('drops caller verify urls for a client session', () => {
        const docId = oid(31);
        const links = urls({
            overview: `/exam-mode/${docId.toHexString()}`,
            verifyObjective: '/teach/homework/wrong/verify/objective',
            verifySubmit: '/teach/homework/wrong/verify/submit',
        });
        const ws = built({
            mode: 'client',
            tdoc: contestDoc({ ...openHomework, docId, entryMode: 'client_required' }),
            urls: links,
        }).ws;
        expectWorkspaceUrls(ws, links, null, null);
    });

    it('leaves verify urls empty for a browser student', () => {
        const docId = oid(24);
        const links = urls({ overview: `/homework/${docId.toHexString()}` });
        const ws = built({
            mode: 'browser',
            tdoc: contestDoc({ ...openHomework, docId }),
            urls: links,
        }).ws;
        expectWorkspaceUrls(ws, links, null, null);
    });

    it('leaves verify urls empty for a client session', () => {
        const docId = oid(25);
        const links = urls({ overview: `/exam-mode/${docId.toHexString()}` });
        const ws = built({
            mode: 'client',
            tdoc: contestDoc({ ...openHomework, docId, entryMode: 'client_required' }),
            urls: links,
        }).ws;
        expectWorkspaceUrls(ws, links, null, null);
    });
});

describe('configured problem-set workspace', () => {
    it('projects ACM scoring independently of the entry route for every purpose', () => {
        for (const kind of ['homework', 'paper', 'contest'] as const) {
            const tdoc = configured(kind);
            tdoc.setConfig.settings.codePolicy = 'acm';
            const ws = built({ kind, tdoc, problems: [problem(1, 'programming', '代码', 100)] }).ws;
            expect(ws.codePolicy).to.equal('acm');
            expect(ws.totals.maxScore).to.equal(null);
        }
    });

    function configured(kind: 'homework' | 'paper' | 'contest', rule = kind === 'paper' ? 'exam' : kind) {
        const tdoc = contestDoc({ rule, beginAt: at('08:00:00'), endAt: at('20:00:00'), duration: 8 });
        tdoc.setConfig = createDraftConfig(kind === 'paper' ? 'exam' : kind);
        return tdoc;
    }

    it('groups a new mixed contest by PTA kinds and accepts a migrated contest as an exam', () => {
        const { ws } = built({ kind: 'contest', tdoc: configured('contest'), problems: [problem(1, 'single', '选择', 5), problem(2, 'programming', '代码', 10)] });
        expect(ws.numbering).to.equal('pta');
        expect(ws.groups.map((group) => group.kind)).to.deep.equal(['single', 'programming']);
        expect(ws.info[0]).to.deep.equal({ label: '类型', text: '比赛' });
        const migrated = built({ kind: 'paper', tdoc: configured('paper', 'acm') }).ws;
        expect(migrated.flavor).to.equal('paper');
        expect(migrated.info[0]).to.deep.equal({ label: '类型', text: '考试' });
    });

    it('uses official round times and configured early hand-in for every purpose', () => {
        for (const kind of ['homework', 'paper', 'contest'] as const) {
            const tdoc = configured(kind);
            tdoc.setConfig.settings.personalLimit = { hours: 1, requireFullWindow: false };
            tdoc.setConfig.settings.earlyHandIn = true;
            const round = { id: 'round-2', roundNo: 2, startedAt: at('09:30:00'), closedAt: null };
            const value = input({ kind, tdoc, officialRound: round, tsdoc: { attend: 1, startAt: at('08:00:00') }, urls: urls({ start: '/round/start', finalize: '/round/hand-in' }) });
            const ws = buildSetWorkspace(value);
            expect(ws.phase).to.equal('answering');
            expect(ws.window.durationMinutes).to.equal(60);
            expect(ws.window.personalEndAt).to.equal(at('10:30:00').toISOString());
            expect(ws.action.canFinalize).to.equal(true);
            tdoc.setConfig.settings.earlyHandIn = false;
            expect(buildSetWorkspace(value).action.canFinalize).to.equal(false);
            expect(buildSetWorkspace({ ...value, officialRound: null }).phase).to.equal('ready');
            expect(buildSetWorkspace({ ...value, officialRound: { ...round, closedAt: at('09:55:00') }, canRetakeRound: true }).action.canRetake).to.equal(true);
        }
    });

    it('requires invitation exchange before starting or retaking a configured round', () => {
        const value = input({
            tdoc: configured('homework'), invitationRequired: true, officialRound: null,
            canRetakeRound: true, canAttend: false, urls: urls({ start: '/round/start', attend: '/contest/invite' }),
        });
        const ws = buildSetWorkspace(value);
        expect(ws.action).to.include({ invitationRequired: true, canAttend: true, canStart: false, canRetake: false });
        expect(buildSetWorkspace({ ...value, invitationRequired: false }).action.canStart).to.equal(true);
    });

    it('lets only the captain mutate the shared team round', () => {
        const value = input({ kind: 'contest', tdoc: configured('contest'), team: { teamName: '队伍', role: 'member' }, canRetakeRound: true, urls: urls({ start: '/round/start', finalize: '/round/hand-in' }) });
        expect(buildSetWorkspace(value).action).to.include({ canStart: false, canRetake: false, canFinalize: false, canSubmit: false });
        expect(buildSetWorkspace({ ...value, officialRound: { id: 'r', roundNo: 1, startedAt: at('09:00:00'), closedAt: null } }).action).to.include({ canFinalize: false, canSubmit: false });
    });

    it('takes selected-round totals and filters per-channel results instead of legacy journal scoring', () => {
        const tdoc = configured('paper');
        tdoc.setConfig.settings.feedback.objective = { when: 'immediate', reveal: 'score' };
        tdoc.setConfig.settings.feedback.code = { when: 'after_deadline', reveal: 'full', afterDeadline: 'same' };
        const { ws } = built({
            kind: 'paper', tdoc, officialRound: { id: 'r', roundNo: 2, startedAt: at('09:30:00'), closedAt: null },
            officialResult: { score: 40, accepted: null, showScore: true },
            problems: [problem(1, 'single', '选择', 5), problem(2, 'programming', '代码', 10)],
            drafts: new Map([[1, draft({ answers: { main: 'A' }, submittedAnswers: { main: 'A' }, version: 2, score: 5, judgeResult: { main: 'correct' } })]]),
            journal: new Map([[2, { submits: 1, lastStatus: STATUS.STATUS_ACCEPTED, lastScore: 10 }]]),
        });
        expect(ws.totals.score).to.equal(40);
        expect(ws.groups[0].items[0]).to.include({ state: 'submitted', lastScore: 5 });
        expect(ws.groups[1].items[0]).to.include({ state: 'submitted', lastScore: null });
        expect(ws.groups[1].items[0].feedback).to.deep.equal({ score: false, verdict: false, details: false });
        expect(ws.paper).to.equal(null);
    });
});
