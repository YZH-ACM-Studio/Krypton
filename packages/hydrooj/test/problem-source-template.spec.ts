import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import type { SourceTemplateDefinition } from '@hydrooj/common';
import { ObjectId } from 'mongodb';
import type { PidNamespaceDoc } from '../src/model/problem-pid-namespace';

function mock(path: string, exports: unknown) {
    const filename = require.resolve(path);
    require.cache[filename] = { id: filename, filename, loaded: true, exports } as NodeModule;
}

type Entry = SourceTemplateDefinition & { revision: number };
let catalog: { _id: string; revision: number; templates: Entry[] } | null = null;
let references: Array<{
    _id?: string;
    domainId: string;
    docType: number;
    sourceMeta: { template: string; year?: number };
    hidden?: boolean;
    archivedAt?: Date;
    pidNamespaceId?: string;
    pid?: string;
    title?: string;
    tag?: string[];
}> = [];
let customNamespaces: Array<Partial<PidNamespaceDoc>> = [];
let rejectSourceCas = false;
const audits: Array<Record<string, unknown>> = [];
const documentCollection = {
    countDocuments: async (filter: Record<string, unknown>) =>
        references.filter(
            (row) => row.domainId === filter.domainId && row.docType === filter.docType && row.sourceMeta.template === filter['sourceMeta.template'],
        ).length,
    aggregate: (pipeline: Array<Record<string, Record<string, unknown>>>) => ({
        toArray: async () => {
            const counts = new Map<string, number>();
            const groupedNamespace = typeof pipeline[1].$group._id === 'object';
            for (const row of references.filter((entry) => entry.domainId === pipeline[0].$match.domainId && entry.docType === 10)) {
                const key = groupedNamespace
                    ? JSON.stringify({ template: row.sourceMeta.template, namespace: row.pidNamespaceId })
                    : row.sourceMeta.template;
                counts.set(key, (counts.get(key) || 0) + 1);
            }
            return [...counts].map(([key, count]) => ({ _id: groupedNamespace ? JSON.parse(key) : key, count }));
        },
    }),
    createIndex: async () => 'references',
    find: (filter: { domainId: string; pidNamespaceId: { $in: string[] } }) => ({
        sort: () => ({ toArray: async () => references.filter((row) => row.domainId === filter.domainId
            && row.docType === 10 && row.sourceMeta.template === 'self' && filter.pidNamespaceId.$in.includes(row.pidNamespaceId!)) }),
    }),
    updateOne: async (filter: { _id: string; sourceMeta: { template: string } }, update: { $set: { 'sourceMeta.template': string } }) => {
        const row = references.find((entry) => entry._id === filter._id && entry.sourceMeta.template === filter.sourceMeta.template);
        if (!row || rejectSourceCas) return { matchedCount: 0 };
        row.sourceMeta = { ...row.sourceMeta, template: update.$set['sourceMeta.template'] };
        return { matchedCount: 1 };
    },
};

mock('../src/service/db', {
    __esModule: true,
    default: {
        collection: (name: string) => {
            if (name === 'problem.source_templates') {
 return {
                    findOne: async ({ _id }: { _id: string }) => (catalog?._id === _id ? structuredClone(catalog) : null),
                    insertOne: async (value: NonNullable<typeof catalog>) => {
                        assert.equal(catalog, null);
                        catalog = structuredClone(value);
                    },
                    updateOne: async (
                        filter: { _id: string; revision: number },
                        update: { $set: { templates: Entry[] }; $inc: { revision: number } },
                    ) => {
                        if (!catalog || filter._id !== catalog._id || filter.revision !== catalog.revision) return { matchedCount: 0 };
                        catalog.templates = structuredClone(update.$set.templates);
                        catalog.revision += update.$inc.revision;
                        return { matchedCount: 1 };
                    },
                };
}
            if (name === 'problem.pid_namespaces') {
 return {
                findOne: async (filter: { domainId: string; namespaceId: string }) => customNamespaces.find((row) => row.domainId === filter.domainId
                    && row.namespaceId === filter.namespaceId) || null,
            };
}
            if (name === 'problem.pid_counters') return { findOne: async () => null };
            throw new Error(`Unexpected collection: ${name}`);
        },
    },
});
mock('../src/model/document', { TYPE_PROBLEM: 10, coll: documentCollection });
mock('../src/model/oplog', {
    add: async (entry: Record<string, unknown>) => {
        audits.push(entry);
        return new ObjectId();
    },
    coll: { updateOne: async () => ({ matchedCount: 1 }) },
});
Object.defineProperty(globalThis, 'Hydro', { value: { model: {} }, configurable: true });

const {
    MANAGED_SOURCE_TEMPLATES,
    normalizeSourceTemplateDefinition,
    normalizeManagedSourceMeta,
    deriveManagedSourceTags,
    formatManagedProblemPid,
    legacyImportSourceMeta,
} = require('../src/model/managed-problem-source') as typeof import('../src/model/managed-problem-source');
const store = require('../src/model/problem-source-template') as typeof import('../src/model/problem-source-template');
const { withPidNamespaceBoundary } = require('../src/model/problem-pid-namespace') as typeof import('../src/model/problem-pid-namespace');
const admin = { _id: 2, hasPriv: () => true, hasPerm: () => true };
const teacher = { ...admin, _id: 3, hasPriv: () => false };
const definition = (entry: Entry) => {
    const { id: _id, revision: _revision, ...value } = entry;
    return value;
};
const newDefinition = () => ({
    label: '教材例题',
    enabled: true,
    pidNamespaceId: 'builtin:self',
    fields: [],
    fixedTags: ['教材'],
    trainingAnchorTag: '教材',
});

beforeEach(() => {
    catalog = { _id: 'system', revision: 1, templates: structuredClone(MANAGED_SOURCE_TEMPLATES).map((entry) => ({ ...entry, revision: 1 })) };
    references = [];
    customNamespaces = [];
    rejectSourceCas = false;
    audits.length = 0;
});

describe('source template catalog', () => {
    it('requires administrator privileges before every mutation', async () => {
        for (const operation of ['create', 'update', 'delete'] as const) {
            await assert.rejects(
                store.mutateSourceTemplate({
                    domainId: 'system',
                    user: teacher,
                    operation,
                    id: 'self',
                    expectedRevision: 1,
                    definition: newDefinition(),
                }),
            );
        }
        assert.equal(catalog!.revision, 1);
        assert.equal(audits.length, 0);
    });

    it('creates a fieldless source in an existing namespace and shares its numbering rules', async () => {
        await store.mutateSourceTemplate({ domainId: 'system', user: admin, operation: 'create', definition: newDefinition() });
        const template = catalog!.templates.at(-1)!;
        const source = normalizeManagedSourceMeta({ template: template.id }, catalog!.templates);
        assert.deepEqual(source, { template: template.id });
        assert.deepEqual(deriveManagedSourceTags(source, catalog!.templates), ['教材']);
        assert.equal(formatManagedProblemPid(source, 5001, catalog!.templates), 'P5001');
        assert.equal(catalog!.templates[5].id, 'self');
        assert.equal(audits[0].type, 'problem.source-template.create');
    });

    it('counts hidden, archived and draft references while isolating domains', async () => {
        references = [
            { domainId: 'system', docType: 10, sourceMeta: { template: 'self' }, hidden: true },
            { domainId: 'system', docType: 10, sourceMeta: { template: 'self' }, archivedAt: new Date() },
            { domainId: 'other', docType: 10, sourceMeta: { template: 'self' } },
        ];
        assert.equal((await store.listSourceTemplateViews('system')).find((entry) => entry.id === 'self')?.references, 2);
        await assert.rejects(store.mutateSourceTemplate({ domainId: 'system', user: admin, operation: 'delete', id: 'self', expectedRevision: 1 }));
        const original = catalog!.templates.find((entry) => entry.id === 'self')!;
        for (const patch of [{ fields: [] }, { fixedTags: ['新标签'], trainingAnchorTag: '新标签' }, { pidNamespaceId: 'builtin:hdu' }]) {
            await assert.rejects(
                store.mutateSourceTemplate({
                    domainId: 'system',
                    user: admin,
                    operation: 'update',
                    id: 'self',
                    expectedRevision: 1,
                    definition: { ...definition(original), ...patch },
                }),
            );
        }
        await store.mutateSourceTemplate({
            domainId: 'system',
            user: admin,
            operation: 'update',
            id: 'self',
            expectedRevision: 1,
            definition: { ...definition(original), label: '校内出题', enabled: false },
        });
        await assert.rejects(store.getManagedSourceTemplate('system', 'self', true));
        const retained = await store.getManagedSourceTemplate('system', 'self');
        assert.equal(retained.label, '校内出题');
        assert.deepEqual(deriveManagedSourceTags({ template: 'self', year: 2026 }, [retained]), ['自命题', '2026自命题']);
        references = [];
        await store.mutateSourceTemplate({
            domainId: 'system',
            user: admin,
            operation: 'update',
            id: 'self',
            expectedRevision: 2,
            definition: newDefinition(),
        });
        await store.mutateSourceTemplate({ domainId: 'system', user: admin, operation: 'delete', id: 'self', expectedRevision: 3 });
        await assert.rejects(store.getManagedSourceTemplate('system', 'self'));
    });

    it('checks live references after a concurrent creator releases the shared boundary', async () => {
        let release!: () => void;
        let entered!: () => void;
        const ready = new Promise<void>((resolve) => {
            entered = resolve;
        });
        const creator = withPidNamespaceBoundary('system', 'source-templates', async () => {
            entered();
            await new Promise<void>((resolve) => {
                release = resolve;
            });
            references.push({ domainId: 'system', docType: 10, sourceMeta: { template: 'self' } });
        });
        await ready;
        let settled = false;
        const deletion = store.mutateSourceTemplate({ domainId: 'system', user: admin, operation: 'delete', id: 'self', expectedRevision: 1 })
            .then(() => {
                settled = true;
                return null;
            }, (error: unknown) => {
                settled = true;
                return error;
            });
        try {
            await new Promise<void>((resolve) => { setImmediate(resolve); });
            assert.equal(settled, false);
        } finally {
            release();
            await creator;
        }
        assert.ok(await deletion instanceof Error);
        assert.ok(await store.getManagedSourceTemplate('system', 'self'));
    });

    it('rejects stale revisions and retains entries in their original order', async () => {
        const entry = catalog!.templates[0];
        await store.mutateSourceTemplate({
            domainId: 'system',
            user: admin,
            operation: 'update',
            id: entry.id,
            expectedRevision: 1,
            definition: { ...definition(entry), label: '改名' },
        });
        assert.equal(catalog!.templates[0].id, entry.id);
        await assert.rejects(store.mutateSourceTemplate({ domainId: 'system', user: admin, operation: 'delete', id: entry.id, expectedRevision: 1 }));
    });

    it('initializes explicitly once and never recreates an intentionally empty catalog', async () => {
        catalog = null;
        await assert.rejects(store.listManagedSourceTemplates('system'));
        const plan = await store.initializeSourceTemplates('system');
        assert.equal(catalog, null);
        await assert.rejects(store.initializeSourceTemplates('system', 'wrong'));
        await store.initializeSourceTemplates('system', plan.fingerprint);
        for (const entry of await store.listManagedSourceTemplates('system')) {
            await store.mutateSourceTemplate({ domainId: 'system', user: admin, operation: 'delete', id: entry.id, expectedRevision: 1 });
        }
        assert.deepEqual(await store.listManagedSourceTemplates('system'), []);
        await assert.rejects(store.initializeSourceTemplates('system'));
    });

    it('initializes existing references without rewriting them and rejects mismatched namespace bindings', async () => {
        catalog = null;
        references = [{ domainId: 'system', docType: 10, sourceMeta: { template: 'self' }, pidNamespaceId: 'builtin:self' }];
        const before = structuredClone(references);
        const plan = await store.initializeSourceTemplates('system');
        await store.initializeSourceTemplates('system', plan.fingerprint);
        assert.deepEqual(references, before);
        catalog = null;
        references[0].pidNamespaceId = 'custom:old';
        await assert.rejects(store.initializeSourceTemplates('system'), /explicit reconciliation/);
        assert.equal(catalog, null);
    });

    it('imports only metadata supplied by the package entry point', () => {
        const original = MANAGED_SOURCE_TEMPLATES.find((entry) => entry.id === 'self')!;
        assert.deepEqual(legacyImportSourceMeta(original, 2026), { template: 'self', year: 2026 });
        const fieldless = normalizeSourceTemplateDefinition('self', newDefinition());
        assert.deepEqual(legacyImportSourceMeta(fieldless, 2026), { template: 'self' });
        assert.throws(() => legacyImportSourceMeta({ ...fieldless, fields: ['season'] }, 2026));
    });

    it('reconciles only explicitly approved custom self references and preserves every other problem field', async () => {
        catalog = null;
        const namespaceId = 'custom:6a643f2d00d47c478b2bf9e9';
        customNamespaces = [{ domainId: 'system', namespaceId, kind: 'custom', name: '操作系统', prefix: 'OS', start: 1001, counter: 1109, members: [] }];
        references = [
            { _id: 'target', domainId: 'system', docType: 10, sourceMeta: { template: 'self', year: 2026 }, pidNamespaceId: namespaceId,
                pid: 'OS1001', title: '保留标题', tag: ['自命题', '2026自命题'], hidden: true },
            { _id: 'builtin', domainId: 'system', docType: 10, sourceMeta: { template: 'self', year: 2026 }, pidNamespaceId: 'builtin:self' },
            { _id: 'other', domainId: 'other', docType: 10, sourceMeta: { template: 'self', year: 2026 }, pidNamespaceId: namespaceId },
        ];
        const before = structuredClone(references);
        await assert.rejects(store.initializeSourceTemplates('system'), /explicit reconciliation/);
        const plan = await store.initializeSourceTemplates('system', undefined, [namespaceId]);
        assert.equal(plan.templates, 10);
        assert.equal(plan.changes.length, 1);
        assert.deepEqual(references, before);
        references[0].title = '已变化';
        await assert.rejects(store.initializeSourceTemplates('system', plan.fingerprint, [namespaceId]), /fingerprint changed/);
        references[0].title = before[0].title;
        rejectSourceCas = true;
        await assert.rejects(store.initializeSourceTemplates('system', plan.fingerprint, [namespaceId]), /CAS failed/);
        assert.equal(catalog, null);
        assert.deepEqual(references, before);
        rejectSourceCas = false;
        await store.initializeSourceTemplates('system', plan.fingerprint, [namespaceId]);
        const template = (await store.listManagedSourceTemplates('system')).find((entry) => entry.pidNamespaceId === namespaceId)!;
        assert.equal(template.label, '操作系统');
        assert.deepEqual(deriveManagedSourceTags({ template: template.id, year: 2026 }, [template]), before[0].tag);
        before[0].sourceMeta.template = template.id;
        assert.deepEqual(references, before);
    });

    it('rejects missing, built-in or duplicate custom reconciliation targets before writes', async () => {
        catalog = null;
        for (const namespaces of [['custom:missing'], ['builtin:self'], ['custom:duplicate', 'custom:duplicate']]) {
            await assert.rejects(store.initializeSourceTemplates('system', undefined, namespaces));
            assert.equal(catalog, null);
        }
    });

    it('validates field dependencies, namespace stages and exact configuration keys', () => {
        for (const patch of [
            { extra: true },
            { fields: ['arbitrary'] },
            { yearTagSuffix: '教材' },
            { pidNamespaceId: 'builtin:cauc' },
            { pidNamespaceId: 'builtin:gplt', fields: ['year'] },
        ]) {
            assert.throws(() => normalizeSourceTemplateDefinition('new', { ...newDefinition(), ...patch }));
        }
        const value = normalizeSourceTemplateDefinition('new', { ...newDefinition(), fields: ['year'], yearTagSuffix: '教材' });
        assert.deepEqual(deriveManagedSourceTags({ template: 'new', year: 2026 }, [value]), ['教材', '2026教材']);
        assert.throws(() => normalizeManagedSourceMeta({ template: 'new', year: 1999 }, [value]));
        assert.throws(() => normalizeManagedSourceMeta({ template: 'unknown' }, [value]));
    });
});
