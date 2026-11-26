import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { BSON, ObjectId } from 'mongodb';
import type { SourceTemplateDefinition, SourceTemplateView } from '@hydrooj/common';
import { Logger } from '@hydrooj/utils';
import { localizedErrorText, PermissionError, ValidationError } from '../error';
import db from '../service/db';
import { PRIV } from './builtin';
import * as document from './document';
import * as oplog from './oplog';
import { MANAGED_SOURCE_TEMPLATES, normalizeSourceTemplateDefinition } from './managed-problem-source';
import { getPidNamespace, getPidNamespaceDefinition, withPidNamespaceBoundary, type PidNamespaceAclUser } from './problem-pid-namespace';

interface TemplateEntry extends SourceTemplateDefinition {
    revision: number;
}
interface Catalog {
    _id: string;
    revision: number;
    templates: TemplateEntry[];
    updatedAt: Date;
}

const catalogs = db.collection<Catalog>('problem.source_templates');
const logger = new Logger('problem-source-template');

async function readCatalog(domainId: string): Promise<Catalog> {
    const catalog = await catalogs.findOne({ _id: domainId });
    if (!catalog) throw new ValidationError('template', null, localizedErrorText`来源模板尚未初始化，请联系管理员`);
    if (
        !Number.isSafeInteger(catalog.revision) ||
        catalog.revision < 1 ||
        !Array.isArray(catalog.templates) ||
        new Set(catalog.templates.map((template) => template.id)).size !== catalog.templates.length
    ) {
        throw new TypeError(`Invalid source template catalog: ${domainId}`);
    }
    for (const { id, revision, ...definition } of catalog.templates) {
        if (!id || !Number.isSafeInteger(revision) || revision < 1) throw new TypeError(`Invalid source template revision: ${domainId}/${id}`);
        if (!isDeepStrictEqual({ id, ...definition }, normalizeSourceTemplateDefinition(id, definition))) {
            throw new TypeError(`Noncanonical source template: ${domainId}/${id}`);
        }
    }
    return catalog;
}

export async function listManagedSourceTemplates(domainId: string): Promise<TemplateEntry[]> {
    return (await readCatalog(domainId)).templates;
}

export async function getManagedSourceTemplate(domainId: string, id: string, forCreation = false): Promise<TemplateEntry> {
    const template = (await listManagedSourceTemplates(domainId)).find((entry) => entry.id === id);
    if (!template) throw new ValidationError('template', null, localizedErrorText`来源模板不存在，请刷新页面`);
    if (forCreation && !template.enabled) throw new ValidationError('template', null, localizedErrorText`来源模板已停用，不能用于新题`);
    return template;
}

export async function listSourceTemplateViews(domainId: string): Promise<SourceTemplateView[]> {
    const [templates, counts] = await Promise.all([
        listManagedSourceTemplates(domainId),
        document.coll
            .aggregate<{
                _id: string;
                count: number;
            }>([{ $match: { domainId, docType: document.TYPE_PROBLEM, 'sourceMeta.template': { $exists: true } } }, { $group: { _id: '$sourceMeta.template', count: { $sum: 1 } } }])
            .toArray(),
    ]);
    const references = new Map(counts.map((entry) => [entry._id, entry.count]));
    return templates.map((template) => ({ ...template, references: references.get(template.id) || 0 }));
}

export async function mutateSourceTemplate(input: {
    domainId: string;
    user: PidNamespaceAclUser;
    operation: 'create' | 'update' | 'delete';
    id?: string;
    expectedRevision?: number;
    definition?: unknown;
}): Promise<void> {
    if (!input.user.hasPriv(PRIV.PRIV_EDIT_SYSTEM)) throw new PermissionError(PRIV.PRIV_EDIT_SYSTEM);
    await withPidNamespaceBoundary(input.domainId, 'source-templates', async () => {
        const catalog = await readCatalog(input.domainId);
        const current = catalog.templates.find((template) => template.id === input.id);
        if (input.operation !== 'create' && (!current || current.revision !== input.expectedRevision)) {
            throw new ValidationError('expectedRevision', null, localizedErrorText`来源模板已变化，请刷新后重试`);
        }
        const id = current?.id || new ObjectId().toHexString();
        const references = current
            ? await document.coll.countDocuments({
                  domainId: input.domainId,
                  docType: document.TYPE_PROBLEM,
                  'sourceMeta.template': id,
              })
            : 0;
        let next: TemplateEntry | undefined;
        if (input.operation === 'delete') {
            if (references) throw new ValidationError('template', null, localizedErrorText`来源模板仍被 ${references} 道题引用，只能停用，不能删除`);
        } else {
            const definition = normalizeSourceTemplateDefinition(id, input.definition);
            if (references && current) {
                const { label: _oldLabel, enabled: _oldEnabled, revision: _revision, ...oldRules } = current;
                const { label: _label, enabled: _enabled, ...newRules } = definition;
                if (!isDeepStrictEqual(oldRules, newRules)) {
                    throw new ValidationError('template', null, localizedErrorText`来源模板已有题目引用，只能修改名称或启停状态`);
                }
            }
            const namespace = await getPidNamespace(input.domainId, definition.pidNamespaceId);
            if (!namespace) throw new ValidationError('pidNamespaceId', null, localizedErrorText`题号命名空间不存在`);
            next = { ...definition, revision: (current?.revision || 0) + 1 };
        }
        const auditId = await oplog.add({
            type: `problem.source-template.${input.operation}`,
            domainId: input.domainId,
            operator: input.user._id,
            templateId: id,
            before: current || null,
            after: next || null,
            result: 'attempt',
            time: new Date(),
        });
        let committed = false;
        try {
            const templates = catalog.templates.flatMap((template) => (template.id === id ? (next ? [next] : []) : [template]));
            if (!current && next) templates.push(next);
            const result = await catalogs.updateOne(
                { _id: input.domainId, revision: catalog.revision },
                {
                    $set: { templates, updatedAt: new Date() },
                    $inc: { revision: 1 },
                },
            );
            if (result.matchedCount !== 1) throw new ValidationError('expectedRevision', null, localizedErrorText`来源模板已变化，请刷新后重试`);
            committed = true;
            const audit = await oplog.coll.updateOne({ _id: auditId }, { $set: { result: 'success', completedAt: new Date() } });
            if (audit.matchedCount !== 1) throw new Error(`Source template audit missing: ${auditId}`);
            logger.info(
                'domain=%s template=%s actor=%d operation=%s references=%d result=success',
                input.domainId,
                id,
                input.user._id,
                input.operation,
                references,
            );
        } catch (error) {
            logger.error(
                'domain=%s template=%s actor=%d operation=%s committed=%s error=%o',
                input.domainId,
                id,
                input.user._id,
                input.operation,
                committed,
                error,
            );
            await oplog.coll.updateOne({ _id: auditId }, { $set: { result: committed ? 'incomplete' : 'rejected', completedAt: new Date() } });
            throw error;
        }
    });
}

/** Explicit offline initialization. Custom self references are reconciled only when named in the approved plan. */
export async function initializeSourceTemplates(domainId: string, expectedFingerprint?: string, reconcileCustomSelfNamespaces: string[] = []) {
    return withPidNamespaceBoundary(domainId, 'source-templates', async () => {
        if (await catalogs.findOne({ _id: domainId })) throw new ValidationError('template', null, localizedErrorText`来源模板已经初始化`);
        if (new Set(reconcileCustomSelfNamespaces).size !== reconcileCustomSelfNamespaces.length) {
            throw new Error('Duplicate custom self namespace in initialization plan');
        }
        const templates = MANAGED_SOURCE_TEMPLATES.map((template) => ({ ...template, revision: 1 }));
        const customTemplates = new Map<string, TemplateEntry>();
        for (const namespaceId of [...reconcileCustomSelfNamespaces].sort()) {
            const namespace = await getPidNamespaceDefinition(domainId, namespaceId);
            if (!namespace || namespace.kind !== 'custom') throw new Error(`Custom self namespace does not exist: ${domainId}/${namespaceId}`);
            const { id: _id, revision: _revision, ...self } = templates.find((template) => template.id === 'self')!;
            const template = {
                ...normalizeSourceTemplateDefinition(`self-${namespaceId.slice('custom:'.length)}`, {
                    ...self, label: namespace.name, pidNamespaceId: namespaceId,
                }),
                revision: 1,
            };
            templates.push(template);
            customTemplates.set(namespaceId, template);
        }
        const references = await document.coll
            .aggregate<{
                _id: { template: string; namespace: string };
                count: number;
            }>([{ $match: { domainId, docType: document.TYPE_PROBLEM, 'sourceMeta.template': { $exists: true } } }, { $group: { _id: { template: '$sourceMeta.template', namespace: '$pidNamespaceId' }, count: { $sum: 1 } } }, { $sort: { '_id.template': 1, '_id.namespace': 1 } }])
            .toArray();
        for (const row of references) {
            const template = MANAGED_SOURCE_TEMPLATES.find((entry) => entry.id === row._id.template);
            if (!template || (template.pidNamespaceId !== row._id.namespace
                && (row._id.template !== 'self' || !customTemplates.has(row._id.namespace)))) {
                throw new Error(`Source initialization requires explicit reconciliation: ${domainId}/${JSON.stringify(row)}`);
            }
        }
        const targets = customTemplates.size ? await document.coll.find({
            domainId, docType: document.TYPE_PROBLEM, 'sourceMeta.template': 'self',
            pidNamespaceId: { $in: [...customTemplates.keys()] },
        }).sort({ _id: 1 }).toArray() : [];
        const changes = targets.map((target) => ({
            documentId: target._id.toString(),
            template: customTemplates.get(target.pidNamespaceId)!.id,
            documentHash: createHash('sha256').update(BSON.EJSON.stringify(target, { relaxed: false })).digest('hex'),
        }));
        const fingerprint = createHash('sha256').update(JSON.stringify({ domainId, templates, references, changes })).digest('hex');
        if (expectedFingerprint !== undefined) {
            if (expectedFingerprint !== fingerprint) throw new Error('Source template initialization fingerprint changed');
            for (const target of targets) {
                const template = customTemplates.get(target.pidNamespaceId)!;
                const result = await document.coll.updateOne({
                    _id: target._id, domainId, docType: document.TYPE_PROBLEM,
                    pidNamespaceId: target.pidNamespaceId, sourceMeta: target.sourceMeta,
                }, { $set: { 'sourceMeta.template': template.id } });
                if (result.matchedCount !== 1) throw new Error(`Source initialization CAS failed: ${domainId}/${target._id}`);
                logger.info('domain=%s document=%s operation=reconcile-self template=%s', domainId, target._id, template.id);
            }
            await catalogs.insertOne({ _id: domainId, templates, revision: 1, updatedAt: new Date() });
            logger.info('domain=%s operation=initialize templates=%d reconciled=%d fingerprint=%s', domainId, templates.length, changes.length, fingerprint);
        }
        return { domainId, fingerprint, templates: templates.length, references, changes, applied: expectedFingerprint !== undefined };
    });
}

export async function apply() {
    await document.coll.createIndex({ domainId: 1, docType: 1, 'sourceMeta.template': 1 }, { name: 'problem_source_template_references' });
}
