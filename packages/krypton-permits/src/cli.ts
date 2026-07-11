import { Logger } from '@hydrooj/utils';
import { permitsModel } from './model';
import { ACTIVE_WRITE_CLAIM_RECOVERY_CONFIRMATION } from './types';

const logger = new Logger('krypton-permits.cli');

function parsePositiveInt(value: string | number, field: string): number {
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${field} must be a positive integer`);
    return parsed;
}

export function registerCommands(ctx: any): void {
    let cli: any;
    try {
        cli = ctx.get?.('cli') ?? ctx.cli;
    } catch {
        cli = undefined;
    }
    if (!cli) return;

    cli.command('permits:drift-report <domainId>')
        .action(async (domainId: string) => {
            const report = await permitsModel.buildDriftReport(domainId);
            process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
        });

    cli.command('permits:repair <kind> <domainId> <pid> [uid]')
        .option('--requestId <requestId>', 'Required stable idempotency key')
        .option('--actor <uid>', 'Required operator uid')
        .option('--strategy <strategy>', 'Required repair strategy for legacy/source conflicts')
        .option(
            '--writeClaimCheck <token>',
            'For problem-write-claim: PARTIAL_WRITE_INSPECTED for ERROR, or '
            + `${ACTIVE_WRITE_CLAIM_RECOVERY_CONFIRMATION} for crash-left ACTIVE claims`,
        )
        .option('--confirm <token>', 'Must be exactly REPAIR_ACL')
        .action(async (
            kind: string,
            domainId: string,
            pidRaw: string,
            uidRaw: string | undefined,
            options: {
                requestId?: string;
                actor?: string;
                strategy?: string;
                writeClaimCheck?: string;
                confirm?: string;
            },
        ) => {
            if (options.confirm !== 'REPAIR_ACL') {
                throw new Error('repair refused: pass --confirm REPAIR_ACL after reviewing drift report');
            }
            if (!options.requestId?.trim()) throw new Error('--requestId is required');
            const pid = parsePositiveInt(pidRaw, 'pid');
            const actor = parsePositiveInt(options.actor || '', 'actor');
            const pairRepair = kind !== 'problem-write-claim';
            const uid = pairRepair ? parsePositiveInt(uidRaw || '', 'uid') : undefined;
            if (!pairRepair && uidRaw !== undefined) {
                throw new Error('uid must be omitted for problem-write-claim repair');
            }
            if (kind === 'legacy-without-canonical') {
                const strategy = options.strategy as 'grant-maintainer' | 'remove-legacy';
                if (!['grant-maintainer', 'remove-legacy'].includes(strategy)) {
                    throw new Error('--strategy must be grant-maintainer or remove-legacy');
                }
                await permitsModel.repairLegacyMaintainerWithoutCanonical(
                    domainId, pid, uid!, strategy, actor, options.requestId,
                );
            } else if (kind === 'canonical-without-legacy') {
                await permitsModel.repairCanonicalMaintainerWithoutLegacy(
                    domainId, pid, uid!, actor, options.requestId,
                );
            } else if (kind === 'verifier-in-legacy') {
                await permitsModel.repairVerifierInLegacy(
                    domainId, pid, uid!, actor, options.requestId,
                );
            } else if (kind === 'legacy-canonical-without-source') {
                if (options.strategy) {
                    throw new Error('legacy canonical source is derived from viaContest; do not pass --strategy');
                }
                await permitsModel.repairLegacyCanonicalWithoutSource(
                    domainId, pid, uid!, actor, options.requestId,
                );
            } else if (kind === 'source-canonical-conflict') {
                const strategy = options.strategy as 'reconcile-from-sources';
                if (strategy !== 'reconcile-from-sources') {
                    throw new Error('--strategy must be reconcile-from-sources');
                }
                await permitsModel.repairSourceCanonicalConflict(
                    domainId, pid, uid!, strategy, actor, options.requestId,
                );
            } else if (kind === 'orphan-problem-lock') {
                if (options.strategy) throw new Error('do not pass --strategy for orphan-problem-lock');
                await permitsModel.repairOrphanProblemLock(
                    domainId, pid, uid!, options.requestId,
                );
            } else if (kind === 'fence-without-problem-lock') {
                if (options.strategy) throw new Error('do not pass --strategy for fence-without-problem-lock');
                await permitsModel.repairFenceWithoutProblemLock(
                    domainId, pid, uid!, options.requestId,
                );
            } else if (kind === 'acl-mutation') {
                if (options.strategy) throw new Error('do not pass --strategy for acl-mutation');
                await permitsModel.repairAclMutation(
                    domainId, pid, uid!, options.requestId,
                );
            } else if (kind === 'problem-write-claim') {
                if (options.strategy) throw new Error('do not pass --strategy for problem-write-claim');
                if (options.writeClaimCheck === ACTIVE_WRITE_CLAIM_RECOVERY_CONFIRMATION) {
                    await permitsModel.recoverActiveProblemWriteClaim(
                        domainId, pid, options.requestId, options.writeClaimCheck,
                    );
                } else if (options.writeClaimCheck === 'PARTIAL_WRITE_INSPECTED') {
                    await permitsModel.repairErroredProblemWriteClaim(
                        domainId, pid, options.requestId,
                    );
                } else {
                    throw new Error(
                        'repair refused: manually inspect partial storage/metadata, then pass '
                        + '--writeClaimCheck PARTIAL_WRITE_INSPECTED for an ERROR claim; '
                        + `for an ACTIVE claim first quiesce the process, then pass --writeClaimCheck ${ACTIVE_WRITE_CLAIM_RECOVERY_CONFIRMATION}`,
                    );
                }
            } else {
                throw new Error(`unknown repair kind: ${kind}`);
            }
            const report = await permitsModel.buildDriftReport(domainId);
            logger.success(
                'repair completed requestId=%s domain=%s pid=%d uid=%s actor=%d',
                options.requestId, domainId, pid, uid ?? '-', actor,
            );
            process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
        });
}
