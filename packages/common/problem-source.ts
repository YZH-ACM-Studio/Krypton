export const SOURCE_FIELDS = ['year', 'season', 'level', 'round'] as const;
export type SourceField = (typeof SOURCE_FIELDS)[number];

export interface ProblemSourceMeta {
    template: string;
    year?: number;
    season?: 'spring' | 'summer' | 'autumn' | 'winter';
    level?: 'L1' | 'L2' | 'L3';
    round?: number;
}

export interface SourceTemplateDefinition {
    id: string;
    label: string;
    fields: SourceField[];
    fixedTags: string[];
    trainingAnchorTag: string;
    pidNamespaceId: string;
    pidStage?: 'national' | 'provincial';
    yearTagSuffix?: string;
    /** Existing PAT and GPLT presets; no arbitrary tag expression language. */
    seasonTag?: boolean;
    levelTag?: boolean;
    enabled: boolean;
}

export interface SourceTemplateView extends SourceTemplateDefinition {
    revision: number;
    references: number;
}

export function sourceTemplateTags(definition: SourceTemplateDefinition, source: ProblemSourceMeta): string[] {
    const tags = [...definition.fixedTags];
    if (definition.levelTag && source.level) tags.push(source.level);
    if (definition.yearTagSuffix !== undefined && source.year !== undefined) tags.push(`${source.year}${definition.yearTagSuffix}`);
    if (definition.seasonTag && source.year !== undefined && source.season) {
        tags.push(`${source.year}${{ spring: '春', summer: '夏', autumn: '秋', winter: '冬' }[source.season]}`);
    }
    return [...new Set(tags)];
}

/** Initialization and historical migration presets only. Runtime callers supply the persisted catalog. */
export const INITIAL_SOURCE_TEMPLATES: readonly SourceTemplateDefinition[] = [
    {
        id: 'pat_basic',
        enabled: true,
        pidNamespaceId: 'builtin:pat-basic',
        seasonTag: true,
        label: 'PAT 乙级',
        fields: ['year', 'season'],
        fixedTags: ['PAT乙级'],
        trainingAnchorTag: 'PAT乙级',
    },
    {
        id: 'pat_advanced',
        enabled: true,
        pidNamespaceId: 'builtin:pat-advanced',
        seasonTag: true,
        label: 'PAT 甲级',
        fields: ['year', 'season'],
        fixedTags: ['PAT甲级'],
        trainingAnchorTag: 'PAT甲级',
    },
    {
        id: 'gplt_national',
        enabled: true,
        pidNamespaceId: 'builtin:gplt',
        pidStage: 'national',
        levelTag: true,
        yearTagSuffix: 'CCCC',
        label: '天梯全国总决赛',
        fields: ['year', 'level'],
        fixedTags: ['天梯赛全国总决赛'],
        trainingAnchorTag: '天梯赛全国总决赛',
    },
    {
        id: 'gplt_provincial',
        enabled: true,
        pidNamespaceId: 'builtin:gplt',
        pidStage: 'provincial',
        levelTag: true,
        yearTagSuffix: 'CCCC-省',
        label: '天梯省级赛',
        fields: ['year', 'level'],
        fixedTags: ['天梯赛省级赛'],
        trainingAnchorTag: '天梯赛省级赛',
    },
    {
        id: 'cauc',
        enabled: true,
        pidNamespaceId: 'builtin:cauc',
        yearTagSuffix: '校赛',
        label: 'CAUC 校赛',
        fields: ['year'],
        fixedTags: ['CAUC校赛'],
        trainingAnchorTag: 'CAUC校赛',
    },
    {
        id: 'self',
        enabled: true,
        pidNamespaceId: 'builtin:self',
        yearTagSuffix: '自命题',
        label: '自命题',
        fields: ['year'],
        fixedTags: ['自命题'],
        trainingAnchorTag: '自命题',
    },
    {
        id: 'nowcoder_summer',
        enabled: true,
        pidNamespaceId: 'builtin:nowcoder',
        yearTagSuffix: '牛客暑期多校',
        label: '牛客暑期多校',
        fields: ['year', 'round'],
        fixedTags: ['MultiSchool', '牛客暑期多校'],
        trainingAnchorTag: '牛客暑期多校',
    },
    {
        id: 'hdu_summer',
        enabled: true,
        pidNamespaceId: 'builtin:hdu',
        yearTagSuffix: '杭电暑期多校',
        label: '杭电暑期多校',
        fields: ['year', 'round'],
        fixedTags: ['MultiSchool', '杭电暑期多校'],
        trainingAnchorTag: '杭电暑期多校',
    },
    {
        id: 'hdu_spring',
        enabled: true,
        pidNamespaceId: 'builtin:hdu',
        yearTagSuffix: 'HDU-S',
        label: '杭电春季赛',
        fields: ['year', 'round'],
        fixedTags: ['杭电春季赛'],
        trainingAnchorTag: '杭电春季赛',
    },
] as const;
