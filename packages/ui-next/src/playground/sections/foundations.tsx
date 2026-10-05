import * as React from 'react';
import { cn } from '@/lib/cn';

export function Section({ id, title, description, children }: { id: string; title: string; description?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24 border-t border-line pt-10 first:border-t-0 first:pt-0 lg:scroll-mt-12">
      <div className="mb-6 max-w-2xl">
        <h2 className="text-xl font-semibold tracking-tight text-fg">{title}</h2>
        {description ? <p className="mt-1.5 text-sm text-fg-muted text-pretty">{description}</p> : null}
      </div>
      <div className="flex flex-col gap-8">{children}</div>
    </section>
  );
}

/** One labelled specimen. `rule` is the spec sentence that will land in DESIGN.md. */
export function Specimen({ label, rule, children, className, stage = true }: { label: string; rule?: React.ReactNode; children: React.ReactNode; className?: string; stage?: boolean }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-3">
        <h3 className="text-sm font-semibold text-fg">{label}</h3>
        {rule ? <p className="text-xs text-fg-subtle">{rule}</p> : null}
      </div>
      <div className={cn(stage && 'rounded-lg border border-line bg-surface p-5 shadow-xs', className)}>{children}</div>
    </div>
  );
}

/* ------------------------------------------------------------------ colour */

function Swatch({ v, name, fg }: { v: string; name: string; fg?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="h-12 rounded-md border border-line-subtle" style={{ background: `var(${v})`, color: fg ? `var(${fg})` : undefined }}>
        {fg ? <span className="grid h-full place-items-center text-xs font-medium">Aa</span> : null}
      </div>
      <div className="truncate font-mono text-2xs text-fg-subtle">{name}</div>
    </div>
  );
}

const TONE_NAMES = ['brand', 'success', 'warning', 'danger', 'info', 'violet', 'orange'] as const;

export function Foundations() {
  return (
    <>
      <Specimen label="表面与层级" rule="bg 是画布；surface 是卡片/面板；sunken 是表头/代码井；raised 是浮层。暗色下层级越高越亮，不靠阴影。">
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
          <Swatch v="--bg" name="bg" />
          <Swatch v="--surface-sunken" name="surface-sunken" />
          <Swatch v="--surface" name="surface" />
          <Swatch v="--surface-raised" name="surface-raised" />
          <Swatch v="--surface-hover" name="surface-hover" />
          <Swatch v="--surface-active" name="surface-active" />
        </div>
      </Specimen>

      <Specimen label="文字与线" rule="正文只用 fg / fg-muted / fg-subtle 三级；disabled 只给禁用态。线分 subtle（行内分隔）/ line（容器）/ strong（输入框）。">
        <div className="grid gap-6 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <div className="text-md text-fg">fg — 标题与正文 The quick brown fox 0123456789</div>
            <div className="text-md text-fg-muted">fg-muted — 次要说明、描述文字</div>
            <div className="text-md text-fg-subtle">fg-subtle — 标签、元信息、占位</div>
            <div className="text-md text-fg-disabled">fg-disabled — 仅禁用态</div>
          </div>
          <div className="flex flex-col justify-center gap-4">
            {(['line-subtle', 'line', 'line-strong'] as const).map((l) => (
              <div key={l} className="flex items-center gap-3">
                <div className="h-px flex-1" style={{ background: `var(--${l})` }} />
                <span className="w-24 shrink-0 whitespace-nowrap font-mono text-2xs text-fg-subtle">{l}</span>
              </div>
            ))}
          </div>
        </div>
      </Specimen>

      <Specimen label="语义色阶" rule="每个语义色只有四种用法：solid 填充、fg 文字、soft 底、line 描边。页面禁止直接写色板（amber-500 之类在本系统里根本不存在）。">
        <div className="overflow-x-auto">
          <div className="grid min-w-[36rem] grid-cols-[5rem_repeat(4,1fr)] gap-x-3 gap-y-2">
            <div />
            {['solid', 'fg', 'soft', 'line'].map((k) => (
              <div key={k} className="font-mono text-2xs text-fg-subtle">
                {k}
              </div>
            ))}
            {TONE_NAMES.map((t) => (
              <React.Fragment key={t}>
                <div className="self-center text-xs font-medium text-fg-muted">{t}</div>
                <div className="grid h-9 place-items-center rounded-md text-xs font-medium" style={{ background: `var(--${t}-solid)`, color: `var(--on-${t}, #fff)` }}>
                  Aa
                </div>
                <div className="grid h-9 place-items-center rounded-md border border-line-subtle bg-surface text-sm font-semibold" style={{ color: `var(--${t}-fg)` }}>
                  Aa
                </div>
                <div className="h-9 rounded-md" style={{ background: `var(--${t}-soft)` }} />
                <div className="h-9 rounded-md border-2" style={{ borderColor: `var(--${t}-line)` }} />
              </React.Fragment>
            ))}
          </div>
        </div>
      </Specimen>

      <Specimen label="图表色" rule="ECharts 系列色按序取 chart-1…6，品牌色永远第一。">
        <div className="flex h-24 items-end gap-2">
          {[64, 88, 52, 72, 40, 80, 58, 92, 46, 68, 76, 54].map((h, i) => (
            <div key={i} className="flex-1 rounded-t-sm" style={{ height: `${h}%`, background: `var(--chart-${(i % 6) + 1})` }} />
          ))}
        </div>
      </Specimen>

      <Specimen label="字号阶梯" rule="页面标题 2xl（全页唯一）；区块标题 lg；卡片标题 sm semibold；正文 md；表格与控件 sm；元信息 xs。数字一律 tabular。">
        <div className="flex flex-col divide-y divide-line-subtle">
          {(
            [
              ['3xl', 'text-3xl font-semibold tracking-tight', '大屏数字 / 倒计时'],
              ['2xl', 'text-2xl font-semibold tracking-tight', '页面标题 · 题目列表'],
              ['xl', 'text-xl font-semibold tracking-tight', '移动端页面标题'],
              ['lg', 'text-lg font-semibold', '区块标题 · 提交记录'],
              ['md', 'text-md', '正文、侧栏导航 · 给定一个长度为 n 的整数序列 a₁…aₙ'],
              ['sm', 'text-sm', '表格、按钮、输入框 · Accepted 128ms 3.2MiB'],
              ['xs', 'text-xs text-fg-muted', '元信息、侧栏分组 · 2026-10-02 14:32 · 提交者'],
              ['2xs', 'text-2xs font-semibold text-fg-subtle', '小号徽标 · Kbd'],
            ] as const
          ).map(([k, cls, txt]) => (
            <div key={k} className="flex items-baseline gap-4 py-2.5">
              <span className="w-10 shrink-0 font-mono text-2xs text-fg-subtle">{k}</span>
              <span className={cn('min-w-0 truncate text-fg', cls)}>{txt}</span>
            </div>
          ))}
        </div>
        <div className="mt-4 grid gap-3 rounded-md bg-surface-sunken p-4 sm:grid-cols-2">
          <div className="text-sm text-fg-muted">
            等宽 · <code className="font-mono text-fg">for (int i = 0; i &lt; n; ++i) ans += a[i];</code>
          </div>
          <div className="tabular text-sm text-fg-muted">
            表格数字 · <span className="text-fg">1,024 / 98.76% / 00:42:17</span>
          </div>
        </div>
      </Specimen>

      <Specimen label="圆角与阴影" rule="控件 md；卡片/面板 lg；对话框 xl；头像/状态点 full。阴影只有三档：xs 控件、sm 悬浮态、pop 浮层。">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {(
            [
              ['sm', 'rounded-sm shadow-xs'],
              ['md', 'rounded-md shadow-xs'],
              ['lg', 'rounded-lg shadow-sm'],
              ['xl', 'rounded-xl shadow-pop'],
            ] as const
          ).map(([k, cls]) => (
            <div key={k} className={cn('grid h-20 place-items-center border border-line bg-surface-raised', cls)}>
              <span className="font-mono text-xs text-fg-subtle">radius-{k}</span>
            </div>
          ))}
        </div>
      </Specimen>
    </>
  );
}

/* ------------------------------------------------------------------ motion */

const DURS = [
  { k: 'dur-1', ms: 100, use: 'hover、按下、颜色变化' },
  { k: 'dur-2', ms: 160, use: '开关、选中、离场' },
  { k: 'dur-3', ms: 240, use: '浮层入场、展开' },
  { k: 'dur-4', ms: 360, use: '大面板、进度、布局' },
];

export function MotionSpec() {
  const [on, setOn] = React.useState(false);
  return (
    <>
      <Specimen label="时长与曲线" rule="入场 ease-out（快起慢停），离场 ease-in 且更短，状态切换 standard。点击轨道重播。">
        <button type="button" onClick={() => setOn((v) => !v)} className="flex w-full flex-col gap-3 text-left">
          {DURS.map((d) => (
            <div key={d.k} className="grid grid-cols-[4.5rem_1fr] items-center gap-3 sm:grid-cols-[4.5rem_1fr_10rem]">
              <span className="font-mono text-xs text-fg-muted">{d.k}</span>
              <div className="relative h-7 rounded-md bg-surface-sunken">
                <div
                  className="absolute top-1 size-5 rounded-sm bg-brand shadow-xs transition-[left] ease-(--ease-out)"
                  style={{ left: on ? 'calc(100% - 1.5rem)' : '0.25rem', transitionDuration: `var(--${d.k})` }}
                />
              </div>
              <span className="hidden text-xs text-fg-subtle sm:block">{d.use}</span>
            </div>
          ))}
        </button>
      </Specimen>
      <Specimen label="动效规则" stage={false}>
        <ul className="grid gap-3 text-sm text-fg-muted sm:grid-cols-2">
          {[
            ['只为因果服务', '动效回答"这东西从哪来、到哪去"。页面内容、卡片列表不做入场动画，不做 stagger。'],
            ['只动 transform 与 opacity', '颜色过渡允许；禁止动画 width/height/top（AppShell 侧栏除外，已用 motion 测量）。'],
            ['跟随指针的用 spring', 'Tab 下划线、分段控件滑块、开关圆点：stiffness 560 / damping 42，不回弹。'],
            ['尊重减少动态', 'prefers-reduced-motion 下所有 dur 归零，骨架屏停止闪光，保留透明度变化。'],
            ['加载有节制', '< 300ms 不显示任何加载态；300ms–1s 显示按钮内 spinner；> 1s 用骨架屏。'],
            ['实时状态用脉冲点', '评测中、直播中、监考在线：一个 2px 脉冲点，不是整块闪烁。'],
          ].map(([t, d]) => (
            <li key={t} className="rounded-lg border border-line bg-surface p-4">
              <div className="font-medium text-fg">{t}</div>
              <div className="mt-1 text-xs">{d}</div>
            </li>
          ))}
        </ul>
      </Specimen>
    </>
  );
}

/* ------------------------------------------------------------- responsive */

export function ResponsiveSpec() {
  const rows = [
    ['< 640', 'base', '手机', '单列；侧栏抽屉；Dialog 变底部抽屉；表格转卡片；分页变 ‹ 3/12 ›；页面左右边距 16'],
    ['≥ 640', 'sm', '大屏手机 / 小平板', 'PageHeader 操作区回到标题右侧；表单 inline 布局生效；边距 24'],
    ['≥ 768', 'md', '平板竖屏', '表格回归表格；Sheet 变 448px 侧板'],
    ['≥ 1024', 'lg', '平板横屏 / 小笔记本', '侧栏常驻（默认图标轨 56px）；题目页左右分栏；边距 32'],
    ['≥ 1280', 'xl', '笔记本 / 机房 1366', '侧栏默认展开 240px；三栏仪表盘生效'],
    ['≥ 1920', '3xl', '投影 / 大屏', '页面壳铺满内容区，与荣誉榜相同；榜单与监考墙再放大字号、增加列'],
    ['高 ≤ 800', 'short:', '1366×768 机房', '顶栏 44；页面上边距收紧；考试计时条贴顶；禁止底部固定栏遮挡作答区'],
  ];
  return (
    <Specimen label="断点与职责" rule="移动优先写法：无前缀 = 手机，逐级加。只有这 7 个断点，禁止 max-[…] 或任意 @media。" stage={false}>
      <div className="overflow-x-auto rounded-lg border border-line bg-surface shadow-xs">
        <table className="w-full min-w-[40rem] text-sm">
          <thead>
            <tr className="bg-surface-sunken text-left text-xs text-fg-subtle">
              <th className="h-9 px-4 font-medium">宽度</th>
              <th className="px-4 font-medium">前缀</th>
              <th className="px-4 font-medium">典型设备</th>
              <th className="px-4 font-medium">发生什么</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r[1]} className="border-t border-line-subtle">
                <td className="px-4 py-2.5 font-mono text-xs whitespace-nowrap text-fg">{r[0]}</td>
                <td className="px-4 font-mono text-xs text-brand-fg">{r[1]}</td>
                <td className="px-4 whitespace-nowrap text-fg-muted">{r[2]}</td>
                <td className="px-4 py-2.5 text-fg-muted">{r[3]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Specimen>
  );
}
