import { verifySignedRequest, signedHeaders } from "./hmac.js";

export { CampaignWorkflow } from "./campaign-workflow.js";

export default {
  async scheduled(_event, env, ctx) {
    ctx.waitUntil((async () => {
      const pathname = '/api/internal/workflow/comment-unhide/tick';
      const body = '{}';
      const headers = await signedHeaders({ secret: env.WORKFLOW_SHARED_SECRET, method: 'POST', pathname, body });
      const response = await fetch(new URL(pathname, env.APP_SERVER_BASE_URL), {
        method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body
      });
      if (!response.ok) throw new Error(`Comment unhide tick HTTP ${response.status}`);
      const result = await response.json();
      console.log('comment-unhide', JSON.stringify(result));
      if (result.status === 'needs_review') throw new Error('Comment unhide requires review');
    })());
  },
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method !== "POST" || url.pathname !== "/runs") {
      return Response.json({ error: "not_found" }, { status: 404 });
    }

    const verification = await verifySignedRequest(request, env.WORKFLOW_SHARED_SECRET);
    if (!verification.ok) {
      return Response.json({ error: verification.reason }, { status: 401 });
    }

    let payload;
    try {
      payload = await request.json();
    } catch {
      return Response.json({ error: "invalid_json" }, { status: 400 });
    }

    const runId = payload?.runId;
    if (typeof runId !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(runId)) {
      return Response.json({ error: "invalid_run_id" }, { status: 400 });
    }

    const restart = payload?.restart === true;
    const workflowToken = typeof payload?.workflowToken === "string" && /^[a-f0-9]{48}$/.test(payload.workflowToken)
      ? payload.workflowToken
      : null;
    if (!workflowToken) {
      return Response.json({ error: "invalid_workflow_token" }, { status: 400 });
    }
    const restartKey = typeof payload?.restartKey === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(payload.restartKey)
      ? payload.restartKey
      : null;
    const instanceId = restart
      ? `${runId}-resume-${restartKey ?? Date.now()}`
      : runId;
    let instance;
    try {
      instance = await env.CAMPAIGN_WORKFLOW.create({ id: instanceId, params: { runId, workflowToken } });
    } catch {
      instance = await env.CAMPAIGN_WORKFLOW.get(instanceId);
    }

    return Response.json(
      { accepted: true, runId, instanceId: instance.id },
      { status: 202 },
    );
  },
};
