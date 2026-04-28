# Agent Limit

<p align="center">
  <strong>语言 / Language:</strong>
  <a href="#简体中文">简体中文</a> | <a href="#english">English</a>
</p>

---

#### 简体中文

## 1.项目简介

`Agent Limit` 是一个面向 Windows 的本地桌面工具，用来查看当前电脑上已登录 AI Agent 账号的额度状态。

当前已支持：

- `Codex`
- `GitHub Copilot`



## 2.功能介绍

- 统一展示当前账号、套餐、配额、重置时间与倒计时
- 支持在顶部设置中切换 `English / 简体中文`
- 默认根据系统语言决定界面语言，之后记住用户选择
- 支持手动刷新当前 Provider 数据与环境诊断
- 支持 `Dashboard / Details` 双视图
- 支持环境诊断，检测 `WebView2`、`Codex`、`GitHub Copilot` 本地状态
- 后端使用统一 Provider 数据模型，便于后续扩展更多额度来源

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

#### 语言实现

- 前端维护本地 locale 状态，只支持 `en` 与 `zh-CN`
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
    providers/
      codex.rs           Codex 适配器
      github_copilot.rs  GitHub Copilot 适配器
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

- 接入 OpenRouter 真实额度查询
- 增加托盘模式
- 增加自动刷新
- 增加历史记录与变化趋势
- 增加更多 Provider / 多账号支持

[↑ 回到顶部](#agent-limit)

---

#### English

## Project Summary

`Agent Limit` is a local Windows desktop app for checking quota status of AI agent accounts currently signed in on your PC.

Supported providers:

- `Codex`
- `GitHub Copilot`

This version adds two important UX improvements:

- Full `English / Simplified Chinese` support, with the default language chosen from the system language on first launch
- A redesigned `GitHub Copilot` dashboard where `remaining percentage` is the primary hero metric and remaining requests are shown as secondary detail

## Features

- Unified view of account, plan, quota, reset time, and countdown
- Top-level language switcher for `English / 简体中文`
- Default language derived from the system locale, then persisted after the user changes it
- Manual refresh for the current provider and environment diagnostics
- `Dashboard / Details` dual-view UI
- Environment diagnostics for local `WebView2`, `Codex`, and `GitHub Copilot` state
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
    providers/
      codex.rs           Codex adapter
      github_copilot.rs  GitHub Copilot adapter
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

- Add real OpenRouter quota querying
- Add tray mode
- Add auto refresh
- Add history and trend views
- Add more providers and multi-account support

[↑ Back to top](#agent-limit)
