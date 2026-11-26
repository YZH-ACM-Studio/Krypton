import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { expect } from 'chai';
import { describe, it } from 'node:test';
import type { ProblemKind } from '../problem-kind';

// pta.ts is not in the tree yet. A static import would fail this lane's tsc
// gate inside the test file, so load the module at runtime.
const __filename = fileURLToPath(import.meta.url);
const requireFromTest = createRequire(__filename);

interface PtaItem {
    pid: number;
    kind: ProblemKind;
}

interface PtaGroup<T extends PtaItem> {
    kind: ProblemKind;
    no: number;
    items: T[];
}

interface PtaModule {
    PTA_KIND_ORDER: readonly ProblemKind[];
    ptaNo: (kind: ProblemKind) => number;
    ptaKindName: (kind: ProblemKind) => string;
    ptaLabel: (kind: ProblemKind, indexInKind: number) => string;
    letterLabel: (index: number) => string;
    isOnePerPageKind: (kind: ProblemKind) => boolean;
    groupByPta: <T extends PtaItem>(items: readonly T[]) => PtaGroup<T>[];
}

const PTA_EXPORTS = [
    'PTA_KIND_ORDER',
    'ptaNo',
    'ptaKindName',
    'ptaLabel',
    'letterLabel',
    'isOnePerPageKind',
    'groupByPta',
] as const satisfies readonly (keyof PtaModule)[];

const PTA_ORDER = [
    'true_false',
    'single',
    'multi',
    'blank',
    'program_fill',
    'function',
    'programming',
    'subjective',
] as const satisfies readonly ProblemKind[];

const KIND_NAMES: Readonly<Record<ProblemKind, string>> = {
    true_false: '判断题',
    single: '单选题',
    multi: '多选题',
    blank: '填空题',
    program_fill: '程序填空题',
    function: '函数题',
    programming: '编程题',
    subjective: '主观题',
};

const ONE_PER_PAGE: readonly ProblemKind[] = ['program_fill', 'function', 'programming'];

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function isPtaModule(value: unknown): value is PtaModule {
    if (!isRecord(value)) return false;
    return PTA_EXPORTS.every((name) => value[name] !== undefined);
}

function loadPta(): PtaModule {
    const loaded: unknown = requireFromTest('../pta');
    if (!isRecord(loaded)) throw new TypeError('pta module is missing');
    for (const name of PTA_EXPORTS) {
        if (loaded[name] === undefined) throw new TypeError(`pta export missing: ${name}`);
    }
    if (!isPtaModule(loaded)) throw new TypeError('pta module is missing');
    return loaded;
}

describe('pta numbering', () => {
    it('numbers kinds from 1 and rejects an unknown kind', () => {
        const pta = loadPta();
        expect([...pta.PTA_KIND_ORDER]).to.deep.equal([...PTA_ORDER]);
        expect(pta.ptaNo('true_false')).to.equal(1);
        expect(pta.ptaNo('subjective')).to.equal(8);
        for (const [index, kind] of PTA_ORDER.entries()) {
            expect(pta.ptaNo(kind)).to.equal(index + 1);
        }
        expect(() => pta.ptaNo('xx' as ProblemKind)).to.throw(TypeError);
    });

    it('builds a kind label from a zero-based index and rejects a bad index', () => {
        const pta = loadPta();
        expect(pta.ptaLabel('function', 0)).to.equal('6-1');
        expect(pta.ptaLabel('single', 2)).to.equal('2-3');
        expect(() => pta.ptaLabel('single', -1)).to.throw(TypeError);
        expect(() => pta.ptaLabel('single', 1.5)).to.throw(TypeError);
    });

    it('labels contest problems with spreadsheet letters', () => {
        const pta = loadPta();
        expect(pta.letterLabel(0)).to.equal('A');
        expect(pta.letterLabel(25)).to.equal('Z');
        expect(pta.letterLabel(26)).to.equal('AA');
        expect(pta.letterLabel(27)).to.equal('AB');
    });

    it('names each kind and marks program kinds as one per page', () => {
        const pta = loadPta();
        for (const kind of PTA_ORDER) {
            expect(pta.ptaKindName(kind)).to.equal(KIND_NAMES[kind]);
            expect(pta.isOnePerPageKind(kind)).to.equal(ONE_PER_PAGE.includes(kind));
        }
    });

    it('groups items by pta kind order and keeps input order inside a kind', () => {
        const pta = loadPta();
        const items = [
            { pid: 1, kind: 'programming' },
            { pid: 2, kind: 'true_false' },
            { pid: 3, kind: 'single' },
            { pid: 4, kind: 'true_false' },
        ] as const satisfies readonly PtaItem[];
        const groups = pta.groupByPta(items);
        expect(groups.map((group) => ({
            kind: group.kind,
            no: group.no,
            pids: group.items.map((item) => item.pid),
        }))).to.deep.equal([
            { kind: 'true_false', no: 1, pids: [2, 4] },
            { kind: 'single', no: 2, pids: [3] },
            { kind: 'programming', no: 7, pids: [1] },
        ]);
    });

    it('matches teach kind order and keeps acm programming kinds', () => {
        const pta = loadPta();
        const loaded: unknown = requireFromTest('../teach');
        expect(isRecord(loaded)).to.equal(true);
        if (!isRecord(loaded)) return;
        expect(loaded.TEACH_KIND_ORDER).to.deep.equal(pta.PTA_KIND_ORDER);
        const allowed = loaded.TEACH_ALLOWED_KINDS;
        expect(isRecord(allowed)).to.equal(true);
        if (!isRecord(allowed)) return;
        expect(allowed.acm).to.deep.equal(['program_fill', 'function', 'programming']);
    });

    it('re-exports the pta contract from the package entry', () => {
        const pta = loadPta();
        const loaded: unknown = requireFromTest('../index');
        expect(isRecord(loaded)).to.equal(true);
        if (!isRecord(loaded)) return;
        for (const name of PTA_EXPORTS) {
            expect(loaded[name], name).to.equal(pta[name]);
        }
    });
});
