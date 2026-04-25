import { invoke } from "@tauri-apps/api/core";
import type { ProviderDescriptor, ProviderSnapshot } from "../types/provider";

export function getRegisteredProviders(): Promise<ProviderDescriptor[]> {
  return invoke("get_registered_providers");
}

export function refreshProvider(providerId: string): Promise<ProviderSnapshot> {
  return invoke("refresh_provider", { providerId });
}

