/**
 * Competitive Companion / CPH payload for public problem samples.
 *
 * Competitive Companion's Hydro parser only auto-matches a hardcoded domain
 * list and scrapes ui-default selectors. This module:
 *   1. Builds the same JSON Task shape CPH listens for on :27121
 *   2. Posts it as a simple (non-preflight) request so an HTTPS/HTTP OJ
 *      page can reach localhost without CORS
 *
 * Exam Mode must not call these helpers.
 */

export const CPH_PORT = 27121;

/** Same default listeners Competitive Companion fans out to. */
export const COMPANION_PORTS = [27121, 1327, 4244, 6174, 10042, 10043, 10045] as const;

export interface CompanionTest {
  input: string;
  output: string;
}

export interface CompanionTask {
  name: string;
  group: string;
  url: string;
  interactive: boolean;
  memoryLimit: number;
  timeLimit: number;
  tests: CompanionTest[];
  testType: 'single';
  input: { type: 'stdin' };
  output: { type: 'stdout' };
  languages: { java: { mainClass: string; taskClass: string } };
}

export function javaTaskClassFromName(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9_ -]/g, '');
  let taskClass = '';
  let nextCapital = true;
  for (const char of cleaned) {
    const isLetter = /[a-z]/i.test(char);
    const isDigit = /[0-9]/.test(char);
    if (isLetter || (isDigit && taskClass.length > 0)) {
      taskClass += nextCapital ? char.toUpperCase() : char;
      nextCapital = false;
    } else {
      nextCapital = true;
    }
  }
  return taskClass || 'Task';
}

export function companionProblemName(pid: string, title: string): string {
  const id = pid.trim();
  const heading = title.trim() || id || 'Problem';
  if (!id || heading === id || heading.startsWith(`#${id}`)) return heading;
  return `#${id}. ${heading}`;
}

function withTrailingNewline(text: string): string {
  if (!text) return '';
  return text.endsWith('\n') ? text : `${text}\n`;
}

export function buildCompanionTask(input: {
  name: string;
  group?: string;
  url: string;
  timeLimitMs: number;
  memoryLimitMb: number;
  tests: CompanionTest[];
  interactive?: boolean;
}): CompanionTask {
  const name = input.name.trim() || 'Problem';
  const timeLimit = Number.isFinite(input.timeLimitMs) && input.timeLimitMs > 0 ? Math.floor(input.timeLimitMs) : 1000;
  const memoryLimit = Number.isFinite(input.memoryLimitMb) && input.memoryLimitMb > 0 ? Math.floor(input.memoryLimitMb) : 256;
  return {
    name,
    group: (input.group || 'Krypton').trim() || 'Krypton',
    url: input.url,
    interactive: input.interactive === true,
    memoryLimit,
    timeLimit,
    tests: input.tests.map((test) => ({
      input: withTrailingNewline(test.input),
      output: withTrailingNewline(test.output),
    })),
    testType: 'single',
    input: { type: 'stdin' },
    output: { type: 'stdout' },
    languages: {
      java: {
        mainClass: 'Main',
        taskClass: javaTaskClassFromName(name),
      },
    },
  };
}

export function companionPostUrl(host: string, port: number): string {
  return `http://${host}:${port}/`;
}

export async function sendCompanionTask(task: CompanionTask, fetchImpl: typeof fetch = fetch): Promise<number> {
  const body = JSON.stringify(task);
  const attempts = COMPANION_PORTS.flatMap((port) =>
    ['127.0.0.1', 'localhost'].map((host) =>
      fetchImpl(companionPostUrl(host, port), {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
        body,
      }).then(
        () => true,
        () => false,
      ),
    ),
  );
  const settled = await Promise.all(attempts);
  return settled.filter(Boolean).length;
}
