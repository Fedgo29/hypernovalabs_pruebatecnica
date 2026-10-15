const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');
const typescript = require('typescript');

// Execute the production API client with browser globals replaced by test doubles.
// Each VM gets isolated module state, including the in-flight refresh promise.
const source = readFileSync(path.join(__dirname, '../src/api.ts'), 'utf8');
const compiled = typescript.transpileModule(source.replaceAll('import.meta.env', '({})'), {
  compilerOptions: {
    target: typescript.ScriptTarget.ES2022,
    module: typescript.ModuleKind.CommonJS,
  },
}).outputText;

function createClient(fetch) {
  const storage = new Map();
  const events = [];
  const module = { exports: {} };
  vm.runInNewContext(compiled, {
    module,
    exports: module.exports,
    Headers,
    Response,
    DOMException,
    Event,
    fetch,
    sessionStorage: {
      getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: key => storage.delete(key),
    },
    window: { dispatchEvent: event => events.push(event.type) },
  }, { filename: 'admin-api.test-vm.cjs' });
  return { client: module.exports, events, storage };
}

function syntheticSession(label) {
  return {
    accessToken: `synthetic-access-${label}`,
    refreshToken: `synthetic-refresh-${label}`,
    user: {
      id: label,
      email: `${label}@invalid.example`,
      name: label,
      role: 'admin',
    },
  };
}

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

const nextTurn = () => new Promise(resolve => setImmediate(resolve));

for (const refreshStatus of [200, 401]) {
  test(`a previous session's refresh ${refreshStatus} preserves a newer login`, async () => {
    const initial = syntheticSession('initial');
    const latest = syntheticSession('latest');
    const refreshStarted = deferred();
    const refreshResponse = deferred();
    const requests = [];
    const { client, events, storage } = createClient((url, options) => {
      if (url.endsWith('/auth/refresh')) {
        refreshStarted.resolve();
        return refreshResponse.promise;
      }
      requests.push(options.headers.get('Authorization'));
      return Promise.resolve(requests.length === 1
        ? json(401, { code: 'AUTH_INVALID_TOKEN' })
        : json(200, { ok: true }));
    });
    client.saveSession(initial);
    // Attach both handlers immediately so rejected requests never leak a rejection.
    const request = client.api('/admin/events').then(
      value => ({ value }),
      error => ({ error }),
    );
    await refreshStarted.promise;
    client.saveSession(null);
    client.saveSession(latest);
    refreshResponse.resolve(refreshStatus === 200
      ? json(200, syntheticSession('previous-refresh-result'))
      : json(401, { code: 'AUTH_INVALID_REFRESH' }));
    const outcome = await request;

    assert.equal(client.session(), latest);
    assert.equal(JSON.parse(storage.get('hypernova.admin.session')).user.id, latest.user.id);
    assert.deepEqual(events, []);
    if (refreshStatus === 200) {
      assert.deepEqual(outcome.value, { ok: true });
      assert.equal(requests[1], `Bearer ${latest.accessToken}`);
    } else {
      assert.equal(outcome.error.code, 'AUTH_INVALID_REFRESH');
    }
  });
}

test('a transient refresh 500 preserves the current session', async () => {
  const initial = syntheticSession('initial');
  const { client, events } = createClient(url => Promise.resolve(
    url.endsWith('/auth/refresh')
      ? json(500, { code: 'SERVER_UNAVAILABLE', message: 'Retry later' })
      : json(401, { code: 'AUTH_INVALID_TOKEN' }),
  ));
  client.saveSession(initial);

  await assert.rejects(client.api('/admin/events'), error => error.status === 500);
  assert.equal(client.session(), initial);
  assert.deepEqual(events, []);
});

test('simultaneous 401 responses share one refresh and both requests retry', async () => {
  const initial = syntheticSession('initial');
  const fresh = syntheticSession('fresh');
  const refreshStarted = deferred();
  const refreshResponse = deferred();
  let refreshCalls = 0;
  let initialCalls = 0;
  let retryCalls = 0;
  const { client } = createClient((url, options) => {
    if (url.endsWith('/auth/refresh')) {
      refreshCalls += 1;
      refreshStarted.resolve();
      return refreshResponse.promise;
    }
    if (options.headers.get('Authorization') === `Bearer ${initial.accessToken}`) {
      initialCalls += 1;
      return Promise.resolve(json(401, { code: 'AUTH_INVALID_TOKEN' }));
    }
    assert.equal(options.headers.get('Authorization'), `Bearer ${fresh.accessToken}`);
    retryCalls += 1;
    return Promise.resolve(json(200, { ok: true }));
  });
  client.saveSession(initial);
  const requests = Promise.all([client.api('/admin/events'), client.api('/admin/audit')]);
  await refreshStarted.promise;
  await nextTurn();
  assert.equal(refreshCalls, 1);
  refreshResponse.resolve(json(200, fresh));

  assert.deepEqual(await requests, [{ ok: true }, { ok: true }]);
  assert.equal(refreshCalls, 1);
  assert.equal(initialCalls, 2);
  assert.equal(retryCalls, 2);
});

test('a delayed 401 from the old access token reuses the already refreshed session', async () => {
  const initial = syntheticSession('initial');
  const fresh = syntheticSession('fresh');
  const delayedResponse = deferred();
  let refreshCalls = 0;
  let retryCalls = 0;
  const { client } = createClient((url, options) => {
    if (url.endsWith('/auth/refresh')) {
      refreshCalls += 1;
      return Promise.resolve(json(200, fresh));
    }
    if (options.headers.get('Authorization') === `Bearer ${initial.accessToken}`) {
      return url.endsWith('/late')
        ? delayedResponse.promise
        : Promise.resolve(json(401, { code: 'AUTH_INVALID_TOKEN' }));
    }
    assert.equal(options.headers.get('Authorization'), `Bearer ${fresh.accessToken}`);
    retryCalls += 1;
    return Promise.resolve(json(200, { ok: true }));
  });
  client.saveSession(initial);
  const first = client.api('/first');
  const late = client.api('/late');
  assert.deepEqual(await first, { ok: true });
  await nextTurn();
  delayedResponse.resolve(json(401, { code: 'AUTH_INVALID_TOKEN' }));

  assert.deepEqual(await late, { ok: true });
  assert.equal(refreshCalls, 1);
  assert.equal(retryCalls, 2);
  assert.equal(client.session().user.id, fresh.user.id);
});
