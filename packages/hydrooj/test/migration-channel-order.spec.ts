import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect } from 'chai';
import { describe, it } from 'node:test';

const Module = require('module');
const migrationPath = require.resolve('../src/service/migration.ts');
const originalLoad = Module._load;
const versions = new Map<string, number>();

Module._load = function load(request: string, parent: NodeModule, isMain: boolean) {
    if (request === '../context') return { Context: class {}, Service: class {} };
    if (request === '@hydrooj/utils') {
        return {
            Logger: class {
                info() {}
                success() {}
                warn() {}
            },
        };
    }
    if (request === '../model/system') {
        return {
            __esModule: true,
            default: {
                get: (key: string) => versions.get(key),
                set: async (key: string, value: number) => {
                    versions.set(key, value);
                },
            },
        };
    }
    return originalLoad.call(this, request, parent, isMain);
};

let MigrationService: typeof import('../src/service/migration').default;
try {
    delete require.cache[migrationPath];
    MigrationService = require(migrationPath).default;
} finally {
    Module._load = originalLoad;
}

describe('fresh-install migration channel order', () => {
    it('runs the built-in mindmap seed before the Hydro welcome problem bootstrap', async () => {
        versions.clear();
        const service = Object.create(MigrationService.prototype) as any;
        service.channels = {};
        service.called = false;
        const events: string[] = [];

        await service.registerChannel('mindmap', [
            async () => {
                events.push('mindmap-seed');
            },
        ]);
        await service.registerChannel('hydrooj', [
            async () => {
                events.push('welcome-problem');
            },
        ]);
        await service.doUpgrade();

        expect(events).to.deep.equal(['mindmap-seed', 'welcome-problem']);
        expect(versions.get('db.ver-mindmap')).to.equal(1);
        expect(versions.get('db.ver')).to.equal(1);
    });

    it('loads the built-in mindmap addon before registering and executing the core channel', () => {
        const loader = readFileSync(resolve(__dirname, '../src/loader.ts'), 'utf8');
        const worker = readFileSync(resolve(__dirname, '../src/entry/worker.ts'), 'utf8');

        expect(loader).to.include("path.resolve(__dirname, '..', '..', 'krypton-mindmap')");
        const addonLoad = worker.indexOf('await addon(pending, fail, ctx)');
        const coreRegistration = worker.indexOf("c.migration.registerChannel('hydrooj'");
        const upgrade = worker.indexOf('await c.migration.doUpgrade()');
        expect(addonLoad).to.be.greaterThan(-1);
        expect(coreRegistration).to.be.greaterThan(addonLoad);
        expect(upgrade).to.be.greaterThan(coreRegistration);
    });
});
