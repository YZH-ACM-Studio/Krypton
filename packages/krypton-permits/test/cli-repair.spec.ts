import { expect } from 'chai';
import { describe, it } from 'node:test';

const Module = require('module');
const calls = {
    orphan: [] as any[],
    fenceWithoutLock: [] as any[],
    writeClaim: [] as any[],
    activeWriteClaim: [] as any[],
    aclMutation: [] as any[],
};
const permitsModel = new Proxy(
    {
        async buildDriftReport(domainId: string) {
            return { domainId };
        },
        async repairOrphanProblemLock(...args: any[]) {
            calls.orphan.push(args);
        },
        async repairFenceWithoutProblemLock(...args: any[]) {
            calls.fenceWithoutLock.push(args);
        },
        async repairErroredProblemWriteClaim(...args: any[]) {
            calls.writeClaim.push(args);
        },
        async recoverActiveProblemWriteClaim(...args: any[]) {
            calls.activeWriteClaim.push(args);
        },
        async repairAclMutation(...args: any[]) {
            calls.aclMutation.push(args);
        },
    },
    {
        get(target, key: string) {
            return target[key] || (async () => undefined);
        },
    },
);

const modelPath = require.resolve('../src/model.ts');
const cliPath = require.resolve('../src/cli.ts');
const previousModel = require.cache[modelPath];
const originalLoad = Module._load;
require.cache[modelPath] = {
    id: modelPath,
    filename: modelPath,
    loaded: true,
    exports: { permitsModel },
} as NodeModule;
Module._load = function load(request: string, parent: NodeModule, isMain: boolean) {
    if (request === '@hydrooj/utils') {
        return {
            Logger: class Logger {
                success() {}
            },
        };
    }
    return originalLoad.call(this, request, parent, isMain);
};

let registerCommands: typeof import('../src/cli').registerCommands;
try {
    delete require.cache[cliPath];
    ({ registerCommands } = require(cliPath));
} finally {
    Module._load = originalLoad;
    if (previousModel) require.cache[modelPath] = previousModel;
    else delete require.cache[modelPath];
}

function getRepairAction() {
    let action: any;
    const chain: any = {
        option() {
            return chain;
        },
        action(callback: any) {
            action = callback;
            return chain;
        },
    };
    registerCommands({
        cli: {
            command(name: string) {
                if (name.startsWith('permits:repair ')) return chain;
                return {
                    ...chain,
                    action() {
                        return chain;
                    },
                };
            },
        },
    });
    return action;
}

async function capture(run: () => Promise<unknown>) {
    try {
        await run();
        return null;
    } catch (error) {
        return error as Error;
    }
}

describe('ACL repair CLI', () => {
    it('requires explicit partial storage/metadata inspection before repairing an ERROR write claim', async () => {
        const action = getRepairAction();
        const base = {
            requestId: 'claim-1',
            actor: '7',
            confirm: 'REPAIR_ACL',
        };

        const refused = await capture(() => action('problem-write-claim', 'system', '12', undefined, base));
        expect(refused?.message).to.contain('manually inspect partial storage/metadata');
        expect(calls.writeClaim).to.deep.equal([]);

        await action('problem-write-claim', 'system', '12', undefined, {
            ...base,
            writeClaimCheck: 'PARTIAL_WRITE_INSPECTED',
        });
        expect(calls.writeClaim).to.deep.equal([['system', 12, 'claim-1']]);
    });

    it('keeps the ERROR token compatible and routes only the process-quiesced token to ACTIVE recovery', async () => {
        const action = getRepairAction();
        const base = {
            requestId: 'claim-active',
            actor: '7',
            confirm: 'REPAIR_ACL',
        };
        const errorRepairsBefore = calls.writeClaim.length;

        await action('problem-write-claim', 'system', '15', undefined, {
            ...base,
            writeClaimCheck: 'PARTIAL_WRITE_INSPECTED',
        });
        expect(calls.writeClaim.slice(errorRepairsBefore)).to.deep.equal([['system', 15, 'claim-active']]);
        expect(calls.activeWriteClaim).to.deep.equal([]);

        await action('problem-write-claim', 'system', '15', undefined, {
            ...base,
            writeClaimCheck: 'PROCESS_QUIESCED_AND_PARTIAL_WRITE_INSPECTED',
        });
        expect(calls.activeWriteClaim).to.deep.equal([['system', 15, 'claim-active', 'PROCESS_QUIESCED_AND_PARTIAL_WRITE_INSPECTED']]);
    });

    it('repairs an orphan lock only through the pair-scoped exact requestId entrypoint', async () => {
        const action = getRepairAction();
        await action('orphan-problem-lock', 'system', '13', '99', {
            requestId: 'orphan-13',
            actor: '7',
            confirm: 'REPAIR_ACL',
        });

        expect(calls.orphan).to.deep.equal([['system', 13, 99, 'orphan-13']]);
    });

    it('repairs a fence without a ProblemDoc lock through its exact requestId entrypoint', async () => {
        const action = getRepairAction();
        await action('fence-without-problem-lock', 'system', '14', '100', {
            requestId: 'fence-14',
            actor: '7',
            confirm: 'REPAIR_ACL',
        });

        expect(calls.fenceWithoutLock).to.deep.equal([['system', 14, 100, 'fence-14']]);
    });

    it('repairs an ACL mutation only through its pair-scoped exact requestId entrypoint', async () => {
        const action = getRepairAction();
        await action('acl-mutation', 'system', '16', '101', {
            requestId: 'acl-16',
            actor: '7',
            confirm: 'REPAIR_ACL',
        });

        expect(calls.aclMutation).to.deep.equal([['system', 16, 101, 'acl-16']]);
    });
});
