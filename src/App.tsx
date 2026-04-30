import { useEffect, useState } from "react";
import {
  detectSystemLocale,
  formatCapabilityLabel,
  formatLocalizedCountdown,
  formatLocalizedDateTime,
  formatLocalizedPercent,
  formatLocalizedQuotaMeta,
  formatLocalizedQuotaValue,
  getTranslation,
  readStoredLocale,
  writeStoredLocale,
  type AppLocale
} from "./i18n";
import {
  clearProviderSettings,
  getEnvironmentDiagnostics,
  getProviderSettings,
  getRegisteredProviders,
  refreshProvider,
  saveProviderSettings
} from "./lib/api";
import type {
  ApiKeyStatus,
  ApiPlatformsEnvironmentStatus,
  EnvironmentDiagnostics,
  ProviderDescriptor,
  ProviderSettingsInput,
  ProviderSnapshot
} from "./types/provider";

const DEFAULT_PROVIDER = "codex";

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
  locale: AppLocale,
  provider: ProviderDescriptor | null,
  snapshot: ProviderSnapshot | null
) {
  const text = getTranslation(locale);

  if (snapshot?.account.email) {
    return snapshot.account.email;
  }

  if (snapshot?.account.identifier) {
    return snapshot.account.identifier;
  }

  if (snapshot?.account.detected) {
    return text.detected;
  }

  if (provider?.status === "planned") {
    return text.planned;
  }

  if (provider?.status === "degraded") {
    return text.notDetected;
  }

  return text.unavailable;
}

function getPlanValue(
  locale: AppLocale,
  provider: ProviderDescriptor | null,
  snapshot: ProviderSnapshot | null
) {
  const text = getTranslation(locale);

  if (snapshot?.plan?.name) {
    return snapshot.plan.name;
  }

  if (snapshot?.plan?.tier) {
    return snapshot.plan.tier;
  }

  if (provider?.status === "planned") {
    return text.planned;
  }

  return text.unavailable;
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

function formatStatus(locale: AppLocale, status?: string) {
  const text = getTranslation(locale);

  switch (status) {
    case "ready":
      return text.statusReady;
    case "degraded":
      return text.statusDegraded;
    case "planned":
      return text.statusPlanned;
    case "unavailable":
      return text.statusUnavailable;
    default:
      return text.statusUnknown;
  }
}

function formatPresence(locale: AppLocale, value: boolean) {
  const text = getTranslation(locale);
  return value ? text.yes : text.no;
}

function buildCopilotSecondaryLine(
  locale: AppLocale,
  remaining?: number | null,
  unit?: string | null
) {
  const text = getTranslation(locale);
  const value = formatLocalizedQuotaValue(locale, remaining, unit);
  return text.remainingInline.replace("{value}", value);
}

function buildMetricPresentation(
  locale: AppLocale,
  providerId: string,
  snapshot: ProviderSnapshot | null
) {
  const text = getTranslation(locale);
  const quota = snapshot?.quota;
  const isCopilot = providerId === "github-copilot";
  const isApiCreditProvider = providerId === "openrouter";
  const hasCopilotPercent = typeof quota?.percentRemaining === "number";

  if (isApiCreditProvider) {
    return {
      label: text.remainingCredits,
      value: formatLocalizedQuotaValue(locale, quota?.remaining, quota?.unit),
      valueClassName: "metric-card__value metric-card__value--remaining",
      meta: formatLocalizedQuotaMeta(locale, quota?.used, quota?.total, quota?.unit),
      submeta:
        typeof quota?.percentRemaining === "number" ||
        typeof quota?.percentUsed === "number"
          ? `${text.percentRemaining} ${formatLocalizedPercent(
              locale,
              quota?.percentRemaining
            )} · ${text.percentUsed} ${formatLocalizedPercent(
              locale,
              quota?.percentUsed
            )}`
          : null
    };
  }

  if (isCopilot && hasCopilotPercent) {
    return {
      label: text.remainingPercent,
      value: formatLocalizedPercent(locale, quota?.percentRemaining),
      valueClassName: "metric-card__value metric-card__value--remaining",
      meta: buildCopilotSecondaryLine(locale, quota?.remaining, quota?.unit),
      submeta: formatLocalizedQuotaMeta(
        locale,
        quota?.used,
        quota?.total,
        quota?.unit
      )
    };
  }

  return {
    label: text.remaining,
    value: formatLocalizedQuotaValue(locale, quota?.remaining, quota?.unit),
    valueClassName: "metric-card__value metric-card__value--remaining",
    meta: formatLocalizedQuotaMeta(locale, quota?.used, quota?.total, quota?.unit),
    submeta:
      quota?.unit !== "%" &&
      (typeof quota?.percentRemaining === "number" ||
        typeof quota?.percentUsed === "number")
        ? `${text.percentRemaining} ${formatLocalizedPercent(
            locale,
            quota?.percentRemaining
          )} · ${text.percentUsed} ${formatLocalizedPercent(
            locale,
            quota?.percentUsed
          )}`
        : null
  };
}

function getActiveProviderSettings(
  settings: ApiPlatformsEnvironmentStatus | null,
  providerId: string
) {
  switch (providerId) {
    case "openrouter":
      return settings?.openrouter ?? null;
    case "custom-provider":
      return settings?.customProvider ?? null;
    default:
      return null;
  }
}

function isSetupProvider(providerId: string) {
  return providerId === "openrouter" || providerId === "custom-provider";
}

function getProviderSettingsPayload(
  providerId: string,
  values: {
    openrouterApiKey: string;
    customDisplayName: string;
    customBaseUrl: string;
    customApiKey: string;
  }
): ProviderSettingsInput {
  if (providerId === "openrouter") {
    return {
      apiKey: values.openrouterApiKey
    };
  }

  return {
    displayName: values.customDisplayName,
    baseUrl: values.customBaseUrl,
    apiKey: values.customApiKey
  };
}

export default function App() {
  const [locale, setLocale] = useState<AppLocale>(
    () => readStoredLocale() ?? detectSystemLocale()
  );
  const [providers, setProviders] = useState<ProviderDescriptor[]>([]);
  const [selectedProvider, setSelectedProvider] = useState(DEFAULT_PROVIDER);
  const [snapshot, setSnapshot] = useState<ProviderSnapshot | null>(null);
  const [providerSettings, setProviderSettings] =
    useState<ApiPlatformsEnvironmentStatus | null>(null);
  const [environmentDiagnostics, setEnvironmentDiagnostics] =
    useState<EnvironmentDiagnostics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [providerFormError, setProviderFormError] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false);
  const [viewMode, setViewMode] = useState<"dashboard" | "details">("dashboard");
  const [now, setNow] = useState(() => Date.now());
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [isClearingSettings, setIsClearingSettings] = useState(false);
  const [editingProviderId, setEditingProviderId] = useState<string | null>(null);
  const [openrouterApiKey, setOpenrouterApiKey] = useState("");
  const [customDisplayName, setCustomDisplayName] = useState("");
  const [customBaseUrl, setCustomBaseUrl] = useState("");
  const [customApiKey, setCustomApiKey] = useState("");

  const text = getTranslation(locale);

  const resetProviderForm = (providerId?: string) => {
    if (!providerId || providerId === "openrouter") {
      setOpenrouterApiKey("");
    }

    if (!providerId || providerId === "custom-provider") {
      setCustomDisplayName("");
      setCustomBaseUrl("");
      setCustomApiKey("");
    }
  };

  const hydrateEditableValues = (providerId: string, settings: ApiKeyStatus | null) => {
    setProviderFormError(null);

    if (providerId === "openrouter") {
      setOpenrouterApiKey("");
      return;
    }

    setCustomDisplayName(settings?.displayName ?? "");
    setCustomBaseUrl(settings?.baseUrl ?? "");
    setCustomApiKey("");
  };

  const handleRefresh = async (providerId: string, currentLocale: AppLocale) => {
    setError(null);
    setIsRefreshing(true);

    try {
      const [registered, result, diagnostics, settings] = await Promise.all([
        getRegisteredProviders(currentLocale),
        refreshProvider(providerId, currentLocale),
        getEnvironmentDiagnostics(currentLocale).catch(() => null),
        getProviderSettings(currentLocale).catch(() => null)
      ]);

      setProviders(registered);
      setSnapshot(result);
      if (diagnostics) {
        setEnvironmentDiagnostics(diagnostics);
      }
      if (settings) {
        setProviderSettings(settings);
      }
      setNow(Date.now());
    } catch (refreshError) {
      setError(
        refreshError instanceof Error
          ? refreshError.message
          : text.providerRefreshFailed
      );
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleSaveSettings = async (providerId: string) => {
    setError(null);
    setProviderFormError(null);
    setIsSavingSettings(true);

    try {
      const payload = getProviderSettingsPayload(providerId, {
        openrouterApiKey,
        customDisplayName,
        customBaseUrl,
        customApiKey
      });

      const settings = await saveProviderSettings(providerId, payload, locale);
      setProviderSettings(settings);
      setEditingProviderId(null);
      resetProviderForm(providerId);
      await handleRefresh(providerId, locale);
    } catch (saveError) {
      setProviderFormError(
        saveError instanceof Error ? saveError.message : text.initFailed
      );
    } finally {
      setIsSavingSettings(false);
    }
  };

  const handleClearSettings = async (providerId: string) => {
    setError(null);
    setProviderFormError(null);
    setIsClearingSettings(true);

    try {
      const settings = await clearProviderSettings(providerId, locale);
      setProviderSettings(settings);
      setEditingProviderId(null);
      resetProviderForm(providerId);
      await handleRefresh(providerId, locale);
    } catch (clearError) {
      setProviderFormError(
        clearError instanceof Error ? clearError.message : text.initFailed
      );
    } finally {
      setIsClearingSettings(false);
    }
  };

  useEffect(() => {
    writeStoredLocale(locale);
  }, [locale]);

  useEffect(() => {
    let isCancelled = false;
    setInitialized(false);
    setError(null);

    void (async () => {
      try {
        const [registered, settings, diagnostics] = await Promise.all([
          getRegisteredProviders(locale),
          getProviderSettings(locale),
          getEnvironmentDiagnostics(locale).catch(() => null)
        ]);

        if (isCancelled) {
          return;
        }

        setProviders(registered);
        setProviderSettings(settings);

        if (diagnostics) {
          setEnvironmentDiagnostics(diagnostics);
        }

        const defaultProvider =
          registered.find((provider) => provider.id === DEFAULT_PROVIDER)?.id ??
          registered[0]?.id ??
          DEFAULT_PROVIDER;

        setSelectedProvider(defaultProvider);

        if (defaultProvider) {
          const result = await refreshProvider(defaultProvider, locale);
          if (isCancelled) {
            return;
          }

          setSnapshot(result);
          setNow(Date.now());
        } else {
          setSnapshot(null);
        }
      } catch (loadError) {
        if (!isCancelled) {
          setError(loadError instanceof Error ? loadError.message : text.initFailed);
        }
      } finally {
        if (!isCancelled) {
          setInitialized(true);
        }
      }
    })();

    return () => {
      isCancelled = true;
    };
  }, [locale]);

  useEffect(() => {
    if (!initialized || !selectedProvider) {
      return;
    }

    if (snapshot?.provider.id === selectedProvider) {
      return;
    }

    void handleRefresh(selectedProvider, locale);
  }, [initialized, locale, selectedProvider, snapshot?.provider.id]);

  useEffect(() => {
    const resetAt =
      snapshot?.provider.id === selectedProvider ? snapshot?.quota?.resetAt : null;
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
  const activeProviderSetup = getActiveProviderSettings(
    providerSettings,
    selectedProvider
  );
  const selectedWarnings = selectedSnapshot?.warnings ?? [];
  const statusTone = getStatusTone(
    selectedSnapshot?.provider.status ?? activeProvider?.status
  );
  const environmentWarnings = environmentDiagnostics?.warnings ?? [];
  const rawMeta = selectedSnapshot?.rawMeta
    ? JSON.stringify(selectedSnapshot.rawMeta, null, 2)
    : null;
  const metricPresentation = buildMetricPresentation(
    locale,
    selectedProvider,
    selectedSnapshot
  );
  const isEditingSelectedProvider = editingProviderId === selectedProvider;
  const showProviderSetup = isSetupProvider(selectedProvider);
  const showSetupForm =
    showProviderSetup &&
    (isEditingSelectedProvider || !activeProviderSetup?.configured);

  const startEditingSelectedProvider = () => {
    const currentSettings = getActiveProviderSettings(providerSettings, selectedProvider);
    hydrateEditableValues(selectedProvider, currentSettings);
    setEditingProviderId(selectedProvider);
  };

  return (
    <main className="app-shell">
      <div className="app-shell__glow app-shell__glow--cyan" />
      <div className="app-shell__glow app-shell__glow--amber" />

      <header className="topbar">
        <div className="topbar__title">
          <p className="topbar__eyebrow">Agent Limit</p>
          <h1>{text.subtitle}</h1>
        </div>

        <div className="topbar__controls">
          <div className="provider-switch" role="tablist" aria-label={text.providerSwitcher}>
            {providers.map((provider) => (
              <button
                key={provider.id}
                className={`provider-switch__item ${
                  provider.id === selectedProvider ? "provider-switch__item--active" : ""
                }`}
                onClick={() => {
                  setError(null);
                  setProviderFormError(null);
                  setEditingProviderId(null);
                  resetProviderForm();
                  setSelectedProvider(provider.id);
                }}
                type="button"
              >
                {provider.name}
              </button>
            ))}
          </div>

          <div className="topbar__utility-row">
            <label className="language-select">
              <span className="language-select__label">{text.language}</span>
              <select
                className="language-select__input"
                value={locale}
                onChange={(event) => {
                  const nextLocale = event.target.value as AppLocale;
                  setLocale(nextLocale);
                }}
              >
                <option value="en">English</option>
                <option value="zh-CN">简体中文</option>
              </select>
            </label>

            <div className="topbar__actions">
              <button
                className="primary-button"
                disabled={!selectedProvider || isRefreshing || !initialized}
                onClick={() => void handleRefresh(selectedProvider, locale)}
                type="button"
              >
                {isRefreshing ? text.refreshing : text.refresh}
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
                {viewMode === "dashboard" ? text.details : text.back}
              </button>
            </div>
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
        <section className="banner">{text.loadingRegistry}</section>
      ) : null}

      {viewMode === "dashboard" ? (
        <section className="dashboard-view">
          {selectedWarnings.map((warning) => (
            <section key={warning} className="banner banner--warning">
              {warning}
            </section>
          ))}

          <section className="summary-grid">
            <article className="info-card">
              <div className="info-card__label">{text.provider}</div>
              <div className="info-card__value">
                {selectedSnapshot?.provider.name ?? activeProvider?.name ?? text.unavailable}
              </div>
            </article>

            <article className="info-card">
              <div className="info-card__label">{text.account}</div>
              <div className="info-card__value">
                {getAccountValue(locale, activeProvider, selectedSnapshot)}
              </div>
            </article>

            <article className="info-card">
              <div className="info-card__label">{text.plan}</div>
              <div className="info-card__value">
                {getPlanValue(locale, activeProvider, selectedSnapshot)}
              </div>
            </article>
          </section>

          <section className="metric-grid">
            <article className="metric-card metric-card--remaining">
              <div className="info-card__label">{metricPresentation.label}</div>
              <div className={metricPresentation.valueClassName}>
                {metricPresentation.value}
              </div>
              <p className="metric-card__meta">{metricPresentation.meta}</p>
              {metricPresentation.submeta ? (
                <p className="metric-card__submeta">{metricPresentation.submeta}</p>
              ) : null}
            </article>

            <article className="metric-card">
              <div className="info-card__label">{text.resetTime}</div>
              <div className="metric-card__value">
                {formatLocalizedDateTime(locale, selectedSnapshot?.quota?.resetAt)}
              </div>
              {selectedSnapshot?.quota?.resetAt ? (
                <p className="metric-card__countdown">
                  {formatLocalizedCountdown(locale, selectedSnapshot?.quota?.resetAt, now)}
                </p>
              ) : null}
            </article>
          </section>

          {showProviderSetup ? (
            <article className="detail-panel setup-panel">
              <div className="detail-panel__header">
                <div>
                  <div className="detail-panel__title">{text.providerSetup}</div>
                  <div className="detail-panel__headline">
                    {activeProvider?.name ?? text.unavailable}
                  </div>
                </div>
                <span
                  className={`status-pill status-pill--${
                    activeProviderSetup?.configured ? "ready" : "muted"
                  }`}
                >
                  {activeProviderSetup?.configured ? text.configured : text.notConfigured}
                </span>
              </div>

              {providerFormError ? (
                <section className="banner banner--error setup-panel__banner">
                  {providerFormError}
                </section>
              ) : null}

              {showSetupForm ? (
                <div className="setup-form">
                  {selectedProvider === "custom-provider" ? (
                    <>
                      <label className="setup-form__field">
                        <span>{text.displayName}</span>
                        <input
                          className="setup-form__input"
                          onChange={(event) => setCustomDisplayName(event.target.value)}
                          placeholder={text.displayName}
                          type="text"
                          value={customDisplayName}
                        />
                      </label>

                      <label className="setup-form__field">
                        <span>{text.baseUrl}</span>
                        <input
                          className="setup-form__input"
                          onChange={(event) => setCustomBaseUrl(event.target.value)}
                          placeholder="https://api.openai.com/v1"
                          type="url"
                          value={customBaseUrl}
                        />
                      </label>
                    </>
                  ) : null}

                  <label className="setup-form__field">
                    <span>{text.apiKey}</span>
                    <input
                      className="setup-form__input"
                      onChange={(event) =>
                        selectedProvider === "openrouter"
                          ? setOpenrouterApiKey(event.target.value)
                          : setCustomApiKey(event.target.value)
                      }
                      placeholder={text.apiKey}
                      type="password"
                      value={
                        selectedProvider === "openrouter"
                          ? openrouterApiKey
                          : customApiKey
                      }
                    />
                  </label>

                  {selectedProvider === "custom-provider" && isEditingSelectedProvider ? (
                    <p className="setup-panel__hint">{text.keepExistingApiKeyHint}</p>
                  ) : null}

                  <div className="setup-panel__actions">
                    <button
                      className="primary-button"
                      disabled={isSavingSettings}
                      onClick={() => void handleSaveSettings(selectedProvider)}
                      type="button"
                    >
                      {isSavingSettings ? text.saving : text.save}
                    </button>
                    {activeProviderSetup?.configured ? (
                      <button
                        className="secondary-button"
                        onClick={() => {
                          setEditingProviderId(null);
                          setProviderFormError(null);
                          resetProviderForm(selectedProvider);
                        }}
                        type="button"
                      >
                        {text.cancel}
                      </button>
                    ) : null}
                  </div>
                </div>
              ) : (
                <>
                  <dl className="detail-list">
                    {selectedProvider === "custom-provider" ? (
                      <div>
                        <dt>{text.displayName}</dt>
                        <dd>{activeProviderSetup?.displayName ?? text.unavailable}</dd>
                      </div>
                    ) : null}
                    {selectedProvider === "custom-provider" ? (
                      <div>
                        <dt>{text.baseUrl}</dt>
                        <dd>{activeProviderSetup?.baseUrl ?? text.unavailable}</dd>
                      </div>
                    ) : null}
                    <div>
                      <dt>{text.keyMasked}</dt>
                      <dd>{activeProviderSetup?.keyMask ?? text.unavailable}</dd>
                    </div>
                    <div>
                      <dt>{text.configuredSource}</dt>
                      <dd>{activeProviderSetup?.source ?? text.unavailable}</dd>
                    </div>
                  </dl>

                  <div className="setup-panel__actions">
                    <button
                      className="secondary-button"
                      onClick={startEditingSelectedProvider}
                      type="button"
                    >
                      {text.edit}
                    </button>
                    {activeProviderSetup?.hasLocalConfig ? (
                      <button
                        className="secondary-button"
                        disabled={isClearingSettings}
                        onClick={() => void handleClearSettings(selectedProvider)}
                        type="button"
                      >
                        {isClearingSettings ? text.refreshing : text.clearLocalConfig}
                      </button>
                    ) : null}
                  </div>

                  {activeProviderSetup?.hasLocalConfig ? (
                    <p className="setup-panel__hint">{text.localConfigOnlyAction}</p>
                  ) : null}
                </>
              )}
            </article>
          ) : null}
        </section>
      ) : (
        <section className="details-view">
          <article className="detail-panel">
            <div className="detail-panel__header">
              <div>
                <div className="detail-panel__title">{text.providerDetails}</div>
                <div className="detail-panel__headline">
                  {selectedSnapshot?.provider.name ?? activeProvider?.name ?? text.unavailable}
                </div>
              </div>
              <span className={`status-pill status-pill--${statusTone}`}>
                {formatStatus(locale, selectedSnapshot?.provider.status ?? activeProvider?.status)}
              </span>
            </div>
            <dl className="detail-list">
              <div>
                <dt>{text.message}</dt>
                <dd>
                  {selectedSnapshot?.provider.message ??
                    activeProvider?.message ??
                    text.noProviderMessage}
                </dd>
              </div>
              <div>
                <dt>{text.capabilities}</dt>
                <dd>
                  {activeProvider?.capabilities.length
                    ? activeProvider.capabilities
                        .map((capability) =>
                          `${formatCapabilityLabel(locale, capability.kind)}: ${
                            capability.available ? text.capabilityOn : text.capabilityOff
                          }`
                        )
                        .join(", ")
                    : text.unavailable}
                </dd>
              </div>
              <div>
                <dt>{text.lastUpdate}</dt>
                <dd>{formatLocalizedDateTime(locale, selectedSnapshot?.refreshedAt)}</dd>
              </div>
            </dl>
          </article>

          <article className="detail-panel">
            <div className="detail-panel__title">{text.environment}</div>
            <dl className="detail-list">
              <div>
                <dt>{text.webview2Installed}</dt>
                <dd>{formatPresence(locale, environmentDiagnostics?.webview2.installed ?? false)}</dd>
              </div>
              <div>
                <dt>{text.webview2Version}</dt>
                <dd>{environmentDiagnostics?.webview2.version ?? text.unavailable}</dd>
              </div>
              <div>
                <dt>{text.registryPath}</dt>
                <dd>{environmentDiagnostics?.webview2.registryPath ?? text.unavailable}</dd>
              </div>
              <div>
                <dt>{text.codexAuth}</dt>
                <dd>{formatPresence(locale, environmentDiagnostics?.codex.authExists ?? false)}</dd>
              </div>
              <div>
                <dt>{text.codexConfig}</dt>
                <dd>{formatPresence(locale, environmentDiagnostics?.codex.configExists ?? false)}</dd>
              </div>
              <div>
                <dt>{text.sessionFiles}</dt>
                <dd>{environmentDiagnostics?.codex.sessionFileCount ?? 0}</dd>
              </div>
              <div>
                <dt>{text.authPath}</dt>
                <dd>{environmentDiagnostics?.codex.authPath ?? text.unavailable}</dd>
              </div>
              <div>
                <dt>{text.sessionsRoot}</dt>
                <dd>{environmentDiagnostics?.codex.sessionsRoot ?? text.unavailable}</dd>
              </div>
              <div>
                <dt>{text.copilotApps}</dt>
                <dd>{formatPresence(locale, environmentDiagnostics?.copilot.appsExists ?? false)}</dd>
              </div>
              <div>
                <dt>{text.copilotOAuth}</dt>
                <dd>{formatPresence(locale, environmentDiagnostics?.copilot.oauthExists ?? false)}</dd>
              </div>
              <div>
                <dt>{text.copilotSessionFiles}</dt>
                <dd>{environmentDiagnostics?.copilot.sessionFileCount ?? 0}</dd>
              </div>
              <div>
                <dt>{text.copilotAppsPath}</dt>
                <dd>{environmentDiagnostics?.copilot.appsPath ?? text.unavailable}</dd>
              </div>
              <div>
                <dt>{text.copilotSessionRoot}</dt>
                <dd>{environmentDiagnostics?.copilot.sessionRoot ?? text.unavailable}</dd>
              </div>
              <div>
                <dt>{text.openrouterApiKey}</dt>
                <dd>
                  {formatPresence(
                    locale,
                    environmentDiagnostics?.apiPlatforms.openrouter.configured ?? false
                  )}
                </dd>
              </div>
              <div>
                <dt>{text.configuredSource}</dt>
                <dd>
                  {environmentDiagnostics?.apiPlatforms.openrouter.source ?? text.unavailable}
                </dd>
              </div>
              <div>
                <dt>{text.customProviderApiKey}</dt>
                <dd>
                  {formatPresence(
                    locale,
                    environmentDiagnostics?.apiPlatforms.customProvider.configured ?? false
                  )}
                </dd>
              </div>
              <div>
                <dt>{text.customProviderDisplayName}</dt>
                <dd>
                  {environmentDiagnostics?.apiPlatforms.customProvider.displayName ??
                    text.unavailable}
                </dd>
              </div>
              <div>
                <dt>{text.customProviderBaseUrl}</dt>
                <dd>
                  {environmentDiagnostics?.apiPlatforms.customProvider.baseUrl ??
                    text.unavailable}
                </dd>
              </div>
              <div>
                <dt>{text.configuredSource}</dt>
                <dd>
                  {environmentDiagnostics?.apiPlatforms.customProvider.source ??
                    text.unavailable}
                </dd>
              </div>
            </dl>
          </article>

          <article className="detail-panel">
            <div className="detail-panel__title">{text.accountDetails}</div>
            <dl className="detail-list">
              <div>
                <dt>{text.email}</dt>
                <dd>{selectedSnapshot?.account.email ?? text.unavailable}</dd>
              </div>
              <div>
                <dt>{text.identifier}</dt>
                <dd>{selectedSnapshot?.account.identifier ?? text.unavailable}</dd>
              </div>
              <div>
                <dt>{text.authMode}</dt>
                <dd>{selectedSnapshot?.account.authMode ?? text.unavailable}</dd>
              </div>
              <div>
                <dt>{text.sourcePath}</dt>
                <dd>{selectedSnapshot?.account.sourcePath ?? text.unavailable}</dd>
              </div>
            </dl>
          </article>

          <article className="detail-panel">
            <div className="detail-panel__title">{text.planDetails}</div>
            <dl className="detail-list">
              <div>
                <dt>{text.name}</dt>
                <dd>{selectedSnapshot?.plan?.name ?? text.unavailable}</dd>
              </div>
              <div>
                <dt>{text.tier}</dt>
                <dd>{selectedSnapshot?.plan?.tier ?? text.unavailable}</dd>
              </div>
              <div>
                <dt>{text.cycle}</dt>
                <dd>{selectedSnapshot?.plan?.cycle ?? text.unavailable}</dd>
              </div>
              <div>
                <dt>{text.renewal}</dt>
                <dd>{formatLocalizedDateTime(locale, selectedSnapshot?.plan?.renewalAt)}</dd>
              </div>
              <div>
                <dt>{text.source}</dt>
                <dd>{selectedSnapshot?.plan?.source ?? text.unavailable}</dd>
              </div>
            </dl>
          </article>

          <article className="detail-panel">
            <div className="detail-panel__title">{text.quotaDetails}</div>
            <dl className="detail-list">
              <div>
                <dt>{text.status}</dt>
                <dd>{formatStatus(locale, selectedSnapshot?.quota?.status)}</dd>
              </div>
              <div>
                <dt>{text.used}</dt>
                <dd>
                  {formatLocalizedQuotaValue(
                    locale,
                    selectedSnapshot?.quota?.used,
                    selectedSnapshot?.quota?.unit
                  )}
                </dd>
              </div>
              <div>
                <dt>{text.remaining}</dt>
                <dd>
                  {formatLocalizedQuotaValue(
                    locale,
                    selectedSnapshot?.quota?.remaining,
                    selectedSnapshot?.quota?.unit
                  )}
                </dd>
              </div>
              <div>
                <dt>{text.total}</dt>
                <dd>
                  {formatLocalizedQuotaValue(
                    locale,
                    selectedSnapshot?.quota?.total,
                    selectedSnapshot?.quota?.unit
                  )}
                </dd>
              </div>
              <div>
                <dt>{text.percentRemaining}</dt>
                <dd>{formatLocalizedPercent(locale, selectedSnapshot?.quota?.percentRemaining)}</dd>
              </div>
              <div>
                <dt>{text.percentUsed}</dt>
                <dd>{formatLocalizedPercent(locale, selectedSnapshot?.quota?.percentUsed)}</dd>
              </div>
              <div>
                <dt>{text.resetTime}</dt>
                <dd>{formatLocalizedDateTime(locale, selectedSnapshot?.quota?.resetAt)}</dd>
              </div>
              <div>
                <dt>{text.countdown}</dt>
                <dd>
                  {formatLocalizedCountdown(locale, selectedSnapshot?.quota?.resetAt, now)}
                </dd>
              </div>
              <div>
                <dt>{text.confidence}</dt>
                <dd>{selectedSnapshot?.quota?.confidence ?? text.unavailable}</dd>
              </div>
              <div>
                <dt>{text.source}</dt>
                <dd>{selectedSnapshot?.quota?.source ?? text.unavailable}</dd>
              </div>
              <div>
                <dt>{text.note}</dt>
                <dd>{selectedSnapshot?.quota?.note ?? text.unavailable}</dd>
              </div>
            </dl>
          </article>

          <article className="detail-panel">
            <div className="detail-panel__title">{text.warnings}</div>
            {selectedSnapshot?.warnings.length ? (
              <ul className="warning-list">
                {selectedSnapshot.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            ) : (
              <p className="empty-state">{text.noWarnings}</p>
            )}
          </article>

          <article className="detail-panel detail-panel--raw">
            <div className="detail-panel__title">{text.rawMetadata}</div>
            {rawMeta ? (
              <pre className="raw-meta">{rawMeta}</pre>
            ) : (
              <p className="empty-state">{text.noRawMetadata}</p>
            )}
          </article>
        </section>
      )}
    </main>
  );
}
