import childProcess from 'node:child_process';
import path from 'node:path';
import { expect } from 'chai';
import { describe, it } from 'node:test';

describe('krypton-permits top-level command bridge', () => {
    it('loads without an initialized Hydro runtime and registers the guarded commands', () => {
        const root = path.resolve(__dirname, '../../..');
        const script = `
            const names = [];
            const chain = { option() { return chain; }, action() { return chain; } };
            const bridge = require('./packages/krypton-permits/command.ts');
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
        expect(JSON.parse(result.stdout)).to.deep.equal([
            'permits:drift-report <domainId>',
            'permits:repair <kind> <domainId> <pid> [uid]',
        ]);
    });
});
