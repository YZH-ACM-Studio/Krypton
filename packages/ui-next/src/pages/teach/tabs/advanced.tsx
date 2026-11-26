import type { TeachTab, TeachType } from '@hydrooj/common';
import type { LucideIcon } from 'lucide-react';
import {
  Armchair,
  BadgeCheck,
  ExternalLink,
  Folder,
  GitBranch,
  KeyRound,
  MessageSquare,
  Settings2,
  Shield,
  Users,
} from 'lucide-react';
import { useEffect, useState, type ReactElement, type ReactNode } from 'react';
import { PracticeIntegrityPolicyPanel } from '@/components/practice-integrity-policy-panel';
import { Alert } from '@/components/ui/alert';
import { MiniTabs } from '@/components/ui/mini-tabs';
import { Panel } from '@/components/ui/panel';
import { ContestExamSeatEntry } from '@/pages/contest-manage';
import { getJson } from '../api';
import {
  OtherContestSettingsSection,
  PlannedTeamBatchSection,
  VerifierSection,
  VigilEntrySection,
} from '../advanced/contest-sections';
import { StageEditorSection } from '../advanced/stage-editor';
import { legacyEditPath } from '../legacy-forms';
import type { TeachLinks, TeachWorkbenchPayload } from '../model';
import { useLegacySnapshot } from '../settings-kit';

interface TeachTabProps {
  payload: TeachWorkbenchPayload;
  onNavigateTab: (tab: TeachTab) => void;
}

interface AdvancedSection {
  title: string;
  description: string;
  icon: LucideIcon;
  body: ReactNode;
}

interface RelatedRow {
  title: string;
  description: string;
  href: string;
  icon: LucideIcon;
}

interface ExamSeatContest {
  _id?: string;
  docId?: string;
  title?: string;
  rule?: string;
  beginAt?: string;
  endAt?: string;
  participationMode?: string;
  participantScopeMode?: 'none' | 'schools' | 'groups';
  participantSchoolIds?: string[];
  participantGroupIds?: string[];
  plannedTeamBatchId?: string;
  teamBatchId?: string;
  assign?: string[];
  code?: string;
  _code?: string;
}

interface ExamSeatGroup {
  _id: unknown;
  name: string;
  schoolId?: unknown;
  archivedAt?: unknown;
}

interface ExamSeatModel {
  contest: ExamSeatContest;
  scopeGroups: ExamSeatGroup[];
}

const RELATED_TITLE = '相关页面';
const RELATED_DESCRIPTION = '打开附件、打印和现场管理工具。';
const SEAT_LOAD_FAILED = '机房座位没有加载出来。';
const SEAT_READING = '正在读取机房座位。';
const TEAM_BATCH_NEEDS_TEAM = '先在「学生」里打开组队参赛，才能预绑定批次。';
const SCOPE_MODES = ['none', 'schools', 'groups'] as const;

const LINK_CLASS = 'flex min-w-0 items-center gap-3 px-4 py-3 outline-none hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [&_svg]:size-4';
const ICON_BOX_CLASS = 'grid size-8 shrink-0 place-items-center rounded-md bg-surface-active text-fg-subtle';

function messageOf(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim() !== '') return error.message;
  return fallback;
}

function invalidSeat(path: string): Error {
  return new Error(`机房座位数据无效（${path}）。`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readRecord(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) throw invalidSeat(path);
  return value;
}

function readOptionalString(record: Record<string, unknown>, key: string, path: string): string | undefined {
  if (!Object.hasOwn(record, key) || record[key] == null) return undefined;
  const value = record[key];
  if (typeof value !== 'string') throw invalidSeat(path);
  return value;
}

function readStringList(record: Record<string, unknown>, key: string, path: string): string[] | undefined {
  if (!Object.hasOwn(record, key) || record[key] == null) return undefined;
  const value = record[key];
  if (!Array.isArray(value)) throw invalidSeat(path);
  const list: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') throw invalidSeat(path);
    list.push(item);
  }
  return list;
}

function isScopeMode(value: string): value is (typeof SCOPE_MODES)[number] {
  return (SCOPE_MODES as readonly string[]).includes(value);
}

function readScopeMode(record: Record<string, unknown>): ExamSeatContest['participantScopeMode'] {
  if (!Object.hasOwn(record, 'participantScopeMode') || record.participantScopeMode == null) return undefined;
  const value = record.participantScopeMode;
  if (typeof value !== 'string' || !isScopeMode(value)) throw invalidSeat('tdoc.participantScopeMode');
  return value;
}

function assignString<T extends object, K extends keyof T>(target: T, key: K, value: T[K] | undefined): void {
  if (value !== undefined) target[key] = value;
}

function readSeatContest(tdoc: Record<string, unknown>, contestId: string): ExamSeatContest {
  const id = readOptionalString(tdoc, '_id', 'tdoc._id');
  const docId = readOptionalString(tdoc, 'docId', 'tdoc.docId');
  if (id !== contestId && docId !== contestId) throw invalidSeat('tdoc._id');
  const contest: ExamSeatContest = {};
  assignString(contest, '_id', id);
  assignString(contest, 'docId', docId);
  assignString(contest, 'title', readOptionalString(tdoc, 'title', 'tdoc.title'));
  assignString(contest, 'rule', readOptionalString(tdoc, 'rule', 'tdoc.rule'));
  assignString(contest, 'beginAt', readOptionalString(tdoc, 'beginAt', 'tdoc.beginAt'));
  assignString(contest, 'endAt', readOptionalString(tdoc, 'endAt', 'tdoc.endAt'));
  assignString(contest, 'participationMode', readOptionalString(tdoc, 'participationMode', 'tdoc.participationMode'));
  assignString(contest, 'participantScopeMode', readScopeMode(tdoc));
  assignString(contest, 'participantSchoolIds', readStringList(tdoc, 'participantSchoolIds', 'tdoc.participantSchoolIds'));
  assignString(contest, 'participantGroupIds', readStringList(tdoc, 'participantGroupIds', 'tdoc.participantGroupIds'));
  assignString(contest, 'plannedTeamBatchId', readOptionalString(tdoc, 'plannedTeamBatchId', 'tdoc.plannedTeamBatchId'));
  assignString(contest, 'teamBatchId', readOptionalString(tdoc, 'teamBatchId', 'tdoc.teamBatchId'));
  assignString(contest, 'assign', readStringList(tdoc, 'assign', 'tdoc.assign'));
  assignString(contest, 'code', readOptionalString(tdoc, 'code', 'tdoc.code'));
  assignString(contest, '_code', readOptionalString(tdoc, '_code', 'tdoc._code'));
  return contest;
}

function readScopeGroups(value: unknown): ExamSeatGroup[] {
  if (value == null) return [];
  if (!Array.isArray(value)) throw invalidSeat('scopeGroups');
  return value.map((item, index) => {
    const row = readRecord(item, `scopeGroups[${index}]`);
    if (!Object.hasOwn(row, '_id')) throw invalidSeat(`scopeGroups[${index}]._id`);
    if (typeof row.name !== 'string') throw invalidSeat(`scopeGroups[${index}].name`);
    const group: ExamSeatGroup = { _id: row._id, name: row.name };
    if (Object.hasOwn(row, 'schoolId')) group.schoolId = row.schoolId;
    if (Object.hasOwn(row, 'archivedAt')) group.archivedAt = row.archivedAt;
    return group;
  });
}

function readInviteCode(record: Record<string, unknown>): string | undefined {
  if (!Object.hasOwn(record, 'inviteCode') || record.inviteCode == null) return undefined;
  if (typeof record.inviteCode !== 'string') throw invalidSeat('inviteCode');
  if (record.inviteCode === '') return undefined;
  return record.inviteCode;
}

function readSeatModel(raw: unknown, contestId: string): ExamSeatModel {
  const record = readRecord(raw, 'document');
  const contest = readSeatContest(readRecord(record.tdoc, 'tdoc'), contestId);
  // Edit JSON keeps the invite code only at the top level; tdoc._code is dropped.
  const inviteCode = readInviteCode(record);
  if (inviteCode !== undefined) contest.code = inviteCode;
  return {
    contest,
    scopeGroups: readScopeGroups(record.scopeGroups),
  };
}

function ExamSeatSection({ contestId }: { contestId: string }): ReactElement {
  const [model, setModel] = useState<ExamSeatModel | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getJson(legacyEditPath('exam', contestId), SEAT_LOAD_FAILED)
      .then((raw) => {
        if (cancelled) return;
        setModel(readSeatModel(raw, contestId));
        setError(null);
      })
      .catch((caught: unknown) => {
        console.error('teach exam seat load failed', { contestId, error: caught });
        if (!cancelled) setError(messageOf(caught, SEAT_LOAD_FAILED));
      });
    return () => {
      cancelled = true;
    };
  }, [contestId]);

  if (error) return <Alert tone="danger">{error}</Alert>;
  if (!model) return <p className="text-sm text-fg-muted">{SEAT_READING}</p>;
  return <ContestExamSeatEntry tdoc={model.contest} contestId={contestId} scopeGroups={model.scopeGroups} />;
}

function TeamBatchSection({ payload }: { payload: TeachWorkbenchPayload }): ReactElement {
  const legacy = useLegacySnapshot();
  const contest = legacy.status === 'ready' && legacy.snapshot?.kind === 'contest' ? legacy.snapshot.value : null;
  if (contest && contest.state.participationMode !== 'team') {
    return <p className="text-sm text-fg-muted">{TEAM_BATCH_NEEDS_TEAM}</p>;
  }
  return <PlannedTeamBatchSection payload={payload} />;
}

function otherDescription(type: TeachType): string {
  if (type === 'acm' || type === 'oi') return '计入 Rating、虚拟参赛、打印和允许的语言。';
  return '允许的语言。';
}

function sectionsFor(payload: TeachWorkbenchPayload): AdvancedSection[] {
  const { type } = payload.container;
  if (type === 'homework') return [];
  if (type === 'practice') {
    return [
      {
        title: '阶段与先修',
        description: '把题目分成几个阶段，学生做完前一阶段才能进入下一阶段。',
        icon: GitBranch,
        body: <StageEditorSection payload={payload} />,
      },
      {
        title: '真实性训练策略',
        description: '禁外部代码注入、移除独立提交表单、防 AI 复制注入。发布后不可改。',
        icon: Shield,
        body: <PracticeIntegrityPolicyPanel containerKind="problemSet" containerId={payload.container.id} />,
      },
    ];
  }
  const sections: AdvancedSection[] = [
    {
      title: '机房监考（Vigil）与入场方式',
      description: '普通网页可进入 / 必须通过客户端进入；审批方式；网络锁。',
      icon: Shield,
      body: <VigilEntrySection payload={payload} />,
    },
  ];
  if (type === 'acm' && payload.capabilities.canManageTeamBatches) {
    sections.push({
      title: '队伍批次预绑定',
      description: '赛前把一个组队批次预绑定到这场比赛。',
      icon: Users,
      body: <TeamBatchSection payload={payload} />,
    });
  }
  sections.push(
    {
      title: '验证人',
      description: '开赛前帮你检查题目和数据的人。',
      icon: BadgeCheck,
      body: <VerifierSection payload={payload} />,
    },
    {
      title: '其它设置',
      description: payload.container.setPublication ? '管理计分与比赛期间的题目可见性。' : otherDescription(type),
      icon: Settings2,
      body: <OtherContestSettingsSection payload={payload} />,
    },
  );
  if (type === 'exam') {
    sections.push({
      title: '座位与机房',
      description: '排座位、预登录、考场网络。',
      icon: Armchair,
      body: <ExamSeatSection contestId={payload.container.id} />,
    });
  }
  return sections;
}

function linkRow(title: string, description: string, href: string | null, icon: LucideIcon): RelatedRow | null {
  if (!href) return null;
  return { title, description, href, icon };
}

function listed(items: Array<RelatedRow | null>): RelatedRow[] {
  return items.filter((item): item is RelatedRow => item !== null);
}

function relatedRows(type: 'practice' | 'homework', links: TeachLinks): RelatedRow[] {
  if (type === 'practice') {
    return listed([
      linkRow('兑换码', '让名单外的人通过兑换码进入整个练习或某个阶段。', links.redemption, KeyRound),
      linkRow('附件文件', '给学生下载的资料。', links.files, Folder),
    ]);
  }
  return listed([
    linkRow('参赛选手', '查看报名名单、手动加人、处理打星。', links.users, Users),
    linkRow('答疑与公告', '回复学生提问，向全体广播通知。', links.clarification, MessageSquare),
    linkRow('附件文件', '公开文件给学生下载，私有材料只有管理者能看。', links.files, Folder),
  ]);
}

function RelatedLink({ item }: { item: RelatedRow }): ReactElement {
  const Icon = item.icon;
  return (
    <a href={item.href} target="_blank" rel="noopener" className={LINK_CLASS}>
      <span className={ICON_BOX_CLASS}>
        <Icon />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-fg">{item.title}</span>
        <span className="block truncate text-xs text-fg-subtle">{item.description}</span>
      </span>
      <ExternalLink className="shrink-0 text-fg-subtle" />
    </a>
  );
}

export function AdvancedTab({ payload }: TeachTabProps): ReactElement {
  const sections = sectionsFor(payload);
  const [category, setCategory] = useState(sections[0]?.title ?? 'tools');
  const links = payload.container.type === 'practice' || payload.container.type === 'homework'
    ? relatedRows(payload.container.type, payload.container.links) : [];
  return <div className="flex min-w-0 flex-col gap-5">
    <MiniTabs
aria-label="高级设置分类"
size="md"
value={category}
onValueChange={setCategory}
      items={[...sections.map((section) => ({ value: section.title, label: section.title, icon: section.icon })), ...(links.length ? [{ value: 'tools', label: '管理工具' }] : [])]} />
    {sections.map((section) => <div key={section.title} hidden={category !== section.title} className={category === section.title ? 'min-w-0' : 'hidden'}>
      <Panel title={section.title} description={section.description}>{section.body}</Panel>
    </div>)}
    {category === 'tools' && links.length > 0 ? <Panel flush title={RELATED_TITLE} description={RELATED_DESCRIPTION}>
      <div className="grid min-w-0 gap-3 md:grid-cols-2 xl:grid-cols-3">{links.map((item) => <RelatedLink key={item.title} item={item} />)}</div>
    </Panel> : null}
  </div>;
}
