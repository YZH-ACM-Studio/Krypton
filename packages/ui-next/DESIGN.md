# Krypton UI 设计规范（ui-next）

> 版本：v1.0 · 2026-10-02 · 状态：生效
> 适用范围：`packages/ui-next/src/**` 下的全部 React 代码。
> 活的样式指南：`bun run dev` 后打开 `/next/playground.html`。本文与 playground 冲突时**以本文为准**，并把 playground 修到与本文一致。

---

## 0. 怎么读这份文档

### 0.1 给实现者（尤其是自动化 worker）

1. 本文的每一条都是**硬规则**，不是建议。用词约定：
   - **必须 / MUST**：违反即视为缺陷，审查必须打回。
   - **禁止 / MUST NOT**：同上。
   - **默认 / DEFAULT**：没有本文列出的例外时一律这样做；要偏离就必须引用本文的例外条款编号。
2. **不要发挥审美。** 本文没写到的视觉决定，一律选最朴素、最少装饰、和相邻已迁移页面最一致的写法，并在提交说明里列出来交给人看。不要发明新颜色、新阴影、新圆角、新动画、新字号。
3. 迁移旧页面时，**功能、权限、数据、路由、文案语义、DOM 中的 `data-*` 钩子与 `aria-*` 属性**全部保持不变。你只改「长什么样」和「用哪个组件画出来」。
4. 先查 §6 的组件目录。已有组件能表达的东西**必须**用组件，不准手写一份长得一样的 `div`。
5. 自动化门禁（§10）是最低要求，不是全部要求。门禁全绿的页面仍然可能违反 §1–§9，审查者按 §12 的清单逐条检查。

### 0.2 优先级

用户本轮明确指令 > 本文 > 现有页面的写法。现有页面里的写法**不是先例**，绝大部分正是本规范要消灭的东西。

### 0.3 术语

| 词 | 含义 |
|---|---|
| token | `src/design/tokens.css` 中的 CSS 自定义属性，例如 `--fg-muted` |
| 工具类 | 映射到 token 的 Tailwind 类，例如 `text-fg-muted` |
| tone | 语义色族：`brand` `success` `warning` `danger` `info` `violet` `orange`，外加无彩色的 `neutral` |
| 原型 | §5 定义的页面骨架：列表页、详情页、表单页、工作区、仪表盘、考试壳、独立页 |
| 门禁 | `scripts/design-gate.mjs`，规则编号 DS001–DS015 |
| 旧 token | shadcn 时代的 `primary` `secondary` `muted` `accent` `destructive` `card` `popover` `background` `foreground` `input` `sidebar-*` |

---

## 1. 设计原则

这五条用来裁决本文没覆盖到的情况。按顺序优先。

1. **内容是主角，界面退后。** OJ 是数据密集的工具：题目、代码、结果、分数。界面靠细线和留白分层，不靠色块、阴影和装饰。一屏里第一眼看到的必须是用户要处理的数据，而不是边框和图标。
2. **颜色只表达含义。** 品牌色只有一个，只用于「主操作」和「当前选中」。其余颜色全部来自语义 tone，并且每个 tone 只有一种含义（§2.3）。不准为了「好看」「活泼」「区分一下」而上色。
3. **一种东西只有一种样子。** 评测结果、难度、比赛状态、空状态、确认对话框、页面标题：全站各只有一种画法，由组件提供。两个页面里的同一种东西长得不一样，就是缺陷。
4. **动效回答因果。** 动画只用来说明「这个东西从哪来、到哪去、状态变了」。页面内容不做入场动画，不做 stagger，不做悬停浮起。克制，像系统应用，不像营销页。不用磨砂玻璃。
5. **每个视口都是一等公民。** 手机（学生在宿舍看题）、1366×768 机房机（考试）、1920 投影（榜单）都必须是被设计过的状态，而不是「缩小了也能凑合看」。

---

## 2. Token

唯一的 token 源是 `src/design/tokens.ts`，由它生成 `src/design/tokens.css`。**禁止**在任何其它地方定义颜色、圆角、字号、时长。

### 2.1 生成参数（已锁定）

```ts
export const DEFAULT_PARAMS: DesignParams = {
  brandHue: 268,        // Indigo
  brandChroma: 0.17,
  neutralHue: 268,      // 冷灰，与品牌同向
  neutralTint: 0.006,
  radius: 7,            // px
  density: 'default',
  font: 'mona',         // Mona Sans；中文走系统字体
  fontSize: 14,         // px
  motionScale: 1,
};
```

修改这些参数需要用户批准。worker **禁止**改。

### 2.2 颜色：中性层级

| 工具类（背景 / 文字 / 边框） | token | 用途 | 禁止用于 |
|---|---|---|---|
| `bg-bg` | `--bg` | 应用画布，最底层。`<body>`、AppShell 主区底色 | 卡片、浮层 |
| `bg-surface` | `--surface` | 卡片、面板、表格、输入框底色 | 页面画布 |
| `bg-surface-sunken` | `--surface-sunken` | 凹陷区：表头、代码块、样例框、侧栏底、面板页脚 | 可点击元素的常态 |
| `bg-surface-raised` | `--surface-raised` | 浮层：Dialog、Sheet、Popover、Menu、Toast | 页面内卡片 |
| `bg-surface-hover` | `--surface-hover` | 悬停底：表格行、菜单项、ghost 按钮 | 常态背景 |
| `bg-surface-active` | `--surface-active` | 选中/按下底：选中的导航项、分段控件槽、中性徽标、进度条轨道 | 大面积背景 |
| `border-line-subtle` | `--line-subtle` | 容器**内部**分隔：表格行线、列表 `divide-y`、面板头底线 | 容器外框 |
| `border-line` | `--line` | 容器外框：卡片、面板、表格外框、浮层、页面分隔线 | 输入框 |
| `border-line-strong` | `--line-strong` | 输入类控件边框、复选框/单选框边框 | 卡片 |
| `text-fg` | `--fg` | 标题、正文、表格主要数据 | — |
| `text-fg-muted` | `--fg-muted` | 次要正文：描述、说明段落、未选中的导航项和页签 | 标题 |
| `text-fg-subtle` | `--fg-subtle` | 元信息：标签文字、时间、计数、占位符、表头、图标 | 段落正文 |
| `text-fg-disabled` | `--fg-disabled` | **只**给禁用态 | 任何非禁用元素（包括「不重要」的文字） |
| `bg-scrim` | `--scrim` | 模态遮罩 | — |

层级规则：

- 亮色下，`surface`（白）浮在 `bg`（近白灰）上，靠 `border-line` 和 `shadow-xs` 分层。
- 暗色下，**层级越高越亮**：`bg` < `surface-sunken` < `surface` < `surface-raised`。暗色不靠阴影分层。
- **禁止卡片套卡片。** `Panel` 里面再分组，用 `divide-y divide-line-subtle` 或一块 `bg-surface-sunken rounded-md` 的井，不准再画一个带边框、带阴影的盒子。

### 2.3 颜色：语义 tone

每个 tone 只有一种含义。**按含义选 tone，不按颜色选。**

| tone | 含义（唯一） | 典型用例 | 禁止用例 |
|---|---|---|---|
| `brand` | 主操作、当前选中、可交互强调 | primary 按钮、选中复选框、开关打开、焦点环、链接、进度条、选中行底 | 状态、装饰、标题着色 |
| `success` | 成功、通过、正常、在线 | AC、已通过题目、保存成功、进行中的比赛点 | 「新」「推荐」等非结果含义 |
| `warning` | 需要注意但未失败；资源接近上限 | TLE/MLE/OLE、即将截止、未验证的配置、剩余 ≤5 分钟 | 普通提示、装饰性高亮 |
| `danger` | 失败、错误、不可逆、违规 | WA/PE、删除按钮、校验错误、离线、作弊告警 | 「重要」但没出错的信息 |
| `info` | 中性的系统信息；进行中；部分 | 评测中、PA 部分分、封榜、提示性 Alert | 品牌强调 |
| `violet` | 运行时错误（RE）；第三类分类色 | RE、难度 10 | 一般装饰 |
| `orange` | 编译错误（CE）；第四类分类色 | CE、难度 6–7 | 一般装饰 |
| `neutral` | 无状态、已结束、未知、等待 | Pending、已结束的比赛、SE、普通标签 | — |

每个 tone 只有四种用法，对应四个工具类，**不准用别的方式消费 tone**：

| 用法 | 工具类 | 什么时候用 |
|---|---|---|
| 实底填充 | `bg-{tone}` + 文字 `text-on-{tone}` | 极少：primary/danger 按钮、计数气泡、榜单「一血」格 |
| 文字 | `text-{tone}-fg` | 带 tone 的文字和图标 |
| 柔和底 | `bg-{tone}-soft` | 徽标底、Alert 底、榜单通过格、选中行（`bg-brand-soft/60`） |
| 描边 | `border-{tone}-line` | Alert 边框、outline 徽标、强调卡片外框 |

另有 `hover:bg-brand-hover`、`hover:bg-danger-hover`、`hover:bg-brand-soft-hover`、`hover:bg-danger-soft-hover` 只给对应的按钮变体用。

对比度保证（`test/design/tokens.spec.ts` 守护，两种主题都成立）：

| 前景 / 背景 | 最低对比度 |
|---|---|
| `fg` / `surface` | 12:1 |
| `fg-muted` / `surface` | 7:1 |
| `fg-subtle` / `surface`、`bg`、`surface-sunken` | 4.5:1 |
| `{tone}-fg` / `surface` 和 `{tone}-soft` | 4.5:1 |
| `on-{tone}` / `{tone}` 实底 | 4.5:1 |

所以：**小号文字可以用 `fg-subtle`**，但**禁止**再往下用 `opacity-*` 或 `/50` 之类给文字减淡。需要更弱的文字，说明它不该出现。

### 2.4 颜色：图表

ECharts 通过 `src/components/ui/echart-theme.ts` 在运行时读取 `--chart-1` 到 `--chart-6`。系列按序取色，品牌色永远是第一个。图表**禁止**在 option 里手写颜色；如果某个系列有语义（例如「通过」和「失败」），就用 `--success-solid` / `--danger-solid`，并通过 `readToken('--success-solid')` 读取（§6.36）。

### 2.5 旧 token → 新 token 对照（迁移用，机械替换）

迁移期间旧 token 通过别名继续可用（看起来已经是新配色），但**每个被迁移的文件必须全部换成新名字**。

| 旧写法 | 新写法 | 说明 |
|---|---|---|
| `bg-background` | `bg-bg` | |
| `text-foreground` | `text-fg` | |
| `bg-card` / `bg-popover` | `bg-surface`；浮层内用 `bg-surface-raised` | |
| `text-card-foreground` / `text-popover-foreground` | `text-fg` | |
| `bg-muted` | `bg-surface-sunken`（凹陷区） 或 `bg-surface-active`（中性徽标/轨道） | 看它是「区域」还是「小块」 |
| `text-muted-foreground` | `text-fg-muted`（段落、描述） 或 `text-fg-subtle`（元信息、标签、时间、图标、≤ `text-xs` 的字） | 规则见 2.5.1 |
| `bg-accent`（悬停用） | `bg-surface-hover` | **旧 accent 是灰，不是品牌色** |
| `hover:bg-accent` | `hover:bg-surface-hover` | |
| `bg-accent` / `data-[state=...]:bg-accent`（选中用） | `bg-surface-active` | |
| `text-accent-foreground` | `text-fg` | |
| `bg-primary` | `bg-brand` | |
| `text-primary`（链接、强调文字） | `text-brand-fg` | |
| `text-primary-foreground` | `text-on-brand` | |
| `bg-primary/10`、`bg-primary/5` | `bg-brand-soft` | |
| `border-primary`、`border-primary/30` | `border-brand-line`；焦点/选中态的实线用 `border-brand` | |
| `ring-primary` | `ring-ring` | |
| `bg-secondary` | `bg-surface-active` | |
| `text-secondary-foreground` | `text-fg` | |
| `bg-destructive` | `bg-danger` | |
| `text-destructive` | `text-danger-fg` | |
| `bg-destructive/10` | `bg-danger-soft` | |
| `border-destructive`、`border-destructive/40` | `border-danger-line` | |
| `text-destructive-foreground` | `text-on-danger` | |
| `border-input` | `border-line-strong` | |
| `border`（无颜色） | `border border-line` | 显式写出颜色 |
| `bg-sidebar*` / `text-sidebar*` | 只允许出现在 AppShell 里，按 §5.8 改写 | |

#### 2.5.1 `text-muted-foreground` 的二选一规则

按顺序判断，第一条命中的就是答案：

1. 元素的字号是 `text-xs` 或 `text-2xs` → `text-fg-subtle`
2. 元素是图标（`<svg>`、lucide 组件） → `text-fg-subtle`
3. 元素是表头 `<th>`、时间戳、计数、单位、标签名（`dt`、`label` 之外的小标题） → `text-fg-subtle`
4. 其它（描述段落、说明文字、`text-sm` 的次要句子） → `text-fg-muted`

### 2.6 原始色板 → tone（迁移用，机械替换）

现有代码里大约有 1,330 处 `text-amber-700` 这样的原始色板。替换分两步，先定 tone，再定用法。

**第一步：色相 → tone**

| 原始色相 | tone |
|---|---|
| `red` `rose` | `danger` |
| `amber` `yellow` | `warning` |
| `emerald` `green` `lime` `teal` | `success` |
| `sky` `blue` `cyan` | `info` |
| `indigo` | `brand` |
| `violet` `purple` `fuchsia` `pink` | `violet` |
| `orange` | `orange` |
| `slate` `gray` `zinc` `neutral` `stone` | 中性：按第二步的中性列 |

例外，**按含义覆盖色相**。这一条比上表优先：

- 元素表达的是「主操作 / 选中 / 链接」（例如选中的筛选芯片用了 `bg-sky-100`）→ `brand`
- 元素表达的是评测结果 → 删掉手写颜色，改用 `<Verdict>`（§7.1）
- 元素表达的是难度 → 改用 `<Difficulty>`（§7.2）
- 元素表达的是比赛/考试状态 → 改用 `<StatusDot>` + 文字（§7.4）
- 纯装饰（渐变头图、彩色图标底、「好看」的彩色卡片） → **删掉颜色**，用中性样式

**第二步：属性 + 色阶 → 工具类**

| 原始类 | 有彩 tone 的结果 | 中性的结果 |
|---|---|---|
| `text-*-400` ~ `text-*-900` | `text-{tone}-fg` | 400–500 → `text-fg-subtle`；600–700 → `text-fg-muted`；800–950 → `text-fg` |
| `bg-*-50` ~ `bg-*-200` | `bg-{tone}-soft` | 50–100 → `bg-surface-sunken`；200 → `bg-surface-active` |
| `bg-*-300` ~ `bg-*-400` | `bg-{tone}-soft` | `bg-surface-active` |
| `bg-*-500` ~ `bg-*-700` | `bg-{tone}`，并把同元素文字改成 `text-on-{tone}` | `bg-fg text-bg`（仅限反色小块，例如 tooltip、当前页码） |
| `bg-*-800` ~ `bg-*-950` | 删除，改 `bg-{tone}-soft` | `bg-surface-sunken` |
| `border-*-100` ~ `border-*-400` | `border-{tone}-line` | `border-line` |
| `border-*-500` ~ `border-*-700` | `border-{tone}`（只限选中/焦点态）；否则 `border-{tone}-line` | `border-line-strong` |
| `ring-*-*` | `ring-ring` | `ring-ring` |
| `fill-*` / `stroke-*` | `fill-current` / `stroke-current`，并在外层设 `text-{tone}-fg` | 同左，配 `text-fg-subtle` |
| `from-*` `via-*` `to-*`（渐变） | 删除渐变，按 §1 原则 2 改成纯色或中性 | 同左 |
| `bg-*-500/10` 这类带透明度的 | `bg-{tone}-soft` | `bg-surface-active` |

**第三步：删除所有 `dark:` 变体。** token 会自动切换暗色。迁移后的文件里不应再有任何 `dark:`（门禁 DS010）。

### 2.7 字体

```css
--font-sans: 'Mona Sans Variable', 'PingFang SC', 'HarmonyOS Sans SC', 'Microsoft YaHei UI',
  'Microsoft YaHei', 'Noto Sans CJK SC', 'Source Han Sans SC', system-ui, sans-serif;
--font-mono: 'JetBrains Mono Variable', ui-monospace, 'SF Mono', Menlo, Consolas,
  'Noto Sans Mono CJK SC', monospace;
```

- 拉丁字体只打包 latin 子集的可变字重 woff2，放在 `src/assets/fonts/` 下，随 Vite 构建产出，**不访问任何 CDN**（`oj` 主机断网）。
- 中文永远由系统字体渲染。**禁止**打包中文字体。
- `font-feature-settings: 'cv11', 'ss03'` 已在 `html` 上全局设置，组件里不要再设。
- 代码、样例、题号（`P1001`）、Record ID、哈希、等宽对齐的数字用 `font-mono`。

### 2.8 字号阶梯

基准 `--fs-md = 14px`。**只有下面这些字号存在。** `text-base`、`text-4xl` 及以上、`text-[…]` 全部禁止（DS009）。

| 工具类 | px | 行高 | 字重 | 唯一用途 |
|---|---|---|---|---|
| `text-3xl` | 30 | 1.15 | 600，`tracking-tight` | 大屏数字：倒计时、仪表盘主数字、榜单投影模式的排名 |
| `text-2xl` | 24 | 1.25 | 600，`tracking-tight` | **页面标题，每页最多一个**，只出现在 `PageHeader` 里（≥ `sm`） |
| `text-xl` | 20 | 1.3 | 600，`tracking-tight` | 手机上的页面标题（`PageHeader` 自动处理）；Section 标题 |
| `text-lg` | 16 | 1.45 | 600 | Dialog 标题；题面里的「题目描述 / 输入格式」小标题；区块标题 |
| `text-md` | 14 | 1.55 | 400 | 正文、题面段落、表单输入值（`lg` 尺寸）、侧栏导航项与侧栏字标 |
| `text-sm` | 13 | 1.5 | 400 / 500 | 表格单元格、按钮、输入框、菜单项、描述文字 |
| `text-xs` | 12 | 1.5 | 400 / 500 | 元信息、提示、表头、徽标、时间戳、侧栏分组 |
| `text-2xs` | 11 | 1.4 | 500 / 600 | 小号徽标、`Kbd`、英文 overline（配 `uppercase tracking-wider`） |

字重只用 400（默认）、500（`font-medium`）、600（`font-semibold`）、700（`font-bold`，只给 Logo 和榜单排名）。**禁止** `font-light`、`font-extrabold`、`font-black`。

数字：所有会对齐或会变化的数字（表格数字列、分数、时间、计数、倒计时、内存、用时、排名）**必须**加 `tabular` 工具类。

中文排版：

- 标题用 `text-balance`，长段落用 `text-pretty`。
- 正文段落最大宽度 `max-w-prose`（≈ 65 个中文字符）。题面在 `prose` 宽度的容器里。
- **禁止** `uppercase` 作用于中文。`uppercase tracking-wider` 只给英文 overline。
- **禁止** `italic` 作用于中文。数学变量的斜体由 KaTeX 负责。

### 2.9 间距

4px 网格。只用 Tailwind 的数值间距类，并且只用下表里的档位。**禁止**任意值 `p-[13px]`（DS004）。

| 场景 | 值 | 写法 |
|---|---|---|
| 图标与文字之间 | 6px | `gap-1.5` |
| 按钮组、徽标组、工具栏里的控件之间 | 8px | `gap-2` |
| 表单字段之间（纵向） | 20px | `gap-5` |
| 表单内 label 与控件 | 6px | `gap-1.5`（由 `Field` 提供） |
| 卡片/面板内边距 | 16px | `p-4`（由 `Panel` 提供） |
| 对话框内边距 | 水平 20px | `px-5`（由 `Dialog` 提供） |
| 同一页面的区块之间 | 24px；`short` 视口 16px | 由 `Page` 提供 `gap-6 short:gap-4` |
| 页面左右边距 | 16 / 24 / 32px | 由 `Page` 提供 `px-4 sm:px-6 lg:px-8` |
| 栅格卡片之间 | 16px | `gap-4` |
| 行内元信息之间 | 横 16px、纵 6px | `gap-x-4 gap-y-1.5` |

允许出现的间距数值：`0 0.5 1 1.5 2 2.5 3 3.5 4 5 6 8 10 12 16 20 24`。出现 `7`、`9`、`11`、`14` 这类档位，说明在凑像素，审查打回。

### 2.10 圆角

| 工具类 | 值 | 唯一用途 |
|---|---|---|
| `rounded-sm` | 5px | 徽标、`Kbd`、复选框、菜单项、分段控件内块、行内 `code` |
| `rounded-md` | 7px | 按钮、输入框、选择框、提示气泡、样例框、代码块 |
| `rounded-lg` | 11px | 卡片、`Panel`、Alert、Popover、Menu、Toast |
| `rounded-xl` | 14px | Dialog、底部抽屉顶边 |
| `rounded-full` | — | 头像、状态点、开关、进度条、滑块 |
| `rounded-none` | 0 | 按钮组内部、表格单元格 |

**禁止** `rounded`（不带尺寸）、`rounded-2xl`、`rounded-3xl`、`rounded-[…]`（DS012）。

### 2.11 阴影与层级

| 工具类 | 用途 |
|---|---|
| `shadow-xs` | 静止的控件和卡片：按钮（secondary/primary）、输入框、`Panel` |
| `shadow-sm` | 悬停中的可点击卡片；分段控件的滑块 |
| `shadow-pop` | 所有浮层：Dialog、Sheet、Popover、Menu、Select 下拉、Toast |
| `shadow-none` | 去掉组件默认阴影 |

**禁止** `shadow-md/lg/xl/2xl/inner`（DS011）、彩色阴影、`drop-shadow-*`。

z-index 只有这些值，**禁止** `z-[…]`（DS007）：

| 值 | 层 |
|---|---|
| `z-10` | 吸顶表头、sticky 列 |
| `z-20` | 页面内吸顶工具栏 |
| `z-30` | AppShell 顶栏 |
| `z-40` | 移动端侧栏抽屉 |
| `z-50` | Dialog、Sheet、Popover、Menu、Select |
| `z-60` | Tooltip |
| `z-70` | Toast |

### 2.12 透明度

- 禁用态：`disabled:opacity-45`（由组件提供）。
- `bg-surface-sunken/60`、`bg-brand-soft/60` 是仅有的两个允许的背景透明度写法（面板页脚、选中行）。
- **禁止**对文字使用透明度（`text-fg/60`、`opacity-70` 包住文字）。用 `fg-muted` / `fg-subtle`。

---

## 3. 动效

### 3.1 Token

| token | 默认 | 用途 |
|---|---|---|
| `--dur-1` | 100ms | 悬停、按下、颜色变化 |
| `--dur-2` | 160ms | 开关、选中、复选、**所有离场** |
| `--dur-3` | 240ms | 浮层入场、展开 |
| `--dur-4` | 360ms | 大面板（Sheet）、进度条、布局变化 |
| `--ease-out` | `cubic-bezier(0.16, 1, 0.3, 1)` | 入场 |
| `--ease-in` | `cubic-bezier(0.55, 0, 1, 0.45)` | 离场 |
| `--ease-standard` | `cubic-bezier(0.2, 0, 0, 1)` | 状态切换（同一元素从 A 变 B） |
| spring | stiffness 560 / damping 42 / mass 0.7 | 跟随指针或在兄弟之间滑动：页签下划线、分段控件滑块、开关圆点 |

CSS 里写 `duration-(--dur-2) ease-(--ease-out)`。JS（`motion/react`）里**必须**使用 `useMotionTokens()`（§6.1），它返回 `enter` / `exit` / `state` / `spring` 四个 transition 对象。**禁止**在 TSX 里写数字时长：`duration: 0.3`、`duration-300`、`delay-150` 都不行（DS006）。

### 3.2 每个组件动什么

| 组件 | 入场 | 离场 | 属性 |
|---|---|---|---|
| 按钮 | — | — | 悬停变色 `dur-1`；按下 `scale(.97)` `dur-1` |
| 输入框 | — | — | 边框色 + 焦点环 `dur-1` |
| 复选框 | — | — | 勾的描边绘制 `dur-2 ease-out` |
| 单选 | — | — | 圆点 `scale 0→1` `dur-2 ease-out` |
| 开关 | — | — | 圆点位移，spring |
| 分段控件 / 页签 | — | — | 选中块或下划线 `layoutId` 滑动，spring |
| Select / Menu / Popover | `opacity 0→1`、`scale .96→1`，`enter`，以触发器为变换原点 | `opacity→0`、`scale→.98`，`exit` | |
| Tooltip | 延迟 450ms 后 `opacity` + 3px 位移，`enter × 0.6` | 立即 `opacity→0` | 聚焦时无延迟 |
| Dialog（≥ sm） | 遮罩 `opacity`；面板 `opacity` + `scale .97→1` + `y 8→0`，`enter` | 反向，`exit` | |
| Dialog（< sm） | 面板 `y 100%→0`，`enter` | 反向，`exit` | 底部抽屉 |
| Sheet | `x 100%→0`，`enter × 1.25` | 反向，`exit` | |
| 移动端侧栏抽屉 | `x -100%→0`，`enter` | 反向，`exit` | |
| Toast | `y 16→0` + `opacity` + `scale .98→1`，`enter`；堆叠位移 `layout` spring | `opacity` + `scale→.98`，`exit` | |
| 进度条 | — | — | `width` 过渡 `dur-4 ease-out` |
| AppShell 侧栏折叠 | — | — | `width 56↔240`，`state` |
| 骨架屏 | 单条高光从右向左扫过，周期 `dur-4 × 4` | — | 禁止整块脉冲 |
| 实时状态点 | 光晕 `opacity` 脉冲，1.6s | — | 只用于「正在发生」：评测中、进行中、在线 |

### 3.3 禁止

- 页面、卡片、列表项的入场动画；stagger；滚动触发动画（`whileInView`）。
- 悬停时元素位移或放大（`hover:-translate-y-*`、`hover:scale-*`）。可点击卡片悬停只允许 `border-line-strong` + `shadow-sm`。
- 动画 `width` / `height` / `top` / `left` / `margin`。例外只有两个：进度条宽度、AppShell 侧栏宽度。
- 无限循环动画。例外：`Spinner`、骨架屏高光、实时状态点。
- 弹跳（`damping` < 30 的 spring）、`ease-in-out` 的入场、超过 400ms 的任何过渡。
- `backdrop-blur-*`（DS013）。遮罩是纯色 `bg-scrim`。

### 3.4 减少动态

`prefers-reduced-motion: reduce` 时，`--dur-*` 全部为 `0ms`，骨架屏停止扫光，`<MotionConfig reducedMotion="user">` 让 `motion/react` 只保留透明度变化。新组件**必须**在这两种设置下都能用：不能依赖 `animationend` / `transitionend` 事件去卸载元素。

### 3.5 加载态时间阈值

| 等待时长 | 显示 |
|---|---|
| < 300ms | 什么都不显示（不闪 spinner） |
| 300ms – 1s | 触发按钮进入 `loading`（按钮内 spinner，宽度不变） |
| > 1s 且是首屏数据 | `Skeleton`，形状与最终内容一致 |
| > 1s 且是后台刷新 | 保留旧数据，在 Panel 头部放 `Spinner className="size-3.5 text-fg-subtle"` |

---

## 4. 响应式

### 4.1 断点（只有这 7 个）

写法：**移动优先**。无前缀 = 手机，往上逐级覆盖。

| 前缀 | 条件 | 典型设备 | 发生什么 |
|---|---|---|---|
| （无） | < 640px | 手机 | 单列；侧栏收进抽屉；Dialog 变底部抽屉；`DataTable` 转卡片；分页变 `‹ 3 / 12 ›`；页面边距 16 |
| `sm:` | ≥ 640px | 大屏手机、小平板 | `PageHeader` 操作区回到标题右侧；`FormField inline` 生效；边距 24 |
| `md:` | ≥ 768px | 平板竖屏 | `DataTable` 回到表格；Sheet 变 448px 侧板 |
| `lg:` | ≥ 1024px | 平板横屏、小笔记本 | 侧栏常驻；题目页左右分栏；边距 32 |
| `xl:` | ≥ 1280px | 笔记本、机房 1366 | 侧栏默认展开 240px；三栏布局生效 |
| `3xl:` | ≥ 1920px | 投影、大屏 | 只给榜单和监考墙：字号放大一档、可显示更多列 |
| `short:` | 高 ≤ 800px | 1366×768 机房 | 顶栏 44px；页面上边距和区块间距收紧；考试计时条贴顶 |

**禁止** `max-sm:` 等 `max-*` 变体、`2xl:`、`min-[…]:` / `max-[…]:` 任意断点、组件里手写 `@media`。确实需要 JS 判断时，用 `useMediaQuery('(min-width: 1024px)')`，且只能用上表里的阈值。

### 4.2 内容宽度（由 `Page width` 决定，禁止手写 `max-w-*`）

| `width` | 最大宽度 | 用于 |
|---|---|---|
| `prose` | 46rem | 阅读：题面（窄屏时）、公告、博客、Wiki、讨论帖 |
| `form` | 56rem | 编辑一样东西：设置、创建/编辑表单 |
| `wide`（默认） | 80rem | 列表、仪表盘、个人主页 |
| `full` | 无上限 | 工作区：IDE、监考墙、座位图、榜单、思维导图画布 |

### 4.3 每种结构在各视口的行为

| 结构 | < sm | sm–md | md–lg | ≥ lg |
|---|---|---|---|---|
| AppShell 侧栏 | 隐藏，汉堡按钮开抽屉（宽 288px，最大 85vw） | 同左 | 同左 | 常驻；lg–xl 默认 56px 图标轨，≥ xl 默认 240px；用户切换后记住 |
| PageHeader | 标题 `text-xl`；操作按钮换行到标题下方 | 标题 `text-2xl`；操作在右 | 同左 | 同左 |
| Toolbar | 搜索框占满一行，其它控件换行 | 搜索 `sm:w-72` | 同左 | 同左 |
| DataTable `stack` | 卡片列表 | 卡片列表 | 表格；`hideBelow` 的列隐藏 | 表格 |
| DataTable `scroll` | 横向滚动，前 1–2 列 sticky | 同左 | 同左 | 同左 |
| Dialog | 底部抽屉，按钮纵向堆叠并占满宽度 | 居中模态 | 同左 | 同左 |
| Sheet | 全屏 | 全屏 | 右侧 448px（`lg` 尺寸 672px） | 同左 |
| 详情页分栏（题目+编辑器） | 纵向：题面在上，编辑器在下 | 同左 | 同左 | 左右各 50%，各自滚动 |
| 表单 `FormField inline` | label 在上 | label 左 14rem，控件右 | 同左 | 同左 |
| 统计 `Stat` 行 | 2 列 | 2 列 | 4 列，竖线分隔 | 4 列 |
| 卡片栅格 | 1 列 | 2 列 | 2 列 | 3 列（`wide`）；4 列只在 `xl` 且卡片 ≤ 18rem |
| Pagination | `‹ 3 / 12 ›` | 页码 | 页码 + 左侧汇总 | 同左 |
| Toast | 底部居中，满宽减 24px | 右下，最大 384px | 同左 | 同左 |

### 4.4 触控与安全区

- 小于 `sm` 时，可点击的列表行高度 ≥ 44px（`DataTable` 卡片、菜单项已满足）。
- 页面主操作在小于 `sm` 时允许 `w-full`。
- 固定在底部的元素（Dialog 底部抽屉、Sheet 页脚、Toast）必须加 `pb-[max(.75rem,env(safe-area-inset-bottom))]`。这是唯一允许的任意值写法，组件已内置，页面里不要再写。
- **禁止**在页面里写固定底栏（`fixed bottom-0`）。考试作答区例外，见 §7.6。

### 4.5 短屏（`short:`，1366×768 机房）

1366×768 的浏览器去掉标签栏和地址栏后，可视高度约 640px。规则：

- AppShell 顶栏 `short:h-11`；`Page` 上边距 `short:pt-4`、区块间距 `short:gap-4`，均由组件提供。
- 考试壳和 IDE 在短屏下**禁止**出现两层以上的固定头部。计时条与题目导航必须合并成一条。
- 工作区（`width="full"`）的面板高度用 `h-full min-h-0 flex-1`，**禁止** `h-[600px]`、`max-h-[70vh]` 这类写死的高度。

### 4.6 滚动

- **全站不出现原生滚动条样式。** `styles.css` 全局把 WebKit/Blink 滚动条改成 10px 透明轨道 + 4px 圆角滑块（悬停 6px），Firefox 用 `scrollbar-width: thin` + token 颜色。页面里**禁止**再写 `::-webkit-scrollbar`、`scrollbar-width`，**禁止**再引用 `krypton-scrollbar` 类。
- 横向滚动的页签行、芯片行、筛选行加 `scrollbar-none`，完全隐藏滚动条。
- `overflow-x-auto` 会连带把 `overflow-y` 变成 `auto`。所以在横向滚动容器里，**禁止**让任何子元素用负偏移（`-bottom-px` 之类）伸出容器，否则会冒出纵向滚动条。需要贴底的指示线放在容器内部 `bottom-0`，并给容器加 `overflow-y-hidden`。
- 可滚动区域在 flex 布局里必须 `min-h-0`（纵向）或 `min-w-0`（横向），否则不会形成滚动上下文（CLAUDE.md 坑 15）。
- 浮层中的下拉一律 portal（坑 13、16）。不要在带 `transform` 的祖先里写 `fixed inset-0`。

---

## 5. 页面原型

每个页面**必须**归入下列原型之一，并按骨架搭建。迁移 lane 会在 PLAN 里写明每个文件的原型。

### 5.1 A 列表页（题库、比赛列表、提交记录、用户管理…）

```tsx
<Page width="wide">
  <PageHeader
    title="题库"
    description="1,184 道题目，覆盖入门到省选。"   // 可选，一句话
    actions={<>
      <Button>次要操作</Button>
      <Button variant="primary"><Plus />新建题目</Button>   // primary 最多一个
    </>}
    tabs={<PageTabs …/>}                                     // 可选：同一列表的不同视图
  />
  <Toolbar end={<span className="text-sm text-fg-subtle">汇总信息</span>}>
    <SearchInput className="w-full sm:w-72" …/>
    <SimpleSelect className="w-32" …/>
  </Toolbar>
  <Panel flush footer={<Pagination current={page} total={pages} baseUrl={url} summary="第 1–12 题，共 1,184 题" />}>
    <DataTable mobile="stack" …/>
  </Panel>
</Page>
```

- 列表为空：`DataTable` 的 `empty` 槽放 `EmptyState`。筛选后为空用「没有匹配的…」+「清除筛选」按钮；本来就没有数据用「还没有…」+ 主操作。
- 批量操作：表格选中后，批量按钮出现在 `Panel` 的 `actions`，`Panel description` 显示「已选 N 项」。

### 5.2 B 详情页（题目、比赛详情、提交详情、用户主页…）

```tsx
<Page width="wide">                  // 题面类阅读内容用 prose
  <PageHeader
    breadcrumb={<Breadcrumb items={[…]} />}
    title="最短路计数"
    meta={<><Difficulty level={4} /><span className="tabular">1000 ms · 256 MiB</span></>}
    actions={…}
    tabs={<PageTabs …/>}
  />
  {/* 主体：单列，或 lg 起 2 栏（主内容 + 320px 侧栏） */}
  <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
    <div className="flex min-w-0 flex-col gap-6">…</div>
    <aside className="flex flex-col gap-4">…</aside>
  </div>
</Page>
```

### 5.3 C 表单页（设置、创建、编辑）

```tsx
<Page width="form">
  <PageHeader title="域设置" description="…" />
  <Panel title="基本信息" footer={<div className="flex justify-end gap-2"><Button>取消</Button><Button variant="primary">保存</Button></div>}>
    <div className="flex flex-col gap-5">
      <FormField inline label="域名称" required><Input …/></FormField>
    </div>
  </Panel>
  <Panel title="评测">
    <div className="flex flex-col divide-y divide-line-subtle">
      <div className="pb-4"><FormField inline label="允许自测" hint="…"><Switch …/></FormField></div>
      <div className="pt-4">…</div>
    </div>
  </Panel>
</Page>
```

- 即时生效的设置（开关）不需要保存按钮；需要提交的分组在 `Panel footer` 放「取消 / 保存」，右对齐，保存是 primary。
- 危险设置（删除、重置）放在页面最后一个 `Panel`，标题「危险操作」，按钮 `variant="danger-soft"`，点击打开确认 Dialog（§6.20）。

### 5.4 D 工作区（题目+编辑器、IDE、监考墙、座位图、思维导图、榜单）

```tsx
<Workspace>                                              {/* 工作区不用 Page；高度 = 视口减去壳层顶栏与横幅 */}
  <Toolbar …/>                                           {/* 紧凑形态：h-10，border-b border-line，bg-surface，px-2 */}
  <div className="grid min-h-0 flex-1 lg:grid-cols-2">
    <section className="min-h-0 overflow-y-auto border-line lg:border-r">…</section>
    <section className="min-h-0 overflow-hidden">…</section>
  </div>
</Workspace>
```

- 工作区的工具条用 `Toolbar` 的紧凑形态：控件 `size="sm"`，高度 40px，`border-b border-line bg-surface px-2`。
- 面板之间用 1px `border-line` 分隔，**不**用间隙加卡片。
- 榜单是唯一允许 `width="full"` 同时使用 `PageHeader` 的工作区。

### 5.5 E 仪表盘（首页、统计、管理首页）

- 第一行：`Stat` 行（最多 4 个），放在一个 `Panel` 里。
- 其下：`grid gap-4 lg:grid-cols-2` 或 `xl:grid-cols-3` 的 `Panel` 栅格，每个 Panel 都有 `title`。
- **禁止**彩色大色块的统计卡、渐变头图、插画。

### 5.6 F 考试壳（Exam Mode、考试作答、团队考试）

见 §7.6。由 `components/layout/exam-shell.tsx` 提供，不使用 AppShell。

### 5.7 G 独立页（登录、错误、客户端提示、sudo）

```tsx
<div className="grid min-h-dvh place-items-center bg-bg px-4 py-12">
  <div className="flex w-full max-w-sm flex-col gap-6">
    <Logo />                                      {/* 居中 */}
    <PageHeader title="登录" description="…" />   {/* 页面唯一的 h1 */}
    <Panel>…表单…</Panel>
    <p className="text-center text-xs text-fg-subtle">…</p>
  </div>
</div>
```

独立页不使用 `Page`（它们不在 AppShell 里，自己居中），但**必须**用 `PageHeader` 提供标题。

错误页：`EmptyState` 放在居中容器里。图标用 lucide，标题说发生了什么，描述说用户能做什么，操作是「返回首页」/「重试」。

### 5.8 AppShell

由 `router.tsx` 的 `DefaultAppShell` 实现，结构与 playground 的 `AppShell` 一致：

- 侧栏底色 `bg-surface-sunken`，右边框 `border-line`。顶部 Logo 区高 48px。
- 导航项用 `NavItem`：高 `--row-h`（40px），字号 `text-md`，图标 `size-5`（与侧栏字标同一档）。选中态 `bg-surface-active font-medium text-fg`；**禁止**左侧色条、品牌色文字、品牌色底。
- 分组名：`text-xs font-semibold text-fg-subtle`。英文 overline 才加 `uppercase tracking-wider`，中文分组名不加。
- 顶栏高 48px（`short:` 44px），`bg-bg border-b border-line`，**不透明，不模糊**。
- 壳层根元素用 `ResizeObserver` 测量「顶栏 + 横幅」的总高度 H，并设置 `style={{ '--workspace-h': `calc(100dvh - ${H}px)` }}`，供 `Workspace` 使用。左侧是移动端汉堡按钮 + 页面级搜索入口（如有），右侧是通知、主题切换、头像菜单。
- 主题切换是三态：亮 / 暗 / 跟随系统（§6.2）。

---

## 6. 组件目录

> 本章是所有 lane 的**接口契约**。签名照抄，不要「改进」。
> 所有组件都在 `src/components/ui/`，从 `@/components/ui/<file>` 导入。
> 「兼容」列出的是迁移期保留的旧写法：现有页面可以继续编译，但**被迁移的文件必须只用「规范」写法**。兼容写法在收尾阶段删除。

### 6.1 `motion.ts` — 动效 token 的 JS 镜像

```ts
export const EASE_OUT: readonly [number, number, number, number];      // [0.16, 1, 0.3, 1]
export const EASE_IN: readonly [number, number, number, number];       // [0.55, 0, 1, 0.45]
export const EASE_STANDARD: readonly [number, number, number, number]; // [0.2, 0, 0, 1]
export interface MotionTokens {
  enter: { duration: number; ease: readonly number[] };   // 0.24s, EASE_OUT
  exit: { duration: number; ease: readonly number[] };    // 0.16s, EASE_IN
  state: { duration: number; ease: readonly number[] };   // 0.16s, EASE_STANDARD
  spring: { type: 'spring'; stiffness: 560; damping: 42; mass: 0.7 };
}
export const MOTION: MotionTokens;
export function useMotionTokens(): MotionTokens;   // 返回 MOTION；保留 hook 形态以便将来接入设置
```

- 所有 `motion/react` 的 `transition` 都必须来自这里。
- `<MotionConfig reducedMotion="user">` 由 `main.tsx` 在根部包一次，组件里不要再包。

### 6.2 `src/lib/theme.ts` — 三态主题

```ts
export type ThemePreference = 'light' | 'dark' | 'system';
export const THEME_STORAGE_KEY = 'krypton:theme';
export function readThemePreference(serverTheme?: string): ThemePreference;
//   localStorage 里是 'light' | 'dark' | 'system' → 原样返回
//   没有或非法 → serverTheme === 'dark' ? 'dark' : 'system'
//   localStorage 抛错 → 同「没有」
export function resolveTheme(pref: ThemePreference, systemDark: boolean): 'light' | 'dark';
export function applyTheme(resolved: 'light' | 'dark'): void;
//   document.documentElement.classList.toggle('dark', resolved === 'dark')
//   并设置 <meta name="theme-color"> 为当前 --bg 的计算值（不存在则不处理）
export function writeThemePreference(pref: ThemePreference): void;  // 写 localStorage，吞掉存储异常
export function useThemePreference(serverTheme?: string): {
  preference: ThemePreference;
  resolved: 'light' | 'dark';
  setPreference(pref: ThemePreference): void;
};
//   挂载时 apply；preference === 'system' 时监听 matchMedia('(prefers-color-scheme: dark)') 的 change
export const THEME_BOOT_SCRIPT: string;
//   一段自执行 JS 字符串，内联在 index.html <head>，在 React 挂载前按同样规则设置 .dark，避免闪烁
```

- 全站**只有** `router.tsx` 和 `exam-shell.tsx` 调用 `useThemePreference`；其它地方要知道当前主题，继续用 `useColorMode()`。
- 主题切换控件是 `MiniTabs size="sm"`，三项：亮（`Sun`）、暗（`Moon`）、系统（`Monitor`），只显示图标，`aria-label` 分别为「亮色」「暗色」「跟随系统」。

### 6.3 `button.tsx` — Button

```ts
type ButtonVariant = 'primary' | 'secondary' | 'soft' | 'ghost' | 'danger' | 'danger-soft' | 'link'
  | 'default' | 'outline' | 'destructive';          // ← 兼容：default→primary，outline→secondary，destructive→danger
type ButtonSize = 'sm' | 'md' | 'lg'
  | 'default' | 'icon';                              // ← 兼容：default→md，icon→md + iconOnly
export interface ButtonProps extends React.ComponentProps<'button'> {
  variant?: ButtonVariant;   // 默认 'secondary'（兼容期：未传 variant 时仍渲染 primary 外观，见下）
  size?: ButtonSize;         // 默认 'md'
  iconOnly?: boolean;        // 正方形按钮；必须同时给 aria-label
  asChild?: boolean;
  loading?: boolean;         // 显示 Spinner、aria-busy、禁用点击、宽度不变
}
export function Button(props: ButtonProps): JSX.Element;
export const buttonVariants: (opts: { variant?: ButtonVariant; size?: ButtonSize; iconOnly?: boolean }) => string;
export function ButtonGroup(props: React.ComponentProps<'div'>): JSX.Element;  // role="group"，子按钮共享边框
```

**默认值的兼容规则**：旧代码大量写 `<Button>` 不带 variant 并期待实心主色。为了不让 134 个调用点同时变样，兼容期内「未传 `variant`」= `primary`。规范写法要求**总是显式写出 `variant`**，因此迁移后的文件里每个 `<Button` 都必须带 `variant=`。收尾阶段把默认值改为 `secondary`。

| variant | 外观 | 什么时候用 |
|---|---|---|
| `primary` | 品牌色实底，白字 | 本视图最重要的一个动作：新建、提交、保存、确认。**每个视图最多一个** |
| `secondary` | 白底、`border-line`、`shadow-xs` | 默认的普通动作：取消、导入、导出、编辑 |
| `soft` | `brand-soft` 底、`brand-fg` 字 | 正向但次要的动作：加入题单、关注、报名（列表行里的） |
| `ghost` | 无底，悬停 `surface-hover` | 工具栏、表格行内、图标按钮、对话框右上角关闭 |
| `danger` | 红色实底 | 确认对话框里的不可逆动作按钮。**页面上不直接放 danger 按钮** |
| `danger-soft` | `danger-soft` 底 | 页面上触发危险操作的入口（点击后弹确认） |
| `link` | 品牌色文字，悬停下划线 | 行内跳转：「查看全部 →」 |

| size | 高度 | 什么时候用 |
|---|---|---|
| `sm` | `--control-sm`（28px） | 表格行内、工作区工具栏、面板头部、`Toast` 里 |
| `md` | `--control-md`（34px） | 默认 |
| `lg` | `--control-lg`（40px） | 只用于：登录页主按钮、提交代码、考试交卷确认 |

- 图标放在文字前，作为第一个子元素，lucide 图标不需要写尺寸（按钮会设）。
- **禁止**在 `className` 里覆盖按钮的颜色、高度、圆角、内边距。需要的外观不在表里，就说明用错了 variant。允许的 `className` 只有：布局类（`w-full`、`sm:w-auto`、`ml-auto`、`shrink-0`、`self-start`）。

### 6.4 `input.tsx` — Input、SearchInput

```ts
export interface InputProps extends Omit<React.ComponentProps<'input'>, 'size'> {
  size?: 'sm' | 'md' | 'lg';     // 默认 'md'
  leading?: React.ReactNode;     // 左侧图标/前缀
  trailing?: React.ReactNode;    // 右侧单位/Kbd/按钮
  invalid?: boolean;             // 等价于 aria-invalid
}
export function Input(props: InputProps): JSX.Element;
export function SearchInput(props: InputProps & { shortcut?: string }): JSX.Element;  // type="search"，leading=Search 图标
```

- **DOM 兼容规则**：没有 `leading` 和 `trailing` 时，渲染**单个** `<input>`，`className`、`ref` 和其它属性都落在 `<input>` 上（与旧实现一致）。有 `leading` 或 `trailing` 时，渲染外层 `<div>` 外壳 + 内部 `<input>`：`className` 落在外壳上，`ref` 和其它属性落在 `<input>` 上。
- 数值输入：`type="number"` 时自动加 `tabular`。

### 6.5 `textarea.tsx` — Textarea

`forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes & { invalid?: boolean }>`；外观与 Input 一致，`min-h-20`，`resize-y`，`py-2 px-2.5 text-sm`。代码类文本域加 `className="font-mono"`。

### 6.6 `select.tsx` — SimpleSelect（规范）与 Select 复合组件

```ts
export type SimpleSelectOption =
  | { value: string; label: React.ReactNode; hint?: React.ReactNode; disabled?: boolean }   // hint 为新增：右侧灰字
  | { type: 'separator' }
  | { type: 'label'; label: React.ReactNode };
export interface SimpleSelectProps {
  options: SimpleSelectOption[];
  value?: string; defaultValue?: string; onValueChange?(v: string): void;
  name?: string; required?: boolean; disabled?: boolean; placeholder?: string;
  className?: string;            // 触发器
  contentClassName?: string;
  size?: 'sm' | 'md';            // 默认 'md'
  id?: string; ariaLabel?: string;
  invalid?: boolean;             // 新增
}
```

- 保留全部现有行为：`''` ↔ `'__EMPTY__'` 哨兵、自带 `<input type="hidden" name>`、`position="popper"`、宽度跟随触发器。
- 外观：触发器与 Input 一致；下拉用 §6.24 的浮层表面（`rounded-lg border-line bg-surface-raised shadow-pop p-1`），选项高 `--control-md`，悬停 `surface-hover`，选中项右侧 `Check` 图标 `text-brand-fg`。
- 层级：下拉 `z-50`（原 `z-[250]`）。

### 6.7 `multi-select.tsx` — MultiSelect

API 完全不变（见源码 `MultiSelectProps`）。换皮：外壳同 Input（`min-h` 由 `minHeight` 控制，默认 40 改为读 `--control-lg`），芯片用 `Badge variant="soft" tone="neutral"` 的外观 + 关闭按钮，下拉同 §6.6。层级 `z-50`（原 `z-250`）。保留「在 Dialog 内 portal 到 dialog root」和「吞掉遮罩点击」两个行为。

### 6.8 `datetime.tsx` — DateTime

API 不变。外观只加 `tabular`。规范：表格里用 `mode="relative"`（7 天内）或 `mode="datetime"`；详情页元信息用 `mode="both"`。

### 6.9 `checkbox.tsx` — Checkbox

```ts
export type CheckboxProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'size'> & {
  size?: 'sm' | 'md';
  indeterminate?: boolean;
  onCheckedChange?(checked: boolean): void;
  label?: React.ReactNode;        // 新增：有 label 时整体包在 <label> 里，点文字可切换
  description?: React.ReactNode;  // 新增：label 下方 xs subtle 文字
};
```

- 保留：原生 `<input type="checkbox">`（表单可提交）、`className` 落在外层 `<span>`、`onCheckedChange` 先于 `onChange`、`indeterminate` 设置 DOM 属性。
- 外观：16px（`sm` 14px）、`rounded-sm`、未选 `border-line-strong bg-surface shadow-xs`；选中 `bg-brand border-brand text-on-brand`，勾的描边用 `stroke-dashoffset` 过渡 `dur-2 ease-out`。

### 6.10 `radio-group.tsx` — RadioGroup / RadioGroupItem

API 不变（原生 radio，靠相同 `name` 分组）。外观：16px 圆，选中 `border-brand`，内点 `bg-brand` 从 `scale-0` 到 `scale-100`，`dur-2 ease-out`。`label` 文字 `text-sm text-fg`，`description` 文字 `text-xs text-fg-subtle`。

### 6.11 `switch.tsx` — Switch

API 不变（原生 checkbox + `role="switch"`）。外观：`md` 轨道 20×36、圆点 16；`sm` 轨道 16×28、圆点 12；关 `bg-line-strong`，开 `bg-brand`；圆点白色 `shadow-sm`，位移用 CSS `transition-transform duration-(--dur-2) ease-(--ease-out)`。

### 6.12 `mini-tabs.tsx` — MiniTabs（分段控件）

API 不变：`{ value, onValueChange?, items: { value, label, count?, icon?, href?, disabled? }[], size?: 'sm'|'md', fullWidth?, className?, 'aria-label'? }`。

- 外观：槽 `rounded-md bg-surface-active p-0.5`；选中块 `rounded-sm bg-surface shadow-sm`（暗色 `bg-surface-raised`），`layoutId` 滑动用 `MOTION.spring`。
- **用途**：同一组数据的显示方式或范围切换（列表/卡片、全部/本校、日/周/月），以及主题切换。**不要**用来做页面级导航，那是 `PageTabs`（§6.26）。

### 6.13 `form.tsx` — FormField、FormRow、FormSection

```ts
export function FormField(props: {
  label?: React.ReactNode; htmlFor?: string;
  required?: boolean;
  optional?: boolean;          // 新增：label 后显示「可选」
  hint?: React.ReactNode;      // error 存在时隐藏
  error?: React.ReactNode;     // role="alert"，text-xs text-danger-fg
  inline?: boolean;            // 新增：≥ sm 时 label 左（14rem）控件右；hint 移到 label 下
  children: React.ReactNode; className?: string;
}): JSX.Element;
export function FormRow(props: { columns?: 1 | 2 | 3 | 4; children; className? }): JSX.Element;   // 移动端单列，sm 起按 columns
export function FormSection(props: { title?; description?; children; className? }): JSX.Element;  // 一组字段；标题 text-sm font-semibold
```

- 规则：`required` 与 `optional` 不同时出现。一个表单里要么用 `*` 标必填，要么用「可选」标选填，选**少数派**来标（必填多就标可选）。
- `CardBody`（零引用）删除。

### 6.14 `badge.tsx` — Badge

```ts
export type BadgeTone = 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info' | 'violet' | 'orange';
export interface BadgeProps extends React.ComponentProps<'span'> {
  tone?: BadgeTone;                                   // 默认 'neutral'
  variant?: 'soft' | 'outline' | 'solid'              // 默认 'soft'
    | 'default' | 'secondary' | 'destructive';        // ← 兼容：default→brand soft，secondary→neutral soft，destructive→danger soft；
                                                      //   兼容的 'outline' 与规范 'outline' 同名同义（neutral outline）
  size?: 'sm' | 'md';                                 // 默认 'md'：h-5.5 text-xs；sm：h-4.5 text-2xs
  dot?: boolean;                                      // 前置 6px 状态点
}
```

- 渲染 `<span>`（原为 `<div>`）。
- 规则：`soft` 是默认；`outline` 只用于**分类**（难度、题型、语言）；`solid` 只用于**需要跳出来的计数**（未读数、侧栏「新」）。一个行内最多 3 个徽标，多了用「+N」。
- **禁止**用 `className` 给徽标上色。

### 6.15 `display.tsx` — Spinner、StatusDot、Kbd、Progress、Skeleton、Stat、Code

```ts
export function Spinner(props: React.ComponentProps<'svg'>): JSX.Element;   // 默认 size-4，颜色继承 currentColor
export function StatusDot(props: { tone?: BadgeTone; pulse?: boolean; className?: string }): JSX.Element;  // 8px
export function Kbd(props: React.ComponentProps<'kbd'>): JSX.Element;
export function Progress(props: { value: number; tone?: 'brand' | 'success' | 'warning' | 'danger'; size?: 'sm' | 'md'; className?: string }): JSX.Element;
export function Skeleton(props: { className?: string }): JSX.Element;      // 必须给出尺寸类，例如 "h-3 w-2/5"
export function Stat(props: { label: string; value: React.ReactNode; unit?: string; delta?: number; hint?: string }): JSX.Element;
export function Code(props: React.ComponentProps<'code'>): JSX.Element;    // 行内代码
```

实现照抄 `src/playground/kit/display.tsx` 中同名组件（`accent` 已改名 `brand`）。`Stat` 替代现有的 `StatCard` / `MetricCard` / `KpiCard` / `MetricTile` / `StatBlock` / `CompactStat` / `Stat`（局部）。

### 6.16 `avatar.tsx` — Avatar

API 不变（`Avatar` / `AvatarImage` / `AvatarFallback`）。换皮：`AvatarFallback` 底色 `bg-surface-active`、文字 `text-fg-muted font-medium`；外圈 `ring-2 ring-surface`（头像叠放时分隔）。尺寸继续由调用方 `className="size-8"` 控制，只允许 `size-5 size-6 size-8 size-10 size-11 size-16`。

### 6.17 `separator.tsx` — Separator

API 不变，颜色 `bg-line`。

### 6.18 `alert.tsx` — Alert（新增）

```ts
export function Alert(props: {
  tone?: 'info' | 'success' | 'warning' | 'danger' | 'neutral';   // 默认 'info'
  title?: React.ReactNode;
  children?: React.ReactNode;
  action?: React.ReactNode;       // 一组 size="sm" 的按钮
  onDismiss?: () => void;
  className?: string;
}): JSX.Element;
```

实现照抄 `src/playground/kit/feedback.tsx` 的 `Alert`。正文颜色永远是 `fg` / `fg-muted`，只有图标带 tone。替代所有手写的「黄底提示框」「红字错误框」。

### 6.19 `empty-state.tsx` — EmptyState（新增）

```ts
export function EmptyState(props: {
  icon?: React.ReactNode;          // 一个 lucide 图标元素
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  compact?: boolean;               // 面板内/侧栏里用：py-8
  className?: string;
}): JSX.Element;
```

实现照抄 `src/playground/kit/feedback.tsx` 的 `EmptyState`。

### 6.20 `dialog.tsx` — Dialog

API **全部不变**（`Dialog`、`DialogContent`、`DialogHeader`、`DialogTitle`、`DialogDescription`、`DialogBody`、`DialogFooter`、`DialogClose`、`markDialogSlot`、`alertDialog`、`confirmDialog`、`promptDialog`、`confirmFormSubmit`、`DialogHost`）。行为全部保留：slot 分区、form 提升、`onClose` 覆盖、`closeOnOverlayClick`、`inert` 堆栈、焦点陷阱与恢复、`data-krypton-dialog-root`、`data-scroll-owner="dialog"`。

只换皮和动效：

| 部位 | 规范 |
|---|---|
| 遮罩 | `bg-scrim`，无模糊；`opacity` 入场 `enter`、离场 `exit` |
| 面板 | `rounded-xl border border-line bg-surface-raised shadow-pop`；< sm 底部抽屉 `rounded-t-xl` + 顶部 36×4 拖拽条（装饰，不可拖） |
| 入场 | ≥ sm：`opacity 0→1`、`scale .97→1`、`y 8→0`，`MOTION.enter`；< sm：`y 100%→0` |
| Header | `px-5 pt-4 pb-3`；标题 `text-lg font-semibold tracking-tight`；描述 `mt-1 text-sm text-fg-muted` |
| Body | `px-5 pb-4`，滚动 |
| Footer | `border-t border-line-subtle bg-surface-sunken/60 px-5 py-3`；≥ sm 右对齐横排，< sm 纵向堆叠且按钮满宽；DOM 顺序保持「取消在前、主按钮在后」，用 `flex-col-reverse` 让主按钮显示在**上**、取消在下 |
| 关闭 X | `Button variant="ghost" size="sm" iconOnly` |
| 层级 | `z-50`（原 `z-200`） |
| 尺寸 | `sm/md/lg/xl/full` 不变 |

确认对话框规范：标题是问句并带对象名，描述写后果；`confirmDialog(msg, { destructive: true, confirmLabel: '删除' })`，按钮文字写动作，**禁止**「确定」。

### 6.21 `sheet.tsx` — Sheet

API 不变（`Sheet`、`SheetContent side`、`SheetHeader`、`SheetTitle`、`SheetBody`）。换皮：`bg-surface-raised shadow-pop`，左右侧宽度 < md 为 100%，≥ md 为 `md:max-w-md`（448px）；头部高 56px、`border-b border-line-subtle`；入场 `x 100%→0` 用 `enter × 1.25`。层级 `z-50`。

### 6.22 `toast.tsx` — Toast

API 不变（`toast.info/success/error/loading/dismiss`、事件名、同 id 替换、默认时长）。变化：

- 位置：< sm 底部居中满宽减 24px；≥ sm 右下角，宽 384px（原右上角 360px）。
- 外观：`rounded-lg border border-line bg-surface-raised shadow-pop p-3`，左侧 tone 图标，标题 `text-sm font-medium`，描述 `text-xs text-fg-muted`。
- **`ToastProvider` 幂等**：模块级计数，第一个挂载的 provider 渲染容器，其余的只渲染 children。`router.tsx` 与 `exam-shell.tsx` 的根部各挂一次。
- 层级 `z-70`（原 `z-[300]`）。

### 6.23 `tooltip.tsx` — Tooltip

复合 API 不变。新增便捷组件：

```ts
export function SimpleTooltip(props: { content: React.ReactNode; side?: 'top' | 'bottom' | 'left' | 'right'; children: React.ReactElement }): JSX.Element;
// = <Tooltip><TooltipTrigger asChild>{children}</TooltipTrigger><TooltipContent side={side}>{content}</TooltipContent></Tooltip>
```

外观：`rounded-md bg-fg px-2 py-1 text-xs font-medium text-bg shadow-sm`，最大宽 256px。默认延迟改为 450ms。层级 `z-60`。规则：只有图标的按钮**必须**有 tooltip 或可见文字；tooltip 里不放可交互内容。

### 6.24 `menu.tsx` — Popover、Menu（新增）

```ts
type Placement = 'bottom-start' | 'bottom-end' | 'bottom' | 'top';
export function Popover(props: {
  trigger: (p: { ref: React.Ref<HTMLButtonElement>; onClick(): void; 'aria-expanded': boolean }) => React.ReactNode;
  children: React.ReactNode | ((close: () => void) => React.ReactNode);
  placement?: Placement;       // 默认 'bottom-start'
  className?: string;          // 宽度、内边距
}): JSX.Element;
export interface MenuItem { label: React.ReactNode; icon?: React.ReactNode; shortcut?: string; danger?: boolean; disabled?: boolean; onSelect?(): void; href?: string }
export function Menu(props: {
  trigger: Popover['trigger'];
  items: (MenuItem | 'separator' | { group: string })[];
  placement?: Placement;       // 默认 'bottom-end'
  label?: string;              // aria-label
}): JSX.Element;
```

实现照抄 `src/playground/kit/overlay.tsx` 的 `Popover` / `Menu` / `useFloating` / `useDismiss`，另外：`href` 存在时菜单项渲染 `<a>`；浮层定位改用现有的 `calculateAnchoredPopoverBox`（`tooltip-position.ts`），不另写一份。层级 `z-50`。规则：一行 3 个以上的次要操作收进 `Menu`（触发器 `Button variant="ghost" size="sm" iconOnly` + `MoreHorizontal`）；危险项放最后，前面加 `'separator'`。

### 6.25 `page-tabs.tsx` — PageTabs（新增）

```ts
export interface PageTabItem<T extends string> { value: T; label: React.ReactNode; count?: number; icon?: React.ReactNode; href?: string }
export function PageTabs<T extends string>(props: {
  value: T; onValueChange?(v: T): void; items: PageTabItem<T>[]; className?: string; 'aria-label'?: string;
}): JSX.Element;
```

实现照抄 `src/playground/kit/nav.tsx` 的 `Tabs`（改名 `PageTabs`；`href` 存在时渲染 `<a>`）。只用在 `PageHeader` 的 `tabs` 槽里，或工作区顶部。删除零引用的旧 `tabs.tsx`；`tabs-compound.tsx`（1 处引用）保留到收尾阶段。

### 6.26 `breadcrumb.tsx` — Breadcrumb（新增）

`Breadcrumb({ items: { label: React.ReactNode; href?: string }[] })`。照抄 playground。只用在 `PageHeader` 的 `breadcrumb` 槽。最后一项是当前页，不可点。

### 6.27 `pagination.tsx` — Pagination

API 不变（`{ current, total, baseUrl }`，链接式）。新增可选 `summary?: React.ReactNode`。外观照抄 playground `Pagination`：< sm 显示 `‹ 3 / 12 ›`，≥ sm 显示页码（当前页 `bg-fg text-bg`）。修复：禁用的上一页/下一页渲染为不可点的 `<span aria-disabled>`，不是带 `disabled` 的 `<a>`。

### 6.28 `panel.tsx` — Panel、DescriptionList（新增）；`card.tsx`（兼容）

```ts
export function Panel(props: {
  title?: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode;
  children?: React.ReactNode; footer?: React.ReactNode;
  flush?: boolean;             // 无内边距，表格/列表贴边
  className?: string;          // 只允许布局类
  as?: 'section' | 'div';      // 默认 'section'
}): JSX.Element;
export function DescriptionList(props: { items: { term: React.ReactNode; detail: React.ReactNode }[]; columns?: 1 | 2 }): JSX.Element;
```

实现照抄 `src/playground/kit/data.tsx`。

`card.tsx` 的 `Card`/`CardHeader`/`CardTitle`/`CardDescription`/`CardContent`/`CardFooter` API 不变，换皮成与 `Panel` 一致的外观（`rounded-lg border-line bg-surface shadow-xs`；Header `px-4 pt-4 pb-2`；Content `p-4`；Title `text-sm font-semibold`）。**被迁移的文件必须把 Card 换成 Panel**：

| 旧 | 新 |
|---|---|
| `<Card><CardHeader><CardTitle>X</CardTitle><CardDescription>Y</CardDescription></CardHeader><CardContent>…</CardContent></Card>` | `<Panel title="X" description="Y">…</Panel>` |
| CardHeader 里还有按钮 | 按钮放进 `actions` |
| `<CardContent className="p-0">` 包表格 | `<Panel flush>` |
| `<CardFooter>` | `footer` |

### 6.29 `verdict.tsx` — Verdict、Difficulty、scoreTone（新增）

```ts
export interface StatusDisplay { label: string; short: string; tone: BadgeTone; live: 'none' | 'pulse' | 'spin' }
export const STATUS_DISPLAY: Record<number, StatusDisplay>;          // §7.1 表格，逐项照抄
export function statusDisplay(status: number, texts?: Record<string, string>): StatusDisplay;
//   未知 status → { label: `Status ${status}`, short: '?', tone: 'neutral', live: 'none' }
//   texts?.[String(status)] 是字符串时覆盖 label
export function Verdict(props: { status: number; texts?: Record<string, string>; compact?: boolean; score?: number; size?: 'md' | 'lg' }): JSX.Element;
export function scoreTone(score: number, full?: number): 'danger' | 'warning' | 'success';   // §7.1
export const DIFFICULTY_LEVELS: readonly { value: number; label: string; tone: BadgeTone }[];   // §7.2，0..10 共 11 项
export function Difficulty(props: { level: number | null | undefined }): JSX.Element;      // 越界或非数字按 0
```

### 6.30 `page.tsx` — Page、PageHeader、Toolbar（新增）

```ts
export const CONTENT_WIDTH: { prose: string; form: string; wide: string; full: string };
export function Page(props: { width?: 'prose' | 'form' | 'wide' | 'full'; children: React.ReactNode; className?: string }): JSX.Element;
export function PageHeader(props: {
  title: React.ReactNode; description?: React.ReactNode; breadcrumb?: React.ReactNode;
  meta?: React.ReactNode; actions?: React.ReactNode; tabs?: React.ReactNode;
}): JSX.Element;
export function Toolbar(props: { children: React.ReactNode; end?: React.ReactNode; className?: string }): JSX.Element;
export function Workspace(props: { children: React.ReactNode; className?: string }): JSX.Element;
// <div data-slot="workspace" className="flex h-(--workspace-h,calc(100dvh-3rem)) min-h-0 flex-col">
// --workspace-h 由 AppShell 根据顶栏与横幅的实测高度写在壳层根元素上（§5.8）。
```

- AppShell 的主区包裹层对 `data-slot="page"` 和 `data-slot="workspace"` 的直接子元素**不加**内边距（`has-[>[data-slot=page]]:p-0`），因此迁移后的页面边距完全由 `Page` 决定，未迁移的页面仍然得到壳层的旧内边距。

实现照抄 `src/playground/kit/layout.tsx`。`PageHeader` 的 `title` 渲染为 `<h1>`。**一个页面只有一个 `<h1>`**，并且只能来自 `PageHeader`。

- 使用 `Page` 时**必须**显式写 `width`，即使是默认的 `wide`。
- 被 `AdminPage` / `ModuleWorkspace` 包裹的页面**不得**再使用 `Page` 和 `PageHeader`，标题、描述、操作区通过 `AdminPage` 的 `title` / `description` / `actions` 传入。
- `Workspace` 页面没有 `PageHeader`。标题放在顶部 `Toolbar` 的最左侧，写成 `<span className="truncate text-sm font-semibold text-fg">`，**不用** `h1`。

### 6.31 `scroll-area.tsx` — ScrollArea

API 不变。换皮：滚动条滑块 `bg-[var(--scroll-thumb)]` → 用 token `--scroll-thumb` / `--scroll-thumb-hover`，宽 10px、内缩 3px、圆角；轨道透明。删除对 `krypton-scrollbar` 类的依赖。

### 6.32 `table.tsx`、`table-actions.tsx` — Table 系列

API 不变。换皮：

- `TableHead`：`h-9 bg-surface-sunken text-xs font-medium text-fg-subtle`，**去掉 `uppercase`**；`border-b border-line`。
- `TableRow`：`border-b border-line-subtle hover:bg-surface-hover`，`data-[state=selected]:bg-brand-soft/60`。
- `TableCell`：`comfortable` 高 `--row-h`，`compact` 高 32px；`text-sm text-fg`。
- `TableActions` / `TableAction`：`TableAction` 渲染为 `Button variant="ghost" size="sm"`（`variant="destructive"` → 文字 `text-danger-fg`；`variant="primary"` → `text-brand-fg`）；确认弹窗沿用现有逻辑。

### 6.33 `data-table.tsx` — DataTable（新增）

```ts
export type Breakpoint = 'sm' | 'md' | 'lg' | 'xl';
export interface Column<T> {
  key: string; header: React.ReactNode; cell(row: T): React.ReactNode;
  align?: 'left' | 'right' | 'center'; width?: string; hideBelow?: Breakpoint; sortable?: boolean;
  stackRole?: 'title' | 'meta' | 'row' | 'hidden';
}
export interface SortState { key: string; dir: 'asc' | 'desc' }
export function DataTable<T>(props: {
  columns: Column<T>[]; rows: T[]; rowKey(row: T): string;
  onRowClick?(row: T): void; rowHref?(row: T): string;      // rowHref：整行是链接（推荐，保留中键新开）
  sort?: SortState; onSort?(s: SortState): void;
  selected?: Set<string>; onSelectedChange?(s: Set<string>): void;
  mobile?: 'stack' | 'scroll';                                // 默认 'stack'
  loading?: boolean; empty?: React.ReactNode; stickyHeader?: boolean;
  rowProps?(row: T): Record<`data-${string}`, string>;        // 透传 data-* 钩子（迁移时保留旧 DOM 钩子）
}): JSX.Element;
```

实现照抄 `src/playground/kit/data.tsx` 的 `DataTable`，加上 `rowHref` 和 `rowProps`。

**选 DataTable 还是 Table 系列**：数据是「一组同类的东西」（题目、比赛、用户、记录），并且每行列数 ≤ 7 → `DataTable mobile="stack"`。数据本身就是二维表（榜单、成绩矩阵、测试点、权限矩阵）→ `DataTable mobile="scroll"`，或者在单元格复杂、需要合并单元格时用 `Table` 系列。

### 6.34 `echart.tsx`、`echart-theme.ts` — EChart

API 不变。`readEchartTheme()` 改为读取新 token：`--bg`、`--fg`、`--fg-subtle`、`--line`、`--brand-solid`、`--surface-raised`、`--chart-1..6`；缺失时仍然抛错。默认高度 `h-[220px]` 改为 `h-56`（224px）。轴线 `--line`，网格线 `--line-subtle`，文字 `--fg-subtle` 12px，tooltip `--surface-raised` + `--line` 边框 + `--shadow-pop`。

### 6.35 `media.ts` — useMediaQuery、BREAKPOINTS（新增）

```ts
export const BREAKPOINTS = { sm: 640, md: 768, lg: 1024, xl: 1280, '3xl': 1920 } as const;
export function useMediaQuery(query: string): boolean;     // 照抄 playground
export function useBreakpoint(bp: keyof typeof BREAKPOINTS): boolean;   // = useMediaQuery(`(min-width: ${BREAKPOINTS[bp]}px)`)
```

### 6.36 `src/lib/read-token.ts` — readToken（新增）

```ts
export function readToken(name: `--${string}`, fallback?: string): string;
// getComputedStyle(document.documentElement).getPropertyValue(name).trim()；空串时返回 fallback ?? ''。
// 只给 canvas、ECharts、图片导出这类无法使用 CSS 类的场景用。
```

### 6.37 `admin/`、`management/` — AdminPage、ModuleWorkspace、AdminSidebar、ForbiddenPanel

API 不变。变化：

- `AdminPage` 删除入场的 `motion.div` 淡入（§3.3）；`title` 为字符串时改为渲染 `PageHeader`；固定高度 `h-[calc(100dvh-…)]` 改为 `h-full min-h-0`，由 AppShell 主区提供高度（与 shell lane 同步）。
- `AdminSidebar`、`ModuleWorkspace` 的导航项用与 AppShell `NavItem` 相同的外观（§5.8）。
- `ForbiddenPanel` 改为 `EmptyState icon={<ShieldAlert />}`。

### 6.38 `cn.ts`

```ts
export function cn(...inputs: ClassValue[]): string;
// twMerge 必须扩展：theme.text 加入 '2xs','md'；theme.shadow 加入 'xs','pop'
```

否则 `cn('text-md', 'text-fg')` 会丢掉一个类。

---

## 7. OJ 专属模式

### 7.1 评测结果

唯一实现：`src/components/ui/verdict.tsx` 的 `STATUS_DISPLAY` 表和 `<Verdict status={n} />`。输入是 Hydro 的数字状态码（`@hydrooj/common` 的 `STATUS`）。页面**禁止**自行决定任何评测结果的颜色或文字，**禁止**再定义自己的 `STATUS_MAP`。

文字沿用现有 `records.tsx` 的 `STATUS_MAP` 文案，一个字都不改（§8 迁移不改文案）。

| status | label（原样保留） | short | tone | 指示 |
|---|---|---|---|---|
| 0 | 等待评测 | 等待 | neutral | 脉冲点 |
| 1 | Accepted | AC | success | 点 |
| 2 | Wrong Answer | WA | danger | 点 |
| 3 | Time Exceeded | TLE | warning | 点 |
| 4 | Memory Exceeded | MLE | warning | 点 |
| 5 | Output Exceeded | OLE | warning | 点 |
| 6 | Runtime Error | RE | violet | 点 |
| 7 | Compile Error | CE | orange | 点 |
| 8 | System Error | SE | neutral | 点 |
| 9 | Canceled | IGN | neutral | 点 |
| 10 | Unknown Error | UKE | danger | 点 |
| 11 | Hacked | HK | danger | 点 |
| 12 | 人工已评分 | MG | success | 点 |
| 20 | Running | 评测中 | info | Spinner |
| 21 | Compiling | 编译中 | info | Spinner |
| 22 | Fetched | 已取题 | info | Spinner |
| 30 | Ignored | IGN | neutral | 点 |
| 31 | Format Error | FE | danger | 点 |
| 32 | Hack Successful | HS | success | 点 |
| 33 | Hack Unsuccessful | HU | danger | 点 |
| 其它 | `Status ${n}` | `?` | neutral | 点 |

如果页面从服务端拿到了 `statusTexts`（本地化文案），把它传给 `<Verdict status={n} texts={statusTexts} />`，组件会优先使用其中的文字，但颜色仍由上表决定。

分数（IOI/OI、部分分）用 `scoreTone(score, full = 100)`：`score <= 0` → `danger`，`0 < score < full` → `warning`，`score >= full` → `success`。分数文字 `tabular font-semibold text-{tone}-fg`。

样式：行内是「状态点 + 文字 (+ 分数)」；表格的结果列用 `<Verdict status={n} compact />`（显示 short）；提交详情页头部用 `<Verdict status={n} size="lg" />`。

### 7.2 难度

唯一实现：`<Difficulty level={n} />`。标签和 tone 固定：

| level | 标签 | tone |
|---|---|---|
| 0 / 空 | 未评定 | neutral |
| 1 | 入门 | success |
| 2 | 普及− | info |
| 3 | 普及/提高− | info |
| 4 | 普及+/提高 | warning |
| 5 | 提高+/省选− | warning |
| 6 | 省选/NOI− | orange |
| 7 | 省选/NOI | orange |
| 8 | NOI/NOI+ | danger |
| 9 | NOI+/CTSC | danger |
| 10 | CTSC/IOI | violet |

渲染为 `Badge variant="outline" size="sm"`。现有的 `DIFFICULTY_OPTIONS`（`problem-edit.tsx`、`structured-problem-metadata-panel.tsx`）改为从 `verdict.tsx` 导入 `DIFFICULTY_LEVELS`，不再各自定义。

### 7.3 ACM 榜单单元格

| 状态 | 背景 | 文字 | 内容 |
|---|---|---|---|
| 通过 | `bg-success-soft` | `text-success-fg` | 第一行 `+` 或 `+n`（n = 罚时次数），第二行通过时间（分钟），`text-2xs` |
| 一血 | `bg-success` | `text-on-success` | 同上 |
| 尝试未通过 | `bg-danger-soft` | `text-danger-fg` | `−n` |
| 封榜后有提交 | `bg-info-soft` | `text-info-fg` | `?`，第二行 `n 次` |
| 未提交 | 无 | — | 空 |
| IOI / OI 分数 | 按分数比例：0 → `danger-soft`，(0,100) → `warning-soft`，100 → `success-soft` | 对应 `-fg` | 分数，`tabular font-semibold` |

所有单元格 `h-12 text-center tabular border-l border-line-subtle`。前两列（排名、队伍）`sticky left-0` + `bg-surface`。表格在所有视口都横向滚动（`mobile="scroll"`），不转卡片。

`scoreboardScoreColor()` 和图片导出（`lib/scoreboard-image-export.ts`）用于 canvas，无法读 Tailwind 类，因此通过 `readToken()`（§6.36）在运行时读取 `--success-solid` 等变量。现有返回 hex 的单测改为断言返回值等于对应 token 的计算值。

### 7.4 比赛 / 考试 / 作业状态

| 状态 | 表达 |
|---|---|
| 进行中 | `<StatusDot tone="success" pulse />` + 「进行中」 |
| 即将开始 | `<StatusDot tone="info" />` + 「即将开始」 |
| 已结束 | `<StatusDot />` + 「已结束」 |
| 封榜中 | `<Badge tone="info" dot>已封榜</Badge>` |
| 已归档 / 草稿 | `<Badge>草稿</Badge>` |

状态**禁止**通过改变整张卡片的背景色来表达。

### 7.5 样例、代码、题面

- 样例框：`rounded-md border border-line bg-surface-sunken`；头部 32px，左侧「输入 #1」`text-xs font-medium text-fg-muted`，右侧复制按钮；内容 `font-mono text-sm leading-relaxed`，横向滚动，不折行。输入/输出在 `sm` 起并排。
- 题面：`.krypton-prose` 改为只使用 token（§9.2 由 styles lane 实现）。题面最大宽度 `prose`。
- 代码高亮：删除 `highlight.js/styles/github.css`，由 `styles.css` 中基于 token 的 `.hljs-*` 规则替代，明暗两套自动切换。
- CodeMirror：`krypton-ide.tsx` 的主题改为读取 token 的 `EditorView.theme`，明暗两套；**禁止**继续使用 `@codemirror/theme-one-dark` 作为暗色主题。

### 7.6 考试壳

- 考试壳顶部只有一条 48px（`short:` 44px）的栏：左侧锁图标 + 「考试模式」+ 考试名，右侧剩余时间（`font-mono text-lg font-semibold tabular`）+ 交卷按钮（primary，`size="sm"`）。
- 剩余时间 > 5 分钟：`text-fg`；≤ 5 分钟：`text-warning-fg`；≤ 1 分钟：`text-danger-fg`。颜色切换不闪烁，不脉冲，不弹窗。
- 考试壳里**禁止**出现与考试无关的导航、通知、公告弹出。
- 考试壳不使用 AppShell 侧栏。题目导航放在左侧 240px 列（`lg` 起），小于 `lg` 时变成顶栏下方的横向滚动芯片行（`scrollbar-none`）。

---

## 8. 文案

- 界面语言是简体中文。按钮用动词开头：「新建题目」「保存」「删除比赛」；**禁止**「确定」「OK」作为危险操作按钮的文字，危险按钮必须写出动作和对象。
- 确认对话框：标题是一个问题，带对象名（「删除题目 P1001？」）；描述说后果和是否可恢复；按钮「取消」+「删除」。
- 错误：教师/管理员看到的错误主文案必须是完整中文句子；内部原因码（`snake_case`）只能出现在 `<details>` 或日志里。
- 空状态：标题说缺什么（「还没有提交记录」），描述说下一步（「选一道题开始吧」）。
- 数量用千分位：`1,184`。时间：`2026-10-02 14:32`；相对时间只用于 7 天内（「3 分钟前」「昨天」）。时长：`00:42:17`（`tabular`）。内存：`3.2 MiB`。用时：`128 ms`。
- 中英混排：中文与英文/数字之间**不**手动加空格（字体渲染已有间距），但单位前加空格：`128 ms`。
- 标点用全角：「，。：；？！」；括号内是英文时用半角括号。

**迁移规则：迁移 lane 禁止修改任何用户可见文案**，除非本条和 PLAN 明确要求（例如把「确定」改为具体动作）。

---

## 9. 可访问性

- 所有交互元素可键盘到达，焦点环统一为 `outline-2 outline-offset-2 outline-ring`（`:focus-visible`），组件已提供。**禁止** `outline-none` 而不提供替代焦点样式。
- 只有图标的按钮必须有 `aria-label`。
- `Dialog` / `Sheet`：`role="dialog" aria-modal`，打开时焦点进入，Esc 关闭，Tab 循环，关闭后焦点回到触发器。
- 表格可排序列头用 `<button>` 并设置 `aria-sort`。
- 颜色从不单独承载信息：评测结果有文字，状态点有文字，必填有 `*`，错误有文字。
- 动效遵守 §3.4。

### 9.2 `.krypton-prose`（题面、公告、博客的 Markdown）

- 段落 `text-md leading-relaxed text-fg`；`h1/h2` `text-lg font-semibold`，**不加下边框**；`h3–h6` `text-md font-semibold`。
- 链接 `text-brand-fg underline underline-offset-2 decoration-brand-line hover:decoration-current`。
- 行内代码 `rounded-sm bg-surface-active px-1 font-mono text-[.9em]`（`text-[.9em]` 是 prose 内唯一允许的任意值）。
- 代码块 `rounded-md border border-line bg-surface-sunken p-3 font-mono text-sm`，横向滚动。
- 表格 `text-sm`，表头 `bg-surface-sunken text-xs text-fg-subtle`，行线 `border-line-subtle`。
- 引用块 `border-l-2 border-line-strong pl-4 text-fg-muted`。
- 图片 `rounded-md`，最大宽度 100%。

---

## 10. 自动门禁（`scripts/design-gate.mjs`）

扫描范围：`src/**/*.{ts,tsx}`，排除 `src/playground/**`、`src/design/**`。

| 规则 | 禁止 | 适用范围 |
|---|---|---|
| DS001 | 原始色板类：`(bg|text|border|ring|outline|from|via|to|fill|stroke|divide|decoration|caret|accent|shadow|placeholder)-(red|…|stone)-\d+` | 全部 |
| DS002 | 旧 token 类：`*-(primary|secondary|muted|muted-foreground|accent|accent-foreground|destructive|card|popover|background|foreground|input|sidebar*)` | 全部 |
| DS003 | 颜色字面量：`#rgb` `#rrggbb` `rgb(` `rgba(` `hsl(` `hsla(` | 全部 |
| DS004 | 长度任意值：`-[12px]` `-[1.5rem]` `[calc(` | 除 `src/components/ui/**` |
| DS005 | 原生元素：`<button` `<select` `<textarea` `<table`，以及 `type` 不是 `hidden`/`file` 的 `<input` | 除 `src/components/ui/**` |
| DS006 | 数字时长：`duration-\d+` `delay-\d+` `duration: 0.3` `delay: 0.1` | 全部 |
| DS007 | 任意 z-index：`z-[…]` | 全部 |
| DS009 | 非阶梯字号：`text-base` `text-4xl`…`text-9xl` `text-[…]` | 全部 |
| DS010 | `dark:` 变体 | 除 `src/components/ui/**` |
| DS011 | `shadow-md/lg/xl/2xl/inner` | 全部 |
| DS012 | `rounded`（无尺寸）`rounded-2xl` `rounded-3xl` `rounded-[…]` | 全部 |
| DS013 | `backdrop-blur` | 全部 |
| DS014 | 渐变：`bg-gradient-*` `bg-linear-*` `bg-radial-*` `bg-conic-*` | 全部 |
| DS015 | 入场/悬停动画：`initial={{ opacity: 0` `initial={{ y:` `whileHover` `whileInView` `whileTap` | 除 `src/components/ui/**` |

### 10.1 豁免

在违规行的**上一行**或**同一行**写：

```tsx
{/* ds-allow DS003: canvas 导出无法读取 CSS 类，颜色来自 readToken() 的回退值 */}
```

- 格式固定：`ds-allow <规则号>: <中文原因>`，原因必须说明「为什么组件和 token 都做不到」。
- 一个注释只豁免一条规则、一行代码。
- 每个豁免都会在审查中被逐条检查。「方便」「暂时」「旧代码」都不是原因。

### 10.2 棘轮

- `design-gate.baseline.json` 记录每个文件、每条规则当前的违规数。
- `node scripts/design-gate.mjs`：任何文件的任何规则计数**高于**基线即失败；不在基线里的文件有任何违规即失败。
- `node scripts/design-gate.mjs --init`：基线文件不存在时按当前违规生成；已存在则报错退出。
- `node scripts/design-gate.mjs --file <path>`：只打印这个文件的违规（行号、规则、片段），不读基线，有违规时退出码 1。
- `node scripts/design-gate.mjs --update`：把基线下调到当前值。**只能下调**：发现任何上调就报错退出。
- 迁移 lane 完成后，它负责的文件必须从基线中**消失**（零违规）。
- 收尾阶段删除基线文件，门禁改为零容忍。

---

## 11. 迁移一个文件的标准步骤

worker 迁移任何文件都按这个顺序做，不要跳步。

1. 读本文 §1、§2.5、§2.6、§5 中该文件的原型、§6 中会用到的组件、§12 审查清单。
2. 运行 `node scripts/design-gate.mjs --file <path>`，拿到这个文件的违规清单（行号 + 规则）。
3. **结构替换**（先做，因为它会删掉大量手写样式）：
   - 页面标题区 → `PageHeader`；页面容器 → `Page`。
   - 手写卡片 `div.rounded-xl.border.bg-card…` → `Panel`。
   - 手写空状态 → `EmptyState`；手写提示条 → `Alert`。
   - 原生 `<button>` → `Button`（选对 variant，§6.3）；原生 `<input>` → `Input` / `Checkbox` / `Switch`；`<select>` → `SimpleSelect`；`<textarea>` → `Textarea`；`<table>` → `DataTable` 或 `Table` 系列（§6.32、§6.33）。
   - 手写评测结果 / 难度 / 状态 → `Verdict` / `Difficulty` / `StatusDot`。
   - 手写下拉菜单 → `Menu`；手写 tooltip（`title` 属性除外） → `Tooltip`。
   - `motion` 的 transition 字面量 → `useMotionTokens()`；页面入场动画 → 删除。
4. **颜色替换**：按 §2.5（旧 token）和 §2.6（原始色板）逐个机械替换，然后删掉所有 `dark:`。
5. **尺寸替换**：
   - `text-[11px]` → `text-2xs`；`text-[12px]` → `text-xs`；`text-[13px]` → `text-sm`；`text-base` → `text-md`；`text-[15px]`/`text-[16px]` → `text-lg`。其它值取最近档位，等距时取较小者。
   - `h-[36px]` 这类控件高度 → 删除，改用组件的 `size`。
   - `w-[…]`、`max-w-[…]` 布局宽度：内容宽度交给 `Page width`；侧栏宽度用 `w-60`（240px）、`w-72`（288px）、`w-80`（320px）；网格模板用 `grid-cols-[minmax(0,1fr)_20rem]`。这一条是 DS004 唯一的例外形态：`grid-cols-[…]` 里只允许出现 `rem` 和 `fr`，并且需要 `ds-allow DS004`。
   - 圆角、阴影按 §2.10 / §2.11 换。
6. 运行 `node scripts/design-gate.mjs --file <path>`，直到零违规（或者只剩带合格理由的豁免）。
7. 运行 PLAN 里列出的相关既有测试，必须全绿。现有测试断言了某个布局不变量（`min-h-0`、`overflow-y-auto`、portal），新代码必须继续满足。**禁止**为了让测试通过而修改不属于本 lane 的测试。
8. 自查 §12 清单，在提交说明里逐条写「已满足 / 不适用」。

---

## 12. 审查清单（对抗性审查必须逐条给出结论）

对每个被迁移的文件，审查者必须逐条回答，并给出 `path:line` 证据：

1. 门禁对该文件零违规；每个 `ds-allow` 都有合格理由。
2. 页面只有一个 `PageHeader`，原型选对了（§5），`Page width` 选对了（§4.2）。
3. 一个视图里 primary 按钮最多一个；危险操作用 `danger` / `danger-soft`，并且有确认 Dialog。
4. 没有卡片套卡片；Panel 内部分组用 `divide-y` 或凹陷井。
5. 颜色语义正确：每个有彩色的元素都能说出它对应 §2.3 的哪一条含义；没有装饰性用色；状态没有用整块背景色表达。
6. 评测结果、难度、比赛状态全部走 `Verdict` / `Difficulty` / `StatusDot`。
7. 字号只用 §2.8 的档位，并且用途匹配（例如没有用 `text-lg` 当正文）；数字列和计时用了 `tabular`。
8. 间距只用 §2.9 的档位；没有 `7` `9` `11` `14` 这类数值。
9. 没有入场动画（DS015）、hover 位移、数字时长；`motion` 只经过 `useMotionTokens()`。
10. 响应式：< sm 时没有横向溢出（表格除外）；操作区换行正确；`DataTable` 的 `mobile` 模式选对了；`short:` 视口下工作区不出现双重滚动。
11. 功能不变：事件处理、请求、路由、`data-*`、`aria-*`、表单字段 `name` 全部保留；用户可见文案未改。
12. 没有修改本 lane 不拥有的文件。

审查结论只有「通过」或「打回 + 条目编号 + 证据」两种。
