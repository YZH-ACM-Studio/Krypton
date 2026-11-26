import {
    assertCanCreateSetKind,
    assertSetPublishable,
    readStoredSetConfig,
    type SetConfig,
    type SetCreateKind,
    type SetPublishFacts,
    type SetPurpose,
} from './set-config';

export interface SetCreateRights {
    privEditSystem: boolean;
    createHomework: boolean;
    createExam: boolean;
    createPractice: boolean;
}

function failForbidden(): never {
    throw new TypeError('set_create_kind_forbidden');
}

export const SET_CREATE_TEXT = Object.freeze({
    set_publish_state_invalid: {
        zh: '只有草稿可以发布。',
        en: 'Only a draft can be published.',
    },
});

/**
 * Purpose gate plus the existing create bits.
 * A contest-purpose set still requires system edit, even when the actor can create an exam.
 */
export function assertSetCreateAllowed(rights: SetCreateRights, kind: unknown): SetCreateKind {
    if (
        typeof rights?.privEditSystem !== 'boolean' ||
        typeof rights.createHomework !== 'boolean' ||
        typeof rights.createExam !== 'boolean' ||
        typeof rights.createPractice !== 'boolean'
    ) {
        throw new TypeError('set_create_kind_invalid');
    }
    const parsed = assertCanCreateSetKind(kind, rights.privEditSystem);
    if (rights.privEditSystem) return parsed;
    if (parsed === 'homework' && rights.createHomework) return parsed;
    if (parsed === 'exam' && rights.createExam) return parsed;
    if (parsed === 'practice' && rights.createPractice) return parsed;
    failForbidden();
}

export function legacyRuleCreateKind(rule: unknown): SetPurpose {
    if (rule === 'homework') return 'homework';
    if (rule === 'exam') return 'exam';
    if (rule === 'acm' || rule === 'oi' || rule === 'ioi' || rule === 'strictioi' || rule === 'ledo' || rule === 'contest') return 'contest';
    throw new TypeError('set_create_kind_invalid');
}

export function isContestPurpose(kind: SetCreateKind): kind is SetPurpose {
    return kind === 'homework' || kind === 'exam' || kind === 'contest';
}

/** Audience is confirmed only by an explicit save. A missing flag is not “everyone”. */
export function setAudienceConfirmed(doc: unknown): boolean {
    return typeof doc === 'object' && doc !== null && !Array.isArray(doc) && (doc as { setAudienceConfirmed?: unknown }).setAudienceConfirmed === true;
}

export function publishDraftConfig(doc: unknown, facts: SetPublishFacts): SetConfig {
    const config = readStoredSetConfig(doc);
    if (config.publication !== 'draft') throw new TypeError('set_publish_state_invalid');
    assertSetPublishable(config, facts);
    return {
        ...config,
        publication: 'published',
    };
}
