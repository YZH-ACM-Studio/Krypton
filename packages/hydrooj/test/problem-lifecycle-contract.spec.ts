import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect } from 'chai';
import { describe, it } from 'node:test';

const root = resolve(__dirname, '..');

describe('P2.12 YAGNI lifecycle contract', () => {
    it('does not reintroduce recovery, lease, reconciler, or schedule subsystems', () => {
        for (const name of [
            'problem-clone',
            'problem-delete',
            'problem-file-recovery',
            'problem-mutation',
            'problem-recovery-owner',
            'problem-reference-barrier',
            'problem-reference-reconciler',
            'problem-schedule',
        ]) {
            expect(existsSync(resolve(root, `src/model/${name}.ts`)), name).to.equal(false);
        }
    });

    it('ready-gates every problem and locks revision-managed submissions before insertion', () => {
        const source = readFileSync(resolve(root, 'src/model/record.ts'), 'utf8');
        const lock = source.indexOf("claimStructureLockForSubmission(domainId, pid, args.type !== 'generate', uid)");
        const insert = source.indexOf('RecordModel.coll.insertOne(data)');
        expect(lock).to.be.greaterThan(-1);
        expect(insert).to.be.greaterThan(lock);
    });

    it('passes the private raw objective config to the judge without exposing it through page reads', () => {
        const source = readFileSync(resolve(root, 'src/model/record.ts'), 'utf8');
        expect(source).to.include('problem.get(domainId, group[0].pid, undefined, true)');
        expect(source).to.match(/const judgeConfig\s*=\s*parseProblemConfigObject\(pdoc\)/);
        expect(source).to.include('...judgeConfig');
    });

    it('forces new problems to be hidden and explicitly typed', () => {
        const source = readFileSync(resolve(root, 'src/model/problem.ts'), 'utf8');
        expect(source).to.include('const problemKind = parseProblemKind(meta?.problemKind)');
        expect(source).to.include('hidden: true');
        expect(source).to.include("if (args.hidden !== true) throw new ValidationError('hidden'");
        expect(source).to.include('structureRevision: 1');
    });

    it('offers an explicit observer-waiting path for audited one-time metadata migrations', () => {
        const source = readFileSync(resolve(root, 'src/model/problem.ts'), 'utf8');
        expect(source).to.include('waitForObservers?: boolean');
        expect(source).to.include("if (options.waitForObservers) await bus.parallel('problem/edit', result");
        expect(source).to.include("else bus.emit('problem/edit', result");
        expect(source).to.include('{ hidden: current.hidden }');
    });

    it('propagates cli execute failures to the process-level non-zero exit handler', () => {
        const source = readFileSync(resolve(root, 'src/entry/cli.ts'), 'utf8');
        const executeStart = source.indexOf("if (modelName === 'execute')");
        const executeEnd = source.indexOf("if (modelName === 'script')", executeStart);
        const execute = source.slice(executeStart, executeEnd);
        expect(execute).to.include('return console.log(await res())');
        expect(execute).not.to.include('catch');
    });

    it('retains and confirms the exact managed draft identity before insert responses or post-create events can fail', () => {
        const source = readFileSync(resolve(root, 'src/model/problem.ts'), 'utf8');
        const createStart = source.indexOf('static async createManagedProgrammingDraft');
        const createEnd = source.indexOf('static async publishManagedProgrammingProblem', createStart);
        const managedCreate = source.slice(createStart, createEnd);
        expect(source).to.include('completePersistedProblemCreate(');
        expect(managedCreate).to.include('onAllocated: (allocatedDocId, allocatedDocumentId) =>');
        expect(managedCreate).to.include('documentId = allocatedDocumentId');
        expect(managedCreate).to.include('onPersisted: (persistedDocId) =>');
        expect(managedCreate).to.include('docId = persistedDocId');
        expect(managedCreate).to.include('_id: documentId');
        expect(managedCreate.indexOf('_id: documentId')).to.be.lessThan(managedCreate.indexOf('cleanupManagedDraftCreation'));
        expect(managedCreate.indexOf('if (!persisted) throw error')).to.be.lessThan(managedCreate.indexOf('cleanupManagedDraftCreation'));
        expect(managedCreate).to.include('authorAssignmentClaim = await ProblemModel.beginAuthorizedWriteClaim(');
        expect(managedCreate).not.to.include('await ProblemModel.withAuthorizedWriteClaim(');
        expect(managedCreate).to.include('authorAssignmentClaimRequestId = `problem-write:managed-draft-author-assignment:');
        expect(managedCreate.indexOf('authorAssignmentClaimRequestId = `problem-write:managed-draft-author-assignment:')).to.be.lessThan(
            managedCreate.indexOf('authorAssignmentClaim = await ProblemModel.beginAuthorizedWriteClaim('),
        );
        expect(managedCreate).to.include('requestId: authorAssignmentClaimRequestId');
        expect(managedCreate).to.include('writeClaimRequestId: authorAssignmentClaimRequestId');
        expect(managedCreate).to.include('await ProblemModel.deleteProblemDocumentUnchecked(domainId, docId, {');
        expect(managedCreate).to.include('documentId,');
        expect(managedCreate).to.include('publicPid,');
        expect(managedCreate).to.include('owner: creator,');
    });

    it('deletes only the exact failed managed draft before touching docId-scoped peripherals', () => {
        const source = readFileSync(resolve(root, 'src/model/problem.ts'), 'utf8');
        const start = source.indexOf('private static async deleteProblemDocumentUnchecked');
        const end = source.indexOf('static async del(', start);
        const cleanup = source.slice(start, end);
        const exactDelete = cleanup.indexOf('const deleted = await document.coll.deleteOne({');
        const identityCheck = cleanup.indexOf('if (deleted.deletedCount !== 1)');
        const statusDelete = cleanup.indexOf('document.deleteMultiStatus(', exactDelete);
        const storageDelete = cleanup.indexOf('.list(`problem/', exactDelete);
        const deleteEvent = cleanup.indexOf("bus.parallel('problem/delete', domainId, docId)", exactDelete);

        expect(cleanup).to.include('_id: context.documentId');
        expect(cleanup).to.include('pid: context.publicPid');
        expect(cleanup).to.include('owner: context.owner');
        expect(cleanup).to.include("authoringMode: 'managed'");
        expect(exactDelete).to.be.greaterThan(-1);
        expect(identityCheck).to.be.greaterThan(exactDelete);
        for (const peripheral of [statusDelete, storageDelete, deleteEvent]) {
            expect(peripheral).to.be.greaterThan(identityCheck);
        }
    });

    it('logs managed validation context at both create and publish service boundaries', () => {
        const source = readFileSync(resolve(root, 'src/model/problem.ts'), 'utf8');
        const createStart = source.indexOf('static async createManagedProgrammingDraft');
        const publishStart = source.indexOf('static async publishManagedProgrammingProblem', createStart);
        const create = source.slice(createStart, publishStart);
        const publishEnd = source.indexOf('static createProblemByKind', publishStart);
        const publish = source.slice(publishStart, publishEnd);

        expect(create).to.include('prepared = await prepareManagedProblemDraft(domainId, input)');
        expect(create).to.include('domain=%s actor=%d template=%o training=%o chapter=%o stage=create-validate error=%o');
        expect(publish).to.include('prepared = await prepareManagedProblemPublication(input.domainId, pdoc)');
        expect(publish).to.include('domain=%s pid=%d publicPid=%s actor=%d template=%o training=%o chapter=%o stage=publish-validate error=%o');
    });

    it('keeps archived problems hidden and preserves HTML when cloning', () => {
        const source = readFileSync(resolve(root, 'src/model/problem.ts'), 'utf8');
        expect(source.match(/current\.archivedAt && publishes/g)).to.have.length(2);
        expect(source).to.include("$set.hidden === false || Object.keys($unset).some((field) => field === 'hidden'");
        expect(source).to.include('html: !!original.html');
    });

    it('limits structured testdata writes to compile program-fill and function problems', () => {
        const source = readFileSync(resolve(root, 'src/model/problem.ts'), 'utf8');
        expect(source).to.include('domainId, pid, true, [name]');
        expect(source).to.include('domainId, pid, true, [file, newName]');
        expect(source).to.include('domainId, pid, true, names');
        expect(source).to.include("key === 'data' && doc.problemKind !== undefined");
        expect(source).to.include('structuredProblemUsesTestdata(problemKind, pdoc.config)');
        expect(source).to.include('structuredProblemUsesTestdata(kind, doc.config)');
    });

    it('keeps clone data physical and fails with the exact file name', () => {
        const source = readFileSync(resolve(root, 'src/model/problem.ts'), 'utf8');
        const cloneHelper = readFileSync(resolve(root, 'src/lib/problem-clone.ts'), 'utf8');
        const start = source.indexOf('static async copy(');
        const end = source.indexOf('static push<', start);
        const method = source.slice(start, end);
        expect(method).to.include('await copyProblemStorageFiles({');
        expect(method).to.include('const content = await storage.get(sourcePath)');
        expect(method).to.include('await storage.put(targetPath, content)');
        expect(method).not.to.include('storage.copy(sourcePath, targetPath)');
        expect(method).to.include('filename=%s');
        expect(cloneHelper).to.include('Problem clone failed while copying ');
        expect(method).to.include('createProblemByKind(');
        expect(method).to.include('const cloneOwner = attribution.owner ?? original.owner');
        expect(method).to.include('const cloneActor = attribution.actor ?? cloneOwner');
        expect(method).to.include('operator: cloneActor');
        expect(method.indexOf('createProblemByKind(')).to.be.lessThan(method.indexOf('copyProblemStorageFiles({'));
        expect(method).not.to.include('testdataSourcePid');
    });

    it('audits successful metadata-only saves for locked structured problems', () => {
        const source = readFileSync(resolve(root, 'src/model/problem.ts'), 'utf8');
        const start = source.indexOf('static async saveStructuredProblemMetadata');
        const end = source.indexOf('static async archiveProblem', start);
        const method = source.slice(start, end);
        expect(start).to.be.greaterThan(-1);
        expect(method).to.include('await ProblemModel.editAuthorizedWithSnapshot({');
        expect(method).to.include("type: 'problem.metadata.save'");
        expect(method.indexOf('await OplogModel.add(')).to.be.greaterThan(method.indexOf('await ProblemModel.editAuthorizedWithSnapshot({'));
        expect(method).to.include('auditedFields.filter((field) => !isEqual(before[field], result[field]))');
    });

    it('records only actual fields changed by a structured save', () => {
        const source = readFileSync(resolve(root, 'src/model/problem.ts'), 'utf8');
        const start = source.indexOf('static async saveStructuredProblem(input');
        const end = source.indexOf('static async saveStructuredProblemMetadata', start);
        const method = source.slice(start, end);
        expect(method).to.include('auditedFields.filter((field) => !isEqual(before[field], result[field]))');
        expect(method).not.to.include("changedFields: ['title'");
    });

    it('rejects every non-ready or invalid code-evaluation publication through the central gate', () => {
        const source = readFileSync(resolve(root, 'src/model/problem.ts'), 'utf8');
        const lifecycle = readFileSync(resolve(root, 'src/model/code-evaluation-lifecycle.ts'), 'utf8');
        expect(source).to.include('function assertPublishableProblem');
        expect(source.match(/assertPublishableProblem\(\{/g)).to.have.length(4);
        expect(source).to.include('assertProblemReadyForUseWithTrace(');
        expect(lifecycle).to.include("pdoc.codeEvaluationStatus !== 'ready'");
        expect(lifecycle).to.include('validateCompiledStructuredConfig(String(pdoc.problemKind), config)');
        expect(lifecycle).to.include('validateStructuredCodeTestdataFiles(config, pdoc.data || []');
    });

    it('blocks every config yaml alias at direct, claimed, and event-backed structured writes', () => {
        const source = readFileSync(resolve(root, 'src/model/problem.ts'), 'utf8');
        const handler = readFileSync(resolve(root, 'src/handler/problem.ts'), 'utf8');
        expect(source).to.include('testdataNames.some(isProblemConfigFilename)');
        expect(source).to.include('assertConfigTestdataEventAllowed(domainId, docId)');
        expect(handler).to.include('[...files, ...newNames].some(isProblemConfigFilename)');
        expect(handler).to.include('files.some(isProblemConfigFilename)');
    });

    it('validates config rename sources and Hydro imports before their first mutation', () => {
        const source = readFileSync(resolve(root, 'src/model/problem.ts'), 'utf8');
        const directStart = source.indexOf('static async renameTestdata(');
        const directEnd = source.indexOf('static async delTestdata(', directStart);
        const directRename = source.slice(directStart, directEnd);
        expect(directRename.indexOf('normalizeProblemTestdataUpload(newName, source)')).to.be.lessThan(directRename.indexOf('storage.rename('));

        const claimStart = source.indexOf('static async renameTestdataWithClaim(');
        const claimEnd = source.indexOf('static async delTestdataWithClaim(', claimStart);
        const claimedRename = source.slice(claimStart, claimEnd);
        expect(claimedRename.indexOf('normalizeProblemTestdataUpload(newName, source)')).to.be.lessThan(claimedRename.indexOf('storage.rename('));

        const importStart = source.indexOf('static async import(');
        const importEnd = source.indexOf('static async export(', importStart);
        const importer = source.slice(importStart, importEnd);
        expect(importer).to.include("'testdata', 'attachments', 'generators', 'include', 'data', 'output_validators'");
        expect(importer.indexOf('await validateImportedTestdataConfigs()')).to.be.lessThan(importer.indexOf('const overrideDoc = overridePid'));
    });

    it('routes managed publication through one audited review service with transaction or bounded compensation', () => {
        const source = readFileSync(resolve(root, 'src/model/problem.ts'), 'utf8');
        const publishStart = source.indexOf('static async publishManagedProgrammingProblem(');
        const publishEnd = source.indexOf('static createProblemByKind(', publishStart);
        const publish = source.slice(publishStart, publishEnd);
        expect(publish.indexOf('prepareManagedProblemPublication(')).to.be.lessThan(publish.indexOf('await prepareManagedPublish(claim)'));
        expect(publish.indexOf('await prepareManagedPublish(claim)')).to.be.lessThan(publish.indexOf('commitManagedProblemPublication({'));
        expect(publish.indexOf('commitManagedProblemPublication({')).to.be.lessThan(publish.lastIndexOf("type: 'problem.managed.publish'"));
        expect(publish.indexOf('const published = await ProblemModel.withAuthorizedWriteClaim(')).to.be.lessThan(
            publish.indexOf('if (!finalization)'),
        );
        expect(publish.indexOf('if (!finalization)')).to.be.lessThan(publish.indexOf('await OplogModel.add({'));
        expect(publish.indexOf('await OplogModel.add({')).to.be.lessThan(publish.indexOf("await bus.emit('problem/edit'"));
        expect(publish).to.include("{ capability: 'publish' }");

        const editStart = source.indexOf('static async editAuthorized(');
        const editEnd = source.indexOf('static async copy(', editStart);
        const edit = source.slice(editStart, editEnd);
        expect(edit).not.to.include('prepareManagedPublish(claim)');

        const persistence = readFileSync(resolve(root, 'src/model/managed-problem-publication.ts'), 'utf8');
        expect(persistence).to.include('session.withTransaction');
        expect(persistence).to.include("{ $addToSet: { 'dag.$.pids': input.docId } }");
        expect(persistence).to.include("{ $pull: { 'dag.$.pids': { $in: [input.docId, String(input.docId)] } } }");
        expect(persistence).to.include('managed publication compensation failed: pid=');
    });

    it('requires a durable capability claim for every managed clone, delete, edit, and file mutation', () => {
        const source = readFileSync(resolve(root, 'src/model/problem.ts'), 'utf8');
        expect(source).to.include("'aclWriteClaim.capability': claim.capability");

        const copyStart = source.indexOf('static async copy(');
        const copyEnd = source.indexOf('static push<', copyStart);
        const copy = source.slice(copyStart, copyEnd);
        expect(copy).to.include("problemWriteCapabilityAllows(claim.capability, 'clone')");
        expect(copy).to.include('problem write claim ownership lost before clone');

        const delStart = source.indexOf('static async del(domainId');
        const delEnd = source.indexOf('static async delAuthorized', delStart);
        expect(source.slice(delStart, delEnd)).to.include('Raw managed problem delete rejected');
        expect(source).to.include('Raw managed problem edit rejected');
        expect(source).to.include('Raw managed problem file write rejected');
    });

    it('audits a hook-injected managed field before rejecting the claimed write', () => {
        const source = readFileSync(resolve(root, 'src/model/problem.ts'), 'utf8');
        const helperStart = source.indexOf('async function auditManagedClaimPatchDenied(');
        const helperEnd = source.indexOf('function assertPublishableProblem', helperStart);
        const helper = source.slice(helperStart, helperEnd);
        expect(helper).to.include("type: 'problem.managed.write.denied'");
        expect(helper).to.include('phase');
        expect(helper).to.include('changedFields: guard.requestedFields');

        const editStart = source.indexOf('static async editWithClaim(');
        const editEnd = source.indexOf('static async editAuthorized(', editStart);
        const edit = source.slice(editStart, editEnd);
        const hook = edit.indexOf("await bus.parallel('problem/before-edit', $set, $unset)");
        const postHookAudit = edit.indexOf("await auditManagedClaimPatchDenied(claim, finalGuard, 'after-hook')", hook);
        const rejection = edit.indexOf('写入钩子产生了超出托管题凭据的字段', postHookAudit);
        expect(hook).to.be.greaterThan(-1);
        expect(postHookAudit).to.be.greaterThan(hook);
        expect(rejection).to.be.greaterThan(postHookAudit);
    });

    it('commits structural managed edits through the state-CAS claim primitive', () => {
        const source = readFileSync(resolve(root, 'src/model/problem.ts'), 'utf8');
        const editStart = source.indexOf('static async editWithClaim(');
        const editEnd = source.indexOf('static async editAuthorized(', editStart);
        const edit = source.slice(editStart, editEnd);
        const structuralStart = edit.indexOf('if (current.problemKind !== undefined && isStructuralPatch');
        const structuralEnd = edit.indexOf('} else {', structuralStart);
        const structural = edit.slice(structuralStart, structuralEnd);

        expect(structural).to.include('result = await commitProblemWriteClaimUpdate(');
        expect(structural).to.match(/commitProblemWriteClaimUpdate\([\s\S]*expectedStructureRevision: expectedRevision[\s\S]*\);/);
        expect(structural).not.to.include('document.coll.findOneAndUpdate(');
    });

    it('keeps managed PID, kind, system tags, source metadata, and confirmed title outside generic edits', () => {
        const source = readFileSync(resolve(root, 'src/model/managed-problem-patch.ts'), 'utf8');
        const guardStart = source.indexOf('export function managedProblemPatchCapability(');
        const guardEnd = source.indexOf('interface MindmapNodeRecord', guardStart);
        const guard = source.slice(guardStart, guardEnd);
        expect(source).to.include("new Set(['authoringMode', 'problemKind', 'pid', 'sort', 'tag', 'sourceMeta'])");
        expect(guard).to.include("field.includes('.') || MANAGED_CANONICAL_FIELDS.has(field)");
        expect(guard).to.include("if (requestedFields.includes('title')) immutableFields.push('title')");
        expect(guard).to.include("if (requestedFields.includes('managedAuthoring')) immutableFields.push('managedAuthoring')");
        expect(guard.indexOf('if (!workingTitleOnly)')).to.be.lessThan(guard.indexOf("immutableFields.push('title')"));
    });
});
