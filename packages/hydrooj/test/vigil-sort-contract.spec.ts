import { expect } from 'chai';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('P5.1 Vigil card-wall sort contracts', () => {
    it('defaults to student id and persists every non-default sort in the URL', () => {
        const page = read('packages/ui-next/src/pages/vigil/index.tsx');

        expect(page).to.include("parseVigilSortKey(initialUrl.searchParams.get('sort'))");
        expect(page).to.include("if (sortKey !== 'student_id') url.searchParams.set('sort', sortKey)");
        expect(page).to.include('sort: sortKey');
    });

    it('keeps all five UI values aligned with the Vigil API contract', () => {
        const page = read('packages/ui-next/src/pages/vigil/index.tsx');
        const api = read('packages/ui-next/src/lib/vigil-api.ts');
        const values = ['status_priority', 'student_id', 'name', 'exam_time', 'event_count'];

        for (const value of values) {
            expect(page).to.include(`{ value: '${value}'`);
            expect(api).to.include(value);
        }
        expect(api).to.include('defaults to "student_id"');
    });
});
