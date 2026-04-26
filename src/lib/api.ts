import { invoke } from "@tauri-apps/api/core";
import type {
  EnvironmentDiagnostics,
  ProviderDescriptor,
  ProviderSnapshot
} from "../types/provider";

export function getRegisteredProviders(): Promise<ProviderDescriptor[]> {
  return invoke("get_registered_providers");
}

export function refreshProvider(providerId: string): Promise<ProviderSnapshot> {
  return invoke("refresh_provider", { providerId });
}

export function getEnvironmentDiagnostics(): Promise<EnvironmentDiagnostics> {
  return invoke("get_environment_diagnostics");
}
