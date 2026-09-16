import { parse as parseYaml } from 'yaml';

export const OBJECTIVE_RECORD_KINDS = ['single', 'multi', 'true_false', 'blank', 'subjective'] as const;
export type ObjectiveRecordKind = (typeof OBJECTIVE_RECORD_KINDS)[number];

export interface ObjectiveQuestionView {
  key: string;
  kind?: string;
  prompt?: string;
  choices?: string[];
  score?: number;
  presentation?: string;
}

export interface ObjectiveAnswerRow {
  key: string;
  kind: string;
  prompt: string;
  selectedLabel: string;
  score: number;
  maxScore: number;
  correct: boolean | null;
  unanswered: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function isObjectiveRecordProblem(pdoc: { problemKind?: unknown; config?: unknown } | null | undefined): boolean {
  if (!pdoc) return false;
  if (typeof pdoc.problemKind === 'string' && (OBJECTIVE_RECORD_KINDS as readonly string[]).includes(pdoc.problemKind)) return true;
  if (!isRecord(pdoc.config)) return false;
  return pdoc.config.type === 'objective';
}

export function parseObjectiveSubmission(code: unknown): Record<string, unknown> {
  if (typeof code !== 'string' || !code.trim()) return {};
  try {
    const parsed = parseYaml(code.replace(/^\uFEFF/, ''));
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function choiceLabel(choices: string[] | undefined, token: string, presentation?: string): string {
  if (presentation === 'truefalse') {
    if (token === 'A') return '正确';
    if (token === 'B') return '错误';
  }
  if (/^[A-H]$/.test(token) && choices && choices[token.charCodeAt(0) - 65]) {
    return `${token}. ${choices[token.charCodeAt(0) - 65]}`;
  }
  return token;
}

function tokensOf(value: unknown): string[] {
  if (value == null || value === '') return [];
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  const text = String(value).trim();
  if (!text) return [];
  if (text.includes(',')) return text.split(',').map((item) => item.trim()).filter(Boolean);
  return [text];
}

function selectedLabel(question: ObjectiveQuestionView, value: unknown): string {
  const tokens = tokensOf(value);
  if (!tokens.length) return '未作答';
  if (question.kind === 'blank' || question.kind === 'subjective') return tokens.join('\n');
  return tokens.map((token) => choiceLabel(question.choices, token, question.presentation)).join('、');
}

function questionsFromConfig(config: unknown): ObjectiveQuestionView[] {
  if (!isRecord(config)) return [];
  if (Array.isArray(config.questions)) {
    return config.questions.flatMap((item) => {
      if (!isRecord(item) || typeof item.key !== 'string' || !item.key) return [];
      const choices = Array.isArray(item.choices) ? item.choices.map((choice) => String(choice)) : undefined;
      return [
        {
          key: item.key,
          kind: typeof item.kind === 'string' ? item.kind : undefined,
          prompt: typeof item.prompt === 'string' ? item.prompt : undefined,
          choices,
          score: typeof item.score === 'number' ? item.score : undefined,
          presentation: typeof item.presentation === 'string' ? item.presentation : undefined,
        },
      ];
    });
  }
  if (isRecord(config.options)) {
    return Object.entries(config.options).map(([key, value]) => ({
      key,
      choices: Array.isArray(value) ? value.map((choice) => String(choice)) : undefined,
    }));
  }
  return [];
}

export function buildObjectiveAnswerRows(input: {
  pdoc: { title?: unknown; content?: unknown; config?: unknown };
  code: unknown;
  cases: Array<{ id?: unknown; status?: unknown; score?: unknown; message?: unknown }>;
}): ObjectiveAnswerRow[] {
  const questions = questionsFromConfig(input.pdoc.config);
  const answers = parseObjectiveSubmission(input.code);
  const keys = questions.length ? questions.map((question) => question.key) : Object.keys(answers);
  const fallbackPrompt = typeof input.pdoc.title === 'string' ? input.pdoc.title : '';
  return keys.map((key, index) => {
    const question = questions.find((item) => item.key === key) || { key };
    const matchedCase =
      input.cases.find((item) => String(item.id) === key) ||
      (questions.length === input.cases.length ? input.cases[index] : undefined);
    const selected = answers[key];
    const unanswered = tokensOf(selected).length === 0;
    const status = typeof matchedCase?.status === 'number' ? matchedCase.status : null;
    return {
      key,
      kind: question.kind || 'single',
      prompt: question.prompt || fallbackPrompt || key,
      selectedLabel: selectedLabel(question, selected),
      score: typeof matchedCase?.score === 'number' ? matchedCase.score : 0,
      maxScore: typeof question.score === 'number' ? question.score : 0,
      correct: status == null ? null : status === 1,
      unanswered,
    };
  });
}
