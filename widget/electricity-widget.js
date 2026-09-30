/**
 * Egern widget: Electricity Balance (minimal)
 *
 * Modified from pronounAI/Egern Subscription-Widget.js.
 * Original work: https://github.com/pronounAI/Egern/blob/main/Subscription-Widget.js
 * Licensed under the Apache License, Version 2.0.
 *
 * Login env (choose one):
 *   YYB_API_KEY=<YYB API Key>    自动获取 code 并续期 Token
 *   YYB_ACCOUNT_REF=<账号 ID、UIN 或 openid>
 *   ELECTRICITY_API_TOKEN=<Bearer token>  也可只用手工 Token
 * Optional env:
 *   YYB_BASE_URL=https://yyb.tiome.me
 *   ELECTRICITY_USER_ID=<电表服务 userId>  防止登录到其他账号
 *   METER_ID=<measureId>
 *   METER_NO=<measureNo>
 *   METER_NAME=电量监控
 *   POWER_THRESHOLD=20          留空时采用接口 balanceThreshold
 *   MAX_DATA_AGE_HOURS=48
 *   REFRESH_HOURS=1
 *   WIDGET_STYLE=glass          glass（默认）| classic
 *   METER_READ_ENABLED=true     刷新时主动抄表
 *   METER_READ_INTERVAL_MINUTES=30
 *   METER_READ_WAIT_SECONDS=12
 *   METER_READ_POLL_SECONDS=2
 */

const C = {
  bg:    { light: '#FFFFFF', dark: '#050506' },
  text:  { light: '#111114', dark: '#F7F7F8' },
  dim:   { light: '#7B7B84', dark: '#85858E' },
  ok:    { light: '#2F9E58', dark: '#76E39A' },
  warn:  { light: '#A06400', dark: '#FFBE3F' },
  fail:  { light: '#D64545', dark: '#FF626A' },
  line:  { light: '#E1E2E5', dark: '#303035' }
};

const API_URL = 'https://bb2.minyie.cn/ruoyi-bb/platform/bar/user/getMeterDataByUser';
const METER_READ_URL = 'https://bb2.minyie.cn/ruoyi-bb/platform/device/sendMeterPacketTask';
const METER_READ_RESULT_URL = 'https://bb2.minyie.cn/ruoyi-bb/platform/device/getReturnBySendMeterPakcet';
const USAGE_REPORT_URL = 'https://bb2.minyie.cn/ruoyi-bb/platform/bar/consume/program/getConsEfficiencyByMonth';
const BUSINESS_TYPE = '1001';
const APP_ID = 'wxa663a58156eb05b2';
const LOGIN_URL = 'https://bb2.minyie.cn/ruoyi-bb/platform/auth/user/login';
const YYB_BASE_URL = 'https://yyb.tiome.me';

class AuthenticationError extends Error {}

function stringEnv(ctx, key, fallback = '') {
  const value = String(ctx.env?.[key] ?? '').trim();
  return value || fallback;
}

function numberEnv(ctx, key, fallback, min, max) {
  const raw = stringEnv(ctx, key);
  const value = Number(raw);
  if (!raw || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function optionalNumberEnv(ctx, key) {
  const raw = stringEnv(ctx, key);
  if (!raw) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function boolEnv(ctx, key, fallback = false) {
  const raw = stringEnv(ctx, key).toLowerCase();
  if (!raw) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw);
}

function styleMode(ctx) {
  return stringEnv(ctx, 'WIDGET_STYLE', 'glass').toLowerCase() === 'classic' ? 'classic' : 'glass';
}

function rootBackground(ctx) {
  return styleMode(ctx) === 'classic' ? { backgroundColor: C.bg } : {};
}

function normalizeToken(value) {
  return String(value || '').trim().replace(/^Bearer\s+/i, '');
}

function hashString(value) {
  let hash = 5381;
  for (let i = 0; i < value.length; i += 1) hash = ((hash << 5) + hash) ^ value.charCodeAt(i);
  return (hash >>> 0).toString(36);
}

function storageKey(apiUrl, selector) {
  return `egern.electricity.balance.v2.${hashString(`${apiUrl}|${selector}`)}`;
}

function parseApiDate(value) {
  const raw = String(value || '').trim();
  if (!raw) return 0;
  const normalized = raw.includes('T') ? raw : `${raw.replace(' ', 'T')}+08:00`;
  const timestamp = new Date(normalized).getTime();
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function selectMeter(meters, meterId, meterNo) {
  if (!Array.isArray(meters) || !meters.length) throw new Error('接口没有返回电表列表');
  const id = String(meterId || '').trim();
  const no = String(meterNo || '').trim();

  if (id || no) {
    const matched = meters.find(meter =>
      (id && String(meter?.measureId ?? '') === id) ||
      (no && String(meter?.measureNo ?? '') === no)
    );
    if (!matched) throw new Error(`未找到电表 ${id || no}`);
    return matched;
  }

  return meters.find(meter => String(meter?.onlineStatus || '').trim() === '在线') || meters[0];
}

async function parseResponse(response, allowedCodes = [0], meterRequest = false) {
  if (!response) throw new Error('没有收到服务器响应');
  const status = Number(response.status ?? 200);
  if (status === 401) throw new AuthenticationError('登录已失效');
  let payload;
  try {
    payload = await response.json();
  } catch {
    try {
      payload = JSON.parse(await response.text());
    } catch {
      throw new Error(`接口返回非 JSON 数据（HTTP ${status}）`);
    }
  }

  const message = String(payload?.msg || payload?.message || `接口错误 code=${payload?.code}`);
  const expiredMessage = /登录失效|登录已过期|登录过期|未登录|请重新登录|token\s*(已过期|失效|expired|invalid)/i.test(message);
  // 电表服务对无效 JWT 实测返回 HTTP 200 / code 500 / 此固定提示。
  // 该提示也可能由服务故障引起；每次运行最多登录一次，避免循环消耗 YYB 额度。
  const ambiguousLoginFailure = meterRequest && status === 200 && payload?.code === 500 && message === '网络开小差了!!';
  if (String(payload?.code) === '401' || String(payload?.status) === '401' || ambiguousLoginFailure ||
      (!allowedCodes.includes(payload?.code) && expiredMessage)) {
    throw new AuthenticationError('登录已失效');
  }
  if (status < 200 || status >= 300) throw new Error(payload?.msg || payload?.message || `HTTP ${status}`);
  if (!allowedCodes.includes(payload?.code)) {
    throw new Error(payload?.msg || payload?.message || `接口错误 code=${payload?.code}`);
  }
  return payload;
}

function apiHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'User-Agent': 'Egern-Electricity-Widget/1.2',
    Referer: `https://servicewechat.com/${APP_ID}/500/page-frame.html`
  };
}

function loginSession(ctx) {
  const yybKey = stringEnv(ctx, 'YYB_API_KEY');
  const ref = stringEnv(ctx, 'YYB_ACCOUNT_REF');
  const yybBase = stringEnv(ctx, 'YYB_BASE_URL', YYB_BASE_URL).replace(/\/+$/, '');
  const userId = stringEnv(ctx, 'ELECTRICITY_USER_ID');
  const initialToken = normalizeToken(ctx.env?.ELECTRICITY_API_TOKEN || ctx.env?.BB_TOKEN);
  const identity = JSON.stringify([yybBase, ref, userId, APP_ID, initialToken]);
  const key = `egern.electricity.auth.v1.${hashString(identity)}`;
  const cached = yybKey ? ctx.storage?.getJSON(key) : null;
  return {
    ctx, yybKey, ref, yybBase, userId, key, identity,
    token: normalizeToken(cached?.identity === identity ? cached?.token : initialToken),
    refreshAttempted: false,
    refreshPromise: null
  };
}

async function refreshLogin(session) {
  if (session.refreshPromise) return session.refreshPromise;
  if (!session.yybKey || !session.ref) {
    throw new Error('请配置 YYB_API_KEY 和 YYB_ACCOUNT_REF，或更新 ELECTRICITY_API_TOKEN');
  }
  if (session.refreshAttempted) throw new Error('自动登录后仍然失效，请检查 YYB 微信账号状态');
  if (!/^https:\/\/[^/?#]+(?:\/[^?#]*)?$/.test(session.yybBase)) throw new Error('YYB_BASE_URL 必须是 HTTPS 地址');
  session.refreshAttempted = true;
  session.refreshPromise = (async () => {
    const response = await session.ctx.http.post(`${session.yybBase}/wxapp/getCode`, {
      timeout: 20000,
      headers: {
        Authorization: `Bearer ${session.yybKey}`,
        Accept: 'application/json',
        'Content-Type': 'application/json'
      },
      body: { ref: session.ref, app_id: APP_ID }
    });
    const payload = await parseResponse(response);
    const code = payload?.data?.result?.code;
    if (typeof code !== 'string' || !code.trim()) throw new Error('YYB 未返回 code，请检查微信账号状态');
    const loginResponse = await session.ctx.http.post(LOGIN_URL, {
      timeout: 10000,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Referer: apiHeaders('').Referer
      },
      body: { code, nickName: 'BB-微信用户', xcxAppId: APP_ID }
    });
    const login = await parseResponse(loginResponse);
    if (session.userId && String(login?.data?.userId) !== session.userId) {
      throw new Error('微信账号与 ELECTRICITY_USER_ID 不匹配，请检查 YYB_ACCOUNT_REF');
    }
    const token = login?.data?.access_token;
    if (typeof token !== 'string' || !token.trim()) throw new Error('电表服务未返回 access_token');
    session.token = normalizeToken(token);
    return session.token;
  })();
  try {
    return await session.refreshPromise;
  } finally {
    session.refreshPromise = null;
  }
}

function saveLogin(session) {
  session.ctx.storage?.setJSON(session.key, {
    identity: session.identity, token: session.token, updatedAt: Date.now()
  });
}

async function postJson(ctx, url, token, body, allowedCodes = [0]) {
  const session = typeof token === 'object' ? token : null;
  if (session && !session.token) await refreshLogin(session);
  const requestToken = session ? session.token : token;
  const request = async credential => parseResponse(await ctx.http.post(url, {
    timeout: 10000,
    headers: apiHeaders(credential),
    body
  }), allowedCodes, true);
  try {
    return await request(requestToken);
  } catch (error) {
    if (!(error instanceof AuthenticationError) || !session) throw error;
    if (session.token === requestToken) await refreshLogin(session);
    return request(session.token);
  }
}

async function fetchMeter(ctx, apiUrl, token, meterId, meterNo) {
  const payload = await postJson(ctx, apiUrl, token, {
    pageNumber: 1,
    pageSize: 50,
    measureType: '',
    measureNo: null
  });
  return selectMeter(payload?.data?.list, meterId, meterNo);
}

function localDateKey(date) {
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
}

function localMonthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function shiftedDay(base, offset) {
  const date = new Date(base);
  date.setDate(date.getDate() + offset);
  return date;
}

async function fetchRecentUsage(ctx, token, meter, dayCount = 7) {
  const projectId = String(meter?.projectId || '').trim();
  const measureId = meter?.measureId;
  if (!projectId || measureId == null || measureId === '') throw new Error('电表缺少 projectId 或 measureId');

  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const dates = Array.from({ length: dayCount }, (_, index) => shiftedDay(today, index - dayCount + 1));
  const months = [...new Set(dates.map(localMonthKey))];
  const values = new Map();

  for (const month of months) {
    const payload = await postJson(ctx, USAGE_REPORT_URL, token, {
      projectId,
      measureType: '1',
      month,
      measureId,
      startDate: '',
      endDate: '',
      dateType: 'month'
    });
    for (const row of payload?.data?.resultData || []) {
      const value = Number(row?.pactTotal);
      if (row?.ddate && Number.isFinite(value)) values.set(String(row.ddate), value);
    }
  }

  return dates.map(date => ({
    key: localDateKey(date),
    timestamp: date.getTime(),
    value: values.has(localDateKey(date)) ? values.get(localDateKey(date)) : null
  }));
}

async function sendMeterRead(ctx, token, meter) {
  const meterNo = String(meter?.measureNo || '').trim();
  const projectId = String(meter?.projectId || '').trim();
  if (!meterNo || !projectId) throw new Error('电表缺少 measureNo 或 projectId');

  const payload = await postJson(ctx, METER_READ_URL, token, {
    meterNo,
    communicationType: '2',
    projectId,
    businessType: BUSINESS_TYPE,
    params: {}
  });
  const taskId = Number(payload?.data?.taskId);
  if (!Number.isFinite(taskId)) throw new Error('主动抄表没有返回 taskId');
  return taskId;
}

async function queryMeterRead(ctx, token, taskId) {
  return postJson(ctx, METER_READ_RESULT_URL, token, {
    taskId,
    businessType: BUSINESS_TYPE
  }, [0, 2]);
}

function delay(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

function readingChanged(before, after) {
  const beforeTime = String(before?.remainingPowerTime || '');
  const afterTime = String(after?.remainingPowerTime || '');
  return Boolean(afterTime && afterTime !== beforeTime);
}

async function waitForFreshMeter(ctx, apiUrl, token, meterId, meterNo, before, taskId) {
  const waitSeconds = numberEnv(ctx, 'METER_READ_WAIT_SECONDS', 12, 0, 25);
  const pollSeconds = numberEnv(ctx, 'METER_READ_POLL_SECONDS', 2, 0.5, 8);
  const attempts = Math.max(1, Math.ceil(waitSeconds / pollSeconds));
  let latest = before;

  for (let index = 0; index < attempts; index += 1) {
    await delay(pollSeconds * 1000);
    try {
      await queryMeterRead(ctx, token, taskId);
    } catch {
      // 电表列表中的数据时间才是最终判断依据。
    }
    latest = await fetchMeter(ctx, apiUrl, token, meterId, meterNo);
    if (readingChanged(before, latest)) return latest;
  }
  return latest;
}

function normalizeMeter(ctx, meter) {
  const remaining = finiteNumber(meter?.remainingPowerNew ?? meter?.remainingPower, NaN);
  if (!Number.isFinite(remaining)) throw new Error('接口没有返回有效剩余电量');
  const thresholdOverride = optionalNumberEnv(ctx, 'POWER_THRESHOLD');
  const threshold = thresholdOverride ?? finiteNumber(meter?.balanceThreshold, 20);
  const dataAt = parseApiDate(meter?.remainingPowerTime);
  const ageHours = dataAt ? Math.max(0, (Date.now() - dataAt) / 3600000) : null;
  const maxAgeHours = numberEnv(ctx, 'MAX_DATA_AGE_HOURS', 48, 1, 24 * 365);

  return {
    id: String(meter?.measureId ?? ''),
    no: String(meter?.measureNo ?? ''),
    projectId: String(meter?.projectId ?? ''),
    name: stringEnv(ctx, 'METER_NAME', String(meter?.measureName || meter?.measureNo || '电量监控')),
    remaining,
    threshold: Math.max(0, threshold),
    dataAt,
    ageHours,
    stale: !dataAt || (ageHours != null && ageHours > maxAgeHours),
    onlineStatus: String(meter?.onlineStatus || '').trim()
  };
}

async function loadData(ctx, includeUsage = false) {
  const token = loginSession(ctx);
  const meterId = stringEnv(ctx, 'METER_ID');
  const meterNo = stringEnv(ctx, 'METER_NO');
  const apiUrl = stringEnv(ctx, 'ELECTRICITY_API_URL', API_URL);
  const defaultName = stringEnv(ctx, 'METER_NAME', '电量监控');
  if (!token.token && !(token.yybKey && token.ref)) {
    return { mode: 'setup', name: defaultName, error: '请配置 YYB_API_KEY 和 YYB_ACCOUNT_REF，或 ELECTRICITY_API_TOKEN' };
  }

  const selector = meterId || meterNo || 'first-online';
  const key = storageKey(apiUrl, token.yybKey ? `${selector}|${token.ref}|${token.userId}|${token.yybBase}` : selector);
  const readKey = `${key}.active-read`;
  const cached = ctx.storage?.getJSON(key);

  try {
    let rawMeter = await fetchMeter(ctx, apiUrl, token, meterId, meterNo);
    if (token.yybKey) saveLogin(token);
    const usagePromise = includeUsage
      ? fetchRecentUsage(ctx, token, rawMeter, 7).catch(() => cached?.usage || [])
      : Promise.resolve(cached?.usage || []);
    const readEnabled = boolEnv(ctx, 'METER_READ_ENABLED', true);
    const readInterval = numberEnv(ctx, 'METER_READ_INTERVAL_MINUTES', 30, 1, 24 * 60) * 60000;
    const lastRead = ctx.storage?.getJSON(readKey);
    const due = !lastRead?.sentAt || Date.now() - Number(lastRead.sentAt) >= readInterval;

    if (readEnabled && due) {
      try {
        const taskId = await sendMeterRead(ctx, token, rawMeter);
        ctx.storage?.setJSON(readKey, {
          sentAt: Date.now(),
          previousDataTime: String(rawMeter?.remainingPowerTime || ''),
          taskId
        });
        rawMeter = await waitForFreshMeter(ctx, apiUrl, token, meterId, meterNo, rawMeter, taskId);
        ctx.storage?.setJSON(readKey, {
          sentAt: Date.now(),
          completedAt: Date.now(),
          dataTime: String(rawMeter?.remainingPowerTime || ''),
          taskId
        });
      } catch (error) {
        ctx.storage?.setJSON(readKey, {
          sentAt: Date.now(),
          error: String(error?.message || error)
        });
      }
    }

    const meter = normalizeMeter(ctx, rawMeter);
    const usage = await usagePromise;
    if (token.yybKey) saveLogin(token);
    const result = { mode: 'live', name: meter.name, meter, usage, updatedAt: Date.now() };
    ctx.storage?.setJSON(key, result);
    return result;
  } catch (error) {
    if (cached?.meter) {
      return {
        ...cached,
        mode: 'cache',
        name: cached.meter.name || defaultName,
        error: String(error?.message || error)
      };
    }
    return { mode: 'error', name: defaultName, error: String(error?.message || error || '加载失败') };
  }
}

function statusColor(data) {
  if (!data.meter || data.mode === 'error') return C.fail;
  if (data.mode === 'cache' || data.meter.stale || (data.meter.onlineStatus && data.meter.onlineStatus !== '在线')) return C.warn;
  if (data.meter.remaining <= 0) return C.fail;
  if (data.meter.remaining <= data.meter.threshold) return C.warn;
  return C.ok;
}

function formatFixed(value) {
  return Number.isFinite(value) ? value.toFixed(2) : '--';
}

function iconSrc(color = '#7B7B84') {
  return `data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><path d='M13 2 3 14h7l-1 8 10-12h-7l1-8z' fill='${color}'/></svg>`;
}

function titleRow(name, color, size = 12, iconSize = 13) {
  return {
    type: 'stack', direction: 'row', alignItems: 'center', gap: 6,
    children: [
      { type: 'image', src: iconSrc(color), width: iconSize, height: iconSize, resizeMode: 'contain' },
      text(name, size, C.dim, 'bold', { minScale: 0.65 })
    ]
  };
}

function formatTime(timestamp, compact = false) {
  if (!timestamp) return '--';
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '--';
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  return compact ? `${hour}:${minute}` : `${month}-${day} ${hour}:${minute}`;
}

function headerRow(meter, stale, titleSize, iconSize, timeSize = 9) {
  return {
    type: 'stack', direction: 'row', alignItems: 'center', gap: 6,
    children: [
      titleRow(meter.name, '#FFBE3F', titleSize, iconSize),
      { type: 'spacer' },
      text(formatTime(meter.dataAt), timeSize, stale ? C.warn : C.dim, 'medium', { minScale: 0.7 })
    ]
  };
}

function usageValue(value) {
  return Number.isFinite(value) ? value.toFixed(2) : '--';
}

function usageDateLabel(timestamp) {
  const date = new Date(timestamp);
  return `${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}`;
}

function recentUsage(data, count) {
  const usage = Array.isArray(data.usage) ? data.usage : [];
  return usage.slice(-count);
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

function refreshAfter(ctx) {
  const hours = numberEnv(ctx, 'REFRESH_HOURS', 1, 0.25, 24);
  return new Date(Date.now() + hours * 3600000).toISOString();
}

function emptyWidget(data, ctx, family) {
  const compact = family === 'systemSmall';
  return {
    type: 'widget',
    ...rootBackground(ctx),
    padding: compact ? 16 : 20,
    gap: 8,
    refreshAfter: refreshAfter(ctx),
    children: [
      {
        type: 'stack', direction: 'row', alignItems: 'center',
        children: [
          titleRow(data.name || '电量监控', '#FF626A', compact ? 11 : 12, compact ? 11 : 13),
          { type: 'spacer' },
          text('--', compact ? 9 : 10, C.dim, 'medium')
        ]
      },
      { type: 'spacer' },
      text('--', compact ? 32 : 40, C.fail, 'bold', {
        font: { size: compact ? 32 : 40, weight: 'bold', family: 'Menlo' }
      }),
      text(data.error || '读取失败', 10, C.dim, 'medium', { maxLines: 2, minScale: 0.65 }),
      { type: 'spacer' }
    ]
  };
}

function balanceValue(meter, color, size) {
  return {
    type: 'stack', direction: 'row', alignItems: 'end', gap: 6,
    children: [
      text(formatFixed(meter.remaining), size, color, 'bold', {
        font: { size, weight: 'bold', family: 'Menlo' }, minScale: 0.5
      }),
      text('度', size >= 40 ? 13 : 11, C.dim, 'semibold'),
      { type: 'spacer' }
    ]
  };
}

function usageBarRow(label, item, maxValue) {
  const ratio = Number.isFinite(item?.value) && maxValue > 0 ? item.value / maxValue : 0;
  return {
    type: 'stack', direction: 'row', alignItems: 'center', gap: 4,
    children: [
      text(label, 9, C.dim, 'medium', { width: 27 }),
      {
        type: 'stack', width: 42, height: 6,
        children: ratio > 0 ? [
          {
            type: 'stack', width: Math.max(3, 42 * ratio), height: 6,
            backgroundColor: C.ok, borderRadius: 3
          },
          { type: 'spacer' }
        ] : []
      },
      { type: 'spacer' },
      text(usageValue(item?.value), 9, C.text, 'semibold', { width: 35, textAlign: 'right', minScale: 0.7 })
    ]
  };
}

function mediumUsageChart(data) {
  const items = recentUsage(data, 3).reverse();
  while (items.length < 3) items.push(null);
  const maxValue = Math.max(1, ...items.map(item => Number.isFinite(item?.value) ? item.value : 0));
  const labels = ['今天', '昨天', '前天'];
  return {
    type: 'stack', direction: 'column', flex: 1, gap: 9,
    children: [
      text('近三日用电 / 度', 10, C.dim, 'bold'),
      ...items.map((item, index) => usageBarRow(labels[index], item, maxValue))
    ]
  };
}

function sevenDayUsageChart(data, extraLarge = false) {
  const items = recentUsage(data, 7);
  const maxValue = Math.max(1, ...items.map(item => Number.isFinite(item?.value) ? item.value : 0));
  const normalized = [...items];
  while (normalized.length < 7) normalized.unshift(null);
  const maxBarHeight = extraLarge ? 78 : 62;

  return {
    type: 'stack', direction: 'row', height: extraLarge ? 118 : 102, gap: extraLarge ? 12 : 6,
    children: normalized.map(item => {
      const ratio = Number.isFinite(item?.value) && maxValue > 0 ? item.value / maxValue : 0;
      const barHeight = ratio > 0 ? Math.max(3, maxBarHeight * ratio) : 2;
      return {
        type: 'stack', direction: 'column', flex: 1, alignItems: 'center', gap: 3,
        children: [
          { type: 'spacer' },
          text(usageValue(item?.value), extraLarge ? 10 : 8, C.text, 'semibold', { textAlign: 'center', minScale: 0.55 }),
          {
            type: 'stack', width: extraLarge ? 21 : 16, height: barHeight,
            backgroundColor: C.ok,
            opacity: Number.isFinite(item?.value) ? 1 : 0,
            borderRadius: 4
          },
          text(item ? usageDateLabel(item.timestamp) : '--', extraLarge ? 9 : 8, C.dim, 'medium', { textAlign: 'center', minScale: 0.65 })
        ]
      };
    })
  };
}

function smallHomeWidget(data, ctx) {
  const meter = data.meter;
  const color = statusColor(data);
  return {
    type: 'widget', ...rootBackground(ctx), padding: [16, 17], gap: 7,
    refreshAfter: refreshAfter(ctx),
    children: [
      headerRow(meter, meter.stale, 11, 11, 9),
      { type: 'spacer' },
      balanceValue(meter, color, 31),
      { type: 'spacer' }
    ]
  };
}

function mediumHomeWidget(data, ctx) {
  const meter = data.meter;
  const color = statusColor(data);
  return {
    type: 'widget', ...rootBackground(ctx), padding: [17, 19], gap: 8,
    refreshAfter: refreshAfter(ctx),
    children: [
      headerRow(meter, meter.stale, 11, 12, 9),
      {
        type: 'stack', direction: 'row', flex: 1, gap: 13,
        children: [
          {
            type: 'stack', direction: 'column', width: 142,
            children: [
              { type: 'spacer' },
              balanceValue(meter, color, 31),
              { type: 'spacer' }
            ]
          },
          { type: 'stack', width: 1, backgroundColor: C.line, borderRadius: 1 },
          mediumUsageChart(data)
        ]
      }
    ]
  };
}

function largeHomeWidget(data, ctx, extraLarge = false) {
  const meter = data.meter;
  const color = statusColor(data);
  return {
    type: 'widget', ...rootBackground(ctx), padding: extraLarge ? [23, 28] : [22, 24], gap: 7,
    refreshAfter: refreshAfter(ctx),
    children: [
      headerRow(meter, meter.stale, extraLarge ? 15 : 13, extraLarge ? 15 : 13, 10),
      { type: 'spacer', length: 6 },
      balanceValue(meter, color, extraLarge ? 51 : 43),
      { type: 'spacer', length: 12 },
      { type: 'stack', height: 1, backgroundColor: C.line },
      { type: 'spacer', length: 8 },
      text('近 7 日用电 / 度', 11, C.dim, 'bold'),
      sevenDayUsageChart(data, extraLarge)
    ]
  };
}

function homeWidget(data, ctx, family) {
  if (!data.meter) return emptyWidget(data, ctx, family);
  if (family === 'systemSmall') return smallHomeWidget(data, ctx);
  if (family === 'systemLarge') return largeHomeWidget(data, ctx, false);
  if (family === 'systemExtraLarge') return largeHomeWidget(data, ctx, true);
  return mediumHomeWidget(data, ctx);
}

function accessoryWidget(data, family) {
  if (!data.meter) return { type: 'widget', children: [text('电量 --', 12, C.text, 'semibold')] };
  const meter = data.meter;
  const color = statusColor(data);
  if (family === 'accessoryInline') {
    return {
      type: 'widget',
      children: [text(`${meter.name} ${formatFixed(meter.remaining)}度 · ${formatTime(meter.dataAt, true)}`, 12, C.text, 'semibold')]
    };
  }
  if (family === 'accessoryCircular') {
    return {
      type: 'widget', padding: 3,
      children: [
        text(formatFixed(meter.remaining), 12, color, 'bold', { textAlign: 'center', minScale: 0.55 }),
        text('度', 9, C.text, 'medium', { textAlign: 'center' })
      ]
    };
  }
  return {
    type: 'widget', gap: 2,
    children: [
      {
        type: 'stack', direction: 'row', alignItems: 'center', gap: 4,
        children: [
          { type: 'image', src: iconSrc('#FFBE3F'), width: 10, height: 10, resizeMode: 'contain' },
          text(meter.name, 10, C.text, 'semibold', { minScale: 0.65 })
        ]
      },
      text(`${formatFixed(meter.remaining)} 度`, 15, color, 'bold', { minScale: 0.65 }),
      {
        type: 'stack', direction: 'row',
        children: [
          { type: 'spacer' },
          text(formatTime(meter.dataAt, true), 9, C.dim, 'medium')
        ]
      }
    ]
  };
}

export default async function(ctx) {
  const family = ctx.widgetFamily || 'systemMedium';
  const includeUsage = ['systemMedium', 'systemLarge', 'systemExtraLarge'].includes(family);
  const data = await loadData(ctx, includeUsage);
  if (family.startsWith('accessory')) return accessoryWidget(data, family);
  return homeWidget(data, ctx, family);
}
