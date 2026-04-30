pub mod api_platform;
pub mod custom_provider;
pub mod codex;
pub mod github_copilot;
pub mod openrouter;

use crate::error::AppError;
use crate::locale::AppLocale;
use crate::models::{ProviderDescriptor, ProviderSnapshot};
use custom_provider::CustomProvider;
use codex::CodexProvider;
use github_copilot::GitHubCopilotProvider;
use openrouter::OpenRouterProvider;

pub trait ProviderAdapter {
    fn descriptor(&self, locale: AppLocale) -> ProviderDescriptor;
    fn refresh(&self, locale: AppLocale) -> Result<ProviderSnapshot, AppError>;
}

pub fn registry() -> Vec<Box<dyn ProviderAdapter>> {
    vec![
        Box::new(CodexProvider::new()),
        Box::new(GitHubCopilotProvider::new()),
        Box::new(OpenRouterProvider::new()),
        Box::new(CustomProvider::new()),
    ]
}

pub fn get_provider(provider_id: &str) -> Option<Box<dyn ProviderAdapter>> {
    registry()
        .into_iter()
        .find(|provider| provider.descriptor(AppLocale::En).id == provider_id)
}

pub fn capability(kind: &str, available: bool) -> crate::models::ProviderCapability {
    crate::models::ProviderCapability {
        kind: kind.to_string(),
        available,
    }
}
