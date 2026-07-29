import { isDeepStrictEqual } from 'node:util';
import { parseProblemKind, type ProblemKind } from '@hydrooj/common';
import { Logger } from '@hydrooj/utils';
import type { ObjectId } from 'mongodb';
import { localizedErrorText, ValidationError } from '../error';
import type { LocalizedErrorText } from '../error';
import type { ProblemDoc } from './problem';
import { isCanonicalManagedSourceTag } from './managed-problem-source';

const logger = new Logger('structured-problem-metadata');

export const DEDICATED_STRUCTURED_PROBLEM_KINDS = new Set<ProblemKind>([
    'single',
    'multi',
    'true_false',
    'blank',
    'subjective',
    'program_fill',
    'function',
]);

export interface StructuredProblemMutationContext {
    domainId: string;
    pid: number;
    actor?: number;
    operation: string;
}

function canonicalRoot(field: string): 'problemKind' | 'tag' | 'knowledgeMapId' | 'knowledgeNodeIds' | undefined {
    for (const root of ['problemKind', 'tag', 'knowledgeMapId', 'knowledgeNodeIds'] as const) {
        if (field === root || field.startsWith(`${root}.`)) return root;
    }
    return undefined;
}

export function touchesCanonicalProblemFields($set: Record<string, unknown>, $unset: Record<string, unknown> = {}): boolean {
    return [...Object.keys($set || {}), ...Object.keys($unset || {})].some((field) => canonicalRoot(field) !== undefined);
}

function deny(
    context: StructuredProblemMutationContext,
    problemKind: unknown,
    stage: string,
    fields: string[],
    result: string,
    field: string,
    message: LocalizedErrorText,
): never {
    logger.warn(
        'Structured metadata write denied domain=%s pid=%d kind=%s actor=%s operation=%s stage=%s fields=%o result=%s',
        context.domainId,
        context.pid,
        problemKind ?? 'legacy-programming',
        context.actor ?? '-',
        context.operation,
        stage,
        fields,
        result,
    );
    throw new ValidationError(field, null, message);
}

/**
 * Enforce immutable problem kind and the knowledge-node/tag pair at every
 * ProblemDoc metadata boundary. Returns true when a later hook must preserve
 * the validated pair.
 */
export async function canonicalizeStructuredKnowledgePatch(
    current: Pick<ProblemDoc, 'problemKind'> &
        Partial<Pick<ProblemDoc, 'authoringMode' | 'codeEvaluationStatus' | 'knowledgeMapId' | 'knowledgeNodeIds' | 'tag'>>,
    $set: Partial<ProblemDoc>,
    $unset: Record<string, unknown>,
    context: StructuredProblemMutationContext,
    stage: string,
    options: { requireKnowledgePair?: boolean; allowMapChange?: boolean; allowEmptyKnowledgeNodes?: boolean } = {},
): Promise<boolean> {
    const setFields = Object.keys($set || {});
    const unsetFields = Object.keys($unset || {});
    const fields = [...setFields, ...unsetFields];
    const dottedCanonicalFields = fields.filter((field) => field.includes('.') && canonicalRoot(field));
    if (dottedCanonicalFields.length) {
        const root = canonicalRoot(dottedCanonicalFields[0])!;
        deny(
            context,
            current.problemKind,
            stage,
            dottedCanonicalFields,
            'dotted-canonical-field',
            root,
            localizedErrorText`结构化题规范字段必须整体保存`,
        );
    }

    const setsKind = Object.hasOwn($set, 'problemKind');
    const unsetsKind = Object.hasOwn($unset, 'problemKind');
    if (unsetsKind || (setsKind && (current.problemKind === undefined || $set.problemKind !== current.problemKind))) {
        deny(
            context,
            current.problemKind,
            stage,
            ['problemKind'],
            'problem-kind-mutation',
            'problemKind',
            localizedErrorText`题型创建后不可原地修改`,
        );
    }

    const problemKind = current.problemKind === undefined ? 'programming' : parseProblemKind(current.problemKind);
    const managedProgramming = problemKind === 'programming' && current.authoringMode === 'managed';
    const convertedProgramming = problemKind === 'programming' && current.authoringMode !== 'managed' && Object.hasOwn(current, 'knowledgeMapId');
    const startsProgrammingConversion =
        problemKind === 'programming' &&
        current.authoringMode !== 'managed' &&
        Object.hasOwn($set, 'knowledgeMapId') &&
        Object.hasOwn($set, 'knowledgeNodeIds');
    if (!DEDICATED_STRUCTURED_PROBLEM_KINDS.has(problemKind) && !managedProgramming && !convertedProgramming && !startsProgrammingConversion) {
        return false;
    }

    const setsTag = Object.hasOwn($set, 'tag');
    const setsMap = Object.hasOwn($set, 'knowledgeMapId');
    const setsKnowledge = Object.hasOwn($set, 'knowledgeNodeIds');
    const unsetsTag = Object.hasOwn($unset, 'tag');
    const unsetsMap = Object.hasOwn($unset, 'knowledgeMapId');
    const unsetsKnowledge = Object.hasOwn($unset, 'knowledgeNodeIds');
    const touchesKnowledgePair = setsTag || setsMap || setsKnowledge || unsetsTag || unsetsMap || unsetsKnowledge;
    if (!touchesKnowledgePair && !options.requireKnowledgePair) return false;

    if (!setsTag || !setsMap || !setsKnowledge || unsetsTag || unsetsMap || unsetsKnowledge) {
        deny(
            context,
            problemKind,
            stage,
            fields.filter((field) => ['tag', 'knowledgeMapId', 'knowledgeNodeIds'].includes(canonicalRoot(field) || '')),
            'incomplete-knowledge-pair',
            'knowledgeNodeIds',
            localizedErrorText`结构化题所属导图、节点与标签必须一起派生保存`,
        );
    }

    if (current.knowledgeMapId && String(current.knowledgeMapId) !== String($set.knowledgeMapId) && options.allowMapChange !== true) {
        deny(
            context,
            problemKind,
            stage,
            ['knowledgeMapId'],
            'implicit-map-change',
            'knowledgeMapId',
            localizedErrorText`更换所属导图必须单独预览并确认`,
        );
    }

    const knowledge = await (
        require('./managed-problem-authoring') as {
            materializeKnowledgeMindmapTags(
                input: unknown,
                options: { knowledgeMapId: unknown; requireMap: true; requirePublicMap: true },
            ): Promise<{ mapId: ObjectId; nodeIds: ObjectId[]; tags: string[] }>;
        }
    ).materializeKnowledgeMindmapTags($set.knowledgeNodeIds, {
        knowledgeMapId: $set.knowledgeMapId,
        requireMap: true,
        requirePublicMap: true,
    });
    if (!knowledge.nodeIds.length && options.allowEmptyKnowledgeNodes !== true && current.codeEvaluationStatus !== 'draft') {
        deny(
            context,
            problemKind,
            stage,
            ['tag', 'knowledgeNodeIds'],
            'empty-knowledge-selection',
            'knowledgeNodeIds',
            localizedErrorText`显式标签编辑至少需要一个知识导图节点`,
        );
    }
    const preservesMapOnlyProgrammingTags = problemKind === 'programming' && !knowledge.nodeIds.length && options.allowEmptyKnowledgeNodes === true;
    const canonicalTags = preservesMapOnlyProgrammingTags
        ? Array.isArray($set.tag)
            ? [...$set.tag]
            : []
        : problemKind === 'programming'
          ? [...new Set([...(Array.isArray(current.tag) ? current.tag.filter(isCanonicalManagedSourceTag) : []), ...knowledge.tags])]
          : knowledge.tags;
    if (!Array.isArray($set.tag) || !isDeepStrictEqual($set.tag, canonicalTags)) {
        deny(
            context,
            problemKind,
            stage,
            ['tag', 'knowledgeNodeIds'],
            'tag-mismatch',
            'tag',
            localizedErrorText`结构化题标签与知识导图派生结果不一致`,
        );
    }
    $set.knowledgeMapId = knowledge.mapId;
    $set.knowledgeNodeIds = knowledge.nodeIds;
    $set.tag = canonicalTags;
    logger.info(
        'Structured knowledge write canonicalized domain=%s pid=%d kind=%s actor=%s operation=%s stage=%s map=%s nodes=%d tags=%d result=allowed',
        context.domainId,
        context.pid,
        problemKind,
        context.actor ?? '-',
        context.operation,
        stage,
        String(knowledge.mapId),
        knowledge.nodeIds.length,
        canonicalTags.length,
    );
    return true;
}

/** Generic array/numeric primitives must not mutate canonical fields piecemeal. */
export function assertNoCanonicalProblemPrimitiveMutation(
    field: string,
    context: StructuredProblemMutationContext,
    operation: 'push' | 'pull' | 'inc',
): void {
    const root = canonicalRoot(field);
    if (!root) return;
    deny(context, undefined, operation, [field], 'piecemeal-canonical-mutation', root, localizedErrorText`题目规范字段不能通过通用增量写入口修改`);
}
