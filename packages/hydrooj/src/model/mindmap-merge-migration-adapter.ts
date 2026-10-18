import {
    MongoClient, ObjectId, type Db, type Document,
} from 'mongodb';
import mongoUri from 'mongodb-uri';
import { Logger } from '@hydrooj/utils';

import type {
    MindmapMergeCourse,
    MindmapMergeMap,
    MindmapMergeNode,
    MindmapMergeProblem,
    MindmapMergeRepository,
    MindmapMergeSnapshot,
} from '../lib/mindmap-merge-migration';
import { courseKindClause } from '../lib/training-kind';
import { load } from '../options';

const TYPE_PROBLEM = 10;
const TYPE_TRAINING = 40;
const NAMESPACE_NOT_FOUND = 26;
const INDEX_NOT_FOUND = 27;
const MINDMAP_COLLECTIONS = ['mindmap.maps', 'mindmap.nodes'] as const;

const logger = new Logger('mindmap-merge');

interface HydroMongoOptions {
    protocol?: string;
    username?: string;
    password?: string;
    host?: string;
    port?: string;
    name?: string;
    url?: string;
    uri?: string;
    prefix?: string;
    collectionMap?: Record<string, string>;
}

function fail(message: string): never {
    throw new Error(message);
}

function collectionName(options: HydroMongoOptions, logicalName: string): string {
    const prefixed = options.prefix ? `${options.prefix}.${logicalName}` : logicalName;
    return options.collectionMap?.[prefixed] || prefixed;
}

function mongoUrl(options: HydroMongoOptions): string {
    if (options.url || options.uri) return options.url || options.uri!;
    if (!options.host || !options.port || !options.name) fail('MongoDB configuration is unavailable for mindmap merge');
    let url = `${options.protocol || 'mongodb'}://`;
    if (options.username) url += `${options.username}:${encodeURIComponent(options.password || '')}@`;
    return `${url}${options.host}:${options.port}/${options.name}`;
}

function mongoErrorCode(error: unknown): number | undefined {
    if (!error || typeof error !== 'object' || !('code' in error)) return undefined;
    const { code } = error as { code: unknown };
    return typeof code === 'number' ? code : undefined;
}

function isMongoCode(error: unknown, code: number): boolean {
    return mongoErrorCode(error) === code;
}

function hex(id: ObjectId): string {
    return id.toHexString();
}

function asRecord(value: object): Record<string, unknown> {
    return value as Record<string, unknown>;
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

function sameDocument(actual: object, expected: object): boolean {
    return sameValue(actual, expected);
}

function definedEntries(value: object): Array<[string, unknown]> {
    return Object.entries(asRecord(value)).filter((entry) => entry[1] !== undefined);
}

function withoutId(doc: object): Record<string, unknown> {
    const copy = { ...asRecord(doc) };
    delete copy._id;
    return copy;
}

function expectObjectId(value: unknown, field: string): ObjectId {
    if (!(value instanceof ObjectId)) fail(`${field} must be an ObjectId`);
    return value;
}

function matchesTarget(
    doc: Record<string, unknown>,
    expected: Record<string, unknown>,
    set: Record<string, unknown>,
    unset: readonly string[],
): boolean {
    const removed = new Set(unset);
    for (const key of unset) {
        if (Object.hasOwn(doc, key)) return false;
    }
    for (const [key, value] of Object.entries(set)) {
        if (value === undefined) continue;
        if (!sameValue(doc[key], value)) return false;
    }
    for (const [key, value] of Object.entries(expected)) {
        if (value === undefined || removed.has(key) || Object.hasOwn(set, key)) continue;
        if (!sameValue(doc[key], value)) return false;
    }
    return true;
}

function pickProblem(row: Record<string, unknown>): MindmapMergeProblem {
    const problem = {
        domainId: row.domainId,
        docId: row.docId,
    } as MindmapMergeProblem;
    if (Object.hasOwn(row, 'knowledgeMapId')) problem.knowledgeMapId = row.knowledgeMapId as ObjectId;
    return problem;
}

function pickCourse(row: Record<string, unknown>): MindmapMergeCourse {
    const course = {
        domainId: row.domainId,
        docId: row.docId,
        owner: row.owner,
    } as MindmapMergeCourse;
    if (Object.hasOwn(row, 'mindmapId')) course.mindmapId = row.mindmapId as ObjectId;
    if (Object.hasOwn(row, 'knowledgeCourseNodeId')) course.knowledgeCourseNodeId = row.knowledgeCourseNodeId as ObjectId;
    return course;
}

export class MongoMindmapMergeRepository implements MindmapMergeRepository {
    constructor(
        private readonly db: Db,
        private readonly options: HydroMongoOptions = {},
        private readonly closeConnection: () => Promise<void> = async () => undefined,
    ) {}

    private collection(logicalName: string) {
        return this.db.collection(collectionName(this.options, logicalName));
    }

    private async indexNames(logicalName: string): Promise<string[]> {
        try {
            const specs = await this.collection(logicalName).indexes();
            return specs.flatMap((spec) => (typeof spec.name === 'string' ? [spec.name] : []));
        } catch (error) {
            if (isMongoCode(error, NAMESPACE_NOT_FOUND)) fail(`mindmap collection ${logicalName} does not exist`);
            throw error;
        }
    }

    async snapshot(): Promise<MindmapMergeSnapshot> {
        const documents = this.collection('document');
        const [maps, nodes, problems, courses, mapIndexes, nodeIndexes] = await Promise.all([
            this.collection('mindmap.maps').find({}).toArray(),
            this.collection('mindmap.nodes').find({}).toArray(),
            documents.find(
                { docType: TYPE_PROBLEM },
                { projection: { _id: 0, domainId: 1, docId: 1, knowledgeMapId: 1 } },
            ).toArray(),
            documents.find(
                { docType: TYPE_TRAINING, ...courseKindClause() },
                { projection: { _id: 0, domainId: 1, docId: 1, owner: 1, mindmapId: 1, knowledgeCourseNodeId: 1 } },
            ).toArray(),
            this.indexNames('mindmap.maps'),
            this.indexNames('mindmap.nodes'),
        ]);
        const indexes = [...new Set([...mapIndexes, ...nodeIndexes])].sort();
        logger.info(
            'mindmap merge snapshot maps=%d nodes=%d problems=%d courses=%d indexes=%d',
            maps.length,
            nodes.length,
            problems.length,
            courses.length,
            indexes.length,
        );
        return {
            maps: maps as MindmapMergeMap[],
            nodes: nodes as MindmapMergeNode[],
            problems: problems.map((row) => pickProblem(row)),
            courses: courses.map((row) => pickCourse(row)),
            indexes,
        };
    }

    private async insertExact(logicalName: string, doc: Document, label: string): Promise<'inserted' | 'exists'> {
        const id = expectObjectId(doc._id, `${label} _id`);
        const collection = this.collection(logicalName);
        const before = await collection.findOneAndUpdate(
            { _id: id },
            { $setOnInsert: withoutId(doc) },
            { upsert: true, returnDocument: 'before' },
        );
        if (!before) {
            const stored = await collection.findOne({ _id: id });
            if (!stored || !sameDocument(stored, doc)) fail(`mindmap merge ${label} ${hex(id)} was not stored as the target document`);
            logger.info('mindmap merge %s id=%s result=inserted', label, hex(id));
            return 'inserted';
        }
        if (!sameDocument(before, doc)) fail(`mindmap merge ${label} ${hex(id)} exists but does not match the target document`);
        logger.info('mindmap merge %s id=%s result=exists', label, hex(id));
        return 'exists';
    }

    insertMap(doc: MindmapMergeMap): Promise<'inserted' | 'exists'> {
        return this.insertExact('mindmap.maps', doc, 'insertMap');
    }

    insertNode(doc: MindmapMergeNode): Promise<'inserted' | 'exists'> {
        return this.insertExact('mindmap.nodes', doc, 'insertNode');
    }

    async updateNode(
        id: ObjectId,
        expected: Partial<MindmapMergeNode>,
        set: Partial<MindmapMergeNode>,
        unset: string[],
    ): Promise<'updated' | 'already'> {
        const nodeId = expectObjectId(id, 'updateNode id');
        const expectedRecord = asRecord(expected);
        const setRecord = asRecord(set);
        const filter: Record<string, unknown> = { _id: nodeId };
        for (const [key, value] of definedEntries(expectedRecord)) {
            if (key === '_id') continue;
            filter[key] = value;
        }
        const update: Record<string, unknown> = {};
        const setFields = Object.fromEntries(definedEntries(setRecord).filter(([key]) => key !== '_id'));
        if (Object.keys(setFields).length > 0) update.$set = setFields;
        if (unset.length > 0) update.$unset = Object.fromEntries(unset.map((key) => [key, '']));
        const collection = this.collection('mindmap.nodes');
        const before = Object.keys(update).length === 0
            ? await collection.findOne(filter)
            : await collection.findOneAndUpdate(filter, update, { upsert: false, returnDocument: 'before' });
        if (before) {
            logger.info('mindmap merge updateNode id=%s result=updated', hex(nodeId));
            return 'updated';
        }
        const current = await collection.findOne({ _id: nodeId });
        if (!current) fail(`mindmap merge updateNode ${hex(nodeId)} is missing`);
        if (!matchesTarget(current, expectedRecord, setRecord, unset)) {
            fail(`mindmap merge updateNode ${hex(nodeId)} does not match the expected or target state`);
        }
        logger.info('mindmap merge updateNode id=%s result=already', hex(nodeId));
        return 'already';
    }

    async updateProblems(fromMapIds: ObjectId[], to: ObjectId): Promise<{ matched: number; modified: number }> {
        const target = expectObjectId(to, 'updateProblems target');
        if (fromMapIds.some((id) => !(id instanceof ObjectId))) fail('updateProblems source map ids must be ObjectIds');
        if (fromMapIds.some((id) => id.equals(target))) fail('mindmap merge cannot rewrite problems onto one of the source maps');
        const result = await this.collection('document').updateMany(
            { docType: TYPE_PROBLEM, knowledgeMapId: { $in: fromMapIds } },
            { $set: { knowledgeMapId: target } },
        );
        logger.info('mindmap merge updateProblems matched=%d modified=%d', result.matchedCount, result.modifiedCount);
        return { matched: result.matchedCount, modified: result.modifiedCount };
    }

    async updateCourse(
        key: { domainId: string; docId: ObjectId },
        expectedMindmapId: ObjectId,
        courseNodeId: ObjectId,
    ): Promise<'updated' | 'already'> {
        const domainId = key.domainId;
        const docId = expectObjectId(key.docId, 'updateCourse docId');
        const mindmapId = expectObjectId(expectedMindmapId, 'updateCourse mindmapId');
        const nodeId = expectObjectId(courseNodeId, 'updateCourse courseNodeId');
        if (typeof domainId !== 'string' || !domainId) fail('updateCourse domainId is missing');
        const identity = {
            domainId,
            docType: TYPE_TRAINING,
            docId,
            ...courseKindClause(),
        };
        const collection = this.collection('document');
        const before = await collection.findOneAndUpdate(
            { ...identity, mindmapId },
            { $set: { knowledgeCourseNodeId: nodeId }, $unset: { mindmapId: '' } },
            { upsert: false, returnDocument: 'before' },
        );
        if (before) {
            logger.info('mindmap merge updateCourse domain=%s docId=%s result=updated', domainId, hex(docId));
            return 'updated';
        }
        const current = await collection.findOne(identity);
        const bound = current?.knowledgeCourseNodeId;
        if (!current || Object.hasOwn(current, 'mindmapId') || !(bound instanceof ObjectId) || !bound.equals(nodeId)) {
            fail(`mindmap merge updateCourse ${domainId}/${hex(docId)} does not match the expected or target binding`);
        }
        logger.info('mindmap merge updateCourse domain=%s docId=%s result=already', domainId, hex(docId));
        return 'already';
    }

    async deleteMap(id: ObjectId, expected: Partial<MindmapMergeMap>): Promise<'deleted' | 'already'> {
        const mapId = expectObjectId(id, 'deleteMap id');
        const filter: Record<string, unknown> = { _id: mapId };
        for (const [key, value] of definedEntries(expected)) {
            if (key === '_id') continue;
            filter[key] = value;
        }
        const deleted = await this.collection('mindmap.maps').findOneAndDelete(filter);
        if (deleted) {
            logger.info('mindmap merge deleteMap id=%s result=deleted', hex(mapId));
            return 'deleted';
        }
        const current = await this.collection('mindmap.maps').findOne({ _id: mapId });
        if (!current) {
            logger.info('mindmap merge deleteMap id=%s result=already', hex(mapId));
            return 'already';
        }
        fail(`mindmap merge deleteMap ${hex(mapId)} does not match the expected document`);
    }

    async dropIndex(name: string): Promise<'dropped' | 'absent'> {
        if (!name || name === '_id_') fail(`mindmap merge cannot drop index ${name || '(empty)'}`);
        let dropped = false;
        for (const logicalName of MINDMAP_COLLECTIONS) {
            try {
                await this.collection(logicalName).dropIndex(name);
                dropped = true;
            } catch (error) {
                if (isMongoCode(error, INDEX_NOT_FOUND) || isMongoCode(error, NAMESPACE_NOT_FOUND)) continue;
                throw error;
            }
        }
        const result = dropped ? 'dropped' : 'absent';
        logger.info('mindmap merge dropIndex name=%s result=%s', name, result);
        return result;
    }

    async writeAudit(record: Record<string, unknown>): Promise<void> {
        const stored = { ...record };
        delete stored._id;
        await this.collection('oplog').insertOne({ _id: new ObjectId(), ...stored });
        logger.info(
            'mindmap merge audit actor=%s fingerprint=%s result=%s',
            String(record.actor ?? ''),
            String(record.fingerprint ?? ''),
            String(record.result ?? ''),
        );
    }

    close(): Promise<void> {
        return this.closeConnection();
    }
}

export async function createMongoMindmapMergeRepository(): Promise<MongoMindmapMergeRepository> {
    const options = load() as HydroMongoOptions | null;
    if (!options) fail('Hydro configuration is unavailable for mindmap merge');
    const url = mongoUrl(options);
    const parsed = mongoUri.parse(url);
    const client = await MongoClient.connect(url, { readPreference: 'primary' });
    return new MongoMindmapMergeRepository(client.db(parsed.database || options.name || 'hydro'), options, () => client.close());
}
