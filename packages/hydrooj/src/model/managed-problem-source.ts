import type { ProblemDoc } from '../interface';
import { ValidationError } from '../error';

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

const TEMPLATE_BY_ID = new Map(MANAGED_SOURCE_TEMPLATES.map((template) => [template.id, template]));

function isPlainObject(value: unknown): value is Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function parseInteger(value: unknown, field: string, minimum: number, maximum: number): number {
    const normalized = typeof value === 'string' && /^\d+$/.test(value.trim()) ? Number(value.trim()) : value;
    if (typeof normalized !== 'number' || !Number.isSafeInteger(normalized) || normalized < minimum || normalized > maximum) {
        throw new ValidationError(field);
    }
    return normalized;
}

/** Parse and canonicalize the only source metadata accepted for managed problems. */
export function normalizeManagedSourceMeta(input: unknown): ManagedSourceMeta {
    if (!isPlainObject(input)) throw new ValidationError('sourceMeta');
    const template = typeof input.template === 'string' ? (input.template.trim() as ManagedSourceTemplate) : ('' as ManagedSourceTemplate);
    const definition = TEMPLATE_BY_ID.get(template);
    if (!definition) throw new ValidationError('template');
    const allowed = new Set<string>(['template', ...definition.fields]);
    const unknown = Object.keys(input).filter((field) => !allowed.has(field));
    if (unknown.length) throw new ValidationError('sourceMeta', null, `来源模板不接受字段：${unknown.join(', ')}`);

    const sourceMeta: ManagedSourceMeta = {
        template,
        year: parseInteger(input.year, 'year', 2000, 2100),
    };
    if (definition.fields.includes('season')) {
        const season = input.season;
        if (season !== 'spring' && season !== 'summer' && season !== 'autumn' && season !== 'winter') throw new ValidationError('season');
        sourceMeta.season = season;
    }
    if (definition.fields.includes('level')) {
        if (input.level !== 'L1' && input.level !== 'L2' && input.level !== 'L3') throw new ValidationError('level');
        sourceMeta.level = input.level;
    }
    if (definition.fields.includes('round')) sourceMeta.round = parseInteger(input.round, 'round', 1, 99);
    return sourceMeta;
}

/** System tags have one source of truth and never include the round number. */
export function deriveManagedSourceTags(sourceMetaInput: unknown): string[] {
    const sourceMeta = normalizeManagedSourceMeta(sourceMetaInput);
    const { template, year } = sourceMeta;
    const fixedTags = [...TEMPLATE_BY_ID.get(template)!.fixedTags];
    if (template === 'pat_basic' || template === 'pat_advanced') {
        const season = { spring: '春', summer: '夏', autumn: '秋', winter: '冬' }[sourceMeta.season!];
        return [...fixedTags, `${year}${season}`];
    }
    if (template === 'gplt_national') return [...fixedTags, sourceMeta.level!, `${year}CCCC`];
    if (template === 'gplt_provincial') return [...fixedTags, sourceMeta.level!, `${year}CCCC-省`];
    if (template === 'cauc') return [...fixedTags, `${year}校赛`];
    if (template === 'self') return [...fixedTags, `${year}自命题`];
    if (template === 'nowcoder_summer') return [...fixedTags, `${year}牛客暑期多校`];
    if (template === 'hdu_summer') return [...fixedTags, `${year}杭电暑期多校`];
    return [...fixedTags, `${year}HDU-S`];
}

export function managedPidCounterNamespace(sourceMetaInput: unknown): string {
    const sourceMeta = normalizeManagedSourceMeta(sourceMetaInput);
    if (sourceMeta.template === 'pat_basic') return 'pat-basic';
    if (sourceMeta.template === 'pat_advanced') return 'pat-advanced';
    if (sourceMeta.template === 'self') return 'self';
    if (sourceMeta.template === 'nowcoder_summer') return 'nowcoder';
    if (sourceMeta.template === 'hdu_summer' || sourceMeta.template === 'hdu_spring') return 'hdu';
    if (sourceMeta.template === 'gplt_national') return `gplt-${sourceMeta.year}-national`;
    if (sourceMeta.template === 'gplt_provincial') return `gplt-${sourceMeta.year}-provincial`;
    return `cauc-${sourceMeta.year}`;
}

export function formatManagedProblemPid(sourceMetaInput: unknown, sequence: number): string {
    const sourceMeta = normalizeManagedSourceMeta(sourceMetaInput);
    if (!Number.isSafeInteger(sequence) || sequence < 1) throw new ValidationError('sequence');
    if (sourceMeta.template === 'pat_basic') {
        if (sequence < 3000 || sequence > 3999) throw new ValidationError('sequence');
        return `P${sequence}`;
    }
    if (sourceMeta.template === 'pat_advanced') {
        if (sequence < 4000 || sequence > 4999) throw new ValidationError('sequence');
        return `P${sequence}`;
    }
    if (sourceMeta.template === 'self') {
        if (sequence < 5000 || sequence > 5999) throw new ValidationError('sequence');
        return `P${sequence}`;
    }
    if (sourceMeta.template === 'nowcoder_summer') {
        if (sequence > 9999) throw new ValidationError('sequence');
        return `NK${String(sequence).padStart(4, '0')}`;
    }
    if (sourceMeta.template === 'hdu_summer' || sourceMeta.template === 'hdu_spring') {
        if (sequence > 9999) throw new ValidationError('sequence');
        return `HDU${String(sequence).padStart(4, '0')}`;
    }
    if (sourceMeta.template === 'cauc') {
        if (sequence > 9999) throw new ValidationError('sequence');
        return `CCCCCAUC${sourceMeta.year}${String(sequence).padStart(4, '0')}`;
    }
    if (sequence > 999) throw new ValidationError('sequence');
    const stage = sourceMeta.template === 'gplt_national' ? 'N' : 'P';
    return `GPLT${sourceMeta.year}${stage}${String(sequence).padStart(3, '0')}`;
}

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
