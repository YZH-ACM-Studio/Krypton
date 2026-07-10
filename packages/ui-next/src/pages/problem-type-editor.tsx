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
import {
  ArrowDown, ArrowUp, ClipboardList, Code, Eye, FileQuestion, FileType2, Layers, Plus, Send, Trash2,
} from 'lucide-react';
import { useId, useState } from 'react';
/* ─── Serialise → config.yaml ─────────────────────────────────────── */
import * as YAML from 'yaml';
import { MarkdownView } from '@/components/markdown-renderer';
import {
  BlankRenderer, FillProgramRenderer, MultiChoiceRenderer, SingleChoiceRenderer,
} from '@/components/paper/paper-shell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { MiniTabs } from '@/components/ui/mini-tabs';
import { cn } from '@/lib/cn';

/* ─── Types ─────────────────────────────────────────────────────────── */

export type ProblemType =
  | 'default' // 编程题（传统输入/输出）
  | 'objective' // 客观题（单选/多选/填空/程序填空）
  | 'fill_function' // 填函数体
  | 'submit_answer' // 提交答案文件
  | 'interactive' // 交互题
  | 'communication'; // 通信题

export const PROBLEM_TYPES: Array<{ key: ProblemType, label: string, desc: string, icon: any }> = [
  { key: 'default', label: '编程题', desc: '传统输入/输出，编译运行后判分', icon: Code },
  { key: 'objective', label: '客观题', desc: '单选 / 多选 / 填空 / 程序填空 混合', icon: ClipboardList },
  { key: 'fill_function', label: '填函数体', desc: '给函数签名，让考生填实现，自动包装运行', icon: FileType2 },
  { key: 'submit_answer', label: '提交答案', desc: '考生直接上传期望输出文件，无需编程', icon: Send },
  { key: 'interactive', label: '交互题', desc: '考生程序与交互器通过 stdin/stdout 对话', icon: Layers },
  { key: 'communication', label: '通信题', desc: '多个进程通过函数调用通信', icon: FileQuestion },
];

export type ObjectiveSubKind = 'single' | 'multi' | 'blank' | 'fill_program' | 'subjective';

/** 编辑器 UI 的展示题型：在 kind 之上叠加「判断」伪题型（single 预设）。 */
export type DisplayKind = ObjectiveSubKind | 'truefalse';

export interface ObjectiveQuestion {
  key: string; // canonical：递增数字串 "1"、"2"…（旧数据 q1 等兼容读）
  kind: ObjectiveSubKind;
  prompt: string;
  choices: string[]; // for single / multi
  /**
   * Canonical correct-answer storage:
   *   single:       answer is the index into choices (as a single string like 'A')
   *   multi:        answer is array of strings like ['A', 'C']
   *   blank:        answer is a SINGLE string —— 判题器把数组按多选集合判
   *                 （全对满分/子集半分），blank v1 明确不支持多个可接受答案
   *                 （PLAN 2026-07 P3.2）
   *   fill_program: answer is a single string (expected program output)
   *   subjective:   answer 恒空串（Rev.12，人工评分）
   */
  answer: string | string[];
  score: number;
  /** 'truefalse' = 判断题（single 预设，choices 锁定「正确/错误」） */
  presentation?: string;
}

export const TRUEFALSE_CHOICES = ['正确', '错误'];

export function displayKindOf(q: ObjectiveQuestion): DisplayKind {
  return q.presentation === 'truefalse' ? 'truefalse' : q.kind;
}

/** 按展示题型生成新小题（Rev.12「按题型直达添加」）。 */
export function newQuestionOf(display: DisplayKind, key: string): ObjectiveQuestion {
  switch (display) {
    case 'multi':
      return { key, kind: 'multi', prompt: '', choices: ['', '', '', ''], answer: [], score: 5 };
    case 'truefalse':
      return {
        key, kind: 'single', prompt: '', choices: [...TRUEFALSE_CHOICES], answer: 'A', score: 5, presentation: 'truefalse',
      };
    case 'blank':
      return { key, kind: 'blank', prompt: '', choices: [], answer: '', score: 5 };
    case 'fill_program':
      return { key, kind: 'fill_program', prompt: '', choices: [], answer: '', score: 5 };
    case 'subjective':
      return { key, kind: 'subjective', prompt: '', choices: [], answer: '', score: 10 };
    case 'single':
    default:
      return { key, kind: 'single', prompt: '', choices: ['', '', '', ''], answer: 'A', score: 5 };
  }
}

/** 下一个数字 key：现有数字 key 的最大值 + 1（忽略 q1 等非数字旧 key）。 */
function nextNumericKey(questions: ObjectiveQuestion[]): string {
  let max = 0;
  for (const q of questions) {
    const n = Number(q.key);
    if (Number.isInteger(n) && n > max) max = n;
  }
  return String(max + 1);
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
          {/* Rev.12：客观题从此处移除——新建/编辑一律走出卷中心独立编辑器 */}
          {PROBLEM_TYPES.filter((t) => t.key !== 'objective').map((t) => {
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

const ADD_KINDS: Array<{ display: DisplayKind, label: string }> = [
  { display: 'single', label: '单选' },
  { display: 'multi', label: '多选' },
  { display: 'truefalse', label: '判断' },
  { display: 'blank', label: '填空' },
  { display: 'fill_program', label: '程序填空' },
  { display: 'subjective', label: '主观题' },
];

export function ObjectiveEditor({
  questions, onChange,
}: {
  questions: ObjectiveQuestion[];
  onChange: (next: ObjectiveQuestion[]) => void;
}) {
  const addQuestion = (display: DisplayKind) => {
    onChange([...questions, newQuestionOf(display, nextNumericKey(questions))]);
  };
  const removeAt = (idx: number) => onChange(questions.filter((_, i) => i !== idx));
  const update = (idx: number, patch: Partial<ObjectiveQuestion>) => {
    onChange(questions.map((q, i) => (i === idx ? { ...q, ...patch } : q)));
  };
  const move = (idx: number, dir: -1 | 1) => {
    const j = idx + dir;
    if (j < 0 || j >= questions.length) return;
    const next = [...questions];
    // key 序 = 全链路展示序（编辑器/学生面板/exam cells 都按 key 自然序），
    // 只换数组位置不换 key 的移动保存后是空操作——内容互换、key 留在原位。
    const a = { ...next[idx], key: next[j].key };
    const b = { ...next[j], key: next[idx].key };
    next[idx] = b;
    next[j] = a;
    onChange(next);
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">小题列表（{questions.length}）</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {questions.length === 0 && (
          <p className="py-6 text-center text-sm text-muted-foreground">
            还没有小题——从下方选择题型开始添加。
          </p>
        )}
        {questions.map((q, idx) => (
          <ObjectiveQuestionCard
            key={`${q.key}-${idx}`}
            index={idx}
            total={questions.length}
            question={q}
            onUpdate={(patch) => update(idx, patch)}
            onRemove={() => removeAt(idx)}
            onMove={(dir) => move(idx, dir)}
          />
        ))}
        {/* Rev.12：按题型直达添加，替代「先加单选再切题型」 */}
        <div className="rounded-lg border border-dashed p-3">
          <p className="mb-2 text-xs font-medium text-muted-foreground">添加小题</p>
          <div className="flex flex-wrap gap-2">
            {ADD_KINDS.map((k) => (
              <Button
                key={k.display}
                type="button"
                size="sm"
                variant="outline"
                className="gap-1"
                onClick={() => addQuestion(k.display)}
              >
                <Plus className="size-3" />
                {k.label}
              </Button>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ObjectiveQuestionCard({
  index, total, question, onUpdate, onRemove, onMove,
}: {
  index: number;
  total: number;
  question: ObjectiveQuestion;
  onUpdate: (patch: Partial<ObjectiveQuestion>) => void;
  onRemove: () => void;
  onMove: (dir: -1 | 1) => void;
}) {
  const reactId = useId();
  const display = displayKindOf(question);

  const setKind = (nextDisplay: DisplayKind) => {
    if (nextDisplay === display) return;
    // Reset answer + choices to defaults for the new kind.
    const next: Partial<ObjectiveQuestion> = { presentation: undefined };
    if (nextDisplay === 'truefalse') {
      next.kind = 'single';
      next.presentation = 'truefalse';
      next.choices = [...TRUEFALSE_CHOICES];
      next.answer = 'A';
    } else if (nextDisplay === 'single') {
      next.kind = 'single';
      next.choices = question.choices.length && question.presentation !== 'truefalse' ? question.choices : ['', '', '', ''];
      next.answer = 'A';
    } else if (nextDisplay === 'multi') {
      next.kind = 'multi';
      next.choices = question.choices.length && question.presentation !== 'truefalse' ? question.choices : ['', '', '', ''];
      next.answer = [];
    } else if (nextDisplay === 'blank') {
      next.kind = 'blank';
      next.choices = [];
      // blank v1 单答案（判题器把数组按多选集合判，PLAN P3.2）
      next.answer = Array.isArray(question.answer) ? (question.answer[0] || '') : (typeof question.answer === 'string' ? question.answer : '');
    } else if (nextDisplay === 'fill_program') {
      next.kind = 'fill_program';
      next.choices = [];
      next.answer = typeof question.answer === 'string' ? question.answer : '';
    } else if (nextDisplay === 'subjective') {
      next.kind = 'subjective';
      next.choices = [];
      next.answer = '';
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
              onChange={(e) => onUpdate({ key: e.target.value.replace(/[^a-zA-Z0-9_-]/g, '') })}
              className="w-32 font-mono text-xs"
              placeholder="1"
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
          <div className="flex items-center gap-0.5">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8"
              onClick={() => onMove(-1)}
              disabled={index === 0}
              title="上移"
            >
              <ArrowUp className="size-3.5" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8"
              onClick={() => onMove(1)}
              disabled={index === total - 1}
              title="下移"
            >
              <ArrowDown className="size-3.5" />
            </Button>
            <Button type="button" variant="ghost" size="icon" onClick={onRemove} className="size-8 text-destructive">
              <Trash2 className="size-3.5" />
            </Button>
          </div>
        </div>

        <MiniTabs
          size="sm"
          value={display}
          onValueChange={(v) => setKind(v as DisplayKind)}
          items={[
            { value: 'single', label: '单选' },
            { value: 'multi', label: '多选' },
            { value: 'truefalse', label: '判断' },
            { value: 'blank', label: '填空' },
            { value: 'fill_program', label: '程序填空' },
            { value: 'subjective', label: '主观题' },
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

        {display === 'truefalse' && (
          <div className="space-y-1.5">
            <label className="text-xs font-medium">正确答案</label>
            <div className="flex gap-3">
              {TRUEFALSE_CHOICES.map((c, i) => {
                const letter = 'AB'[i];
                const checked = question.answer === letter;
                return (
                  <label
                    key={letter}
                    className={cn(
                      'flex cursor-pointer items-center gap-2 rounded-md border px-4 py-2 text-sm transition-colors',
                      checked ? 'border-primary bg-primary/5 font-medium' : 'hover:bg-accent/50',
                    )}
                  >
                    <input
                      type="radio"
                      name={`${reactId}-tf`}
                      checked={checked}
                      onChange={() => onUpdate({ answer: letter })}
                      className="accent-primary"
                    />
                    {c}
                  </label>
                );
              })}
            </div>
          </div>
        )}

        {display !== 'truefalse' && (question.kind === 'single' || question.kind === 'multi') && (
          <ChoiceList
            kind={question.kind}
            choices={question.choices}
            answer={question.answer}
            onChoicesChange={(choices) => onUpdate({ choices })}
            onAnswerChange={(answer) => onUpdate({ answer })}
            reactId={reactId}
          />
        )}

        {question.kind === 'subjective' && (
          <p className="rounded-md border border-dashed bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            主观题没有标准答案——学生提交后记录停在「等待中」，你在比赛管理的「阅卷」里逐份给分（0 ~ 本题分值）。
          </p>
        )}

        {question.kind === 'blank' && (
          <div className="space-y-1.5">
            <label className="text-xs font-medium">标准答案（单一字符串）</label>
            <Input
              value={Array.isArray(question.answer) ? (question.answer[0] || '') : String(question.answer ?? '')}
              onChange={(e) => onUpdate({ answer: e.target.value })}
              placeholder="学生答案与此完全一致（去首尾空白后）才判对"
              className="text-sm"
            />
            <p className="text-[11px] text-muted-foreground">
              填空题 v1 只支持一个标准答案——判题器会把数组形式按「多选集合」判分（全对满分/子集半分），所以这里不提供多个可接受答案。
            </p>
          </div>
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
            type="button"
            size="sm"
            variant="ghost"
            className="h-6 text-[11px]"
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
                type="button"
                variant="ghost"
                size="icon"
                className="size-7 text-destructive"
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

/* ─── Objective live preview（复用 paper-shell 学生端 renderer）────── */

const KIND_LABEL: Record<DisplayKind, string> = {
  single: '单选', multi: '多选', truefalse: '判断', blank: '填空', fill_program: '程序填空', subjective: '主观题',
};

export function ObjectivePreview({ questions }: { questions: ObjectiveQuestion[] }) {
  // 预览可交互：老师能点选感受学生视角；state 不参与保存。
  const [answers, setAnswers] = useState<Record<string, string | string[]>>({});
  const set = (key: string, v: string | string[]) => setAnswers((prev) => ({ ...prev, [key]: v }));

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-1.5 text-sm">
          <Eye className="size-3.5" />
          学生视角实时预览
        </CardTitle>
        <p className="text-[11px] text-muted-foreground">与考试页/题目页使用同一套渲染组件；可试点选，不影响保存。</p>
      </CardHeader>
      <CardContent className="space-y-4">
        {questions.length === 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground">左侧添加题目后这里实时预览。</p>
        )}
        {questions.map((q, idx) => (
          <div key={`${q.key}-${idx}`} className="rounded-lg border">
            <div className="flex items-center gap-2 border-b bg-muted/40 px-4 py-2">
              <span className="text-sm font-medium">第 {q.key || `${idx + 1}`} 题</span>
              <Badge variant="secondary" className="text-[10px]">{KIND_LABEL[displayKindOf(q)]}</Badge>
              <span className="ml-auto text-xs text-muted-foreground">{q.score} 分</span>
            </div>
            <div className="space-y-3 p-4">
              {q.prompt ? <MarkdownView content={q.prompt} /> : <p className="text-xs text-muted-foreground">（无题干）</p>}
              {q.kind === 'single' && (
                <SingleChoiceRenderer
                  name={`preview-${q.key || idx}`}
                  value={(answers[q.key] as string) || null}
                  options={q.choices}
                  onChange={(v) => set(q.key, v)}
                />
              )}
              {q.kind === 'multi' && (
                <MultiChoiceRenderer
                  value={(answers[q.key] as string[]) || []}
                  options={q.choices}
                  onChange={(v) => set(q.key, v)}
                />
              )}
              {q.kind === 'blank' && (
                <BlankRenderer
                  value={(answers[q.key] as string) || ''}
                  onChange={(v) => set(q.key, v)}
                />
              )}
              {q.kind === 'fill_program' && (
                <FillProgramRenderer
                  value={(answers[q.key] as string) || ''}
                  onChange={(v) => set(q.key, v)}
                />
              )}
              {q.kind === 'subjective' && (
                <div className="space-y-1.5">
                  <textarea
                    value={(answers[q.key] as string) || ''}
                    onChange={(e) => set(q.key, e.target.value)}
                    rows={4}
                    className="w-full rounded-md border bg-background p-3 text-sm"
                    placeholder="在此作答（主观题）"
                  />
                  <p className="text-[11px] text-muted-foreground">主观题由老师人工评分。</p>
                </div>
              )}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

/* ─── Fill function + submit_answer + interactive + communication ─── */

export function FillFunctionEditor({
  template, onChange,
}: { template: string, onChange: (next: string) => void }) {
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
          placeholder={'#include <bits/stdc++.h>\nusing namespace std;\nint sum(int a, int b) {\n  // REGION_START\n  return ;\n  // REGION_END\n}'}
        />
      </CardContent>
    </Card>
  );
}

export function SubmitAnswerEditor({
  expectedAnswer, onChange,
}: { expectedAnswer: string, onChange: (next: string) => void }) {
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
}: { interactor: string, onChange: (next: string) => void }) {
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
}: { manager: string, onChange: (next: string) => void }) {
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

export interface ProblemTypeState {
  type: ProblemType;
  objective: ObjectiveQuestion[];
  template: string; // for fill_function
  expectedAnswer: string; // for submit_answer
  interactor: string; // for interactive
  manager: string; // for communication
}

export function buildConfigYaml(state: ProblemTypeState, existingYaml: string = ''): string {
  // Preserve any keys we don't own (time, memory, checker_type, score, etc.).
  let base: Record<string, any> = {};
  try { base = YAML.parse(existingYaml) || {}; } catch { base = {}; }
  // Always overwrite `type`. Always overwrite owned fields.
  base.type = state.type;
  if (state.type === 'objective') {
    const answers: Record<string, any> = {};
    const options: Record<string, string[]> = {};
    for (const q of state.objective) {
      if (!q.key) continue;
      // canonical meta 键名 = kind（PLAN P3.2 归一，旧 type 键读取端兜底）
      const meta: any = { kind: q.kind, prompt: q.prompt };
      if (q.presentation) meta.presentation = q.presentation;
      // blank v1 强制单字符串（判题器把数组按多选集合判）；主观题答案恒空
      const answer = q.kind === 'subjective' ? ''
        : (q.kind === 'blank' && Array.isArray(q.answer) ? (q.answer[0] || '') : q.answer);
      if (q.kind === 'single' || q.kind === 'multi') {
        meta.choices = q.choices;
        // 双写 config.options[key]——考试页/结构化渲染器的现行消费点
        options[q.key] = q.choices;
      }
      answers[q.key] = [answer, q.score, meta];
    }
    base.answers = answers;
    if (Object.keys(options).length) base.options = options;
    else delete base.options;
  } else {
    delete base.answers;
    delete base.options;
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
      // kind 推断链与服务端 inferQuestionKind 一致：
      // meta.kind（canonical）→ meta.type（legacy）→ 按答案形态推断
      const kind: ObjectiveSubKind = (meta?.kind as any) || (meta?.type as any)
        || (Array.isArray(answer) ? 'multi'
          : (typeof answer === 'string' && /\s/.test(answer)) ? 'blank' : 'single');
      // blank 旧数据可能是数组（多候选，legacy）——取第一个，保存后归一
      const normAnswer = kind === 'blank' && Array.isArray(answer) ? (answer[0] || '') : answer;
      objective.push({
        key,
        kind,
        prompt: meta?.prompt || '',
        // choices 双源：meta.choices（canonical）→ config.options[key]（既有消费点）
        choices: (Array.isArray(meta?.choices) && meta.choices.length ? meta.choices
          : (Array.isArray(parsed.options?.[key]) ? parsed.options[key] : [])),
        answer: normAnswer,
        score: Number(score) || 0,
        presentation: typeof meta?.presentation === 'string' ? meta.presentation : undefined,
      });
    }
    // 数字 key 自然序（'2' < '10'），非数字 key 排后面保持稳定
    objective.sort((a, b) => {
      const an = Number(a.key);
      const bn = Number(b.key);
      const aNum = Number.isFinite(an);
      const bNum = Number.isFinite(bn);
      if (aNum && bNum) return an - bn;
      if (aNum) return -1;
      if (bNum) return 1;
      return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
    });
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
