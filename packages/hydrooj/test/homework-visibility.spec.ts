import { describe, it } from 'node:test';
import { expect } from 'chai';
import { ObjectId } from 'mongodb';
import type { Tdoc } from '../src/interface';
import { InMemoryStudentDirectory, studentRecord } from '../src/lib/testing/in-memory-student-directory';
import { withStudentDirectory } from '../src/service/student-directory';

const hydroHost = globalThis as unknown as {
    Hydro?: { model: Record<string, unknown> };
};
if (!hydroHost.Hydro) hydroHost.Hydro = { model: {} };

const { assertHomeworkAccess, buildHomeworkListAccessFilter, homeworkParticipantScopeAllows } = require('../src/model/homework-access.ts') as typeof import('../src/model/homework-access');

const groupA = new ObjectId('aaaaaaaaaaaaaaaaaaaaaaaa');
const groupB = new ObjectId('bbbbbbbbbbbbbbbbbbbbbbbb');
const homeworkId = new ObjectId('dddddddddddddddddddddddd');

interface HomeworkActor {
    _id: number;
    group: string[];
    own: (doc: { owner: number }) => boolean;
    hasPerm: (...perm: bigint[]) => boolean;
    hasPriv: (...priv: number[]) => boolean;
}

function homeworkDoc(fields: Partial<Pick<Tdoc, 'docId' | 'owner' | 'assign' | 'participantScopeMode' | 'participantGroupIds'>>): Tdoc {
    return fields as Tdoc;
}

function actor(id: number, owns: boolean): HomeworkActor {
    return {
        _id: id,
        group: [],
        own: (doc) => owns && doc.owner === id,
        hasPerm: () => false,
        hasPriv: () => false,
    };
}

async function thrownName(run: () => Promise<void>): Promise<string> {
    try {
        await run();
        return '';
    } catch (error) {
        return error instanceof Error ? error.name : '';
    }
}

function plainNodes(value: unknown, nodes: Record<string, unknown>[] = []): Record<string, unknown>[] {
    if (Array.isArray(value)) {
        for (const item of value) plainNodes(item, nodes);
        return nodes;
    }
    if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
        const node = value as Record<string, unknown>;
        nodes.push(node);
        for (const child of Object.values(node)) plainNodes(child, nodes);
    }
    return nodes;
}

describe('homework student scope', () => {
    it('returns false for a missing, none, or other scope and true when any group matches', () => {
        expect(homeworkParticipantScopeAllows(homeworkDoc({}), new Set()), 'missing scope').to.equal(false);
        expect(homeworkParticipantScopeAllows(homeworkDoc({ participantScopeMode: 'none' }), new Set()), 'none scope').to.equal(false);
        expect(
            homeworkParticipantScopeAllows(
                homeworkDoc({ participantScopeMode: 'groups', participantGroupIds: [groupA, groupB] }),
                new Set([String(groupB)]),
            ),
            'matching group',
        ).to.equal(true);
        expect(
            homeworkParticipantScopeAllows(homeworkDoc({ participantScopeMode: 'groups', participantGroupIds: [groupA] }), new Set([String(groupB)])),
            'other group',
        ).to.equal(false);
        expect(homeworkParticipantScopeAllows(homeworkDoc({ participantScopeMode: 'schools' }), new Set([String(groupA)])), 'other mode').to.equal(
            false,
        );
    });

    it('keeps owner and maintainer and only the groups branch in the student list filter', () => {
        const filter = buildHomeworkListAccessFilter(5, [], [groupA]);
        const nodes = plainNodes(filter);
        expect(nodes.some((node) => Object.hasOwn(node, '$exists')), 'filter contains $exists').to.equal(false);
        expect(nodes.some((node) => node.participantScopeMode === 'none'), 'filter contains none').to.equal(false);
        const modes = nodes.flatMap((node) => (Object.hasOwn(node, 'participantScopeMode') ? [node.participantScopeMode] : []));
        expect(modes, 'student scope modes').to.deep.equal(['groups']);
        expect(nodes.some((node) => node.owner === 5), 'owner branch').to.equal(true);
        expect(nodes.some((node) => node.maintainer === 5), 'maintainer branch').to.equal(true);
        const groups = nodes.find((node) => node.participantScopeMode === 'groups');
        const groupIds = groups && groups.participantGroupIds && typeof groups.participantGroupIds === 'object' && '$in' in groups.participantGroupIds
            ? groups.participantGroupIds.$in
            : [];
        expect(Array.isArray(groupIds) ? groupIds.map((groupId) => String(groupId)) : [], 'group ids').to.deep.equal([String(groupA)]);
    });

    it('rejects a student opening homework with no participant scope and lets the owner through', async () => {
        const missing = homeworkDoc({ docId: homeworkId, owner: 9 });
        const none = homeworkDoc({ docId: homeworkId, owner: 9, participantScopeMode: 'none' });
        const student = actor(5, false);
        const owner = actor(9, true);
        await withStudentDirectory(
            new InMemoryStudentDirectory({
                students: [studentRecord({ domainId: 'system', boundUserId: 5, groupIds: [] })],
            }),
            async () => {
                expect(await thrownName(() => assertHomeworkAccess('system', missing, student)), 'missing scope student').to.equal('NotAssignedError');
                expect(await thrownName(() => assertHomeworkAccess('system', none, student)), 'none scope student').to.equal('NotAssignedError');
                expect(await thrownName(() => assertHomeworkAccess('system', missing, owner)), 'owner').to.equal('');
            },
        );
    });
});
