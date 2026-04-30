use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::AppError;
use crate::locale::AppLocale;
use crate::models::{ApiKeyStatus, ApiPlatformsEnvironmentStatus, ProviderSettingsInput};
use crate::providers::api_platform::{
    get_env_key, mask_key, OPENAI_API_KEY_ENV, OPENROUTER_API_KEY_ENV,
};

pub const CUSTOM_PROVIDER_FALLBACK_NAME: &str = "Custom Provider";
pub const CUSTOM_PROVIDER_DEFAULT_BASE_URL: &str = "https://api.openai.com/v1";
const SETTINGS_FILE_NAME: &str = "provider-settings.json";
const SETTINGS_DIRECTORY_NAME: &str = "Agent Limit";

#[derive(Debug, Clone)]
pub struct ResolvedOpenRouterConfig {
    pub api_key: String,
    pub source: String,
    pub key_mask: String,
    pub has_local_config: bool,
}

#[derive(Debug, Clone)]
pub struct ResolvedCustomProviderConfig {
    pub display_name: String,
    pub base_url: String,
    pub api_key: String,
    pub source: String,
    pub key_mask: String,
    pub has_local_config: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredProviderSettings {
    #[serde(default)]
    openrouter: Option<StoredOpenRouterSettings>,
    #[serde(default)]
    custom_provider: Option<StoredCustomProviderSettings>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredOpenRouterSettings {
    api_key: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredCustomProviderSettings {
    display_name: String,
    base_url: String,
    api_key: String,
}

pub fn settings_file_path() -> PathBuf {
    let root = dirs::data_local_dir()
        .or_else(dirs::home_dir)
        .unwrap_or_else(|| PathBuf::from("."));
    root.join(SETTINGS_DIRECTORY_NAME).join(SETTINGS_FILE_NAME)
}

pub fn get_provider_settings() -> Result<ApiPlatformsEnvironmentStatus, AppError> {
    let path = settings_file_path();
    let store = load_store_from_path(&path)?;
    Ok(build_settings_snapshot(&store, &path))
}

pub fn clear_provider_settings(provider_id: &str) -> Result<ApiPlatformsEnvironmentStatus, AppError> {
    let path = settings_file_path();
    let mut store = load_store_from_path(&path)?;

    match provider_id {
        "openrouter" => store.openrouter = None,
        "custom-provider" => store.custom_provider = None,
        _ => return Err(AppError::Message(format!("Unknown provider: {provider_id}"))),
    }

    persist_store_to_path(&path, &store)?;
    Ok(build_settings_snapshot(&store, &path))
}

pub fn save_provider_settings(
    provider_id: &str,
    payload: ProviderSettingsInput,
    locale: AppLocale,
) -> Result<ApiPlatformsEnvironmentStatus, AppError> {
    let path = settings_file_path();
    let mut store = load_store_from_path(&path)?;

    match provider_id {
        "openrouter" => {
            let api_key = require_non_empty(
                payload.api_key,
                locale.text(
                    "OpenRouter API key is required.",
                    "必须填写 OpenRouter API Key。",
                ),
            )?;

            store.openrouter = Some(StoredOpenRouterSettings { api_key });
        }
        "custom-provider" => {
            let display_name = normalize_display_name(
                payload.display_name,
                locale.text(
                    "Display name is required.",
                    "必须填写显示名称。",
                ),
            )?;
            let base_url = normalize_base_url(
                payload.base_url,
                locale.text(
                    "Base URL is required.",
                    "必须填写 Base URL。",
                ),
                locale.text(
                    "Base URL must start with http:// or https://.",
                    "Base URL 必须以 http:// 或 https:// 开头。",
                ),
            )?;
            let api_key = match normalize_optional(payload.api_key) {
                Some(value) => value,
                None => store
                    .custom_provider
                    .as_ref()
                    .map(|settings| settings.api_key.clone())
                    .ok_or_else(|| {
                        AppError::Message(locale.text(
                            "API key is required for the custom provider.",
                            "自定义 Provider 必须填写 API Key。",
                        ))
                    })?,
            };

            store.custom_provider = Some(StoredCustomProviderSettings {
                display_name,
                base_url,
                api_key,
            });
        }
        _ => return Err(AppError::Message(format!("Unknown provider: {provider_id}"))),
    }

    persist_store_to_path(&path, &store)?;
    Ok(build_settings_snapshot(&store, &path))
}

pub fn resolve_openrouter_config() -> Result<Option<ResolvedOpenRouterConfig>, AppError> {
    let path = settings_file_path();
    let store = load_store_from_path(&path)?;
    Ok(resolve_openrouter_from_store(
        &store,
        &path,
        get_env_key(OPENROUTER_API_KEY_ENV),
    ))
}

pub fn resolve_custom_provider_config() -> Result<Option<ResolvedCustomProviderConfig>, AppError> {
    let path = settings_file_path();
    let store = load_store_from_path(&path)?;
    Ok(resolve_custom_provider_from_store(
        &store,
        &path,
        get_env_key(OPENAI_API_KEY_ENV),
    ))
}

fn build_settings_snapshot(
    store: &StoredProviderSettings,
    path: &Path,
) -> ApiPlatformsEnvironmentStatus {
    ApiPlatformsEnvironmentStatus {
        openrouter: build_openrouter_status(store, path),
        custom_provider: build_custom_provider_status(store, path),
    }
}

fn build_openrouter_status(store: &StoredProviderSettings, path: &Path) -> ApiKeyStatus {
    if let Some(config) =
        resolve_openrouter_from_store(store, path, get_env_key(OPENROUTER_API_KEY_ENV))
    {
        ApiKeyStatus {
            configured: true,
            source: Some(config.source),
            key_mask: Some(config.key_mask),
            display_name: None,
            base_url: None,
            has_local_config: config.has_local_config,
        }
    } else {
        ApiKeyStatus {
            configured: false,
            source: None,
            key_mask: None,
            display_name: None,
            base_url: None,
            has_local_config: false,
        }
    }
}

fn build_custom_provider_status(store: &StoredProviderSettings, path: &Path) -> ApiKeyStatus {
    if let Some(config) =
        resolve_custom_provider_from_store(store, path, get_env_key(OPENAI_API_KEY_ENV))
    {
        ApiKeyStatus {
            configured: true,
            source: Some(config.source),
            key_mask: Some(config.key_mask),
            display_name: Some(config.display_name),
            base_url: Some(config.base_url),
            has_local_config: config.has_local_config,
        }
    } else {
        ApiKeyStatus {
            configured: false,
            source: None,
            key_mask: None,
            display_name: None,
            base_url: None,
            has_local_config: false,
        }
    }
}

fn resolve_openrouter_from_store(
    store: &StoredProviderSettings,
    path: &Path,
    env_api_key: Option<String>,
) -> Option<ResolvedOpenRouterConfig> {
    if let Some(api_key) = store
        .openrouter
        .as_ref()
        .map(|settings| settings.api_key.trim())
        .filter(|value| !value.is_empty())
    {
        return Some(ResolvedOpenRouterConfig {
            api_key: api_key.to_string(),
            source: format!("config:{}", path.display()),
            key_mask: mask_key(api_key),
            has_local_config: true,
        });
    }

    env_api_key.map(|api_key| ResolvedOpenRouterConfig {
        key_mask: mask_key(&api_key),
        source: format!("env:{OPENROUTER_API_KEY_ENV}"),
        has_local_config: false,
        api_key,
    })
}

fn resolve_custom_provider_from_store(
    store: &StoredProviderSettings,
    path: &Path,
    env_api_key: Option<String>,
) -> Option<ResolvedCustomProviderConfig> {
    if let Some(local) = store.custom_provider.as_ref() {
        let display_name = normalize_optional(Some(local.display_name.clone()))
            .unwrap_or_else(|| CUSTOM_PROVIDER_FALLBACK_NAME.to_string());
        let base_url = normalize_optional(Some(local.base_url.clone()))?;
        let api_key = normalize_optional(Some(local.api_key.clone()))?;

        return Some(ResolvedCustomProviderConfig {
            display_name,
            base_url,
            key_mask: mask_key(&api_key),
            source: format!("config:{}", path.display()),
            has_local_config: true,
            api_key,
        });
    }

    env_api_key.map(|api_key| ResolvedCustomProviderConfig {
        display_name: "OpenAI API".to_string(),
        base_url: CUSTOM_PROVIDER_DEFAULT_BASE_URL.to_string(),
        key_mask: mask_key(&api_key),
        source: format!("env:{OPENAI_API_KEY_ENV}"),
        has_local_config: false,
        api_key,
    })
}

fn require_non_empty(value: Option<String>, error_message: String) -> Result<String, AppError> {
    normalize_optional(value).ok_or_else(|| AppError::Message(error_message))
}

fn normalize_display_name(value: Option<String>, error_message: String) -> Result<String, AppError> {
    let display_name = normalize_optional(value).ok_or_else(|| AppError::Message(error_message))?;
    Ok(display_name)
}

fn normalize_base_url(
    value: Option<String>,
    required_message: String,
    invalid_message: String,
) -> Result<String, AppError> {
    let normalized = normalize_optional(value)
        .ok_or_else(|| AppError::Message(required_message))?
        .trim_end_matches('/')
        .to_string();

    if normalized.starts_with("http://") || normalized.starts_with("https://") {
        Ok(normalized)
    } else {
        Err(AppError::Message(invalid_message))
    }
}

fn normalize_optional(value: Option<String>) -> Option<String> {
    value
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn load_store_from_path(path: &Path) -> Result<StoredProviderSettings, AppError> {
    if !path.exists() {
        return Ok(StoredProviderSettings::default());
    }

    let content = fs::read_to_string(path)?;
    Ok(serde_json::from_str::<StoredProviderSettings>(&content)?)
}

fn persist_store_to_path(path: &Path, store: &StoredProviderSettings) -> Result<(), AppError> {
    if store.openrouter.is_none() && store.custom_provider.is_none() {
        if path.exists() {
            fs::remove_file(path)?;
        }
        return Ok(());
    }

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }

    fs::write(path, serde_json::to_string_pretty(store)?)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        build_settings_snapshot, load_store_from_path, normalize_base_url, normalize_optional,
        persist_store_to_path, resolve_custom_provider_from_store,
        resolve_openrouter_from_store, settings_file_path, StoredCustomProviderSettings,
        StoredOpenRouterSettings, StoredProviderSettings,
    };
    use crate::models::ProviderSettingsInput;
    use std::path::{Path, PathBuf};
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_path(name: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time should be valid")
            .as_nanos();
        std::env::temp_dir()
            .join("agent-limit-tests")
            .join(format!("{name}-{unique}"))
            .join("provider-settings.json")
    }

    fn cleanup(path: &Path) {
        if let Some(parent) = path.parent() {
            let _ = std::fs::remove_dir_all(parent);
        }
    }

    fn save_with_path(
        path: &Path,
        provider_id: &str,
        payload: ProviderSettingsInput,
    ) -> StoredProviderSettings {
        let mut store = load_store_from_path(path).expect("store should load");

        match provider_id {
            "openrouter" => {
                store.openrouter = Some(StoredOpenRouterSettings {
                    api_key: payload.api_key.expect("api key should exist"),
                });
            }
            "custom-provider" => {
                let existing_key = store
                    .custom_provider
                    .as_ref()
                    .map(|settings| settings.api_key.clone());
                let next_api_key = payload
                    .api_key
                    .and_then(|value| normalize_optional(Some(value)))
                    .or(existing_key)
                    .expect("api key should exist");
                store.custom_provider = Some(StoredCustomProviderSettings {
                    display_name: payload.display_name.expect("display name should exist"),
                    base_url: normalize_base_url(
                        payload.base_url,
                        "required".to_string(),
                        "invalid".to_string(),
                    )
                    .expect("base url should normalize"),
                    api_key: next_api_key,
                });
            }
            other => panic!("unexpected provider id: {other}"),
        }

        persist_store_to_path(path, &store).expect("store should persist");
        load_store_from_path(path).expect("store should reload")
    }

    #[test]
    fn settings_file_roundtrip_preserves_saved_values() {
        let path = temp_path("roundtrip");
        let store = StoredProviderSettings {
            openrouter: Some(StoredOpenRouterSettings {
                api_key: "sk-or-test".to_string(),
            }),
            custom_provider: Some(StoredCustomProviderSettings {
                display_name: "My Router".to_string(),
                base_url: "https://example.com/v1".to_string(),
                api_key: "sk-custom-test".to_string(),
            }),
        };

        persist_store_to_path(&path, &store).expect("store should persist");
        let reloaded = load_store_from_path(&path).expect("store should reload");

        assert_eq!(
            reloaded
                .openrouter
                .as_ref()
                .map(|settings| settings.api_key.as_str()),
            Some("sk-or-test")
        );
        assert_eq!(
            reloaded
                .custom_provider
                .as_ref()
                .map(|settings| settings.base_url.as_str()),
            Some("https://example.com/v1")
        );

        cleanup(&path);
    }

    #[test]
    fn local_config_takes_precedence_over_environment_fallback() {
        let path = temp_path("precedence");
        let store = StoredProviderSettings {
            openrouter: Some(StoredOpenRouterSettings {
                api_key: "sk-or-local".to_string(),
            }),
            custom_provider: Some(StoredCustomProviderSettings {
                display_name: "Local Custom".to_string(),
                base_url: "https://local.example/v1".to_string(),
                api_key: "sk-local-custom".to_string(),
            }),
        };

        let openrouter = resolve_openrouter_from_store(
            &store,
            &path,
            Some("sk-or-env".to_string()),
        )
        .expect("openrouter config should resolve");
        let custom_provider = resolve_custom_provider_from_store(
            &store,
            &path,
            Some("sk-env-openai".to_string()),
        )
        .expect("custom provider config should resolve");

        assert_eq!(openrouter.api_key, "sk-or-local");
        assert!(openrouter.has_local_config);
        assert_eq!(custom_provider.display_name, "Local Custom");
        assert_eq!(custom_provider.base_url, "https://local.example/v1");
        assert_eq!(custom_provider.api_key, "sk-local-custom");
        assert!(custom_provider.has_local_config);
    }

    #[test]
    fn environment_fallback_is_used_when_local_config_is_absent() {
        let path = temp_path("env-fallback");
        let store = StoredProviderSettings::default();
        let snapshot = build_settings_snapshot(&store, &path);

        assert!(!snapshot.openrouter.configured);
        assert!(!snapshot.custom_provider.configured);

        let custom_provider = resolve_custom_provider_from_store(
            &store,
            &path,
            Some("sk-env-openai".to_string()),
        )
        .expect("custom provider env fallback should resolve");

        assert_eq!(custom_provider.display_name, "OpenAI API");
        assert_eq!(custom_provider.base_url, "https://api.openai.com/v1");
        assert!(!custom_provider.has_local_config);
    }

    #[test]
    fn custom_provider_base_url_is_normalized() {
        let normalized = normalize_base_url(
            Some(" https://example.com/v1/// ".to_string()),
            "required".to_string(),
            "invalid".to_string(),
        )
        .expect("base url should normalize");

        assert_eq!(normalized, "https://example.com/v1");
    }

    #[test]
    fn blank_api_key_preserves_existing_custom_provider_secret() {
        let path = temp_path("preserve-key");
        save_with_path(
            &path,
            "custom-provider",
            ProviderSettingsInput {
                api_key: Some("sk-initial".to_string()),
                display_name: Some("First Name".to_string()),
                base_url: Some("https://first.example/v1".to_string()),
            },
        );

        let updated = save_with_path(
            &path,
            "custom-provider",
            ProviderSettingsInput {
                api_key: Some("   ".to_string()),
                display_name: Some("Updated Name".to_string()),
                base_url: Some("https://updated.example/v1/".to_string()),
            },
        );

        assert_eq!(
            updated
                .custom_provider
                .as_ref()
                .map(|settings| settings.api_key.as_str()),
            Some("sk-initial")
        );
        assert_eq!(
            updated
                .custom_provider
                .as_ref()
                .map(|settings| settings.display_name.as_str()),
            Some("Updated Name")
        );
        assert_eq!(
            updated
                .custom_provider
                .as_ref()
                .map(|settings| settings.base_url.as_str()),
            Some("https://updated.example/v1")
        );

        cleanup(&path);
    }

    #[test]
    fn settings_path_points_to_named_file() {
        let path = settings_file_path();
        assert!(path.ends_with("provider-settings.json"));
    }
}
