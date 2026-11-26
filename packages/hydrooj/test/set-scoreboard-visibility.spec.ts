import { createDraftConfig, parseSetConfig, type SetScoreboard } from '@hydrooj/common';
import { Logger } from '@hydrooj/utils';
import { expect } from 'chai';
import { describe, it } from 'node:test';
import { Service } from 'cordis';
import { ValidationError } from '../src/error';

const RealDate = Date;
const logger = new Logger('set-scoreboard-visibility');

global.Hydro = {
    version: { node: process.version, hydrooj: 'test' },
    model: {} as unknown as typeof global.Hydro.model,
    script: {},
    module: new Proxy({} as Record<string, Record<string, unknown>>, {
        get(self, key: string) {
            self[key] ||= {};
            return self[key];
        },
    }) as unknown as typeof global.Hydro.module,
    ui: {} as unknown as typeof global.Hydro.ui,
    error: {} as unknown as typeof global.Hydro.error,
    Logger,
    logger,
    locales: {},
};

const { Context } = require('../src/context.ts') as typeof import('../src/context');

class FakeDb extends Service {
    constructor(ctx: ConstructorParameters<typeof Service>[0]) {
        super(ctx, 'db');
    }

    collection() {
        const cursor = {
            toArray: async () => [],
            sort() {
                return this;
            },
            limit() {
                return this;
            },
        };
        return {
            find: () => cursor,
            findOne: async () => null,
            countDocuments: async () => 0,
            updateOne: async () => ({}),
            createIndex: async () => '',
        };
    }
}

global.app = new Context();
const fakeDb = new FakeDb(global.app);
void fakeDb;

const contest = require('../src/model/contest.ts') as typeof import('../src/model/contest');

const beginAt = new RealDate('2026-11-10T08:00:00.000Z');
const endAt = new RealDate('2026-11-10T10:00:00.000Z');
const before = new RealDate('2026-11-10T07:59:59.000Z');
const during = new RealDate('2026-11-10T09:00:00.000Z');
const after = new RealDate('2026-11-10T10:00:01.000Z');

function withNow<T>(now: Date, run: () => T): T {
    // Date's construct signatures are overloads, so their parameter union cannot be spread.
    const DateFromArgs = RealDate as unknown as new (...values: unknown[]) => Date;
    class FrozenDate extends RealDate {
        constructor(...args: unknown[]) {
            const init: unknown[] = args.length === 0 ? [now.getTime()] : args;
            super(new DateFromArgs(...init).getTime());
        }

        static override now() {
            return now.getTime();
        }
    }
    global.Date = FrozenDate as unknown as DateConstructor;
    try {
        return run();
    } finally {
        global.Date = RealDate;
    }
}

function setDoc(scoreboard: SetScoreboard) {
    const draft = createDraftConfig('contest');
    return {
        rule: 'contest',
        beginAt,
        endAt,
        setConfig: parseSetConfig({
            ...draft,
            publication: 'published',
            settings: { ...draft.settings, scoreboard },
        }),
    };
}

function viewer(kind: 'student' | 'owner' | 'perm') {
    return {
        user: {
            own: () => kind === 'owner',
            hasPerm: () => kind === 'perm',
        },
    };
}

function visible(scoreboard: SetScoreboard, now: Date, kind: 'student' | 'owner' | 'perm' = 'student', allowPermOverride?: boolean) {
    return withNow(now, () => contest.canShowScoreboard.call(viewer(kind) as never, setDoc(scoreboard) as never, allowPermOverride));
}

describe('setConfig scoreboard visibility', () => {
    it('keeps an off scoreboard hidden from students and open for the hidden override', () => {
        expect(visible('off', before)).to.equal(false);
        expect(visible('off', during)).to.equal(false);
        expect(visible('off', endAt)).to.equal(false);
        expect(visible('off', after)).to.equal(false);
        expect(visible('off', during, 'owner')).to.equal(true);
        expect(visible('off', during, 'perm')).to.equal(true);
        expect(visible('off', during, 'owner', false)).to.equal(false);
        expect(visible('off', during, 'perm', false)).to.equal(false);
    });

    it('keeps a live scoreboard open after endAt', () => {
        expect(visible('live', before)).to.equal(false);
        expect(visible('live', beginAt)).to.equal(true);
        expect(visible('live', during)).to.equal(true);
        expect(visible('live', endAt)).to.equal(true);
        expect(visible('live', after)).to.equal(true);
        expect(visible('live', before, 'owner')).to.equal(true);
        expect(visible('live', after, 'perm')).to.equal(true);
        expect(visible('live', after, 'perm', false)).to.equal(true);
    });

    it('shows an after_end scoreboard only once endAt is reached, plus the hidden override', () => {
        expect(visible('after_end', before)).to.equal(false);
        expect(visible('after_end', beginAt)).to.equal(false);
        expect(visible('after_end', during)).to.equal(false);
        expect(visible('after_end', endAt)).to.equal(true);
        expect(visible('after_end', after)).to.equal(true);
        expect(visible('after_end', during, 'owner')).to.equal(true);
        expect(visible('after_end', before, 'perm', false)).to.equal(false);
    });

    it('shows a during_only scoreboard from beginAt until endAt, excluding the end instant', () => {
        expect(visible('during_only', before)).to.equal(false);
        expect(visible('during_only', beginAt)).to.equal(true);
        expect(visible('during_only', during)).to.equal(true);
        expect(visible('during_only', endAt)).to.equal(false);
        expect(visible('during_only', after)).to.equal(false);
        expect(visible('during_only', endAt, 'owner')).to.equal(true);
        expect(visible('during_only', after, 'perm', false)).to.equal(false);
    });

    it('rejects a missing scoreboard rule instead of reading RULES', () => {
        const tdoc = { rule: 'contest', beginAt, endAt };
        expect(() => contest.canShowScoreboard.call(viewer('student') as never, tdoc as never)).to.throw(ValidationError);
        try {
            contest.canShowScoreboard.call(viewer('student') as never, tdoc as never);
            expect.fail('missing rule should throw');
        } catch (error) {
            expect(error).to.be.instanceOf(ValidationError);
            expect((error as InstanceType<typeof ValidationError>).params).to.deep.equal(['rule']);
        }
    });

    it('keeps the legacy RULES path when setConfig is absent', () => {
        const tdoc = { rule: 'acm', beginAt, endAt };
        expect(withNow(before, () => contest.canShowScoreboard.call(viewer('student') as never, tdoc as never))).to.equal(false);
        expect(withNow(beginAt, () => contest.canShowScoreboard.call(viewer('student') as never, tdoc as never))).to.equal(false);
        expect(withNow(during, () => contest.canShowScoreboard.call(viewer('student') as never, tdoc as never))).to.equal(true);
        expect(withNow(after, () => contest.canShowScoreboard.call(viewer('student') as never, tdoc as never))).to.equal(true);
        expect(withNow(before, () => contest.canShowScoreboard.call(viewer('owner') as never, tdoc as never))).to.equal(true);
    });
});
