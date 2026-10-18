import fs from 'node:fs/promises';
import path from 'node:path';
import type { CAC } from 'cac';
import { BSON, ObjectId } from 'mongodb';

import {
    applyMindmapMergePlan,
    buildMindmapMergePlan,
    MINDMAP_MERGE_SCHEMA_VERSION,
    mindmapMergeFingerprint,
    verifyMindmapMerge,
    type MindmapMergeGenerated,
    type MindmapMergeGates,
    type MindmapMergePlan,
    type MindmapMergeRepository,
} from '../lib/mindmap-merge-migration';
import { writeJsonAtomic } from '../lib/problem-batch-import';

const CONFIRM_PREFIX = 'APPLY:mindmap-merge-courses:';
const originalStdoutWrite = process.stdout.write.bind(process.stdout);

interface MindmapMergeCommandOptions {
    actor?: string;
    backupConfirmed?: string;
    confirm?: string;
    fingerprint?: string;
    serviceStopped?: boolean;
}

interface ClosableRepository extends MindmapMergeRepository {
    close?: () => Promise<void>;
}

interface MindmapMergeCommandDependencies {
    loadRepository: () => Promise<ClosableRepository>;
}

interface MindmapMergeCommandReport extends MindmapMergePlan {
    generated: MindmapMergeGenerated;
}

async function defaultLoadRepository(): Promise<ClosableRepository> {
    const { createMongoMindmapMergeRepository } = require('../model/mindmap-merge-migration-adapter') as typeof import('../model/mindmap-merge-migration-adapter');
    return createMongoMindmapMergeRepository();
}

function positiveInteger(value: string | undefined, field: string): number {
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(`${field} must be a positive integer`);
    return parsed;
}

function sameInstant(left: unknown, right: Date): boolean {
    return left instanceof Date && left.getTime() === right.getTime();
}

function assertReport(value: unknown): asserts value is MindmapMergeCommandReport {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('mindmap merge report is malformed');
    const report = value as MindmapMergeCommandReport;
    if (report.schemaVersion !== MINDMAP_MERGE_SCHEMA_VERSION) throw new Error('mindmap merge report schemaVersion is unsupported');
    if (typeof report.fingerprint !== 'string' || !/^[0-9a-fA-F]{64}$/.test(report.fingerprint)) {
        throw new Error('mindmap merge report fingerprint is malformed');
    }
    if (mindmapMergeFingerprint(report) !== report.fingerprint) throw new Error('mindmap merge report fingerprint is invalid');
    const generated = report.generated;
    if (!(generated?.mapId instanceof ObjectId) || !(generated.rootNodeId instanceof ObjectId)) {
        throw new TypeError('mindmap merge report is missing generated ids');
    }
    if (!(generated.now instanceof Date) || Number.isNaN(generated.now.getTime())) {
        throw new TypeError('mindmap merge report generated.now is invalid');
    }
    const map = report.target?.map;
    const root = report.target?.root;
    if (!(map?._id instanceof ObjectId) || !map._id.equals(generated.mapId)) {
        throw new Error('mindmap merge report generated.mapId does not match the plan');
    }
    if (!(root?._id instanceof ObjectId) || !root._id.equals(generated.rootNodeId)) {
        throw new Error('mindmap merge report generated.rootNodeId does not match the plan');
    }
    if (!(map.rootNodeId instanceof ObjectId) || !map.rootNodeId.equals(generated.rootNodeId)) {
        throw new Error('mindmap merge report root does not match generated.rootNodeId');
    }
    if (!sameInstant(map.createdAt, generated.now) || !sameInstant(map.updatedAt, generated.now)
        || !sameInstant(root.createdAt, generated.now) || !sameInstant(root.updatedAt, generated.now)) {
        throw new Error('mindmap merge report generated.now does not match the plan');
    }
}

async function readReport(filename: string): Promise<MindmapMergeCommandReport> {
    let parsed: unknown;
    try {
        parsed = JSON.parse(await fs.readFile(filename, 'utf8'));
    } catch (error) {
        throw new Error(`cannot read mindmap merge report: ${filename}`, { cause: error });
    }
    let report: unknown;
    try {
        report = BSON.EJSON.deserialize(parsed);
    } catch (error) {
        throw new Error(`mindmap merge report is not EJSON: ${filename}`, { cause: error });
    }
    assertReport(report);
    return report;
}

function assertApplyGates(report: MindmapMergeCommandReport, options: MindmapMergeCommandOptions): MindmapMergeGates {
    if (options.serviceStopped !== true) {
        throw new Error('--service-stopped is required; stop Hydro before applying this migration');
    }
    const fingerprint = String(options.fingerprint || '').trim();
    const confirm = String(options.confirm || '').trim();
    const backupConfirmed = String(options.backupConfirmed || '').trim();
    if (!fingerprint || !confirm) throw new Error('--fingerprint and --confirm are required');
    if (backupConfirmed !== report.fingerprint) {
        throw new Error('--backup-confirmed must equal the exact plan fingerprint after the required full and collection backups complete');
    }
    if (fingerprint !== report.fingerprint) throw new Error('mindmap merge fingerprint does not match the plan');
    if (confirm !== `${CONFIRM_PREFIX}${report.fingerprint}`) throw new Error('mindmap merge confirmation does not match the plan');
    return {
        actor: positiveInteger(options.actor, '--actor'),
        fingerprint,
        confirm,
        backupConfirmed: true,
        serviceStopped: true,
    };
}

async function withRepository<T>(
    dependencies: MindmapMergeCommandDependencies,
    callback: (repository: ClosableRepository) => Promise<T>,
): Promise<T> {
    const repository = await dependencies.loadRepository();
    try {
        return await callback(repository);
    } finally {
        await repository.close?.();
    }
}

async function planMerge(reportPath: string, dependencies: MindmapMergeCommandDependencies) {
    return withRepository(dependencies, async (repository) => {
        const generated: MindmapMergeGenerated = {
            mapId: new ObjectId(),
            rootNodeId: new ObjectId(),
            now: new Date(),
        };
        const first = buildMindmapMergePlan(await repository.snapshot(), generated);
        const second = buildMindmapMergePlan(await repository.snapshot(), generated);
        if (first.fingerprint !== second.fingerprint) {
            throw new Error('production changed while the read-only migration plan was loading');
        }
        const report: MindmapMergeCommandReport = { ...second, generated };
        await writeJsonAtomic(reportPath, BSON.EJSON.serialize(report, { relaxed: false }));
        return {
            ok: true as const,
            stage: 'plan' as const,
            reportPath,
            fingerprint: report.fingerprint,
            mapId: generated.mapId.toHexString(),
            rootNodeId: generated.rootNodeId.toHexString(),
        };
    });
}

export async function runMindmapMergeCoursesCommand(
    stage: string,
    reportInput: string,
    options: MindmapMergeCommandOptions,
    dependencies: MindmapMergeCommandDependencies,
) {
    if (stage !== 'plan' && stage !== 'apply' && stage !== 'verify') throw new Error(`unsupported stage: ${stage}`);
    const reportPath = path.resolve(reportInput);
    if (stage === 'plan') return planMerge(reportPath, dependencies);
    const report = await readReport(reportPath);
    if (stage === 'apply') {
        const gates = assertApplyGates(report, options);
        return withRepository(dependencies, async (repository) => {
            const applied = await applyMindmapMergePlan(repository, report, gates);
            return {
                ok: true as const, stage, reportPath, fingerprint: report.fingerprint, applied,
            };
        });
    }
    return withRepository(dependencies, async (repository) => {
        const verified = await verifyMindmapMerge(repository, report);
        return {
            ok: true as const, stage, reportPath, verified,
        };
    });
}

export function register(
    cli: CAC,
    dependencies: MindmapMergeCommandDependencies = { loadRepository: defaultLoadRepository },
): void {
    cli.command('mindmap:merge-courses <stage> <report>')
        .option('--fingerprint <sha256>', 'Exact read-only plan fingerprint required by apply')
        .option('--confirm <token>', 'Exact APPLY:mindmap-merge-courses:<fingerprint> token required by apply')
        .option('--actor <uid>', 'Operator uid recorded in the migration audit')
        .option('--backup-confirmed <sha256>', 'Exact plan fingerprint acknowledging the required full and collection backups')
        .option('--service-stopped', 'Required acknowledgement that Hydro is stopped')
        .action(async (stage: string, report: string, options: MindmapMergeCommandOptions) => {
            const result = await runMindmapMergeCoursesCommand(stage, report, options, dependencies);
            originalStdoutWrite(`${JSON.stringify(result)}\n`);
        });
}
