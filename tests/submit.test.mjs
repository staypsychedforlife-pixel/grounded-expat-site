import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const source = await readFile(new URL('../functions/api/submit.js', import.meta.url), 'utf8');
const { onRequestPost, onRequestGet } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
const env = { RESEND_API_KEY: 'fake-resend-secret', LEAD_TO: 'inbox@example.invalid', LEAD_FROM: 'sender@example.invalid', KIT_API_KEY: 'fake-kit-secret' };
const signup = { _form: 'grounded-waitlist', email: 'test@example.invalid', name: 'Test' };
const subscriber = { subscription: { subscribable_id: 9638627, subscribable_type: 'form', subscriber: { id: 123 } } };
function response(body = subscriber, status = 201) { return new Response(JSON.stringify(body), { status }); }
function harness(t, handler = () => response()) {
  const calls = [], logs = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, ...options, body: JSON.parse(options.body) });
    return handler(url, options, calls);
  });
  t.mock.method(console, 'error', message => logs.push(message));
  return { calls, logs };
}
function submit(data = signup, environment = env) {
  return onRequestPost({ env: environment, request: new Request('https://site.example.invalid/api/submit', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data)
  }) });
}
test('awaits exact form association, preserving both existing emails', async t => {
  const { calls } = harness(t);
  const result = await submit();
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), { ok: true });
  assert.deepEqual(calls.map(c => c.url), ['https://api.resend.com/emails', 'https://api.resend.com/emails', 'https://api.convertkit.com/v3/forms/9638627/subscribe']);
  assert.deepEqual(calls[0].body.to, [env.LEAD_TO]);
  assert.deepEqual(calls[1].body.to, [signup.email]);
  assert.deepEqual(calls[2].body, { api_key: env.KIT_API_KEY, email: signup.email, first_name: 'Test' });
  assert.ok(calls[2].signal);
});
test('duplicate/retry accepts Kit 200 and reuses distinct Resend idempotency keys', async t => {
  const { calls } = harness(t, () => response(subscriber, 200));
  await submit(); await submit();
  assert.equal(calls[0].headers['Idempotency-Key'], calls[3].headers['Idempotency-Key']);
  assert.equal(calls[1].headers['Idempotency-Key'], calls[4].headers['Idempotency-Key']);
  assert.notEqual(calls[0].headers['Idempotency-Key'], calls[1].headers['Idempotency-Key']);
  assert.ok(!calls[0].headers['Idempotency-Key'].includes(signup.email));
});
test('library is included, whitespace is trimmed, absent name is not overwritten', async t => {
  const { calls } = harness(t);
  assert.equal((await submit({ _form: 'library-free-journals', email: '  test@example.invalid  ' })).status, 200);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1].body, { api_key: env.KIT_API_KEY, email: signup.email });
});
for (const code of [401, 404, 422, 429]) {
  test(`Kit ${code} is not silently successful or immediately retried`, async t => {
    const { calls, logs } = harness(t, url => url.includes('/forms/') ? response({ error: 'PRIVATE ' + signup.email }, code) : response());
    const result = await submit();
    assert.equal(result.status, 502);
    assert.equal((await result.json()).journal_access, true);
    assert.equal(calls.length, 3);
    assert.equal(JSON.parse(logs[0]).stage, 'form');
    assert.equal(JSON.parse(logs[0]).status, code);
    assert.ok(!logs.join('').includes(signup.email));
    assert.ok(!logs.join('').includes('secret'));
  });
}
test('temporary 5xx retries once and succeeds', async t => {
  let attempts = 0;
  harness(t, url => url.includes('/forms/') && ++attempts === 1 ? response({}, 503) : response());
  assert.equal((await submit()).status, 200);
  assert.equal(attempts, 2);
});
test('network timeout is bounded and preserves access on failure', async t => {
  const { calls, logs } = harness(t, url => {
    if (url.includes('api.convertkit.com')) throw new DOMException('sensitive detail', 'TimeoutError');
    return response();
  });
  const result = await submit();
  assert.equal(result.status, 502);
  assert.equal((await result.json()).journal_access, true);
  assert.equal(calls.length, 4);
  assert.equal(logs.length, 2);
  assert.ok(!logs.join('').includes('sensitive'));
});
for (const body of [{}, { subscription: { subscribable_id: 999, subscribable_type: 'form', subscriber: { id: 123 } } }]) {
  test('2xx with missing/wrong form membership is rejected', async t => {
    harness(t, url => url.includes('api.convertkit.com') ? response(body) : response());
    assert.equal((await submit()).status, 502);
  });
}
test('non-JSON provider response never counts as success', async t => {
  harness(t, url => url.includes('api.convertkit.com') ? new Response('<html>bad</html>') : response());
  assert.equal((await submit()).status, 502);
});
test('missing Kit secret retains notification, returns failure and logs no PII', async t => {
  const { calls, logs } = harness(t);
  const result = await submit(signup, { ...env, KIT_API_KEY: undefined });
  assert.equal(result.status, 502);
  assert.equal(calls.length, 2);
  assert.equal(JSON.parse(logs[0]).status, 'missing_key');
});
test('honeypot, invalid email, and invalid JSON shape cause no outbound calls', async t => {
  const { calls } = harness(t);
  assert.equal((await submit({ ...signup, _gotcha: 'bot' })).status, 200);
  for (const data of [{ ...signup, email: 'bad' }, { ...signup, email: ['test@example.invalid'] }, null, []]) {
    assert.equal((await submit(data)).status, 400);
  }
  assert.equal(calls.length, 0);
  assert.equal(onRequestGet().status, 405);
});
test('non-Free-Journal forms do not enroll in Kit', async t => {
  const { calls } = harness(t);
  for (const key of ['contact', 'circle-waitlist', 'gate-first-7-days', 'unknown']) {
    assert.equal((await submit({ ...signup, _form: key })).status, 200);
  }
  assert.equal(calls.length, 4);
  assert.ok(calls.every(c => c.url === 'https://api.resend.com/emails'));
});
test('Resend failure stays retryable and does not expose provider response', async t => {
  harness(t, () => response({ message: signup.email }, 403));
  const result = await submit();
  assert.equal(result.status, 502);
  assert.ok(!(await result.text()).includes(signup.email));
});
test('form-encoded submissions still work', async t => {
  harness(t);
  const result = await onRequestPost({ env, request: new Request('https://site.example.invalid/api/submit', {
    method: 'POST', body: new URLSearchParams(signup)
  }) });
  assert.equal(result.status, 200);
});
test('response cannot resolve before Kit form association finishes', async t => {
  let release, reached;
  const started = new Promise(resolve => { reached = resolve; });
  const pending = new Promise(resolve => { release = resolve; });
  harness(t, url => {
    if (url.includes('/forms/')) { reached(); return pending; }
    return response();
  });
  let done = false;
  const result = submit().then(value => { done = true; return value; });
  await started;
  assert.equal(done, false);
  release(response());
  assert.equal((await result).status, 200);
});
