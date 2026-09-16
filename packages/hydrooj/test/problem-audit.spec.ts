import childProcess from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect } from 'chai';
import { after, before, describe, it } from 'node:test';
import {
    parsePatMap,
    persistProblemAuditReport,
    ProblemAuditError,
    runProblemAudit,
    type ProblemAuditAdapter,
    type ProblemAuditProblem,
    type ProblemAuditTestdataFile,
    type ProblemAuditTestdataRead,
} from '../src/lib/problem-audit';
import { classifyTestdataEol, shouldScanTestdataName } from '../src/lib/problem-audit-eol';
import { extractMathSpans, renderLatexWithKatex, statementSourcesForAudit } from '../src/lib/problem-audit-latex';
import { inspectPatProblem } from '../src/lib/problem-audit-pat';
import { BUILTIN_PID_NAMESPACE_IDS } from '../src/lib/problem-pid-namespace-registry';

function problem(pid: string, patch: Partial<ProblemAuditProblem> = {}): ProblemAuditProblem {
    return {
        domainId: 'system',
        docId: Number(pid.replace(/\D/g, '') || 1),
        pid,
        title: pid,
        content: '',
        ...patch,
    };
}

class FixtureAdapter implements ProblemAuditAdapter {
    closed = 0;

    constructor(
        private readonly problems: ProblemAuditProblem[],
        private readonly blobs: Map<string, Buffer | 'missing'> = new Map(),
    ) {}

    async loadProblems() {
        return this.problems;
    }

    async listTestdataFiles(problems: ProblemAuditProblem[]): Promise<ProblemAuditTestdataFile[]> {
        const allowed = new Set(problems.map((item) => `${item.domainId}/${item.docId}`));
        const files: ProblemAuditTestdataFile[] = [];
        for (const [key, blob] of this.blobs) {
            const [domainId, docIdText, name] = key.split('/');
            const docId = Number(docIdText);
            if (!allowed.has(`${domainId}/${docId}`)) continue;
            const owner = problems.find((item) => item.domainId === domainId && item.docId === docId);
            files.push({
                domainId,
                docId,
                pid: owner?.pid || String(docId),
                title: owner?.title || '',
                name,
                size: blob === 'missing' ? 0 : blob.length,
            });
        }
        return files;
    }

    async readTestdata(file: ProblemAuditTestdataFile): Promise<ProblemAuditTestdataRead> {
        const blob = this.blobs.get(`${file.domainId}/${file.docId}/${file.name}`);
        if (blob === undefined || blob === 'missing') return { missing: true };
        return { bytes: blob };
    }

    async close() {
        this.closed++;
    }
}

describe('problem audit latex extraction', () => {
    it('extracts inline, display, escaped fences and ignores currency dollars', () => {
        const spans = extractMathSpans(
            'content',
            [
                'price $100 and $200.',
                'inline $a+b$ and $1 \\le n$ and display $$\\frac{1}{2}$$.',
                'also \\(x^2\\) and \\[y^2\\] are not formulas.',
                '',
                '```c',
                'int x = $not$;',
                '```',
                '',
                'code `$also$` stays.',
                '$$',
                'unterminated',
            ].join('\n'),
        );
        expect(spans.map((span) => [span.display, span.latex, span.unterminated])).to.deep.equal([
            [false, 'a+b', false],
            [false, '1 \\le n', false],
            [true, '\\frac{1}{2}', false],
            [true, 'unterminated', true],
        ]);
    });

    it('scans localized and structured statement sources', () => {
        const sources = statementSourcesForAudit(
            problem('P3001', {
                statementFormat: 'structured-v1',
                programmingStatement: {
                    background: { state: 'absent', content: '' },
                    description: { state: 'present', content: 'desc $x$' },
                    input: { state: 'present', content: '' },
                    output: { state: 'present', content: '' },
                    examples: { state: 'present', items: [{ input: '1', output: '1', note: 'note $y$' }] },
                    hints: { state: 'absent', content: '' },
                },
                content: '{"zh":"学生 $z$","en":"ok"}',
            }),
        );
        expect(sources.map((item) => item.path)).to.deep.equal([
            'programmingStatement.description',
            'programmingStatement.examples.0.note',
            'content.zh',
            'content.en',
        ]);
    });

    it('reports KaTeX failures and mechanical suggestions without rewriting successes', async () => {
        const report = await runProblemAudit({
            kind: 'latex',
            adapter: new FixtureAdapter([
                problem('P3001', {
                    title: '1001 A+B',
                    content: 'good $a+b$ and bad $\\mbox{hi}$ and broken $$\\frac{1}{',
                }),
            ]),
            renderLatex: renderLatexWithKatex,
        });
        expect(report.summary.mathSpans).to.equal(3);
        expect(report.latex?.map((item) => item.latex)).to.deep.equal(['\\mbox{hi}', '\\frac{1}{']);
        const mbox = report.latex?.find((item) => item.latex === '\\mbox{hi}');
        expect(mbox?.suggested).to.equal('\\text{hi}');
        expect(mbox?.reason).to.equal('katex');
        const broken = report.latex?.find((item) => item.latex === '\\frac{1}{');
        expect(broken?.reason).to.equal('unterminated');
    });

    it('only treats dollar delimiters as math and flags silent \\\\le as double-backslash', async () => {
        const report = await runProblemAudit({
            kind: 'latex',
            adapter: new FixtureAdapter([
                problem('P3002', {
                    content: 'not math \\(x^2\\) but bad $a \\\\le b$ and good $a \\le b$.',
                }),
            ]),
            renderLatex: renderLatexWithKatex,
        });
        expect(report.summary.mathSpans).to.equal(2);
        expect(report.latex).to.have.length(1);
        expect(report.latex?.[0]).to.include({ reason: 'double-backslash', latex: 'a \\\\le b', suggested: 'a \\le b' });
    });
});

describe('problem audit testdata eol', () => {
    it('classifies lf, crlf, mixed and binary', () => {
        expect(classifyTestdataEol(Buffer.from('a\nb\n')).kind).to.equal('lf');
        expect(classifyTestdataEol(Buffer.from('a\r\nb\r\n')).kind).to.equal('crlf');
        expect(classifyTestdataEol(Buffer.from('a\rb\r')).kind).to.equal('cr');
        expect(classifyTestdataEol(Buffer.from('a\r\nb\nc')).kind).to.equal('mixed');
        expect(classifyTestdataEol(Buffer.from('a')).kind).to.equal('none');
        expect(classifyTestdataEol(Buffer.from([0x61, 0x00, 0x62])).binary).to.equal(true);
        expect(shouldScanTestdataName('1.in')).to.equal('text');
        expect(shouldScanTestdataName('pic.png')).to.equal('skip');
        expect(shouldScanTestdataName('checker')).to.equal('sniff');
    });

    it('keeps only non-lf and skipped testdata in the report', async () => {
        const adapter = new FixtureAdapter(
            [problem('P3001', { docId: 3001 })],
            new Map<string, Buffer | 'missing'>([
                ['system/3001/1.in', Buffer.from('1\n')],
                ['system/3001/1.out', Buffer.from('1\r\n')],
                ['system/3001/2.in', Buffer.from([0x00, 0x01])],
                ['system/3001/missing.out', 'missing'],
            ]),
        );
        const report = await runProblemAudit({ kind: 'testdata-eol', adapter });
        expect(report.summary.lf).to.equal(1);
        expect(report.summary.crlf).to.equal(1);
        expect(report.summary.binary).to.equal(1);
        expect(report.summary.missing).to.equal(1);
        expect(report.testdataEol?.map((item) => [item.name, item.eol, item.skipReason || ''])).to.deep.equal([
            ['1.out', 'crlf', ''],
            ['2.in', 'skipped', 'binary'],
            ['missing.out', 'skipped', 'missing'],
        ]);
    });
});

describe('problem audit PAT inventory', () => {
    it('does not treat P3xxx as a PAT problem number and flags exact-text checkers', () => {
        const row = inspectPatProblem(
            problem('P3001', {
                title: '1001 A+B Format',
                pidNamespaceId: BUILTIN_PID_NAMESPACE_IDS.patBasic,
                sourceMeta: { template: 'pat_basic', year: 2024, season: 'spring' },
                config: { checker_type: 'default', time: '1s', memory: '256m' },
                data: [{ name: '1.in' }, { name: '1.out' }, { name: '2.in' }],
            }),
        );
        expect(row.patProblemId).to.equal('1001');
        expect(row.patGuessSource).to.equal('title');
        expect(row.flags).to.include('text_exact_checker');
        expect(row.flags).to.include('unpaired_cases');
        expect(row.unpairedInputs).to.deep.equal(['2.in']);
        expect(row.caseCount).to.equal(1);
    });

    it('uses --pat-map over title and keeps unmapped P4 as unknown', () => {
        const mapped = inspectPatProblem(problem('P4001', { title: 'Graph' }), { P4001: '1003' });
        expect(mapped.patProblemId).to.equal('1003');
        expect(mapped.patGuessSource).to.equal('map');
        const unknown = inspectPatProblem(problem('P4002', { title: 'Graph' }));
        expect(unknown.patProblemId).to.equal(null);
        expect(unknown.flags).to.include('pat_id_unknown');
        expect(unknown.flags).to.include('namespace_missing');
        expect(unknown.flags).to.include('legacy_pid_shape');
    });

    it('parses pat map JSON objects', () => {
        expect(parsePatMap({ 'system/P3001': '1001', P3002: '1002' })).to.include({ P3001: '1001', P3002: '1002', 'system/P3001': '1001' });
        expect(() => parsePatMap({ P3001: 'nope' })).to.throw(ProblemAuditError);
    });
});

describe('problem audit CLI protocol', () => {
    let tempRoot: string;
    let harnessPath: string;
    let reportPath: string;

    before(async () => {
        tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'problem-audit-'));
        harnessPath = path.join(tempRoot, 'command-harness.cjs');
        reportPath = path.join(tempRoot, 'report.json');
        await fsp.writeFile(
            harnessPath,
            `
const cacModule = require(${JSON.stringify(require.resolve('cac'))});
const cac = cacModule.default || cacModule;
const { register } = require(${JSON.stringify(require.resolve('../src/commands/problem-audit.ts'))});
const adapter = {
  async loadProblems() {
    return [{
      domainId: 'system', docId: 3001, pid: 'P3001', title: '1001 A+B',
      content: 'ok $a+b$ bad $\\\\mbox{x}$',
      pidNamespaceId: 'builtin:pat-basic',
      config: { checker_type: 'default' },
      data: [{ name: '1.in' }, { name: '1.out' }],
    }];
  },
  async listTestdataFiles() {
    return [{ domainId: 'system', docId: 3001, pid: 'P3001', title: '1001 A+B', name: '1.out', size: 4 }];
  },
  async readTestdata() { return { bytes: Buffer.from('1\\r\\n') }; },
  async close() { process.stdout.write('runtime-close\\n'); },
};
const cli = cac();
register(cli, { loadAdapter: async () => { process.stdout.write('runtime-load\\n'); return adapter; } });
cli.parse(process.argv, { run: false });
Promise.resolve(cli.runMatchedCommand()).catch((error) => {
  process.stderr.write(String(error && (error.stack || error.message) || error) + '\\n', () => process.exit(1));
});
`,
        );
    });

    after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));

    it('keeps stdout as one JSON record and writes markdown beside the report', async () => {
        const run = (kind: string, args: string[] = []) =>
            childProcess.spawnSync(process.execPath, ['-r', '@hydrooj/register', harnessPath, 'problem:audit', kind, reportPath, ...args], {
                cwd: path.resolve(__dirname, '../../..'),
                encoding: 'utf8',
                timeout: 8000,
            });

        const latex = run('latex');
        expect(latex.status, latex.stderr || latex.stdout).to.equal(0);
        const latexOutput = JSON.parse(latex.stdout);
        expect(latexOutput).to.include({ ok: true, kind: 'latex', reportPath });
        expect(latex.stderr).to.include('runtime-load');
        expect(latex.stderr).to.include('runtime-close');
        expect(fs.existsSync(reportPath.replace(/\.json$/, '.md'))).to.equal(true);
        const latexReport = JSON.parse(await fsp.readFile(reportPath, 'utf8'));
        expect(latexReport.latex.some((item: { latex: string }) => item.latex.includes('mbox'))).to.equal(true);

        const refused = run('nope');
        expect(refused.status).not.to.equal(0);
        expect(refused.stdout).to.equal('');
        expect(JSON.parse(refused.stderr).error.code).to.equal('PROBLEM_AUDIT_KIND_INVALID');

        const pat = run('pat', ['--pid', 'P3001']);
        expect(pat.status, pat.stderr || pat.stdout).to.equal(0);
        expect(JSON.parse(pat.stdout).summary.textExactChecker).to.equal(1);

        const eol = run('testdata-eol');
        expect(eol.status, eol.stderr || eol.stdout).to.equal(0);
        expect(JSON.parse(eol.stdout).summary.crlf).to.equal(1);
    });

    it('persists a fingerprint that covers findings', async () => {
        const report = await runProblemAudit({
            kind: 'pat',
            adapter: new FixtureAdapter([problem('P3001', { title: '1001 A+B', pidNamespaceId: BUILTIN_PID_NAMESPACE_IDS.patBasic })]),
        });
        const persisted = await persistProblemAuditReport(path.join(tempRoot, 'pat.json'), report);
        const disk = JSON.parse(await fsp.readFile(persisted.reportPath, 'utf8'));
        expect(disk.fingerprint).to.equal(report.fingerprint);
        expect(disk.fingerprint).to.match(/^[a-f0-9]{64}$/);
    });
});
