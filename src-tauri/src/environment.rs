use std::path::PathBuf;

use walkdir::WalkDir;

use crate::models::{
    CodexEnvironmentStatus, CopilotEnvironmentStatus, EnvironmentDiagnostics, WebView2Status,
};

const WEBVIEW2_CLIENT_ID: &str = "{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}";

pub fn inspect_environment() -> EnvironmentDiagnostics {
    let webview2 = inspect_webview2();
    let codex = inspect_codex();
    let copilot = inspect_copilot();

    let mut warnings = Vec::new();

    if !webview2.installed {
        warnings.push(
            "WebView2 Runtime was not detected. Install using the generated setup package before running the standalone exe."
                .to_string(),
        );
    }

    if !codex.auth_exists {
        warnings.push(
            "No Codex login was detected for this Windows account. Sign in with Codex first, then refresh."
                .to_string(),
        );
    } else if codex.session_file_count == 0 {
        warnings.push(
            "Codex login was found, but no local session history exists yet. Open Codex once to generate session data."
                .to_string(),
        );
    }

    if codex.auth_exists && !codex.config_exists {
        warnings.push(
            "Codex auth was found, but config.toml is missing. Some plan fields may stay partial."
                .to_string(),
        );
    }

    if !copilot.apps_exists && !copilot.oauth_exists {
        warnings.push(
            "No GitHub Copilot login was detected for this Windows account. Sign in to Copilot first, then refresh."
                .to_string(),
        );
    } else if copilot.session_file_count == 0 {
        warnings.push(
            "GitHub Copilot login was found, but no local session history exists yet. Open Copilot once to generate local session data."
                .to_string(),
        );
    }

    EnvironmentDiagnostics {
        webview2,
        codex,
        copilot,
        warnings,
    }
}

fn inspect_codex() -> CodexEnvironmentStatus {
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    let root = home.join(".codex");
    let auth_path = root.join("auth.json");
    let config_path = root.join("config.toml");
    let sessions_root = root.join("sessions");
    let session_file_count = if sessions_root.exists() {
        WalkDir::new(&sessions_root)
            .into_iter()
            .filter_map(Result::ok)
            .filter(|entry| entry.file_type().is_file())
            .filter(|entry| entry.path().extension().and_then(|ext| ext.to_str()) == Some("jsonl"))
            .count()
    } else {
        0
    };

    CodexEnvironmentStatus {
        root_path: root.display().to_string(),
        auth_path: auth_path.display().to_string(),
        config_path: config_path.display().to_string(),
        sessions_root: sessions_root.display().to_string(),
        auth_exists: auth_path.exists(),
        config_exists: config_path.exists(),
        sessions_exists: sessions_root.exists(),
        session_file_count,
    }
}

fn inspect_copilot() -> CopilotEnvironmentStatus {
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    let local_data = dirs::data_local_dir().unwrap_or_else(|| home.join("AppData").join("Local"));
    let data_dir = dirs::data_dir().unwrap_or_else(|| home.join("AppData").join("Roaming"));

    let root = local_data.join("github-copilot");
    let apps_path = root.join("apps.json");
    let oauth_path = root.join("oauth.json");
    let session_root = home.join(".copilot").join("session-state");
    let vscode_storage_root = data_dir
        .join("Code")
        .join("User")
        .join("globalStorage")
        .join("github.copilot-chat");

    let session_file_count = if session_root.exists() {
        WalkDir::new(&session_root)
            .into_iter()
            .filter_map(Result::ok)
            .filter(|entry| entry.file_type().is_file())
            .filter(|entry| entry.path().extension().and_then(|ext| ext.to_str()) == Some("jsonl"))
            .count()
    } else {
        0
    };

    CopilotEnvironmentStatus {
        root_path: root.display().to_string(),
        apps_path: apps_path.display().to_string(),
        oauth_path: oauth_path.display().to_string(),
        session_root: session_root.display().to_string(),
        vscode_storage_root: vscode_storage_root.display().to_string(),
        apps_exists: apps_path.exists(),
        oauth_exists: oauth_path.exists(),
        session_exists: session_root.exists(),
        vscode_storage_exists: vscode_storage_root.exists(),
        session_file_count,
    }
}

#[cfg(target_os = "windows")]
fn inspect_webview2() -> WebView2Status {
    use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};
    use winreg::RegKey;

    let local_machine_path = if cfg!(target_pointer_width = "64") {
        format!(
            "SOFTWARE\\WOW6432Node\\Microsoft\\EdgeUpdate\\Clients\\{WEBVIEW2_CLIENT_ID}"
        )
    } else {
        format!("SOFTWARE\\Microsoft\\EdgeUpdate\\Clients\\{WEBVIEW2_CLIENT_ID}")
    };
    let current_user_path = format!("Software\\Microsoft\\EdgeUpdate\\Clients\\{WEBVIEW2_CLIENT_ID}");

    let candidates = vec![
        ("HKCU", current_user_path),
        ("HKLM", local_machine_path),
    ];

    let mut checked_paths = Vec::new();

    for (root_name, path) in candidates {
        checked_paths.push(format!("{root_name}\\{path}"));

        let root = match root_name {
            "HKCU" => RegKey::predef(HKEY_CURRENT_USER),
            _ => RegKey::predef(HKEY_LOCAL_MACHINE),
        };

        if let Ok(key) = root.open_subkey(&path) {
            if let Ok(version) = key.get_value::<String, _>("pv") {
                let version = version.trim().to_string();
                if !version.is_empty() && version != "0.0.0.0" {
                    return WebView2Status {
                        installed: true,
                        version: Some(version),
                        registry_path: Some(format!("{root_name}\\{path}")),
                        checked_paths,
                    };
                }
            }
        }
    }

    WebView2Status {
        installed: false,
        version: None,
        registry_path: None,
        checked_paths,
    }
}

#[cfg(not(target_os = "windows"))]
fn inspect_webview2() -> WebView2Status {
    WebView2Status {
        installed: false,
        version: None,
        registry_path: None,
        checked_paths: Vec::new(),
    }
}
