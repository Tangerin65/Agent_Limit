use reqwest::blocking::{Client, Response};
use reqwest::header::{HeaderMap, HeaderValue, ACCEPT, AUTHORIZATION};
use serde_json::Value;
use std::time::Duration;

use crate::error::AppError;
use crate::locale::AppLocale;

pub const OPENROUTER_API_KEY_ENV: &str = "OPENROUTER_API_KEY";
pub const OPENAI_API_KEY_ENV: &str = "OPENAI_API_KEY";

pub fn get_env_key(name: &str) -> Option<String> {
    std::env::var(name)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

pub fn build_json_client(user_agent: &'static str, auth_token: &str) -> Result<Client, AppError> {
    let mut headers = HeaderMap::new();
    headers.insert(ACCEPT, HeaderValue::from_static("application/json"));
    headers.insert(
        AUTHORIZATION,
        HeaderValue::from_str(&format!("Bearer {auth_token}"))
            .map_err(|error| AppError::Message(error.to_string()))?,
    );

    Ok(Client::builder()
        .user_agent(user_agent)
        .timeout(Duration::from_secs(12))
        .default_headers(headers)
        .build()?)
}

pub fn read_json_body(response: Response) -> Result<Value, AppError> {
    Ok(response.error_for_status()?.json::<Value>()?)
}

pub fn mask_key(value: &str) -> String {
    if value.len() <= 8 {
        return "***".to_string();
    }

    format!("{}***{}", &value[..4], &value[value.len() - 4..])
}

pub fn missing_key_warning(locale: AppLocale, env_name: &str) -> String {
    match env_name {
        OPENROUTER_API_KEY_ENV => locale.text(
            "OpenRouter API key is not configured. Add it below and refresh to load OpenRouter credit.",
            "尚未配置 OpenRouter API Key。请在下方填写后刷新，以读取 OpenRouter Credit。",
        ),
        OPENAI_API_KEY_ENV => locale.text(
            "Custom provider API key is not configured. Fill in the provider details below and refresh to validate access.",
            "尚未配置自定义 Provider 的 API Key。请在下方填写 Provider 信息后刷新，以校验访问状态。",
        ),
        _ => locale.text("API key is missing.", "缺少 API Key。"),
    }
}

pub fn custom_provider_missing_configuration_warning(locale: AppLocale) -> String {
    locale.text(
        "Custom provider is not configured. Fill in display name, base URL, and API key below, then refresh to validate access.",
        "自定义 Provider 尚未配置。请在下方填写显示名称、Base URL 和 API Key，然后刷新以校验访问状态。",
    )
}

pub fn validation_endpoint_for_base_url(base_url: &str) -> String {
    format!("{}/models", base_url.trim_end_matches('/'))
}
