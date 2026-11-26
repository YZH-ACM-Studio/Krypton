import { parseTeachType, type TeachType } from '@hydrooj/common';
import type { Tdoc, TrainingDoc } from '../interface';
import { PERM, PRIV } from '../model/builtin';

export interface TeachActor {
    _id: number;
    own(doc: { owner: number; maintainer?: number[] }, exact?: boolean): boolean;
    hasPerm(...perm: bigint[]): boolean;
    hasPriv(...priv: number[]): boolean;
}

export type TeachDoc = Tdoc | TrainingDoc;

function canManagePractice(actor: TeachActor, doc: TeachDoc): boolean {
    if (actor.hasPriv(PRIV.PRIV_EDIT_SYSTEM)) return true;
    if (actor.hasPerm(PERM.PERM_EDIT_TRAINING)) return true;
    return actor.own(doc) && actor.hasPerm(PERM.PERM_EDIT_TRAINING_SELF);
}

function canManageHomework(actor: TeachActor, doc: TeachDoc): boolean {
    return (
        actor.hasPriv(PRIV.PRIV_EDIT_SYSTEM) ||
        (actor.own(doc) ? actor.hasPerm(PERM.PERM_EDIT_HOMEWORK_SELF) : actor.hasPerm(PERM.PERM_EDIT_HOMEWORK))
    );
}

function canManageContest(actor: TeachActor, doc: TeachDoc): boolean {
    return (
        actor.hasPriv(PRIV.PRIV_EDIT_SYSTEM) || (actor.own(doc) ? actor.hasPerm(PERM.PERM_EDIT_CONTEST_SELF) : actor.hasPerm(PERM.PERM_EDIT_CONTEST))
    );
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
