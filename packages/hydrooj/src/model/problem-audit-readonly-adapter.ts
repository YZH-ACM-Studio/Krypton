import fs from 'node:fs/promises';
import path from 'node:path';
import type { Db, Document } from 'mongodb';
import { MongoClient } from 'mongodb';
import mongoUri from 'mongodb-uri';
import {
    ProblemAuditError,
    type ProblemAuditAdapter,
    type ProblemAuditProblem,
    type ProblemAuditQuery,
    type ProblemAuditTestdataFile,
    type ProblemAuditTestdataRead,
} from '../lib/problem-audit';
import { shouldScanTestdataName } from '../lib/problem-audit-eol';
import { load } from '../options';

const TYPE_PROBLEM = 10;
const MAX_TEXT_BYTES = 32 * 1024 * 1024;

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

interface SystemRow {
    _id: string;
    value?: unknown;
}

interface StorageRow {
    _id: string;
    path: string;
    link?: string;
    size?: number;
    autoDelete?: unknown;
}

function fail(message: string, code = 'PROBLEM_AUDIT_READONLY_UNAVAILABLE', details?: unknown): never {
    throw new ProblemAuditError(message, code, details);
}

function collectionName(options: HydroMongoOptions, logicalName: string): string {
    const prefixed = options.prefix ? `${options.prefix}.${logicalName}` : logicalName;
    return options.collectionMap?.[prefixed] || prefixed;
}

function mongoUrl(options: HydroMongoOptions): string {
    if (options.url || options.uri) return options.url || options.uri;
    if (!options.host || !options.port || !options.name) fail('MongoDB configuration is unavailable for read-only audit');
    let url = `${options.protocol || 'mongodb'}://`;
    if (options.username) url += `${options.username}:${encodeURIComponent(options.password || '')}@`;
    return `${url}${options.host}:${options.port}/${options.name}`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function problemFromRow(row: Record<string, unknown>): ProblemAuditProblem | null {
    if (typeof row.domainId !== 'string' || !Number.isSafeInteger(row.docId)) return null;
    return {
        domainId: row.domainId,
        docId: Number(row.docId),
        pid: typeof row.pid === 'string' && row.pid ? row.pid : String(row.docId),
        title: typeof row.title === 'string' ? row.title : '',
        content: row.content,
        html: row.html,
        statementFormat: row.statementFormat,
        programmingStatement: row.programmingStatement,
        pidNamespaceId: row.pidNamespaceId,
        sourceMeta: row.sourceMeta,
        config: row.config,
        data: row.data,
        tag: row.tag,
        hidden: row.hidden,
        archivedAt: row.archivedAt,
        problemKind: row.problemKind,
        nSubmit: row.nSubmit,
        nAccept: row.nAccept,
    };
}

function testdataPrefix(domainId: string, docId: number): string {
    return `problem/${domainId}/${docId}/testdata/`;
}

function resolveBlobPath(fileRoot: string, row: StorageRow): string {
    const id = String(row.link || row._id || '');
    if (!id || id.includes('..') || path.isAbsolute(id) || id.includes('\\')) {
        fail(`storage blob id is not a relative file path: ${id}`, 'PROBLEM_AUDIT_STORAGE_INVALID');
    }
    return path.join(fileRoot, id);
}

export class ReadonlyProblemAuditAdapter implements ProblemAuditAdapter {
    constructor(
        private readonly db: Db,
        private readonly options: HydroMongoOptions = {},
        private readonly fileRootOverride: string | undefined,
        private readonly closeConnection: () => Promise<void> = async () => undefined,
    ) {}

    private collection<T extends Document = Record<string, unknown>>(logicalName: string) {
        return this.db.collection<T>(collectionName(this.options, logicalName));
    }

    async loadProblems(query: ProblemAuditQuery): Promise<ProblemAuditProblem[]> {
        const filter: Record<string, unknown> = { docType: TYPE_PROBLEM };
        if (!query.allDomains) filter.domainId = query.domainId || 'system';
        const rows = await this.collection('document')
            .find(filter, {
                projection: {
                    domainId: 1,
                    docId: 1,
                    pid: 1,
                    title: 1,
                    content: 1,
                    html: 1,
                    statementFormat: 1,
                    programmingStatement: 1,
                    pidNamespaceId: 1,
                    sourceMeta: 1,
                    config: 1,
                    data: 1,
                    tag: 1,
                    hidden: 1,
                    archivedAt: 1,
                    problemKind: 1,
                    nSubmit: 1,
                    nAccept: 1,
                },
            })
            .toArray();
        return rows.map(problemFromRow).filter((item): item is ProblemAuditProblem => Boolean(item));
    }

    private async fileRoot(): Promise<string> {
        if (this.fileRootOverride) return path.resolve(this.fileRootOverride);
        const type = await this.collection<SystemRow>('system').findOne({ _id: 'file.type' }, { projection: { value: 1 } });
        const storageType = isPlainObject(type) ? type.value : undefined;
        if (storageType !== undefined && storageType !== 'file') {
            fail(`testdata-eol requires local file storage, got ${String(storageType)}`, 'PROBLEM_AUDIT_STORAGE_NOT_LOCAL');
        }
        const configured = await this.collection<SystemRow>('system').findOne({ _id: 'file.path' }, { projection: { value: 1 } });
        const value = isPlainObject(configured) && typeof configured.value === 'string' ? configured.value : '';
        return value || process.env.DEFAULT_STORE_PATH || '/data/file/hydro';
    }

    async listTestdataFiles(problems: ProblemAuditProblem[]): Promise<ProblemAuditTestdataFile[]> {
        if (!problems.length) return [];
        const byPrefix = new Map(problems.map((problem) => [testdataPrefix(problem.domainId, problem.docId), problem]));
        const prefixRegex = /^problem\/([^/]+)\/(\d+)\/testdata\/(.+)$/;
        const scanned = (await this.collection('storage')
            .find({ autoDelete: null, path: { $regex: '^problem/[^/]+/[0-9]+/testdata/' } }, { projection: { _id: 1, path: 1, link: 1, size: 1 } })
            .toArray()) as unknown as StorageRow[];
        const files: ProblemAuditTestdataFile[] = [];
        const seen = new Set<string>();
        for (const row of scanned) {
            if (typeof row.path !== 'string') continue;
            const matched = prefixRegex.exec(row.path);
            if (!matched) continue;
            const problem = byPrefix.get(testdataPrefix(matched[1], Number(matched[2])));
            if (!problem) continue;
            const name = matched[3];
            if (!name || seen.has(`${problem.domainId}/${problem.docId}/${name}`)) continue;
            const scan = shouldScanTestdataName(name);
            if (scan === 'skip') continue;
            seen.add(`${problem.domainId}/${problem.docId}/${name}`);
            files.push({
                domainId: problem.domainId,
                docId: problem.docId,
                pid: problem.pid,
                title: problem.title,
                name,
                size: typeof row.size === 'number' ? row.size : 0,
            });
        }
        return files.sort((left, right) => left.pid.localeCompare(right.pid) || left.name.localeCompare(right.name));
    }

    async readTestdata(file: ProblemAuditTestdataFile): Promise<ProblemAuditTestdataRead> {
        const row = (await this.collection('storage').findOne(
            { path: `${testdataPrefix(file.domainId, file.docId)}${file.name}`, autoDelete: null },
            { projection: { _id: 1, path: 1, link: 1, size: 1 } },
        )) as unknown as StorageRow | null;
        if (!row) return { missing: true };
        const size = typeof row.size === 'number' ? row.size : file.size;
        if (size > MAX_TEXT_BYTES) return { tooLarge: true };
        const root = await this.fileRoot();
        const blobPath = resolveBlobPath(root, row);
        try {
            const bytes = await fs.readFile(blobPath);
            if (bytes.length > MAX_TEXT_BYTES) return { tooLarge: true };
            return { bytes };
        } catch (error) {
            const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
            if (code === 'ENOENT') return { missing: true };
            throw error;
        }
    }

    close(): Promise<void> {
        return this.closeConnection();
    }
}

export async function createReadonlyProblemAuditAdapter(fileRoot?: string): Promise<ReadonlyProblemAuditAdapter> {
    const options = load() as HydroMongoOptions | null;
    if (!options) fail('Hydro configuration is unavailable for read-only audit');
    const url = mongoUrl(options);
    const parsed = mongoUri.parse(url);
    const client = await MongoClient.connect(url, { readPreference: 'primary' });
    return new ReadonlyProblemAuditAdapter(client.db(parsed.database || options.name || 'hydro'), options, fileRoot, () => client.close());
}

export const problemAuditReadonlyInternals = { collectionName, mongoUrl };
