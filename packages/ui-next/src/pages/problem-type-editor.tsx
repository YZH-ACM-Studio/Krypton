/**
 * Problem type editor — picks the problem type (default / objective /
 * fill_function / submit_answer / interactive / communication) and renders
 * a type-specific editor area below.
 *
 * Persistence: the editor reads + writes the problem's `config.yaml` testdata
 * file. The objective sub-editor renders a list of question cards, each with
 * a sub-type (single / multi / blank / fill_program), choices, correct
 * answer and score. On save the parent serialises everything into the YAML
 * config and uploads it via Hydro's existing `/p/:pid/files` testdata API.
 */
import { useId } from 'react';
import {
  ClipboardList, Code, FileQuestion, FileType2, Layers, Plus, Send, Trash2,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { MiniTabs } from '@/components/ui/mini-tabs';
import { cn } from '@/lib/cn';

/* ─── Types ─────────────────────────────────────────────────────────── */

export type ProblemType =
  | 'default'        // 编程题（传统输入/输出）
  | 'objective'      // 客观题（单选/多选/填空/程序填空）
  | 'fill_function'  // 填函数体
  | 'submit_answer'  // 提交答案文件
  | 'interactive'    // 交互题
  | 'communication'; // 通信题

export const PROBLEM_TYPES: Array<{ key: ProblemType; label: string; desc: string; icon: any }> = [
  { key: 'default',        label: '编程题',     desc: '传统输入/输出，编译运行后判分',          icon: Code },
  { key: 'objective',      label: '客观题',     desc: '单选 / 多选 / 填空 / 程序填空 混合',     icon: ClipboardList },
  { key: 'fill_function',  label: '填函数体',   desc: '给函数签名，让考生填实现，自动包装运行', icon: FileType2 },
  { key: 'submit_answer',  label: '提交答案',   desc: '考生直接上传期望输出文件，无需编程',     icon: Send },
  { key: 'interactive',    label: '交互题',     desc: '考生程序与交互器通过 stdin/stdout 对话', icon: Layers },
  { key: 'communication',  label: '通信题',     desc: '多个进程通过函数调用通信',               icon: FileQuestion },
];

export type ObjectiveSubKind = 'single' | 'multi' | 'blank' | 'fill_program';

export interface ObjectiveQuestion {
  key: string;          // q1, q2, …
  kind: ObjectiveSubKind;
  prompt: string;
  choices: string[];    // for single / multi
  /**
   * Canonical correct-answer storage:
   *   single:       answer is the index into choices (as a single string like 'A')
   *   multi:        answer is array of strings like ['A', 'C']
   *   blank:        answer is array of acceptable strings (any matches)
   *   fill_program: answer is a single string (expected program output)
   */
  answer: string | string[];
  score: number;
}

/* ─── Type picker ───────────────────────────────────────────────────── */

export function TypePicker({
  value, onChange, disabled,
}: {
  value: ProblemType;
  onChange: (next: ProblemType) => void;
  disabled?: boolean;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">题目类型</CardTitle>
        <p className="text-xs text-muted-foreground">
          选择后下方会出现该类型对应的可视化编辑器。已有题目改类型会清空类型特定字段。
        </p>
      </CardHeader>
      <CardContent>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {PROBLEM_TYPES.map((t) => {
            const active = value === t.key;
            const Icon = t.icon;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => !disabled && onChange(t.key)}
                disabled={disabled}
                className={cn(
                  'flex items-start gap-2.5 rounded-lg border p-3 text-left transition-colors',
                  active
                    ? 'border-primary bg-primary/5 ring-1 ring-primary/40'
                    : 'border-border hover:border-primary/40 hover:bg-accent/40',
                  disabled && 'cursor-not-allowed opacity-50',
                )}
              >
                <Icon className={cn('mt-0.5 size-4 shrink-0', active ? 'text-primary' : 'text-muted-foreground')} />
                <div className="min-w-0">
                  <p className={cn('text-sm font-medium', active && 'text-primary')}>{t.label}</p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">{t.desc}</p>
                </div>
              </button>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

/* ─── Type-specific editors ────────────────────────────────────────── */

export function ObjectiveEditor({
  questions, onChange,
}: {
  questions: ObjectiveQuestion[];
  onChange: (next: ObjectiveQuestion[]) => void;
}) {
  const addQuestion = () => {
    const nextKey = `q${questions.length + 1}`;
    onChange([
      ...questions,
      { key: nextKey, kind: 'single', prompt: '', choices: ['', '', '', ''], answer: 'A', score: 5 },
    ]);
  };
  const removeAt = (idx: number) => onChange(questions.filter((_, i) => i !== idx));
  const update = (idx: number, patch: Partial<ObjectiveQuestion>) => {
    onChange(questions.map((q, i) => (i === idx ? { ...q, ...patch } : q)));
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm">题目列表（{questions.length}）</CardTitle>
        <Button type="button" size="sm" variant="outline" onClick={addQuestion} className="gap-1">
          <Plus className="size-3.5" />
          新增题目
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {questions.length === 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground">
            点击右上角"新增题目"开始添加。
          </p>
        )}
        {questions.map((q, idx) => (
          <ObjectiveQuestionCard
            key={`${q.key}-${idx}`}
            index={idx}
            question={q}
            onUpdate={(patch) => update(idx, patch)}
            onRemove={() => removeAt(idx)}
          />
        ))}
      </CardContent>
    </Card>
  );
}

function ObjectiveQuestionCard({
  index, question, onUpdate, onRemove,
}: {
  index: number;
  question: ObjectiveQuestion;
  onUpdate: (patch: Partial<ObjectiveQuestion>) => void;
  onRemove: () => void;
}) {
  const reactId = useId();

  const setKind = (kind: ObjectiveSubKind) => {
    // Reset answer + choices to defaults for the new kind.
    const next: Partial<ObjectiveQuestion> = { kind };
    if (kind === 'single') {
      next.choices = question.choices.length ? question.choices : ['', '', '', ''];
      next.answer = 'A';
    } else if (kind === 'multi') {
      next.choices = question.choices.length ? question.choices : ['', '', '', ''];
      next.answer = [];
    } else if (kind === 'blank') {
      next.choices = [];
      next.answer = Array.isArray(question.answer) ? question.answer : [typeof question.answer === 'string' ? question.answer : ''];
    } else if (kind === 'fill_program') {
      next.choices = [];
      next.answer = typeof question.answer === 'string' ? question.answer : '';
    }
    onUpdate(next);
  };

  return (
    <Card className="border-border/80 bg-card/50">
      <CardContent className="space-y-4 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="font-mono text-[10px]">#{index + 1}</Badge>
            <Input
              value={question.key}
              onChange={(e) => onUpdate({ key: e.target.value.replace(/[^a-zA-Z0-9_]/g, '') })}
              className="w-32 font-mono text-xs"
              placeholder="q1"
            />
            <Input
              type="number"
              min="0"
              step="0.5"
              value={question.score}
              onChange={(e) => onUpdate({ score: Number(e.target.value) || 0 })}
              className="w-20 text-xs"
            />
            <span className="text-xs text-muted-foreground">分</span>
          </div>
          <Button type="button" variant="ghost" size="icon" onClick={onRemove} className="size-8 text-destructive">
            <Trash2 className="size-3.5" />
          </Button>
        </div>

        <MiniTabs
          size="sm"
          value={question.kind}
          onValueChange={(v) => setKind(v as ObjectiveSubKind)}
          items={[
            { value: 'single', label: '单选' },
            { value: 'multi', label: '多选' },
            { value: 'blank', label: '填空' },
            { value: 'fill_program', label: '程序填空' },
          ]}
        />

        <div className="space-y-1.5">
          <label className="text-xs font-medium">题目描述</label>
          <textarea
            value={question.prompt}
            onChange={(e) => onUpdate({ prompt: e.target.value })}
            rows={2}
            className="w-full rounded-md border bg-background p-2 text-sm"
            placeholder="问题描述（Markdown）…"
          />
        </div>

        {(question.kind === 'single' || question.kind === 'multi') && (
          <ChoiceList
            kind={question.kind}
            choices={question.choices}
            answer={question.answer}
            onChoicesChange={(choices) => onUpdate({ choices })}
            onAnswerChange={(answer) => onUpdate({ answer })}
            reactId={reactId}
          />
        )}

        {question.kind === 'blank' && (
          <BlankAnswers
            answers={Array.isArray(question.answer) ? question.answer : [String(question.answer ?? '')]}
            onChange={(answers) => onUpdate({ answer: answers })}
          />
        )}

        {question.kind === 'fill_program' && (
          <div className="space-y-1.5">
            <label className="text-xs font-medium">期望输出 / 标准答案代码</label>
            <textarea
              value={typeof question.answer === 'string' ? question.answer : ''}
              onChange={(e) => onUpdate({ answer: e.target.value })}
              rows={4}
              className="w-full rounded-md border bg-background p-2 font-mono text-xs"
              placeholder="考生代码的预期输出，或参考实现代码…"
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ChoiceList({
  kind, choices, answer, onChoicesChange, onAnswerChange, reactId,
}: {
  kind: 'single' | 'multi';
  choices: string[];
  answer: string | string[];
  onChoicesChange: (next: string[]) => void;
  onAnswerChange: (next: string | string[]) => void;
  reactId: string;
}) {
  const letters = 'ABCDEFGHIJKLMNOP';
  const selected = new Set<string>(
    Array.isArray(answer) ? answer : (typeof answer === 'string' ? [answer] : []),
  );
  const toggle = (letter: string) => {
    if (kind === 'single') {
      onAnswerChange(letter);
    } else {
      const next = new Set(selected);
      if (next.has(letter)) next.delete(letter);
      else next.add(letter);
      onAnswerChange(Array.from(next).sort());
    }
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <label className="text-xs font-medium">选项（{choices.length}）</label>
        <div className="flex gap-1">
          <Button
            type="button" size="sm" variant="ghost" className="h-6 text-[11px]"
            onClick={() => onChoicesChange([...choices, ''])}
            disabled={choices.length >= letters.length}
          >
            <Plus className="mr-0.5 size-3" />
            添加选项
          </Button>
        </div>
      </div>
      <div className="space-y-1.5">
        {choices.map((c, i) => {
          const letter = letters[i];
          const isCorrect = selected.has(letter);
          return (
            <div key={`${reactId}-${i}`} className="flex items-center gap-2">
              {kind === 'single' ? (
                <label className="inline-flex size-5 cursor-pointer items-center justify-center">
                  <input
                    type="radio"
                    name={`${reactId}-correct`}
                    checked={isCorrect}
                    onChange={() => toggle(letter)}
                    className="accent-primary"
                  />
                </label>
              ) : (
                <Checkbox
                  checked={isCorrect}
                  onCheckedChange={() => toggle(letter)}
                />
              )}
              <span className={cn(
                'shrink-0 font-mono text-xs font-semibold',
                isCorrect ? 'text-primary' : 'text-muted-foreground',
              )}>{letter}.</span>
              <Input
                value={c}
                onChange={(e) => {
                  const next = [...choices];
                  next[i] = e.target.value;
                  onChoicesChange(next);
                }}
                placeholder={`选项 ${letter}`}
                className="flex-1 text-sm"
              />
              <Button
                type="button" variant="ghost" size="icon" className="size-7 text-destructive"
                onClick={() => {
                  // Remove choice + drop any answer references to its letter.
                  const next = choices.filter((_, j) => j !== i);
                  onChoicesChange(next);
                  if (kind === 'single' && selected.has(letter)) {
                    onAnswerChange('');
                  } else if (kind === 'multi') {
                    const arr = (Array.isArray(answer) ? answer : []).filter((l) => l !== letter);
                    onAnswerChange(arr);
                  }
                }}
                disabled={choices.length <= 2}
                title="删除选项"
              >
                <Trash2 className="size-3" />
              </Button>
            </div>
          );
        })}
      </div>
      <p className="text-[11px] text-muted-foreground">
        {kind === 'single' ? '勾选 radio 标记正确答案。' : '勾选所有正确答案。'}
      </p>
    </div>
  );
}

function BlankAnswers({
  answers, onChange,
}: { answers: string[]; onChange: (next: string[]) => void }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <label className="text-xs font-medium">可接受的答案（任一匹配即对）</label>
        <Button type="button" size="sm" variant="ghost" className="h-6 text-[11px]"
          onClick={() => onChange([...answers, ''])}>
          <Plus className="mr-0.5 size-3" />
          添加候选
        </Button>
      </div>
      <div className="space-y-1.5">
        {answers.map((a, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="shrink-0 font-mono text-xs text-muted-foreground">{i + 1}.</span>
            <Input
              value={a}
              onChange={(e) => {
                const next = [...answers];
                next[i] = e.target.value;
                onChange(next);
              }}
              placeholder="一个可接受的答案"
              className="flex-1 text-sm"
            />
            <Button type="button" variant="ghost" size="icon" className="size-7 text-destructive"
              onClick={() => onChange(answers.filter((_, j) => j !== i))}
              disabled={answers.length <= 1}>
              <Trash2 className="size-3" />
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── Fill function + submit_answer + interactive + communication ─── */

export function FillFunctionEditor({
  template, onChange,
}: { template: string; onChange: (next: string) => void }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">代码模板（含填空标记）</CardTitle>
        <p className="text-[11px] text-muted-foreground">
          使用 <code className="rounded bg-muted px-1">// REGION_START / // REGION_END</code> 标记考生可编辑的区域。
        </p>
      </CardHeader>
      <CardContent>
        <textarea
          value={template}
          onChange={(e) => onChange(e.target.value)}
          rows={14}
          spellCheck={false}
          className="w-full rounded-md border bg-background p-3 font-mono text-xs"
          placeholder={`#include <bits/stdc++.h>\nusing namespace std;\nint sum(int a, int b) {\n  // REGION_START\n  return ;\n  // REGION_END\n}`}
        />
      </CardContent>
    </Card>
  );
}

export function SubmitAnswerEditor({
  expectedAnswer, onChange,
}: { expectedAnswer: string; onChange: (next: string) => void }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">期望答案</CardTitle>
        <p className="text-[11px] text-muted-foreground">
          考生上传答案文件后会与下方期望答案逐行比对。也可用文件比对模式（在评测配置里配置）。
        </p>
      </CardHeader>
      <CardContent>
        <textarea
          value={expectedAnswer}
          onChange={(e) => onChange(e.target.value)}
          rows={10}
          spellCheck={false}
          className="w-full rounded-md border bg-background p-3 font-mono text-xs"
          placeholder="期望的标准答案内容…"
        />
      </CardContent>
    </Card>
  );
}

export function InteractiveEditor({
  interactor, onChange,
}: { interactor: string; onChange: (next: string) => void }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">交互器源码</CardTitle>
        <p className="text-[11px] text-muted-foreground">
          交互器是评测端运行的程序，与考生程序通过 stdin/stdout 对话。
        </p>
      </CardHeader>
      <CardContent>
        <textarea
          value={interactor}
          onChange={(e) => onChange(e.target.value)}
          rows={14}
          spellCheck={false}
          className="w-full rounded-md border bg-background p-3 font-mono text-xs"
          placeholder="// interactor.cpp"
        />
      </CardContent>
    </Card>
  );
}

export function CommunicationEditor({
  manager, onChange,
}: { manager: string; onChange: (next: string) => void }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">通信管理器源码</CardTitle>
        <p className="text-[11px] text-muted-foreground">
          管理器协调多个考生进程间的通信。
        </p>
      </CardHeader>
      <CardContent>
        <textarea
          value={manager}
          onChange={(e) => onChange(e.target.value)}
          rows={14}
          spellCheck={false}
          className="w-full rounded-md border bg-background p-3 font-mono text-xs"
          placeholder="// manager.cpp"
        />
      </CardContent>
    </Card>
  );
}

/* ─── Serialise → config.yaml ─────────────────────────────────────── */

import * as YAML from 'yaml';

export interface ProblemTypeState {
  type: ProblemType;
  objective: ObjectiveQuestion[];
  template: string;        // for fill_function
  expectedAnswer: string;  // for submit_answer
  interactor: string;      // for interactive
  manager: string;         // for communication
}

export function buildConfigYaml(state: ProblemTypeState, existingYaml: string = ''): string {
  // Preserve any keys we don't own (time, memory, checker_type, score, etc.).
  let base: Record<string, any> = {};
  try { base = YAML.parse(existingYaml) || {}; } catch { base = {}; }
  // Always overwrite `type`. Always overwrite owned fields.
  base.type = state.type;
  if (state.type === 'objective') {
    const answers: Record<string, any> = {};
    for (const q of state.objective) {
      if (!q.key) continue;
      const meta: any = { prompt: q.prompt, type: q.kind };
      if (q.kind === 'single' || q.kind === 'multi') meta.choices = q.choices;
      answers[q.key] = [q.answer, q.score, meta];
    }
    base.answers = answers;
  } else {
    delete base.answers;
  }
  // The text editors below could surface as separate keys; we keep them
  // simple for now — fill_function / submit_answer / interactive /
  // communication still need their content in the testdata files, so the
  // YAML just records the *type* and the React UI provides the editor.
  return YAML.stringify(base);
}

export function parseConfigYaml(yaml: string): ProblemTypeState {
  let parsed: any = {};
  try { parsed = YAML.parse(yaml) || {}; } catch { parsed = {}; }
  const type = (PROBLEM_TYPES.find((p) => p.key === parsed.type)?.key) || 'default';
  const objective: ObjectiveQuestion[] = [];
  if (type === 'objective' && parsed.answers && typeof parsed.answers === 'object') {
    for (const [key, raw] of Object.entries(parsed.answers)) {
      if (!Array.isArray(raw)) continue;
      const [answer, score, meta] = raw as [any, number, any];
      const kind: ObjectiveSubKind = (meta?.type as any) || (Array.isArray(answer) ? 'multi' : 'single');
      objective.push({
        key,
        kind,
        prompt: meta?.prompt || '',
        choices: meta?.choices || [],
        answer,
        score: Number(score) || 0,
      });
    }
  }
  return {
    type,
    objective,
    template: '',
    expectedAnswer: '',
    interactor: '',
    manager: '',
  };
}
