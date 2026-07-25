import { expect } from 'chai';
import { describe, it } from 'node:test';
import { processDocument } from '../document';

describe('elastic problem document indexing', () => {
    it('does not mutate the shared problem document while preparing search fields', () => {
        const pdoc = {
            domainId: 'system',
            docId: 3083,
            pid: 'OS1073',
            title: 'OS1073（操作系统测试）',
            content: '题面（草稿）',
            tag: ['课程'],
        } as any;
        const original = structuredClone(pdoc);

        const indexed = processDocument(pdoc);

        expect(indexed.pid).to.equal('OS1073 OS 1073');
        expect(indexed.title).to.equal('OS1073 OS 1073 操作系统测试 ');
        expect(indexed.content).to.equal('题面 草稿 ');
        expect(pdoc).to.deep.equal(original);
    });

    it('adds a hyphenated PID namespace only to the indexed copy', () => {
        const pdoc = {
            domainId: 'system',
            docId: 1,
            pid: 'HDU-1001',
            title: 'A+B',
            content: 'Statement',
            tag: ['source'],
        } as any;

        const indexed = processDocument(pdoc);

        expect(indexed.tag).to.deep.equal(['source', 'HDU']);
        expect(pdoc.tag).to.deep.equal(['source']);
        expect(pdoc.pid).to.equal('HDU-1001');
    });
});
