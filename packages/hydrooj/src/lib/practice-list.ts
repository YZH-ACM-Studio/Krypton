import { escapeRegExp } from 'lodash';
import { ObjectId } from 'mongodb';
import type { TrainingDoc } from '../interface';
import { isProblemSetKind, withProblemSetKind } from './training-kind';
import { PRIV } from '../model/builtin';
import { contextualCompletionService } from '../model/contextual-completion';
import { practiceIntegrityService } from '../model/practice-integrity';
import { problemSetAccessService, type ProblemSetAccessUser } from '../model/problem-set-access';
import * as training from '../model/training';

export interface PracticeRow {
    kind: 'practice';
    id: string;
    title: string;
    href: string;
    stageCount: number;
    problemCount: number;
    doneCount: number;
    sourceLabel: string;
}

export interface PracticeListResult {
    rows: PracticeRow[];
    page: number;
    pageCount: number;
    total: number;
}

export type PracticeProgressBuilder = (
    tdoc: TrainingDoc,
    doneByScope: ReadonlyMap<number, ReadonlySet<number>>,
) => { completedProblemCount?: number };

export interface PracticeListQuery {
    q?: string;
    page?: number;
    pageSize?: number;
    hrefFor?: (id: string) => string;
    buildScopedProgress?: PracticeProgressBuilder;
}

interface PracticeStatusDoc {
    docId?: ObjectId;
    enroll?: number;
    donePids?: number[];
    contextualProgress?: { completedProblemCount?: number };
}

const SOURCE_LABEL: Record<string, string> = {
    public: '全站公开',
    group: '用户组',
    course: '课程',
    redemption: '兑换',
    manage: '管理',
};

function docHex(id: ObjectId): string {
    return id.toHexString();
}

function sourceLabelOf(sources: Array<{ kind?: string }> | undefined): string {
    const kind = sources?.[0]?.kind;
    const label = kind ? SOURCE_LABEL[kind] : undefined;
    if (!label) throw new TypeError(`unknown practice source: ${String(kind)}`);
    return label;
}

function stageCountOf(tdoc: TrainingDoc): number {
    return Array.isArray(tdoc.dag) ? tdoc.dag.length : 0;
}

function problemCountOf(tdoc: TrainingDoc): number {
    if (!Array.isArray(tdoc.dag)) return 0;
    return tdoc.dag.reduce((count, node) => count + (Array.isArray(node?.pids) ? node.pids.length : 0), 0);
}

/** Same numbers as the problem-set list (`resolveTrainingListProgress`). */
function doneCountOf(status: PracticeStatusDoc | undefined): number {
    const contextual = status?.contextualProgress;
    if (contextual) {
        const count = contextual.completedProblemCount;
        if (typeof count === 'number' && Number.isSafeInteger(count) && count >= 0) return count;
        return 0;
    }
    return Array.isArray(status?.donePids) ? status.donePids.length : 0;
}

function positivePageSize(value: number | undefined): number {
    if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 1) return value;
    return 20;
}

/**
 * Discoverable problem sets, in the same order as the previous `/problem-sets` list:
 * pinned catalog page, then enrolled sets the title filter left out.
 */
export async function loadPracticeList(
    domainId: string,
    actor: ProblemSetAccessUser,
    query: PracticeListQuery = {},
): Promise<PracticeListResult> {
    const q = query.q ?? '';
    const page = query.page ?? 1;
    const pageSize = positivePageSize(query.pageSize);
    const hrefFor = query.hrefFor ?? ((id: string) => `/problem-sets/${id}`);
    const buildScopedProgress = query.buildScopedProgress ?? training.buildScopedTrainingProgress;
    const listed = await training
        .getMulti(domainId, withProblemSetKind(q ? { title: { $regex: new RegExp(escapeRegExp(q), 'i') } } : {}))
        .toArray();
    const statusById = new Map<string, PracticeStatusDoc>();
    let extraDocs: TrainingDoc[] = [];
    if (actor.hasPriv(PRIV.PRIV_USER_PROFILE)) {
        const listedIds = new Set(listed.map((tdoc) => String(tdoc.docId)));
        const tsdocs = await training
            .getMultiStatus(domainId, {
                uid: actor._id,
                $or: [{ docId: { $in: listed.map((tdoc) => tdoc.docId) } }, { enroll: 1 }],
            })
            .toArray();
        const extraIds: ObjectId[] = [];
        for (const tsdoc of tsdocs) {
            statusById.set(String(tsdoc.docId), tsdoc);
            if (!listedIds.has(String(tsdoc.docId)) && tsdoc.enroll === 1) extraIds.push(tsdoc.docId);
        }
        if (extraIds.length) {
            extraDocs = Object.values(await training.getList(domainId, extraIds)).filter((tdoc) => isProblemSetKind(tdoc?.kind));
        }
    }
    const enrollments = new Map<string, boolean>();
    for (const [id, status] of statusById) enrollments.set(id, status.enroll === 1);
    const decisions = await problemSetAccessService.evaluateMany(domainId, actor, [...listed, ...extraDocs], enrollments);
    const discoverableListed = listed.filter((tdoc) => decisions.get(String(tdoc.docId))?.discoverable);
    const pageCount = Math.max(1, Math.ceil(discoverableListed.length / pageSize));
    const tdocs = discoverableListed.slice((page - 1) * pageSize, page * pageSize);
    for (const tdoc of extraDocs) {
        const decision = decisions.get(String(tdoc.docId));
        if (!decision?.discoverable) {
            statusById.delete(String(tdoc.docId));
            continue;
        }
        if (tdocs.some((listedDoc) => String(listedDoc.docId) === String(tdoc.docId))) continue;
        tdocs.push(tdoc);
    }
    for (const id of [...statusById.keys()]) {
        if (!decisions.get(id)?.discoverable) statusById.delete(id);
    }
    if (actor.hasPriv(PRIV.PRIV_USER_PROFILE)) {
        await Promise.all(
            tdocs.map(async (tdoc) => {
                const published = await practiceIntegrityService.getLatestPublished(domainId, 'problemSet', tdoc.docId);
                if (!published) return;
                const doneByScope = await contextualCompletionService.getCompletedByScope(
                    domainId,
                    actor._id,
                    'problemSet',
                    tdoc.docId,
                );
                const current = statusById.get(docHex(tdoc.docId));
                statusById.set(docHex(tdoc.docId), {
                    ...current,
                    docId: tdoc.docId,
                    contextualProgress: buildScopedProgress(tdoc, doneByScope),
                });
            }),
        );
    }
    return {
        rows: tdocs.map((tdoc) => {
            const id = docHex(tdoc.docId);
            const decision = decisions.get(id) ?? decisions.get(String(tdoc.docId));
            return {
                kind: 'practice',
                id,
                title: tdoc.title,
                href: hrefFor(id),
                stageCount: stageCountOf(tdoc),
                problemCount: problemCountOf(tdoc),
                doneCount: doneCountOf(statusById.get(id)),
                sourceLabel: sourceLabelOf(decision?.sources),
            };
        }),
        page,
        pageCount,
        total: discoverableListed.length,
    };
}
