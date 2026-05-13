use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::error::AppError;
use crate::locale::AppLocale;
use crate::models::{
    ApiKeyStatus, ApiPlatformsEnvironmentStatus, DesktopWidgetSettings,
    DesktopWidgetSettingsInput, ProviderSettingsInput, SavedProviderEntrySummary,
};
use crate::providers::api_platform::{
    get_env_key, mask_key, OPENAI_API_KEY_ENV, OPENROUTER_API_KEY_ENV,
};

pub const CUSTOM_PROVIDER_FALLBACK_NAME: &str = "Custom Provider";
pub const CUSTOM_PROVIDER_DEFAULT_BASE_URL: &str = "https://api.openai.com/v1";
const DEFAULT_WIDGET_PROVIDER_ID: &str = "codex";
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
    pub entry_id: Option<String>,
    pub display_name: String,
    pub base_url: String,
    pub api_key: String,
    pub source: String,
    pub key_mask: String,
    pub has_local_config: bool,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
struct StoredProviderSettings {
    #[serde(default)]
    openrouter: Option<StoredOpenRouterSettings>,
    #[serde(default)]
    custom_provider: Option<StoredCustomProviderCollection>,
    #[serde(default)]
    desktop_widget: StoredDesktopWidgetSettings,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawStoredProviderSettings {
    #[serde(default)]
    openrouter: Option<StoredOpenRouterSettings>,
    #[serde(default)]
    custom_provider: Option<RawStoredCustomProviderSettings>,
    #[serde(default)]
    desktop_widget: StoredDesktopWidgetSettings,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredOpenRouterSettings {
    api_key: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredCustomProviderCollection {
    #[serde(default)]
    active_entry_id: Option<String>,
    #[serde(default)]
    entries: Vec<StoredCustomProviderEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredCustomProviderEntry {
    id: String,
    display_name: String,
    base_url: String,
    api_key: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LegacyStoredCustomProviderSettings {
    display_name: String,
    base_url: String,
    api_key: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(untagged)]
enum RawStoredCustomProviderSettings {
    Legacy(LegacyStoredCustomProviderSettings),
    Multi(StoredCustomProviderCollection),
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredDesktopWidgetSettings {
    #[serde(default)]
    visible: bool,
    #[serde(default)]
    provider_id: Option<String>,
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

pub fn clear_provider_settings(
    provider_id: &str,
    entry_id: Option<String>,
) -> Result<ApiPlatformsEnvironmentStatus, AppError> {
    let path = settings_file_path();
    let mut store = load_store_from_path(&path)?;

    match provider_id {
        "openrouter" => store.openrouter = None,
        "custom-provider" => match normalize_optional(entry_id) {
            Some(target_entry_id) => {
                if let Some(collection) = store.custom_provider.as_mut() {
                    collection.entries.retain(|entry| entry.id != target_entry_id);
                    store.custom_provider = normalize_collection(Some(collection.clone()));
                }
            }
            None => store.custom_provider = None,
        },
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
                locale.text("Display name is required.", "必须填写显示名称。"),
            )?;
            let base_url = normalize_base_url(
                payload.base_url,
                locale.text("Base URL is required.", "必须填写 Base URL。"),
                locale.text(
                    "Base URL must start with http:// or https://.",
                    "Base URL 必须以 http:// 或 https:// 开头。",
                ),
            )?;
            let requested_entry_id = normalize_optional(payload.entry_id);
            let mut collection = store
                .custom_provider
                .take()
                .unwrap_or(StoredCustomProviderCollection {
                    active_entry_id: None,
                    entries: Vec::new(),
                });

            let existing_index = requested_entry_id.as_ref().and_then(|entry_id| {
                collection
                    .entries
                    .iter()
                    .position(|entry| entry.id == *entry_id)
            });

            let next_api_key = match normalize_optional(payload.api_key) {
                Some(value) => value,
                None => existing_index
                    .and_then(|index| collection.entries.get(index))
                    .map(|entry| entry.api_key.clone())
                    .ok_or_else(|| {
                        AppError::Message(locale.text(
                            "API key is required for the custom provider.",
                            "自定义 Provider 必须填写 API Key。",
                        ))
                    })?,
            };

            let target_entry_id =
                requested_entry_id.unwrap_or_else(|| create_entry_id("custom-provider"));

            if let Some(index) = existing_index {
                let entry = &mut collection.entries[index];
                entry.display_name = display_name;
                entry.base_url = base_url;
                entry.api_key = next_api_key;
                collection.active_entry_id = Some(entry.id.clone());
            } else {
                collection.entries.push(StoredCustomProviderEntry {
                    id: target_entry_id.clone(),
                    display_name,
                    base_url,
                    api_key: next_api_key,
                });
                collection.active_entry_id = Some(target_entry_id);
            }

            store.custom_provider = normalize_collection(Some(collection));
        }
        _ => return Err(AppError::Message(format!("Unknown provider: {provider_id}"))),
    }

    persist_store_to_path(&path, &store)?;
    Ok(build_settings_snapshot(&store, &path))
}

pub fn set_active_custom_provider_entry(
    entry_id: String,
) -> Result<ApiPlatformsEnvironmentStatus, AppError> {
    let path = settings_file_path();
    let mut store = load_store_from_path(&path)?;
    let target_entry_id = normalize_optional(Some(entry_id)).ok_or_else(|| {
        AppError::Message("A custom provider entry id is required.".to_string())
    })?;

    let collection = store
        .custom_provider
        .as_mut()
        .ok_or_else(|| AppError::Message("No custom provider entries were found.".to_string()))?;

    if collection.entries.iter().any(|entry| entry.id == target_entry_id) {
        collection.active_entry_id = Some(target_entry_id);
    } else {
        return Err(AppError::Message(
            "The selected custom provider entry was not found.".to_string(),
        ));
    }

    store.custom_provider = normalize_collection(store.custom_provider.take());
    persist_store_to_path(&path, &store)?;
    Ok(build_settings_snapshot(&store, &path))
}

pub fn save_desktop_widget_settings(
    payload: DesktopWidgetSettingsInput,
) -> Result<ApiPlatformsEnvironmentStatus, AppError> {
    let path = settings_file_path();
    let mut store = load_store_from_path(&path)?;

    if let Some(visible) = payload.visible {
        store.desktop_widget.visible = visible;
        if visible && store.desktop_widget.provider_id.is_none() {
            store.desktop_widget.provider_id = Some(DEFAULT_WIDGET_PROVIDER_ID.to_string());
        }
    }

    if let Some(provider_id) = normalize_optional(payload.provider_id) {
        store.desktop_widget.provider_id = Some(provider_id);
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
        desktop_widget: build_desktop_widget_settings(store),
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
            active_entry_id: None,
            saved_entries: Vec::new(),
        }
    } else {
        ApiKeyStatus {
            configured: false,
            source: None,
            key_mask: None,
            display_name: None,
            base_url: None,
            has_local_config: false,
            active_entry_id: None,
            saved_entries: Vec::new(),
        }
    }
}

fn build_custom_provider_status(store: &StoredProviderSettings, path: &Path) -> ApiKeyStatus {
    let saved_entries = store
        .custom_provider
        .as_ref()
        .map(build_custom_provider_summaries)
        .unwrap_or_default();
    let active_entry_id = store
        .custom_provider
        .as_ref()
        .and_then(|collection| collection.active_entry_id.clone());

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
            active_entry_id,
            saved_entries,
        }
    } else {
        ApiKeyStatus {
            configured: false,
            source: None,
            key_mask: None,
            display_name: None,
            base_url: None,
            has_local_config: false,
            active_entry_id,
            saved_entries,
        }
    }
}

fn build_custom_provider_summaries(
    collection: &StoredCustomProviderCollection,
) -> Vec<SavedProviderEntrySummary> {
    collection
        .entries
        .iter()
        .map(|entry| SavedProviderEntrySummary {
            id: entry.id.clone(),
            display_name: entry.display_name.clone(),
            base_url: entry.base_url.clone(),
            key_mask: mask_key(&entry.api_key),
        })
        .collect()
}

fn build_desktop_widget_settings(store: &StoredProviderSettings) -> DesktopWidgetSettings {
    DesktopWidgetSettings {
        visible: store.desktop_widget.visible,
        provider_id: store
            .desktop_widget
            .provider_id
            .clone()
            .or_else(|| Some(DEFAULT_WIDGET_PROVIDER_ID.to_string())),
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
    if let Some(collection) = store.custom_provider.as_ref() {
        let active_entry = resolve_active_entry(collection)?;
        let display_name = normalize_optional(Some(active_entry.display_name.clone()))
            .unwrap_or_else(|| CUSTOM_PROVIDER_FALLBACK_NAME.to_string());
        let base_url = normalize_optional(Some(active_entry.base_url.clone()))?;
        let api_key = normalize_optional(Some(active_entry.api_key.clone()))?;

        return Some(ResolvedCustomProviderConfig {
            entry_id: Some(active_entry.id.clone()),
            display_name,
            base_url,
            key_mask: mask_key(&api_key),
            source: format!("config:{}", path.display()),
            has_local_config: true,
            api_key,
        });
    }

    env_api_key.map(|api_key| ResolvedCustomProviderConfig {
        entry_id: None,
        display_name: "OpenAI API".to_string(),
        base_url: CUSTOM_PROVIDER_DEFAULT_BASE_URL.to_string(),
        key_mask: mask_key(&api_key),
        source: format!("env:{OPENAI_API_KEY_ENV}"),
        has_local_config: false,
        api_key,
    })
}

fn resolve_active_entry(
    collection: &StoredCustomProviderCollection,
) -> Option<&StoredCustomProviderEntry> {
    collection
        .active_entry_id
        .as_ref()
        .and_then(|active_entry_id| {
            collection
                .entries
                .iter()
                .find(|entry| entry.id == *active_entry_id)
        })
        .or_else(|| collection.entries.first())
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

fn normalize_collection(
    collection: Option<StoredCustomProviderCollection>,
) -> Option<StoredCustomProviderCollection> {
    let mut collection = collection?;
    collection.entries = collection
        .entries
        .into_iter()
        .filter_map(normalize_custom_provider_entry)
        .collect();

    if collection.entries.is_empty() {
        return None;
    }

    let has_active_entry = collection
        .active_entry_id
        .as_ref()
        .map(|active_entry_id| collection.entries.iter().any(|entry| entry.id == *active_entry_id))
        .unwrap_or(false);

    if !has_active_entry {
        collection.active_entry_id = collection.entries.first().map(|entry| entry.id.clone());
    }

    Some(collection)
}

fn normalize_custom_provider_entry(
    entry: StoredCustomProviderEntry,
) -> Option<StoredCustomProviderEntry> {
    let display_name = normalize_optional(Some(entry.display_name))
        .unwrap_or_else(|| CUSTOM_PROVIDER_FALLBACK_NAME.to_string());
    let base_url = normalize_base_url(
        Some(entry.base_url),
        "required".to_string(),
        "invalid".to_string(),
    )
    .ok()?;
    let api_key = normalize_optional(Some(entry.api_key))?;
    let id = normalize_optional(Some(entry.id)).unwrap_or_else(|| create_entry_id("custom"));

    Some(StoredCustomProviderEntry {
        id,
        display_name,
        base_url,
        api_key,
    })
}

fn create_entry_id(prefix: &str) -> String {
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    format!("{prefix}-{unique}")
}

fn load_store_from_path(path: &Path) -> Result<StoredProviderSettings, AppError> {
    if !path.exists() {
        return Ok(StoredProviderSettings::default());
    }

    let content = fs::read_to_string(path)?;
    let raw = serde_json::from_str::<RawStoredProviderSettings>(&content)?;
    let custom_provider = match raw.custom_provider {
        Some(RawStoredCustomProviderSettings::Legacy(legacy)) => normalize_collection(Some(
            StoredCustomProviderCollection {
                active_entry_id: None,
                entries: vec![StoredCustomProviderEntry {
                    id: create_entry_id("legacy"),
                    display_name: legacy.display_name,
                    base_url: legacy.base_url,
                    api_key: legacy.api_key,
                }],
            },
        )),
        Some(RawStoredCustomProviderSettings::Multi(collection)) => normalize_collection(Some(collection)),
        None => None,
    };

    Ok(StoredProviderSettings {
        openrouter: raw.openrouter,
        custom_provider,
        desktop_widget: normalize_desktop_widget_settings(raw.desktop_widget),
    })
}

fn normalize_desktop_widget_settings(
    settings: StoredDesktopWidgetSettings,
) -> StoredDesktopWidgetSettings {
    StoredDesktopWidgetSettings {
        visible: settings.visible,
        provider_id: normalize_optional(settings.provider_id),
    }
}

fn persist_store_to_path(path: &Path, store: &StoredProviderSettings) -> Result<(), AppError> {
    let should_remove_file = store.openrouter.is_none()
        && store.custom_provider.is_none()
        && !store.desktop_widget.visible
        && store.desktop_widget.provider_id.is_none();

    if should_remove_file {
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
        build_settings_snapshot, load_store_from_path, normalize_base_url,
        normalize_collection, normalize_optional, persist_store_to_path,
        resolve_custom_provider_from_store, resolve_openrouter_from_store, settings_file_path,
        StoredCustomProviderCollection, StoredCustomProviderEntry, StoredOpenRouterSettings,
        StoredProviderSettings,
    };
    use std::fs;
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

    fn write_store(path: &Path, store: &StoredProviderSettings) {
        persist_store_to_path(path, store).expect("store should persist");
    }

    #[test]
    fn settings_file_roundtrip_preserves_saved_values() {
        let path = temp_path("roundtrip");
        let store = StoredProviderSettings {
            openrouter: Some(StoredOpenRouterSettings {
                api_key: "sk-or-test".to_string(),
            }),
            custom_provider: Some(StoredCustomProviderCollection {
                active_entry_id: Some("entry-2".to_string()),
                entries: vec![
                    StoredCustomProviderEntry {
                        id: "entry-1".to_string(),
                        display_name: "My Router".to_string(),
                        base_url: "https://example.com/v1".to_string(),
                        api_key: "sk-custom-test".to_string(),
                    },
                    StoredCustomProviderEntry {
                        id: "entry-2".to_string(),
                        display_name: "My GLM".to_string(),
                        base_url: "https://open.bigmodel.cn/api/paas/v4".to_string(),
                        api_key: "sk-glm-test".to_string(),
                    },
                ],
            }),
            desktop_widget: super::StoredDesktopWidgetSettings {
                visible: true,
                provider_id: Some("github-copilot".to_string()),
            },
        };

        write_store(&path, &store);
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
                .map(|settings| settings.entries.len()),
            Some(2)
        );
        assert_eq!(reloaded.desktop_widget.provider_id.as_deref(), Some("github-copilot"));

        cleanup(&path);
    }

    #[test]
    fn local_config_takes_precedence_over_environment_fallback() {
        let path = temp_path("precedence");
        let store = StoredProviderSettings {
            openrouter: Some(StoredOpenRouterSettings {
                api_key: "sk-or-local".to_string(),
            }),
            custom_provider: Some(StoredCustomProviderCollection {
                active_entry_id: Some("local-entry".to_string()),
                entries: vec![StoredCustomProviderEntry {
                    id: "local-entry".to_string(),
                    display_name: "Local Custom".to_string(),
                    base_url: "https://local.example/v1".to_string(),
                    api_key: "sk-local-custom".to_string(),
                }],
            }),
            desktop_widget: super::StoredDesktopWidgetSettings::default(),
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
        assert_eq!(custom_provider.entry_id.as_deref(), Some("local-entry"));
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
        assert!(snapshot.custom_provider.saved_entries.is_empty());
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
        let initial_store = StoredProviderSettings {
            openrouter: None,
            custom_provider: Some(StoredCustomProviderCollection {
                active_entry_id: Some("entry-1".to_string()),
                entries: vec![StoredCustomProviderEntry {
                    id: "entry-1".to_string(),
                    display_name: "First Name".to_string(),
                    base_url: "https://first.example/v1".to_string(),
                    api_key: "sk-initial".to_string(),
                }],
            }),
            desktop_widget: super::StoredDesktopWidgetSettings::default(),
        };
        write_store(&path, &initial_store);

        let content = fs::read_to_string(&path).expect("settings file should exist");
        let _ = serde_json::from_str::<serde_json::Value>(&content).expect("json should parse");

        let mut store = load_store_from_path(&path).expect("store should load");
        let collection = store.custom_provider.as_mut().expect("entries should exist");
        let entry = collection.entries.first_mut().expect("entry should exist");
        let next_api_key = normalize_optional(Some("   ".to_string()))
            .unwrap_or_else(|| entry.api_key.clone());
        entry.display_name = "Updated Name".to_string();
        entry.base_url = "https://updated.example/v1".to_string();
        entry.api_key = next_api_key;

        write_store(&path, &store);
        let updated = load_store_from_path(&path).expect("store should reload");

        assert_eq!(
            updated
                .custom_provider
                .as_ref()
                .and_then(|settings| settings.entries.first())
                .map(|entry| entry.api_key.as_str()),
            Some("sk-initial")
        );
        assert_eq!(
            updated
                .custom_provider
                .as_ref()
                .and_then(|settings| settings.entries.first())
                .map(|entry| entry.display_name.as_str()),
            Some("Updated Name")
        );
        assert_eq!(
            updated
                .custom_provider
                .as_ref()
                .and_then(|settings| settings.entries.first())
                .map(|entry| entry.base_url.as_str()),
            Some("https://updated.example/v1")
        );

        cleanup(&path);
    }

    #[test]
    fn normalize_collection_keeps_active_entry_valid() {
        let normalized = normalize_collection(Some(StoredCustomProviderCollection {
            active_entry_id: Some("missing".to_string()),
            entries: vec![StoredCustomProviderEntry {
                id: "".to_string(),
                display_name: "A".to_string(),
                base_url: "https://example.com/v1".to_string(),
                api_key: "sk-test".to_string(),
            }],
        }))
        .expect("collection should normalize");

        assert_eq!(normalized.entries.len(), 1);
        assert_eq!(normalized.active_entry_id, Some(normalized.entries[0].id.clone()));
    }

    #[test]
    fn settings_path_points_to_named_file() {
        let path = settings_file_path();
        assert!(path.ends_with("provider-settings.json"));
    }

    #[test]
    fn legacy_shape_is_migrated_to_multi_entry_collection() {
        let path = temp_path("legacy-migration");
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).expect("parent should exist");
        }
        fs::write(
            &path,
            r#"{
  "customProvider": {
    "displayName": "Legacy",
    "baseUrl": "https://legacy.example/v1",
    "apiKey": "sk-legacy"
  }
}"#,
        )
        .expect("legacy content should write");

        let reloaded = load_store_from_path(&path).expect("store should load");
        let collection = reloaded
            .custom_provider
            .as_ref()
            .expect("collection should exist");

        assert_eq!(collection.entries.len(), 1);
        assert_eq!(collection.entries[0].display_name, "Legacy");
        assert!(collection.active_entry_id.is_some());

        cleanup(&path);
    }
}
