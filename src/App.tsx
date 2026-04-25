import { useEffect, useState, useTransition } from "react";
import { ProviderCard } from "./components/ProviderCard";
import { getRegisteredProviders, refreshProvider } from "./lib/api";
import type { ProviderDescriptor, ProviderSnapshot } from "./types/provider";

const DEFAULT_PROVIDER = "codex";

function formatPercent(value?: number | null) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "--";
  }

  return `${value.toFixed(1)}%`;
}

function formatDate(value?: string | null) {
  if (!value) {
    return "--";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString();
}

export default function App() {
  const [providers, setProviders] = useState<ProviderDescriptor[]>([]);
  const [selectedProvider, setSelectedProvider] = useState(DEFAULT_PROVIDER);
  const [snapshot, setSnapshot] = useState<ProviderSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    void (async () => {
      try {
        const registered = await getRegisteredProviders();
        setProviders(registered);
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

  const handleRefresh = (providerId: string) => {
    setError(null);
    startTransition(() => {
      void refreshProvider(providerId)
        .then((result) => {
          setSnapshot(result);
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

  return (
    <main className="shell">
      <div className="shell__backdrop shell__backdrop--left" />
      <div className="shell__backdrop shell__backdrop--right" />

      <section className="hero">
        <div>
          <p className="eyebrow">Agent Limit</p>
          <h1>Track your local Codex session quota without leaving the desktop.</h1>
          <p className="hero__copy">
            The app reads local Codex auth context and recent session rate-limit
            signals, then normalizes the result into a provider-agnostic model.
          </p>
        </div>

        <div className="hero__actions">
          <button
            className="refresh-button"
            disabled={!selectedProvider || isPending || !initialized}
            onClick={() => handleRefresh(selectedProvider)}
            type="button"
          >
            {isPending ? "Refreshing..." : "Refresh"}
          </button>
          <span className="timestamp">
            Last update: {formatDate(snapshot?.refreshedAt)}
          </span>
        </div>
      </section>

      <section className="provider-grid">
        {providers.map((provider) => (
          <ProviderCard
            key={provider.id}
            provider={provider}
            selected={provider.id === selectedProvider}
            onSelect={(providerId) => {
              setSelectedProvider(providerId);
              if (providerId !== snapshot?.provider.id) {
                setSnapshot(null);
              }
            }}
          />
        ))}
      </section>

      {error ? (
        <section className="banner banner--error">{error}</section>
      ) : null}

      {!initialized && !error ? (
        <section className="banner">Loading local provider registry...</section>
      ) : null}

      <section className="dashboard">
        <article className="panel panel--spotlight">
          <div className="panel__label">Provider</div>
          <div className="panel__value">
            {snapshot?.provider.name ?? activeProvider?.name ?? "--"}
          </div>
          <p className="panel__meta">
            {snapshot?.provider.message ??
              activeProvider?.message ??
              "No provider selected."}
          </p>
        </article>

        <article className="panel">
          <div className="panel__label">Account</div>
          <div className="panel__value">
            {snapshot?.account.email ??
              snapshot?.account.identifier ??
              (snapshot?.account.detected ? "Detected" : "--")}
          </div>
          <p className="panel__meta">
            Mode: {snapshot?.account.authMode ?? "--"} | Source:{" "}
            {snapshot?.account.sourcePath ?? "--"}
          </p>
        </article>

        <article className="panel">
          <div className="panel__label">Plan</div>
          <div className="panel__value">
            {snapshot?.plan?.name ?? snapshot?.plan?.tier ?? "--"}
          </div>
          <p className="panel__meta">
            Cycle: {snapshot?.plan?.cycle ?? "--"} | Source:{" "}
            {snapshot?.plan?.source ?? "--"}
          </p>
        </article>

        <article className="panel">
          <div className="panel__label">Remaining</div>
          <div className="panel__value panel__value--quota">
            {formatPercent(snapshot?.quota?.remaining)}
          </div>
          <p className="panel__meta">
            Used: {formatPercent(snapshot?.quota?.used)} | Reset:{" "}
            {formatDate(snapshot?.quota?.resetAt)}
          </p>
        </article>
      </section>

      <section className="details-grid">
        <article className="detail-panel">
          <div className="detail-panel__title">Quota details</div>
          <dl className="detail-list">
            <div>
              <dt>Status</dt>
              <dd>{snapshot?.quota?.status ?? "--"}</dd>
            </div>
            <div>
              <dt>Confidence</dt>
              <dd>{snapshot?.quota?.confidence ?? "--"}</dd>
            </div>
            <div>
              <dt>Source</dt>
              <dd>{snapshot?.quota?.source ?? "--"}</dd>
            </div>
            <div>
              <dt>Note</dt>
              <dd>{snapshot?.quota?.note ?? "--"}</dd>
            </div>
          </dl>
        </article>

        <article className="detail-panel">
          <div className="detail-panel__title">Warnings</div>
          {snapshot?.warnings.length ? (
            <ul className="warning-list">
              {snapshot.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          ) : (
            <p className="empty-state">No warnings for the current snapshot.</p>
          )}
        </article>
      </section>
    </main>
  );
}

