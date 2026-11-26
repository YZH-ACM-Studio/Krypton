import { ObjectId } from 'mongodb';
import { effectiveProblemKind, parseTeachType, teachDocKind, teachTypeOfContestRule, type TeachType } from '@hydrooj/common';
import { PERM, PRIV } from '@hydrooj/common/permission';
import { Logger } from '@hydrooj/utils';
import {
    ContestNotFoundError,
    localizeError,
    type LocalizedErrorText,
    localizeErrorParameter,
    localizedErrorText,
    NotFoundError,
    PermissionError,
    ProblemNotFoundError,
    TrainingNotFoundError,
    ValidationError,
} from '../error';
import {
    getProblemConfigErrorText,
    parseProblemConfigObject,
    parseStructuredRegionSubmission,
} from '../lib/problem-config';
import { gradeVerifyObjective, resolveVerifySubmitLanguage } from '../lib/teach-verify';
import { isProblemSetKind } from '../lib/training-kind';
import * as contest from '../model/contest';
import domain from '../model/domain';
import problem from '../model/problem';
import record from '../model/record';
import * as setting from '../model/setting';
import system from '../model/system';
import * as training from '../model/training';
import { Handler } from '../service/server';

const logger = new Logger('teach-verify');
const verifyLog = 'teach verify domain=%s uid=%d type=%s id=%s pid=%d kind=%s result=%s';

// teach-access imports model/builtin, which writes global.Hydro.model at import time.
// Keep the predicates here so this file's model imports stay on the stubbed boundary.
interface TeachActor {
    _id: number;
    own(doc: { owner: number; maintainer?: number[] }, exact?: boolean): boolean;
    hasPerm(...perm: bigint[]): boolean;
    hasPriv(...priv: number[]): boolean;
}

interface TeachContainer {
    owner: number;
    maintainer?: number[];
    rule?: unknown;
    kind?: unknown;
    pids?: unknown;
    dag?: unknown;
    langs?: unknown;
}

interface Attempt {
    domainId: string;
    uid: number;
    type: string;
    id: string;
    pid: number;
    kind: string;
    logged: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function teachMissing(): never {
    throw localizeError(new NotFoundError(), '题目集不存在');
}

function isNamedError(error: unknown, name: string): boolean {
    return error instanceof Error && error.name === name;
}

function canManagePractice(actor: TeachActor, doc: TeachContainer): boolean {
    if (actor.hasPriv(PRIV.PRIV_EDIT_SYSTEM)) return true;
    if (actor.hasPerm(PERM.PERM_EDIT_TRAINING)) return true;
    return actor.own(doc) && actor.hasPerm(PERM.PERM_EDIT_TRAINING_SELF);
}

function canManageHomework(actor: TeachActor, doc: TeachContainer): boolean {
    return actor.hasPriv(PRIV.PRIV_EDIT_SYSTEM)
        || (actor.own(doc) ? actor.hasPerm(PERM.PERM_EDIT_HOMEWORK_SELF) : actor.hasPerm(PERM.PERM_EDIT_HOMEWORK));
}

function canManageContest(actor: TeachActor, doc: TeachContainer): boolean {
    return actor.hasPriv(PRIV.PRIV_EDIT_SYSTEM)
        || (actor.own(doc) ? actor.hasPerm(PERM.PERM_EDIT_CONTEST_SELF) : actor.hasPerm(PERM.PERM_EDIT_CONTEST));
}

function canManageTeachContainer(actor: TeachActor, type: TeachType, doc: TeachContainer): boolean {
    const parsed = parseTeachType(type);
    if (parsed === 'practice') return canManagePractice(actor, doc);
    if (parsed === 'homework') return canManageHomework(actor, doc);
    if (parsed === 'exam' || parsed === 'acm' || parsed === 'oi') return canManageContest(actor, doc);
    const unreachable: never = parsed;
    throw new TypeError(`teach_type_invalid:${String(unreachable)}`);
}

function isHiddenNonHomeworkRule(rule: unknown): boolean {
    if (typeof rule !== 'string' || rule === 'homework') return false;
    const entry = contest.RULES[rule];
    return entry?.hidden === true;
}

function begin(handler: Handler): Attempt {
    const domainRaw = handler.domain?._id;
    const uidRaw = handler.user?._id;
    return {
        domainId: typeof domainRaw === 'string' && domainRaw ? domainRaw : '-',
        uid: typeof uidRaw === 'number' ? uidRaw : 0,
        type: '-',
        id: '-',
        pid: 0,
        kind: '-',
        logged: false,
    };
}

function logAttempt(attempt: Attempt, result: string): void {
    if (attempt.logged) return;
    attempt.logged = true;
    logger.info(verifyLog, attempt.domainId, attempt.uid, attempt.type, attempt.id, attempt.pid, attempt.kind, result);
}

function actorOf(handler: Handler): TeachActor {
    const user = handler.user as Partial<TeachActor> | undefined;
    if (!user || typeof user._id !== 'number' || typeof user.hasPerm !== 'function' || typeof user.hasPriv !== 'function' || typeof user.own !== 'function') {
        throw new PermissionError();
    }
    return user as TeachActor;
}

function readRaw(raw: unknown): Record<string, unknown> {
    if (!isRecord(raw)) throw new ValidationError('query', null, localizedErrorText`请求参数无效。`);
    return raw;
}

function parseType(value: unknown): TeachType {
    if (typeof value !== 'string') teachMissing();
    try {
        return parseTeachType(value);
    } catch (error) {
        if (error instanceof TypeError && error.message === 'teach_type_invalid') teachMissing();
        throw error;
    }
}

function parseId(value: unknown): ObjectId {
    if (typeof value !== 'string' || !/^[0-9a-f]{24}$/i.test(value)) teachMissing();
    return new ObjectId(value);
}

function parsePid(value: unknown): number {
    if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return value;
    if (typeof value === 'string' && /^[1-9]\d*$/.test(value)) {
        const pid = Number(value);
        if (Number.isSafeInteger(pid)) return pid;
    }
    throw new ValidationError('pid', null, localizedErrorText`题目编号无效。`);
}

function positivePid(value: unknown): value is number {
    return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function readPidList(raw: unknown, field: string): number[] {
    if (!Array.isArray(raw)) throw new ValidationError(field, null, localizedErrorText`题目列表无效。`);
    const pids: number[] = [];
    for (const item of raw) {
        if (!positivePid(item)) throw new ValidationError(field, null, localizedErrorText`题目列表无效。`);
        pids.push(item);
    }
    return pids;
}

function practicePids(doc: TeachContainer): number[] {
    if (!Array.isArray(doc.dag)) throw new ValidationError('dag', null, localizedErrorText`练习的阶段数据无效。`);
    const pids: number[] = [];
    for (const node of doc.dag) {
        if (!isRecord(node)) throw new ValidationError('dag', null, localizedErrorText`练习的阶段数据无效。`);
        pids.push(...readPidList(node.pids, 'dag'));
        if (node.sections == null) continue;
        if (!Array.isArray(node.sections)) throw new ValidationError('dag', null, localizedErrorText`练习的阶段数据无效。`);
        for (const section of node.sections) {
            if (!isRecord(section)) throw new ValidationError('dag', null, localizedErrorText`练习的阶段数据无效。`);
            if (section.pids == null) continue;
            pids.push(...readPidList(section.pids, 'dag'));
        }
    }
    return pids;
}

/** Exam draws still verify against the whole pool, not one student's frozen paper. */
function containerPids(type: TeachType, doc: TeachContainer): number[] {
    if (type === 'practice') return practicePids(doc);
    if (doc.pids == null) return [];
    return readPidList(doc.pids, 'pids');
}

async function loadContest(domainId: string, type: TeachType, id: ObjectId): Promise<TeachContainer> {
    let doc: TeachContainer;
    try {
        doc = await contest.get(domainId, id);
    } catch (error) {
        if (error instanceof ContestNotFoundError || isNamedError(error, 'ContestNotFoundError')) teachMissing();
        throw error;
    }
    if (!doc || isHiddenNonHomeworkRule(doc.rule)) teachMissing();
    let resolved: TeachType;
    try {
        resolved = teachTypeOfContestRule(doc.rule);
    } catch (error) {
        if (error instanceof TypeError && error.message === 'teach_rule_unsupported') teachMissing();
        throw error;
    }
    if (resolved !== type) teachMissing();
    return doc;
}

async function loadPractice(domainId: string, id: ObjectId): Promise<TeachContainer> {
    let doc: TeachContainer;
    try {
        doc = await training.get(domainId, id);
    } catch (error) {
        if (error instanceof TrainingNotFoundError || isNamedError(error, 'TrainingNotFoundError')) teachMissing();
        throw error;
    }
    if (!doc || !isProblemSetKind(doc.kind)) teachMissing();
    return doc;
}

async function loadContainer(domainId: string, type: TeachType, id: ObjectId): Promise<TeachContainer> {
    if (teachDocKind(type) === 'training') return loadPractice(domainId, id);
    return loadContest(domainId, type, id);
}

function parseAnswers(value: unknown): Record<string, unknown> {
    if (typeof value !== 'string') throw new ValidationError('answers', null, localizedErrorText`答案必须是 JSON 文本。`);
    let parsed: unknown;
    try {
        parsed = JSON.parse(value);
    } catch {
        throw new ValidationError('answers', null, localizedErrorText`答案不是合法的 JSON。`);
    }
    if (!isRecord(parsed)) throw new ValidationError('answers', null, localizedErrorText`答案必须是对象。`);
    return parsed;
}

function parseCode(value: unknown): string {
    if (typeof value !== 'string' || !value) throw new ValidationError('code', null, localizedErrorText`请填写代码。`);
    return value.replace(/\r\n/g, '\n');
}

function parseLang(value: unknown): string {
    if (typeof value !== 'string' || !value) throw new ValidationError('lang', null, localizedErrorText`请选择语言。`);
    return value;
}

function problemKindOf(pdoc: { problemKind?: unknown }): string {
    try {
        return effectiveProblemKind(pdoc);
    } catch (error) {
        if (error instanceof TypeError) throw new ValidationError('pid', null, localizedErrorText`这道题的题型无效。`);
        throw error;
    }
}

function domainLangs(handler: Handler): unknown {
    return (handler.domain as { langs?: unknown } | undefined)?.langs;
}

function sourceReference(pdoc: { reference?: unknown }): { domainId: string; pid: string | number } | null {
    if (pdoc.reference == null) return null;
    if (!isRecord(pdoc.reference)) throw localizeError(new NotFoundError(), '题目不存在');
    const sourceDomain = pdoc.reference.domainId;
    const sourcePid = pdoc.reference.pid;
    const pidOk = (typeof sourcePid === 'number' && Number.isSafeInteger(sourcePid) && sourcePid > 0)
        || (typeof sourcePid === 'string' && sourcePid.length > 0);
    if (typeof sourceDomain !== 'string' || !sourceDomain || !pidOk) throw localizeError(new NotFoundError(), '题目不存在');
    return { domainId: sourceDomain, pid: sourcePid };
}

interface LoadedVerifyProblem {
    pdoc: { config?: unknown; problemKind?: unknown };
    /** Present only for a referenced problem. '' means the source domain sets no limit. */
    sourceDomainLangs?: unknown;
}

/** Config lives on the referenced problem. Source-domain langs join the current domain, as in problem prepare. */
async function problemForVerify(domainId: string, pid: number): Promise<LoadedVerifyProblem> {
    const local = await problem.get(domainId, pid, undefined, true);
    if (!local) throw localizeError(new NotFoundError(), '题目不存在');
    const reference = sourceReference(local);
    if (!reference) return { pdoc: local };
    const sourceDomain = await domain.get(reference.domainId);
    const source = await problem.get(reference.domainId, reference.pid, undefined, true);
    if (!sourceDomain || !source) throw new ProblemNotFoundError(reference.domainId, reference.pid);
    return {
        pdoc: { ...local, config: source.config },
        sourceDomainLangs: sourceDomain.langs,
    };
}

function compiledStructuredKind(pdoc: { config?: unknown; problemKind?: unknown }): 'program_fill' | 'function' | null {
    const config = parseProblemConfigObject(pdoc);
    if (!isRecord(config)) return null;
    let kind = '';
    try {
        kind = effectiveProblemKind(pdoc);
    } catch (error) {
        if (error instanceof TypeError) return null;
        throw error;
    }
    if (config.type === 'function' && kind === 'function') return 'function';
    if (config.type === 'program_fill' && kind === 'program_fill' && config.mode === 'compile') return 'program_fill';
    return null;
}

function structuredSubmissionFailure(error: unknown): boolean {
    if (getProblemConfigErrorText(error)) return true;
    return error instanceof Error && error.message.includes('submission language mismatch');
}

function throwLocalized(field: string, text: LocalizedErrorText): never {
    throw new ValidationError(field, null, text);
}

function rejectStructuredCode(error: unknown): never {
    if (error instanceof ValidationError) throw error;
    const text = getProblemConfigErrorText(error);
    if (text) throwLocalized('code', text);
    const message = error instanceof Error ? error.message : String(error);
    throw localizeErrorParameter(
        new ValidationError('code', null, message),
        2,
        'The structured answer is invalid: {0}',
        message,
    );
}

function assertStructuredRegions(pdoc: { config?: unknown; problemKind?: unknown }, code: string): void {
    const kind = compiledStructuredKind(pdoc);
    if (!kind) return;
    try {
        parseStructuredRegionSubmission(kind, parseProblemConfigObject(pdoc)?.template, code);
    } catch (error) {
        rejectStructuredCode(error);
    }
}

async function runObjective(handler: Handler, attempt: Attempt, raw: Record<string, unknown>): Promise<void> {
    if (attempt.domainId === '-' || !attempt.uid) {
        if (attempt.domainId === '-') throw new ValidationError('domainId', null, localizedErrorText`域无效。`);
        throw new PermissionError();
    }
    const actor = actorOf(handler);
    const type = parseType(raw.type);
    const id = parseId(raw.id);
    const pid = parsePid(raw.pid);
    attempt.type = type;
    attempt.id = id.toHexString();
    attempt.pid = pid;
    const doc = await loadContainer(attempt.domainId, type, id);
    if (!canManageTeachContainer(actor, type, doc)) {
        throw localizeError(new PermissionError(), '你不能管理这个题目集。');
    }
    if (!containerPids(type, doc).includes(pid)) {
        throw new ValidationError('pid', null, localizedErrorText`这道题不在这个题目集里。`);
    }
    const loaded = await problemForVerify(attempt.domainId, pid);
    attempt.kind = problemKindOf(loaded.pdoc);
    const graded = gradeVerifyObjective(loaded.pdoc, parseAnswers(raw.answers));
    logAttempt(attempt, 'graded');
    handler.response.body = { results: graded.results, skipped: graded.skipped };
}

async function runSubmit(handler: Handler, attempt: Attempt, raw: Record<string, unknown>): Promise<void> {
    if (attempt.domainId === '-' || !attempt.uid) {
        if (attempt.domainId === '-') throw new ValidationError('domainId', null, localizedErrorText`域无效。`);
        throw new PermissionError();
    }
    const actor = actorOf(handler);
    const type = parseType(raw.type);
    const id = parseId(raw.id);
    const pid = parsePid(raw.pid);
    attempt.type = type;
    attempt.id = id.toHexString();
    attempt.pid = pid;
    const doc = await loadContainer(attempt.domainId, type, id);
    if (!canManageTeachContainer(actor, type, doc)) {
        throw localizeError(new PermissionError(), '你不能管理这个题目集。');
    }
    if (!containerPids(type, doc).includes(pid)) {
        throw new ValidationError('pid', null, localizedErrorText`这道题不在这个题目集里。`);
    }
    const loaded = await problemForVerify(attempt.domainId, pid);
    attempt.kind = problemKindOf(loaded.pdoc);
    const lang = resolveVerifySubmitLanguage(loaded.pdoc, parseLang(raw.lang), setting.langs, {
        contestLangs: doc.langs,
        domainLangs: domainLangs(handler),
        sourceDomainLangs: loaded.sourceDomainLangs,
    });
    const code = parseCode(raw.code);
    const lengthLimit = system.get('limit.codelength') || 128 * 1024;
    if (code.length > lengthLimit) throw new ValidationError('code', null, localizedErrorText`代码超过长度限制。`);
    assertStructuredRegions(loaded.pdoc, code);
    await handler.limitRate('add_record', 60, system.get('limit.submission_user'), '{{user}}');
    await handler.limitRate('add_record', 60, system.get('limit.submission'));
    let rid: unknown;
    try {
        rid = await record.add(attempt.domainId, pid, actor._id, lang, code, true, { type: 'verify' });
    } catch (error) {
        if (compiledStructuredKind(loaded.pdoc) && structuredSubmissionFailure(error)) rejectStructuredCode(error);
        throw error;
    }
    if (!(rid instanceof ObjectId)) throw new ValidationError('rid', null, localizedErrorText`验题记录没有创建。`);
    logAttempt(attempt, 'submitted');
    handler.response.body = { rid: rid.toHexString() };
}

class TeachVerifyObjectiveHandler extends Handler {
    async post(raw: unknown) {
        const attempt = begin(this);
        try {
            await runObjective(this, attempt, readRaw(raw));
        } catch (error) {
            logAttempt(attempt, error instanceof Error ? error.name : 'error');
            throw error;
        }
    }
}

class TeachVerifySubmitHandler extends Handler {
    async post(raw: unknown) {
        const attempt = begin(this);
        try {
            await runSubmit(this, attempt, readRaw(raw));
        } catch (error) {
            logAttempt(attempt, error instanceof Error ? error.name : 'error');
            throw error;
        }
    }
}

export async function apply(ctx: {
    Route: (name: string, path: string, HandlerClass: new (...args: unknown[]) => Handler) => void;
}): Promise<void> {
    ctx.Route('teach_verify_objective', '/teach/:type/:id/verify/objective', TeachVerifyObjectiveHandler);
    ctx.Route('teach_verify_submit', '/teach/:type/:id/verify/submit', TeachVerifySubmitHandler);
}
