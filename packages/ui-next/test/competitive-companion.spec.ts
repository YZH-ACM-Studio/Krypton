// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  buildCompanionTask,
  companionContestEligibility,
  companionContestName,
  companionPostUrl,
  companionProblemName,
  companionTaskFromProblemPage,
  contestProblemLetter,
  createCompanionBatch,
  importContestCompanionTasks,
  javaTaskClassFromName,
  mapCompanionLanguage,
  readCompanionSourceFile,
  sameOriginCompanionUrl,
  sendCompanionTask,
  sendCompanionTasks,
  submitCompanionSolution,
} from '../src/lib/competitive-companion';

const problemDetail = readFileSync(resolve(import.meta.dirname, '../src/pages/problem-detail.tsx'), 'utf8');
const contestManage = readFileSync(resolve(import.meta.dirname, '../src/pages/contest-manage.tsx'), 'utf8');
const examContest = readFileSync(resolve(import.meta.dirname, '../src/pages/exam-mode/contest.tsx'), 'utf8');

function programmingPayload(overrides: Record<string, unknown> = {}) {
  return {
    pdoc: {
      pid: 'H1000',
      docId: 1000,
      title: 'A + B Problem',
      problemKind: 'programming',
      content: '```input1\n1 2\n```\n```output1\n3\n```',
      config: { type: 'default', time: '1s', memory: '256m' },
      ...overrides,
    },
  };
}

describe('competitive companion payload', () => {
  it('builds the CPH Task JSON that Hydro fixtures use', () => {
    const task = buildCompanionTask({
      name: companionProblemName('H1000', 'A + B Problem'),
      group: 'Krypton',
      url: 'http://10.1.234.2/p/H1000',
      timeLimitMs: 1000,
      memoryLimitMb: 256,
      tests: [
        { input: '1 2', output: '3' },
        { input: '3 4\n', output: '7\n' },
      ],
    });

    expect(task).to.deep.include({
      name: '#H1000. A + B Problem',
      group: 'Krypton',
      url: 'http://10.1.234.2/p/H1000',
      interactive: false,
      memoryLimit: 256,
      timeLimit: 1000,
      testType: 'single',
      input: { type: 'stdin' },
      output: { type: 'stdout' },
    });
    expect(task.tests).to.deep.equal([
      { input: '1 2\n', output: '3\n' },
      { input: '3 4\n', output: '7\n' },
    ]);
    expect(task.languages.java).to.deep.equal({ mainClass: 'Main', taskClass: 'H1000ABProblem' });
  });

  it('derives a Java task class the same way Competitive Companion does', () => {
    expect(javaTaskClassFromName('#H1000. A + B Problem')).to.equal('H1000ABProblem');
    expect(javaTaskClassFromName('???')).to.equal('Task');
  });

  it('falls back to safe limits when the judge config is missing', () => {
    const task = buildCompanionTask({
      name: 'P',
      url: 'http://oj.test/p/P',
      timeLimitMs: Number.NaN,
      memoryLimitMb: 0,
      tests: [],
    });
    expect(task.timeLimit).to.equal(1000);
    expect(task.memoryLimit).to.equal(256);
  });

  it('keeps the problem page bridge off Exam Mode', () => {
    expect(problemDetail).to.include('<CompetitiveCompanionBridge');
    expect(problemDetail).to.match(/const showCompanion = !examMode\?\.enabled/);
    expect(problemDetail).to.match(/tdoc\?\.participationMode !== 'team'/);
    expect(problemDetail).to.include('canSubmitBack={canSubmitBack}');
  });

  it('posts text/plain JSON to CPH and companion ports without a CORS preflight', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(null, { status: 200 }));
    const task = buildCompanionTask({
      name: 'A',
      url: 'http://oj.test/p/A',
      timeLimitMs: 1000,
      memoryLimitMb: 256,
      tests: [],
    });
    const accepted = await sendCompanionTask(task, fetchImpl);
    expect(accepted).to.equal(14);
    expect(fetchImpl.mock.calls.length).to.equal(14);
    const firstCall = fetchImpl.mock.calls[0];
    expect(firstCall).not.to.equal(undefined);
    if (!firstCall) throw new Error('companion fetch was not called');
    const [url, init] = firstCall;
    expect(init).not.to.equal(undefined);
    if (!init) throw new Error('companion fetch request options were missing');
    expect(String(url)).to.equal(companionPostUrl('127.0.0.1', 27121));
    expect(init.method).to.equal('POST');
    expect(init.mode).to.equal('no-cors');
    expect(String(init.headers && (init.headers as Record<string, string>)['Content-Type'])).to.match(/^text\/plain/);
    expect(JSON.parse(String(init.body))).to.deep.include({ name: 'A', timeLimit: 1000 });
  });

  it('fails closed when no companion listener accepts the task', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      throw new TypeError('Failed to fetch');
    });
    await expect(
      sendCompanionTask(
        buildCompanionTask({
          name: 'A',
          url: 'http://oj.test/p/A',
          timeLimitMs: 1000,
          memoryLimitMb: 256,
          tests: [],
        }),
        fetchImpl,
      ),
    ).rejects.toThrow(/本机没有收到题目/);
  });
});

describe('contest companion eligibility', () => {
  it('allows only individual ACM/IOI contests', () => {
    expect(companionContestEligibility({ rule: 'acm', participationMode: 'individual', problemCount: 3 })).to.deep.equal({ allowed: true });
    expect(companionContestEligibility({ rule: 'ioi', problemCount: 1 })).to.deep.equal({ allowed: true });
    expect(companionContestEligibility({ rule: 'strictioi', problemCount: 2 })).to.deep.equal({ allowed: true });
  });

  it('refuses exam mode, team ACM, OI/homework/exam rules, and empty lists', () => {
    expect(companionContestEligibility({ rule: 'acm', examModeEnabled: true, problemCount: 3 })).to.include({ allowed: false, reason: 'exam_mode' });
    expect(companionContestEligibility({ rule: 'acm', participationMode: 'team', problemCount: 3 })).to.include({ allowed: false, reason: 'team' });
    expect(companionContestEligibility({ rule: 'oi', problemCount: 3 })).to.include({ allowed: false, reason: 'rule' });
    expect(companionContestEligibility({ rule: 'homework', problemCount: 3 })).to.include({ allowed: false, reason: 'rule' });
    expect(companionContestEligibility({ rule: 'exam', problemCount: 3 })).to.include({ allowed: false, reason: 'rule' });
    expect(companionContestEligibility({ rule: 'acm', problemCount: 0 })).to.include({ allowed: false, reason: 'empty' });
  });

  it('names contest problems with the alphabetic letter', () => {
    expect(contestProblemLetter(0)).to.equal('A');
    expect(contestProblemLetter(25)).to.equal('Z');
    expect(contestProblemLetter(26)).to.equal('AA');
    expect(companionContestName('A', 'Watermelon')).to.equal('A. Watermelon');
  });

  it('wires the contest list button and keeps the exam-mode shell on the same page', () => {
    expect(contestManage).to.include('<ContestCompanionBridge');
    expect(contestManage).to.include('companionContestEligibility');
    expect(examContest).to.include('ContestProblemListPage');
  });
});

describe('contest companion import', () => {
  it('builds a CC batch and skips non-programming problems', async () => {
    const pages = new Map<string, unknown>([
      ['/p/1?tid=t', programmingPayload({ title: 'Add' })],
      ['/p/2?tid=t', programmingPayload({ title: 'Quiz', problemKind: 'objective', config: { type: 'objective' } })],
      [
        '/p/3?tid=t',
        programmingPayload({
          title: 'Chat',
          config: { type: 'interactive', time: 2000, memory: 128 },
          programmingStatementView: { examples: { items: [{ input: 'hi', output: 'ho' }] } },
          content: '',
        }),
      ],
    ]);
    const result = await importContestCompanionTasks(
      {
        eligibility: { allowed: true },
        contestTitle: '校赛',
        origin: 'http://oj.test',
        problems: [
          { letter: 'A', title: 'Add', href: '/p/1?tid=t' },
          { letter: 'B', title: 'Quiz', href: '/p/2?tid=t' },
          { letter: 'C', title: 'Chat', href: '/p/3?tid=t' },
        ],
      },
      async (href) => {
        const payload = pages.get(href);
        if (!payload) throw new Error(`missing ${href}`);
        return payload;
      },
    );
    expect(result.skipped).to.deep.equal([{ letter: 'B', reason: '非编程题不能导入 CPH' }]);
    expect(result.tasks.map((task) => task.name)).to.deep.equal(['A. Add', 'C. Chat']);
    expect(result.tasks[0]?.group).to.equal('Krypton - 校赛');
    expect(result.tasks[0]?.batch).to.deep.include({ size: 2 });
    expect(result.tasks[1]?.batch?.id).to.equal(result.tasks[0]?.batch?.id);
    expect(result.tasks[1]?.interactive).to.equal(true);
    expect(result.tasks[1]?.tests).to.deep.equal([{ input: 'hi\n', output: 'ho\n' }]);
    expect(result.tasks[1]?.timeLimit).to.equal(2000);
    expect(result.tasks[1]?.memoryLimit).to.equal(128);
  });

  it('refuses exam-mode payloads and empty programming sets', async () => {
    await expect(
      importContestCompanionTasks({
        eligibility: companionContestEligibility({ rule: 'acm', participationMode: 'team', problemCount: 1 }),
        contestTitle: '队赛',
        origin: 'http://oj.test',
        problems: [{ letter: 'A', title: 'A', href: '/p/1' }],
      }),
    ).rejects.toThrow(/团队赛/);

    await expect(
      importContestCompanionTasks(
        {
          eligibility: { allowed: true },
          contestTitle: '校赛',
          origin: 'http://oj.test',
          problems: [{ letter: 'A', title: 'A', href: '/p/1' }],
        },
        async () => ({ examMode: { enabled: true }, pdoc: { title: 'secret' } }),
      ),
    ).rejects.toThrow(/考试壳/);
  });

  it('sends the imported batch sequentially', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(null, { status: 200 }));
    const batch = createCompanionBatch(2, 99);
    const tasks = [
      buildCompanionTask({ name: 'A', url: 'http://oj.test/p/1', timeLimitMs: 1000, memoryLimitMb: 256, tests: [], batch }),
      buildCompanionTask({ name: 'B', url: 'http://oj.test/p/2', timeLimitMs: 1000, memoryLimitMb: 256, tests: [], batch }),
    ];
    await sendCompanionTasks(tasks, fetchImpl);
    expect(fetchImpl.mock.calls.length).to.equal(28);
    expect(JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body)).batch).to.deep.equal({ id: 99, size: 2 });
  });
});

describe('companion submit-back', () => {
  it('maps CPH filenames and compiler ids onto Hydro langs', () => {
    expect(mapCompanionLanguage({ filename: 'A.cpp', allowedLangs: ['cc.cc17', 'py.py3'] })).to.deep.equal({ lang: 'cc.cc17' });
    expect(mapCompanionLanguage({ filename: 'A.cpp', allowedLangs: ['cc.cc20o2'] })).to.deep.equal({ lang: 'cc.cc20o2' });
    expect(mapCompanionLanguage({ filename: 'main.py', allowedLangs: [] })).to.deep.equal({ lang: 'py.py3' });
    expect(mapCompanionLanguage({ languageId: 54, allowedLangs: ['cc.cc14'] })).to.deep.equal({ lang: 'cc.cc14' });
    expect(mapCompanionLanguage({ filename: 'Main.java', allowedLangs: ['_'] })).to.deep.include({ reason: '这道题不是编程提交，不能从 CPH 回传' });
    expect(mapCompanionLanguage({ filename: 'a.rs', allowedLangs: ['cc.cc17'] })).to.deep.include({ reason: '这道题不允许该语言' });
  });

  it('reads a source file and rejects empty or oversized ones', async () => {
    const ok = new File(['int main(){}\n'], 'A.cpp', { type: 'text/plain' });
    expect(await readCompanionSourceFile(ok)).to.equal('int main(){}\n');
    const empty = new File(['   '], 'A.cpp', { type: 'text/plain' });
    await expect(readCompanionSourceFile(empty)).rejects.toThrow(/空/);
    const huge = new File([new Uint8Array(8)], 'A.cpp', { type: 'text/plain' });
    Object.defineProperty(huge, 'size', { value: 3 * 1024 * 1024 });
    await expect(readCompanionSourceFile(huge)).rejects.toThrow(/超过/);
  });

  it('posts the existing problem submit FormData and keeps the record URL on-origin', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ rid: 'r1', url: '/record/r1' }), { status: 200 }));
    const result = await submitCompanionSolution(
      {
        submitUrl: '/p/H1000/submit?tid=abc',
        lang: 'cc.cc17',
        code: 'int main(){}',
        origin: 'http://oj.test',
        tid: 'abc',
      },
      fetchImpl,
    );
    expect(result).to.deep.equal({ rid: 'r1', url: '/record/r1' });
    const init = fetchImpl.mock.calls[0]?.[1];
    expect(init?.method).to.equal('POST');
    expect(init?.headers && (init.headers as Record<string, string>).Accept).to.equal('application/json');
    const body = init?.body;
    expect(body).to.be.instanceOf(FormData);
    const form = body as FormData;
    expect(form.get('lang')).to.equal('cc.cc17');
    expect(form.get('code')).to.equal('int main(){}');
    expect(form.get('tid')).to.equal('abc');
    expect(() => sameOriginCompanionUrl('https://evil.test/record/x', 'http://oj.test')).to.throw(/非本站/);
  });

  it('refuses exam-mode problem pages at the task builder', () => {
    const built = companionTaskFromProblemPage({
      payload: { examMode: { enabled: true }, pdoc: { title: 'hidden', config: { type: 'default' } } },
      url: 'http://oj.test/p/1',
    });
    expect(built).to.deep.equal({ ok: false, reason: '考试壳题目不能导入 CPH' });
  });
});
