import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { fetchHydroResponse, readHydroResponseError } from '@/lib/error-presenter';
import type { PracticeIntegrityPolicyView } from '@/lib/practice-integrity';

interface PolicyRevisionView {
  revision: number;
  state: 'draft' | 'published';
  draftVersion?: number;
  policy: PracticeIntegrityPolicyView;
  publishedAt?: string;
  updatedAt?: string;
}

const EMPTY_POLICY: PracticeIntegrityPolicyView = {
  prohibitExternalCodeInjection: false,
  removeIndependentSubmitForm: false,
  antiAiCopyInjection: false,
};

function asPolicy(value: unknown): PracticeIntegrityPolicyView {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('真实性策略格式无效');
  const record = value as Record<string, unknown>;
  for (const field of ['prohibitExternalCodeInjection', 'removeIndependentSubmitForm', 'antiAiCopyInjection'] as const) {
    if (typeof record[field] !== 'boolean') throw new TypeError('真实性策略格式无效');
  }
  return {
    prohibitExternalCodeInjection: record.prohibitExternalCodeInjection as boolean,
    removeIndependentSubmitForm: record.removeIndependentSubmitForm as boolean,
    antiAiCopyInjection: record.antiAiCopyInjection as boolean,
  };
}

function asRevision(value: unknown): PolicyRevisionView | null {
  if (value === null || value === undefined) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('真实性策略版本格式无效');
  const record = value as Record<string, unknown>;
  if ((record.state !== 'draft' && record.state !== 'published') || !Number.isSafeInteger(record.revision) || Number(record.revision) <= 0) {
    throw new TypeError('真实性策略版本格式无效');
  }
  return {
    revision: Number(record.revision),
    state: record.state,
    ...(record.draftVersion === undefined ? {} : { draftVersion: Number(record.draftVersion) }),
    policy: asPolicy(record.policy),
    ...(typeof record.publishedAt === 'string' ? { publishedAt: record.publishedAt } : {}),
    ...(typeof record.updatedAt === 'string' ? { updatedAt: record.updatedAt } : {}),
  };
}

export function PracticeIntegrityPolicyPanel({ containerKind, containerId }: { containerKind: 'course' | 'problemSet'; containerId: string }) {
  const endpoint = `/practice-integrity/${containerKind}/${containerId}`;
  const [published, setPublished] = useState<PolicyRevisionView | null>(null);
  const [draft, setDraft] = useState<PolicyRevisionView | null>(null);
  const [policy, setPolicy] = useState<PracticeIntegrityPolicyView>(EMPTY_POLICY);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<'save' | 'publish' | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    const response = await fetchHydroResponse(
      endpoint,
      { credentials: 'same-origin', headers: { Accept: 'application/json' } },
      '无法读取真实性策略',
    );
    if (!response.ok) throw new Error(await readHydroResponseError(response, '无法读取真实性策略'));
    const body = (await response.json()) as { published?: unknown; draft?: unknown };
    const nextPublished = asRevision(body.published);
    const nextDraft = asRevision(body.draft);
    setPublished(nextPublished);
    setDraft(nextDraft);
    setPolicy(nextDraft?.policy || nextPublished?.policy || EMPTY_POLICY);
  };

  useEffect(() => {
    let cancelled = false;
    load()
      .catch((cause) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : '无法读取真实性策略');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [endpoint]);

  const postPolicy = async (operation: 'save' | 'publish') => {
    setBusy(operation);
    setError('');
    setNotice('');
    try {
      const body = new URLSearchParams({
        operation,
        expectedDraftVersion: String(operation === 'publish' ? draft?.draftVersion || 0 : draft?.draftVersion || 0),
        prohibitExternalCodeInjection: policy.prohibitExternalCodeInjection ? 'true' : 'false',
        removeIndependentSubmitForm: policy.removeIndependentSubmitForm ? 'true' : 'false',
        antiAiCopyInjection: policy.antiAiCopyInjection ? 'true' : 'false',
      });
      const response = await fetchHydroResponse(
        endpoint,
        {
          method: 'POST',
          body,
          credentials: 'same-origin',
          headers: { Accept: 'application/json' },
        },
        operation === 'publish' ? '发布真实性策略失败' : '保存真实性策略失败',
      );
      if (!response.ok) {
        throw new Error(await readHydroResponseError(response, operation === 'publish' ? '发布真实性策略失败' : '保存真实性策略失败'));
      }
      const payload = (await response.json()) as { published?: unknown; draft?: unknown };
      if (operation === 'publish') {
        const nextPublished = asRevision(payload.published);
        if (!nextPublished) throw new TypeError('发布结果无效');
        setPublished(nextPublished);
        setDraft(null);
        setPolicy(nextPublished.policy);
        setNotice(`已发布第 ${nextPublished.revision} 版，学生现在会按该版生效。`);
      } else {
        const nextDraft = asRevision(payload.draft);
        if (!nextDraft) throw new TypeError('草稿保存结果无效');
        setDraft(nextDraft);
        setPolicy(nextDraft.policy);
        setNotice('草稿已保存。学生在你点「发布」之前不会受影响。');
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : operation === 'publish' ? '发布真实性策略失败' : '保存真实性策略失败');
    } finally {
      setBusy(null);
    }
  };

  const toggle = (field: keyof PracticeIntegrityPolicyView) => {
    setPolicy((current) => ({ ...current, [field]: !current[field] }));
    setNotice('');
  };

  return (
    <div className="space-y-3">
      {loading ? <p className="text-xs text-muted-foreground">正在读取当前策略…</p> : null}
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
      {notice ? <p className="text-xs text-muted-foreground">{notice}</p> : null}
      <p className="text-xs text-muted-foreground">
        {published ? `学生当前生效：第 ${published.revision} 版。` : '还没有发布过策略，学生不受限制。'}
        {draft ? ` 有未发布草稿（版本 ${draft.draftVersion}）。` : ''}
      </p>
      <label className="flex items-start gap-2.5 text-sm">
        <Checkbox
          checked={policy.prohibitExternalCodeInjection}
          disabled={loading || busy !== null}
          onCheckedChange={() => toggle('prohibitExternalCodeInjection')}
        />
        <span>
          禁止粘贴或拖入外部代码
          <span className="mt-0.5 block text-xs text-muted-foreground">学生只能在题面 IDE 里手打。不会拦截操作系统剪贴板或其它软件。</span>
        </span>
      </label>
      <label className="flex items-start gap-2.5 text-sm">
        <Checkbox
          checked={policy.removeIndependentSubmitForm}
          disabled={loading || busy !== null}
          onCheckedChange={() => toggle('removeIndependentSubmitForm')}
        />
        <span>
          只许用题面内的 Krypton IDE 提交
          <span className="mt-0.5 block text-xs text-muted-foreground">关闭独立提交页和旁路表单；IDE 里的自测和提交仍可用。</span>
        </span>
      </label>
      <label className="flex items-start gap-2.5 text-sm">
        <Checkbox checked={policy.antiAiCopyInjection} disabled={loading || busy !== null} onCheckedChange={() => toggle('antiAiCopyInjection')} />
        <span>
          防 AI 复制注入
          <span className="mt-0.5 block text-xs text-muted-foreground">只在从本课或本题集入口进入题目时生效；题库直达和作业不会注入。</span>
        </span>
      </label>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" disabled={loading || busy !== null} onClick={() => void postPolicy('save')}>
          {busy === 'save' ? '保存中…' : '保存草稿'}
        </Button>
        <Button type="button" size="sm" disabled={loading || busy !== null || !draft} onClick={() => void postPolicy('publish')}>
          {busy === 'publish' ? '发布中…' : '发布'}
        </Button>
      </div>
    </div>
  );
}
