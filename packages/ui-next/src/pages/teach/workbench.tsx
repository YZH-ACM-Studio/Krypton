import { parseTeachTab, teachPath, teachTabsFor, summarizeSetSettings, teachStatusOf } from '@hydrooj/common';
import type { TeachStatus, TeachTab, TeachType } from '@hydrooj/common';
import { Eye, MoreHorizontal } from 'lucide-react';
import { useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { confirmDialog } from '@/components/ui/dialog';
import { StatusDot } from '@/components/ui/display';
import { Menu } from '@/components/ui/menu';
import type { MenuItem } from '@/components/ui/menu';
import { Page, PageHeader } from '@/components/ui/page';
import { PageTabs } from '@/components/ui/page-tabs';
import { Breadcrumb } from '@/components/ui/breadcrumb';
import { useBootstrap } from '@/lib/bootstrap';
import { useExamNow } from '@/lib/exam-server-clock';
import { AdvancedTab } from './tabs/advanced';
import { ManagementTab } from './tabs/management';
import { GradesTab } from './tabs/grades';
import { OverviewTab } from './tabs/overview';
import { ProblemsTab } from './tabs/problems';
import { RecordsTab } from './tabs/records';
import { SettingsContestTab } from './tabs/settings-contest';
import { SettingsHomeworkTab } from './tabs/settings-homework';
import { SettingsPracticeTab } from './tabs/settings-practice';
import { SetSettingsTab } from './tabs/set-advanced-settings';
import type { SettingsResponse } from './tabs/set-settings-model';
import { StudentsTab } from './tabs/students';
import { postJson } from './api';
import { teachSetTypeLabel } from './shared-preview-dialog';
import { LegacySnapshotProvider, WorkbenchDirtyProvider, useWorkbenchDirty, useLegacySnapshot } from './settings-kit';
import {
  formatTeachWindow,
  parseTeachWorkbenchPayload,
  TEACH_STATUS_LABEL,
} from './model';
import type { TeachAudienceSummary, TeachWorkbenchPayload } from './model';

const TAB_LABEL: Record<TeachTab, string> = {
  overview: '概况',
  problems: '题目',
  students: '学生',
  settings: '设置',
  grades: '成绩',
  records: '提交',
  management: '管理',
  advanced: '高级',
};

const DISCARD_MESSAGE = '切换页签会丢掉还没保存的修改。';
const DISCARD_TITLE = '放弃未保存的修改？';
const HOUR_MS = 60 * 60 * 1000;

function draftNotice(beginAt: string | null, now: number): string {
  if (!beginAt) return '已保存为草稿，尚未发布。学生还不能进入。';
  const begin = Date.parse(beginAt);
  if (!Number.isFinite(begin)) return '已保存为草稿，尚未发布。学生还不能进入。';
  if (begin <= now) return '已到开始时间，尚未发布，学生无法进入。';
  if (begin - now <= 24 * HOUR_MS) return '开始时间在 24 小时内，这份题目集尚未发布。';
  return '已保存为草稿，尚未发布。学生还不能进入。';
}

function DraftPublishAlert({ payload, now }: { payload: TeachWorkbenchPayload; now: number }) {
  const container = payload.container;
  const [confirmAudience, setConfirmAudience] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const begun = container.beginAt !== null && Date.parse(container.beginAt) <= now;
  return (
    <Alert
      tone={begun ? 'danger' : 'warning'}
      action={(
        <Button
          type="button"
          variant="primary"
          size="sm"
          loading={publishing}
          disabled={!confirmAudience || publishing}
          onClick={() => {
            setPublishing(true);
            setPublishError(null);
            void postJson(`/teach/${container.type}/${container.id}/publish`, { confirmAudience: true }, '发布失败')
              .then(() => { window.location.reload(); })
              .catch((error: unknown) => {
                setPublishError(error instanceof Error && error.message ? error.message : '发布失败');
                setPublishing(false);
              });
          }}
        >
          发布题目集
        </Button>
      )}
    >
      <span className="block">{draftNotice(container.beginAt, now)}</span>
      {container.setSummary ? <span className="mt-1 block">{container.setSummary}</span> : null}
      <label className="mt-2 flex items-center gap-2 text-sm">
        <Checkbox
          checked={confirmAudience}
          onChange={(event) => setConfirmAudience(event.target.checked)}
        />
        我已确认给谁做
      </label>
      {publishError ? <span className="mt-2 block">{publishError}</span> : null}
    </Alert>
  );
}

interface TeachTabProps {
  payload: TeachWorkbenchPayload;
  onNavigateTab: (tab: TeachTab) => void;
  onSettingsSaved?: (result: SettingsResponse) => void;
}

function namedList(names: readonly string[], empty: string): string {
  if (names.length === 0) return empty;
  return names.join('、');
}

function audienceSummary(audience: TeachAudienceSummary): string {
  if (audience.mode === 'all') return '所有人';
  if (audience.mode === 'redeem_only') return '仅兑换码';
  if (audience.mode === 'groups') return namedList(audience.groupNames, '未选择用户组');
  if (audience.mode === 'schools') return namedList(audience.schoolNames, '未选择学校');
  const unexpected: never = audience.mode;
  throw new TypeError(`teach_audience_invalid:${String(unexpected)}`);
}

function StatusMark({ status }: { status: TeachStatus }) {
  const label = TEACH_STATUS_LABEL[status];
  if (status === 'open') return <span>{label}</span>;
  let dot: ReactNode;
  if (status === 'running') dot = <StatusDot tone="success" pulse />;
  else if (status === 'upcoming') dot = <StatusDot tone="info" />;
  else if (status === 'ended') dot = <StatusDot />;
  else throw new TypeError(`teach_status_invalid:${String(status)}`);
  return (
    <span className="inline-flex items-center gap-1.5">
      {dot}
      {label}
    </span>
  );
}

function SettingsTab(props: TeachTabProps) {
  if (props.payload.container.setPublication != null) return <SetSettingsTab payload={props.payload} onSaved={props.onSettingsSaved} />;
  const type = props.payload.container.type;
  if (type === 'homework') return <SettingsHomeworkTab {...props} />;
  if (type === 'practice') return <SettingsPracticeTab {...props} />;
  if (type === 'exam' || type === 'acm' || type === 'oi') return <SettingsContestTab {...props} />;
  const unexpected: never = type;
  throw new TypeError(`teach_type_invalid:${String(unexpected)}`);
}

function WorkbenchTab({ tab, ...props }: TeachTabProps & { tab: TeachTab }) {
  if (tab === 'overview') return <OverviewTab {...props} />;
  if (tab === 'problems') return <ProblemsTab {...props} />;
  if (tab === 'students') return <StudentsTab {...props} />;
  if (tab === 'settings') return <SettingsTab {...props} />;
  if (tab === 'grades') return <GradesTab {...props} />;
  if (tab === 'records') return <RecordsTab {...props} />;
  if (tab === 'management') return <ManagementTab payload={props.payload} />;
  if (tab === 'advanced') return <AdvancedTab {...props} />;
  const unexpected: never = tab;
  throw new TypeError(`teach_tab_invalid:${String(unexpected)}`);
}

function tabFromLocation(type: TeachType): TeachTab {
  return parseTeachTab(new URLSearchParams(window.location.search).get('tab'), type);
}

function WorkbenchView({ payload: initialPayload, generatedAt }: { payload: TeachWorkbenchPayload; generatedAt: string }) {
  const [payload, setPayload] = useState(initialPayload);
  const legacy = useLegacySnapshot();
  const legacyStale = useRef(false);
  const [navigationError, setNavigationError] = useState('');
  const onSettingsSaved = (result: SettingsResponse) => {
    legacyStale.current = true;
    setPayload((current) => ({ ...current, container: { ...current.container,
      ...(result.basic ? { title: result.basic.title, beginAt: result.basic.beginAt, endAt: result.basic.endAt, status: result.basic.beginAt && result.basic.endAt ? teachStatusOf({ type: current.container.type, beginAt: result.basic.beginAt, endAt: result.basic.endAt }, new Date(now)) : 'upcoming' } : {}),
      durationMinutes: result.settings.personalLimit.hours === null ? null : result.settings.personalLimit.hours * 60,
      setSummary: summarizeSetSettings(result.settings), lockAt: result.lockAt,
    } }));
  };
  const now = useExamNow(generatedAt);
  const { dirtyTabs } = useWorkbenchDirty();
  const container = payload.container;
  const [tab, setTab] = useState<TeachTab>(() => tabFromLocation(container.type));
  const tabRef = useRef(tab);
  const dirtyRef = useRef(dirtyTabs);
  const switching = useRef(false);
  tabRef.current = tab;
  dirtyRef.current = dirtyTabs;

  async function chooseTab(next: TeachTab) {
    const current = tabRef.current;
    if (next === current || switching.current) return;
    if (dirtyRef.current.has(current)) {
      switching.current = true;
      let discard = false;
      try {
        discard = await confirmDialog(DISCARD_MESSAGE, {
          title: DISCARD_TITLE,
          confirmLabel: '放弃修改',
          destructive: true,
        });
      } finally {
        switching.current = false;
      }
      if (!discard || tabRef.current !== current) return;
    }
    if (next === 'advanced' && legacyStale.current) {
      switching.current = true;
      setNavigationError('');
      try {
 await legacy.reload();
        legacyStale.current = false;
        } catch (cause) {
 setNavigationError(cause instanceof Error ? cause.message : '无法读取最新设置。');
        return;
        } finally {
 switching.current = false;
        }
    }
    window.history.replaceState(null, '', teachPath(container.type, container.id, next));
    setTab(next);
  }

  const windowLabel = formatTeachWindow({
    type: container.type,
    beginAt: container.beginAt,
    endAt: container.endAt,
    durationMinutes: container.durationMinutes,
  }, new Date(now));
  const menuItems: MenuItem[] = [
    { label: '复制为新题目集', href: `/teach/new?copy=${container.type}:${container.id}` },
  ];
  if (container.links.scoreboard !== null) {
    menuItems.push({ label: '查看排行榜', href: container.links.scoreboard });
  }
  const onNavigateTab = (next: TeachTab) => {
    void chooseTab(next);
  };

  return (
    <Page width="wide">
      <PageHeader
        breadcrumb={(
          <Breadcrumb items={[
            { label: '题目集', href: '/teach' },
            { label: container.title },
          ]}
          />
        )}
        title={container.title}
        meta={(
          <>
            <Badge variant="outline">{teachSetTypeLabel(container.type, container.rule, container.setPurpose)}</Badge>
            <StatusMark status={container.status} />
            <span className="tabular">{windowLabel}</span>
            <span className="max-w-full min-w-0">{`· ${audienceSummary(container.audience)}`}</span>
          </>
        )}
        actions={(
          <>
            <Button asChild variant="secondary">
              <a href={container.links.studentView} target="_blank" rel="noreferrer">
                <Eye />
                学生视角
              </a>
            </Button>
            <Menu
              label="更多"
              trigger={(props) => (
                <Button
                  variant="ghost"
                  size="sm"
                  iconOnly
                  aria-label="更多"
                  type="button"
                  {...props}
                >
                  <MoreHorizontal />
                </Button>
              )}
              items={menuItems}
            />
          </>
        )}
        tabs={(
          <PageTabs
            aria-label="题目集页签"
            value={tab}
            onValueChange={onNavigateTab}
            items={teachTabsFor(container.type).map((value) => ({
              value,
              label: TAB_LABEL[value],
              count: value === 'problems' ? payload.paper.problems.length : undefined,
            }))}
          />
        )}
      />
      {container.setPublication === 'draft' ? <DraftPublishAlert payload={payload} now={now} /> : null}
      {navigationError ? <Alert tone="danger">{navigationError}</Alert> : null}
      <WorkbenchTab tab={tab} payload={payload} onNavigateTab={onNavigateTab} onSettingsSaved={onSettingsSaved} />
    </Page>
  );
}

export function TeachWorkbenchPage() {
  const bootstrap = useBootstrap();
  const payload = parseTeachWorkbenchPayload(bootstrap.page.data);
  return (
    <WorkbenchDirtyProvider>
      <LegacySnapshotProvider type={payload.container.type} id={payload.container.id}>
        <WorkbenchView payload={payload} generatedAt={bootstrap.generatedAt} />
      </LegacySnapshotProvider>
    </WorkbenchDirtyProvider>
  );
}
