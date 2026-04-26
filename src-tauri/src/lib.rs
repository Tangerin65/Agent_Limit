mod environment;
mod error;
mod models;
mod providers;

use providers::{get_provider, registry};

#[tauri::command]
fn get_registered_providers() -> Vec<models::ProviderDescriptor> {
    registry()
        .into_iter()
        .map(|provider| provider.descriptor())
        .collect()
}

#[tauri::command]
fn refresh_provider(provider_id: String) -> Result<models::ProviderSnapshot, String> {
    let provider = get_provider(&provider_id)
        .ok_or_else(|| format!("Unknown provider: {provider_id}"))?;

    provider.refresh().map_err(|error| error.to_string())
}

#[tauri::command]
fn get_environment_diagnostics() -> models::EnvironmentDiagnostics {
    environment::inspect_environment()
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
