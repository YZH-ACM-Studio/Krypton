import { ObjectId } from 'mongodb';
import { parseTeachType, type TeachType } from '@hydrooj/common';
import { localizeError, localizedErrorText, NotFoundError, ValidationError, type LocalizedErrorText } from '../error';
import { buildTeachNewPayload, loadTeachCopySource, recordTeachProvenance } from '../lib/teach-copy';
import type { TeachActor } from '../lib/teach-access';
import { PRIV } from '../model/builtin';
import { Handler } from '../service/server';

function invalid(field: string, text: LocalizedErrorText): never {
    throw new ValidationError(field, null, text);
}

function missingContainer(): never {
    throw localizeError(new NotFoundError(), '题目集不存在');
}

function isArgs(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function argsOf(raw: unknown): Record<string, unknown> {
    if (!isArgs(raw)) invalid('query', localizedErrorText`请求参数无效。`);
    return raw;
}

function domainIdOf(handler: Handler): string {
    const domainId = handler.domain?._id;
    if (typeof domainId !== 'string' || !domainId) invalid('domainId', localizedErrorText`域无效。`);
    return domainId;
}

function actorOf(handler: Handler): TeachActor {
    const actor = handler.user as TeachActor | undefined;
    if (!actor || typeof actor._id !== 'number' || typeof actor.hasPerm !== 'function' || typeof actor.hasPriv !== 'function' || typeof actor.own !== 'function') {
        invalid('user', localizedErrorText`用户无效。`);
    }
    return actor;
}

function routeType(value: unknown): TeachType {
    if (typeof value !== 'string') missingContainer();
    try {
        return parseTeachType(value);
    } catch (error) {
        if (error instanceof TypeError && error.message === 'teach_type_invalid') missingContainer();
        throw error;
    }
}

function routeId(value: unknown): ObjectId {
    if (typeof value !== 'string' || !/^[0-9a-f]{24}$/i.test(value)) missingContainer();
    return new ObjectId(value);
}

function postedType(value: unknown): TeachType {
    if (typeof value !== 'string') invalid('sourceType', localizedErrorText`来源题目集的类型无效。`);
    try {
        return parseTeachType(value);
    } catch (error) {
        if (error instanceof TypeError && error.message === 'teach_type_invalid') invalid('sourceType', localizedErrorText`来源题目集的类型无效。`);
        throw error;
    }
}

function postedId(value: unknown): ObjectId {
    if (typeof value !== 'string' || !/^[0-9a-f]{24}$/i.test(value)) invalid('sourceId', localizedErrorText`来源题目集的编号无效。`);
    return new ObjectId(value);
}

class TeachNewHandler extends Handler {
    async get(raw: unknown) {
        this.checkPriv(PRIV.PRIV_USER_PROFILE);
        this.response.body = await buildTeachNewPayload(domainIdOf(this), actorOf(this), argsOf(raw));
        this.response.template = 'teach_new.html';
    }
}

class TeachCopyableHandler extends Handler {
    async get(raw: unknown) {
        this.checkPriv(PRIV.PRIV_USER_PROFILE);
        const args = argsOf(raw);
        this.response.body = await loadTeachCopySource(domainIdOf(this), actorOf(this), routeType(args.type), routeId(args.id));
    }
}

class TeachProvenanceHandler extends Handler {
    async post(raw: unknown) {
        this.checkPriv(PRIV.PRIV_USER_PROFILE);
        const args = argsOf(raw);
        await recordTeachProvenance(
            domainIdOf(this),
            actorOf(this),
            routeType(args.type),
            routeId(args.id),
            postedType(args.sourceType),
            postedId(args.sourceId),
        );
        this.response.body = { ok: true };
    }
}

export async function apply(ctx: { Route: (name: string, path: string, HandlerClass: typeof Handler, priv?: number) => void }) {
    ctx.Route('teach_new', '/teach/new', TeachNewHandler, PRIV.PRIV_USER_PROFILE);
    ctx.Route('teach_copyable', '/teach/:type/:id/copyable', TeachCopyableHandler, PRIV.PRIV_USER_PROFILE);
    ctx.Route('teach_provenance', '/teach/:type/:id/provenance', TeachProvenanceHandler, PRIV.PRIV_USER_PROFILE);
}
