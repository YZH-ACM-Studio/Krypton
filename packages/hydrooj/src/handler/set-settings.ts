import { assertSetPublishable, parseSetConfig, parseTeachType, setConfigMessage, type TeachType } from '@hydrooj/common';
import { randomUUID } from 'node:crypto';
import { Logger } from '@hydrooj/utils';
import { ObjectId } from 'mongodb';
import { localizeError, LocalizedErrorText, NotFoundError, ValidationError } from '../error';
import { parseSetBasicInfo, planSetSettingsUpdate, postedSetContestOptions, setBasicInfo, setContestOptions } from '../lib/set-settings-edit';
import { loadSetPublishFacts } from '../lib/set-publish-facts';
import { withContestEditBoundary } from '../lib/contest-edit-boundary';
import { assertTeachManage } from '../lib/teach-access';
import { assertGroupsAttachable, listAttachableGroups, describeGroupRefs } from '../lib/user-group-attach';
import type { Tdoc } from '../interface';
import { PRIV } from '../model/builtin';
import * as contest from '../model/contest';
import db from '../service/db';
import * as setting from '../model/setting';
import { Handler, param, Types } from '../service/server';
import { scheduleContestUnhide } from './contest';

const logger = new Logger('set-settings');

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function chineseError(message: string): LocalizedErrorText {
    const strings = [message] as unknown as TemplateStringsArray;
    Object.defineProperty(strings, 'raw', { value: [message] });
    return new LocalizedErrorText(strings, []);
}

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

function rejectSettings(error: unknown): never {
    if (error instanceof TypeError && error.message === 'set_config_revision_conflict') {
        throw new ValidationError('setConfig', null, chineseError('设置已经更新，请刷新后再保存。'));
    }
    if (error instanceof TypeError && error.message === 'set_structure_locked') {
        throw new ValidationError('setConfig', null, chineseError('已经有人开始作答，不能再改计分方式或抽题。'));
    }
    if (error instanceof TypeError) {
        let text: string | null = null;
        try {
            text = setConfigMessage(error.message);
        } catch {
            text = null;
        }
        if (text) throw new ValidationError('setConfig', null, chineseError(text));
    }
    throw error;
}

function postedSettings(handler: Handler): unknown {
    const body = handler.request?.body;
    if (isRecord(body) && Object.hasOwn(body, 'settings')) return body.settings;
    if (isRecord(handler.args) && Object.hasOwn(handler.args, 'settings')) return handler.args.settings;
    throw new ValidationError('settings', null, chineseError('请求参数无效。'));
}

function storedConfig(doc: unknown): unknown {
    if (!isRecord(doc)) return undefined;
    return doc.setConfig;
}

class SetSettingsHandler extends Handler {
    async load(typeRaw: string, idRaw: string) {
        this.checkPriv(PRIV.PRIV_USER_PROFILE);
        const domainId = this.domain?._id;
        if (typeof domainId !== 'string' || !domainId) throw new ValidationError('domainId', null, chineseError('域无效。'));
        const type = parseType(typeRaw);
        if (type === 'practice') throw new ValidationError('type', null, chineseError('练习不能在这里改设置。'));
        const id = parseId(idRaw);
        await assertTeachManage(domainId, this.user, type, id);
        const tdoc = await contest.get(domainId, id);
        return { domainId, type, id, tdoc };
    }

    @param('type', Types.String)
    @param('id', Types.String)
    async get(_domainId: string, typeRaw: string, idRaw: string) {
        const loaded = await this.load(typeRaw, idRaw);
        let config;
        try {
            config = parseSetConfig(storedConfig(loaded.tdoc));
        } catch (error) {
            rejectSettings(error);
        }
        this.response.template = null;
        const unrestricted = this.user.hasPriv(PRIV.PRIV_EDIT_SYSTEM);
        const [available, referenced] = await Promise.all([
            listAttachableGroups(loaded.domainId, this.user, { unrestricted }),
            describeGroupRefs(loaded.domainId, this.user, (config.settings.authorization?.groups ?? []).map((group) => new ObjectId(group.groupId)), { unrestricted }),
        ]);
        const groups = [...new Map([...available, ...referenced].map((group) => [group._id, group])).values()];
        this.response.body = { basic: setBasicInfo(loaded.tdoc), settings: config.settings, revision: config.revision,
            langs: loaded.tdoc.langs ?? [], languageOptions: Object.entries(setting.langs).filter(([, lang]) => !lang.disabled && !lang.hidden)
                .map(([value, lang]) => ({ value, label: lang.display || value })), groups,
            lockAt: loaded.tdoc.lockAt?.toISOString() ?? null, ...setContestOptions(loaded.tdoc) };
    }

    @param('type', Types.String)
    @param('id', Types.String)
    async post(_domainId: string, typeRaw: string, idRaw: string) {
        const tid = parseId(idRaw);
        return withContestEditBoundary(this.domain._id, tid, async () => this.saveSettings(typeRaw, idRaw));
    }

    async saveSettings(typeRaw: string, idRaw: string) {
        const loaded = await this.load(typeRaw, idRaw);
        const settings = postedSettings(this);
        const body = isRecord(this.request.body) ? this.request.body : this.args;
        const expectedRevision = body.expectedRevision;
        if (typeof expectedRevision !== 'number' || !Number.isSafeInteger(expectedRevision)) {
            throw new ValidationError('expectedRevision', null, chineseError('设置版本无效，请刷新后再保存。'));
        }
        const basic = Object.hasOwn(body, 'basic') ? parseSetBasicInfo(body.basic) : null;
        const basicPatch: Partial<Tdoc> = {};
        if (basic) {
            const { beginAt, endAt, ...metadata } = basic;
            Object.assign(basicPatch, metadata);
            if (beginAt !== null && endAt !== null) {
                basicPatch.beginAt = new Date(beginAt);
                basicPatch.endAt = new Date(endAt);
            } else if (loaded.tdoc.beginAt || loaded.tdoc.endAt || parseSetConfig(storedConfig(loaded.tdoc)).publication === 'published') {
                throw new ValidationError('beginAt', 'endAt', chineseError('请填写完整的开放和结束时间。'));
            }
        }
        const candidate = { ...loaded.tdoc, ...basicPatch };
        let lockAt = loaded.tdoc.lockAt ?? null;
        if (Object.hasOwn(body, 'lockAt')) {
            if (body.lockAt === null) lockAt = null;
            else if (typeof body.lockAt === 'string') {
                lockAt = new Date(body.lockAt);
                if (!Number.isFinite(lockAt.getTime()) || !(candidate.beginAt instanceof Date) || !(candidate.endAt instanceof Date)
                    || lockAt < candidate.beginAt || lockAt >= candidate.endAt) {
                    throw new ValidationError('lockAt', null, chineseError('封榜时间必须在开放时间内。'));
                }
            } else throw new ValidationError('lockAt');
        }
        if (lockAt && (!(candidate.beginAt instanceof Date) || !(candidate.endAt instanceof Date)
            || lockAt < candidate.beginAt || lockAt >= candidate.endAt)) {
            throw new ValidationError('lockAt', null, chineseError('封榜时间必须在开放时间内。'));
        }
        let contestOptions;
        try {
            contestOptions = postedSetContestOptions(body);
        } catch (error) {
            if (!(error instanceof TypeError)) throw error;
            throw new ValidationError('contestOptions', null, chineseError('比赛设置必须是布尔值。'));
        }
        const roundCount = await db.collection('contest.rounds').countDocuments({ domainId: loaded.domainId, tid: loaded.id });
        const before = parseSetConfig(storedConfig(loaded.tdoc)).settings;
        let clearPoints = false;
        let result;
        try {
            result = planSetSettingsUpdate(storedConfig(loaded.tdoc), settings, roundCount, expectedRevision);
            clearPoints = before.codePolicy !== 'acm' && result.setConfig.settings.codePolicy === 'acm';
            if (clearPoints) {
                delete candidate.setPoints;
                delete candidate.setTargetScore;
            }
            if (result.setConfig.publication === 'published') {
                assertSetPublishable(result.setConfig, await loadSetPublishFacts(candidate, result.setConfig));
            }
        } catch (error) {
            rejectSettings(error);
        }
        const after = result.setConfig.settings;
        if (JSON.stringify(before.authorization) !== JSON.stringify(after.authorization)) {
            await assertGroupsAttachable(loaded.domainId, this.user, {
                field: 'authorization.groups', unrestricted: this.user.hasPriv(PRIV.PRIV_EDIT_SYSTEM),
                previous: (before.authorization?.groups ?? []).map((group) => new ObjectId(group.groupId)),
                next: (after.authorization?.groups ?? []).map((group) => new ObjectId(group.groupId)),
            });
        }
        let langs = loaded.tdoc.langs ?? [];
        if (Object.hasOwn(body, 'langs')) {
            if (!Array.isArray(body.langs) || body.langs.some((value) => typeof value !== 'string' || !setting.langs[value] || setting.langs[value].disabled || setting.langs[value].hidden)
                || new Set(body.langs).size !== body.langs.length) throw new ValidationError('langs', null, chineseError('编译器选择无效。'));
            langs = body.langs;
        }
        const scheduleChanged = candidate.beginAt?.getTime() !== loaded.tdoc.beginAt?.getTime()
            || candidate.endAt?.getTime() !== loaded.tdoc.endAt?.getTime();
        const needsRecalc = Boolean(loaded.tdoc.statusRecalcToken) || (roundCount > 0 && (scheduleChanged || JSON.stringify(before.late) !== JSON.stringify(after.late)
            || before.retake.pick !== after.retake.pick || before.retake.passScore !== after.retake.passScore));
        const lockChanged = (loaded.tdoc.lockAt?.getTime() ?? null) !== (lockAt?.getTime() ?? null);
        const patch = {
            ...basicPatch, setConfig: result.setConfig, lockAt, langs, ...contestOptions,
            ...(lockChanged ? { unlocked: false } : {}),
            ...(needsRecalc ? { statusRecalcToken: randomUUID() } : {}),
        };
        await contest.edit(loaded.domainId, loaded.id, patch, clearPoints ? { unset: { setPoints: true, setTargetScore: true } } : {});
        if (basic && candidate.autoHide && candidate.endAt instanceof Date) {
            try {
                await scheduleContestUnhide(loaded.domainId, loaded.id, candidate.endAt, candidate.autoHideProblemPids ?? candidate.pids);
            } catch (error) {
                logger.error('Problem set schedule update failed domain=%s tid=%s revision=%d stage=schedule-unhide error=%o',
                    loaded.domainId, loaded.id.toHexString(), result.setConfig.revision, error);
                throw error;
            }
        }
        if (needsRecalc) await contest.recalcConfiguredSet({ ...loaded.tdoc, ...patch });
        logger.info(
            'problem set settings updated domain=%s tid=%s type=%s rounds=%d revision=%d basic=%s',
            loaded.domainId,
            loaded.id.toHexString(),
            loaded.type,
            roundCount,
            result.setConfig.revision,
            Boolean(basic),
        );
        this.response.template = null;
        this.response.body = { basic: setBasicInfo(candidate), settings: result.setConfig.settings, revision: result.setConfig.revision, langs,
            lockAt: lockAt?.toISOString() ?? null, ...setContestOptions({ ...loaded.tdoc, ...contestOptions }) };
    }
}

export async function apply(ctx: { Route: (name: string, path: string, HandlerClass: typeof Handler, priv?: number) => void }) {
    ctx.Route('set_settings', '/teach/:type/:id/set-settings', SetSettingsHandler, PRIV.PRIV_USER_PROFILE);
}
