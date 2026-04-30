# AGENTS.md

本文档用于帮助后续 AI 代理快速理解并安全修改 `Agent Limit` 项目。

## 1. 项目概览

- 项目名称：`Agent Limit`
- 形态：`Windows` 本地桌面应用
- 目标：统一展示当前电脑上已登录 AI Agent 账号的套餐、配额、重置时间和环境诊断信息
- 当前已实现 Provider：
  - `Codex`
  - `GitHub Copilot`
  - `OpenRouter`
  - `Custom Provider`（OpenAI-compatible）

这个项目的核心特点不是“远程 SaaS 仪表盘”，而是“读取本机已有登录态和本地缓存，再补充必要的远程刷新”，因此很多功能都和本地文件结构、Windows 环境、以及第三方客户端登录状态强相关。

## 2. 技术栈

- 前端：`React 19` + `TypeScript` + `Vite`
- 桌面壳：`Tauri v2`
- 后端：`Rust`
- 网络请求：Rust 侧 `reqwest` 阻塞客户端
- 本地文件遍历：Rust 侧 `walkdir`
- Windows 诊断：`winreg`

## 3. 项目目录

```text
src/                         前端源码
  App.tsx                    主页面、状态管理、刷新逻辑、视图切换
  i18n.ts                    中英文文案、时间/百分比/配额格式化
  main.tsx                   React 入口
  styles.css                 全局样式
  components/
    ProviderCard.tsx         Provider 卡片组件（当前主流程中基本未使用）
  lib/
    api.ts                   Tauri invoke 封装
  types/
    provider.ts              前端使用的数据结构定义

src-tauri/                   Tauri / Rust 后端
  Cargo.toml                 Rust 依赖与构建配置
  tauri.conf.json            应用名、窗口、打包目标、构建命令
  src/
    lib.rs                   Tauri 命令注册入口
    main.rs                  桌面程序入口
    error.rs                 统一错误类型
    locale.rs                Rust 侧 locale 解析
    models.rs                前后端共享的序列化模型
    environment.rs           本地环境诊断
    providers/
      mod.rs                 Provider 注册表与 trait
      api_platform/
        mod.rs               API 平台公共逻辑（API Key、HTTP、脱敏）
      codex.rs               Codex 适配器
      github_copilot.rs      GitHub Copilot 适配器
      openrouter.rs          OpenRouter 适配器
      custom_provider.rs     自定义 OpenAI-compatible Provider 适配器
    provider_settings.rs     API 平台 Provider 本地配置存储

scripts/
  export-root-exe.ps1        将构建产物复制到仓库根目录

dist/                        前端构建产物
releases/                    发布相关产物目录（当前未跟踪）
```

## 4. 运行与构建

常用命令：

```bash
npm install
npm run tauri dev
npm run build
npm run build:installer
npm run build:root-exe
```

说明：

- `npm run dev` 启动 Vite，端口固定为 `1420`
- `npm run tauri dev` 会先启动前端开发服务器，再启动桌面应用
- `npm run build` 先跑 `tsc` 再跑 `vite build`
- `npm run build:installer` 调用 `tauri build` 生成 `nsis` 安装包
- `npm run build:root-exe` 除了打包，还会执行 [scripts/export-root-exe.ps1](D:/Tangerin/Personal/Code/Agent_Limit/scripts/export-root-exe.ps1) 将最新 exe 和安装包复制到仓库根目录

交付要求：

- 任何会影响可发布产物的修改，在结束前优先执行可用自动校验
- 当前最小校验链路为：`cargo test` -> `npm run build`
- 若校验通过，默认继续执行 `npm run build:root-exe`
- 最终应保证项目根目录中的 `Agent Limit.exe` 和安装包为最新产物

## 5. 前后端交互模型

前端不会直接访问 Provider 私有接口，而是通过 Tauri 命令获取统一数据结构。

当前公开命令包括，定义在 [src-tauri/src/lib.rs](D:/Tangerin/Personal/Code/Agent_Limit/src-tauri/src/lib.rs)：

- `get_registered_providers(locale)`
- `refresh_provider(provider_id, locale)`
- `get_environment_diagnostics(locale)`
- `get_provider_settings(locale)`
- `save_provider_settings(provider_id, payload, locale)`
- `clear_provider_settings(provider_id, locale)`

前端封装位于 [src/lib/api.ts](D:/Tangerin/Personal/Code/Agent_Limit/src/lib/api.ts)。

统一模型定义：

- Rust： [src-tauri/src/models.rs](D:/Tangerin/Personal/Code/Agent_Limit/src-tauri/src/models.rs)
- TypeScript： [src/types/provider.ts](D:/Tangerin/Personal/Code/Agent_Limit/src/types/provider.ts)

后续修改时，优先保持这两端字段语义一致，避免只改一侧导致序列化或显示异常。

## 6. 前端结构与行为

主界面集中在 [src/App.tsx](D:/Tangerin/Personal/Code/Agent_Limit/src/App.tsx)，它负责：

- 管理当前语言、当前 Provider、当前快照、环境诊断、错误信息
- 首次加载 Provider 列表与默认 Provider 数据
- 在 `dashboard` / `details` 之间切换
- 每秒刷新倒计时显示
- 根据 Provider 类型决定主展示指标

重要行为：

- 默认 Provider 是 `codex`
- 语言只支持 `en` 和 `zh-CN`
- 语言优先级：本地存储 > 系统语言
- 语言存储 key：`agent-limit.locale`
- `GitHub Copilot` 在首页优先展示 `remaining percentage`
- 其他 Provider 默认优先展示 `remaining`

本地化实现位于 [src/i18n.ts](D:/Tangerin/Personal/Code/Agent_Limit/src/i18n.ts)。如果新增字段或 UI，必须同步补齐中英文文案与格式化逻辑。

注意：

- [src/components/ProviderCard.tsx](D:/Tangerin/Personal/Code/Agent_Limit/src/components/ProviderCard.tsx) 当前更像保留组件，主页面并未依赖它驱动 Provider 切换
- 前端样式集中在 `styles.css`，如果改布局，优先保持当前桌面信息面板风格一致

## 7. Provider 架构

Provider 抽象定义在 [src-tauri/src/providers/mod.rs](D:/Tangerin/Personal/Code/Agent_Limit/src-tauri/src/providers/mod.rs)：

- `ProviderAdapter::descriptor(locale)`：返回 Provider 基本信息与能力声明
- `ProviderAdapter::refresh(locale)`：返回当前账号、套餐、配额、警告和原始元数据

注册表 `registry()` 当前挂载：

- `CodexProvider`
- `GitHubCopilotProvider`
- `OpenRouterProvider`
- `CustomProvider`

新增 Provider 的标准步骤：

1. 在 `src-tauri/src/providers/` 下新增适配器文件
2. 实现 `ProviderAdapter`
3. 返回统一 `ProviderSnapshot`
4. 在 `registry()` 中注册
5. 如果需要新字段，先改 Rust `models.rs`，再改前端 `types/provider.ts` 和 UI

建议保持一个原则：

- Provider 负责“取数、归一化、给出告警”
- 前端负责“展示、格式化、交互”
- 不要把 Provider 私有逻辑散落到前端条件分支里

## 8. Codex Provider 说明

实现文件： [src-tauri/src/providers/codex.rs](D:/Tangerin/Personal/Code/Agent_Limit/src-tauri/src/providers/codex.rs)

主要数据来源：

- `~/.codex/auth.json`
- `~/.codex/config.toml`
- `~/.codex/sessions/**/*.jsonl`

实现要点：

- 登录身份主要从 `auth.json` 和 JWT claims 推断
- 套餐类型可能来自 JWT，也可能来自最新 session rate limit
- 配额并不是账单余额，而是从本地 `token_count` 事件中的 `rate_limits.primary.used_percent` 推算
- 当前 UI 展示的是“当前限额窗口剩余百分比”

重要限制：

- 如果本地还没有任何 `token_count` 事件，则配额会显示不可用
- 如果认证方式不是 `chatgpt`，套餐信息可能不完整
- 检测到本地 `OPENAI_API_KEY` 时，当前实现仍优先使用 ChatGPT/Codex 登录态

这部分逻辑对本地文件格式非常敏感。修改前应优先保持向后兼容，不要轻易假设 `jsonl` 行结构稳定不变。

## 9. GitHub Copilot Provider 说明

实现文件： [src-tauri/src/providers/github_copilot.rs](D:/Tangerin/Personal/Code/Agent_Limit/src-tauri/src/providers/github_copilot.rs)

主要数据来源：

- `AppData/Local/github-copilot/apps.json`
- `AppData/Local/github-copilot/oauth.json`
- `~/.copilot/session-state/**/*.jsonl`
- `AppData/Roaming/Code/User/globalStorage/github.copilot-chat`

实现方式：

- 先从本地文件读取登录态和 token
- 再调用 `https://api.github.com/copilot_internal/user` 刷新远程套餐和配额信息
- 优先解析 `quota_snapshots.premium_interactions`

重要限制：

- 若远程请求失败，Provider 会降级，但仍保留本地账号检测结果
- 某些套餐场景下可能没有可计算的有限 `premium requests` 配额
- 重置时间可能来自 `quota_reset_at`、`quota_reset_date_utc`、`quota_reset_date`，最后才回退到“下个月 1 号”

后续若修改此模块，重点关注：

- GitHub 返回字段的兼容性
- 请求失败时的降级体验
- 不要把 token、完整响应等敏感信息直接输出到前端或日志

## 10. 环境诊断逻辑

实现文件： [src-tauri/src/environment.rs](D:/Tangerin/Personal/Code/Agent_Limit/src-tauri/src/environment.rs)

诊断覆盖：

- `WebView2` 是否安装
- `Codex` 本地认证、配置、会话文件是否存在
- `GitHub Copilot` 本地登录文件、会话目录、VS Code 存储目录是否存在
- OpenRouter / Custom Provider 是否已配置（仅状态、来源和脱敏摘要，不输出明文）

注意点：

- `WebView2` 检查依赖 Windows 注册表
- 许多“未登录/无配额”的问题，本质上是本地文件缺失、Provider 本地配置未填写，或第三方客户端尚未生成会话数据
- 诊断文案也需要中英文同步
- API 平台类 “未配置 / 尚未设置” 提示应显示在对应 Provider 视图内，不应作为全局顶部条幅

## 11. 本地化约束

当前仅支持：

- `en`
- `zh-CN`

任何新增字段、按钮、告警、状态文本，至少要同步修改：

- [src/i18n.ts](D:/Tangerin/Personal/Code/Agent_Limit/src/i18n.ts)
- Rust 侧硬编码的 `locale.text(...)` 文案

如果只改前端静态文本、不改 Rust 侧告警，最终界面会出现中英文混杂。

## 12. 修改建议

后续 AI 修改本项目时，优先遵守以下原则：

- 先确认改动发生在前端、Provider、还是共享模型层，不要混改
- 涉及字段新增或重命名时，Rust 和 TypeScript 两侧一起改
- 涉及 Provider 行为时，优先补充 `raw_meta`，方便 UI 和调试观察
- 涉及配额展示时，先明确单位是 `%`、`requests` 还是其他数值
- 涉及语言或告警时，保证 `en` / `zh-CN` 双语完整
- 涉及 API 平台 Provider 配置时，优先复用 `%LocalAppData%/Agent Limit/provider-settings.json`，并保留环境变量作为兼容回退
- 涉及 “未配置 / 尚未设置” 类文案时，优先放到对应 Provider 视图，而不是全局 warnings
- 涉及本地文件读取时，优先容错，避免因为单个文件格式变化导致整个 Provider 崩溃
- 涉及远程请求时，必须设计降级路径，保证应用仍可打开并显示问题原因

## 13. 常见任务入口

如果要做不同类型的需求，建议优先查看这些文件：

- 改首页展示或详情页布局： [src/App.tsx](D:/Tangerin/Personal/Code/Agent_Limit/src/App.tsx)
- 改文案或时间/数值格式： [src/i18n.ts](D:/Tangerin/Personal/Code/Agent_Limit/src/i18n.ts)
- 改前后端调用： [src/lib/api.ts](D:/Tangerin/Personal/Code/Agent_Limit/src/lib/api.ts)
- 改共享字段： [src/types/provider.ts](D:/Tangerin/Personal/Code/Agent_Limit/src/types/provider.ts) 和 [src-tauri/src/models.rs](D:/Tangerin/Personal/Code/Agent_Limit/src-tauri/src/models.rs)
- 改诊断逻辑： [src-tauri/src/environment.rs](D:/Tangerin/Personal/Code/Agent_Limit/src-tauri/src/environment.rs)
- 新增或修改 Codex 数据来源： [src-tauri/src/providers/codex.rs](D:/Tangerin/Personal/Code/Agent_Limit/src-tauri/src/providers/codex.rs)
- 新增或修改 Copilot 数据来源： [src-tauri/src/providers/github_copilot.rs](D:/Tangerin/Personal/Code/Agent_Limit/src-tauri/src/providers/github_copilot.rs)
- 新增或修改 OpenRouter 数据来源： [src-tauri/src/providers/openrouter.rs](D:/Tangerin/Personal/Code/Agent_Limit/src-tauri/src/providers/openrouter.rs)
- 新增或修改自定义 OpenAI-compatible Provider： [src-tauri/src/providers/custom_provider.rs](D:/Tangerin/Personal/Code/Agent_Limit/src-tauri/src/providers/custom_provider.rs)
- 维护 Provider 本地配置存储： [src-tauri/src/provider_settings.rs](D:/Tangerin/Personal/Code/Agent_Limit/src-tauri/src/provider_settings.rs)
- 维护 API 平台公共层： [src-tauri/src/providers/api_platform/mod.rs](D:/Tangerin/Personal/Code/Agent_Limit/src-tauri/src/providers/api_platform/mod.rs)
- 增加新 Provider： [src-tauri/src/providers/mod.rs](D:/Tangerin/Personal/Code/Agent_Limit/src-tauri/src/providers/mod.rs)
- 改窗口或打包行为： [src-tauri/tauri.conf.json](D:/Tangerin/Personal/Code/Agent_Limit/src-tauri/tauri.conf.json)

## 14. 当前仓库状态提醒

在编写本文档时，工作区存在非本文档引入的现有变化：

- `src-tauri/Cargo.toml` 已修改
- `releases/` 为未跟踪目录

后续 AI 在提交代码前，应先确认这些改动是否属于用户已有工作，避免误覆盖或误清理。

## 15. 建议补充但目前缺失的内容

当前仓库里可以看到单元测试样例主要集中在 Provider Rust 文件内部，但尚未看到完整的自动化校验说明。后续若有时间，建议补：

- 统一测试命令说明
- Provider 样例输入与回归测试数据
- 模拟本地文件缺失/损坏的测试
- Copilot 远程接口失败时的回归测试
- 新 Provider 接入模板

---

如果你是后续接手的 AI，建议先读 `README.md` 了解产品目标，再按本文件的“常见任务入口”定位代码，最后再进行最小范围修改。
