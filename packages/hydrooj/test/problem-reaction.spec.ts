import { expect } from 'chai';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { resolve } from 'node:path';
import {
    nextProblemReactionInc,
    parseProblemReactionInput,
    parseStoredProblemReactionChoice,
    parseStoredProblemReactions,
} from '../src/lib/problem-reaction';

function readSrc(relative: string) {
    return readFileSync(resolve(__dirname, '..', relative), 'utf8');
}

describe('programming problem reactions', () => {
    it('parses exclusive choices and treats missing counts as zero', () => {
        expect(parseProblemReactionInput('up')).to.equal('up');
        expect(parseProblemReactionInput('none')).to.equal(null);
        expect(parseProblemReactionInput('')).to.equal(null);
        expect(() => parseProblemReactionInput('star')).to.throw(/up, down, what/);
        expect(parseStoredProblemReactions(undefined)).to.deep.equal({ up: 0, down: 0, what: 0 });
        expect(parseStoredProblemReactions({ up: 2, what: 1 })).to.deep.equal({ up: 2, down: 0, what: 1 });
        expect(() => parseStoredProblemReactions({ up: 1, funny: 1 })).to.throw(/unknown fields/);
        expect(() => parseStoredProblemReactions({ up: -1 })).to.throw(/non-negative/);
        expect(parseStoredProblemReactionChoice(null)).to.equal(null);
        expect(() => parseStoredProblemReactionChoice('star')).to.throw(/invalid/);
    });

    it('computes count deltas for switch and cancel', () => {
        expect(nextProblemReactionInc(null, 'what')).to.deep.equal({ 'reactions.what': 1 });
        expect(nextProblemReactionInc('up', 'down')).to.deep.equal({ 'reactions.up': -1, 'reactions.down': 1 });
        expect(nextProblemReactionInc('what', null)).to.deep.equal({ 'reactions.what': -1 });
        expect(nextProblemReactionInc('up', 'up')).to.deep.equal({});
    });

    it('keeps reactions on ordinary programming detail and strips contest/exam paths', () => {
        const model = readSrc('src/model/problem.ts');
        expect(model).to.include("[...ProblemModel.PROJECTION_PUBLIC, 'reactions']");
        expect(model).to.include('static async setReaction');
        expect(model).to.include("static PROJECTION_PUBLIC: Field[] = [");
        expect(model).to.include("effectiveProblemKind(pdoc) !== 'programming'");
        const handler = readSrc('src/handler/problem.ts');
        expect(handler).to.include("'managedAuthoring', 'reactions'");
        expect(handler).to.include('delete this.pdoc.reactions');
        expect(handler).to.include("effectiveProblemKind(this.pdoc) === 'programming'");
        expect(handler).to.include('async postReaction');
        expect(handler).to.include('PRIV.PRIV_USER_PROFILE');
        expect(handler).to.include('this.tdoc || this.virtualAttempt || this.args.tid');
        const paper = readSrc('src/handler/paper.ts');
        expect(paper.match(/delete pdoc\.reactions/g)).to.have.length(2);
    });
});
