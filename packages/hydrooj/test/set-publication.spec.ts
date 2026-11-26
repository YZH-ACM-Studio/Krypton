import { describe, it } from 'node:test';
import { expect } from 'chai';
import { ObjectId } from 'mongodb';
import { createDraftConfig, parseSetConfig } from '@hydrooj/common';

import { requirePublishedForStudent } from '../src/lib/set-publication';

const tid = new ObjectId('aaaaaaaaaaaaaaaaaaaaaaaa');

function doc(publication: 'draft' | 'published' | 'missing') {
    const setConfig = publication === 'missing' ? undefined : parseSetConfig({ ...createDraftConfig('homework'), publication });
    return {
        domainId: 'system',
        docId: tid,
        rule: 'homework',
        ...(setConfig ? { setConfig } : {}),
    } as unknown as Parameters<typeof requirePublishedForStudent>[0];
}

describe('student publication gate', () => {
    it('hides a draft from a student and lets a manager open it', () => {
        expect(() => requirePublishedForStudent(doc('draft'), false)).to.throw();
        expect(() => requirePublishedForStudent(doc('draft'), true)).not.to.throw();
        expect(() => requirePublishedForStudent(doc('published'), false)).not.to.throw();
    });

    it('leaves legacy containers to their existing access gates without writing a config', () => {
        const legacy = doc('missing');
        expect(() => requirePublishedForStudent(legacy, false)).not.to.throw();
        expect(legacy.setConfig).to.equal(undefined);
    });
});
