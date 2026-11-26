/** Optional container rules. Missing rules keep the pre-existing set behavior. */
export interface SetExperience {
    announcement: string;
    discussion: boolean;
    allowSelfTest: boolean;
    autoSaveBeforeEnd: boolean;
    prohibitCodePaste: boolean;
    showDisplayName: boolean;
    showDifficulty: boolean;
    hideTestCases: boolean;
    hideTotalScore: boolean;
}

export const SET_EXPERIENCE_DEFAULTS: Readonly<SetExperience> = Object.freeze({
    announcement: '',
    discussion: true,
    allowSelfTest: true,
    autoSaveBeforeEnd: false,
    prohibitCodePaste: false,
    showDisplayName: false,
    showDifficulty: false,
    hideTestCases: false,
    hideTotalScore: false,
});

export const SET_PROBLEM_PERMISSIONS = ['hidden', 'view', 'answer'] as const;
export const SET_RECORD_PERMISSIONS = ['self', 'list', 'details'] as const;

export interface SetPermissions {
    problems: (typeof SET_PROBLEM_PERMISSIONS)[number];
    records: (typeof SET_RECORD_PERMISSIONS)[number];
    scoreboard: boolean;
    afterEnd: boolean;
}

export interface SetGroupPermission extends SetPermissions {
    groupId: string;
}
export interface SetAuthorization {
    defaults: SetPermissions;
    groups: SetGroupPermission[];
}

export const SET_DEFAULT_PERMISSIONS: Readonly<SetPermissions> = Object.freeze({
    problems: 'answer',
    records: 'self',
    scoreboard: true,
    afterEnd: true,
});

function object(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('set_config_experience_invalid');
    return value as Record<string, unknown>;
}

function exact(value: Record<string, unknown>, keys: readonly string[]) {
    if (Object.keys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key))) {
        throw new TypeError('set_config_experience_invalid');
    }
}

function boolean(value: unknown): boolean {
    if (typeof value !== 'boolean') throw new TypeError('set_config_experience_invalid');
    return value;
}

export function parseSetExperience(value: unknown): SetExperience {
    const raw = object(value);
    exact(raw, Object.keys(SET_EXPERIENCE_DEFAULTS));
    if (typeof raw.announcement !== 'string' || raw.announcement.length >= 65536) throw new TypeError('set_config_experience_invalid');
    return {
        announcement: raw.announcement,
        discussion: boolean(raw.discussion),
        allowSelfTest: boolean(raw.allowSelfTest),
        autoSaveBeforeEnd: boolean(raw.autoSaveBeforeEnd),
        prohibitCodePaste: boolean(raw.prohibitCodePaste),
        showDisplayName: boolean(raw.showDisplayName),
        showDifficulty: boolean(raw.showDifficulty),
        hideTestCases: boolean(raw.hideTestCases),
        hideTotalScore: boolean(raw.hideTotalScore),
    };
}

function permissions(raw: Record<string, unknown>): SetPermissions {
    const problems = SET_PROBLEM_PERMISSIONS.find((item) => item === raw.problems);
    const records = SET_RECORD_PERMISSIONS.find((item) => item === raw.records);
    if (!problems || !records) throw new TypeError('set_config_authorization_invalid');
    return { problems, records, scoreboard: boolean(raw.scoreboard), afterEnd: boolean(raw.afterEnd) };
}

export function parseSetAuthorization(value: unknown): SetAuthorization {
    const raw = object(value);
    exact(raw, ['defaults', 'groups']);
    const defaults = object(raw.defaults);
    exact(defaults, ['problems', 'records', 'scoreboard', 'afterEnd']);
    if (!Array.isArray(raw.groups) || raw.groups.length > 200) throw new TypeError('set_config_authorization_invalid');
    const ids = new Set<string>();
    const groups = raw.groups.map((entry) => {
        const row = object(entry);
        exact(row, ['groupId', 'problems', 'records', 'scoreboard', 'afterEnd']);
        if (typeof row.groupId !== 'string' || !/^[0-9a-f]{24}$/.test(row.groupId) || ids.has(row.groupId)) {
            throw new TypeError('set_config_authorization_invalid');
        }
        ids.add(row.groupId);
        return { groupId: row.groupId, ...permissions(row) };
    });
    return { defaults: permissions(defaults), groups };
}

/** Matching groups replace the defaults; overlapping groups grant the highest level per capability. */
export function resolveSetPermissions(policy: SetAuthorization, groupIds: readonly string[]): SetPermissions {
    const ids = new Set(groupIds);
    const matching = policy.groups.filter((group) => ids.has(group.groupId));
    if (!matching.length) return { ...policy.defaults };
    return matching.reduce<SetPermissions>(
        (result, group) => ({
            problems:
                SET_PROBLEM_PERMISSIONS[Math.max(SET_PROBLEM_PERMISSIONS.indexOf(result.problems), SET_PROBLEM_PERMISSIONS.indexOf(group.problems))],
            records: SET_RECORD_PERMISSIONS[Math.max(SET_RECORD_PERMISSIONS.indexOf(result.records), SET_RECORD_PERMISSIONS.indexOf(group.records))],
            scoreboard: result.scoreboard || group.scoreboard,
            afterEnd: result.afterEnd || group.afterEnd,
        }),
        { problems: 'hidden', records: 'self', scoreboard: false, afterEnd: false },
    );
}
