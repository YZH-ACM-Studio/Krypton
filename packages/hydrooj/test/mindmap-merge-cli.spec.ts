import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import cac from 'cac';
import { expect } from 'chai';
import { ObjectId } from 'mongodb';

// This line matches @hydrooj/register's CJS strip so __filename stays defined.
const __filename = fileURLToPath(import.meta.url);
const requireFromTest = createRequire(__filename);
const commandModuleFilename = path.resolve(path.dirname(__filename), '../src/commands/mindmap-merge-courses.ts');
const commandsFilename = path.resolve(path.dirname(__filename), '../bin/commands.ts');

const nodeTime = new Date('2026-07-01T00:00:00.000Z');
const sourceMapId = new ObjectId('64b00000000000000000000a');
const sourceRootId = new ObjectId('64b000000000000000000011');

interface MindmapMergeMap {
    _id: ObjectId;
    title: string;
    rootNodeId: ObjectId;
    visibility: 'public' | 'hidden';
    layoutDirection: 'RIGHT' | 'DOWN';
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
}

interface MindmapMergeSnapshot {
    maps: MindmapMergeMap[];
    nodes: MindmapMergeNode[];
    problems: unknown[];
    courses: unknown[];
    indexes: string[];
}

interface CommandModule {
    register: (cli: ReturnType<typeof cac>, dependencies: { loadRepository: () => Promise<RecordingRepository> }) => void;
}

class CommandReturned extends Error {
    constructor() {
        super('mindmap:merge-courses apply completed without a non-zero failure');
        this.name = 'CommandReturned';
    }
}

class RecordingRepository {
    readonly writes: string[] = [];

    closed = 0;

    constructor(private readonly source: MindmapMergeSnapshot) {}

    async snapshot(): Promise<MindmapMergeSnapshot> {
        return cloneValue(this.source);
    }

    async insertMap(_doc: unknown): Promise<'inserted' | 'exists'> {
        this.writes.push('insertMap');
        return 'inserted';
    }

    async insertNode(_doc: unknown): Promise<'inserted' | 'exists'> {
        this.writes.push('insertNode');
        return 'inserted';
    }

    async updateNode(_id: unknown, _expected: unknown, _set: unknown, _unset: unknown): Promise<'updated' | 'already'> {
        this.writes.push('updateNode');
        return 'updated';
    }

    async updateProblems(_fromMapIds: unknown, _to: unknown): Promise<{ matched: number; modified: number }> {
        this.writes.push('updateProblems');
        return { matched: 0, modified: 0 };
    }

    async updateCourse(_key: unknown, _expectedMindmapId: unknown, _courseNodeId: unknown): Promise<'updated' | 'already'> {
        this.writes.push('updateCourse');
        return 'updated';
    }

    async deleteMap(_id: unknown, _expected: unknown): Promise<'deleted' | 'already'> {
        this.writes.push('deleteMap');
        return 'deleted';
    }

    async dropIndex(_name: unknown): Promise<'dropped' | 'absent'> {
        this.writes.push('dropIndex');
        return 'absent';
    }

    async writeAudit(_record: unknown): Promise<void> {
        this.writes.push('writeAudit');
    }

    async close(): Promise<void> {
        this.closed += 1;
    }
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

function oneMapSnapshot(): MindmapMergeSnapshot {
    return {
        maps: [{
            _id: sourceMapId,
            title: '算法',
            rootNodeId: sourceRootId,
            visibility: 'public',
            layoutDirection: 'RIGHT',
            createdAt: nodeTime,
            updatedAt: nodeTime,
        }],
        nodes: [{
            _id: sourceRootId,
            mapId: sourceMapId,
            parentId: null,
            topic: '算法',
            tags: [],
            problemIds: [],
            order: 0,
            createdAt: nodeTime,
            updatedAt: nodeTime,
        }],
        problems: [],
        courses: [],
        indexes: [],
    };
}

function readCommandModule(): unknown {
    try {
        return requireFromTest(commandModuleFilename);
    } catch (error) {
        const code = error && typeof error === 'object' && 'code' in error ? String((error as { code: unknown }).code) : '';
        const message = error instanceof Error ? error.message : '';
        const firstLine = message.split('\n')[0] ?? '';
        if (code === 'MODULE_NOT_FOUND' && firstLine.includes('mindmap-merge-courses')) return undefined;
        throw error;
    }
}

function loadCommand(): CommandModule {
    const loaded = readCommandModule() as Partial<CommandModule> | undefined;
    expect(typeof loaded?.register, 'mindmap-merge-courses register').to.equal('function');
    return loaded as CommandModule;
}

function failureText(failure: unknown): string {
    if (failure instanceof Error) return `${failure.message}\n${failure.stack ?? ''}`;
    return String(failure);
}

function reportMapId(report: Record<string, unknown>): string {
    const generated = report.generated;
    if (!generated || typeof generated !== 'object' || Array.isArray(generated)) return '';
    const mapId = (generated as Record<string, unknown>).mapId;
    if (typeof mapId === 'string') return mapId;
    if (!mapId || typeof mapId !== 'object' || Array.isArray(mapId)) return '';
    const oid = (mapId as Record<string, unknown>).$oid;
    return typeof oid === 'string' ? oid : '';
}

async function captureFailure(work: Promise<unknown>): Promise<unknown> {
    try {
        await work;
        return new CommandReturned();
    } catch (error) {
        return error;
    }
}

async function runCommand(command: CommandModule, repository: RecordingRepository, args: readonly string[]): Promise<unknown> {
    const cli = cac();
    command.register(cli, { loadRepository: async () => repository });
    cli.parse(['node', 'hydrooj', ...args], { run: false });
    expect(cli.matchedCommandName, 'mindmap:merge-courses').to.equal('mindmap:merge-courses');
    return cli.runMatchedCommand();
}

async function withReport<T>(callback: (reportPath: string) => Promise<T>): Promise<T> {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mindmap-merge-courses-'));
    try {
        return await callback(path.join(directory, 'report.json'));
    } finally {
        await fs.rm(directory, { recursive: true, force: true });
    }
}

describe('mindmap merge courses cli', () => {
    it('exits nonzero and names the missing backup confirmation without repository writes', async () => {
        const command = loadCommand();
        const repository = new RecordingRepository(oneMapSnapshot());
        await withReport(async (reportPath) => {
            await runCommand(command, repository, ['mindmap:merge-courses', 'plan', reportPath]);
            const report = JSON.parse(await fs.readFile(reportPath, 'utf8')) as Record<string, unknown>;
            expect(typeof report.fingerprint, 'fingerprint').to.equal('string');
            const fingerprint = String(report.fingerprint);
            const writesBeforeApply = repository.writes.slice();
            const failure = await captureFailure(runCommand(command, repository, [
                'mindmap:merge-courses',
                'apply',
                reportPath,
                '--actor',
                '2',
                '--fingerprint',
                fingerprint,
                '--confirm',
                `APPLY:mindmap-merge-courses:${fingerprint}`,
                '--service-stopped',
            ]));
            expect(failure instanceof CommandReturned, 'apply without --backup-confirmed should fail').to.equal(false);
            expect(/backup-confirmed|backupConfirmed/.test(failureText(failure)), failureText(failure)).to.equal(true);
            expect(repository.writes).to.deep.equal(writesBeforeApply);
        });
    });

    it('writes a plan report containing fingerprint and generated.mapId', async () => {
        const command = loadCommand();
        const repository = new RecordingRepository(oneMapSnapshot());
        await withReport(async (reportPath) => {
            await runCommand(command, repository, ['mindmap:merge-courses', 'plan', reportPath]);
            const report = JSON.parse(await fs.readFile(reportPath, 'utf8')) as Record<string, unknown>;
            expect(/^[0-9a-fA-F]{64}$/.test(String(report.fingerprint)), 'fingerprint').to.equal(true);
            expect(/^[0-9a-fA-F]{24}$/.test(reportMapId(report)), 'generated.mapId').to.equal(true);
        });
    });

    it('registers mindmap-merge-courses from bin/commands.ts', async () => {
        const source = await fs.readFile(commandsFilename, 'utf8');
        expect(source).to.match(/require\(\s*['"]\.\.\/src\/commands\/mindmap-merge-courses['"]\s*\)\s*\.register\(\s*cli\s*\)/);
    });
});
