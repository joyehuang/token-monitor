const PERIOD_LABELS = Object.freeze({
  today: 'Today',
  week: 'This week',
  month: 'This month',
  allTime: 'All time'
});

const PERIOD_PILLS = Object.freeze({
  today: 'TODAY',
  week: '7 DAYS',
  month: 'MONTH',
  allTime: 'ALL TIME'
});

const THEMES = Object.freeze({
  dark: {
    background: '#0b0b10',
    surface: '#14141c',
    border: '#2a2a34',
    heading: '#fafafa',
    label: '#a5a6ad',
    faint: '#65666f',
    accent: '#b4ebfd',
    accentMuted: '#30434c'
  },
  light: {
    background: '#fcfcfd',
    surface: '#f2f4f6',
    border: '#d9dde3',
    heading: '#08080a',
    label: '#45454a',
    faint: '#8b8c92',
    accent: '#517e94',
    accentMuted: '#dce8ed'
  }
});

function finiteNonNegative(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function formatTokens(value) {
  return Math.round(finiteNonNegative(value)).toLocaleString('en-US');
}

function formatCompactTokens(value) {
  const number = finiteNonNegative(value);
  const units = [
    { threshold: 1e12, suffix: 'T' },
    { threshold: 1e9, suffix: 'B' },
    { threshold: 1e6, suffix: 'M' },
    { threshold: 1e3, suffix: 'K' }
  ];
  const unit = units.find(({ threshold }) => number >= threshold);
  if (!unit) return String(Math.round(number));
  const scaled = number / unit.threshold;
  const digits = scaled >= 100 ? 0 : scaled >= 10 ? 1 : 2;
  const compact = scaled.toFixed(digits).replace(/\.0+$|(?<=\.[0-9])0+$/, '');
  return `${compact}${unit.suffix}`;
}

function latestUpdate(stats) {
  let latest = 0;
  for (const device of Array.isArray(stats?.devices) ? stats.devices : []) {
    const timestamp = Date.parse(device?.updatedAt || device?.receivedAt || '');
    if (Number.isFinite(timestamp)) latest = Math.max(latest, timestamp);
  }
  const aggregateTimestamp = Date.parse(stats?.updatedAt || '');
  if (!latest && Number.isFinite(aggregateTimestamp)) latest = aggregateTimestamp;
  return latest ? new Date(latest).toISOString().slice(0, 16).replace('T', ' · ') + ' UTC' : 'WAITING FOR DATA';
}

function parseBadgeOptions(url) {
  const period = String(url.searchParams.get('period') || 'today');
  const theme = String(url.searchParams.get('theme') || 'dark');
  if (!Object.hasOwn(PERIOD_LABELS, period)) {
    return { error: `Invalid period: ${period}` };
  }
  if (!Object.hasOwn(THEMES, theme)) {
    return { error: `Invalid theme: ${theme}` };
  }
  return { period, theme };
}

function renderUsageBadge(stats, { period = 'today', theme = 'dark' } = {}) {
  const colors = THEMES[theme] || THEMES.dark;
  const label = PERIOD_LABELS[period] || PERIOD_LABELS.today;
  const pill = PERIOD_PILLS[period] || PERIOD_PILLS.today;
  const rawTokens = stats?.periods?.[period]?.totalTokens;
  const totalTokens = formatTokens(rawTokens);
  const compactTokens = formatCompactTokens(rawTokens);
  const updatedAt = latestUpdate(stats);
  const title = `Token Monitor - ${label}: ${totalTokens} tokens`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="520" height="124" viewBox="0 0 520 124" role="img" aria-label="${title}">
  <title>${title}</title>
  <defs>
    <linearGradient id="card" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${colors.surface}"/>
      <stop offset="0.52" stop-color="${colors.background}"/>
      <stop offset="1" stop-color="${colors.background}"/>
    </linearGradient>
    <radialGradient id="glow" cx="0" cy="0" r="1" gradientTransform="translate(474 8) rotate(137) scale(180 104)">
      <stop offset="0" stop-color="${colors.accent}" stop-opacity="0.15"/>
      <stop offset="1" stop-color="${colors.accent}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect x="0.5" y="0.5" width="519" height="123" rx="16" fill="url(#card)" stroke="${colors.border}"/>
  <rect x="1" y="1" width="518" height="122" rx="15.5" fill="url(#glow)"/>

  <rect x="20" y="20" width="32" height="32" rx="9" fill="${colors.accentMuted}"/>
  <rect x="28" y="35" width="3.5" height="9" rx="1.75" fill="${colors.accent}" opacity="0.55"/>
  <rect x="34.25" y="29" width="3.5" height="15" rx="1.75" fill="${colors.accent}" opacity="0.78"/>
  <rect x="40.5" y="24" width="3.5" height="20" rx="1.75" fill="${colors.accent}"/>
  <text x="64" y="34" fill="${colors.heading}" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif" font-size="15" font-weight="650">Token Monitor</text>
  <text x="64" y="50" fill="${colors.label}" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif" font-size="10.5" letter-spacing="0.15">AI coding usage</text>

  <circle cx="25" cy="94" r="3" fill="${colors.accent}"/>
  <text x="35" y="97.5" fill="${colors.label}" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif" font-size="9.5" letter-spacing="0.65">SYNCED</text>
  <text x="81" y="97.5" fill="${colors.faint}" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif" font-size="9.5">${updatedAt}</text>

  <line x1="216.5" y1="20" x2="216.5" y2="104" stroke="${colors.border}"/>
  <text x="240" y="34" fill="${colors.label}" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif" font-size="10" font-weight="600" letter-spacing="1.25">${label.toUpperCase()}</text>
  <rect x="442" y="20" width="58" height="22" rx="11" fill="${colors.accentMuted}"/>
  <text x="471" y="34.5" text-anchor="middle" fill="${colors.accent}" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif" font-size="8.5" font-weight="700" letter-spacing="0.8">${pill}</text>
  <text x="238" y="78" fill="${colors.heading}" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif" font-size="34" font-weight="720" letter-spacing="-0.8">${compactTokens}</text>
  <text x="240" y="98" fill="${colors.faint}" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif" font-size="10.5">${totalTokens} tokens</text>
</svg>`;
}

function renderErrorBadge(message = 'Badge unavailable') {
  const safeMessage = String(message).replace(/[<>&"']/g, '');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="520" height="72" viewBox="0 0 520 72" role="img" aria-label="Token Monitor badge unavailable">
  <rect x="0.5" y="0.5" width="519" height="71" rx="14" fill="#0b0b10" stroke="#493039"/>
  <circle cx="24" cy="25" r="4" fill="#fda4af"/>
  <text x="38" y="30" fill="#fafafa" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif" font-size="15" font-weight="650">Token Monitor</text>
  <text x="20" y="53" fill="#d6a7ae" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif" font-size="11">${safeMessage}</text>
</svg>`;
}

export { parseBadgeOptions, renderErrorBadge, renderUsageBadge };
