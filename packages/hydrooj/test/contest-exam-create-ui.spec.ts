import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import { expect } from 'chai';

const source = readFileSync(resolve(__dirname, '../src/handler/contest.ts'), 'utf8');

function extractNamed(text: string, marker: string) {
    const start = text.indexOf(marker);
    if (start < 0) throw new Error(`missing ${JSON.stringify(marker)}`);
    const brace = text.indexOf('{', start);
    if (brace < 0) throw new Error(`missing body for ${marker}`);
    let depth = 0;
    for (let i = brace; i < text.length; i++) {
        if (text[i] === '{') depth++;
        else if (text[i] === '}') {
            depth--;
            if (depth === 0) return text.slice(start, i + 1);
        }
    }
    throw new Error(`unclosed ${marker}`);
}

const editor = extractNamed(source, 'export class ContestEditHandler');
const get = extractNamed(editor, 'async get(');
const postUpdate = extractNamed(editor, 'async postUpdate(');

describe('contest exam create UI handler lock', () => {
    it('redirects create to contest_edit', () => {
        expect(postUpdate).to.include('const creatingContest = !tid');
        expect(postUpdate).to.include("this.url(creatingContest ? 'contest_edit' : 'contest_detail', { tid })");
    });

    it('does not write courseExam from postUpdate', () => {
        expect(postUpdate).not.to.match(/courseExam/);
    });

    it('builds endAt from duration hours', () => {
        expect(editor).to.include("@param('duration', Types.Float)");
        expect(postUpdate).to.include("const endAt = beginAtMoment.clone().add(duration, 'hours').toDate()");
        expect(postUpdate).not.to.include('.add(contestDuration');
    });

    it('persists contestDuration as tdoc.duration', () => {
        expect(editor).to.include("@param('contestDuration', Types.Float, true)");
        expect(postUpdate).to.include('duration: contestDuration');
        expect(postUpdate).to.match(/contest\.add\([\s\S]*duration:\s*contestDuration/);
        expect(postUpdate).to.match(/contest\.edit\([\s\S]*duration:\s*contestDuration/);
    });

    it('persists hidden on the second contest.edit', () => {
        expect(editor).to.include("@param('hidden', Types.Boolean)");
        expect(postUpdate).to.match(/contest\.edit\([\s\S]*hidden,/);
    });

    it('writes examShowVerdict only for exam', () => {
        expect(editor).to.include("@param('examShowVerdict', Types.Boolean, true)");
        expect(postUpdate).to.include("rule !== 'exam' && examShowVerdict !== undefined");
        expect(postUpdate).to.include('examShowVerdict: examShowVerdict !== false');
    });

    it('accepts empty exam description and empty paper pool on create', () => {
        expect(editor).to.include("@param('content', Types.Content, true)");
        expect(editor).to.include("@param('pids', Types.Content, true)");
        expect(postUpdate).to.include("content = content ?? ''");
        expect(postUpdate).to.match(/_pids\s*=\s*''/);
    });

    it('does not read query.rule on GET', () => {
        expect(get).to.match(/async get\(_domainId: string, tid: ObjectId\)/);
        expect(get).not.to.include('query.rule');
        expect(get).not.to.include('request.query');
    });
});
