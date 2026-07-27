import { expect } from 'chai';
import { describe, it } from 'node:test';
import { parseConfig } from '../src/lib/testdataConfig';

describe('problem detail testcase count', () => {
    it('stays zero when files exist but no testcase can be resolved', async () => {
        const config = 'time: 1s\nmemory: 256m\n';

        expect((await parseConfig(config, [])).count).to.equal(0);
        expect((await parseConfig(config, ['config.yaml'])).count).to.equal(0);
        expect((await parseConfig(config, ['config.yaml', 'checker.cc', 'generator.cc'])).count).to.equal(0);
    });

    it('counts explicit and conventionally paired testcases', async () => {
        const explicit = 'cases:\n  - input: 1.in\n    output: 1.out\n';

        expect((await parseConfig(explicit, ['config.yaml', '1.in', '1.out'])).count).to.equal(1);
        expect((await parseConfig({}, ['1.in', '1.out'])).count).to.equal(1);
    });

    it('keeps remote-judge type distinct from local testcase availability', async () => {
        const parsed = await parseConfig('type: remote_judge\nsubType: luogu\n', []);

        expect(parsed.type).to.equal('remote_judge');
        expect(parsed.count).to.equal(0);
    });

    it('reports the actual configured maximum score', async () => {
        const parsed = await parseConfig(
            [
                'subtasks:',
                '  - score: 5',
                '    cases:',
                '      - input: 1.in',
                '        output: 1.out',
                '  - score: 10',
                '    cases:',
                '      - input: 2.in',
                '        output: 2.out',
            ].join('\n'),
            ['1.in', '1.out', '2.in', '2.out'],
        );

        expect(parsed.maxScore).to.equal(15);
    });
});
