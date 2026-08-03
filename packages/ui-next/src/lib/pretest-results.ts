export interface PretestCaseResult {
  id?: number;
  status: number;
  time: number;
  memory: number;
  message?: string;
}

export interface PretestResult {
  status?: number;
  score?: number;
  time?: number;
  memory?: number;
  compilerTexts?: string[];
  judgeTexts?: string[];
  testCases?: PretestCaseResult[];
  stdout?: string;
  stderr?: string;
  error?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Hydro's JSON renderer may return handler data directly or inside the
 * UINext bootstrap envelope. Record polling must understand both shapes;
 * otherwise a completed record is mistaken for an object with no `status`
 * and remains pending until the client-side timeout.
 */
export function parseRecordResponse(payload: unknown): PretestResult & { status: number } {
  if (!isRecord(payload)) throw new Error('评测记录接口返回了无效 JSON');

  let candidate: Record<string, unknown> = payload;
  if (isRecord(payload.rdoc)) {
    candidate = payload.rdoc;
  } else if (isRecord(payload.page) && isRecord(payload.page.data) && isRecord(payload.page.data.rdoc)) {
    candidate = payload.page.data.rdoc;
  }

  if (typeof candidate.status !== 'number') throw new Error('评测记录响应缺少有效状态');
  return { ...candidate, status: candidate.status };
}

export type SelfTestVerdict = 'ac' | 'wa' | 'ran' | 'fail' | 'pending' | 'none';
export type PretestResultTab = 'output' | 'diff' | 'compiler';

export function isPendingJudgeStatus(status: number): boolean {
  return status === 0 || status === 20 || status === 21 || status === 22;
}

export function isTerminalJudgeStatus(status: number | undefined): status is number {
  return typeof status === 'number' && !isPendingJudgeStatus(status);
}

export function normalizePretestLineEndings(value: string): string {
  return value.replace(/\r\n?/g, '\n');
}

export function pretestOutputsMatch(actual: string, expected: string): boolean {
  return normalizePretestLineEndings(actual).trim() === normalizePretestLineEndings(expected).trim();
}

export function preferredPretestResultTab(result: PretestResult): PretestResultTab {
  const hasCompilerDiagnostics =
    result.compilerTexts?.some((text) => text.trim().length > 0) || (typeof result.stderr === 'string' && result.stderr.trim().length > 0);
  if (result.status === 7 && hasCompilerDiagnostics) return 'compiler';
  return 'output';
}

export function pretestActualOutput(result: Pick<PretestResult, 'testCases' | 'stdout' | 'judgeTexts'> | null | undefined): string {
  return normalizePretestLineEndings(result?.testCases?.[0]?.message || result?.stdout || result?.judgeTexts?.join('\n') || '');
}

export function selfTestVerdict(
  result: Pick<PretestResult, 'status' | 'testCases' | 'stdout' | 'judgeTexts'> | null | undefined,
  expectedOutput: string,
): SelfTestVerdict {
  const status = result?.status;
  if (status == null) return 'none';
  if (isPendingJudgeStatus(status)) return 'pending';
  if (status !== 1) return 'fail';
  if (expectedOutput.trim().length === 0) return 'ran';
  return pretestOutputsMatch(pretestActualOutput(result), expectedOutput) ? 'ac' : 'wa';
}

export function distributePretestRecord(rdoc: PretestResult, tabIds: string[]): Map<string, PretestResult> {
  const cases = Array.isArray(rdoc.testCases) ? rdoc.testCases : [];
  const casesById = new Map<number, PretestCaseResult>();
  for (const testCase of cases) {
    if (!Number.isInteger(testCase.id) || (testCase.id as number) < 1 || (testCase.id as number) > tabIds.length) {
      throw new Error(`评测机返回了无效的自测点编号：${String(testCase.id)}`);
    }
    if (casesById.has(testCase.id as number)) throw new Error(`评测机重复返回自测点 #${testCase.id}`);
    casesById.set(testCase.id as number, testCase);
  }

  if (rdoc.status === 1 && casesById.size !== tabIds.length) {
    const missing = tabIds.map((_, index) => index + 1).filter((id) => !casesById.has(id));
    throw new Error(`评测已结束，但缺少自测点结果：${missing.map((id) => `#${id}`).join('、')}`);
  }

  return new Map(
    tabIds.map((tabId, index) => {
      const testCase = casesById.get(index + 1);
      return [
        tabId,
        testCase
          ? {
              status: testCase.status,
              time: testCase.time,
              memory: testCase.memory,
              testCases: [testCase],
              compilerTexts: rdoc.compilerTexts,
              judgeTexts: rdoc.judgeTexts,
              stderr: rdoc.stderr,
              error: rdoc.error,
            }
          : {
              status: rdoc.status ?? 0,
              time: rdoc.time,
              memory: rdoc.memory,
              compilerTexts: rdoc.compilerTexts,
              judgeTexts: rdoc.judgeTexts,
              stdout: rdoc.stdout,
              stderr: rdoc.stderr,
              error: rdoc.error,
            },
      ];
    }),
  );
}
