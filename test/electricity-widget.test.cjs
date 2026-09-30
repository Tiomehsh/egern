const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../widget/electricity-widget.js'), 'utf8');
const api = vm.runInNewContext(
  source.replace('export default async function(ctx)', 'async function renderWidget(ctx)') +
  '\n({loadData, postJson, loginSession, parseResponse});',
  { setTimeout }
);
const meter = {
  measureId: 568639, measureNo: '141241004267', projectId: '8933',
  measureName: '测试电表', remainingPowerNew: '14.39', balanceThreshold: 20,
  remainingPowerTime: '2026-09-30 19:50:03', onlineStatus: '在线'
};
function response(code, data, status = 200, msg = 'success') {
  return { status, json: async () => ({ code, data, msg }) };
}
function context(handler, env = {}, storage = new Map()) {
  const calls = [];
  return {
    env: {
      YYB_API_KEY: 'test-yyb-key', YYB_ACCOUNT_REF: '1', ELECTRICITY_USER_ID: '2086312',
      ELECTRICITY_API_TOKEN: 'old-token', METER_ID: '568639', METER_READ_ENABLED: 'false', ...env
    },
    storage: { getJSON: key => storage.get(key), setJSON: (key, value) => storage.set(key, value) },
    http: { post: async (url, options) => {
      calls.push({ url, ...options });
      return handler(url, options);
    } },
    calls, saved: storage
  };
}
function loginHandler(url, options) {
  if (url.endsWith('/wxapp/getCode')) {
    assert.equal(options.headers.Authorization, 'Bearer test-yyb-key');
    assert.equal(options.body.ref, '1');
    assert.equal(options.body.app_id, 'wxa663a58156eb05b2');
    assert.equal(options.headers.Referer, undefined);
    return response(0, { result: { code: 'one-time-code' } });
  }
  if (url.endsWith('/auth/user/login')) {
    assert.equal(options.headers.Authorization, undefined);
    assert.equal(options.body.code, 'one-time-code');
    assert.equal(options.body.xcxAppId, 'wxa663a58156eb05b2');
    return response(0, { access_token: 'new-token', userId: 2086312 });
  }
  assert.equal(options.headers.Authorization, 'Bearer new-token');
  return response(0, { list: [meter] });
}

test('expired business Token refreshes once and is reused on the next run', async () => {
  const ctx = context((url, options) => {
    if (options.headers.Authorization === 'Bearer old-token') return response(401, null);
    return loginHandler(url, options);
  });
  assert.equal((await api.loadData(ctx)).mode, 'live');
  assert.equal((await api.loadData(ctx)).meter.remaining, 14.39);
  assert.equal(ctx.calls.filter(c => c.url.endsWith('/wxapp/getCode')).length, 1);
  assert.equal(ctx.calls.filter(c => c.url.endsWith('/auth/user/login')).length, 1);
  assert.equal(ctx.calls.length, 5);
  assert.ok([...ctx.saved.values()].some(v => v.token === 'new-token'));
  assert.ok([...ctx.saved.values()].every(v => !JSON.stringify(v).includes('test-yyb-key')));
});

test('no Token bootstraps through YYB', async () => {
  const ctx = context(loginHandler, { ELECTRICITY_API_TOKEN: '' });
  assert.equal((await api.loadData(ctx)).mode, 'live');
  assert.equal(ctx.calls.length, 3);
});

test('valid manual Token keeps working without YYB calls', async () => {
  const ctx = context((url, options) => {
    assert.ok(url.endsWith('/getMeterDataByUser'));
    assert.equal(options.headers.Authorization, 'Bearer old-token');
    return response(0, { list: [meter] });
  }, { YYB_API_KEY: '', YYB_ACCOUNT_REF: '' });
  assert.equal((await api.loadData(ctx)).mode, 'live');
  assert.equal(ctx.calls.length, 1);
});

test('network errors, HTTP 403 and ordinary business failures do not spend YYB quota', async () => {
  for (const failure of [
    () => { throw new Error('network unavailable'); },
    () => response(403, null, 403, 'permission denied'),
    () => response(500, null, 200, '电表服务暂不可用')
  ]) {
    const ctx = context(failure);
    assert.equal((await api.loadData(ctx)).mode, 'error');
    assert.equal(ctx.calls.length, 1);
  }
});

test('HTTP 401 without a JSON body is recognized as expired', async () => {
  const ctx = context((url, options) => {
    if (options.headers.Authorization === 'Bearer old-token') {
      return { status: 401, json: async () => { throw new Error('not JSON'); } };
    }
    return loginHandler(url, options);
  });
  assert.equal((await api.loadData(ctx)).mode, 'live');
});

test('the observed invalid JWT response gets one bounded renewal', async () => {
  const ctx = context((url, options) => {
    if (options.headers.Authorization === 'Bearer old-token') return response(500, null, 200, '网络开小差了!!');
    return loginHandler(url, options);
  });
  assert.equal((await api.loadData(ctx)).mode, 'live');
  assert.equal(ctx.calls.filter(c => c.url.endsWith('/wxapp/getCode')).length, 1);
});

test('persistent ambiguous server failure never loops through YYB', async () => {
  const ctx = context((url, options) => {
    if (url.endsWith('/getMeterDataByUser')) return response(500, null, 200, '网络开小差了!!');
    return loginHandler(url, options);
  });
  assert.equal((await api.loadData(ctx)).mode, 'error');
  assert.equal(ctx.calls.filter(c => c.url.endsWith('/wxapp/getCode')).length, 1);
  assert.equal(ctx.saved.size, 0);
});

test('a mismatched account cannot overwrite the cached login', async () => {
  const ctx = context((url, options) => {
    if (url.endsWith('/auth/user/login')) return response(0, { access_token: 'wrong-token', userId: 99 });
    return loginHandler(url, options);
  }, { ELECTRICITY_API_TOKEN: '' });
  const result = await api.loadData(ctx);
  assert.equal(result.mode, 'error');
  assert.match(result.error, /不匹配/);
  assert.equal(ctx.saved.size, 0);
});

test('login into an account without the target meter does not cache its Token', async () => {
  const ctx = context((url, options) => {
    if (url.endsWith('/getMeterDataByUser')) return response(0, { list: [{ ...meter, measureId: 99 }] });
    return loginHandler(url, options);
  }, { ELECTRICITY_API_TOKEN: '' });
  assert.match((await api.loadData(ctx)).error, /未找到电表/);
  assert.equal(ctx.saved.size, 0);
});

test('YYB quota failure and missing code stop without a login request', async () => {
  for (const reply of [response(429, null, 429, '额度耗尽'), response(0, { result: {} })]) {
    const ctx = context(() => reply, { ELECTRICITY_API_TOKEN: '' });
    assert.equal((await api.loadData(ctx)).mode, 'error');
    assert.equal(ctx.calls.length, 1);
    assert.equal(ctx.saved.size, 0);
  }
});

test('parallel expired requests share one login and both retry with the new Token', async () => {
  const ctx = context((url, options) => {
    if (options.headers.Authorization === 'Bearer old-token') return response(401, null);
    return loginHandler(url, options);
  });
  const session = api.loginSession(ctx);
  await Promise.all([
    api.postJson(ctx, 'https://bb2.minyie.cn/query1', session, {}),
    api.postJson(ctx, 'https://bb2.minyie.cn/query2', session, {})
  ]);
  assert.equal(ctx.calls.filter(c => c.url.endsWith('/wxapp/getCode')).length, 1);
  assert.equal(ctx.calls.filter(c => c.url.endsWith('/auth/user/login')).length, 1);
});

test('rejected new Token does not cause a repeated login loop', async () => {
  const ctx = context((url, options) => {
    if (url.endsWith('/getMeterDataByUser')) return response(401, null);
    return loginHandler(url, options);
  });
  assert.equal((await api.loadData(ctx)).mode, 'error');
  assert.equal(ctx.calls.filter(c => c.url.endsWith('/wxapp/getCode')).length, 1);
  assert.equal(ctx.saved.size, 0);
});

test('changed account configuration cannot reuse another account Token', async () => {
  const saved = new Map();
  const first = context(loginHandler, { ELECTRICITY_API_TOKEN: '' }, saved);
  assert.equal((await api.loadData(first)).mode, 'live');
  const second = context(() => response(429, null, 429, '额度耗尽'), {
    ELECTRICITY_API_TOKEN: '', YYB_ACCOUNT_REF: '2'
  }, saved);
  assert.equal((await api.loadData(second)).mode, 'error');
  assert.ok(second.calls[0].url.endsWith('/wxapp/getCode'));
  assert.equal(second.calls[0].body.ref, '2');
});
