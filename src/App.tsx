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
import codexLogo from "./assets/provider-codex.svg";
import copilotLogo from "./assets/provider-copilot.svg";
import openrouterLogo from "./assets/provider-openrouter.svg";
import customDefaultLogo from "./assets/provider-custom.svg";
import customDeepseekLogo from "./assets/provider-deepseek.svg";
import customKimiLogo from "./assets/provider-kimi.svg";
import customGlmLogo from "./assets/provider-glm.svg";
import customAihubmixLogo from "./assets/provider-aihubmix.svg";
import {
  clearProviderSettings,
  getEnvironmentDiagnostics,
  getProviderSettings,
  getRegisteredProviders,
  refreshProvider,
  saveDesktopWidgetSettings,
  saveProviderSettings,
  setActiveCustomProviderEntry
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
const CUSTOM_PROVIDER_PAGE_SIZE = 4;
const THEME_PREFERENCE_STORAGE_KEY = "agent-limit.theme-preference";

type ViewMode = "dashboard" | "details" | "settings";
type ThemePreference = "system" | "dark" | "light";
type ThemeMode = "dark" | "light";
type CustomVendor = "deepseek" | "kimi" | "glm" | "aihubmix" | "unknown";

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
    customEntryId: string | null;
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
    apiKey: values.customApiKey,
    entryId: values.customEntryId
  };
}

function findCustomProviderEntry(
  settings: ApiKeyStatus | null,
  entryId: string | null
) {
  if (!entryId) {
    return null;
  }

  return settings?.savedEntries.find((entry) => entry.id === entryId) ?? null;
}

function clampEntryPage(page: number, totalEntries: number) {
  const maxPage = Math.max(0, Math.ceil(totalEntries / CUSTOM_PROVIDER_PAGE_SIZE) - 1);
  return Math.min(Math.max(0, page), maxPage);
}

function readStoredThemePreference(): ThemePreference {
  if (typeof localStorage === "undefined") {
    return "system";
  }

  const value = localStorage.getItem(THEME_PREFERENCE_STORAGE_KEY);
  if (value === "system" || value === "dark" || value === "light") {
    return value;
  }
  return "system";
}

function writeStoredThemePreference(preference: ThemePreference) {
  if (typeof localStorage === "undefined") {
    return;
  }
  localStorage.setItem(THEME_PREFERENCE_STORAGE_KEY, preference);
}

function detectSystemTheme(): ThemeMode {
  if (typeof window === "undefined" || typeof window.matchMedia === "undefined") {
    return "dark";
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function clampPercent(value: number) {
  return Math.min(100, Math.max(0, value));
}

function deriveRemainingRingPercent(snapshot: ProviderSnapshot | null) {
  const quota = snapshot?.quota;
  if (!quota) {
    return null;
  }
  if (typeof quota.percentRemaining === "number" && !Number.isNaN(quota.percentRemaining)) {
    return clampPercent(quota.percentRemaining);
  }

  if (
    typeof quota.remaining === "number" &&
    !Number.isNaN(quota.remaining) &&
    typeof quota.total === "number" &&
    !Number.isNaN(quota.total) &&
    quota.total > 0
  ) {
    return clampPercent((quota.remaining / quota.total) * 100);
  }

  return null;
}

function detectCustomVendor(
  snapshot: ProviderSnapshot | null,
  settings: ApiKeyStatus | null
): CustomVendor {
  const detectedVendor = snapshot?.rawMeta?.detectedVendor;
  if (
    detectedVendor === "deepseek" ||
    detectedVendor === "kimi" ||
    detectedVendor === "glm" ||
    detectedVendor === "aihubmix"
  ) {
    return detectedVendor;
  }

  const baseUrl = settings?.baseUrl?.toLowerCase() ?? "";
  if (baseUrl.includes("deepseek")) {
    return "deepseek";
  }
  if (baseUrl.includes("moonshot") || baseUrl.includes("kimi")) {
    return "kimi";
  }
  if (baseUrl.includes("bigmodel") || baseUrl.includes("z.ai")) {
    return "glm";
  }
  if (baseUrl.includes("aihubmix.com")) {
    return "aihubmix";
  }

  return "unknown";
}

function getProviderLogo(
  providerId: string,
  snapshot: ProviderSnapshot | null,
  settings: ApiKeyStatus | null
) {
  if (providerId === "codex") {
    return codexLogo;
  }
  if (providerId === "github-copilot") {
    return copilotLogo;
  }
  if (providerId === "openrouter") {
    return openrouterLogo;
  }
  if (providerId === "custom-provider") {
    const vendor = detectCustomVendor(snapshot, settings);
    if (vendor === "deepseek") {
      return customDeepseekLogo;
    }
    if (vendor === "kimi") {
      return customKimiLogo;
    }
    if (vendor === "glm") {
      return customGlmLogo;
    }
    if (vendor === "aihubmix") {
      return customAihubmixLogo;
    }
    return customDefaultLogo;
  }
  return customDefaultLogo;
}

function getVendorDisplayName(vendor: CustomVendor) {
  switch (vendor) {
    case "deepseek":
      return "DeepSeek";
    case "kimi":
      return "Kimi";
    case "glm":
      return "GLM";
    case "aihubmix":
      return "AIHUBMIX";
    default:
      return "Custom Provider";
  }
}

function buildCustomProviderSuccessBanner(
  locale: AppLocale,
  vendor: CustomVendor
) {
  const text = getTranslation(locale);
  return text.customProviderRefreshSuccess.replace(
    "{vendor}",
    getVendorDisplayName(vendor)
  );
}

export default function App() {
  const [locale, setLocale] = useState<AppLocale>(
    () => readStoredLocale() ?? detectSystemLocale()
  );
  const [themePreference, setThemePreference] = useState<ThemePreference>(
    () => readStoredThemePreference()
  );
  const [systemTheme, setSystemTheme] = useState<ThemeMode>(() => detectSystemTheme());
  const [providers, setProviders] = useState<ProviderDescriptor[]>([]);
  const [selectedProvider, setSelectedProvider] = useState(DEFAULT_PROVIDER);
  const [snapshot, setSnapshot] = useState<ProviderSnapshot | null>(null);
  const [providerSettings, setProviderSettings] =
    useState<ApiPlatformsEnvironmentStatus | null>(null);
  const [environmentDiagnostics, setEnvironmentDiagnostics] =
    useState<EnvironmentDiagnostics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [transientSuccess, setTransientSuccess] = useState<string | null>(null);
  const [providerFormError, setProviderFormError] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("dashboard");
  const [now, setNow] = useState(() => Date.now());
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [isClearingSettings, setIsClearingSettings] = useState(false);
  const [editingProviderId, setEditingProviderId] = useState<string | null>(null);
  const [openrouterApiKey, setOpenrouterApiKey] = useState("");
  const [customDisplayName, setCustomDisplayName] = useState("");
  const [customBaseUrl, setCustomBaseUrl] = useState("");
  const [customApiKey, setCustomApiKey] = useState("");
  const [customEditingEntryId, setCustomEditingEntryId] = useState<string | null>(null);
  const [customEntryPage, setCustomEntryPage] = useState(0);

  const text = getTranslation(locale);
  const resolvedTheme: ThemeMode =
    themePreference === "system" ? systemTheme : themePreference;

  const resetProviderForm = (providerId?: string) => {
    if (!providerId || providerId === "openrouter") {
      setOpenrouterApiKey("");
    }

    if (!providerId || providerId === "custom-provider") {
      setCustomDisplayName("");
      setCustomBaseUrl("");
      setCustomApiKey("");
      setCustomEditingEntryId(null);
    }
  };

  const hydrateEditableValues = (
    providerId: string,
    settings: ApiKeyStatus | null,
    entryId?: string | null
  ) => {
    setProviderFormError(null);

    if (providerId === "openrouter") {
      setOpenrouterApiKey("");
      return;
    }

    const targetEntry = findCustomProviderEntry(settings, entryId ?? settings?.activeEntryId ?? null);
    setCustomDisplayName(targetEntry?.displayName ?? settings?.displayName ?? "");
    setCustomBaseUrl(targetEntry?.baseUrl ?? settings?.baseUrl ?? "");
    setCustomApiKey("");
    setCustomEditingEntryId(targetEntry?.id ?? null);
  };

  const handleRefresh = async (
    providerId: string,
    currentLocale: AppLocale
  ): Promise<ProviderSnapshot | null> => {
    setError(null);
    setTransientSuccess(null);
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
      return result;
    } catch (refreshError) {
      setError(
        refreshError instanceof Error
          ? refreshError.message
          : text.providerRefreshFailed
      );
      return null;
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
        customApiKey,
        customEntryId: customEditingEntryId
      });

      const settings = await saveProviderSettings(providerId, payload, locale);
      setProviderSettings(settings);
      setEditingProviderId(null);
      setCustomEditingEntryId(settings.customProvider.activeEntryId ?? null);
      resetProviderForm(providerId);
      setCustomEntryPage((currentPage) =>
        clampEntryPage(currentPage, settings.customProvider.savedEntries.length)
      );
      const refreshed = await handleRefresh(providerId, locale);

      if (providerId === "custom-provider" && refreshed?.quota?.status === "available") {
        const vendor = detectCustomVendor(refreshed, settings.customProvider);
        setTransientSuccess(buildCustomProviderSuccessBanner(locale, vendor));
      }
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
      const entryId =
        providerId === "custom-provider"
          ? activeProviderSetup?.activeEntryId ?? customEditingEntryId
          : null;
      const settings = await clearProviderSettings(providerId, entryId ?? null, locale);
      setProviderSettings(settings);
      setEditingProviderId(null);
      setCustomEditingEntryId(settings.customProvider.activeEntryId ?? null);
      resetProviderForm(providerId);
      setCustomEntryPage((currentPage) =>
        clampEntryPage(currentPage, settings.customProvider.savedEntries.length)
      );
      await handleRefresh(providerId, locale);
    } catch (clearError) {
      setProviderFormError(
        clearError instanceof Error ? clearError.message : text.initFailed
      );
    } finally {
      setIsClearingSettings(false);
    }
  };

  const handleSelectCustomEntry = async (entryId: string) => {
    if (selectedProvider !== "custom-provider") {
      return;
    }

    setError(null);
    setProviderFormError(null);

    try {
      const settings = await setActiveCustomProviderEntry(entryId, locale);
      setProviderSettings(settings);
      setCustomEditingEntryId(entryId);
      setEditingProviderId(null);
      const selectedIndex = settings.customProvider.savedEntries.findIndex(
        (entry) => entry.id === entryId
      );
      if (selectedIndex >= 0) {
        setCustomEntryPage(
          clampEntryPage(
            Math.floor(selectedIndex / CUSTOM_PROVIDER_PAGE_SIZE),
            settings.customProvider.savedEntries.length
          )
        );
      }
      await handleRefresh("custom-provider", locale);
    } catch (selectionError) {
      setProviderFormError(
        selectionError instanceof Error ? selectionError.message : text.initFailed
      );
    }
  };

  const handleDesktopWidgetVisibilityChange = async (visible: boolean) => {
    try {
      const settings = await saveDesktopWidgetSettings(
        {
          visible,
          providerId:
            providerSettings?.desktopWidget.providerId ??
            selectedProvider ??
            DEFAULT_PROVIDER
        },
        locale
      );
      setProviderSettings(settings);
    } catch (widgetError) {
      setError(widgetError instanceof Error ? widgetError.message : text.initFailed);
    }
  };

  useEffect(() => {
    writeStoredLocale(locale);
  }, [locale]);

  useEffect(() => {
    writeStoredThemePreference(themePreference);
  }, [themePreference]);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia === "undefined") {
      return;
    }

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (event: MediaQueryListEvent) => {
      setSystemTheme(event.matches ? "dark" : "light");
    };

    setSystemTheme(media.matches ? "dark" : "light");

    if (typeof media.addEventListener === "function") {
      media.addEventListener("change", handler);
      return () => media.removeEventListener("change", handler);
    }

    media.addListener(handler);
    return () => media.removeListener(handler);
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", resolvedTheme);
  }, [resolvedTheme]);

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

  useEffect(() => {
    if (selectedProvider !== "custom-provider") {
      return;
    }

    setCustomEntryPage((currentPage) =>
      clampEntryPage(currentPage, providerSettings?.customProvider.savedEntries.length ?? 0)
    );
  }, [providerSettings?.customProvider.savedEntries.length, selectedProvider]);

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
  const customProviderEntries = activeProviderSetup?.savedEntries ?? [];
  const activeCustomProviderEntryId = activeProviderSetup?.activeEntryId ?? null;
  const clampedCustomEntryPage = clampEntryPage(
    customEntryPage,
    customProviderEntries.length
  );
  const customEntryStart = clampedCustomEntryPage * CUSTOM_PROVIDER_PAGE_SIZE;
  const visibleCustomProviderEntries = customProviderEntries.slice(
    customEntryStart,
    customEntryStart + CUSTOM_PROVIDER_PAGE_SIZE
  );
  const customEntryPageCount = Math.max(
    1,
    Math.ceil(customProviderEntries.length / CUSTOM_PROVIDER_PAGE_SIZE)
  );
  const desktopWidgetVisible = providerSettings?.desktopWidget.visible ?? false;
  const rawMeta = selectedSnapshot?.rawMeta
    ? JSON.stringify(selectedSnapshot.rawMeta, null, 2)
    : null;
  const metricPresentation = buildMetricPresentation(
    locale,
    selectedProvider,
    selectedSnapshot
  );
  const showRemainingRing = selectedProvider !== "custom-provider";
  const remainingRingPercent = deriveRemainingRingPercent(selectedSnapshot);
  const ringRadius = 58;
  const ringCircumference = 2 * Math.PI * ringRadius;
  const ringStrokeOffset =
    remainingRingPercent === null
      ? ringCircumference
      : ringCircumference * (1 - remainingRingPercent / 100);
  const ringPercentLabel =
    remainingRingPercent === null
      ? text.unavailable
      : `${remainingRingPercent.toFixed(1)}%`;
  const isEditingSelectedProvider = editingProviderId === selectedProvider;
  const showProviderSetup = isSetupProvider(selectedProvider);
  const showSetupForm =
    showProviderSetup &&
    (isEditingSelectedProvider || !activeProviderSetup?.configured);

  const startEditingSelectedProvider = () => {
    const currentSettings = getActiveProviderSettings(providerSettings, selectedProvider);
    hydrateEditableValues(
      selectedProvider,
      currentSettings,
      currentSettings?.activeEntryId ?? null
    );
    setEditingProviderId(selectedProvider);
  };

  const startAddingCustomProviderEntry = () => {
    setProviderFormError(null);
    setCustomDisplayName("");
    setCustomBaseUrl("");
    setCustomApiKey("");
    setCustomEditingEntryId(null);
    setEditingProviderId("custom-provider");
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
                  setTransientSuccess(null);
                  setSelectedProvider(provider.id);
                }}
                type="button"
              >
                <img
                  alt=""
                  aria-hidden
                  className="provider-switch__logo"
                  src={getProviderLogo(
                    provider.id,
                    provider.id === selectedProvider ? selectedSnapshot : null,
                    getActiveProviderSettings(providerSettings, provider.id)
                  )}
                />
                <span className="provider-switch__label">{provider.name}</span>
              </button>
            ))}
          </div>

          <div className="topbar__utility-row">
            <div className="topbar__actions">
              <button
                className="primary-button primary-button--refresh"
                disabled={!selectedProvider || isRefreshing || !initialized}
                onClick={() => void handleRefresh(selectedProvider, locale)}
                type="button"
              >
                {isRefreshing ? text.refreshing : text.refresh}
              </button>
              <div className="segment-control topbar__nav">
                <button
                  className={`segment-control__item ${
                    viewMode === "dashboard" ? "segment-control__item--active" : ""
                  }`}
                  onClick={() => setViewMode("dashboard")}
                  type="button"
                >
                  {text.dashboard}
                </button>
                <button
                  className={`segment-control__item ${
                    viewMode === "details" ? "segment-control__item--active" : ""
                  }`}
                  onClick={() => setViewMode("details")}
                  type="button"
                >
                  {text.details}
                </button>
                <button
                  className={`segment-control__item ${
                    viewMode === "settings" ? "segment-control__item--active" : ""
                  }`}
                  onClick={() => setViewMode("settings")}
                  type="button"
                >
                  {text.settings}
                </button>
              </div>
            </div>
          </div>
        </div>
      </header>

      {transientSuccess ? (
        <section className="banner banner--success">{transientSuccess}</section>
      ) : null}

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
              <div className="metric-card__remaining-layout">
                {showRemainingRing ? (
                  <div className="metric-ring" aria-label={text.remainingPercent}>
                    <svg className="metric-ring__svg" viewBox="0 0 140 140" role="img">
                      <circle
                        className="metric-ring__track"
                        cx="70"
                        cy="70"
                        r={ringRadius}
                      />
                      <circle
                        className="metric-ring__progress"
                        cx="70"
                        cy="70"
                        r={ringRadius}
                        style={{
                          strokeDasharray: ringCircumference,
                          strokeDashoffset: ringStrokeOffset
                        }}
                      />
                    </svg>
                    <div className="metric-ring__center">
                      <span>{ringPercentLabel}</span>
                    </div>
                  </div>
                ) : null}
                <div className="metric-card__remaining-content">
                  <div className={metricPresentation.valueClassName}>
                    {metricPresentation.value}
                  </div>
                  <p className="metric-card__meta">{metricPresentation.meta}</p>
                  {metricPresentation.submeta ? (
                    <p className="metric-card__submeta">{metricPresentation.submeta}</p>
                  ) : null}
                </div>
              </div>
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

              {selectedProvider === "custom-provider" ? (
                <div className="custom-provider-browser">
                  <div className="custom-provider-browser__header">
                    <div className="detail-panel__title">{text.savedProviders}</div>
                    <div className="custom-provider-browser__controls">
                      <button
                        aria-label={text.previousEntries}
                        className="secondary-button secondary-button--icon"
                        disabled={clampedCustomEntryPage === 0}
                        onClick={() =>
                          setCustomEntryPage((page) =>
                            clampEntryPage(page - 1, customProviderEntries.length)
                          )
                        }
                        type="button"
                      >
                        {"<"}
                      </button>
                      <span className="setup-panel__hint">
                        {text.entryPagination
                          .replace("{current}", (clampedCustomEntryPage + 1).toString())
                          .replace("{total}", customEntryPageCount.toString())}
                      </span>
                      <button
                        aria-label={text.nextEntries}
                        className="secondary-button secondary-button--icon"
                        disabled={clampedCustomEntryPage >= customEntryPageCount - 1}
                        onClick={() =>
                          setCustomEntryPage((page) =>
                            clampEntryPage(page + 1, customProviderEntries.length)
                          )
                        }
                        type="button"
                      >
                        {">"}
                      </button>
                    </div>
                  </div>

                  {customProviderEntries.length ? (
                    <div className="custom-provider-browser__grid">
                      {visibleCustomProviderEntries.map((entry) => (
                        <button
                          key={entry.id}
                          className={`custom-provider-card ${
                            entry.id === activeCustomProviderEntryId
                              ? "custom-provider-card--active"
                              : ""
                          }`}
                          onClick={() => void handleSelectCustomEntry(entry.id)}
                          type="button"
                        >
                          <span className="custom-provider-card__title">
                            {entry.displayName}
                          </span>
                          <span className="custom-provider-card__base">{entry.baseUrl}</span>
                          <span className="custom-provider-card__meta">{entry.keyMask}</span>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="empty-state">{text.noSavedProviders}</p>
                  )}
                </div>
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
                    {selectedProvider === "custom-provider" && customEditingEntryId ? (
                      <button
                        className="secondary-button"
                        disabled={isClearingSettings}
                        onClick={() => void handleClearSettings(selectedProvider)}
                        type="button"
                      >
                        {isClearingSettings ? text.refreshing : text.deleteEntry}
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
                    {selectedProvider === "custom-provider" && activeCustomProviderEntryId ? (
                      <button
                        className="secondary-button"
                        onClick={startEditingSelectedProvider}
                        type="button"
                      >
                        {text.edit}
                      </button>
                    ) : selectedProvider !== "custom-provider" ? (
                      <button
                        className="secondary-button"
                        onClick={() => {
                          startEditingSelectedProvider();
                        }}
                        type="button"
                      >
                        {text.edit}
                      </button>
                    ) : null}
                    {selectedProvider === "custom-provider" ? (
                      <button
                        className="primary-button"
                        onClick={startAddingCustomProviderEntry}
                        type="button"
                      >
                        {text.addProvider}
                      </button>
                    ) : null}
                    {activeProviderSetup?.hasLocalConfig ? (
                      <button
                        className="secondary-button"
                        disabled={isClearingSettings}
                        onClick={() => void handleClearSettings(selectedProvider)}
                        type="button"
                      >
                        {isClearingSettings
                          ? text.refreshing
                          : selectedProvider === "custom-provider"
                            ? text.deleteEntry
                            : text.clearLocalConfig}
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
      ) : viewMode === "details" ? (
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
      ) : (
        <section className="settings-view">
          <article className="detail-panel settings-panel">
            <div className="detail-panel__header">
              <div>
                <div className="detail-panel__title">{text.settings}</div>
                <div className="detail-panel__headline">{text.appearance}</div>
              </div>
            </div>

            <div className="settings-grid">
              <label className="settings-field">
                <span>{text.language}</span>
                <select
                  className="settings-select"
                  value={locale}
                  onChange={(event) => setLocale(event.target.value as AppLocale)}
                >
                  <option value="en">English</option>
                  <option value="zh-CN">简体中文</option>
                </select>
              </label>

              <div className="settings-field">
                <span>{text.theme}</span>
                <div className="segment-control">
                  <button
                    className={`segment-control__item ${
                      themePreference === "system"
                        ? "segment-control__item--active"
                        : ""
                    }`}
                    onClick={() => setThemePreference("system")}
                    type="button"
                  >
                    {text.themeSystem}
                  </button>
                  <button
                    className={`segment-control__item ${
                      themePreference === "dark" ? "segment-control__item--active" : ""
                    }`}
                    onClick={() => setThemePreference("dark")}
                    type="button"
                  >
                    {text.themeDark}
                  </button>
                  <button
                    className={`segment-control__item ${
                      themePreference === "light"
                        ? "segment-control__item--active"
                        : ""
                    }`}
                    onClick={() => setThemePreference("light")}
                    type="button"
                  >
                    {text.themeLight}
                  </button>
                </div>
                <p className="settings-hint">
                  {themePreference === "system"
                    ? `${text.themeCurrent} ${resolvedTheme === "dark" ? text.themeDark : text.themeLight}`
                    : `${text.themeCurrent} ${themePreference === "dark" ? text.themeDark : text.themeLight}`}
                </p>
              </div>

              <label className="settings-field settings-field--checkbox">
                <span>{text.desktopWidget}</span>
                <div className="settings-checkbox">
                  <input
                    checked={desktopWidgetVisible}
                    onChange={(event) =>
                      void handleDesktopWidgetVisibilityChange(event.target.checked)
                    }
                    type="checkbox"
                  />
                  <span>
                    {desktopWidgetVisible
                      ? text.desktopWidgetVisible
                      : text.desktopWidgetHidden}
                  </span>
                </div>
                <p className="settings-hint">{text.desktopWidgetHint}</p>
              </label>
            </div>
          </article>
        </section>
      )}
    </main>
  );
}
