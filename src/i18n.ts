export type AppLocale = "en" | "zh-CN";

export const LOCALE_STORAGE_KEY = "agent-limit.locale";

export function detectSystemLocale(): AppLocale {
  if (typeof navigator === "undefined") {
    return "en";
  }

  const language = navigator.language.toLowerCase();
  return language.startsWith("zh") ? "zh-CN" : "en";
}

export function readStoredLocale(): AppLocale | null {
  if (typeof localStorage === "undefined") {
    return null;
  }

  const value = localStorage.getItem(LOCALE_STORAGE_KEY);
  return value === "en" || value === "zh-CN" ? value : null;
}

export function writeStoredLocale(locale: AppLocale) {
  if (typeof localStorage === "undefined") {
    return;
  }

  localStorage.setItem(LOCALE_STORAGE_KEY, locale);
}

type TranslationSet = {
  subtitle: string;
  providerSwitcher: string;
  language: string;
  languageShort: string;
  languageSystem: string;
  refresh: string;
  refreshing: string;
  details: string;
  back: string;
  loadingRegistry: string;
  provider: string;
  account: string;
  plan: string;
  remaining: string;
  remainingPercent: string;
  remainingRequests: string;
  resetTime: string;
  due: string;
  providerDetails: string;
  environment: string;
  accountDetails: string;
  planDetails: string;
  quotaDetails: string;
  warnings: string;
  rawMetadata: string;
  noWarnings: string;
  noRawMetadata: string;
  noProviderMessage: string;
  yes: string;
  no: string;
  planned: string;
  detected: string;
  notDetected: string;
  unavailable: string;
  message: string;
  capabilities: string;
  lastUpdate: string;
  webview2Installed: string;
  webview2Version: string;
  registryPath: string;
  codexAuth: string;
  codexConfig: string;
  sessionFiles: string;
  authPath: string;
  sessionsRoot: string;
  copilotApps: string;
  copilotOAuth: string;
  copilotSessionFiles: string;
  copilotAppsPath: string;
  copilotSessionRoot: string;
  email: string;
  identifier: string;
  authMode: string;
  sourcePath: string;
  name: string;
  tier: string;
  cycle: string;
  renewal: string;
  source: string;
  status: string;
  used: string;
  total: string;
  countdown: string;
  confidence: string;
  note: string;
  percentRemaining: string;
  percentUsed: string;
  statusReady: string;
  statusDegraded: string;
  statusPlanned: string;
  statusUnavailable: string;
  statusUnknown: string;
  capabilityOn: string;
  capabilityOff: string;
  capabilityAccount: string;
  capabilityPlan: string;
  capabilityQuota: string;
  providerRefreshFailed: string;
  initFailed: string;
  requestsUnitSuffix: string;
  usedPrefix: string;
  hoursSuffix: string;
  minutesSuffix: string;
  secondsSuffix: string;
  daysSuffix: string;
  remainingInline: string;
  usageInline: string;
};

const TRANSLATIONS: Record<AppLocale, TranslationSet> = {
  "zh-CN": {
    subtitle: "本机 Agent 配额监视器",
    providerSwitcher: "Provider 切换",
    language: "语言",
    languageShort: "中 / EN",
    languageSystem: "跟随系统",
    refresh: "刷新",
    refreshing: "刷新中...",
    details: "详情",
    back: "返回",
    loadingRegistry: "正在加载本地 Provider 列表...",
    provider: "Provider",
    account: "账号",
    plan: "套餐",
    remaining: "剩余",
    remainingPercent: "剩余百分比",
    remainingRequests: "剩余调用次数",
    resetTime: "重置时间",
    due: "已到期",
    providerDetails: "Provider 详情",
    environment: "环境诊断",
    accountDetails: "账号详情",
    planDetails: "套餐详情",
    quotaDetails: "配额详情",
    warnings: "告警",
    rawMetadata: "原始元数据",
    noWarnings: "当前 Provider 没有告警。",
    noRawMetadata: "当前 Provider 没有原始元数据。",
    noProviderMessage: "当前 Provider 没有额外说明。",
    yes: "是",
    no: "否",
    planned: "计划中",
    detected: "已检测到",
    notDetected: "未检测到",
    unavailable: "--",
    message: "消息",
    capabilities: "能力",
    lastUpdate: "上次更新时间",
    webview2Installed: "WebView2 已安装",
    webview2Version: "WebView2 版本",
    registryPath: "注册表路径",
    codexAuth: "Codex 认证",
    codexConfig: "Codex 配置",
    sessionFiles: "会话文件数",
    authPath: "认证路径",
    sessionsRoot: "会话目录",
    copilotApps: "Copilot Apps",
    copilotOAuth: "Copilot OAuth",
    copilotSessionFiles: "Copilot 会话文件数",
    copilotAppsPath: "Copilot Apps 路径",
    copilotSessionRoot: "Copilot 会话目录",
    email: "邮箱",
    identifier: "标识",
    authMode: "认证方式",
    sourcePath: "来源路径",
    name: "名称",
    tier: "层级",
    cycle: "周期",
    renewal: "续期时间",
    source: "来源",
    status: "状态",
    used: "已用",
    total: "总量",
    countdown: "倒计时",
    confidence: "置信度",
    note: "备注",
    percentRemaining: "剩余百分比",
    percentUsed: "已用百分比",
    statusReady: "可用",
    statusDegraded: "降级",
    statusPlanned: "计划中",
    statusUnavailable: "不可用",
    statusUnknown: "未知",
    capabilityOn: "开启",
    capabilityOff: "关闭",
    capabilityAccount: "账号",
    capabilityPlan: "套餐",
    capabilityQuota: "配额",
    providerRefreshFailed: "刷新 Provider 失败。",
    initFailed: "初始化应用失败。",
    requestsUnitSuffix: "次",
    usedPrefix: "已用",
    hoursSuffix: "时",
    minutesSuffix: "分",
    secondsSuffix: "秒",
    daysSuffix: "天",
    remainingInline: "剩余 {value}",
    usageInline: "已用 {used} / {total}"
  },
  en: {
    subtitle: "Local Agent Quota Monitor",
    providerSwitcher: "Provider Switcher",
    language: "Language",
    languageShort: "EN / 中",
    languageSystem: "System Default",
    refresh: "Refresh",
    refreshing: "Refreshing...",
    details: "Details",
    back: "Back",
    loadingRegistry: "Loading local provider registry...",
    provider: "Provider",
    account: "Account",
    plan: "Plan",
    remaining: "Remaining",
    remainingPercent: "Remaining %",
    remainingRequests: "Remaining Requests",
    resetTime: "Reset Time",
    due: "Due",
    providerDetails: "Provider Details",
    environment: "Environment Diagnostics",
    accountDetails: "Account Details",
    planDetails: "Plan Details",
    quotaDetails: "Quota Details",
    warnings: "Warnings",
    rawMetadata: "Raw Metadata",
    noWarnings: "No warnings for the current provider.",
    noRawMetadata: "No raw metadata for the current provider.",
    noProviderMessage: "No extra message for the current provider.",
    yes: "Yes",
    no: "No",
    planned: "Planned",
    detected: "Detected",
    notDetected: "Not detected",
    unavailable: "--",
    message: "Message",
    capabilities: "Capabilities",
    lastUpdate: "Last Updated",
    webview2Installed: "WebView2 Installed",
    webview2Version: "WebView2 Version",
    registryPath: "Registry Path",
    codexAuth: "Codex Auth",
    codexConfig: "Codex Config",
    sessionFiles: "Session Files",
    authPath: "Auth Path",
    sessionsRoot: "Sessions Root",
    copilotApps: "Copilot Apps",
    copilotOAuth: "Copilot OAuth",
    copilotSessionFiles: "Copilot Session Files",
    copilotAppsPath: "Copilot Apps Path",
    copilotSessionRoot: "Copilot Session Root",
    email: "Email",
    identifier: "Identifier",
    authMode: "Auth Mode",
    sourcePath: "Source Path",
    name: "Name",
    tier: "Tier",
    cycle: "Cycle",
    renewal: "Renewal",
    source: "Source",
    status: "Status",
    used: "Used",
    total: "Total",
    countdown: "Countdown",
    confidence: "Confidence",
    note: "Note",
    percentRemaining: "Remaining %",
    percentUsed: "Used %",
    statusReady: "Ready",
    statusDegraded: "Degraded",
    statusPlanned: "Planned",
    statusUnavailable: "Unavailable",
    statusUnknown: "Unknown",
    capabilityOn: "On",
    capabilityOff: "Off",
    capabilityAccount: "Account",
    capabilityPlan: "Plan",
    capabilityQuota: "Quota",
    providerRefreshFailed: "Failed to refresh provider.",
    initFailed: "Failed to initialize the app.",
    requestsUnitSuffix: "requests",
    usedPrefix: "Used",
    hoursSuffix: "h",
    minutesSuffix: "m",
    secondsSuffix: "s",
    daysSuffix: "d",
    remainingInline: "{value} remaining",
    usageInline: "{used} used / {total}"
  }
};

export function getTranslation(locale: AppLocale) {
  return TRANSLATIONS[locale];
}

export function formatLocalizedDateTime(locale: AppLocale, value?: string | null) {
  const text = getTranslation(locale);
  if (!value) {
    return text.unavailable;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString(locale);
}

export function formatLocalizedPercent(locale: AppLocale, value?: number | null) {
  const text = getTranslation(locale);
  if (typeof value !== "number" || Number.isNaN(value)) {
    return text.unavailable;
  }

  return `${value.toFixed(1)}%`;
}

export function formatLocalizedQuotaValue(
  locale: AppLocale,
  value?: number | null,
  unit?: string | null
) {
  const text = getTranslation(locale);
  if (typeof value !== "number" || Number.isNaN(value)) {
    return text.unavailable;
  }

  if (unit === "%") {
    return `${value.toFixed(1)}%`;
  }

  if (unit === "requests") {
    return locale === "zh-CN"
      ? `${Math.round(value)} ${text.requestsUnitSuffix}`
      : `${Math.round(value)} ${text.requestsUnitSuffix}`;
  }

  return value.toFixed(1);
}

export function formatLocalizedQuotaMeta(
  locale: AppLocale,
  used?: number | null,
  total?: number | null,
  unit?: string | null
) {
  const text = getTranslation(locale);
  if (typeof used !== "number" || Number.isNaN(used)) {
    return text.unavailable;
  }

  if (unit === "%") {
    return locale === "zh-CN" ? `${text.usedPrefix} ${used.toFixed(1)}%` : `${text.usedPrefix} ${used.toFixed(1)}%`;
  }

  if (unit === "requests") {
    if (typeof total === "number" && !Number.isNaN(total)) {
      const usedText = formatLocalizedQuotaValue(locale, used, unit);
      const totalText = formatLocalizedQuotaValue(locale, total, unit);
      return text.usageInline
        .replace("{used}", usedText)
        .replace("{total}", totalText);
    }

    return locale === "zh-CN"
      ? `${text.usedPrefix} ${formatLocalizedQuotaValue(locale, used, unit)}`
      : `${text.usedPrefix} ${formatLocalizedQuotaValue(locale, used, unit)}`;
  }

  return locale === "zh-CN" ? `${text.usedPrefix} ${used.toFixed(1)}` : `${text.usedPrefix} ${used.toFixed(1)}`;
}

export function formatLocalizedCountdown(
  locale: AppLocale,
  value: string | null | undefined,
  now: number
) {
  const text = getTranslation(locale);
  if (!value) {
    return text.unavailable;
  }

  const target = new Date(value).getTime();
  if (Number.isNaN(target)) {
    return text.unavailable;
  }

  const diff = target - now;
  if (diff <= 0) {
    return text.due;
  }

  const totalSeconds = Math.floor(diff / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const pad = (input: number) => input.toString().padStart(2, "0");
  const parts: string[] = [];

  if (days > 0) {
    parts.push(
      locale === "zh-CN"
        ? `${days}${text.daysSuffix}`
        : `${days}${text.daysSuffix}`
    );
  }

  parts.push(`${pad(hours)}${text.hoursSuffix}`);
  parts.push(`${pad(minutes)}${text.minutesSuffix}`);
  parts.push(`${pad(seconds)}${text.secondsSuffix}`);

  return locale === "zh-CN" ? parts.join(" ") : parts.join(" ");
}

export function formatCapabilityLabel(locale: AppLocale, kind: string) {
  const text = getTranslation(locale);

  switch (kind) {
    case "account":
      return text.capabilityAccount;
    case "plan":
      return text.capabilityPlan;
    case "quota":
      return text.capabilityQuota;
    default:
      return kind;
  }
}
