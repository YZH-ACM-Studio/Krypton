import { expect } from 'chai';
import { describe, it } from 'node:test';
import { createDraftConfig, parseSetConfig } from '../set-config';
import { buildDraftFields, copyConfigAsDraft, normalizeSetTitle, publishedSetConfig } from '../set-lifecycle';

function codeOf(run: () => void): string {
    try {
        run();
    } catch (error) {
        if (error instanceof TypeError) return error.message;
        throw error;
    }
    throw new Error('expected a TypeError');
}

describe('problem set lifecycle', () => {
    it('creates a draft from a title and purpose only', () => {
        const fields = buildDraftFields('exam', '  期中考试  ');
        expect(fields.title).to.equal('期中考试');
        expect(fields.rule).to.equal('exam');
        expect(fields.pids).to.deep.equal([]);
        expect(fields.setConfig.publication).to.equal('draft');
        expect(fields.setConfig.settings.earlyHandIn).to.equal(true);
        expect(fields).to.not.have.property('beginAt');
        expect(fields).to.not.have.property('endAt');
        expect(buildDraftFields('contest', '校赛').rule).to.equal('contest');
        expect(buildDraftFields('contest', '校赛').setConfig.settings.codePolicy).to.equal('highest');
        expect(codeOf(() => normalizeSetTitle('   '))).to.equal('set_title_invalid');
        expect(codeOf(() => normalizeSetTitle('x'.repeat(65)))).to.equal('set_title_invalid');
    });

    it('hides drafts from students and does not invent a configuration', () => {
        const draft = buildDraftFields('homework', '作业一');
        expect(publishedSetConfig(draft)).to.equal(null);
        const published = parseSetConfig({ ...draft.setConfig, publication: 'published' });
        expect(publishedSetConfig({ setConfig: published })?.publication).to.equal('published');
        expect(codeOf(() => publishedSetConfig({ rule: 'homework', title: '作业一' }))).to.equal('set_config_missing');
    });

    it('copies settings into a new draft without keeping the published state', () => {
        const source = parseSetConfig({
            ...createDraftConfig('homework'),
            publication: 'published',
            revision: 4,
            settings: { ...createDraftConfig('homework').settings, codePolicy: 'acm' },
        });
        const copy = copyConfigAsDraft(source);
        expect(copy.publication).to.equal('draft');
        expect(copy.revision).to.equal(1);
        expect(copy.purpose).to.equal('homework');
        expect(copy.settings.codePolicy).to.equal('acm');
        expect(copy.settings).to.not.equal(source.settings);
    });
});
