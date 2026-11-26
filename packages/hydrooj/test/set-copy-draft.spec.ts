import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { assertSetCreateAllowed, legacyRuleCreateKind } from '@hydrooj/common';
import { copiedDraftUpdate, selectCopiedDraftFields } from '../src/lib/set-publication';

const legacyHomework = {
    rule: 'homework',
    pids: [1],
    penaltySince: new Date('2026-11-01T00:00:00Z'),
    endAt: new Date('2026-11-02T00:00:00Z'),
};

describe('copiedDraftUpdate', () => {
    it('copies a legacy homework as a draft and keeps pids', () => {
        const result = copiedDraftUpdate(legacyHomework, 'homework');
        assert.equal(result.setConfig.publication, 'draft');
        assert.deepEqual(result.pids, [1]);
    });

    it('rejects copying a homework document as a contest', () => {
        assert.throws(
            () => copiedDraftUpdate(legacyHomework, 'contest'),
            (error: unknown) => error instanceof TypeError && error.message === 'set_copy_purpose_mismatch',
        );
    });

    it('does not swallow an invalid legacy rule', () => {
        assert.throws(
            () => copiedDraftUpdate({ rule: 'nope', pids: [1] }, 'homework'),
            (error: unknown) => error instanceof Error && error.message !== 'set_config_missing',
        );
    });

    it('copies a legacy homework score onto the publication draft', () => {
        const result = copiedDraftUpdate({ ...legacyHomework, score: { 1: 5 } }, 'homework');
        assert.equal(result.setConfig.publication, 'draft');
        assert.ok(result.score);
        assert.equal(result.score[1], 5);
    });

    it('rejects a score value that is not a number', () => {
        assert.throws(
            () => copiedDraftUpdate({ ...legacyHomework, score: { 1: 'bad' } }, 'homework'),
            (error: unknown) => error instanceof TypeError && error.message === 'set_copy_score_invalid',
        );
    });
});

describe('selectCopiedDraftFields', () => {
    const copiedAt = new Date('2026-11-10T00:00:00Z');

    it('drops an unusable problem and its score, and records the source', () => {
        const sourceId = { toHexString: () => 'a'.repeat(24) };
        const fields = selectCopiedDraftFields({
            pids: [1, 2],
            score: { 1: 5, 2: 9 },
            unusable: new Set([2]),
            statement: '改过的说明',
            sourceType: 'homework',
            sourceId,
            sourceTitle: '原作业',
            ownerUid: 4,
            copiedBy: 8,
            copiedAt,
        });
        assert.deepEqual(fields.pids, [1]);
        assert.deepEqual(fields.score, { 1: 5 });
        assert.equal(fields.content, '改过的说明');
        assert.equal(fields.copiedFrom.type, 'homework');
        assert.equal(fields.copiedFrom.id, sourceId);
        assert.equal(fields.copiedFrom.ownerUid, 4);
        assert.equal(fields.copiedFrom.copiedBy, 8);
        assert.equal(Object.hasOwn(fields, 'beginAt'), false);
        assert.equal(Object.hasOwn(fields, 'assign'), false);
    });

    it('rejects a source with no owner', () => {
        assert.throws(
            () => selectCopiedDraftFields({
                pids: [1],
                unusable: new Set(),
                statement: '',
                sourceType: 'exam',
                sourceId: 'id',
                sourceTitle: '考试',
                ownerUid: 0,
                copiedBy: 8,
                copiedAt,
            }),
            (error: unknown) => error instanceof TypeError && error.message === 'set_copy_owner_invalid',
        );
    });
});

describe('legacyRuleCreateKind', () => {
    it('maps acm to contest', () => {
        assert.equal(legacyRuleCreateKind('acm'), 'contest');
    });

    it('lets a non-admin with createExam create an exam but not a contest or practice', () => {
        const rights = {
            privEditSystem: false,
            createHomework: false,
            createExam: true,
            createPractice: false,
        };
        assert.doesNotThrow(() => assertSetCreateAllowed(rights, 'exam'));
        assert.throws(
            () => assertSetCreateAllowed(rights, 'contest'),
            (error: unknown) => error instanceof TypeError && error.message === 'set_create_kind_forbidden',
        );
        assert.throws(
            () => assertSetCreateAllowed(rights, 'practice'),
            (error: unknown) => error instanceof TypeError && error.message === 'set_create_kind_forbidden',
        );
    });
});
