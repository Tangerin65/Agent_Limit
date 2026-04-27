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

function formatQuotaValue(value?: number | null, unit?: string | null) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "--";
  }

  if (unit === "%") {
    return `${value.toFixed(1)}%`;
  }

  if (unit === "requests") {
    return `${Math.round(value)} requests`;
  }

  return value.toFixed(1);
}

function formatQuotaMeta(
  used?: number | null,
  total?: number | null,
  unit?: string | null
) {
  if (typeof used !== "number" || Number.isNaN(used)) {
    return "--";
  }

  if (unit === "%") {
    return `Used ${used.toFixed(1)}%`;
  }

  if (unit === "requests") {
    if (typeof total === "number" && !Number.isNaN(total)) {
      return `Used ${Math.round(used)} / ${Math.round(total)} requests`;
    }

    return `Used ${Math.round(used)} requests`;
  }

  return `Used ${used.toFixed(1)}`;
}

function formatDateTime(value?: string | null) {
  if (!value) {
    return "--";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString();
}

function pad(value: number) {
  return value.toString().padStart(2, "0");
}

function formatCountdown(value: string | null | undefined, now: number) {
  if (!value) {
    return "--";
  }

  const target = new Date(value).getTime();
  if (Number.isNaN(target)) {
    return "--";
  }

  const diff = target - now;
  if (diff <= 0) {
    return "Due";
  }

  const totalSeconds = Math.floor(diff / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (days > 0) {
    return `${days}d ${pad(hours)}h ${pad(minutes)}m ${pad(seconds)}s`;
  }

  return `${pad(hours)}h ${pad(minutes)}m ${pad(seconds)}s`;
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
    return "Detected";
  }

  if (provider?.status === "planned") {
    return "Planned";
  }

  if (provider?.status === "degraded") {
    return "Not detected";
  }

  return "--";
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
    return "Planned";
  }

  return "--";
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

function formatPresence(value: boolean) {
  return value ? "Yes" : "No";
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
        setError(
          loadError instanceof Error ? loadError.message : "Failed to initialize app."
        );
      } finally {
        setInitialized(true);
      }
    })();
  }, []);

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
              : "Failed to refresh provider."
          );
        });
    });
  };

  const activeProvider =
    providers.find((provider) => provider.id === selectedProvider) ?? null;
  const selectedSnapshot = getSelectedSnapshot(snapshot, selectedProvider);
  const statusTone = getStatusTone(selectedSnapshot?.provider.status ?? activeProvider?.status);
  const environmentWarnings = environmentDiagnostics?.warnings ?? [];
  const rawMeta = selectedSnapshot?.rawMeta
    ? JSON.stringify(selectedSnapshot.rawMeta, null, 2)
    : null;

  return (
    <main className="app-shell">
      <div className="app-shell__glow app-shell__glow--cyan" />
      <div className="app-shell__glow app-shell__glow--amber" />

      <header className="topbar">
        <div className="topbar__title">
          <p className="topbar__eyebrow">Agent Limit</p>
          <h1>Quota monitor</h1>
        </div>

        <div className="topbar__controls">
          <div className="provider-switch" role="tablist" aria-label="Provider switcher">
            {providers.map((provider) => (
              <button
                key={provider.id}
                className={`provider-switch__item ${
                  provider.id === selectedProvider ? "provider-switch__item--active" : ""
                }`}
                onClick={() => {
                  setError(null);
                  setSelectedProvider(provider.id);
                  if (provider.id !== snapshot?.provider.id) {
                    setSnapshot(null);
                  }
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
              {isPending ? "Refreshing..." : "Refresh"}
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
              {viewMode === "dashboard" ? "Details" : "Back"}
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
        <section className="banner">Loading local provider registry...</section>
      ) : null}

      {viewMode === "dashboard" ? (
        <section className="dashboard-view">
          <section className="summary-grid">
            <article className="info-card">
              <div className="info-card__label">Provider</div>
              <div className="info-card__value">
                {selectedSnapshot?.provider.name ?? activeProvider?.name ?? "--"}
              </div>
            </article>

            <article className="info-card">
              <div className="info-card__label">Account</div>
              <div className="info-card__value">
                {getAccountValue(activeProvider, selectedSnapshot)}
              </div>
            </article>

            <article className="info-card">
              <div className="info-card__label">Plan</div>
              <div className="info-card__value">
                {getPlanValue(activeProvider, selectedSnapshot)}
              </div>
            </article>
          </section>

          <section className="metric-grid">
            <article className="metric-card metric-card--remaining">
              <div className="info-card__label">Remaining</div>
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
            </article>

            <article className="metric-card">
              <div className="info-card__label">Reset Time</div>
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
                <div className="detail-panel__title">Provider Details</div>
                <div className="detail-panel__headline">
                  {selectedSnapshot?.provider.name ?? activeProvider?.name ?? "--"}
                </div>
              </div>
              <span className={`status-pill status-pill--${statusTone}`}>
                {selectedSnapshot?.provider.status ?? activeProvider?.status ?? "unknown"}
              </span>
            </div>
            <dl className="detail-list">
              <div>
                <dt>Message</dt>
                <dd>
                  {selectedSnapshot?.provider.message ??
                    activeProvider?.message ??
                    "No provider message."}
                </dd>
              </div>
              <div>
                <dt>Capabilities</dt>
                <dd>
                  {activeProvider?.capabilities.length
                    ? activeProvider.capabilities
                        .map((capability) =>
                          `${capability.kind}:${capability.available ? "on" : "off"}`
                        )
                        .join(", ")
                    : "--"}
                </dd>
              </div>
              <div>
                <dt>Last Update</dt>
                <dd>{formatDateTime(selectedSnapshot?.refreshedAt)}</dd>
              </div>
            </dl>
          </article>

          <article className="detail-panel">
            <div className="detail-panel__title">Environment</div>
            <dl className="detail-list">
              <div>
                <dt>WebView2 Installed</dt>
                <dd>{formatPresence(environmentDiagnostics?.webview2.installed ?? false)}</dd>
              </div>
              <div>
                <dt>WebView2 Version</dt>
                <dd>{environmentDiagnostics?.webview2.version ?? "--"}</dd>
              </div>
              <div>
                <dt>Registry Path</dt>
                <dd>{environmentDiagnostics?.webview2.registryPath ?? "--"}</dd>
              </div>
              <div>
                <dt>Codex Auth</dt>
                <dd>{formatPresence(environmentDiagnostics?.codex.authExists ?? false)}</dd>
              </div>
              <div>
                <dt>Codex Config</dt>
                <dd>{formatPresence(environmentDiagnostics?.codex.configExists ?? false)}</dd>
              </div>
              <div>
                <dt>Session Files</dt>
                <dd>{environmentDiagnostics?.codex.sessionFileCount ?? 0}</dd>
              </div>
              <div>
                <dt>Auth Path</dt>
                <dd>{environmentDiagnostics?.codex.authPath ?? "--"}</dd>
              </div>
              <div>
                <dt>Sessions Root</dt>
                <dd>{environmentDiagnostics?.codex.sessionsRoot ?? "--"}</dd>
              </div>
              <div>
                <dt>Copilot Apps</dt>
                <dd>{formatPresence(environmentDiagnostics?.copilot.appsExists ?? false)}</dd>
              </div>
              <div>
                <dt>Copilot OAuth</dt>
                <dd>{formatPresence(environmentDiagnostics?.copilot.oauthExists ?? false)}</dd>
              </div>
              <div>
                <dt>Copilot Session Files</dt>
                <dd>{environmentDiagnostics?.copilot.sessionFileCount ?? 0}</dd>
              </div>
              <div>
                <dt>Copilot Apps Path</dt>
                <dd>{environmentDiagnostics?.copilot.appsPath ?? "--"}</dd>
              </div>
              <div>
                <dt>Copilot Session Root</dt>
                <dd>{environmentDiagnostics?.copilot.sessionRoot ?? "--"}</dd>
              </div>
            </dl>
          </article>

          <article className="detail-panel">
            <div className="detail-panel__title">Account Details</div>
            <dl className="detail-list">
              <div>
                <dt>Email</dt>
                <dd>{selectedSnapshot?.account.email ?? "--"}</dd>
              </div>
              <div>
                <dt>Identifier</dt>
                <dd>{selectedSnapshot?.account.identifier ?? "--"}</dd>
              </div>
              <div>
                <dt>Auth Mode</dt>
                <dd>{selectedSnapshot?.account.authMode ?? "--"}</dd>
              </div>
              <div>
                <dt>Source Path</dt>
                <dd>{selectedSnapshot?.account.sourcePath ?? "--"}</dd>
              </div>
            </dl>
          </article>

          <article className="detail-panel">
            <div className="detail-panel__title">Plan Details</div>
            <dl className="detail-list">
              <div>
                <dt>Name</dt>
                <dd>{selectedSnapshot?.plan?.name ?? "--"}</dd>
              </div>
              <div>
                <dt>Tier</dt>
                <dd>{selectedSnapshot?.plan?.tier ?? "--"}</dd>
              </div>
              <div>
                <dt>Cycle</dt>
                <dd>{selectedSnapshot?.plan?.cycle ?? "--"}</dd>
              </div>
              <div>
                <dt>Renewal</dt>
                <dd>{formatDateTime(selectedSnapshot?.plan?.renewalAt)}</dd>
              </div>
              <div>
                <dt>Source</dt>
                <dd>{selectedSnapshot?.plan?.source ?? "--"}</dd>
              </div>
            </dl>
          </article>

          <article className="detail-panel">
            <div className="detail-panel__title">Quota Details</div>
            <dl className="detail-list">
              <div>
                <dt>Status</dt>
                <dd>{selectedSnapshot?.quota?.status ?? "--"}</dd>
              </div>
              <div>
                <dt>Used</dt>
                <dd>
                  {formatQuotaValue(
                    selectedSnapshot?.quota?.used,
                    selectedSnapshot?.quota?.unit
                  )}
                </dd>
              </div>
              <div>
                <dt>Remaining</dt>
                <dd>
                  {formatQuotaValue(
                    selectedSnapshot?.quota?.remaining,
                    selectedSnapshot?.quota?.unit
                  )}
                </dd>
              </div>
              <div>
                <dt>Total</dt>
                <dd>
                  {formatQuotaValue(
                    selectedSnapshot?.quota?.total,
                    selectedSnapshot?.quota?.unit
                  )}
                </dd>
              </div>
              <div>
                <dt>Reset Time</dt>
                <dd>{formatDateTime(selectedSnapshot?.quota?.resetAt)}</dd>
              </div>
              <div>
                <dt>Countdown</dt>
                <dd>{formatCountdown(selectedSnapshot?.quota?.resetAt, now)}</dd>
              </div>
              <div>
                <dt>Confidence</dt>
                <dd>{selectedSnapshot?.quota?.confidence ?? "--"}</dd>
              </div>
              <div>
                <dt>Source</dt>
                <dd>{selectedSnapshot?.quota?.source ?? "--"}</dd>
              </div>
              <div>
                <dt>Note</dt>
                <dd>{selectedSnapshot?.quota?.note ?? "--"}</dd>
              </div>
            </dl>
          </article>

          <article className="detail-panel">
            <div className="detail-panel__title">Warnings</div>
            {selectedSnapshot?.warnings.length ? (
              <ul className="warning-list">
                {selectedSnapshot.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            ) : (
              <p className="empty-state">No warnings for the current provider.</p>
            )}
          </article>

          <article className="detail-panel detail-panel--raw">
            <div className="detail-panel__title">Raw Metadata</div>
            {rawMeta ? (
              <pre className="raw-meta">{rawMeta}</pre>
            ) : (
              <p className="empty-state">No raw metadata for the current provider.</p>
            )}
          </article>
        </section>
      )}
    </main>
  );
}
