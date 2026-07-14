import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect } from 'chai';
import { describe, it } from 'node:test';

const workspaceRoot = resolve(__dirname, '../../..');
const read = (relative: string) => readFileSync(resolve(workspaceRoot, relative), 'utf8');

describe('P3.18 function problem wiring', () => {
    it('contains no runtime marker authoring protocol', () => {
        for (const file of [
            'packages/hydrooj/src/lib/problem-config.ts',
            'packages/hydrooj/src/model/problem-lifecycle.ts',
            'packages/hydrooj/src/model/code-evaluation-lifecycle.ts',
            'packages/ui-next/src/pages/structured-code-editors.tsx',
        ]) {
            const source = read(file);
            expect(source, file).not.to.include('markerSource');
            expect(source, file).not.to.include('@krypton-region');
        }
    });

    it('derives source hashes and server ids while rejecting client-controlled ids', () => {
        const lifecycle = read('packages/hydrooj/src/model/code-evaluation-lifecycle.ts');
        expect(lifecycle).to.match(/do id = `r_\$\{nanoid\(16\)\}`/);
        expect(lifecycle).to.include('sourceHash: templateSourceHash(source)');
        expect(lifecycle).to.include('ID 不属于当前题目');
        expect(lifecycle).to.include('坐标不可直接改写，请删除后重新框选');
        expect(lifecycle).to.include('已因模板修改失效，请删除后重新框选');
    });

    it('revalidates the current locked template and exact payload before Record insertion', () => {
        const record = read('packages/hydrooj/src/model/record.ts');
        const start = record.indexOf('static async add(');
        const end = record.indexOf('static getMulti(', start);
        const add = record.slice(start, end);
        expect(add.indexOf('claimStructureLockForSubmission(')).to.be.lessThan(add.indexOf('RecordModel.coll.insertOne(data)'));
        expect(add.indexOf('validateStructuredCodeJudgeConfig(')).to.be.lessThan(add.indexOf('RecordModel.coll.insertOne(data)'));
        expect(add.indexOf('parseStructuredRegionSubmission(')).to.be.lessThan(add.indexOf('RecordModel.coll.insertOne(data)'));
        expect(add).to.include('stage=before-insert');
    });

    it('dispatches function configs through the existing default-judge adapter', () => {
        const judges = read('packages/hydrojudge/src/judge/index.ts');
        const adapter = read('packages/hydrojudge/src/judge/fill_function.ts');
        expect(judges).to.include('function: fill_function');
        expect(adapter).to.include('spliceStructuredCodeTemplate(template, regionContents, kind)');
        expect(adapter).to.include('await defaultJudge(ctx)');
    });

    it('serializes only ordered ids, signatures, and descriptions to students', () => {
        const config = read('packages/hydrooj/src/lib/problem-config.ts');
        const start = config.indexOf('export function clientProblemConfig');
        const end = config.indexOf('// ─── Structured-code whole-line regions', start);
        const serializer = config.slice(start, end);
        expect(serializer).to.include('signature: region.signature');
        expect(serializer).to.include('description: region.description');
        expect(serializer).not.to.include('region.startLine');
        expect(serializer).not.to.include('region.endLine');
        expect(serializer).not.to.include('config.cases');
        expect(serializer).not.to.include('config.template.source');
    });
});
