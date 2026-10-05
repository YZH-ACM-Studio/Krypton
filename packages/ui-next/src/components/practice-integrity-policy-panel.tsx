import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
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

function samePolicy(left: PracticeIntegrityPolicyView, right: PracticeIntegrityPolicyView): boolean {
  return (
    left.prohibitExternalCodeInjection === right.prohibitExternalCodeInjection &&
    left.removeIndependentSubmitForm === right.removeIndependentSubmitForm &&
    left.antiAiCopyInjection === right.antiAiCopyInjection
  );
}

type PolicyWriteOperation = 'save' | 'publish' | 'saveAndPublish';

function writeFailureMessage(operation: PolicyWriteOperation): string {
  return operation === 'save' ? '保存真实性策略失败' : '发布真实性策略失败';
}

export function PracticeIntegrityPolicyPanel({ containerKind, containerId }: { containerKind: 'course' | 'problemSet'; containerId: string }) {
  const endpoint = `/practice-integrity/${containerKind}/${containerId}`;
  const [published, setPublished] = useState<PolicyRevisionView | null>(null);
  const [draft, setDraft] = useState<PolicyRevisionView | null>(null);
  const [policy, setPolicy] = useState<PracticeIntegrityPolicyView>(EMPTY_POLICY);
  const [loading, setLoading] = useState(true);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState<PolicyWriteOperation | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const writesDisabled = loading || !ready || busy !== null;

  const load = async () => {
    setLoading(true);
    setReady(false);
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
    setReady(true);
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

  const postPolicy = async (operation: PolicyWriteOperation) => {
    setBusy(operation);
    setError('');
    setNotice('');
    const failure = writeFailureMessage(operation);
    try {
      const body = new URLSearchParams({
        operation,
        expectedDraftVersion: String(draft?.draftVersion || 0),
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
        failure,
      );
      if (!response.ok) {
        throw new Error(await readHydroResponseError(response, failure));
      }
      const payload = (await response.json()) as { published?: unknown; draft?: unknown };
      if (operation === 'save') {
        const nextDraft = asRevision(payload.draft);
        if (!nextDraft) throw new TypeError('草稿保存结果无效');
        setDraft(nextDraft);
        setPolicy(nextDraft.policy);
        setNotice('草稿已保存。学生在你点「发布到学生」之前不会受影响。');
        return;
      }
      const nextPublished = asRevision(payload.published);
      if (!nextPublished) throw new TypeError('发布结果无效');
      setPublished(nextPublished);
      setDraft(null);
      setPolicy(nextPublished.policy);
      setNotice(`已发布第 ${nextPublished.revision} 版，学生现在会按该版生效。`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : failure);
    } finally {
      setBusy(null);
    }
  };

  const publishToStudents = () => {
    const needsSave = !draft || !samePolicy(policy, draft.policy);
    void postPolicy(needsSave ? 'saveAndPublish' : 'publish');
  };

  const toggle = (field: keyof PracticeIntegrityPolicyView) => {
    setPolicy((current) => ({ ...current, [field]: !current[field] }));
    setNotice('');
  };

  return (
    <div className="min-w-0 space-y-3">
      {loading ? <p className="text-xs text-fg-subtle">正在读取当前策略…</p> : null}
      {error ? (
        <p role="alert" className="text-xs text-danger-fg">
          {error}
        </p>
      ) : null}
      {notice ? <p className="min-w-0 text-xs text-fg-subtle">{notice}</p> : null}
      <p className="min-w-0 text-xs text-fg-subtle tabular">
        {published ? `学生当前生效：第 ${published.revision} 版。` : '还没有发布过策略，学生不受限制。'}
        {draft ? ` 有未发布草稿（版本 ${draft.draftVersion}）。` : ''}
      </p>
      <label className="flex min-w-0 items-start gap-2.5 text-sm text-fg">
        <Switch
          checked={policy.prohibitExternalCodeInjection}
          disabled={writesDisabled}
          onCheckedChange={() => toggle('prohibitExternalCodeInjection')}
        />
        <span className="min-w-0">
          禁止粘贴或拖入外部代码
          <span className="mt-0.5 block text-xs text-fg-subtle">学生只能在题面 IDE 里手打。不会拦截操作系统剪贴板或其它软件。</span>
        </span>
      </label>
      <label className="flex min-w-0 items-start gap-2.5 text-sm text-fg">
        <Switch
          checked={policy.removeIndependentSubmitForm}
          disabled={writesDisabled}
          onCheckedChange={() => toggle('removeIndependentSubmitForm')}
        />
        <span className="min-w-0">
          只许用题面内的 Krypton IDE 提交
          <span className="mt-0.5 block text-xs text-fg-subtle">关闭独立提交页和旁路表单；IDE 里的自测和提交仍可用。</span>
        </span>
      </label>
      <label className="flex min-w-0 items-start gap-2.5 text-sm text-fg">
        <Switch checked={policy.antiAiCopyInjection} disabled={writesDisabled} onCheckedChange={() => toggle('antiAiCopyInjection')} />
        <span className="min-w-0">
          防 AI 复制注入
          <span className="mt-0.5 block text-xs text-fg-subtle">只在从本课或本题集入口进入题目时生效；题库直达和作业不会注入。</span>
        </span>
      </label>
      <div className="flex min-w-0 flex-wrap gap-2">
        <Button type="button" variant="secondary" size="sm" disabled={writesDisabled} onClick={publishToStudents}>
          {busy === 'publish' || busy === 'saveAndPublish' ? '发布中…' : '发布到学生'}
        </Button>
        <Button type="button" variant="secondary" size="sm" disabled={writesDisabled} onClick={() => void postPolicy('save')}>
          {busy === 'save' ? '保存中…' : '仅保存草稿'}
        </Button>
      </div>
    </div>
  );
}
