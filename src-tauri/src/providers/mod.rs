pub mod codex;
pub mod github_copilot;

use crate::error::AppError;
use crate::locale::AppLocale;
use crate::models::{ProviderDescriptor, ProviderSnapshot};
use codex::CodexProvider;
use github_copilot::GitHubCopilotProvider;

pub trait ProviderAdapter {
    fn descriptor(&self, locale: AppLocale) -> ProviderDescriptor;
    fn refresh(&self, locale: AppLocale) -> Result<ProviderSnapshot, AppError>;
}

pub fn registry() -> Vec<Box<dyn ProviderAdapter>> {
    vec![
        Box::new(CodexProvider::new()),
        Box::new(GitHubCopilotProvider::new()),
        Box::new(PlannedProvider::new(
            "openrouter",
            "OpenRouter",
            "Adapter reserved for API key balance support.",
        )),
    ]
}

pub fn get_provider(provider_id: &str) -> Option<Box<dyn ProviderAdapter>> {
    registry()
        .into_iter()
        .find(|provider| provider.descriptor(AppLocale::En).id == provider_id)
}

struct PlannedProvider {
    id: String,
    name: String,
    message: String,
}

impl PlannedProvider {
    fn new(id: &str, name: &str, message: &str) -> Self {
        Self {
            id: id.to_string(),
            name: name.to_string(),
            message: message.to_string(),
        }
    }
}

impl ProviderAdapter for PlannedProvider {
    fn descriptor(&self, locale: AppLocale) -> ProviderDescriptor {
        ProviderDescriptor {
            id: self.id.clone(),
            name: self.name.clone(),
            status: "planned".to_string(),
            message: Some(match locale {
                AppLocale::En => self.message.clone(),
                AppLocale::ZhCn => "预留中的适配器入口，后续用于 API Key 余额支持。".to_string(),
            }),
            capabilities: vec![
                capability("account", false),
                capability("plan", false),
                capability("quota", false),
            ],
        }
    }

    fn refresh(&self, locale: AppLocale) -> Result<ProviderSnapshot, AppError> {
        Err(AppError::Message(match locale {
            AppLocale::En => format!("{} is not implemented yet.", self.name),
            AppLocale::ZhCn => format!("{} 目前尚未实现。", self.name),
        }))
    }
}

pub fn capability(kind: &str, available: bool) -> crate::models::ProviderCapability {
    crate::models::ProviderCapability {
        kind: kind.to_string(),
        available,
    }
}
