import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect } from 'chai';
import { describe, it } from 'node:test';
import { copyProblemStorageFiles, type ProblemCloneFileFailure } from '../src/lib/problem-clone';

const hash = (value: Buffer) => createHash('sha256').update(value).digest('hex');

describe('physical problem storage clone', () => {
    it('uses storage get and put instead of the link-based global copy operation', () => {
        const source = readFileSync(resolve(__dirname, '../src/model/problem.ts'), 'utf8');
        const start = source.indexOf('static async copy(');
        const end = source.indexOf('static async del(', start);
        const method = source.slice(start, end);
        expect(method).to.include('const content = await storage.get(sourcePath)');
        expect(method).to.include('await storage.put(targetPath, content)');
        expect(method).not.to.include('storage.copy(sourcePath, targetPath)');
    });

    it('copies every file byte-for-byte and leaves the target independent', async () => {
        const storage = new Map<string, Buffer>([
            ['problem/system/7/testdata/1.in', Buffer.from('1\n')],
            ['problem/system/7/testdata/1.out', Buffer.from('2\n')],
        ]);
        await copyProblemStorageFiles({
            files: [
                { name: 'testdata/1.in', path: 'problem/system/7/testdata/1.in' },
                { name: 'testdata/1.out', path: 'problem/system/7/testdata/1.out' },
            ],
            sourceDomainId: 'system',
            sourceProblemId: 7,
            targetDomainId: 'system',
            targetProblemId: 8,
            targetPrefix: 'problem/system/8/',
            copy: async (source, target) => {
                const value = storage.get(source);
                if (!value) throw new Error(`missing ${source}`);
                storage.set(target, Buffer.from(value));
            },
            onFailure: () => {
                throw new Error('unexpected failure');
            },
        });

        for (const filename of ['1.in', '1.out']) {
            const source = storage.get(`problem/system/7/testdata/${filename}`)!;
            const target = storage.get(`problem/system/8/testdata/${filename}`)!;
            expect(hash(target)).to.equal(hash(source));
        }
        storage.set('problem/system/7/testdata/1.in', Buffer.from('changed\n'));
        expect(storage.get('problem/system/8/testdata/1.in')!.toString()).to.equal('1\n');
        storage.delete('problem/system/7/testdata/1.out');
        expect(storage.get('problem/system/8/testdata/1.out')!.toString()).to.equal('2\n');
    });

    it('reports the exact failing source, target, and filename and rejects immediately', async () => {
        let failure: ProblemCloneFileFailure | undefined;
        const error = await copyProblemStorageFiles({
            files: [{ name: 'testdata/broken.in', path: 'problem/source/7/testdata/broken.in' }],
            sourceDomainId: 'source',
            sourceProblemId: 7,
            targetDomainId: 'target',
            targetProblemId: 8,
            targetPrefix: 'problem/target/8/',
            copy: async () => {
                throw new Error('disk failure');
            },
            onFailure: (value) => {
                failure = value;
            },
        }).catch((caught) => caught);

        expect(error).to.be.instanceOf(Error);
        expect(error.message).to.include('testdata/broken.in');
        expect(failure).to.deep.include({
            sourceDomainId: 'source',
            sourceProblemId: 7,
            targetDomainId: 'target',
            targetProblemId: 8,
            filename: 'testdata/broken.in',
        });
        expect((failure!.error as Error).message).to.equal('disk failure');
    });

    it('rejects every programming clone before creating a replacement document', () => {
        const source = readFileSync(resolve(__dirname, '../src/model/problem.ts'), 'utf8');
        const start = source.indexOf('static async copy(');
        const end = source.indexOf('static push<', start);
        const method = source.slice(start, end);

        const rejection = method.indexOf("if (problemKind === 'programming')");
        const creation = method.indexOf('createProblemByKind(');
        expect(rejection).to.be.greaterThan(-1);
        expect(method).to.include('编程题不能通过复制创建；请从托管编程题入口新建');
        expect(rejection).to.be.lessThan(creation);
    });

    it('requires every trusted programming import to bind one public map while preserving map-only drafts', () => {
        const source = readFileSync(resolve(__dirname, '../src/model/problem.ts'), 'utf8');
        const start = source.indexOf('static async addWithId(');
        const end = source.indexOf('static async createManagedProgrammingDraft', start);
        const method = source.slice(start, end);

        expect(method).to.include("if (problemKind === 'programming') {");
        expect(method).to.include('knowledgeMapId: meta.knowledgeMapId');
        expect(method).to.include('allowSolePublicMap: !meta.knowledgeMapId');
        expect(method).to.include('args.knowledgeMapId = knowledge.mapId');
        expect(method).to.include('if (meta.knowledgeNodeIds !== undefined) args.knowledgeNodeIds = knowledge.nodeIds');
        expect(method).to.include("requireKnowledgePair: problemKind !== 'programming' || meta.knowledgeNodeIds !== undefined");
        expect(method).not.to.include("if (problemKind === 'programming') args.knowledgeNodeIds = []");
    });

    it('creates the bootstrap welcome draft with an explicit empty canonical node array', () => {
        const source = readFileSync(resolve(__dirname, '../src/model/problem.ts'), 'utf8');
        const start = source.indexOf('static async createBuiltinWelcomeProblem(');
        const end = source.indexOf('private static async materializeStartedContainerLock', start);
        const method = source.slice(start, end);

        expect(method).to.include("{ problemKind: 'programming', knowledgeMapId: knowledge.mapId, knowledgeNodeIds: [] }");
    });

    it('resolves one public map before a Hydro archive import can create any problem', () => {
        const source = readFileSync(resolve(__dirname, '../src/model/problem.ts'), 'utf8');
        const start = source.indexOf('static async import(');
        const end = source.indexOf('static async export(', start);
        const method = source.slice(start, end);

        const resolution = method.indexOf('resolveProgrammingKnowledgeMap(options.knowledgeMapId)');
        const extraction = method.indexOf("if (filepath.endsWith('.zip'))");
        const creation = method.indexOf('knowledgeMapId: importKnowledge.mapId');
        expect(resolution).to.be.greaterThan(-1);
        expect(resolution).to.be.lessThan(extraction);
        expect(creation).to.be.greaterThan(extraction);
        expect(method).to.include('knowledgeNodeIds: []');
    });

    it('plumbs an explicit map through every non-interactive programming ingestion path', () => {
        const directSources = [
            'packages/hydrooj/src/handler/crawler.ts',
            'packages/import-hoj/index.ts',
            'packages/import-qduoj/index.ts',
            'packages/vjudge/src/index.ts',
        ].map((filename) => readFileSync(resolve(process.cwd(), filename), 'utf8'));

        for (const source of directSources) {
            expect(source).to.include('resolveProgrammingKnowledgeMap(');
            expect(source).to.include('knowledgeMapId: knowledge.mapId');
            expect(source).to.include('knowledgeNodeIds: []');
        }
        const fps = readFileSync(resolve(process.cwd(), 'packages/fps-importer/index.ts'), 'utf8');
        expect(fps).to.include('resolveProgrammingKnowledgeMap(');
        expect(fps).to.include('this.run(domainId, task, knowledge.mapId)');
        expect(fps).to.include('knowledgeMapId,');
        expect(fps).to.include('knowledgeNodeIds: []');
    });
});
