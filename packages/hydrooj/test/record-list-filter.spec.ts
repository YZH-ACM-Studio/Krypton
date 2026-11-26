import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { recordDateRange, resolveRecordUserIds } from '../src/lib/record-list-filter';
import { InMemoryStudentDirectory, studentRecord } from '../src/lib/testing/in-memory-student-directory';

describe('record filters', () => {
    it('includes the full Beijing end day and rejects invalid or reversed dates', () => {
        const range = recordDateRange('2026-10-01', '2026-10-31');
        assert.equal(range.$gte.getTimestamp().toISOString(), '2026-09-30T16:00:00.000Z');
        assert.equal(range.$lt.getTimestamp().toISOString(), '2026-10-31T16:00:00.000Z');
        assert.equal(recordDateRange(), undefined);
        assert.throws(() => recordDateRange('2026-02-30'));
        assert.throws(() => recordDateRange('2026-11-01', '2026-10-31'));
    });

    it('searches all canonical bound students without truncating common names to 50', async () => {
        const directory = new InMemoryStudentDirectory({ students: Array.from({ length: 65 }, (_, index) => studentRecord({
            domainId: 'd', boundUserId: index + 2, studentId: `2400${index}`, realName: `张${index}`,
        })) });
        const search = (query: string) => directory.searchBoundStudents('d', query, 0);
        assert.equal((await resolveRecordUserIds('张', async () => null, search)).length, 65);
        assert.deepEqual(await resolveRecordUserIds('240010', async () => null, search), [12]);
        assert.deepEqual(await resolveRecordUserIds('张', async () => null), []);
        assert.deepEqual(await resolveRecordUserIds('42', async () => ({ _id: 42 }), search), [42]);
    });
});
