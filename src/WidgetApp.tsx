import { useEffect, useMemo, useState } from "react";
import {
  detectSystemLocale,
  formatLocalizedPercent,
  formatLocalizedQuotaValue,
  getTranslation,
  readStoredLocale,
  type AppLocale
} from "./i18n";
import {
  getProviderSettings,
  getRegisteredProviders,
  refreshProvider,
  saveDesktopWidgetSettings
} from "./lib/api";
import type { ProviderDescriptor, ProviderSnapshot } from "./types/provider";

const DEFAULT_PROVIDER = "codex";
const LOCALE_STORAGE_KEY = "agent-limit.locale";
const THEME_PREFERENCE_STORAGE_KEY = "agent-limit.theme-preference";

type ThemePreference = "system" | "dark" | "light";
type ThemeMode = "dark" | "light";

function detectSystemTheme(): ThemeMode {
  if (typeof window === "undefined" || typeof window.matchMedia === "undefined") {
    return "dark";
  }

  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
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

function clampPercent(value: number) {
  return Math.min(100, Math.max(0, value));
}

function deriveRingPercent(snapshot: ProviderSnapshot | null) {
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

function buildWidgetValue(locale: AppLocale, providerId: string, snapshot: ProviderSnapshot | null) {
  const quota = snapshot?.quota;

  if (providerId === "github-copilot" && typeof quota?.percentRemaining === "number") {
    return formatLocalizedPercent(locale, quota.percentRemaining);
  }

  return formatLocalizedQuotaValue(locale, quota?.remaining, quota?.unit);
}

function shouldShowRing(providerId: string) {
  return providerId === "codex" || providerId === "github-copilot";
}

export default function WidgetApp() {
  const [locale, setLocale] = useState<AppLocale>(
    () => readStoredLocale() ?? detectSystemLocale()
  );
  const [themePreference, setThemePreference] = useState<ThemePreference>(
    () => readStoredThemePreference()
  );
  const [systemTheme, setSystemTheme] = useState<ThemeMode>(() => detectSystemTheme());
  const [providers, setProviders] = useState<ProviderDescriptor[]>([]);
  const [selectedProviderId, setSelectedProviderId] = useState(DEFAULT_PROVIDER);
  const [snapshot, setSnapshot] = useState<ProviderSnapshot | null>(null);
  const [initialized, setInitialized] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const text = getTranslation(locale);
  const resolvedTheme: ThemeMode =
    themePreference === "system" ? systemTheme : themePreference;
  const selectedProviderIndex = Math.max(
    0,
    providers.findIndex((provider) => provider.id === selectedProviderId)
  );
  const activeProvider = providers[selectedProviderIndex] ?? null;
  const ringPercent = deriveRingPercent(snapshot);
  const ringRadius = 48;
  const ringCircumference = 2 * Math.PI * ringRadius;
  const ringStrokeOffset =
    ringPercent === null
      ? ringCircumference
      : ringCircumference * (1 - ringPercent / 100);
  const ringLabel =
    ringPercent === null ? text.unavailable : `${ringPercent.toFixed(1)}%`;
  const quotaValue = useMemo(
    () => buildWidgetValue(locale, selectedProviderId, snapshot),
    [locale, selectedProviderId, snapshot]
  );
  const showRing = shouldShowRing(selectedProviderId);
  const showRemainingValue = !showRing;

  const refreshCurrentProvider = async (providerId: string) => {
    setError(null);
    setIsRefreshing(true);
    try {
      const result = await refreshProvider(providerId, locale);
      setSnapshot(result);
    } catch (refreshError) {
      setError(
        refreshError instanceof Error ? refreshError.message : text.providerRefreshFailed
      );
    } finally {
      setIsRefreshing(false);
    }
  };

  const persistWidgetProvider = async (providerId: string) => {
    try {
      await saveDesktopWidgetSettings(
        {
          visible: true,
          providerId
        },
        locale
      );
    } catch {
      // Keep the widget responsive even if preference persistence fails.
    }
  };

  const selectProviderByOffset = async (offset: number) => {
    if (!providers.length) {
      return;
    }

    const nextIndex = (selectedProviderIndex + offset + providers.length) % providers.length;
    const nextProvider = providers[nextIndex];
    setSelectedProviderId(nextProvider.id);
    await persistWidgetProvider(nextProvider.id);
    await refreshCurrentProvider(nextProvider.id);
  };

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", resolvedTheme);
  }, [resolvedTheme]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const handleStorage = (event: StorageEvent) => {
      if (event.key === LOCALE_STORAGE_KEY) {
        setLocale(readStoredLocale() ?? detectSystemLocale());
      }

      if (event.key === THEME_PREFERENCE_STORAGE_KEY) {
        setThemePreference(readStoredThemePreference());
      }
    };

    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia === "undefined") {
      return;
    }

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const handleThemeChange = (event: MediaQueryListEvent) => {
      setSystemTheme(event.matches ? "dark" : "light");
    };

    setSystemTheme(media.matches ? "dark" : "light");

    if (typeof media.addEventListener === "function") {
      media.addEventListener("change", handleThemeChange);
      return () => media.removeEventListener("change", handleThemeChange);
    }

    media.addListener(handleThemeChange);
    return () => media.removeListener(handleThemeChange);
  }, []);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const [registeredProviders, settings] = await Promise.all([
          getRegisteredProviders(locale),
          getProviderSettings(locale)
        ]);

        if (cancelled) {
          return;
        }

        setProviders(registeredProviders);
        const preferredProviderId =
          settings.desktopWidget.providerId ??
          registeredProviders.find((provider) => provider.id === DEFAULT_PROVIDER)?.id ??
          registeredProviders[0]?.id ??
          DEFAULT_PROVIDER;

        setSelectedProviderId(preferredProviderId);
        await refreshCurrentProvider(preferredProviderId);
      } finally {
        if (!cancelled) {
          setInitialized(true);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [locale]);

  return (
    <main className="widget-shell">
      <article className="widget-card">
        <div className="widget-card__header">
          <button
            aria-label={text.previousProvider}
            className="widget-nav-button"
            disabled={!providers.length || isRefreshing}
            onClick={() => void selectProviderByOffset(-1)}
            type="button"
          >
            {"<"}
          </button>
          <div className="widget-card__title-group" data-tauri-drag-region>
            <strong className="widget-card__title">
              {activeProvider?.name ?? text.unavailable}
            </strong>
          </div>
          <button
            aria-label={text.nextProvider}
            className="widget-nav-button"
            disabled={!providers.length || isRefreshing}
            onClick={() => void selectProviderByOffset(1)}
            type="button"
          >
            {">"}
          </button>
        </div>

        <div className="widget-card__body">
          {showRing ? (
            <div className="widget-ring" aria-label={text.remainingPercent}>
              <svg className="widget-ring__svg" viewBox="0 0 120 120" role="img">
                <circle className="widget-ring__track" cx="60" cy="60" r={ringRadius} />
                <circle
                  className="widget-ring__progress"
                  cx="60"
                  cy="60"
                  r={ringRadius}
                  style={{
                    strokeDasharray: ringCircumference,
                    strokeDashoffset: ringStrokeOffset
                  }}
                />
              </svg>
              <div className="widget-ring__center">{ringLabel}</div>
            </div>
          ) : null}

          {showRemainingValue ? (
            <div className="widget-card__value-group">
              <span className="widget-card__value-label">{text.remaining}</span>
              <strong className="widget-card__value">{quotaValue}</strong>
            </div>
          ) : null}
        </div>

        <div className="widget-card__footer">
          <button
            className="widget-refresh-button"
            disabled={!initialized || !selectedProviderId || isRefreshing}
            onClick={() => void refreshCurrentProvider(selectedProviderId)}
            type="button"
          >
            {isRefreshing ? text.refreshing : text.refresh}
          </button>
          {error ? <span className="widget-card__error">{error}</span> : null}
        </div>
      </article>
    </main>
  );
}
