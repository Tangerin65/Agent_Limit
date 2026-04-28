use std::fs;
use std::path::PathBuf;

use chrono::{Datelike, TimeZone, Utc};
use reqwest::blocking::Client;
use reqwest::header::{ACCEPT, AUTHORIZATION, HeaderMap, HeaderValue};
use serde::Deserialize;
use serde_json::json;

use crate::error::AppError;
use crate::models::{
    AccountSnapshot, PlanSnapshot, ProviderDescriptor, ProviderSnapshot, QuotaSnapshot,
};
use crate::providers::{capability, ProviderAdapter};

const COPILOT_USER_ENDPOINT: &str = "https://api.github.com/copilot_internal/user";

pub struct GitHubCopilotProvider;

impl GitHubCopilotProvider {
    pub fn new() -> Self {
        Self
    }
}

impl ProviderAdapter for GitHubCopilotProvider {
    fn descriptor(&self) -> ProviderDescriptor {
        let paths = CopilotPaths::detect();
        let has_login = paths.apps_path.exists() || paths.oauth_path.exists();

        ProviderDescriptor {
            id: "github-copilot".to_string(),
            name: "GitHub Copilot".to_string(),
            status: if has_login { "ready" } else { "degraded" }.to_string(),
            message: Some(if has_login {
                "读取本地 GitHub Copilot 登录态，并从 GitHub 刷新套餐与配额信息。"
                    .to_string()
            } else {
                "当前用户目录中未找到 GitHub Copilot 登录文件。".to_string()
            }),
            capabilities: vec![
                capability("account", has_login),
                capability("plan", has_login),
                capability("quota", has_login),
            ],
        }
    }

    fn refresh(&self) -> Result<ProviderSnapshot, AppError> {
        let paths = CopilotPaths::detect();
        let descriptor = self.descriptor();
        let refreshed_at = Utc::now().to_rfc3339();

        let login = read_login(&paths)?;
        let Some(login) = login else {
            return Ok(ProviderSnapshot {
                provider: descriptor,
                account: AccountSnapshot {
                    identifier: None,
                    email: None,
                    auth_mode: Some("oauth".to_string()),
                    source_path: Some(paths.apps_path.display().to_string()),
                    detected: false,
                },
                plan: None,
                quota: Some(QuotaSnapshot {
                    status: "unavailable".to_string(),
                    total: None,
                    used: None,
                    remaining: None,
                    percent_used: None,
                    percent_remaining: None,
                    unit: Some("requests".to_string()),
                    confidence: Some("none".to_string()),
                    reset_at: None,
                    source: Some("local-filesystem".to_string()),
                    note: Some("未找到 GitHub Copilot 登录文件。".to_string()),
                }),
                warnings: vec![
                    "当前 Windows 用户似乎尚未登录 GitHub Copilot。".to_string(),
                ],
                refreshed_at,
                raw_meta: Some(json!({
                    "appsPath": paths.apps_path.display().to_string(),
                    "oauthPath": paths.oauth_path.display().to_string(),
                    "sessionRoot": paths.session_root.display().to_string(),
                    "vscodeStorageRoot": paths.vscode_storage_root.display().to_string()
                })),
            });
        };

        let account = AccountSnapshot {
            identifier: login.account_id.clone().or_else(|| Some(login.username.clone())),
            email: None,
            auth_mode: Some("oauth".to_string()),
            source_path: Some(login.source_path.clone()),
            detected: true,
        };

        match fetch_remote_user(&login.username, &login.token) {
            Ok(remote) => {
                let quota = build_quota_snapshot(&remote);
                let plan = Some(PlanSnapshot {
                    name: Some(format_plan_name(&remote)),
                    tier: Some(remote.access_type_sku.clone()),
                    cycle: Some("monthly".to_string()),
                    renewal_at: resolve_reset_at(&remote),
                    source: Some("copilot_internal/user".to_string()),
                });

                let mut warnings = Vec::new();
                if quota.as_ref().is_some_and(|snapshot| snapshot.status != "available") {
                    warnings.push(
                        "已检测到 GitHub Copilot 账号，但当前套餐或上下文未返回 premium requests 配额。"
                            .to_string(),
                    );
                }

                Ok(ProviderSnapshot {
                    provider: descriptor,
                    account,
                    plan,
                    quota,
                    warnings,
                    refreshed_at,
                    raw_meta: Some(json!({
                        "appsPath": paths.apps_path.display().to_string(),
                        "oauthPath": paths.oauth_path.display().to_string(),
                        "sessionRoot": paths.session_root.display().to_string(),
                        "vscodeStorageRoot": paths.vscode_storage_root.display().to_string(),
                        "login": remote.login,
                        "copilotPlan": remote.copilot_plan,
                        "accessTypeSku": remote.access_type_sku,
                        "quotaResetDate": remote.quota_reset_date,
                        "quotaResetDateUtc": remote.quota_reset_date_utc,
                        "quotaSnapshots": remote.quota_snapshots
                    })),
                })
            }
            Err(error) => Ok(ProviderSnapshot {
                provider: ProviderDescriptor {
                    status: "degraded".to_string(),
                    message: Some(
                        "已检测到本地 GitHub Copilot 登录态，但刷新配额请求失败。"
                            .to_string(),
                    ),
                    ..descriptor
                },
                account,
                plan: None,
                quota: Some(QuotaSnapshot {
                    status: "unavailable".to_string(),
                    total: None,
                    used: None,
                    remaining: None,
                    percent_used: None,
                    percent_remaining: None,
                    unit: Some("requests".to_string()),
                    confidence: Some("low".to_string()),
                    reset_at: None,
                    source: Some("copilot_internal/user".to_string()),
                    note: Some(
                        "配额刷新失败；如果持续出现，请在 GitHub Copilot 中重新登录。"
                            .to_string(),
                    ),
                }),
                warnings: vec![format!("GitHub Copilot 刷新失败：{error}")],
                refreshed_at,
                raw_meta: Some(json!({
                    "appsPath": paths.apps_path.display().to_string(),
                    "oauthPath": paths.oauth_path.display().to_string(),
                    "sessionRoot": paths.session_root.display().to_string(),
                    "vscodeStorageRoot": paths.vscode_storage_root.display().to_string(),
                    "username": login.username
                })),
            }),
        }
    }
}

#[derive(Debug)]
struct CopilotPaths {
    apps_path: PathBuf,
    oauth_path: PathBuf,
    session_root: PathBuf,
    vscode_storage_root: PathBuf,
}

impl CopilotPaths {
    fn detect() -> Self {
        let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
        let local_data = dirs::data_local_dir().unwrap_or_else(|| home.join("AppData").join("Local"));
        let data_dir = dirs::data_dir().unwrap_or_else(|| home.join("AppData").join("Roaming"));

        Self {
            apps_path: local_data.join("github-copilot").join("apps.json"),
            oauth_path: local_data.join("github-copilot").join("oauth.json"),
            session_root: home.join(".copilot").join("session-state"),
            vscode_storage_root: data_dir
                .join("Code")
                .join("User")
                .join("globalStorage")
                .join("github.copilot-chat"),
        }
    }
}

#[derive(Debug)]
struct CopilotLogin {
    username: String,
    account_id: Option<String>,
    token: String,
    source_path: String,
}

#[derive(Debug, Deserialize)]
struct AppsLoginFile(std::collections::HashMap<String, AppsLoginEntry>);

#[derive(Debug, Deserialize)]
struct AppsLoginEntry {
    user: String,
    oauth_token: String,
}

#[derive(Debug, Deserialize)]
struct OAuthFile(std::collections::HashMap<String, Vec<OAuthEntry>>);

#[derive(Debug, Deserialize)]
struct OAuthEntry {
    id: Option<String>,
    #[serde(rename = "accessToken")]
    access_token: String,
    account: Option<OAuthAccount>,
}

#[derive(Debug, Deserialize)]
struct OAuthAccount {
    label: Option<String>,
    id: Option<String>,
}

#[derive(Debug, Deserialize, serde::Serialize)]
struct CopilotRemoteUser {
    login: String,
    copilot_plan: String,
    access_type_sku: String,
    quota_reset_date: Option<String>,
    quota_reset_date_utc: Option<String>,
    quota_snapshots: Option<std::collections::HashMap<String, CopilotQuotaSnapshot>>,
}

#[derive(Debug, Clone, Deserialize, serde::Serialize)]
struct CopilotQuotaSnapshot {
    quota_id: String,
    percent_remaining: Option<f64>,
    quota_remaining: Option<f64>,
    unlimited: Option<bool>,
    timestamp_utc: Option<String>,
    has_quota: Option<bool>,
    quota_reset_at: Option<i64>,
    remaining: Option<f64>,
    entitlement: Option<f64>,
    overage_count: Option<f64>,
    overage_permitted: Option<bool>,
}

fn read_login(paths: &CopilotPaths) -> Result<Option<CopilotLogin>, AppError> {
    if paths.apps_path.exists() {
        let apps = serde_json::from_str::<AppsLoginFile>(&fs::read_to_string(&paths.apps_path)?)?;
        if let Some((_, entry)) = apps.0.into_iter().find(|(_, entry)| !entry.oauth_token.is_empty()) {
            return Ok(Some(CopilotLogin {
                username: entry.user,
                account_id: None,
                token: entry.oauth_token,
                source_path: paths.apps_path.display().to_string(),
            }));
        }
    }

    if paths.oauth_path.exists() {
        let oauth = serde_json::from_str::<OAuthFile>(&fs::read_to_string(&paths.oauth_path)?)?;
        if let Some(entry) = oauth
            .0
            .into_values()
            .flatten()
            .find(|entry| !entry.access_token.is_empty())
        {
            return Ok(Some(CopilotLogin {
                username: entry
                    .account
                    .as_ref()
                    .and_then(|account| account.label.clone())
                    .unwrap_or_else(|| "GitHub user".to_string()),
                account_id: entry
                    .account
                    .as_ref()
                    .and_then(|account| account.id.clone())
                    .or(entry.id),
                token: entry.access_token,
                source_path: paths.oauth_path.display().to_string(),
            }));
        }
    }

    Ok(None)
}

fn fetch_remote_user(username: &str, token: &str) -> Result<CopilotRemoteUser, AppError> {
    let mut headers = HeaderMap::new();
    headers.insert(ACCEPT, HeaderValue::from_static("application/vnd.github+json"));
    headers.insert("X-GitHub-Api-Version", HeaderValue::from_static("2026-03-10"));
    headers.insert(
        AUTHORIZATION,
        HeaderValue::from_str(&format!("Bearer {token}"))
            .map_err(|error| AppError::Message(error.to_string()))?,
    );

    let client = Client::builder()
        .user_agent("Agent-Limit/0.1")
        .default_headers(headers)
        .build()?;

    let response = client.get(COPILOT_USER_ENDPOINT).send()?.error_for_status()?;
    let remote = response.json::<CopilotRemoteUser>()?;

    if remote.login.eq_ignore_ascii_case(username) {
        Ok(remote)
    } else {
        Ok(CopilotRemoteUser {
            login: username.to_string(),
            ..remote
        })
    }
}

fn build_quota_snapshot(remote: &CopilotRemoteUser) -> Option<QuotaSnapshot> {
    let premium = remote
        .quota_snapshots
        .as_ref()
        .and_then(|snapshots| snapshots.get("premium_interactions"));

    let Some(premium) = premium else {
        return Some(QuotaSnapshot {
            status: "unavailable".to_string(),
            total: None,
            used: None,
            remaining: None,
            percent_used: None,
            percent_remaining: None,
            unit: Some("requests".to_string()),
            confidence: Some("none".to_string()),
            reset_at: resolve_reset_at(remote),
            source: Some("copilot_internal/user".to_string()),
            note: Some("未返回 premium requests 配额快照。".to_string()),
        });
    };

    let entitlement = premium.entitlement.filter(|value| *value > 0.0);
    let remaining = premium
        .remaining
        .or(premium.quota_remaining)
        .filter(|value| *value >= 0.0);
    let used = entitlement.zip(remaining).map(|(total, left)| (total - left).max(0.0));

    if entitlement.is_none() || remaining.is_none() {
        return Some(QuotaSnapshot {
            status: "unavailable".to_string(),
            total: entitlement,
            used,
            remaining,
            percent_used: premium.percent_remaining.map(|value| (100.0 - value).clamp(0.0, 100.0)),
            percent_remaining: premium.percent_remaining,
            unit: Some("requests".to_string()),
            confidence: Some("low".to_string()),
            reset_at: resolve_reset_at(remote),
            source: Some("copilot_internal/user".to_string()),
            note: Some(
                "GitHub Copilot 返回了套餐信息，但没有可计算的有限 premium requests 配额。"
                    .to_string(),
            ),
        });
    }

    Some(QuotaSnapshot {
        status: "available".to_string(),
        total: entitlement,
        used,
        remaining,
        percent_used: premium
            .percent_remaining
            .map(|value| (100.0 - value).clamp(0.0, 100.0)),
        percent_remaining: premium.percent_remaining,
        unit: Some("requests".to_string()),
        confidence: Some("high".to_string()),
        reset_at: resolve_reset_at(remote),
        source: Some("copilot_internal/user".to_string()),
        note: Some(
            "数据来自本地登录账号对应的 GitHub Copilot 账户元数据。"
                .to_string(),
        ),
    })
}

fn resolve_reset_at(remote: &CopilotRemoteUser) -> Option<String> {
    if let Some(reset_at) = remote
        .quota_snapshots
        .as_ref()
        .and_then(|snapshots| snapshots.get("premium_interactions"))
        .and_then(|snapshot| snapshot.quota_reset_at)
        .filter(|epoch| *epoch > 0)
        .and_then(|epoch| Utc.timestamp_opt(epoch, 0).single())
    {
        return Some(reset_at.to_rfc3339());
    }

    if let Some(reset_at) = remote.quota_reset_date_utc.clone() {
        return Some(reset_at);
    }

    if let Some(reset_date) = remote.quota_reset_date.as_deref() {
        if let Ok(parsed) = chrono::NaiveDate::parse_from_str(reset_date, "%Y-%m-%d") {
            return parsed
                .and_hms_opt(0, 0, 0)
                .map(|timestamp| chrono::DateTime::<Utc>::from_naive_utc_and_offset(timestamp, Utc))
                .map(|timestamp| timestamp.to_rfc3339());
        }
    }

    let now = Utc::now();
    let (year, month) = if now.month() == 12 {
        (now.year() + 1, 1)
    } else {
        (now.year(), now.month() + 1)
    };

    Utc.with_ymd_and_hms(year, month, 1, 0, 0, 0)
        .single()
        .map(|timestamp| timestamp.to_rfc3339())
}

fn format_plan_name(remote: &CopilotRemoteUser) -> String {
    let normalized = remote.access_type_sku.replace('_', " ");
    normalized
        .split_whitespace()
        .map(title_case)
        .collect::<Vec<_>>()
        .join(" ")
}

fn title_case(value: &str) -> String {
    let mut chars = value.chars();
    match chars.next() {
        Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
        None => String::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::{build_quota_snapshot, format_plan_name, resolve_reset_at, CopilotRemoteUser, CopilotQuotaSnapshot};
    use std::collections::HashMap;

    #[test]
    fn formats_access_type_sku_into_title_case() {
        let remote = CopilotRemoteUser {
            login: "monalisa".to_string(),
            copilot_plan: "individual".to_string(),
            access_type_sku: "free_educational_quota".to_string(),
            quota_reset_date: None,
            quota_reset_date_utc: None,
            quota_snapshots: None,
        };

        assert_eq!(format_plan_name(&remote), "Free Educational Quota");
    }

    #[test]
    fn resolves_reset_time_from_reset_date_utc() {
        let remote = CopilotRemoteUser {
            login: "monalisa".to_string(),
            copilot_plan: "individual".to_string(),
            access_type_sku: "copilot_pro".to_string(),
            quota_reset_date: Some("2026-05-01".to_string()),
            quota_reset_date_utc: Some("2026-05-01T00:00:00Z".to_string()),
            quota_snapshots: None,
        };

        assert_eq!(
            resolve_reset_at(&remote).as_deref(),
            Some("2026-05-01T00:00:00Z")
        );
    }

    #[test]
    fn maps_premium_interactions_into_quota_snapshot() {
        let mut snapshots = HashMap::new();
        snapshots.insert(
            "premium_interactions".to_string(),
            CopilotQuotaSnapshot {
                quota_id: "premium_interactions".to_string(),
                percent_remaining: Some(16.2),
                quota_remaining: Some(48.8),
                unlimited: Some(false),
                timestamp_utc: Some("2026-04-27T12:01:57.935Z".to_string()),
                has_quota: Some(false),
                quota_reset_at: Some(0),
                remaining: Some(48.0),
                entitlement: Some(300.0),
                overage_count: Some(0.0),
                overage_permitted: Some(false),
            },
        );

        let remote = CopilotRemoteUser {
            login: "monalisa".to_string(),
            copilot_plan: "individual".to_string(),
            access_type_sku: "copilot_pro".to_string(),
            quota_reset_date: Some("2026-05-01".to_string()),
            quota_reset_date_utc: Some("2026-05-01T00:00:00Z".to_string()),
            quota_snapshots: Some(snapshots),
        };

        let quota = build_quota_snapshot(&remote).expect("quota snapshot should exist");

        assert_eq!(quota.status, "available");
        assert_eq!(quota.total, Some(300.0));
        assert_eq!(quota.remaining, Some(48.0));
        assert_eq!(quota.used, Some(252.0));
        assert_eq!(quota.percent_remaining, Some(16.2));
        assert_eq!(quota.percent_used, Some(83.8));
        assert_eq!(quota.unit.as_deref(), Some("requests"));
    }
}
