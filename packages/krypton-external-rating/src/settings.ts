import { SettingModel } from 'hydrooj';

const Setting = SettingModel.Setting;

/**
 * Client-writable Hydro account fields for CF / Nowcoder identity and
 * per-site public display. Rating / fetchedAt / lastError are server
 * snapshots in model.ts and must not be registered as user settings.
 *
 * Flag 0 keeps them on the account form and off both User.serialize
 * pick-lists. FLAG_PRIVATE would leak handles to default students with
 * PERM_VIEW_USER_PRIVATE_INFO; FLAG_HIDDEN hides the account form;
 * FLAG_PUBLIC is forbidden. Missing public switches stay false.
 */
export const EXTERNAL_RATING_ACCOUNT_KEYS = {
    codeforcesHandle: 'codeforcesHandle',
    nowcoderName: 'nowcoderName',
    codeforcesRatingPublic: 'codeforcesRatingPublic',
    nowcoderRatingPublic: 'nowcoderRatingPublic',
} as const;

export const EXTERNAL_RATING_ACCOUNT_SETTINGS = [
    Setting(
        'setting_info',
        EXTERNAL_RATING_ACCOUNT_KEYS.codeforcesHandle,
        '',
        'text',
        'Codeforces Handle',
        'Codeforces handle. Leave blank to clear.',
        0,
    ),
    Setting(
        'setting_info',
        EXTERNAL_RATING_ACCOUNT_KEYS.nowcoderName,
        '',
        'text',
        'Nowcoder Username',
        'Nowcoder username. Leave blank to clear.',
        0,
    ),
    Setting(
        'setting_info',
        EXTERNAL_RATING_ACCOUNT_KEYS.codeforcesRatingPublic,
        false,
        'boolean',
        'Public Codeforces Rating',
        'If enabled, public profile and ranking may show this Codeforces rating. Default off.',
        0,
    ),
    Setting(
        'setting_info',
        EXTERNAL_RATING_ACCOUNT_KEYS.nowcoderRatingPublic,
        false,
        'boolean',
        'Public Nowcoder Rating',
        'If enabled, public profile and ranking may show this Nowcoder rating. Default off.',
        0,
    ),
];
