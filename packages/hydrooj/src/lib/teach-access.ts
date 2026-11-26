import { parseTeachType, readStoredSetConfig, teachDocKind, teachTypeOfContestRule, type TeachType } from '@hydrooj/common';
import { ObjectId } from 'mongodb';
import {
    ContestNotFoundError,
    localizeError,
    NotFoundError,
    PermissionError,
    TrainingNotFoundError,
} from '../error';
import type { Tdoc, TrainingDoc } from '../interface';
import * as contest from '../model/contest';
import * as training from '../model/training';
import { isProblemSetKind } from './training-kind';

import { canManageTeachContainer, type TeachActor, type TeachDoc } from './teach-permissions';
export { canCreateTeachType, canManageTeachContainer, type TeachActor, type TeachDoc, teachRoleOf } from './teach-permissions';

function teachMissing(): never {
    throw localizeError(new NotFoundError(), '题目集不存在');
}

function isNamedError(error: unknown, name: string): boolean {
    return error instanceof Error && error.name === name;
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
    if (doc.rule === 'contest') {
        let purpose: string;
        try {
            purpose = readStoredSetConfig(doc).purpose;
        } catch (error) {
            if (error instanceof TypeError && error.message === 'set_config_missing') teachMissing();
            throw error;
        }
        if (purpose !== 'contest' || type !== 'exam') teachMissing();
        return doc;
    }
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
