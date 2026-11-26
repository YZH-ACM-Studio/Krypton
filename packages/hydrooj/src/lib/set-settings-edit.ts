import { parseSetConfig, parseSetSettings } from '@hydrooj/common';
import { localizedErrorText, ValidationError } from '../error';
import type { Tdoc } from '../interface';
import { allowsPostContestPractice, allowsPostContestSubmit, allowsPostContestView } from './contest-correction';
import { contestAllowsVirtual } from './virtual-contest';

export function planSetSettingsUpdate(current: unknown, nextSettings: unknown, roundCount: number, expectedRevision?: number) {
    const currentConfig = parseSetConfig(current);
    if (expectedRevision !== undefined && expectedRevision !== currentConfig.revision) throw new TypeError('set_config_revision_conflict');
    const parsed = parseSetSettings(nextSettings);
    if (
        roundCount > 0
        && (
            currentConfig.settings.codePolicy !== parsed.codePolicy
            || JSON.stringify(currentConfig.settings.draw) !== JSON.stringify(parsed.draw)
        )
    ) {
        throw new TypeError('set_structure_locked');
    }
    return { setConfig: { ...currentConfig, settings: parsed, revision: currentConfig.revision + 1 } };
}

export const SET_CONTEST_OPTION_KEYS = [
    'allowVirtual', 'allowPostContestView', 'allowPostContestPractice', 'allowPostContestSubmit', 'allowViewCode', 'allowPrint',
] as const;

export type SetContestOptions = Record<(typeof SET_CONTEST_OPTION_KEYS)[number], boolean>;

/** These defaults match the existing contest runtime gates. */
export function setContestOptions(doc: Partial<SetContestOptions>): SetContestOptions {
    for (const key of SET_CONTEST_OPTION_KEYS) {
        if (doc[key] !== undefined && typeof doc[key] !== 'boolean') throw new TypeError(`invalid contest option: ${key}`);
    }
    return {
        allowVirtual: contestAllowsVirtual(doc),
        allowPostContestView: allowsPostContestView(doc),
        allowPostContestPractice: allowsPostContestPractice(doc),
        allowPostContestSubmit: allowsPostContestSubmit(doc),
        allowViewCode: doc.allowViewCode === true,
        allowPrint: doc.allowPrint === true,
    };
}

export function postedSetContestOptions(body: Record<string, unknown>): Partial<SetContestOptions> {
    const result: Partial<SetContestOptions> = {};
    for (const key of SET_CONTEST_OPTION_KEYS) {
        if (!Object.hasOwn(body, key)) continue;
        if (typeof body[key] !== 'boolean') throw new TypeError(`invalid contest option: ${key}`);
        result[key] = body[key];
    }
    return result;
}

export interface SetBasicInfo {
    title: string;
    content: string;
    beginAt: string | null;
    endAt: string | null;
    maintainer: number[];
    hidden: boolean;
}

export function parseSetBasicInfo(raw: unknown): SetBasicInfo {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new ValidationError('basic', null, localizedErrorText`基本信息无效。`);
    const value = raw as Record<string, unknown>;
    const keys = ['title', 'content', 'beginAt', 'endAt', 'maintainer', 'hidden'];
    if (Object.keys(value).some((key) => !keys.includes(key)) || keys.some((key) => !Object.hasOwn(value, key))) {
        throw new ValidationError('basic', null, localizedErrorText`基本信息字段不完整或包含未知字段。`);
    }
    if (typeof value.title !== 'string' || !/^.{1,64}$/.test(value.title.trim())) {
        throw new ValidationError('title', null, localizedErrorText`标题须为 1 到 64 个字符。`);
    }
    if (typeof value.content !== 'string' || value.content.length >= 65536) {
        throw new ValidationError('content', null, localizedErrorText`说明须少于 65536 个字符。`);
    }
    const unscheduled = value.beginAt === null && value.endAt === null;
    if (!unscheduled && (typeof value.beginAt !== 'string' || typeof value.endAt !== 'string'
        || !Number.isFinite(Date.parse(value.beginAt)) || !Number.isFinite(Date.parse(value.endAt))
        || Date.parse(value.beginAt) >= Date.parse(value.endAt))) {
        throw new ValidationError('beginAt', 'endAt', localizedErrorText`结束时间须晚于开放时间。`);
    }
    if (!Array.isArray(value.maintainer) || value.maintainer.some((uid) => !Number.isSafeInteger(uid) || uid <= 0)
        || new Set(value.maintainer).size !== value.maintainer.length) {
        throw new ValidationError('maintainer', null, localizedErrorText`协作者编号必须是互不重复的正整数。`);
    }
    if (typeof value.hidden !== 'boolean') throw new ValidationError('hidden', null, localizedErrorText`列表显示设置无效。`);
    return {
        title: value.title.trim(), content: value.content.trim(),
        beginAt: unscheduled ? null : new Date(value.beginAt as string).toISOString(),
        endAt: unscheduled ? null : new Date(value.endAt as string).toISOString(),
        maintainer: value.maintainer, hidden: value.hidden,
    };
}

export function setBasicInfo(doc: Tdoc): SetBasicInfo {
    return parseSetBasicInfo({
        title: doc.title, content: doc.content, beginAt: doc.beginAt?.toISOString() ?? null, endAt: doc.endAt?.toISOString() ?? null,
        maintainer: doc.maintainer ?? [], hidden: doc.hidden ?? false,
    });
}
