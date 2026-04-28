import { useEffect, useState, useTransition } from "react";
import {
  getEnvironmentDiagnostics,
  getRegisteredProviders,
  refreshProvider
} from "./lib/api";
import type {
  EnvironmentDiagnostics,
  ProviderDescriptor,
  ProviderSnapshot
} from "./types/provider";

const DEFAULT_PROVIDER = "codex";
const TEXT = {
  subtitle: "本机 Agent 配额监视器",
  providerSwitcher: "Provider 切换",
  refresh: "刷新",
  refreshing: "刷新中...",
  details: "详情",
  back: "返回",
  loadingRegistry: "正在加载本地 Provider 列表...",
  provider: "Provider",
  account: "账号",
  plan: "套餐",
  remaining: "剩余",
  resetTime: "重置时间",
  due: "已到期",
  providerDetails: "Provider 详情",
  environment: "环境诊断",
  accountDetails: "账号详情",
  planDetails: "套餐详情",
  quotaDetails: "配额详情",
  warnings: "告警",
  rawMetadata: "原始元数据",
  noWarnings: "当前 Provider 没有告警。",
  noRawMetadata: "当前 Provider 没有原始元数据。",
  noProviderMessage: "当前 Provider 没有额外说明。",
  yes: "是",
  no: "否",
  planned: "计划中",
  detected: "已检测到",
  notDetected: "未检测到",
  unavailable: "--",
  message: "消息",
  capabilities: "能力",
  lastUpdate: "上次更新时间",
  webview2Installed: "WebView2 已安装",
  webview2Version: "WebView2 版本",
  registryPath: "注册表路径",
  codexAuth: "Codex 认证",
  codexConfig: "Codex 配置",
  sessionFiles: "会话文件数",
  authPath: "认证路径",
  sessionsRoot: "会话目录",
  copilotApps: "Copilot Apps",
  copilotOAuth: "Copilot OAuth",
  copilotSessionFiles: "Copilot 会话文件数",
  copilotAppsPath: "Copilot Apps 路径",
  copilotSessionRoot: "Copilot 会话目录",
  email: "邮箱",
  identifier: "标识",
  authMode: "认证方式",
  sourcePath: "来源路径",
  name: "名称",
  tier: "层级",
  cycle: "周期",
  renewal: "续期时间",
  source: "来源",
  status: "状态",
  used: "已用",
  total: "总量",
  countdown: "倒计时",
  confidence: "置信度",
  note: "备注",
  percentRemaining: "剩余百分比",
  percentUsed: "已用百分比",
  statusReady: "可用",
  statusDegraded: "降级",
  statusPlanned: "计划中",
  statusUnavailable: "不可用",
  statusUnknown: "未知",
  capabilityOn: "开启",
  capabilityOff: "关闭"
} as const;

function formatQuotaValue(value?: number | null, unit?: string | null) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return TEXT.unavailable;
  }

  if (unit === "%") {
    return `${value.toFixed(1)}%`;
  }

  if (unit === "requests") {
    return `${Math.round(value)} 次`;
  }

  return value.toFixed(1);
}

function formatQuotaMeta(
  used?: number | null,
  total?: number | null,
  unit?: string | null
) {
  if (typeof used !== "number" || Number.isNaN(used)) {
    return TEXT.unavailable;
  }

  if (unit === "%") {
    return `已用 ${used.toFixed(1)}%`;
  }

  if (unit === "requests") {
    if (typeof total === "number" && !Number.isNaN(total)) {
      return `已用 ${Math.round(used)} / ${Math.round(total)} 次`;
    }

    return `已用 ${Math.round(used)} 次`;
  }

  return `已用 ${used.toFixed(1)}`;
}

function formatPercent(value?: number | null) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return TEXT.unavailable;
  }

  return `${value.toFixed(1)}%`;
}

function formatDateTime(value?: string | null) {
  if (!value) {
    return TEXT.unavailable;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString("zh-CN");
}

function pad(value: number) {
  return value.toString().padStart(2, "0");
}

function formatCountdown(value: string | null | undefined, now: number) {
  if (!value) {
    return TEXT.unavailable;
  }

  const target = new Date(value).getTime();
  if (Number.isNaN(target)) {
    return TEXT.unavailable;
  }

  const diff = target - now;
  if (diff <= 0) {
    return TEXT.due;
  }

  const totalSeconds = Math.floor(diff / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (days > 0) {
    return `${days}天 ${pad(hours)}时 ${pad(minutes)}分 ${pad(seconds)}秒`;
  }

  return `${pad(hours)}时 ${pad(minutes)}分 ${pad(seconds)}秒`;
}

function getSelectedSnapshot(
  snapshot: ProviderSnapshot | null,
  selectedProvider: string
) {
  if (snapshot?.provider.id !== selectedProvider) {
    return null;
  }

  return snapshot;
}

function getAccountValue(
  provider: ProviderDescriptor | null,
  snapshot: ProviderSnapshot | null
) {
  if (snapshot?.account.email) {
    return snapshot.account.email;
  }

  if (snapshot?.account.identifier) {
    return snapshot.account.identifier;
  }

  if (snapshot?.account.detected) {
    return TEXT.detected;
  }

  if (provider?.status === "planned") {
    return TEXT.planned;
  }

  if (provider?.status === "degraded") {
    return TEXT.notDetected;
  }

  return TEXT.unavailable;
}

function getPlanValue(
  provider: ProviderDescriptor | null,
  snapshot: ProviderSnapshot | null
) {
  if (snapshot?.plan?.name) {
    return snapshot.plan.name;
  }

  if (snapshot?.plan?.tier) {
    return snapshot.plan.tier;
  }

  if (provider?.status === "planned") {
    return TEXT.planned;
  }

  return TEXT.unavailable;
}

function getStatusTone(status?: string) {
  switch (status) {
    case "ready":
      return "ready";
    case "degraded":
      return "degraded";
    case "planned":
      return "planned";
    default:
      return "muted";
  }
}

function formatStatus(status?: string) {
  switch (status) {
    case "ready":
      return TEXT.statusReady;
    case "degraded":
      return TEXT.statusDegraded;
    case "planned":
      return TEXT.statusPlanned;
    case "unavailable":
      return TEXT.statusUnavailable;
    default:
      return TEXT.statusUnknown;
  }
}

function formatPresence(value: boolean) {
  return value ? TEXT.yes : TEXT.no;
}

export default function App() {
  const [providers, setProviders] = useState<ProviderDescriptor[]>([]);
  const [selectedProvider, setSelectedProvider] = useState(DEFAULT_PROVIDER);
  const [snapshot, setSnapshot] = useState<ProviderSnapshot | null>(null);
  const [environmentDiagnostics, setEnvironmentDiagnostics] =
    useState<EnvironmentDiagnostics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false);
  const [viewMode, setViewMode] = useState<"dashboard" | "details">("dashboard");
  const [now, setNow] = useState(() => Date.now());
  const [isPending, startTransition] = useTransition();

  const handleRefresh = (providerId: string) => {
    setError(null);
    startTransition(() => {
      void Promise.all([
        refreshProvider(providerId),
        getEnvironmentDiagnostics().catch(() => null)
      ])
        .then(([result, diagnostics]) => {
          setSnapshot(result);
          if (diagnostics) {
            setEnvironmentDiagnostics(diagnostics);
          }
          setNow(Date.now());
        })
        .catch((refreshError) => {
          setError(
            refreshError instanceof Error
              ? refreshError.message
              : "刷新 Provider 失败。"
          );
        });
    });
  };

  useEffect(() => {
    void (async () => {
      try {
        const registered = await getRegisteredProviders();
        setProviders(registered);
        const diagnostics = await getEnvironmentDiagnostics().catch(() => null);
        if (diagnostics) {
          setEnvironmentDiagnostics(diagnostics);
        }
        const defaultProvider =
          registered.find((provider) => provider.id === DEFAULT_PROVIDER)?.id ??
          registered[0]?.id ??
          DEFAULT_PROVIDER;
        setSelectedProvider(defaultProvider);
        if (defaultProvider) {
          const result = await refreshProvider(defaultProvider);
          setSnapshot(result);
        }
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "初始化应用失败。");
      } finally {
        setInitialized(true);
      }
    })();
  }, []);

  useEffect(() => {
    if (!initialized || !selectedProvider) {
      return;
    }

    if (snapshot?.provider.id === selectedProvider) {
      return;
    }

    handleRefresh(selectedProvider);
  }, [initialized, selectedProvider, snapshot?.provider.id]);

  useEffect(() => {
    const resetAt = snapshot?.provider.id === selectedProvider ? snapshot?.quota?.resetAt : null;
    if (!resetAt) {
      return undefined;
    }

    setNow(Date.now());
    const timer = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);

    return () => {
      window.clearInterval(timer);
    };
  }, [selectedProvider, snapshot]);

  const activeProvider =
    providers.find((provider) => provider.id === selectedProvider) ?? null;
  const selectedSnapshot = getSelectedSnapshot(snapshot, selectedProvider);
  const statusTone = getStatusTone(selectedSnapshot?.provider.status ?? activeProvider?.status);
  const environmentWarnings = environmentDiagnostics?.warnings ?? [];
  const rawMeta = selectedSnapshot?.rawMeta
    ? JSON.stringify(selectedSnapshot.rawMeta, null, 2)
    : null;
  const hasQuotaPercentages =
    selectedSnapshot?.quota?.unit !== "%" &&
    (typeof selectedSnapshot?.quota?.percentRemaining === "number" ||
      typeof selectedSnapshot?.quota?.percentUsed === "number");

  return (
    <main className="app-shell">
      <div className="app-shell__glow app-shell__glow--cyan" />
      <div className="app-shell__glow app-shell__glow--amber" />

      <header className="topbar">
        <div className="topbar__title">
          <p className="topbar__eyebrow">Agent Limit</p>
          <h1>{TEXT.subtitle}</h1>
        </div>

        <div className="topbar__controls">
          <div className="provider-switch" role="tablist" aria-label={TEXT.providerSwitcher}>
            {providers.map((provider) => (
              <button
                key={provider.id}
                className={`provider-switch__item ${
                  provider.id === selectedProvider ? "provider-switch__item--active" : ""
                }`}
                onClick={() => {
                  setError(null);
                  setSelectedProvider(provider.id);
                }}
                type="button"
              >
                {provider.name}
              </button>
            ))}
          </div>

          <div className="topbar__actions">
            <button
              className="primary-button"
              disabled={!selectedProvider || isPending || !initialized}
              onClick={() => handleRefresh(selectedProvider)}
              type="button"
            >
              {isPending ? TEXT.refreshing : TEXT.refresh}
            </button>
            <button
              className="secondary-button"
              onClick={() =>
                setViewMode((current) =>
                  current === "dashboard" ? "details" : "dashboard"
                )
              }
              type="button"
            >
              {viewMode === "dashboard" ? TEXT.details : TEXT.back}
            </button>
          </div>
        </div>
      </header>

      {error ? <section className="banner banner--error">{error}</section> : null}

      {environmentWarnings.map((warning) => (
        <section key={warning} className="banner banner--warning">
          {warning}
        </section>
      ))}

      {!initialized && !error ? (
        <section className="banner">{TEXT.loadingRegistry}</section>
      ) : null}

      {viewMode === "dashboard" ? (
        <section className="dashboard-view">
          <section className="summary-grid">
            <article className="info-card">
              <div className="info-card__label">{TEXT.provider}</div>
              <div className="info-card__value">
                {selectedSnapshot?.provider.name ?? activeProvider?.name ?? TEXT.unavailable}
              </div>
            </article>

            <article className="info-card">
              <div className="info-card__label">{TEXT.account}</div>
              <div className="info-card__value">
                {getAccountValue(activeProvider, selectedSnapshot)}
              </div>
            </article>

            <article className="info-card">
              <div className="info-card__label">{TEXT.plan}</div>
              <div className="info-card__value">
                {getPlanValue(activeProvider, selectedSnapshot)}
              </div>
            </article>
          </section>

          <section className="metric-grid">
            <article className="metric-card metric-card--remaining">
              <div className="info-card__label">{TEXT.remaining}</div>
              <div className="metric-card__value metric-card__value--remaining">
                {formatQuotaValue(
                  selectedSnapshot?.quota?.remaining,
                  selectedSnapshot?.quota?.unit
                )}
              </div>
              <p className="metric-card__meta">
                {formatQuotaMeta(
                  selectedSnapshot?.quota?.used,
                  selectedSnapshot?.quota?.total,
                  selectedSnapshot?.quota?.unit
                )}
              </p>
              {hasQuotaPercentages ? (
                <p className="metric-card__submeta">
                  {TEXT.percentRemaining} {formatPercent(selectedSnapshot?.quota?.percentRemaining)}
                  {" · "}
                  {TEXT.percentUsed} {formatPercent(selectedSnapshot?.quota?.percentUsed)}
                </p>
              ) : null}
            </article>

            <article className="metric-card">
              <div className="info-card__label">{TEXT.resetTime}</div>
              <div className="metric-card__value">
                {formatDateTime(selectedSnapshot?.quota?.resetAt)}
              </div>
              <p className="metric-card__countdown">
                {formatCountdown(selectedSnapshot?.quota?.resetAt, now)}
              </p>
            </article>
          </section>
        </section>
      ) : (
        <section className="details-view">
          <article className="detail-panel">
            <div className="detail-panel__header">
              <div>
                <div className="detail-panel__title">{TEXT.providerDetails}</div>
                <div className="detail-panel__headline">
                  {selectedSnapshot?.provider.name ?? activeProvider?.name ?? TEXT.unavailable}
                </div>
              </div>
              <span className={`status-pill status-pill--${statusTone}`}>
                {formatStatus(selectedSnapshot?.provider.status ?? activeProvider?.status)}
              </span>
            </div>
            <dl className="detail-list">
              <div>
                <dt>{TEXT.message}</dt>
                <dd>
                  {selectedSnapshot?.provider.message ??
                    activeProvider?.message ??
                    TEXT.noProviderMessage}
                </dd>
              </div>
              <div>
                <dt>{TEXT.capabilities}</dt>
                <dd>
                  {activeProvider?.capabilities.length
                    ? activeProvider.capabilities
                        .map((capability) =>
                          `${capability.kind}:${
                            capability.available ? TEXT.capabilityOn : TEXT.capabilityOff
                          }`
                        )
                        .join(", ")
                    : TEXT.unavailable}
                </dd>
              </div>
              <div>
                <dt>{TEXT.lastUpdate}</dt>
                <dd>{formatDateTime(selectedSnapshot?.refreshedAt)}</dd>
              </div>
            </dl>
          </article>

          <article className="detail-panel">
            <div className="detail-panel__title">{TEXT.environment}</div>
            <dl className="detail-list">
              <div>
                <dt>{TEXT.webview2Installed}</dt>
                <dd>{formatPresence(environmentDiagnostics?.webview2.installed ?? false)}</dd>
              </div>
              <div>
                <dt>{TEXT.webview2Version}</dt>
                <dd>{environmentDiagnostics?.webview2.version ?? TEXT.unavailable}</dd>
              </div>
              <div>
                <dt>{TEXT.registryPath}</dt>
                <dd>{environmentDiagnostics?.webview2.registryPath ?? TEXT.unavailable}</dd>
              </div>
              <div>
                <dt>{TEXT.codexAuth}</dt>
                <dd>{formatPresence(environmentDiagnostics?.codex.authExists ?? false)}</dd>
              </div>
              <div>
                <dt>{TEXT.codexConfig}</dt>
                <dd>{formatPresence(environmentDiagnostics?.codex.configExists ?? false)}</dd>
              </div>
              <div>
                <dt>{TEXT.sessionFiles}</dt>
                <dd>{environmentDiagnostics?.codex.sessionFileCount ?? 0}</dd>
              </div>
              <div>
                <dt>{TEXT.authPath}</dt>
                <dd>{environmentDiagnostics?.codex.authPath ?? TEXT.unavailable}</dd>
              </div>
              <div>
                <dt>{TEXT.sessionsRoot}</dt>
                <dd>{environmentDiagnostics?.codex.sessionsRoot ?? TEXT.unavailable}</dd>
              </div>
              <div>
                <dt>{TEXT.copilotApps}</dt>
                <dd>{formatPresence(environmentDiagnostics?.copilot.appsExists ?? false)}</dd>
              </div>
              <div>
                <dt>{TEXT.copilotOAuth}</dt>
                <dd>{formatPresence(environmentDiagnostics?.copilot.oauthExists ?? false)}</dd>
              </div>
              <div>
                <dt>{TEXT.copilotSessionFiles}</dt>
                <dd>{environmentDiagnostics?.copilot.sessionFileCount ?? 0}</dd>
              </div>
              <div>
                <dt>{TEXT.copilotAppsPath}</dt>
                <dd>{environmentDiagnostics?.copilot.appsPath ?? TEXT.unavailable}</dd>
              </div>
              <div>
                <dt>{TEXT.copilotSessionRoot}</dt>
                <dd>{environmentDiagnostics?.copilot.sessionRoot ?? TEXT.unavailable}</dd>
              </div>
            </dl>
          </article>

          <article className="detail-panel">
            <div className="detail-panel__title">{TEXT.accountDetails}</div>
            <dl className="detail-list">
              <div>
                <dt>{TEXT.email}</dt>
                <dd>{selectedSnapshot?.account.email ?? TEXT.unavailable}</dd>
              </div>
              <div>
                <dt>{TEXT.identifier}</dt>
                <dd>{selectedSnapshot?.account.identifier ?? TEXT.unavailable}</dd>
              </div>
              <div>
                <dt>{TEXT.authMode}</dt>
                <dd>{selectedSnapshot?.account.authMode ?? TEXT.unavailable}</dd>
              </div>
              <div>
                <dt>{TEXT.sourcePath}</dt>
                <dd>{selectedSnapshot?.account.sourcePath ?? TEXT.unavailable}</dd>
              </div>
            </dl>
          </article>

          <article className="detail-panel">
            <div className="detail-panel__title">{TEXT.planDetails}</div>
            <dl className="detail-list">
              <div>
                <dt>{TEXT.name}</dt>
                <dd>{selectedSnapshot?.plan?.name ?? TEXT.unavailable}</dd>
              </div>
              <div>
                <dt>{TEXT.tier}</dt>
                <dd>{selectedSnapshot?.plan?.tier ?? TEXT.unavailable}</dd>
              </div>
              <div>
                <dt>{TEXT.cycle}</dt>
                <dd>{selectedSnapshot?.plan?.cycle ?? TEXT.unavailable}</dd>
              </div>
              <div>
                <dt>{TEXT.renewal}</dt>
                <dd>{formatDateTime(selectedSnapshot?.plan?.renewalAt)}</dd>
              </div>
              <div>
                <dt>{TEXT.source}</dt>
                <dd>{selectedSnapshot?.plan?.source ?? TEXT.unavailable}</dd>
              </div>
            </dl>
          </article>

          <article className="detail-panel">
            <div className="detail-panel__title">{TEXT.quotaDetails}</div>
            <dl className="detail-list">
              <div>
                <dt>{TEXT.status}</dt>
                <dd>{formatStatus(selectedSnapshot?.quota?.status)}</dd>
              </div>
              <div>
                <dt>{TEXT.used}</dt>
                <dd>
                  {formatQuotaValue(
                    selectedSnapshot?.quota?.used,
                    selectedSnapshot?.quota?.unit
                  )}
                </dd>
              </div>
              <div>
                <dt>{TEXT.remaining}</dt>
                <dd>
                  {formatQuotaValue(
                    selectedSnapshot?.quota?.remaining,
                    selectedSnapshot?.quota?.unit
                  )}
                </dd>
              </div>
              <div>
                <dt>{TEXT.total}</dt>
                <dd>
                  {formatQuotaValue(
                    selectedSnapshot?.quota?.total,
                    selectedSnapshot?.quota?.unit
                  )}
                </dd>
              </div>
              <div>
                <dt>{TEXT.percentRemaining}</dt>
                <dd>{formatPercent(selectedSnapshot?.quota?.percentRemaining)}</dd>
              </div>
              <div>
                <dt>{TEXT.percentUsed}</dt>
                <dd>{formatPercent(selectedSnapshot?.quota?.percentUsed)}</dd>
              </div>
              <div>
                <dt>{TEXT.resetTime}</dt>
                <dd>{formatDateTime(selectedSnapshot?.quota?.resetAt)}</dd>
              </div>
              <div>
                <dt>{TEXT.countdown}</dt>
                <dd>{formatCountdown(selectedSnapshot?.quota?.resetAt, now)}</dd>
              </div>
              <div>
                <dt>{TEXT.confidence}</dt>
                <dd>{selectedSnapshot?.quota?.confidence ?? TEXT.unavailable}</dd>
              </div>
              <div>
                <dt>{TEXT.source}</dt>
                <dd>{selectedSnapshot?.quota?.source ?? TEXT.unavailable}</dd>
              </div>
              <div>
                <dt>{TEXT.note}</dt>
                <dd>{selectedSnapshot?.quota?.note ?? TEXT.unavailable}</dd>
              </div>
            </dl>
          </article>

          <article className="detail-panel">
            <div className="detail-panel__title">{TEXT.warnings}</div>
            {selectedSnapshot?.warnings.length ? (
              <ul className="warning-list">
                {selectedSnapshot.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            ) : (
              <p className="empty-state">{TEXT.noWarnings}</p>
            )}
          </article>

          <article className="detail-panel detail-panel--raw">
            <div className="detail-panel__title">{TEXT.rawMetadata}</div>
            {rawMeta ? (
              <pre className="raw-meta">{rawMeta}</pre>
            ) : (
              <p className="empty-state">{TEXT.noRawMetadata}</p>
            )}
          </article>
        </section>
      )}
    </main>
  );
}
