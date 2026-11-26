import { sourceTemplateTags, type SourceTemplateDefinition } from '@hydrooj/common';

export interface ManagedSourceTemplateOption {
  id: string;
  label: string;
  fields: ReadonlyArray<'year' | 'season' | 'level' | 'round'>;
}
export type ManagedSourceTemplateConfig = SourceTemplateDefinition;

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

export function managedSourceTagPreview(template: ManagedSourceTemplateConfig | undefined, year: string, season: string, level: string): string[] {
  if (
    !template ||
    (template.fields.includes('year') && !/^\d{4}$/.test(year)) ||
    (template.seasonTag && !['spring', 'summer', 'autumn', 'winter'].includes(season))
  ) { return []; }
  return sourceTemplateTags(template, {
    template: template.id,
    ...(template.fields.includes('year') && /^\d{4}$/.test(year) ? { year: Number(year) } : {}),
    ...(['spring', 'summer', 'autumn', 'winter'].includes(season) ? { season: season as 'spring' | 'summer' | 'autumn' | 'winter' } : {}),
    ...(['L1', 'L2', 'L3'].includes(level) ? { level: level as 'L1' | 'L2' | 'L3' } : {}),
  });
}

/** Render every server-declared field so round-only metadata is never hidden. */
export function managedSourceFieldViews(
  sourceMeta: ManagedSourceMetaView | undefined,
  template: ManagedSourceTemplateOption | undefined,
): ManagedSourceFieldView[] {
  if (!sourceMeta?.template) return [];
  const fields: ManagedSourceFieldView[] = [
    { label: '来源模板', value: template?.label || sourceMeta.template },
    ...(template?.fields.includes('year') || sourceMeta.year !== undefined
      ? [{ label: '年份', value: sourceMeta.year ? String(sourceMeta.year) : '—' }]
      : []),
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
