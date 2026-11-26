import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { createDraftConfig, parseSetConfig } from '../set-config';
import {
    parseSetAuthorization,
    parseSetExperience,
    resolveSetPermissions,
    SET_DEFAULT_PERMISSIONS,
    SET_EXPERIENCE_DEFAULTS,
} from '../set-experience';

const groupA = '64b000000000000000000001';
const groupB = '64b000000000000000000002';

describe('independent set experience and group permissions', () => {
    it('preserves existing documents and requires explicit opt-in to end-of-round saving', () => {
        const config = createDraftConfig('exam');
        assert.equal(parseSetConfig(config).settings.experience, undefined);
        assert.equal(SET_EXPERIENCE_DEFAULTS.autoSaveBeforeEnd, false);
        const experience = { ...SET_EXPERIENCE_DEFAULTS, announcement: '开考后公告', autoSaveBeforeEnd: true };
        assert.deepEqual(parseSetConfig({ ...config, settings: { ...config.settings, experience } }).settings.experience, experience);
    });

    it('rejects missing, unknown, and incorrectly typed rules', () => {
        for (const value of [
            null,
            {},
            { ...SET_EXPERIENCE_DEFAULTS, extra: true },
            { ...SET_EXPERIENCE_DEFAULTS, autoSaveBeforeEnd: 'false' },
            { ...SET_EXPERIENCE_DEFAULTS, announcement: 'a'.repeat(65536) },
        ]) {
            assert.throws(() => parseSetExperience(value));
        }
        for (const value of [
            null,
            { defaults: SET_DEFAULT_PERMISSIONS, groups: [{ groupId: 'bad', ...SET_DEFAULT_PERMISSIONS }] },
            {
                defaults: SET_DEFAULT_PERMISSIONS,
                groups: [
                    { groupId: groupA, ...SET_DEFAULT_PERMISSIONS },
                    { groupId: groupA, ...SET_DEFAULT_PERMISSIONS },
                ],
            },
            { defaults: { ...SET_DEFAULT_PERMISSIONS, records: 'all' }, groups: [] },
        ]) { assert.throws(() => parseSetAuthorization(value)); }
    });

    it('uses defaults only for unmatched users and merges overlapping groups per capability', () => {
        const policy = parseSetAuthorization({
            defaults: SET_DEFAULT_PERMISSIONS,
            groups: [
                { groupId: groupA, problems: 'view', records: 'self', scoreboard: false, afterEnd: true },
                { groupId: groupB, problems: 'hidden', records: 'details', scoreboard: true, afterEnd: false },
            ],
        });
        assert.deepEqual(resolveSetPermissions(policy, []), SET_DEFAULT_PERMISSIONS);
        assert.deepEqual(resolveSetPermissions(policy, [groupA]), { problems: 'view', records: 'self', scoreboard: false, afterEnd: true });
        assert.deepEqual(resolveSetPermissions(policy, [groupA, groupB]), { problems: 'view', records: 'details', scoreboard: true, afterEnd: true });
    });
});
