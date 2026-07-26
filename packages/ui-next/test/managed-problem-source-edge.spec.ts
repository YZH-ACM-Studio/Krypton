import { describe, expect, it } from 'vitest';
import {
  managedSourceFieldViews,
  managedSourceTagPreview,
  type ManagedSourceMetaView,
  type ManagedSourceTemplateOption,
} from '../src/lib/managed-problem-source.ts';

describe('managed source tag preview', () => {
  it('rejects any non-four-digit year regardless of template', () => {
    for (const year of ['', '26', '20266', 'abcd', '202a', ' 2026', '2026 ']) {
      expect(managedSourceTagPreview('pat_basic', year, 'spring', ''), `year=${JSON.stringify(year)}`).to.deep.equal([]);
    }
    expect(managedSourceTagPreview('cauc', '9999x', '', '')).to.deep.equal([]);
    expect(managedSourceTagPreview('self', '', '', '')).to.deep.equal([]);
  });

  it('maps PAT templates to a level tag plus a year-season tag', () => {
    expect(managedSourceTagPreview('pat_basic', '2026', 'spring', '')).to.deep.equal(['PAT乙级', '2026春']);
    expect(managedSourceTagPreview('pat_basic', '2024', 'summer', '')).to.deep.equal(['PAT乙级', '2024夏']);
    expect(managedSourceTagPreview('pat_advanced', '2023', 'autumn', '')).to.deep.equal(['PAT甲级', '2023秋']);
    expect(managedSourceTagPreview('pat_advanced', '2025', 'winter', 'L3')).to.deep.equal(['PAT甲级', '2025冬']);
  });

  it('rejects PAT previews with an unknown season', () => {
    for (const season of ['', 'fall', 'SPRING', '春']) {
      expect(managedSourceTagPreview('pat_basic', '2026', season, ''), `season=${JSON.stringify(season)}`).to.deep.equal([]);
      expect(managedSourceTagPreview('pat_advanced', '2026', season, ''), `season=${JSON.stringify(season)}`).to.deep.equal([]);
    }
  });

  it('includes the GPLT level tag only when a level is present', () => {
    expect(managedSourceTagPreview('gplt_national', '2024', '', 'L2')).to.deep.equal(['天梯赛全国总决赛', 'L2', '2024CCCC']);
    expect(managedSourceTagPreview('gplt_provincial', '2024', '', 'L1')).to.deep.equal(['天梯赛省级赛', 'L1', '2024CCCC-省']);
    expect(managedSourceTagPreview('gplt_national', '2024', '', '')).to.deep.equal(['天梯赛全国总决赛', '2024CCCC']);
    expect(managedSourceTagPreview('gplt_provincial', '2024', '', '')).to.deep.equal(['天梯赛省级赛', '2024CCCC-省']);
  });

  it('builds school and self-authored tags from the year alone', () => {
    expect(managedSourceTagPreview('cauc', '2023', 'spring', 'L1')).to.deep.equal(['CAUC校赛', '2023校赛']);
    expect(managedSourceTagPreview('self', '2023', '', '')).to.deep.equal(['自命题', '2023自命题']);
  });

  it('marks summer multi-school templates with the shared MultiSchool tag', () => {
    expect(managedSourceTagPreview('nowcoder_summer', '2022', '', '')).to.deep.equal(['MultiSchool', '牛客暑期多校', '2022牛客暑期多校']);
    expect(managedSourceTagPreview('hdu_summer', '2022', '', '')).to.deep.equal(['MultiSchool', '杭电暑期多校', '2022杭电暑期多校']);
    expect(managedSourceTagPreview('hdu_spring', '2022', '', '')).to.deep.equal(['杭电春季赛', '2022HDU-S']);
  });

  it('returns no tags for unknown templates', () => {
    expect(managedSourceTagPreview('icpc_regional', '2026', 'spring', 'L1')).to.deep.equal([]);
    expect(managedSourceTagPreview('', '2026', '', '')).to.deep.equal([]);
  });
});

describe('managed source field views edge cases', () => {
  const roundTemplate: ManagedSourceTemplateOption = { id: 'nowcoder_summer', label: '牛客暑期多校', fields: ['year', 'round'] };

  it('renders nothing without a server-declared template', () => {
    expect(managedSourceFieldViews(undefined, roundTemplate)).to.deep.equal([]);
    expect(managedSourceFieldViews({}, roundTemplate)).to.deep.equal([]);
    expect(managedSourceFieldViews({ year: 2026, round: 3 }, roundTemplate)).to.deep.equal([]);
  });

  it('falls back to the raw template id when the option list lags behind', () => {
    const meta: ManagedSourceMetaView = { template: 'hdu_spring', year: 2026 };
    expect(managedSourceFieldViews(meta, undefined)).to.deep.equal([
      { label: '来源模板', value: 'hdu_spring' },
      { label: '年份', value: '2026' },
    ]);
  });

  it('falls back to the id when the template label is empty', () => {
    const meta: ManagedSourceMetaView = { template: 'self', year: 2020 };
    const views = managedSourceFieldViews(meta, { id: 'self', label: '', fields: ['year'] });
    expect(views[0]).to.deep.equal({ label: '来源模板', value: 'self' });
  });

  it('shows a dash for every declared but missing value', () => {
    const template: ManagedSourceTemplateOption = { id: 'x', label: '全字段', fields: ['year', 'season', 'level', 'round'] };
    expect(managedSourceFieldViews({ template: 'x' }, template)).to.deep.equal([
      { label: '来源模板', value: '全字段' },
      { label: '年份', value: '—' },
      { label: '季度', value: '—' },
      { label: '题目等级', value: '—' },
      { label: '场次', value: '—' },
    ]);
  });

  it('treats round zero as unset', () => {
    expect(managedSourceFieldViews({ template: 'nowcoder_summer', year: 2022, round: 0 }, roundTemplate)).to.deep.equal([
      { label: '来源模板', value: '牛客暑期多校' },
      { label: '年份', value: '2022' },
      { label: '场次', value: '—' },
    ]);
  });

  it('never duplicates the year row and keeps declared field order', () => {
    const template: ManagedSourceTemplateOption = { id: 'x', label: 'X', fields: ['season', 'level', 'round', 'year'] };
    const meta: ManagedSourceMetaView = { template: 'x', year: 2021, season: 'autumn', level: 'L1', round: 12 };
    const views = managedSourceFieldViews(meta, template);
    expect(views.map((field) => field.label)).to.deep.equal(['来源模板', '年份', '季度', '题目等级', '场次']);
    expect(views.map((field) => field.value)).to.deep.equal(['X', '2021', '秋季', 'L1', '第 12 场']);
  });
});
