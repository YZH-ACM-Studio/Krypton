import * as React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { BookOpen, CheckCircle2, ChevronDown, Code2, Home, Menu as MenuIcon, MessageSquare, PanelLeftClose, PanelLeftOpen, Play, Plus, Search, Settings, Shuffle, Trophy, Upload, Users, X } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Breadcrumb } from '@/components/ui/breadcrumb';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import { Progress } from '@/components/ui/display';
import { FormField } from '@/components/ui/form';
import { Input, SearchInput } from '@/components/ui/input';
import { useMediaQuery } from '@/components/ui/media';
import { MiniTabs } from '@/components/ui/mini-tabs';
import { MOTION } from '@/components/ui/motion';
import { Page, PageHeader, Toolbar } from '@/components/ui/page';
import { PageTabs } from '@/components/ui/page-tabs';
import { Pagination } from '@/components/ui/pagination';
import { Panel } from '@/components/ui/panel';
import { SimpleSelect } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { SimpleTooltip } from '@/components/ui/tooltip';
import { Difficulty } from '@/components/ui/verdict';
import { cn } from '@/lib/cn';
import { NavButton } from '../nav-button';
import { Person } from '../person';
import { Scoreboard } from '../sections/oj';

export type DemoKey = 'problems' | 'problem' | 'scoreboard' | 'settings';

const NAV = [
  { key: 'home', label: '首页', icon: Home },
  { key: 'problems', label: '题库', icon: Code2 },
  { key: 'contests', label: '比赛', icon: Trophy },
  { key: 'training', label: '训练', icon: BookOpen },
  { key: 'discuss', label: '讨论', icon: MessageSquare },
  { key: 'users', label: '排名', icon: Users },
] as const;

function motionEase(token: { duration: number; ease: readonly number[] }) {
  const [x1, y1, x2, y2] = token.ease;
  if (token.ease.length !== 4 || x1 === undefined || y1 === undefined || x2 === undefined || y2 === undefined) {
    throw new TypeError('Playground motion ease must be a four-number bezier');
  }
  return { duration: token.duration, ease: [x1, y1, x2, y2] as const };
}

function Logo({ collapsed }: { collapsed: boolean }) {
  return (
    <div className={cn('flex h-12 shrink-0 items-center gap-2.5 px-3.5', collapsed && 'justify-center px-0')}>
      <span className="grid size-7 place-items-center rounded-md bg-fg text-sm font-bold text-bg">Kr</span>
      {collapsed ? null : <span className="text-sm font-semibold tracking-tight text-fg">Krypton</span>}
    </div>
  );
}

function DemoSidebar({ collapsed, active }: { collapsed: boolean; active: string }) {
  return (
    <>
      <Logo collapsed={collapsed} />
      <nav className="flex flex-col gap-0.5 px-2 pt-2">
        {NAV.map((item) => {
          const Icon = item.icon;
          return (
            <NavButton
              key={item.key}
              collapsed={collapsed}
              icon={<Icon />}
              label={item.label}
              active={item.key === active}
              badge={item.key === 'contests' ? <Badge tone="success" size="sm">1</Badge> : undefined}
              badgeText={item.key === 'contests' ? '1' : undefined}
            />
          );
        })}
      </nav>
      <div className={cn('mt-6 px-4 text-2xs font-semibold text-fg-subtle', collapsed && 'hidden')}>管理</div>
      <nav className="flex flex-col gap-0.5 px-2 pt-1.5">
        <NavButton collapsed={collapsed} icon={<Settings />} label="域设置" active={active === 'settings'} />
      </nav>
    </>
  );
}

const shellQueryListeners = new Set<() => void>();
let shellQuery = '';

function subscribeShellQuery(listener: () => void) {
  shellQueryListeners.add(listener);
  return () => {
    shellQueryListeners.delete(listener);
  };
}

function getShellQuery() {
  return shellQuery;
}

function setShellQuery(next: string) {
  if (next === shellQuery) {
    return;
  }
  shellQuery = next;
  for (const listener of shellQueryListeners) {
    listener();
  }
}

function problemMatches(row: { pid: string; title: string; tags: readonly string[] }, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle === '') {
    return true;
  }
  if (row.pid.toLowerCase().includes(needle) || row.title.toLowerCase().includes(needle)) {
    return true;
  }
  return row.tags.some((tag) => tag.toLowerCase().includes(needle));
}

export function DemoShell({ active, children, scroll = true }: { active: string; children: React.ReactNode; scroll?: boolean }) {
  const desktop = useMediaQuery('(min-width: 1024px)');
  const wide = useMediaQuery('(min-width: 1280px)');
  const [pref, setPref] = React.useState<boolean | null>(null);
  const collapsed = pref ?? !wide;
  const [drawer, setDrawer] = React.useState(false);
  const [searchOpen, setSearchOpen] = React.useState(false);
  const query = React.useSyncExternalStore(subscribeShellQuery, getShellQuery, () => '');
  const searchRef = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => {
    if (desktop) setDrawer(false);
  }, [desktop]);
  React.useEffect(() => {
    if (searchOpen) {
      searchRef.current?.focus();
    }
  }, [searchOpen]);
  const closeSearch = () => {
    setShellQuery('');
    setSearchOpen(false);
  };

  return (
    <div className="flex h-dvh min-h-0 bg-bg">
      {desktop ? (
        <motion.aside
          initial={false}
          animate={{ width: collapsed ? 56 : 240 }}
          transition={motionEase(MOTION.state)}
          className="flex shrink-0 flex-col overflow-hidden border-r border-line bg-surface-sunken"
        >
          <DemoSidebar collapsed={collapsed} active={active} />
          <div className={cn('mt-auto flex border-t border-line-subtle p-2', collapsed ? 'justify-center' : 'justify-end')}>
            <SimpleTooltip content={collapsed ? '展开侧栏' : '收起侧栏'}>
              <Button type="button" variant="ghost" size="sm" iconOnly aria-label={collapsed ? '展开侧栏' : '收起侧栏'} onClick={() => setPref(!collapsed)}>
                {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
              </Button>
            </SimpleTooltip>
          </div>
        </motion.aside>
      ) : null}
      <AnimatePresence>
        {!desktop && drawer ? (
          <div className="fixed inset-0 z-40">
            <motion.div
              className="absolute inset-0 bg-scrim"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1, transition: motionEase(MOTION.enter) }}
              exit={{ opacity: 0, transition: motionEase(MOTION.exit) }}
              onClick={() => setDrawer(false)}
            />
            <motion.aside
              className="relative flex h-full w-72 max-w-[85vw] flex-col border-r border-line bg-surface-raised shadow-pop"
              initial={{ x: '-100%' }}
              animate={{ x: 0, transition: motionEase(MOTION.enter) }}
              exit={{ x: '-100%', transition: motionEase(MOTION.exit) }}
            >
              <div className="flex justify-end p-2">
                <SimpleTooltip content="关闭菜单">
                  <Button type="button" variant="ghost" size="sm" iconOnly aria-label="关闭菜单" onClick={() => setDrawer(false)}>
                    <X />
                  </Button>
                </SimpleTooltip>
              </div>
              <DemoSidebar collapsed={false} active={active} />
            </motion.aside>
          </div>
        ) : null}
      </AnimatePresence>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-12 shrink-0 items-center gap-2 border-b border-line bg-bg px-3 sm:px-4 short:h-11">
          {!desktop ? (
            <SimpleTooltip content="打开菜单">
              <Button type="button" variant="ghost" size="sm" iconOnly aria-label="打开菜单" onClick={() => setDrawer(true)}>
                <MenuIcon />
              </Button>
            </SimpleTooltip>
          ) : null}
          <SearchInput
            id="playground-shell-search"
            ref={searchRef}
            placeholder="搜索题目、比赛、用户"
            value={query}
            onChange={(event) => setShellQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape' && searchOpen) {
                event.preventDefault();
                closeSearch();
              }
            }}
            className={cn('min-w-0 md:w-72', searchOpen ? 'w-auto flex-1' : 'hidden md:flex')}
          />
          <div className="ml-auto flex items-center gap-1">
            <SimpleTooltip content={searchOpen ? '关闭搜索' : '搜索'}>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                iconOnly
                aria-label={searchOpen ? '关闭搜索' : '搜索'}
                aria-expanded={searchOpen}
                aria-controls="playground-shell-search"
                className="md:hidden"
                onClick={() => {
                  if (searchOpen) {
                    closeSearch();
                    return;
                  }
                  setSearchOpen(true);
                }}
              >
                {searchOpen ? <X /> : <Search />}
              </Button>
            </SimpleTooltip>
            <Person name="王小明" size="sm" className="ml-1" />
          </div>
        </div>
        <main className={cn('min-h-0 flex-1', scroll ? 'overflow-y-auto' : 'overflow-hidden')}>{children}</main>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- problems */

const PROBLEM_PAGE_SIZE = 12;
const PROBLEM_TOTAL = 1184;
const PROBLEM_PAGE_COUNT = 99;
const PROBLEM_TITLES = ['A+B Problem', '最短路计数', '区间第 k 小', '树上背包', '括号序列', '二分图最大匹配', '石子合并', '线段树 1', '字符串哈希', '最小生成树', '数位 DP', '网络流 24 题 · 飞行员配对'] as const;
const PROBLEM_TAGS = [['入门', '模拟'], ['图论', '最短路'], ['数据结构', '主席树'], ['DP', '树形 DP'], ['栈'], ['图论', '匈牙利'], ['DP', '区间 DP'], ['数据结构'], ['字符串'], ['图论', 'Kruskal'], ['DP'], ['网络流']] as const;
const PROBLEM_DIFF = [1, 4, 7, 6, 3, 6, 4, 4, 3, 4, 7, 8] as const;
const PROBLEM_AC = [98, 41, 18, 22, 63, 30, 47, 52, 58, 61, 15, 9] as const;
const PROBLEM_SOLVED = [true, true, false, false, true, false, true, false, false, true, false, false] as const;

function problemAt(offset: number) {
  const index = offset % PROBLEM_PAGE_SIZE;
  const title = PROBLEM_TITLES[index];
  const tagList = PROBLEM_TAGS[index];
  const diff = PROBLEM_DIFF[index];
  const ac = PROBLEM_AC[index];
  const solved = PROBLEM_SOLVED[index];
  if (title === undefined || tagList === undefined || diff === undefined || ac === undefined || solved === undefined) {
    throw new TypeError(`Problem demo row ${offset} is incomplete`);
  }
  return { pid: `P${1001 + offset}`, title, tags: tagList, diff, ac, solved };
}

export function ProblemsDemo() {
  const [tab, setTab] = React.useState('all');
  const [difficulty, setDifficulty] = React.useState('all');
  const query = React.useSyncExternalStore(subscribeShellQuery, getShellQuery, () => '');
  const page = Number(new URLSearchParams(window.location.search).get('page')) || 1;
  const visiblePage = Math.min(PROBLEM_PAGE_COUNT, Math.max(1, Math.trunc(page)));
  const rangeStart = (visiblePage - 1) * PROBLEM_PAGE_SIZE + 1;
  const rangeEnd = Math.min(visiblePage * PROBLEM_PAGE_SIZE, PROBLEM_TOTAL);
  const problems = Array.from({ length: rangeEnd - rangeStart + 1 }, (_, index) => problemAt(rangeStart - 1 + index));
  const shown = problems.filter((row) => problemMatches(row, query));
  const searching = query.trim() !== '';
  return (
    <DemoShell active="problems">
      <Page width="wide">
        <PageHeader
          title="题库"
          description="1,184 道题目，覆盖入门到省选。"
          actions={(
            <>
              <Button type="button" variant="secondary">
                <Shuffle />
                随机一题
              </Button>
              <Button type="button" variant="primary">
                <Plus />
                新建题目
              </Button>
            </>
          )}
          tabs={(
            <PageTabs
              aria-label="题库范围"
              value={tab}
              onValueChange={setTab}
              items={[
                { value: 'all', label: '全部', count: 1184 },
                { value: 'mine', label: '我的', count: 12 },
                { value: 'fav', label: '收藏', count: 37 },
              ]}
            />
          )}
        />
        <Toolbar end={<span className="hidden text-sm text-fg-subtle sm:inline">已通过 312 / 1,184</span>}>
          <SearchInput placeholder="题号、标题或标签" className="w-full sm:w-72" />
          <SimpleSelect
            ariaLabel="难度"
            className="w-32"
            options={[{ value: 'all', label: '全部难度' }, { value: '1', label: '入门' }, { value: '3', label: '普及' }, { value: '5', label: '提高' }]}
            value={difficulty}
            onValueChange={setDifficulty}
          />
          <Button type="button" variant="ghost">
            标签
            {' '}
            <ChevronDown />
          </Button>
        </Toolbar>
        <Panel flush footer={<Pagination current={page} total={PROBLEM_PAGE_COUNT} baseUrl="?demo=problems" summary={searching ? `当前页匹配 ${shown.length} 题` : `第 ${rangeStart}–${rangeEnd} 题，共 1,184 题`} />}>
          <DataTable
            rows={shown}
            rowKey={(row) => row.pid}
            onRowClick={() => undefined}
            empty={searching ? <p className="px-4 py-8 text-center text-sm text-fg-muted">没有匹配的题目</p> : undefined}
            columns={[
              {
                key: 'status',
                header: '',
                width: '2.5rem',
                stackRole: 'hidden',
                cell: (row) => (row.solved ? <CheckCircle2 className="size-4 text-success-fg" aria-label="已通过" /> : null),
              },
              { key: 'pid', header: '题号', width: '5.5rem', stackRole: 'hidden', cell: (row) => <span className="font-mono text-xs text-fg-subtle">{row.pid}</span> },
              {
                key: 'title',
                header: '标题',
                stackRole: 'title',
                cell: (row) => (
                  <span className="flex items-center gap-2">
                    {row.solved ? <CheckCircle2 className="size-4 shrink-0 text-success-fg md:hidden" /> : null}
                    <span className="font-mono text-xs text-fg-subtle md:hidden">{row.pid}</span>
                    <span className="font-medium">{row.title}</span>
                  </span>
                ),
              },
              {
                key: 'tags',
                header: '标签',
                hideBelow: 'lg',
                stackRole: 'hidden',
                cell: (row) => (
                  <span className="flex gap-1">
                    {row.tags.map((tag) => (
                      <Badge key={tag} size="sm">
                        {tag}
                      </Badge>
                    ))}
                  </span>
                ),
              },
              { key: 'diff', header: '难度', width: '5rem', stackRole: 'meta', cell: (row) => <Difficulty level={row.diff} /> },
              {
                key: 'ac',
                header: '通过率',
                width: '8rem',
                align: 'right',
                hideBelow: 'sm',
                cell: (row) => (
                  <span className="flex items-center justify-end gap-2">
                    <Progress value={row.ac} size="sm" className="hidden w-12 xl:block" />
                    <span className="tabular text-fg-muted">
                      {row.ac}
                      %
                    </span>
                  </span>
                ),
              },
            ]}
          />
        </Panel>
      </Page>
    </DemoShell>
  );
}

/* --------------------------------------------------------------- problem */

export function ProblemDemo() {
  const [lang, setLang] = React.useState('cpp17');
  const lg = useMediaQuery('(min-width: 1024px)');
  const statement = (
    <div className="flex flex-col gap-5">
      <PageHeader
        breadcrumb={<Breadcrumb items={[{ label: '题库', href: '#' }, { label: 'P1002' }]} />}
        title="最短路计数"
        meta={(
          <>
            <Difficulty level={4} />
            <span className="tabular">1000 ms · 256 MiB</span>
            <span className="tabular">通过 4,211 / 提交 10,233</span>
          </>
        )}
      />
      <article className="flex flex-col gap-4 text-md leading-relaxed text-fg">
        <h2 className="text-lg font-semibold">题目描述</h2>
        <p className="text-pretty">
          给出一个
          {' '}
          <i>N</i>
          {' '}
          个顶点
          {' '}
          <i>M</i>
          {' '}
          条边的无向无权图，顶点编号为 1∼
          <i>N</i>
          。问从顶点 1 开始，到其他每个点的最短路有几条。
        </p>
        <h2 className="text-lg font-semibold">输入格式</h2>
        <p className="text-pretty">
          第一行包含 2 个正整数
          {' '}
          <i>N</i>
          ,
          {' '}
          <i>M</i>
          ，为图的顶点数与边数。接下来
          {' '}
          <i>M</i>
          {' '}
          行，每行 2 个正整数
          {' '}
          <i>x</i>
          ,
          {' '}
          <i>y</i>
          ，表示有一条连接顶点
          {' '}
          <i>x</i>
          {' '}
          和顶点
          {' '}
          <i>y</i>
          {' '}
          的边。
        </p>
        <Alert tone="neutral">答案对 100003 取模。</Alert>
      </article>
    </div>
  );
  const editor = (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-line bg-surface shadow-xs">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-line-subtle px-2">
        <SimpleSelect
          size="sm"
          ariaLabel="语言"
          className="w-40"
          value={lang}
          onValueChange={setLang}
          options={[
            { value: 'cpp17', label: 'C++17' },
            { value: 'py3', label: 'Python 3' },
          ]}
        />
        <div className="ml-auto flex gap-1.5">
          <Button type="button" size="sm" variant="ghost">
            <Play />
            自测
          </Button>
          <Button type="button" size="sm" variant="primary">
            <Upload />
            提交
          </Button>
        </div>
      </div>
      <pre className="min-h-0 flex-1 overflow-auto bg-surface-sunken p-4 font-mono text-sm leading-relaxed text-fg-muted">
        {`#include <bits/stdc++.h>
using namespace std;
const int MOD = 100003;

int main() {
    int n, m;
    cin >> n >> m;
    vector<vector<int>> g(n + 1);
    // ...
}`}
      </pre>
    </div>
  );
  return (
    <DemoShell active="problems" scroll={!lg}>
      {lg ? (
        <div className="grid h-full min-h-0 grid-cols-2 gap-0 overflow-hidden">
          <div className="min-h-0 overflow-y-auto border-r border-line px-8 pt-8 pb-16 short:pt-4">{statement}</div>
          <div className="flex min-h-0 flex-col overflow-hidden p-4">
            <div className="flex min-h-0 flex-1 flex-col">{editor}</div>
          </div>
        </div>
      ) : (
        <Page width="prose">
          {statement}
          {editor}
        </Page>
      )}
    </DemoShell>
  );
}

/* ------------------------------------------------------------ scoreboard */

export function ScoreboardDemo() {
  const [scope, setScope] = React.useState('all');
  return (
    <DemoShell active="contests">
      <Page width="full">
        <PageHeader
          breadcrumb={<Breadcrumb items={[{ label: '比赛', href: '#' }, { label: '2026 秋季校赛 · 第一场' }]} />}
          title="榜单"
          meta={(
            <>
              <Badge tone="success" dot>
                进行中
              </Badge>
              <span className="tabular">剩余 00:42:17</span>
              <span>186 支队伍</span>
            </>
          )}
          actions={(
            <MiniTabs
              size="sm"
              aria-label="榜单范围"
              value={scope}
              onValueChange={setScope}
              items={[{ value: 'all', label: '全部' }, { value: 'school', label: '本校' }]}
            />
          )}
        />
        <Panel flush>
          <Scoreboard big />
        </Panel>
      </Page>
    </DemoShell>
  );
}

/* -------------------------------------------------------------- settings */

export function SettingsDemo() {
  const [allowSelfTest, setAllowSelfTest] = React.useState(true);
  const [publicDetail, setPublicDetail] = React.useState(false);
  return (
    <DemoShell active="settings">
      <Page width="form">
        <PageHeader title="域设置" description="这些设置作用于本域内所有题目、比赛和用户。" />
        <Panel
          title="基本信息"
          footer={(
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary">取消</Button>
              <Button type="button" variant="primary">保存</Button>
            </div>
          )}
        >
          <div className="flex flex-col gap-5">
            <FormField inline label="域名称" required>
              <Input defaultValue="计算机学院 OJ" />
            </FormField>
            <FormField inline label="域简介" hint="显示在首页顶部，支持 Markdown">
              <Textarea rows={3} defaultValue="欢迎来到计算机学院在线评测系统。" />
            </FormField>
          </div>
        </Panel>
        <Panel title="评测">
          <div className="flex flex-col divide-y divide-line-subtle">
            <div className="pb-4">
              <FormField inline label="允许自测" hint="学生可以在提交前用自定义输入运行代码">
                <div className="flex sm:justify-end">
                  <Switch checked={allowSelfTest} onCheckedChange={setAllowSelfTest} aria-label="允许自测" />
                </div>
              </FormField>
            </div>
            <div className="pt-4">
              <FormField inline label="公开评测详情" hint="赛后向所有人展示每个测试点的结果">
                <div className="flex sm:justify-end">
                  <Switch checked={publicDetail} onCheckedChange={setPublicDetail} aria-label="公开评测详情" />
                </div>
              </FormField>
            </div>
          </div>
        </Panel>
      </Page>
    </DemoShell>
  );
}

export const DEMOS: Record<DemoKey, { label: string; el: () => React.ReactElement }> = {
  problems: { label: '题库列表', el: () => <ProblemsDemo /> },
  problem: { label: '题目详情', el: () => <ProblemDemo /> },
  scoreboard: { label: '榜单', el: () => <ScoreboardDemo /> },
  settings: { label: '设置表单', el: () => <SettingsDemo /> },
};
