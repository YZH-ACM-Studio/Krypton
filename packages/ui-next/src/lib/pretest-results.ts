export interface PretestCaseResult {
  id?: number;
  status: number;
  time: number;
  memory: number;
  message?: string;
}

export interface PretestResult {
  status?: number;
  time?: number;
  memory?: number;
  compilerTexts?: string[];
  judgeTexts?: string[];
  testCases?: PretestCaseResult[];
  stdout?: string;
  stderr?: string;
  error?: string;
}

export type SelfTestVerdict = 'ac' | 'wa' | 'ran' | 'fail' | 'pending' | 'none';

export function pretestActualOutput(result: Pick<PretestResult, 'testCases' | 'stdout' | 'judgeTexts'> | null | undefined): string {
  return result?.testCases?.[0]?.message || result?.stdout || result?.judgeTexts?.join('\n') || '';
}

export function selfTestVerdict(
  result: Pick<PretestResult, 'status' | 'testCases' | 'stdout' | 'judgeTexts'> | null | undefined,
  expectedOutput: string,
): SelfTestVerdict {
  const status = result?.status;
  if (status == null) return 'none';
  if (status !== 1) return status >= 2 && status < 20 ? 'fail' : 'pending';
  if (expectedOutput.trim().length === 0) return 'ran';
  return pretestActualOutput(result).trim() === expectedOutput.trim() ? 'ac' : 'wa';
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
            }
          : {
              status: rdoc.status ?? 0,
              compilerTexts: rdoc.compilerTexts,
              judgeTexts: rdoc.judgeTexts,
            },
      ];
    }),
  );
}
