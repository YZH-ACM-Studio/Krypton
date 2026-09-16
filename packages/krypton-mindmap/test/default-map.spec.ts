import { expect } from 'chai';
import { describe, it } from 'node:test';
import { ALGORITHM_KNOWLEDGE_MAP_TITLE, pickDefaultKnowledgeMap } from '../src/default-map';

describe('pickDefaultKnowledgeMap', () => {
    it('prefers the unique isDefault map over title sort', () => {
        const maps = [
            { title: '学校安全' },
            { title: ALGORITHM_KNOWLEDGE_MAP_TITLE },
            { title: '操作系统', isDefault: true },
        ];
        expect(pickDefaultKnowledgeMap(maps)?.title).to.equal('操作系统');
    });

    it('falls back to the seeded algorithm map instead of the first title-sorted map', () => {
        const maps = [
            { title: '学校安全' },
            { title: '操作系统' },
            { title: ALGORITHM_KNOWLEDGE_MAP_TITLE },
        ];
        expect(pickDefaultKnowledgeMap(maps)?.title).to.equal(ALGORITHM_KNOWLEDGE_MAP_TITLE);
    });

    it('fails closed when more than one map is flagged default', () => {
        expect(() => pickDefaultKnowledgeMap([
            { title: 'A', isDefault: true },
            { title: 'B', isDefault: true },
        ])).to.throw(/multiple default knowledge maps/);
    });
});
