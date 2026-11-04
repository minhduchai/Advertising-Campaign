import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { addCampaign, archiveCompletedCampaigns, createWorkspaceState } from '../public/state.js';
import { createPublishProgress, mergeRunSnapshot } from '../public/run-progress.js';

const source = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
function functionSource(name) {
  const start = source.search(new RegExp(`(?:async )?function ${name}\\(`));
  return start < 0 ? '' : source.slice(start, source.indexOf('\n}', start) + 2);
}

function fixture(statuses = ['pending']) {
  let id = 0;
  const state = createWorkspaceState({ randomId: () => `node-${++id}` });
  for (let index = 1; index < statuses.length; index++) addCampaign(state, () => `node-${++id}`);
  for (const campaign of state.draft.campaigns) {
    campaign.seeding = { enabled: true, items: [{ id: `item-${campaign.clientId}`, message: 'Hello' }] };
  }
  const snapshot = structuredClone(state.draft);
  const nodes = snapshot.campaigns.flatMap(campaign => [
    { clientId: campaign.clientId, type: 'campaign', status: 'created' },
    ...campaign.adSets.flatMap(adSet => [
      { clientId: adSet.clientId, parentClientId: campaign.clientId, type: 'adSet', status: 'created' },
      ...adSet.ads.map(ad => ({ clientId: ad.clientId, parentClientId: adSet.clientId, type: 'ad', status: 'created', postId: `page_${ad.clientId}` }))
    ])
  ]);
  function seeding(jobStatuses) {
    const jobs = snapshot.campaigns.map((campaign, index) => ({
      id: `job-${index}`, campaignClientId: campaign.clientId,
      postId: `page_${campaign.adSets[0].ads[0].clientId}`, status: jobStatuses[index]
    }));
    return { jobs, summary: {
      total: jobs.length,
      ...Object.fromEntries(['pending', 'posting', 'created', 'failed', 'cancelled'].map(status => [status, jobs.filter(job => job.status === status).length])),
      needsReview: jobs.filter(job => job.status === 'needs_review').length
    }, conflicts: [], waitingPostCount: 0, waitingCampaignCount: 0 };
  }
  const run = { id: 'run-1', status: 'completed', snapshot, nodes, seeding: seeding(statuses) };
  state.publishProgress = createPublishProgress(state.draft);
  mergeRunSnapshot(state.publishProgress, run);
  const calls = { renders: 0, saved: [], loads: 0 };
  let callbacks;
  let clock = 0;
  const context = {
    state, structuredClone, mergeRunSnapshot, archiveCompletedCampaigns,
    completedRunMonitors: new Map(), publishRecoveryTimeoutMs: 60 * 60_000,
    Date: { now: () => clock }, document: { hidden: false },
    wait: async () => { clock += 60_000; },
    api: { loadRun: async () => { calls.loads++; return structuredClone(run); } },
    createSeedingRunner: options => { callbacks = options; return {}; },
    draftStorage: { save: () => calls.saved.push(structuredClone(state.draft)) },
    render: () => { calls.renders++; context.draftStorage.save(state); },
    renderResultsDrawer() {}, renderHistoryWorkspace() {}, renderWorkspaceTreeProgress() {},
    syncLiveActivityHistory() {}, captureDrawerFocus() {}, restoreDrawerFocus() {},
    resultsDrawer: {}, historyWorkspace: {}, showToast() {},
    applySeedingState: (runId, value) => {
      if (state.publishProgress.runId === runId) mergeRunSnapshot(state.publishProgress, { seeding: value });
    }
  };
  const runnerStart = source.indexOf('const seedingRunner = createSeedingRunner(');
  const runner = source.slice(runnerStart, source.indexOf('\n});', runnerStart) + 4);
  runInNewContext([
    functionSource('archiveCompletedRunCampaigns'),
    functionSource('synchronizeCompletedRunProgress'),
    functionSource('monitorCompletedRun'), runner
  ].join('\n'), context);
  return { state, run, snapshot, calls, context, callbacks, seeding };
}

test('authoritative completion sync archives successful campaigns after the short monitor has ended', async () => {
  const f = fixture();
  const originalId = f.snapshot.campaigns[0].clientId;
  f.run.seeding = f.seeding(['created']);
  await f.context.synchronizeCompletedRunProgress('run-1');
  assert.ok(!f.state.draft.campaigns.some(campaign => campaign.clientId === originalId));
  assert.equal(f.calls.renders, 1);
  assert.equal(f.calls.saved.length, 1);
  assert.equal(f.state.publishProgress.snapshot.campaigns[0].clientId, originalId);
  await f.context.synchronizeCompletedRunProgress('run-1');
  assert.equal(f.calls.renders, 1, 'repeated completion must not archive the replacement draft');
});

test('live completion removes only successful campaigns, retaining errors, review and active jobs', () => {
  const f = fixture(['pending', 'pending', 'pending', 'pending', 'pending']);
  const originalIds = f.snapshot.campaigns.map(campaign => campaign.clientId);
  f.callbacks.onUpdate(f.seeding(['created', 'failed', 'needs_review', 'pending', 'posting']), { runId: 'run-1' });
  assert.deepEqual(f.state.draft.campaigns.map(campaign => campaign.clientId), originalIds.slice(1));
  assert.equal(f.calls.renders, 1);
  assert.equal(f.calls.saved.length, 1);
});

test('ordinary seeding updates and another run never clear the draft or fully rerender it', async () => {
  const f = fixture();
  const before = structuredClone(f.state.draft);
  f.callbacks.onUpdate(f.seeding(['pending']), { runId: 'run-1' });
  f.callbacks.onUpdate(f.seeding(['created']), { runId: 'other-run' });
  await f.context.synchronizeCompletedRunProgress('other-run');
  assert.deepEqual(f.state.draft, before);
  assert.equal(f.calls.renders, 0);
});

test('a successful seeding stop archives through the authoritative refresh', async () => {
  const f = fixture();
  const originalId = f.snapshot.campaigns[0].clientId;
  f.run.seeding = f.seeding(['created']);
  f.callbacks.onStop({ runId: 'run-1', state: f.run.seeding, reason: 'complete' });
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(!f.state.draft.campaigns.some(campaign => campaign.clientId === originalId));
});

test('an old response arriving after another run starts cannot archive its draft', async () => {
  const f = fixture();
  const before = structuredClone(f.state.draft);
  let resolveRun;
  f.context.api.loadRun = () => new Promise(resolve => { resolveRun = resolve; });
  const pendingSync = f.context.synchronizeCompletedRunProgress('run-1');
  f.state.publishProgress.runId = 'new-run';
  resolveRun({ ...f.run, seeding: f.seeding(['created']) });
  await pendingSync;
  assert.deepEqual(f.state.draft, before);
  assert.equal(f.calls.renders, 0);
});

test('background completion beyond three minutes still refreshes and archives the draft', async () => {
  const f = fixture();
  const originalId = f.snapshot.campaigns[0].clientId;
  f.context.api.loadRun = async () => {
    f.calls.loads++;
    return { ...f.run, seeding: f.seeding([f.calls.loads >= 4 ? 'created' : 'pending']) };
  };
  f.context.monitorCompletedRun('run-1');
  await f.context.completedRunMonitors.get('run-1');
  assert.equal(f.calls.loads, 4);
  assert.ok(!f.state.draft.campaigns.some(campaign => campaign.clientId === originalId));
});

test('a hidden tab does not poll and the recovery monitor remains bounded', async () => {
  const f = fixture();
  f.context.document.hidden = true;
  f.context.monitorCompletedRun('run-1');
  await f.context.completedRunMonitors.get('run-1');
  assert.equal(f.calls.loads, 0);
  assert.equal(f.context.completedRunMonitors.size, 0);
  assert.equal(f.calls.renders, 0);
});
