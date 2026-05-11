mod environment;
mod error;
mod locale;
mod models;
mod provider_settings;
mod providers;

use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

use locale::AppLocale;
use models::{ApiPlatformsEnvironmentStatus, DesktopWidgetSettingsInput, ProviderSettingsInput};
use provider_settings::{
    clear_provider_settings as clear_provider_settings_store,
    get_provider_settings as get_provider_settings_store,
    save_provider_settings as save_provider_settings_store,
    save_desktop_widget_settings as save_desktop_widget_settings_store,
    set_active_custom_provider_entry as set_active_custom_provider_entry_store,
};
use providers::{get_provider, registry};

const DESKTOP_WIDGET_LABEL: &str = "desktop-widget";

#[tauri::command]
fn get_registered_providers(locale: String) -> Vec<models::ProviderDescriptor> {
    let locale = AppLocale::from_input(&locale);

    registry()
        .into_iter()
        .map(|provider| provider.descriptor(locale))
        .collect()
}

#[tauri::command]
fn refresh_provider(provider_id: String, locale: String) -> Result<models::ProviderSnapshot, String> {
    let locale = AppLocale::from_input(&locale);
    let provider = get_provider(&provider_id)
        .ok_or_else(|| locale.text(
            &format!("Unknown provider: {provider_id}"),
            &format!("未知 Provider：{provider_id}"),
        ))?;

    provider.refresh(locale).map_err(|error| error.to_string())
}

#[tauri::command]
fn get_environment_diagnostics(locale: String) -> models::EnvironmentDiagnostics {
    environment::inspect_environment(AppLocale::from_input(&locale))
}

#[tauri::command]
fn get_provider_settings(locale: String) -> Result<ApiPlatformsEnvironmentStatus, String> {
    let _locale = AppLocale::from_input(&locale);
    get_provider_settings_store().map_err(|error| error.to_string())
}

#[tauri::command]
fn save_provider_settings(
    provider_id: String,
    payload: ProviderSettingsInput,
    locale: String,
) -> Result<ApiPlatformsEnvironmentStatus, String> {
    let locale = AppLocale::from_input(&locale);
    save_provider_settings_store(&provider_id, payload, locale).map_err(|error| error.to_string())
}

#[tauri::command]
fn clear_provider_settings(
    provider_id: String,
    entry_id: Option<String>,
    locale: String,
) -> Result<ApiPlatformsEnvironmentStatus, String> {
    let _locale = AppLocale::from_input(&locale);
    clear_provider_settings_store(&provider_id, entry_id).map_err(|error| error.to_string())
}

#[tauri::command]
fn set_active_custom_provider_entry(
    entry_id: String,
    locale: String,
) -> Result<ApiPlatformsEnvironmentStatus, String> {
    let _locale = AppLocale::from_input(&locale);
    set_active_custom_provider_entry_store(entry_id).map_err(|error| error.to_string())
}

#[tauri::command]
fn save_desktop_widget_settings(
    app: tauri::AppHandle,
    payload: DesktopWidgetSettingsInput,
    locale: String,
) -> Result<ApiPlatformsEnvironmentStatus, String> {
    let _locale = AppLocale::from_input(&locale);
    let settings = save_desktop_widget_settings_store(payload).map_err(|error| error.to_string())?;
    sync_desktop_widget_window(&app, &settings)?;
    Ok(settings)
}

fn ensure_desktop_widget_window(app: &tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(DESKTOP_WIDGET_LABEL) {
        window.show().map_err(|error| error.to_string())?;
        return Ok(());
    }

    WebviewWindowBuilder::new(
        app,
        DESKTOP_WIDGET_LABEL,
        WebviewUrl::App("index.html".into()),
    )
    .title("Agent Limit Widget")
    .decorations(false)
    .resizable(false)
    .skip_taskbar(true)
    .always_on_top(true)
    .inner_size(320.0, 220.0)
    .min_inner_size(320.0, 220.0)
    .build()
    .map_err(|error| error.to_string())?;

    Ok(())
}

fn close_desktop_widget_window(app: &tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(DESKTOP_WIDGET_LABEL) {
        window.close().map_err(|error| error.to_string())?;
    }

    Ok(())
}

fn sync_desktop_widget_window(
    app: &tauri::AppHandle,
    settings: &ApiPlatformsEnvironmentStatus,
) -> Result<(), String> {
    if settings.desktop_widget.visible {
        ensure_desktop_widget_window(app)
    } else {
        close_desktop_widget_window(app)
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            if let Ok(settings) = get_provider_settings_store() {
                let _ = sync_desktop_widget_window(&app.handle().clone(), &settings);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_registered_providers,
            refresh_provider,
            get_environment_diagnostics,
            get_provider_settings,
            save_provider_settings,
            clear_provider_settings,
            set_active_custom_provider_entry,
            save_desktop_widget_settings
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
