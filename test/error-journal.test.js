import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { configureErrorJournal, withErrorContext, recordError, readErrorJournal, redactErrorText } from '../src/error-journal.js';
import { createMetaClient } from '../src/meta-client.js';
import { createServer } from '../src/server.js';
import { createDatabase } from '../src/db.js';
import { signSession } from '../src/crypto.js';
import { request, testConfig } from './helpers.js';
import { sendJson } from '../src/http.js';

async function journal(t) {
  const directory = await mkdtemp(join(tmpdir(), 'campaign-error-journal-'));
  configureErrorJournal({ directory, secrets: ['configured-secret'] });
  t.after(async () => { configureErrorJournal(); await rm(directory, { recursive: true, force: true }); });
  return directory;
}

test('client-error floods have a global write budget and successful responses still work', async t => {
  await journal(t);
  const response = { setHeader() {}, writeHead() {}, end() {} };
  for (let index = 0; index < 100; index++) sendJson(response, 401, { error: 'Unauthorized' });
  assert.equal((await readErrorJournal({})).total, 60);
  assert.doesNotThrow(() => sendJson(response, 200, { ok: true }));
  recordError(new Error('server failure'), { stage: 'api', statusCode: 500 });
  assert.equal((await readErrorJournal({})).total, 61);
});

test('rotation retains a bounded archive and includes it in journal reads', async t => {
  const directory = await journal(t);
  const path = join(directory, 'system.jsonl');
  for (let index = 0; index < 5; index++) {
    await writeFile(path, JSON.stringify({ id: `old-${index}`, error: { message: 'archived' } }) + ' '.repeat(10 * 1024 * 1024));
    recordError(new Error(`new-${index}`));
  }
  const report = await readErrorJournal({});
  assert.deepEqual(report.events.map(event => event.id).slice(1), ['old-4', 'old-3', 'old-2']);
  await assert.rejects(readFile(`${path}.4`), { code: 'ENOENT' });
});

test('body failures measure elapsed time through body consumption', async t => {
  await journal(t);
  const client = createMetaClient({ apiVersion: 'v24.0' }, {
    fetchImpl: async () => new Response(new ReadableStream({ start(controller) {
      setTimeout(() => controller.error(Object.assign(new Error('body timeout'), { code: 'UND_ERR_BODY_TIMEOUT' })), 100);
    } }))
  });
  await withErrorContext({ ownerMetaUserId: 'timing' }, () => client.getProfile('fake').catch(() => {}));
  const { events } = await readErrorJournal({ ownerMetaUserId: 'timing' });
  assert.equal(events[0].error.code, 'UND_ERR_BODY_TIMEOUT');
  assert.ok(events[0].durationMs >= 90);
  assert.ok(events[0].durationMs > events[0].headersDurationMs);
});

test('keeps the original network failure after a successful retry, with causes and credentials redacted', async t => {
  await journal(t);
  let calls = 0;
  const original = new TypeError('fetch failed configured-secret', { cause: new AggregateError([
    Object.assign(new Error('connect ETIMEDOUT Bearer page-private-token'), { code: 'ETIMEDOUT', syscall: 'connect', address: '192.0.2.1', port: 443 }),
    Object.assign(new Error('connect https://example.com/?access_token=page-private-token'), { code: 'ENETUNREACH' })
  ]) });
  original.message = 'fetch failed';
  const client = createMetaClient({ apiVersion: 'v24.0' }, {
    fetchImpl: async () => { if (++calls === 1) throw original; return Response.json({ id: 'created-campaign' }); },
    networkRetryDelay: async () => {}
  });
  await withErrorContext({ ownerMetaUserId: 'owner-a', runId: 'run-a', clientId: 'campaign-a' }, async () => {
    assert.equal(await client.createCampaign('page-private-token', 'act_1', new URLSearchParams()), 'created-campaign');
    // The caller no longer has the Page token; re-recording must retain the already-redacted cause tree.
    recordError(original, { stage: 'caller' });
  });
  const report = await readErrorJournal({ ownerMetaUserId: 'owner-a', runId: 'run-a' });
  assert.equal(report.total, 2);
  const event = report.events.find(event => event.stage === 'meta-request');
  assert.equal(event.retrying, true);
  assert.equal(event.attempt, 1);
  assert.equal(event.clientId, 'campaign-a');
  assert.equal(typeof event.durationMs, 'number');
  assert.equal(event.error.cause.errors[0].code, 'ETIMEDOUT');
  assert.equal(event.error.cause.errors[0].syscall, 'connect');
  assert.equal(event.error.cause.errors[0].port, 443);
  assert.match(event.error.stack, /error-journal.test.js/);
  assert.doesNotMatch(JSON.stringify(report), /page-private-token|configured-secret|access_token=page/);
  assert.equal((await readErrorJournal({ ownerMetaUserId: 'owner-b' })).total, 0);
});

test('Meta HTTP errors retain status, code, subcode and fbtrace without raw request bodies', async t => {
  await journal(t);
  const client = createMetaClient({ apiVersion: 'v24.0' }, {
    fetchImpl: async () => Response.json({ error: { message: 'Invalid parameter private-token', type: 'OAuthException',
      code: 100, error_subcode: 123, fbtrace_id: 'trace-a', access_token: 'hidden-token' } }, { status: 400 })
  });
  await withErrorContext({ ownerMetaUserId: 'owner-a', runId: 'run-a' }, async () => {
    try { await client.createCampaign('private-token', 'act_1', new URLSearchParams({ name: 'private-body-name' })); }
    catch (error) { recordError(error, { stage: 'caller' }); }
  });
  const { events } = await readErrorJournal({ ownerMetaUserId: 'owner-a' });
  assert.equal(events.length, 2);
  const event = events.find(event => event.stage === 'meta-response');
  assert.equal(event.statusCode, 400);
  assert.equal(event.error.meta.code, 100);
  assert.equal(event.error.meta.subcode, 123);
  assert.equal(event.error.meta.fbtraceId, 'trace-a');
  assert.doesNotMatch(JSON.stringify(events), /hidden-token|private-token|private-body-name/);
});

test('parallel requests keep their account, run and object context separate', async t => {
  await journal(t);
  const client = createMetaClient({ apiVersion: 'v24.0' }, {
    fetchImpl: async () => {
      await new Promise(resolve => setTimeout(resolve, 5));
      throw new TypeError('fetch failed', { cause: { code: 'ECONNRESET' } });
    }
  });
  await Promise.all(['a', 'b'].map(key => withErrorContext({ ownerMetaUserId: `owner-${key}`,
    runId: `run-${key}`, clientId: `campaign-${key}` }, () =>
    assert.rejects(client.createCampaign(`private-token-${key}`, `act_${key}`, new URLSearchParams())))));
  for (const key of ['a', 'b']) {
    const { events } = await readErrorJournal({ ownerMetaUserId: `owner-${key}` });
    assert.equal(events.length, 1);
    assert.equal(events[0].runId, `run-${key}`);
    assert.equal(events[0].clientId, `campaign-${key}`);
    assert.equal(events[0].path, `/v24.0/act_${key}/campaigns`);
  }
});

test('journal pages and full downloads are isolated by account and by owned run, and escape HTML', async t => {
  await journal(t);
  const config = testConfig();
  const db = createDatabase(':memory:');
  const server = createServer({ config, db, metaClient: {} });
  t.after(() => server.close());
  const cookie = owner => {
    const session = db.createSession();
    db.attachMetaUser(session.id, { id: owner, name: owner });
    return `meta_ads_session=${encodeURIComponent(signSession(session.id, config.sessionSecret))}`;
  };
  const ownerA = cookie('owner-a'), ownerB = cookie('owner-b');
  const run = db.createRun({ ownerMetaUserId: 'owner-a', status: 'completed' });
  for (let i = 0; i < 205; i++) recordError(new Error(`<script>bad-${i}</script>`), {
    ownerMetaUserId: 'owner-a', runId: run.id, stage: 'test' });
  recordError(new Error('Other run'), { ownerMetaUserId: 'owner-a', runId: 'other-run' });
  recordError(new Error('Other account private error'), { ownerMetaUserId: 'owner-b', runId: 'private-run' });
  const route = `/api/runs/${run.id}/errors`;
  assert.equal((await request(server, '/api/errors')).status, 401);
  assert.equal((await request(server, route, { headers: { cookie: ownerB } })).status, 404);
  const page = await request(server, route, { headers: { cookie: ownerA } });
  assert.equal(page.status, 200);
  assert.match(page.body, /205 bản ghi; hiển thị 200/);
  assert.doesNotMatch(page.body, /<script>|Other run|Other account private error/);
  assert.match(page.body, /&lt;script&gt;/);
  const download = await request(server, `${route}?download=1`, { headers: { cookie: ownerA } });
  const events = download.body.trim().split('\n').map(line => JSON.parse(line));
  assert.equal(events.length, 205);
  assert.ok(events.every(event => event.runId === run.id && event.ownerMetaUserId === 'owner-a'));
});

test('a broken log destination never blocks a Meta write or changes its result', async t => {
  const directory = await journal(t);
  const notDirectory = join(directory, 'file');
  await writeFile(notDirectory, 'not a directory');
  configureErrorJournal({ directory: notDirectory });
  let calls = 0;
  const retryClient = createMetaClient({ apiVersion: 'v24.0' }, {
    fetchImpl: async () => {
      if (++calls === 1) throw new TypeError('fetch failed', { cause: { code: 'ENOTFOUND' } });
      return Response.json({ id: 'campaign' });
    },
    networkRetryDelay: async () => {}
  });
  assert.equal(await retryClient.createCampaign('fake', 'act_1', new URLSearchParams()), 'campaign');
  assert.equal(calls, 2);
  const client = createMetaClient({ apiVersion: 'v24.0' }, {
    fetchImpl: async () => Response.json({ error: { message: 'Rejected', code: 100 } }, { status: 400 })
  });
  await assert.rejects(client.createCampaign('fake', 'act_1', new URLSearchParams()), /Rejected/);
  configureErrorJournal({ directory });
  const frozen = Object.freeze(new Error('Frozen error'));
  assert.doesNotThrow(() => recordError(frozen, { ownerMetaUserId: 'owner-a' }));
  assert.equal((await readErrorJournal({ ownerMetaUserId: 'owner-a' })).total, 1);
});

test('crash monitoring writes synchronously while preserving a failing process exit', async t => {
  const directory = await journal(t);
  const moduleUrl = new URL('../src/error-journal.js', import.meta.url).href;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e',
    `import {configureErrorJournal} from ${JSON.stringify(moduleUrl)}; configureErrorJournal({directory:${JSON.stringify(directory)}}); throw new Error('simulated crash');`]);
  assert.notEqual(child.status, 0);
  const event = JSON.parse((await readFile(join(directory, 'system.jsonl'), 'utf8')).trim());
  assert.equal(event.stage, 'process');
  assert.equal(event.error.message, 'simulated crash');
});

test('redacts quoted credentials with spaces and reports a partial corrupted log', async t => {
  const directory = await journal(t);
  assert.doesNotMatch(redactErrorText('"password": "secret with spaces", authorization=Bearer private-token'), /secret with spaces|private-token/);
  recordError(new Error('valid'), { ownerMetaUserId: 'owner-a', runId: 'run-a' });
  const path = join(directory, createHash('sha256').update('owner-a').digest('hex') + '.jsonl');
  const original = await readFile(path, 'utf8');
  await writeFile(path, original + '{unfinished');
  const report = await readErrorJournal({ ownerMetaUserId: 'owner-a' });
  assert.equal(report.total, 1);
  assert.equal(report.unreadableLines, 1);
});
