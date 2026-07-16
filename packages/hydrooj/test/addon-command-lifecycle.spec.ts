import childProcess from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect } from 'chai';
import { after, before, describe, it } from 'node:test';

const root = path.resolve(__dirname, '..');
let home: string;

describe('top-level addon command lifecycle', () => {
    before(() => {
        home = fs.mkdtempSync(path.join(os.tmpdir(), 'hydro-addon-command-'));
        const addon = path.join(home, 'fixture-addon');
        fs.mkdirSync(path.join(home, '.hydro'), { recursive: true });
        fs.mkdirSync(addon);
        fs.writeFileSync(path.join(home, '.hydro', 'addon.json'), JSON.stringify([addon]));
        fs.writeFileSync(
            path.join(addon, 'command.js'),
            `
                function holdRuntimeOpen() {
                    process.env.HYDRO_ADDON_COMMAND_CONTEXT = 'true';
                    process.on('unhandledRejection', () => {});
                    setInterval(() => {}, 1000);
                }
                exports.register = (cli) => {
                    cli.command('fixture:success').action(async () => {
                        holdRuntimeOpen();
                        await new Promise((resolve) => setTimeout(resolve, 20));
                        process.stdout.write('fixture success\\n');
                    });
                    cli.command('fixture:failure').action(async () => {
                        holdRuntimeOpen();
                        await new Promise((resolve) => setTimeout(resolve, 20));
                        throw new Error('fixture failure');
                    });
                };
            `,
        );
    });

    after(() => fs.rmSync(home, { recursive: true, force: true }));

    function run(command: string) {
        return childProcess.spawnSync(process.execPath, [path.join(root, 'bin/hydrooj.js'), command], {
            cwd: root,
            env: { ...process.env, HOME: home },
            encoding: 'utf8',
            timeout: 3000,
        });
    }

    it('awaits a successful async addon action and exits zero despite live runtime handles', () => {
        const result = run('fixture:success');

        expect(result.error, result.stderr || result.stdout).to.equal(undefined);
        expect(result.status, result.stderr || result.stdout).to.equal(0);
        expect(result.stdout).to.include('fixture success');
    });

    it('prints a failed async addon action and exits non-zero without hanging', () => {
        const result = run('fixture:failure');

        expect(result.error, result.stderr || result.stdout).to.equal(undefined);
        expect(result.status).not.to.equal(0);
        expect(result.stderr).to.include('fixture failure');
    });
});
