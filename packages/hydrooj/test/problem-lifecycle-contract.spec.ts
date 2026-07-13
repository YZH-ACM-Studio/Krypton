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

    it('locks revision-managed problems before inserting a submission', () => {
        const source = readFileSync(resolve(root, 'src/model/record.ts'), 'utf8');
        const lock = source.indexOf('claimStructureLockForSubmission(domainId, pid)');
        const insert = source.indexOf('RecordModel.coll.insertOne(data)');
        expect(lock).to.be.greaterThan(-1);
        expect(insert).to.be.greaterThan(lock);
    });

    it('passes the private raw objective config to the judge without exposing it through page reads', () => {
        const source = readFileSync(resolve(root, 'src/model/record.ts'), 'utf8');
        expect(source).to.include('problem.get(domainId, rdocs[0].pid, undefined, true)');
        expect(source).to.match(/const judgeConfig\s*=\s*parseProblemConfigObject\(pdoc\)/);
        expect(source).to.include('...judgeConfig');
    });

    it('forces new problems to be hidden and explicitly typed', () => {
        const source = readFileSync(resolve(root, 'src/model/problem.ts'), 'utf8');
        expect(source).to.include('const problemKind = parseProblemKind(meta?.problemKind)');
        expect(source).to.include('hidden: true');
        expect(source).to.include('structureRevision: 1');
    });

    it('keeps archived problems hidden and preserves HTML when cloning', () => {
        const source = readFileSync(resolve(root, 'src/model/problem.ts'), 'utf8');
        expect(source.match(/current\.archivedAt && \$set\.hidden === false/g)).to.have.length(2);
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

    it('rejects every type-only fill-function publication, including legacy programming problems', () => {
        const source = readFileSync(resolve(root, 'src/model/problem.ts'), 'utf8');
        expect(source).to.include('function assertPublishableFillFunction');
        expect(source.match(/assertPublishableFillFunction\(\{/g)).to.have.length(3);
        expect(source).to.include('validateCompiledStructuredConfig(problemKind, config)');
        expect(source).to.include('validateFillFunctionTestdataFiles(config, input.data || [])');
        expect(source.match(/config:\s*1,\s*data:\s*1/g)).to.have.length(2);
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

    it('audits managed publication before clearing verifiers and before unhide mutation', () => {
        const source = readFileSync(resolve(root, 'src/model/problem.ts'), 'utf8');
        const publishStart = source.indexOf('async function prepareManagedPublish(');
        const publishEnd = source.indexOf('function revisionClaimFilter', publishStart);
        const publish = source.slice(publishStart, publishEnd);
        expect(publish.indexOf("type: 'problem.managed.publish'")).to.be.lessThan(publish.indexOf('await permits.clearVerifiersForProblem('));
        expect(publish).to.include('operator: claim.actor');
        expect(publish).to.include("type: 'problem.permit.revoke'");

        const editStart = source.indexOf('static async editAuthorized(');
        const editEnd = source.indexOf('static async copy(', editStart);
        const edit = source.slice(editStart, editEnd);
        expect(edit.indexOf('await prepareManagedPublish(claim)')).to.be.lessThan(edit.indexOf('ProblemModel.editWithClaim('));
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
        const helperEnd = source.indexOf('function assertPublishableFillFunction', helperStart);
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
});
