import { workflowAuthHeaders } from './workflow-auth.js';

export function createWorkflowDispatcher({ config, fetchImpl = fetch, now = Date.now }) {
  return {
    enabled: config.workflowEnabled,
    async dispatch(runId, { restart = false, restartKey = null, workflowToken = null } = {}) {
      if (!config.workflowEnabled) return { dispatched: false, reason: 'disabled' };
      const pathname = '/runs';
      const body = JSON.stringify({
        runId,
        ...(restart ? { restart: true } : {}),
        ...(restartKey ? { restartKey } : {}),
        ...(workflowToken ? { workflowToken } : {})
      });
      const response = await fetchImpl(`${config.workflowUrl}${pathname}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...workflowAuthHeaders({ pathname, body, now: now() }, config.workflowSharedSecret)
        },
        body,
        signal: AbortSignal.timeout(10_000)
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = new Error(payload.error || `Workflow dispatch failed (${response.status})`);
        error.statusCode = response.status;
        throw error;
      }
      return { dispatched: true, workflowInstanceId: payload.instanceId ?? runId };
    }
  };
}
