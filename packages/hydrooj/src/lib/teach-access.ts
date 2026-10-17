import { parseTeachType, teachDocKind, teachTypeOfContestRule, type TeachType } from '@hydrooj/common';
import { ObjectId } from 'mongodb';
import {
    ContestNotFoundError,
    localizeError,
    NotFoundError,
    PermissionError,
    TrainingNotFoundError,
} from '../error';
import type { Tdoc, TrainingDoc } from '../interface';
import { PERM, PRIV } from '../model/builtin';
import * as contest from '../model/contest';
import * as training from '../model/training';
import { isProblemSetKind } from './training-kind';

export interface TeachActor {
    _id: number;
    own(doc: { owner: number; maintainer?: number[] }, exact?: boolean): boolean;
    hasPerm(...perm: bigint[]): boolean;
    hasPriv(...priv: number[]): boolean;
}

export type TeachDoc = Tdoc | TrainingDoc;

function teachMissing(): never {
    throw localizeError(new NotFoundError(), '题目集不存在');
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

/** Same predicates as the old homework, contest, and problem-set edit pages. */
export function canManageTeachContainer(actor: TeachActor, type: TeachType, doc: TeachDoc): boolean {
    const parsed = parseTeachType(type);
    if (parsed === 'practice') return canManagePractice(actor, doc);
    if (parsed === 'homework') return canManageHomework(actor, doc);
    if (parsed === 'exam' || parsed === 'acm' || parsed === 'oi') return canManageContest(actor, doc);
    const unreachable: never = parsed;
    throw new TypeError(`teach_type_invalid:${String(unreachable)}`);
}

export function canCreateTeachType(actor: TeachActor, type: TeachType): boolean {
    const parsed = parseTeachType(type);
    if (actor.hasPriv(PRIV.PRIV_EDIT_SYSTEM)) return true;
    if (parsed === 'practice') return actor.hasPerm(PERM.PERM_CREATE_TRAINING);
    if (parsed === 'homework') return actor.hasPerm(PERM.PERM_CREATE_HOMEWORK);
    if (parsed === 'exam' || parsed === 'acm' || parsed === 'oi') return actor.hasPerm(PERM.PERM_CREATE_CONTEST);
    const unreachable: never = parsed;
    throw new TypeError(`teach_type_invalid:${String(unreachable)}`);
}

export function teachRoleOf(actor: TeachActor, doc: TeachDoc): 'owner' | 'maintainer' | 'admin' {
    if (doc.owner === actor._id) return 'owner';
    if ((doc.maintainer || []).includes(actor._id)) return 'maintainer';
    return 'admin';
}

/** Homework stays visible when its contest rule is hidden. Every other hidden rule does not exist here. */
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

export async function loadTeachContainer(domainId: string, type: TeachType, id: ObjectId): Promise<TeachDoc> {
    const parsed = parseTeachType(type);
    if (teachDocKind(parsed) === 'training') return loadPractice(domainId, id);
    return loadContest(domainId, parsed, id);
}

export async function assertTeachManage(domainId: string, actor: TeachActor, type: TeachType, id: ObjectId): Promise<TeachDoc> {
    const doc = await loadTeachContainer(domainId, type, id);
    if (!canManageTeachContainer(actor, type, doc)) {
        throw localizeError(new PermissionError(), '你不能管理这个题目集。');
    }
    return doc;
}
