// Isolated API-contract/load simulation. Never sends requests to Meta or production R2.
// The 200 MiB fixture tests byte transport, not whether Meta accepts/decodes a video.
import assert from 'node:assert/strict';
import { mkdtemp, open, rm, writeFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { publishDraft } from '../src/publisher.js';
import { createMetaClient } from '../src/meta-client.js';
import { prepareWorkflowMedia } from '../src/workflow-media.js';

const size = 200 * 1024 * 1024;
const directory = await mkdtemp(join(tmpdir(), 'meta-load-'));
const fixture = join(directory, 'transport-fixture.bin');
const file = await open(fixture, 'w');
await file.truncate(size);
await file.write(Buffer.from('TRANSPORT SIMULATION; NOT AN ENCODED VIDEO'), 0, 41, 0);
await file.close();
const source = createServer((_request, response) => {
  response.writeHead(200, { 'content-length': size, 'content-type': 'application/octet-stream' });
  createReadStream(fixture).pipe(response);
});
source.listen(0, '127.0.0.1');
await once(source, 'listening');
const sourceUrl = `http://127.0.0.1:${source.address().port}/fixture`;
const reports = [];

function draft(unique = false) {
  return { campaigns: Array.from({ length: 10 }, (_, c) => ({
    clientId: `campaign-${c}`, name: `Campaign ${c}`, adAccountId: 'act_1', pageId: 'page_1',
    specialAdCategory: 'NONE', budgetStrategy: 'AD_SET', dailyBudget: 0,
    adSets: Array.from({ length: 5 }, (_, s) => ({
      clientId: `set-${c}-${s}`, name: `Set ${c}-${s}`, dailyBudget: 100000,
      locationMode: 'REGIONS', includedRegions: [{ key: '3984', countryCode: 'VN' }],
      excludedRegions: [], ageMin: 18, ageMax: 45, genders: [], includedCustomAudienceIds: [],
      excludedCustomAudienceIds: [], detailedTargeting: [], advantageAudienceEnabled: false,
      startTime: '', endTime: '', ads: [{
        clientId: `ad-${c}-${s}`, name: `Ad ${c}-${s}`, primaryText: 'Simulation', headline: 'Simulation',
        mediaId: unique ? `media-${c}-${s}` : 'shared-media',
        conversation: { sourceTemplateId: null, templateName: 'Simulation', greeting: 'Hello',
          quickReplies: [], showBusinessPhoneNumber: false, businessPhoneNumber: '',
          customerActions: [{ id: 'button', label: 'Open', type: 'OPEN_URL', value: 'https://example.com' }] }
      }]
    }))
  })) };
}

function harness({ transfer = false, processing = false, processingUntil, malformedCampaign = false, stallCampaign = false } = {}) {
  const calls = {};
  let bytes = 0, controlBytes = 0, active = 0, peak = 0, clock = 0;
  const saved = new Map();
  const getMedia = async (_owner, id) => ({ id, name: `${id}.mp4`, mimeType: 'video/mp4', sizeBytes: size, sourceUrl });
  const client = createMetaClient({ apiVersion: 'v24.0' }, { fetchImpl: async (input, options = {}) => {
    const url = new URL(input);
    assert.ok(['graph.facebook.com', 'graph-video.facebook.com'].includes(url.hostname));
    const edge = url.pathname.split('/').at(-1);
    const key = `${options.method ?? 'GET'} ${edge}`;
    calls[key] = (calls[key] ?? 0) + 1;
    const ordinal = calls[key];
    active++; peak = Math.max(peak, active);
    try {
      let payload;
      if (options.method === 'POST') {
        if (edge === 'campaigns' && stallCampaign) {
          await new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }));
        }
        controlBytes += Buffer.byteLength(String(options.body ?? ''));
        if (edge === 'advideos' && transfer) {
          const target = new URL(new URLSearchParams(options.body).get('file_url'));
          assert.equal(target.origin, new URL(sourceUrl).origin);
          const result = await fetch(target);
          let received = 0;
          for await (const chunk of result.body) received += chunk.length;
          assert.equal(received, size);
          bytes += received;
        }
        if (edge === 'campaigns' && malformedCampaign && calls[key] === 1) return new Response('{');
        payload = { id: `${edge}-${ordinal}` };
      } else if (edge.startsWith('advideos-')) {
        payload = { status: { video_status: processing && (processingUntil === undefined || clock < processingUntil) ? 'processing' : 'ready' }, thumbnails: { data: [{ uri: 'https://example.com/thumb.jpg' }] } };
      } else payload = { creative: {} };
      return Response.json(payload, { headers: { 'x-app-usage': '{"call_count":0}' } });
    } finally { active--; }
  } });
  return {
    client, calls, saved, getMedia,
    now: () => clock, delay: async ms => { clock += ms; },
    stats: () => ({ calls, bytesTransferred: bytes, controlRequestBytes: controlBytes, peakMockRequests: peak, simulatedMs: clock }),
    base: { token: 'simulation-token', runId: 'simulation', ownerMetaUserId: `simulation-${Math.random()}`,
      metaClient: client, getMedia, concurrency: 3,
      getMetaVideoId: async (_owner, id) => saved.get(id),
      saveMetaVideoId: async (_owner, id, _account, video) => { saved.set(id, video); } }
  };
}

try {
  for (const unique of [false, true]) {
    const h = harness({ transfer: true });
    const started = performance.now();
    const result = await publishDraft({ ...h.base, draft: draft(unique) });
    assert.equal(result.complete, true);
    assert.equal(result.nodes.length, 110);
    assert.ok(result.nodes.every(node => node.status === 'created' && node.remoteId),
      JSON.stringify(result.nodes.find(node => node.status !== 'created' || !node.remoteId)));
    assert.equal(h.calls['POST campaigns'], 10);
    assert.equal(h.calls['POST adsets'], 50);
    assert.equal(h.calls['POST ads'], 50);
    assert.equal(h.calls['POST advideos'], unique ? 50 : 1);
    assert.equal(h.saved.size, unique ? 50 : 1);
    assert.equal(new Set(h.saved.values()).size, unique ? 50 : 1);
    reports.push({ scenario: unique ? '50 distinct 200 MiB files' : 'one shared 200 MiB file',
      created: 110, elapsedMs: Math.round(performance.now() - started), ...h.stats() });
    console.log(JSON.stringify(reports.at(-1)));
  }

  const slow = harness({ processing: true });
  const slowResult = await publishDraft({ ...slow.base, draft: draft(), concurrency: 1,
    now: slow.now, delay: slow.delay });
  assert.equal(slowResult.nodes.filter(node => node.type === 'ad' && node.status === 'retry_pending').length, 50);
  assert.equal(slowResult.nodes.filter(node => node.status === 'failed').length, 0);
  reports.push({ scenario: 'direct mode: video still processing after one hour',
    pendingAds: 50, failedAds: 0, message: slowResult.nodes.find(node => node.type === 'ad').error.message, ...slow.stats() });

  const eventually = harness({ processing: true, processingUntil: 180_000 });
  const eventualResult = await publishDraft({ ...eventually.base, draft: draft(), concurrency: 1,
    now: eventually.now, delay: eventually.delay });
  assert.equal(eventualResult.nodes.filter(node => node.type === 'ad' && node.status === 'created').length, 50);
  reports.push({ scenario: 'video becomes ready after three minutes', createdAds: 50, ...eventually.stats() });

  const pending = harness({ processing: true });
  const prepared = await prepareWorkflowMedia({ ...pending.base, draft: draft(),
    getMedia: id => pending.getMedia(null, id), updateNodeResult: async () => {} });
  assert.equal(prepared.pending, true);
  assert.equal(prepared.failed, 0);
  reports.push({ scenario: 'workflow mode: processing video stays pending', result: prepared });

  const delayed = harness({ stallCampaign: true });
  const original = delayed.client.createCampaign;
  let receivedSignal;
  delayed.client.createCampaign = async (...args) => {
    receivedSignal = args[3]?.signal;
    return original(...args);
  };
  const started = Date.now();
  const deadlineResult = await publishDraft({ ...delayed.base, draft: draft(), concurrency: 1,
    deadlineAt: started + 20, onDeadline: 'return' });
  assert.ok(Date.now() - started < 500);
  assert.ok(receivedSignal?.aborted);
  assert.equal(deadlineResult.deadlineHit, true);
  assert.equal(deadlineResult.nodes[0].error.type, 'UncertainMetaWriteError');
  reports.push({ scenario: '20ms deadline aborts a stalled write and requires review',
    elapsedMs: Date.now() - started, requestSignalPresent: Boolean(receivedSignal),
    deadlineHit: deadlineResult.deadlineHit });

  const malformed = harness({ malformedCampaign: true });
  const corrupt = await publishDraft({ ...malformed.base, draft: draft() });
  const broken = corrupt.nodes.find(node => node.clientId === 'campaign-0');
  assert.equal(broken.status, 'failed');
  assert.equal(broken.error.type, 'UncertainMetaWriteError');
  assert.equal(broken.remoteId, undefined);
  assert.ok(!corrupt.nodes.some(node => node.status === 'created' && !node.remoteId));
  reports.push({ scenario: 'HTTP200 campaign response with invalid JSON',
    campaignStatus: broken.status, remoteIdMissing: true,
    skippedChildren: corrupt.nodes.filter(node => node.status === 'skipped').length });

  const output = process.argv[2];
  if (output) await writeFile(output, JSON.stringify({ at: new Date().toISOString(), fixtureBytes: size,
    caveat: 'Local mock API and binary transport fixture; not a Meta video decode or production throughput test.', reports }, null, 2));
  console.log(JSON.stringify({ scenarios: reports.length, assertions: 'passed', reports: reports.slice(2) }, null, 2));
} finally {
  source.close();
  source.closeAllConnections();
  await rm(directory, { recursive: true, force: true });
}
