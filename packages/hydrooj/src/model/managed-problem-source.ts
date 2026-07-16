import type { ProblemDoc } from '../interface';

export type ManagedSourceMeta = NonNullable<ProblemDoc['sourceMeta']>;
export type ManagedSourceTemplate = ManagedSourceMeta['template'];

type TemplateField = 'year' | 'season' | 'level' | 'round';

export interface ManagedSourceTemplateDefinition {
    id: ManagedSourceTemplate;
    label: string;
    fields: TemplateField[];
    /** Tags emitted for every problem created from this template. */
    fixedTags: string[];
    /** Finite field-derived tags that are valid choices in shared catalogs. */
    selectableTags?: string[];
    /** Tag used to decide whether an existing training accepts this template. */
    trainingAnchorTag: string;
}

export const MANAGED_SOURCE_TEMPLATES: readonly ManagedSourceTemplateDefinition[] = [
    { id: 'pat_basic', label: 'PAT 乙级', fields: ['year', 'season'], fixedTags: ['PAT乙级'], trainingAnchorTag: 'PAT乙级' },
    { id: 'pat_advanced', label: 'PAT 甲级', fields: ['year', 'season'], fixedTags: ['PAT甲级'], trainingAnchorTag: 'PAT甲级' },
    {
        id: 'gplt_national',
        label: '天梯全国总决赛',
        fields: ['year', 'level'],
        fixedTags: ['天梯赛全国总决赛'],
        selectableTags: ['L1', 'L2', 'L3'],
        trainingAnchorTag: '天梯赛全国总决赛',
    },
    {
        id: 'gplt_provincial',
        label: '天梯省级赛',
        fields: ['year', 'level'],
        fixedTags: ['天梯赛省级赛'],
        selectableTags: ['L1', 'L2', 'L3'],
        trainingAnchorTag: '天梯赛省级赛',
    },
    { id: 'cauc', label: 'CAUC 校赛', fields: ['year'], fixedTags: ['CAUC校赛'], trainingAnchorTag: 'CAUC校赛' },
    { id: 'self', label: '自命题', fields: ['year'], fixedTags: ['自命题'], trainingAnchorTag: '自命题' },
    {
        id: 'nowcoder_summer',
        label: '牛客暑期多校',
        fields: ['year', 'round'],
        fixedTags: ['MultiSchool', '牛客暑期多校'],
        trainingAnchorTag: '牛客暑期多校',
    },
    {
        id: 'hdu_summer',
        label: '杭电暑期多校',
        fields: ['year', 'round'],
        fixedTags: ['MultiSchool', '杭电暑期多校'],
        trainingAnchorTag: '杭电暑期多校',
    },
    {
        id: 'hdu_spring',
        label: '杭电春季赛',
        fields: ['year', 'round'],
        fixedTags: ['杭电春季赛'],
        trainingAnchorTag: '杭电春季赛',
    },
] as const;

const MANAGED_ANNUAL_SOURCE_TAG_PATTERNS = [
    /^(?:20\d{2}|2100)[春夏秋冬]$/,
    /^(?:20\d{2}|2100)CCCC(?:-省)?$/,
    /^(?:20\d{2}|2100)校赛$/,
    /^(?:20\d{2}|2100)自命题$/,
    /^(?:20\d{2}|2100)牛客暑期多校$/,
    /^(?:20\d{2}|2100)杭电暑期多校$/,
    /^(?:20\d{2}|2100)HDU-S$/,
] as const;

export const MANAGED_FIXED_SOURCE_TAGS = new Set(
    MANAGED_SOURCE_TEMPLATES.flatMap((template) => [...template.fixedTags, ...(template.selectableTags || [])]),
);

export function isManagedAnnualSourceTag(value: unknown): value is string {
    return typeof value === 'string' && MANAGED_ANNUAL_SOURCE_TAG_PATTERNS.some((pattern) => pattern.test(value));
}

export function isCanonicalManagedSourceTag(value: unknown): value is string {
    return typeof value === 'string' && (MANAGED_FIXED_SOURCE_TAGS.has(value) || isManagedAnnualSourceTag(value));
}
