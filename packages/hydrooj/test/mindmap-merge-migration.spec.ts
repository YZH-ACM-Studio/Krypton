import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { expect } from 'chai';
import { ObjectId } from 'mongodb';

// This line matches @hydrooj/register's CJS strip so __filename stays defined.
const __filename = fileURLToPath(import.meta.url);
const requireFromTest = createRequire(__filename);
const plannedModule = 'packages/hydrooj/src/lib/mindmap-merge-migration.ts';
const plannedModuleFilename = path.resolve(path.dirname(__filename), '../../..', plannedModule);

const keptIndex = 'mindmap_one_root_per_map';
const defaultIndex = 'mindmap_one_default_map';
const courseIndex = 'mindmap_one_map_per_course';
const nodeTime = new Date('2026-07-01T00:00:00.000Z');
const courseOwner = 17;

const mapAlgoHighId = new ObjectId('64b00000000000000000000b');
const mapAlgoLowId = new ObjectId('64b00000000000000000000a');
const mapCourseId = new ObjectId('64b00000000000000000000c');
const rootHighId = new ObjectId('64b000000000000000000021');
const rootLowId = new ObjectId('64b000000000000000000011');
const rootCourseId = new ObjectId('64b000000000000000000031');
const childHighId = new ObjectId('64b000000000000000000022');
const childLowId = new ObjectId('64b000000000000000000012');
const childCourseId = new ObjectId('64b000000000000000000032');
const courseDocId = new ObjectId('84b000000000000000000001');
const unboundCourseDocId = new ObjectId('84b000000000000000000002');
const oldNodeIds = [rootHighId, rootLowId, rootCourseId, childHighId, childLowId, childCourseId];

interface MindmapMergeMap {
    _id: ObjectId;
    title: string;
    rootNodeId: ObjectId;
    visibility: 'public' | 'hidden';
    layoutDirection: 'RIGHT' | 'DOWN';
    isDefault?: boolean;
    ownerDomainId?: string;
    ownerCourseId?: ObjectId;
    createdAt: Date;
    updatedAt: Date;
}

interface MindmapMergeNode {
    _id: ObjectId;
    mapId: ObjectId;
    parentId: ObjectId | null;
    topic: string;
    tags: string[];
    problemIds: string[];
    order: number;
    createdAt: Date;
    updatedAt: Date;
    coursePins?: number[];
    courseVisibility?: 'public' | 'hidden';
    ownerUids?: number[];
}

interface MindmapMergeProblem {
    domainId: string;
    docId: number;
    knowledgeMapId: ObjectId;
}

interface MindmapMergeCourse {
    domainId: string;
    docId: ObjectId;
    owner: number;
    mindmapId?: ObjectId;
    knowledgeCourseNodeId?: ObjectId;
}

interface MindmapMergeSnapshot {
    maps: MindmapMergeMap[];
    nodes: MindmapMergeNode[];
    problems: MindmapMergeProblem[];
    courses: MindmapMergeCourse[];
    indexes: string[];
}

interface MindmapMergeGenerated {
    mapId: ObjectId;
    rootNodeId: ObjectId;
    now: Date;
}

interface MindmapMergePlan {
    schemaVersion: number;
    fingerprint: string;
    source: unknown;
    target: {
        map: MindmapMergeMap;
        root: MindmapMergeNode;
        nodes: MindmapMergeNode[];
    };
}

interface MindmapMergeGates {
    actor: number;
    fingerprint: string;
    confirm: string;
    backupConfirmed: boolean;
    serviceStopped: boolean;
}

interface MindmapMergeRepository {
    snapshot: () => Promise<MindmapMergeSnapshot>;
    insertMap: (doc: MindmapMergeMap) => Promise<'inserted' | 'exists'>;
    insertNode: (doc: MindmapMergeNode) => Promise<'inserted' | 'exists'>;
    updateNode: (id: ObjectId, expected: Partial<MindmapMergeNode>, set: Partial<MindmapMergeNode>, unset: string[]) => Promise<'updated' | 'already'>;
    updateProblems: (fromMapIds: ObjectId[], to: ObjectId) => Promise<{ matched: number; modified: number }>;
    updateCourse: (key: { domainId: string; docId: ObjectId }, expectedMindmapId: ObjectId, courseNodeId: ObjectId) => Promise<'updated' | 'already'>;
    deleteMap: (id: ObjectId, expected: Partial<MindmapMergeMap>) => Promise<'deleted' | 'already'>;
    dropIndex: (name: string) => Promise<'dropped' | 'absent'>;
    writeAudit: (record: Record<string, unknown>) => Promise<void>;
}

interface MergeMigrationModule {
    MINDMAP_MERGE_SCHEMA_VERSION: number;
    MERGED_MAP_TITLE: string;
    MindmapMergePlanError: new (message: string) => Error;
    buildMindmapMergePlan: (snapshot: MindmapMergeSnapshot, generated: MindmapMergeGenerated) => MindmapMergePlan;
    mindmapMergeFingerprint: (plan: MindmapMergePlan) => string;
    applyMindmapMergePlan: (repo: MindmapMergeRepository, plan: MindmapMergePlan, gates: MindmapMergeGates) => Promise<unknown>;
    verifyMindmapMerge: (repo: MindmapMergeRepository, plan: MindmapMergePlan) => Promise<unknown>;
}

interface RepoCall {
    method: string;
    result: string;
    detail: string;
}

function readPlannedModule(): unknown {
    try {
        return requireFromTest(plannedModuleFilename);
    } catch (error) {
        const code = error && typeof error === 'object' && 'code' in error ? String((error as { code: unknown }).code) : '';
        const message = error instanceof Error ? error.message : '';
        if (code === 'MODULE_NOT_FOUND' && message.includes('mindmap-merge-migration')) return undefined;
        throw error;
    }
}

function loadMigration(): MergeMigrationModule {
    const loaded = readPlannedModule() as Partial<MergeMigrationModule> | undefined;
    expect(loaded?.MINDMAP_MERGE_SCHEMA_VERSION, 'MINDMAP_MERGE_SCHEMA_VERSION').to.equal(1);
    expect(loaded?.MERGED_MAP_TITLE, 'MERGED_MAP_TITLE').to.equal('知识图谱');
    expect(typeof loaded?.MindmapMergePlanError, 'MindmapMergePlanError').to.equal('function');
    expect(typeof loaded?.buildMindmapMergePlan, 'buildMindmapMergePlan').to.equal('function');
    expect(typeof loaded?.mindmapMergeFingerprint, 'mindmapMergeFingerprint').to.equal('function');
    expect(typeof loaded?.applyMindmapMergePlan, 'applyMindmapMergePlan').to.equal('function');
    expect(typeof loaded?.verifyMindmapMerge, 'verifyMindmapMerge').to.equal('function');
    return loaded as MergeMigrationModule;
}

function generatedStamp(): MindmapMergeGenerated {
    return {
        mapId: new ObjectId('64a000000000000000000001'),
        rootNodeId: new ObjectId('64a000000000000000000002'),
        now: new Date('2026-10-16T03:00:00.000Z'),
    };
}

function cloneValue<T>(value: T): T {
    if (value instanceof ObjectId) return new ObjectId(value) as T;
    if (value instanceof Date) return new Date(value.getTime()) as T;
    if (Array.isArray(value)) return value.map((item) => cloneValue(item)) as T;
    if (value && typeof value === 'object') {
        const copy: Record<string, unknown> = {};
        for (const [key, entry] of Object.entries(value)) {
            if (entry !== undefined) copy[key] = cloneValue(entry);
        }
        return copy as T;
    }
    return value;
}

function sameValue(left: unknown, right: unknown): boolean {
    if (left instanceof ObjectId && right instanceof ObjectId) return left.equals(right);
    if (left instanceof Date && right instanceof Date) return left.getTime() === right.getTime();
    if (Array.isArray(left) && Array.isArray(right)) {
        return left.length === right.length && left.every((item, index) => sameValue(item, right[index]));
    }
    if (left && right && typeof left === 'object' && typeof right === 'object') {
        const leftRecord = left as Record<string, unknown>;
        const rightRecord = right as Record<string, unknown>;
        const leftKeys = Object.keys(leftRecord).filter((key) => leftRecord[key] !== undefined).sort();
        const rightKeys = Object.keys(rightRecord).filter((key) => rightRecord[key] !== undefined).sort();
        return leftKeys.length === rightKeys.length && leftKeys.every((key, index) => key === rightKeys[index] && sameValue(leftRecord[key], rightRecord[key]));
    }
    return Object.is(left, right);
}

function matchesPartial(actual: object, expected: object): boolean {
    const record = actual as Record<string, unknown>;
    return Object.entries(expected).every(([key, value]) => value === undefined || sameValue(record[key], value));
}

function node(snapshot: MindmapMergeSnapshot, id: ObjectId): MindmapMergeNode {
    const found = snapshot.nodes.find((item) => item._id.equals(id));
    if (!found) throw new Error(`fixture missing node ${id.toHexString()}`);
    return found;
}

function mapDoc(input: {
    mapId: ObjectId;
    rootId: ObjectId;
    title: string;
    visibility: 'public' | 'hidden';
    layoutDirection: 'RIGHT' | 'DOWN';
    isDefault?: boolean;
    ownerDomainId?: string;
    ownerCourseId?: ObjectId;
}): MindmapMergeMap {
    const map: MindmapMergeMap = {
        _id: input.mapId,
        title: input.title,
        rootNodeId: input.rootId,
        visibility: input.visibility,
        layoutDirection: input.layoutDirection,
        createdAt: nodeTime,
        updatedAt: nodeTime,
    };
    if (input.isDefault) map.isDefault = true;
    if (input.ownerDomainId) map.ownerDomainId = input.ownerDomainId;
    if (input.ownerCourseId) map.ownerCourseId = input.ownerCourseId;
    return map;
}

function rootDoc(map: MindmapMergeMap): MindmapMergeNode {
    return {
        _id: map.rootNodeId,
        mapId: map._id,
        parentId: null,
        topic: map.title,
        tags: [],
        problemIds: [],
        order: 0,
        createdAt: nodeTime,
        updatedAt: nodeTime,
    };
}

function childDoc(id: ObjectId, map: MindmapMergeMap, topic: string): MindmapMergeNode {
    return {
        _id: id,
        mapId: map._id,
        parentId: map.rootNodeId,
        topic,
        tags: [],
        problemIds: [],
        order: 1,
        createdAt: nodeTime,
        updatedAt: nodeTime,
    };
}

function threeMapSnapshot(): MindmapMergeSnapshot {
    const algoHigh = mapDoc({
        mapId: mapAlgoHighId,
        rootId: rootHighId,
        title: '算法',
        visibility: 'public',
        layoutDirection: 'DOWN',
    });
    const course = mapDoc({
        mapId: mapCourseId,
        rootId: rootCourseId,
        title: '程序设计基础(I)',
        visibility: 'hidden',
        layoutDirection: 'RIGHT',
        ownerDomainId: 'system',
        ownerCourseId: courseDocId,
    });
    const algoLow = mapDoc({
        mapId: mapAlgoLowId,
        rootId: rootLowId,
        title: '算法',
        visibility: 'public',
        layoutDirection: 'RIGHT',
        isDefault: true,
    });
    const pinned = childDoc(childCourseId, course, '数组');
    pinned.problemIds = ['5', '6'];
    pinned.coursePins = [8, 6];
    return {
        maps: [algoHigh, course, algoLow],
        nodes: [
            rootDoc(algoHigh),
            childDoc(childHighId, algoHigh, '图论'),
            rootDoc(course),
            pinned,
            rootDoc(algoLow),
            childDoc(childLowId, algoLow, '排序'),
        ],
        problems: [
            { domainId: 'system', docId: 5, knowledgeMapId: mapAlgoLowId },
            { domainId: 'system', docId: 6, knowledgeMapId: mapCourseId },
            { domainId: 'system', docId: 8, knowledgeMapId: mapCourseId },
        ],
        courses: [
            { domainId: 'system', docId: courseDocId, owner: courseOwner, mindmapId: mapCourseId },
            { domainId: 'system', docId: unboundCourseDocId, owner: 4 },
        ],
        indexes: [keptIndex, defaultIndex, courseIndex],
    };
}

function alreadyMergedSnapshot(generated: MindmapMergeGenerated): MindmapMergeSnapshot {
    const courseNodeId = new ObjectId('64b000000000000000000041');
    return {
        maps: [{
            _id: generated.mapId,
            title: '知识图谱',
            rootNodeId: generated.rootNodeId,
            visibility: 'public',
            layoutDirection: 'RIGHT',
            createdAt: generated.now,
            updatedAt: generated.now,
        }],
        nodes: [
            {
                _id: generated.rootNodeId,
                mapId: generated.mapId,
                parentId: null,
                topic: '知识图谱',
                tags: [],
                problemIds: [],
                order: 0,
                createdAt: generated.now,
                updatedAt: generated.now,
            },
            {
                _id: courseNodeId,
                mapId: generated.mapId,
                parentId: generated.rootNodeId,
                topic: '操作系统',
                tags: [],
                problemIds: [],
                order: 0,
                courseVisibility: 'public',
                ownerUids: [],
                createdAt: generated.now,
                updatedAt: generated.now,
            },
        ],
        problems: [{ domainId: 'system', docId: 1, knowledgeMapId: generated.mapId }],
        courses: [],
        indexes: [keptIndex],
    };
}

class FakeRepository implements MindmapMergeRepository {
    maps: MindmapMergeMap[];
    nodes: MindmapMergeNode[];
    problems: MindmapMergeProblem[];
    courses: MindmapMergeCourse[];
    indexes: string[];
    calls: RepoCall[] = [];
    fault: 'updateCourse' | null = null;
    private held: MindmapMergeSnapshot | null = null;

    constructor(snapshot: MindmapMergeSnapshot) {
        const copy = cloneValue(snapshot);
        this.maps = copy.maps;
        this.nodes = copy.nodes;
        this.problems = copy.problems;
        this.courses = copy.courses;
        this.indexes = copy.indexes;
    }

    holdSnapshot(snapshot: MindmapMergeSnapshot) {
        this.held = cloneValue(snapshot);
    }

    async snapshot(): Promise<MindmapMergeSnapshot> {
        this.record('snapshot', 'read', '');
        if (this.held) return cloneValue(this.held);
        return cloneValue({
            maps: this.maps,
            nodes: this.nodes,
            problems: this.problems,
            courses: this.courses,
            indexes: this.indexes,
        });
    }

    async insertMap(doc: MindmapMergeMap): Promise<'inserted' | 'exists'> {
        return this.insertDoc(this.maps, doc, 'insertMap');
    }

    async insertNode(doc: MindmapMergeNode): Promise<'inserted' | 'exists'> {
        return this.insertDoc(this.nodes, doc, 'insertNode');
    }

    async updateNode(id: ObjectId, expected: Partial<MindmapMergeNode>, set: Partial<MindmapMergeNode>, unset: string[] = []): Promise<'updated' | 'already'> {
        const current = this.nodes.find((item) => item._id.equals(id));
        if (!current) throw new Error(`cas mismatch updateNode missing ${id.toHexString()}`);
        const record = current as unknown as Record<string, unknown>;
        const unsetDone = unset.every((key) => !Object.hasOwn(record, key));
        if (matchesPartial(current, set) && unsetDone) {
            this.record('updateNode', 'already', id.toHexString());
            return 'already';
        }
        if (!matchesPartial(current, expected)) throw new Error(`cas mismatch updateNode ${id.toHexString()}`);
        for (const [key, value] of Object.entries(set)) {
            if (value !== undefined) record[key] = cloneValue(value);
        }
        for (const key of unset) delete record[key];
        this.record('updateNode', 'updated', id.toHexString());
        return 'updated';
    }

    async updateProblems(fromMapIds: ObjectId[], to: ObjectId): Promise<{ matched: number; modified: number }> {
        let matched = 0;
        let modified = 0;
        for (const problem of this.problems) {
            if (!fromMapIds.some((id) => id.equals(problem.knowledgeMapId))) continue;
            matched += 1;
            if (!problem.knowledgeMapId.equals(to)) {
                problem.knowledgeMapId = new ObjectId(to);
                modified += 1;
            }
        }
        this.record('updateProblems', 'returned', `${matched}/${modified}`);
        return { matched, modified };
    }

    async updateCourse(key: { domainId: string; docId: ObjectId }, expectedMindmapId: ObjectId, courseNodeId: ObjectId): Promise<'updated' | 'already'> {
        if (this.fault === 'updateCourse') {
            this.fault = null;
            throw new Error('injected failure after updating problems');
        }
        const identity = courseKey(key);
        const course = this.courses.find((item) => item.domainId === identity.domainId && item.docId.equals(identity.docId));
        if (!course) throw new Error(`cas mismatch updateCourse missing ${identity.domainId}/${identity.docId.toHexString()}`);
        const alreadyBound = course.knowledgeCourseNodeId instanceof ObjectId
            && course.knowledgeCourseNodeId.equals(courseNodeId)
            && !Object.hasOwn(course, 'mindmapId');
        if (alreadyBound) {
            this.record('updateCourse', 'already', identity.docId.toHexString());
            return 'already';
        }
        if (course.mindmapId instanceof ObjectId && course.mindmapId.equals(expectedMindmapId)) {
            course.knowledgeCourseNodeId = new ObjectId(courseNodeId);
            delete course.mindmapId;
            this.record('updateCourse', 'updated', identity.docId.toHexString());
            return 'updated';
        }
        throw new Error(`cas mismatch updateCourse ${identity.domainId}/${identity.docId.toHexString()}`);
    }

    async deleteMap(id: ObjectId, expected: Partial<MindmapMergeMap>): Promise<'deleted' | 'already'> {
        const index = this.maps.findIndex((item) => item._id.equals(id));
        if (index < 0) {
            this.record('deleteMap', 'already', id.toHexString());
            return 'already';
        }
        if (!matchesPartial(this.maps[index], expected)) throw new Error(`cas mismatch deleteMap ${id.toHexString()}`);
        this.maps.splice(index, 1);
        this.record('deleteMap', 'deleted', id.toHexString());
        return 'deleted';
    }

    async dropIndex(name: string): Promise<'dropped' | 'absent'> {
        const index = this.indexes.indexOf(name);
        if (index < 0) {
            this.record('dropIndex', 'absent', name);
            return 'absent';
        }
        this.indexes.splice(index, 1);
        this.record('dropIndex', 'dropped', name);
        return 'dropped';
    }

    async writeAudit(record: Record<string, unknown>): Promise<void> {
        this.record('writeAudit', 'written', typeof record.type === 'string' ? record.type : '');
    }

    private insertDoc<T extends { _id: ObjectId }>(docs: T[], doc: T, method: 'insertMap' | 'insertNode'): 'inserted' | 'exists' {
        const existing = docs.find((item) => item._id.equals(doc._id));
        if (!existing) {
            docs.push(cloneValue(doc));
            this.record(method, 'inserted', doc._id.toHexString());
            return 'inserted';
        }
        if (!sameValue(existing, doc)) throw new Error(`cas mismatch ${method} ${doc._id.toHexString()}`);
        this.record(method, 'exists', doc._id.toHexString());
        return 'exists';
    }

    private record(method: string, result: string, detail: string) {
        this.calls.push({ method, result, detail });
    }
}

function courseKey(value: unknown): { domainId: string; docId: ObjectId } {
    if (!value || typeof value !== 'object') throw new TypeError('updateCourse key must be { domainId, docId }');
    const record = value as Record<string, unknown>;
    if (typeof record.domainId !== 'string' || !(record.docId instanceof ObjectId)) {
        throw new TypeError(`updateCourse key must be { domainId, docId }, received ${JSON.stringify(value)}`);
    }
    return { domainId: record.domainId, docId: record.docId };
}

function openGates(plan: MindmapMergePlan, patch: Partial<MindmapMergeGates> = {}): MindmapMergeGates {
    const fingerprint = patch.fingerprint ?? plan.fingerprint;
    return {
        actor: patch.actor ?? 2,
        fingerprint,
        confirm: patch.confirm ?? `APPLY:mindmap-merge-courses:${fingerprint}`,
        backupConfirmed: patch.backupConfirmed ?? true,
        serviceStopped: patch.serviceStopped ?? true,
    };
}

function flipLast(value: string): string {
    const last = value.slice(-1);
    return `${value.slice(0, -1)}${last === 'a' ? 'b' : 'a'}`;
}

function writeCalls(repo: FakeRepository): RepoCall[] {
    return repo.calls.filter((call) => call.method !== 'snapshot');
}

function phases(calls: RepoCall[]): string[] {
    const collapsed: string[] = [];
    for (const call of calls) {
        if (collapsed[collapsed.length - 1] !== call.method) collapsed.push(call.method);
    }
    return collapsed;
}

async function captureError(work: () => unknown): Promise<Error> {
    try {
        await work();
    } catch (error) {
        expect(error).to.be.instanceOf(Error);
        if (error instanceof Error) return error;
    }
    expect.fail('expected the call to throw');
}

function errorText(error: Error): string {
    const record = error as Error & Record<string, unknown>;
    const parts = [error.message];
    for (const key of ['code', 'issues', 'details', 'problems', 'diffs', 'differences', 'errors']) {
        if (record[key] !== undefined) parts.push(JSON.stringify(record[key]));
    }
    return parts.join('\n');
}

function mustFind<T>(items: readonly T[], predicate: (item: T) => boolean, label: string): T {
    const found = items.find(predicate);
    expect(found, label).to.not.equal(undefined);
    if (!found) throw new Error(label);
    return found;
}

function assertNoLegacyMapFields(map: object) {
    expect(Object.hasOwn(map, 'isDefault')).to.equal(false);
    expect(Object.hasOwn(map, 'ownerDomainId')).to.equal(false);
    expect(Object.hasOwn(map, 'ownerCourseId')).to.equal(false);
}

function assertCourseNode(nodeDoc: MindmapMergeNode, generated: MindmapMergeGenerated, order: number, visibility: 'public' | 'hidden', ownerUids: number[]) {
    expect(nodeDoc.parentId instanceof ObjectId && nodeDoc.parentId.equals(generated.rootNodeId)).to.equal(true);
    expect(nodeDoc.mapId.equals(generated.mapId)).to.equal(true);
    expect(nodeDoc.order).to.equal(order);
    expect(nodeDoc.courseVisibility).to.equal(visibility);
    expect(nodeDoc.ownerUids).to.deep.equal(ownerUids);
}

function assertMergedState(repo: FakeRepository, generated: MindmapMergeGenerated) {
    expect(repo.maps.length).to.equal(1);
    const map = repo.maps[0];
    expect(map._id.equals(generated.mapId)).to.equal(true);
    expect(map.title).to.equal('知识图谱');
    expect(map.rootNodeId.equals(generated.rootNodeId)).to.equal(true);
    expect(map.visibility).to.equal('public');
    expect(map.layoutDirection).to.equal('RIGHT');
    expect(map.createdAt.toISOString()).to.equal(generated.now.toISOString());
    expect(map.updatedAt.toISOString()).to.equal(generated.now.toISOString());
    assertNoLegacyMapFields(map);

    const roots = repo.nodes.filter((item) => item.parentId === null);
    expect(roots.length).to.equal(1);
    expect(roots[0]._id.equals(generated.rootNodeId)).to.equal(true);
    expect(roots[0].topic).to.equal('知识图谱');
    expect(roots[0].tags).to.deep.equal([]);
    expect(roots[0].problemIds).to.deep.equal([]);
    expect(roots[0].order).to.equal(0);
    expect(roots[0].mapId.equals(generated.mapId)).to.equal(true);

    assertCourseNode(mustFind(repo.nodes, (item) => item._id.equals(rootCourseId), 'course root'), generated, 0, 'hidden', [courseOwner]);
    assertCourseNode(mustFind(repo.nodes, (item) => item._id.equals(rootLowId), 'lower algorithm root'), generated, 1, 'public', []);
    assertCourseNode(mustFind(repo.nodes, (item) => item._id.equals(rootHighId), 'higher algorithm root'), generated, 2, 'public', []);
    const pinned = mustFind(repo.nodes, (item) => item._id.equals(childCourseId), 'pinned node');
    expect(pinned.problemIds).to.deep.equal(['5', '6', '8']);
    expect(Object.hasOwn(pinned, 'coursePins')).to.equal(false);
    expect(Object.hasOwn(pinned, 'courseVisibility')).to.equal(false);
    expect(Object.hasOwn(pinned, 'ownerUids')).to.equal(false);
    expect(repo.nodes.every((item) => item.mapId.equals(generated.mapId))).to.equal(true);
    expect(repo.nodes.some((item) => Object.hasOwn(item, 'coursePins'))).to.equal(false);
    expect(repo.problems.every((problem) => problem.knowledgeMapId.equals(generated.mapId))).to.equal(true);

    const bound = mustFind(repo.courses, (course) => course.docId.equals(courseDocId), 'bound course');
    expect(bound.knowledgeCourseNodeId instanceof ObjectId && bound.knowledgeCourseNodeId.equals(rootCourseId)).to.equal(true);
    expect(Object.hasOwn(bound, 'mindmapId')).to.equal(false);
    const unbound = mustFind(repo.courses, (course) => course.docId.equals(unboundCourseDocId), 'unbound course');
    expect(Object.hasOwn(unbound, 'mindmapId')).to.equal(false);
    expect(Object.hasOwn(unbound, 'knowledgeCourseNodeId')).to.equal(false);
    expect(repo.indexes.includes(defaultIndex)).to.equal(false);
    expect(repo.indexes.includes(courseIndex)).to.equal(false);
    expect(repo.indexes.includes(keptIndex)).to.equal(true);
}

function assertPlan(plan: MindmapMergePlan, migration: MergeMigrationModule, generated: MindmapMergeGenerated) {
    expect(migration.MINDMAP_MERGE_SCHEMA_VERSION).to.equal(1);
    expect(migration.MERGED_MAP_TITLE).to.equal('知识图谱');
    expect(plan.schemaVersion).to.equal(1);
    expect(plan.fingerprint).to.match(/^[a-f0-9]{64}$/);
    expect(migration.mindmapMergeFingerprint(plan)).to.equal(plan.fingerprint);
    expect(plan.target.map.title).to.equal('知识图谱');
    expect(plan.target.map._id.equals(generated.mapId)).to.equal(true);
    expect(plan.target.map.rootNodeId.equals(generated.rootNodeId)).to.equal(true);
    expect(plan.target.map.visibility).to.equal('public');
    expect(plan.target.map.layoutDirection).to.equal('RIGHT');
    expect(plan.target.map.createdAt.toISOString()).to.equal(generated.now.toISOString());
    expect(plan.target.map.updatedAt.toISOString()).to.equal(generated.now.toISOString());
    assertNoLegacyMapFields(plan.target.map);
    expect(plan.target.root._id.equals(generated.rootNodeId)).to.equal(true);
    expect(plan.target.root.mapId.equals(generated.mapId)).to.equal(true);
    expect(plan.target.root.parentId).to.equal(null);
    expect(plan.target.root.topic).to.equal('知识图谱');
    expect(plan.target.root.tags).to.deep.equal([]);
    expect(plan.target.root.problemIds).to.deep.equal([]);
    expect(plan.target.root.order).to.equal(0);

    for (const id of oldNodeIds) {
        const migrated = mustFind(plan.target.nodes, (item) => item._id.equals(id), id.toHexString());
        expect(migrated.mapId.equals(generated.mapId)).to.equal(true);
    }
    const courseNodes = plan.target.nodes.filter((item) => item.parentId instanceof ObjectId && item.parentId.equals(generated.rootNodeId));
    expect(courseNodes.length).to.equal(3);
    assertCourseNode(mustFind(plan.target.nodes, (item) => item._id.equals(rootCourseId), 'planned course root'), generated, 0, 'hidden', [courseOwner]);
    expect(mustFind(plan.target.nodes, (item) => item._id.equals(rootCourseId), 'planned course topic').topic).to.equal('程序设计基础(I)');
    assertCourseNode(mustFind(plan.target.nodes, (item) => item._id.equals(rootLowId), 'planned lower root'), generated, 1, 'public', []);
    assertCourseNode(mustFind(plan.target.nodes, (item) => item._id.equals(rootHighId), 'planned higher root'), generated, 2, 'public', []);
    const pinned = mustFind(plan.target.nodes, (item) => item._id.equals(childCourseId), 'planned pins');
    expect(pinned.problemIds).to.deep.equal(['5', '6', '8']);
    expect(Object.hasOwn(pinned, 'coursePins')).to.equal(false);
    expect(Object.hasOwn(pinned, 'courseVisibility')).to.equal(false);
    expect(pinned.parentId instanceof ObjectId && pinned.parentId.equals(rootCourseId)).to.equal(true);
}

async function planError(migration: MergeMigrationModule, snapshot: MindmapMergeSnapshot): Promise<Error> {
    return captureError(() => migration.buildMindmapMergePlan(snapshot, generatedStamp()));
}

describe('mindmap merge migration', () => {
    it('plans three maps into course nodes and merges pins into problemIds', () => {
        const migration = loadMigration();
        const generated = generatedStamp();
        const plan = migration.buildMindmapMergePlan(threeMapSnapshot(), generated);
        assertPlan(plan, migration, generated);
    });

    it('takes layoutDirection from the default map, or the first map when none is default', () => {
        const migration = loadMigration();
        const generated = generatedStamp();
        const firstId = new ObjectId('64b0000000000000000000d1');
        const firstRootId = new ObjectId('64b0000000000000000000d2');
        const secondId = new ObjectId('64b0000000000000000000d3');
        const secondRootId = new ObjectId('64b0000000000000000000d4');
        const first = mapDoc({
            mapId: firstId,
            rootId: firstRootId,
            title: '操作系统',
            visibility: 'public',
            layoutDirection: 'DOWN',
        });
        const second = mapDoc({
            mapId: secondId,
            rootId: secondRootId,
            title: '算法',
            visibility: 'public',
            layoutDirection: 'RIGHT',
        });
        const plan = migration.buildMindmapMergePlan({
            maps: [first, second],
            nodes: [rootDoc(first), rootDoc(second)],
            problems: [{ domainId: 'system', docId: 1, knowledgeMapId: firstId }],
            courses: [],
            indexes: [keptIndex, defaultIndex, courseIndex],
        }, generated);
        expect(plan.target.map.layoutDirection).to.equal('DOWN');
    });

    it('rejects a problem whose knowledgeMapId points at a missing map', async () => {
        const migration = loadMigration();
        const snapshot = threeMapSnapshot();
        snapshot.problems.push({ domainId: 'missing-map-domain', docId: 424242, knowledgeMapId: new ObjectId() });
        const error = await planError(migration, snapshot);
        expect(error).to.be.instanceOf(migration.MindmapMergePlanError);
        expect(error.message).to.include('missing-map-domain');
        expect(error.message).to.include('424242');
    });

    it('rejects an already merged graph', async () => {
        const migration = loadMigration();
        const generated = generatedStamp();
        const error = await captureError(() => migration.buildMindmapMergePlan(alreadyMergedSnapshot(generated), generated));
        expect(error).to.be.instanceOf(migration.MindmapMergePlanError);
        const code = (error as { code?: unknown }).code;
        expect(error.message.includes('already_merged') || code === 'already_merged').to.equal(true);
    });

    it('reports every plan precondition failure together', async () => {
        const migration = loadMigration();
        const empty = await planError(migration, {
            maps: [],
            nodes: [],
            problems: [],
            courses: [],
            indexes: [defaultIndex],
        });
        expect(empty).to.be.instanceOf(migration.MindmapMergePlanError);
        expect(errorText(empty).includes('already_merged')).to.equal(false);

        const twoRoots = threeMapSnapshot();
        node(twoRoots, childLowId).parentId = null;
        const twoRootError = await planError(migration, twoRoots);
        expect(twoRootError).to.be.instanceOf(migration.MindmapMergePlanError);
        expect(errorText(twoRootError)).to.include(mapAlgoLowId.toHexString());

        const crossParent = threeMapSnapshot();
        node(crossParent, childLowId).parentId = rootCourseId;
        const crossParentError = await planError(migration, crossParent);
        expect(errorText(crossParentError)).to.include(childLowId.toHexString());

        const missingMap = threeMapSnapshot();
        node(missingMap, childHighId).mapId = new ObjectId();
        const missingMapError = await planError(migration, missingMap);
        expect(errorText(missingMapError)).to.include(childHighId.toHexString());

        const rootMap = threeMapSnapshot();
        node(rootMap, rootLowId).mapId = mapAlgoHighId;
        node(rootMap, childLowId).mapId = mapAlgoHighId;
        const rootMapError = await planError(migration, rootMap);
        expect(errorText(rootMapError)).to.include(mapAlgoLowId.toHexString());
        expect(errorText(rootMapError)).to.include(mapAlgoHighId.toHexString());

        const missingCourseId = new ObjectId('84b000000000000000000088');
        const missingCourse = threeMapSnapshot();
        const owned = missingCourse.maps.find((item) => item._id.equals(mapCourseId));
        if (!owned) throw new Error('fixture missing course map');
        owned.ownerCourseId = missingCourseId;
        const missingCourseError = await planError(migration, missingCourse);
        expect(errorText(missingCourseError)).to.include(missingCourseId.toHexString());

        const wrongDomainPin = threeMapSnapshot();
        const pinned = node(wrongDomainPin, childCourseId);
        pinned.problemIds = ['5'];
        pinned.coursePins = [77];
        wrongDomainPin.problems.push({ domainId: 'other-domain', docId: 77, knowledgeMapId: mapCourseId });
        const pinError = await planError(migration, wrongDomainPin);
        expect(errorText(pinError)).to.include('77');

        const badCourseId = new ObjectId('84b000000000000000000099');
        const combined = threeMapSnapshot();
        combined.problems.push({ domainId: 'missing-map-domain', docId: 424242, knowledgeMapId: new ObjectId() });
        combined.courses.push({
            domainId: 'system',
            docId: badCourseId,
            owner: 3,
            mindmapId: new ObjectId('64b0000000000000000000ff'),
        });
        const combinedError = await planError(migration, combined);
        expect(combinedError).to.be.instanceOf(migration.MindmapMergePlanError);
        const combinedText = errorText(combinedError);
        expect(combinedText).to.include('missing-map-domain');
        expect(combinedText).to.include('424242');
        expect(combinedText).to.include(badCourseId.toHexString());
    });

    it('keeps the fingerprint stable until a node title changes', () => {
        const migration = loadMigration();
        const generated = generatedStamp();
        const first = migration.buildMindmapMergePlan(threeMapSnapshot(), generated);
        const second = migration.buildMindmapMergePlan(threeMapSnapshot(), generated);
        expect(first.fingerprint).to.equal(second.fingerprint);
        expect(migration.mindmapMergeFingerprint(first)).to.equal(first.fingerprint);
        const changed = threeMapSnapshot();
        node(changed, childLowId).topic = '改过的标题';
        const third = migration.buildMindmapMergePlan(changed, generated);
        expect(third.fingerprint).to.not.equal(first.fingerprint);
    });

    it('rejects a confirmation that differs by one character without writing', async () => {
        const migration = loadMigration();
        const snapshot = threeMapSnapshot();
        const repo = new FakeRepository(snapshot);
        const plan = migration.buildMindmapMergePlan(snapshot, generatedStamp());
        const error = await captureError(() => migration.applyMindmapMergePlan(repo, plan, openGates(plan, {
            confirm: flipLast(`APPLY:mindmap-merge-courses:${plan.fingerprint}`),
        })));
        expect(error).to.be.instanceOf(Error);
        expect(writeCalls(repo)).to.deep.equal([]);
        expect(repo.maps.length).to.equal(3);
    });

    it('rejects apply when the service, backup, fingerprint, or actor gate is closed', async () => {
        const migration = loadMigration();
        const snapshot = threeMapSnapshot();
        const plan = migration.buildMindmapMergePlan(snapshot, generatedStamp());
        const wrongFingerprint = flipLast(plan.fingerprint);
        const gates = [
            openGates(plan, { serviceStopped: false }),
            openGates(plan, { backupConfirmed: false }),
            openGates(plan, { fingerprint: wrongFingerprint, confirm: `APPLY:mindmap-merge-courses:${wrongFingerprint}` }),
            openGates(plan, { actor: 0 }),
        ];
        for (const gate of gates) {
            const repo = new FakeRepository(snapshot);
            const error = await captureError(() => migration.applyMindmapMergePlan(repo, plan, gate));
            expect(error).to.be.instanceOf(Error);
            expect(writeCalls(repo)).to.deep.equal([]);
        }
    });

    it('stops writing when the live snapshot no longer matches the plan', async () => {
        const migration = loadMigration();
        const snapshot = threeMapSnapshot();
        const plan = migration.buildMindmapMergePlan(cloneValue(snapshot), generatedStamp());
        const repo = new FakeRepository(snapshot);
        const live = mustFind(repo.nodes, (item) => item._id.equals(childLowId), 'live node');
        live.topic = '计划之后被改掉';
        const error = await captureError(() => migration.applyMindmapMergePlan(repo, plan, openGates(plan)));
        expect(error).to.be.instanceOf(Error);
        expect(repo.calls.some((call) => call.method === 'insertMap')).to.equal(false);
        expect(repo.maps.length).to.equal(3);
    });

    it('stops later steps when an insert does not match the expected map', async () => {
        const migration = loadMigration();
        const pristine = threeMapSnapshot();
        const generated = generatedStamp();
        const plan = migration.buildMindmapMergePlan(cloneValue(pristine), generated);
        const repo = new FakeRepository(pristine);
        repo.holdSnapshot(pristine);
        repo.maps.push(mapDoc({
            mapId: generated.mapId,
            rootId: generated.rootNodeId,
            title: '不是知识图谱',
            visibility: 'public',
            layoutDirection: 'RIGHT',
        }));
        const error = await captureError(() => migration.applyMindmapMergePlan(repo, plan, openGates(plan)));
        expect(error).to.be.instanceOf(Error);
        expect(repo.calls.some((call) => call.method === 'updateProblems')).to.equal(false);
        expect(repo.calls.some((call) => call.method === 'writeAudit')).to.equal(false);
    });

    it('resumes after a failure following the problem update and then verifies', async () => {
        const migration = loadMigration();
        const generated = generatedStamp();
        const snapshot = threeMapSnapshot();
        const plan = migration.buildMindmapMergePlan(cloneValue(snapshot), generated);
        const repo = new FakeRepository(snapshot);
        repo.fault = 'updateCourse';
        const firstError = await captureError(() => migration.applyMindmapMergePlan(repo, plan, openGates(plan)));
        expect(firstError).to.be.instanceOf(Error);
        expect(phases(writeCalls(repo))).to.deep.equal(['insertMap', 'insertNode', 'updateNode', 'updateProblems']);
        expect(repo.calls.some((call) => call.method === 'deleteMap')).to.equal(false);
        expect(repo.calls.some((call) => call.method === 'writeAudit')).to.equal(false);

        repo.calls = [];
        const report = await migration.applyMindmapMergePlan(repo, plan, openGates(plan));
        expect(report !== null && typeof report === 'object').to.equal(true);
        const secondWrites = writeCalls(repo);
        expect(phases(secondWrites)).to.deep.equal([
            'insertMap',
            'insertNode',
            'updateNode',
            'updateProblems',
            'updateCourse',
            'deleteMap',
            'dropIndex',
            'writeAudit',
        ]);
        expect(secondWrites.filter((call) => call.method === 'insertMap').every((call) => call.result === 'exists')).to.equal(true);
        expect(secondWrites.filter((call) => call.method === 'insertNode').every((call) => call.result === 'exists')).to.equal(true);
        expect(secondWrites.filter((call) => call.method === 'updateNode').every((call) => call.result === 'already')).to.equal(true);
        expect(secondWrites.filter((call) => call.method === 'dropIndex').map((call) => call.detail)).to.deep.equal([defaultIndex, courseIndex]);
        expect(secondWrites.filter((call) => call.method === 'deleteMap' && call.result === 'deleted').map((call) => call.detail).sort()).to.deep.equal(
            [mapAlgoHighId, mapAlgoLowId, mapCourseId].map((id) => id.toHexString()).sort(),
        );
        assertMergedState(repo, generated);
        const verification = await migration.verifyMindmapMerge(repo, plan);
        expect(verification !== null && typeof verification === 'object').to.equal(true);
    });

    it('verify lists every node that still has coursePins', async () => {
        const migration = loadMigration();
        const generated = generatedStamp();
        const snapshot = threeMapSnapshot();
        const plan = migration.buildMindmapMergePlan(cloneValue(snapshot), generated);
        const repo = new FakeRepository(snapshot);
        await migration.applyMindmapMergePlan(repo, plan, openGates(plan));
        assertMergedState(repo, generated);
        const first = mustFind(repo.nodes, (item) => item._id.equals(childCourseId), 'first pinned');
        const second = mustFind(repo.nodes, (item) => item._id.equals(childLowId), 'second pinned');
        first.coursePins = [8];
        second.coursePins = [5];
        const error = await captureError(() => migration.verifyMindmapMerge(repo, plan));
        const text = errorText(error);
        expect(text).to.include(childCourseId.toHexString());
        expect(text).to.include(childLowId.toHexString());
    });
});
