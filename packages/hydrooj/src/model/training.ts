import { flatten } from 'lodash';
import { Filter, ObjectId } from 'mongodb';
import { Logger } from '@hydrooj/utils';
import { PermissionError, TrainingAlreadyEnrollError, TrainingNotFoundError } from '../error';
import { TrainingDoc, TrainingNode } from '../interface';
import {
    courseKindClause,
    isCourseKind,
    isKnownTrainingKind,
    isProblemSetKind,
    problemSetKindClause,
    resolveWritableTrainingKind,
    withProblemSetKind,
} from '../lib/training-kind';
import { PERM } from './builtin';
import * as document from './document';
import * as OplogModel from './oplog';
import { isProblemBankAdmin, type ProblemAclUser } from './problem-access';
import { canonicalProblemSetAudience } from '../lib/problem-set-audience';

const logger = new Logger('training');

export function getStatus(domainId: string, tid: ObjectId, uid: number) {
    return document.getStatus(domainId, document.TYPE_TRAINING, tid, uid);
}

export function getMultiStatus(domainId: string, query: Filter<TrainingDoc>) {
    return document.getMultiStatus(domainId, document.TYPE_TRAINING, query);
}

export async function getListStatus(domainId: string, uid: number, tids: ObjectId[]) {
    const tsdocs = await getMultiStatus(domainId, { uid, docId: { $in: Array.from(new Set(tids)) } }).toArray();
    const r = {};
    for (const tsdoc of tsdocs) r[tsdoc.docId] = tsdoc;
    return r;
}

export interface ScopedTrainingProgress {
    completedProblemCount: number;
    totalProblemCount: number;
    doneNids: number[];
    done: boolean;
    nsdict: Record<
        number,
        {
            donePids: number[];
            isDone: boolean;
            isProgress: boolean | number;
            isOpen: boolean;
            isInvalid: boolean;
        }
    >;
}

export function buildScopedTrainingProgress(
    tdoc: TrainingDoc,
    contextualDoneByScope: ReadonlyMap<number, ReadonlySet<number>>,
): ScopedTrainingProgress {
    const doneNids = new Set<number>();
    const nsdict: ScopedTrainingProgress['nsdict'] = {};
    let completedProblemCount = 0;
    let totalProblemCount = 0;
    for (const node of tdoc.dag) {
        const nodePids = new Set(node.pids);
        totalProblemCount += nodePids.size;
        const scopedDonePids = nodePids.intersection(new Set(contextualDoneByScope.get(node._id) || []));
        completedProblemCount += scopedDonePids.size;
        const nsdoc = {
            donePids: Array.from(scopedDonePids),
            isDone: isDone(node, doneNids, scopedDonePids),
            isProgress: isProgress(node, doneNids, scopedDonePids, new Set<number>()),
            isOpen: isOpen(node, doneNids, scopedDonePids, new Set<number>()),
            isInvalid: isInvalid(node, doneNids),
        };
        if (nsdoc.isDone) doneNids.add(node._id);
        nsdict[node._id] = nsdoc;
    }
    return {
        completedProblemCount,
        totalProblemCount,
        doneNids: Array.from(doneNids),
        done: tdoc.dag.length > 0 && doneNids.size === tdoc.dag.length,
        nsdict,
    };
}

export async function ensureEnrolled(domainId: string, tid: ObjectId, uid: number): Promise<boolean> {
    const created = await document.setIfNotStatus(domainId, document.TYPE_TRAINING, tid, uid, 'enroll', 1, 1, {});
    if (created) {
        await document.inc(domainId, document.TYPE_TRAINING, tid, 'attend', 1);
        logger.info('Problem set enrollment created domain=%s tid=%s uid=%d stage=enroll result=created', domainId, tid, uid);
        return true;
    }
    const status = await getStatus(domainId, tid, uid);
    if (status?.enroll === 1) return false;
    logger.error(
        'Problem set enrollment write failed domain=%s tid=%s uid=%d enroll=%o stage=enroll result=failed',
        domainId,
        tid,
        uid,
        status?.enroll,
    );
    throw new Error(`problem set enrollment write failed: ${domainId}/${tid}/${uid}`);
}

export async function enroll(domainId: string, tid: ObjectId, uid: number) {
    if (!(await ensureEnrolled(domainId, tid, uid))) throw new TrainingAlreadyEnrollError(tid, uid);
}

export function setStatus(domainId: string, tid: ObjectId, uid: number, $set: any) {
    return document.setStatus(domainId, document.TYPE_TRAINING, tid, uid, $set);
}

export async function add(
    domainId: string,
    title: string,
    content: string,
    owner: number,
    dag: TrainingNode[] = [],
    description = '',
    pin = 0,
    extra: Partial<TrainingDoc> = {},
) {
    const kind = resolveWritableTrainingKind(extra.kind);
    const tid = await document.add(domainId, content, owner, document.TYPE_TRAINING, null, null, null, {
        dag,
        title,
        description,
        attend: 0,
        pin,
        ...extra,
        kind,
    });
    logger.info('Training document created domain=%s tid=%s kind=%s owner=%d stage=add result=success', domainId, tid, kind, owner);
    return tid;
}

export function edit(domainId: string, tid: ObjectId, $set: Partial<TrainingDoc>, $unset: Partial<Record<keyof TrainingDoc, 1>> = {}) {
    if (Object.hasOwn($set, 'kind') || Object.hasOwn($unset, 'kind')) {
        throw new TypeError('training document kind cannot be edited');
    }
    return document.set(domainId, document.TYPE_TRAINING, tid, $set, $unset as any);
}

export async function setProblemSetAudience(domainId: string, tid: ObjectId, audienceInput: unknown) {
    const tdoc = await get(domainId, tid);
    if (!isProblemSetKind(tdoc.kind)) throw new TrainingNotFoundError(domainId, tid);
    const problemSetAudience = canonicalProblemSetAudience(audienceInput);
    await edit(domainId, tid, { problemSetAudience });
    logger.info(
        'Problem set audience updated domain=%s tid=%s public=%s groups=%d stage=audience result=success',
        domainId,
        tid,
        problemSetAudience.public,
        problemSetAudience.groupIds.length,
    );
    return problemSetAudience;
}

interface ProblemBatchChapterAuditInput {
    domainId: string;
    trainingId: ObjectId;
    chapterId: number;
    chapterTitle: string;
    batchId: string;
    actor: number;
    mode?: 'create-front' | 'replace-existing';
    replacePids?: number[];
}

function problemBatchChapterAuditAction(input: ProblemBatchChapterAuditInput) {
    return input.mode === 'replace-existing' ? 'replace-members' : 'create';
}

function problemBatchChapterAuditIdentity(input: ProblemBatchChapterAuditInput) {
    return {
        type: 'training.chapter.batch-import',
        domainId: input.domainId,
        requestId: `problem-batch:${input.batchId}:training:${input.trainingId}:chapter:${input.chapterId}`,
    };
}

function assertProblemBatchChapterAuditRecord(record: any, input: ProblemBatchChapterAuditInput): void {
    if (
        !record ||
        record.operator !== input.actor ||
        String(record.trainingId) !== String(input.trainingId) ||
        record.chapterId !== input.chapterId ||
        record.chapterTitle !== input.chapterTitle ||
        record.batchId !== input.batchId ||
        record.action !== problemBatchChapterAuditAction(input) ||
        (input.mode === 'replace-existing' && JSON.stringify(record.replacePids) !== JSON.stringify(input.replacePids || [])) ||
        record.result !== 'success'
    ) {
        throw new Error(`problem batch chapter audit is missing or conflicting: ${input.domainId}/${input.trainingId}/${input.chapterId}`);
    }
}

async function findProblemBatchChapterAudit(input: ProblemBatchChapterAuditInput) {
    return OplogModel.coll.findOne(problemBatchChapterAuditIdentity(input));
}

export async function assertProblemBatchChapterAudit(input: ProblemBatchChapterAuditInput): Promise<void> {
    assertProblemBatchChapterAuditRecord(await findProblemBatchChapterAudit(input), input);
}

async function ensureProblemBatchChapterAudit(input: ProblemBatchChapterAuditInput): Promise<void> {
    const existing = await findProblemBatchChapterAudit(input);
    if (existing) {
        assertProblemBatchChapterAuditRecord(existing, input);
        return;
    }
    const identity = problemBatchChapterAuditIdentity(input);
    try {
        await OplogModel.add({
            ...identity,
            operator: input.actor,
            trainingId: input.trainingId,
            chapterId: input.chapterId,
            chapterTitle: input.chapterTitle,
            batchId: input.batchId,
            action: problemBatchChapterAuditAction(input),
            ...(input.mode === 'replace-existing' ? { replacePids: [...(input.replacePids || [])] } : {}),
            result: 'success',
            time: new Date(),
        } as any);
    } catch (error) {
        const confirmed = await findProblemBatchChapterAudit(input);
        if (!confirmed) {
            logger.error(
                'Problem batch chapter audit failed domain=%s training=%s chapter=%d actor=%d batchId=%s requestId=%s stage=training-audit result=failed error=%o',
                input.domainId,
                input.trainingId,
                input.chapterId,
                input.actor,
                input.batchId,
                identity.requestId,
                error,
            );
            throw error;
        }
        assertProblemBatchChapterAuditRecord(confirmed, input);
        logger.warn(
            'Problem batch chapter audit confirmed after lost response domain=%s training=%s chapter=%d actor=%d batchId=%s requestId=%s stage=training-audit result=confirmed',
            input.domainId,
            input.trainingId,
            input.chapterId,
            input.actor,
            input.batchId,
            identity.requestId,
        );
    }
}

/** Create or resume one exact front chapter for an approved problem batch. Never creates a training. */
export async function ensureProblemBatchChapter(input: {
    domainId: string;
    trainingId: ObjectId;
    trainingTitle: string;
    chapterId: number;
    chapterTitle: string;
    expectedCurrentMaxChapterId: number;
    batchId: string;
    user: ProblemAclUser;
    mode?: 'create-front' | 'replace-existing';
    chapterPosition?: number;
    replacePids?: number[];
    expectedCurrentPids?: number[];
    replaceMembers?: boolean;
}): Promise<{ chapterId: number; created: boolean; replaced?: boolean }> {
    if (!isProblemBankAdmin(input.user)) throw new PermissionError(PERM.PERM_EDIT_PROBLEM);
    if (!Number.isSafeInteger(input.chapterId) || input.chapterId < 1) throw new TypeError('problem batch chapter id must be positive');
    if (!Number.isSafeInteger(input.expectedCurrentMaxChapterId) || input.expectedCurrentMaxChapterId < 0) {
        throw new TypeError('problem batch expected max chapter id must be non-negative');
    }
    const trainingTitle = input.trainingTitle.trim();
    const chapterTitle = input.chapterTitle.trim();
    if (!trainingTitle || !chapterTitle) throw new TypeError('problem batch training and chapter titles are required');
    const training = await document.coll.findOne(
        withProblemSetKind({
            domainId: input.domainId,
            docType: document.TYPE_TRAINING,
            docId: input.trainingId,
        }) as Filter<TrainingDoc>,
    );
    if (!training || !isProblemSetKind(training.kind) || training.title !== trainingTitle || !Array.isArray(training.dag)) {
        throw new Error(`problem batch training identity changed: ${input.domainId}/${input.trainingId}`);
    }
    if (input.mode === 'replace-existing') {
        if (
            !Number.isSafeInteger(input.chapterPosition) ||
            input.chapterPosition! < 0 ||
            !Array.isArray(input.replacePids) ||
            input.replacePids.length === 0 ||
            !Array.isArray(input.expectedCurrentPids) ||
            typeof input.replaceMembers !== 'boolean'
        ) {
            throw new TypeError('historical problem batch chapter facts are required');
        }
        const chapter = training.dag[input.chapterPosition!];
        if (
            !chapter ||
            chapter._id !== input.chapterId ||
            chapter.title !== chapterTitle ||
            !Array.isArray(chapter.requireNids) ||
            chapter.requireNids.length !== 0 ||
            !Array.isArray(chapter.pids) ||
            JSON.stringify(chapter.pids.map(Number)) !== JSON.stringify(input.expectedCurrentPids)
        ) {
            throw new Error(`historical problem batch chapter identity conflicts: ${input.domainId}/${input.trainingId}/${input.chapterId}`);
        }
        let replaced = false;
        if (input.replaceMembers && JSON.stringify(chapter.pids.map(Number)) === JSON.stringify(input.replacePids)) {
            const nextDag = training.dag.map((candidate, index) => (index === input.chapterPosition ? { ...candidate, pids: [] } : candidate));
            const result = await document.coll.updateOne(
                {
                    _id: training._id,
                    domainId: input.domainId,
                    docType: document.TYPE_TRAINING,
                    docId: input.trainingId,
                    title: trainingTitle,
                    dag: training.dag,
                },
                { $set: { dag: nextDag } },
            );
            if (result.modifiedCount !== 1) {
                throw new Error(`historical problem batch chapter CAS failed: ${input.domainId}/${input.trainingId}/${input.chapterId}`);
            }
            replaced = true;
        }
        await ensureProblemBatchChapterAudit({
            domainId: input.domainId,
            trainingId: input.trainingId,
            chapterId: input.chapterId,
            chapterTitle,
            batchId: input.batchId,
            actor: input.user._id,
            mode: 'replace-existing',
            replacePids: input.replacePids,
        });
        logger.info(
            'Historical problem batch chapter prepared domain=%s training=%s chapter=%d actor=%d batchId=%s replaced=%s stage=training-ready result=success',
            input.domainId,
            input.trainingId,
            input.chapterId,
            input.user._id,
            input.batchId,
            replaced,
        );
        return { chapterId: input.chapterId, created: false, replaced };
    }
    const matches = training.dag.filter((chapter) => chapter?._id === input.chapterId || chapter?.title === chapterTitle);
    if (matches.length) {
        if (
            matches.length !== 1 ||
            matches[0]._id !== input.chapterId ||
            matches[0].title !== chapterTitle ||
            !Array.isArray(matches[0].requireNids) ||
            matches[0].requireNids.length !== 0 ||
            !Array.isArray(matches[0].pids) ||
            training.dag[0] !== matches[0]
        ) {
            throw new Error(`problem batch chapter identity conflicts: ${input.domainId}/${input.trainingId}/${input.chapterId}`);
        }
        await ensureProblemBatchChapterAudit({
            domainId: input.domainId,
            trainingId: input.trainingId,
            chapterId: input.chapterId,
            chapterTitle,
            batchId: input.batchId,
            actor: input.user._id,
        });
        return { chapterId: input.chapterId, created: false };
    }
    const numericIds = training.dag.map((chapter) => Number(chapter?._id)).filter(Number.isSafeInteger);
    const currentMax = numericIds.length ? Math.max(...numericIds) : 0;
    if (currentMax !== input.expectedCurrentMaxChapterId || input.chapterId !== currentMax + 1) {
        throw new Error(
            `problem batch chapter counter changed: training=${input.trainingId} expectedMax=${input.expectedCurrentMaxChapterId} actualMax=${currentMax}`,
        );
    }
    const chapter: TrainingNode = { _id: input.chapterId, title: chapterTitle, requireNids: [], pids: [] };
    const result = await document.coll.updateOne(
        {
            _id: training._id,
            domainId: input.domainId,
            docType: document.TYPE_TRAINING,
            docId: input.trainingId,
            title: trainingTitle,
            dag: training.dag,
        },
        { $push: { dag: { $each: [chapter], $position: 0 } } } as any,
    );
    if (result.modifiedCount !== 1) {
        throw new Error(`problem batch chapter CAS failed: ${input.domainId}/${input.trainingId}/${input.chapterId}`);
    }
    await ensureProblemBatchChapterAudit({
        domainId: input.domainId,
        trainingId: input.trainingId,
        chapterId: input.chapterId,
        chapterTitle,
        batchId: input.batchId,
        actor: input.user._id,
    });
    logger.info(
        'Problem batch chapter created domain=%s training=%s chapter=%d actor=%d batchId=%s stage=training-ready result=success',
        input.domainId,
        input.trainingId,
        input.chapterId,
        input.user._id,
        input.batchId,
    );
    return { chapterId: input.chapterId, created: true };
}

export async function attachContestToCourseChapter(domainId: string, tid: ObjectId, chapterId: number, contestId: ObjectId): Promise<boolean> {
    const result = await document.coll.updateOne(
        {
            domainId,
            docType: document.TYPE_TRAINING,
            docId: tid,
            ...courseKindClause(),
            'dag._id': chapterId,
        },
        { $addToSet: { 'dag.$[chapter].tids': contestId } } as any,
        { arrayFilters: [{ 'chapter._id': chapterId }] },
    );
    return result.matchedCount === 1;
}

export function del(domainId: string, tid: ObjectId) {
    return Promise.all([
        document.deleteOne(domainId, document.TYPE_TRAINING, tid),
        document.deleteMultiStatus(domainId, document.TYPE_TRAINING, { docId: tid }),
    ]);
}

export function getPids(dag: TrainingNode[]) {
    return Array.from(new Set(flatten(dag.map((node) => node.pids))));
}

export function isDone(node: TrainingNode, doneNids: Set<number> | number[], donePids: Set<number> | number[]) {
    return new Set(doneNids).isSupersetOf(new Set(node.requireNids)) && new Set(donePids).isSupersetOf(new Set(node.pids));
}

export function isProgress(node: TrainingNode, doneNids: Set<number> | number[], donePids: Set<number> | number[], progPids: Set<number> | number[]) {
    return (
        new Set(doneNids).isSupersetOf(new Set(node.requireNids)) &&
        !new Set(donePids).isSupersetOf(new Set(node.pids)) &&
        new Set(donePids).union(new Set(progPids)).intersection(new Set(node.pids)).size
    );
}

export function isOpen(node: TrainingNode, doneNids: Set<number> | number[], donePids: Set<number> | number[], progPids: Set<number> | number[]) {
    return (
        new Set(doneNids).isSupersetOf(new Set(node.requireNids)) &&
        !new Set(donePids).isSupersetOf(new Set(node.pids)) &&
        !new Set(donePids).union(new Set(progPids)).intersection(new Set(node.pids)).size
    );
}

export const isInvalid = (node: TrainingNode, doneNids: Set<number> | number[]) => !new Set(doneNids).isSupersetOf(new Set(node.requireNids));

export async function count(domainId: string, query: Filter<TrainingDoc>) {
    return await document.count(domainId, document.TYPE_TRAINING, query);
}

export async function get(domainId: string, tid: ObjectId) {
    const tdoc = await document.get(domainId, document.TYPE_TRAINING, tid);
    if (!tdoc) throw new TrainingNotFoundError(domainId, tid);
    if (!isKnownTrainingKind(tdoc.kind)) {
        logger.error('Unknown training document kind domain=%s tid=%s kind=%o stage=get result=failed', domainId, tid, tdoc.kind);
        throw new TrainingNotFoundError(domainId, tid);
    }
    for (const i in tdoc.dag) {
        for (const j in tdoc.dag[i].pids) {
            if (Number.isSafeInteger(Number.parseInt(tdoc.dag[i].pids[j], 10))) {
                tdoc.dag[i].pids[j] = Number.parseInt(tdoc.dag[i].pids[j], 10);
            }
        }
    }
    return tdoc;
}

export const getMulti = (domainId: string, query: Filter<TrainingDoc> = {}) =>
    document.getMulti(domainId, document.TYPE_TRAINING, query).sort({ pin: -1, _id: -1 });

export async function getList(domainId: string, tids: ObjectId[]) {
    const tdocs = await getMulti(domainId, { _id: { $in: Array.from(new Set(tids)) } }).toArray();
    const r = {};
    for (const tdoc of tdocs) r[tdoc.docId.toString()] = tdoc;
    return r;
}

global.Hydro.model.training = {
    buildScopedTrainingProgress,
    getPids,
    isDone,
    isProgress,
    isOpen,
    isInvalid,
    isCourseKind,
    isProblemSetKind,
    problemSetKindClause,
    withProblemSetKind,
    add,
    edit,
    ensureProblemBatchChapter,
    assertProblemBatchChapterAudit,
    attachContestToCourseChapter,
    del,
    count,
    get,
    getList,
    getMulti,
    getMultiStatus,
    getStatus,
    enroll,
    ensureEnrolled,
    setStatus,
    getListStatus,
    setProblemSetAudience,
};
