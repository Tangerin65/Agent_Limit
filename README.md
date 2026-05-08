# Agent Limit

<p align="center">
  <strong>语言 / Language:</strong>
  <a href="#简体中文">简体中文</a> | <a href="#english">English</a>
</p>

---

#### 简体中文

## 1.项目简介

你可能正在经历这些问题：
- 明明开通了 Coding Plan 或购买了 API Credit，却不知道“现在还剩多少额度、何时能够重置”
- Codex、Copilot、OpenRouter、自定义平台分散在不同网页客户端，来回切换费时费力
- 到了额度边缘才发现即将耗尽，影响连续开发节奏

`Agent Limit` 就是为这个场景而生：一个面向 Windows 的本地桌面面板，把本地**已登录**的 AI Agent 额度状态统一拉平展示。  
可以在同一界面里快速看到账号、套餐、剩余配额、重置时间和倒计时，减少排查成本，降低额度焦虑。

当前已支持：

- `Codex`
- `GitHub Copilot`
- `OpenRouter`
- `自定义API供应商(OpenAI格式)`



## 2.功能介绍

- 统一展示当前账号、套餐、配额、重置时间与倒计时
- 新增 `Settings` 独立页面，集中管理语言与主题
- 多语言支持,默认根据系统语言决定界面语言，之后记住用户选择
- 支持 `System / Dark / Light` 三种主题模式（可跟随系统）
- `OpenRouter` 支持在主界面直接填写 API Key，无需再手动绑定命令行环境变量
- `Custom Provider` 支持在主界面图形化填写 `Display Name / Base URL / API Key`
- Provider 选择栏支持品牌 Logo 展示，Custom Provider 自动匹配 `Kimi / DeepSeek / GLM` Logo
- Remaining 主卡片新增圆环进度，可同时显示剩余额度与百分比
- 支持环境诊断，检测 `WebView2`、`Codex`、`GitHub Copilot` 本地状态

## 3.下载使用方式

#### 普通用户

1. 前往项目 Releases 页面下载 Windows 安装包。
2. 双击安装并启动应用。
3. 首次运行如果系统缺少 `WebView2 Runtime`，应用可能会触发安装或需要先安装运行时。
4. 如果页面显示未登录或没有额度数据，请先在本机完成相应服务的登录，再回到应用中点击“刷新”。

便携版说明：

- 如果拿到的是单文件版本 `Agent Limit.exe`，可以直接双击运行。

#### 开发者

开发运行：

```bash
npm install
npm run tauri dev
```

如果需要体验 API 平台 Provider，现在推荐直接在应用主界面内填写配置。

兼容模式下，仍可在当前终端设置环境变量（Windows PowerShell）：

```powershell
$env:OPENROUTER_API_KEY="your-openrouter-key"
$env:OPENAI_API_KEY="your-openai-key"
```

前端构建：

```bash
npm run build
```

构建安装包：

```bash
npm run build:installer
```

同时导出根目录可执行文件与安装包：

```bash
npm run build:root-exe
```

发布与清理（`v0.1.2` 起推荐）：

```bash
cd src-tauri && cargo test
cd ..
npm run build
npm run build:root-exe
```

确认 `Agent Limit.exe` 可启动后，可发布到 GitHub Release：

```bash
gh release create v0.1.2 "Agent Limit.exe" "Agent Limit Setup.exe" --title "v0.1.2" --notes "See README for highlights."
```

发布完成后如需深度清理本地工作区：

```powershell
Remove-Item -Recurse -Force .\dist, .\src-tauri\target, .\node_modules
Remove-Item -Force ".\Agent Limit.exe", ".\Agent Limit Setup.exe"
```

## 4.实现方式

#### Codex

优先读取本机已有的 Codex 本地数据：

- `C:\Users\<你的用户名>\.codex\auth.json`
- `C:\Users\<你的用户名>\.codex\config.toml`
- `C:\Users\<你的用户名>\.codex\sessions\**\*.jsonl`

其中：

- 账号和套餐信息主要来自本地认证上下文
- 当前限额窗口的百分比来自最新一次本地 `token_count` 事件
- 当前界面展示的是 `当前限额窗口剩余百分比`，不是控制台账单余额

#### GitHub Copilot

先读取本机登录文件，再使用本地登录态向 GitHub 接口刷新账号信息：

- `C:\Users\<你的用户名>\AppData\Local\github-copilot\apps.json`
- `C:\Users\<你的用户名>\AppData\Local\github-copilot\oauth.json`
- `C:\Users\<你的用户名>\.copilot\session-state\**\*.jsonl`
- `C:\Users\<你的用户名>\AppData\Roaming\Code\User\globalStorage\github.copilot-chat`

其中：

- 本地文件用于检测当前 Windows 账户是否已登录 GitHub Copilot
- 远程刷新会返回账号、套餐、SKU 以及 `premium_interactions` 配额快照
- 如果存在有限的 premium requests 配额，首页会突出显示 `剩余百分比`
- 剩余调用次数、已用量与总量会作为次级信息展示

#### OpenRouter

- 优先读取应用本地配置文件中的 `OpenRouter API Key`
- 若本地配置不存在，则回退读取 `OPENROUTER_API_KEY` 环境变量
- 调用 `https://openrouter.ai/api/v1/credits` 刷新 Credit
- 未配置时会在 OpenRouter 主界面直接显示填写表单
- 首页优先展示 `剩余 Credit`，并在可用时展示 `已用/总量` 与百分比

#### Custom Provider

- 面向 `OpenAI-compatible` 服务
- 优先读取应用本地配置文件中的 `Display Name / Base URL / API Key`
- 若本地配置不存在但存在 `OPENAI_API_KEY`，则回退为官方 OpenAI 默认校验模式
- 会根据 `Base URL` 自动识别 `DeepSeek / Kimi / GLM` 并调用对应余额端点
- 识别成功时可返回可用余额；未知厂商时仍会回退到通用校验模式

#### API 平台配置

- 本地配置文件路径：`%LocalAppData%\Agent Limit\provider-settings.json`
- 配置优先级：`本地配置 > 环境变量回退`

#### 语言实现

- 前端维护本地 locale 状态
- 首次启动根据 `navigator.language` 自动选择默认语言
- 用户手动切换后，语言偏好会持久化到本地存储
- 前端调用 Tauri 命令时会传入 locale，后端告警和 Provider 文案也会同步切换

## 5.目录架构

```text
scripts/                 打包辅助脚本
src/                     前端（React + TypeScript）
  App.tsx                主界面与语言状态
  i18n.ts                前端本地化与格式化工具
  lib/api.ts             Tauri invoke 封装
  types/                 统一类型定义
  components/            预留 UI 组件目录
  styles.css             全局样式

src-tauri/               Tauri v2 / Rust 后端
  src/
    lib.rs               Tauri 命令注册
    locale.rs            后端 locale 解析
    models.rs            统一数据模型
    environment.rs       本地环境诊断
    provider_settings.rs API 平台 Provider 本地配置存储
    providers/
      api_platform/        API 平台公共逻辑（API Key、HTTP、脱敏）
      codex.rs           Codex 适配器
      github_copilot.rs  GitHub Copilot 适配器
      openrouter.rs      OpenRouter 适配器
      custom_provider.rs 自定义 OpenAI-compatible Provider 适配器
      mod.rs             Provider 注册表

dist/                    前端构建产物
```

## 6.开发说明

- 技术栈：`Tauri v2`、`React`、`TypeScript`、`Vite`、`Rust`
- 前后端共用统一 Provider 数据结构，前端不直接依赖某个平台私有接口
- 新增 Provider 时，原则上只需要：
  1. 在 Rust 侧新增适配器
  2. 返回统一的账号 / 套餐 / 配额结构
  3. 在 Provider 注册表中挂载
- 当前中英文切换覆盖：
  - 前端静态文案
  - Provider 描述信息
  - 环境诊断告警
  - 日期、倒计时、配额格式化

## 7.后续更新计划

- 增加托盘模式
- 增加自动刷新
- 增加历史记录与变化趋势
- 增加更多 Provider / 多账号支持

[↑ 回到顶部](#agent-limit)

---

#### English

## Project Summary

If you use multiple AI coding tools every day, you probably hit the same friction:

- You pay for plans or credits, but still can’t quickly tell what’s left right now
- Quota info is scattered across different apps and dashboards
- You only notice limits when you’re already close to cutoff

`Agent Limit` is a local Windows desktop app built to solve exactly that.  
It gives you one unified view of the AI agent accounts already signed in on your PC, including account, plan, remaining quota, reset time, and countdown, so you can keep coding without quota guesswork.

Supported providers:

- `Codex`
- `GitHub Copilot`
- `OpenRouter`
- `Custom Provider` (OpenAI-compatible)

This version adds a full UI upgrade:

- Dedicated settings view for language and theme selection
- `System / Dark / Light` theme support
- Provider logo display with custom vendor auto-matching
- Remaining quota progress-ring visualization

## Features

- Unified view of account, plan, quota, reset time, and countdown
- Dedicated `Settings` view for language and appearance controls
- Top-level language switcher for `English / 简体中文`
- `System / Dark / Light` theme modes with system-follow support
- Default language derived from the system locale, then persisted after the user changes it
- Manual refresh for the current provider and environment diagnostics
- `Dashboard / Details` dual-view UI
- `OpenRouter` can now be configured directly from its dashboard without a command-line setup step
- `Custom Provider` includes an in-app graphical form for `Display Name / Base URL / API Key`
- Provider tabs now include logos; custom provider auto-maps `Kimi / DeepSeek / GLM` logos
- Remaining card now includes a progress ring for quick quota visibility
- Environment diagnostics for local `WebView2`, `Codex`, `GitHub Copilot`, and API key configuration state
- Unified backend provider model for future expansion

## Download & Usage

#### End users

1. Download the Windows installer from the Releases page.
2. Run the installer and launch the app.
3. If `WebView2 Runtime` is missing, the app may require installation of the runtime first.
4. If the app shows no sign-in or no quota data, sign in to the relevant service on this machine and then click `Refresh`.

Portable build:

- If you have the single-file build `Agent Limit.exe`, you can run it directly.

#### Developers

Run in development:

```bash
npm install
npm run tauri dev
```

To test API-platform providers, the recommended path is now to enter their settings directly in the app UI.

For compatibility, you can still set environment variables in the terminal first (Windows PowerShell):

```powershell
$env:OPENROUTER_API_KEY="your-openrouter-key"
$env:OPENAI_API_KEY="your-openai-key"
```

Build the frontend:

```bash
npm run build
```

Build the installer:

```bash
npm run build:installer
```

Export the root-level executable and installer:

```bash
npm run build:root-exe
```

Release and cleanup flow (recommended since `v0.1.2`):

```bash
cd src-tauri && cargo test
cd ..
npm run build
npm run build:root-exe
```

After confirming `Agent Limit.exe` launches correctly, publish artifacts:

```bash
gh release create v0.1.2 "Agent Limit.exe" "Agent Limit Setup.exe" --title "v0.1.2" --notes "See README for highlights."
```

Optional deep cleanup after publishing:

```powershell
Remove-Item -Recurse -Force .\dist, .\src-tauri\target, .\node_modules
Remove-Item -Force ".\Agent Limit.exe", ".\Agent Limit Setup.exe"
```

## How It Works

#### Codex

The app reads local Codex files first:

- `C:\Users\<your-username>\.codex\auth.json`
- `C:\Users\<your-username>\.codex\config.toml`
- `C:\Users\<your-username>\.codex\sessions\**\*.jsonl`

Where:

- account and plan information mainly come from local auth context
- limit-window usage is derived from the latest local `token_count` event
- the UI shows `remaining percentage in the current limit window`, not billing balance

#### GitHub Copilot

The app reads local sign-in files, then refreshes account data from GitHub using the local session:

- `C:\Users\<your-username>\AppData\Local\github-copilot\apps.json`
- `C:\Users\<your-username>\AppData\Local\github-copilot\oauth.json`
- `C:\Users\<your-username>\.copilot\session-state\**\*.jsonl`
- `C:\Users\<your-username>\AppData\Roaming\Code\User\globalStorage\github.copilot-chat`

Where:

- local files detect whether the current Windows account is signed in
- remote refresh returns account, plan, SKU, and `premium_interactions` quota snapshots
- when a finite premium-requests quota exists, the dashboard highlights `remaining percentage`
- remaining requests, used, and total values are shown as secondary detail

#### OpenRouter

- Reads the configured OpenRouter API key from app-local settings first
- Falls back to `OPENROUTER_API_KEY` when no local config is stored
- Fetches credit data from `https://openrouter.ai/api/v1/credits`
- Shows an inline setup form on the OpenRouter dashboard when the key is missing
- Dashboard prioritizes `remaining credits` with used/total and percentage metadata when available

#### Custom Provider

- Targets `OpenAI-compatible` services instead of only the official OpenAI API
- Reads `Display Name / Base URL / API Key` from app-local settings first
- Falls back to the official OpenAI API only when `OPENAI_API_KEY` exists and no local custom-provider config is stored
- Auto-detects `DeepSeek / Kimi / GLM` from base URL and queries known vendor balance endpoints
- Falls back to generic validation mode when the vendor is unknown

#### API Platform Configuration

- Local settings file: `%LocalAppData%\Agent Limit\provider-settings.json`
- Precedence: `local config > environment variable fallback`
- Missing API-key warnings are shown only inside the matching provider UI instead of as global top-of-page banners

#### Language Support

- The frontend keeps a local locale state and currently supports only `en` and `zh-CN`
- The initial locale is derived from `navigator.language`
- After a manual switch, the chosen language is persisted locally
- The frontend passes locale into Tauri commands so backend warnings and provider messages also switch language

## Project Structure

```text
scripts/                 Build helper scripts
src/                     Frontend (React + TypeScript)
  App.tsx                Main UI and locale state
  i18n.ts                Frontend localization and formatting helpers
  lib/api.ts             Tauri invoke wrappers
  types/                 Shared type definitions
  components/            Reserved UI component directory
  styles.css             Global styles

src-tauri/               Tauri v2 / Rust backend
  src/
    lib.rs               Tauri command registration
    locale.rs            Backend locale parsing
    models.rs            Shared data model
    environment.rs       Local environment diagnostics
    provider_settings.rs Local settings storage for API-platform providers
    providers/
      api_platform/        Shared helpers for API-key providers
      codex.rs           Codex adapter
      github_copilot.rs  GitHub Copilot adapter
      openrouter.rs      OpenRouter adapter
      custom_provider.rs Custom OpenAI-compatible provider adapter
      mod.rs             Provider registry

dist/                    Frontend build output
```

## Development Notes

- Stack: `Tauri v2`, `React`, `TypeScript`, `Vite`, `Rust`
- The frontend depends on a unified provider shape instead of provider-specific UI contracts
- To add a new provider, you typically only need to:
  1. add a Rust adapter
  2. return the shared account / plan / quota structure
  3. register it in the provider registry
- Current bilingual coverage includes:
  - frontend static UI text
  - provider descriptions
  - environment warning messages
  - date, countdown, and quota formatting

## Roadmap

- Add tray mode
- Add auto refresh
- Add history and trend views
- Add more providers and multi-account support

[↑ Back to top](#agent-limit)
