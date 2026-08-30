/**
 * Egern widget: Electricity Balance
 *
 * Modified from pronounAI/Egern Subscription-Widget.js.
 * Original work: https://github.com/pronounAI/Egern/blob/main/Subscription-Widget.js
 * Licensed under the Apache License, Version 2.0.
 *
 * Required env:
 *   ELECTRICITY_API_TOKEN=<Bearer token，不需要填写 Bearer 前缀>
 * Optional env:
 *   METER_ID=<measureId>        指定 measureId；留空时优先选择第一块在线电表
 *   METER_NO=<measureNo>        也可按电表编号选择
 *   METER_NAME=我的电表         覆盖组件显示名称
 *   POWER_THRESHOLD=20          留空时采用接口 balanceThreshold
 *   MAX_DATA_AGE_HOURS=48       超过此时间显示数据过期
 *   REFRESH_HOURS=1
 *   WIDGET_STYLE=glass          glass（默认）| classic
 *   ELECTRICITY_API_URL=https://bb2.minyie.cn/ruoyi-bb/platform/bar/user/getMeterDataByUser
 */

const C = {
  bg:       { light: '#FFFFFF', dark: '#050506' },
  text:     { light: '#111114', dark: '#F7F7F8' },
  dim:      { light: '#7B7B84', dark: '#85858E' },
  panel:    { light: '#F5F5F7', dark: '#111114' },
  hairline: { light: '#E4E4E8', dark: '#242429' },
  track:    { light: '#E8E8ED', dark: '#202025' },
  accent:   { light: '#2F9E58', dark: '#76E39A' },
  ok:       { light: '#2F9E58', dark: '#C7FF18' },
  warn:     { light: '#A06400', dark: '#FFBE3F' },
  fail:     { light: '#D64545', dark: '#FF626A' }
};

const DEFAULT_API_URL = 'https://bb2.minyie.cn/ruoyi-bb/platform/bar/user/getMeterDataByUser';
const GAUGE_API = 'https://quickchart.io/chart';

function numberEnv(ctx, key, fallback, min, max) {
  const raw = String(ctx.env?.[key] ?? '').trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function optionalNumberEnv(ctx, key) {
  const raw = String(ctx.env?.[key] ?? '').trim();
  if (!raw) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function styleMode(ctx) {
  const value = String(ctx.env?.WIDGET_STYLE || 'glass').trim().toLowerCase();
  return value === 'classic' ? 'classic' : 'glass';
}

function rootBackground(mode) {
  return mode === 'classic' ? { backgroundColor: C.bg } : {};
}

function hashString(value) {
  let hash = 5381;
  for (let i = 0; i < value.length; i += 1) hash = ((hash << 5) + hash) ^ value.charCodeAt(i);
  return (hash >>> 0).toString(36);
}

function storageKey(apiUrl, selector) {
  return `egern.electricity.balance.v1.${hashString(`${apiUrl}|${selector}`)}`;
}

function normalizeToken(value) {
  return String(value || '').trim().replace(/^Bearer\s+/i, '');
}

function parseApiDate(value) {
  const raw = String(value || '').trim();
  if (!raw) return 0;
  const normalized = raw.includes('T') ? raw : `${raw.replace(' ', 'T')}+08:00`;
  const timestamp = new Date(normalized).getTime();
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function toFiniteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function selectMeter(meters, meterId, meterNo) {
  if (!Array.isArray(meters) || !meters.length) return null;
  const id = String(meterId || '').trim();
  const no = String(meterNo || '').trim();

  if (id || no) {
    const matched = meters.find(meter =>
      (id && String(meter?.measureId ?? '') === id) ||
      (no && String(meter?.measureNo ?? '') === no)
    );
    if (matched) return matched;
    throw new Error(`未找到电表 ${id || no}`);
  }

  return meters.find(meter => String(meter?.onlineStatus || '').trim() === '在线') || meters[0];
}

async function parseJsonResponse(response) {
  if (!response) throw new Error('没有收到服务器响应');
  const status = Number(response.status ?? 200);
  let payload;
  try {
    payload = await response.json();
  } catch {
    try {
      payload = JSON.parse(await response.text());
    } catch {
      throw new Error(`电表接口返回非 JSON 数据（HTTP ${status}）`);
    }
  }

  if (status === 401 || status === 403) throw new Error('Token 已失效，请重新抓取');
  if (status < 200 || status >= 300) throw new Error(payload?.msg || payload?.message || `HTTP ${status}`);
  if (payload?.code !== 0) throw new Error(payload?.msg || payload?.message || `接口错误 code=${payload?.code}`);
  return payload;
}

async function fetchMeter(ctx, apiUrl, token, meterId, meterNo) {
  const response = await ctx.http.post(apiUrl, {
    timeout: 10000,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': 'Egern-Electricity-Widget/1.0',
      Referer: 'https://servicewechat.com/wxa663a58156eb05b2/500/page-frame.html'
    },
    body: {
      pageNumber: 1,
      pageSize: 50,
      measureType: '',
      measureNo: null
    }
  });

  const payload = await parseJsonResponse(response);
  const meters = payload?.data?.list;
  if (!Array.isArray(meters)) throw new Error('接口没有返回电表列表');
  return selectMeter(meters, meterId, meterNo);
}

function normalizeMeter(ctx, meter) {
  const thresholdOverride = optionalNumberEnv(ctx, 'POWER_THRESHOLD');
  const remaining = toFiniteNumber(meter?.remainingPowerNew ?? meter?.remainingPower, NaN);
  if (!Number.isFinite(remaining)) throw new Error('接口没有返回有效剩余电量');

  const threshold = thresholdOverride ?? toFiniteNumber(meter?.balanceThreshold, 20);
  const totalUsage = toFiniteNumber(meter?.zxygzdlNew ?? meter?.zxygzdlNumber ?? meter?.zxygzdl, NaN);
  const unitPrice = toFiniteNumber(meter?.singleRateValue, NaN);
  const dataAt = parseApiDate(meter?.remainingPowerTime);
  const maxAgeHours = numberEnv(ctx, 'MAX_DATA_AGE_HOURS', 48, 1, 24 * 365);
  const ageHours = dataAt ? Math.max(0, (Date.now() - dataAt) / 3600000) : null;
  const customName = String(ctx.env?.METER_NAME || '').trim();

  return {
    id: String(meter?.measureId ?? ''),
    no: String(meter?.measureNo ?? ''),
    name: customName || String(meter?.measureName || meter?.measureNo || '电量监控'),
    projectName: String(meter?.projectName || ''),
    remaining,
    threshold: Math.max(0, threshold),
    totalUsage,
    unitPrice,
    estimatedAmount: Number.isFinite(unitPrice) ? Math.max(0, remaining * unitPrice) : NaN,
    dataAt,
    dataTime: String(meter?.remainingPowerTime || ''),
    ageHours,
    dataStale: !dataAt || (ageHours != null && ageHours > maxAgeHours),
    onlineStatus: String(meter?.onlineStatus || '').trim(),
    powerStatus: String(meter?.powerStatus || '').trim(),
    relayStatus: String(meter?.jdqzt || '').trim()
  };
}

async function loadData(ctx) {
  const token = normalizeToken(ctx.env?.ELECTRICITY_API_TOKEN || ctx.env?.BB_TOKEN);
  const meterId = String(ctx.env?.METER_ID || '').trim();
  const meterNo = String(ctx.env?.METER_NO || '').trim();
  const apiUrl = String(ctx.env?.ELECTRICITY_API_URL || DEFAULT_API_URL).trim();
  const defaultName = String(ctx.env?.METER_NAME || 'ELECTRICITY').trim();

  if (!token) return { mode: 'setup', name: defaultName };

  const selector = meterId || meterNo || 'first-online';
  const key = storageKey(apiUrl, selector);
  try {
    const meter = normalizeMeter(ctx, await fetchMeter(ctx, apiUrl, token, meterId, meterNo));
    const result = { mode: 'live', name: meter.name, meter, updatedAt: Date.now() };
    ctx.storage?.setJSON(key, result);
    return result;
  } catch (error) {
    const cached = ctx.storage?.getJSON(key);
    if (cached?.meter) {
      return {
        ...cached,
        mode: 'stale',
        error: String(error?.message || error),
        name: cached.meter.name || defaultName
      };
    }
    return { mode: 'error', name: defaultName, error: String(error?.message || error || '加载失败') };
  }
}

function safetyPercent(meter) {
  if (!meter || !Number.isFinite(meter.threshold) || meter.threshold <= 0) return null;
  return Math.max(0, Math.min(100, (meter.remaining / meter.threshold) * 100));
}

function statusOf(data) {
  if (data.mode === 'setup') {
    return { key: 'setup', label: '待配置', icon: 'gearshape.fill', bgColor: 'rgba(255, 255, 255, 0.22)', iconColor: '#FFFFFF' };
  }
  if (data.mode === 'error') {
    return { key: 'error', label: '更新失败', icon: 'exclamationmark.circle.fill', bgColor: 'rgba(214, 69, 69, 0.35)', iconColor: '#FF626A' };
  }
  if (data.mode === 'stale') {
    return { key: 'cache', label: '缓存数据', icon: 'clock.arrow.circlepath', bgColor: 'rgba(255, 190, 63, 0.3)', iconColor: '#FFBE3F' };
  }

  const meter = data.meter;
  if (meter.dataStale) {
    return { key: 'stale', label: '数据过期', icon: 'clock.badge.exclamationmark.fill', bgColor: 'rgba(255, 190, 63, 0.3)', iconColor: '#FFBE3F' };
  }
  if (meter.onlineStatus && meter.onlineStatus !== '在线') {
    return { key: 'offline', label: '电表离线', icon: 'wifi.slash', bgColor: 'rgba(255, 190, 63, 0.3)', iconColor: '#FFBE3F' };
  }
  if (meter.remaining <= 0) {
    return { key: 'empty', label: '电量耗尽', icon: 'bolt.slash.fill', bgColor: 'rgba(214, 69, 69, 0.35)', iconColor: '#FF626A' };
  }
  if (meter.remaining <= meter.threshold) {
    return { key: 'low', label: '电量不足', icon: 'exclamationmark.triangle.fill', bgColor: 'rgba(255, 190, 63, 0.3)', iconColor: '#FFBE3F' };
  }
  return { key: 'ok', label: '电量充足', icon: 'checkmark.circle.fill', bgColor: 'rgba(255, 255, 255, 0.25)', iconColor: '#FFFFFF' };
}

function statusAccent(data) {
  const key = statusOf(data).key;
  if (key === 'empty' || key === 'error') return C.fail;
  if (['low', 'stale', 'offline', 'cache'].includes(key)) return C.warn;
  return C.accent;
}

function formatPower(value, suffix = '度') {
  if (!Number.isFinite(value)) return '--';
  const digits = Math.abs(value) >= 100 ? 1 : 2;
  const number = value.toFixed(digits).replace(/\.?0+$/, '');
  return suffix ? `${number} ${suffix}` : number;
}

function formatMoney(value) {
  if (!Number.isFinite(value)) return '--';
  return `¥${value.toFixed(2)}`;
}

function formatDateTime(timestamp, includeDate = true) {
  if (!timestamp) return '--';
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '--';
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  return includeDate ? `${month}-${day} ${hour}:${minute}` : `${hour}:${minute}`;
}

function formatAge(hours) {
  if (!Number.isFinite(hours)) return '更新时间未知';
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} 分钟前`;
  if (hours < 24) return `${hours.toFixed(hours >= 10 ? 0 : 1)} 小时前`;
  return `${Math.floor(hours / 24)} 天前`;
}

function bytesToBase64(bytes) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let output = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    const triple = (a << 16) | (b << 8) | c;
    output += alphabet[(triple >> 18) & 63];
    output += alphabet[(triple >> 12) & 63];
    output += i + 1 < bytes.length ? alphabet[(triple >> 6) & 63] : '=';
    output += i + 2 < bytes.length ? alphabet[triple & 63] : '=';
  }
  return output;
}

async function loadGaugeImage(ctx, data) {
  const percent = safetyPercent(data.meter);
  if (percent == null) return '';
  const rounded = Math.round(percent);
  const status = statusOf(data).key;
  const color = status === 'empty' ? '#D64545' : status === 'low' ? '#FFBE3F' : '#2F9E58';
  const cacheKey = `egern.electricity.gauge.png.v1.${status}.${rounded}`;
  const cached = ctx.storage?.get(cacheKey);
  if (cached) return cached;

  const chart = {
    type: 'doughnut',
    data: {
      datasets: [{
        data: [Math.max(0.01, rounded), Math.max(0.01, 100 - rounded)],
        backgroundColor: [color, '#D0D0D8'],
        borderColor: ['rgba(0,0,0,0)', 'rgba(0,0,0,0)'],
        borderWidth: 1
      }]
    },
    options: {
      responsive: false,
      animation: false,
      rotation: 2.35619449,
      circumference: 4.71238898,
      cutoutPercentage: 82,
      legend: { display: false },
      tooltips: { enabled: false },
      plugins: {
        datalabels: { display: false },
        doughnutlabel: {
          labels: [
            { text: ' ', font: { size: 12, weight: 'normal', family: 'Helvetica Neue' }, color: 'rgba(0,0,0,0)' },
            { text: `${rounded}%`, font: { size: 36, weight: 'bold', family: 'Helvetica Neue' }, color },
            { text: '安全度', font: { size: 14, weight: 'normal', family: 'Helvetica Neue' }, color: '#7B7B84' }
          ]
        }
      }
    }
  };

  const response = await ctx.http.post(GAUGE_API, {
    timeout: 8000,
    headers: { 'Content-Type': 'application/json' },
    body: {
      version: '2',
      width: 280,
      height: 200,
      devicePixelRatio: 2,
      format: 'png',
      backgroundColor: 'transparent',
      chart
    }
  });
  if (response.status < 200 || response.status >= 300) throw new Error(`Gauge HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!bytes.length) throw new Error('Gauge image is empty');
  const dataUri = `data:image/png;base64,${bytesToBase64(bytes)}`;
  ctx.storage?.set(cacheKey, dataUri);
  return dataUri;
}

function icon(name, color, size = 14) {
  return { type: 'image', src: `sf-symbol:${name}`, width: size, height: size, color };
}

function text(value, size, color, weight = 'regular', extra = {}) {
  return {
    type: 'text',
    text: String(value),
    font: { size, weight },
    textColor: color,
    maxLines: 1,
    ...extra
  };
}

function header(data, isSmall = false) {
  const status = statusOf(data);
  const badge = isSmall
    ? {
        type: 'stack', direction: 'row', alignItems: 'center', justifyContent: 'center',
        padding: [4, 7, 4, 7], backgroundColor: status.bgColor, borderRadius: 12,
        children: [icon(status.icon, status.iconColor, 12)]
      }
    : {
        type: 'stack', direction: 'row', alignItems: 'center', gap: 5,
        padding: [4, 10, 4, 8], backgroundColor: status.bgColor, borderRadius: 14,
        children: [icon(status.icon, status.iconColor, 13), text(status.label, 10, '#FFFFFF', 'semibold')]
      };

  return {
    type: 'stack', direction: 'row', alignItems: 'center', gap: 7,
    children: [
      icon('bolt.circle.fill', C.accent, 14),
      text(isSmall ? (data.name || '电量监控') : 'ELECTRICITY', 10, C.dim, 'bold', isSmall ? { minScale: 0.65 } : {}),
      { type: 'spacer' },
      badge
    ]
  };
}

function progressBar(meter) {
  const percent = safetyPercent(meter);
  const active = Math.max(0.001, percent ?? 0.001);
  const empty = Math.max(0.001, 100 - (percent ?? 0));
  const color = meter.remaining <= 0 ? C.fail : meter.remaining <= meter.threshold ? C.warn : C.accent;
  return {
    type: 'stack', direction: 'row', height: 5, backgroundColor: C.track, borderRadius: 3,
    children: [
      { type: 'stack', height: 5, backgroundColor: color, borderRadius: 3, flex: active, children: [] },
      { type: 'spacer', flex: empty }
    ]
  };
}

function fallbackGauge(data, size = 90) {
  const percent = safetyPercent(data.meter);
  return {
    type: 'stack', direction: 'column', alignItems: 'center', width: size, height: size, gap: 3,
    children: [
      { type: 'spacer' },
      icon('gauge.with.dots.needle.33percent', statusAccent(data), 46),
      text(percent == null ? '--' : `${percent.toFixed(0)}%`, 14, C.text, 'bold', {
        font: { size: 14, weight: 'bold', family: 'Menlo' }
      }),
      text('安全度', 9, C.dim, 'semibold'),
      { type: 'spacer' }
    ]
  };
}

function gaugeView(data, size = 86) {
  if (!data.gaugeImage) return fallbackGauge(data, size);
  return { type: 'image', src: data.gaugeImage, width: size + 14, height: size, resizeMode: 'contain' };
}

function metric(label, value, color = C.text) {
  return {
    type: 'stack', direction: 'column', gap: 2, flex: 1,
    children: [
      text(label, 9, C.dim, 'semibold'),
      text(value, 12, color, 'semibold', { minScale: 0.68 })
    ]
  };
}

function refreshAfter(ctx) {
  const refreshHours = numberEnv(ctx, 'REFRESH_HOURS', 1, 0.25, 24);
  return new Date(Date.now() + refreshHours * 3600000).toISOString();
}

function emptyWidget(data, family, ctx) {
  const isSmall = family === 'systemSmall';
  const mode = styleMode(ctx);
  const setup = data.mode === 'setup';
  return {
    type: 'widget',
    ...rootBackground(mode),
    padding: isSmall ? [14, 16] : [16, 20],
    gap: 8,
    refreshAfter: refreshAfter(ctx),
    children: [
      header(data, isSmall),
      { type: 'spacer' },
      {
        type: 'stack', direction: 'row',
        children: [
          { type: 'spacer' },
          {
            type: 'stack', direction: 'column', alignItems: 'center', gap: 6,
            children: [
              icon(setup ? 'key.fill' : 'exclamationmark.triangle', setup ? C.dim : C.fail, isSmall ? 20 : 22),
              text(setup ? '等待电表 Token' : '无法读取电量', isSmall ? 13 : 15, C.text, 'semibold'),
              text(setup ? '请配置 ELECTRICITY_API_TOKEN' : data.error, 9, C.dim, 'medium', { minScale: 0.6, maxLines: 2 })
            ]
          },
          { type: 'spacer' }
        ]
      },
      { type: 'spacer' }
    ]
  };
}

function mediumWidget(data, ctx) {
  if (!data.meter) return emptyWidget(data, 'systemMedium', ctx);
  const meter = data.meter;
  const mode = styleMode(ctx);
  return {
    type: 'widget',
    ...rootBackground(mode),
    padding: [16, 20, 14, 20],
    gap: 8,
    refreshAfter: refreshAfter(ctx),
    children: [
      header(data, false),
      { type: 'spacer' },
      {
        type: 'stack', direction: 'row', alignItems: 'center', gap: 12,
        children: [
          {
            type: 'stack', direction: 'column', gap: 3, flex: 1,
            children: [
              text(formatPower(meter.remaining), 26, C.text, 'bold', {
                font: { size: 26, weight: 'bold', family: 'Menlo' }, minScale: 0.58
              }),
              text('剩余电量', 10, C.dim, 'medium'),
              {
                type: 'stack', direction: 'row', alignItems: 'center',
                children: [
                  text(`累计 ${formatPower(meter.totalUsage)}`, 10, C.dim, 'medium', { minScale: 0.68 }),
                  { type: 'spacer' },
                  text(formatAge(meter.ageHours), 10, meter.dataStale ? C.warn : C.dim, 'medium', { minScale: 0.68 })
                ]
              },
              text(`更新 ${formatDateTime(meter.dataAt)}`, 9, C.dim, 'medium'),
              { type: 'spacer' },
              text(meter.name, 9, C.dim, 'medium', { minScale: 0.65 })
            ]
          },
          {
            type: 'stack', direction: 'column', alignItems: 'center', justifyContent: 'center', gap: 2, width: 100,
            children: [
              gaugeView(data, 86),
              text(`阈值 ${formatPower(meter.threshold)}`, 9, C.dim, 'semibold', { minScale: 0.68 })
            ]
          }
        ]
      },
      { type: 'spacer' }
    ]
  };
}

function smallWidget(data, ctx) {
  if (!data.meter) return emptyWidget(data, 'systemSmall', ctx);
  const meter = data.meter;
  const percent = safetyPercent(meter);
  const mode = styleMode(ctx);
  return {
    type: 'widget',
    ...rootBackground(mode),
    padding: [16, 18, 16, 18],
    gap: 7,
    refreshAfter: refreshAfter(ctx),
    children: [
      header(data, true),
      { type: 'spacer' },
      text(formatPower(meter.remaining, ''), 24, C.text, 'bold', {
        font: { size: 24, weight: 'bold', family: 'Menlo' }, minScale: 0.58
      }),
      {
        type: 'stack', direction: 'row',
        children: [
          text('剩余电量', 10, C.dim, 'medium'),
          { type: 'spacer' },
          text(percent == null ? '--' : `${percent.toFixed(0)}%`, 11, statusAccent(data), 'semibold')
        ]
      },
      progressBar(meter),
      { type: 'spacer' },
      text(`阈值 ${formatPower(meter.threshold)} · ${formatDateTime(meter.dataAt, false)}`, 9, C.dim, 'medium', { minScale: 0.65 })
    ]
  };
}

function largeWidget(data, ctx) {
  if (!data.meter) return emptyWidget(data, 'systemLarge', ctx);
  const meter = data.meter;
  const percent = safetyPercent(meter);
  const mode = styleMode(ctx);
  const cardBg = mode === 'glass'
    ? { light: 'rgba(255, 255, 255, 0.18)', dark: 'rgba(255, 255, 255, 0.08)' }
    : C.panel;
  const hairlineBg = mode === 'glass'
    ? { light: 'rgba(255, 255, 255, 0.25)', dark: 'rgba(255, 255, 255, 0.12)' }
    : C.hairline;

  return {
    type: 'widget',
    ...rootBackground(mode),
    padding: [18, 20, 18, 20],
    gap: 10,
    refreshAfter: refreshAfter(ctx),
    children: [
      header(data, false),
      {
        type: 'stack', direction: 'row', alignItems: 'center', gap: 12,
        padding: [11, 14], backgroundColor: cardBg, borderRadius: 12,
        children: [
          icon('bolt.circle.fill', statusAccent(data), 28),
          {
            type: 'stack', direction: 'column', gap: 2, flex: 1,
            children: [
              text(formatPower(meter.remaining), 22, C.text, 'bold', {
                font: { size: 22, weight: 'bold', family: 'Menlo' }, minScale: 0.6
              }),
              text('剩余电量', 10, C.dim, 'medium')
            ]
          },
          text(percent == null ? '--' : `${percent.toFixed(0)}%`, 18, statusAccent(data), 'bold')
        ]
      },
      progressBar(meter),
      {
        type: 'stack', direction: 'row', gap: 12,
        children: [
          metric('告警阈值', formatPower(meter.threshold)),
          metric('累计用电', formatPower(meter.totalUsage)),
          metric('电价', Number.isFinite(meter.unitPrice) ? `${meter.unitPrice.toFixed(2)} 元/度` : '--')
        ]
      },
      { type: 'stack', height: 1, backgroundColor: hairlineBg, children: [] },
      {
        type: 'stack', direction: 'row', gap: 12,
        children: [
          metric('估算余额', formatMoney(meter.estimatedAmount)),
          metric('在线状态', meter.onlineStatus || '未知', meter.onlineStatus && meter.onlineStatus !== '在线' ? C.warn : C.text),
          metric('数据更新', formatAge(meter.ageHours), meter.dataStale ? C.warn : C.text)
        ]
      },
      { type: 'spacer' },
      {
        type: 'stack', direction: 'row',
        children: [
          text(meter.name, 9, C.dim, 'medium', { flex: 1, minScale: 0.65 }),
          text(meter.no ? `电表 ${meter.no}` : `更新 ${formatDateTime(meter.dataAt)}`, 9, C.dim, 'semibold', { minScale: 0.68 })
        ]
      }
    ]
  };
}

function lockWidget(data, family) {
  if (!data.meter) {
    const label = data.mode === 'setup' ? '电量监控：待配置' : '电量监控：读取失败';
    return { type: 'widget', children: [text(label, 12, C.text, 'semibold')] };
  }
  const meter = data.meter;
  const percent = safetyPercent(meter);
  const remaining = formatPower(meter.remaining);
  if (family === 'accessoryInline') {
    return { type: 'widget', children: [text(`剩余 ${remaining}${percent == null ? '' : ` · ${percent.toFixed(0)}%`}`, 12, C.text, 'semibold')] };
  }
  if (family === 'accessoryCircular') {
    return {
      type: 'widget', padding: 4,
      children: [
        icon('bolt.fill', C.text, 15),
        text(percent == null ? '--' : `${percent.toFixed(0)}%`, 12, C.text, 'bold', { textAlign: 'center' })
      ]
    };
  }
  return {
    type: 'widget', gap: 2,
    children: [
      {
        type: 'stack', direction: 'row', alignItems: 'center', gap: 5,
        children: [icon('bolt.circle.fill', C.text, 12), text(data.name, 11, C.text, 'semibold', { minScale: 0.65 })]
      },
      text(`剩余 ${remaining} · 阈值 ${formatPower(meter.threshold)}`, 12, C.text, 'bold', { minScale: 0.68 })
    ]
  };
}

export default async function(ctx) {
  const data = await loadData(ctx);
  const family = ctx.widgetFamily || 'systemMedium';
  if (family === 'systemMedium' && data.meter) {
    try {
      data.gaugeImage = await loadGaugeImage(ctx, data);
    } catch {
      data.gaugeImage = '';
    }
  }
  if (family.startsWith('accessory')) return lockWidget(data, family);
  if (family === 'systemSmall') return smallWidget(data, ctx);
  if (family === 'systemLarge' || family === 'systemExtraLarge') return largeWidget(data, ctx);
  return mediumWidget(data, ctx);
}
