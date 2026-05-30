# Krypton Vigil Client — Fluent Design 重设计

> 状态：设计已确认，分三阶段实施
> 目标：把 `ecosystems/KryptonVigilSystem/Client` 现有的 Qt Widgets 默认皮替换成微软 Fluent Design / WinUI 3 风格，主色 `#0078D4` 天蓝色

伴文档：[`CLIENT_REQUIRED_CONTEST_DESIGN.md`](CLIENT_REQUIRED_CONTEST_DESIGN.md)（决定该客户端的产品语义）。

本文只描述视觉与工程决策，不包含实现代码。

## 1. 背景

现有 Qt Client 用 Qt 6.5+ Widgets，无 QML / 无 QSS 资源 / 无图标库。视觉是 Qt 默认风格 + 个别 `setStyleSheet` 内联（exam_webview 顶部 toolbar 是深色 `#111827`，login 用了 `#2563eb` 蓝色 status 文字）——风格散乱、不统一、不 Fluent。

目标是给学生面给一套统一的、像 Win11 / WinUI3 应用的视觉。

## 2. 设计决策摘要

13 项已确认决策（grill session 2026-05-27）：

| # | 主题 | 决策 |
|---|---|---|
| 1 | 实现路线 | QSS + Win32 DWM hacks（Mica） |
| 2 | 改造范围 | LoginWindow + ExamShell dialogs + ExamWebview chrome + blockedHtml |
| 3 | 颜色模式 | Light only（blockedHtml 例外保留深色） |
| 4 | 主色 | `#0078D4` Win11 默认 accent + 派生色阶 |
| 5 | 字体栈 | Segoe UI Variable → Segoe UI → Microsoft YaHei UI → system-ui |
| 6 | 窗口边框 | Hybrid — LoginWindow frameless 自画，ExamWebview native chrome + Mica |
| 7 | Mica fallback | 只 Win11 22H2+ Mica，其他自动 solid 白 |
| 8 | 组件分发 | setProperty + QSS 属性选择器 |
| 9 | 动画 | QSS 状态选择器 + Dialog 淡入 + InfoBar 滑入 + ProgressRing 自定义 |
| 10 | 图标 | Microsoft Fluent UI System Icons + SVG + QRC |
| 11 | 代码组织 | 新建 `ui/` 顶层目录（fluent/ + widgets/ + resources/） |
| 12 | 上线节奏 | 三阶段（基础设施 → 主屏 → dialogs/InfoBar） |
| 13 | MainWindow | 全局 QSS 自动覆盖（"Let it happen"） |

## 3. 调色板

### 3.1 主色（accent / 天蓝）

```
accent-default       #0078D4   (Primary 按钮填充、focus ring、链接、进度条)
accent-secondary     #106EBE   (hover)
accent-tertiary      #005A9E   (pressed)
accent-disabled      #A6A6A6   (disabled 用中性灰)
accent-bg-subtle     #F3F9FD   (selected item 背景)
accent-text-onlight  #003D6E   (浅色背景上的强调文字)
```

### 3.2 中性灰阶（WinUI3 Light 标准）

```
bg-base         #FFFFFF   (Mica 透出时变成半透白，无 Mica 时纯白)
bg-secondary    #FAFAFA   (卡片次级)
bg-tertiary     #F3F3F3   (输入框 / disabled bg)
border          #E5E5E5
border-strong   #C8C8C8   (focused / hover 时强化边框)
text-primary    #1A1A1A
text-secondary  #595959
text-tertiary   #8A8A8A
```

### 3.3 语义色（InfoBar / 状态）

```
info     #0078D4  (= accent)
success  #107C10
warning  #F2A100
danger   #C42B1C
```

### 3.4 错误页（blockedHtml）特例

`blockedHtml` 是网络锁拦截时 webview 显示的"被拦截"页，语义就是"错误/禁止"。维持深色：

```
error-bg         #0F172A  (深 slate)
error-text       #E5E7EB
error-accent     #F87171  (淡红警告)
```

## 4. 字体

### 4.1 字体栈

```css
font-family:
  "Segoe UI Variable", "Segoe UI",          /* Win11 → Win10 fallback */
  "Microsoft YaHei UI", "Microsoft YaHei",  /* 中文 */
  system-ui, sans-serif;
```

零字体打包；全部依赖 Windows 内置字体；macOS / Linux 走 system-ui fallback（开发用机）。

### 4.2 Type Ramp（WinUI3 标准 4 档）

| 名称 | 字号 | 字重 | 使用场景 |
|---|---|---|---|
| **Body** | 14px | Regular (400) | 默认正文 |
| **Body Strong** | 14px | SemiBold (600) | 字段标签 |
| **Subtitle** | 20px | SemiBold (600) | 对话框标题 |
| **Title** | 28px | SemiBold (600) | 大标题（LoginWindow welcome） |

Variable 字体的光学尺寸特性靠 `QFont::setStyleStrategy(QFont::PreferAntialias)` + `setWeight(QFont::Weight)` 触发。

## 5. 组件目录

### 5.1 按钮（QPushButton + variant）

| Variant | 用途 | 视觉 |
|---|---|---|
| `primary` | 主操作（提交 / 确认） | accent 填充 + 白字 |
| `standard` | 次操作（取消） | 白底 + 灰边 + 黑字（默认） |
| `subtle` | 弱操作（链接式） | 透明底 + 灰字 + hover 浅灰底 |
| `destructive` | 危险操作（删除 / 强制结束） | `#C42B1C` 填充 + 白字 |
| `hyperlink` | 链接 | 透明底 + accent 文字 + hover 下划线 |

应用方式：`Fluent::setVariant(button, "primary")`。

### 5.2 输入框（QLineEdit + variant）

| Variant | 用途 |
|---|---|
| `default` | 标准单行输入 |
| `readonly` | 只读（URL bar 等） |

视觉：1px `#E5E5E5` 边框，hover/focus 时变 accent `#0078D4` 2px 描边，圆角 4px。

### 5.3 自定义 widget（新加）

- **`Fluent::ProgressRing`** — Fluent 招牌无尽圆环，替代 `QProgressBar` 用于 "审核中" 等不定时长场景
- **`Fluent::InfoBar`** — 顶部滑入的非模态消息条，4 种 severity（info/success/warning/danger）
- **`Fluent::FramelessDialog`** — frameless QDialog 基类，自画 32px 标题栏 + close 按钮 + Mica 接入，给 LoginWindow 用
- **`Fluent::ContentDialog`** — 模态对话框，链式 API `setTitle().setBody().addAction()`，替代部分 QMessageBox / QInputDialog 场景

## 6. 窗口边框策略

### 6.1 LoginWindow — frameless 自画

- `Qt::FramelessWindowHint | Qt::WindowSystemMenuHint`
- 顶部自画 32px 标题栏：左 app icon + "Krypton 考试登录"，右 Fluent close 按钮
- title bar 区域 `mousePressEvent` + `mouseMoveEvent` 实现拖动
- `Qt::WA_TranslucentBackground` + Win32 `DwmExtendFrameIntoClientArea(-1,-1,-1,-1)` 让 Mica 透到全窗
- Win11 22H2+ 默认带阴影；老版本无 Mica fallback 为 solid 白底
- 不需要 resize / 最大化 / snap layouts（QDialog 固定 420px 宽）

### 6.2 ExamWebview — native chrome + Mica

- 维持 `QMainWindow` 默认 chrome
- `DwmSetWindowAttribute(hwnd, DWMWA_SYSTEMBACKDROP_TYPE, DWMSBT_MAINWINDOW)` 启用 Mica（Win11 22H2+，老系统 NoOp）
- 标题栏跟随系统主题（Light 时与 client 一致）
- snap layouts / resize / 系统右键菜单全由系统处理

### 6.3 ExamShell 临时对话框 — native chrome

- ContentDialog 继承自标准 QDialog，使用系统 chrome
- 200×100 级别的小弹窗，自画 chrome 不值得

## 7. Mica/Acrylic 接入

### 7.1 检测 Win11 22H2+

```cpp
bool isWin11_22H2_OrGreater() {
    OSVERSIONINFOEX info{};
    info.dwOSVersionInfoSize = sizeof(info);
    DWORDLONG mask = 0;
    VER_SET_CONDITION(mask, VER_MAJORVERSION, VER_GREATER_EQUAL);
    VER_SET_CONDITION(mask, VER_BUILDNUMBER, VER_GREATER_EQUAL);
    info.dwMajorVersion = 10;          // Win11 仍报告 major=10
    info.dwBuildNumber = 22621;        // 22H2 起的 build
    return VerifyVersionInfoW(&info, VER_MAJORVERSION | VER_BUILDNUMBER, mask);
}
```

### 7.2 API

```cpp
// Win11 22H2+
DWORD backdrop = DWMSBT_MAINWINDOW;
DwmSetWindowAttribute(hwnd, DWMWA_SYSTEMBACKDROP_TYPE, &backdrop, sizeof(backdrop));
```

老系统调用直接返回 `S_FALSE`，无需手动判断，窗口自动 fall back 到 solid 白底（由 QSS 决定）。

### 7.3 不实现的 fallback

- ❌ 不实现 Acrylic 老 API（`SetWindowCompositionAttribute` 是 undocumented）
- ❌ 不实现 Win10 blur-behind
- 老系统直接 solid 白，视觉退化但功能完整

## 8. 动画策略

### 8.1 必做（QSS 状态选择器，0 额外 C++）

- `:hover` / `:focus` / `:pressed` / `:disabled` 色变（瞬切，不缓动）
- focused 时 2px accent 描边
- disabled 时降饱和度 + 灰色文字

### 8.2 推荐（QPropertyAnimation 驱动）

- **Dialog 淡入**：`Fluent::fadeInDialog(dialog, 250ms)` helper，windowOpacity 0→1
- **InfoBar 滑入**：从顶部 -40px 滑入到 0，250ms ease-out
- **ProgressRing 旋转**：QTimer 60fps，QPainter 画一段圆弧

### 8.3 跳过

- Hover 颜色缓动（200ms 渐变）
- 按钮按下 scale（Fluent 现行版已无）
- Reveal cursor highlight（实现成本极高，价值低）
- Dialog 切屏滑动

### 8.4 时长常数

```
state-transition  167ms ease-out  (QSS 状态切换基线，但 QSS 不支持，仅作为后续手动动画时参考)
dialog-fade-in    250ms ease-out
infobar-slide-in  250ms ease-out
progress-ring     1500ms 一圈（持续匀速旋转）
```

## 9. 图标

### 9.1 来源

[Microsoft Fluent UI System Icons](https://github.com/microsoft/fluentui-system-icons) MIT licensed。

### 9.2 必需图标清单

```
arrow-left-20         (toolbar back)
arrow-right-20        (toolbar forward)
arrow-clockwise-20    (toolbar reload)
sign-out-20           (toolbar "结束考试")
dismiss-20            (LoginWindow custom title bar close)
person-20             (LoginWindow 学号 input prefix，可选)

info-24               (InfoBar info severity)
checkmark-circle-24   (InfoBar success severity)
warning-24            (InfoBar warning severity)
dismiss-circle-24     (InfoBar danger severity)
```

10 个图标 + ~5KB 总体积。

### 9.3 着色

SVG 默认 `fill="currentColor"`，运行时通过 `Fluent::tintedIcon(path, color, size)` helper 用 QSvgRenderer + QPainter `CompositionMode_SourceIn` 重着色：

```cpp
QIcon tintedIcon(const QString& resourcePath, QColor color, int size);
```

### 9.4 嵌入

SVG + QRC 内嵌（`fluent_resources.qrc`）。Qt 6.5+ 自带 SVG 支持，CMakeLists 加 `Qt6::Svg`。

## 10. 代码组织

```
ecosystems/KryptonVigilSystem/Client/
  ui/
    fluent/
      fluent_palette.h            色常量 + Variant 字符串
      fluent_palette.cpp
      fluent_style.h              setVariant / tintedIcon / fadeInDialog
      fluent_style.cpp
      fluent_backdrop.h           Mica DWM 接口
      fluent_backdrop.cpp         跨平台调用入口
      fluent_backdrop_win.cpp     Win32 DWM 实现
      fluent_backdrop_stub.cpp    跨平台 NoOp fallback
      resources/
        fluent.qss                主样式表
        icons/
          arrow-left-20.svg
          ... (10 个 svg)
        fluent_resources.qrc
    widgets/
      progress_ring.h
      progress_ring.cpp
      info_bar.h
      info_bar.cpp
      frameless_dialog.h
      frameless_dialog.cpp
      frameless_dialog_win.cpp    Win32 hit-test + Mica 接入
      frameless_dialog_stub.cpp   跨平台 NoOp
      content_dialog.h            (Phase 3 添加)
      content_dialog.cpp          (Phase 3 添加)
```

`CMakeLists.txt` 改动：
- `find_package(Qt6 6.5 REQUIRED COMPONENTS ... Svg)`
- `qt_add_executable(KryptonVigilClient ... ui/fluent/*.cpp ui/widgets/*.cpp ${FLUENT_BACKDROP_PLATFORM_SOURCE} ${FLUENT_FRAMELESS_PLATFORM_SOURCE})`
- `qt_add_resources(KryptonVigilClient "fluent_resources" PREFIX "/fluent" FILES ...)`
- `target_link_libraries(KryptonVigilClient PRIVATE Qt6::Svg)`

## 11. 上线节奏

### Phase 1 — 基础设施 + 全局 QSS（零 UI 代码改动）

**交付：**
- `ui/fluent/*` 调色板 / helper / Mica 接入
- `ui/widgets/*` ProgressRing / InfoBar / FramelessDialog（基础类，未使用）
- `ui/fluent/resources/fluent.qss` 主样式表
- `ui/fluent/resources/icons/*.svg` 10 个图标
- `ui/fluent/resources/fluent_resources.qrc`
- `CMakeLists.txt` 加文件 + Qt6::Svg + QRC
- `app/main.cpp` 启动时 `QApplication::setStyleSheet(loadFluentQss())`

**影响：**
- 所有现有 widget（包括 MainWindow）立即套上 Fluent 基础皮（QSS 全局生效）
- 0 行为变更，只视觉升级
- 行为风险接近 0，可独立合并独立观察

### Phase 2 — LoginWindow + ExamWebview 主屏重写

**交付：**
- `app/login_window.cpp` 改造：
  - 继承 `Fluent::FramelessDialog`
  - 移除 inline `setStyleSheet`（已被全局 QSS 接管）
  - 提交按钮 `Fluent::setVariant(submit, "primary")`
  - QProgressBar 替换为 `Fluent::ProgressRing`
- `app/exam_webview.cpp` 改造：
  - 移除 toolbar / infoBar 的 inline `setStyleSheet`
  - 调按钮 variant
  - 用 `Fluent::tintedIcon` 替代 emoji 字符（`←` `↻` `→` → SVG）
  - 启动时调 `Fluent::Backdrop::applyMica(this)` 启用 Mica
- `app/main.cpp` 启动时给 LoginWindow / ExamWebview 调 Mica

**影响：**
- 主要触点完整 Fluent 化
- ExamShell 临时对话框暂时维持默认风格，可能有"主屏 Fluent + 弹窗默认"的视觉断层
- 工程量 ~500 行

### Phase 3 — dialogs + InfoBar + 错误页

**交付：**
- `ui/widgets/content_dialog.{h,cpp}` 实现 Fluent ContentDialog
- `app/exam_shell.cpp` 替换：
  - `confirmStudentFinish` 自定义 QDialog → `Fluent::ContentDialog`
  - `needs_selection` `QInputDialog::getItem` → 自定义 `Fluent::ListSelectionDialog`
  - 提示类 QMessageBox（"正在结束"）→ `Fluent::InfoBar`
  - 关键决策 QMessageBox（"考试结束"、"网络锁失败"）→ `Fluent::ContentDialog`
- `blockedHtml` HTML 字符串：保留深色，加 Fluent 字体 + 内联 SVG 图标

**影响：**
- 客户端全栈 Fluent 化完成
- 工程量 ~500 行

## 12. QSS 选择器约定

### 12.1 默认（按 widget 类型）

```css
QPushButton { /* 默认 = standard 风格 */ }
QLineEdit   { /* 默认 = default 风格 */ }
QLabel      { /* 默认正文 */ }
```

### 12.2 Variant 选择器（与默认共存）

```css
QPushButton[variant="primary"] { background: #0078D4; color: white; }
QPushButton[variant="primary"]:hover { background: #106EBE; }
QPushButton[variant="primary"]:pressed { background: #005A9E; }
QPushButton[variant="primary"]:disabled { background: #A6A6A6; color: #FAFAFA; }

QPushButton[variant="subtle"] { background: transparent; color: #1A1A1A; border: none; }
QPushButton[variant="destructive"] { background: #C42B1C; color: white; }
...
```

### 12.3 objectName 选择器（用于特定 widget）

```css
QFrame#examToolbar { /* Fluent toolbar 风格 */ }
QFrame#examInfoBar { /* Fluent info bar 风格 */ }
```

### 12.4 Property change 后必须重新 polish

```cpp
// Fluent::setVariant 内部已经处理：
void setVariant(QWidget* w, const char* variant) {
    w->setProperty("variant", variant);
    w->style()->unpolish(w);
    w->style()->polish(w);
}
```

## 13. 验证方式

- **Phase 1 合并后**：开发同学跑一遍 `--ui` 看 MainWindow 的视觉差异；跑 ExamShell（默认入口）看 LoginWindow 的"原 widget + 新 QSS"
- **Phase 2 合并后**：实机录屏对比 Win11 22H2+（应看到 Mica）+ Win10（应看到 solid）+ macOS（应看到 solid）
- **Phase 3 合并后**：完整走一遍考试流程（登录 → 多比赛选择 → 进入考试 → 结束），所有触点应统一

无 CI 截图测试，纯人工目检。

## 14. 风险与回滚

| 风险 | 缓解 |
|---|---|
| MainWindow 在 Phase 1 后布局错位 | 单独给问题 widget 加 legacy-compact variant 反向覆盖 |
| Mica API 在某 Win 版本崩溃 | `DwmSetWindowAttribute` 调用包 try-catch，失败 NoOp |
| Frameless dialog 拖动 hit-test 错位 | LoginWindow 是 QDialog 定宽，hit-test 区域固定，问题面小 |
| 字体 fallback 在中文 Win10 下变形 | YaHei UI 是 Win 内置，必能 fallback；最差降到 system-ui |
| QSS hot-reload 不支持 | 开发模式下用环境变量 `KRYPTON_FLUENT_QSS_PATH` 指定文件系统路径，编辑保存重启即可看到 |

回滚：每个 Phase 一个独立 PR，回滚单 Phase 即可。Phase 1 不动 UI 代码，回滚=删 ui/ 目录 + main.cpp 那行 setStyleSheet。

## 15. 已确认决策摘要

- 实现路线：QSS + Win32 DWM hacks
- 改造范围：LoginWindow + ExamShell dialogs + ExamWebview chrome + blockedHtml
- 颜色：Light only，accent `#0078D4`
- 字体：Segoe UI Variable + Microsoft YaHei UI
- 窗口：LoginWindow frameless + ExamWebview native chrome
- Mica：只 Win11 22H2+，其他 solid
- 分发：setProperty + QSS 属性选择器
- 动画：QSS 状态 + Dialog 淡入 + InfoBar 滑入 + ProgressRing
- 图标：Microsoft Fluent UI System Icons + SVG + QRC
- 组织：新建 `ui/` 顶层目录
- 节奏：三阶段（基础设施 → 主屏 → dialogs）
- MainWindow：Let it happen
