/**
 * Exam create/edit form. Parent wraps chrome and seat entry.
 * Wall-clock POSTs as `duration`; personal clock POSTs as `contestDuration`.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { ArrowLeft, Copy, Save, Trash2, WifiOff } from 'lucide-react';
import { MarkdownEditor } from '@/components/markdown-renderer';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { confirmFormSubmit } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { MiniTabs } from '@/components/ui/mini-tabs';
import { MultiSelect } from '@/components/ui/multi-select';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { SimpleSelect } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/cn';
import { useBootstrap } from '@/lib/bootstrap';
import { replaceRouteTokens } from '@/lib/format';
import { ContestExamPaperPool } from './contest-exam-paper-pool';
import { EXAM_CREATE_WALL_CLOCK_HOURS, examHiddenFlags } from './contest-edit-exam-defaults';

export interface ContestEditExamProps {
  rule: string;
  onRuleChange: (rule: string) => void;
  children?: ReactNode;
}

type ParticipantScopeMode = 'none' | 'schools' | 'groups';
type ContestEntryMode = 'open' | 'client_required';
type ContestApprovalMode = 'strict' | 'auto';
type NetworkFailurePolicy = 'strict' | 'report_only' | 'off';
type AccessPermission = 'public' | 'invite';
type ExamEditTab = 'basic' | 'paper' | 'access' | 'content' | 'vigil';

interface ScopeOption {
  _id: string;
  name: string;
  schoolName?: string;
}

function readRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function readOptionalBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function readFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readStringMap(value: unknown): Record<string, string> {
  const record = readRecord(value);
  const out: Record<string, string> = {};
  for (const [key, label] of Object.entries(record)) {
    if (typeof label === 'string' && label) out[key] = label;
  }
  return out;
}

function readIdList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((id) => String(id)).filter(Boolean);
}

function readStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

function readQuotaMap(value: unknown): Partial<Record<string, number>> | undefined {
  const record = readRecord(value);
  const out: Partial<Record<string, number>> = {};
  for (const [key, count] of Object.entries(record)) {
    if (typeof count === 'number' && Number.isInteger(count)) out[key] = count;
  }
  return Object.keys(out).length ? out : undefined;
}

function readPdict(value: unknown): Record<string, { problemKind?: unknown; title?: unknown; pid?: unknown; docId?: unknown }> {
  const record = readRecord(value);
  const out: Record<string, { problemKind?: unknown; title?: unknown; pid?: unknown; docId?: unknown }> = {};
  for (const [key, row] of Object.entries(record)) {
    const item = readRecord(row);
    out[key] = { problemKind: item.problemKind, title: item.title, pid: item.pid, docId: item.docId };
  }
  return out;
}

function readScopeMode(value: unknown): ParticipantScopeMode {
  return value === 'schools' || value === 'groups' ? value : 'none';
}

function readEntryMode(value: unknown): ContestEntryMode | undefined {
  return value === 'client_required' || value === 'open' ? value : undefined;
}

function formatCommaValue(value: unknown): string {
  return Array.isArray(value)
    ? value
        .map((item) => String(item))
        .filter(Boolean)
        .join(',')
    : String(value || '');
}

function joinLines(value: unknown): string {
  return readStringList(value).join('\n');
}

function numberOr(value: unknown, fallback: number): number {
  const parsed = readFiniteNumber(value);
  return parsed === null ? fallback : parsed;
}

function toDate(value: unknown) {
  if (!value) return null;
  const date = new Date(value as string);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDateInput(value: unknown) {
  const date = toDate(value);
  if (!date) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function formatTimeInput(value: unknown) {
  const date = toDate(value);
  if (!date) return '';
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function formatDateTimeInput(dateText: string, timeText: string, durationHours: string) {
  const begin = new Date(`${dateText}T${timeText || '00:00'}`);
  const duration = Number(durationHours);
  if (Number.isNaN(begin.getTime()) || !Number.isFinite(duration)) return '';
  begin.setMinutes(begin.getMinutes() + Math.round(duration * 60));
  return `${formatDateInput(begin)} ${formatTimeInput(begin)}`;
}

function HiddenFlag({ name, value }: { name: string; value: boolean }) {
  return <input type="hidden" name={name} value={value ? 'true' : 'false'} />;
}

function initialPidIds(pidsCsv: string, tdocPids: unknown): string[] {
  if (pidsCsv.trim())
    return pidsCsv
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean);
  return readIdList(tdocPids);
}

function readScopeCatalog(rows: unknown, selectedIds: string[], schools: Array<{ _id: string; name: string }>): ScopeOption[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row) => readRecord(row))
    .filter((row) => {
      const id = String(row._id || '');
      return id && (!row.archivedAt || selectedIds.includes(id));
    })
    .map((row) => {
      const parent = schools.find((school) => school._id === String(row.schoolId || ''));
      return {
        _id: String(row._id),
        name: row.archivedAt ? `${String(row.name || row._id)}（已归档）` : String(row.name || row._id),
        schoolName: parent?.name,
      };
    });
}

function ExamCard({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <CardContent className="space-y-4 pt-0">{children}</CardContent>
    </Card>
  );
}

function SettingsRow({ label, description, children }: { label: string; description?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
      <div className="min-w-0 space-y-1">
        <p className="text-sm font-medium leading-none">{label}</p>
        {description ? <p className="text-xs leading-5 text-muted-foreground">{description}</p> : null}
      </div>
      <div className="shrink-0 pt-0.5">{children}</div>
    </div>
  );
}

function ChoiceCard({
  checked,
  onSelect,
  label,
  description,
}: {
  checked: boolean;
  onSelect: () => void;
  label: string;
  description: string;
}) {
  return (
    <RadioGroupItem
      checked={checked}
      onChange={onSelect}
      label={label}
      description={description}
      wrapperClassName={cn(
        'w-full rounded-lg border p-3 transition-colors',
        checked ? 'border-primary bg-primary/5' : 'hover:bg-accent/40',
      )}
    />
  );
}

export function ContestEditExam({ rule, onRuleChange, children }: ContestEditExamProps) {
  const bs = useBootstrap();
  const data = readRecord(bs.page.data);
  const tdoc = readRecord(data.tdoc);
  const isEdit = data.page_name === 'contest_edit';
  const rules = readStringMap(data.rules);
  const ruleOptions = Object.entries(rules).map(([value, label]) => ({ value, label }));
  if (rule && !ruleOptions.some((option) => option.value === rule)) {
    ruleOptions.unshift({ value: rule, label: rule });
  }
  if (!ruleOptions.length) ruleOptions.push({ value: 'exam', label: '考试' });

  const flags = examHiddenFlags(
    {
      rated: readOptionalBoolean(tdoc.rated),
      autoHide: readOptionalBoolean(tdoc.autoHide),
      allowViewCode: readOptionalBoolean(tdoc.allowViewCode),
      allowVirtual: readOptionalBoolean(tdoc.allowVirtual),
      keepScoreboardHidden: readOptionalBoolean(tdoc.keepScoreboardHidden),
      allowPrint: readOptionalBoolean(tdoc.allowPrint),
      vigilEnabled: readOptionalBoolean(tdoc.vigilEnabled),
      entryMode: readEntryMode(tdoc.entryMode),
    },
    isEdit,
  );

  const tid = readString(tdoc.docId) || readString(tdoc._id);
  const contestUrl = isEdit && tid ? replaceRouteTokens(bs.urls.contestDetail, { TID: tid }) : bs.urls.contests;
  const initialBeginAt = data.beginAt || tdoc.beginAt || '';
  const wallClock = isEdit ? readFiniteNumber(data.duration) : EXAM_CREATE_WALL_CLOCK_HOURS;
  const personalClock = isEdit ? readFiniteNumber(tdoc.duration) : null;
  const [beginDate, setBeginDate] = useState(formatDateInput(initialBeginAt));
  const [beginTime, setBeginTime] = useState(formatTimeInput(initialBeginAt));
  const [duration, setDuration] = useState(String(wallClock ?? EXAM_CREATE_WALL_CLOCK_HOURS));
  const [pids, setPids] = useState(() => initialPidIds(readString(data.pids), tdoc.pids));
  const [permission, setPermission] = useState<AccessPermission>(() => (tdoc._code || tdoc.code ? 'invite' : 'public'));
  const [listHidden, setListHidden] = useState(tdoc.hidden === true);
  const [showVerdict, setShowVerdict] = useState(isEdit ? tdoc.examShowVerdict !== false : true);
  const [scopeMode, setScopeMode] = useState<ParticipantScopeMode>(readScopeMode(tdoc.participantScopeMode));
  const [vigilEnabled, setVigilEnabled] = useState(flags.vigilEnabled);
  const [entryMode, setEntryMode] = useState<ContestEntryMode>(flags.entryMode);
  const [approvalMode, setApprovalMode] = useState<ContestApprovalMode>(tdoc.approvalMode === 'auto' ? 'auto' : 'strict');
  const [lockdownMode, setLockdownMode] = useState(tdoc.lockdownMode === true);
  const [networkTouched, setNetworkTouched] = useState(tdoc.networkLockdownMode != null);
  const [networkLockdownMode, setNetworkLockdownMode] = useState(
    tdoc.networkLockdownMode != null ? tdoc.networkLockdownMode === true : tdoc.lockdownMode === true,
  );
  const [networkFailurePolicy, setNetworkFailurePolicy] = useState<NetworkFailurePolicy>(
    tdoc.networkLockdownFailurePolicy === 'report_only' ? 'report_only' : tdoc.networkLockdownFailurePolicy === 'off' ? 'off' : 'strict',
  );
  const [liveEnabled, setLiveEnabled] = useState(tdoc.liveEnabled !== false);
  const [cameraEnabled, setCameraEnabled] = useState(tdoc.cameraEnabled !== false);
  const [tab, setTab] = useState<ExamEditTab>('basic');

  const schoolCatalog: ScopeOption[] = (Array.isArray(data.scopeSchools) ? data.scopeSchools : [])
    .map((row) => readRecord(row))
    .filter((row) => row._id != null)
    .map((row) => ({ _id: String(row._id), name: String(row.name || row._id) }));
  const initialSchoolIds = readIdList(tdoc.participantSchoolIds);
  const initialGroupIds = readIdList(tdoc.participantGroupIds);
  const groupCatalog = readScopeCatalog(data.scopeGroups, initialGroupIds, schoolCatalog);
  const [schoolValue, setSchoolValue] = useState<ScopeOption[]>(
    initialSchoolIds.map((id) => schoolCatalog.find((school) => school._id === id) || { _id: id, name: id }),
  );
  const [groupValue, setGroupValue] = useState<ScopeOption[]>(
    initialGroupIds.map((id) => groupCatalog.find((group) => group._id === id) || { _id: id, name: id }),
  );

  const endAtDate = toDate(tdoc.endAt);
  const lockAtDate = toDate(tdoc.lockAt);
  const lockMinutes = endAtDate && lockAtDate ? String(Math.max(0, Math.round((endAtDate.getTime() - lockAtDate.getTime()) / 60000))) : '';
  const postedVigilEnabled = isEdit ? vigilEnabled : flags.vigilEnabled;
  const postedEntryMode = isEdit ? entryMode : flags.entryMode;
  const computedEnd = formatDateTimeInput(beginDate, beginTime, duration);
  const personalClockLabel = personalClock === null ? '不限个人时长' : `${personalClock} 小时个人卷`;

  useEffect(() => {
    if (entryMode === 'client_required' && !vigilEnabled) setVigilEnabled(true);
  }, [entryMode, vigilEnabled]);
  useEffect(() => {
    if (!vigilEnabled && entryMode !== 'open') setEntryMode('open');
  }, [vigilEnabled, entryMode]);
  useEffect(() => {
    if (!networkTouched) setNetworkLockdownMode(lockdownMode);
  }, [lockdownMode, networkTouched]);
  useEffect(() => {
    if (!networkLockdownMode && networkFailurePolicy !== 'off') setNetworkFailurePolicy('off');
    if (networkLockdownMode && networkFailurePolicy === 'off') setNetworkFailurePolicy('strict');
  }, [networkLockdownMode, networkFailurePolicy]);

  return (
    <div className="max-w-5xl space-y-6">
      <header className="sticky top-0 z-10 -mx-1 space-y-2 rounded-xl border bg-background/95 px-3 py-2 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild variant="ghost" size="icon">
            <a href={contestUrl} aria-label="返回">
              <ArrowLeft className="size-4" />
            </a>
          </Button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-lg font-semibold tracking-tight">{isEdit ? '编辑考试' : '创建考试'}</h1>
            <p className="hidden truncate text-xs text-muted-foreground sm:block">个人答卷考试。先定时间和题池，说明可以后写。</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {isEdit ? (
              <Button type="submit" form="exam-edit-form" name="operation" value="update" variant="outline" formAction={`${bs.urls.contests}/create`}>
                <Copy className="size-4" />
                复制为新考试
              </Button>
            ) : null}
            <Button type="submit" form="exam-edit-form" name="operation" value="update">
              <Save className="size-4" />
              {isEdit ? '保存修改' : '创建考试'}
            </Button>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Badge variant="secondary" className="font-normal tabular-nums">
            {beginDate && beginTime ? `${beginDate} ${beginTime} 开门` : '未设开始时间'}
          </Badge>
          <Badge variant="secondary" className="font-normal tabular-nums">
            {duration || '—'} 小时关门
          </Badge>
          <Badge variant="outline" className="font-normal">
            {personalClock === null && !isEdit ? '未设个人时长' : personalClockLabel}
          </Badge>
          <Badge variant="outline" className="font-normal">
            {permission === 'invite' ? '邀请码' : '公开'}
            {scopeMode === 'schools' ? ' · 指定学校' : scopeMode === 'groups' ? ' · 指定用户组' : ''}
          </Badge>
        </div>
        <div className="-mx-1 overflow-x-auto px-1">
          <MiniTabs<ExamEditTab>
            value={tab}
            onValueChange={setTab}
            size="md"
            aria-label="考试编辑分区"
            items={[
              { value: 'basic', label: '这场考试' },
              { value: 'paper', label: '试卷', count: pids.length },
              { value: 'access', label: '谁能考' },
              { value: 'content', label: '考生说明' },
              ...(isEdit ? [{ value: 'vigil' as const, label: '反作弊' }] : []),
            ]}
          />
        </div>
      </header>

      <form id="exam-edit-form" method="post" className="space-y-6">
        <HiddenFlag name="rated" value={flags.rated} />
        <HiddenFlag name="autoHide" value={flags.autoHide} />
        <HiddenFlag name="allowViewCode" value={flags.allowViewCode} />
        <HiddenFlag name="allowPrint" value={flags.allowPrint} />
        <HiddenFlag name="keepScoreboardHidden" value={flags.keepScoreboardHidden} />
        {flags.allowVirtual != null ? <HiddenFlag name="allowVirtual" value={flags.allowVirtual} /> : null}
        <input type="hidden" name="participationMode" value={flags.participationMode} />
        <HiddenFlag name="vigilEnabled" value={postedVigilEnabled} />
        <input type="hidden" name="entryMode" value={postedEntryMode} />
        {isEdit ? (
          <>
            <input type="hidden" name="assign" value={formatCommaValue(tdoc.assign)} />
            <input type="hidden" name="maintainer" value={formatCommaValue(tdoc.maintainer)} />
            <input type="hidden" name="langs" value={formatCommaValue(tdoc.langs)} />
            {lockMinutes !== '' ? <input type="hidden" name="lock" value={lockMinutes} /> : null}
            <input type="hidden" name="participationRevision" value={String(numberOr(data.participationRevision, 0))} />
          </>
        ) : null}

        <div hidden={tab !== 'basic'}>
        <ExamCard title="这场考试" description="标题和开门时间是这场考试的身份。整场关门后不能再开考。">
          <div className="space-y-1.5">
            <label htmlFor="title" className="text-sm font-medium">
              考试标题
            </label>
            <Input id="title" name="title" defaultValue={readString(tdoc.title)} required placeholder="例如：2026 秋 程序设计期末" />
          </div>

          <div className="grid gap-3 lg:grid-cols-3">
            <div className="space-y-3 rounded-lg border bg-muted/20 p-4">
              <p className="text-xs font-medium text-muted-foreground">开门</p>
              <div className="space-y-1.5">
                <label htmlFor="beginAtDate" className="text-sm font-medium">
                  开始日期
                </label>
                <Input
                  id="beginAtDate"
                  name="beginAtDate"
                  type="date"
                  value={beginDate}
                  onChange={(event) => setBeginDate(event.target.value)}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="beginAtTime" className="text-sm font-medium">
                  开始时间
                </label>
                <Input
                  id="beginAtTime"
                  name="beginAtTime"
                  type="time"
                  value={beginTime}
                  onChange={(event) => setBeginTime(event.target.value)}
                  required
                />
              </div>
            </div>

            <div className="space-y-3 rounded-lg border bg-muted/20 p-4">
              <p className="text-xs font-medium text-muted-foreground">个人答卷</p>
              <div className="space-y-1.5">
                <label htmlFor="contestDuration" className="text-sm font-medium">
                  开考后个人时长（小时）
                </label>
                <Input
                  id="contestDuration"
                  name="contestDuration"
                  type="number"
                  min="0"
                  step="0.5"
                  defaultValue={personalClock === null ? '' : String(personalClock)}
                  placeholder="留空表示只受整场关门时间限制"
                />
                <p className="text-xs leading-5 text-muted-foreground">开考后个人时长；剩余整场时间不够一场则不能开考。与整场关门不是同一字段。</p>
              </div>
            </div>

            <div className="space-y-3 rounded-lg border bg-muted/20 p-4">
              <p className="text-xs font-medium text-muted-foreground">整场窗口</p>
              <div className="space-y-1.5">
                <label htmlFor="duration" className="text-sm font-medium">
                  整场关门（小时）
                </label>
                <Input
                  id="duration"
                  name="duration"
                  type="number"
                  step="0.5"
                  min="0"
                  value={duration}
                  onChange={(event) => setDuration(event.target.value)}
                  required
                />
                <p className="text-xs leading-5 text-muted-foreground">
                  从开始时间起关闭整场。创建默认 {EXAM_CREATE_WALL_CLOCK_HOURS} 小时。
                </p>
              </div>
              <p className="text-sm tabular-nums">
                <span className="text-muted-foreground">预计结束 </span>
                {computedEnd || '填开始时间和整场关门后显示'}
              </p>
            </div>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="rule" className="text-sm font-medium">
              赛制
            </label>
            <SimpleSelect id="rule" name="rule" value={rule} onValueChange={onRuleChange} options={ruleOptions} />
            <p className="text-xs text-muted-foreground">改成 ACM / OI 会切回比赛编辑器。</p>
          </div>

          <SettingsRow
            label="交卷后显示对错"
            description="关闭后学生只能看到分数，看不到每题正确或错误。管理员预览仍显示对错。"
          >
            <Switch checked={showVerdict} onCheckedChange={(value) => setShowVerdict(!!value)} />
          </SettingsRow>
          <HiddenFlag name="examShowVerdict" value={showVerdict} />
        </ExamCard>
        </div>

        <div hidden={tab !== 'paper'}>
        <ExamCard title="试卷" description="题池可按题型筛选、多选、排序，并批量改这场考试的分数。可设及格分和补考次数。填写配额后按题型抽个人卷，开考或再考时冻结。">
          <ContestExamPaperPool
            name="pids"
            value={pids}
            onChange={setPids}
            pdict={readPdict(data.pdict)}
            quotas={readQuotaMap(tdoc.examPaperQuotas)}
            scores={tdoc.score}
            passScore={tdoc.examPassScore}
            attemptLimit={tdoc.examAttemptLimit}
          />
        </ExamCard>
        </div>

        <div hidden={tab !== 'access'}>
        <ExamCard title="谁能考" description="公开或邀请码，再加可选的学校 / 用户组范围。不写入比赛 assign。列表隐藏只影响发现，不影响链接和课程入口。">
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-2">
              <p className="text-sm font-medium">访问</p>
              <RadioGroup>
                <ChoiceCard
                  checked={permission === 'public'}
                  onSelect={() => setPermission('public')}
                  label="公开"
                  description="知道链接即可进入"
                />
                <ChoiceCard
                  checked={permission === 'invite'}
                  onSelect={() => setPermission('invite')}
                  label="需要邀请码"
                  description="凭邀请码进入"
                />
              </RadioGroup>
            </div>
            <div className="space-y-2">
              <p className="text-sm font-medium">范围</p>
              <RadioGroup>
                <ChoiceCard checked={scopeMode === 'none'} onSelect={() => setScopeMode('none')} label="不限" description="不按学校或用户组收窄" />
                <ChoiceCard
                  checked={scopeMode === 'schools'}
                  onSelect={() => setScopeMode('schools')}
                  label="一所学校"
                  description="仅选中学校的已绑定学生"
                />
                <ChoiceCard
                  checked={scopeMode === 'groups'}
                  onSelect={() => setScopeMode('groups')}
                  label="同校用户组"
                  description="仅选中用户组"
                />
              </RadioGroup>
              <input type="hidden" name="participantScopeMode" value={scopeMode} />
            </div>
          </div>
          {permission === 'invite' ? (
            <div className="space-y-1.5">
              <label htmlFor="code" className="text-sm font-medium">
                邀请码
              </label>
              <Input id="code" name="code" defaultValue={readString(tdoc._code) || readString(tdoc.code)} placeholder="留空表示不设置邀请码" />
            </div>
          ) : null}
          {scopeMode === 'schools' ? (
            <div className="space-y-1.5">
              <label className="text-sm font-medium">学校</label>
              <MultiSelect<ScopeOption>
                options={schoolCatalog}
                value={schoolValue}
                onChange={setSchoolValue}
                getKey={(item) => item._id}
                getLabel={(item) => item.name}
                name="participantSchoolIds"
                placeholder="选择学校…"
              />
            </div>
          ) : (
            <input type="hidden" name="participantSchoolIds" value="" />
          )}
          {scopeMode === 'groups' ? (
            <div className="space-y-1.5">
              <label className="text-sm font-medium">用户组</label>
              <MultiSelect<ScopeOption>
                options={groupCatalog}
                value={groupValue}
                onChange={setGroupValue}
                getKey={(item) => item._id}
                getLabel={(item) => (item.schoolName ? `${item.name}（${item.schoolName}）` : item.name)}
                name="participantGroupIds"
                placeholder="选择用户组…"
              />
            </div>
          ) : (
            <input type="hidden" name="participantGroupIds" value="" />
          )}
          <SettingsRow
            label="不在列表中显示"
            description="学生在比赛列表和首页看不到这场考试。知道链接、从课程进入或已报名的人仍可考。"
          >
            <Switch checked={listHidden} onCheckedChange={(value) => setListHidden(!!value)} />
          </SettingsRow>
          <HiddenFlag name="hidden" value={listHidden} />
        </ExamCard>
        </div>

        <div hidden={tab !== 'content'}>
        <ExamCard title="考生说明" description="开考页展示的 Markdown，可后补。">
          <div className="space-y-1.5">
            <label htmlFor="content" className="text-sm font-medium">
              考试说明 (Markdown)
            </label>
            <MarkdownEditor name="content" value={readString(tdoc.content)} minHeight={240} />
          </div>
        </ExamCard>
        </div>

        {isEdit ? (
          <div hidden={tab !== 'vigil'}>
          <ExamCard title="客户端与反作弊" description="创建时默认关闭。这里打开后才会要求 Client、锁屏或网络锁。">
            <label className="flex cursor-pointer items-start justify-between gap-4 rounded-lg border p-4">
              <span className="min-w-0 space-y-1">
                <span className="block text-sm font-medium leading-none">启用 Vigil 反作弊</span>
                <span className="block text-xs text-muted-foreground">创建页不展示；编辑后再开</span>
              </span>
              <Switch checked={vigilEnabled} onCheckedChange={(value) => setVigilEnabled(!!value)} />
            </label>
            {vigilEnabled ? (
              <div className="space-y-4">
                <div className="grid gap-4 lg:grid-cols-2">
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">进入模式</label>
                    <SimpleSelect
                      value={entryMode}
                      onValueChange={(value) => {
                        if (value === 'open' || value === 'client_required') setEntryMode(value);
                      }}
                      options={[
                        { value: 'open', label: '普通网页可进入（Vigil 可选）' },
                        { value: 'client_required', label: '必须通过 Qt Client 进入' },
                      ]}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">审批模式</label>
                    <SimpleSelect
                      value={approvalMode}
                      onValueChange={(value) => {
                        if (value === 'auto' || value === 'strict') setApprovalMode(value);
                      }}
                      options={[
                        { value: 'auto', label: 'auto（已绑定且命中范围的学生自动通过）' },
                        { value: 'strict', label: 'strict（全部进入老师审批）' },
                      ]}
                    />
                    <input type="hidden" name="approvalMode" value={approvalMode} />
                  </div>
                </div>

                <SettingsRow label="启用客户端锁屏 / 热键拦截" description="考试机拦截热键与切出。">
                  <Switch checked={lockdownMode} onCheckedChange={(value) => setLockdownMode(!!value)} />
                </SettingsRow>
                <input type="hidden" name="lockdownMode" value={lockdownMode ? 'true' : 'false'} />
                <SettingsRow label="断线时暂停" description="Client 掉线后暂停作答。">
                  <Switch name="pauseOnDisconnect" value="true" defaultChecked={tdoc.pauseOnDisconnect === true} />
                </SettingsRow>
                <SettingsRow label="锁定当前考试工作台" description="不显示比赛切换器。">
                  <Switch name="exclusive" value="true" defaultChecked={tdoc.exclusive === true} />
                </SettingsRow>

                <div className="space-y-3 rounded-lg border bg-muted/20 p-4">
                  <div className="space-y-1">
                    <h3 className="text-sm font-medium">实时媒体</h3>
                    <p className="text-xs text-muted-foreground">
                      推流到 SRS 媒体服务器；老师在反作弊详情页可看实时画面。<strong>失败不影响考试</strong>。
                    </p>
                  </div>
                  <SettingsRow label="实时屏幕直播">
                    <Switch checked={liveEnabled} onCheckedChange={(value) => setLiveEnabled(!!value)} />
                  </SettingsRow>
                  <HiddenFlag name="liveEnabled" value={liveEnabled} />
                  <SettingsRow label="摄像头直播（防替考）">
                    <Switch checked={cameraEnabled} onCheckedChange={(value) => setCameraEnabled(!!value)} />
                  </SettingsRow>
                  <HiddenFlag name="cameraEnabled" value={cameraEnabled} />
                  <SettingsRow label="服务器录屏 mp4" description="存储压力大，默认关闭。">
                    <Switch name="recordEnabled" value="true" defaultChecked={tdoc.recordEnabled === true} />
                  </SettingsRow>
                </div>

                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">截图间隔 (ms)</label>
                    <Input
                      type="number"
                      name="screenshotIntervalMs"
                      min={1000}
                      step={1000}
                      defaultValue={numberOr(tdoc.screenshotIntervalMs, 60000)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">截图抖动 (ms)</label>
                    <Input type="number" name="screenshotJitterMs" min={0} step={1000} defaultValue={numberOr(tdoc.screenshotJitterMs, 30000)} />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">封锁开始（分钟）</label>
                    <Input
                      type="number"
                      name="clientLoginBlockBeforeMinutes"
                      min={0}
                      defaultValue={numberOr(tdoc.clientLoginBlockBeforeMinutes, 60)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">封锁结束（分钟）</label>
                    <Input
                      type="number"
                      name="clientLoginBlockAfterMinutes"
                      min={0}
                      defaultValue={numberOr(tdoc.clientLoginBlockAfterMinutes, 30)}
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-sm font-medium">进程白名单（每行一个，加在服务器全局默认之上）</label>
                  <Textarea
                    name="vigilProcessWhitelist"
                    defaultValue={joinLines(tdoc.vigilProcessWhitelist)}
                    rows={5}
                    className="font-mono text-xs"
                    placeholder={'Code.exe\npython.exe\nmsedge.exe'}
                  />
                </div>

                <div className="space-y-4 rounded-lg border bg-muted/20 p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="space-y-1">
                      <h3 className="flex items-center gap-2 text-sm font-medium">
                        <WifiOff className="size-4" />
                        考试网络锁
                      </h3>
                      <p className="text-xs text-muted-foreground">只允许默认白名单和下方附加白名单。</p>
                    </div>
                    <label className="flex shrink-0 items-center gap-2 text-sm">
                      <Switch
                        checked={networkLockdownMode}
                        onCheckedChange={(value) => {
                          setNetworkTouched(true);
                          setNetworkLockdownMode(!!value);
                        }}
                      />
                      启用网络锁
                    </label>
                  </div>
                  <input type="hidden" name="networkLockdownMode" value={networkLockdownMode ? 'true' : 'false'} />
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">失败策略</label>
                    <SimpleSelect
                      value={networkFailurePolicy}
                      onValueChange={(value) => {
                        if (value === 'strict' || value === 'report_only' || value === 'off') setNetworkFailurePolicy(value);
                      }}
                      options={[
                        { value: 'strict', label: 'strict：失败则不进入考试' },
                        { value: 'report_only', label: 'report_only：失败上报后放行' },
                        { value: 'off', label: 'off：不启用系统网络锁' },
                      ]}
                    />
                    <input type="hidden" name="networkLockdownFailurePolicy" value={networkFailurePolicy} />
                  </div>
                  <div className="grid gap-4 lg:grid-cols-3">
                    <div className="space-y-1.5">
                      <label className="text-sm font-medium">附加域名 / Host</label>
                      <Textarea name="networkWhitelistHosts" defaultValue={joinLines(tdoc.networkWhitelistHosts)} rows={4} className="font-mono text-xs" />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-sm font-medium">附加 IP / CIDR</label>
                      <Textarea name="networkWhitelistIps" defaultValue={joinLines(tdoc.networkWhitelistIps)} rows={4} className="font-mono text-xs" />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-sm font-medium">附加端口</label>
                      <Textarea name="networkWhitelistPorts" defaultValue={joinLines(tdoc.networkWhitelistPorts)} rows={4} className="font-mono text-xs" />
                    </div>
                  </div>
                </div>
              </div>
            ) : null}
          </ExamCard>
          </div>
        ) : null}

        <div className="flex items-center justify-end gap-3">
          <Button type="submit" name="operation" value="update">
            <Save className="size-4" />
            {isEdit ? '保存修改' : '创建考试'}
          </Button>
        </div>
      </form>

      {isEdit ? children : null}

      {isEdit ? (
        <Card className="border-destructive/30">
          <CardHeader>
            <CardTitle className="text-base">危险操作</CardTitle>
            <CardDescription>删除不可恢复。不会级联删除题目或课程绑定。</CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <form
              method="post"
              onSubmit={(event) => {
                void confirmFormSubmit(event, '确定要删除此考试吗？', { destructive: true });
              }}
            >
              <input type="hidden" name="operation" value="delete" />
              <Button type="submit" variant="destructive" size="sm">
                <Trash2 className="size-3" />
                删除考试
              </Button>
            </form>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
