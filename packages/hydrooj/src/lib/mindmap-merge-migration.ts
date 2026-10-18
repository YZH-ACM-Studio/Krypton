import { BSON, ObjectId } from 'mongodb';

import { canonicalJson, sha256 } from './problem-batch-import';

export const MINDMAP_MERGE_SCHEMA_VERSION = 1;
export const MERGED_MAP_TITLE = '知识图谱';

const CONFIRM_PREFIX = 'APPLY:mindmap-merge-courses:';
const DROPPED_INDEXES = ['mindmap_one_default_map', 'mindmap_one_map_per_course'] as const;

export class MindmapMergePlanError extends Error {
    readonly issues: readonly string[];

    readonly code: string;

    constructor(message: string, issues: readonly string[] = [], code = 'MINDMAP_MERGE_PLAN_INVALID') {
        super(issues.length > 0 ? `${message}\n${issues.join('\n')}` : message);
        this.name = 'MindmapMergePlanError';
        this.issues = issues;
        this.code = code;
    }
}

export interface MindmapMergeMap {
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

export interface MindmapMergeNode {
    _id: ObjectId;
    mapId: ObjectId;
    parentId: ObjectId | null;
    topic: string;
    tags: string[];
    problemIds: string[];
    order: number;
    createdAt: Date;
    updatedAt: Date;
    description?: string;
    color?: string;
    layoutSide?: 'left' | 'right';
    coursePins?: number[];
    courseVisibility?: 'public' | 'hidden';
    ownerUids?: number[];
}

export interface MindmapMergeProblem {
    domainId: string;
    docId: number;
    knowledgeMapId: ObjectId;
}

export interface MindmapMergeCourse {
    domainId: string;
    docId: ObjectId;
    owner: number;
    mindmapId?: ObjectId;
    knowledgeCourseNodeId?: ObjectId;
}

export interface MindmapMergeSnapshot {
    maps: MindmapMergeMap[];
    nodes: MindmapMergeNode[];
    problems: MindmapMergeProblem[];
    courses: MindmapMergeCourse[];
    indexes: string[];
}

export interface MindmapMergeGenerated {
    mapId: ObjectId;
    rootNodeId: ObjectId;
    now: Date;
}

export interface MindmapMergePlan {
    schemaVersion: number;
    fingerprint: string;
    source: MindmapMergeSnapshot;
    target: {
        map: MindmapMergeMap;
        root: MindmapMergeNode;
        nodes: MindmapMergeNode[];
    };
}

export interface MindmapMergeGates {
    actor: number;
    fingerprint: string;
    confirm: string;
    backupConfirmed: boolean;
    serviceStopped: boolean;
}

export interface MindmapMergeRepository {
    snapshot(): Promise<MindmapMergeSnapshot>;
    insertMap(doc: MindmapMergeMap): Promise<'inserted' | 'exists'>;
    insertNode(doc: MindmapMergeNode): Promise<'inserted' | 'exists'>;
    updateNode(id: ObjectId, expected: Partial<MindmapMergeNode>, set: Partial<MindmapMergeNode>, unset: string[]): Promise<'updated' | 'already'>;
    updateProblems(fromMapIds: ObjectId[], to: ObjectId): Promise<{ matched: number; modified: number }>;
    updateCourse(key: { domainId: string; docId: ObjectId }, expectedMindmapId: ObjectId, courseNodeId: ObjectId): Promise<'updated' | 'already'>;
    deleteMap(id: ObjectId, expected: Partial<MindmapMergeMap>): Promise<'deleted' | 'already'>;
    dropIndex(name: string): Promise<'dropped' | 'absent'>;
    writeAudit(record: Record<string, unknown>): Promise<void>;
}

export interface MindmapMergeApplyReport {
    schemaVersion: number;
    fingerprint: string;
    actor: number;
    counts: {
        insertMap: 'inserted' | 'exists';
        insertNode: 'inserted' | 'exists';
        nodesUpdated: number;
        nodesAlready: number;
        problemsMatched: number;
        problemsModified: number;
        coursesUpdated: number;
        coursesAlready: number;
        mapsDeleted: number;
        mapsAlreadyDeleted: number;
        indexesDropped: number;
        indexesAbsent: number;
    };
}

export interface MindmapMergeVerifyReport {
    ok: true;
    fingerprint: string;
    mapId: string;
    nodeCount: number;
    problemCount: number;
    courseCount: number;
}

interface NodeWrite {
    id: ObjectId;
    expected: Record<string, unknown>;
    set: Record<string, unknown>;
    unset: string[];
}

function hex(id: ObjectId): string {
    return id.toHexString();
}

function cloneValue<T>(value: T): T {
    if (value instanceof ObjectId) return new ObjectId(value) as T;
    if (value instanceof Date) return new Date(value.getTime()) as T;
    if (Array.isArray(value)) return value.map((item) => cloneValue(item)) as T;
    if (value && typeof value === 'object') {
        const copy: Record<string, unknown> = {};
        for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
            if (entry !== undefined) copy[key] = cloneValue(entry);
        }
        return copy as T;
    }
    return value;
}

function sameValue(left: unknown, right: unknown): boolean {
    if (left instanceof ObjectId || right instanceof ObjectId) {
        return left instanceof ObjectId && right instanceof ObjectId && left.equals(right);
    }
    if (left instanceof Date || right instanceof Date) {
        return left instanceof Date && right instanceof Date && left.getTime() === right.getTime();
    }
    if (Array.isArray(left) || Array.isArray(right)) {
        return Array.isArray(left) && Array.isArray(right)
            && left.length === right.length
            && left.every((item, index) => sameValue(item, right[index]));
    }
    if (left && right && typeof left === 'object' && typeof right === 'object') {
        const leftRecord = left as Record<string, unknown>;
        const rightRecord = right as Record<string, unknown>;
        const leftKeys = Object.keys(leftRecord).filter((key) => leftRecord[key] !== undefined).sort();
        const rightKeys = Object.keys(rightRecord).filter((key) => rightRecord[key] !== undefined).sort();
        return leftKeys.length === rightKeys.length
            && leftKeys.every((key, index) => key === rightKeys[index] && sameValue(leftRecord[key], rightRecord[key]));
    }
    return Object.is(left, right);
}

function compareText(left: string, right: string): number {
    if (left < right) return -1;
    if (left > right) return 1;
    return 0;
}

function compareHex(left: ObjectId, right: ObjectId): number {
    return compareText(hex(left), hex(right));
}

function asRecord(value: object): Record<string, unknown> {
    return value as Record<string, unknown>;
}

function applyPatch<T extends object>(doc: T, set: Record<string, unknown>, unset: readonly string[]): T {
    const next = asRecord(cloneValue(doc));
    for (const [key, value] of Object.entries(set)) {
        if (value !== undefined) next[key] = cloneValue(value);
    }
    for (const key of unset) delete next[key];
    return next as T;
}

function snapshotShape(snapshot: MindmapMergeSnapshot): string | null {
    if (!snapshot || typeof snapshot !== 'object') return 'mindmap merge snapshot is malformed';
    if (!Array.isArray(snapshot.maps) || !Array.isArray(snapshot.nodes) || !Array.isArray(snapshot.problems)) {
        return 'mindmap merge snapshot is malformed';
    }
    if (!Array.isArray(snapshot.courses) || !Array.isArray(snapshot.indexes)) return 'mindmap merge snapshot is malformed';
    return null;
}

function isAlreadyMerged(snapshot: MindmapMergeSnapshot): boolean {
    if (snapshot.maps.length !== 1) return false;
    const map = snapshot.maps[0];
    if (map.title !== MERGED_MAP_TITLE || map.visibility !== 'public') return false;
    if (!(map._id instanceof ObjectId) || !(map.rootNodeId instanceof ObjectId)) return false;
    if (Object.hasOwn(map, 'isDefault') || Object.hasOwn(map, 'ownerDomainId') || Object.hasOwn(map, 'ownerCourseId')) return false;
    const root = snapshot.nodes.find((node) => node._id instanceof ObjectId && node._id.equals(map.rootNodeId));
    if (!root || root.parentId !== null) return false;
    return root.mapId instanceof ObjectId && root.mapId.equals(map._id);
}

function courseForMap(map: MindmapMergeMap, courses: readonly MindmapMergeCourse[]): MindmapMergeCourse | undefined {
    if (!(map.ownerCourseId instanceof ObjectId)) return undefined;
    return courses.find((course) => course.docId instanceof ObjectId
        && course.docId.equals(map.ownerCourseId as ObjectId)
        && (typeof map.ownerDomainId !== 'string' || course.domainId === map.ownerDomainId));
}

function pinDomain(map: MindmapMergeMap | undefined, courses: readonly MindmapMergeCourse[]): string | null {
    if (!map) return null;
    if (typeof map.ownerDomainId === 'string' && map.ownerDomainId) return map.ownerDomainId;
    return courseForMap(map, courses)?.domainId ?? null;
}

function problemKey(problem: Pick<MindmapMergeProblem, 'domainId' | 'docId'>): string {
    return `${problem.domainId}/${problem.docId}`;
}

function courseKey(course: Pick<MindmapMergeCourse, 'domainId' | 'docId'>): string {
    const docId = course.docId instanceof ObjectId ? hex(course.docId) : String(course.docId);
    return `${course.domainId}/${docId}`;
}

function validateGenerated(snapshot: MindmapMergeSnapshot, generated: MindmapMergeGenerated, issues: string[]) {
    if (!(generated?.mapId instanceof ObjectId)) issues.push('generated mapId must be an ObjectId');
    if (!(generated?.rootNodeId instanceof ObjectId)) issues.push('generated rootNodeId must be an ObjectId');
    if (!(generated?.now instanceof Date) || Number.isNaN(generated.now.getTime())) issues.push('generated.now must be a valid Date');
    if (!(generated?.mapId instanceof ObjectId) || !(generated?.rootNodeId instanceof ObjectId)) return;
    if (snapshot.maps.some((map) => map._id instanceof ObjectId && map._id.equals(generated.mapId))) {
        issues.push(`generated mapId ${hex(generated.mapId)} collides with an existing map`);
    }
    if (snapshot.nodes.some((node) => node._id instanceof ObjectId && node._id.equals(generated.rootNodeId))) {
        issues.push(`generated rootNodeId ${hex(generated.rootNodeId)} collides with an existing node`);
    }
    if (snapshot.nodes.some((node) => node._id instanceof ObjectId && node._id.equals(generated.mapId))) {
        issues.push(`generated mapId ${hex(generated.mapId)} collides with an existing node`);
    }
}

function validateMaps(snapshot: MindmapMergeSnapshot, nodeById: Map<string, MindmapMergeNode>, issues: string[]) {
    if (snapshot.maps.length < 1) {
        issues.push('mindmap.maps must contain at least one map');
        return;
    }
    const seen = new Set<string>();
    let defaultCount = 0;
    for (const map of snapshot.maps) {
        if (!(map._id instanceof ObjectId)) {
            issues.push('mindmap map is missing _id');
            continue;
        }
        const mapId = hex(map._id);
        if (seen.has(mapId)) issues.push(`duplicate mindmap map ${mapId}`);
        seen.add(mapId);
        if (map.isDefault === true) defaultCount += 1;
        if (map.visibility !== 'public' && map.visibility !== 'hidden') issues.push(`map ${mapId} visibility is invalid`);
        if (map.layoutDirection !== 'RIGHT' && map.layoutDirection !== 'DOWN') issues.push(`map ${mapId} layoutDirection is invalid`);
        if (typeof map.title !== 'string' || !map.title) issues.push(`map ${mapId} title is invalid`);
        const roots = snapshot.nodes.filter((node) => node.parentId === null && node.mapId instanceof ObjectId && node.mapId.equals(map._id));
        if (roots.length !== 1 || !(map.rootNodeId instanceof ObjectId) || !roots[0]._id.equals(map.rootNodeId)) {
            issues.push(`map ${mapId} must have exactly one root`);
        }
        if (!(map.rootNodeId instanceof ObjectId)) {
            issues.push(`map ${mapId} rootNodeId is missing`);
        } else {
            const designated = nodeById.get(hex(map.rootNodeId));
            if (!designated) issues.push(`map ${mapId} rootNodeId is missing`);
            else if (!(designated.mapId instanceof ObjectId) || !designated.mapId.equals(map._id)) {
                const owner = designated.mapId instanceof ObjectId ? hex(designated.mapId) : 'invalid';
                issues.push(`map ${mapId} root belongs to map ${owner}`);
            }
        }
    }
    if (defaultCount > 1) issues.push('more than one map is marked isDefault');
}

function validateNodes(snapshot: MindmapMergeSnapshot, nodeById: Map<string, MindmapMergeNode>, mapIds: Set<string>, issues: string[]) {
    for (const node of snapshot.nodes) {
        if (!(node._id instanceof ObjectId)) continue;
        const id = hex(node._id);
        if (!(node.mapId instanceof ObjectId) || !mapIds.has(hex(node.mapId))) issues.push(`node ${id} mapId does not exist`);
        if (!Array.isArray(node.problemIds) || node.problemIds.some((item) => typeof item !== 'string')) {
            issues.push(`node ${id} problemIds is invalid`);
        }
        if (node.parentId === null) continue;
        if (!(node.parentId instanceof ObjectId)) {
            issues.push(`node ${id} parent is invalid`);
            continue;
        }
        const parent = nodeById.get(hex(node.parentId));
        if (!parent) issues.push(`node ${id} parent is missing`);
        else if (node.mapId instanceof ObjectId && parent.mapId instanceof ObjectId && !parent.mapId.equals(node.mapId)) {
            issues.push(`node ${id} parent is on another map`);
        }
    }
    for (const node of snapshot.nodes) {
        if (!(node._id instanceof ObjectId)) continue;
        const seen = new Set<string>();
        let current: MindmapMergeNode | undefined = node;
        while (current?.parentId instanceof ObjectId) {
            const id = hex(current._id);
            if (seen.has(id)) {
                issues.push(`node ${hex(node._id)} is in a cycle`);
                break;
            }
            seen.add(id);
            current = nodeById.get(hex(current.parentId));
        }
    }
}

function validateReferences(snapshot: MindmapMergeSnapshot, mapById: Map<string, MindmapMergeMap>, issues: string[]) {
    const problemIds = new Set<string>();
    for (const problem of snapshot.problems) {
        const key = problemKey(problem);
        if (problemIds.has(key)) issues.push(`duplicate problem ${key}`);
        problemIds.add(key);
        if (!(problem.knowledgeMapId instanceof ObjectId) || !mapById.has(hex(problem.knowledgeMapId))) {
            issues.push(`problem ${problem.domainId}/${problem.docId} knowledgeMapId does not exist`);
        }
    }
    const courseIds = new Set<string>();
    for (const course of snapshot.courses) {
        const key = courseKey(course);
        if (courseIds.has(key)) issues.push(`duplicate course ${key}`);
        courseIds.add(key);
        if (Object.hasOwn(course, 'knowledgeCourseNodeId')) issues.push(`course ${key} already has knowledgeCourseNodeId`);
        if (!Object.hasOwn(course, 'mindmapId')) continue;
        if (!(course.mindmapId instanceof ObjectId) || !mapById.has(hex(course.mindmapId))) {
            issues.push(`course ${key} mindmapId does not exist`);
        }
    }
    for (const map of snapshot.maps) {
        if (!(map.ownerCourseId instanceof ObjectId)) continue;
        if (!courseForMap(map, snapshot.courses)) issues.push(`course-owned map ownerCourseId ${hex(map.ownerCourseId)} does not exist`);
        else if (!Number.isSafeInteger(courseForMap(map, snapshot.courses)?.owner) || (courseForMap(map, snapshot.courses)?.owner ?? 0) <= 0) {
            issues.push(`course-owned map ownerCourseId ${hex(map.ownerCourseId)} owner is invalid`);
        }
    }
}

function validatePins(snapshot: MindmapMergeSnapshot, mapById: Map<string, MindmapMergeMap>, issues: string[]) {
    for (const node of snapshot.nodes) {
        if (!(node._id instanceof ObjectId) || !Object.hasOwn(node, 'coursePins')) continue;
        const id = hex(node._id);
        if (!Array.isArray(node.coursePins)) {
            issues.push(`node ${id} coursePins is invalid`);
            continue;
        }
        const domain = pinDomain(node.mapId instanceof ObjectId ? mapById.get(hex(node.mapId)) : undefined, snapshot.courses);
        for (const pin of node.coursePins) {
            if (!Number.isSafeInteger(pin) || pin < 1) {
                issues.push(`node ${id} coursePins docId ${String(pin)} is invalid`);
                continue;
            }
            const exists = snapshot.problems.some((problem) => problem.docId === pin && (domain === null || problem.domainId === domain));
            if (!exists) issues.push(`node ${id} coursePins docId ${pin} is missing from domain ${domain ?? 'any'}`);
        }
    }
}

function validateSnapshot(snapshot: MindmapMergeSnapshot, generated: MindmapMergeGenerated): string[] {
    const malformed = snapshotShape(snapshot);
    if (malformed) return [malformed];
    if (isAlreadyMerged(snapshot)) return ['already_merged'];
    const issues: string[] = [];
    const nodeById = new Map<string, MindmapMergeNode>();
    for (const node of snapshot.nodes) {
        if (!(node._id instanceof ObjectId)) {
            issues.push('mindmap node is missing _id');
            continue;
        }
        const id = hex(node._id);
        if (nodeById.has(id)) issues.push(`duplicate mindmap node ${id}`);
        else nodeById.set(id, node);
    }
    validateMaps(snapshot, nodeById, issues);
    const mapById = new Map<string, MindmapMergeMap>();
    for (const map of snapshot.maps) {
        if (map._id instanceof ObjectId && !mapById.has(hex(map._id))) mapById.set(hex(map._id), map);
    }
    validateNodes(snapshot, nodeById, new Set(mapById.keys()), issues);
    validateReferences(snapshot, mapById, issues);
    validatePins(snapshot, mapById, issues);
    validateGenerated(snapshot, generated, issues);
    return issues;
}

function mergeProblemIds(problemIds: readonly string[], pins: readonly number[]): string[] {
    const merged: string[] = [];
    const seen = new Set<string>();
    for (const id of problemIds) {
        if (seen.has(id)) continue;
        seen.add(id);
        merged.push(id);
    }
    for (const pin of pins) {
        const text = String(pin);
        if (seen.has(text)) continue;
        seen.add(text);
        merged.push(text);
    }
    return merged;
}

function ownerUidsFor(map: MindmapMergeMap, courses: readonly MindmapMergeCourse[]): number[] {
    const course = courseForMap(map, courses);
    if (!course) return [];
    return [course.owner].sort((left, right) => left - right);
}

function courseVisibilityFor(map: MindmapMergeMap): 'public' | 'hidden' {
    if (map.ownerCourseId instanceof ObjectId) return 'hidden';
    return map.visibility;
}

function layoutDirectionFor(maps: readonly MindmapMergeMap[]): 'RIGHT' | 'DOWN' {
    return (maps.find((map) => map.isDefault === true) ?? maps[0]).layoutDirection;
}

interface CoursePlacement {
    order: number;
    visibility: 'public' | 'hidden';
    ownerUids: number[];
}

function coursePlacements(snapshot: MindmapMergeSnapshot): Map<string, CoursePlacement> {
    const ordered = [...snapshot.maps].sort((left, right) => compareText(left.title, right.title) || compareHex(left._id, right._id));
    const placements = new Map<string, CoursePlacement>();
    for (const [index, map] of ordered.entries()) {
        placements.set(hex(map.rootNodeId), {
            order: index,
            visibility: courseVisibilityFor(map),
            ownerUids: ownerUidsFor(map, snapshot.courses),
        });
    }
    return placements;
}

function migratedNode(node: MindmapMergeNode, placement: CoursePlacement | undefined, generated: MindmapMergeGenerated): MindmapMergeNode {
    const next = cloneValue(node);
    next.mapId = cloneValue(generated.mapId);
    next.updatedAt = cloneValue(generated.now);
    if (placement) {
        next.parentId = cloneValue(generated.rootNodeId);
        next.order = placement.order;
        next.courseVisibility = placement.visibility;
        next.ownerUids = placement.ownerUids.slice();
    }
    if (Object.hasOwn(next, 'coursePins') && Array.isArray(next.coursePins)) {
        next.problemIds = mergeProblemIds(next.problemIds, next.coursePins);
        delete next.coursePins;
    }
    return next;
}

function canonicalSnapshot(snapshot: MindmapMergeSnapshot): MindmapMergeSnapshot {
    return {
        maps: cloneValue(snapshot.maps).sort((left, right) => compareHex(left._id, right._id)),
        nodes: cloneValue(snapshot.nodes).sort((left, right) => compareHex(left._id, right._id)),
        problems: cloneValue(snapshot.problems).sort((left, right) => compareText(problemKey(left), problemKey(right))),
        courses: cloneValue(snapshot.courses).sort((left, right) => compareText(courseKey(left), courseKey(right))),
        indexes: [...snapshot.indexes].sort(),
    };
}

function targetMap(snapshot: MindmapMergeSnapshot, generated: MindmapMergeGenerated): MindmapMergeMap {
    return {
        _id: cloneValue(generated.mapId),
        title: MERGED_MAP_TITLE,
        rootNodeId: cloneValue(generated.rootNodeId),
        visibility: 'public',
        layoutDirection: layoutDirectionFor(snapshot.maps),
        createdAt: cloneValue(generated.now),
        updatedAt: cloneValue(generated.now),
    };
}

function targetRoot(generated: MindmapMergeGenerated): MindmapMergeNode {
    return {
        _id: cloneValue(generated.rootNodeId),
        mapId: cloneValue(generated.mapId),
        parentId: null,
        topic: MERGED_MAP_TITLE,
        tags: [],
        problemIds: [],
        order: 0,
        createdAt: cloneValue(generated.now),
        updatedAt: cloneValue(generated.now),
    };
}

function structuralWrite(source: MindmapMergeNode, finalNode: MindmapMergeNode): NodeWrite {
    const set: Record<string, unknown> = {};
    const expected: Record<string, unknown> = {};
    const sourceRecord = asRecord(source);
    const finalRecord = asRecord(finalNode);
    const keys = new Set([...Object.keys(sourceRecord), ...Object.keys(finalRecord)]);
    for (const key of keys) {
        if (key === '_id' || key === 'problemIds' || key === 'coursePins') continue;
        const sourceHas = Object.hasOwn(sourceRecord, key);
        const finalHas = Object.hasOwn(finalRecord, key);
        if (sourceHas && finalHas && sameValue(sourceRecord[key], finalRecord[key])) continue;
        if (finalHas) set[key] = cloneValue(finalRecord[key]);
        if (sourceHas) expected[key] = cloneValue(sourceRecord[key]);
    }
    return { id: source._id, expected, set, unset: [] };
}

function pinWrite(source: MindmapMergeNode, finalNode: MindmapMergeNode): NodeWrite | null {
    if (!Object.hasOwn(source, 'coursePins')) return null;
    return {
        id: source._id,
        expected: {
            problemIds: cloneValue(source.problemIds),
            coursePins: cloneValue(source.coursePins),
        },
        set: { problemIds: cloneValue(finalNode.problemIds) },
        unset: ['coursePins'],
    };
}

function nodeWrites(sourceNodes: readonly MindmapMergeNode[], finalNodes: readonly MindmapMergeNode[], courseRootIds: ReadonlySet<string>): NodeWrite[] {
    const finals = new Map(finalNodes.map((node) => [hex(node._id), node]));
    const courseWrites: NodeWrite[] = [];
    const otherWrites: NodeWrite[] = [];
    const pinWrites: NodeWrite[] = [];
    const ordered = [...sourceNodes].sort((left, right) => {
        const leftFinal = finals.get(hex(left._id));
        const rightFinal = finals.get(hex(right._id));
        const leftCourse = courseRootIds.has(hex(left._id));
        const rightCourse = courseRootIds.has(hex(right._id));
        if (leftCourse !== rightCourse) return leftCourse ? -1 : 1;
        if (leftCourse && rightCourse && leftFinal && rightFinal && leftFinal.order !== rightFinal.order) return leftFinal.order - rightFinal.order;
        return compareHex(left._id, right._id);
    });
    for (const source of ordered) {
        const finalNode = finals.get(hex(source._id));
        if (!finalNode) continue;
        const structural = structuralWrite(source, finalNode);
        if (courseRootIds.has(hex(source._id))) courseWrites.push(structural);
        else otherWrites.push(structural);
        const pins = pinWrite(source, finalNode);
        if (pins) pinWrites.push(pins);
    }
    return [...courseWrites, ...otherWrites, ...pinWrites];
}

function migratedProblem(problem: MindmapMergeProblem, mapId: ObjectId): MindmapMergeProblem {
    const next = cloneValue(problem);
    next.knowledgeMapId = cloneValue(mapId);
    return next;
}

function migratedCourse(course: MindmapMergeCourse, maps: ReadonlyMap<string, MindmapMergeMap>): MindmapMergeCourse {
    const next = cloneValue(course);
    if (!(next.mindmapId instanceof ObjectId)) return next;
    const map = maps.get(hex(next.mindmapId));
    if (!map) return next;
    next.knowledgeCourseNodeId = cloneValue(map.rootNodeId);
    delete next.mindmapId;
    return next;
}

function sourceMaps(plan: MindmapMergePlan): Map<string, MindmapMergeMap> {
    return new Map(plan.source.maps.map((map) => [hex(map._id), map]));
}

function acceptableNodes(source: MindmapMergeNode, finalNode: MindmapMergeNode): MindmapMergeNode[] {
    const structural = structuralWrite(source, finalNode);
    const intermediate = applyPatch(source, structural.set, structural.unset);
    if (!Object.hasOwn(source, 'coursePins')) return [source, finalNode];
    return [source, intermediate, finalNode];
}

function checkLiveMaps(live: MindmapMergeSnapshot, plan: MindmapMergePlan, issues: string[]) {
    const sources = sourceMaps(plan);
    const targetId = hex(plan.target.map._id);
    const seen = new Set<string>();
    for (const map of live.maps) {
        if (!(map._id instanceof ObjectId)) {
            issues.push('live map is missing _id');
            continue;
        }
        const id = hex(map._id);
        if (seen.has(id)) issues.push(`duplicate live map ${id}`);
        seen.add(id);
        if (id === targetId) {
            if (!sameValue(map, plan.target.map)) issues.push(`map ${id} does not match the merged map`);
        } else if (!sources.has(id)) issues.push(`unexpected map ${id}`);
        else if (!sameValue(map, sources.get(id))) issues.push(`map ${id} changed after the plan`);
    }
}

function checkLiveNodes(live: MindmapMergeSnapshot, plan: MindmapMergePlan, issues: string[]) {
    const finals = new Map(plan.target.nodes.map((node) => [hex(node._id), node]));
    const sources = new Map(plan.source.nodes.map((node) => [hex(node._id), node]));
    const rootId = hex(plan.target.root._id);
    const seen = new Set<string>();
    for (const node of live.nodes) {
        if (!(node._id instanceof ObjectId)) {
            issues.push('live node is missing _id');
            continue;
        }
        const id = hex(node._id);
        if (seen.has(id)) issues.push(`duplicate live node ${id}`);
        seen.add(id);
        if (id === rootId) {
            if (!sameValue(node, plan.target.root)) issues.push(`root ${id} does not match the plan`);
            continue;
        }
        const source = sources.get(id);
        const finalNode = finals.get(id);
        if (!source || !finalNode) {
            issues.push(`unexpected node ${id}`);
            continue;
        }
        if (!acceptableNodes(source, finalNode).some((candidate) => sameValue(node, candidate))) {
            issues.push(`node ${id} changed after the plan`);
        }
    }
    for (const id of sources.keys()) {
        if (!seen.has(id)) issues.push(`missing node ${id}`);
    }
}

function checkLiveProblems(live: MindmapMergeSnapshot, plan: MindmapMergePlan, issues: string[]) {
    const sources = new Map(plan.source.problems.map((problem) => [problemKey(problem), problem]));
    const seen = new Set<string>();
    for (const problem of live.problems) {
        const key = problemKey(problem);
        if (seen.has(key)) issues.push(`duplicate live problem ${key}`);
        seen.add(key);
        const source = sources.get(key);
        if (!source) {
            issues.push(`unexpected problem ${key}`);
            continue;
        }
        const migrated = migratedProblem(source, plan.target.map._id);
        if (!sameValue(problem, source) && !sameValue(problem, migrated)) issues.push(`problem ${key} changed after the plan`);
    }
    for (const key of sources.keys()) {
        if (!seen.has(key)) issues.push(`missing problem ${key}`);
    }
}

function checkLiveCourses(live: MindmapMergeSnapshot, plan: MindmapMergePlan, issues: string[]) {
    const maps = sourceMaps(plan);
    const sources = new Map(plan.source.courses.map((course) => [courseKey(course), course]));
    const seen = new Set<string>();
    for (const course of live.courses) {
        const key = courseKey(course);
        if (seen.has(key)) issues.push(`duplicate live course ${key}`);
        seen.add(key);
        const source = sources.get(key);
        if (!source) {
            issues.push(`unexpected course ${key}`);
            continue;
        }
        if (!sameValue(course, source) && !sameValue(course, migratedCourse(source, maps))) {
            issues.push(`course ${key} changed after the plan`);
        }
    }
    for (const key of sources.keys()) {
        if (!seen.has(key)) issues.push(`missing course ${key}`);
    }
}

function checkLiveIndexes(live: MindmapMergeSnapshot, plan: MindmapMergePlan, issues: string[]) {
    const dropped = new Set<string>(DROPPED_INDEXES);
    const source = new Set(plan.source.indexes);
    for (const name of live.indexes) {
        if (!source.has(name)) issues.push(`unexpected index ${name}`);
    }
    for (const name of source) {
        if (dropped.has(name)) continue;
        if (!live.indexes.includes(name)) issues.push(`missing index ${name}`);
    }
}

function compatibilityIssues(live: MindmapMergeSnapshot, plan: MindmapMergePlan): string[] {
    const malformed = snapshotShape(live);
    if (malformed) return [malformed];
    const issues: string[] = [];
    checkLiveMaps(live, plan, issues);
    checkLiveNodes(live, plan, issues);
    checkLiveProblems(live, plan, issues);
    checkLiveCourses(live, plan, issues);
    checkLiveIndexes(live, plan, issues);
    return issues;
}

function assertGates(plan: MindmapMergePlan, gates: MindmapMergeGates) {
    if (!plan?.target?.map || !plan.target.root || !Array.isArray(plan.target.nodes) || !plan.source) {
        throw new Error('mindmap merge plan is malformed');
    }
    if (plan.schemaVersion !== MINDMAP_MERGE_SCHEMA_VERSION) throw new Error('mindmap merge plan schemaVersion is unsupported');
    if (gates.serviceStopped !== true || gates.backupConfirmed !== true) {
        throw new Error('mindmap merge requires serviceStopped and backupConfirmed');
    }
    if (gates.fingerprint !== plan.fingerprint || mindmapMergeFingerprint(plan) !== plan.fingerprint) {
        throw new Error('mindmap merge fingerprint does not match the plan');
    }
    if (gates.confirm !== `${CONFIRM_PREFIX}${plan.fingerprint}`) throw new Error('mindmap merge confirmation does not match the plan');
    if (!Number.isSafeInteger(gates.actor) || gates.actor <= 0) throw new Error('mindmap merge actor must be a positive integer');
}

function rootIds(plan: MindmapMergePlan): Set<string> {
    return new Set(plan.source.maps.map((map) => hex(map.rootNodeId)));
}

function countResult(result: 'updated' | 'already' | 'deleted' | 'dropped' | 'absent', success: 'updated' | 'deleted' | 'dropped'): [number, number] {
    return result === success ? [1, 0] : [0, 1];
}

export function mindmapMergeFingerprint(plan: Pick<MindmapMergePlan, 'schemaVersion' | 'source' | 'target'>): string {
    return sha256(canonicalJson(BSON.EJSON.serialize({
        schemaVersion: plan.schemaVersion,
        source: plan.source,
        target: plan.target,
    }, { relaxed: false })));
}

export function buildMindmapMergePlan(snapshot: MindmapMergeSnapshot, generated: MindmapMergeGenerated): MindmapMergePlan {
    const issues = validateSnapshot(snapshot, generated);
    if (issues.length === 1 && issues[0] === 'already_merged') throw new MindmapMergePlanError('already_merged', [], 'already_merged');
    if (issues.length > 0) throw new MindmapMergePlanError('mindmap merge preconditions failed', issues);
    const placements = coursePlacements(snapshot);
    const nodes = snapshot.nodes
        .map((node) => migratedNode(node, placements.get(hex(node._id)), generated))
        .sort((left, right) => compareHex(left._id, right._id));
    const plan: MindmapMergePlan = {
        schemaVersion: MINDMAP_MERGE_SCHEMA_VERSION,
        fingerprint: '',
        source: canonicalSnapshot(snapshot),
        target: {
            map: targetMap(snapshot, generated),
            root: targetRoot(generated),
            nodes,
        },
    };
    plan.fingerprint = mindmapMergeFingerprint(plan);
    return plan;
}

export async function applyMindmapMergePlan(
    repo: MindmapMergeRepository,
    plan: MindmapMergePlan,
    gates: MindmapMergeGates,
): Promise<MindmapMergeApplyReport> {
    assertGates(plan, gates);
    const live = await repo.snapshot();
    const drift = compatibilityIssues(live, plan);
    if (drift.length > 0) throw new Error(`mindmap merge snapshot no longer matches the plan\n${drift.join('\n')}`);
    const counts: MindmapMergeApplyReport['counts'] = {
        insertMap: await repo.insertMap(cloneValue(plan.target.map)),
        insertNode: await repo.insertNode(cloneValue(plan.target.root)),
        nodesUpdated: 0,
        nodesAlready: 0,
        problemsMatched: 0,
        problemsModified: 0,
        coursesUpdated: 0,
        coursesAlready: 0,
        mapsDeleted: 0,
        mapsAlreadyDeleted: 0,
        indexesDropped: 0,
        indexesAbsent: 0,
    };
    for (const write of nodeWrites(plan.source.nodes, plan.target.nodes, rootIds(plan))) {
        const result = await repo.updateNode(write.id, write.expected, write.set, write.unset);
        const [updated, already] = countResult(result, 'updated');
        counts.nodesUpdated += updated;
        counts.nodesAlready += already;
    }
    const oldMapIds = plan.source.maps.map((map) => cloneValue(map._id));
    const pendingProblems = live.problems.filter((problem) => oldMapIds.some((id) => id.equals(problem.knowledgeMapId))).length;
    const problems = await repo.updateProblems(oldMapIds, plan.target.map._id);
    if (problems.matched !== pendingProblems || problems.modified !== pendingProblems) {
        throw new Error(`problem update count mismatch: expected ${pendingProblems}, got matched ${problems.matched} modified ${problems.modified}`);
    }
    counts.problemsMatched = problems.matched;
    counts.problemsModified = problems.modified;
    const maps = sourceMaps(plan);
    const courses = [...plan.source.courses]
        .filter((course) => course.mindmapId instanceof ObjectId)
        .sort((left, right) => compareText(courseKey(left), courseKey(right)));
    for (const course of courses) {
        const map = maps.get(hex(course.mindmapId as ObjectId));
        if (!map) throw new Error(`course ${courseKey(course)} mindmap is missing from the plan`);
        const result = await repo.updateCourse(
            { domainId: course.domainId, docId: course.docId },
            course.mindmapId as ObjectId,
            map.rootNodeId,
        );
        if (result === 'updated') counts.coursesUpdated += 1;
        else counts.coursesAlready += 1;
    }
    const mapsToDelete = [...plan.source.maps].sort((left, right) => compareHex(left._id, right._id));
    for (const map of mapsToDelete) {
        const result = await repo.deleteMap(map._id, map);
        const [deleted, already] = countResult(result, 'deleted');
        counts.mapsDeleted += deleted;
        counts.mapsAlreadyDeleted += already;
    }
    for (const name of DROPPED_INDEXES) {
        const result = await repo.dropIndex(name);
        const [dropped, absent] = countResult(result, 'dropped');
        counts.indexesDropped += dropped;
        counts.indexesAbsent += absent;
    }
    await repo.writeAudit({
        type: 'mindmap.merge-courses',
        actor: gates.actor,
        fingerprint: plan.fingerprint,
        mapId: hex(plan.target.map._id),
        result: 'applied',
        counts: {
            nodes: plan.target.nodes.length,
            problems: plan.source.problems.length,
            courses: courses.length,
            maps: plan.source.maps.length,
        },
    });
    return {
        schemaVersion: MINDMAP_MERGE_SCHEMA_VERSION,
        fingerprint: plan.fingerprint,
        actor: gates.actor,
        counts,
    };
}

function verifyDocuments(live: MindmapMergeSnapshot, plan: MindmapMergePlan, diffs: string[]) {
    if (live.maps.length !== 1) diffs.push(`expected exactly 1 map, found ${live.maps.length}`);
    else if (!sameValue(live.maps[0], plan.target.map)) diffs.push(`map ${hex(plan.target.map._id)} differs from the merged map`);
    const expectedIds = new Set(plan.target.nodes.map((node) => hex(node._id)));
    expectedIds.add(hex(plan.target.root._id));
    const liveIds = new Set<string>();
    for (const node of live.nodes) {
        if (!(node._id instanceof ObjectId)) {
            diffs.push('live node is missing _id');
            continue;
        }
        const id = hex(node._id);
        if (liveIds.has(id)) diffs.push(`duplicate node ${id}`);
        liveIds.add(id);
        if (Object.hasOwn(node, 'coursePins')) diffs.push(`node ${id} still has coursePins`);
        if (!node.mapId?.equals?.(plan.target.map._id)) diffs.push(`node ${id} mapId is not the merged map`);
    }
    for (const id of expectedIds) {
        if (!liveIds.has(id)) diffs.push(`missing node ${id}`);
    }
    for (const id of liveIds) {
        if (!expectedIds.has(id)) diffs.push(`unexpected node ${id}`);
    }
    const finals = new Map<string, MindmapMergeNode>([[hex(plan.target.root._id), plan.target.root]]);
    for (const node of plan.target.nodes) finals.set(hex(node._id), node);
    for (const node of live.nodes) {
        if (!(node._id instanceof ObjectId)) continue;
        const expected = finals.get(hex(node._id));
        if (expected && !sameValue(node, expected)) diffs.push(`node ${hex(node._id)} differs from the plan`);
    }
    const roots = live.nodes.filter((node) => node.parentId === null);
    if (roots.length !== 1 || !(roots[0]._id instanceof ObjectId) || !roots[0]._id.equals(plan.target.root._id)) {
        diffs.push(`expected root ${hex(plan.target.root._id)} to be the only root`);
    }
    for (const node of plan.target.nodes) {
        if (!(node.parentId instanceof ObjectId) || !node.parentId.equals(plan.target.root._id)) continue;
        const liveNode = live.nodes.find((item) => item._id instanceof ObjectId && item._id.equals(node._id));
        if (!liveNode) continue;
        if (liveNode.order !== node.order || liveNode.courseVisibility !== node.courseVisibility || !sameValue(liveNode.ownerUids, node.ownerUids)) {
            diffs.push(`course node ${hex(node._id)} does not match the planned order, visibility, or owners`);
        }
    }
}

function verifyLinks(live: MindmapMergeSnapshot, plan: MindmapMergePlan, diffs: string[]) {
    const oldMapIds = new Set(plan.source.maps.map((map) => hex(map._id)));
    if (live.problems.length !== plan.source.problems.length) {
        diffs.push(`expected ${plan.source.problems.length} problems, found ${live.problems.length}`);
    }
    const problems = new Map(plan.source.problems.map((problem) => [problemKey(problem), migratedProblem(problem, plan.target.map._id)]));
    for (const problem of live.problems) {
        const key = problemKey(problem);
        if (problem.knowledgeMapId instanceof ObjectId && oldMapIds.has(hex(problem.knowledgeMapId))) {
            diffs.push(`problem ${key} still points at an old map`);
        }
        const expected = problems.get(key);
        if (!expected) diffs.push(`unexpected problem ${key}`);
        else if (!sameValue(problem, expected)) diffs.push(`problem ${key} differs from the plan`);
    }
    const maps = sourceMaps(plan);
    const courses = new Map(plan.source.courses.map((course) => [courseKey(course), migratedCourse(course, maps)]));
    if (live.courses.length !== plan.source.courses.length) {
        diffs.push(`expected ${plan.source.courses.length} courses, found ${live.courses.length}`);
    }
    for (const course of live.courses) {
        const key = courseKey(course);
        if (Object.hasOwn(course, 'mindmapId')) diffs.push(`course ${key} still has mindmapId`);
        const expected = courses.get(key);
        if (!expected) diffs.push(`unexpected course ${key}`);
        else if (!sameValue(course, expected)) diffs.push(`course ${key} binding differs from the plan`);
    }
    for (const name of DROPPED_INDEXES) {
        if (live.indexes.includes(name)) diffs.push(`index ${name} still exists`);
    }
}

export async function verifyMindmapMerge(repo: MindmapMergeRepository, plan: MindmapMergePlan): Promise<MindmapMergeVerifyReport> {
    if (mindmapMergeFingerprint(plan) !== plan.fingerprint) throw new Error('mindmap merge plan fingerprint is invalid');
    const live = await repo.snapshot();
    const diffs: string[] = [];
    const malformed = snapshotShape(live);
    if (malformed) diffs.push(malformed);
    else {
        verifyDocuments(live, plan, diffs);
        verifyLinks(live, plan, diffs);
    }
    if (diffs.length > 0) {
        const error = new Error(`mindmap merge verification failed\n${diffs.join('\n')}`) as Error & { diffs: string[] };
        error.diffs = diffs;
        throw error;
    }
    return {
        ok: true,
        fingerprint: plan.fingerprint,
        mapId: hex(plan.target.map._id),
        nodeCount: live.nodes.length,
        problemCount: live.problems.length,
        courseCount: live.courses.length,
    };
}
