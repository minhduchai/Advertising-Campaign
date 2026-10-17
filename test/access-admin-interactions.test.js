import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

test('admin sees pending Meta logins, grants the exact ID, and auto-refresh preserves form notes', async () => {
  class Element {
    children = []; events = {}; value = ''; textContent = '';
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
    add(child) { this.children.push(child); }
    addEventListener(name, action) { this.events[name] = action; }
  }
  const nodes = new Map();
  const node = selector => {
    if (!nodes.has(selector)) nodes.set(selector, new Element());
    return nodes.get(selector);
  };
  const form = node('#access-form');
  form.elements = { metaUserId: node('[name="metaUserId"]'), label: new Element(), facebookUrl: new Element() };
  form.elements.label.value = 'Unsaved note';
  const document = { hidden: false, title: '', querySelector: node, createElement: () => new Element(), addEventListener() {} };
  const profiles = [{ id: '456', name: '<Mỹ Thi>', lastSeen: 1792200487534 }];
  const users = [{ id: '123', admin: true }];
  let timer; let timerMs; let reads = 0;
  const writes = [];
  runInNewContext(readFileSync(new URL('../public/access-admin.js', import.meta.url), 'utf8'), {
    document, Option: function(text, value) { this.textContent = text; this.value = value; },
    setInterval: (action, ms) => { timer = action; timerMs = ms; },
    fetch: async (path, options = {}) => {
      if (options.method === 'POST') {
        const input = JSON.parse(options.body);
        writes.push(input);
        if (input.allowed) users.push({ id: input.metaUserId, admin: false });
      } else reads++;
      return { ok: true, json: async () => ({ profiles, users }) };
    }
  });
  const flush = () => new Promise(resolve => setImmediate(resolve));
  await flush();
  assert.equal(node('#access-pending').children.length, 1);
  assert.equal(node('#access-pending').children[0].children[0].textContent, '<Mỹ Thi>');
  assert.match(document.title, /^\(1\)/);
  assert.equal(timerMs, 15_000);
  const approve = node('#access-pending').children[0].children[2];
  await approve.events.click();
  assert.deepEqual(writes[0], { metaUserId: '456', allowed: true });
  assert.equal(node('#access-pending').children.length, 0);
  assert.equal(form.elements.label.value, 'Unsaved note');
  profiles.push({ id: '789', name: 'New user', lastSeen: 1792200487534 });
  timer(); await flush();
  assert.equal(node('#access-pending').children.length, 1);
  assert.match(document.title, /^\(1\)/);
  document.hidden = true;
  const before = reads;
  timer(); await flush();
  assert.equal(reads, before);
});
