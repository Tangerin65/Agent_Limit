use serde::Serialize;
use serde_json::Value;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderCapability {
    pub kind: String,
    pub available: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderDescriptor {
    pub id: String,
    pub name: String,
    pub status: String,
    pub message: Option<String>,
    pub capabilities: Vec<ProviderCapability>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountSnapshot {
    pub identifier: Option<String>,
    pub email: Option<String>,
    pub auth_mode: Option<String>,
    pub source_path: Option<String>,
    pub detected: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanSnapshot {
    pub name: Option<String>,
    pub tier: Option<String>,
    pub cycle: Option<String>,
    pub renewal_at: Option<String>,
    pub source: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuotaSnapshot {
    pub status: String,
    pub total: Option<f64>,
    pub used: Option<f64>,
    pub remaining: Option<f64>,
    pub percent_used: Option<f64>,
    pub percent_remaining: Option<f64>,
    pub unit: Option<String>,
    pub confidence: Option<String>,
    pub reset_at: Option<String>,
    pub source: Option<String>,
    pub note: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderSnapshot {
    pub provider: ProviderDescriptor,
    pub account: AccountSnapshot,
    pub plan: Option<PlanSnapshot>,
    pub quota: Option<QuotaSnapshot>,
    pub warnings: Vec<String>,
    pub refreshed_at: String,
    pub raw_meta: Option<Value>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebView2Status {
    pub installed: bool,
    pub version: Option<String>,
    pub registry_path: Option<String>,
    pub checked_paths: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexEnvironmentStatus {
    pub root_path: String,
    pub auth_path: String,
    pub config_path: String,
    pub sessions_root: String,
    pub auth_exists: bool,
    pub config_exists: bool,
    pub sessions_exists: bool,
    pub session_file_count: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CopilotEnvironmentStatus {
    pub root_path: String,
    pub apps_path: String,
    pub oauth_path: String,
    pub session_root: String,
    pub vscode_storage_root: String,
    pub apps_exists: bool,
    pub oauth_exists: bool,
    pub session_exists: bool,
    pub vscode_storage_exists: bool,
    pub session_file_count: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvironmentDiagnostics {
    pub webview2: WebView2Status,
    pub codex: CodexEnvironmentStatus,
    pub copilot: CopilotEnvironmentStatus,
    pub warnings: Vec<String>,
}
