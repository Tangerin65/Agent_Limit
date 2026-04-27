  # GitHub Copilot Provider Integration

  ## Summary

  实现 GitHub Copilot provider，采用你确认的混合方案：

  - 本地文件负责检测登录态、账号信息、可用客户端环境
  - 在线查询负责获取 Copilot 当前真实额度
  - 额度对象统一定义为 premium requests，并按 GitHub 文档语义展示月度已用/剩余与重置时间
    参考：https://docs.github.com/en/copilot/concepts/billing/copilot-requests、https://docs.github.com/en/copilot/how-tos/premium-requests/monitoring-your-
    copilot-usage-and-entitlements

  ## Key Changes

  - 在 Rust 侧新增 github_copilot provider，并替换当前 planned 占位注册。
  - 本地检测路径固定为三类：
      - C:\Users\<user>\AppData\Local\github-copilot\
      - C:\Users\<user>\.copilot\
      - C:\Users\<user>\AppData\Roaming\Code\User\globalStorage\github.copilot-chat\
  - 账号识别规则固定为：
      - 优先读取 apps.json / oauth.json
      - 取可解析且最近可用的 GitHub 账号作为 account.identifier
      - email 允许缺失，不因缺少邮箱判失败
      - 任何 token 只用于内存中的请求头，不写入 rawMeta，不回传前端
  - 额度查询规则固定为：
      - 统一展示 Copilot 的 premium requests
      - 在线调用使用本地登录态中的 GitHub OAuth token
      - 若能拿到 usage + entitlement，则填充：
          - quota.total = 月度总 premium requests
          - quota.used = 当前月已用
          - quota.remaining = 剩余
          - quota.unit = requests
      - 若在线 usage 查询失败但本地登录态存在，provider 状态设为 degraded，账号可见、额度设为 unavailable
  - 降级与告警固定为：
      - 本地未登录：degraded，提示未检测到 Copilot 登录态
      - 只要 quota 不可信，confidence 不设为 high
  - 诊断扩展固定为：
      - 在 EnvironmentDiagnostics 中加入 Copilot 环境项，至少包含根目录、关键文件存在性、会话目录存在性
  - 前端改动保持最小：
      - 不改统一卡片结构
      - 仅确保 requests 单位、非百分比剩余值、以及 Copilot 的 warning/message 在现有 UI 中可读
      - 若当前 formatPercent 只适合 Codex，需要改为按 quota.unit 分支显示

  ## Test Plan

  - Rust 单元测试：
      - 本地 apps.json / oauth.json 解析正常与缺字段场景
      - 本地无登录文件时返回 degraded
      - usage 响应成功时正确映射 plan/quota/resetAt
      - usage 缺少 reset 时间时回退到每月 1 日 00:00:00 UTC
      - 401 / 网络失败时返回 degraded 且不泄露 token
  - 集成验证：
      - get_registered_providers 中 github-copilot 从 planned 变为 ready 或 degraded
      - refresh_provider("github-copilot") 在三种场景下行为正确：
          - 已登录且可查询
          - 已登录但查询失败
          - 未登录
  - 前端验证：
      - Copilot 选中后能显示账号、计划、剩余额度、重置时间
      - 非百分比单位不会被错误渲染成 %

  ## Assumptions

  - Copilot 部分不坚持纯离线；真实额度以在线 usage/entitlement 为准。
  - 不把任何本地 token、完整响应体、敏感请求头暴露到前端或日志。
  - 若 GitHub 当前在线 usage 接口与本机已安装 Copilot 扩展实际调用契约不一致，仍按“账号可见、额度降级 unavailable”的策略收口，不回退为伪造额度。
  - 重置时间的默认语义采用 GitHub 文档当前规则：每月 1 日 00:00:00 UTC。