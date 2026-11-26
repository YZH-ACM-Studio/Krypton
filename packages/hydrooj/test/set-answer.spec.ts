import { describe, it } from 'node:test';
import { expect } from 'chai';
import { ObjectId } from 'mongodb';
import { parseRoundTid, parseSaveBody } from '../src/lib/set-answer-request';

describe('problem set answer request', () => {
    it('accepts a versioned save bound to one round and question kind', () => {
        const tid = new ObjectId().toHexString();
        const roundId = new ObjectId().toHexString();
        const parsed = parseSaveBody({
            domainId: 'system',
            tid,
            roundId,
            kind: 'single',
            operationId: 'save-0001',
            items: [{ pid: 3, body: { q1: 'A' }, baseVersion: 0 }],
        });
        expect(parsed.operationId).to.equal('save-0001');
        expect(parsed.items).to.deep.equal([{ pid: 3, body: { q1: 'A' }, baseVersion: 0 }]);
        expect(parsed.roundId.toHexString()).to.equal(roundId);
        expect(parsed.kind).to.equal('single');
        expect(parseRoundTid({ tid }).toHexString()).to.equal(tid);
    });

    it('rejects a stale-looking duplicate and an unknown field', () => {
        expect(() => parseSaveBody({
            operationId: 'save-0001',
            items: [{ pid: 3, body: 'A', baseVersion: 0 }, { pid: 3, body: 'B', baseVersion: 0 }],
        })).to.throw();
        expect(() => parseSaveBody({ operationId: 'save-0001', items: [], extra: true })).to.throw();
    });

    it('rejects forged scores, malformed answer values and missing round identity', () => {
        const valid = { roundId: new ObjectId().toHexString(), kind: 'single', operationId: 'save-0001',
            items: [{ pid: 3, body: { q1: 'A' }, baseVersion: 0 }] };
        expect(() => parseSaveBody({ ...valid, items: [{ ...valid.items[0], rawScore: 100 }] })).to.throw();
        expect(() => parseSaveBody({ ...valid, items: [{ ...valid.items[0], body: { q1: { score: 100 } } }] })).to.throw();
        expect(() => parseSaveBody({ ...valid, roundId: undefined })).to.throw();
        expect(() => parseSaveBody({ ...valid, kind: 'invented' })).to.throw();
    });
});
