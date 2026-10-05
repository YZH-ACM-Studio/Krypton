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
import { RotateCcw, Send } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import * as YAML from 'yaml';
import { MarkdownView } from '@/components/markdown-renderer';
import { BlankRenderer, FillProgramRenderer, MultiChoiceRenderer, SingleChoiceRenderer } from '@/components/paper/paper-shell';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Panel } from '@/components/ui/panel';
import { Textarea } from '@/components/ui/textarea';
import { fetchHydroResponse, readHydroResponseError } from '@/lib/error-presenter';

type ConfirmState = { kind: 'clear' } | { kind: 'submit'; missing: number };

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
  disabled,
}: {
  kind: 'single' | 'multi';
  value: string | string[];
  onChange: (next: string | string[]) => void;
  disabled?: boolean;
}) {
  if (kind === 'multi') {
    const display = Array.isArray(value) ? value.join('') : value || '';
    return (
      <div className="flex flex-col gap-1">
        <Input
          value={display}
          disabled={disabled}
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
        <p className="text-2xs text-fg-subtle">本题选项在题面正文中，请对照正文输入选项字母。</p>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1">
      <Input
        value={Array.isArray(value) ? value[0] || '' : value || ''}
        disabled={disabled}
        onChange={(e) => {
          const raw = e.target.value;
          // 单个小写字母视为选项，自动大写；其他内容（数字/单词）原样。
          onChange(/^[a-z]$/.test(raw) ? raw.toUpperCase() : raw);
        }}
        placeholder="选项题填选项字母（如 A）；填空题直接填答案"
        className="max-w-72"
      />
      <p className="text-2xs text-fg-subtle">本题未配置结构化选项，请对照题面正文作答。</p>
    </div>
  );
}

export function ObjectiveAnswerPanel({
  questions,
  submitUrl,
  storageKey,
  signedIn,
  previewOnly = false,
  reloadOnConflict = false,
  practiceContextId,
}: {
  questions: ObjectiveClientQuestion[];
  submitUrl: string;
  storageKey: string;
  signedIn: boolean;
  previewOnly?: boolean;
  reloadOnConflict?: boolean;
  practiceContextId?: string;
}) {
  const [answers, setAnswers] = useState<AnswerMap>(() => loadDraft(storageKey));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const loadedKey = useRef(storageKey);

  // storageKey 变化（切题）时重载草稿。
  useEffect(() => {
    if (loadedKey.current !== storageKey) {
      loadedKey.current = storageKey;
      setAnswers(loadDraft(storageKey));
    }
  }, [storageKey]);

  const set = (key: string, v: string | string[]) => {
    if (previewOnly) return;
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
    if (previewOnly) return;
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
    setSubmitting(true);
    setError('');
    try {
      // 只提交本题实际存在的 key，草稿里残留的旧 key 不带上。
      const payload: AnswerMap = {};
      for (const q of questions) {
        if (answered(answers[q.key])) payload[q.key] = answers[q.key];
      }
      const res = await fetchHydroResponse(submitUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          lang: '_',
          code: questions.length === 1 && questions[0].kind === 'subjective' ? String(payload[questions[0].key] || '') : YAML.stringify(payload),
          ...(practiceContextId ? { practiceContextId } : {}),
        }),
        credentials: 'same-origin',
      });
      if (res.status === 409 && reloadOnConflict) {
        setSubmitting(false);
        window.location.reload();
        return;
      }
      if (!res.ok) throw new Error(await readHydroResponseError(res, '提交失败'));
      const data = await res.json().catch(() => null);
      if (data?.error) throw new Error('提交响应包含错误标记');
      try {
        window.localStorage.removeItem(storageKey);
      } catch {
        /* ignore */
      }
      const rid = data?.rid ? String(data.rid) : '';
      window.location.href = data?.url || (rid ? `/record/${rid}` : submitUrl);
    } catch (caught) {
      const message = (caught as { message?: unknown } | null)?.message;
      setError(typeof message === 'string' && message ? message : String(caught));
      setSubmitting(false);
    }
  };

  return (
    <Panel>
      <div className="flex min-w-0 flex-col gap-4">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <h2 className="min-w-0 break-words text-sm font-semibold text-fg">{previewOnly ? '答题框预览' : '在线作答'}</h2>
          <span className="min-w-0 break-words text-xs text-fg-subtle tabular">
            共 {questions.length} 题 · {totalScore} 分 · 已答 {answeredCount}/{questions.length}
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto"
            onClick={() => {
              if (previewOnly) return;
              setConfirm({ kind: 'clear' });
            }}
            disabled={submitting || previewOnly}
          >
            <RotateCcw />
            清空
          </Button>
        </div>

        <div className="flex flex-col divide-y divide-line border-t border-line">
          {questions.map((q, idx) => (
            <div key={q.key} className="flex min-w-0 flex-col gap-3 py-4">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <span className="min-w-0 break-words text-sm font-medium text-fg">第 {q.key} 题</span>
                <Badge variant="outline" size="sm">
                  {q.presentation === 'truefalse' ? '判断' : KIND_LABEL[q.kind] || q.kind}
                </Badge>
                {answered(answers[q.key]) ? (
                  <Badge tone="success" variant="soft" size="sm">
                    已答
                  </Badge>
                ) : null}
                <span className="ml-auto shrink-0 text-xs text-fg-subtle tabular">{q.score} 分</span>
              </div>
              <div className="flex min-w-0 flex-col gap-3">
                {q.prompt ? <MarkdownView content={q.prompt} className="min-w-0" /> : null}
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
                    <LetterFallback kind="single" value={answers[q.key] || ''} onChange={(v) => set(q.key, v)} disabled={submitting || previewOnly} />
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
                    <LetterFallback kind="multi" value={answers[q.key] || []} onChange={(v) => set(q.key, v)} disabled={submitting || previewOnly} />
                  ))}
                {q.kind === 'blank' && <BlankRenderer value={(answers[q.key] as string) || ''} onChange={(v) => set(q.key, v)} disabled={submitting || previewOnly} />}
                {q.kind === 'fill_program' && (
                  <FillProgramRenderer value={(answers[q.key] as string) || ''} onChange={(v) => set(q.key, v)} disabled={submitting || previewOnly} />
                )}
                {q.kind === 'subjective' && (
                  <div className="flex flex-col gap-1.5">
                    <Textarea
                      value={(answers[q.key] as string) || ''}
                      onChange={(e) => set(q.key, e.target.value)}
                      disabled={submitting || previewOnly}
                      rows={6}
                      placeholder="在此作答（主观题）"
                    />
                    <p className="text-2xs text-fg-subtle">本题为主观题，提交后由老师人工评分，评分完成前记录显示「等待中」。</p>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        {error ? (
          <Alert tone="danger">
            <span className="block min-w-0 break-words">{error}</span>
          </Alert>
        ) : null}

        <div className="flex flex-col-reverse flex-wrap items-stretch gap-3 border-t border-line pt-4 sm:flex-row sm:items-center sm:justify-end">
          {previewOnly ? (
            <span className="min-w-0 break-words text-xs text-fg-subtle">只读预览；主观题不能从独立题目页提交。</span>
          ) : (
            <>
              <span className="min-w-0 break-words text-xs text-fg-subtle">草稿已自动保存在本机，提交后以评测记录为准。</span>
              <Button
                variant="primary"
                onClick={() => setConfirm({ kind: 'submit', missing: questions.length - answeredCount })}
                disabled={submitting || !signedIn}
                loading={submitting}
                className="w-full sm:w-auto"
              >
                <Send />
                {signedIn ? '提交答案' : '登录后可提交'}
              </Button>
            </>
          )}
        </div>
      </div>
      <Dialog open={!!confirm} onOpenChange={(open) => { if (!open && !submitting) setConfirm(null); }}>
        <DialogContent
          size="sm"
          onClose={() => {
            if (!submitting) setConfirm(null);
          }}
        >
          <DialogHeader>
            <DialogTitle>{confirm?.kind === 'clear' ? '清空已选答案' : '确认提交答案'}</DialogTitle>
            <DialogDescription className="leading-6">
              {confirm?.kind === 'clear'
                ? '将清除本题在本机保存的全部作答草稿，无法撤销。'
                : confirm && confirm.kind === 'submit' && confirm.missing > 0
                  ? `还有 ${confirm.missing} 道题未作答。提交后以评测记录为准，本机草稿会被清除。`
                  : '提交后以评测记录为准，本机草稿会被清除。'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="secondary" disabled={submitting} onClick={() => setConfirm(null)}>
              取消
            </Button>
            {confirm?.kind === 'clear' ? (
              <Button
                type="button"
                variant="danger"
                onClick={() => {
                  clearAll();
                  setConfirm(null);
                }}
              >
                确认清空
              </Button>
            ) : (
              <Button
                type="button"
                variant="primary"
                disabled={submitting}
                onClick={() => {
                  setConfirm(null);
                  void submit();
                }}
              >
                {submitting ? '提交中…' : '确认提交'}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Panel>
  );
}
