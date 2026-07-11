import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect } from 'chai';
import { describe, it } from 'node:test';
import {
    buildStudentsMongoFilter,
    listStudentsFromCollection,
    parseShanghaiNaturalDate,
    parseStudentFilterQuery,
} from '../src/student-filter';

function loadStudentFilterHttpAdapter() {
    const Module = require('module');
    const framework = require('../../../framework/framework');
    const originalLoad = Module._load;
    Module._load = function load(request: string, parent: unknown, isMain: boolean) {
        if (request === 'hydrooj') return { BadRequestError: framework.BadRequestError };
        return originalLoad.call(this, request, parent, isMain);
    };
    try {
        const modulePath = require.resolve('../src/student-filter-http');
        delete require.cache[modulePath];
        return require(modulePath);
    } finally {
        Module._load = originalLoad;
    }
}

describe('P2.9 student filter query parsing', () => {
    it('parses a leap-day range as Asia/Shanghai inclusive-from/exclusive-to UTC dates', () => {
        const parsed = parseStudentFilterQuery({
            enrollmentYear: '2024',
            bindingStatus: 'bound',
            timeField: 'createdAt',
            from: '2024-02-29',
            to: '2024-02-29',
        });

        expect(parsed.enrollmentYear).to.equal(2024);
        expect(parsed.bindingStatus).to.equal('bound');
        expect(parsed.timeField).to.equal('createdAt');
        expect(parsed.from?.toISOString()).to.equal('2024-02-28T16:00:00.000Z');
        expect(parsed.to?.toISOString()).to.equal('2024-02-29T16:00:00.000Z');
        expect(parsed.values).to.deep.equal({
            enrollmentYear: '2024',
            bindingStatus: 'bound',
            timeField: 'createdAt',
            from: '2024-02-29',
            to: '2024-02-29',
        });
    });

    it('defaults status/time field and accepts empty optional values', () => {
        const parsed = parseStudentFilterQuery({});
        expect(parsed).to.deep.include({
            bindingStatus: 'all',
            timeField: 'boundAt',
        });
        expect(parsed.enrollmentYear).to.equal(undefined);
        expect(parsed.from).to.equal(undefined);
        expect(parsed.to).to.equal(undefined);
    });

    it('rejects invalid years, enums, dates, and reversed date ranges', () => {
        for (const input of [
            { enrollmentYear: '2024x' },
            { enrollmentYear: '1899' },
            { enrollmentYear: '2100' },
            { bindingStatus: 'maybe' },
            { timeField: 'updatedAt' },
            { from: '2023-02-29' },
            { from: '2024-2-09' },
            { to: '2024-04-31' },
            { from: '2024-03-02', to: '2024-03-01' },
        ]) {
            expect(() => parseStudentFilterQuery(input)).to.throw();
        }
    });

    it('validates natural dates before converting boundaries', () => {
        expect(parseShanghaiNaturalDate('2000-02-29', 'from').toISOString())
            .to.equal('2000-02-28T16:00:00.000Z');
        expect(() => parseShanghaiNaturalDate('1900-02-29', 'from')).to.throw();
        expect(() => parseShanghaiNaturalDate('2024-00-10', 'to')).to.throw();
    });
});

describe('P2.9 HTTP filter validation adapter', () => {
    it('maps production parser failures to a BadRequestError with code 400', () => {
        const { parseAdminStudentFilters } = loadStudentFilterHttpAdapter();
        let thrown: any;
        try {
            parseAdminStudentFilters({ enrollmentYear: '2024x' });
        } catch (error) {
            thrown = error;
        }
        expect(thrown).to.be.instanceOf(Error);
        expect(thrown.name).to.equal('BadRequestError');
        expect(thrown.code).to.equal(400);
        expect(thrown.params).to.deep.equal([
            'enrollmentYear',
            null,
            '入学年必须是 1900–2099 的四位十进制年份',
        ]);
    });
});

describe('P2.9 Mongo filter construction', () => {
    it('combines school/group/query/year/status/time filters in one Mongo filter', () => {
        const schoolId = { _id: 'school' } as any;
        const groupId = { _id: 'group' } as any;
        const from = new Date('2024-01-01T16:00:00.000Z');
        const to = new Date('2024-02-01T16:00:00.000Z');
        const filter = buildStudentsMongoFilter('system', {
            schoolId,
            groupId,
            query: 'A. [B] (C)+?',
            enrollmentYear: 2024,
            bindingStatus: 'bound',
            timeField: 'createdAt',
            from,
            to,
        }) as any;

        expect(filter.domainId).to.equal('system');
        expect(filter.schoolId).to.equal(schoolId);
        expect(filter.groupIds).to.equal(groupId);
        expect(filter.enrollmentYear).to.equal(2024);
        expect(filter.boundUserId).to.deep.equal({ $gt: 0 });
        expect(filter.createdAt).to.deep.equal({ $gte: from, $lt: to });
        expect(filter.$or).to.deep.equal([
            { studentId: { $regex: 'A\\. \\[B\\] \\(C\\)\\+\\?', $options: 'i' } },
            { realName: { $regex: 'A\\. \\[B\\] \\(C\\)\\+\\?', $options: 'i' } },
        ]);
    });

    it('uses boundUserId as authority and Mongo null equality for missing/unbound records', () => {
        expect((buildStudentsMongoFilter('system', { bindingStatus: 'bound' }) as any).boundUserId)
            .to.deep.equal({ $gt: 0 });
        expect((buildStudentsMongoFilter('system', { bindingStatus: 'unbound' }) as any).boundUserId)
            .to.equal(null);
        expect((buildStudentsMongoFilter('system', { boundOnly: true }) as any).boundUserId)
            .to.deep.equal({ $gt: 0 });
        expect((buildStudentsMongoFilter('system', { unboundOnly: true }) as any).boundUserId)
            .to.equal(null);
    });

    it('keeps boundAt+unbound intact so a date range naturally matches nothing', () => {
        const filter = buildStudentsMongoFilter('system', {
            bindingStatus: 'unbound',
            timeField: 'boundAt',
            from: new Date('2024-01-01T16:00:00.000Z'),
        }) as any;
        expect(filter.boundUserId).to.equal(null);
        expect(filter.boundAt).to.deep.equal({ $gte: new Date('2024-01-01T16:00:00.000Z') });
        expect(filter.createdAt).to.equal(undefined);
    });

    it('fails fast on contradictory legacy/new binding flags', () => {
        expect(() => buildStudentsMongoFilter('system', { boundOnly: true, unboundOnly: true })).to.throw();
        expect(() => buildStudentsMongoFilter('system', {
            boundOnly: true,
            bindingStatus: 'unbound',
        })).to.throw();
        expect(() => buildStudentsMongoFilter('system', {
            unboundOnly: true,
            bindingStatus: 'bound',
        })).to.throw();
    });
});

describe('P2.9 listStudents DB boundary', () => {
    it('passes the exact same composed filter to countDocuments and find', async () => {
        let countFilter: unknown;
        let findFilter: unknown;
        const collection = {
            countDocuments: async (filter: unknown) => {
                countFilter = filter;
                return 0;
            },
            find: (filter: unknown) => {
                findFilter = filter;
                const cursor: any = {
                    sort: () => cursor,
                    skip: () => cursor,
                    limit: () => cursor,
                    toArray: async () => [],
                };
                return cursor;
            },
        };

        await listStudentsFromCollection(collection, 'system', {
            query: '.*',
            enrollmentYear: 2024,
            bindingStatus: 'bound',
            timeField: 'createdAt',
            from: new Date('2024-01-01T16:00:00.000Z'),
            to: new Date('2025-01-01T16:00:00.000Z'),
            limit: 50,
            skip: 50,
        });

        expect(countFilter).to.equal(findFilter);
        expect(countFilter).to.deep.include({
            domainId: 'system',
            enrollmentYear: 2024,
            boundUserId: { $gt: 0 },
        });
    });
});

describe('P2.9 UI and index source contracts', () => {
    const uiSource = readFileSync(
        resolve(process.cwd(), 'packages/ui-next/src/pages/userbind/index.tsx'),
        'utf8',
    );
    const dbSource = readFileSync(
        resolve(process.cwd(), 'packages/krypton-userbind/src/db.ts'),
        'utf8',
    );

    it('uses one shared StudentFilterBar on both admin student lists', () => {
        expect(uiSource.match(/<StudentFilterBar\b/g)).to.have.lengthOf(2);
        expect(uiSource).to.include('function StudentFilterBar');
        expect(uiSource).to.include('未绑定记录没有绑定时间');
        expect(uiSource).to.include('建档时间');
        expect(uiSource).to.include('绑定时间');
    });

    it('persists every filter in pagination URLs and keeps the school students tab on clear', () => {
        for (const key of ['q', 'enrollmentYear', 'bindingStatus', 'timeField', 'from', 'to']) {
            expect(uiSource).to.include(`params.set('${key}'`);
        }
        expect(uiSource).to.match(
            /clearHref=\{`\/admin\/userbind\/schools\/\$\{data\.school\._id\}\?tab=students`\}/,
        );
    });

    it('declares four ordinary compound indexes without partialFilterExpression', () => {
        expect(dbSource).not.to.include('partialFilterExpression');
        expect(dbSource.match(/enrollmentYear: 1, boundUserId: 1, createdAt: -1/g)).to.have.lengthOf(2);
        expect(dbSource.match(/enrollmentYear: 1, boundUserId: 1, boundAt: -1/g)).to.have.lengthOf(2);
    });
});
