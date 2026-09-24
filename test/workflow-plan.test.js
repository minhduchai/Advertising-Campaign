import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateMonotonicProgress,
  createWorkflowExecutionPlan,
  createWorkflowPlan,
  workflowStepLogLine,
  WORKFLOW_PUBLISH_BATCH_SIZE
} from '../src/workflow-plan.js';

test('workflow plan orders campaign, ad set, ad, publication and seeding', () => {
  const plan = createWorkflowPlan({ campaigns: [{ clientId: 'c1', name: 'C', adSets: [{ clientId: 's1', name: 'S', ads: [{ clientId: 'a1', name: 'A' }] }], seeding: { items: [{}] } }] });
  assert.deepEqual(plan.map(({ type }) => type), ['campaign', 'adSet', 'ad', 'publication', 'seeding']);
  assert.equal(new Set(plan.map(({ key }) => key)).size, plan.length);
});

test('progress never decreases', () => {
  assert.equal(calculateMonotonicProgress(76, [{ status: 'succeeded' }, { status: 'pending' }]), 76);
  assert.equal(calculateMonotonicProgress(0, [{ status: 'succeeded' }, { status: 'failed' }]), 100);
});

test('execution plan allocates bounded publish and seeding calls', () => {
  const plan = createWorkflowExecutionPlan({ id: 'run-1', execution: { campaigns: [{ clientId: 'c1', seeding: { items: [{}, {}] }, adSets: [{ clientId: 's1', ads: [{ clientId: 'a1' }, { clientId: 'a2' }] }] }] } });
  assert.equal(plan.steps.filter(({ key }) => key.startsWith('publish:')).length, 1);
  assert.equal(plan.steps.filter(({ key }) => /^publication:\d/.test(key)).length, 1);
  assert.equal(plan.steps.filter(({ key }) => key.startsWith('seeding:final:')).length, 2);
});

test('execution plan fetches Post IDs and seeds them before the next publish batch', () => {
  // 10 quảng cáo + 1 nhóm + 1 chiến dịch = 12 node => 2 bước publish với batch 8.
  const plan = createWorkflowExecutionPlan({ id: 'run-live', execution: { campaigns: [{ clientId: 'c1', seeding: { items: [{}, {}] }, adSets: [{ clientId: 's1', ads: Array.from({ length: 10 }, (_, index) => ({ clientId: `a${index + 1}` })) }] }] } });
  const keys = plan.steps.map(({ key }) => key);
  for (const phase of ['publish:1', 'publish:2']) {
    const index = keys.indexOf(phase);
    assert.notEqual(index, -1, `thiếu bước ${phase}`);
    assert.deepEqual(keys.slice(index + 1, index + 4), [
      `publication:realtime:${phase}`,
      `seeding:prepare:${phase}`,
      `seeding:realtime:${phase}`
    ]);
  }
  const finalPublicationIndex = keys.indexOf('publication:1');
  assert.deepEqual(keys.slice(finalPublicationIndex + 1, finalPublicationIndex + 3), [
    'seeding:prepare:publication:1',
    'seeding:realtime:publication:1'
  ]);
});

test('large multi-campaign plans stay below the Cloudflare free subrequest limit', () => {
  const campaigns = Array.from({ length: 10 }, (_, campaignIndex) => ({
    clientId: `c${campaignIndex}`,
    seeding: { items: Array.from({ length: 8 }, () => ({})) },
    adSets: [{
      clientId: `s${campaignIndex}`,
      ads: [{ clientId: `a${campaignIndex}`, creativeGroupId: `g${campaignIndex}` }]
    }]
  }));
  const plan = createWorkflowExecutionPlan({ id: 'run-large', execution: { campaigns } });
  assert.ok(plan.steps.length < 80, `expected fewer than 80 requests, received ${plan.steps.length}`);
  // 10 chiến dịch x (1 chiến dịch + 1 nhóm + 1 quảng cáo) = 30 node => ceil(30 / 8) = 4 bước publish.
  assert.equal(plan.steps.filter(({ key }) => key.startsWith('publish:')).length, 4);
  assert.equal(plan.steps.filter(({ key }) => /^publication:\d/.test(key)).length, 1);
  assert.equal(plan.steps.filter(({ key }) => key.startsWith('seeding:final:')).length, 27);
});

test('publish steps use the batch size shared with the Cloudflare worker and allow up to five retries', () => {
  assert.equal(WORKFLOW_PUBLISH_BATCH_SIZE, 8);
  const plan = createWorkflowExecutionPlan({ id: 'run-retry', execution: { campaigns: [{ clientId: 'c1', adSets: [{ clientId: 's1', ads: [{ clientId: 'a1' }] }] }] } });
  const publishStep = plan.steps.find(({ key }) => key === 'publish:1');
  assert.equal(publishStep.retryLimit, 5);
  assert.equal(plan.steps.find(({ key }) => key.startsWith('publication:realtime:')).retryLimit, 2);
});

test('media preparation runs first and only when ads reference media', () => {
  const withMedia = createWorkflowExecutionPlan({ id: 'run-media', execution: { campaigns: [{ clientId: 'c1', adSets: [{ clientId: 's1', ads: [{ clientId: 'a1', mediaId: 'video-1' }, { clientId: 'a2' }] }] }] } });
  assert.equal(withMedia.steps[0].key, 'media:prepare');
  assert.equal(withMedia.steps[0].path, '/api/internal/workflow/runs/run-media/media/prepare');
  assert.equal(withMedia.steps.filter(({ key }) => key === 'media:prepare').length, 1);
  assert.ok(withMedia.steps.findIndex(({ key }) => key === 'publish:1') > 0);

  const withoutMedia = createWorkflowExecutionPlan({ id: 'run-plain', execution: { campaigns: [{ clientId: 'c1', adSets: [{ clientId: 's1', ads: [{ clientId: 'a1' }] }] }] } });
  assert.equal(withoutMedia.steps.some(({ key }) => key === 'media:prepare'), false);
});

test('workflow step log lines only carry allow-listed fields and never secrets', () => {
  const line = workflowStepLogLine({
    runId: 'run-1',
    action: 'continue',
    stepKey: 'publish:2',
    status: 200,
    ms: 1234,
    attempted: 8,
    complete: false,
    deadlineHit: true,
    token: 'EAAG-super-secret',
    sourceUrl: 'https://signed.example/video.mp4?signature=abc',
    authorization: 'Bearer secret'
  });
  const parsed = JSON.parse(line);
  assert.deepEqual(Object.keys(parsed).sort(), ['action', 'attempted', 'complete', 'deadlineHit', 'evt', 'ms', 'runId', 'status', 'stepKey']);
  assert.equal(parsed.evt, 'workflow_step');
  assert.equal(/token|signature|secret|EAAG/i.test(line), false);
  assert.equal(JSON.parse(workflowStepLogLine({ runId: 'r', ms: Number.NaN })).ms, undefined);
});
