import { beforeEach, describe, it } from 'node:test';
import { expect } from 'chai';
import { ObjectId } from 'mongodb';
import { assertSetPublishable, createDraftConfig } from '@hydrooj/common';
import type { Tdoc } from '../src/interface';

const Module = require('module');
const originalLoad = Module._load;
const problems = new Map<number, object>();
Module._load = function load(request: string, parent: NodeModule, main: boolean) {
    if (parent.filename.endsWith('/set-publish-facts.ts') && request === '../model/problem') {
        return { __esModule: true, default: { getList: async (domain: string, pids: number[]) => {
            expect(domain).to.equal('test');
            return Object.fromEntries(pids.map((pid) => {
                const doc = problems.get(pid);
                if (!doc) throw new Error('problem missing');
                return [pid, doc];
            }));
        } } };
    }
    return originalLoad.call(this, request, parent, main);
};
let loadFacts: typeof import('../src/lib/set-publish-facts').loadSetPublishFacts;
try {
    loadFacts = require('../src/lib/set-publish-facts.ts').loadSetPublishFacts;
} finally {
    Module._load = originalLoad;
}

let doc: Tdoc;
beforeEach(() => {
    problems.clear();
    problems.set(1, { problemKind: 'single', config: { maxScore: 100, type: 'objective' } });
    problems.set(2, { problemKind: 'programming', config: { maxScore: 100, type: 'default' } });
    doc = { domainId: 'test', docId: new ObjectId(), rule: 'contest', pids: [1, 2],
        score: { 1: 20, 2: 30 }, setAudienceConfirmed: true,
        beginAt: new Date('2026-11-10T00:00:00Z'), endAt: new Date('2026-11-10T02:00:00Z'),
        setConfig: createDraftConfig('contest') } as unknown as Tdoc;
});

describe('publication uses the actual paper and weights', () => {
    it('preserves a published legacy audience without backfilling its confirmation flag', async () => {
        delete doc.setAudienceConfirmed;
        doc.setConfig.publication = 'published';
        doc.participantScopeMode = 'schools';
        doc.participantSchoolIds = [new ObjectId()];
        const before = JSON.stringify(doc);
        const facts = await loadFacts(doc);
        expect(facts.audienceConfirmed).to.equal(false);
        expect(() => assertSetPublishable(doc.setConfig, facts)).not.to.throw();
        expect(JSON.stringify(doc)).to.equal(before);
        doc.setConfig.publication = 'draft';
        expect(() => assertSetPublishable(doc.setConfig, facts)).to.throw('set_config_audience_required');
    });

    it('accepts a reachable pass mark and rejects one above the actual maximum', async () => {
        doc.setConfig.settings.retake.passScore = 50;
        const facts = await loadFacts(doc);
        expect(facts.paperMax).to.equal(50);
        expect(() => assertSetPublishable(doc.setConfig, facts)).not.to.throw();
        doc.setConfig.settings.retake.passScore = 51;
        expect(() => assertSetPublishable(doc.setConfig, facts)).to.throw('set_config_pass_above_max');
    });
    it('uses a drawn paper maximum rather than summing the entire pool', async () => {
        problems.set(2, { problemKind: 'single', config: { maxScore: 100, type: 'objective' } });
        doc.score = { 1: 20, 2: 20 };
        doc.setConfig.settings.draw = { ...doc.setConfig.settings.draw, enabled: true, quotas: { single: 1 } };
        doc.setConfig.settings.retake.passScore = 20;
        const facts = await loadFacts(doc);
        expect(facts.paperMax).to.equal(20);
        expect(() => assertSetPublishable(doc.setConfig, facts)).not.to.throw();
        doc.score[2] = 30;
        const changed = await loadFacts(doc);
        expect(changed.paperMax).to.equal(null);
        expect(changed.paperRange).to.deep.equal({ min: 20, max: 30 });
        expect(() => assertSetPublishable(doc.setConfig, changed)).not.to.throw();
        doc.setConfig.settings.retake.passScore = 21;
        expect(() => assertSetPublishable(doc.setConfig, changed)).to.throw('set_config_pass_above_max');
    });
    it('counts ACM solved problems and rejects an objective problem in the paper', async () => {
        problems.set(1, { problemKind: 'program_fill', config: { maxScore: 100, type: 'program_fill', mode: 'compile' } });
        doc.setConfig.settings.codePolicy = 'acm';
        doc.setConfig.settings.retake.passScore = 2;
        const facts = await loadFacts(doc);
        expect(facts.paperMax).to.equal(2);
        expect(() => assertSetPublishable(doc.setConfig, facts)).not.to.throw();
        problems.set(1, { problemKind: 'program_fill', config: { maxScore: 100, type: 'program_fill', mode: 'text' } });
        const textPaper = await loadFacts(doc);
        expect(() => assertSetPublishable(doc.setConfig, textPaper)).to.throw('set_config_acm_kind');
    });
    it('rejects missing or structurally invalid pool problems', async () => {
        problems.delete(2);
        await expectFailure(() => loadFacts(doc));
        problems.set(2, { problemKind: 'program_fill', config: { maxScore: 100, type: 'program_fill' } });
        await expectFailure(() => loadFacts(doc));
    });
});

async function expectFailure(work: () => Promise<unknown>) {
    let error: unknown;
    try {
        await work();
    } catch (caught) {
        error = caught;
    }
    expect(error).to.be.instanceOf(Error);
}
