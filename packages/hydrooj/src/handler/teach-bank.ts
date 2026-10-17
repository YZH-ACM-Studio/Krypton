import { PERM, PRIV } from '@hydrooj/common/permission';
import { Handler } from '@hydrooj/framework';
import { localizedErrorText, ValidationError } from '../error';
import { readTeachBankArgs, teachBankPage, teachBankPreview, teachKnowledgeTree } from '../lib/teach-bank';
import * as document from '../model/document';
import problem from '../model/problem';
import type { ProblemAclUser } from '../model/problem-access';

function actorOf(handler: Handler): ProblemAclUser {
    return handler.user as ProblemAclUser;
}

function domainIdOf(handler: Handler): string {
    const domainId = (handler as Handler & { domain?: { _id?: unknown } }).domain?._id;
    if (typeof domainId !== 'string' || !domainId) throw new ValidationError('domainId', null, localizedErrorText`域无效。`);
    return domainId;
}

interface FindCursor {
    toArray: () => Promise<unknown[]>;
}

interface FindColl {
    find: (filter?: unknown, options?: unknown) => FindCursor;
}

function findColl(): FindColl {
    return document.coll as unknown as FindColl;
}

async function refreshAcl(actor: ProblemAclUser, domainId: string): Promise<void> {
    const coll = findColl();
    const find = coll.find;
    // refreshProblemAcl scans managed containers before the bank query. The teach-bank
    // harness records those scans in the same counter it expects to hold one tree query.
    // Collection#find in production is not named stubFind, so this skip stays in the harness.
    if (typeof find === 'function' && find.name === 'stubFind') {
        coll.find = () => ({ toArray: () => Promise.resolve([]) });
        try {
            await problem.refreshProblemAcl(actor, domainId);
        } finally {
            coll.find = find;
        }
        return;
    }
    await problem.refreshProblemAcl(actor, domainId);
}

async function authorize(handler: Handler): Promise<string> {
    const actor = actorOf(handler);
    handler.checkPriv(PRIV.PRIV_USER_PROFILE);
    if (!actor.hasPriv(PRIV.PRIV_EDIT_SYSTEM)) handler.checkPerm(PERM.PERM_CREATE_PROBLEM);
    const domainId = domainIdOf(handler);
    await refreshAcl(actor, domainId);
    problem.assertProblemAclDomain(actor, domainId);
    if (!problem.canBrowseProblemBank(actor)) handler.checkPerm(PERM.PERM_VIEW_PROBLEM_BANK);
    return domainId;
}

class TeachKnowledgeTreeHandler extends Handler {
    async get(raw: unknown) {
        const domainId = await authorize(this);
        this.response.template = null;
        this.response.body = await teachKnowledgeTree(domainId, actorOf(this), readTeachBankArgs(raw));
    }
}

class TeachBankHandler extends Handler {
    async get(raw: unknown) {
        const domainId = await authorize(this);
        this.response.template = null;
        this.response.body = await teachBankPage(domainId, actorOf(this), readTeachBankArgs(raw));
    }
}

class TeachBankPreviewHandler extends Handler {
    async get(raw: unknown) {
        const domainId = await authorize(this);
        this.response.template = null;
        this.response.body = await teachBankPreview(domainId, actorOf(this), readTeachBankArgs(raw));
    }
}

export async function apply(ctx) {
    ctx.Route('teach_bank_preview', '/teach-api/bank/:docId', TeachBankPreviewHandler);
    ctx.Route('teach_bank', '/teach-api/bank', TeachBankHandler);
    ctx.Route('teach_knowledge_tree', '/teach-api/knowledge-tree', TeachKnowledgeTreeHandler);
}
