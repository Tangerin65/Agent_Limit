use chrono::{TimeZone, Utc};
use reqwest::blocking::Client;
use serde_json::{json, Value};

use crate::error::AppError;
use crate::locale::AppLocale;
use crate::models::{
    AccountSnapshot, PlanSnapshot, ProviderDescriptor, ProviderSnapshot, QuotaSnapshot,
};
use crate::provider_settings::{
    resolve_custom_provider_config, ResolvedCustomProviderConfig, CUSTOM_PROVIDER_FALLBACK_NAME,
};
use crate::providers::api_platform::{
    build_json_client, custom_provider_missing_configuration_warning, validation_endpoint_for_base_url,
};
use crate::providers::{capability, ProviderAdapter};

pub struct CustomProvider;

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
enum CustomVendor {
    DeepSeek,
    Kimi,
    Glm,
    Aihubmix,
    Unknown,
}

impl CustomVendor {
    fn id(self) -> &'static str {
        match self {
            Self::DeepSeek => "deepseek",
            Self::Kimi => "kimi",
            Self::Glm => "glm",
            Self::Aihubmix => "aihubmix",
            Self::Unknown => "unknown",
        }
    }

    fn display_name(self) -> &'static str {
        match self {
            Self::DeepSeek => "DeepSeek",
            Self::Kimi => "Kimi",
            Self::Glm => "GLM",
            Self::Aihubmix => "AIHUBMIX",
            Self::Unknown => "OpenAI-compatible",
        }
    }

    fn supports_direct_quota(self) -> bool {
        matches!(self, Self::DeepSeek | Self::Kimi | Self::Glm)
    }

    fn balance_endpoints(self, base_url: &str) -> Vec<String> {
        let origin = extract_origin(base_url);
        match self {
            Self::DeepSeek => vec![format!("{origin}/user/balance")],
            Self::Kimi => vec![format!("{origin}/v1/users/me/balance")],
            Self::Glm => vec![
                format!("{origin}/api/paas/v4/users/me/balance"),
                format!("{origin}/api/paas/v4/user/balance"),
                format!("{origin}/api/monitor/usage/quota/limit"),
            ],
            Self::Aihubmix => vec![validation_endpoint_for_base_url(base_url)],
            Self::Unknown => vec![validation_endpoint_for_base_url(base_url)],
        }
    }
}

#[derive(Debug, Clone)]
struct QuotaCandidate {
    quota: QuotaSnapshot,
    warning: String,
    response_shape_hint: String,
    balance_endpoint: String,
}

#[derive(Debug, Clone)]
struct VendorRefresh {
    provider_status: String,
    provider_message: String,
    quota: QuotaSnapshot,
    warnings: Vec<String>,
    balance_endpoint: Option<String>,
    response_shape_hint: Option<String>,
    endpoint_attempts: Vec<Value>,
}

impl CustomProvider {
    pub fn new() -> Self {
        Self
    }
}

impl ProviderAdapter for CustomProvider {
    fn descriptor(&self, locale: AppLocale) -> ProviderDescriptor {
        let resolved = resolve_custom_provider_config().ok().flatten();
        let has_config = resolved.is_some();
        let vendor = resolved
            .as_ref()
            .map(|config| detect_vendor(&config.base_url))
            .unwrap_or(CustomVendor::Unknown);
        let name = resolved
            .as_ref()
            .map(|config| config.display_name.clone())
            .unwrap_or_else(|| CUSTOM_PROVIDER_FALLBACK_NAME.to_string());

        let status = if !has_config {
            "degraded"
        } else if vendor == CustomVendor::Unknown {
            "degraded"
        } else {
            "ready"
        };

        ProviderDescriptor {
            id: "custom-provider".to_string(),
            name,
            status: status.to_string(),
            message: Some(match resolved {
                Some(config) => {
                    if vendor == CustomVendor::Unknown {
                        locale.text(
                            &format!(
                                "Validates {} through {}. Stable quota or balance fields are not exposed by this generic integration.",
                                config.display_name, config.base_url
                            ),
                            &format!(
                                "通过 {} 校验 {}。当前这套通用接入不提供稳定的配额或余额字段。",
                                config.base_url, config.display_name
                            ),
                        )
                    } else if vendor.supports_direct_quota() {
                        locale.text(
                            &format!(
                                "{} is auto-detected from {}. The app will query vendor balance endpoints directly.",
                                vendor.display_name(),
                                config.base_url
                            ),
                            &format!(
                                "已根据 {} 自动识别为 {}，应用会直接查询该厂商的余额接口。",
                                config.base_url,
                                vendor.display_name()
                            ),
                        )
                    } else {
                        locale.text(
                            &format!(
                                "{} is auto-detected from {}. The app validates OpenAI-compatible access, while quota remains in generic mode.",
                                vendor.display_name(),
                                config.base_url
                            ),
                            &format!(
                                "已根据 {} 自动识别为 {}。应用会校验 OpenAI-compatible 访问状态，配额暂按通用模式展示。",
                                config.base_url,
                                vendor.display_name()
                            ),
                        )
                    }
                }
                None => custom_provider_missing_configuration_warning(locale),
            }),
            capabilities: vec![
                capability("account", has_config),
                capability("plan", has_config),
                capability("quota", has_config && vendor.supports_direct_quota()),
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

        let vendor = detect_vendor(&config.base_url);
        let client = build_json_client("Agent-Limit/0.1", &config.api_key)?;
        let result = if vendor.supports_direct_quota() {
            refresh_supported_vendor(&client, locale, &config, vendor)
        } else {
            refresh_unknown_vendor(&client, locale, &config, vendor)
        };

        Ok(build_snapshot_from_refresh(
            descriptor,
            config,
            refreshed_at,
            vendor,
            result,
        ))
    }
}

fn refresh_unknown_vendor(
    client: &Client,
    locale: AppLocale,
    config: &ResolvedCustomProviderConfig,
    _vendor: CustomVendor,
) -> VendorRefresh {
    let validation_endpoint = validation_endpoint_for_base_url(&config.base_url);
    let mut attempts = Vec::new();
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
    attempts.push(json!({
        "endpoint": validation_endpoint,
        "result": status,
    }));

    VendorRefresh {
        provider_status: "degraded".to_string(),
        provider_message: locale.text(
            "Quota is not mapped for the generic custom provider.",
            "当前通用自定义 Provider 尚未映射配额数据。",
        ),
        quota: QuotaSnapshot {
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
            note: Some(warning.clone()),
        },
        warnings: vec![warning],
        balance_endpoint: Some(validation_endpoint),
        response_shape_hint: Some("generic-validation".to_string()),
        endpoint_attempts: attempts,
    }
}

fn refresh_supported_vendor(
    client: &Client,
    locale: AppLocale,
    config: &ResolvedCustomProviderConfig,
    vendor: CustomVendor,
) -> VendorRefresh {
    let endpoints = vendor.balance_endpoints(&config.base_url);
    let mut attempts = Vec::new();
    let mut fallback_candidate: Option<QuotaCandidate> = None;

    for endpoint in endpoints {
        match client.get(&endpoint).send() {
            Ok(response) => {
                let status = response.status();
                if !status.is_success() {
                    attempts.push(json!({
                        "endpoint": endpoint,
                        "httpStatus": status.as_u16(),
                        "result": "http_error",
                    }));
                    continue;
                }

                match response.json::<Value>() {
                    Ok(body) => {
                        let parsed = parse_vendor_payload(vendor, locale, &endpoint, &body);
                        attempts.push(json!({
                            "endpoint": endpoint,
                            "result": parsed.quota.status,
                            "responseShapeHint": parsed.response_shape_hint,
                        }));

                        if parsed.quota.status == "available" {
                            return VendorRefresh {
                                provider_status: "ready".to_string(),
                                provider_message: locale.text(
                                    "Vendor balance endpoint refreshed successfully.",
                                    "厂商余额接口刷新成功。",
                                ),
                                quota: parsed.quota,
                                warnings: vec![],
                                balance_endpoint: Some(parsed.balance_endpoint),
                                response_shape_hint: Some(parsed.response_shape_hint),
                                endpoint_attempts: attempts,
                            };
                        }

                        fallback_candidate = Some(parsed);
                    }
                    Err(error) => {
                        attempts.push(json!({
                            "endpoint": endpoint,
                            "result": "invalid_json",
                            "error": error.to_string(),
                        }));
                    }
                }
            }
            Err(error) => {
                attempts.push(json!({
                    "endpoint": endpoint,
                    "result": "request_error",
                    "error": error.to_string(),
                }));
            }
        }
    }

    if let Some(candidate) = fallback_candidate {
        return VendorRefresh {
            provider_status: "degraded".to_string(),
            provider_message: locale.text(
                "Vendor endpoint responded, but quota fields were incomplete.",
                "厂商接口已返回，但配额字段不完整。",
            ),
            quota: candidate.quota,
            warnings: vec![candidate.warning],
            balance_endpoint: Some(candidate.balance_endpoint),
            response_shape_hint: Some(candidate.response_shape_hint),
            endpoint_attempts: attempts,
        };
    }

    VendorRefresh {
        provider_status: "degraded".to_string(),
        provider_message: locale.text(
            "Vendor was detected, but all known balance endpoints failed.",
            "已识别供应商，但所有已知余额接口都请求失败。",
        ),
        quota: QuotaSnapshot {
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
            note: Some(locale.text(
                "Retry later, or verify API key scope and account plan.",
                "请稍后重试，或检查 API Key 权限与账号套餐。",
            )),
        },
        warnings: vec![match locale {
            AppLocale::En => format!(
                "{} balance refresh failed on all known endpoints.",
                vendor.display_name()
            ),
            AppLocale::ZhCn => format!("{} 余额刷新在所有已知端点上均失败。", vendor.display_name()),
        }],
        balance_endpoint: None,
        response_shape_hint: None,
        endpoint_attempts: attempts,
    }
}

fn parse_vendor_payload(
    vendor: CustomVendor,
    locale: AppLocale,
    endpoint: &str,
    body: &Value,
) -> QuotaCandidate {
    match vendor {
        CustomVendor::DeepSeek => parse_deepseek_payload(locale, endpoint, body),
        CustomVendor::Kimi => parse_kimi_payload(locale, endpoint, body),
        CustomVendor::Glm => parse_glm_payload(locale, endpoint, body),
        CustomVendor::Aihubmix | CustomVendor::Unknown => QuotaCandidate {
            quota: QuotaSnapshot {
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
                note: Some(locale.text(
                    "Quota is not mapped for the generic custom provider.",
                    "当前通用自定义 Provider 尚未映射配额数据。",
                )),
            },
            warning: locale.text(
                "Quota is not mapped for the generic custom provider.",
                "当前通用自定义 Provider 尚未映射配额数据。",
            ),
            response_shape_hint: "unknown".to_string(),
            balance_endpoint: endpoint.to_string(),
        },
    }
}

fn parse_deepseek_payload(locale: AppLocale, endpoint: &str, body: &Value) -> QuotaCandidate {
    let infos = body
        .get("balance_infos")
        .and_then(Value::as_array)
        .or_else(|| body.get("data").and_then(Value::as_array));

    let mut total = 0.0f64;
    let mut currencies: Vec<String> = Vec::new();

    if let Some(items) = infos {
        for item in items {
            if let Some(value) = value_to_f64(item.get("total_balance")) {
                total += value;
            }
            if let Some(currency) = item.get("currency").and_then(Value::as_str) {
                let normalized = currency.trim().to_uppercase();
                if !normalized.is_empty() && !currencies.contains(&normalized) {
                    currencies.push(normalized);
                }
            }
        }
    }

    if total > 0.0 {
        let currency_text = if currencies.is_empty() {
            locale.text("unknown currency", "未知币种")
        } else {
            currencies.join(", ")
        };
        let note = locale.text(
            &format!(
                "DeepSeek total balance was mapped from balance_infos (currencies: {}).",
                currency_text
            ),
            &format!(
                "DeepSeek 总余额来自 balance_infos（币种：{}）。",
                currency_text
            ),
        );
        return QuotaCandidate {
            quota: QuotaSnapshot {
                status: "available".to_string(),
                total: Some(total),
                used: None,
                remaining: Some(total),
                percent_used: None,
                percent_remaining: None,
                unit: Some("credits".to_string()),
                confidence: Some("high".to_string()),
                reset_at: None,
                source: Some("deepseek:/user/balance".to_string()),
                note: Some(note.clone()),
            },
            warning: locale.text(
                "DeepSeek balance endpoint refreshed successfully.",
                "DeepSeek 余额接口刷新成功。",
            ),
            response_shape_hint: "deepseek:balance_infos".to_string(),
            balance_endpoint: endpoint.to_string(),
        };
    }

    let warning = locale.text(
        "DeepSeek endpoint responded but balance_infos.total_balance was missing.",
        "DeepSeek 接口已返回，但缺少 balance_infos.total_balance 字段。",
    );
    QuotaCandidate {
        quota: QuotaSnapshot {
            status: "unavailable".to_string(),
            total: None,
            used: None,
            remaining: None,
            percent_used: None,
            percent_remaining: None,
            unit: Some("credits".to_string()),
            confidence: Some("low".to_string()),
            reset_at: None,
            source: Some("deepseek:/user/balance".to_string()),
            note: Some(warning.clone()),
        },
        warning,
        response_shape_hint: "deepseek:missing-balance-fields".to_string(),
        balance_endpoint: endpoint.to_string(),
    }
}

fn parse_kimi_payload(locale: AppLocale, endpoint: &str, body: &Value) -> QuotaCandidate {
    let data = body.get("data").unwrap_or(&Value::Null);
    let available = value_to_f64(data.get("available_balance"));
    let voucher = value_to_f64(data.get("voucher_balance"));
    let cash = value_to_f64(data.get("cash_balance"));

    if let Some(remaining) = available {
        let total = voucher.unwrap_or(0.0) + cash.unwrap_or(0.0);
        let note = locale.text(
            "Kimi available_balance is used as remaining value; voucher_balance and cash_balance are included in metadata.",
            "Kimi 的 available_balance 作为剩余额度展示；voucher_balance 和 cash_balance 作为辅助信息。",
        );
        return QuotaCandidate {
            quota: QuotaSnapshot {
                status: "available".to_string(),
                total: if total > 0.0 { Some(total) } else { Some(remaining) },
                used: if total > 0.0 {
                    Some((total - remaining).max(0.0))
                } else {
                    None
                },
                remaining: Some(remaining),
                percent_used: if total > 0.0 {
                    Some(((total - remaining) / total * 100.0).clamp(0.0, 100.0))
                } else {
                    None
                },
                percent_remaining: if total > 0.0 {
                    Some((remaining / total * 100.0).clamp(0.0, 100.0))
                } else {
                    None
                },
                unit: Some("credits".to_string()),
                confidence: Some("high".to_string()),
                reset_at: None,
                source: Some("kimi:/v1/users/me/balance".to_string()),
                note: Some(note.clone()),
            },
            warning: locale.text(
                "Kimi balance endpoint refreshed successfully.",
                "Kimi 余额接口刷新成功。",
            ),
            response_shape_hint: "kimi:data.available_balance".to_string(),
            balance_endpoint: endpoint.to_string(),
        };
    }

    let warning = locale.text(
        "Kimi endpoint responded but data.available_balance was missing.",
        "Kimi 接口已返回，但缺少 data.available_balance 字段。",
    );
    QuotaCandidate {
        quota: QuotaSnapshot {
            status: "unavailable".to_string(),
            total: None,
            used: None,
            remaining: None,
            percent_used: None,
            percent_remaining: None,
            unit: Some("credits".to_string()),
            confidence: Some("low".to_string()),
            reset_at: None,
            source: Some("kimi:/v1/users/me/balance".to_string()),
            note: Some(warning.clone()),
        },
        warning,
        response_shape_hint: "kimi:missing-balance-fields".to_string(),
        balance_endpoint: endpoint.to_string(),
    }
}

fn parse_glm_payload(locale: AppLocale, endpoint: &str, body: &Value) -> QuotaCandidate {
    let direct = body.get("data").unwrap_or(body);
    let direct_remaining = value_to_f64(direct.get("available_balance"))
        .or_else(|| value_to_f64(direct.get("balance")))
        .or_else(|| value_to_f64(direct.get("total_balance")));
    if let Some(remaining) = direct_remaining {
        return QuotaCandidate {
            quota: QuotaSnapshot {
                status: "available".to_string(),
                total: Some(remaining),
                used: None,
                remaining: Some(remaining),
                percent_used: None,
                percent_remaining: None,
                unit: Some("credits".to_string()),
                confidence: Some("medium".to_string()),
                reset_at: None,
                source: Some("glm:balance-endpoint".to_string()),
                note: Some(locale.text(
                    "GLM balance value was mapped from the v4 balance endpoint.",
                    "GLM 余额值来自 v4 balance 端点。",
                )),
            },
            warning: locale.text("GLM balance endpoint refreshed successfully.", "GLM 余额接口刷新成功。"),
            response_shape_hint: "glm:balance-value".to_string(),
            balance_endpoint: endpoint.to_string(),
        };
    }

    let limit = body
        .get("data")
        .and_then(|data| data.get("limits"))
        .and_then(Value::as_array)
        .and_then(|limits| {
            limits
                .iter()
                .find(|item| {
                    item.get("type")
                        .and_then(Value::as_str)
                        .map(|value| value.contains("TOKENS"))
                        .unwrap_or(false)
                })
                .or_else(|| limits.first())
        });

    if let Some(limit) = limit {
        let used = value_to_f64(limit.get("currentValue")).or_else(|| value_to_f64(limit.get("used")));
        let total = value_to_f64(limit.get("usage"))
            .or_else(|| value_to_f64(limit.get("total")))
            .or_else(|| value_to_f64(limit.get("limit")));
        let remaining = value_to_f64(limit.get("remaining")).or_else(|| {
            total.zip(used).map(|(total_value, used_value)| (total_value - used_value).max(0.0))
        });
        let percent_used = value_to_f64(limit.get("percentage")).or_else(|| {
            total
                .filter(|value| *value > 0.0)
                .zip(used)
                .map(|(total_value, used_value)| (used_value / total_value * 100.0).clamp(0.0, 100.0))
        });
        let percent_remaining = percent_used.map(|value| (100.0 - value).clamp(0.0, 100.0));
        let reset_at = value_to_f64(limit.get("nextResetTime")).and_then(to_iso_datetime);

        if total.is_some() || used.is_some() || remaining.is_some() {
            return QuotaCandidate {
                quota: QuotaSnapshot {
                    status: "available".to_string(),
                    total,
                    used,
                    remaining,
                    percent_used,
                    percent_remaining,
                    unit: Some("credits".to_string()),
                    confidence: Some("medium".to_string()),
                    reset_at,
                    source: Some("glm:/api/monitor/usage/quota/limit".to_string()),
                    note: Some(locale.text(
                        "GLM quota was mapped from monitor usage limits.",
                        "GLM 配额来自 monitor usage limits 接口。",
                    )),
                },
                warning: locale.text(
                    "GLM monitor endpoint refreshed successfully.",
                    "GLM monitor 配额接口刷新成功。",
                ),
                response_shape_hint: "glm:data.limits".to_string(),
                balance_endpoint: endpoint.to_string(),
            };
        }
    }

    let warning = locale.text(
        "GLM endpoint responded but quota fields were missing.",
        "GLM 接口已返回，但缺少可用配额字段。",
    );
    QuotaCandidate {
        quota: QuotaSnapshot {
            status: "unavailable".to_string(),
            total: None,
            used: None,
            remaining: None,
            percent_used: None,
            percent_remaining: None,
            unit: Some("credits".to_string()),
            confidence: Some("low".to_string()),
            reset_at: None,
            source: Some("glm:unknown-shape".to_string()),
            note: Some(warning.clone()),
        },
        warning,
        response_shape_hint: "glm:missing-quota-fields".to_string(),
        balance_endpoint: endpoint.to_string(),
    }
}

fn build_snapshot_from_refresh(
    descriptor: ProviderDescriptor,
    config: ResolvedCustomProviderConfig,
    refreshed_at: String,
    vendor: CustomVendor,
    refresh: VendorRefresh,
) -> ProviderSnapshot {
    ProviderSnapshot {
        provider: ProviderDescriptor {
            status: refresh.provider_status,
            message: Some(refresh.provider_message),
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
        quota: Some(refresh.quota),
        warnings: refresh.warnings,
        refreshed_at,
        raw_meta: Some(json!({
            "configured": true,
            "providerName": config.display_name,
            "baseUrl": config.base_url,
            "source": config.source,
            "keyMask": config.key_mask,
            "activeEntryId": config.entry_id,
            "detectedVendor": vendor.id(),
            "balanceEndpoint": refresh.balance_endpoint,
            "endpointAttempts": refresh.endpoint_attempts,
            "responseShapeHint": refresh.response_shape_hint,
        })),
    }
}

fn detect_vendor(base_url: &str) -> CustomVendor {
    let normalized = normalize_base_url(base_url);
    let parsed = reqwest::Url::parse(&normalized).ok();
    let host = parsed
        .as_ref()
        .and_then(|url| url.host_str())
        .map(|value| value.to_ascii_lowercase());

    match host {
        Some(value) if value.ends_with("deepseek.com") => CustomVendor::DeepSeek,
        Some(value) if value.ends_with("moonshot.cn") || value.ends_with("kimi.com") => {
            CustomVendor::Kimi
        }
        Some(value)
            if value == "open.bigmodel.cn"
                || value == "dev.bigmodel.cn"
                || value == "api.z.ai"
                || value.ends_with(".bigmodel.cn")
                || value.ends_with(".z.ai") =>
        {
            CustomVendor::Glm
        }
        Some(value) if value == "aihubmix.com" || value == "api.aihubmix.com" => {
            CustomVendor::Aihubmix
        }
        _ => CustomVendor::Unknown,
    }
}

fn normalize_base_url(base_url: &str) -> String {
    base_url.trim().trim_end_matches('/').to_string()
}

fn extract_origin(base_url: &str) -> String {
    let normalized = normalize_base_url(base_url);
    if let Ok(url) = reqwest::Url::parse(&normalized) {
        if let Some(host) = url.host_str() {
            if let Some(port) = url.port() {
                return format!("{}://{}:{}", url.scheme(), host, port);
            }
            return format!("{}://{}", url.scheme(), host);
        }
    }
    normalized
}

fn value_to_f64(value: Option<&Value>) -> Option<f64> {
    match value {
        Some(Value::Number(number)) => number.as_f64(),
        Some(Value::String(text)) => text.trim().parse::<f64>().ok(),
        _ => None,
    }
}

fn to_iso_datetime(raw: f64) -> Option<String> {
    let as_i64 = raw.round() as i64;
    let millis = if as_i64.abs() < 10_000_000_000 {
        as_i64.saturating_mul(1000)
    } else {
        as_i64
    };
    Utc.timestamp_millis_opt(millis).single().map(|value| value.to_rfc3339())
}

#[cfg(test)]
mod tests {
    use super::{build_snapshot_from_refresh, detect_vendor, parse_glm_payload, parse_kimi_payload};
    use super::{parse_deepseek_payload, CustomVendor, VendorRefresh};
    use crate::models::{ProviderCapability, ProviderDescriptor};
    use crate::provider_settings::{ResolvedCustomProviderConfig, CUSTOM_PROVIDER_FALLBACK_NAME};
    use serde_json::json;

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
        let snapshot = build_snapshot_from_refresh(
            descriptor(),
            ResolvedCustomProviderConfig {
                entry_id: Some("entry-1".to_string()),
                display_name: "Test Provider".to_string(),
                base_url: "https://example.com/v1".to_string(),
                api_key: "sk-test".to_string(),
                source: "config:C:\\Users\\a\\AppData\\Local\\Agent Limit\\provider-settings.json"
                    .to_string(),
                key_mask: "sk-t***test".to_string(),
                has_local_config: true,
            },
            "2026-04-30T10:00:00Z".to_string(),
            CustomVendor::Unknown,
            VendorRefresh {
                provider_status: "degraded".to_string(),
                provider_message: "message".to_string(),
                quota: crate::models::QuotaSnapshot {
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
                    note: Some("note".to_string()),
                },
                warnings: vec!["warning".to_string()],
                balance_endpoint: Some("https://example.com/v1/models".to_string()),
                response_shape_hint: Some("generic".to_string()),
                endpoint_attempts: vec![json!({"endpoint":"https://example.com/v1/models"})],
            },
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

    #[test]
    fn vendor_detection_matches_supported_hosts() {
        assert_eq!(
            detect_vendor("https://api.deepseek.com/v1"),
            CustomVendor::DeepSeek
        );
        assert_eq!(
            detect_vendor("https://api.moonshot.cn/v1"),
            CustomVendor::Kimi
        );
        assert_eq!(
            detect_vendor("https://api.kimi.com/v1"),
            CustomVendor::Kimi
        );
        assert_eq!(
            detect_vendor("https://open.bigmodel.cn/api/paas/v4"),
            CustomVendor::Glm
        );
        assert_eq!(
            detect_vendor("https://api.z.ai/api/anthropic"),
            CustomVendor::Glm
        );
        assert_eq!(
            detect_vendor("https://aihubmix.com/v1"),
            CustomVendor::Aihubmix
        );
        assert_eq!(
            detect_vendor("https://api.aihubmix.com/v1"),
            CustomVendor::Aihubmix
        );
        assert_eq!(
            detect_vendor("https://example.com/v1"),
            CustomVendor::Unknown
        );
    }

    #[test]
    fn deepseek_payload_maps_balance_infos() {
        let payload = json!({
            "is_available": true,
            "balance_infos": [
                { "currency": "USD", "total_balance": "12.5", "granted_balance": "2.0", "topped_up_balance": "10.5" },
                { "currency": "CNY", "total_balance": "7.5", "granted_balance": "0", "topped_up_balance": "7.5" }
            ]
        });

        let parsed = parse_deepseek_payload(
            crate::locale::AppLocale::En,
            "https://api.deepseek.com/user/balance",
            &payload,
        );

        assert_eq!(parsed.quota.status, "available");
        assert_eq!(parsed.quota.total, Some(20.0));
        assert_eq!(parsed.quota.remaining, Some(20.0));
    }

    #[test]
    fn kimi_payload_maps_available_balance() {
        let payload = json!({
            "code": 0,
            "data": {
                "available_balance": 49.58894,
                "voucher_balance": 46.58893,
                "cash_balance": 3.0
            }
        });

        let parsed = parse_kimi_payload(
            crate::locale::AppLocale::En,
            "https://api.moonshot.cn/v1/users/me/balance",
            &payload,
        );

        assert_eq!(parsed.quota.status, "available");
        assert_eq!(parsed.quota.remaining, Some(49.58894));
        assert_eq!(parsed.quota.total, Some(49.58893));
    }

    #[test]
    fn glm_monitor_payload_maps_limit_fields() {
        let payload = json!({
            "code": 200,
            "data": {
                "limits": [
                    {
                        "type": "TOKENS_LIMIT",
                        "usage": 800000000,
                        "currentValue": 127694464,
                        "remaining": 672305536,
                        "percentage": 15,
                        "nextResetTime": 1770648402389_i64
                    }
                ]
            }
        });

        let parsed = parse_glm_payload(
            crate::locale::AppLocale::En,
            "https://open.bigmodel.cn/api/monitor/usage/quota/limit",
            &payload,
        );

        assert_eq!(parsed.quota.status, "available");
        assert_eq!(parsed.quota.total, Some(800000000.0));
        assert_eq!(parsed.quota.used, Some(127694464.0));
        assert_eq!(parsed.quota.remaining, Some(672305536.0));
        assert_eq!(parsed.quota.percent_used, Some(15.0));
        assert!(parsed.quota.reset_at.is_some());
    }

    #[test]
    fn glm_endpoints_keep_expected_fallback_order() {
        let endpoints = CustomVendor::Glm.balance_endpoints("https://open.bigmodel.cn/api/paas/v4");
        assert_eq!(endpoints.len(), 3);
        assert_eq!(
            endpoints[0],
            "https://open.bigmodel.cn/api/paas/v4/users/me/balance"
        );
        assert_eq!(
            endpoints[1],
            "https://open.bigmodel.cn/api/paas/v4/user/balance"
        );
        assert_eq!(
            endpoints[2],
            "https://open.bigmodel.cn/api/monitor/usage/quota/limit"
        );
    }

    #[test]
    fn unknown_vendor_keeps_generic_message_in_snapshot() {
        let snapshot = build_snapshot_from_refresh(
            descriptor(),
            ResolvedCustomProviderConfig {
                entry_id: None,
                display_name: CUSTOM_PROVIDER_FALLBACK_NAME.to_string(),
                base_url: "https://example.com/v1".to_string(),
                api_key: "sk-test".to_string(),
                source: "env:OPENAI_API_KEY".to_string(),
                key_mask: "sk-t***test".to_string(),
                has_local_config: false,
            },
            "2026-04-30T10:00:00Z".to_string(),
            CustomVendor::Unknown,
            VendorRefresh {
                provider_status: "degraded".to_string(),
                provider_message: "Quota is not mapped for the generic custom provider.".to_string(),
                quota: crate::models::QuotaSnapshot {
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
                    note: Some("note".to_string()),
                },
                warnings: vec!["warning".to_string()],
                balance_endpoint: Some("https://example.com/v1/models".to_string()),
                response_shape_hint: Some("generic".to_string()),
                endpoint_attempts: vec![],
            },
        );

        assert_eq!(
            snapshot.provider.message.as_deref(),
            Some("Quota is not mapped for the generic custom provider.")
        );
    }
}
