import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateMonotonicProgress, createWorkflowExecutionPlan, createWorkflowPlan } from '../src/workflow-plan.js';

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
  const plan = createWorkflowExecutionPlan({ id: 'run-live', execution: { campaigns: [{ clientId: 'c1', seeding: { items: [{}, {}] }, adSets: [{ clientId: 's1', ads: Array.from({ length: 5 }, (_, index) => ({ clientId: `a${index + 1}` })) }] }] } });
  const keys = plan.steps.map(({ key }) => key);
  for (const phase of ['publish:1', 'publish:2']) {
    const index = keys.indexOf(phase);
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
  assert.equal(plan.steps.filter(({ key }) => key.startsWith('publish:')).length, 8);
  assert.equal(plan.steps.filter(({ key }) => /^publication:\d/.test(key)).length, 1);
  assert.equal(plan.steps.filter(({ key }) => key.startsWith('seeding:final:')).length, 27);
});
