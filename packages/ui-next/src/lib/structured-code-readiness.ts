export type StructuredAuthorStage = 'metadata' | 'template' | 'testdata' | 'review';

export interface StructuredCodeCompletionIssue {
  stage: Exclude<StructuredAuthorStage, 'review'>;
  message: string;
}

interface StructuredRange {
  startLine: number;
  endLine: number;
  invalid?: boolean;
}

interface StructuredCase {
  input: string;
  output: string;
}

interface StructuredFile {
  name: string;
}

export interface StructuredCodeCompletionInput {
  kind: 'program_fill' | 'function';
  compileMode: boolean;
  title?: string;
  source: string;
  lang: string;
  regions: StructuredRange[];
  publicRanges: StructuredRange[];
  selectedKnowledgeCount: number;
  hasInvalidKnowledge: boolean;
  cases: StructuredCase[];
  files: StructuredFile[];
}

export function structuredCodeCompletionIssues(input: StructuredCodeCompletionInput): StructuredCodeCompletionIssue[] {
  const issues: StructuredCodeCompletionIssue[] = [];
  if (input.title !== undefined && !input.title.trim()) issues.push({ stage: 'metadata', message: '请输入题目标题' });
  if (!input.source.trim()) issues.push({ stage: 'template', message: '请输入完整模板源码' });
  if (input.compileMode && !input.lang) issues.push({ stage: 'metadata', message: '请选择评测语言' });
  if (!input.regions.length) issues.push({ stage: 'template', message: '至少设置一个作答区域' });
  if (input.regions.some((region) => region.invalid)) issues.push({ stage: 'template', message: '请修复或删除失效的作答区域' });
  if (input.publicRanges.some((range) => range.invalid)) issues.push({ stage: 'template', message: '请修复或删除失效的公开区域' });
  if (input.kind === 'program_fill' && input.regions.some((region) => region.endLine !== region.startLine + 1)) {
    issues.push({ stage: 'template', message: '程序填空题的每个作答区必须恰好占一行' });
  }
  if (input.selectedKnowledgeCount === 0) issues.push({ stage: 'metadata', message: '至少选择一个有效知识节点' });
  if (input.hasInvalidKnowledge) issues.push({ stage: 'metadata', message: '请移除失效的知识节点' });
  if (!input.compileMode) return issues;

  const files = new Set(input.files.map((file) => file.name));
  if (!input.cases.length) issues.push({ stage: 'testdata', message: '至少映射一个测试点' });
  input.cases.forEach((testCase, index) => {
    const label = `测试点 ${index + 1}`;
    if (!testCase.input) issues.push({ stage: 'testdata', message: `${label} 还未选择输入文件` });
    else if (!files.has(testCase.input)) issues.push({ stage: 'testdata', message: `${label} 的输入文件不存在` });
    if (!testCase.output) issues.push({ stage: 'testdata', message: `${label} 还未选择输出文件` });
    else if (!files.has(testCase.output)) issues.push({ stage: 'testdata', message: `${label} 的输出文件不存在` });
    if (testCase.input && testCase.output && testCase.input === testCase.output) {
      issues.push({ stage: 'testdata', message: `${label} 的输入和输出不能使用同一个文件` });
    }
  });
  return issues;
}
