import { isDeepStrictEqual } from 'node:util';
import type { Db, Filter } from 'mongodb';
import { MongoClient, ObjectId } from 'mongodb';
import mongoUri from 'mongodb-uri';
import {
    PID_NAMESPACE_MIGRATION_DOMAIN_ID,
    PID_NAMESPACE_MIGRATION_SCHEMA_VERSION,
    PID_NAMESPACE_OS_DOC_ID,
    PID_NAMESPACE_OS_NEW_PID,
    PID_NAMESPACE_OS_OLD_PID,
    PidNamespaceMigrationError,
    type PidNamespaceMigrationCounterTarget,
    type PidNamespaceMigrationEntry,
    type PidNamespaceMigrationRelatedRows,
    type PidNamespaceMigrationReport,
    type PidNamespaceMigrationRepository,
    type PidNamespaceMigrationSnapshot,
} from '../lib/problem-pid-namespace-migration';
import { load } from '../options';

const TYPE_PROBLEM = 10;
const TYPE_PROBLEM_SOLUTION = 11;
const TYPE_DISCUSSION = 21;
const TYPE_CONTEST = 30;
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

function fail(message: string, code = 'PID_NAMESPACE_MIGRATION_DATABASE_UNAVAILABLE', details?: unknown): never {
    throw new PidNamespaceMigrationError(message, code, details);
}

function collectionName(options: HydroMongoOptions, logicalName: string): string {
    const prefixed = options.prefix ? `${options.prefix}.${logicalName}` : logicalName;
    return options.collectionMap?.[prefixed] || prefixed;
}

function mongoUrl(options: HydroMongoOptions): string {
    if (options.url || options.uri) return options.url || options.uri!;
    if (!options.host || !options.port || !options.name) fail('MongoDB configuration is unavailable for PID namespace migration');
    let url = `${options.protocol || 'mongodb'}://`;
    if (options.username) url += `${options.username}:${encodeURIComponent(options.password || '')}@`;
    return `${url}${options.host}:${options.port}/${options.name}`;
}

function same(left: unknown, right: unknown): boolean {
    return isDeepStrictEqual(left, right);
}

function expectedField(present: boolean, value: unknown): unknown {
    return present ? value : { $exists: false };
}

function osNamespaceObjectId(namespaceId: string): ObjectId {
    const raw = namespaceId.slice('custom:'.length);
    if (!/^custom:[a-f0-9]{24}$/.test(namespaceId)) {
        fail('OS namespace identity is malformed', 'PID_NAMESPACE_MIGRATION_REPORT_TAMPERED');
    }
    return new ObjectId(raw);
}

function exactOsNamespace(doc: Record<string, any> | null, target: PidNamespaceMigrationReport['target']['osNamespace'], actor: number): boolean {
    return (
        !!doc &&
        String(doc._id) === target.namespaceId.slice('custom:'.length) &&
        doc.domainId === PID_NAMESPACE_MIGRATION_DOMAIN_ID &&
        doc.namespaceId === target.namespaceId &&
        doc.kind === 'custom' &&
        doc.name === target.name &&
        doc.prefix === target.prefix &&
        doc.start === target.start &&
        doc.counter === target.counter &&
        doc.allocated === true &&
        doc.enabled === true &&
        doc.revision === 1 &&
        doc.createdBy === actor &&
        same(doc.members, target.members)
    );
}

export class MongoPidNamespaceMigrationRepository implements PidNamespaceMigrationRepository {
    constructor(
        private readonly db: Db,
        private readonly options: HydroMongoOptions = {},
        private readonly closeConnection: () => Promise<void> = async () => undefined,
    ) {}

    private collection(logicalName: string) {
        return this.db.collection<any>(collectionName(this.options, logicalName));
    }

    private async loadDatabaseIdentity(): Promise<PidNamespaceMigrationSnapshot['databaseIdentity']> {
        const hello = await this.db.admin().command({ hello: 1 });
        return {
            databaseName: this.db.databaseName,
            collectionPrefix: this.options.prefix || '',
            collectionMap: Object.entries(this.options.collectionMap || {})
                .map(([logicalName, physicalName]) => ({ logicalName, physicalName }))
                .sort((left, right) => left.logicalName.localeCompare(right.logicalName) || left.physicalName.localeCompare(right.physicalName)),
            replicaSet: typeof hello.setName === 'string' ? hello.setName : null,
            primary: typeof hello.primary === 'string' ? hello.primary : null,
            hosts: Array.isArray(hello.hosts) ? hello.hosts.map(String).sort() : [],
        };
    }

    private async loadRelatedRows(): Promise<PidNamespaceMigrationRelatedRows> {
        const aliases = [PID_NAMESPACE_OS_DOC_ID, String(PID_NAMESPACE_OS_DOC_ID), PID_NAMESPACE_OS_OLD_PID, PID_NAMESPACE_OS_NEW_PID];
        const recordsPromise = this.collection('record')
            .find({ domainId: PID_NAMESPACE_MIGRATION_DOMAIN_ID, pid: PID_NAMESPACE_OS_DOC_ID })
            .toArray();
        const [
            records,
            recordStats,
            statuses,
            containers,
            trainingCourses,
            problemReferences,
            solutions,
            discussions,
            mindmap,
            tasks,
            paperDrafts,
            permits,
            permitSources,
            testdataSources,
            storage,
        ] = await Promise.all([
            recordsPromise,
            this.collection('record.stat').find({ domainId: PID_NAMESPACE_MIGRATION_DOMAIN_ID, pid: PID_NAMESPACE_OS_DOC_ID }).toArray(),
            this.collection('document.status')
                .find({
                    domainId: PID_NAMESPACE_MIGRATION_DOMAIN_ID,
                    docType: TYPE_PROBLEM,
                    docId: PID_NAMESPACE_OS_DOC_ID,
                })
                .toArray(),
            this.collection('document')
                .find({
                    domainId: PID_NAMESPACE_MIGRATION_DOMAIN_ID,
                    docType: TYPE_CONTEST,
                    pids: PID_NAMESPACE_OS_DOC_ID,
                })
                .toArray(),
            this.collection('document')
                .find({
                    domainId: PID_NAMESPACE_MIGRATION_DOMAIN_ID,
                    docType: TYPE_TRAINING,
                    'dag.pids': PID_NAMESPACE_OS_DOC_ID,
                })
                .toArray(),
            this.collection('document')
                .find({
                    docType: TYPE_PROBLEM,
                    'reference.domainId': PID_NAMESPACE_MIGRATION_DOMAIN_ID,
                    'reference.pid': PID_NAMESPACE_OS_DOC_ID,
                })
                .toArray(),
            this.collection('document')
                .find({
                    domainId: PID_NAMESPACE_MIGRATION_DOMAIN_ID,
                    docType: TYPE_PROBLEM_SOLUTION,
                    parentType: TYPE_PROBLEM,
                    parentId: PID_NAMESPACE_OS_DOC_ID,
                })
                .toArray(),
            this.collection('document')
                .find({
                    domainId: PID_NAMESPACE_MIGRATION_DOMAIN_ID,
                    docType: TYPE_DISCUSSION,
                    parentType: TYPE_PROBLEM,
                    parentId: PID_NAMESPACE_OS_DOC_ID,
                })
                .toArray(),
            this.collection('mindmap.nodes')
                .find({ problemIds: { $in: aliases } })
                .toArray(),
            this.collection('tasks.tasks')
                .find({
                    domainId: PID_NAMESPACE_MIGRATION_DOMAIN_ID,
                    'graph.nodes.params.problemId': { $in: aliases },
                })
                .toArray(),
            this.collection('vigil.paper_draft').find({ domainId: PID_NAMESPACE_MIGRATION_DOMAIN_ID, pid: PID_NAMESPACE_OS_DOC_ID }).toArray(),
            this.collection('problem.permits')
                .find({
                    domainId: PID_NAMESPACE_MIGRATION_DOMAIN_ID,
                    pid: PID_NAMESPACE_OS_DOC_ID,
                })
                .toArray(),
            this.collection('problem.permitSources')
                .find({
                    domainId: PID_NAMESPACE_MIGRATION_DOMAIN_ID,
                    pid: PID_NAMESPACE_OS_DOC_ID,
                })
                .toArray(),
            this.collection('document')
                .find({
                    domainId: PID_NAMESPACE_MIGRATION_DOMAIN_ID,
                    docType: TYPE_PROBLEM,
                    $or: [{ testdataSourcePid: PID_NAMESPACE_OS_DOC_ID }, { 'config.testdataSourcePid': PID_NAMESPACE_OS_DOC_ID }],
                })
                .toArray(),
            this.collection('storage')
                .find({ path: { $regex: `^problem/${PID_NAMESPACE_MIGRATION_DOMAIN_ID}/${PID_NAMESPACE_OS_DOC_ID}/` } })
                .toArray(),
        ]);
        const recordIds = records.map((record) => record._id).filter(Boolean);
        const recordHistory = recordIds.length
            ? await this.collection('record.history')
                  .find({ rid: { $in: recordIds } })
                  .toArray()
            : [];
        return {
            records,
            recordStats,
            recordHistory,
            statuses,
            containers,
            trainingCourses,
            problemReferences,
            solutions,
            discussions,
            mindmap,
            tasks,
            paperDrafts,
            permits,
            permitSources,
            testdataSources,
            storage,
        };
    }

    async loadSnapshot(): Promise<PidNamespaceMigrationSnapshot> {
        const [databaseIdentity, problems, domains, counters, namespaceDocs, related] = await Promise.all([
            this.loadDatabaseIdentity(),
            this.collection('document').find({ docType: TYPE_PROBLEM }).toArray(),
            this.collection('domain').find({}).toArray(),
            this.collection('problem.pid_counters').find({}).toArray(),
            this.collection('problem.pid_namespaces').find({}).toArray(),
            this.loadRelatedRows(),
        ]);
        const packageVersion = String(require('../../package.json').version || 'unknown');
        return {
            databaseIdentity,
            codeVersion: `hydrooj@${packageVersion}/problem-pid-namespace-migration@${PID_NAMESPACE_MIGRATION_SCHEMA_VERSION}`,
            problems,
            domains,
            counters,
            namespaceDocs,
            related,
        };
    }

    async isSystemAdministrator(uid: number): Promise<boolean> {
        const user = await this.collection('user').findOne({ _id: uid }, { projection: { _id: 1, priv: 1 } });
        return !!user && user._id === uid && Number.isSafeInteger(user.priv) && (user.priv & PRIV_EDIT_SYSTEM) === PRIV_EDIT_SYSTEM;
    }

    loadProblem(domainId: string, docId: number): Promise<Record<string, any> | null> {
        return this.collection('document').findOne({ domainId, docType: TYPE_PROBLEM, docId });
    }

    async casProblem(entry: PidNamespaceMigrationEntry) {
        if (entry.decision !== 'assign' && entry.decision !== 'rename-os') {
            fail(`Refusing to write skipped Problem ${entry.domainId}/${entry.docId}`, 'PID_NAMESPACE_MIGRATION_WRITE_INVALID');
        }
        const filter: Filter<Record<string, any>> = {
            _id: new ObjectId(entry.documentId),
            domainId: entry.domainId,
            docType: TYPE_PROBLEM,
            docId: entry.docId,
            pid: entry.pid,
            structureRevision: expectedField(entry.structureRevisionPresent, entry.structureRevision),
            pidNamespaceId: expectedField(entry.pidNamespaceIdPresent, entry.pidNamespaceId),
        };
        const $set: Record<string, unknown> = { pidNamespaceId: entry.namespaceId };
        if (entry.decision === 'rename-os') {
            $set.pid = entry.targetPid;
            $set.sort = entry.targetSort;
        }
        const result = await this.collection('document').updateOne(filter, { $set });
        return { matchedCount: result.matchedCount, modifiedCount: result.modifiedCount };
    }

    async ensureOsNamespace(target: PidNamespaceMigrationReport['target']['osNamespace'], actor: number, now: Date): Promise<'applied' | 'no-op'> {
        const objectId = osNamespaceObjectId(target.namespaceId);
        const collisionFilter = {
            $or: [{ _id: objectId }, { namespaceId: target.namespaceId }, { domainId: PID_NAMESPACE_MIGRATION_DOMAIN_ID, prefix: target.prefix }],
        };
        const current = await this.collection('problem.pid_namespaces').findOne(collisionFilter);
        if (current) {
            if (exactOsNamespace(current, target, actor)) return 'no-op';
            fail('OS namespace collides with a different document', 'PID_NAMESPACE_MIGRATION_CAS_CONFLICT', current);
        }
        const doc = {
            _id: objectId,
            domainId: PID_NAMESPACE_MIGRATION_DOMAIN_ID,
            namespaceId: target.namespaceId,
            kind: 'custom',
            name: target.name,
            prefix: target.prefix,
            start: target.start,
            counter: target.counter,
            allocated: true,
            enabled: target.enabled,
            revision: 1,
            members: target.members,
            createdBy: actor,
            createdAt: now,
            updatedAt: now,
        };
        try {
            await this.collection('problem.pid_namespaces').insertOne(doc);
            return 'applied';
        } catch (error) {
            const confirmed = await this.collection('problem.pid_namespaces').findOne(collisionFilter);
            if (exactOsNamespace(confirmed, target, actor)) return 'no-op';
            throw error;
        }
    }

    async ensureCounter(target: PidNamespaceMigrationCounterTarget, now: Date): Promise<'applied' | 'no-op'> {
        const identity = { domainId: target.domainId, namespace: target.scope };
        const current = await this.collection('problem.pid_counters').findOne(identity);
        if (current?.value === target.targetValue) return 'no-op';
        if (target.currentPresent) {
            if (!current || current.value !== target.currentValue) {
                fail(`Counter ${target.domainId}/${target.scope} changed after plan`, 'PID_NAMESPACE_MIGRATION_CAS_CONFLICT', current);
            }
            const result = await this.collection('problem.pid_counters').updateOne(
                { ...identity, value: target.currentValue },
                { $set: { value: target.targetValue, updatedAt: now } },
            );
            if (result.matchedCount === 1 && result.modifiedCount === 1) return 'applied';
        } else if (!current) {
            try {
                await this.collection('problem.pid_counters').insertOne({ ...identity, value: target.targetValue, updatedAt: now });
                return 'applied';
            } catch (error) {
                const confirmed = await this.collection('problem.pid_counters').findOne(identity);
                if (confirmed?.value === target.targetValue) return 'no-op';
                throw error;
            }
        }
        const confirmed = await this.collection('problem.pid_counters').findOne(identity);
        if (confirmed?.value === target.targetValue) return 'no-op';
        fail(`Counter ${target.domainId}/${target.scope} CAS failed`, 'PID_NAMESPACE_MIGRATION_CAS_CONFLICT', confirmed);
    }

    async insertAudit(audit: Record<string, any>): Promise<string> {
        const result = await this.collection('oplog').insertOne({ _id: new ObjectId(), ...audit });
        return result.insertedId.toHexString();
    }

    findEntryAudit(fingerprint: string, domainId: string, docId: number): Promise<Record<string, any> | null> {
        return this.collection('oplog').findOne({
            type: 'problem.pid-namespace.migration.entry',
            fingerprint,
            domainId,
            problemId: docId,
            result: 'success',
        });
    }

    findNamespaceAudit(fingerprint: string): Promise<Record<string, any> | null> {
        return this.collection('oplog').findOne({
            type: 'problem.pid-namespace.migration.namespace',
            fingerprint,
            result: 'success',
        });
    }

    findCounterAudit(fingerprint: string, domainId: string, scope: string): Promise<Record<string, any> | null> {
        return this.collection('oplog').findOne({
            type: 'problem.pid-namespace.migration.counter',
            fingerprint,
            domainId,
            counterScope: scope,
            result: 'success',
        });
    }

    findSuccessfulAudit(fingerprint: string): Promise<Record<string, any> | null> {
        return this.collection('oplog').findOne({
            type: 'problem.pid-namespace.migration',
            fingerprint,
            result: 'success',
        });
    }

    loadSuccessfulAudits(fingerprint: string): Promise<Array<Record<string, any>>> {
        return this.collection('oplog')
            .find({
                type: {
                    $in: [
                        'problem.pid-namespace.migration',
                        'problem.pid-namespace.migration.entry',
                        'problem.pid-namespace.migration.namespace',
                        'problem.pid-namespace.migration.counter',
                    ],
                },
                fingerprint,
                result: 'success',
            })
            .toArray();
    }

    close(): Promise<void> {
        return this.closeConnection();
    }
}

export async function createMongoPidNamespaceMigrationRepository(): Promise<MongoPidNamespaceMigrationRepository> {
    const options = load() as HydroMongoOptions | null;
    if (!options) fail('Hydro configuration is unavailable for PID namespace migration');
    const url = mongoUrl(options);
    const parsed = mongoUri.parse(url);
    const client = await MongoClient.connect(url, { readPreference: 'primary' });
    return new MongoPidNamespaceMigrationRepository(client.db(parsed.database || options.name || 'hydro'), options, () => client.close());
}

export const pidNamespaceMigrationAdapterInternals = {
    collectionName,
    exactOsNamespace,
    mongoUrl,
};
