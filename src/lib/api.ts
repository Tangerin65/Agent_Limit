import { invoke } from "@tauri-apps/api/core";
import type {
  ApiPlatformsEnvironmentStatus,
  EnvironmentDiagnostics,
  ProviderDescriptor,
  ProviderSettingsInput,
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

export function getProviderSettings(
  locale: AppLocale
): Promise<ApiPlatformsEnvironmentStatus> {
  return invoke("get_provider_settings", { locale });
}

export function saveProviderSettings(
  providerId: string,
  payload: ProviderSettingsInput,
  locale: AppLocale
): Promise<ApiPlatformsEnvironmentStatus> {
  return invoke("save_provider_settings", { providerId, payload, locale });
}

export function clearProviderSettings(
  providerId: string,
  locale: AppLocale
): Promise<ApiPlatformsEnvironmentStatus> {
  return invoke("clear_provider_settings", { providerId, locale });
}
