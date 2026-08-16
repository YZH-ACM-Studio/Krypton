// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  buildCompanionTask,
  companionPostUrl,
  companionProblemName,
  javaTaskClassFromName,
  sendCompanionTask,
} from '../src/lib/competitive-companion';

const problemDetail = readFileSync(resolve(import.meta.dirname, '../src/pages/problem-detail.tsx'), 'utf8');

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
  });

  it('posts text/plain JSON to CPH and companion ports without a CORS preflight', async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => ({ ok: true }));
    const task = buildCompanionTask({
      name: 'A',
      url: 'http://oj.test/p/A',
      timeLimitMs: 1000,
      memoryLimitMb: 256,
      tests: [],
    });
    const accepted = await sendCompanionTask(task, fetchImpl as unknown as typeof fetch);
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
});
