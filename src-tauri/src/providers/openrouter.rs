use serde_json::{json, Value};

use crate::error::AppError;
use crate::locale::AppLocale;
use crate::models::{
    AccountSnapshot, PlanSnapshot, ProviderDescriptor, ProviderSnapshot, QuotaSnapshot,
};
use crate::provider_settings::{resolve_openrouter_config, ResolvedOpenRouterConfig};
use crate::providers::api_platform::{
    build_json_client, missing_key_warning, read_json_body, OPENROUTER_API_KEY_ENV,
};
use crate::providers::{capability, ProviderAdapter};

const OPENROUTER_CREDITS_ENDPOINT: &str = "https://openrouter.ai/api/v1/credits";

pub struct OpenRouterProvider;

impl OpenRouterProvider {
    pub fn new() -> Self {
        Self
    }
}

impl ProviderAdapter for OpenRouterProvider {
    fn descriptor(&self, locale: AppLocale) -> ProviderDescriptor {
        let has_key = resolve_openrouter_config().ok().flatten().is_some();
        ProviderDescriptor {
            id: "openrouter".to_string(),
            name: "OpenRouter".to_string(),
            status: if has_key { "ready" } else { "degraded" }.to_string(),
            message: Some(if has_key {
                locale.text(
                    "Reads the configured OpenRouter API key and refreshes credit balance from OpenRouter.",
                    "读取已配置的 OpenRouter API Key，并从 OpenRouter 刷新 Credit 余额。",
                )
            } else {
                missing_key_warning(locale, OPENROUTER_API_KEY_ENV)
            }),
            capabilities: vec![
                capability("account", has_key),
                capability("plan", has_key),
                capability("quota", has_key),
            ],
        }
    }

    fn refresh(&self, locale: AppLocale) -> Result<ProviderSnapshot, AppError> {
        let descriptor = self.descriptor(locale);
        let refreshed_at = chrono::Utc::now().to_rfc3339();
        let key = resolve_openrouter_config()?;

        let Some(config) = key else {
            return Ok(ProviderSnapshot {
                provider: descriptor,
                account: AccountSnapshot {
                    identifier: None,
                    email: None,
                    auth_mode: Some("api_key".to_string()),
                    source_path: None,
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
                    unit: Some("credits".to_string()),
                    confidence: Some("none".to_string()),
                    reset_at: None,
                    source: Some("openrouter-api".to_string()),
                    note: Some(missing_key_warning(locale, OPENROUTER_API_KEY_ENV)),
                }),
                warnings: vec![missing_key_warning(locale, OPENROUTER_API_KEY_ENV)],
                refreshed_at,
                raw_meta: Some(json!({ "keyConfigured": false })),
            });
        };

        let client = build_json_client("Agent-Limit/0.1", &config.api_key)?;
        match client.get(OPENROUTER_CREDITS_ENDPOINT).send() {
            Ok(response) => {
                let body = read_json_body(response)?;
                Ok(build_snapshot_from_credits(
                    locale,
                    descriptor,
                    body,
                    refreshed_at,
                    &config,
                ))
            }
            Err(error) => Ok(ProviderSnapshot {
                provider: ProviderDescriptor {
                    status: "degraded".to_string(),
                    message: Some(locale.text(
                        "OpenRouter API key was detected, but credit refresh failed.",
                        "已检测到 OpenRouter API Key，但 Credit 刷新失败。",
                    )),
                    ..descriptor
                },
                account: AccountSnapshot {
                    identifier: Some("OpenRouter API Key".to_string()),
                    email: None,
                    auth_mode: Some("api_key".to_string()),
                    source_path: Some(config.source.clone()),
                    detected: true,
                },
                plan: None,
                quota: Some(QuotaSnapshot {
                    status: "unavailable".to_string(),
                    total: None,
                    used: None,
                    remaining: None,
                    percent_used: None,
                    percent_remaining: None,
                    unit: Some("credits".to_string()),
                    confidence: Some("low".to_string()),
                    reset_at: None,
                    source: Some("openrouter-api".to_string()),
                    note: Some(locale.text(
                        "Remote credit request failed. Check network connectivity or refresh later.",
                        "远程 Credit 请求失败。请检查网络连接或稍后重试。",
                    )),
                }),
                warnings: vec![match locale {
                    AppLocale::En => format!("OpenRouter refresh failed: {error}"),
                    AppLocale::ZhCn => format!("OpenRouter 刷新失败：{error}"),
                }],
                refreshed_at,
                raw_meta: Some(json!({
                    "source": config.source,
                    "keyConfigured": true,
                    "keyMask": config.key_mask,
                })),
            }),
        }
    }
}

fn build_snapshot_from_credits(
    locale: AppLocale,
    provider: ProviderDescriptor,
    body: Value,
    refreshed_at: String,
    config: &ResolvedOpenRouterConfig,
) -> ProviderSnapshot {
    let data = body.get("data").unwrap_or(&Value::Null);
    let total = data.get("total_credits").and_then(Value::as_f64);
    let used = data.get("total_usage").and_then(Value::as_f64);
    let remaining = total.zip(used).map(|(t, u)| (t - u).max(0.0));
    let percent_used = total
        .filter(|t| *t > 0.0)
        .zip(used)
        .map(|(t, u)| (u / t * 100.0).clamp(0.0, 100.0));
    let percent_remaining = percent_used.map(|v| (100.0 - v).clamp(0.0, 100.0));

    let quota_status = if total.is_some() && used.is_some() {
        "available"
    } else {
        "unavailable"
    };

    let warnings = if quota_status == "available" {
        vec![]
    } else {
        vec![locale.text(
            "OpenRouter account was detected, but credit fields were missing in the API response.",
            "已检测到 OpenRouter 账号，但接口响应缺少 Credit 字段。",
        )]
    };

    ProviderSnapshot {
        provider,
        account: AccountSnapshot {
            identifier: Some("OpenRouter API Key".to_string()),
            email: None,
            auth_mode: Some("api_key".to_string()),
            source_path: Some(config.source.clone()),
            detected: true,
        },
        plan: Some(PlanSnapshot {
            name: Some("OpenRouter API".to_string()),
            tier: data
                .get("tier")
                .and_then(Value::as_str)
                .map(|value| value.to_string()),
            cycle: None,
            renewal_at: None,
            source: Some("openrouter-api".to_string()),
        }),
        quota: Some(QuotaSnapshot {
            status: quota_status.to_string(),
            total,
            used,
            remaining,
            percent_used,
            percent_remaining,
            unit: Some("credits".to_string()),
            confidence: Some(if quota_status == "available" {
                "high".to_string()
            } else {
                "low".to_string()
            }),
            reset_at: None,
            source: Some("openrouter-api/v1/credits".to_string()),
            note: Some(locale.text(
                "Credit values come from OpenRouter credits endpoint.",
                "Credit 数值来自 OpenRouter credits 接口。",
            )),
        }),
        warnings,
        refreshed_at,
        raw_meta: Some(json!({
            "source": config.source,
            "keyConfigured": true,
            "keyMask": config.key_mask,
            "creditsResponse": data,
        })),
    }
}

#[cfg(test)]
mod tests {
    use super::build_snapshot_from_credits;
    use crate::locale::AppLocale;
    use crate::models::{ProviderCapability, ProviderDescriptor};
    use crate::provider_settings::ResolvedOpenRouterConfig;
    use serde_json::json;

    fn descriptor() -> ProviderDescriptor {
        ProviderDescriptor {
            id: "openrouter".to_string(),
            name: "OpenRouter".to_string(),
            status: "ready".to_string(),
            message: None,
            capabilities: vec![
                ProviderCapability {
                    kind: "account".to_string(),
                    available: true,
                },
                ProviderCapability {
                    kind: "plan".to_string(),
                    available: true,
                },
                ProviderCapability {
                    kind: "quota".to_string(),
                    available: true,
                },
            ],
        }
    }

    fn resolved_config() -> ResolvedOpenRouterConfig {
        ResolvedOpenRouterConfig {
            api_key: "sk-or-test".to_string(),
            source: "config:C:\\Users\\a\\AppData\\Local\\Agent Limit\\provider-settings.json"
                .to_string(),
            key_mask: "sk-o***test".to_string(),
            has_local_config: true,
        }
    }

    #[test]
    fn maps_openrouter_credit_payload() {
        let payload = json!({
            "data": {
                "total_credits": 100.0,
                "total_usage": 35.25,
                "tier": "standard"
            }
        });
        let snapshot = build_snapshot_from_credits(
            AppLocale::En,
            descriptor(),
            payload,
            "2026-04-30T10:00:00Z".to_string(),
            &resolved_config(),
        );
        let quota = snapshot.quota.expect("quota should exist");
        assert_eq!(quota.status, "available");
        assert_eq!(quota.total, Some(100.0));
        assert_eq!(quota.used, Some(35.25));
        assert_eq!(quota.remaining, Some(64.75));
        assert_eq!(quota.unit.as_deref(), Some("credits"));
    }

    #[test]
    fn keeps_unavailable_when_credit_fields_missing() {
        let payload = json!({ "data": { "tier": "free" } });
        let snapshot = build_snapshot_from_credits(
            AppLocale::En,
            descriptor(),
            payload,
            "2026-04-30T10:00:00Z".to_string(),
            &resolved_config(),
        );
        let quota = snapshot.quota.expect("quota should exist");
        assert_eq!(quota.status, "unavailable");
        assert!(snapshot.warnings.len() == 1);
    }
}
