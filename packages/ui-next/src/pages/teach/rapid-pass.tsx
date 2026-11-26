import {
  parseRapidPassEvidence, parseRapidPassRule, type RapidPassEvidence, type RapidPassRule,
} from '@hydrooj/common';
import { useEffect, useRef, useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { getJson, postJson } from './api';

interface Review {
  rule: RapidPassRule;
  revision: number;
  signals: Map<string, RapidPassEvidence>;
}

function readReview(value: unknown): Review {
  if (!value || typeof value !== 'object' || !('rule' in value) || !('revision' in value)
    || typeof value.revision !== 'number' || !Number.isSafeInteger(value.revision) || value.revision < 0
    || !('signals' in value) || !value.signals || typeof value.signals !== 'object' || Array.isArray(value.signals)) {
    throw new TypeError('作答速度分析响应无效。');
  }
  const signals = new Map<string, RapidPassEvidence>();
  for (const [uid, signal] of Object.entries(value.signals)) {
    if (!/^[1-9]\d*$/.test(uid)) throw new TypeError('作答速度分析的学生编号无效。');
    signals.set(`user:${uid}`, parseRapidPassEvidence(signal));
  }
  return { rule: parseRapidPassRule(value.rule), revision: value.revision, signals };
}

export function useRapidPassReview(url: string | null) {
  const [review, setReview] = useState<Review | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const generation = useRef(0);
  const writing = useRef(false);
  useEffect(() => {
    const current = ++generation.current;
    writing.current = false;
    setReview(null);
    setSaving(false);
    setError('');
    if (!url) return;
    getJson(url, '读取作答速度分析失败').then(readReview).then((result) => {
      if (generation.current === current) setReview(result);
    }).catch((cause: unknown) => {
      if (generation.current === current) setError(cause instanceof Error ? cause.message : '读取作答速度分析失败');
    });
    return () => { generation.current++; };
  }, [url, attempt]);

  async function save(rule: RapidPassRule) {
    if (!url || !review || writing.current) return;
    const current = generation.current;
    writing.current = true;
    setSaving(true);
    setError('');
    try {
      const result = readReview(await postJson(url, { rule: parseRapidPassRule(rule), revision: review.revision }, '保存分析设置失败'));
      if (generation.current === current) setReview(result);
    } catch (cause: unknown) {
      if (generation.current === current) setError(cause instanceof Error ? cause.message : '保存分析设置失败');
    } finally {
      if (generation.current === current) {
        writing.current = false;
        setSaving(false);
      }
    }
  }
  return { review, saving, error, save, reload: () => setAttempt((previous) => previous + 1) };
}

export function RapidPassControls({ state }: { state: ReturnType<typeof useRapidPassReview> }) {
  const { review, saving, save } = state;
  return <div className="space-y-2">
    {state.error ? <Alert tone="warning" action={<Button size="sm" variant="secondary" onClick={state.reload}>重新读取</Button>}>{state.error}</Alert> : null}
    {review ? <details className="rounded-lg border border-line bg-surface px-4 py-3">
      <summary className="cursor-pointer text-sm font-medium text-fg">
        作答速度提示
        <span className="ml-2 font-normal text-fg-subtle">{review.rule.enabled ? `${review.rule.minutes} 分钟内至少通过 ${review.rule.minProblems} 题` : '已关闭'}</span>
      </summary>
      <fieldset disabled={saving} className="mt-3 flex flex-wrap items-end gap-x-5 gap-y-3 text-sm">
        <label className="flex items-center gap-2">
          <Switch checked={review.rule.enabled} onCheckedChange={(enabled) => { void save({ ...review.rule, enabled }); }} />
          在成绩行提示
        </label>
        {review.rule.enabled ? (['minutes', 'minProblems'] as const).map((key) => (
          <label key={key} className="flex flex-col gap-1 text-xs text-fg-subtle">
            {key === 'minutes' ? '时间窗口（分钟）' : '至少通过题数'}
            <Input
key={review.revision}
type="number"
className="w-28"
min={key === 'minutes' ? 1 : 2}
max={key === 'minutes' ? 180 : 200}
              defaultValue={review.rule[key]}
onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }}
              onBlur={(event) => {
                const value = event.currentTarget.valueAsNumber;
                if (value !== review.rule[key]) void save({ ...review.rule, [key]: value });
              }} />
          </label>
        )) : null}
        {saving ? <span role="status" className="text-xs text-fg-muted">正在保存…</span> : null}
      </fieldset>
      <p className="mt-2 text-xs text-fg-muted">按学生每轮的正式作答统计。批量保存从本轮开始计时，单独提交的代码题也检查连续通过的用时。提示仅供教师核查。</p>
    </details> : null}
  </div>;
}

export function RapidPassMark({ evidence }: { evidence: RapidPassEvidence }) {
  const minutes = Math.floor(evidence.seconds / 60);
  const seconds = evidence.seconds % 60;
  const duration = minutes ? `${minutes}分${seconds ? `${seconds}秒` : ''}` : `${seconds}秒`;
  return <span className="mt-1 block">
    <Badge tone="warning" size="sm">短时多题通过 · 待核查</Badge>
    <span className="mt-0.5 block text-xs font-normal text-fg-muted">
      第{evidence.roundNo}轮 · {evidence.fromStart ? '开始后' : '连续'}{duration}通过 {evidence.passed}/{evidence.total} 题
    </span>
  </span>;
}
