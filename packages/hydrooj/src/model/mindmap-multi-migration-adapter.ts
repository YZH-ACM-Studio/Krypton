import type { Db } from 'mongodb';
import { MongoClient, ObjectId } from 'mongodb';
import mongoUri from 'mongodb-uri';
import {
    MindmapMultiMigrationError,
    type MindmapMultiMigrationRepository,
    type MindmapMultiMigrationSnapshot,
    type MindmapMultiMigrationSourceFacts,
} from '../lib/mindmap-multi-migration';
import { courseKindClause } from '../lib/training-kind';
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

function fail(message: string): never {
    throw new MindmapMultiMigrationError(message, 'MINDMAP_MULTI_MIGRATION_DATABASE_UNAVAILABLE');
}

function collectionName(options: HydroMongoOptions, logicalName: string): string {
    const prefixed = options.prefix ? `${options.prefix}.${logicalName}` : logicalName;
    return options.collectionMap?.[prefixed] || prefixed;
}

function mongoUrl(options: HydroMongoOptions): string {
    if (options.url || options.uri) return options.url || options.uri!;
    if (!options.host || !options.port || !options.name) fail('MongoDB configuration is unavailable for mindmap migration');
    let url = `${options.protocol || 'mongodb'}://`;
    if (options.username) url += `${options.username}:${encodeURIComponent(options.password || '')}@`;
    return `${url}${options.host}:${options.port}/${options.name}`;
}

export class MongoMindmapMultiMigrationRepository implements MindmapMultiMigrationRepository {
    constructor(
        private readonly db: Db,
        private readonly options: HydroMongoOptions = {},
        private readonly closeConnection: () => Promise<void> = async () => undefined,
    ) {}

    private collection(logicalName: string) {
        return this.db.collection<any>(collectionName(this.options, logicalName));
    }

    async loadSnapshot(): Promise<MindmapMultiMigrationSnapshot> {
        const [configs, maps, nodes, problems, courses] = await Promise.all([
            this.collection('mindmap.config').find({}).toArray(),
            this.collection('mindmap.maps').find({}).toArray(),
            this.collection('mindmap.nodes').find({}).toArray(),
            this.collection('document').find({ docType: TYPE_PROBLEM }).toArray(),
            this.collection('document')
                .find({ docType: TYPE_TRAINING, ...courseKindClause() })
                .toArray(),
        ]);
        return { configs, maps, nodes, problems, courses };
    }

    async isSystemAdministrator(uid: number): Promise<boolean> {
        const user = await this.collection('user').findOne({ _id: uid }, { projection: { _id: 1, priv: 1 } });
        return !!user && user._id === uid && Number.isSafeInteger(user.priv) && (user.priv & PRIV_EDIT_SYSTEM) === PRIV_EDIT_SYSTEM;
    }

    async insertMap(map: Record<string, any>): Promise<void> {
        await this.collection('mindmap.maps').insertOne(map);
    }

    async setNodeMapId(mapId: ObjectId) {
        const result = await this.collection('mindmap.nodes').updateMany({ mapId: { $exists: false } }, { $set: { mapId } });
        return { matchedCount: result.matchedCount, modifiedCount: result.modifiedCount };
    }

    async setProblemMapId(mapId: ObjectId) {
        const result = await this.collection('document').updateMany(
            { docType: TYPE_PROBLEM, knowledgeMapId: { $exists: false } },
            { $set: { knowledgeMapId: mapId } },
        );
        return { matchedCount: result.matchedCount, modifiedCount: result.modifiedCount };
    }

    async deleteGlobalConfig(config: MindmapMultiMigrationSourceFacts['config']): Promise<number> {
        const result = await this.collection('mindmap.config').deleteOne({
            _id: 'global',
            title: config.title,
            rootNodeId: new ObjectId(config.rootNodeId),
            layoutDirection: config.layoutDirection,
            updatedAt: new Date(config.updatedAt),
        });
        return result.deletedCount;
    }

    async insertAudit(audit: Record<string, any>): Promise<string> {
        const result = await this.collection('oplog').insertOne({ _id: new ObjectId(), ...audit });
        return result.insertedId.toHexString();
    }

    findSuccessfulAudit(fingerprint: string): Promise<Record<string, any> | null> {
        return this.collection('oplog').findOne({ type: 'mindmap.multi.migration', fingerprint, result: 'success' });
    }

    close(): Promise<void> {
        return this.closeConnection();
    }
}

export async function createMongoMindmapMultiMigrationRepository(): Promise<MongoMindmapMultiMigrationRepository> {
    const options = load() as HydroMongoOptions | null;
    if (!options) fail('Hydro configuration is unavailable for mindmap migration');
    const url = mongoUrl(options);
    const parsed = mongoUri.parse(url);
    const client = await MongoClient.connect(url, { readPreference: 'primary' });
    return new MongoMindmapMultiMigrationRepository(client.db(parsed.database || options.name || 'hydro'), options, () => client.close());
}

export const mindmapMultiMigrationAdapterInternals = { collectionName, mongoUrl };
