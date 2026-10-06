import { useEffect, useRef, useState, type JSX, type ReactNode } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { ActionBar, type ActionBarTone } from '@/components/admin/action-bar';
import { RevisionHistory } from '@/components/admin/revision-history';
import type { DomainUserOption } from '@/components/domain-user-search';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { FormField, FormRow } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Menu } from '@/components/ui/menu';
import { Panel } from '@/components/ui/panel';
import { SimpleSelect } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/toast';
import { useBootstrap } from '@/lib/bootstrap';
import {
  collaboratorsFromUids,
  formatDate,
  formatPorts,
  hydrateCollaborators,
  latestPolicyRevision,
  parseTemplate,
  policyExpansion,
  postJson,
  samePolicy,
  splitValues,
  type ConfirmPlan,
  type NetworkConfig,
  type NetworkPolicy,
  type PolicyRevision,
  type PolicyTemplate,
} from './model';
import { CollaboratorSelect, MutationNotice } from './shared';

function policyRules(policy: NetworkPolicy): JSX.Element {
  return (
    <div className="space-y-1">
      <p>{`域名：${policy.hosts.join('、') || '无'}`}</p>
      <p>{`IP：${policy.ips.join('、') || '无'}`}</p>
      <p>{`端口：${formatPorts(policy.ports)}`}</p>
    </div>
  );
}

export function PolicyStep({
  eventId,
  templates,
  suggestedPolicy,
  config,
  readOnly,
  displayName,
  reload,
  requestConfirm,
}: {
  eventId: string;
  templates: PolicyTemplate[];
  suggestedPolicy: NetworkPolicy | null;
  config: NetworkConfig | null;
  readOnly: boolean;
  displayName: (uid: number | null | undefined) => string;
  reload: () => Promise<void>;
  requestConfirm: (plan: ConfirmPlan) => void;
}): JSX.Element {
  const bs = useBootstrap();
  const [selectedId, setSelectedId] = useState('');
  const activeTemplates = templates.filter((template) => template.status === 'active');
  const selected = selectedId === '__new__'
    ? null
    : activeTemplates.find((template) => template.templateId === selectedId)
      || activeTemplates.find((template) => template.templateId === config?.policy?.id)
      || activeTemplates[0]
      || null;
  const [name, setName] = useState('');
  const [hosts, setHosts] = useState('');
  const [ips, setIps] = useState('');
  const [ports, setPorts] = useState('');
  const [collaborators, setCollaborators] = useState<DomainUserOption[]>([]);
  const [busyAction, setBusyAction] = useState<'save' | 'publish' | 'archive' | 'assign' | null>(null);
  const busy = busyAction !== null;
  const [error, setError] = useState<string | null>(null);
  const hydrateSeq = useRef(0);
  useEffect(() => {
    const seq = ++hydrateSeq.current;
    if (!selected) {
      setName('');
      setHosts(suggestedPolicy?.hosts.join('\n') || '');
      setIps(suggestedPolicy?.ips.join('\n') || '');
      setPorts(suggestedPolicy?.ports.join(', ') || '');
      setCollaborators([]);
      return;
    }
    setSelectedId(selected.templateId);
    setName(selected.name);
    setHosts(selected.draft.policy.hosts.join('\n'));
    setIps(selected.draft.policy.ips.join('\n'));
    setPorts(selected.draft.policy.ports.join(', '));
    setCollaborators(collaboratorsFromUids(selected.collaboratorUids));
    void hydrateCollaborators(bs.domain.id, selected.collaboratorUids).then((next) => {
      if (seq === hydrateSeq.current) setCollaborators(next);
    });
  }, [bs.domain.id, selected?.collaboratorUids?.join(','), selected?.revision, selected?.templateId, suggestedPolicy]);
  const policy = (): NetworkPolicy => ({
    hosts: splitValues(hosts),
    ips: splitValues(ips),
    ports: splitValues(ports).map((value) => Number(value)),
  });
  const collaboratorUids = collaborators.map((user) => user._id);
  const dirty = selected
    ? JSON.stringify({
      name,
      policy: policy(),
      collaboratorUids: [...collaboratorUids].sort((left, right) => left - right),
    }) !== JSON.stringify({
      name: selected.name,
      policy: selected.draft.policy,
      collaboratorUids: [...selected.collaboratorUids].sort((left, right) => left - right),
    })
    : false;
  const latest = selected ? latestPolicyRevision(selected) : null;
  const assigned = selected !== null
    && latest !== null
    && config?.policy?.id === selected.templateId
    && config.policy?.revision === latest.revision;
  const added = policyExpansion(policy(), latest?.policy || null);
  const discard = () => {
    if (!selected) return;
    const seq = ++hydrateSeq.current;
    setName(selected.name);
    setHosts(selected.draft.policy.hosts.join('\n'));
    setIps(selected.draft.policy.ips.join('\n'));
    setPorts(selected.draft.policy.ports.join(', '));
    setCollaborators(collaboratorsFromUids(selected.collaboratorUids));
    void hydrateCollaborators(bs.domain.id, selected.collaboratorUids).then((next) => {
      if (seq === hydrateSeq.current) setCollaborators(next);
    });
  };
  const create = async () => {
    setBusyAction('save');
    setError(null);
    try {
      const payload = await postJson(
        `/api/admin/exam-policy-templates?eventId=${encodeURIComponent(eventId)}`,
        { eventId, name, policy: policy(), collaboratorUids },
        '创建策略失败',
      );
      const created = parseTemplate(payload.template);
      await reload();
      setSelectedId(created.templateId);
      toast.success('策略模板已创建');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '创建策略失败');
    } finally {
      setBusyAction(null);
    }
  };
  const save = async () => {
    if (!selected) return create();
    setBusyAction('save');
    setError(null);
    try {
      await postJson(
        `/api/admin/exam-policy-templates/${selected.templateId}?eventId=${encodeURIComponent(eventId)}`,
        {
          eventId,
          templateId: selected.templateId,
          action: 'saveDraft',
          expectedRevision: selected.revision,
          name,
          policy: policy(),
          collaboratorUids,
        },
        '保存策略草稿失败',
      );
      await reload();
      toast.success('草稿已保存');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '保存策略草稿失败');
    } finally {
      setBusyAction(null);
    }
  };
  const publish = async () => {
    if (!selected) return;
    const publishedRevision = (selected.latestPublishedRevision || 0) + 1;
    setBusyAction('publish');
    setError(null);
    try {
      await postJson(
        `/api/admin/exam-policy-templates/${selected.templateId}?eventId=${encodeURIComponent(eventId)}`,
        { eventId, templateId: selected.templateId, action: 'publish', expectedRevision: selected.revision },
        '发布策略失败',
      );
      await reload();
      toast.success(`已发布 v${publishedRevision}`);
    } finally {
      setBusyAction(null);
    }
  };
  const archive = async () => {
    if (!selected) return;
    setBusyAction('archive');
    setError(null);
    try {
      await postJson(
        `/api/admin/exam-policy-templates/${selected.templateId}?eventId=${encodeURIComponent(eventId)}`,
        { eventId, templateId: selected.templateId, action: 'archive', expectedRevision: selected.revision },
        '归档策略失败',
      );
      await reload();
      toast.success('策略模板已归档');
    } finally {
      setBusyAction(null);
    }
  };
  const assign = async (revision: PolicyRevision) => {
    if (!selected) return;
    setBusyAction('assign');
    setError(null);
    try {
      await postJson(
        `/api/admin/exam-events/${eventId}/network-config`,
        {
          eventId,
          action: 'assignPolicy',
          expectedRevision: config?.revision || 0,
          templateId: selected.templateId,
          revision: revision.revision,
        },
        '分配策略失败',
      );
      await reload();
      toast.success(`本活动策略已改为 v${revision.revision}`);
    } finally {
      setBusyAction(null);
    }
  };
  const openAssign = (revision: PolicyRevision) => {
    if (!selected) return;
    requestConfirm({
      title: '分配此策略版本？',
      description: '活动配置会通过 CAS 更新；已存在的执行仍固定使用启动时版本。',
      confirmLabel: '确认分配',
      facts: [
        { label: '策略', value: `${selected.name} · v${revision.revision}` },
        { label: '配置版本', value: `${config?.revision || 0} → ${(config?.revision || 0) + 1}` },
        { label: '策略指纹', value: revision.fingerprint.slice(0, 16) },
        { label: '执行影响', value: '不会自动启动或热更新' },
      ],
      run: () => assign(revision),
    });
  };
  const openArchive = () => {
    if (!selected) return;
    requestConfirm({
      title: '归档此策略模板？',
      description: '归档后该模板不再出现在活动策略选择器中。已发布的不可变版本会保留，不会删除历史修订。',
      confirmLabel: '确认归档',
      tone: 'destructive',
      facts: [
        { label: '模板', value: selected.name },
        { label: '模板版本', value: `${selected.revision} → ${selected.revision + 1}` },
        { label: '已发布版本', value: selected.latestPublishedRevision ? `v${selected.latestPublishedRevision}` : '无' },
      ],
      run: archive,
    });
  };
  const openPublish = () => {
    if (!selected) return;
    requestConfirm({
      title: '发布不可变策略版本？',
      description: added.length
        ? '本次策略增加了允许项，会放宽终端可访问范围。发布只生成版本，不会自动下发。'
        : '发布只生成不可变版本，不会自动下发到终端。',
      confirmLabel: '确认发布',
      tone: added.length ? 'destructive' : 'default',
      facts: [
        { label: '模板版本', value: `${selected.revision} → ${selected.revision + 1}` },
        { label: '发布策略版本', value: `v${(selected.latestPublishedRevision || 0) + 1}` },
        { label: '新增允许项', value: added.length ? added.join('、') : '无' },
        { label: '目标终端', value: '尚未下发；需后续明确分配并启动' },
      ],
      run: publish,
    });
  };
  let actionStatus: string | undefined;
  let actionTone: ActionBarTone = 'neutral';
  let actionEnd: ReactNode = null;
  if (!readOnly) {
    if (selected === null) {
      actionStatus = '新策略尚未创建';
      actionEnd = (
        <Button
          type="button"
          variant="primary"
          disabled={busy || !name.trim()}
          loading={busyAction === 'save'}
          onClick={() => void create()}
        >
          创建策略
        </Button>
      );
    } else if (dirty) {
      actionStatus = '有未保存修改';
      actionTone = 'warning';
      actionEnd = (
        <>
          <Button type="button" variant="secondary" disabled={busy} onClick={discard}>
            放弃修改
          </Button>
          <Button
            type="button"
            variant="primary"
            disabled={busy}
            loading={busyAction === 'save'}
            onClick={() => void save()}
          >
            保存草稿
          </Button>
        </>
      );
    } else if (latest === null || !samePolicy(selected.draft.policy, latest.policy)) {
      actionStatus = '草稿已保存，尚未发布';
      actionTone = 'warning';
      actionEnd = (
        <Button
          type="button"
          variant="primary"
          disabled={busy}
          loading={busyAction === 'publish'}
          onClick={openPublish}
        >
          {`发布为 v${(selected.latestPublishedRevision || 0) + 1}…`}
        </Button>
      );
    } else if (!assigned) {
      actionStatus = `v${latest.revision} 已发布，本活动尚未使用`;
      actionTone = 'warning';
      actionEnd = (
        <Button
          type="button"
          variant="primary"
          disabled={busy}
          loading={busyAction === 'assign'}
          onClick={() => openAssign(latest)}
        >
          设为本活动策略…
        </Button>
      );
    } else {
      actionStatus = `本活动正在使用 v${latest.revision}`;
      actionTone = 'success';
    }
  }
  const historySummary = selected === null
    ? ''
    : `${selected.revisions.length} 个已发布版本${selected.draft.updatedAt ? ` · 草稿最后由 ${displayName(selected.draft.updatedBy)} 修改于 ${formatDate(selected.draft.updatedAt)}` : ''}`;
  return (
    <Panel
      title="网络策略"
      description="编辑草稿，发布成不可变版本，再设为本活动使用的策略。已在运行的执行仍固定使用启动时的版本。"
      actions={(
        <>
          <SimpleSelect
            id="policy-template"
            ariaLabel="策略模板"
            value={selected?.templateId || '__new__'}
            disabled={readOnly}
            onValueChange={setSelectedId}
            size="sm"
            className="w-48"
            options={[
              { value: '__new__', label: '新建策略' },
              ...activeTemplates.map((template) => ({ value: template.templateId, label: template.name })),
            ]}
          />
          {selected && !readOnly ? (
            <Menu
              label="模板操作"
              trigger={(menuProps) => (
                <Button type="button" variant="ghost" size="sm" iconOnly aria-label="模板操作" {...menuProps}>
                  <MoreHorizontal />
                </Button>
              )}
              items={[{ label: '归档模板…', danger: true, disabled: busy, onSelect: openArchive }]}
            />
          ) : null}
        </>
      )}
      footer={<ActionBar status={actionStatus} statusTone={actionTone} end={actionEnd} />}
    >
      <div className="space-y-4">
        <MutationNotice error={error} />
        {readOnly ? <Alert tone="neutral">活动已归档，策略版本仅供查看。</Alert> : null}
        <FormRow columns={2}>
          <FormField label="策略名称" htmlFor="policy-name" required>
            <Input
              id="policy-name"
              value={name}
              disabled={readOnly}
              onChange={(event) => setName(event.target.value)}
              maxLength={120}
              placeholder="例如：CSP 考试网络"
            />
          </FormField>
          <FormField label="协作者" hint="可选。服务端会重新校验学校范围。基础设施管理员可以管理任意模板。">
            <CollaboratorSelect domainId={bs.domain.id} value={collaborators} onChange={setCollaborators} disabled={readOnly} />
          </FormField>
        </FormRow>
        <FormRow columns={3}>
          <FormField label="允许域名" htmlFor="policy-hosts" hint="每行一个精确域名或 *.example.com">
            <Textarea id="policy-hosts" value={hosts} disabled={readOnly} onChange={(event) => setHosts(event.target.value)} rows={5} />
          </FormField>
          <FormField label="允许 IP / CIDR" htmlFor="policy-ips" hint="必须显式包含 Vigil IP，例如 10.1.235.155；只填 OJ 会发布失败">
            <Textarea id="policy-ips" value={ips} disabled={readOnly} onChange={(event) => setIps(event.target.value)} rows={5} />
          </FormField>
          <FormField label="允许端口" htmlFor="policy-ports" hint="留空表示已填地址的全部端口；若填写则必须包含控制面端口和 1935">
            <Textarea id="policy-ports" value={ports} disabled={readOnly} onChange={(event) => setPorts(event.target.value)} rows={5} />
          </FormField>
        </FormRow>
        {selected && selected.revisions.length > 0 ? (
          <RevisionHistory
            title="版本历史"
            summary={historySummary}
            currentLabel="本活动使用中"
            rows={[...selected.revisions]
              .sort((left, right) => right.revision - left.revision)
              .map((revision) => {
                const current = config?.policy?.id === selected.templateId && config.policy?.revision === revision.revision;
                return {
                  key: String(revision.revision),
                  title: `v${revision.revision}`,
                  meta: `${formatDate(revision.publishedAt)} 发布`,
                  current,
                  action: current || readOnly ? undefined : (
                    <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={() => openAssign(revision)}>
                      改用此版本
                    </Button>
                  ),
                  detail: { summary: '查看规则', content: policyRules(revision.policy) },
                };
              })}
          />
        ) : null}
      </div>
    </Panel>
  );
}
