import { expect } from 'chai';
import { describe, it } from 'node:test';
import { managedSourceFieldViews, type ManagedSourceMetaView, type ManagedSourceTemplateOption } from '../src/lib/managed-problem-source.ts';

const cases: Array<{
  template: ManagedSourceTemplateOption;
  sourceMeta: ManagedSourceMetaView;
  expected: string[][];
}> = [
  {
    template: { id: 'pat_basic', label: 'PAT 乙级', fields: ['year', 'season'] },
    sourceMeta: { template: 'pat_basic', year: 2026, season: 'spring' },
    expected: [
      ['来源模板', 'PAT 乙级'],
      ['年份', '2026'],
      ['季度', '春季'],
    ],
  },
  {
    template: { id: 'pat_advanced', label: 'PAT 甲级', fields: ['year', 'season'] },
    sourceMeta: { template: 'pat_advanced', year: 2025, season: 'autumn' },
    expected: [
      ['来源模板', 'PAT 甲级'],
      ['年份', '2025'],
      ['季度', '秋季'],
    ],
  },
  ...(['gplt_national', 'gplt_provincial'] as const).map((id, index) => ({
    template: { id, label: index ? '天梯省级赛' : '天梯全国总决赛', fields: ['year', 'level'] as const },
    sourceMeta: { template: id, year: 2024, level: index ? ('L3' as const) : ('L2' as const) },
    expected: [
      ['来源模板', index ? '天梯省级赛' : '天梯全国总决赛'],
      ['年份', '2024'],
      ['题目等级', index ? 'L3' : 'L2'],
    ],
  })),
  ...(['cauc', 'self'] as const).map((id, index) => ({
    template: { id, label: index ? '自命题' : 'CAUC 校赛', fields: ['year'] as const },
    sourceMeta: { template: id, year: 2023 },
    expected: [
      ['来源模板', index ? '自命题' : 'CAUC 校赛'],
      ['年份', '2023'],
    ],
  })),
  ...(['nowcoder_summer', 'hdu_summer', 'hdu_spring'] as const).map((id, index) => ({
    template: { id, label: ['牛客暑期多校', '杭电暑期多校', '杭电春季赛'][index], fields: ['year', 'round'] as const },
    sourceMeta: { template: id, year: 2022, round: index + 1 },
    expected: [
      ['来源模板', ['牛客暑期多校', '杭电暑期多校', '杭电春季赛'][index]],
      ['年份', '2022'],
      ['场次', `第 ${index + 1} 场`],
    ],
  })),
];

describe('P2.14 managed source read-only UI', () => {
  for (const { template, sourceMeta, expected } of cases) {
    it(`shows every required field for ${template.id}`, () => {
      expect(managedSourceFieldViews(sourceMeta, template).map(({ label, value }) => [label, value])).to.deep.equal(expected);
    });
  }
});
