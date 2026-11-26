import { SOURCE_FIELDS, sourceTemplateTags, type ProblemSourceMeta, type SourceTemplateDefinition } from '@hydrooj/common';
import { localizedErrorText, ValidationError } from '../error';

export type ManagedSourceMeta = ProblemSourceMeta;
export type ManagedSourceTemplate = string;
export type ManagedSourceTemplateDefinition = SourceTemplateDefinition;

export { INITIAL_SOURCE_TEMPLATES as MANAGED_SOURCE_TEMPLATES } from '@hydrooj/common';

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

export function normalizeSourceTemplateDefinition(id: string, input: unknown): SourceTemplateDefinition {
    if (!isPlainObject(input)) throw new ValidationError('template');
    const keys = [
        'label',
        'enabled',
        'fields',
        'fixedTags',
        'trainingAnchorTag',
        'pidNamespaceId',
        'pidStage',
        'yearTagSuffix',
        'seasonTag',
        'levelTag',
    ];
    if (Object.keys(input).some((key) => !keys.includes(key))) { throw new ValidationError('template', null, localizedErrorText`来源模板包含未知配置字段`); }
    const text = (value: unknown, field: string) => {
        if (typeof value !== 'string' || !value.trim() || value.trim().length > 80 || [...value].some((character) => character.charCodeAt(0) < 32)) {
            throw new ValidationError(field);
        }
        return value.trim();
    };
    const label = text(input.label, 'label');
    const pidNamespaceId = text(input.pidNamespaceId, 'pidNamespaceId');
    if (typeof input.enabled !== 'boolean') throw new ValidationError('enabled');
    if (!Array.isArray(input.fields) || input.fields.some((field) => !SOURCE_FIELDS.includes(field))) throw new ValidationError('fields');
    const inputFields = input.fields;
    const fields = SOURCE_FIELDS.filter((field) => inputFields.includes(field));
    if (!Array.isArray(input.fixedTags) || !input.fixedTags.length || input.fixedTags.length > 20) throw new ValidationError('fixedTags');
    const fixedTags = [...new Set(input.fixedTags.map((tag) => text(tag, 'fixedTags')))];
    const trainingAnchorTag = text(input.trainingAnchorTag, 'trainingAnchorTag');
    if (!fixedTags.includes(trainingAnchorTag)) throw new ValidationError('trainingAnchorTag', null, localizedErrorText`主来源标签必须属于固定标签`);
    for (const key of ['seasonTag', 'levelTag']) {
        if (input[key] !== undefined && typeof input[key] !== 'boolean') throw new ValidationError(key);
    }
    const yearTagSuffix = input.yearTagSuffix === undefined ? undefined : text(input.yearTagSuffix, 'yearTagSuffix');
    if ((yearTagSuffix !== undefined || input.seasonTag || ['builtin:gplt', 'builtin:cauc'].includes(pidNamespaceId)) && !fields.includes('year')) {
        throw new ValidationError('fields', null, localizedErrorText`所选题号或标签规则需要年份字段`);
    }
    if (input.seasonTag && !fields.includes('season')) throw new ValidationError('fields');
    if (input.levelTag && !fields.includes('level')) throw new ValidationError('fields');
    if (pidNamespaceId === 'builtin:gplt') {
        if (input.pidStage !== 'national' && input.pidStage !== 'provincial') throw new ValidationError('pidStage');
    } else if (input.pidStage !== undefined) throw new ValidationError('pidStage');
    return {
        id,
        label,
        enabled: input.enabled,
        fields,
        fixedTags,
        trainingAnchorTag,
        pidNamespaceId,
        ...(pidNamespaceId === 'builtin:gplt' ? { pidStage: input.pidStage as 'national' | 'provincial' } : {}),
        ...(yearTagSuffix !== undefined ? { yearTagSuffix } : {}),
        ...(input.seasonTag ? { seasonTag: true } : {}),
        ...(input.levelTag ? { levelTag: true } : {}),
    };
}

/** Parse and canonicalize the only source metadata accepted for managed problems. */
export function normalizeManagedSourceMeta(input: unknown, templates: readonly SourceTemplateDefinition[]): ManagedSourceMeta {
    if (!isPlainObject(input)) throw new ValidationError('sourceMeta');
    const template = typeof input.template === 'string' ? (input.template.trim() as ManagedSourceTemplate) : ('' as ManagedSourceTemplate);
    const definition = templates.find((candidate) => candidate.id === template);
    if (!definition) throw new ValidationError('template');
    const allowed = new Set<string>(['template', ...definition.fields]);
    const unknown = Object.keys(input).filter((field) => !allowed.has(field));
    if (unknown.length) throw new ValidationError('sourceMeta', null, localizedErrorText`来源模板不接受字段：${unknown.join(', ')}`);

    const sourceMeta: ManagedSourceMeta = {
        template,
    };
    if (definition.fields.includes('year')) sourceMeta.year = parseInteger(input.year, 'year', 2000, 2100);
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

export function deriveManagedSourceTags(input: unknown, templates: readonly SourceTemplateDefinition[]): string[] {
    const source = normalizeManagedSourceMeta(input, templates);
    return sourceTemplateTags(templates.find((template) => template.id === source.template)!, source);
}

/** Legacy packages have no source form; only the current year can be supplied automatically. */
export function legacyImportSourceMeta(template: SourceTemplateDefinition, year: number): ManagedSourceMeta {
    if (template.fields.some((field) => field !== 'year')) {
        throw new ValidationError('template', null, localizedErrorText`自命题模板需要额外来源信息，请使用可填写来源信息的批量导入`);
    }
    return normalizeManagedSourceMeta({ template: template.id, ...(template.fields.includes('year') ? { year } : {}) }, [template]);
}

export function managedPidCounterNamespace(sourceMetaInput: unknown, templates: readonly SourceTemplateDefinition[]): string {
    const sourceMeta = normalizeManagedSourceMeta(sourceMetaInput, templates);
    const definition = templates.find((template) => template.id === sourceMeta.template)!;
    if (definition.pidNamespaceId === 'builtin:pat-basic') return 'pat-basic';
    if (definition.pidNamespaceId === 'builtin:pat-advanced') return 'pat-advanced';
    if (definition.pidNamespaceId === 'builtin:self') return 'self';
    if (definition.pidNamespaceId === 'builtin:nowcoder') return 'nowcoder';
    if (definition.pidNamespaceId === 'builtin:hdu') return 'hdu';
    if (definition.pidNamespaceId === 'builtin:gplt' && definition.pidStage === 'national') return `gplt-${sourceMeta.year}-national`;
    if (definition.pidNamespaceId === 'builtin:gplt' && definition.pidStage === 'provincial') return `gplt-${sourceMeta.year}-provincial`;
    if (definition.pidNamespaceId === 'builtin:cauc') return `cauc-${sourceMeta.year}`;
    return definition.pidNamespaceId;
}

export function formatManagedProblemPid(
    sourceMetaInput: unknown,
    sequence: number,
    templates: readonly SourceTemplateDefinition[],
    customPrefix?: string,
): string {
    const sourceMeta = normalizeManagedSourceMeta(sourceMetaInput, templates);
    const definition = templates.find((template) => template.id === sourceMeta.template)!;
    if (!Number.isSafeInteger(sequence) || sequence < 1) throw new ValidationError('sequence');
    if (definition.pidNamespaceId === 'builtin:pat-basic') {
        if (sequence < 3000 || sequence > 3999) throw new ValidationError('sequence');
        return `P${sequence}`;
    }
    if (definition.pidNamespaceId === 'builtin:pat-advanced') {
        if (sequence < 4000 || sequence > 4999) throw new ValidationError('sequence');
        return `P${sequence}`;
    }
    if (definition.pidNamespaceId === 'builtin:self') {
        if (sequence < 5000 || sequence > 5999) throw new ValidationError('sequence');
        return `P${sequence}`;
    }
    if (definition.pidNamespaceId === 'builtin:nowcoder') {
        if (sequence > 9999) throw new ValidationError('sequence');
        return `NK${String(sequence).padStart(4, '0')}`;
    }
    if (definition.pidNamespaceId === 'builtin:hdu') {
        if (sequence > 9999) throw new ValidationError('sequence');
        return `HDU${String(sequence).padStart(4, '0')}`;
    }
    if (definition.pidNamespaceId === 'builtin:cauc') {
        if (sequence > 9999) throw new ValidationError('sequence');
        return `CCCCCAUC${sourceMeta.year}${String(sequence).padStart(4, '0')}`;
    }
    if (definition.pidNamespaceId !== 'builtin:gplt') {
        if (!customPrefix || !/^[A-Z]{2,8}$/.test(customPrefix) || sequence > 9999) throw new ValidationError('pidNamespaceId');
        return `${customPrefix}${String(sequence).padStart(4, '0')}`;
    }
    if (sequence > 999) throw new ValidationError('sequence');
    const stage = definition.pidNamespaceId === 'builtin:gplt' && definition.pidStage === 'national' ? 'N' : 'P';
    return `GPLT${sourceMeta.year}${stage}${String(sequence).padStart(3, '0')}`;
}

export function managedFixedSourceTags(templates: readonly SourceTemplateDefinition[]): Set<string> {
    return new Set(templates.flatMap((template) => [...template.fixedTags, ...(template.levelTag ? ['L1', 'L2', 'L3'] : [])]));
}

export function isManagedAnnualSourceTag(value: unknown, templates: readonly SourceTemplateDefinition[]): value is string {
    if (typeof value !== 'string' || !/^(?:20\d{2}|2100)/.test(value)) return false;
    const suffix = value.slice(4);
    return templates.some(
        (template) =>
            (template.yearTagSuffix !== undefined && suffix === template.yearTagSuffix) ||
            (template.seasonTag && ['春', '夏', '秋', '冬'].includes(suffix)),
    );
}

export function isCanonicalManagedSourceTag(value: unknown, templates: readonly SourceTemplateDefinition[]): value is string {
    return typeof value === 'string' && (managedFixedSourceTags(templates).has(value) || isManagedAnnualSourceTag(value, templates));
}
