import { teachDocKind, type TeachType } from '@hydrooj/common';
import { ObjectId } from 'mongodb';
import { localizeError, PermissionError, ValidationError } from '../error';
import type { Tdoc, TrainingDoc } from '../interface';
import { assertTeachManage, type TeachActor, type TeachDoc } from '../lib/teach-access';
import { readProblemSchoolBank, readSchoolShared, type TeachSchoolShared } from '../lib/teach-fields';
import { Logger } from '../logger';
import { PRIV } from './builtin';
import * as document from './document';
import { canToggleProblemSchoolBank, isProblemInSchoolBank, setProblemSchoolBank } from './problem-school-bank';
import user from './user';

const logger = new Logger('teach-share');
const DELETED_USER_NAME = '已删除的用户';

export interface TeachShareState {
    shared: { sharedAt: string; sharedByName: string } | null;
    canShare: boolean;
    ownHiddenUnshared: Array<{ docId: number; pid: string; title: string }>;
    othersHiddenUnshared: Array<{ docId: number; pid: string; title: string; ownerName: string }>;
}

interface ShareProblem {
    docId: number;
    pid: string;
    title: string;
    owner: number;
    hidden: boolean;
    authoringMode: 'managed' | undefined;
    schoolBank: unknown;
}

interface ClassifiedProblems {
    own: ShareProblem[];
    others: ShareProblem[];
    missing: number[];
}

interface ShareCommand {
    shared: boolean;
    shareOwnProblems: boolean | undefined;
    expectedOwnDocIds: number[] | undefined;
}

/** User text stays a parameter. A filled sentence in msg() is parsed as a template and 500s on `{` / `}`. */
function teacherValidation(field: string, template: string, ...params: readonly unknown[]): never {
    const filled = template.replace(/\{(0|[1-9]\d*)\}/g, (_token, indexText: string) => {
        const value = params[Number(indexText)];
        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value);
        return '';
    });
    throw localizeError(new ValidationError(field, null, filled), template, ...params);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function positiveId(value: unknown): value is number {
    return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function readContainerShare(raw: unknown): TeachSchoolShared | null {
    try {
        return readSchoolShared(raw);
    } catch (error) {
        if (error instanceof TypeError && error.message === 'teach_school_shared_invalid') {
            teacherValidation('schoolShared', '题目集的学校共享数据无效。');
        }
        throw error;
    }
}

function readContestPids(raw: unknown): number[] {
    if (raw == null) return [];
    if (!Array.isArray(raw)) teacherValidation('pids', '题目列表无效。');
    const pids: number[] = [];
    for (const item of raw) {
        if (!positiveId(item)) teacherValidation('pids', '题目列表无效。');
        pids.push(item);
    }
    return pids;
}

function readPracticePids(raw: unknown): number[] {
    if (!Array.isArray(raw)) teacherValidation('dag', '练习的阶段数据无效。');
    const pids: number[] = [];
    for (const node of raw) {
        if (!isRecord(node) || !Array.isArray(node.pids)) teacherValidation('dag', '练习的阶段数据无效。');
        for (const item of node.pids) {
            if (!positiveId(item)) teacherValidation('dag', '练习的阶段数据无效。');
            pids.push(item);
        }
    }
    return pids;
}

function uniqueIds(ids: readonly number[]): number[] {
    const seen = new Set<number>();
    const unique: number[] = [];
    for (const id of ids) {
        if (seen.has(id)) continue;
        seen.add(id);
        unique.push(id);
    }
    return unique;
}

function containerPids(type: TeachType, doc: TeachDoc): number[] {
    if (type === 'practice') return uniqueIds(readPracticePids((doc as TrainingDoc).dag));
    return uniqueIds(readContestPids((doc as Tdoc).pids));
}

function displayedProblemPid(docId: number, raw: unknown): string {
    if (typeof raw === 'string' && raw !== '') return raw;
    if (raw == null || raw === '') return `P${docId}`;
    teacherValidation('pids', '题目数据无效。');
}

function readShareProblem(raw: unknown): ShareProblem {
    if (!isRecord(raw) || !positiveId(raw.docId)) teacherValidation('docId', '题目编号无效。');
    if (typeof raw.title !== 'string') teacherValidation('pids', '题目数据无效。');
    const pid = displayedProblemPid(raw.docId, raw.pid);
    if (!positiveId(raw.owner)) teacherValidation('owner', '题目的所有者无效。');
    if (raw.hidden !== undefined && typeof raw.hidden !== 'boolean') teacherValidation('hidden', '题目的隐藏状态无效。');
    if (raw.authoringMode !== undefined && raw.authoringMode !== 'managed' && typeof raw.authoringMode !== 'string') {
        teacherValidation('authoringMode', '题目的出题方式无效。');
    }
    return {
        docId: raw.docId,
        pid,
        title: raw.title,
        owner: raw.owner,
        hidden: raw.hidden === true,
        authoringMode: raw.authoringMode === 'managed' ? 'managed' : undefined,
        schoolBank: raw.schoolBank,
    };
}

function problemInSchoolBank(schoolBank: unknown): boolean {
    let parsed: ReturnType<typeof readProblemSchoolBank>;
    try {
        parsed = readProblemSchoolBank(schoolBank);
    } catch (error) {
        if (error instanceof TypeError && error.message === 'problem_school_bank_invalid') {
            teacherValidation('schoolBank', '题目的学校题库数据无效。');
        }
        throw error;
    }
    return isProblemInSchoolBank({ schoolBank: parsed ?? undefined });
}

function canShareContainer(actor: TeachActor, doc: TeachDoc): boolean {
    return doc.owner === actor._id || actor.hasPriv(PRIV.PRIV_EDIT_SYSTEM);
}

async function loadProblems(domainId: string, docIds: readonly number[]): Promise<{ found: Map<number, ShareProblem>; missing: number[] }> {
    const found = new Map<number, ShareProblem>();
    if (!docIds.length) return { found, missing: [] };
    const rows = await document.getMulti(domainId, document.TYPE_PROBLEM, { docId: { $in: [...docIds] } }).toArray();
    for (const raw of rows) {
        const problem = readShareProblem(raw);
        if (found.has(problem.docId)) teacherValidation('pids', '题目数据无效。');
        found.set(problem.docId, problem);
    }
    const missing = docIds.filter((id) => !found.has(id));
    for (const docId of missing) logger.error('Teach share problem missing domain=%s docId=%d', domainId, docId);
    return { found, missing };
}

async function classifyProblems(domainId: string, actor: TeachActor, type: TeachType, doc: TeachDoc): Promise<ClassifiedProblems> {
    const pids = containerPids(type, doc);
    const { found, missing } = await loadProblems(domainId, pids);
    const own: ShareProblem[] = [];
    const others: ShareProblem[] = [];
    for (const docId of pids) {
        const problem = found.get(docId);
        if (!problem || !problem.hidden || problemInSchoolBank(problem.schoolBank)) continue;
        const toggle = canToggleProblemSchoolBank(actor, { owner: problem.owner, authoringMode: problem.authoringMode });
        if (toggle) own.push(problem);
        else others.push(problem);
    }
    return { own, others, missing };
}

async function namesFor(domainId: string, uids: readonly number[]): Promise<Map<number, string>> {
    const unique = [...new Set(uids)];
    const names = new Map<number, string>();
    if (!unique.length) return names;
    const listed: unknown = await user.getList(domainId, unique);
    for (const uid of unique) {
        const row = isRecord(listed) ? listed[uid] : undefined;
        if (isRecord(row) && row._id === uid && typeof row.uname === 'string' && row.uname) {
            names.set(uid, row.uname);
            continue;
        }
        logger.error('Teach share user missing domain=%s uid=%d', domainId, uid);
        names.set(uid, DELETED_USER_NAME);
    }
    return names;
}

function sameIdSet(expected: readonly number[] | undefined, actual: readonly number[]): boolean {
    if (!expected || expected.length !== actual.length) return false;
    const left = [...expected].sort((one, other) => one - other);
    const right = [...actual].sort((one, other) => one - other);
    return left.every((id, index) => id === right[index]);
}

function readExpectedDocIds(raw: unknown): number[] {
    if (!Array.isArray(raw)) teacherValidation('expectedOwnDocIds', '题目集里的题刚刚有变化，请重新打开共享');
    const ids: number[] = [];
    for (const item of raw) {
        if (!positiveId(item)) teacherValidation('expectedOwnDocIds', '题目集里的题刚刚有变化，请重新打开共享');
        ids.push(item);
    }
    return ids;
}

function readCommand(body: unknown): ShareCommand {
    if (!isRecord(body) || typeof body.shared !== 'boolean') teacherValidation('shared', '请选择开启或关闭学校共享。');
    let shareOwnProblems: boolean | undefined;
    if (Object.hasOwn(body, 'shareOwnProblems') && body.shareOwnProblems !== undefined) {
        if (typeof body.shareOwnProblems !== 'boolean') teacherValidation('shareOwnProblems', '请确认是否一并共享你的隐藏题。');
        shareOwnProblems = body.shareOwnProblems;
    }
    let expectedOwnDocIds: number[] | undefined;
    if (Object.hasOwn(body, 'expectedOwnDocIds') && body.expectedOwnDocIds !== undefined) {
        expectedOwnDocIds = readExpectedDocIds(body.expectedOwnDocIds);
    }
    return { shared: body.shared, shareOwnProblems, expectedOwnDocIds };
}

function othersList(problems: readonly ShareProblem[]): string {
    return problems.map((problem) => `${problem.pid} ${problem.title}`).join('、');
}

async function writeSchoolShared(domainId: string, type: TeachType, id: ObjectId, value: TeachSchoolShared): Promise<void> {
    const update = { schoolShared: value };
    if (teachDocKind(type) === 'training') await document.set(domainId, document.TYPE_TRAINING, id, update);
    else await document.set(domainId, document.TYPE_CONTEST, id, update);
}

async function clearSchoolShared(domainId: string, type: TeachType, id: ObjectId): Promise<void> {
    const unset = { schoolShared: '' } as never;
    if (teachDocKind(type) === 'training') await document.set(domainId, document.TYPE_TRAINING, id, undefined, unset);
    else await document.set(domainId, document.TYPE_CONTEST, id, undefined, unset);
}

function logShare(domainId: string, actorId: number, id: ObjectId, shared: boolean, stage: string, bankCount: number): void {
    logger.info(
        'Teach container school share domain=%s actor=%d id=%s shared=%s bankCount=%d stage=%s result=ok',
        domainId,
        actorId,
        id.toHexString(),
        shared,
        bankCount,
        stage,
    );
}

async function stateFor(domainId: string, actor: TeachActor, type: TeachType, doc: TeachDoc): Promise<TeachShareState> {
    const shared = readContainerShare(doc.schoolShared);
    const classified = await classifyProblems(domainId, actor, type, doc);
    const names = await namesFor(domainId, [
        ...classified.others.map((problem) => problem.owner),
        ...(shared ? [shared.sharedBy] : []),
    ]);
    const sharedByName = shared ? names.get(shared.sharedBy) : undefined;
    if (shared && !sharedByName) teacherValidation('schoolShared', '题目集的学校共享数据无效。');
    return {
        shared: shared && sharedByName ? { sharedAt: shared.sharedAt.toISOString(), sharedByName } : null,
        canShare: canShareContainer(actor, doc),
        ownHiddenUnshared: classified.own.map((problem) => ({ docId: problem.docId, pid: problem.pid, title: problem.title })),
        othersHiddenUnshared: classified.others.map((problem) => ({
            docId: problem.docId,
            pid: problem.pid,
            title: problem.title,
            ownerName: names.get(problem.owner) ?? DELETED_USER_NAME,
        })),
    };
}

export async function loadTeachShareState(domainId: string, actor: TeachActor, type: TeachType, id: ObjectId): Promise<TeachShareState> {
    const doc = await assertTeachManage(domainId, actor, type, id);
    return stateFor(domainId, actor, type, doc);
}

export async function updateTeachShare(
    domainId: string,
    actor: TeachActor,
    type: TeachType,
    id: ObjectId,
    body: unknown,
): Promise<TeachShareState> {
    const doc = await assertTeachManage(domainId, actor, type, id);
    if (!canShareContainer(actor, doc)) throw localizeError(new PermissionError(), '只有所有者能共享这个题目集。');
    const command = readCommand(body);
    const existing = readContainerShare(doc.schoolShared);
    if (!command.shared) {
        if (existing) {
            await clearSchoolShared(domainId, type, id);
            logShare(domainId, actor._id, id, false, 'unset', 0);
        }
        return loadTeachShareState(domainId, actor, type, id);
    }

    const classified = await classifyProblems(domainId, actor, type, doc);
    if (classified.missing.length) teacherValidation('pids', '题目不存在或已删除：{0}', classified.missing.join('、'));
    if (classified.others.length) {
        teacherValidation('shared', '题目集里有别人的隐藏题还没共享，不能共享：{0}', othersList(classified.others));
    }
    if (classified.own.length && command.shareOwnProblems !== true) {
        teacherValidation('shareOwnProblems', '需要先把你自己的 {0} 道隐藏题共享到学校题库', classified.own.length);
    }
    const ownDocIds = classified.own.map((problem) => problem.docId);
    const ownPids = classified.own.map((problem) => problem.pid);
    if (command.shareOwnProblems === true && !sameIdSet(command.expectedOwnDocIds, ownDocIds)) {
        teacherValidation('expectedOwnDocIds', '题目集里的题刚刚有变化，请重新打开共享');
    }
    if (ownDocIds.length) await setProblemSchoolBank(domainId, actor, ownDocIds, true);
    if (!existing) {
        try {
            await writeSchoolShared(domainId, type, id, { sharedBy: actor._id, sharedAt: new Date() });
        } catch (error) {
            logger.error(
                'Teach container school share write failed domain=%s actor=%d id=%s docIds=%s pids=%s',
                domainId,
                actor._id,
                id.toHexString(),
                ownDocIds.join(','),
                ownPids.join(','),
            );
            throw error;
        }
        logShare(domainId, actor._id, id, true, 'set', ownDocIds.length);
    } else if (ownDocIds.length) logShare(domainId, actor._id, id, true, 'bank', ownDocIds.length);
    return loadTeachShareState(domainId, actor, type, id);
}
