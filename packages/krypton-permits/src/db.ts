/**
 * Collection + indexes for krypton-permits.
 *
 * Index shapes:
 *
 *   - `{domainId, pid, uid}` UNIQUE — prevents double-grant; also covers
 *     `findOne` for "does user X have a permit on problem Y".
 *   - `{domainId, uid}` — drives the "我的验题" inbox + bulk pre-fetch on
 *     user-load (to feed canViewBy without an extra round-trip).
 *   - `{domainId, pid}` — drives the "this problem's permit list" panel
 *     in the problem editor.
 * Source rows preserve direct and every contest grant independently. Mutation
 * fences are durable deny markers and intentionally have no TTL index.
 */
import { db } from 'hydrooj';

export const permitsColl = db.collection('problem.permits');
export const permitSourcesColl = db.collection('problem.permitSources');
export const aclMutationFencesColl = db.collection('problem.aclMutationFences');

interface RequiredIndex {
    name: string;
    key: Record<string, 1 | -1>;
    unique?: boolean;
}

interface IndexCompatibility {
    allowLegacyCanonicalPair?: boolean;
    allowLegacyViaContestPartial?: boolean;
    allowMissingNamespace?: boolean;
}

const canonicalIndexes: RequiredIndex[] = [
    {
        name: 'problem_permits_pair_uq',
        key: { domainId: 1, pid: 1, uid: 1 },
        unique: true,
    },
    {
        name: 'problem_permits_user_active_role',
        key: { domainId: 1, uid: 1, active: 1, role: 1, pid: 1 },
    },
    {
        name: 'problem_permits_problem_active_role',
        key: { domainId: 1, pid: 1, active: 1, role: 1 },
    },
    {
        name: 'problem_permits_contest_active',
        key: { domainId: 1, viaContest: 1, active: 1, pid: 1, uid: 1 },
    },
];

const sourceIndexes: RequiredIndex[] = [
    {
        name: 'problem_permit_sources_identity_uq',
        key: { domainId: 1, pid: 1, uid: 1, sourceType: 1, sourceId: 1 },
        unique: true,
    },
    {
        name: 'problem_permit_sources_user_active_role',
        key: { domainId: 1, uid: 1, active: 1, role: 1, pid: 1 },
    },
    {
        name: 'problem_permit_sources_problem_active_role',
        key: { domainId: 1, pid: 1, active: 1, role: 1, uid: 1 },
    },
    {
        name: 'problem_permit_sources_contest',
        key: { domainId: 1, sourceType: 1, sourceId: 1, pid: 1, uid: 1 },
    },
];

const fenceIndexes: RequiredIndex[] = [
    {
        name: 'problem_acl_fences_pair_uq',
        key: { domainId: 1, pid: 1, uid: 1 },
        unique: true,
    },
    {
        name: 'problem_acl_fences_request',
        key: { domainId: 1, requestId: 1 },
    },
    {
        name: 'problem_acl_fences_user',
        key: { domainId: 1, uid: 1, pid: 1 },
    },
];

let indexesPromise: Promise<void> | null = null;

function sameKey(actual: Record<string, unknown>, expected: Record<string, unknown>): boolean {
    return JSON.stringify(actual) === JSON.stringify(expected);
}

function isLegacyCanonicalPairAlias(found: any, expected: RequiredIndex): boolean {
    return expected.name === 'problem_permits_pair_uq'
        && sameKey(found.key, expected.key)
        && found.unique === true
        && found.partialFilterExpression === undefined
        && found.expireAfterSeconds === undefined;
}

function isHarmlessLegacyViaContestPartial(found: any): boolean {
    const hasExpectedPartialFilter = JSON.stringify(found.partialFilterExpression)
        === JSON.stringify({ viaContest: { $type: 'objectId' } });
    return sameKey(found.key, { domainId: 1, viaContest: 1 })
        && hasExpectedPartialFilter
        && !found.unique
        && found.expireAfterSeconds === undefined;
}

function assertRequiredIndexShape(found: any, expected: RequiredIndex): void {
    if (!sameKey(found.key, expected.key)) {
        throw new Error(`required index ${expected.name} has wrong key shape`);
    }
    if (Boolean(found.unique) !== Boolean(expected.unique)) {
        throw new Error(`required index ${expected.name} has wrong unique setting`);
    }
    if (found.partialFilterExpression !== undefined) {
        throw new Error(`required index ${expected.name} must not be partial`);
    }
    if (found.expireAfterSeconds !== undefined) {
        throw new Error(`required index ${expected.name} must not have TTL`);
    }
}

function isNamespaceNotFound(error: any): boolean {
    return error?.code === 26 || error?.codeName === 'NamespaceNotFound';
}

async function listExistingIndexes(collection: any, allowMissingNamespace: boolean): Promise<any[]> {
    try {
        return await collection.listIndexes().toArray();
    } catch (error) {
        if (allowMissingNamespace && isNamespaceNotFound(error)) return [];
        throw error;
    }
}

async function createAndVerifyIndexes(
    collection: any,
    required: RequiredIndex[],
    compatibility: IndexCompatibility = {},
): Promise<void> {
    // MongoDB reports code 26 when listIndexes targets a collection that has
    // never been created. This is expected only for the two new P2.11
    // collections; createIndex creates the namespace, after which the normal
    // strict verification below must succeed.
    const before = await listExistingIndexes(collection, compatibility.allowMissingNamespace === true);
    const satisfied = new Set<string>();
    for (const found of before) {
        if (found.name === '_id_') continue;
        if (found.expireAfterSeconds !== undefined) {
            throw new Error(`legacy TTL index ${found.name} must be repaired explicitly before startup`);
        }
        const named = required.find((expected) => expected.name === found.name);
        if (named) {
            assertRequiredIndexShape(found, named);
            satisfied.add(named.name);
            continue;
        }
        const equivalent = required.find((expected) => sameKey(found.key, expected.key));
        if (equivalent
            && compatibility.allowLegacyCanonicalPair
            && isLegacyCanonicalPairAlias(found, equivalent)) {
            satisfied.add(equivalent.name);
            continue;
        }
        if (compatibility.allowLegacyViaContestPartial
            && isHarmlessLegacyViaContestPartial(found)) {
            continue;
        }
        if (found.partialFilterExpression !== undefined) {
            throw new Error(`legacy partial index ${found.name} must be repaired explicitly before startup`);
        }
        if (equivalent) {
            throw new Error(`legacy index ${found.name} duplicates required key ${equivalent.name}; repair explicitly`);
        }
    }
    await Promise.all(required.filter((index) => !satisfied.has(index.name)).map((index) => collection.createIndex(index.key, {
        name: index.name,
        ...(index.unique ? { unique: true } : {}),
    })));
    const actual = await collection.listIndexes().toArray();
    for (const expected of required) {
        const found = actual.find((index: any) => index.name === expected.name)
            || (compatibility.allowLegacyCanonicalPair
                ? actual.find((index: any) => isLegacyCanonicalPairAlias(index, expected))
                : undefined);
        if (!found) throw new Error(`required index ${expected.name} is missing after createIndex`);
        assertRequiredIndexShape(found, expected);
    }
}

export async function ensureIndexes(): Promise<void> {
    indexesPromise ||= (async () => {
        await createAndVerifyIndexes(permitsColl, canonicalIndexes, {
            allowLegacyCanonicalPair: true,
            allowLegacyViaContestPartial: true,
            allowMissingNamespace: true,
        });
        await createAndVerifyIndexes(permitSourcesColl, sourceIndexes, { allowMissingNamespace: true });
        await createAndVerifyIndexes(aclMutationFencesColl, fenceIndexes, { allowMissingNamespace: true });
    })();
    try {
        await indexesPromise;
    } catch (error) {
        indexesPromise = null;
        throw error;
    }
}
