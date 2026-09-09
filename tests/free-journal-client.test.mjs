import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

for (const page of ['index.html', 'start-here/index.html', 'journals/index.html']) {
  for (const outcome of ['success', 'kit-failure', 'server-failure']) {
    test(`${page}: ${outcome} uses only server request and preserves access/retry behavior`, async () => {
      const html = await readFile(new URL('../' + page, import.meta.url), 'utf8');
      const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).find(s => s.includes('var ENDPOINT'));
      const note = { children: [], appendChild(node) { this.children.push(node); } };
      const button = { disabled: false, textContent: 'Original label' };
      let listener, resets = 0;
      const form = {
        email: { value: 'test@example.invalid' },
        parentNode: { querySelector: () => note },
        querySelector: () => button,
        addEventListener: (_, callback) => { listener = callback; },
        reset: () => { resets++; }
      };
      const calls = [], stored = new Map();
      const body = outcome === 'success' ? { ok: true } : { ok: false, journal_access: outcome === 'kit-failure' };
      vm.runInNewContext(script, {
        document: { querySelectorAll: () => [form], createElement: tag => ({ tag }), createTextNode: text => ({ text }) },
        localStorage: { setItem: (key, value) => stored.set(key, value) },
        FormData: class { forEach(callback) { callback(form.email.value, 'email'); callback(page === 'journals/index.html' ? 'library-free-journals' : 'grounded-waitlist', '_form'); } },
        fetch: async (url, options) => { calls.push({ url, options }); return { ok: outcome === 'success', json: async () => body }; }
      });
      listener({ preventDefault() {} });
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(calls.length, 1);
      assert.equal(calls[0].url, '/api/submit');
      assert.equal(button.disabled, false);
      assert.equal(button.textContent, 'Original label');
      assert.equal(stored.get('tge-gate-unlocked'), outcome === 'server-failure' ? undefined : '1');
      assert.equal(resets, outcome === 'success' ? 1 : 0);
      assert.equal(note.className, outcome === 'success' ? 'note ok' : 'note err');
      if (outcome === 'kit-failure') {
        assert.match(note.children.at(-1).text, /try again/);
        if (page !== 'journals/index.html') assert.match(note.innerHTML, /href="\/journals\/"/);
      }
    });
  }
}
