import type { Db } from 'mongodb';
import { MongoClient, ObjectId } from 'mongodb';
import mongoUri from 'mongodb-uri';
import {
    ProblemBatchImportError,
    type ProblemBatchExecutionReport,
    type ProblemBatchImportAdapter,
    type ProblemBatchImportPlan,
    type ProblemBatchProgressEvent,
    type ProblemBatchProductionFacts,
    type ProblemBatchVerifyResult,
    type ValidatedProblemBatch,
} from '../lib/problem-batch-import';
import {
    buildProblemBatchProductionFacts,
    type ProblemBatchFactProblem,
    type ProblemBatchFactsRepository,
} from '../lib/problem-batch-production-facts';
import { load } from '../options';

const TYPE_PROBLEM = 10;
const TYPE_TRAINING = 40;
const PRIV_EDIT_SYSTEM = 1;

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

interface MindmapNodeRecord {
    _id: ObjectId;
    parentId: ObjectId | null;
    topic: string;
    tags: string[];
}

interface AnyMongoDocument {
    _id: number | ObjectId | string;
    [key: string]: any;
}

function fail(message: string, code = 'BATCH_IMPORT_PRODUCTION_DRIFT', details?: unknown): never {
    throw new ProblemBatchImportError(message, code, details);
}

function collectionName(options: HydroMongoOptions, logicalName: string): string {
    const prefixed = options.prefix ? `${options.prefix}.${logicalName}` : logicalName;
    return options.collectionMap?.[prefixed] || prefixed;
}

function mongoUrl(options: HydroMongoOptions): string {
    if (options.url || options.uri) return options.url || options.uri!;
    if (!options.host || !options.port || !options.name) {
        fail('MongoDB configuration is unavailable for read-only preflight', 'BATCH_IMPORT_READONLY_UNAVAILABLE');
    }
    let url = `${options.protocol || 'mongodb'}://`;
    if (options.username) url += `${options.username}:${encodeURIComponent(options.password || '')}@`;
    return `${url}${options.host}:${options.port}/${options.name}`;
}

function mindmapPath(node: MindmapNodeRecord, byId: Map<string, MindmapNodeRecord>): MindmapNodeRecord[] {
    const path: MindmapNodeRecord[] = [];
    const visited = new Set<string>();
    let current: MindmapNodeRecord | undefined = node;
    while (current) {
        const id = current._id.toHexString();
        if (visited.has(id)) fail('mindmap contains a cycle', 'BATCH_IMPORT_MINDMAP_CONFLICT', { id });
        visited.add(id);
        path.push(current);
        if (!current.parentId) break;
        current = byId.get(current.parentId.toHexString());
        if (!current) fail('mindmap ancestor is missing', 'BATCH_IMPORT_MINDMAP_CONFLICT', { id });
    }
    return path.reverse();
}

export class MongoProblemBatchFactsRepository implements ProblemBatchFactsRepository {
    constructor(
        private readonly db: Db,
        private readonly options: HydroMongoOptions = {},
    ) {}

    private collection(logicalName: string) {
        return this.db.collection<AnyMongoDocument>(collectionName(this.options, logicalName));
    }

    async getUser(_domainId: string, uid: number) {
        const user = await this.collection('user').findOne({ _id: uid }, { projection: { _id: 1, uname: 1, priv: 1 } });
        if (!user) return null;
        return {
            uid: Number(user._id),
            username: typeof user.uname === 'string' ? user.uname : '',
            isProblemBankAdmin: Number.isSafeInteger(user.priv) && (user.priv & PRIV_EDIT_SYSTEM) === PRIV_EDIT_SYSTEM,
        };
    }

    async getCounter(domainId: string, namespace: string) {
        const counter = await this.collection('problem.pid_counters').findOne({ domainId, namespace }, { projection: { value: 1 } });
        if (!counter) return null;
        return typeof counter.value === 'number' ? counter.value : Number.NaN;
    }

    async getTraining(domainId: string, trainingId: string) {
        const training = await this.collection('document').findOne(
            { domainId, docType: TYPE_TRAINING, docId: new ObjectId(trainingId), kind: { $ne: 'course' } },
            { projection: { docId: 1, title: 1, dag: 1 } },
        );
        if (!training) return null;
        return {
            id: String(training.docId),
            title: typeof training.title === 'string' ? training.title : '',
            dag: training.dag as unknown[],
        };
    }

    async hasTrainingAnchor(domainId: string, pids: number[], tag: string) {
        if (!pids.length) return false;
        return !!(await this.collection('document').findOne(
            { domainId, docType: TYPE_PROBLEM, docId: { $in: pids }, tag },
            { projection: { docId: 1 } },
        ));
    }

    async getMindmapFacts(nodeIds: string[]) {
        if (!nodeIds.length) return [];
        const nodes = (await this.collection('mindmap.nodes')
            .find({}, { projection: { _id: 1, parentId: 1, topic: 1, tags: 1 } })
            .toArray()) as unknown as MindmapNodeRecord[];
        const byId = new Map(nodes.map((node) => [node._id.toHexString(), node]));
        return nodeIds.map((id) => {
            const node = byId.get(id);
            const ownTags = Array.isArray(node?.tags) ? node.tags.map((tag) => (typeof tag === 'string' ? tag.trim() : '')).filter(Boolean) : [];
            if (!node || !ownTags.length) {
                fail(`mindmap node is missing or not selectable: ${id}`, 'BATCH_IMPORT_MINDMAP_CONFLICT');
            }
            const path = mindmapPath(node, byId);
            const tags: string[] = [];
            for (const part of path) {
                for (const rawTag of Array.isArray(part.tags) ? part.tags : []) {
                    const tag = typeof rawTag === 'string' ? rawTag.trim() : '';
                    if (tag && !tags.includes(tag)) tags.push(tag);
                }
            }
            return {
                id,
                topic: path.map((part) => part.topic).join(' / '),
                tags,
            };
        });
    }

    async getBatchProblems(domainId: string, batchId: string) {
        return (await this.collection('document')
            .find(
                { domainId, docType: TYPE_PROBLEM, 'batchImport.batchId': batchId },
                {
                    projection: {
                        docId: 1,
                        pid: 1,
                        title: 1,
                        hidden: 1,
                        authoringMode: 1,
                        problemKind: 1,
                        managedAuthoring: 1,
                        batchImport: 1,
                        hasBatchImportIdentity: 1,
                    },
                },
            )
            .toArray()) as unknown as ProblemBatchFactProblem[];
    }

    async getActiveProblemPermits(domainId: string, docId: number) {
        const permits = await this.collection('problem.permits')
            .find({ domainId, pid: docId, active: { $ne: false } }, { projection: { uid: 1, role: 1 } })
            .toArray();
        return permits.map((permit) => ({ uid: Number(permit.uid), role: String(permit.role) }));
    }

    async getDuplicateProblems(domainId: string, titles: string[], pids: string[]) {
        return (await this.collection('document')
            .find(
                {
                    domainId,
                    docType: TYPE_PROBLEM,
                    $or: [{ title: { $in: titles } }, { pid: { $in: pids } }],
                },
                { projection: { docId: 1, pid: 1, title: 1, batchImport: 1 } },
            )
            .toArray()) as unknown as ProblemBatchFactProblem[];
    }
}

export class ReadonlyProblemBatchImportAdapter implements ProblemBatchImportAdapter {
    constructor(
        private readonly repository: ProblemBatchFactsRepository,
        private readonly closeConnection: () => Promise<void> = async () => undefined,
    ) {}

    preflight(batch: ValidatedProblemBatch): Promise<ProblemBatchProductionFacts> {
        return buildProblemBatchProductionFacts(batch, this.repository);
    }

    apply(
        _batch: ValidatedProblemBatch,
        _plan: ProblemBatchImportPlan,
        _report: ProblemBatchExecutionReport,
        _progress: (event: ProblemBatchProgressEvent) => Promise<void>,
    ): Promise<ProblemBatchVerifyResult> {
        return Promise.reject(new ProblemBatchImportError('read-only adapter cannot apply a batch', 'BATCH_IMPORT_STAGE_INVALID'));
    }

    verify(_batch: ValidatedProblemBatch, _plan: ProblemBatchImportPlan): Promise<ProblemBatchVerifyResult> {
        return Promise.reject(new ProblemBatchImportError('read-only adapter cannot verify a batch', 'BATCH_IMPORT_STAGE_INVALID'));
    }

    close(): Promise<void> {
        return this.closeConnection();
    }
}

export async function createReadonlyProblemBatchImportAdapter(): Promise<ReadonlyProblemBatchImportAdapter> {
    const options = load() as HydroMongoOptions | null;
    if (!options) fail('Hydro configuration is unavailable for read-only preflight', 'BATCH_IMPORT_READONLY_UNAVAILABLE');
    const url = mongoUrl(options);
    const parsed = mongoUri.parse(url);
    const client = await MongoClient.connect(url, { readPreference: 'primary' });
    const repository = new MongoProblemBatchFactsRepository(client.db(parsed.database || options.name || 'hydro'), options);
    return new ReadonlyProblemBatchImportAdapter(repository, () => client.close());
}

export const problemBatchReadonlyInternals = { collectionName, mongoUrl };
