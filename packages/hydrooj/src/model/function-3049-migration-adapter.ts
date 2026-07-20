import type { Db } from 'mongodb';
import { MongoClient, ObjectId } from 'mongodb';
import mongoUri from 'mongodb-uri';
import {
    FUNCTION_3049_DOC_ID,
    FUNCTION_3049_DOMAIN_ID,
    Function3049MigrationError,
    type Function3049MigrationRepository,
    type Function3049MigrationSnapshot,
} from '../lib/function-3049-migration';
import { load } from '../options';

const TYPE_PROBLEM = 10;
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
    throw new Function3049MigrationError(message, 'FUNCTION_3049_MIGRATION_DATABASE_UNAVAILABLE');
}

function collectionName(options: HydroMongoOptions, logicalName: string): string {
    const prefixed = options.prefix ? `${options.prefix}.${logicalName}` : logicalName;
    return options.collectionMap?.[prefixed] || prefixed;
}

function mongoUrl(options: HydroMongoOptions): string {
    if (options.url || options.uri) return options.url || options.uri!;
    if (!options.host || !options.port || !options.name) fail('MongoDB configuration is unavailable for function #3049 migration');
    let url = `${options.protocol || 'mongodb'}://`;
    if (options.username) url += `${options.username}:${encodeURIComponent(options.password || '')}@`;
    return `${url}${options.host}:${options.port}/${options.name}`;
}

export class MongoFunction3049MigrationRepository implements Function3049MigrationRepository {
    constructor(
        private readonly db: Db,
        private readonly options: HydroMongoOptions = {},
        private readonly closeConnection: () => Promise<void> = async () => undefined,
    ) {}

    private collection(logicalName: string) {
        return this.db.collection<any>(collectionName(this.options, logicalName));
    }

    async loadSnapshot(): Promise<Function3049MigrationSnapshot> {
        const [functionProblems, recordCount] = await Promise.all([
            this.collection('document').find({ docType: TYPE_PROBLEM, problemKind: 'function' }).toArray(),
            this.collection('record').countDocuments({ domainId: FUNCTION_3049_DOMAIN_ID, pid: FUNCTION_3049_DOC_ID }),
        ]);
        return { functionProblems, recordCount };
    }

    async isSystemAdministrator(uid: number): Promise<boolean> {
        const user = await this.collection('user').findOne({ _id: uid }, { projection: { _id: 1, priv: 1 } });
        return !!user && user._id === uid && Number.isSafeInteger(user.priv) && (user.priv & PRIV_EDIT_SYSTEM) === PRIV_EDIT_SYSTEM;
    }

    async updateTarget(input: { expectedProblem: Record<string, any>; nextConfig: Record<string, any>; nextStructureRevision: number }) {
        const expected = input.expectedProblem;
        const result = await this.collection('document').updateOne(
            {
                _id: expected._id,
                docType: TYPE_PROBLEM,
                domainId: FUNCTION_3049_DOMAIN_ID,
                docId: FUNCTION_3049_DOC_ID,
                problemKind: 'function',
                hidden: true,
                codeEvaluationStatus: 'draft',
                nSubmit: 0,
                structureRevision: expected.structureRevision,
                config: expected.config,
            },
            { $set: { config: input.nextConfig, structureRevision: input.nextStructureRevision } },
        );
        return { matchedCount: result.matchedCount, modifiedCount: result.modifiedCount };
    }

    async insertAudit(audit: Record<string, any>): Promise<string> {
        const result = await this.collection('oplog').insertOne({ _id: new ObjectId(), ...audit });
        return result.insertedId.toHexString();
    }

    findSuccessfulAudit(fingerprint: string): Promise<Record<string, any> | null> {
        return this.collection('oplog').findOne({ type: 'problem.function-3049.migration', fingerprint, result: 'success' });
    }

    close(): Promise<void> {
        return this.closeConnection();
    }
}

export async function createMongoFunction3049MigrationRepository(): Promise<MongoFunction3049MigrationRepository> {
    const options = load() as HydroMongoOptions | null;
    if (!options) fail('Hydro configuration is unavailable for function #3049 migration');
    const url = mongoUrl(options);
    const parsed = mongoUri.parse(url);
    const client = await MongoClient.connect(url, { readPreference: 'primary' });
    return new MongoFunction3049MigrationRepository(client.db(parsed.database || options.name || 'hydro'), options, () => client.close());
}

export const function3049MigrationAdapterInternals = { collectionName, mongoUrl };
