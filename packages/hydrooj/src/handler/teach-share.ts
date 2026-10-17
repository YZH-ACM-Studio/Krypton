import { parseTeachType, type TeachType } from '@hydrooj/common';
import { ObjectId } from 'mongodb';
import { localizeError, localizedErrorText, NotFoundError, ValidationError } from '../error';
import { loadTeachShareState, updateTeachShare } from '../model/teach-share';
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

class TeachShareHandler extends Handler {
    @param('type', Types.String)
    @param('id', Types.String)
    async get(_domainId: string, typeRaw: string, idRaw: string) {
        const domainId = authoritativeDomainId(this);
        const type = parseType(typeRaw);
        const id = parseId(idRaw);
        this.response.template = null;
        this.response.body = await loadTeachShareState(domainId, this.user, type, id);
    }

    @param('type', Types.String)
    @param('id', Types.String)
    async post(_domainId: string, typeRaw: string, idRaw: string) {
        const domainId = authoritativeDomainId(this);
        const type = parseType(typeRaw);
        const id = parseId(idRaw);
        this.response.template = null;
        this.response.body = await updateTeachShare(domainId, this.user, type, id, this.request.json ? this.request.body : this.args);
    }
}

export async function apply(ctx) {
    ctx.Route('teach_share', '/teach/:type/:id/share', TeachShareHandler);
}
