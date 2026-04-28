import { invoke } from "@tauri-apps/api/core";
import type {
  EnvironmentDiagnostics,
  ProviderDescriptor,
  ProviderSnapshot
} from "../types/provider";
import type { AppLocale } from "../i18n";

export function getRegisteredProviders(
  locale: AppLocale
): Promise<ProviderDescriptor[]> {
  return invoke("get_registered_providers", { locale });
}

export function refreshProvider(
  providerId: string,
  locale: AppLocale
): Promise<ProviderSnapshot> {
  return invoke("refresh_provider", { providerId, locale });
}

export function getEnvironmentDiagnostics(
  locale: AppLocale
): Promise<EnvironmentDiagnostics> {
  return invoke("get_environment_diagnostics", { locale });
}
