import { PERM, PRIV } from '@hydrooj/common/permission';
import { parseTeachType, teachDocKind, teachTypeOfContestRule, type TeachType } from '@hydrooj/common';
import { Handler } from '@hydrooj/framework';
import { ObjectId } from 'mongodb';
import { Logger } from '@hydrooj/utils';
import {
    ContestNotFoundError,
    localizeError,
    localizedErrorText,
    NotFoundError,
    PermissionError,
    TrainingNotFoundError,
    ValidationError,
} from '../error';
import type { Tdoc, TrainingDoc } from '../interface';
import { buildTeachPaperExport } from '../lib/teach-paper-export';
import { isProblemSetKind } from '../lib/training-kind';
import * as contest from '../model/contest';
import * as training from '../model/training';

const logger = new Logger('teach-paper');

// teach-access pulls model/builtin, which writes global.Hydro.model at import time.
// The paper export test never creates Hydro, so these predicates stay beside the route.
interface TeachActor {
    _id: number;
    own(doc: { owner: number; maintainer?: number[] }, exact?: boolean): boolean;
    hasPerm(...perm: bigint[]): boolean;
    hasPriv(...priv: number[]): boolean;
}

type TeachDoc = Tdoc | TrainingDoc;

function teachMissing(): never {
    throw localizeError(new NotFoundError(), '题目集不存在');
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNamedError(error: unknown, name: string): boolean {
    return error instanceof Error && error.name === name;
}

function canManagePractice(actor: TeachActor, doc: TeachDoc): boolean {
    if (actor.hasPriv(PRIV.PRIV_EDIT_SYSTEM)) return true;
    if (actor.hasPerm(PERM.PERM_EDIT_TRAINING)) return true;
    return actor.own(doc) && actor.hasPerm(PERM.PERM_EDIT_TRAINING_SELF);
}

function canManageHomework(actor: TeachActor, doc: TeachDoc): boolean {
    return actor.hasPriv(PRIV.PRIV_EDIT_SYSTEM)
        || (actor.own(doc) ? actor.hasPerm(PERM.PERM_EDIT_HOMEWORK_SELF) : actor.hasPerm(PERM.PERM_EDIT_HOMEWORK));
}

function canManageContest(actor: TeachActor, doc: TeachDoc): boolean {
    return actor.hasPriv(PRIV.PRIV_EDIT_SYSTEM)
        || (actor.own(doc) ? actor.hasPerm(PERM.PERM_EDIT_CONTEST_SELF) : actor.hasPerm(PERM.PERM_EDIT_CONTEST));
}

function canManageTeachContainer(actor: TeachActor, type: TeachType, doc: TeachDoc): boolean {
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

async function loadContest(domainId: string, type: TeachType, id: ObjectId): Promise<Tdoc> {
    let doc: Tdoc;
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

async function loadPractice(domainId: string, id: ObjectId): Promise<TrainingDoc> {
    let doc: TrainingDoc;
    try {
        doc = await training.get(domainId, id);
    } catch (error) {
        if (error instanceof TrainingNotFoundError || isNamedError(error, 'TrainingNotFoundError')) teachMissing();
        throw error;
    }
    if (!doc || !isProblemSetKind(doc.kind)) teachMissing();
    return doc;
}

async function assertTeachManage(domainId: string, actor: TeachActor, type: TeachType, id: ObjectId): Promise<TeachDoc> {
    const doc = teachDocKind(type) === 'training' ? await loadPractice(domainId, id) : await loadContest(domainId, type, id);
    if (!canManageTeachContainer(actor, type, doc)) {
        logger.warn(
            'teach paper export domain=%s uid=%d type=%s id=%s stage=authorize result=denied',
            domainId,
            actor._id,
            type,
            id.toHexString(),
        );
        throw localizeError(new PermissionError(), '你不能管理这个题目集。');
    }
    return doc;
}

function authoritativeDomainId(handler: Handler & { domain?: { _id?: unknown } }): string {
    const domainId = handler.domain?._id;
    if (typeof domainId !== 'string' || !domainId) {
        throw new ValidationError('domainId', null, localizedErrorText`域无效。`);
    }
    return domainId;
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

function readAnswers(raw: unknown): boolean {
    if (raw === undefined || raw === null || raw === '' || raw === false || raw === 0 || raw === '0') return false;
    if (raw === true || raw === 1 || raw === '1') return true;
    throw new ValidationError('answers', null, localizedErrorText`答案参数无效。`);
}

class TeachPaperHandler extends Handler {
    async get(raw: unknown) {
        const domainId = authoritativeDomainId(this);
        if (!isRecord(raw)) throw new ValidationError('query', null, localizedErrorText`查询参数无效。`);
        const type = parseType(raw.type);
        const id = parseId(raw.id);
        const answers = readAnswers(raw.answers);
        const actor = this.user as TeachActor;
        const doc = await assertTeachManage(domainId, actor, type, id);
        const body = await buildTeachPaperExport(domainId, type, doc, answers);
        logger.info(
            'teach paper export domain=%s uid=%d type=%s id=%s answers=%s sections=%d stage=export result=ok',
            domainId,
            actor._id,
            type,
            id.toHexString(),
            answers ? '1' : '0',
            body.sections.length,
        );
        this.response.body = body;
        this.response.template = 'teach_paper_print.html';
    }
}

export async function apply(ctx: {
    Route: (name: string, path: string, HandlerClass: typeof TeachPaperHandler) => void;
}): Promise<void> {
    ctx.Route('teach_paper', '/teach/:type/:id/paper', TeachPaperHandler);
}
