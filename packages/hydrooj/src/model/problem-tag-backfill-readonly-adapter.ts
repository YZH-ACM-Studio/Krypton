import type { Db } from 'mongodb';
import { MongoClient } from 'mongodb';
import mongoUri from 'mongodb-uri';
import type { ProblemTagBackfillPlanAdapter, ProblemTagBackfillPlanFacts, ProblemTagBackfillProblemSnapshot } from '../lib/problem-tag-backfill';
import { createProblemTagBackfillSnapshot, ProblemTagBackfillError } from '../lib/problem-tag-backfill';
import {
    knowledgeMindmapOptionsFromFacts,
    normalizeProblemTagBackfillMindmapFacts,
    previewProblemTagNormalizationFromFacts,
    problemTagBackfillMindmapFingerprint,
    type ProblemTagBackfillMindmapFact,
} from '../lib/problem-tag-backfill-facts';
import { load } from '../options';

const TYPE_PROBLEM = 10;

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

function fail(message: string, details?: unknown): never {
    throw new ProblemTagBackfillError(message, 'PROBLEM_TAG_BACKFILL_READONLY_UNAVAILABLE', details);
}

function collectionName(options: HydroMongoOptions, logicalName: string): string {
    const prefixed = options.prefix ? `${options.prefix}.${logicalName}` : logicalName;
    return options.collectionMap?.[prefixed] || prefixed;
}

function mongoUrl(options: HydroMongoOptions): string {
    if (options.url || options.uri) return options.url || options.uri!;
    if (!options.host || !options.port || !options.name) fail('MongoDB configuration is unavailable for read-only tag plan');
    let url = `${options.protocol || 'mongodb'}://`;
    if (options.username) url += `${options.username}:${encodeURIComponent(options.password || '')}@`;
    return `${url}${options.host}:${options.port}/${options.name}`;
}

export class ReadonlyProblemTagBackfillAdapter implements ProblemTagBackfillPlanAdapter {
    private mindmapFacts: ProblemTagBackfillMindmapFact[] | null = null;

    constructor(
        private readonly db: Db,
        private readonly options: HydroMongoOptions = {},
        private readonly closeConnection: () => Promise<void> = async () => undefined,
    ) {}

    private collection(logicalName: string) {
        return this.db.collection<Record<string, any>>(collectionName(this.options, logicalName));
    }

    private async loadMindmapFacts(): Promise<ProblemTagBackfillMindmapFact[]> {
        const [rows, maps] = await Promise.all([
            this.collection('mindmap.nodes')
                .find({}, { projection: { _id: 1, mapId: 1, parentId: 1, topic: 1, tags: 1, updatedAt: 1 } })
                .toArray(),
            this.collection('mindmap.maps')
                .find({}, { projection: { _id: 1, title: 1 } })
                .toArray(),
        ]);
        const titleById = new Map(maps.map((map) => [String(map._id), map.title]));
        return normalizeProblemTagBackfillMindmapFacts(rows.map((row) => ({ ...row, mapTitle: titleById.get(String(row.mapId)) })));
    }

    async loadPlanFacts(): Promise<ProblemTagBackfillPlanFacts> {
        const mindmapBefore = await this.loadMindmapFacts();
        const [problemRows, permitRows] = await Promise.all([
            this.collection('document')
                .find(
                    { docType: TYPE_PROBLEM },
                    {
                        projection: {
                            _id: 1,
                            domainId: 1,
                            docId: 1,
                            pid: 1,
                            title: 1,
                            owner: 1,
                            tag: 1,
                            knowledgeMapId: 1,
                            knowledgeNodeIds: 1,
                            structureRevision: 1,
                            problemKind: 1,
                            authoringMode: 1,
                            sourceMeta: 1,
                            managedAuthoring: 1,
                            config: 1,
                            data: 1,
                            additional_file: 1,
                            hidden: 1,
                            content: 1,
                            html: 1,
                            archivedAt: 1,
                        },
                    },
                )
                .toArray(),
            this.collection('problem.permits')
                .find({ active: { $in: [true, null] } }, { projection: { domainId: 1, pid: 1 } })
                .toArray(),
        ]);
        const mindmapAfter = await this.loadMindmapFacts();
        const beforeFingerprint = problemTagBackfillMindmapFingerprint(mindmapBefore);
        const afterFingerprint = problemTagBackfillMindmapFingerprint(mindmapAfter);
        if (beforeFingerprint !== afterFingerprint) {
            throw new ProblemTagBackfillError('mindmap changed while the read-only plan was loading', 'PROBLEM_TAG_BACKFILL_PLAN_DRIFT');
        }
        const permitCounts = new Map<string, number>();
        for (const row of permitRows) {
            const key = `${row.domainId}/${row.pid}`;
            permitCounts.set(key, (permitCounts.get(key) || 0) + 1);
        }
        const problems = problemRows
            .filter((row) => !row.archivedAt && (row.problemKind === undefined || row.problemKind === 'programming'))
            .map((row) => createProblemTagBackfillSnapshot(row, permitCounts.get(`${row.domainId}/${row.docId}`) || 0));
        this.mindmapFacts = mindmapAfter;
        return {
            problems,
            mindmapOptions: knowledgeMindmapOptionsFromFacts(mindmapAfter),
            mindmapFingerprint: afterFingerprint,
        };
    }

    async preview(snapshot: ProblemTagBackfillProblemSnapshot, selectedNodeIds: string[]) {
        if (!this.mindmapFacts) throw new ProblemTagBackfillError('plan facts must be loaded before preview', 'PROBLEM_TAG_BACKFILL_PLAN_INVALID');
        return previewProblemTagNormalizationFromFacts(snapshot, selectedNodeIds, this.mindmapFacts);
    }

    close(): Promise<void> {
        return this.closeConnection();
    }
}

export async function createReadonlyProblemTagBackfillAdapter(): Promise<ReadonlyProblemTagBackfillAdapter> {
    const options = load() as HydroMongoOptions | null;
    if (!options) fail('Hydro configuration is unavailable for read-only tag plan');
    const url = mongoUrl(options);
    const parsed = mongoUri.parse(url);
    const client = await MongoClient.connect(url, { readPreference: 'primary' });
    return new ReadonlyProblemTagBackfillAdapter(client.db(parsed.database || options.name || 'hydro'), options, () => client.close());
}

export const problemTagBackfillReadonlyInternals = { collectionName, mongoUrl };
