import childProcess from 'node:child_process';
import path from 'node:path';
import { expect } from 'chai';
import { describe, it } from 'node:test';
import {
    dispatchHydroCliTick,
    isHydroCliCampusNetTick,
    listPositionalArgv,
    parseCampusNetTickArgv,
    register,
} from '../src/cli';

const root = path.resolve(__dirname, '../../..');
const addonDir = path.resolve(__dirname, '..');

function discoverAddonCommands(addonPaths: string[]): string[] {
    const names: string[] = [];
    const chain = {
        option() {
            return chain;
        },
        action() {
            return chain;
        },
    };
    const cli = {
        command(name: string) {
            names.push(name);
            return chain;
        },
    };
    for (const addon of addonPaths) {
        try {
            require(`${addon}/command.ts`).register(cli);
        } catch {
            try {
                require(`${addon}/command.js`).register(cli);
            } catch {
                /* same swallow as hydrooj/bin/commands.ts */
            }
        }
    }
    return names;
}

describe('krypton-campus-net top-level command bridge', () => {
    it('loads command.ts without an initialized Hydro runtime and registers campus-net:tick', () => {
        const script = `
            const names = [];
            const chain = { option() { return chain; }, action() { return chain; } };
            const bridge = require('./packages/krypton-campus-net/command.ts');
            bridge.register({ command(name) { names.push(name); return chain; } });
            process.stdout.write(JSON.stringify(names));
            process.exit(0);
        `;
        const result = childProcess.spawnSync(process.execPath, ['-r', '@hydrooj/register', '-e', script], {
            cwd: root,
            encoding: 'utf8',
            timeout: 5000,
        });

        expect(result.status, result.stderr || result.stdout).to.equal(0);
        expect(JSON.parse(result.stdout)).to.deep.equal(['campus-net:tick']);
    });

    it('is found by the same getAddons() command.ts loop hydrooj/bin/commands.ts uses', () => {
        expect(discoverAddonCommands([])).to.deep.equal([]);
        expect(discoverAddonCommands([addonDir])).to.deep.equal(['campus-net:tick']);
        register({
            command(name: string) {
                expect(name).to.equal('campus-net:tick');
                return {
                    option() {
                        return this;
                    },
                    action() {
                        return this;
                    },
                };
            },
        });
    });

    it('lets hydrooj.js command discovery match campus-net:tick when getAddons() lists this package', () => {
        const home = childProcess.execSync('mktemp -d', { encoding: 'utf8' }).trim();
        const script = `
            const fs = require('fs');
            const os = require('os');
            const path = require('path');
            const cac = require('cac').default || require('cac');
            const home = process.env.HOME;
            fs.mkdirSync(path.join(home, '.hydro'), { recursive: true });
            fs.writeFileSync(path.join(home, '.hydro', 'addon.json'), JSON.stringify([${JSON.stringify(addonDir)}]));
            const { getAddons } = require('./packages/hydrooj/src/options');
            const cli = cac();
            for (const i of getAddons()) {
                try { require(i + '/command.ts').register(cli); }
                catch (e) {
                    try { require(i + '/command.js').register(cli); } catch (err) {}
                }
            }
            cli.parse(['node', 'hydrooj.js', 'campus-net:tick'], { run: false });
            process.stdout.write(JSON.stringify({
                addons: getAddons(),
                homedir: os.homedir(),
                matched: cli.matchedCommand ? cli.matchedCommand.name : null,
            }));
            process.exit(0);
        `;
        try {
            const result = childProcess.spawnSync(process.execPath, ['-r', '@hydrooj/register', '-e', script], {
                cwd: root,
                env: { ...process.env, HOME: home },
                encoding: 'utf8',
                timeout: 10000,
            });
            expect(result.status, result.stderr || result.stdout).to.equal(0);
            const payload = JSON.parse(result.stdout);
            expect(payload.homedir).to.equal(home);
            expect(payload.addons).to.deep.equal([addonDir]);
            expect(payload.matched).to.equal('campus-net:tick');
        } finally {
            childProcess.execSync(`rm -rf '${home}'`);
        }
    });

    it('does not discover campus-net:tick from getAddons() when only builtin-style addon.json is present', () => {
        const home = childProcess.execSync('mktemp -d', { encoding: 'utf8' }).trim();
        const script = `
            const fs = require('fs');
            const path = require('path');
            const cac = require('cac').default || require('cac');
            fs.mkdirSync(path.join(process.env.HOME, '.hydro'), { recursive: true });
            fs.writeFileSync(
                path.join(process.env.HOME, '.hydro', 'addon.json'),
                JSON.stringify(['@hydrooj/ui-default', '@hydrooj/hydrojudge']),
            );
            const { getAddons } = require('./packages/hydrooj/src/options');
            const cli = cac();
            for (const i of getAddons()) {
                try { require(i + '/command.ts').register(cli); }
                catch (e) {
                    try { require(i + '/command.js').register(cli); } catch (err) {}
                }
            }
            cli.parse(['node', 'hydrooj.js', 'campus-net:tick'], { run: false });
            process.stdout.write(JSON.stringify({
                addons: getAddons(),
                matched: cli.matchedCommand ? cli.matchedCommand.name : null,
            }));
            process.exit(0);
        `;
        try {
            const result = childProcess.spawnSync(process.execPath, ['-r', '@hydrooj/register', '-e', script], {
                cwd: root,
                env: { ...process.env, HOME: home },
                encoding: 'utf8',
                timeout: 10000,
            });
            expect(result.status, result.stderr || result.stdout).to.equal(0);
            const payload = JSON.parse(result.stdout);
            expect(payload.addons).to.deep.equal(['@hydrooj/ui-default', '@hydrooj/hydrojudge']);
            expect(payload.matched).to.equal(null);
        } finally {
            childProcess.execSync(`rm -rf '${home}'`);
        }
    });
});

describe('hydrooj cli campus-net:tick dispatch', () => {
    it('matches only loadCli argv, not addon-command-context or bare campus-net:tick', () => {
        const cliArgv = ['node', 'hydrooj.js', 'cli', 'campus-net:tick'];
        expect(isHydroCliCampusNetTick(cliArgv, { HYDRO_CLI: 'true' })).to.equal(true);
        expect(
            isHydroCliCampusNetTick(cliArgv, { HYDRO_CLI: 'true', HYDRO_ADDON_COMMAND_CONTEXT: 'true' }),
        ).to.equal(false);
        expect(isHydroCliCampusNetTick(['node', 'hydrooj.js', 'campus-net:tick'], { HYDRO_CLI: 'true' })).to.equal(
            false,
        );
        expect(isHydroCliCampusNetTick(cliArgv, {})).to.equal(false);
        expect(listPositionalArgv(['node', 'hydrooj.js', 'cli', '--env-file', '/tmp/x', 'campus-net:tick'])).to.deep.equal(
            ['cli', 'campus-net:tick'],
        );
        expect(
            parseCampusNetTickArgv([
                'node',
                'hydrooj.js',
                'cli',
                'campus-net:tick',
                '--env-file',
                '/tmp/env',
                '--state-file=/tmp/state',
            ]),
        ).to.deep.equal({ envFile: '/tmp/env', stateFile: '/tmp/state' });
    });

    it('runs the tick and exits zero for hydrooj cli campus-net:tick', async () => {
        const exits: number[] = [];
        const stdout: string[] = [];
        let ran = 0;
        const handled = await dispatchHydroCliTick({
            argv: ['node', 'hydrooj.js', 'cli', 'campus-net:tick', '--env-file', '/tmp/campus-net.env'],
            env: { HYDRO_CLI: 'true' },
            async runTick(options) {
                ran += 1;
                expect(options).to.deep.equal({ envFile: '/tmp/campus-net.env' });
                return {
                    connectivity: 'up',
                    previousConnectivity: 'unknown',
                    probeDetail: 'http 200 status OK',
                    dialAttempted: false,
                    dialOk: null,
                    dialDetail: null,
                    notified: [],
                };
            },
            writeStdout(chunk) {
                stdout.push(chunk);
            },
            exitProcess(code) {
                exits.push(code);
            },
        });
        expect(handled).to.equal(true);
        expect(ran).to.equal(1);
        expect(exits).to.deep.equal([0]);
        expect(JSON.parse(stdout.join(''))).to.include({ connectivity: 'up' });
    });

    it('exits non-zero when the loaded-runtime tick fails', async () => {
        const exits: number[] = [];
        const stderr: string[] = [];
        const handled = await dispatchHydroCliTick({
            argv: ['node', 'hydrooj.js', 'cli', 'campus-net:tick'],
            env: { HYDRO_CLI: 'true' },
            async runTick() {
                throw new Error('tick exploded');
            },
            writeStderr(chunk) {
                stderr.push(chunk);
            },
            exitProcess(code) {
                exits.push(code);
            },
        });
        expect(handled).to.equal(true);
        expect(exits).to.deep.equal([1]);
        expect(stderr.join('')).to.include('tick exploded');
    });

    it('does not dispatch during ordinary apply', async () => {
        const handled = await dispatchHydroCliTick({
            argv: ['node', 'test'],
            env: {},
            async runTick() {
                throw new Error('must not run');
            },
            exitProcess() {
                throw new Error('must not exit');
            },
        });
        expect(handled).to.equal(false);
    });
});
