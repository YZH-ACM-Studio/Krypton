import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect } from 'chai';
import { describe, it } from 'node:test';

const workspaceRoot = resolve(__dirname, '../../..');

function read(relative: string) {
    return readFileSync(resolve(workspaceRoot, relative), 'utf8');
}

describe('P3.17 code evaluation lifecycle wiring', () => {
    it('creates the actual hidden Problem from metadata plus immutable mode and language only', () => {
        const handler = read('packages/hydrooj/src/handler/problem.ts');
        const start = handler.indexOf('abstract class DedicatedStructuredCreateHandler');
        const end = handler.indexOf('export class ProblemCreateSingleHandler', start);
        const create = handler.slice(start, end);

        expect(create).to.include("@post('codeEvaluationDraft', Types.Boolean, true)");
        expect(create).to.include("throw new ValidationError('content', null, '代码评测草稿第一阶段不接受题面、模板或测试数据')");
        expect(create).to.include('normalizeCodeEvaluationDraftCreationConfig(this.problemKind, parsedConfig)');
        expect(create).to.include("codeEvaluationStatus: 'draft' as const");
        expect(create).to.include('structureRevision: 1');
        expect(create).to.include("this.url('problem_edit', { pid: pid || docId })");

        const model = read('packages/hydrooj/src/model/problem.ts');
        expect(model).to.include('normalizeCodeEvaluationCreationStatus((meta as unknown as Record<string, unknown>).codeEvaluationStatus)');
    });

    it('changes draft to ready in the same revision-CAS that revalidates config and physical files', () => {
        const model = read('packages/hydrooj/src/model/problem.ts');
        const start = model.indexOf('static async saveStructuredProblem(input');
        const end = model.indexOf('static async saveStructuredProblemMetadata', start);
        const save = model.slice(start, end);

        expect(save).to.include("operation: completing ? 'code-evaluation-complete' : 'structure-save'");
        expect(save).to.include("...(completing ? { hidden: true, codeEvaluationStatus: 'ready' as const } : {})");
        expect(save).to.include("codeEvaluationStatus: 'ready'");
        expect(save).to.include("{ actor: input.actor, stage: 'complete-cas' }");
        expect(save).to.include('expectedStructureRevision: input.expectedStructureRevision');
        expect(save.indexOf('assertProblemReadyForUseWithTrace(')).to.be.lessThan(save.indexOf('const { before, result, auditedFields }'));
    });

    it('gates submission creation and every judge queue before their first mutation', () => {
        const problem = read('packages/hydrooj/src/model/problem.ts');
        const record = read('packages/hydrooj/src/model/record.ts');
        const claimStart = problem.indexOf('static async claimStructureLockForSubmission');
        const claimEnd = problem.indexOf('private static async editAuthorizedWithSnapshot', claimStart);
        const claim = problem.slice(claimStart, claimEnd);
        const judgeStart = record.indexOf('static async judge(');
        const judgeEnd = record.indexOf('static async add(', judgeStart);
        const judge = record.slice(judgeStart, judgeEnd);

        expect(claim).to.include('lockStructure = true');
        expect(claim.indexOf("stage: 'record-create'")).to.be.lessThan(claim.indexOf('document.coll.updateOne('));
        expect(claim).to.include('reference: 1');
        expect(claim.indexOf("stage: 'record-create-reference'")).to.be.lessThan(claim.indexOf('document.coll.updateOne('));
        expect(judge.indexOf("stage: 'judge-queue'")).to.be.lessThan(judge.indexOf('task.deleteMany('));
        expect(judge.indexOf("stage: 'judge-queue'")).to.be.lessThan(judge.indexOf('task.addMany('));
        expect(record).to.include("claimStructureLockForSubmission(domainId, pid, args.type !== 'generate', uid)");
    });

    it('keeps drafts hidden across hooks and gates publication at both low-level commit primitives', () => {
        const problem = read('packages/hydrooj/src/model/problem.ts');
        const access = read('packages/hydrooj/src/model/problem-access.ts');
        expect(problem).to.include("if (args.hidden !== true) throw new ValidationError('hidden'");
        expect(access).to.include("stage: 'acl-guarded-publish'");
        expect(access).to.include("stage: 'claim-publish'");
        expect(access.match(/assertCodeEvaluationReadyWithTrace\(/g)).to.have.length(3);
    });

    it('routes all current container writers through the central bank-selection ready gate', () => {
        for (const file of [
            'packages/hydrooj/src/handler/contest.ts',
            'packages/hydrooj/src/handler/homework.ts',
            'packages/hydrooj/src/handler/training.ts',
            'packages/hydrooj/src/handler/course.ts',
        ]) {
            expect(read(file), file).to.include('assertProblemBankSelection(');
        }
        expect(read('packages/krypton-tasks/src/handler.ts')).to.include('ProblemModel.assertProblemBankSelection(');
    });

    it('rejects dangling file operations before storage mutation and returns canonical upload state', () => {
        const model = read('packages/hydrooj/src/model/problem.ts');
        for (const [methodName, nextMethod, mutation, storageCall] of [
            ['static async addTestdataWithClaim(', 'static async renameTestdataWithClaim(', "type: 'upload'", 'storage.put('],
            ['static async renameTestdataWithClaim(', 'static async delTestdataWithClaim(', "type: 'rename'", 'storage.rename('],
            ['static async delTestdataWithClaim(', 'static async addAdditionalFileWithClaim(', "type: 'delete'", 'storage.del('],
        ]) {
            const start = model.indexOf(methodName);
            const end = model.indexOf(nextMethod, start);
            const method = model.slice(start, end);
            expect(method).to.include('assertCodeEvaluationFileMutationWithTrace(');
            expect(method.indexOf('assertClaimedTestdataWriteClaim(')).to.be.lessThan(method.indexOf(storageCall));
            expect(method.indexOf('getClaimedProblemFiles(')).to.be.lessThan(method.indexOf(storageCall));
            expect(method.indexOf(mutation)).to.be.lessThan(method.indexOf(storageCall));
        }

        const handler = read('packages/hydrooj/src/handler/problem.ts');
        const uploadStart = handler.indexOf('async postUploadFile(');
        const uploadEnd = handler.indexOf('async postRenameFiles(', uploadStart);
        const upload = handler.slice(uploadStart, uploadEnd);
        expect(upload).to.include("['structureRevision', 'data']");
        expect(upload).to.include('testdata: sortFiles(latest.data || [])');

        const pushStart = model.indexOf('static push<');
        const incStart = model.indexOf('static inc(', pushStart);
        const primitives = model.slice(pushStart, incStart);
        expect(primitives.match(/if \(key === 'data'\) throw new ValidationError/g)).to.have.length(2);
        expect(model).to.include("document.push(domainId, document.TYPE_PROBLEM, pid, 'data'");
        expect(model).to.include("document.deleteSub(domainId, document.TYPE_PROBLEM, pid, 'data', names)");
        const claimedCommitStart = model.indexOf('private static async commitClaimedTestdataState(');
        const claimedCommitEnd = model.indexOf('static async addTestdataWithClaim(', claimedCommitStart);
        const claimedCommit = model.slice(claimedCommitStart, claimedCommitEnd);
        const claimedReadStart = model.indexOf('private static async getClaimedProblemFiles(');
        const claimedRead = model.slice(claimedReadStart, claimedCommitStart);
        expect(claimedCommit).to.include('physicalTestdataMutation: true');
        expect(claimedCommit).to.include('problemWriteClaimAllowsTestdataMutation');
        expect(claimedCommit).to.include('current.problemKind === undefined');
        expect(claimedCommit).to.include('expectedData,');
        expect(claimedCommit).to.include('problemDataSnapshotFilter(expectedData)');
        const access = read('packages/hydrooj/src/model/problem-access.ts');
        expect(access).to.include('normalizeProblemFileListSnapshot(');
        expect(access).to.include("'aclWriteClaim.operation': claim.operation");
        expect(claimedRead).to.include("'aclWriteClaim.operation': claim.operation");
        expect(access).to.include("if (snapshot.state === 'missing') return { data: { $exists: false } }");
        expect(access).to.include("$expr: { $eq: ['$data', { $literal: snapshot.value }] }");
        expect(access).to.include("upload: new Set(['files-upload', 'generate-testdata-callback', 'crawler-testdata-replace'])");
        expect(access).to.include("delete: new Set(['files-delete', 'crawler-testdata-replace'])");
        expect(model.match(/commitClaimedTestdataState\(/g)).to.have.length(4);
        expect(claimedCommit.indexOf('current.problemKind === undefined')).to.be.lessThan(claimedCommit.indexOf('assertStructureRevision('));
    });

    it('rejects incomplete clone sources and always returns code-evaluation clones as hidden drafts', () => {
        const model = read('packages/hydrooj/src/model/problem.ts');
        const start = model.indexOf('static async copy(');
        const end = model.indexOf('static push<', start);
        const copy = model.slice(start, end);
        expect(copy.indexOf("stage: 'clone-source'")).to.be.lessThan(copy.indexOf('createProblemByKind('));
        expect(copy).to.include("codeEvaluationStatus: 'draft' as const");
        expect(copy).to.include('...(cloneIsCodeEvaluation ? {} : { config: cloneConfig as any })');
        const createStart = model.indexOf('static async addWithId(');
        const createEnd = model.indexOf('static async createManagedProgrammingDraft', createStart);
        expect(model.slice(createStart, createEnd)).to.include('hidden: true');
    });
});
