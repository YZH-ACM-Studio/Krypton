import { ObjectId } from 'mongodb';
import { parseTeachType, type TeachType } from '@hydrooj/common';
import { localizeError, localizedErrorText, NotFoundError, ValidationError } from '../error';
import { assertTeachManage } from '../lib/teach-access';
import { buildTeachComposePayload, buildTeachWorkbenchPayload } from '../lib/teach-workbench';
import { Handler, param, Types } from '../service/server';

function teachMissing(): never {
    throw localizeError(new NotFoundError(), '题目集不存在');
}

function parseType(value: string): TeachType {
    try {
        return parseTeachType(value);
    } catch (error) {
        if (error instanceof TypeError && error.message === 'teach_type_invalid') teachMissing();
        throw error;
    }
}

function parseId(value: string): ObjectId {
    if (!/^[0-9a-f]{24}$/i.test(value)) teachMissing();
    return new ObjectId(value);
}

function authoritativeDomainId(handler: Handler): string {
    const domainId = handler.domain?._id;
    if (typeof domainId !== 'string' || !domainId) {
        throw new ValidationError('domainId', null, localizedErrorText`域无效。`);
    }
    return domainId;
}

class TeachWorkbenchHandler extends Handler {
    @param('type', Types.String)
    @param('id', Types.String)
    async get(_domainId: string, typeRaw: string, idRaw: string) {
        const domainId = authoritativeDomainId(this);
        const type = parseType(typeRaw);
        const id = parseId(idRaw);
        const doc = await assertTeachManage(domainId, this.user, type, id);
        this.response.body = await buildTeachWorkbenchPayload(domainId, this.user, type, doc);
        this.response.template = 'teach_workbench.html';
    }
}

class TeachComposeHandler extends Handler {
    @param('type', Types.String)
    @param('id', Types.String)
    async get(_domainId: string, typeRaw: string, idRaw: string) {
        const domainId = authoritativeDomainId(this);
        const type = parseType(typeRaw);
        const id = parseId(idRaw);
        const doc = await assertTeachManage(domainId, this.user, type, id);
        this.response.body = await buildTeachComposePayload(domainId, this.user, type, doc);
        this.response.template = 'teach_compose.html';
    }
}

export async function apply(ctx) {
    ctx.Route('teach_compose', '/teach/:type/:id/compose', TeachComposeHandler);
    ctx.Route('teach_workbench', '/teach/:type/:id', TeachWorkbenchHandler);
}
