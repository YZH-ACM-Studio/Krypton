import { escapeRegExp } from 'lodash';
import { ObjectId } from 'mongodb';
import { getVisibleReferencedProblems } from '../handler/problem-reference';
import type { TrainingDoc } from '../interface';
import { courseNodePids } from './course-chapter';
import { problemSetIntroPids, serializeProblemSetIntro } from './problem-set-stage';
import { isProblemSetKind, withProblemSetKind } from './training-kind';
import { PRIV } from '../model/builtin';
import { contextualCompletionService } from '../model/contextual-completion';
import problem from '../model/problem';
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
    description: string;
    enrolled: boolean;
    participantCount: number;
    sourceLabels: string[];
    stages: Array<{ id: number; title: string; status: 'done' | 'progress' | 'open' | 'locked' }>;
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
) => Pick<training.ScopedTrainingProgress, 'completedProblemCount' | 'doneNids' | 'nsdict'>;

export interface PracticeListQuery {
    q?: string;
    page?: number;
    pageSize?: number;
    hrefFor?: (id: string) => string;
    buildScopedProgress?: PracticeProgressBuilder;
    countOnly?: boolean;
}

interface PracticeStatusDoc {
    docId?: ObjectId;
    enroll?: number;
    progress?: ReturnType<PracticeProgressBuilder>;
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
    return tdoc.dag.reduce((count, node) => count + courseNodePids(node).length, 0);
}

function cardStages(tdoc: TrainingDoc, status: PracticeStatusDoc | undefined): PracticeRow['stages'] {
    return tdoc.dag.map((node) => {
        const stage = status?.progress?.nsdict[node._id];
        const state = stage
            ? stage.isDone ? 'done' : stage.isProgress ? 'progress' : stage.isOpen ? 'open' : 'locked'
            : node.requireNids?.length ? 'locked' : 'open';
        return { id: node._id, title: node.title || `阶段 ${node._id}`, status: state };
    });
}

async function loadCardProgress(
    domainId: string,
    actor: ProblemSetAccessUser,
    docs: TrainingDoc[],
    statuses: Map<string, PracticeStatusDoc>,
    buildScoped: PracticeProgressBuilder,
): Promise<void> {
    const ordinary: TrainingDoc[] = [];
    await Promise.all(docs.map(async (doc) => {
        const id = docHex(doc.docId);
        const policy = await practiceIntegrityService.getLatestPublished(domainId, 'problemSet', doc.docId);
        if (!policy) {
            ordinary.push(doc);
            return;
        }
        const completed = await contextualCompletionService.getCompletedByScope(domainId, actor._id, 'problemSet', doc.docId);
        statuses.set(id, { ...statuses.get(id), progress: buildScoped(doc, completed) });
    }));
    if (!ordinary.length) return;
    const pids = [...new Set(ordinary.flatMap(problemSetIntroPids))];
    const byPid = pids.length ? await problem.getListStatus(domainId, actor._id, pids) : {};
    const attempted = pids.filter((pid) => byPid[pid]?.status);
    const visible = attempted.length ? await getVisibleReferencedProblems(domainId, attempted, actor, ['docId']) : {};
    for (const doc of ordinary) {
        const psdict = Object.fromEntries(problemSetIntroPids(doc).filter((pid) => visible[pid]?.docId).map((pid) => [pid, byPid[pid]]));
        const progress = serializeProblemSetIntro(doc, { accessible: true, stageAccess: 'all' }, {
            psdict, publishedIntegrity: null, contextualDoneByScope: null, selfContextualDoneByScope: null,
        });
        const id = docHex(doc.docId);
        statuses.set(id, { ...statuses.get(id), progress });
    }
}

function positivePageSize(value: number | undefined): number {
    if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 1) return value;
    return 20;
}

/** Callers must authorize these documents before requesting the viewer's card data. */
export async function loadPracticeCardsForDocuments(
    domainId: string,
    actor: ProblemSetAccessUser,
    docs: TrainingDoc[],
    sourceLabel: string,
    hrefFor: (id: string) => string,
): Promise<PracticeRow[]> {
    if (!docs.length) return [];
    const statuses = await training.getMultiStatus(domainId, {
        uid: actor._id,
        docId: { $in: docs.map((doc) => doc.docId) },
    }).toArray();
    const byId = new Map<string, PracticeStatusDoc>(statuses.map((status) => [String(status.docId), status]));
    await loadCardProgress(domainId, actor, docs, byId, training.buildScopedTrainingProgress);
    return docs.map((doc): PracticeRow => {
        const id = docHex(doc.docId);
        const status = byId.get(id);
        return {
            kind: 'practice',
            id,
            title: doc.title,
            href: hrefFor(id),
            stageCount: stageCountOf(doc),
            problemCount: problemCountOf(doc),
            doneCount: status?.progress?.completedProblemCount ?? 0,
            sourceLabel,
            description: doc.content || doc.description || '',
            enrolled: !!status?.enroll,
            participantCount: doc.attend || 0,
            sourceLabels: [sourceLabel],
            stages: cardStages(doc, status),
        };
    });
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
    if (query.countOnly) return { rows: [], page, pageCount, total: discoverableListed.length };
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
        await loadCardProgress(domainId, actor, tdocs, statusById, buildScopedProgress);
    }
    return {
        rows: tdocs.map((tdoc) => {
            const id = docHex(tdoc.docId);
            const decision = decisions.get(id) ?? decisions.get(String(tdoc.docId));
            const status = statusById.get(id);
            return {
                kind: 'practice',
                id,
                title: tdoc.title,
                href: hrefFor(id),
                stageCount: stageCountOf(tdoc),
                problemCount: problemCountOf(tdoc),
                doneCount: status?.progress?.completedProblemCount ?? 0,
                sourceLabel: sourceLabelOf(decision?.sources),
                description: tdoc.content || tdoc.description || '',
                enrolled: !!status?.enroll || !!decision?.enrolled,
                participantCount: tdoc.attend || 0,
                sourceLabels: (decision?.sources ?? []).map((source) => {
                    if (source.kind === 'public') return '公开';
                    if (source.kind === 'course') return '课程引用';
                    return sourceLabelOf([source]);
                }),
                stages: cardStages(tdoc, status),
            };
        }),
        page,
        pageCount,
        total: discoverableListed.length,
    };
}
