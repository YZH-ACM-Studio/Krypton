import { describe, expect, it } from 'vitest';
import { structuredCodeCompletionIssues } from '../src/lib/structured-code-readiness';

const validRegion = { id: 'r_abcdefghijkl', startLine: 1, endLine: 2 };

describe('structured code completion readiness', () => {
  it('reports every actionable compile-mode problem with its owning stage', () => {
    expect(
      structuredCodeCompletionIssues({
        kind: 'function',
        compileMode: true,
        source: '',
        lang: '',
        regions: [],
        publicRanges: [{ startLine: 0, endLine: 1, invalid: true }],
        selectedKnowledgeCount: 0,
        hasInvalidKnowledge: true,
        cases: [
          { input: 'same.txt', output: 'same.txt' },
          { input: 'missing.in', output: 'missing.out' },
        ],
        files: [{ name: 'same.txt' }],
      }).map(({ stage, message }) => ({ stage, message })),
    ).toEqual([
      { stage: 'template', message: '请输入完整模板源码' },
      { stage: 'metadata', message: '请选择评测语言' },
      { stage: 'template', message: '至少设置一个作答区域' },
      { stage: 'template', message: '请修复或删除失效的公开区域' },
      { stage: 'metadata', message: '至少选择一个有效知识节点' },
      { stage: 'metadata', message: '请移除失效的知识节点' },
      { stage: 'testdata', message: '测试点 1 的输入和输出不能使用同一个文件' },
      { stage: 'testdata', message: '测试点 2 的输入文件不存在' },
      { stage: 'testdata', message: '测试点 2 的输出文件不存在' },
    ]);
  });

  it('accepts text program-fill without a language or testdata and rejects multi-line blanks', () => {
    const base = {
      kind: 'program_fill' as const,
      compileMode: false,
      source: 'int x = 0;\nx++;',
      lang: '',
      publicRanges: [],
      selectedKnowledgeCount: 1,
      hasInvalidKnowledge: false,
      cases: [],
      files: [],
    };

    expect(structuredCodeCompletionIssues({ ...base, regions: [validRegion] })).toEqual([]);
    expect(structuredCodeCompletionIssues({ ...base, regions: [{ ...validRegion, endLine: 3 }] })).toEqual([
      { stage: 'template', message: '程序填空题的每个作答区必须恰好占一行' },
    ]);
  });

  it('accepts a complete compiled structured problem', () => {
    expect(
      structuredCodeCompletionIssues({
        kind: 'function',
        compileMode: true,
        source: 'int solve() { return 1; }',
        lang: 'cc.cc20',
        regions: [validRegion],
        publicRanges: [],
        selectedKnowledgeCount: 1,
        hasInvalidKnowledge: false,
        cases: [{ input: '1.in', output: '1.out' }],
        files: [{ name: '1.in' }, { name: '1.out' }],
      }),
    ).toEqual([]);
  });
});
