'use strict';

// Appearance theme data: interface palette presets and vendor-colour helpers.
// Pure data + functions so it can be unit-tested under node:test and shared by
// the widget and dashboard renderers. No DOM / Node built-ins here.
(function exposeThemePresets(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.TokenMonitorThemePresets = api;
})(typeof window !== 'undefined' ? window : null, function createThemePresetsApi() {
  // The customisable interface colours, in display order. Each maps to a CSS
  // custom property on :root (see styles.css). `bg` drives the glass tint
  // (--glass-rgb, an "r, g, b" triplet); `text` also drives --number (the big
  // TOTAL figure) so it reads as plain text. The semantic status colours
  // (--blue/--orange/--purple/--yellow/--red) are intentionally NOT exposed:
  // they only surface in edge states (links, warnings, errors) and --purple is
  // unused entirely, so a picker for them would be a no-op for everyday use.
  const INTERFACE_COLOR_KEYS = ['accent', 'bg', 'text', 'muted'];
  const THEME_CODE_VERSION = 'TM1';

  const THEME_VAR_MAP = {
    accent: '--green',
    bg: '--glass-rgb',
    text: '--text',
    muted: '--muted'
  };

  // Built-in defaults — must mirror the :root values in styles.css. The local
  // fork follows joyehuang.me's dark palette by default.
  // bg #0b0b10 == rgb(11, 11, 16) (the --glass-rgb default).
  const DEFAULT_THEME = {
    accent: '#b4ebfd',
    bg: '#0b0b10',
    text: '#fafafa',
    muted: '#bcbcc2'
  };

  // Curated one-click themes. Each is a full palette — accent + background tint
  // + text + muted swap together, so picking one changes the whole mood, not
  // just the accent. These mirror joyehuang.me's dark/light site palettes.
  // The light preset relies on the overlay flip in themeCssVarEntries().
  const THEME_PRESETS = [
    { id: 'joyeDark', colors: { ...DEFAULT_THEME } },
    { id: 'joyeLight', colors: { accent: '#517e94', bg: '#fcfcfd', text: '#09090b', muted: '#45454a' } }
  ];

  // Surface RGBs used when the background is light, so overlays/borders read as
  // subtle dark-on-light, the settings/tooltip card becomes a white card, and
  // sunken inputs/tracks become light grey — instead of staying dark.
  const LIGHT_OVERLAY_RGB = '9, 9, 11';
  const LIGHT_LINE_RGB = '9, 9, 11';
  const LIGHT_PANEL_RGB = '255, 255, 255';
  const LIGHT_SUNKEN_RGB = '242, 242, 243';
  const LIGHT_INPUT_RGB = '228, 228, 231';
  const LIGHT_PRIMARY_RGB = '81, 126, 148';
  const LIGHT_SHADE_RGB = '255, 255, 255';
  const LIGHT_SHADOW = 'rgba(9, 9, 11, 0.06)';
  const LIGHT_BASE_ALPHA = '0.9';

  // Vendors shown in the vendor-colour list, tracked clients first. Vendors not
  // listed here but present in clientColors are appended after these, then the
  // synthetic "default" fallback is shown last.
  const VENDOR_ORDER = [
    'claude', 'codex', 'hermes', 'opencode', 'openclaw', 'cline', 'cursor',
    'gemini', 'antigravity', 'kimi', 'qwen', 'grok', 'copilot', 'pi', 'zed', 'kilocode', 'micode', 'zcode', 'kiro', 'codebuddy', 'workbuddy', 'deepseek', 'xai', 'meta', 'mistral',
    'moonshot', 'zai', 'cohere', 'xiaomi', 'minimax'
  ];

  // Display labels for every vendor in the clientColors map. The widget also
  // has its own clientLabels for tracked clients; this map is the complete set
  // so the appearance picker is self-contained.
  const VENDOR_LABELS = {
    claude: 'Claude Code',
    codex: 'Codex',
    hermes: 'Hermes',
    opencode: 'OpenCode',
    openclaw: 'OpenClaw',
    cline: 'Cline',
    cursor: 'Cursor',
    gemini: 'Gemini',
    antigravity: 'Antigravity',
    kimi: 'Kimi',
    grok: 'Grok Build',
    copilot: 'GitHub Copilot',
    pi: 'Pi',
    zed: 'Zed',
    kilocode: 'Kilo Code',
    micode: 'MiMo Code',
    zcode: 'ZCode',
    kiro: 'Kiro',
    codebuddy: 'CodeBuddy',
    workbuddy: 'WorkBuddy',
    deepseek: 'DeepSeek',
    xai: 'xAI',
    meta: 'Meta',
    mistral: 'Mistral',
    qwen: 'Qwen',
    moonshot: 'Moonshot',
    zai: 'Z.ai',
    cohere: 'Cohere',
    xiaomi: 'Xiaomi',
    minimax: 'MiniMax',
    default: 'Default'
  };

  const HEX_RE = /^#[0-9a-fA-F]{6}$/;

  function isValidHex(value) {
    return typeof value === 'string' && HEX_RE.test(value.trim());
  }

  function normalizeHex(value) {
    return isValidHex(value) ? value.trim().toLowerCase() : null;
  }

  // Keep only valid hex entries from a stored overrides object, restricted to a
  // set of allowed keys. Returns a fresh object — safe to store as-is.
  function normalizeOverrides(overrides, allowedKeys) {
    const allowed = allowedKeys ? new Set(allowedKeys) : null;
    const out = {};
    if (!overrides || typeof overrides !== 'object') return out;
    for (const [key, value] of Object.entries(overrides)) {
      if (allowed && !allowed.has(key)) continue;
      const hex = normalizeHex(value);
      if (hex) out[key] = hex;
    }
    return out;
  }

  // Resolve the full interface palette: defaults with valid overrides applied.
  function mergeThemeColors(overrides) {
    const clean = normalizeOverrides(overrides, INTERFACE_COLOR_KEYS);
    return { ...DEFAULT_THEME, ...clean };
  }

  // Portable, offline theme code. The fixed field order is part of the TM1
  // format, so future schemas can add fields under a new version without
  // silently changing how an older shared code is interpreted.
  function encodeThemeCode(overrides) {
    const colors = mergeThemeColors(overrides);
    const fields = INTERFACE_COLOR_KEYS.map((key) => colors[key].slice(1).toUpperCase());
    return `${THEME_CODE_VERSION}-${fields.join('-')}`;
  }

  function decodeThemeCode(value) {
    const code = typeof value === 'string' ? value.trim() : '';
    const version = /^TM(\d+)(?:-|$)/i.exec(code);
    if (version && version[1] !== '1') return { ok: false, reason: 'unsupportedVersion' };

    const match = /^TM1-([0-9a-f]{6})-([0-9a-f]{6})-([0-9a-f]{6})-([0-9a-f]{6})$/i.exec(code);
    if (!match) return { ok: false, reason: 'invalid' };

    const colors = Object.fromEntries(
      INTERFACE_COLOR_KEYS.map((key, index) => [key, `#${match[index + 1].toLowerCase()}`])
    );
    return { ok: true, colors, code: encodeThemeCode(colors) };
  }

  function hexToRgbTriplet(hex) {
    const v = String(hex).replace('#', '');
    return `${parseInt(v.slice(0, 2), 16)}, ${parseInt(v.slice(2, 4), 16)}, ${parseInt(v.slice(4, 6), 16)}`;
  }

  // Perceived brightness (0–1). Used to decide whether a background needs the
  // light-mode overlay flip — true for white/pale backgrounds.
  function isLightHex(hex) {
    if (!isValidHex(hex)) return false;
    const v = hex.replace('#', '');
    const r = parseInt(v.slice(0, 2), 16), g = parseInt(v.slice(2, 4), 16), b = parseInt(v.slice(4, 6), 16);
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6;
  }

  // The list of CSS custom properties to set for a given override set. A null
  // value means "remove the property" so it falls back to the stylesheet
  // default. Handles the two special cases: `bg` becomes an --glass-rgb triplet,
  // and `text` is mirrored onto --number (the big TOTAL figure). Both renderers
  // consume this so the mapping lives in exactly one place.
  function themeCssVarEntries(overrides) {
    const clean = normalizeOverrides(overrides, INTERFACE_COLOR_KEYS);
    const entries = [];
    const accentRgb = clean.accent ? hexToRgbTriplet(clean.accent) : null;
    for (const key of INTERFACE_COLOR_KEYS) {
      const value = clean[key] || null;
      if (key === 'bg') {
        entries.push({ name: '--glass-rgb', value: value ? hexToRgbTriplet(value) : null });
        continue;
      }
      entries.push({ name: THEME_VAR_MAP[key], value });
      if (key === 'text') entries.push({ name: '--number', value });
      // Accent also drives --accent-rgb so the tinted borders / glows / active
      // states flip with it, not just the accent text colour.
      if (key === 'accent') entries.push({ name: '--accent-rgb', value: accentRgb });
    }
    // Flip the overlay/border system + native control scheme when the resolved
    // background is light, so a white theme (or any light custom bg) doesn't
    // render with invisible borders and washed-out panels. Null falls back to
    // the dark :root defaults.
    const light = isLightHex(clean.bg);
    entries.push({ name: '--overlay-rgb', value: light ? LIGHT_OVERLAY_RGB : null });
    entries.push({ name: '--line-rgb', value: light ? LIGHT_LINE_RGB : null });
    entries.push({ name: '--line-alpha', value: light ? '0.12' : null });
    entries.push({ name: '--line-strong-alpha', value: light ? '0.2' : null });
    entries.push({ name: '--panel-rgb', value: light ? LIGHT_PANEL_RGB : null });
    entries.push({ name: '--sunken-rgb', value: light ? LIGHT_SUNKEN_RGB : null });
    entries.push({ name: '--input-rgb', value: light ? LIGHT_INPUT_RGB : null });
    // Primary controls and data visualisations should follow the chosen accent.
    // A light background without an explicit accent falls back to the site's
    // light primary so pale dark-theme cyan never disappears on white.
    const primaryRgb = accentRgb || (light ? LIGHT_PRIMARY_RGB : null);
    entries.push({ name: '--blue-rgb', value: primaryRgb });
    entries.push({ name: '--chart-rgb', value: primaryRgb });
    entries.push({ name: '--shade-rgb', value: light ? LIGHT_SHADE_RGB : null });
    entries.push({ name: '--shadow', value: light ? LIGHT_SHADOW : null });
    // Light mode on the website is an opaque page, while the widget's normal
    // glass layer is only 68% opaque. Add a bright base beneath that user-
    // controlled glass layer so a dark desktop cannot turn it grey.
    entries.push({ name: '--theme-base-alpha', value: light ? LIGHT_BASE_ALPHA : null });
    entries.push({ name: 'color-scheme', value: light ? 'light' : null });
    return entries;
  }

  // Resolve the effective vendor colours: brand defaults with valid overrides
  // applied. `brand` is the canonical clientColors map (incl. "default").
  function mergeVendorColors(brand, overrides) {
    const clean = normalizeOverrides(overrides, Object.keys(brand || {}));
    return { ...(brand || {}), ...clean };
  }

  // Ordered list of vendor ids to render in the picker, given the live brand
  // map. Known order first, then any extra brand keys, then "default" last.
  function orderedVendorIds(brand) {
    const keys = Object.keys(brand || {}).filter((k) => k !== 'default');
    const seen = new Set();
    const ordered = [];
    for (const id of VENDOR_ORDER) {
      if (keys.includes(id)) { ordered.push(id); seen.add(id); }
    }
    for (const id of keys) {
      if (!seen.has(id)) ordered.push(id);
    }
    if (Object.prototype.hasOwnProperty.call(brand || {}, 'default')) ordered.push('default');
    return ordered;
  }

  function vendorLabel(id) {
    return VENDOR_LABELS[id] || (id ? id.charAt(0).toUpperCase() + id.slice(1) : id);
  }

  return {
    INTERFACE_COLOR_KEYS,
    THEME_CODE_VERSION,
    THEME_VAR_MAP,
    DEFAULT_THEME,
    THEME_PRESETS,
    VENDOR_ORDER,
    VENDOR_LABELS,
    isValidHex,
    normalizeHex,
    normalizeOverrides,
    mergeThemeColors,
    encodeThemeCode,
    decodeThemeCode,
    hexToRgbTriplet,
    isLightHex,
    themeCssVarEntries,
    mergeVendorColors,
    orderedVendorIds,
    vendorLabel
  };
});
