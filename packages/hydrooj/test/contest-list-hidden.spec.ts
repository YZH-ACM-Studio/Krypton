import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import { expect } from 'chai';
import { isListVisibleToUser, listAccessQuery } from '../src/lib/contest-list-access';

const handlerRoot = resolve(__dirname, '../src/handler');

describe('contest list hidden', () => {
    it('lets restricted browsers see everything', () => {
        expect(listAccessQuery(8, ['default'], true)).to.deep.equal({});
        expect(isListVisibleToUser({ owner: 1, hidden: true }, 8, ['default'], true)).to.equal(true);
    });

    it('lists missing hidden as public', () => {
        const query = listAccessQuery(8, ['default'], false);
        expect(query).to.deep.equal({
            $or: [
                { owner: 8 },
                { maintainer: 8 },
                {
                    hidden: { $ne: true },
                    $or: [{ assign: { $in: ['default'] } }, { assign: { $size: 0 } }],
                },
            ],
        });
        expect(isListVisibleToUser({ owner: 1, assign: [] }, 8, ['default'], false)).to.equal(true);
        expect(isListVisibleToUser({ owner: 1, hidden: false, assign: [] }, 8, ['default'], false)).to.equal(true);
    });

    it('hides hidden contests from students but keeps owner and maintainer', () => {
        expect(isListVisibleToUser({ owner: 1, hidden: true, assign: [] }, 8, ['default'], false)).to.equal(false);
        expect(isListVisibleToUser({ owner: 8, hidden: true, assign: [] }, 8, ['default'], false)).to.equal(true);
        expect(isListVisibleToUser({ owner: 1, maintainer: [8], hidden: true, assign: [] }, 8, ['default'], false)).to.equal(true);
    });

    it('still honors assign after a contest is listed', () => {
        expect(isListVisibleToUser({ owner: 1, assign: ['lab'] }, 8, ['default'], false)).to.equal(false);
        expect(isListVisibleToUser({ owner: 1, assign: ['default'] }, 8, ['default'], false)).to.equal(true);
        expect(isListVisibleToUser({ owner: 1, hidden: true, assign: ['default'] }, 8, ['default'], false)).to.equal(false);
    });

    it('wires list/home/problem-bank through the shared filter', () => {
        const contestHandler = readFileSync(resolve(handlerRoot, 'contest.ts'), 'utf8');
        const homeHandler = readFileSync(resolve(handlerRoot, 'home.ts'), 'utf8');
        const problemHandler = readFileSync(resolve(handlerRoot, 'problem.ts'), 'utf8');
        expect(contestHandler).to.include('contest.listAccessQuery(');
        expect(homeHandler).to.include('contest.listAccessQuery(');
        expect(problemHandler).to.include('contest.listAccessQuery(');
        expect(problemHandler).to.include('contest.isListVisibleToUser(');
        expect(contestHandler).to.include('hidden,');
        expect(contestHandler).not.to.include('hidden === true && this.response.redirect');
    });
});
