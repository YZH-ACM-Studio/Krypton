import { expect } from 'chai';
import { describe, it } from 'node:test';
import { distributePretestRecord, pretestActualOutput, selfTestVerdict } from '../src/lib/pretest-results.ts';

describe('Krypton IDE multi-case pretest results', () => {
  it('binds parallel case results to tabs by the judge case id, not completion order', () => {
    const results = distributePretestRecord(
      {
        status: 1,
        testCases: [
          { id: 2, status: 1, time: 2, memory: 20, message: 'second\n' },
          { id: 1, status: 1, time: 1, memory: 10, message: 'first\n' },
        ],
      },
      ['sample-1', 'sample-2'],
    );

    expect(pretestActualOutput(results.get('sample-1'))).to.equal('first\n');
    expect(pretestActualOutput(results.get('sample-2'))).to.equal('second\n');
    expect(results.get('sample-1')?.testCases?.[0]?.id).to.equal(1);
    expect(results.get('sample-2')?.testCases?.[0]?.id).to.equal(2);
  });

  it('keeps an early out-of-order result on its own tab while other cases are pending', () => {
    const results = distributePretestRecord(
      {
        status: 21,
        testCases: [{ id: 2, status: 1, time: 2, memory: 20, message: 'second\n' }],
      },
      ['sample-1', 'sample-2'],
    );

    expect(results.get('sample-1')?.status).to.equal(21);
    expect(results.get('sample-1')?.testCases).to.equal(undefined);
    expect(pretestActualOutput(results.get('sample-2'))).to.equal('second\n');
  });

  it('shows AC only after a successful run whose output matches this tab expectation', () => {
    const accepted = { status: 1, testCases: [{ id: 1, status: 1, time: 1, memory: 10, message: '42\n' }] };

    expect(selfTestVerdict(accepted, '42\n')).to.equal('ac');
    expect(selfTestVerdict(accepted, '41\n')).to.equal('wa');
    expect(selfTestVerdict(accepted, '')).to.equal('ran');
    expect(selfTestVerdict({ ...accepted, status: 7 }, '42\n')).to.equal('fail');
    expect(selfTestVerdict({ status: 21 }, '42\n')).to.equal('pending');
  });

  it('rejects malformed or incomplete final case sets instead of reusing another output', () => {
    expect(() =>
      distributePretestRecord(
        {
          status: 21,
          testCases: [
            { id: 1, status: 1, time: 1, memory: 10, message: 'first\n' },
            { id: 1, status: 1, time: 2, memory: 20, message: 'duplicate\n' },
          ],
        },
        ['sample-1', 'sample-2'],
      ),
    ).to.throw('重复返回自测点 #1');

    expect(() =>
      distributePretestRecord(
        {
          status: 1,
          testCases: [{ id: 1, status: 1, time: 1, memory: 10, message: 'first\n' }],
        },
        ['sample-1', 'sample-2'],
      ),
    ).to.throw('缺少自测点结果：#2');
  });
});
