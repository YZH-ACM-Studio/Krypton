/**
 * CLI commands for krypton-userbind. Registered via hydrooj's `commands/`
 * convention — the loader picks up the default export.
 *
 *   hydrooj userbind:export <domainId>            (stdout JSON)
 *   hydrooj userbind:import <targetDomainId> [--conflict=error|skip|overwrite]
 *                                                 (stdin JSON)
 */
import { Logger } from '@hydrooj/utils';
import { userBindModel } from './model';

const logger = new Logger('userbind.cli');

export function registerCommands(ctx: any): void {
    // The hydrooj entry uses cac; we register via ctx.bus / ctx.command depending
    // on framework version. The pattern below matches existing CLI extensions.
    if (!ctx.cli) return;

    ctx.cli.command('userbind:export <domainId>')
        .option('--out <path>', 'Write JSON to file instead of stdout')
        .action(async (domainId: string, opts: { out?: string }) => {
            const pkg = await userBindModel.exportDomain(domainId);
            const json = JSON.stringify(pkg, null, 2);
            if (opts.out) {
                const fs = await import('node:fs/promises');
                await fs.writeFile(opts.out, json, 'utf-8');
                logger.success('wrote %d bytes to %s', json.length, opts.out);
            } else {
                process.stdout.write(json);
            }
        });

    ctx.cli.command('userbind:import <targetDomainId>')
        .option('--conflict <policy>', 'error | skip | overwrite (default: error)')
        .option('--in <path>', 'Read JSON from file instead of stdin')
        .action(async (targetDomainId: string, opts: { conflict?: string; in?: string }) => {
            const policy = (opts.conflict as any) || 'error';
            if (!['error', 'skip', 'overwrite'].includes(policy)) {
                logger.error('invalid --conflict policy: %s', policy);
                process.exit(2);
            }
            let raw: string;
            if (opts.in) {
                const fs = await import('node:fs/promises');
                raw = await fs.readFile(opts.in, 'utf-8');
            } else {
                raw = await new Promise<string>((resolve, reject) => {
                    let buf = '';
                    process.stdin.setEncoding('utf-8');
                    process.stdin.on('data', (chunk: string) => { buf += chunk; });
                    process.stdin.on('end', () => resolve(buf));
                    process.stdin.on('error', reject);
                });
            }
            const pkg = JSON.parse(raw);
            const report = await userBindModel.importDomain(targetDomainId, pkg as any, policy);
            logger.success('import report: %o', report);
            process.stdout.write(JSON.stringify(report, null, 2));
        });
}
