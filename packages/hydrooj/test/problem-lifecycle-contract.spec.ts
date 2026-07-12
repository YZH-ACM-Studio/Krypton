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
        expect(source).to.include('const judgeConfig = parseProblemConfigObject(pdoc)');
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

    it('rejects structured testdata writes in both direct and claimed model helpers', () => {
        const source = readFileSync(resolve(root, 'src/model/problem.ts'), 'utf8');
        expect(source.match(/assertDirectStructureWritable\(domainId, pid, true\)/g)).to.have.length(3);
        expect(source).to.include("key === 'data' && doc.problemKind !== undefined");
    });

    it('audits successful metadata-only saves for locked structured problems', () => {
        const source = readFileSync(resolve(root, 'src/model/problem.ts'), 'utf8');
        const start = source.indexOf('static async saveStructuredProblemMetadata');
        const end = source.indexOf('static async archiveProblem', start);
        const method = source.slice(start, end);
        expect(start).to.be.greaterThan(-1);
        expect(method).to.include('await ProblemModel.editAuthorizedWithSnapshot({');
        expect(method).to.include("type: 'problem.metadata.save'");
        expect(method.indexOf('await OplogModel.add('))
            .to.be.greaterThan(method.indexOf('await ProblemModel.editAuthorizedWithSnapshot({'));
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
});
