import fs from 'node:fs/promises';
import path from 'node:path';
import type { CAC } from 'cac';
import { BSON, ObjectId } from 'mongodb';
import {
    applyMigration,
    assertMigrationConnection,
    assertMigrationPlan,
    connectMigrationStore,
    planMigration,
    verifyMigration,
    type MigratePlan,
    type MigrateStore,
} from '../lib/set-migrate-tool';

export interface SetMigrateOptions {
    uri?: string;
    database?: string;
    domain?: string;
    tids?: string;
    fingerprint?: string;
    confirm?: string;
    backupConfirmed?: string;
    serviceStopped?: boolean;
    actor?: string;
}
interface ClosableStore extends MigrateStore { close(): Promise<void> }
export interface SetMigrateDependencies { connect(uri: string, database: string): Promise<ClosableStore>; now(): Date }
const defaults: SetMigrateDependencies = { connect: connectMigrationStore, now: () => new Date() };

/** Never loads Hydro's global configuration or runtime. The URI must include the exact named database. */
export async function runSetMigrateCommand(stage: string, reportInput: string, options: SetMigrateOptions, dependencies = defaults) {
    if (!['plan', 'apply', 'verify'].includes(stage)) throw new Error('set_migrate_stage_invalid');
    const uri = options.uri ?? '';
    const database = options.database ?? '';
    const connectionFingerprint = assertMigrationConnection(uri, database);
    const reportPath = path.resolve(reportInput);
    let plan: MigratePlan | undefined;
    if (stage !== 'plan') {
        plan = BSON.EJSON.parse(await fs.readFile(reportPath, 'utf8'), { relaxed: false }) as MigratePlan;
        assertMigrationPlan(plan);
        if (plan.databaseName !== database || plan.connectionFingerprint !== connectionFingerprint) throw new Error('set_migrate_connection_mismatch');
    }
    if (stage === 'apply' && (!Number.isSafeInteger(Number(options.actor)) || Number(options.actor) < 1)) throw new Error('set_migrate_actor_required');
    const store = await dependencies.connect(uri, database);
    try {
        if (stage === 'plan') {
            const tidStrings = (options.tids ?? '').split(',');
            if (!options.domain || !tidStrings.length || tidStrings.some((tid) => !/^[a-fA-F0-9]{24}$/.test(tid))) throw new Error('set_migrate_explicit_scope_required');
            const scope = { domainId: options.domain, tids: tidStrings.map((tid) => new ObjectId(tid)) };
            const now = dependencies.now();
            const first = planMigration(await store.snapshot(), scope, store, now);
            const second = planMigration(await store.snapshot(), scope, store, now);
            if (first.fingerprint !== second.fingerprint) throw new Error('set_migrate_source_changed_during_plan');
            await fs.writeFile(reportPath, BSON.EJSON.stringify(second, { relaxed: false }), { mode: 0o600, flag: 'wx' });
            return { stage, ok: second.diagnostics.length === 0, reportPath, fingerprint: second.fingerprint, targets: second.mutations.length, participants: second.participants.length, diagnostics: second.diagnostics };
        }
        if (!plan) throw new Error('set_migrate_plan_missing');
        if (stage === 'apply') {
            await fs.appendFile(`${reportPath}.events.jsonl`, `${JSON.stringify({
                stage, phase: 'started', at: dependencies.now().toISOString(), database,
                fingerprint: plan.fingerprint, actor: options.actor,
            })}\n`, { mode: 0o600 });
        }
        const result = stage === 'apply' ? await applyMigration(store, plan, {
            fingerprint: options.fingerprint ?? '', confirm: options.confirm ?? '',
            backupConfirmed: options.backupConfirmed ?? '', serviceStopped: options.serviceStopped === true,
        }) : await verifyMigration(store, plan);
        const event = { stage, phase: 'complete', ok: true, at: dependencies.now().toISOString(), database, fingerprint: plan.fingerprint, actor: options.actor ?? null, result };
        await fs.appendFile(`${reportPath}.events.jsonl`, `${JSON.stringify(event)}\n`, { mode: 0o600 });
        return { ...event, reportPath };
    } finally {
        await store.close();
    }
}

export function register(cli: CAC, dependencies = defaults): void {
    cli.command('set:migrate <stage> <report>')
        .option('--uri <uri>', 'Explicit MongoDB URI including the database path')
        .option('--database <name>', 'Exact database name; must match URI and report')
        .option('--domain <id>', 'Domain included by the read-only plan')
        .option('--tids <ids>', 'Comma-separated exact legacy contest ids included by plan')
        .option('--fingerprint <sha256>', 'Exact plan fingerprint required by apply')
        .option('--confirm <token>', 'APPLY:set-migrate:<database>:<fingerprint>')
        .option('--backup-confirmed <sha256>', 'Plan fingerprint acknowledging full database and source collection backups')
        .option('--service-stopped', 'Acknowledge Hydro and judging writers are stopped')
        .option('--actor <uid>', 'Operator uid recorded in the apply audit')
        .action(async (stage: string, report: string, options: SetMigrateOptions) => {
            const result = await runSetMigrateCommand(stage, report, options, dependencies);
            process.stdout.write(`${JSON.stringify(result)}\n`);
            if (!result.ok) throw new Error('set_migrate_plan_has_diagnostics');
        });
}
