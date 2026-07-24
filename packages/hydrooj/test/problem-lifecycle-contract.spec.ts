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

    it('validates and stabilizes only the directly submitted managed draft before skipping its structure lock', () => {
        const source = readFileSync(resolve(root, 'src/model/problem.ts'), 'utf8');
        const start = source.indexOf('static async claimStructureLockForSubmission');
        const end = source.indexOf('private static async editAuthorizedWithSnapshot', start);
        const claim = source.slice(start, end);

        expect(claim.indexOf('parseProblemKind(snapshot.problemKind)')).to.be.lessThan(
            claim.indexOf('shouldClaimSubmissionStructureLock(snapshot, lockStructure)'),
        );
        expect(claim.indexOf('assertStructureRevision(snapshot.structureRevision)')).to.be.lessThan(
            claim.indexOf('shouldClaimSubmissionStructureLock(snapshot, lockStructure)'),
        );
        expect(claim).to.include("'managedAuthoring.metadataStatus': 'draft'");
        expect(claim).to.include('aclWriteClaim: { $exists: false }');
        expect(claim).to.include('structureRevision: snapshot.structureRevision');
        expect(claim).to.include('const direct = await claimLock(pdoc as ProblemDoc, true)');
        expect(claim).to.include('if (source) await claimLock(source, false)');
    });

    it('keeps archived and legacy statement writes behind server-side guards', () => {
        const source = readFileSync(resolve(root, 'src/model/problem.ts'), 'utf8');
        const rawStart = source.indexOf('static async edit(');
        const rawEnd = source.indexOf('static async beginAuthorizedWriteClaim', rawStart);
        const raw = source.slice(rawStart, rawEnd);
        const claimedStart = source.indexOf('static async editWithClaim(');
        const claimedEnd = source.indexOf('/** HTTP/service-token metadata write entrypoint. */', claimedStart);
        const claimed = source.slice(claimedStart, claimedEnd);

        for (const method of [raw, claimed]) {
            expect(method.match(/current\.archivedAt && isStructuralPatch/g)).to.have.length(2);
            const legacyAwareGuard = method.indexOf('editorialPatch && (current.problemKind === undefined || !submissionLockedPatch)');
            const revisionManagedBranch = method.indexOf('if (current.problemKind !== undefined && structuralPatch');
            expect(legacyAwareGuard).to.be.greaterThan(-1);
            expect(revisionManagedBranch).to.be.greaterThan(legacyAwareGuard);
        }
        expect(claimed).to.include("'statement-edit'");
        expect(claimed).to.include("'statement'");
    });

    it('checks active containers through reverse reference wrappers as well as the source itself', () => {
        const source = readFileSync(resolve(root, 'src/model/problem.ts'), 'utf8');
        const start = source.indexOf('static async listActiveDataWriteContainers');
        const end = source.indexOf('static activeDataWriteContainerFacts', start);
        const method = source.slice(start, end);

        expect(method).to.include("'reference.domainId': domainId");
        expect(method).to.include("'reference.pid': pid");
        expect(method).to.include('targets.map((target) =>');
        expect(method).to.include('pids: target.docId');
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

    it('waits for testdata observers before releasing direct or claimed writes', () => {
        const source = readFileSync(resolve(root, 'src/model/problem.ts'), 'utf8');
        const helperStart = source.indexOf('async function waitForProblemTestdataObservers(');
        const helperEnd = source.indexOf('function assertProblemReadyForUseWithTrace', helperStart);
        const helper = source.slice(helperStart, helperEnd);
        expect(helperStart).to.be.greaterThan(-1);
        expect(helper).to.include('await notify()');
        expect(helper).to.include('stage=testdata-observer');
        expect(helper).to.include('files=%o');
        expect(helper).to.include('context.files');
        expect(helper).to.include('throw error');
        expect(source.match(/await waitForProblemTestdataObservers\(/g)).to.have.length(6);
        expect(source.match(/files: \[name\]/g)).to.have.length(2);
        expect(source.match(/files: \[file, newName\]/g)).to.have.length(2);
        expect(source.match(/files: names/g)).to.have.length(2);
        for (const event of ['addTestdata', 'renameTestdata', 'delTestdata']) {
            expect(source.match(new RegExp(`await parallelAllSettled\\('problem/${event}'`, 'g')), event).to.have.length(2);
            expect(source).not.to.include(`await bus.emit('problem/${event}'`);
        }
        const busSource = readFileSync(resolve(root, 'src/service/bus.ts'), 'utf8');
        const settledStart = busSource.indexOf('export async function parallelAllSettled');
        const settledEnd = busSource.indexOf('\nexport function apply(', settledStart);
        const settled = busSource.slice(settledStart, settledEnd);
        expect(settled).to.include('await Promise.allSettled(');
        expect(settled).to.include("app.events.dispatch('emit', dispatchArgs)");
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
        expect(importer.indexOf('await validateImportedTestdataConfigs()')).to.be.lessThan(
            importer.indexOf('await ProblemModel.createManagedProgrammingDraft('),
        );
        expect(importer).not.to.include('await ProblemModel.add(');
        expect(importer).not.to.include('await ProblemModel.addTestdata(');
        expect(importer).not.to.include('await ProblemModel.addAdditionalFile(');
        expect(importer).to.include('await ProblemModel.withAuthorizedDataWriteClaim(');
        expect(importer).to.include('await ProblemModel.addTestdataWithClaim(');
        expect(importer).to.include('await ProblemModel.addAdditionalFileWithClaim(');
    });

    it('routes managed publication through one audited review service with transaction or bounded compensation', () => {
        const source = readFileSync(resolve(root, 'src/model/problem.ts'), 'utf8');
        const publishStart = source.indexOf('static async publishManagedProgrammingProblem(');
        const publishEnd = source.indexOf('static createProblemByKind(', publishStart);
        const publish = source.slice(publishStart, publishEnd);
        expect(publish.indexOf('prepareManagedProblemPublication(')).to.be.lessThan(publish.indexOf('await prepareManagedPublish(claim, input)'));
        expect(publish.indexOf('await prepareManagedPublish(claim, input)')).to.be.lessThan(publish.indexOf('commitManagedProblemPublication({'));
        expect(publish.indexOf('commitManagedProblemPublication({')).to.be.lessThan(publish.indexOf('finalizeManagedPublishAcl(claim'));
        expect(publish).not.to.include("'managed-publish-verifier-cleanup'");
        expect(publish).to.include('finalizeManagedPublishAcl(claim, verifierUids)');
        expect(publish).to.include("capability: 'publish', requiredPidNamespaceGrant: 'manager'");
        expect(publish).to.include('withLivePidNamespaceGrant(claim');

        const editStart = source.indexOf('static async editAuthorized(');
        const editEnd = source.indexOf('static async copy(', editStart);
        const edit = source.slice(editStart, editEnd);
        expect(edit).not.to.include('prepareManagedPublish(claim, input)');

        const persistence = readFileSync(resolve(root, 'src/model/managed-problem-publication.ts'), 'utf8');
        expect(persistence).to.include('session.withTransaction');
        expect(persistence).to.include("{ $addToSet: { 'dag.$.pids': input.docId } }");
        expect(persistence).to.include("{ $pull: { 'dag.$.pids': { $in: [input.docId, String(input.docId)] } } }");
        expect(persistence).to.include('managed publication compensation failed: pid=');
    });

    it('revalidates managed creation authority and every publish prerequisite before visibility changes', () => {
        const source = readFileSync(resolve(root, 'src/model/problem.ts'), 'utf8');
        const createStart = source.indexOf('static async createManagedProgrammingDraft(');
        const publishStart = source.indexOf('static async publishManagedProgrammingProblem(', createStart);
        const create = source.slice(createStart, publishStart);
        const publishEnd = source.indexOf('static createProblemByKind(', publishStart);
        const publish = source.slice(publishStart, publishEnd);

        expect(create).to.include('ProblemModel.canCreateManagedProgrammingDraft(actorUser)');
        expect(create).to.include('await reservePidForNamespace({');
        expect(create).to.include("namespaceId: String(input.pidNamespaceId || '')");
        expect(create.indexOf('await reservePidForNamespace({')).to.be.lessThan(create.indexOf('ProblemModel.createProblemByKind('));
        expect(create).to.include("['pendingTrainingPlacement']");
        expect(create).to.include('throw new PermissionError(PERM.PERM_CREATE_PROGRAMMING_DRAFT)');

        for (const field of ['content: 1', 'config: 1', 'data: 1', 'structureRevision: 1']) expect(publish).to.include(field);
        const readiness = publish.indexOf("stage: 'publish-explicit-testpoints'");
        const permitCheck = publish.indexOf('await prepareManagedPublish(claim, input)');
        const commit = publish.indexOf('commitManagedProblemPublication({');
        expect(readiness).to.be.greaterThan(-1);
        expect(readiness).to.be.lessThan(permitCheck);
        expect(permitCheck).to.be.lessThan(commit);
        expect(publish).to.include('assertProgrammingTestcasesConfiguredWithTrace(');
        expect(publish).to.include('pdoc.structureRevision !== input.expectedStructureRevision');
        expect(publish).to.include('expectedStructureRevision: input.expectedStructureRevision');
        expect(publish).to.include('publicationState=committed_with_error stage=verifier-cleanup');
        expect(publish).not.to.include('managed publication committed but finalization failed:');

        const prepareStart = source.indexOf('async function prepareManagedPublish(');
        const prepareEnd = source.indexOf('async function finalizeManagedPublishAcl(', prepareStart);
        const prepare = source.slice(prepareStart, prepareEnd);
        expect(prepare).to.include("row?.role === 'author'");
        expect(prepare).to.include('authorUids.length !== 1');
        expect(prepare).not.to.include('await permits.clearVerifiersForProblem');

        const finalizeStart = source.indexOf('async function finalizeManagedPublishAcl(', prepareEnd);
        const finalizeEnd = source.indexOf('function revisionClaimFilter', finalizeStart);
        expect(source.slice(finalizeStart, finalizeEnd)).to.include('permits.clearVerifiersForProblem');

        const persistence = readFileSync(resolve(root, 'src/model/managed-problem-publication.ts'), 'utf8');
        expect(persistence).to.include('structureRevision: input.expectedStructureRevision');
        expect(persistence).to.include('structureLockedAt: { $exists: false }');
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
        const structuralStart = edit.indexOf('if (current.problemKind !== undefined && structuralPatch');
        const structuralEnd = edit.indexOf('if (!result &&', structuralStart);
        const structural = edit.slice(structuralStart, structuralEnd);

        expect(structural).to.include('result = await commitProblemWriteClaimUpdate(');
        expect(structural).to.match(/commitProblemWriteClaimUpdate\([\s\S]*expectedStructureRevision: expectedRevision[\s\S]*\);/);
        expect(structural).not.to.include('document.coll.findOneAndUpdate(');
    });

    it('applies programming tag normalization under one claim with preview and final CAS', () => {
        const source = readFileSync(resolve(root, 'src/model/problem.ts'), 'utf8');
        const start = source.indexOf('static async applyProgrammingTagNormalization(');
        const end = source.indexOf('static async claimStructureLockForSubmission', start);
        const method = source.slice(start, end);

        expect(start).to.be.greaterThan(-1);
        expect(method).to.include("'programming-tag-normalize'");
        expect(method).to.include('const preview = await previewProgrammingTagNormalization({');
        expect(method.indexOf('preview.fingerprint !== input.previewFingerprint')).to.be.lessThan(method.indexOf('commitProblemWriteClaimUpdate('));
        expect(method).to.include('tag: preview.nextTags');
        expect(method).to.include('knowledgeNodeIds: preview.selectedNodeIds');
        expect(method).to.include("'managedAuthoring.selectedMindmapNodeIds': preview.selectedNodeIds");
        expect(method).to.include("commitProblemWriteClaimUpdate(claim, tagPatch as Partial<ProblemDoc>, {}, 'tag'");
        expect(method).to.include('expectedTag: current.tag || []');
        expect(method).to.include('if (!result) throw new ProblemTagConflictError(input.pid)');
        expect(method).to.include("{ capability: 'tag' }");
        expect(method).to.include("type: 'problem.tag.contribution'");
        expect(method).to.include('Programming tag normalization succeeded');
    });

    it('keeps ordinary programming saves free of hook-injected tag writes', () => {
        const source = readFileSync(resolve(root, 'src/model/problem.ts'), 'utf8');
        const rawStart = source.indexOf('static async edit(');
        const rawEnd = source.indexOf('static async beginAuthorizedWriteClaim(', rawStart);
        const rawEdit = source.slice(rawStart, rawEnd);
        const claimedStart = source.indexOf('static async editWithClaim(');
        const claimedEnd = source.indexOf('static async editAuthorized(', claimedStart);
        const claimedEdit = source.slice(claimedStart, claimedEnd);

        expect(rawEdit).to.include('const preserveProgrammingTagPair =');
        expect(rawEdit).to.include('未请求标签变更时，写入钩子不能修改编程题标签');
        expect(claimedEdit).to.include('const preserveProgrammingTagPair =');
        expect(claimedEdit).to.include('Programming tag hook write rejected');
    });

    it('keeps managed PID, kind, system tags, source metadata, and confirmed title outside generic edits', () => {
        const source = readFileSync(resolve(root, 'src/model/managed-problem-patch.ts'), 'utf8');
        const guardStart = source.indexOf('export function managedProblemPatchCapability(');
        const guardEnd = source.indexOf('interface MindmapNodeRecord', guardStart);
        const guard = source.slice(guardStart, guardEnd);
        for (const field of ['authoringMode', 'problemKind', 'pid', 'sort', 'tag', 'sourceMeta']) {
            expect(source).to.include(`    '${field}',`);
        }
        expect(guard).to.include("field.includes('.') || MANAGED_CANONICAL_FIELDS.has(field)");
        expect(guard).to.include("if (requestedFields.includes('title')) immutableFields.push('title')");
        expect(guard).to.include("if (requestedFields.includes('managedAuthoring')) immutableFields.push('managedAuthoring')");
        expect(guard.indexOf('if (!managedDraftPatch)')).to.be.lessThan(guard.indexOf("immutableFields.push('title')"));
    });
});
