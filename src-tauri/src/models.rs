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

