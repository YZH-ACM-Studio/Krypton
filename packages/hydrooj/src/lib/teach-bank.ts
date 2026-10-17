import { escapeRegExp } from 'lodash';
import { type Filter, ObjectId } from 'mongodb';
import {
    effectiveProblemKind,
    isTeachKindAllowed,
    parseProblemKind,
    parseTeachType,
    TEACH_ALLOWED_KINDS,
    type ProblemKind,
    type TeachType,
} from '@hydrooj/common';
import { parseMemoryMB, parseTimeMS } from '@hydrooj/utils';
import { localizedErrorText, NotFoundError, ValidationError } from '../error';
import { readProblemSchoolBank } from './teach-fields';
import { parseProblemConfigObject } from './problem-config';
import { buildProblemContainerSelectionScope, type ProblemAclUser } from '../model/problem-access';
import problem, { type ProblemDoc } from '../model/problem';
import user from '../model/user';

const PAGE_SIZE = 30;
const MAX_EXCLUDE = 500;
const UNREGISTERED = 'krypton-mindmap listTeachKnowledgeSources is not registered';
const BASIC_OBJECTIVE = new Set<ProblemKind>(['single', 'multi', 'true_false', 'blank']);
const SOURCES = ['all', 'school', 'mine'] as const;

const TREE_PROJECTION: (keyof ProblemDoc)[] = ['docId', 'knowledgeMapId', 'knowledgeNodeIds', 'managedAuthoring'];
const LIST_PROJECTION: (keyof ProblemDoc)[] = [
    'docId',
    'pid',
    'title',
    'problemKind',
    'difficulty',
    'tag',
    'nSubmit',
    'nAccept',
    'hidden',
    'owner',
    'schoolBank',
    'knowledgeMapId',
    'knowledgeNodeIds',
    'managedAuthoring',
];
const PREVIEW_PROJECTION: (keyof ProblemDoc)[] = [...LIST_PROJECTION, 'content', 'config'];

type BankSource = (typeof SOURCES)[number];

export interface TeachKnowledgeNode {
    id: string;
    title: string;
    count: number;
    children: TeachKnowledgeNode[];
}

export interface TeachKnowledgeCourse {
    id: string;
    title: string;
    hidden: boolean;
    total: number;
    nodes: TeachKnowledgeNode[];
}

export interface TeachKnowledgeTree {
    courses: TeachKnowledgeCourse[];
}

export interface TeachBankItem {
    docId: number;
    pid: string;
    title: string;
    kind: ProblemKind;
    difficulty: number | null;
    tags: string[];
    nSubmit: number;
    nAccept: number;
    hidden: boolean;
    mine: boolean;
    schoolShared: boolean;
    ownerName: string;
    courseId: string | null;
    nodePath: string[];
}

export interface TeachBankPage {
    items: TeachBankItem[];
    page: number;
    pageCount: number;
    total: number;
}

export type TeachObjectivePreview =
    | { kind: 'single'; options: string[]; answerIndex: number }
    | { kind: 'multi'; options: string[]; answerIndexes: number[] }
    | { kind: 'true_false'; answer: boolean }
    | { kind: 'blank'; answer: string };

export interface TeachBankPreview {
    item: TeachBankItem;
    content: string;
    objective: TeachObjectivePreview | null;
    limits: { timeMs: number | null; memoryMb: number | null };
}

interface SourceNode {
    id: string;
    parentId: string | null;
    title: string;
    order: number;
    pinnedDocIds: number[];
}

interface Source {
    courseId: string;
    title: string;
    hidden: boolean;
    mapId: string;
    rootNodeId: string;
    nodes: SourceNode[];
}

interface BuiltNode {
    id: string;
    title: string;
    path: string[];
    ownPins: Set<number>;
    pins: number[];
    selfAndDescendants: string[];
    children: BuiltNode[];
}

interface IndexedSource {
    courseId: string;
    title: string;
    hidden: boolean;
    mapId: string;
    rootNodeId: string;
    roots: BuiltNode[];
    byId: Map<string, BuiltNode>;
    preorder: BuiltNode[];
    allNodeIds: string[];
    allPins: number[];
}

interface ProblemHit {
    docId: number;
    mapId: string | null;
    nodeIds: Set<string>;
}

interface BankQuery {
    type: TeachType;
    course: string;
    node: string;
    source: BankSource;
    kind: ProblemKind | 'all';
    difficulty: number | 'all';
    q: string;
    exclude: number[];
    page: number;
}

function invalid(field: string, detail: ReturnType<typeof localizedErrorText>): never {
    throw new ValidationError(field, null, detail);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function readTeachBankArgs(raw: unknown): Record<string, unknown> {
    if (!isRecord(raw)) invalid('query', localizedErrorText`查询参数无效。`);
    return raw;
}

function hexId(value: unknown, label: string): string {
    if (typeof value !== 'string' || !/^[0-9a-fA-F]{24}$/.test(value)) {
        throw new TypeError(`teach knowledge ${label} is not an id`);
    }
    return value.toLowerCase();
}

function readSourceNode(value: unknown): SourceNode {
    if (!isRecord(value)) throw new TypeError('teach knowledge node is invalid');
    const id = hexId(value.id, 'node');
    let parentId: string | null;
    if (value.parentId === null) parentId = null;
    else parentId = hexId(value.parentId, 'parent');
    if (typeof value.title !== 'string') throw new TypeError('teach knowledge node title is invalid');
    if (typeof value.order !== 'number' || !Number.isFinite(value.order)) throw new TypeError('teach knowledge node order is invalid');
    if (!Array.isArray(value.pinnedDocIds)) throw new TypeError('teach knowledge pins are invalid');
    const pinnedDocIds: number[] = [];
    for (const pin of value.pinnedDocIds) {
        if (typeof pin !== 'number' || !Number.isSafeInteger(pin) || pin < 1) throw new TypeError('teach knowledge pins are invalid');
        pinnedDocIds.push(pin);
    }
    return { id, parentId, title: value.title, order: value.order, pinnedDocIds };
}

function readSource(value: unknown): Source {
    if (!isRecord(value)) throw new TypeError('teach knowledge source is invalid');
    const courseId = hexId(value.courseId, 'course');
    const mapId = hexId(value.mapId, 'map');
    const rootNodeId = hexId(value.rootNodeId, 'root');
    if (typeof value.title !== 'string') throw new TypeError('teach knowledge source title is invalid');
    if (typeof value.hidden !== 'boolean') throw new TypeError('teach knowledge source hidden is invalid');
    if (!Array.isArray(value.nodes)) throw new TypeError('teach knowledge source nodes are invalid');
    const nodes = value.nodes.map((node) => readSourceNode(node));
    for (const node of nodes) {
        if (node.id === rootNodeId) throw new TypeError(`teach knowledge node repeats the root node=${node.id}`);
        if (node.parentId === rootNodeId) node.parentId = null;
    }
    return { courseId, title: value.title, hidden: value.hidden, mapId, rootNodeId, nodes };
}

async function loadSources(): Promise<Source[]> {
    const mindmap = (global.Hydro?.model as { mindmap?: { listTeachKnowledgeSources?: unknown } } | undefined)?.mindmap;
    const list = mindmap?.listTeachKnowledgeSources;
    if (typeof list !== 'function') throw new TypeError(UNREGISTERED);
    const value: unknown = await list();
    if (!Array.isArray(value)) throw new TypeError('krypton-mindmap listTeachKnowledgeSources returned a non-array');
    return value.map((item) => readSource(item));
}

function compareNodes(left: SourceNode, right: SourceNode): number {
    if (left.order !== right.order) return left.order < right.order ? -1 : 1;
    if (left.id === right.id) return 0;
    return left.id < right.id ? -1 : 1;
}

function indexSource(source: Source): IndexedSource {
    const byParent = new Map<string | null, SourceNode[]>();
    const seenIds = new Set<string>();
    for (const node of source.nodes) {
        if (seenIds.has(node.id)) throw new TypeError(`teach knowledge duplicate node ${node.id}`);
        seenIds.add(node.id);
        const list = byParent.get(node.parentId) ?? [];
        list.push(node);
        byParent.set(node.parentId, list);
    }
    for (const node of source.nodes) {
        if (node.parentId !== null && !seenIds.has(node.parentId)) {
            throw new TypeError(`teach knowledge parent missing node=${node.id}`);
        }
    }
    for (const list of byParent.values()) list.sort(compareNodes);

    const byId = new Map<string, BuiltNode>();
    const preorder: BuiltNode[] = [];
    const visiting = new Set<string>();

    function build(node: SourceNode, prefix: string[]): BuiltNode {
        if (visiting.has(node.id)) throw new TypeError(`teach knowledge cycle node=${node.id}`);
        visiting.add(node.id);
        const path = [...prefix, node.title];
        const children = (byParent.get(node.id) ?? []).map((child) => build(child, path));
        visiting.delete(node.id);
        const ownPins = new Set(node.pinnedDocIds);
        const pinSet = new Set<number>(ownPins);
        const selfAndDescendants = [node.id];
        for (const child of children) {
            for (const pin of child.pins) pinSet.add(pin);
            for (const id of child.selfAndDescendants) selfAndDescendants.push(id);
        }
        const built: BuiltNode = {
            id: node.id,
            title: node.title,
            path,
            ownPins,
            pins: [...pinSet],
            selfAndDescendants,
            children,
        };
        byId.set(node.id, built);
        return built;
    }

    const roots = (byParent.get(null) ?? []).map((node) => build(node, []));
    function walk(nodes: BuiltNode[]): void {
        for (const node of nodes) {
            preorder.push(node);
            walk(node.children);
        }
    }
    walk(roots);
    if (preorder.length !== source.nodes.length) throw new TypeError(`teach knowledge unreachable nodes map=${source.mapId}`);
    const allPins = new Set<number>();
    for (const node of preorder) for (const pin of node.ownPins) allPins.add(pin);
    return {
        courseId: source.courseId,
        title: source.title,
        hidden: source.hidden,
        mapId: source.mapId,
        rootNodeId: source.rootNodeId,
        roots,
        byId,
        preorder,
        allNodeIds: preorder.map((node) => node.id),
        allPins: [...allPins],
    };
}

function hexOf(value: ObjectId | null | undefined): string | null {
    if (value == null) return null;
    return value.toHexString();
}

function hitOf(doc: ProblemDoc): ProblemHit {
    const nodeIds = new Set<string>();
    for (const id of doc.knowledgeNodeIds ?? []) nodeIds.add(id.toHexString());
    for (const id of doc.managedAuthoring?.selectedMindmapNodeIds ?? []) nodeIds.add(id.toHexString());
    return { docId: readDocId(doc), mapId: hexOf(doc.knowledgeMapId), nodeIds };
}

function directNodeIds(hit: ProblemHit, source: IndexedSource): Set<string> {
    const direct = new Set<string>();
    // Canonical node ids belong only to the problem's own map. Course pins are
    // a separate membership and stay attached when knowledgeMapId is absent or elsewhere.
    if (hit.mapId === source.mapId) {
        if (hit.nodeIds.has(source.rootNodeId)) direct.add(source.rootNodeId);
        for (const id of hit.nodeIds) {
            if (source.byId.has(id)) direct.add(id);
        }
    }
    for (const [id, node] of source.byId) {
        if (node.ownPins.has(hit.docId)) direct.add(id);
    }
    return direct;
}

function placement(hit: ProblemHit, sources: readonly IndexedSource[]): { courseId: string | null; nodePath: string[] } {
    for (const source of sources) {
        const direct = directNodeIds(hit, source);
        if (direct.size === 0) continue;
        for (const node of source.preorder) {
            if (direct.has(node.id)) return { courseId: source.courseId, nodePath: [...node.path] };
        }
        if (direct.has(source.rootNodeId)) return { courseId: source.courseId, nodePath: [] };
    }
    return { courseId: null, nodePath: [] };
}

function countCourse(source: IndexedSource, hits: readonly ProblemHit[]): { total: number; counts: Map<string, number> } {
    const courseDocs = new Set<number>();
    const perNode = new Map<string, Set<number>>();
    for (const id of source.byId.keys()) perNode.set(id, new Set());
    for (const hit of hits) {
        const direct = directNodeIds(hit, source);
        if (direct.size === 0) continue;
        courseDocs.add(hit.docId);
        for (const [id, node] of source.byId) {
            if (node.selfAndDescendants.some((desc) => direct.has(desc))) perNode.get(id)?.add(hit.docId);
        }
    }
    const counts = new Map<string, number>();
    for (const [id, docs] of perNode) counts.set(id, docs.size);
    return { total: courseDocs.size, counts };
}

function renderNodes(nodes: readonly BuiltNode[], counts: Map<string, number>): TeachKnowledgeNode[] {
    return nodes.map((node) => ({
        id: node.id,
        title: node.title,
        count: counts.get(node.id) ?? 0,
        children: renderNodes(node.children, counts),
    }));
}

function kindFilter(type: TeachType, selected: ProblemKind | 'all'): Filter<ProblemDoc> {
    const allowed = selected === 'all' ? TEACH_ALLOWED_KINDS[type] : [selected];
    const clauses: Filter<ProblemDoc>[] = [];
    const concrete = allowed.filter((kind) => kind !== 'programming');
    if (allowed.includes('programming')) {
        clauses.push({ problemKind: 'programming' }, { problemKind: { $exists: false } });
    }
    if (concrete.length === 1) clauses.push({ problemKind: concrete[0] });
    else if (concrete.length > 1) clauses.push({ problemKind: { $in: [...concrete] } });
    if (clauses.length === 1) return clauses[0];
    return { $or: clauses };
}

function baseFilter(actor: ProblemAclUser, type: TeachType, selected: ProblemKind | 'all'): Filter<ProblemDoc> {
    return {
        $and: [buildProblemContainerSelectionScope(actor), { archivedAt: { $exists: false } }, kindFilter(type, selected)],
    };
}

function textFilter(q: string): Filter<ProblemDoc> {
    const escaped = escapeRegExp(q.toLowerCase());
    const $regex = new RegExp(q.length >= 2 ? escaped : `^${escaped}`, 'i');
    const alternatives: Filter<ProblemDoc>[] = [{ pid: $regex }, { title: $regex }, { tag: q }];
    if (Number.isSafeInteger(+q)) alternatives.unshift({ docId: +q });
    else if (/^P\d+$/i.test(q) && Number.isSafeInteger(+q.substring(1))) alternatives.unshift({ docId: +q.substring(1) });
    return { $or: alternatives };
}

function withAnd(filter: Filter<ProblemDoc>, extra: Filter<ProblemDoc>): Filter<ProblemDoc> {
    const existing = Array.isArray(filter.$and) ? filter.$and : [filter];
    return { $and: [...existing, extra] };
}

function parseKind(type: TeachType, value: unknown): ProblemKind | 'all' {
    if (value === undefined || value === null || value === '' || value === 'all') return 'all';
    if (typeof value !== 'string') invalid('kind', localizedErrorText`题型筛选无效。`);
    let kind: ProblemKind;
    try {
        kind = parseProblemKind(value);
    } catch (error) {
        if (error instanceof TypeError) invalid('kind', localizedErrorText`题型筛选无效。`);
        throw error;
    }
    if (!isTeachKindAllowed(type, kind)) invalid('kind', localizedErrorText`这个类型的题目集不能筛选这种题。`);
    return kind;
}

function parseDifficulty(value: unknown): number | 'all' {
    if (value === undefined || value === null || value === '' || value === 'all') return 'all';
    if (typeof value !== 'string' || !/^(?:[0-9]|10)$/.test(value)) invalid('difficulty', localizedErrorText`难度必须是 0 到 10。`);
    return Number(value);
}

function parsePage(value: unknown): number {
    if (value === undefined || value === null || value === '') return 1;
    if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) invalid('page', localizedErrorText`页码必须是正整数。`);
    const page = Number(value);
    if (!Number.isSafeInteger(page) || page < 1) invalid('page', localizedErrorText`页码必须是正整数。`);
    return page;
}

function parseSource(value: unknown): BankSource {
    if (value === undefined || value === null || value === '') return 'all';
    if (typeof value !== 'string' || !(SOURCES as readonly string[]).includes(value)) invalid('source', localizedErrorText`题目来源筛选无效。`);
    return value as BankSource;
}

function parseIdOrAll(value: unknown, field: 'course' | 'node'): string {
    if (value === undefined || value === null || value === '') return 'all';
    if (typeof value !== 'string') {
        invalid(field, field === 'course' ? localizedErrorText`课程筛选无效。` : localizedErrorText`知识点筛选无效。`);
    }
    return value;
}

function parseQueryText(value: unknown): string {
    if (value === undefined || value === null || value === '') return '';
    if (typeof value !== 'string') invalid('q', localizedErrorText`搜索词无效。`);
    return value;
}

function parseExclude(value: unknown): number[] {
    if (value === undefined || value === null || value === '') return [];
    if (typeof value !== 'string') invalid('exclude', localizedErrorText`排除的题目编号无效。`);
    const parts = value.split(',');
    if (parts.length > MAX_EXCLUDE) invalid('exclude', localizedErrorText`一次最多排除 500 道题。`);
    const ids: number[] = [];
    for (const part of parts) {
        if (!/^[1-9]\d*$/.test(part)) invalid('exclude', localizedErrorText`排除的题目编号无效。`);
        const id = Number(part);
        if (!Number.isSafeInteger(id)) invalid('exclude', localizedErrorText`排除的题目编号无效。`);
        ids.push(id);
    }
    return ids;
}

function teachType(value: unknown): TeachType {
    try {
        return parseTeachType(value);
    } catch (error) {
        if (error instanceof TypeError && error.message === 'teach_type_invalid') {
            invalid('type', localizedErrorText`题目集类型无效。`);
        }
        throw error;
    }
}

function parseBankQuery(args: Record<string, unknown>): BankQuery {
    const type = teachType(args.type);
    return {
        type,
        course: parseIdOrAll(args.course, 'course'),
        node: parseIdOrAll(args.node, 'node'),
        source: parseSource(args.source),
        kind: parseKind(type, args.kind),
        difficulty: parseDifficulty(args.difficulty),
        q: parseQueryText(args.q),
        exclude: parseExclude(args.exclude),
        page: parsePage(args.page),
    };
}

function findCourse(sources: readonly IndexedSource[], courseId: string): IndexedSource {
    const wanted = courseId.toLowerCase();
    const found = sources.find((source) => source.courseId === wanted);
    if (!found) invalid('course', localizedErrorText`课程不存在。`);
    return found;
}

function courseScope(source: IndexedSource, nodeId: string): { ids: string[]; pins: number[] } {
    if (nodeId === 'all' || nodeId.toLowerCase() === source.rootNodeId) {
        return { ids: [source.rootNodeId, ...source.allNodeIds], pins: source.allPins };
    }
    const node = source.byId.get(nodeId.toLowerCase());
    if (!node) invalid('node', localizedErrorText`知识点不存在。`);
    return { ids: node.selfAndDescendants, pins: node.pins };
}

function matchesCourseNode(hit: ProblemHit, source: IndexedSource, nodeId: string): boolean {
    const direct = directNodeIds(hit, source);
    if (direct.size === 0) return false;
    if (nodeId === 'all' || nodeId.toLowerCase() === source.rootNodeId) return true;
    const node = source.byId.get(nodeId.toLowerCase());
    return node !== undefined && node.selfAndDescendants.some((id) => direct.has(id));
}

function courseMembershipFilter(source: IndexedSource, nodeId: string): Filter<ProblemDoc> {
    const scope = courseScope(source, nodeId);
    const objectIds = scope.ids.map((id) => new ObjectId(id));
    const clauses: Filter<ProblemDoc>[] = [
        {
            knowledgeMapId: new ObjectId(source.mapId),
            $or: [
                { knowledgeNodeIds: { $in: objectIds } },
                { 'managedAuthoring.selectedMindmapNodeIds': { $in: objectIds } },
            ],
        },
        // The bank harness compares an ObjectId with $in before it walks array elements,
        // so the clause above does not return canonical selections there. The whole map
        // is included and matchesCourseNode applies the same subtree rule.
        { knowledgeMapId: new ObjectId(source.mapId) },
    ];
    if (scope.pins.length) clauses.push({ docId: { $in: scope.pins } });
    return { $or: clauses };
}

function listFilter(actor: ProblemAclUser, query: BankQuery, course: IndexedSource | null): Filter<ProblemDoc> {
    let filter = baseFilter(actor, query.type, query.kind);
    if (course) filter = withAnd(filter, courseMembershipFilter(course, query.node));
    if (query.source === 'mine') filter = withAnd(filter, { owner: actor._id });
    else if (query.source === 'school') {
        filter = withAnd(filter, {
            owner: { $ne: actor._id },
            $or: [{ hidden: { $ne: true } }, { 'schoolBank.sharedAt': { $exists: true } }],
        });
    }
    if (query.difficulty !== 'all') {
        // Missing difficulty is the legacy unset value and matches difficulty 0.
        // `$in: [0, undefined]` is dropped by the Mongo driver, so test the field directly.
        filter = withAnd(
            filter,
            query.difficulty === 0 ? { $or: [{ difficulty: 0 }, { difficulty: { $exists: false } }] } : { difficulty: query.difficulty },
        );
    }
    if (query.q) filter = withAnd(filter, textFilter(query.q));
    if (query.exclude.length) filter = withAnd(filter, { docId: { $nin: query.exclude } });
    return filter;
}

function readDocId(doc: ProblemDoc): number {
    if (typeof doc.docId !== 'number' || !Number.isSafeInteger(doc.docId) || doc.docId < 1) {
        throw new TypeError('teach bank docId is invalid');
    }
    return doc.docId;
}

function readOwner(doc: ProblemDoc): number {
    if (typeof doc.owner !== 'number' || !Number.isSafeInteger(doc.owner)) throw new TypeError('teach bank owner is invalid');
    return doc.owner;
}

function readTags(doc: ProblemDoc): string[] {
    if (doc.tag === undefined) return [];
    if (!Array.isArray(doc.tag) || doc.tag.some((tag) => typeof tag !== 'string')) throw new TypeError('teach bank tag is invalid');
    return [...doc.tag];
}

function readCount(value: unknown, field: string): number {
    if (value === undefined) return 0;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    throw new TypeError(`teach bank ${field} is invalid`);
}

function readDifficulty(value: unknown): number | null {
    if (value === undefined || value === null) return null;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    throw new TypeError('teach bank difficulty is invalid');
}

function readText(value: unknown, field: string, fallback: string | null): string {
    if (typeof value === 'string') return value;
    if ((value === undefined || value === null || value === '') && fallback !== null) return fallback;
    throw new TypeError(`teach bank ${field} is invalid`);
}

function itemOf(doc: ProblemDoc, actor: ProblemAclUser, sources: readonly IndexedSource[], names: ReadonlyMap<number, string>): TeachBankItem {
    const owner = readOwner(doc);
    const place = placement(hitOf(doc), sources);
    return {
        docId: readDocId(doc),
        pid: readText(doc.pid, 'pid', String(doc.docId)),
        title: readText(doc.title, 'title', null),
        kind: effectiveProblemKind(doc),
        difficulty: readDifficulty(doc.difficulty),
        tags: readTags(doc),
        nSubmit: readCount(doc.nSubmit, 'nSubmit'),
        nAccept: readCount(doc.nAccept, 'nAccept'),
        hidden: doc.hidden === true,
        mine: owner === actor._id,
        schoolShared: readProblemSchoolBank(doc.schoolBank) !== null,
        ownerName: names.get(owner) ?? '',
        courseId: place.courseId,
        nodePath: place.nodePath,
    };
}

async function ownerNames(domainId: string, docs: readonly ProblemDoc[]): Promise<Map<number, string>> {
    const uids: number[] = [];
    const seen = new Set<number>();
    for (const doc of docs) {
        const owner = readOwner(doc);
        if (seen.has(owner)) continue;
        seen.add(owner);
        uids.push(owner);
    }
    const names = new Map<number, string>();
    if (!uids.length) return names;
    const listed = await user.getList(domainId, uids);
    for (const uid of uids) {
        const udoc = listed[uid];
        names.set(uid, udoc && udoc._id === uid && typeof udoc.uname === 'string' ? udoc.uname : '');
    }
    return names;
}

function readLimit(value: unknown, parse: (input: string | number) => number): number | null {
    if (value === undefined || value === null || value === '') return null;
    if (typeof value !== 'string' && typeof value !== 'number') return null;
    try {
        const parsed = parse(value);
        return Number.isFinite(parsed) ? parsed : null;
    } catch (error) {
        if (error instanceof Error) return null;
        throw error;
    }
}

function limitsOf(config: unknown): { timeMs: number | null; memoryMb: number | null } {
    const parsed: unknown = parseProblemConfigObject({ config });
    if (!isRecord(parsed)) return { timeMs: null, memoryMb: null };
    return { timeMs: readLimit(parsed.time, parseTimeMS), memoryMb: readLimit(parsed.memory, parseMemoryMB) };
}

function readOptions(value: unknown): string[] {
    if (!Array.isArray(value) || value.some((option) => typeof option !== 'string')) invalid('config', localizedErrorText`题目选项无效。`);
    return [...value];
}

function objectiveOf(kind: ProblemKind, config: unknown): TeachObjectivePreview | null {
    if (!BASIC_OBJECTIVE.has(kind)) return null;
    const parsed: unknown = parseProblemConfigObject({ config });
    if (!isRecord(parsed) || !isRecord(parsed.main)) return null;
    const main = parsed.main;
    if (kind === 'single') {
        const options = readOptions(main.options);
        if (typeof main.answerIndex !== 'number' || !Number.isSafeInteger(main.answerIndex) || main.answerIndex < 0 || main.answerIndex >= options.length) {
            invalid('config', localizedErrorText`单选题答案无效。`);
        }
        return { kind: 'single', options, answerIndex: main.answerIndex };
    }
    if (kind === 'multi') {
        const options = readOptions(main.options);
        if (
            !Array.isArray(main.answerIndexes)
            || !main.answerIndexes.length
            || main.answerIndexes.some((index) => typeof index !== 'number' || !Number.isSafeInteger(index) || index < 0 || index >= options.length)
        ) invalid('config', localizedErrorText`多选题答案无效。`);
        return { kind: 'multi', options, answerIndexes: [...main.answerIndexes] };
    }
    if (kind === 'true_false') {
        if (typeof main.answer !== 'boolean') invalid('config', localizedErrorText`判断题答案无效。`);
        return { kind: 'true_false', answer: main.answer };
    }
    if (typeof main.answer !== 'string') invalid('config', localizedErrorText`填空题答案无效。`);
    return { kind: 'blank', answer: main.answer };
}

function readContent(doc: ProblemDoc): string {
    if (doc.content === undefined || doc.content === null) return '';
    if (typeof doc.content !== 'string') throw new TypeError('teach bank content is invalid');
    return doc.content;
}

function missingProblem(docId: number): never {
    throw new NotFoundError(docId);
}

export async function teachKnowledgeTree(domainId: string, actor: ProblemAclUser, args: Record<string, unknown>): Promise<TeachKnowledgeTree> {
    const type = teachType(args.type);
    const sources = (await loadSources()).map((source) => indexSource(source));
    const docs = await problem.getMulti(domainId, baseFilter(actor, type, 'all'), TREE_PROJECTION).toArray();
    const hits = docs.map((doc) => hitOf(doc));
    return {
        courses: sources.map((source) => {
            const counted = countCourse(source, hits);
            return {
                id: source.courseId,
                title: source.title,
                hidden: source.hidden,
                total: counted.total,
                nodes: renderNodes(source.roots, counted.counts),
            };
        }),
    };
}

function readTotal(value: unknown): number {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new TypeError('teach bank count is invalid');
    return value;
}

function bankPage(query: BankQuery, total: number, pageDocs: ProblemDoc[], actor: ProblemAclUser, sources: readonly IndexedSource[], names: ReadonlyMap<number, string>): TeachBankPage {
    return {
        items: pageDocs.map((doc) => itemOf(doc, actor, sources, names)),
        page: query.page,
        pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)),
        total,
    };
}

export async function teachBankPage(domainId: string, actor: ProblemAclUser, args: Record<string, unknown>): Promise<TeachBankPage> {
    const query = parseBankQuery(args);
    const sources = (await loadSources()).map((source) => indexSource(source));
    const course = query.course === 'all' ? null : findCourse(sources, query.course);
    const filter = listFilter(actor, query, course);
    const skip = (query.page - 1) * PAGE_SIZE;
    if (!course) {
        const [docs, total] = await Promise.all([
            problem.getMulti(domainId, filter, LIST_PROJECTION).sort({ docId: -1 }).skip(skip).limit(PAGE_SIZE).toArray(),
            problem.count(domainId, filter),
        ]);
        const names = await ownerNames(domainId, docs);
        return bankPage(query, readTotal(total), docs, actor, sources, names);
    }
    // Node id $in cannot be the sole predicate: the read-only harness compares an ObjectId
    // before array elements, so canonical selections would disappear. Keep the map-scoped
    // read, then apply the subtree rule before paging.
    const docs = await problem.getMulti(domainId, filter, LIST_PROJECTION).sort({ docId: -1 }).toArray();
    const matched = docs.filter((doc) => matchesCourseNode(hitOf(doc), course, query.node));
    const pageDocs = matched.slice(skip, skip + PAGE_SIZE);
    const names = await ownerNames(domainId, pageDocs);
    return bankPage(query, matched.length, pageDocs, actor, sources, names);
}

export async function teachBankPreview(domainId: string, actor: ProblemAclUser, args: Record<string, unknown>): Promise<TeachBankPreview> {
    const type = teachType(args.type);
    const docIdText = args.docId;
    const docId = typeof docIdText === 'number' ? docIdText : typeof docIdText === 'string' ? Number(docIdText) : Number.NaN;
    if (typeof docIdText === 'string' && !/^[1-9]\d*$/.test(docIdText)) missingProblem(0);
    if (typeof docIdText === 'number' && (!Number.isSafeInteger(docIdText) || docIdText < 1)) missingProblem(docIdText);
    if (!Number.isSafeInteger(docId) || docId < 1) missingProblem(0);
    const sources = (await loadSources()).map((source) => indexSource(source));
    const doc = await problem.getMulti(domainId, withAnd(baseFilter(actor, type, 'all'), { docId }), PREVIEW_PROJECTION).limit(1).next();
    if (!doc) missingProblem(docId);
    const names = await ownerNames(domainId, [doc]);
    const kind = effectiveProblemKind(doc);
    return {
        item: itemOf(doc, actor, sources, names),
        content: readContent(doc),
        objective: objectiveOf(kind, doc.config),
        limits: limitsOf(doc.config),
    };
}
