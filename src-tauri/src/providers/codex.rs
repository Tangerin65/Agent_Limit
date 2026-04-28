use std::fs;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use base64::Engine;
use chrono::{TimeZone, Utc};
use serde::Deserialize;
use serde_json::{json, Value};
use walkdir::WalkDir;

use crate::error::AppError;
use crate::locale::AppLocale;
use crate::models::{
    AccountSnapshot, PlanSnapshot, ProviderDescriptor, ProviderSnapshot, QuotaSnapshot,
};
use crate::providers::{capability, ProviderAdapter};

pub struct CodexProvider;

impl CodexProvider {
    pub fn new() -> Self {
        Self
    }
}

impl ProviderAdapter for CodexProvider {
    fn descriptor(&self, locale: AppLocale) -> ProviderDescriptor {
        let paths = CodexPaths::detect();
        let auth_exists = paths.auth_path.exists();
        let session_exists = paths.sessions_root.exists();

        ProviderDescriptor {
            id: "codex".to_string(),
            name: "Codex".to_string(),
            status: if auth_exists { "ready" } else { "degraded" }.to_string(),
            message: Some(if auth_exists {
                locale.text(
                    "Reads local Codex auth data and the latest quota snapshot.",
                    "读取本地 Codex 认证数据与最新限额快照。",
                )
            } else {
                locale.text(
                    "No Codex auth.json was found in the current user directory.",
                    "当前用户目录中未找到 Codex 的 auth.json。",
                )
            }),
            capabilities: vec![
                capability("account", auth_exists),
                capability("plan", auth_exists),
                capability("quota", session_exists),
            ],
        }
    }

    fn refresh(&self, locale: AppLocale) -> Result<ProviderSnapshot, AppError> {
        let paths = CodexPaths::detect();
        let descriptor = self.descriptor(locale);

        if !paths.auth_path.exists() {
            return Ok(ProviderSnapshot {
                provider: descriptor,
                account: AccountSnapshot {
                    identifier: None,
                    email: None,
                    auth_mode: None,
                    source_path: Some(paths.auth_path.display().to_string()),
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
                    unit: None,
                    confidence: Some("none".to_string()),
                    reset_at: None,
                    source: Some("local-filesystem".to_string()),
                    note: Some(locale.text(
                        "Codex auth.json was not found.",
                        "未找到 Codex auth.json。",
                    )),
                }),
                warnings: vec![locale.text(
                    "The current Windows user does not appear to be signed in to Codex.",
                    "当前 Windows 用户似乎尚未登录 Codex。",
                )],
                refreshed_at: Utc::now().to_rfc3339(),
                raw_meta: Some(json!({
                    "authPath": paths.auth_path.display().to_string(),
                    "configPath": paths.config_path.display().to_string(),
                    "sessionsRoot": paths.sessions_root.display().to_string()
                })),
            });
        }

        let auth: AuthFile = serde_json::from_str(&fs::read_to_string(&paths.auth_path)?)?;
        let config = read_config(&paths.config_path)?;
        let claims = decode_claims(&auth)?;
        let session_limits = read_latest_rate_limits(&paths.sessions_root)?;

        let email = claims
            .as_ref()
            .and_then(|claims| claims.profile.email.clone().or_else(|| claims.email.clone()));
        let account_identifier = claims
            .as_ref()
            .and_then(|claims| {
                claims
                    .auth
                    .chatgpt_account_id
                    .clone()
                    .or_else(|| auth.tokens.as_ref()?.account_id.clone())
            })
            .or_else(|| auth.tokens.as_ref().and_then(|tokens| tokens.account_id.clone()));

        let detected_plan = session_limits
            .as_ref()
            .and_then(|limits| limits.plan_type.clone())
            .or_else(|| claims.as_ref().and_then(|claims| claims.auth.chatgpt_plan_type.clone()));

        let quota = if let Some(limits) = session_limits.as_ref() {
            let remaining = (100.0 - limits.used_percent).clamp(0.0, 100.0);
            Some(QuotaSnapshot {
                status: "available".to_string(),
                total: Some(100.0),
                used: Some(limits.used_percent),
                remaining: Some(remaining),
                percent_used: Some(limits.used_percent),
                percent_remaining: Some(remaining),
                unit: Some("%".to_string()),
                confidence: Some("high".to_string()),
                reset_at: limits.reset_at.clone(),
                source: Some("codex-session-rate-limits".to_string()),
                note: Some(locale.text(
                    "Data comes from the latest local Codex token_count event on disk.",
                    "数据来自本地磁盘中最新的 Codex token_count 事件。",
                )),
            })
        } else {
            Some(QuotaSnapshot {
                status: "unavailable".to_string(),
                total: None,
                used: None,
                remaining: None,
                percent_used: None,
                percent_remaining: None,
                unit: None,
                confidence: Some("none".to_string()),
                reset_at: None,
                source: Some("local-filesystem".to_string()),
                note: Some(locale.text(
                    "No local quota snapshot was found yet.",
                    "暂未找到本地限额快照。",
                )),
            })
        };

        let mut warnings = Vec::new();
        if session_limits.is_none() {
            warnings.push(locale.text(
                "Quota information stays unavailable until Codex writes at least one local token_count event.",
                "在 Codex 本地写入至少一条 token_count 事件之前，配额信息不可用。",
            ));
        }
        if let Some(mode) = auth.auth_mode.as_deref() {
            if mode != "chatgpt" {
                warnings.push(locale.text(
                    "This account was not signed in through ChatGPT, so plan information may be incomplete.",
                    "当前账号不是通过 ChatGPT 登录，套餐信息可能不完整。",
                ));
            }
        }
        if auth.openai_api_key.is_some() {
            warnings.push(locale.text(
                "A local OPENAI_API_KEY was detected, but this app still prefers the ChatGPT/Codex sign-in state.",
                "本地检测到 OPENAI_API_KEY；当前应用仍优先使用 ChatGPT/Codex 登录态。",
            ));
        }

        Ok(ProviderSnapshot {
            provider: descriptor,
            account: AccountSnapshot {
                identifier: account_identifier,
                email,
                auth_mode: auth.auth_mode.clone(),
                source_path: Some(paths.auth_path.display().to_string()),
                detected: true,
            },
            plan: Some(PlanSnapshot {
                name: detected_plan.clone().map(title_case),
                tier: detected_plan,
                cycle: format_plan_cycle(locale, session_limits.as_ref()),
                renewal_at: session_limits.as_ref().and_then(|limits| limits.reset_at.clone()),
                source: Some(if session_limits.is_some() {
                    "session-rate-limits".to_string()
                } else {
                    "auth-jwt".to_string()
                }),
            }),
            quota,
            warnings,
            refreshed_at: Utc::now().to_rfc3339(),
            raw_meta: Some(json!({
                "authPath": paths.auth_path.display().to_string(),
                "configPath": paths.config_path.display().to_string(),
                "sessionsRoot": paths.sessions_root.display().to_string(),
                "lastAuthRefresh": auth.last_refresh,
                "model": config.model,
                "reasoningEffort": config.model_reasoning_effort,
                "sessionRateLimit": session_limits
            })),
        })
    }
}

#[derive(Debug)]
struct CodexPaths {
    auth_path: PathBuf,
    config_path: PathBuf,
    sessions_root: PathBuf,
}

impl CodexPaths {
    fn detect() -> Self {
        let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
        let root = home.join(".codex");

        Self {
            auth_path: root.join("auth.json"),
            config_path: root.join("config.toml"),
            sessions_root: root.join("sessions"),
        }
    }
}

#[derive(Debug, Deserialize)]
struct AuthFile {
    auth_mode: Option<String>,
    #[serde(rename = "OPENAI_API_KEY", default)]
    openai_api_key: Option<String>,
    tokens: Option<AuthTokens>,
    last_refresh: Option<String>,
}

#[derive(Debug, Deserialize)]
struct AuthTokens {
    id_token: Option<String>,
    access_token: Option<String>,
    account_id: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
struct ConfigFile {
    model: Option<String>,
    model_reasoning_effort: Option<String>,
}

#[derive(Debug, Deserialize)]
struct Claims {
    email: Option<String>,
    #[serde(rename = "https://api.openai.com/auth", default)]
    auth: AuthClaims,
    #[serde(rename = "https://api.openai.com/profile", default)]
    profile: ProfileClaims,
}

#[derive(Debug, Default, Deserialize)]
struct AuthClaims {
    chatgpt_account_id: Option<String>,
    chatgpt_plan_type: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
struct ProfileClaims {
    email: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct SessionRateLimit {
    used_percent: f64,
    window_minutes: i64,
    reset_at: Option<String>,
    plan_type: Option<String>,
    source_file: String,
}

fn read_config(path: &Path) -> Result<ConfigFile, AppError> {
    if !path.exists() {
        return Ok(ConfigFile::default());
    }

    let content = fs::read_to_string(path)?;
    let config = toml::from_str::<ConfigFile>(&content)?;
    Ok(config)
}

fn decode_claims(auth: &AuthFile) -> Result<Option<Claims>, AppError> {
    let token = auth
        .tokens
        .as_ref()
        .and_then(|tokens| tokens.access_token.as_ref().or(tokens.id_token.as_ref()));

    let Some(token) = token else {
        return Ok(None);
    };

    let Some(payload) = token.split('.').nth(1) else {
        return Err(AppError::JwtDecode("JWT payload segment is missing.".to_string()));
    };

    let engine = base64::engine::general_purpose::URL_SAFE_NO_PAD;
    let decoded = engine
        .decode(payload)
        .map_err(|error| AppError::JwtDecode(error.to_string()))?;

    let claims = serde_json::from_slice::<Claims>(&decoded)?;
    Ok(Some(claims))
}

fn read_latest_rate_limits(sessions_root: &Path) -> Result<Option<SessionRateLimit>, AppError> {
    if !sessions_root.exists() {
        return Ok(None);
    }

    let mut files: Vec<(SystemTime, PathBuf)> = WalkDir::new(sessions_root)
        .into_iter()
        .filter_map(Result::ok)
        .filter(|entry| entry.file_type().is_file())
        .filter(|entry| entry.path().extension().and_then(|ext| ext.to_str()) == Some("jsonl"))
        .filter_map(|entry| {
            let modified = entry.metadata().ok()?.modified().ok()?;
            Some((modified, entry.into_path()))
        })
        .collect();

    files.sort_by(|left, right| right.0.cmp(&left.0));

    for (_, path) in files {
        let content = fs::read_to_string(&path)?;
        for line in content.lines().rev() {
            if let Some(rate_limit) = parse_session_rate_limit_line(line, &path) {
                return Ok(Some(rate_limit));
            }
        }
    }

    Ok(None)
}

fn parse_session_rate_limit_line(line: &str, path: &Path) -> Option<SessionRateLimit> {
    let value = serde_json::from_str::<Value>(line).ok()?;
    if value.get("type").and_then(Value::as_str) != Some("event_msg") {
        return None;
    }

    let payload = value.get("payload").unwrap_or(&Value::Null);
    if payload.get("type").and_then(Value::as_str) != Some("token_count") {
        return None;
    }

    let rate_limits = payload.get("rate_limits").unwrap_or(&Value::Null);
    let primary = rate_limits.get("primary").unwrap_or(&Value::Null);
    let used_percent = primary.get("used_percent").and_then(Value::as_f64)?;
    let window_minutes = primary.get("window_minutes").and_then(Value::as_i64)?;
    let reset_at = primary
        .get("resets_at")
        .and_then(Value::as_i64)
        .and_then(|epoch| Utc.timestamp_opt(epoch, 0).single())
        .map(|date| date.to_rfc3339());

    Some(SessionRateLimit {
        used_percent,
        window_minutes,
        reset_at,
        plan_type: rate_limits
            .get("plan_type")
            .and_then(Value::as_str)
            .map(|value| value.to_string()),
        source_file: path.display().to_string(),
    })
}

fn title_case(value: String) -> String {
    let mut chars = value.chars();
    match chars.next() {
        Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
        None => value,
    }
}

fn format_plan_cycle(locale: AppLocale, session_limits: Option<&SessionRateLimit>) -> Option<String> {
    session_limits
        .map(|limits| match locale {
            AppLocale::En => format!("{} minute window", limits.window_minutes),
            AppLocale::ZhCn => format!("{} 分钟窗口", limits.window_minutes),
        })
        .or_else(|| Some(locale.text("Session-based", "基于会话")))
}

#[cfg(test)]
mod tests {
    use super::{parse_session_rate_limit_line, title_case};
    use std::path::Path;

    #[test]
    fn parses_token_count_rate_limits_from_session_line() {
        let line = r#"{"type":"event_msg","payload":{"type":"token_count","rate_limits":{"limit_id":"codex","plan_type":"free","primary":{"used_percent":23.0,"window_minutes":10080,"resets_at":1777464803}}}}"#;

        let parsed = parse_session_rate_limit_line(line, Path::new("session.jsonl"))
            .expect("rate-limit line should parse");

        assert!((parsed.used_percent - 23.0).abs() < f64::EPSILON);
        assert_eq!(parsed.window_minutes, 10080);
        assert_eq!(parsed.plan_type.as_deref(), Some("free"));
        assert_eq!(parsed.source_file, "session.jsonl");
        assert!(parsed.reset_at.is_some());
    }

    #[test]
    fn title_case_only_changes_first_character() {
        assert_eq!(title_case("free".to_string()), "Free");
        assert_eq!(title_case(String::new()), "");
    }
}
