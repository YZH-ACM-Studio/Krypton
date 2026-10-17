import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'chai';
import { describe, it } from 'node:test';
import type { ProblemKind } from '../problem-kind';

// PLAN shows a static import. teach.ts does not exist yet, and a static import
// would fail this lane's tsc gate inside the test file. Load the module at runtime.
// These two lines match @hydrooj/register's CJS strip so __filename stays defined.
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const requireFromTest = createRequire(__filename);
const paperShellPath = resolve(__dirname, '../../ui-next/src/components/paper/paper-shell.tsx');

type TeachType = 'practice' | 'homework' | 'exam' | 'acm' | 'oi';
type TeachDocKind = 'contest' | 'training';
type TeachStatus = 'upcoming' | 'running' | 'ended' | 'open';
type TeachTab = 'overview' | 'problems' | 'students' | 'settings' | 'grades' | 'records' | 'advanced';

interface TeachWindow {
    type: TeachType;
    beginAt?: Date | string | null;
    endAt?: Date | string | null;
}

interface TeachModule {
    TEACH_TYPES: readonly TeachType[];
    TEACH_TABS: readonly TeachTab[];
    TEACH_KIND_ORDER: readonly ProblemKind[];
    TEACH_ALLOWED_KINDS: Readonly<Record<TeachType, readonly ProblemKind[]>>;
    TEACH_SCORED_CONTEST_RULES: readonly string[];
    parseTeachType: (value: unknown) => TeachType;
    teachDocKind: (type: TeachType) => TeachDocKind;
    teachTypeOfContestRule: (rule: unknown) => TeachType;
    isTeachKindAllowed: (type: TeachType, kind: ProblemKind) => boolean;
    disallowedTeachKinds: (type: TeachType) => ProblemKind[];
    isTeachGroupedByKind: (type: TeachType) => boolean;
    teachTabsFor: (type: TeachType) => TeachTab[];
    parseTeachTab: (value: unknown, type: TeachType) => TeachTab;
    teachStatusOf: (input: TeachWindow, now: Date) => TeachStatus;
    teachPath: (type: TeachType, id: string, tab?: TeachTab) => string;
    teachComposePath: (type: TeachType, id: string) => string;
}

const TEACH_EXPORTS = [
    'TEACH_TYPES',
    'TEACH_TABS',
    'TEACH_KIND_ORDER',
    'TEACH_ALLOWED_KINDS',
    'TEACH_SCORED_CONTEST_RULES',
    'parseTeachType',
    'teachDocKind',
    'teachTypeOfContestRule',
    'isTeachKindAllowed',
    'disallowedTeachKinds',
    'isTeachGroupedByKind',
    'teachTabsFor',
    'parseTeachTab',
    'teachStatusOf',
    'teachPath',
    'teachComposePath',
] as const satisfies readonly (keyof TeachModule)[];

const KIND_ORDER = [
    'true_false',
    'single',
    'multi',
    'blank',
    'program_fill',
    'subjective',
    'function',
    'programming',
] as const satisfies readonly ProblemKind[];

const ALL_TABS = [
    'overview',
    'problems',
    'students',
    'settings',
    'grades',
    'records',
    'advanced',
] as const satisfies readonly TeachTab[];

const HOUR_MS = 60 * 60 * 1000;

// The paper shell spells one program-fill kind three ways, then drops submit_answer.
const PAPER_KIND_ALIAS: Record<string, string | null> = {
    fill_program: 'program_fill',
    program_fill_text: 'program_fill',
    program_fill_compile: 'program_fill',
    default: 'programming',
    submit_answer: null,
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function isTeachModule(value: unknown): value is TeachModule {
    if (!isRecord(value)) return false;
    return TEACH_EXPORTS.every((name) => value[name] !== undefined);
}

function loadTeach(): TeachModule {
    const loaded: unknown = requireFromTest('../teach');
    if (!isRecord(loaded)) throw new TypeError('teach module is missing');
    for (const name of TEACH_EXPORTS) {
        if (loaded[name] === undefined) throw new TypeError(`teach export missing: ${name}`);
    }
    if (!isTeachModule(loaded)) throw new TypeError('teach module is missing');
    return loaded;
}

function expectTypeError(run: () => void, message: string): void {
    let caught: unknown;
    try {
        run();
    } catch (error) {
        caught = error;
    }
    expect(caught instanceof TypeError).to.equal(true);
    if (!(caught instanceof TypeError)) return;
    expect(caught.message).to.equal(message);
}

function paperShellKindOrder(source: string): string[] {
    const block = source.match(/export const KIND_ORDER\b[^=]*=\s*\[([\s\S]*?)\];/);
    if (!block?.[1]) throw new Error('paper shell KIND_ORDER is missing');
    const names = [...block[1].matchAll(/['"]([^'"]+)['"]/g)].map((found) => found[1] ?? '');
    if (!names.includes('fill_program') || !names.includes('submit_answer')) {
        throw new Error('paper shell KIND_ORDER did not parse');
    }
    return names;
}

function canonicalPaperKinds(order: readonly string[]): string[] {
    const seen = new Set<string>();
    const kinds: string[] = [];
    for (const name of order) {
        const mapped = Object.hasOwn(PAPER_KIND_ALIAS, name) ? PAPER_KIND_ALIAS[name] : name;
        if (mapped === null || mapped === undefined || seen.has(mapped)) continue;
        seen.add(mapped);
        kinds.push(mapped);
    }
    return kinds;
}

describe('shared teach constants', () => {
    it('orders teach kinds the same way as the exam paper shell', () => {
        const teach = loadTeach();
        expect([...teach.TEACH_KIND_ORDER]).to.deep.equal([...KIND_ORDER]);
        expect(teach.TEACH_KIND_ORDER.length).to.equal(8);
        const shellOrder = paperShellKindOrder(readFileSync(paperShellPath, 'utf8'));
        expect(canonicalPaperKinds(shellOrder)).to.deep.equal([...teach.TEACH_KIND_ORDER]);
    });

    it('allows kinds by teach type in kind order', () => {
        const teach = loadTeach();
        const practice = KIND_ORDER.filter((kind) => kind !== 'subjective');
        const contestKinds = ['program_fill', 'function', 'programming'] as const;
        expect([...teach.TEACH_ALLOWED_KINDS.practice]).to.deep.equal([...practice]);
        expect(teach.TEACH_ALLOWED_KINDS.practice.includes('subjective')).to.equal(false);
        expect([...teach.TEACH_ALLOWED_KINDS.acm]).to.deep.equal([...contestKinds]);
        expect([...teach.TEACH_ALLOWED_KINDS.oi]).to.deep.equal([...contestKinds]);
        expect([...teach.TEACH_ALLOWED_KINDS.homework]).to.deep.equal([...teach.TEACH_KIND_ORDER]);
        expect([...teach.TEACH_ALLOWED_KINDS.exam]).to.deep.equal([...teach.TEACH_KIND_ORDER]);
        for (const type of teach.TEACH_TYPES) {
            const allowed = teach.TEACH_ALLOWED_KINDS[type];
            expect([...allowed]).to.deep.equal(KIND_ORDER.filter((kind) => allowed.includes(kind)));
            for (const kind of KIND_ORDER) {
                expect(teach.isTeachKindAllowed(type, kind)).to.equal(allowed.includes(kind));
            }
        }
    });

    it('maps contest rules onto teach types', () => {
        const teach = loadTeach();
        expect(teach.teachTypeOfContestRule('ioi')).to.equal('oi');
        expect(teach.teachTypeOfContestRule('strictioi')).to.equal('oi');
        expect(teach.teachTypeOfContestRule('ledo')).to.equal('oi');
        expect(teach.teachTypeOfContestRule('oi')).to.equal('oi');
        expect(teach.teachTypeOfContestRule('homework')).to.equal('homework');
        expect(teach.teachTypeOfContestRule('exam')).to.equal('exam');
        expect(teach.teachTypeOfContestRule('acm')).to.equal('acm');
        expectTypeError(() => teach.teachTypeOfContestRule('codeforces'), 'teach_rule_unsupported');
        expectTypeError(() => teach.teachTypeOfContestRule(null), 'teach_rule_unsupported');
    });

    it('rejects an unknown teach type', () => {
        const teach = loadTeach();
        expect([...teach.TEACH_TYPES]).to.deep.equal(['practice', 'homework', 'exam', 'acm', 'oi']);
        for (const type of teach.TEACH_TYPES) expect(teach.parseTeachType(type)).to.equal(type);
        expectTypeError(() => teach.parseTeachType('quiz'), 'teach_type_invalid');
        expectTypeError(() => teach.parseTeachType(null), 'teach_type_invalid');
    });

    it('derives status from the caller clock and the time window', () => {
        const teach = loadTeach();
        const now = new Date('2026-10-16T00:00:00.000Z');
        const at = (offset: number) => new Date(now.getTime() + offset);
        expect(teach.teachStatusOf({ type: 'practice' }, now)).to.equal('open');
        expect(teach.teachStatusOf({ type: 'practice', beginAt: null, endAt: 'not-a-date' }, now)).to.equal('open');
        expect(teach.teachStatusOf({
            type: 'practice',
            beginAt: at(HOUR_MS),
            endAt: at(2 * HOUR_MS),
        }, now)).to.equal('open');
        expect(teach.teachStatusOf({
            type: 'acm',
            beginAt: at(HOUR_MS),
            endAt: at(2 * HOUR_MS),
        }, now)).to.equal('upcoming');
        expect(teach.teachStatusOf({
            type: 'acm',
            beginAt: at(-HOUR_MS),
            endAt: at(HOUR_MS),
        }, now)).to.equal('running');
        expect(teach.teachStatusOf({
            type: 'acm',
            beginAt: at(-HOUR_MS),
            endAt: new Date(now.getTime()),
        }, now)).to.equal('ended');
        expect(teach.teachStatusOf({
            type: 'exam',
            beginAt: at(-2 * HOUR_MS),
            endAt: at(-HOUR_MS),
        }, now)).to.equal('ended');
        expect(teach.teachStatusOf({
            type: 'acm',
            beginAt: now.toISOString(),
            endAt: at(HOUR_MS).toISOString(),
        }, now)).to.equal('running');
        expectTypeError(
            () => teach.teachStatusOf({ type: 'exam', beginAt: null }, now),
            'teach_window_invalid',
        );
        expectTypeError(
            () => teach.teachStatusOf({ type: 'exam', beginAt: now, endAt: null }, now),
            'teach_window_invalid',
        );
        expectTypeError(
            () => teach.teachStatusOf({ type: 'homework', beginAt: 'not-a-date', endAt: at(HOUR_MS) }, now),
            'teach_window_invalid',
        );
        expectTypeError(
            () => teach.teachStatusOf({
                type: 'oi',
                beginAt: new Date(Number.NaN),
                endAt: at(HOUR_MS),
            }, now),
            'teach_window_invalid',
        );
    });

    it('drops the records tab for practice and falls back to overview', () => {
        const teach = loadTeach();
        expect([...teach.TEACH_TABS]).to.deep.equal([...ALL_TABS]);
        expect(teach.teachTabsFor('practice').includes('records')).to.equal(false);
        expect(teach.teachTabsFor('practice')).to.deep.equal(ALL_TABS.filter((tab) => tab !== 'records'));
        for (const type of ['homework', 'exam', 'acm', 'oi'] as const) {
            expect(teach.teachTabsFor(type)).to.deep.equal([...ALL_TABS]);
        }
        expect(teach.parseTeachTab('records', 'practice')).to.equal('overview');
        expect(teach.parseTeachTab('grades', 'practice')).to.equal('grades');
        expect(teach.parseTeachTab('grades', 'acm')).to.equal('grades');
        expect(teach.parseTeachTab('records', 'homework')).to.equal('records');
        expect(teach.parseTeachTab('not-a-tab', 'exam')).to.equal('overview');
        expect(teach.parseTeachTab(null, 'acm')).to.equal('overview');
    });

    it('builds workbench and compose paths', () => {
        const teach = loadTeach();
        expect(teach.teachPath('exam', 'abc', 'overview')).to.equal('/teach/exam/abc');
        expect(teach.teachPath('exam', 'abc')).to.equal('/teach/exam/abc');
        expect(teach.teachPath('exam', 'abc', 'settings')).to.equal('/teach/exam/abc?tab=settings');
        expect(teach.teachPath('exam', 'abc', 'problems')).to.equal('/teach/exam/abc?tab=problems');
        expect(teach.teachComposePath('exam', 'abc')).to.equal('/teach/exam/abc/compose');
    });

    it('lists disallowed kinds in kind order', () => {
        const teach = loadTeach();
        expect(teach.disallowedTeachKinds('acm')).to.deep.equal([
            'true_false',
            'single',
            'multi',
            'blank',
            'subjective',
        ]);
        expect(teach.disallowedTeachKinds('oi')).to.deep.equal([
            'true_false',
            'single',
            'multi',
            'blank',
            'subjective',
        ]);
        expect(teach.disallowedTeachKinds('practice')).to.deep.equal(['subjective']);
        expect(teach.disallowedTeachKinds('homework')).to.deep.equal([]);
        expect(teach.disallowedTeachKinds('exam')).to.deep.equal([]);
    });

    it('classifies documents, grouping, and scored contest rules', () => {
        const teach = loadTeach();
        expect(teach.teachDocKind('practice')).to.equal('training');
        for (const type of ['homework', 'exam', 'acm', 'oi'] as const) {
            expect(teach.teachDocKind(type)).to.equal('contest');
        }
        expect(teach.isTeachGroupedByKind('homework')).to.equal(true);
        expect(teach.isTeachGroupedByKind('exam')).to.equal(true);
        expect(teach.isTeachGroupedByKind('practice')).to.equal(false);
        expect(teach.isTeachGroupedByKind('acm')).to.equal(false);
        expect(teach.isTeachGroupedByKind('oi')).to.equal(false);
        expect([...teach.TEACH_SCORED_CONTEST_RULES]).to.deep.equal(['exam', 'oi', 'ioi', 'strictioi']);
    });

    it('re-exports the teach contract from the package entry', () => {
        const teach = loadTeach();
        const loaded: unknown = requireFromTest('../index');
        expect(isRecord(loaded)).to.equal(true);
        if (!isRecord(loaded)) return;
        for (const name of TEACH_EXPORTS) {
            expect(loaded[name], name).to.equal(teach[name]);
        }
    });
});
