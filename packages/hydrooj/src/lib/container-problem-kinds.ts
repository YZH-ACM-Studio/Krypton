import { effectiveProblemKind, isTeachKindAllowed, type ProblemKind, type TeachType } from '@hydrooj/common';
import { localizedErrorText, ValidationError } from '../error';
import { logger } from '../logger';
import * as document from '../model/document';

/** Eight Chinese kind names. The UI copy table is not a server dependency. */
const KIND_LABEL: Readonly<Record<ProblemKind, string>> = Object.freeze({
    true_false: '判断题',
    single: '单选题',
    multi: '多选题',
    blank: '填空题',
    program_fill: '程序填空题',
    subjective: '主观题',
    function: '函数题',
    programming: '编程题',
});

function newlyAddedDocIds(nextPids: readonly number[], previousPids: readonly number[]): number[] {
    const previous = new Set(previousPids);
    const seen = new Set<number>();
    const added: number[] = [];
    for (const docId of nextPids) {
        if (previous.has(docId) || seen.has(docId)) continue;
        seen.add(docId);
        added.push(docId);
    }
    return added;
}

/** Missing documents are ignored; the existing selection check reports them. */
export async function assertContainerProblemKinds(
    domainId: string,
    type: TeachType,
    nextPids: readonly number[],
    previousPids: readonly number[] = [],
): Promise<void> {
    const added = newlyAddedDocIds(nextPids, previousPids);
    if (added.length === 0) return;

    const rows = await document
        .getMulti(domainId, document.TYPE_PROBLEM, { docId: { $in: added } })
        .project({
            docId: 1,
            problemKind: 1,
            pid: 1,
            title: 1,
        })
        .toArray();
    const byDocId = new Map<number, (typeof rows)[number]>();
    for (const row of rows) {
        if (!byDocId.has(row.docId)) byDocId.set(row.docId, row);
    }

    const rejected: Array<{ docId: number; text: string }> = [];
    for (const docId of added) {
        const row = byDocId.get(docId);
        if (!row) continue;
        const kind = effectiveProblemKind(row);
        if (isTeachKindAllowed(type, kind)) continue;
        rejected.push({ docId, text: `${row.pid}（${KIND_LABEL[kind]}）` });
    }
    if (rejected.length === 0) return;

    logger.warn(
        'Container problem kind rejected domain=%s type=%s docIds=%s',
        domainId,
        type,
        rejected.map((item) => item.docId).join(','),
    );
    throw new ValidationError(
        'pids',
        null,
        localizedErrorText`这些题目不能加入当前类型的题目集：${rejected.map((item) => item.text).join('、')}`,
    );
}
