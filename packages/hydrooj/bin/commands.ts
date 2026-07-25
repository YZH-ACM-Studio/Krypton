import cac from 'cac';
import { getAddons } from '../src/options';

const argv = cac().parse(process.argv, { run: false });

async function main() {
    if (!argv.args[0] || argv.args[0] === 'cli') {
        const hydro = require('../src/loader');
        await (argv.args[0] === 'cli' ? hydro.loadCli : hydro.load)();
        return;
    }

    const cli = cac();
    require('../src/commands/install').register(cli);
    require('../src/commands/addon').register(cli);
    require('../src/commands/db').register(cli);
    require('../src/commands/patch').register(cli);
    require('../src/commands/diagnosis').register(cli);
    require('../src/commands/problem-batch-import').register(cli);
    require('../src/commands/problem-tag-backfill').register(cli);
    require('../src/commands/mindmap-migrate-multi').register(cli);
    require('../src/commands/function-3049-migration').register(cli);
    require('../src/commands/problem-pid-namespace-migration').register(cli);
    cli.help();
    cli.parse(process.argv, { run: false });
    if (!cli.matchedCommand) {
        const addons = getAddons();
        for (const i of addons) {
            try {
                require(`${i}/command.ts`).register(cli);
            } catch (e) {
                try {
                    require(`${i}/command.js`).register(cli);
                } catch (err) {}
            }
        }
        cli.parse(process.argv, { run: false });
        if (!cli.matchedCommand) {
            console.log('Unknown command.');
            cli.outputHelp();
            return;
        }
    }

    await cli.runMatchedCommand();
    if (process.env.HYDRO_ADDON_COMMAND_CONTEXT === 'true') {
        await new Promise<void>((resolve, reject) =>
            process.stdout.write('', (error) => {
                if (error) reject(error);
                else resolve();
            }),
        );
        process.exit(0);
    }
}

main().catch((error) => {
    const message = error instanceof Error ? error.stack || error.message : String(error);
    process.stderr.write(`${message}\n`, () => process.exit(1));
});
