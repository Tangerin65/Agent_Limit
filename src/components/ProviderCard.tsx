import type { ProviderDescriptor } from "../types/provider";

interface ProviderCardProps {
  provider: ProviderDescriptor;
  selected: boolean;
  onSelect: (providerId: string) => void;
}

export function ProviderCard({
  provider,
  selected,
  onSelect
}: ProviderCardProps) {
  const disabled = provider.status !== "ready" && provider.status !== "degraded";

  return (
    <button
      className={`provider-card ${selected ? "selected" : ""}`}
      onClick={() => onSelect(provider.id)}
      disabled={disabled}
      type="button"
    >
      <div className="provider-card__topline">
        <span className="provider-card__name">{provider.name}</span>
        <span className={`chip chip--${provider.status}`}>{provider.status}</span>
      </div>
      <p className="provider-card__message">
        {provider.message ?? "No details available."}
      </p>
      <div className="provider-card__capabilities">
        {provider.capabilities.map((capability) => (
          <span
            key={`${provider.id}-${capability.kind}`}
            className={`capability ${capability.available ? "on" : "off"}`}
          >
            {capability.kind}
          </span>
        ))}
      </div>
    </button>
  );
}

