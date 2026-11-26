import { ObjectId } from 'mongodb';
import {
    parseTeachType,
    publishDraftConfig,
    SET_CREATE_TEXT,
    setAudienceConfirmed,
    setConfigMessage,
    type TeachType,
} from '@hydrooj/common';
import { localizeError, localizedErrorText, NotFoundError, ValidationError } from '../error';
import type { Tdoc } from '../interface';
import { withContestEditBoundary } from '../lib/contest-edit-boundary';
import { loadSetPublishFacts } from '../lib/set-publish-facts';
import { assertTeachManage } from '../lib/teach-access';
import { buildTeachComposePayload, buildTeachWorkbenchPayload } from '../lib/teach-workbench';
import * as contest from '../model/contest';
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

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

class TeachPublishHandler extends Handler {
    @param('type', Types.String)
    @param('id', Types.String)
    async post(_domainId: string, typeRaw: string, idRaw: string) {
        const domainId = authoritativeDomainId(this);
        const type = parseType(typeRaw);
        const id = parseId(idRaw);
        return withContestEditBoundary(domainId, id, () => this.publish(domainId, type, id));
    }

    async publish(domainId: string, type: TeachType, id: ObjectId) {
        if (type === 'practice') {
            throw new ValidationError('type', null, localizedErrorText`练习仍从练习入口发布。`);
        }
        const doc = await assertTeachManage(domainId, this.user, type, id) as Tdoc;
        const body = isRecord(this.request.body) ? this.request.body : this.args;
        const confirmed = setAudienceConfirmed(doc) || body.confirmAudience === true;
        if (!confirmed) throw new ValidationError('audience', null, localizedErrorText`请先确认给谁做。`);
        let next;
        try {
            const confirmedDoc = { ...doc, setAudienceConfirmed: true };
            next = publishDraftConfig(
                confirmedDoc,
                await loadSetPublishFacts(confirmedDoc),
            );
        } catch (error) {
            if (error instanceof TypeError) {
                let text = '题目集还不能发布。';
                try {
                    text = setConfigMessage(error.message);
                } catch {
                    const created = SET_CREATE_TEXT[error.message as keyof typeof SET_CREATE_TEXT];
                    if (created) text = created.zh;
                }
                throw new ValidationError('set', null, localizedErrorText`${text}`);
            }
            throw error;
        }
        await contest.edit(domainId, id, { setConfig: next, setAudienceConfirmed: true });
        this.response.body = { publication: next.publication };
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
    ctx.Route('teach_publish', '/teach/:type/:id/publish', TeachPublishHandler);
    ctx.Route('teach_compose', '/teach/:type/:id/compose', TeachComposeHandler);
    ctx.Route('teach_workbench', '/teach/:type/:id', TeachWorkbenchHandler);
}
