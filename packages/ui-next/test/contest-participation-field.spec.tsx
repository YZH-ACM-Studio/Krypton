import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ACM_PARTICIPATION_OPTIONS, ContestParticipationField } from '../src/components/contest-participation-field';

describe('contest participation field', () => {
  it('shows the participation selector only for ACM contests', () => {
    const markup = renderToStaticMarkup(
      <ContestParticipationField rule="acm" value="individual" onValueChange={() => undefined} />,
    );

    expect(markup).to.include('参赛身份');
    expect(markup).to.include('name="participationMode"');
    expect(ACM_PARTICIPATION_OPTIONS).to.deep.equal([
      { value: 'individual', label: '个人赛' },
      { value: 'team', label: '1–3 人团队 ACM' },
    ]);
    expect(ACM_PARTICIPATION_OPTIONS.map((option) => option.label)).not.to.include('个人 ACM / 普通比赛');
  });

  it.each(['ioi', 'oi', 'exam', 'homework'])('locks %s contests to individual mode without an irrelevant selector', (rule) => {
    const markup = renderToStaticMarkup(
      <ContestParticipationField rule={rule} value="team" onValueChange={() => undefined} />,
    );

    expect(markup).to.equal('<input type="hidden" name="participationMode" value="individual"/>');
  });
});
