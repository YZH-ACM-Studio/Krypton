import { useState, type FormEvent } from 'react';
import { SOURCE_FIELDS, sourceTemplateTags, type SourceField, type SourceTemplateDefinition, type SourceTemplateView } from '@hydrooj/common';
import { ProblemBankNav } from '@/components/problem-bank-nav';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { confirmDialog, Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Page, PageHeader } from '@/components/ui/page';
import { Panel } from '@/components/ui/panel';
import { SimpleSelect } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useBootstrap } from '@/lib/bootstrap';
import { fetchHydroResponse, readHydroResponseError } from '@/lib/error-presenter';

interface PageData {
  templates: SourceTemplateView[];
  pidNamespaces: Array<{ namespaceId: string; name: string; pidPattern: string }>;
  sourceTemplateUrl: string;
  pidNamespaceUrl: string;
  problemReviewUrl: string;
}

type Definition = Omit<SourceTemplateDefinition, 'id'>;
const fieldLabels: Record<SourceField, string> = { year: '年份', season: '季度', level: '等级', round: '场次' };

function definitionOf(template: SourceTemplateView): Definition {
  const { id: _id, revision: _revision, references: _references, ...definition } = template;
  return definition;
}

export function ProblemSourceTemplatesPage() {
  const bs = useBootstrap();
  const data = bs.page.data as PageData;
  const [editing, setEditing] = useState<SourceTemplateView | 'new' | null>(null);
  const [form, setForm] = useState<Definition>({ label: '', enabled: true, fields: [], fixedTags: [], trainingAnchorTag: '', pidNamespaceId: '' });
  const [tagText, setTagText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const current = editing && editing !== 'new' ? editing : null;
  const locked = (current?.references || 0) > 0;
  const tags = [
    ...new Set(
      tagText
        .split(/[,，\n]/)
        .map((tag) => tag.trim())
        .filter(Boolean),
    ),
  ];
  const primaryTag = tags.length === 1 ? tags[0] : form.trainingAnchorTag;
  const requiresYear = ['builtin:cauc', 'builtin:gplt'].includes(form.pidNamespaceId) || form.yearTagSuffix !== undefined || form.seasonTag;
  const preview = sourceTemplateTags(
    { ...form, id: current?.id || 'preview', fixedTags: tags },
    {
      template: current?.id || 'preview',
      year: new Date().getFullYear(),
      season: 'spring',
      level: 'L1',
      round: 1,
    },
  );

  function open(template: SourceTemplateView | 'new') {
    setEditing(template);
    setError('');
    setForm(
      template === 'new'
        ? {
            label: '',
            enabled: true,
            fields: [],
            fixedTags: [],
            trainingAnchorTag: '',
            pidNamespaceId:
              data.pidNamespaces.find((namespace) => namespace.namespaceId === 'builtin:self')?.namespaceId ||
              data.pidNamespaces[0]?.namespaceId ||
              '',
          }
        : definitionOf(template),
    );
    setTagText(template === 'new' ? '' : template.fixedTags.join(', '));
  }

  async function submitOperation(operation: 'create' | 'update' | 'delete', template: SourceTemplateView | null, definition?: Definition) {
    setBusy(true);
    setError('');
    try {
      const response = await fetchHydroResponse(data.sourceTemplateUrl, {
        method: 'POST',
        credentials: 'include',
        headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
        body: new URLSearchParams({
          operation,
          ...(template ? { id: template.id, expectedRevision: String(template.revision) } : {}),
          ...(definition ? { definition: JSON.stringify(definition) } : {}),
        }),
      });
      if (!response.ok) throw new Error(await readHydroResponseError(response, '来源模板操作失败'));
      const result: unknown = await response.json();
      if (!result || typeof result !== 'object' || !('ok' in result) || result.ok !== true) throw new Error('服务器未确认来源模板操作成功');
      window.location.reload();
    } catch (cause) {
      console.error('Source template operation failed', { operation, templateId: template?.id, cause });
      setError(cause instanceof Error ? cause.message : '来源模板操作失败');
      setBusy(false);
    }
  }

  function save(event: FormEvent) {
    event.preventDefault();
    void submitOperation(current ? 'update' : 'create', current, { ...form, fixedTags: tags, trainingAnchorTag: primaryTag });
  }

  function toggleField(field: SourceField, checked: boolean) {
    setForm((previous) => ({
      ...previous,
      fields: SOURCE_FIELDS.filter((item) => (item === field ? checked : previous.fields.includes(item))),
      ...(field === 'season' && !checked ? { seasonTag: undefined } : {}),
      ...(field === 'level' && !checked ? { levelTag: undefined } : {}),
    }));
  }

  return (
    <Page width="wide">
      <PageHeader
        title="来源模板"
        description="管理创建题目时的来源信息、来源标签与题号归属。"
        actions={
          <Button variant="primary" onClick={() => open('new')} disabled={busy}>
            新建来源模板
          </Button>
        }
      />
      <ProblemBankNav
        active="sources"
        problemsUrl={bs.urls.problems}
        reviewUrl={data.problemReviewUrl}
        canReview
        namespaceUrl={data.pidNamespaceUrl}
        canManageNamespaces
        sourceTemplateUrl={data.sourceTemplateUrl}
      />
      {error && !editing ? <Alert tone="danger">{error}</Alert> : null}
      <Panel>
        {data.templates.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>名称</TableHead>
                <TableHead>题号命名空间</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>引用题数</TableHead>
                <TableHead>操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.templates.map((template) => (
                <TableRow key={template.id}>
                  <TableCell className="font-medium">{template.label}</TableCell>
                  <TableCell>
                    {data.pidNamespaces.find((namespace) => namespace.namespaceId === template.pidNamespaceId)?.name || template.pidNamespaceId}
                  </TableCell>
                  <TableCell>
                    <Badge tone={template.enabled ? 'success' : 'warning'}>{template.enabled ? '已启用' : '已停用'}</Badge>
                  </TableCell>
                  <TableCell className="tabular">{template.references}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="secondary" disabled={busy} onClick={() => open(template)}>
                        编辑
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        onClick={() => void submitOperation('update', template, { ...definitionOf(template), enabled: !template.enabled })}
                      >
                        {template.enabled ? '停用' : '启用'}
                      </Button>
                      <Button
                        size="sm"
                        variant="danger-soft"
                        disabled={busy || template.references > 0}
                        title={template.references ? '仍有题目引用，只能停用' : undefined}
                        onClick={async () => {
                          if (
                            await confirmDialog(`“${template.label}”当前没有题目引用。删除后将不再出现在创建题目的来源选项中。`, {
                              title: '删除来源模板？',
                              confirmLabel: '删除',
                              destructive: true,
                            })
                          ) {
                            await submitOperation('delete', template);
                          }
                        }}
                      >
                        删除
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <EmptyState title="还没有来源模板" description="新增模板后，出题人就可以在对应命名空间下使用。" />
        )}
      </Panel>
      <Dialog
        open={editing !== null}
        onOpenChange={(openState) => {
          if (!openState && !busy) setEditing(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{current ? '编辑来源模板' : '新建来源模板'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={save}>
            <DialogBody className="space-y-4">
              {error ? <Alert tone="danger">{error}</Alert> : null}
              {locked ? <Alert tone="info">当前有 {current?.references} 道题引用，只能修改名称和启停状态。停用不会影响已有题目。</Alert> : null}
              <label className="block space-y-1.5">
                <span className="text-sm font-medium">名称</span>
                <Input
                  value={form.label}
                  required
                  maxLength={80}
                  onChange={(event) => {
                    const label = event.target.value;
                    if (editing === 'new' && tagText === form.label) setTagText(label);
                    setForm((previous) => ({
                      ...previous,
                      label,
                      ...(editing === 'new' && previous.trainingAnchorTag === previous.label ? { trainingAnchorTag: label } : {}),
                    }));
                  }}
                />
              </label>
              <label className="flex items-center justify-between gap-3">
                <span className="text-sm font-medium">启用模板</span>
                <Switch checked={form.enabled} onCheckedChange={(enabled) => setForm((previous) => ({ ...previous, enabled }))} />
              </label>
              <label htmlFor="source-template-namespace" className="block space-y-1.5">
                <span className="text-sm font-medium">题号命名空间</span>
                <SimpleSelect
                  id="source-template-namespace"
                  value={form.pidNamespaceId}
                  disabled={locked}
                  options={data.pidNamespaces.map((namespace) => ({
                    value: namespace.namespaceId,
                    label: `${namespace.name} · ${namespace.pidPattern}`,
                  }))}
                  onValueChange={(pidNamespaceId) =>
                    setForm((previous) => ({
                      ...previous,
                      pidNamespaceId,
                      pidStage: undefined,
                      fields: ['builtin:cauc', 'builtin:gplt'].includes(pidNamespaceId)
                        ? SOURCE_FIELDS.filter((field) => field === 'year' || previous.fields.includes(field))
                        : previous.fields,
                    }))
                  }
                />
              </label>
              {form.pidNamespaceId === 'builtin:gplt' ? (
                <label className="block space-y-1.5">
                  <span className="text-sm font-medium">天梯编号分支</span>
                  <SimpleSelect
                    value={form.pidStage || ''}
                    disabled={locked}
                    placeholder="请选择全国或省级"
                    options={[
                      { value: 'national', label: '全国 · N' },
                      { value: 'provincial', label: '省级 · P' },
                    ]}
                    onValueChange={(value) => {
                      if (value !== 'national' && value !== 'provincial') throw new Error('天梯编号分支无效');
                      setForm((previous) => ({ ...previous, pidStage: value }));
                    }}
                  />
                </label>
              ) : null}
              <fieldset disabled={locked} className="space-y-2">
                <legend className="text-sm font-medium">出题时填写的信息</legend>
                <div className="flex flex-wrap gap-4">
                  {SOURCE_FIELDS.map((field) => (
                    <label key={field} className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={form.fields.includes(field)}
                        disabled={locked || (field === 'year' && !!requiresYear)}
                        onCheckedChange={(checked) => toggleField(field, checked)}
                      />
                      {fieldLabels[field]}
                    </label>
                  ))}
                </div>
                {requiresYear ? <p className="text-xs text-fg-subtle">当前题号或标签规则需要年份。</p> : null}
              </fieldset>
              <label className="block space-y-1.5">
                <span className="text-sm font-medium">固定来源标签</span>
                <Input
                  value={tagText}
                  disabled={locked}
                  required
                  placeholder="多个标签用逗号分隔"
                  onChange={(event) => setTagText(event.target.value)}
                />
              </label>
              {tags.length > 1 ? (
                <label htmlFor="source-template-anchor" className="block space-y-1.5">
                  <span className="text-sm font-medium">主来源标签</span>
                  <SimpleSelect
                    id="source-template-anchor"
                    value={primaryTag}
                    disabled={locked}
                    options={tags.map((tag) => ({ value: tag, label: tag }))}
                    onValueChange={(trainingAnchorTag) => setForm((previous) => ({ ...previous, trainingAnchorTag }))}
                  />
                  <p className="text-xs text-fg-subtle">用于匹配可挂入的训练。</p>
                </label>
              ) : null}
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={form.yearTagSuffix !== undefined}
                  disabled={locked}
                  onCheckedChange={(checked) =>
                    setForm((previous) => ({
                      ...previous,
                      yearTagSuffix: checked ? primaryTag : undefined,
                      fields: checked ? SOURCE_FIELDS.filter((field) => field === 'year' || previous.fields.includes(field)) : previous.fields,
                    }))
                  }
                />
                生成年份标签
              </label>
              {form.yearTagSuffix !== undefined ? (
                <label className="block space-y-1.5">
                  <span className="text-sm font-medium">年份标签后缀</span>
                  <Input
                    value={form.yearTagSuffix}
                    disabled={locked}
                    required
                    maxLength={80}
                    onChange={(event) => setForm((previous) => ({ ...previous, yearTagSuffix: event.target.value }))}
                  />
                </label>
              ) : null}
              {current?.seasonTag ? (
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={!!form.seasonTag}
                    disabled={locked}
                    onCheckedChange={(checked) =>
                      setForm((previous) => ({
                        ...previous,
                        seasonTag: checked || undefined,
                        fields: checked
                          ? SOURCE_FIELDS.filter((field) => ['year', 'season'].includes(field) || previous.fields.includes(field))
                          : previous.fields,
                      }))
                    }
                  />
                  生成“年份＋季度”标签
                </label>
              ) : null}
              {current?.levelTag ? (
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={!!form.levelTag}
                    disabled={locked}
                    onCheckedChange={(checked) =>
                      setForm((previous) => ({
                        ...previous,
                        levelTag: checked || undefined,
                        fields: checked ? SOURCE_FIELDS.filter((field) => field === 'level' || previous.fields.includes(field)) : previous.fields,
                      }))
                    }
                  />
                  附加等级标签
                </label>
              ) : null}
              <div className="space-y-2">
                <p className="text-xs text-fg-subtle">标签示例</p>
                <div className="flex flex-wrap gap-1.5">
                  {preview.map((tag) => (
                    <Badge key={tag} variant="outline">
                      {tag}
                    </Badge>
                  ))}
                </div>
              </div>
            </DialogBody>
            <DialogFooter>
              <Button variant="secondary" type="button" disabled={busy} onClick={() => setEditing(null)}>
                取消
              </Button>
              <Button
                variant="primary"
                type="submit"
                disabled={busy || !form.pidNamespaceId || !tags.includes(primaryTag) || (form.pidNamespaceId === 'builtin:gplt' && !form.pidStage)}
              >
                {busy ? '保存中…' : '保存'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Page>
  );
}
