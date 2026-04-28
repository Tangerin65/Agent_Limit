export type ProviderStatus = "ready" | "planned" | "degraded" | "unavailable";

export interface ProviderCapability {
  kind: string;
  available: boolean;
}

export interface ProviderDescriptor {
  id: string;
  name: string;
  status: ProviderStatus;
  message?: string | null;
  capabilities: ProviderCapability[];
}

export interface AccountSnapshot {
  identifier?: string | null;
  email?: string | null;
  authMode?: string | null;
  sourcePath?: string | null;
  detected: boolean;
}

export interface PlanSnapshot {
  name?: string | null;
  tier?: string | null;
  cycle?: string | null;
  renewalAt?: string | null;
  source?: string | null;
}

export interface QuotaSnapshot {
  status: "available" | "unavailable";
  total?: number | null;
  used?: number | null;
  remaining?: number | null;
  percentUsed?: number | null;
  percentRemaining?: number | null;
  unit?: string | null;
  confidence?: string | null;
  resetAt?: string | null;
  source?: string | null;
  note?: string | null;
}

export interface ProviderSnapshot {
  provider: ProviderDescriptor;
  account: AccountSnapshot;
  plan?: PlanSnapshot | null;
  quota?: QuotaSnapshot | null;
  warnings: string[];
  refreshedAt: string;
  rawMeta?: Record<string, unknown> | null;
}

export interface WebView2Status {
  installed: boolean;
  version?: string | null;
  registryPath?: string | null;
  checkedPaths: string[];
}

export interface CodexEnvironmentStatus {
  rootPath: string;
  authPath: string;
  configPath: string;
  sessionsRoot: string;
  authExists: boolean;
  configExists: boolean;
  sessionsExists: boolean;
  sessionFileCount: number;
}

export interface CopilotEnvironmentStatus {
  rootPath: string;
  appsPath: string;
  oauthPath: string;
  sessionRoot: string;
  vscodeStorageRoot: string;
  appsExists: boolean;
  oauthExists: boolean;
  sessionExists: boolean;
  vscodeStorageExists: boolean;
  sessionFileCount: number;
}

export interface EnvironmentDiagnostics {
  webview2: WebView2Status;
  codex: CodexEnvironmentStatus;
  copilot: CopilotEnvironmentStatus;
  warnings: string[];
}
