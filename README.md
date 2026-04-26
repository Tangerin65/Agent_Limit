# Agent Limit

`Agent Limit` 是一个面向 Windows 的本地桌面工具，用来查看当前电脑上已登录的 AI Agent 账号额度情况。

一期重点支持 `Codex`，可以直接读取本机 `codex` 登录状态与本地会话限额信息，展示：

- 当前账号
- 当前套餐
- 当前限额窗口已用比例
- 当前限额窗口剩余比例
- 重置时间
- 手动刷新获取

同时，项目已经预留了后续扩展接口，便于继续接入：

- GitHub Copilot
- OpenRouter
- 其他基于 API Key 或网页登录态的额度来源

## 当前实现方式

当前版本不会调用公开账单接口，而是优先读取本机已有的 Codex 本地数据：

- `C:\Users\<你的用户名>\.codex\auth.json`
- `C:\Users\<你的用户名>\.codex\config.toml`
- `C:\Users\<你的用户名>\.codex\sessions\**\*.jsonl`

其中：

- 账号和套餐信息主要来自本地认证上下文
- 剩余额度来自最新一次本地 `token_count` 事件中的 `rate_limits.primary.used_percent`

因此，这一版显示的是 `Codex 当前限额窗口的剩余百分比`，而不是 OpenAI 控制台上的账单余额。

## 技术栈

- `Tauri v2`
- `React`
- `TypeScript`
- `Vite`
- `Rust`

## 运行方式

### 普通用户（推荐）

1. 前往项目的 Releases 页面，下载 Windows 安装包（NSIS，通常是 `*.exe`）。
2. 双击安装并启动。
3. 首次运行可能会自动安装/拉取 WebView2 运行时（Tauri 配置为静默下载），需要联网一次。
4. 若页面提示未登录/无数据：请先在本机完成 Codex 登录（确保存在 `C:\Users\<你的用户名>\.codex\...` 相关文件），再回到软件里点“刷新”。

> 如果你拿到的是便携版单文件（`Agent Limit.exe`），直接双击运行即可。

### 开发者（从源码运行/打包）

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

## 目录结构

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
        providers/             Provider 适配器（一期 codex + 预留入口）
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

## 已支持能力

### Codex

- 检测本机是否已登录 Codex
- 读取当前账号基础信息
- 读取套餐类型
- 读取本地最新限额窗口使用比例
- 计算剩余百分比
- 手动刷新

### 预留 Provider

- `Github Copilot`
- `OpenRouter`

当前这两个 Provider 已保留统一适配器入口，但尚未实现真实查询逻辑。


## 开发说明

项目采用统一 Provider 数据模型，前端不直接依赖某个具体平台。后续新增额度来源时，原则上只需要：

1. 在 Rust 侧新增一个 Provider 适配器
2. 返回统一的账号 / 套餐 / 额度结构
3. 在注册表中挂载该 Provider

这样可以保证 UI 不需要为每个平台单独重写。

## 后续计划

- 接入 GitHub Copilot 额度查询
- 接入 OpenRouter 余额查询
- 增加托盘模式
- 增加自动刷新
- 前端界面优化
- 增加历史记录与变化趋势
- 增加多账号 / 多 Provider 切换
