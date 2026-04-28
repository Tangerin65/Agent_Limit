#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub enum AppLocale {
    En,
    ZhCn,
}

impl AppLocale {
    pub fn from_input(value: &str) -> Self {
        if value.to_ascii_lowercase().starts_with("zh") {
            Self::ZhCn
        } else {
            Self::En
        }
    }

    pub fn text<'a>(&self, en: &'a str, zh_cn: &'a str) -> String {
        match self {
            Self::En => en.to_string(),
            Self::ZhCn => zh_cn.to_string(),
        }
    }
}
