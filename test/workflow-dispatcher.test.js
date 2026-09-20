import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkflowDispatcher } from '../src/workflow-dispatcher.js';

test('dispatches the workflow lease token to Cloudflare', async () => {
  let requestBody;
  const dispatcher = createWorkflowDispatcher({
    config: {
      workflowEnabled: true,
      workflowUrl: 'https://workflow.example',
      workflowSharedSecret: 'shared-secret'
    },
    fetchImpl: async (_url, options) => {
      requestBody = JSON.parse(options.body);
      return Response.json({ instanceId: 'run-1' }, { status: 202 });
    },
    now: () => 1_000
  });

  await dispatcher.dispatch('run-1', { workflowToken: 'workflow-token-a' });

  assert.deepEqual(requestBody, {
    runId: 'run-1',
    workflowToken: 'workflow-token-a'
  });
});
