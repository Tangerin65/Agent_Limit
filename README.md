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

## 目录结构

```text
src/                前端界面
src-tauri/          Tauri / Rust 后端
src-tauri/src/providers/
                     Provider 适配器
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

- `github-copilot`
- `openrouter`

当前这两个 Provider 已保留统一适配器入口，但尚未实现真实查询逻辑。

## 本地运行

在项目目录下执行：

```powershell
$env:PATH="C:\Users\a\.cargo\bin;$env:PATH"
npm run tauri dev
```

如果只想直接运行已构建的调试版：

```powershell
D:\Tangerin\Personal\Code\Agent_Limit\src-tauri\target\debug\agent-limit.exe
```

## 构建

```powershell
$env:PATH="C:\Users\a\.cargo\bin;$env:PATH"
npm exec tauri build -- --debug
```

构建完成后，可执行文件位于：

```text
src-tauri\target\debug\agent-limit.exe
```

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
- 增加历史记录与变化趋势
- 增加多账号 / 多 Provider 切换
