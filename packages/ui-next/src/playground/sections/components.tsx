import * as React from 'react';
import {
  Archive,
  ArrowRight,
  Bell,
  BookOpen,
  ChevronDown,
  Code2,
  Copy,
  Download,
  FileText,
  Filter,
  Inbox,
  LayoutGrid,
  List,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  Settings,
  Share2,
  Trash2,
  Trophy,
  Upload,
  Users,
} from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Breadcrumb } from '@/components/ui/breadcrumb';
import { Button, ButtonGroup } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { DataTable, type SortState } from '@/components/ui/data-table';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Kbd, Progress, Skeleton, Spinner, Stat, StatusDot } from '@/components/ui/display';
import { EmptyState } from '@/components/ui/empty-state';
import { FormField } from '@/components/ui/form';
import { Input, SearchInput } from '@/components/ui/input';
import { Menu, Popover } from '@/components/ui/menu';
import { MiniTabs } from '@/components/ui/mini-tabs';
import { PageTabs } from '@/components/ui/page-tabs';
import { Pagination } from '@/components/ui/pagination';
import { DescriptionList, Panel } from '@/components/ui/panel';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { SimpleSelect } from '@/components/ui/select';
import { Sheet, SheetBody, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/toast';
import { SimpleTooltip } from '@/components/ui/tooltip';
import { NavButton } from '../nav-button';
import { Person } from '../person';
import { RangeInput } from '../range';
import { Specimen } from './foundations';

const Row = ({ children }: { children: React.ReactNode }) => <div className="flex flex-wrap items-center gap-3">{children}</div>;

/* ----------------------------------------------------------------- actions */

export function Actions() {
  const [loading, setLoading] = React.useState(false);
  return (
    <Specimen label="按钮层级" rule="一个视图里 primary 最多一个；secondary 是默认；ghost 用于工具栏和表格行；danger 只给不可逆操作。">
      <div className="flex flex-col gap-5">
        <Row>
          <Button type="button" variant="primary">
            <Plus />
            新建题目
          </Button>
          <Button type="button" variant="secondary">
            <Upload />
            导入
          </Button>
          <Button type="button" variant="soft">加入题单</Button>
          <Button type="button" variant="ghost">
            <Filter />
            筛选
          </Button>
          <Button type="button" variant="danger">
            <Trash2 />
            删除比赛
          </Button>
          <Button type="button" variant="danger-soft">撤销提交</Button>
          <Button type="button" variant="link">
            查看全部
            {' '}
            <ArrowRight />
          </Button>
        </Row>
        <Row>
          <Button type="button" variant="primary" size="sm">
            小号
          </Button>
          <Button type="button" variant="primary">标准</Button>
          <Button type="button" variant="primary" size="lg">
            大号 · 提交代码
          </Button>
          <Button
            type="button"
            variant="primary"
            loading={loading}
            onClick={() => {
              setLoading(true);
              window.setTimeout(() => setLoading(false), 1600);
            }}
          >
            {loading ? '提交中' : '点我看加载态'}
          </Button>
          <Button type="button" variant="secondary" disabled>禁用</Button>
        </Row>
        <Row>
          <SimpleTooltip content="复制链接">
            <Button type="button" variant="secondary" iconOnly aria-label="复制链接">
              <Copy />
            </Button>
          </SimpleTooltip>
          <SimpleTooltip content="刷新">
            <Button type="button" iconOnly variant="ghost" aria-label="刷新">
              <RefreshCw />
            </Button>
          </SimpleTooltip>
          <ButtonGroup>
            <Button type="button" variant="secondary">
              <Download />
              下载数据
            </Button>
            <SimpleTooltip content="更多下载选项">
              <Button type="button" variant="secondary" iconOnly aria-label="更多下载选项">
                <ChevronDown />
              </Button>
            </SimpleTooltip>
          </ButtonGroup>
          <ButtonGroup>
            <Button type="button" variant="secondary" size="sm">日</Button>
            <Button type="button" variant="secondary" size="sm">周</Button>
            <Button type="button" variant="secondary" size="sm">月</Button>
          </ButtonGroup>
        </Row>
      </div>
    </Specimen>
  );
}

/* ------------------------------------------------------------------ inputs */

const RULES = [
  { value: 'acm', label: 'ACM / ICPC', hint: '罚时' },
  { value: 'oi', label: 'OI', hint: '赛后出分' },
  { value: 'ioi', label: 'IOI', hint: '实时分数' },
] as const;

const TIME_LIMIT_MIN = 0;
const TIME_LIMIT_MAX = 10000;

function clampTimeLimit(raw: number): number {
  if (!Number.isFinite(raw)) {
    throw new TypeError('Time limit must be a finite number');
  }
  return Math.min(TIME_LIMIT_MAX, Math.max(TIME_LIMIT_MIN, raw));
}

export function Inputs() {
  const [lang, setLang] = React.useState('cpp17');
  const [rule, setRule] = React.useState('acm');
  const [choice, setChoice] = React.useState('acm');
  const [view, setView] = React.useState<'list' | 'grid'>('list');
  const [pub, setPub] = React.useState(true);
  const [compactSwitch, setCompactSwitch] = React.useState(false);
  const [rated, setRated] = React.useState(false);
  const [agree, setAgree] = React.useState(true);
  const [o2, setO2] = React.useState(false);
  const [limit, setLimit] = React.useState(1000);
  // The number itself cannot represent a cleared field: valueAsNumber is NaN, and writing it back snaps to the last value.
  const [limitDraft, setLimitDraft] = React.useState('1000');
  const commitLimit = (next: number) => {
    const clamped = clampTimeLimit(next);
    setLimit(clamped);
    setLimitDraft(String(clamped));
  };
  return (
    <>
      <Specimen label="表单字段" rule="标签在上、提示在下；错误替换提示而不是追加。必填用红色 *，可选写「可选」，二者不混用。">
        <div className="grid gap-5 md:grid-cols-2">
          <FormField label="比赛标题" htmlFor="demo-contest-title" required hint="会显示在比赛列表与榜单顶部">
            <Input id="demo-contest-title" placeholder="2026 秋季校赛 · 第一场" />
          </FormField>
          <FormField label="比赛编号" htmlFor="demo-contest-code" error="编号已被 2025 秋季校赛占用">
            <Input id="demo-contest-code" defaultValue="autumn-2026" invalid />
          </FormField>
          <FormField label="赛制">
            <SimpleSelect
              ariaLabel="赛制"
              value={rule}
              onValueChange={setRule}
              options={[
                { value: 'acm', label: 'ACM / ICPC', hint: '罚时' },
                { value: 'oi', label: 'OI', hint: '赛后出分' },
                { value: 'ioi', label: 'IOI', hint: '实时分数' },
                { value: 'ledo', label: 'Ledo', hint: '递减' },
                { value: 'homework', label: '作业', disabled: true },
              ]}
            />
          </FormField>
          <FormField label="时间限制" htmlFor="demo-time-limit" optional hint="单位毫秒，默认 1000">
            <Input
              id="demo-time-limit"
              type="number"
              min={TIME_LIMIT_MIN}
              max={TIME_LIMIT_MAX}
              step={1}
              value={limitDraft}
              onChange={(event) => {
                const raw = event.target.value;
                setLimitDraft(raw);
                if (raw.trim() === '') {
                  return;
                }
                const parsed = event.target.valueAsNumber;
                if (!Number.isFinite(parsed)) {
                  return;
                }
                setLimit(clampTimeLimit(parsed));
              }}
              onBlur={() => {
                if (limitDraft.trim() === '' || !Number.isFinite(Number(limitDraft))) {
                  setLimitDraft(String(limit));
                  return;
                }
                commitLimit(Number(limitDraft));
              }}
              trailing={<span className="text-xs">ms</span>}
            />
          </FormField>
          <FormField label="搜索" htmlFor="demo-field-search">
            <SearchInput id="demo-field-search" placeholder="题号、标题或标签" />
          </FormField>
          <FormField label="已锁定" htmlFor="demo-locked-pid">
            <Input id="demo-locked-pid" defaultValue="P1001" disabled />
          </FormField>
          <FormField label="比赛说明" htmlFor="demo-contest-notes" className="md:col-span-2">
            <Textarea id="demo-contest-notes" placeholder="支持 Markdown 与 LaTeX…" rows={3} />
          </FormField>
        </div>
      </Specimen>

      <Specimen label="设置列表（inline 字段）" rule="设置页用 label 左 / 控件右，sm 以下自动堆叠。开关类设置即时生效，不需要保存按钮。">
        <div className="flex flex-col divide-y divide-line-subtle">
          <div className="pb-4">
            <FormField inline label="公开比赛" hint="关闭后仅受邀用户可见">
              <div className="flex h-full items-center sm:justify-end">
                <Switch checked={pub} onCheckedChange={setPub} aria-label="公开比赛" />
              </div>
            </FormField>
          </div>
          <div className="py-4">
            <FormField inline label="计入 Rating" hint="比赛结束后重新计算参赛者 Rating">
              <div className="flex h-full items-center sm:justify-end">
                <Switch checked={rated} onCheckedChange={setRated} aria-label="计入 Rating" />
              </div>
            </FormField>
          </div>
          <div className="pt-4">
            <FormField inline label="默认语言">
              <SimpleSelect
                ariaLabel="默认语言"
                value={lang}
                onValueChange={setLang}
                className="sm:ml-auto sm:max-w-60"
                options={[
                  { value: 'cpp17', label: 'C++17 (GCC 13)' },
                  { value: 'cpp20', label: 'C++20 (GCC 13)' },
                  { value: 'py3', label: 'Python 3.12' },
                  { value: 'java', label: 'Java 21' },
                ]}
              />
            </FormField>
          </div>
        </div>
      </Specimen>

      <Specimen label="选择类控件">
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
          <div className="flex flex-col gap-3">
            <Checkbox checked={agree} onCheckedChange={setAgree} label="我已阅读考试须知" description="考试期间切屏将被记录" />
            <Checkbox checked={o2} onCheckedChange={setO2} label="开启 O2 优化" />
            <Checkbox checked={false} indeterminate onCheckedChange={() => undefined} label="部分选中" />
            <Checkbox checked disabled label="已锁定选项" />
          </div>
          <RadioGroup aria-label="赛制">
            {RULES.map((option) => (
              <RadioGroupItem
                key={option.value}
                name="contest-rule-choice"
                value={option.value}
                checked={choice === option.value}
                onChange={() => setChoice(option.value)}
                label={option.label}
                description={option.hint}
              />
            ))}
          </RadioGroup>
          <div className="flex flex-col gap-4">
            <MiniTabs<'list' | 'grid'>
              value={view}
              onValueChange={setView}
              aria-label="显示方式"
              items={[
                { value: 'list', label: '列表', icon: <List /> },
                { value: 'grid', label: '卡片', icon: <LayoutGrid /> },
              ]}
            />
            <div className="flex items-center gap-3">
              <Switch checked={compactSwitch} onCheckedChange={setCompactSwitch} size="sm" aria-label="小号开关" />
              <span className="text-sm text-fg-muted">小号开关（表格行内）</span>
            </div>
            <RangeInput label="时间限制滑块" value={limit} min={TIME_LIMIT_MIN} max={TIME_LIMIT_MAX} step={1} onValueChange={commitLimit} />
          </div>
        </div>
      </Specimen>
    </>
  );
}

/* ----------------------------------------------------------------- display */

const TONES: BadgeTone[] = ['neutral', 'brand', 'success', 'warning', 'danger', 'info', 'violet', 'orange'];
const GROUP = ['李雷', '韩梅梅', 'Carol', 'Dave', 'Eve', 'Frank'];

export function Display() {
  return (
    <>
      <Specimen label="徽标" rule="soft 是默认；outline 用于分类标签（难度、题型）；solid 只给需要跳出来的计数（未读、新）。">
        <div className="flex flex-col gap-3">
          {(['soft', 'outline', 'solid'] as const).map((variant) => (
            <Row key={variant}>
              <span className="w-14 font-mono text-2xs text-fg-subtle">{variant}</span>
              {TONES.map((tone) => (
                <Badge key={tone} tone={tone} variant={variant} dot={variant === 'soft'}>
                  {tone}
                </Badge>
              ))}
            </Row>
          ))}
        </div>
      </Specimen>

      <div className="grid gap-8 lg:grid-cols-2">
        <Specimen label="头像与状态">
          <div className="flex flex-col gap-4">
            <Row>
              <Person name="张三" size="lg" />
              <Person name="Alice" />
              <Person name="王小明" size="sm" />
              <Person name="Bob" size="xs" />
              <span className="inline-flex -space-x-1.5">
                {GROUP.slice(0, 4).map((name) => (
                  <Person key={name} name={name} size="sm" />
                ))}
                <span className="inline-grid size-6 place-items-center rounded-full bg-surface-active text-2xs font-medium text-fg-muted ring-2 ring-surface">
                  +
                  {GROUP.length - 4}
                </span>
              </span>
            </Row>
            <Row>
              <span className="inline-flex items-center gap-2 text-sm text-fg-muted">
                <StatusDot tone="success" pulse />
                {' '}
                进行中
              </span>
              <span className="inline-flex items-center gap-2 text-sm text-fg-muted">
                <StatusDot tone="info" />
                {' '}
                即将开始
              </span>
              <span className="inline-flex items-center gap-2 text-sm text-fg-muted">
                <StatusDot />
                {' '}
                已结束
              </span>
              <span className="inline-flex items-center gap-2 text-sm text-fg-muted">
                <Spinner className="text-fg-subtle" />
                {' '}
                同步中
              </span>
            </Row>
            <Row>
              <span className="text-sm text-fg-muted">
                快捷键
                {' '}
                <Kbd>⌘</Kbd>
                {' '}
                <Kbd>K</Kbd>
                {' '}
                打开搜索，
                <Kbd>Ctrl</Kbd>
                {' '}
                +
                {' '}
                <Kbd>Enter</Kbd>
                {' '}
                提交
              </span>
            </Row>
          </div>
        </Specimen>
        <Specimen label="进度与骨架">
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <div className="flex justify-between text-xs">
                <span className="text-fg-muted">题单进度</span>
                <span className="tabular text-fg">32 / 50</span>
              </div>
              <Progress value={64} />
            </div>
            <Progress value={100} tone="success" size="sm" />
            <Progress value={38} tone="warning" size="sm" />
            <div className="flex items-center gap-3 pt-2">
              <Skeleton className="size-9 rounded-full" />
              <div className="flex flex-1 flex-col gap-2">
                <Skeleton className="h-3 w-2/5" />
                <Skeleton className="h-3 w-4/5" />
              </div>
            </div>
          </div>
        </Specimen>
      </div>

      <Specimen label="统计" rule="数字是主角：2xl tabular；标签在上 xs subtle。一行最多 4 个，md 以下 2 列。">
        <div className="grid grid-cols-2 gap-x-6 gap-y-6 md:grid-cols-4 md:divide-x md:divide-line-subtle [&>*]:md:pl-6 [&>*:first-child]:md:pl-0">
          <Stat label="通过题数" value="1,284" delta={12} />
          <Stat label="提交次数" value="9,317" hint="本周 +418" />
          <Stat label="通过率" value="38.4" unit="%" delta={-3} />
          <Stat label="排名" value="#27" hint="共 1,906 人" />
        </div>
      </Specimen>
    </>
  );
}

/* ---------------------------------------------------------------- feedback */

function showRecycleToast() {
  let id = '';
  id = toast.info('已移入回收站', {
    description: (
      <Button
        type="button"
        variant="link"
        size="sm"
        onClick={() => {
          if (id === '') {
            throw new TypeError('recycle toast id was not assigned');
          }
          toast.dismiss(id);
          toast.success('已从回收站恢复');
        }}
      >
        撤销
      </Button>
    ),
  });
}

export function Feedback() {
  const [shown, setShown] = React.useState(true);
  return (
    <>
      <Specimen label="提示条" rule="Alert 是页面内的持久信息；Toast 是对操作的短暂回执。错误 Toast 不自动消失。">
        <div className="flex flex-col gap-3">
          <Alert tone="info" title="本场比赛采用 ACM 赛制">
            封榜时间为结束前 1 小时，封榜后提交结果仅自己可见。
          </Alert>
          {shown ? (
            <Alert tone="success" title="题目数据已同步" onDismiss={() => setShown(false)}>
              48 个测试点、3 个子任务全部通过校验。
            </Alert>
          ) : null}
          <Alert tone="warning" title="检查器未经生产评测链验证" action={<Button type="button" size="sm" variant="secondary">发起无记录烟测</Button>}>
            浮点题请勿使用 default 文本比较器。
          </Alert>
          <Alert tone="danger" title="评测机离线">
            go-judge 心跳已中断 3 分钟，新提交将排队。
          </Alert>
        </div>
      </Specimen>
      <Specimen label="Toast">
        <Row>
          <Button type="button" variant="secondary" onClick={() => toast.success('已保存', { description: '比赛设置已更新' })}>成功</Button>
          <Button type="button" variant="secondary" onClick={() => toast.error('提交失败', { description: '网络连接中断，请重试', duration: Infinity })}>错误（不自动消失）</Button>
          <Button type="button" variant="secondary" onClick={showRecycleToast}>
            带撤销
          </Button>
          <Button type="button" variant="secondary" onClick={() => toast.info('还剩 5 分钟', { description: '请尽快保存代码' })}>提示</Button>
        </Row>
      </Specimen>
      <div className="grid gap-8 lg:grid-cols-2">
        <Specimen label="空状态" stage={false}>
          <Panel>
            <EmptyState
              icon={<Inbox />}
              title="还没有提交记录"
              description="选一道题开始吧，你的每次提交都会出现在这里。"
              action={(
                <Button type="button" variant="primary" size="sm">
                  去题库
                </Button>
              )}
            />
          </Panel>
        </Specimen>
        <Specimen label="空状态 · 筛选无结果" stage={false}>
          <Panel>
            <EmptyState
              icon={<Filter />}
              title="没有匹配的题目"
              description="试试去掉「省选」难度或「已通过」筛选。"
              action={<Button type="button" variant="secondary" size="sm">清除筛选</Button>}
            />
          </Panel>
        </Specimen>
      </div>
    </>
  );
}

/* ---------------------------------------------------------------- overlays */

export function Overlays() {
  const [dialog, setDialog] = React.useState(false);
  const [confirm, setConfirm] = React.useState(false);
  const [sheet, setSheet] = React.useState(false);
  return (
    <Specimen label="浮层" rule="Dialog 用于需要决定的事；Sheet 用于查看/编辑一条记录而不离开列表；Menu 用于 3 个以上的次要操作。手机上 Dialog 变底部抽屉。">
      <Row>
        <Button type="button" variant="secondary" onClick={() => setDialog(true)}>打开对话框</Button>
        <Button type="button" variant="danger-soft" onClick={() => setConfirm(true)}>
          危险确认
        </Button>
        <Button type="button" variant="secondary" onClick={() => setSheet(true)}>打开侧板</Button>
        <Menu
          label="题目操作"
          trigger={(props) => (
            <Button type="button" variant="secondary" {...props}>
              操作
              {' '}
              <ChevronDown />
            </Button>
          )}
          items={[
            { label: '编辑题面', icon: <Pencil />, shortcut: 'E' },
            { label: '复制到题库', icon: <Copy /> },
            { label: '分享', icon: <Share2 />, shortcut: '⌘L' },
            // Menu groups are always `uppercase tracking-wider` and have no opt-out. DESIGN §6.24 puts danger items after a separator instead of a Chinese overline.
            'separator',
            { label: '归档', icon: <Archive /> },
            { label: '删除题目', icon: <Trash2 />, danger: true, onSelect: () => setConfirm(true) },
          ]}
        />
        <Menu
          trigger={(props) => (
            <Button type="button" variant="ghost" iconOnly aria-label="更多" {...props}>
              <MoreHorizontal />
            </Button>
          )}
          items={[{ label: '查看提交', icon: <FileText /> }, { label: '重测', icon: <RefreshCw />, disabled: true }]}
        />
        <Popover
          trigger={(props) => (
            <Button type="button" variant="ghost" {...props}>
              <Bell />
              {' '}
              通知
            </Button>
          )}
          className="w-80 p-0"
        >
          <div className="border-b border-line-subtle px-4 py-3 text-sm font-semibold text-fg">通知</div>
          <ul className="divide-y divide-line-subtle">
            {['你的提交 #81723 已通过', '2026 秋季校赛将在 30 分钟后开始', '李雷 回复了你的讨论'].map((item) => (
              <li key={item} className="flex gap-3 px-4 py-3 text-sm text-fg-muted hover:bg-surface-hover">
                <StatusDot tone="brand" className="mt-1.5" />
                {item}
              </li>
            ))}
          </ul>
        </Popover>
        <SimpleTooltip content="悬停 450ms 后出现，聚焦立即出现">
          <Button type="button" variant="ghost">悬停提示</Button>
        </SimpleTooltip>
      </Row>

      <Dialog open={dialog} onOpenChange={setDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>创建题单</DialogTitle>
            <DialogDescription>题单可以分配给班级，也可以公开给所有人。</DialogDescription>
          </DialogHeader>
          <DialogBody>
            <div className="flex flex-col gap-4">
              <FormField label="名称" required>
                <Input placeholder="动态规划入门" />
              </FormField>
              <FormField label="描述" optional>
                <Textarea rows={3} />
              </FormField>
            </div>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setDialog(false)}>取消</Button>
            <Button
              type="button"
              variant="primary"
              onClick={() => {
                setDialog(false);
                toast.success('题单已创建');
              }}
            >
              创建
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>删除题目 P1001？</DialogTitle>
            <DialogDescription>题面、测试数据和 1,284 条提交记录将被永久删除，且无法恢复。</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setConfirm(false)}>取消</Button>
            <Button
              type="button"
              variant="danger"
              onClick={() => {
                setConfirm(false);
                toast.info('P1001 已删除');
              }}
            >
              删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Sheet open={sheet} onOpenChange={setSheet}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>提交 #81723</SheetTitle>
          </SheetHeader>
          <SheetBody>
            <div className="p-5">
              <DescriptionList
                items={[
                  { term: '题目', detail: 'P1001 A+B Problem' },
                  { term: '用户', detail: '王小明' },
                  { term: '结果', detail: <Badge tone="success" dot>Accepted</Badge> },
                  { term: '用时', detail: '128 ms' },
                  { term: '内存', detail: '3.2 MiB' },
                  { term: '语言', detail: 'C++17 (GCC 13)' },
                  { term: '提交时间', detail: '2026-10-02 14:32:07' },
                ]}
              />
            </div>
          </SheetBody>
          <div className="flex shrink-0 justify-end gap-2 border-t border-line-subtle px-5 py-3 pb-[max(.75rem,env(safe-area-inset-bottom))]">
            <Button type="button" variant="secondary">重测</Button>
            <Button type="button" variant="primary">查看代码</Button>
          </div>
        </SheetContent>
      </Sheet>
    </Specimen>
  );
}

/* -------------------------------------------------------------- navigation */

const NAV = [
  { key: 'problems', label: '题库', icon: Code2 },
  { key: 'contests', label: '比赛', icon: Trophy, badge: '2' },
  { key: 'training', label: '训练', icon: BookOpen },
  { key: 'users', label: '用户', icon: Users },
  { key: 'settings', label: '设置', icon: Settings },
] as const;

export function Navigation() {
  const [tab, setTab] = React.useState('statement');
  const [nav, setNav] = React.useState('problems');
  return (
    <>
      <Specimen label="页签" rule="页面级用下划线 Tabs；同一视图内切换显示方式用 Segmented。窄屏横向滚动不换行。">
        <div className="border-b border-line">
          <PageTabs
            aria-label="题目"
            value={tab}
            onValueChange={setTab}
            items={[
              { value: 'statement', label: '题面', icon: <BookOpen /> },
              { value: 'submissions', label: '提交', count: 128 },
              { value: 'solutions', label: '题解', count: 7 },
              { value: 'discussion', label: '讨论', count: 23 },
              { value: 'stats', label: '统计' },
            ]}
          />
        </div>
      </Specimen>
      <div className="grid gap-8 lg:grid-cols-2">
        <Specimen label="面包屑">
          <Breadcrumb items={[{ label: '比赛', href: '#' }, { label: '2026 秋季校赛', href: '#' }, { label: 'C · 最短路计数' }]} />
        </Specimen>
        <Specimen label="分页" rule="手机上自动变成 ‹ 3 / 24 ›">
          <Pagination current={3} total={24} baseUrl="?demo=problems" summary="共 1,184 道题" />
        </Specimen>
      </div>
      <Specimen label="侧栏导航项" rule="选中态靠背景 + 字重，不加色条、不变色。图标统一 lucide 16px。">
        <div className="grid gap-6 sm:grid-cols-[15rem_auto]">
          <div className="flex flex-col gap-0.5 rounded-lg bg-surface-sunken p-2">
            {NAV.map((item) => {
              const Icon = item.icon;
              return (
                <NavButton
                  key={item.key}
                  icon={<Icon />}
                  label={item.label}
                  badge={'badge' in item ? <Badge tone="success" size="sm">{item.badge}</Badge> : undefined}
                  badgeText={'badge' in item ? item.badge : undefined}
                  active={nav === item.key}
                  onClick={() => setNav(item.key)}
                />
              );
            })}
          </div>
          <div className="flex w-14 flex-col gap-0.5 rounded-lg bg-surface-sunken p-2">
            {NAV.slice(0, 3).map((item) => {
              const Icon = item.icon;
              return (
                <NavButton
                  key={item.key}
                  collapsed
                  icon={<Icon />}
                  label={item.label}
                  badge={'badge' in item ? <Badge tone="success" size="sm">{item.badge}</Badge> : undefined}
                  badgeText={'badge' in item ? item.badge : undefined}
                  active={nav === item.key}
                  onClick={() => setNav(item.key)}
                />
              );
            })}
          </div>
        </div>
      </Specimen>
    </>
  );
}

/* -------------------------------------------------------------------- data */

interface UserRow {
  uid: string;
  name: string;
  school: string;
  solved: number;
  rating: number;
  role: 'admin' | 'teacher' | 'student';
  last: string;
}

const USERS: UserRow[] = [
  { uid: '1001', name: '王小明', school: '计科 2401', solved: 312, rating: 1987, role: 'student', last: '3 分钟前' },
  { uid: '1002', name: '李雷', school: '软工 2302', solved: 548, rating: 2214, role: 'student', last: '1 小时前' },
  { uid: '1003', name: '韩梅梅', school: '计科 2401', solved: 97, rating: 1432, role: 'student', last: '昨天' },
  { uid: '1004', name: '陈老师', school: '教研室', solved: 1204, rating: 2650, role: 'teacher', last: '刚刚' },
  { uid: '1005', name: 'admin', school: '—', solved: 0, rating: 0, role: 'admin', last: '2 天前' },
];

const ROLE: Record<UserRow['role'], { label: string; tone: BadgeTone }> = {
  admin: { label: '管理员', tone: 'danger' },
  teacher: { label: '教师', tone: 'brand' },
  student: { label: '学生', tone: 'neutral' },
};

function compareUser(left: UserRow, right: UserRow, key: keyof UserRow): number {
  const a = left[key];
  const b = right[key];
  if (typeof a === 'number' && typeof b === 'number') {
    return a - b;
  }
  return String(a).localeCompare(String(b));
}

export function Data() {
  const [sort, setSort] = React.useState<SortState>({ key: 'rating', dir: 'desc' });
  const [selected, setSelected] = React.useState<Set<string>>(new Set(['1002']));
  const [loading, setLoading] = React.useState(false);
  const key = sort.key as keyof UserRow;
  const rows = [...USERS].sort((left, right) => {
    const delta = compareUser(left, right, key);
    return sort.dir === 'asc' ? delta : -delta;
  });
  return (
    <Specimen
      label="数据表"
      rule="表头 sunken + xs subtle；行高 = --row-h；数字列右对齐 tabular；整行 hover；选中行 brand-soft。md 以下变卡片（试试缩窄窗口）。"
      stage={false}
    >
      <Panel
        flush
        title="用户"
        description={selected.size ? `已选 ${selected.size} 人` : '共 5 人'}
        actions={(
          <>
            {selected.size ? (
              <Button type="button" size="sm" variant="danger-soft">
                移出域
              </Button>
            ) : null}
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                setLoading(true);
                window.setTimeout(() => setLoading(false), 1500);
              }}
            >
              <RefreshCw />
              模拟加载
            </Button>
          </>
        )}
      >
        <DataTable
          rows={rows}
          rowKey={(row) => row.uid}
          sort={sort}
          onSort={setSort}
          selected={selected}
          onSelectedChange={setSelected}
          loading={loading}
          onRowClick={() => undefined}
          columns={[
            {
              key: 'name',
              header: '用户',
              stackRole: 'title',
              cell: (row) => (
                <span className="flex items-center gap-2.5">
                  <Person name={row.name} size="sm" />
                  <span className="font-medium">{row.name}</span>
                </span>
              ),
            },
            { key: 'school', header: '班级', hideBelow: 'lg', cell: (row) => <span className="text-fg-muted">{row.school}</span> },
            { key: 'role', header: '角色', stackRole: 'meta', cell: (row) => <Badge tone={ROLE[row.role].tone}>{ROLE[row.role].label}</Badge> },
            { key: 'solved', header: '通过', align: 'right', sortable: true, width: '6rem', cell: (row) => <span className="tabular">{row.solved}</span> },
            { key: 'rating', header: 'Rating', align: 'right', sortable: true, width: '6rem', cell: (row) => <span className="tabular font-medium">{row.rating || '—'}</span> },
            { key: 'last', header: '最近活跃', align: 'right', hideBelow: 'xl', cell: (row) => <span className="text-fg-subtle">{row.last}</span> },
          ]}
        />
      </Panel>
    </Specimen>
  );
}
