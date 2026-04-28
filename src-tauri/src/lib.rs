mod environment;
mod error;
mod locale;
mod models;
mod providers;

use locale::AppLocale;
use providers::{get_provider, registry};

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            get_registered_providers,
            refresh_provider,
            get_environment_diagnostics
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
