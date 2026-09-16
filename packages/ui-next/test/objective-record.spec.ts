import { describe, expect, it } from 'vitest';
import { buildObjectiveAnswerRows, isObjectiveRecordProblem, parseObjectiveSubmission } from '../src/lib/objective-record';

describe('objective record view', () => {
  it('recognizes basic objective kinds and objective configs', () => {
    expect(isObjectiveRecordProblem({ problemKind: 'single' })).to.equal(true);
    expect(isObjectiveRecordProblem({ problemKind: 'true_false' })).to.equal(true);
    expect(isObjectiveRecordProblem({ config: { type: 'objective' } })).to.equal(true);
    expect(isObjectiveRecordProblem({ problemKind: 'programming' })).to.equal(false);
  });

  it('parses yaml answers and maps letters onto choices', () => {
    expect(parseObjectiveSubmission('main: C\n')).to.deep.equal({ main: 'C' });
    const rows = buildObjectiveAnswerRows({
      pdoc: {
        title: '烟头的中心温度大概是（ ）',
        config: {
          type: 'objective',
          questions: [
            {
              key: 'main',
              kind: 'single',
              score: 100,
              choices: ['200—300℃', '400—500℃', '700—800℃', '900—1000℃'],
            },
          ],
        },
      },
      code: 'main: C\n',
      cases: [{ id: 'main', status: 1, score: 100 }],
    });
    expect(rows).to.have.length(1);
    expect(rows[0].selectedLabel).to.equal('C. 700—800℃');
    expect(rows[0].correct).to.equal(true);
  });

  it('labels true/false tokens without leaking a standard answer', () => {
    const rows = buildObjectiveAnswerRows({
      pdoc: {
        title: '判断',
        config: { questions: [{ key: 'main', kind: 'true_false', presentation: 'truefalse', choices: ['正确', '错误'], score: 100 }] },
      },
      code: 'main: B\n',
      cases: [{ id: 'main', status: 2, score: 0 }],
    });
    expect(rows[0].selectedLabel).to.equal('错误');
    expect(rows[0].correct).to.equal(false);
  });
});
