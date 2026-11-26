import { equal, rejects } from 'node:assert/strict';
import { it } from 'node:test';
import { createDraftConfig, DEFAULT_RAPID_PASS_RULE, PERM, PRIV } from '@hydrooj/common';
import { ObjectId } from 'mongodb';

it('restricts both rapid pass operations to the set manager with roster access in the current domain', async () => {
    const tid = new ObjectId();
    const doc = { docId: tid, owner: 7, docType: 30, rule: 'exam', setConfig: createDraftConfig('exam') };
    const Module = require('node:module');
    const original = Module._load;
    const host = globalThis as unknown as { Hydro?: { model: Record<string, unknown> } };
    host.Hydro ||= { model: {} };
    const rules: string[] = [];
    let writes = 0;
    let reads = 0;
    const route = require.resolve('../src/handler/teach-rapid-pass');
    const access = require.resolve('../src/lib/teach-access');
    // Only replace I/O. The route and its parent container authorization run normally.
    Module._load = (name: string, parent: NodeModule, main: boolean) => {
        if (parent?.filename === access && name === '../model/training') return {};
        if (parent?.filename === access && name === '../model/contest') {
            return {
                RULES: { exam: {}, contest: {} },
                get: async (domain: string) => {
                    rules.push(domain);
                    return doc;
                },
            };
        }
        if (parent?.filename === route) {
            if (name === '../model/document') return { TYPE_CONTEST: 30 };
            if (name === '../service/db') return {};
            if (name === '../service/server') return { Handler: class {}, Types: {}, param: () => () => {} };
            if (name === '../lib/teach-rapid-pass') {
                return {
                    loadRapidPassPolicy: async () => { reads++; return { rule: DEFAULT_RAPID_PASS_RULE, revision: 1 }; },
                    loadRapidPassEvidence: async () => ({}),
                    writeRapidPassPolicy: async () => { writes++; return true; },
                };
            }
        }
        return original.call(Module, name, parent, main);
    };
    let HandlerClass;
    try {
        require(route).apply({ Route: (_name, _path, handler, priv) => {
            equal(priv, PRIV.PRIV_USER_PROFILE);
            HandlerClass = handler;
        }, on() {} });
    } finally {
        Module._load = original;
    }
    const handler = (uid: number, perms: bigint[]) => Object.assign(new HandlerClass(), {
        domain: { _id: 'school' }, request: { body: { revision: 1, rule: DEFAULT_RAPID_PASS_RULE } }, response: {},
        user: { _id: uid, hasPriv: () => false, hasPerm: (perm: bigint) => perms.includes(perm), own: () => doc.owner === uid },
    });
    for (const forbidden of [handler(9, []), handler(9, [PERM.PERM_USERBIND_MANAGE_STUDENTS]), handler(7, [PERM.PERM_EDIT_CONTEST_SELF])]) {
        await rejects(forbidden.get({ domainId: 'another' }, 'exam', tid), { name: 'PermissionError' });
        await rejects(forbidden.post({ domainId: 'another' }, 'exam', tid), { name: 'PermissionError' });
    }
    equal(reads, 0);
    equal(writes, 0);
    const teacher = handler(7, [PERM.PERM_EDIT_CONTEST_SELF, PERM.PERM_USERBIND_MANAGE_STUDENTS]);
    await teacher.get({}, 'exam', tid);
    await teacher.post({}, 'exam', tid);
    equal(writes, 1);
    equal(reads, 2);
    equal(rules.every((domain) => domain === 'school'), true);
    doc.rule = 'contest';
    doc.setConfig = createDraftConfig('contest');
    await rejects(teacher.get({}, 'exam', tid), { name: 'NotFoundError' });
    await rejects(teacher.post({}, 'practice', tid), { name: 'NotFoundError' });
    equal(writes, 1);
    equal(reads, 2);
});
