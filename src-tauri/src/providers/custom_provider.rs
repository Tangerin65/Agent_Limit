use serde_json::json;

use crate::error::AppError;
use crate::locale::AppLocale;
use crate::models::{
    AccountSnapshot, PlanSnapshot, ProviderDescriptor, ProviderSnapshot, QuotaSnapshot,
};
use crate::provider_settings::{
    resolve_custom_provider_config, ResolvedCustomProviderConfig, CUSTOM_PROVIDER_FALLBACK_NAME,
};
use crate::providers::api_platform::{
    build_json_client, custom_provider_missing_configuration_warning,
    validation_endpoint_for_base_url,
};
use crate::providers::{capability, ProviderAdapter};

pub struct CustomProvider;

impl CustomProvider {
    pub fn new() -> Self {
        Self
    }
}

impl ProviderAdapter for CustomProvider {
    fn descriptor(&self, locale: AppLocale) -> ProviderDescriptor {
        let resolved = resolve_custom_provider_config().ok().flatten();
        let has_config = resolved.is_some();
        let name = resolved
            .as_ref()
            .map(|config| config.display_name.clone())
            .unwrap_or_else(|| CUSTOM_PROVIDER_FALLBACK_NAME.to_string());

        ProviderDescriptor {
            id: "custom-provider".to_string(),
            name,
            status: "degraded".to_string(),
            message: Some(match resolved {
                Some(config) => locale.text(
                    &format!(
                        "Validates {} through {}. Stable quota or balance fields are not exposed by this generic integration.",
                        config.display_name, config.base_url
                    ),
                    &format!(
                        "通过 {} 校验 {}。当前这套通用接入不提供稳定的配额或余额字段。",
                        config.base_url, config.display_name
                    ),
                ),
                None => custom_provider_missing_configuration_warning(locale),
            }),
            capabilities: vec![
                capability("account", has_config),
                capability("plan", false),
                capability("quota", false),
            ],
        }
    }

    fn refresh(&self, locale: AppLocale) -> Result<ProviderSnapshot, AppError> {
        let descriptor = self.descriptor(locale);
        let refreshed_at = chrono::Utc::now().to_rfc3339();
        let Some(config) = resolve_custom_provider_config()? else {
            let warning = custom_provider_missing_configuration_warning(locale);
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
                    source: Some("custom-provider".to_string()),
                    note: Some(warning.clone()),
                }),
                warnings: vec![warning.clone()],
                refreshed_at,
                raw_meta: Some(json!({
                    "configured": false,
                    "providerName": CUSTOM_PROVIDER_FALLBACK_NAME,
                })),
            });
        };

        let validation_endpoint = validation_endpoint_for_base_url(&config.base_url);
        let client = build_json_client("Agent-Limit/0.1", &config.api_key)?;
        let (status, warning) = match client.get(&validation_endpoint).send() {
            Ok(response) => match response.error_for_status() {
                Ok(_) => (
                    "degraded".to_string(),
                    locale.text(
                        "Provider access is valid, but quota remains unavailable because this generic integration does not know a stable balance endpoint.",
                        "Provider 访问校验通过，但由于当前通用接入没有稳定余额端点，配额仍不可用。",
                    ),
                ),
                Err(error) => (
                    "degraded".to_string(),
                    match locale {
                        AppLocale::En => format!("Custom provider validation failed: {error}"),
                        AppLocale::ZhCn => format!("自定义 Provider 校验失败：{error}"),
                    },
                ),
            },
            Err(error) => (
                "degraded".to_string(),
                match locale {
                    AppLocale::En => format!("Custom provider request failed: {error}"),
                    AppLocale::ZhCn => format!("自定义 Provider 请求失败：{error}"),
                },
            ),
        };

        Ok(build_snapshot(
            descriptor,
            config,
            warning,
            status,
            refreshed_at,
            validation_endpoint,
            locale.text(
                "Quota is not mapped for the generic custom provider.",
                "当前通用自定义 Provider 尚未映射配额数据。",
            ),
        ))
    }
}

fn build_snapshot(
    descriptor: ProviderDescriptor,
    config: ResolvedCustomProviderConfig,
    warning: String,
    status: String,
    refreshed_at: String,
    validation_endpoint: String,
    quota_note: String,
) -> ProviderSnapshot {
    ProviderSnapshot {
        provider: ProviderDescriptor {
            status,
            ..descriptor
        },
        account: AccountSnapshot {
            identifier: Some(config.display_name.clone()),
            email: None,
            auth_mode: Some("api_key".to_string()),
            source_path: Some(config.source.clone()),
            detected: true,
        },
        plan: Some(PlanSnapshot {
            name: Some(config.display_name.clone()),
            tier: Some("OpenAI-compatible".to_string()),
            cycle: None,
            renewal_at: None,
            source: Some("custom-provider".to_string()),
        }),
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
            source: Some("custom-provider".to_string()),
            note: Some(quota_note),
        }),
        warnings: vec![warning],
        refreshed_at,
        raw_meta: Some(json!({
            "configured": true,
            "providerName": config.display_name,
            "baseUrl": config.base_url,
            "source": config.source,
            "keyMask": config.key_mask,
            "validationEndpoint": validation_endpoint,
        })),
    }
}

#[cfg(test)]
mod tests {
    use super::build_snapshot;
    use crate::models::{ProviderCapability, ProviderDescriptor};
    use crate::provider_settings::ResolvedCustomProviderConfig;

    fn descriptor() -> ProviderDescriptor {
        ProviderDescriptor {
            id: "custom-provider".to_string(),
            name: "My Provider".to_string(),
            status: "degraded".to_string(),
            message: None,
            capabilities: vec![
                ProviderCapability {
                    kind: "account".to_string(),
                    available: true,
                },
                ProviderCapability {
                    kind: "plan".to_string(),
                    available: false,
                },
                ProviderCapability {
                    kind: "quota".to_string(),
                    available: false,
                },
            ],
        }
    }

    #[test]
    fn snapshot_uses_custom_provider_values() {
        let snapshot = build_snapshot(
            descriptor(),
            ResolvedCustomProviderConfig {
                display_name: "Test Provider".to_string(),
                base_url: "https://example.com/v1".to_string(),
                api_key: "sk-test".to_string(),
                source: "config:C:\\Users\\a\\AppData\\Local\\Agent Limit\\provider-settings.json"
                    .to_string(),
                key_mask: "sk-t***test".to_string(),
                has_local_config: true,
            },
            "warning".to_string(),
            "degraded".to_string(),
            "2026-04-30T10:00:00Z".to_string(),
            "https://example.com/v1/models".to_string(),
            "Quota is not mapped for the generic custom provider.".to_string(),
        );

        assert_eq!(snapshot.provider.id, "custom-provider");
        assert_eq!(snapshot.provider.name, "My Provider");
        assert_eq!(
            snapshot.plan.as_ref().and_then(|plan| plan.name.as_deref()),
            Some("Test Provider")
        );
        assert_eq!(
            snapshot.account.source_path.as_deref(),
            Some(
                "config:C:\\Users\\a\\AppData\\Local\\Agent Limit\\provider-settings.json"
            )
        );
    }
}
