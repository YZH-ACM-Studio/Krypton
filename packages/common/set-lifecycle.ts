import {
    createDraftConfig,
    parseSetConfig,
    parseSetSettings,
    readStoredSetConfig,
    type SetConfig,
    type SetPurpose,
} from './set-config';

const TITLE_PATTERN = /^.{1,64}$/;

export const SET_LIFECYCLE_TEXT = Object.freeze({
    set_title_invalid: {
        zh: '标题需要 1 到 64 个字符。',
        en: 'The title must be 1 to 64 characters.',
    },
    set_not_published: {
        zh: '题目集尚未发布。',
        en: 'This problem set is not published.',
    },
});

function fail(code: keyof typeof SET_LIFECYCLE_TEXT): never {
    throw new TypeError(code);
}

export function setLifecycleMessage(code: string): string {
    const text = SET_LIFECYCLE_TEXT[code as keyof typeof SET_LIFECYCLE_TEXT];
    if (!text) throw new TypeError('set_title_invalid');
    return text.zh;
}

/** Same acceptance rule as Hydro `Types.Title`: 1–64 raw characters, and not blank after trimming. */
export function normalizeSetTitle(value: unknown): string {
    if (typeof value !== 'string' || !TITLE_PATTERN.test(value) || !value.trim()) fail('set_title_invalid');
    return value.trim();
}

/** Audit label stored in the old `rule` field. It does not select scoring. */
export function auditRuleForPurpose(purpose: SetPurpose): 'homework' | 'exam' | 'contest' {
    const config = createDraftConfig(purpose);
    return config.purpose;
}

export interface SetDraftFields {
    title: string;
    content: string;
    rule: 'homework' | 'exam' | 'contest';
    pids: number[];
    rated: false;
    attend: 0;
    setConfig: SetConfig;
}

export function buildDraftFields(purpose: SetPurpose, title: unknown): SetDraftFields {
    return {
        title: normalizeSetTitle(title),
        content: '',
        rule: auditRuleForPurpose(purpose),
        pids: [],
        rated: false,
        attend: 0,
        setConfig: createDraftConfig(purpose),
    };
}

export function copyConfigAsDraft(source: SetConfig): SetConfig {
    const parsed = parseSetConfig(source);
    return {
        schemaVersion: parsed.schemaVersion,
        purpose: parsed.purpose,
        publication: 'draft',
        revision: 1,
        settings: parseSetSettings(parsed.settings),
    };
}

/**
 * Students, calendars, courses, and direct links use this.
 * A draft is invisible. A missing or illegal configuration fails instead of being treated as published.
 */
export function publishedSetConfig(doc: unknown): SetConfig | null {
    const config = readStoredSetConfig(doc);
    if (config.publication !== 'published') return null;
    return config;
}
