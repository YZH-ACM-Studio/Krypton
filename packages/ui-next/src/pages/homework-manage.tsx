/**
 * Homework management pages — edit and files.
 */

import { useEffect, useState } from 'react';
import { ArrowLeft, FolderOpen, Plus, Save, Trash2, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { confirmFormSubmit } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { FormField, FormRow } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Page, PageHeader } from '@/components/ui/page';
import { Panel } from '@/components/ui/panel';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { MarkdownEditor } from '@/components/markdown-renderer';
import { Switch } from '@/components/ui/switch';
import { Difficulty } from '@/components/ui/verdict';
import { MultiSelect } from '@/components/ui/multi-select';
import {
  COMMON_LANG_OPTIONS,
  type LangOption,
  resolveLangs,
  searchProblems,
  fetchProblemsByIds,
  mergeFetchedProblemTitles,
  type ProblemOption,
} from '@/lib/multi-select-presets';
import { useBootstrap } from '@/lib/bootstrap';
import { formatDateTime, replaceRouteTokens } from '@/lib/format';

interface HomeworkDocument {
  _id?: string | number;
  docId?: string | number;
  title?: string;
  langs?: string | string[];
  participantGroupIds?: Array<string | number>;
  assign?: string | string[];
  maintainer?: string | string[];
  content?: string | Record<string, string>;
  rated?: boolean;
}

interface HomeworkManageData {
  tdoc?: HomeworkDocument;
  page_name?: string;
  fromCourse?: string | number;
  chapter?: string | number;
  penaltyRules?: string;
  pids?: string;
  participantGroupIds?: Array<string | number>;
  scopeGroups?: Array<{ _id: string | number; name: string; archivedAt?: string }>;
  courseContext?: { courseTitle: string; chapterTitle: string };
  dateBeginText?: string;
  timeBeginText?: string;
  datePenaltyText?: string;
  timePenaltyText?: string;
  extensionDays?: number;
}

interface HomeworkFile {
  name: string;
  size?: number;
  lastModified?: string | Date;
}
interface ScopeOption {
  _id: string;
  name: string;
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

interface PenaltyRuleRow {
  id: string;
  hours: string;
  coefficient: string;
}

const DEFAULT_PENALTY_RULES: PenaltyRuleRow[] = [
  { id: 'default-1', hours: '1', coefficient: '0.9' },
  { id: 'default-3', hours: '3', coefficient: '0.8' },
  { id: 'default-12', hours: '12', coefficient: '0.75' },
  { id: 'default-9999', hours: '9999', coefficient: '0.5' },
];

function listInputValue(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value.join(',') : value || '';
}

/** Handler sends moment `YYYY-M-D`. Date inputs only accept `YYYY-MM-DD`. */
function htmlDateValue(value: string | undefined): string {
  const text = (value || '').trim();
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
  if (!match) return text;
  return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
}

/** Handler sends moment `H:mm` (hour 0 is `0:00`). Time inputs only accept `HH:mm`. */
function htmlTimeValue(value: string | undefined): string {
  const text = (value || '').trim();
  const match = /^(\d{1,2}):(\d{2})$/.exec(text);
  if (!match) return text;
  return `${match[1].padStart(2, '0')}:${match[2]}`;
}

function parsePenaltyRules(value: string | null | undefined): PenaltyRuleRow[] {
  if (!value?.trim()) return DEFAULT_PENALTY_RULES;
  const rows = value
    .split('\n')
    .map((line, index) => {
      const match = line.match(/^\s*([0-9]+(?:\.[0-9]+)?)\s*:\s*([0-9]+(?:\.[0-9]+)?)\s*(?:#.*)?$/);
      if (!match) return null;
      return { id: `rule-${index}-${match[1]}`, hours: match[1], coefficient: match[2] };
    })
    .filter(Boolean) as PenaltyRuleRow[];
  return rows.length ? rows : DEFAULT_PENALTY_RULES;
}

function serializePenaltyRules(rows: PenaltyRuleRow[]) {
  return rows
    .filter((row) => row.hours.trim() && row.coefficient.trim())
    .map((row) => `${row.hours.trim()}: ${row.coefficient.trim()}`)
    .join('\n');
}

function BackButton({ href }: { href: string }) {
  return (
    <Button asChild variant="ghost" size="sm" iconOnly>
      <a href={href} aria-label="返回">
        <ArrowLeft />
      </a>
    </Button>
  );
}

/* ---------- Homework Edit ---------- */

export function HomeworkEditPage() {
  const bs = useBootstrap();
  const data = bs.page.data as HomeworkManageData;
  const tdoc = data.tdoc || {};
  const isEdit = data.page_name === 'homework_edit';
  const hwUrl = data.fromCourse
    ? `/course/${data.fromCourse}?chapter=${data.chapter}`
    : isEdit
      ? replaceRouteTokens(bs.urls.homeworkDetail, { TID: String(tdoc.docId || tdoc._id) })
      : bs.urls.homework;
  const [penaltyRules, setPenaltyRules] = useState<PenaltyRuleRow[]>(() => parsePenaltyRules(data.penaltyRules));

  const updatePenaltyRule = (id: string, patch: Partial<PenaltyRuleRow>) => {
    setPenaltyRules((rows) => rows.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  };
  /* MultiSelect state — pids resolved async on mount, langs sync. */
  const initialPidCsv: string = (typeof data.pids === 'string' ? data.pids : '') || '';
  const initialPidIds = initialPidCsv
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const [pidValue, setPidValue] = useState<ProblemOption[]>(() =>
    initialPidIds.map((id) => ({
      docId: Number(id) || 0,
      pid: id,
      title: '',
    })),
  );
  useEffect(() => {
    if (!initialPidIds.length) return;
    let cancelled = false;
    fetchProblemsByIds(initialPidIds).then((res) => {
      if (cancelled) return;
      setPidValue((current) => mergeFetchedProblemTitles(current, initialPidIds, res));
    });
    return () => {
      cancelled = true;
    };
  }, []);
  const initialLangIds: string[] = Array.isArray(tdoc.langs)
    ? tdoc.langs
    : typeof tdoc.langs === 'string'
      ? tdoc.langs.split(',').filter(Boolean)
      : [];
  const [langValue, setLangValue] = useState<LangOption[]>(() => resolveLangs(initialLangIds));
  const initialGroupIds: string[] = (data.participantGroupIds || tdoc.participantGroupIds || []).map(String);
  const groupCatalog: ScopeOption[] = (data.scopeGroups || [])
    .filter((group) => !group.archivedAt || initialGroupIds.includes(String(group._id)))
    .map((group) => ({
      _id: String(group._id),
      name: group.archivedAt ? `${group.name}（已归档）` : group.name,
    }));
  const [participantGroups, setParticipantGroups] = useState<ScopeOption[]>(
    initialGroupIds.map((groupId) => groupCatalog.find((group) => group._id === groupId) || { _id: groupId, name: groupId }),
  );

  return (
    <Page width="form">
      <PageHeader
        title={isEdit ? '编辑作业' : '创建作业'}
        description={
          data.courseContext ? `${data.courseContext.courseTitle} · ${data.courseContext.chapterTitle}` : undefined
        }
        actions={<BackButton href={hwUrl} />}
      />

      <Panel>
        <form method="post" className="flex flex-col gap-5">
          {data.fromCourse ? (
            <>
              <input type="hidden" name="fromCourse" value={data.fromCourse} />
              <input type="hidden" name="chapter" value={data.chapter} />
            </>
          ) : null}
          <FormField label="作业标题" htmlFor="title" required>
            <Input id="title" name="title" defaultValue={tdoc.title || ''} required />
          </FormField>

          <FormRow columns={2}>
            <FormField label="开始日期" htmlFor="beginAtDate" required>
              <Input id="beginAtDate" name="beginAtDate" type="date" defaultValue={htmlDateValue(data.dateBeginText)} required />
            </FormField>
            <FormField label="开始时间" htmlFor="beginAtTime" required>
              <Input id="beginAtTime" name="beginAtTime" type="time" defaultValue={htmlTimeValue(data.timeBeginText)} required />
            </FormField>
          </FormRow>

          <FormRow columns={2}>
            <FormField label="截止日期" htmlFor="penaltySinceDate" required>
              <Input id="penaltySinceDate" name="penaltySinceDate" type="date" defaultValue={htmlDateValue(data.datePenaltyText)} required />
            </FormField>
            <FormField label="截止时间" htmlFor="penaltySinceTime" required>
              <Input id="penaltySinceTime" name="penaltySinceTime" type="time" defaultValue={htmlTimeValue(data.timePenaltyText)} required />
            </FormField>
          </FormRow>

          <FormField label="延期天数" htmlFor="extensionDays">
            <Input id="extensionDays" name="extensionDays" type="number" step="0.5" min="0" defaultValue={data.extensionDays ?? 1} />
          </FormField>

          <FormRow columns={2}>
            <FormField label="分配给" htmlFor="assign">
              <Input id="assign" name="assign" defaultValue={listInputValue(tdoc.assign)} placeholder="用户组 / UID，逗号分隔" />
            </FormField>
            <FormField label="作业维护者" htmlFor="maintainer">
              <Input id="maintainer" name="maintainer" defaultValue={listInputValue(tdoc.maintainer)} placeholder="UID，逗号分隔" />
            </FormField>
          </FormRow>

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-fg">可见班级</label>
            <input type="hidden" name="participantScopeMode" value={participantGroups.length ? 'groups' : 'none'} />
            {data.courseContext ? (
              <>
                <input type="hidden" name="participantGroupIds" value={participantGroups.map((group) => group._id).join(',')} />
                <div className="border-y border-line py-2 text-sm text-fg-muted">
                  {participantGroups.length ? participantGroups.map((group) => group.name).join('、') : '课程未限定班级，本作业对全域用户开放。'}
                </div>
                <p className="text-xs text-fg-subtle">范围跟随课程设置，创建时由服务端再次校验。</p>
              </>
            ) : (
              <>
                <MultiSelect<ScopeOption>
                  options={groupCatalog}
                  value={participantGroups}
                  onChange={setParticipantGroups}
                  getKey={(group) => group._id}
                  getLabel={(group) => group.name}
                  name="participantGroupIds"
                  placeholder="留空 = 不启用班级范围"
                />
                <p className="text-xs text-fg-subtle">与旧“分配给”规则同时满足；留空时普通作业行为不变。</p>
              </>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-fg">题目列表</label>
            <MultiSelect<ProblemOption>
              loadOptions={(q) => searchProblems(q, 20)}
              value={pidValue}
              onChange={setPidValue}
              getKey={(p) => String(p.docId || p.pid)}
              getLabel={(p) => `${p.pid || p.docId} ${p.title || ''}`.trim()}
              renderChip={(p) => (
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="shrink-0 font-mono text-2xs text-fg-subtle">{p.pid || p.docId}</span>
                  {p.title ? <span className="min-w-0 max-w-36 truncate">{p.title}</span> : null}
                </span>
              )}
              renderOption={(p) => (
                <div className="flex min-w-0 items-center gap-2">
                  <span className="shrink-0 font-mono text-2xs text-fg-subtle">{p.pid || p.docId}</span>
                  <span className="min-w-0 flex-1 truncate">{p.title || '—'}</span>
                  <Difficulty level={p.difficulty} />
                  {p.nSubmit ? (
                    <span className="shrink-0 text-2xs text-fg-subtle tabular">
                      {p.nAccept ?? 0}/{p.nSubmit}
                    </span>
                  ) : null}
                </div>
              )}
              name="pids"
              placeholder="搜索题目 (pid / 标题)…"
              minHeight={48}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-fg">提交语言限制</label>
            <MultiSelect<LangOption>
              options={COMMON_LANG_OPTIONS}
              value={langValue}
              onChange={setLangValue}
              getKey={(o) => o.value}
              getLabel={(o) => `${o.label} (${o.value})`}
              renderChip={(o) => <span className="font-mono">{o.label}</span>}
              renderOption={(o) => (
                <div className="flex min-w-0 items-center justify-between gap-2">
                  <span className="min-w-0 truncate font-medium">{o.label}</span>
                  <span className="shrink-0 font-mono text-2xs text-fg-subtle">{o.value}</span>
                </div>
              )}
              name="langs"
              placeholder="留空 = 全部"
            />
          </div>

          <FormField label="作业说明 (Markdown)" htmlFor="content">
            <MarkdownEditor name="content" value={tdoc.content || ''} minHeight={280} preferredLang={bs.locale} />
          </FormField>

          <div className="flex flex-col gap-1.5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <label className="text-sm font-medium text-fg">延期扣分规则</label>
                <p className="break-words text-xs text-fg-subtle">超过截止时间后，按提交延迟小时数乘以对应分数系数。</p>
              </div>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="shrink-0"
                onClick={() => setPenaltyRules((rows) => [...rows, { id: `new-${Date.now()}`, hours: '', coefficient: '1' }])}
              >
                <Plus />
                添加规则
              </Button>
            </div>
            <input type="hidden" name="penaltyRules" value={serializePenaltyRules(penaltyRules)} readOnly />
            <div className="flex flex-col gap-2">
              {penaltyRules.map((row) => (
                <div key={row.id} className="grid gap-2 rounded-md border border-line bg-surface-sunken p-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
                  <div className="flex min-w-0 flex-col gap-1.5">
                    <label className="text-xs text-fg-subtle">延迟达到 (小时)</label>
                    <Input
                      type="number"
                      min="0"
                      step="0.5"
                      value={row.hours}
                      required
                      onChange={(e) => updatePenaltyRule(row.id, { hours: e.target.value })}
                    />
                  </div>
                  <div className="flex min-w-0 flex-col gap-1.5">
                    <label className="text-xs text-fg-subtle">分数系数</label>
                    <Input
                      type="number"
                      min="0"
                      max="1"
                      step="0.01"
                      value={row.coefficient}
                      required
                      onChange={(e) => updatePenaltyRule(row.id, { coefficient: e.target.value })}
                    />
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    iconOnly
                    className="self-end"
                    disabled={penaltyRules.length <= 1}
                    title={penaltyRules.length <= 1 ? '至少保留一条扣分规则' : '删除扣分规则'}
                    onClick={() => setPenaltyRules((rows) => (rows.length > 1 ? rows.filter((item) => item.id !== row.id) : rows))}
                    aria-label={penaltyRules.length <= 1 ? '至少保留一条扣分规则' : '删除扣分规则'}
                  >
                    <Trash2 />
                  </Button>
                </div>
              ))}
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm text-fg">
            <Switch name="rated" value="true" defaultChecked={tdoc.rated} />
            计入 Rating
          </label>

          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button type="submit" variant="primary" name="operation" value="update">
              <Save />
              {isEdit ? '保存修改' : '创建作业'}
            </Button>
            {isEdit ? (
              <Button asChild variant="secondary" size="sm">
                <a href={`/homework/${String(tdoc.docId || tdoc._id)}/file`}>
                  <FolderOpen />
                  文件
                </a>
              </Button>
            ) : null}
          </div>
        </form>
        {isEdit ? (
          <form
            method="post"
            className="mt-8 flex items-center border-t border-line pt-6"
            onSubmit={(event) => {
              void confirmFormSubmit(event, '删除后不能恢复。', {
                destructive: true,
                title: `删除作业「${tdoc.title?.trim() || '此作业'}」？`,
                confirmLabel: '删除',
              });
            }}
          >
            <input type="hidden" name="operation" value="delete" />
            <Button type="submit" variant="danger-soft" size="sm">
              <Trash2 />
              删除
            </Button>
          </form>
        ) : null}
      </Panel>
    </Page>
  );
}

/* ---------- Homework Files ---------- */

export function HomeworkFilesPage() {
  const bs = useBootstrap();
  const data = bs.page.data as { tdoc?: HomeworkDocument; files?: HomeworkFile[] };
  const tdoc = data.tdoc || {};
  const files = data.files || [];
  const tid = tdoc.docId || tdoc._id;
  const hwUrl = replaceRouteTokens(bs.urls.homeworkDetail, { TID: String(tid) });

  return (
    <Page width="wide">
      <PageHeader title="作业文件" description={tdoc.title || undefined} actions={<BackButton href={hwUrl} />} />

      <Panel
        flush
        title={
          <span className="inline-flex min-w-0 items-center gap-1.5">
            <FolderOpen className="size-4 shrink-0 text-fg-subtle" />
            <span className="min-w-0 truncate">
              文件 (<span className="tabular">{files.length}</span>)
            </span>
          </span>
        }
        actions={
          <form method="post" encType="multipart/form-data" className="flex w-full max-w-full flex-wrap items-center gap-2 sm:w-auto">
            <input type="file" name="file" className="max-w-full text-xs" />
            <Button type="submit" name="operation" value="upload_file" size="sm" variant="primary">
              <Upload />
              上传
            </Button>
          </form>
        }
      >
        {files.length > 0 ? (
          <>
            <ul className="divide-y divide-line-subtle sm:hidden">
              {files.map((f) => (
                <li key={f.name} className="flex items-start justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="break-all font-mono text-sm text-fg">{f.name}</p>
                    <p className="mt-1 text-xs text-fg-subtle tabular">
                      {formatSize(f.size || 0)}
                      {f.lastModified ? ` · ${formatDateTime(f.lastModified, bs.locale)}` : ''}
                    </p>
                  </div>
                  <form
                    method="post"
                    className="shrink-0"
                    onSubmit={(event) => {
                      void confirmFormSubmit(event, '删除后不能恢复。', {
                        destructive: true,
                        title: `删除文件「${f.name}」？`,
                        confirmLabel: '删除',
                      });
                    }}
                  >
                    <input type="hidden" name="operation" value="delete_files" />
                    <input type="hidden" name="files" value={f.name} />
                    <Button type="submit" variant="danger-soft" size="sm" iconOnly aria-label={`删除 ${f.name}`}>
                      <Trash2 />
                    </Button>
                  </form>
                </li>
              ))}
            </ul>
            <div className="hidden sm:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>文件名</TableHead>
                    <TableHead className="w-28 text-right">大小</TableHead>
                    <TableHead className="w-40 text-right">修改时间</TableHead>
                    <TableHead className="w-20 text-center">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {files.map((f) => (
                    <TableRow key={f.name}>
                      <TableCell className="min-w-0 break-all font-mono text-sm">{f.name}</TableCell>
                      <TableCell className="text-right text-sm text-fg-subtle tabular">{formatSize(f.size || 0)}</TableCell>
                      <TableCell className="text-right text-sm text-fg-subtle tabular">
                        {f.lastModified ? formatDateTime(f.lastModified, bs.locale) : '-'}
                      </TableCell>
                      <TableCell className="text-center">
                        <form
                          method="post"
                          className="inline"
                          onSubmit={(event) => {
                            void confirmFormSubmit(event, '删除后不能恢复。', {
                              destructive: true,
                              title: `删除文件「${f.name}」？`,
                              confirmLabel: '删除',
                            });
                          }}
                        >
                          <input type="hidden" name="operation" value="delete_files" />
                          <input type="hidden" name="files" value={f.name} />
                          <Button type="submit" variant="danger-soft" size="sm" iconOnly aria-label={`删除 ${f.name}`}>
                            <Trash2 />
                          </Button>
                        </form>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        ) : (
          <EmptyState compact icon={<FolderOpen />} title="暂无文件" />
        )}
      </Panel>
    </Page>
  );
}
