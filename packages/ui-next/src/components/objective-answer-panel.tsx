/**
 * 客观题结构化作答面板（PLAN 2026-07 P3.2 Rev.11）。
 *
 * 数据源：`pdoc.config.questions`（服务端 parseConfig 生成的无答案题目
 * 描述符，见 hydrooj/src/lib/problem-config.ts clientQuestions）。渲染复用
 * paper-shell 的学生端组件；提交走现有 objective 提交链路——
 * POST {submitUrl} JSON `{lang:'_', code: <answers 的 YAML>}`，服务端
 * （handler/problem.ts ProblemSubmitHandler）对 objective 强制 lang='_'，
 * hydrojudge objective.ts 逐题比对判分。
 *
 * 草稿存 localStorage（按题目+比赛+用户隔离），提交成功后清除并跳转
 * 评测记录页。普通题目页 / 比赛 / homework（submitUrl 带 ?tid=）通用。
 */
import { AlertTriangle, Loader2, RotateCcw, Send } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import * as YAML from 'yaml';
import { MarkdownView } from '@/components/markdown-renderer';
import { BlankRenderer, FillProgramRenderer, MultiChoiceRenderer, SingleChoiceRenderer } from '@/components/paper/paper-shell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/cn';

export interface ObjectiveClientQuestion {
  key: string;
  kind: 'single' | 'multi' | 'blank' | 'fill_program' | string;
  prompt?: string;
  choices?: string[];
  score: number;
  presentation?: string;
}

const KIND_LABEL: Record<string, string> = {
  single: '单选',
  multi: '多选',
  blank: '填空',
  fill_program: '程序填空',
  subjective: '主观题',
};

type AnswerMap = Record<string, string | string[]>;

function loadDraft(storageKey: string): AnswerMap {
  try {
    const raw = window.localStorage.getItem(storageKey);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function answered(v: string | string[] | undefined): boolean {
  if (v === undefined || v === null) return false;
  if (Array.isArray(v)) return v.length > 0;
  return String(v).trim() !== '';
}

/**
 * 无结构化选项的旧题兜底。
 * single 用自由文本：kind 推断会把 legacy 单词/数字答案的填空题误判成
 * single（对抗审查 M3），强制字母过滤会让这类题物理无法作答——只对
 * "单个小写字母"做自动大写，其余原样保留（判题是 trim 后字符串比较）。
 * multi 的标准答案必为字母数组，保留字母解析。
 */
function LetterFallback({
  kind,
  value,
  onChange,
}: {
  kind: 'single' | 'multi';
  value: string | string[];
  onChange: (next: string | string[]) => void;
}) {
  if (kind === 'multi') {
    const display = Array.isArray(value) ? value.join('') : value || '';
    return (
      <div className="space-y-1">
        <Input
          value={display}
          onChange={(e) => {
            const letters = Array.from(
              new Set(
                e.target.value
                  .toUpperCase()
                  .replace(/[^A-Z]/g, '')
                  .split(''),
              ),
            ).sort();
            onChange(letters);
          }}
          placeholder="输入选项字母组合，如 ACD"
          className="max-w-56 font-mono"
        />
        <p className="text-[11px] text-muted-foreground">本题选项在题面正文中，请对照正文输入选项字母。</p>
      </div>
    );
  }
  return (
    <div className="space-y-1">
      <Input
        value={Array.isArray(value) ? value[0] || '' : value || ''}
        onChange={(e) => {
          const raw = e.target.value;
          // 单个小写字母视为选项，自动大写；其他内容（数字/单词）原样。
          onChange(/^[a-z]$/.test(raw) ? raw.toUpperCase() : raw);
        }}
        placeholder="选项题填选项字母（如 A）；填空题直接填答案"
        className="max-w-72"
      />
      <p className="text-[11px] text-muted-foreground">本题未配置结构化选项，请对照题面正文作答。</p>
    </div>
  );
}

export function ObjectiveAnswerPanel({
  questions,
  submitUrl,
  storageKey,
  signedIn,
  previewOnly = false,
}: {
  questions: ObjectiveClientQuestion[];
  submitUrl: string;
  storageKey: string;
  signedIn: boolean;
  previewOnly?: boolean;
}) {
  const [answers, setAnswers] = useState<AnswerMap>(() => loadDraft(storageKey));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const loadedKey = useRef(storageKey);

  // storageKey 变化（切题）时重载草稿。
  useEffect(() => {
    if (loadedKey.current !== storageKey) {
      loadedKey.current = storageKey;
      setAnswers(loadDraft(storageKey));
    }
  }, [storageKey]);

  const set = (key: string, v: string | string[]) => {
    setAnswers((prev) => {
      const next = { ...prev, [key]: v };
      try {
        window.localStorage.setItem(storageKey, JSON.stringify(next));
      } catch {
        /* 隐私模式等 */
      }
      return next;
    });
  };

  const clearAll = () => {
    if (!window.confirm('清空本题全部已选答案？')) return;
    setAnswers({});
    try {
      window.localStorage.removeItem(storageKey);
    } catch {
      /* ignore */
    }
  };

  const totalScore = questions.reduce((s, q) => s + (q.score || 0), 0);
  const answeredCount = questions.filter((q) => answered(answers[q.key])).length;

  const submit = async () => {
    const missing = questions.length - answeredCount;

    if (missing > 0 && !window.confirm(`还有 ${missing} 道题未作答，确认提交？`)) return;

    if (missing === 0 && !window.confirm('确认提交全部答案？')) return;
    setSubmitting(true);
    setError('');
    try {
      // 只提交本题实际存在的 key，草稿里残留的旧 key 不带上。
      const payload: AnswerMap = {};
      for (const q of questions) {
        if (answered(answers[q.key])) payload[q.key] = answers[q.key];
      }
      const res = await fetch(submitUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          lang: '_',
          code: questions.length === 1 && questions[0].kind === 'subjective' ? String(payload[questions[0].key] || '') : YAML.stringify(payload),
        }),
        credentials: 'same-origin',
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || data?.error) {
        throw new Error(data?.error?.message || `提交失败（HTTP ${res.status}）`);
      }
      try {
        window.localStorage.removeItem(storageKey);
      } catch {
        /* ignore */
      }
      const rid = data?.rid ? String(data.rid) : '';
      window.location.href = data?.url || (rid ? `/record/${rid}` : submitUrl);
    } catch (e: any) {
      setError(e?.message || String(e));
      setSubmitting(false);
    }
  };

  return (
    <Card>
      <CardContent className="space-y-4 p-4 sm:p-6">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-semibold">{previewOnly ? '答题框预览' : '在线作答'}</h2>
          <span className="text-xs text-muted-foreground">
            共 {questions.length} 题 · {totalScore} 分 · 已答 {answeredCount}/{questions.length}
          </span>
          <div className="flex-1" />
          <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={clearAll} disabled={submitting}>
            <RotateCcw className="size-3" />
            清空
          </Button>
        </div>

        {questions.map((q, idx) => (
          <div key={q.key} className="rounded-lg border">
            <div className="flex items-center gap-2 border-b bg-muted/40 px-4 py-2">
              <span className="text-sm font-medium">第 {q.key} 题</span>
              <Badge variant="secondary" className="text-[10px]">
                {q.presentation === 'truefalse' ? '判断' : KIND_LABEL[q.kind] || q.kind}
              </Badge>
              {answered(answers[q.key]) ? (
                <Badge variant="outline" className="text-[10px]">
                  已答
                </Badge>
              ) : null}
              <span className="ml-auto text-xs text-muted-foreground">{q.score} 分</span>
            </div>
            <div className="space-y-3 p-4">
              {q.prompt ? <MarkdownView content={q.prompt} /> : null}
              {q.kind === 'single' &&
                (q.choices?.length ? (
                  <SingleChoiceRenderer
                    name={`objective-${q.key || idx}`}
                    value={(answers[q.key] as string) || null}
                    options={q.choices}
                    onChange={(v) => set(q.key, v)}
                    disabled={submitting || previewOnly}
                  />
                ) : (
                  <LetterFallback kind="single" value={answers[q.key] || ''} onChange={(v) => set(q.key, v)} />
                ))}
              {q.kind === 'multi' &&
                (q.choices?.length ? (
                  <MultiChoiceRenderer
                    value={(answers[q.key] as string[]) || []}
                    options={q.choices}
                    onChange={(v) => set(q.key, v)}
                    disabled={submitting || previewOnly}
                  />
                ) : (
                  <LetterFallback kind="multi" value={answers[q.key] || []} onChange={(v) => set(q.key, v)} />
                ))}
              {q.kind === 'blank' && <BlankRenderer value={(answers[q.key] as string) || ''} onChange={(v) => set(q.key, v)} disabled={submitting} />}
              {q.kind === 'fill_program' && (
                <FillProgramRenderer value={(answers[q.key] as string) || ''} onChange={(v) => set(q.key, v)} disabled={submitting} />
              )}
              {q.kind === 'subjective' && (
                <div className="space-y-1.5">
                  <textarea
                    value={(answers[q.key] as string) || ''}
                    onChange={(e) => set(q.key, e.target.value)}
                    disabled={submitting || previewOnly}
                    rows={6}
                    className="w-full rounded-md border bg-background p-3 text-sm disabled:opacity-60"
                    placeholder="在此作答（主观题）"
                  />
                  <p className="text-[11px] text-muted-foreground">本题为主观题，提交后由老师人工评分，评分完成前记录显示「等待中」。</p>
                </div>
              )}
            </div>
          </div>
        ))}

        {error ? (
          <div
            className={cn(
              'flex items-center gap-2 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700',
              'dark:border-red-900 dark:bg-red-950/30 dark:text-red-300',
            )}
          >
            <AlertTriangle className="size-4 shrink-0" />
            {error}
          </div>
        ) : null}

        <div className="flex items-center justify-end gap-3 border-t pt-4">
          {previewOnly ? (
            <span className="text-xs text-muted-foreground">只读预览；主观题不能从独立题目页提交。</span>
          ) : (
            <>
              <span className="text-xs text-muted-foreground">草稿已自动保存在本机，提交后以评测记录为准。</span>
              <Button onClick={submit} disabled={submitting || !signedIn} className="gap-1.5">
                {submitting ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
                {signedIn ? '提交答案' : '登录后可提交'}
              </Button>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
