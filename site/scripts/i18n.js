/* i18n.js: translations + language resolution. No auto-run; main.js drives it. */
var supportedLanguages = ["en", "zh-TW", "zh-CN"];
var languageStorageKey = "token-monitor-site-language";

var translations = {
  en: {
    "meta.title": "Token Monitor: AI Tools usage at a glance",
    "meta.description": "Token Monitor is a local-first desktop widget for real-time token, cost, limit, and session monitoring across AI Tools.",
    "meta.ogTitle": "Token Monitor",
    "meta.ogDescription": "Local-first token, cost, limit, and session monitoring for AI Tools.",
    "nav.skip": "Skip to content",
    "nav.primary": "Primary",
    "nav.home": "Token Monitor home",
    "nav.language": "Language",
    "nav.theme": "Toggle light or dark theme",
    "nav.github": "GitHub",
    "nav.sections": "Section navigation",
    "nav.features": "Features",
    "nav.privacy": "Privacy",
    "nav.download": "Download",

    "hero.eyebrow": "Local-first AI coding telemetry",
    "hero.title": "AI Tools usage at a glance",
    "hero.lede": "A local-first desktop widget for real-time token, cost, limit, and session monitoring across AI Tools.",
    "hero.actions": "Primary actions",
    "hero.platforms": "Supported platforms",
    "cta.download": "Download latest release",
    "cta.github": "View on GitHub",

    "tools.eyebrow": "Tracks every tool in your loop",

    "feature.title": "Tokens, limits, and session detail in one view.",
    "feature.live.title": "Live token tracking & cost",
    "feature.live.body": "Watch Claude Code, Codex, Hermes, OpenCode, OpenClaw, Cursor, and Antigravity update within seconds of each turn, with cost alongside every count.",
    "feature.limits.title": "AI Tool Limits before you hit the wall",
    "feature.limits.body": "See Claude Code, Codex, Cursor, Antigravity, and OpenCode session, weekly, billing, and credits windows, so a limit never surprises you mid-task.",
    "feature.session.title": "Per-session detail on demand",
    "feature.session.body": "Open a Claude Code, Codex, or OpenCode session to see tokens per prompt and per reply, read on-demand from local transcripts or databases. Never synced.",
    "mock.you": "YOU",
    "mock.newest": "↕ Newest",
    "mock.session.one": "Compare model spend...",
    "mock.session.two": "Inspect reply details...",

    "surfaces.title": "The same usage, on every surface you already use.",
    "surfaces.menubar.title": "Menu bar & tray",
    "surfaces.menubar.body": "Live cost, tokens, or your closest limit % right next to the clock on macOS and Windows.",
    "surfaces.bubble.title": "Floating Bubble",
    "surfaces.bubble.body": "Collapse the widget into a draggable mini-window with click or hover preview.",
    "surfaces.discord.playing": "Playing",
    "surfaces.discord.title": "Discord Rich Presence",
    "surfaces.discord.body": "Broadcast today's tokens, cost, and top tool to your profile. Opt-in.",
    "surfaces.ios.title": "iOS widget",
    "surfaces.ios.body": "Today's totals on your Home Screen via the Worker hub, with Widgy or Scriptable.",

    "how.title": "Start with one widget. Add a hub for multi-device sync.",
    "how.lede": "Local stays the default path. Add self-hosted sync when you want token usage from multiple devices rolled into one view.",
    "how.local.badge": "Default path",
    "how.local.title": "Local mode",
    "how.local.body": "The widget reads local usage summaries through tokscale and renders them on the same machine. No account, no cloud.",
    "how.sync.badge": "Add only when needed",
    "how.sync.title": "Sync mode",
    "how.sync.body": "Each widget or headless agent posts that device's usage summary to your hub, which merges totals and streams them back to every connected widget.",
    "how.node.widget": "Widget",
    "how.node.sameMachine": "Same machine",
    "how.node.tokscale": "tokscale",
    "how.node.localLogs": "Local AI logs",
    "how.node.mac": "Mac widget",
    "how.node.windows": "Windows widget",
    "how.node.agent": "Headless agent",
    "how.node.hub": "Self-hosted hub",
    "how.node.summaryStream": "Summary stream",
    "how.backends": "Self-host the sync backend three ways: the in-widget hub, the Node CLI hub, or a Cloudflare Worker (which also powers the iOS widget).",
    "how.backend.widget": "In-widget hub",
    "how.backend.node": "Node CLI hub",
    "how.backend.worker": "Cloudflare Worker",

    "privacy.title": "Your code and conversations are not the product.",
    "privacy.body": "Token Monitor syncs only the fields needed to show totals, costs, tool and model breakdowns, and normalized account limit status.",
    "privacy.syncs": "Can sync",
    "privacy.syncs.1": "Device, hostname, and platform labels",
    "privacy.syncs.2": "Today, month, and all-time totals",
    "privacy.syncs.3": "Cost, client, model, and limit summaries",
    "privacy.never": "Never syncs",
    "privacy.never.1": "Raw prompts or source files",
    "privacy.never.2": "Conversation transcripts",
    "privacy.never.3": "OAuth credentials or provider responses",

    "final.title": "Download the packaged app and keep every coding tool visible.",
    "final.readme": "Read the setup guide",
    "final.downloads": "Release download options",
    "final.mac.title": "macOS .dmg",
    "final.mac.body": "Apple Silicon, M1 and later",
    "final.win.title": "Windows Setup .exe",
    "final.win.body": "Installer build, recommended",
    "final.source": "Intel Mac, Linux, and source installs are covered in the README for advanced setups.",

    "footer.api": "API docs",
    "footer.worker": "Worker docs",
    "footer.license": "License"
  },

  "zh-TW": {
    "meta.title": "Token Monitor：AI Tools 用量一眼看清",
    "meta.description": "Token Monitor 是為 AI Tools 打造的本地優先桌面 widget，可即時監控 token、成本與限額，查看 session 明細，並透過自架 hub 同步多台裝置。",
    "meta.ogTitle": "Token Monitor",
    "meta.ogDescription": "為 AI Tools 打造的本地優先 token、成本、限額與 session 監控。",
    "nav.skip": "跳到內容",
    "nav.primary": "主要導覽",
    "nav.home": "Token Monitor 首頁",
    "nav.language": "語言",
    "nav.theme": "切換淺色或深色主題",
    "nav.github": "GitHub",
    "nav.sections": "區塊導覽",
    "nav.features": "功能",
    "nav.privacy": "隱私",
    "nav.download": "下載",

    "hero.eyebrow": "本地優先的 AI coding telemetry",
    "hero.title": "AI Tools 用量一眼看清",
    "hero.lede": "為 AI Tools 打造的桌面 widget，即時監控 token、成本、限額與 session 明細。",
    "hero.actions": "主要操作",
    "hero.platforms": "支援平台",
    "cta.download": "下載最新版本",
    "cta.github": "查看 GitHub",

    "tools.eyebrow": "涵蓋你工作流裡的每個工具",

    "feature.title": "Token、限制與 session 明細，集中在一個畫面。",
    "feature.live.title": "即時 token 追蹤與成本",
    "feature.live.body": "Claude Code、Codex、Hermes、OpenCode、OpenClaw、Cursor、Antigravity 每輪對話後數秒內更新，每個數字旁都有成本。",
    "feature.limits.title": "在撞牆前看見 AI Tool Limits",
    "feature.limits.body": "看見 Claude Code、Codex、Cursor、Antigravity、OpenCode 的 session、每週、帳單與 credits 視窗，限制不再在工作中途突襲你。",
    "feature.session.title": "需要時才看 session 明細",
    "feature.session.body": "打開 Claude Code、Codex 或 OpenCode session，看每個 prompt 與 reply 的 token；從本機 transcript 或資料庫即時讀取，永不同步。",
    "mock.you": "你",
    "mock.newest": "↕ 最新",
    "mock.session.one": "比較模型成本...",
    "mock.session.two": "查看 reply 明細...",

    "surfaces.title": "同一份用量，出現在你本來就在用的每個介面。",
    "surfaces.menubar.title": "menu bar 與工作列",
    "surfaces.menubar.body": "macOS 與 Windows 時鐘旁就有即時成本、tokens 或最接近的限制 %。",
    "surfaces.bubble.title": "Floating Bubble",
    "surfaces.bubble.body": "把 widget 收成可拖曳的迷你視窗，支援點擊或 hover 預覽。",
    "surfaces.discord.playing": "正在遊玩",
    "surfaces.discord.title": "Discord Rich Presence",
    "surfaces.discord.body": "把今日 tokens、成本與最常用工具廣播到你的個人檔案，可選開啟。",
    "surfaces.ios.title": "iOS 小工具",
    "surfaces.ios.body": "透過 Worker hub，用 Widgy 或 Scriptable 把今日總量放到主畫面。",

    "how.title": "先用一個 widget。要同步多台裝置時才加 hub。",
    "how.lede": "本地仍是預設路徑。想彙整多台裝置的 Token 用量時，再加一層自架同步。",
    "how.local.badge": "預設路徑",
    "how.local.title": "本地模式",
    "how.local.body": "Widget 透過 tokscale 讀取本機用量摘要，並在同一台機器上顯示。不需要帳號、不需要雲端。",
    "how.sync.badge": "需要時才加",
    "how.sync.title": "同步模式",
    "how.sync.body": "每個 widget 或 headless agent 會把該裝置的用量摘要送到你的 hub，hub 彙整後再串流回所有已連線 widget。",
    "how.node.widget": "Widget",
    "how.node.sameMachine": "同一台機器",
    "how.node.tokscale": "tokscale",
    "how.node.localLogs": "本機 AI logs",
    "how.node.mac": "Mac widget",
    "how.node.windows": "Windows widget",
    "how.node.agent": "Headless agent",
    "how.node.hub": "自架 hub",
    "how.node.summaryStream": "摘要串流",
    "how.backends": "三種方式自架同步後端：widget 內建 hub、Node CLI hub，或 Cloudflare Worker（同時驅動 iOS 小工具）。",
    "how.backend.widget": "widget 內建 hub",
    "how.backend.node": "Node CLI hub",
    "how.backend.worker": "Cloudflare Worker",

    "privacy.title": "你的程式碼與對話不是產品。",
    "privacy.body": "Token Monitor 只同步顯示總量、成本、工具與模型拆分，以及標準化帳戶限制所需的欄位。",
    "privacy.syncs": "可以同步",
    "privacy.syncs.1": "裝置、hostname 與平台標籤",
    "privacy.syncs.2": "今日、本月與累計總量",
    "privacy.syncs.3": "成本、工具、模型與限制摘要",
    "privacy.never": "永不同步",
    "privacy.never.1": "原始提示詞或原始碼",
    "privacy.never.2": "對話 transcript",
    "privacy.never.3": "OAuth 憑證或 provider 回應",

    "final.title": "下載打包好的 App，讓每個 coding 工具的用量都看得見。",
    "final.readme": "閱讀設定指南",
    "final.downloads": "Release 下載選項",
    "final.mac.title": "macOS .dmg",
    "final.mac.body": "Apple Silicon，M1 或更新機型",
    "final.win.title": "Windows Setup .exe",
    "final.win.body": "建議使用安裝版",
    "final.source": "Intel Mac、Linux 與原始碼啟動方式請看 README，適合進階設定。",

    "footer.api": "API 文件",
    "footer.worker": "Worker 文件",
    "footer.license": "授權"
  },

  "zh-CN": {
    "meta.title": "Token Monitor：AI Tools 用量一眼看清",
    "meta.description": "Token Monitor 是为 AI Tools 打造的本地优先桌面组件，可实时监控 token、成本与限额，查看 session 明细，并通过自托管 hub 同步多台设备。",
    "meta.ogTitle": "Token Monitor",
    "meta.ogDescription": "为 AI Tools 打造的本地优先 token、成本、限额与 session 监控。",
    "nav.skip": "跳到内容",
    "nav.primary": "主要导航",
    "nav.home": "Token Monitor 首页",
    "nav.language": "语言",
    "nav.theme": "切换浅色或深色主题",
    "nav.github": "GitHub",
    "nav.sections": "区块导航",
    "nav.features": "功能",
    "nav.privacy": "隐私",
    "nav.download": "下载",

    "hero.eyebrow": "本地优先的 AI coding telemetry",
    "hero.title": "AI Tools 用量一眼看清",
    "hero.lede": "为 AI Tools 打造的桌面组件，实时监控 token、成本、限额与 session 明细。",
    "hero.actions": "主要操作",
    "hero.platforms": "支持平台",
    "cta.download": "下载最新版本",
    "cta.github": "查看 GitHub",

    "tools.eyebrow": "覆盖你工作流里的每个工具",

    "feature.title": "Token、限制与 session 明细，集中在一个界面。",
    "feature.live.title": "实时 token 追踪与成本",
    "feature.live.body": "Claude Code、Codex、Hermes、OpenCode、OpenClaw、Cursor、Antigravity 每轮对话后数秒内更新，每个数字旁都有成本。",
    "feature.limits.title": "在撞墙前看见 AI Tool Limits",
    "feature.limits.body": "看见 Claude Code、Codex、Cursor、Antigravity、OpenCode 的 session、每周、账单与 credits 窗口，限制不再在工作中途突袭你。",
    "feature.session.title": "需要时才看 session 明细",
    "feature.session.body": "打开 Claude Code、Codex 或 OpenCode session，看每个 prompt 与 reply 的 token；从本机 transcript 或数据库实时读取，永不同步。",
    "mock.you": "你",
    "mock.newest": "↕ 最新",
    "mock.session.one": "比较模型成本...",
    "mock.session.two": "查看 reply 明细...",

    "surfaces.title": "同一份用量，出现在你本来就在用的每个界面。",
    "surfaces.menubar.title": "menu bar 与任务栏",
    "surfaces.menubar.body": "macOS 与 Windows 时钟旁就有实时成本、tokens 或最接近的限制 %。",
    "surfaces.bubble.title": "Floating Bubble",
    "surfaces.bubble.body": "把 widget 收成可拖拽的迷你窗口，支持点击或 hover 预览。",
    "surfaces.discord.playing": "正在玩",
    "surfaces.discord.title": "Discord Rich Presence",
    "surfaces.discord.body": "把今日 tokens、成本与最常用工具广播到你的个人资料，可选开启。",
    "surfaces.ios.title": "iOS 小组件",
    "surfaces.ios.body": "通过 Worker hub，用 Widgy 或 Scriptable 把今日总量放到主屏幕。",

    "how.title": "先用一个 widget。要同步多台设备时才加 hub。",
    "how.lede": "本地仍是默认路径。想汇总多台设备的 Token 用量时，再加一层自托管同步。",
    "how.local.badge": "默认路径",
    "how.local.title": "本地模式",
    "how.local.body": "Widget 通过 tokscale 读取本机用量摘要，并在同一台机器上显示。不需要账号、不需要云端。",
    "how.sync.badge": "需要时才加",
    "how.sync.title": "同步模式",
    "how.sync.body": "每个 widget 或 headless agent 会把该设备的用量摘要送到你的 hub，hub 汇总后再流式推送回所有已连接 widget。",
    "how.node.widget": "Widget",
    "how.node.sameMachine": "同一台机器",
    "how.node.tokscale": "tokscale",
    "how.node.localLogs": "本机 AI logs",
    "how.node.mac": "Mac widget",
    "how.node.windows": "Windows widget",
    "how.node.agent": "Headless agent",
    "how.node.hub": "自托管 hub",
    "how.node.summaryStream": "摘要流",
    "how.backends": "三种方式自托管同步后端：widget 内置 hub、Node CLI hub，或 Cloudflare Worker（同时驱动 iOS 小组件）。",
    "how.backend.widget": "widget 内置 hub",
    "how.backend.node": "Node CLI hub",
    "how.backend.worker": "Cloudflare Worker",

    "privacy.title": "你的代码与对话不是产品。",
    "privacy.body": "Token Monitor 只同步显示总量、成本、工具与模型拆分，以及标准化账号限制所需的字段。",
    "privacy.syncs": "可以同步",
    "privacy.syncs.1": "设备、hostname 与平台标签",
    "privacy.syncs.2": "今日、本月与累计总量",
    "privacy.syncs.3": "成本、工具、模型与限制摘要",
    "privacy.never": "永不同步",
    "privacy.never.1": "原始提示词或源码",
    "privacy.never.2": "对话 transcript",
    "privacy.never.3": "OAuth 凭证或 provider 响应",

    "final.title": "下载打包好的 App，让每个 coding 工具的用量都看得见。",
    "final.readme": "阅读设置指南",
    "final.downloads": "Release 下载选项",
    "final.mac.title": "macOS .dmg",
    "final.mac.body": "Apple Silicon，M1 或更新机型",
    "final.win.title": "Windows Setup .exe",
    "final.win.body": "建议使用安装版",
    "final.source": "Intel Mac、Linux 与源码启动方式请看 README，适合进阶设置。",

    "footer.api": "API 文档",
    "footer.worker": "Worker 文档",
    "footer.license": "许可证"
  }
};

function normalizeLanguage(value) {
  if (!value) return "";
  var normalized = value.replace("_", "-");
  if (supportedLanguages.indexOf(normalized) !== -1) return normalized;
  var lower = normalized.toLowerCase();
  if (lower === "zh" || lower.indexOf("zh-hant") === 0 || lower === "zh-tw" || lower === "zh-hk" || lower === "zh-mo") return "zh-TW";
  if (lower.indexOf("zh-hans") === 0 || lower === "zh-cn" || lower === "zh-sg") return "zh-CN";
  if (lower.indexOf("en") === 0) return "en";
  return "";
}
function readStoredLanguage() { try { return normalizeLanguage(window.localStorage.getItem(languageStorageKey)); } catch (e) { return ""; } }
function storeLanguage(language) { try { window.localStorage.setItem(languageStorageKey, language); } catch (e) {} }
function languageFromHash() { return normalizeLanguage(window.location.hash.slice(1)); }
function preferredLanguage() { return languageFromHash() || readStoredLanguage() || normalizeLanguage(window.navigator.language) || "en"; }

function translateElement(element, messages) {
  var key = element.getAttribute("data-i18n");
  if (key && messages[key]) element.textContent = messages[key];
  var attrConfig = element.getAttribute("data-i18n-attr");
  if (!attrConfig) return;
  var pairs = attrConfig.split(",");
  for (var i = 0; i < pairs.length; i++) {
    var parts = pairs[i].split(":");
    var attr = (parts[0] || "").trim(), attrKey = (parts[1] || "").trim();
    if (attr && attrKey && messages[attrKey]) element.setAttribute(attr, messages[attrKey]);
  }
}
function applyLanguage(language) {
  var active = supportedLanguages.indexOf(language) !== -1 ? language : "en";
  var messages = translations[active];
  document.documentElement.lang = active;
  document.title = messages["meta.title"];
  var nodes = document.querySelectorAll("[data-i18n], [data-i18n-attr]");
  for (var i = 0; i < nodes.length; i++) translateElement(nodes[i], messages);
  var langBtns = document.querySelectorAll("[data-lang]");
  for (var j = 0; j < langBtns.length; j++) langBtns[j].setAttribute("aria-pressed", String(langBtns[j].getAttribute("data-lang") === active));
  storeLanguage(active);
  if (window.location.hash !== "#" + active) window.history.replaceState(null, "", "#" + active);
}
function setupLanguageButtons() {
  var btns = document.querySelectorAll("[data-lang]");
  for (var i = 0; i < btns.length; i++) {
    (function (b) { b.addEventListener("click", function () { applyLanguage(b.getAttribute("data-lang")); }); })(btns[i]);
  }
  window.addEventListener("hashchange", function () { applyLanguage(preferredLanguage()); });
}
