/**
 * Exam create/edit form. Parent wraps chrome and seat entry.
 * Wall-clock POSTs as `duration`; personal clock POSTs as `contestDuration`.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { ArrowLeft, Copy, Save, Trash2, WifiOff } from 'lucide-react';
import { ProblemPicker } from '@/components/problem-picker';
import { MarkdownEditor } from '@/components/markdown-renderer';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { confirmFormSubmit } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { MultiSelect } from '@/components/ui/multi-select';
import { SimpleSelect } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useBootstrap } from '@/lib/bootstrap';
import { replaceRouteTokens } from '@/lib/format';
import { ContestExamPaperQuotas } from './contest-exam-paper-quotas';
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

function readPdict(value: unknown): Record<string, { problemKind?: unknown }> {
  const record = readRecord(value);
  const out: Record<string, { problemKind?: unknown }> = {};
  for (const [key, row] of Object.entries(record)) {
    const item = readRecord(row);
    out[key] = { problemKind: item.problemKind };
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
  const quotaPids = pids.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0);
  const postedVigilEnabled = isEdit ? vigilEnabled : flags.vigilEnabled;
  const postedEntryMode = isEdit ? entryMode : flags.entryMode;

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
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="icon">
          <a href={contestUrl}>
            <ArrowLeft className="size-4" />
          </a>
        </Button>
        <h1 className="text-xl font-semibold">{isEdit ? '编辑考试' : '创建考试'}</h1>
      </div>

      <Card>
        <CardContent className="p-6">
          <form method="post" className="space-y-6">
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

            <div className="space-y-1.5">
              <label htmlFor="title" className="text-sm font-medium">
                考试标题
              </label>
              <Input id="title" name="title" defaultValue={readString(tdoc.title)} required />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="content" className="text-sm font-medium">
                考试说明 (Markdown)
              </label>
              <MarkdownEditor name="content" value={readString(tdoc.content)} minHeight={320} />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="rule" className="text-sm font-medium">
                赛制
              </label>
              <SimpleSelect id="rule" name="rule" value={rule} onValueChange={onRuleChange} options={ruleOptions} />
            </div>

            <div className="space-y-4">
              <h2 className="text-sm font-medium">试卷</h2>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">题目列表</label>
                <ProblemPicker name="pids" value={pids} onChange={setPids} placeholder="搜索题目 (pid / 标题)…" />
              </div>
              <ContestExamPaperQuotas pids={quotaPids} pdict={readPdict(data.pdict)} quotas={readQuotaMap(tdoc.examPaperQuotas)} />
            </div>

            <div className="space-y-4">
              <h2 className="text-sm font-medium">时间</h2>
              <div className="grid gap-4 sm:grid-cols-2">
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

              <div className="grid gap-4 sm:grid-cols-2">
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
                  <p className="text-xs text-muted-foreground">
                    从开始时间起，整场考试在此时长后关闭。创建默认 {EXAM_CREATE_WALL_CLOCK_HOURS} 小时。
                  </p>
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="examEndAt" className="text-sm font-medium">
                    结束时间
                  </label>
                  <Input id="examEndAt" value={formatDateTimeInput(beginDate, beginTime, duration)} readOnly className="text-muted-foreground" />
                </div>
              </div>

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
                <p className="text-xs text-muted-foreground">开考后个人时长；剩余整场时间不够一场则不能开考。与整场关门不是同一字段。</p>
              </div>
            </div>

            <div className="space-y-4">
              <h2 className="text-sm font-medium">谁能考</h2>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <label htmlFor="permission" className="text-sm font-medium">
                    访问
                  </label>
                  <SimpleSelect
                    id="permission"
                    value={permission}
                    onValueChange={(value) => {
                      if (value === 'public' || value === 'invite') setPermission(value);
                    }}
                    options={[
                      { value: 'public', label: '公开' },
                      { value: 'invite', label: '需要邀请码' },
                    ]}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">范围</label>
                  <SimpleSelect
                    value={scopeMode}
                    onValueChange={(value) => setScopeMode(readScopeMode(value))}
                    options={[
                      { value: 'none', label: '不限' },
                      { value: 'schools', label: '一所学校' },
                      { value: 'groups', label: '同校用户组' },
                    ]}
                  />
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
            </div>

            {isEdit ? (
              <div className="space-y-4">
                <h2 className="text-sm font-medium">客户端与反作弊</h2>
                <label className="flex items-center gap-2 text-sm">
                  <Switch checked={vigilEnabled} onCheckedChange={(value) => setVigilEnabled(!!value)} />
                  启用 Vigil 反作弊
                  <span className="ml-auto text-[11px] text-muted-foreground">创建页不展示；编辑后再开</span>
                </label>
                {vigilEnabled ? (
                  <>
                    <div className="grid gap-4 sm:grid-cols-2">
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
                    <div className="flex flex-wrap gap-4">
                      <label className="flex items-center gap-2 text-sm">
                        <Switch checked={lockdownMode} onCheckedChange={(value) => setLockdownMode(!!value)} />
                        启用客户端锁屏 / 热键拦截
                      </label>
                      <input type="hidden" name="lockdownMode" value={lockdownMode ? 'true' : 'false'} />
                      <label className="flex items-center gap-2 text-sm">
                        <Switch name="pauseOnDisconnect" value="true" defaultChecked={tdoc.pauseOnDisconnect === true} />
                        断线时暂停
                      </label>
                      <label className="flex items-center gap-2 text-sm">
                        <Switch name="exclusive" value="true" defaultChecked={tdoc.exclusive === true} />
                        锁定当前考试工作台（不显示比赛切换器）
                      </label>
                    </div>
                    <div className="space-y-3 rounded-md border bg-muted/20 p-4">
                      <h3 className="text-sm font-medium">实时媒体</h3>
                      <p className="text-xs text-muted-foreground">
                        推流到 SRS 媒体服务器；老师在反作弊详情页可看实时画面。<strong>失败不影响考试</strong>。
                      </p>
                      <div className="flex flex-wrap gap-4">
                        <label className="flex items-center gap-2 text-sm">
                          <Switch checked={liveEnabled} onCheckedChange={(value) => setLiveEnabled(!!value)} />
                          实时屏幕直播
                        </label>
                        <HiddenFlag name="liveEnabled" value={liveEnabled} />
                        <label className="flex items-center gap-2 text-sm">
                          <Switch checked={cameraEnabled} onCheckedChange={(value) => setCameraEnabled(!!value)} />
                          摄像头直播（防替考）
                        </label>
                        <HiddenFlag name="cameraEnabled" value={cameraEnabled} />
                        <label className="flex items-center gap-2 text-sm">
                          <Switch name="recordEnabled" value="true" defaultChecked={tdoc.recordEnabled === true} />
                          服务器录屏 mp4（存储压力大，默认关闭）
                        </label>
                      </div>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
                      <textarea
                        name="vigilProcessWhitelist"
                        defaultValue={joinLines(tdoc.vigilProcessWhitelist)}
                        rows={5}
                        className="w-full rounded-md border bg-background p-2 font-mono text-xs"
                        placeholder={'Code.exe\npython.exe\nmsedge.exe'}
                      />
                    </div>
                    <div className="space-y-4 rounded-md border bg-muted/20 p-4">
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
                          <textarea
                            name="networkWhitelistHosts"
                            defaultValue={joinLines(tdoc.networkWhitelistHosts)}
                            rows={4}
                            className="w-full rounded-md border bg-background p-2 font-mono text-xs"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-sm font-medium">附加 IP / CIDR</label>
                          <textarea
                            name="networkWhitelistIps"
                            defaultValue={joinLines(tdoc.networkWhitelistIps)}
                            rows={4}
                            className="w-full rounded-md border bg-background p-2 font-mono text-xs"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-sm font-medium">附加端口</label>
                          <textarea
                            name="networkWhitelistPorts"
                            defaultValue={joinLines(tdoc.networkWhitelistPorts)}
                            rows={4}
                            className="w-full rounded-md border bg-background p-2 font-mono text-xs"
                          />
                        </div>
                      </div>
                    </div>
                  </>
                ) : null}
              </div>
            ) : null}

            <div className="flex items-center gap-3">
              <Button type="submit" name="operation" value="update">
                <Save className="mr-1 size-4" />
                {isEdit ? '保存修改' : '创建考试'}
              </Button>
              {isEdit ? (
                <Button type="submit" name="operation" value="update" variant="outline" formAction={`${bs.urls.contests}/create`}>
                  <Copy className="mr-1 size-4" />
                  复制为新考试
                </Button>
              ) : null}
            </div>
          </form>
          {isEdit ? (
            <form
              method="post"
              className="mt-4 flex items-center"
              onSubmit={(event) => {
                void confirmFormSubmit(event, '确定要删除此考试吗？', { destructive: true });
              }}
            >
              <input type="hidden" name="operation" value="delete" />
              <Button type="submit" variant="destructive" size="sm">
                <Trash2 className="mr-1 size-3" />
                删除考试
              </Button>
            </form>
          ) : null}
        </CardContent>
      </Card>
      {isEdit ? children : null}
    </div>
  );
}
