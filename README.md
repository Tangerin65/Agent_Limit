# Agent Limit

<p align="center">
    <strong>语言 / Language:</strong>
    <a href="#简体中文">简体中文</a> | <a href="#english">English</a>
</p>

---

## 简体中文

`Agent Limit` 是一个面向 Windows 的本地桌面工具，用来查看当前电脑上已登录的 AI Agent 账号额度情况。

当前版本已支持 `Codex` 与 `GitHub Copilot` 两类 Provider，并统一展示：

- 当前账号
- 当前套餐
- 当前限额窗口已用量
- 当前限额窗口剩余量
- 重置时间
- 重置倒计时
- 手动刷新获取

其中：

- `Codex` 以百分比形式展示当前限额窗口使用情况
- `GitHub Copilot` 以 `premium requests` 数量展示套餐、剩余额度与剩余百分比

同时，项目已经预留了后续扩展接口，便于继续接入：

- OpenRouter
- 其他基于 API Key 或网页登录态的额度来源

### 最近更新

最近一次提交主要完成了以下改动：

- 新增 `GitHub Copilot` Provider，支持读取本机登录态并请求 GitHub 接口刷新账号套餐与额度信息
- 前端从单 Provider 展示升级为多 Provider 切换
- 新增 `Dashboard / Details` 双视图
- 新增额度重置倒计时显示
- 新增环境诊断面板，可查看 `WebView2`、`Codex`、`GitHub Copilot` 的本地检测结果
- 统一扩展了 Provider 数据模型，补充套餐、额度置信度、原始元数据、告警等字段

最近一次修复进一步补齐了以下问题：

- 修复切换顶部 `Agent / Provider` 菜单后不会自动刷新的问题，现在切换后会立即请求当前 Provider 快照
- 为 `GitHub Copilot` 补充 `premium_interactions.percent_remaining` 映射，界面可同时显示剩余数量与剩余百分比
- 前端主界面、详情面板、环境告警与 Provider 提示已补充中文文案
- 调整页面语言与字体栈，优先使用 Windows 下不易乱码的中文字体（如 `Microsoft YaHei UI`）

### 当前实现方式

当前版本对不同 Provider 采用不同的数据来源策略：

#### Codex

优先读取本机已有的 Codex 本地数据：

- `C:\Users\<你的用户名>\.codex\auth.json`
- `C:\Users\<你的用户名>\.codex\config.toml`
- `C:\Users\<你的用户名>\.codex\sessions\**\*.jsonl`

其中：

- 账号和套餐信息主要来自本地认证上下文
- 剩余额度来自最新一次本地 `token_count` 事件中的 `rate_limits.primary.used_percent`

因此，这一版显示的是 `Codex 当前限额窗口的剩余百分比`，而不是 OpenAI 控制台上的账单余额。

#### GitHub Copilot

先读取本机登录文件，再使用本地登录态向 GitHub 接口刷新 Copilot 账号信息：

- `C:\Users\<你的用户名>\AppData\Local\github-copilot\apps.json`
- `C:\Users\<你的用户名>\AppData\Local\github-copilot\oauth.json`
- `C:\Users\<你的用户名>\.copilot\session-state\**\*.jsonl`
- `C:\Users\<你的用户名>\AppData\Roaming\Code\User\globalStorage\github.copilot-chat`

其中：

- 本地文件用于检测当前 Windows 账户下是否已登录 GitHub Copilot
- 远程刷新请求会返回当前账号、套餐 SKU、套餐名称以及 `premium_interactions` 配额快照
- 若当前套餐返回了有限 premium requests 配额，界面会展示总量、已用、剩余与剩余百分比
- 若当前套餐没有有限的 premium requests 配额，界面会显示套餐信息，但额度状态可能为 `unavailable`

因此，这一版显示的是 `GitHub Copilot premium requests` 的套餐/额度视图，而不是 GitHub 账单页面的消费金额。

### 技术栈

- `Tauri v2`
- `React`
- `TypeScript`
- `Vite`
- `Rust`

### 运行方式

#### 普通用户（推荐）

1. 前往项目的 Releases 页面，下载 Windows 安装包（NSIS，通常是 `*.exe`）。
2. 双击安装并启动。
3. 首次运行可能会自动安装/拉取 WebView2 运行时（Tauri 配置为静默下载），需要联网一次。
4. 若页面提示未登录/无数据：请先在本机完成 Codex 登录（确保存在 `C:\Users\<你的用户名>\.codex\...` 相关文件），再回到软件里点“刷新”。

> 如果你拿到的是便携版单文件（`Agent Limit.exe`），直接双击运行即可。

#### 开发者（从源码运行/打包）

- 开发运行：

```bash
npm install
npm run tauri dev
```

- 构建安装包（NSIS）：

```bash
npm run build:installer
```

产物一般在：`src-tauri\target\release\bundle\nsis\`。

- 同时导出根目录可执行文件/安装包（便于发给其他人直接运行）：

```bash
npm run build:root-exe
```

会在仓库根目录生成：`Agent Limit.exe` 与 `Agent Limit Setup.exe`。

### 目录结构

```text
scripts/                 打包辅助脚本（导出根目录 exe / 安装包等）
src/                     前端（React）
    components/             UI 组件
    lib/                    前端与后端交互封装（invoke / API 等）
    types/                  统一类型定义（Provider 数据模型等）
    App.tsx                 主界面
    main.tsx                前端入口
    styles.css              全局样式

src-tauri/                Tauri v2 / Rust 后端
    src/
        providers/             Provider 适配器（当前已接入 codex / github copilot）
        main.rs                Tauri 入口与命令注册
        lib.rs                 后端对外接口（commands 等）
        models.rs              统一数据模型
        error.rs               错误定义
        environment.rs         Windows 环境/路径相关处理
    capabilities/            Tauri capabilities 配置
    gen/schemas/             Tauri schema（自动生成）

index.html                Vite 页面模板
vite.config.ts            Vite 配置
tsconfig*.json            TypeScript 配置
```

### 已支持能力

#### Codex

- 检测本机是否已登录 Codex
- 读取当前账号基础信息
- 读取套餐类型
- 读取本地最新限额窗口使用比例
- 计算剩余百分比
- 手动刷新

#### 已支持 / 部分支持 Provider

- `OpenRouter`
- `GitHub Copilot`

其中：

- `GitHub Copilot` 已支持读取本地登录态
- `GitHub Copilot` 已支持通过 GitHub 接口刷新账号套餐、套餐 SKU、premium requests 总量/已用/剩余、剩余百分比、重置时间
- `GitHub Copilot` 在无法读取登录文件或远程刷新失败时，会返回降级状态与告警信息
- `OpenRouter` 仍保留统一适配器入口，尚未实现真实查询逻辑

### 界面变化

当前界面不再只展示单一卡片，而是分为两种视图：

- `Dashboard`：展示当前 Provider、账号、套餐、剩余额度、重置时间、倒计时
- `Details`：展示 Provider 状态、能力开关、环境诊断、账号详情、套餐详情、额度详情、百分比详情、告警、原始元数据

多 Provider 可通过顶部切换按钮进行切换；切换时会自动刷新当前 Provider，手动刷新操作会同时更新当前 Provider 快照与环境诊断信息。

当前版本界面已补充中文，并对 Windows 字体回退做了处理，以尽量避免中文显示乱码。


### 开发说明

项目采用统一 Provider 数据模型，前端不直接依赖某个具体平台。后续新增额度来源时，原则上只需要：

1. 在 Rust 侧新增一个 Provider 适配器
2. 返回统一的账号 / 套餐 / 额度结构
3. 在注册表中挂载该 Provider

这样可以保证 UI 不需要为每个平台单独重写。

### 后续计划

- 接入 OpenRouter 余额查询
- 增加托盘模式
- 增加自动刷新
- 前端界面优化
- 增加历史记录与变化趋势
- 增加多账号 / 多 Provider 切换

[↑ 回到顶部](#agent-limit)

---

## English

`Agent Limit` is a Windows desktop app that shows quota usage for AI agent accounts currently signed in on your PC.

The current version supports both **Codex** and **GitHub Copilot**, and shows:

- Current account
- Current plan
- Used amount in the current limit window
- Remaining amount in the current limit window
- Reset time
- Reset countdown
- Manual refresh

Where:

- `Codex` is displayed as percentage-based limit window usage
- `GitHub Copilot` is displayed as premium request quota totals, remaining requests, and remaining percentage

The project also reserves extension points so you can add more providers later:

- OpenRouter
- Other quota sources via API keys or web login sessions

### Latest update

The latest commit `011bdac` (`Update:更新Github Copilot适配`) introduced:

- A new `GitHub Copilot` provider that detects local sign-in state and refreshes account/plan/quota data from GitHub
- Multi-provider switching in the UI
- A `Dashboard / Details` split view
- Reset countdown display
- An environment diagnostics panel for `WebView2`, `Codex`, and `GitHub Copilot`
- An expanded provider data model with plan details, quota confidence, warnings, and raw metadata

The latest fix pass also addressed the following issues:

- Switching the top provider menu now auto-refreshes the selected provider snapshot
- `GitHub Copilot` now maps `premium_interactions.percent_remaining`, so the UI can show both remaining requests and remaining percentage
- The frontend UI, detail panels, warnings, and provider messages now include Chinese text
- The page language and font stack were adjusted to prefer Windows-safe Chinese fonts such as `Microsoft YaHei UI`

### How it works

This version uses different data sources depending on the provider:

#### Codex

It reads local Codex data files:

- `C:\Users\<your-username>\.codex\auth.json`
- `C:\Users\<your-username>\.codex\config.toml`
- `C:\Users\<your-username>\.codex\sessions\**\*.jsonl`

Where:

- Account and plan info mainly come from the local auth context
- Remaining quota is derived from the latest local `token_count` event field: `rate_limits.primary.used_percent`

So what you see is the **remaining percentage within Codex’s current rate-limit window**, not the monetary balance shown in any web console.

#### GitHub Copilot

It first reads local login files, then uses the local signed-in session to refresh account data from GitHub:

- `C:\Users\<your-username>\AppData\Local\github-copilot\apps.json`
- `C:\Users\<your-username>\AppData\Local\github-copilot\oauth.json`
- `C:\Users\<your-username>\.copilot\session-state\**\*.jsonl`
- `C:\Users\<your-username>\AppData\Roaming\Code\User\globalStorage\github.copilot-chat`

Where:

- Local files are used to detect whether GitHub Copilot is signed in for the current Windows account
- The refresh request returns account identity, plan SKU, plan name, and `premium_interactions` quota snapshots
- When a finite premium requests allowance is returned, the app shows total, used, remaining, and remaining percentage
- If the current plan does not expose a finite premium request allowance, the plan may still be shown while quota stays `unavailable`

So what you see is a **GitHub Copilot premium-requests quota view**, not a GitHub billing or spending page.

### Tech stack

- Tauri v2
- React
- TypeScript
- Vite
- Rust

### How to run

#### For end users (recommended)

1. Go to the project Releases page and download the Windows installer (NSIS, typically `*.exe`).
2. Run the installer and launch the app.
3. On first launch, it may download/install the WebView2 runtime silently (as configured by Tauri), so an internet connection may be required once.
4. If the app shows “not logged in” / “no data”, please sign in to Codex on this machine first (make sure `C:\Users\<your-username>\.codex\...` exists), then click Refresh in the app.

> If you have a portable single executable (`Agent Limit.exe`), just double-click to run it.

#### For developers (run/build from source)

- Run in development:

```bash
npm install
npm run tauri dev
```

- Build the Windows installer (NSIS):

```bash
npm run build:installer
```

The output is typically under: `src-tauri\target\release\bundle\nsis\`.

- Export a root-level executable + installer (easy to share):

```bash
npm run build:root-exe
```

This generates `Agent Limit.exe` and `Agent Limit Setup.exe` in the repository root.

### Project structure

```text
scripts/                 Build helper scripts (export root exe / installer, etc.)
src/                     Frontend (React)
    components/             UI components
    lib/                    Frontend ↔ backend bridge (invoke / API wrappers)
    types/                  Shared types (provider data model, etc.)
    App.tsx                 Main UI
    main.tsx                Frontend entry
    styles.css              Global styles

src-tauri/                Tauri v2 / Rust backend
    src/
        providers/             Provider adapters (currently codex / github copilot)
        main.rs                Tauri entry & command registration
        lib.rs                 Backend public interface (commands, etc.)
        models.rs              Shared data model
        error.rs               Error types
        environment.rs         Windows env/path helpers
    capabilities/            Tauri capabilities config
    gen/schemas/             Tauri schemas (generated)

index.html                Vite HTML template
vite.config.ts            Vite config
tsconfig*.json            TypeScript configs
```

### Supported providers

#### Codex

- Detect whether Codex is logged in
- Read current account info
- Read plan type
- Read latest local limit-window used percentage
- Calculate remaining percentage
- Manual refresh

#### Supported / partial providers

- OpenRouter

Current status:

- GitHub Copilot now reads local sign-in state
- GitHub Copilot now refreshes account plan, plan SKU, premium requests total/used/remaining, remaining percentage, and reset time from GitHub
- GitHub Copilot returns degraded state and warnings when local login files are missing or the remote refresh fails
- OpenRouter still has a reserved adapter entry point, but the actual query logic is not implemented yet

### UI changes

The UI is now split into two views:

- `Dashboard`: current provider, account, plan, remaining quota, reset time, and countdown
- `Details`: provider status, capability flags, environment diagnostics, account details, plan details, quota details, percentage details, warnings, and raw metadata

You can switch providers from the top bar, and switching now auto-refreshes the selected provider. Manual refresh updates both the selected provider snapshot and the environment diagnostics.

The current build also includes Chinese UI text and a safer Windows-oriented Chinese font fallback setup to reduce the risk of garbled rendering.

### Development notes

The project uses a unified provider data model. The frontend does not depend on a specific platform implementation.
To add a new quota source, you typically only need to:

1. Add a provider adapter on the Rust side
2. Return the unified account/plan/quota structure
3. Register the provider in the registry

This keeps the UI stable without rewriting it per provider.

### Roadmap

- Add OpenRouter balance querying
- Add tray mode
- Add auto refresh
- Improve UI
- Add history and trends
- Add multi-account / multi-provider switching

[↑ Back to top](#agent-limit)
