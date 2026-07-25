import type { ManagedSourceTemplate } from '../model/managed-problem-source';

export const BUILTIN_PID_NAMESPACE_IDS = {
    patBasic: 'builtin:pat-basic',
    patAdvanced: 'builtin:pat-advanced',
    self: 'builtin:self',
    nowcoder: 'builtin:nowcoder',
    hdu: 'builtin:hdu',
    gplt: 'builtin:gplt',
    cauc: 'builtin:cauc',
} as const;

export type BuiltinPidNamespaceId = (typeof BUILTIN_PID_NAMESPACE_IDS)[keyof typeof BUILTIN_PID_NAMESPACE_IDS];

export interface BuiltinPidNamespaceDefinition {
    namespaceId: BuiltinPidNamespaceId;
    name: string;
    sourceTemplates: readonly ManagedSourceTemplate[];
    pidPattern: string;
    counterScope: 'pat-basic' | 'pat-advanced' | 'self' | 'nowcoder' | 'hdu' | 'gplt-year-stage' | 'cauc-year';
}

export interface LegacyBuiltinPidMatch {
    namespaceId: BuiltinPidNamespaceId;
    family: 'pat-basic' | 'pat-advanced' | 'self' | 'nowcoder' | 'hdu' | 'gplt' | 'cauc';
    counterScope: string;
    sequence: number;
}

export const BUILTIN_PID_NAMESPACE_DEFINITIONS: readonly BuiltinPidNamespaceDefinition[] = [
    {
        namespaceId: BUILTIN_PID_NAMESPACE_IDS.patBasic,
        name: 'PAT 乙级',
        sourceTemplates: ['pat_basic'],
        pidPattern: 'P3xxx',
        counterScope: 'pat-basic',
    },
    {
        namespaceId: BUILTIN_PID_NAMESPACE_IDS.patAdvanced,
        name: 'PAT 甲级',
        sourceTemplates: ['pat_advanced'],
        pidPattern: 'P4xxx',
        counterScope: 'pat-advanced',
    },
    {
        namespaceId: BUILTIN_PID_NAMESPACE_IDS.self,
        name: '自命题',
        sourceTemplates: ['self'],
        pidPattern: 'P5xxx',
        counterScope: 'self',
    },
    {
        namespaceId: BUILTIN_PID_NAMESPACE_IDS.nowcoder,
        name: '牛客',
        sourceTemplates: ['nowcoder_summer'],
        pidPattern: 'NKxxxx',
        counterScope: 'nowcoder',
    },
    {
        namespaceId: BUILTIN_PID_NAMESPACE_IDS.hdu,
        name: 'HDU',
        sourceTemplates: ['hdu_summer', 'hdu_spring'],
        pidPattern: 'HDUxxxx',
        counterScope: 'hdu',
    },
    {
        namespaceId: BUILTIN_PID_NAMESPACE_IDS.gplt,
        name: '天梯赛',
        sourceTemplates: ['gplt_national', 'gplt_provincial'],
        pidPattern: 'GPLT{year}{N/P}xxx',
        counterScope: 'gplt-year-stage',
    },
    {
        namespaceId: BUILTIN_PID_NAMESPACE_IDS.cauc,
        name: 'CAUC 校赛',
        sourceTemplates: ['cauc'],
        pidPattern: 'CCCCCAUC{year}xxxx',
        counterScope: 'cauc-year',
    },
] as const;

const BUILTIN_BY_ID = new Map(BUILTIN_PID_NAMESPACE_DEFINITIONS.map((definition) => [definition.namespaceId, definition]));
const BUILTIN_BY_TEMPLATE = new Map(
    BUILTIN_PID_NAMESPACE_DEFINITIONS.flatMap((definition) =>
        definition.sourceTemplates.map((template) => [template, definition.namespaceId] as const),
    ),
);

export function builtinPidNamespaceDefinition(namespaceId: string): BuiltinPidNamespaceDefinition | null {
    return BUILTIN_BY_ID.get(namespaceId as BuiltinPidNamespaceId) || null;
}

export function builtinPidNamespaceForSourceTemplate(template: unknown): BuiltinPidNamespaceId | null {
    return typeof template === 'string' ? BUILTIN_BY_TEMPLATE.get(template as ManagedSourceTemplate) || null : null;
}

export function pidNamespaceCounterScopeMatches(definition: BuiltinPidNamespaceDefinition, scope: string): boolean {
    if (definition.counterScope === 'gplt-year-stage') return /^gplt-\d{4}-(?:national|provincial)$/.test(scope);
    if (definition.counterScope === 'cauc-year') return /^cauc-\d{4}$/.test(scope);
    return scope === definition.counterScope;
}

/**
 * Strict legacy classifier used only by the explicit P2.39 migration CLI.
 * Runtime authorization and request handlers must use stored pidNamespaceId.
 */
export function classifyLegacyBuiltinPidForMigration(pid: unknown): LegacyBuiltinPidMatch | null {
    if (typeof pid !== 'string') return null;
    let match = /^P(3\d{3})$/.exec(pid);
    if (match) {
        return {
            namespaceId: BUILTIN_PID_NAMESPACE_IDS.patBasic,
            family: 'pat-basic',
            counterScope: 'pat-basic',
            sequence: Number(match[1]),
        };
    }
    match = /^P(4\d{3})$/.exec(pid);
    if (match) {
        return {
            namespaceId: BUILTIN_PID_NAMESPACE_IDS.patAdvanced,
            family: 'pat-advanced',
            counterScope: 'pat-advanced',
            sequence: Number(match[1]),
        };
    }
    match = /^P(5\d{3})$/.exec(pid);
    if (match) {
        return {
            namespaceId: BUILTIN_PID_NAMESPACE_IDS.self,
            family: 'self',
            counterScope: 'self',
            sequence: Number(match[1]),
        };
    }
    match = /^NK(\d{4})$/.exec(pid);
    if (match && Number(match[1]) >= 1) {
        return {
            namespaceId: BUILTIN_PID_NAMESPACE_IDS.nowcoder,
            family: 'nowcoder',
            counterScope: 'nowcoder',
            sequence: Number(match[1]),
        };
    }
    match = /^HDU(\d{4})$/.exec(pid);
    if (match && Number(match[1]) >= 1) {
        return {
            namespaceId: BUILTIN_PID_NAMESPACE_IDS.hdu,
            family: 'hdu',
            counterScope: 'hdu',
            sequence: Number(match[1]),
        };
    }
    match = /^GPLT(20\d{2}|2100)(N|P)(\d{3})$/.exec(pid);
    if (match && Number(match[3]) >= 1) {
        return {
            namespaceId: BUILTIN_PID_NAMESPACE_IDS.gplt,
            family: 'gplt',
            counterScope: `gplt-${match[1]}-${match[2] === 'N' ? 'national' : 'provincial'}`,
            sequence: Number(match[3]),
        };
    }
    match = /^CCCCCAUC(20\d{2}|2100)(\d{4})$/.exec(pid);
    if (match && Number(match[2]) >= 1) {
        return {
            namespaceId: BUILTIN_PID_NAMESPACE_IDS.cauc,
            family: 'cauc',
            counterScope: `cauc-${match[1]}`,
            sequence: Number(match[2]),
        };
    }
    return null;
}
