const COLORS = {
  background: { light: '#EAF8F5', dark: '#101B1F' },
  panel: { light: '#FFFFFF', dark: '#1B252B' },
  title: { light: '#697080', dark: '#B8C0CC' },
  value: { light: '#121827', dark: '#F5F7FA' },
  muted: { light: '#737987', dark: '#9EA8B5' },
  blue: { light: '#2F6FCB', dark: '#83B7FF' },
  blueBg: { light: '#E4F0FF', dark: '#21344B' },
  amber: { light: '#D28A1A', dark: '#FFD37C' },
  amberBg: { light: '#FFF4CD', dark: '#4A3920' },
  green: { light: '#23A45D', dark: '#6EE7A0' },
  greenBg: { light: '#DDF8E7', dark: '#1D4430' },
  purple: { light: '#8D39D5', dark: '#D7A8FF' },
  purpleBg: { light: '#F1E3FA', dark: '#3E2D4C' },
  shadow: { light: '#9CB7B2', dark: '#000000' },
  progressBg: { light: '#E5E7EB', dark: '#334155' },
  warning: { light: '#B45309', dark: '#FBBF24' },
  danger: { light: '#B91C1C', dark: '#FCA5A5' },
};

const TOKEN_LABEL_TEXT_STYLE = {
  font: { size: 'headline', weight: 'semibold' },
  textColor: COLORS.title,
  maxLines: 1,
  minScale: 0.62,
};

const MUTED_SUBTITLE_TEXT_STYLE = {
  font: { size: 'subheadline', weight: 'regular' },
  textColor: COLORS.muted,
  maxLines: 2,
  minScale: 0.55,
};

const METRICS = [
  {
    label: '今日用量',
    key: 'day',
    formatter: formatPeriodValue,
    subtitle: formatPeriodSubtitle,
    icon: 'sf-symbol:sun.max',
    iconColor: COLORS.blue,
    iconBackground: COLORS.blueBg,
  },
  {
    label: '本周用量',
    key: 'week',
    formatter: formatPeriodValue,
    subtitle: formatPeriodSubtitle,
    icon: 'sf-symbol:calendar',
    iconColor: COLORS.amber,
    iconBackground: COLORS.amberBg,
  },
  {
    label: '月度用量',
    key: 'month',
    formatter: formatPeriodValue,
    subtitle: formatPeriodSubtitle,
    icon: 'sf-symbol:calendar.badge.clock',
    iconColor: COLORS.green,
    iconBackground: COLORS.greenBg,
    valueColor: COLORS.green,
  },
];

async function sub2apiUsageWidget(ctx) {
  try {
    const usage = await fetchQuotaUsage(ctx);
    return renderUsageWidget(ctx, usage);
  } catch (error) {
    return renderErrorWidget(error);
  }
}

async function fetchQuotaUsage(ctx) {
  const env = ctx?.env ?? {};
  const baseUrl = normalizeBaseUrl(env.BASE_URL);
  const email = trimString(env.EMAIL);
  const password = trimString(env.PASSWORD);
  const subscriptionIndex = parseSubscriptionIndex(env.SUBSCRIPTION_INDEX);

  if (!baseUrl || !email || !password) {
    throw new WidgetError('配置缺失', '请在模块 Env 中填写 BASE_URL、EMAIL、PASSWORD');
  }

  const loginResponse = await postJson(ctx, `${baseUrl}/api/v1/auth/login`, {
    email,
    password,
  }, '登录失败');
  const loginPayload = unwrapApiResponse(loginResponse, '登录失败');
  const accessToken = trimString(loginPayload.access_token);

  if (!accessToken) {
    if (loginPayload.requires_2fa) {
      throw new WidgetError('需要 2FA', '当前账号启用了双因素验证，小组件无法自动登录');
    }
    throw new WidgetError('登录失败', '登录响应缺少 access_token');
  }

  const activeResponse = await getJson(ctx, buildActiveSubscriptionsUrl(baseUrl), {
    Authorization: `Bearer ${accessToken}`,
  });
  const activePayload = unwrapApiResponse(activeResponse, '读取失败');
  const subscriptions = normalizeSubscriptions(activePayload);
  if (subscriptions.length === 0) {
    throw new WidgetError('无订阅', 'Sub2API 没有返回 active subscriptions');
  }

  const subscription = subscriptions[subscriptionIndex - 1];
  if (!subscription) {
    throw new WidgetError('订阅不存在', `未找到第 ${subscriptionIndex} 个 active subscription`);
  }

  return buildQuotaUsage(subscription, subscriptionIndex);
}

function normalizeSubscriptions(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.subscriptions)) return payload.subscriptions;
  return [];
}

function buildQuotaUsage(subscription, subscriptionIndex) {
  const group = subscription?.group && typeof subscription.group === 'object' ? subscription.group : {};

  return {
    subscriptionIndex,
    groupName: trimString(group.name),
    day: quotaPeriod(subscription?.daily_usage_usd, group.daily_limit_usd),
    week: quotaPeriod(subscription?.weekly_usage_usd, group.weekly_limit_usd),
    month: quotaPeriod(subscription?.monthly_usage_usd, group.monthly_limit_usd),
  };
}

function quotaPeriod(usedValue, limitValue) {
  const used = Math.max(0, toFiniteNumber(usedValue));
  const limit = Math.max(0, toFiniteNumber(limitValue));
  const usedPercent = limit > 0 ? Math.min(Math.max((used / limit) * 100, 0), 100) : 0;
  return {
    used,
    limit,
    usedPercent,
    remaining: limit > 0 ? Math.max(0, limit - used) : null,
  };
}

function parseSubscriptionIndex(value) {
  const index = Math.trunc(toFiniteNumber(value));
  return index > 0 ? index : 1;
}

function normalizeBaseUrl(value) {
  let url = trimString(value);
  if (!url) return '';

  url = url.replace(/\/+$/, '');
  url = url.replace(/\/admin\/usage$/i, '');
  url = url.replace(/\/api\/v1$/i, '');
  return url.replace(/\/+$/, '');
}

function buildActiveSubscriptionsUrl(baseUrl) {
  return `${normalizeBaseUrl(baseUrl)}/api/v1/subscriptions/active?timezone=Asia%2FShanghai`;
}

function formatNumber(value, options = {}) {
  const number = toFiniteNumber(value);
  if (options.compact === false) {
    return Math.round(number).toLocaleString('en-US');
  }

  const absolute = Math.abs(number);
  if (absolute >= 1_000_000_000) return `${trimTrailingZeros(number / 1_000_000_000, 2)}B`;
  if (absolute >= 1_000_000) return `${trimTrailingZeros(number / 1_000_000, 2)}M`;
  if (absolute >= 1_000) return `${trimTrailingZeros(number / 1_000, 2)}K`;
  return String(Math.round(number));
}

function formatCost(value) {
  const number = toFiniteNumber(value);
  if (number === 0) return '$0.00';
  if (Math.abs(number) < 1) return `$${trimTrailingZeros(number, 6)}`;
  return `$${trimTrailingZeros(number, 4)}`;
}

function formatPeriodValue(period) {
  if (!period) return '$0.00';
  if (period.limit > 0) return `${formatCost(period.used)} / ${formatCost(period.limit)}`;
  return `${formatCost(period.used)} / 不限额`;
}

function formatPeriodSubtitle(period) {
  if (!period) return '暂无用量';
  if (period.limit > 0) {
    return `已用 ${formatCost(period.used)} · 剩余 ${formatCost(period.remaining)}`;
  }
  return `已用 ${formatCost(period.used)} · 不限额`;
}

function formatPercent(value) {
  const number = toFiniteNumber(value);
  return `${trimTrailingZeros(number, number >= 10 ? 1 : 2)}%`;
}

async function postJson(ctx, url, body, fallbackTitle = '请求失败') {
  const response = await ctx.http.post(url, {
    headers: { 'Content-Type': 'application/json' },
    body,
  });
  return parseJsonResponse(response, fallbackTitle, url);
}

async function getJson(ctx, url, headers) {
  const response = await ctx.http.get(url, { headers });
  return parseJsonResponse(response, '请求失败', url);
}

async function parseJsonResponse(response, fallbackTitle, url = '') {
  if (!response) {
    throw new WidgetError(fallbackTitle, '没有收到服务器响应');
  }

  const status = Number(response.status ?? 200);
  const route = summarizeUrl(url);
  let payload;
  try {
    payload = await response.json();
  } catch {
    const preview = await safeResponsePreview(response);
    const statusText = Number.isFinite(status) ? `HTTP ${status}` : 'HTTP 状态未知';
    throw new WidgetError(fallbackTitle, `${route}${statusText}，非 JSON 响应：${preview}`);
  }

  if (status < 200 || status >= 300) {
    throw new WidgetError(fallbackTitle, `${route}${readableMessage(payload) || `HTTP ${status}`}`);
  }

  return payload;
}

async function safeResponsePreview(response) {
  if (typeof response.text !== 'function') return '无响应正文';
  try {
    return compactText(await response.text()).slice(0, 120) || '空响应';
  } catch {
    return '无法读取响应正文';
  }
}

function summarizeUrl(url) {
  if (!url) return '';
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}：`;
  } catch {
    return '';
  }
}

function unwrapApiResponse(payload, fallbackTitle) {
  if (payload && typeof payload === 'object' && 'code' in payload) {
    if (payload.code === 0) return payload.data ?? {};
    throw new WidgetError(fallbackTitle, readableMessage(payload) || `code=${payload.code}`);
  }
  return payload ?? {};
}

function renderUsageWidget(ctx, usage) {
  const compact = isCompactFamily(ctx?.widgetFamily);
  const now = new Date();
  const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  return {
    type: 'widget',
    refreshAfter: refreshAfter(10),
    padding: compact ? 12 : [13, 14, 12, 14],
    gap: compact ? 7 : 10,
    backgroundColor: COLORS.background,
    children: [
      headerRow(usage, timeStr, compact),
      progressRows(usage, compact),
    ],
  };
}

function headerRow(usage, timeStr, compact) {
  return {
    type: 'stack',
    direction: 'row',
    alignItems: 'center',
    gap: 6,
    children: [
      {
        type: 'image',
        src: 'sf-symbol:chart.bar.fill',
        width: compact ? 12 : 13,
        height: compact ? 12 : 13,
        color: COLORS.blue,
      },
      {
        type: 'text',
        text: usage.groupName || 'Sub2API 额度',
        font: { size: compact ? 'caption2' : 'caption1', weight: 'semibold' },
        textColor: COLORS.title,
        maxLines: 1,
        minScale: 0.75,
      },
      { type: 'spacer' },
      {
        type: 'image',
        src: 'sf-symbol:clock',
        width: 11,
        height: 11,
        color: COLORS.muted,
      },
      {
        type: 'text',
        text: timeStr,
        font: { size: 'caption2' },
        textColor: COLORS.muted,
      },
    ],
  };
}

function progressRows(usage, compact) {
  return {
    type: 'stack',
    direction: 'column',
    gap: compact ? 6 : 8,
    children: METRICS.map((metric) => progressRow(metric, usage[metric.key], compact)),
  };
}

function progressRow(metric, period, compact) {
  const percent = period?.usedPercent ?? 0;
  const stopPercent = Math.min(Math.max(percent / 100, 0), 1);
  const usageColor = progressColor(percent, metric.iconColor);
  const progressBgColor = tintColor(usageColor, percent >= 70 ? 0.28 : 0.22);
  const rowGradient = {
    type: 'linear',
    colors: [progressBgColor, progressBgColor, COLORS.panel, COLORS.panel],
    stops: [0, stopPercent, stopPercent, 1],
    startPoint: { x: 0, y: 0 },
    endPoint: { x: 1, y: 0 },
  };

  return {
    type: 'stack',
    direction: 'column',
    gap: compact ? 3 : 5,
    padding: compact ? [7, 9, 7, 9] : [9, 11, 9, 11],
    backgroundGradient: rowGradient,
    borderRadius: 12,
    borderWidth: 0.5,
    borderColor: COLORS.progressBg,
    children: [
      {
        type: 'stack',
        direction: 'row',
        alignItems: 'center',
        gap: 6,
        children: [
          {
            type: 'image',
            src: metric.icon,
            width: compact ? 11 : 13,
            height: compact ? 11 : 13,
            color: usageColor,
          },
          {
            type: 'text',
            text: metric.label,
            font: { size: compact ? 'caption2' : 'caption1', weight: 'semibold' },
            textColor: COLORS.value,
            maxLines: 1,
          },
          { type: 'spacer' },
          {
            type: 'text',
            text: formatPercent(percent),
            font: { size: compact ? 'caption2' : 'caption1', weight: 'bold' },
            textColor: usageColor,
            textAlign: 'right',
          },
        ],
      },
      {
        type: 'text',
        text: formatPeriodSubtitle(period),
        font: { size: 'caption2' },
        textColor: COLORS.muted,
        maxLines: 1,
        minScale: 0.65,
      },
    ],
  };
}

function progressColor(percent, fallback) {
  if (percent >= 90) return COLORS.danger;
  if (percent >= 70) return COLORS.warning;
  return fallback || COLORS.green;
}

function tintColor(color, alpha) {
  const suffix = Math.round(Math.min(Math.max(alpha, 0), 1) * 255).toString(16).padStart(2, '0');
  return {
    light: `${color.light}${suffix}`,
    dark: `${color.dark}${suffix}`,
  };
}

function renderErrorWidget(error) {
  const title = error instanceof WidgetError ? error.title : '加载失败';
  const detail = error instanceof WidgetError ? error.detail : readableMessage(error) || '请稍后重试';

  return {
    type: 'widget',
    refreshAfter: refreshAfter(15),
    padding: 14,
    gap: 8,
    backgroundColor: COLORS.background,
    children: [
      {
        type: 'text',
        text: title,
        font: { size: 'headline', weight: 'bold' },
        textColor: title === '配置缺失' ? COLORS.warning : COLORS.danger,
        maxLines: 1,
        minScale: 0.75,
      },
      {
        type: 'text',
        text: detail,
        font: { size: 'caption1', weight: 'regular' },
        textColor: COLORS.muted,
        maxLines: 4,
        minScale: 0.7,
      },
    ],
  };
}

function refreshAfter(minutes) {
  return new Date(Date.now() + minutes * 60 * 1000).toISOString();
}


function isCompactFamily(family) {
  return family === 'systemSmall' || family === 'accessoryRectangular' || family === 'accessoryInline';
}

function toFiniteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function trimString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function trimTrailingZeros(value, digits = 1) {
  return Number(value).toFixed(digits).replace(/\.?0+$/, '');
}

function compactText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function readableMessage(value) {
  if (!value) return '';
  if (value instanceof Error) return value.message;
  if (typeof value === 'string') return value;
  if (typeof value.message === 'string') return value.message;
  if (typeof value.error === 'string') return value.error;
  if (typeof value.detail === 'string') return value.detail;
  return '';
}

class WidgetError extends Error {
  constructor(title, detail) {
    super(`${title}: ${detail}`);
    this.name = 'WidgetError';
    this.title = title;
    this.detail = detail;
  }
}

export default sub2apiUsageWidget;
