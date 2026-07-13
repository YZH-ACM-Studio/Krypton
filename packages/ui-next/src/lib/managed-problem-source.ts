export interface ManagedSourceTemplateOption {
  id: string;
  label: string;
  fields: ReadonlyArray<'year' | 'season' | 'level' | 'round'>;
}

export interface ManagedSourceMetaView {
  template?: string;
  year?: number;
  season?: 'spring' | 'summer' | 'autumn' | 'winter';
  level?: 'L1' | 'L2' | 'L3';
  round?: number;
}

export interface ManagedSourceFieldView {
  label: string;
  value: string;
}

export function managedSourceTagPreview(template: string, year: string, season: string, level: string): string[] {
  if (!/^\d{4}$/.test(year)) return [];
  if (template === 'pat_basic' || template === 'pat_advanced') {
    const seasonLabel: Record<string, string> = { spring: '春', summer: '夏', autumn: '秋', winter: '冬' };
    if (!seasonLabel[season]) return [];
    return [template === 'pat_basic' ? 'PAT乙级' : 'PAT甲级', `${year}${seasonLabel[season]}`];
  }
  if (template === 'gplt_national') return ['天梯赛全国总决赛', level, `${year}CCCC`].filter(Boolean);
  if (template === 'gplt_provincial') return ['天梯赛省级赛', level, `${year}CCCC-省`].filter(Boolean);
  if (template === 'cauc') return ['CAUC校赛', `${year}校赛`];
  if (template === 'self') return ['自命题', `${year}自命题`];
  if (template === 'nowcoder_summer') return ['MultiSchool', '牛客暑期多校', `${year}牛客暑期多校`];
  if (template === 'hdu_summer') return ['MultiSchool', '杭电暑期多校', `${year}杭电暑期多校`];
  if (template === 'hdu_spring') return ['杭电春季赛', `${year}HDU-S`];
  return [];
}

/** Render every server-declared field so round-only metadata is never hidden. */
export function managedSourceFieldViews(
  sourceMeta: ManagedSourceMetaView | undefined,
  template: ManagedSourceTemplateOption | undefined,
): ManagedSourceFieldView[] {
  if (!sourceMeta?.template) return [];
  const fields: ManagedSourceFieldView[] = [
    { label: '来源模板', value: template?.label || sourceMeta.template },
    { label: '年份', value: sourceMeta.year ? String(sourceMeta.year) : '—' },
  ];
  for (const field of template?.fields || []) {
    if (field === 'year') continue;
    if (field === 'season') {
      const seasonLabel = { spring: '春季', summer: '夏季', autumn: '秋季', winter: '冬季' } as const;
      fields.push({ label: '季度', value: sourceMeta.season ? seasonLabel[sourceMeta.season] : '—' });
    }
    if (field === 'level') fields.push({ label: '题目等级', value: sourceMeta.level || '—' });
    if (field === 'round') fields.push({ label: '场次', value: sourceMeta.round ? `第 ${sourceMeta.round} 场` : '—' });
  }
  return fields;
}
