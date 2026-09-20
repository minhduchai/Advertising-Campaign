import { WorkflowEntrypoint } from "cloudflare:workers";
import { signedHeaders } from "./hmac.js";
import { isPublishStep, runPublishBatch } from "./publish-batch.js";

const DEFAULT_RETRY = Object.freeze({
  retries: { limit: 3, delay: "5 seconds", backoff: "exponential" },
  timeout: "5 minutes",
});
const MAX_REQUEST_STEPS_PER_INSTANCE = 40;

class NonRetryableError extends Error {
  constructor(message) {
    super(message);
    this.name = "NonRetryableError";
  }
}

export class CampaignWorkflow extends WorkflowEntrypoint {
  async run(event, step) {
    const runId = requireRunId(event.payload?.runId);
    const workflowToken = requireWorkflowToken(event.payload?.workflowToken);
    const startIndex = requireStartIndex(event.payload?.startIndex);
    const plan = await step.do("Tải kế hoạch tạo quảng cáo", DEFAULT_RETRY, () =>
      callVercel(this.env, {
        method: "GET",
        path: `/api/internal/workflow/runs/${encodeURIComponent(runId)}/plan`,
        workflowToken,
      }),
    );

    validatePlan(plan, runId);
    const results = [];

    const endIndex = Math.min(plan.steps.length, startIndex + MAX_REQUEST_STEPS_PER_INSTANCE);
    for (let index = startIndex; index < endIndex; index += 1) {
      const plannedStep = plan.steps[index];
      if (plannedStep.delayBeforeMs > 0) {
        await step.sleep(`Chờ trước bước ${index + 1}`, plannedStep.delayBeforeMs);
      }

      let result;
      for (let throttleAttempt = 0; throttleAttempt < 4; throttleAttempt += 1) {
        const execute = () => executePlannedStep(this.env, runId, workflowToken, plannedStep);
        const attemptLabel = throttleAttempt > 0 ? ` · hạn mức ${throttleAttempt + 1}` : "";
        result = isPublishStep(plannedStep)
          ? await runPublishBatch((call) => step.do(
            `${workflowStepName(index, plannedStep)}${attemptLabel}${call > 1 ? ` · lần ${call}` : ""}`,
            retryConfig(plannedStep),
            execute,
          ))
          : await step.do(`${workflowStepName(index, plannedStep)}${attemptLabel}`, retryConfig(plannedStep), execute);
        if (!result?.retryable) break;
        await step.sleep(
          `Chờ hạn mức Meta · ${plannedStep.key} · ${throttleAttempt + 1}`,
          Math.max(30_000, Number(result.retryAfterMs) || 30_000),
        );
      }
      if (result?.retryable) throw new Error(`Meta vẫn giới hạn sau 4 lần thử: ${plannedStep.key}`);
      results.push(result);

      if (plannedStep.key === 'run:finalize' && result?.pending === true) {
        const attempt = Number(event.payload?.finalizeAttempt ?? 0) + 1;
        if (attempt > 180) throw new NonRetryableError('Seeding vẫn đang chờ sau 180 lần kiểm tra; cần kiểm tra lượt tạo.');
        await step.sleep(`Chờ Post ID hoặc seeding ${attempt}`, 30000);
        await step.do(`Tiếp tục seeding ${attempt}`, DEFAULT_RETRY, async () => {
          const id = `${runId}-${workflowToken.slice(0, 12)}-final-${attempt}`;
          try {
            await this.env.CAMPAIGN_WORKFLOW.create({ id, params: { runId, workflowToken, startIndex: index, finalizeAttempt: attempt } });
          } catch {
            await this.env.CAMPAIGN_WORKFLOW.get(id);
          }
        });
        return { runId, status: 'continued', pending: true };
      }

      if (plannedStep.delayAfterMs > 0) {
        await step.sleep(`Chờ sau bước ${index + 1}`, plannedStep.delayAfterMs);
      }
    }

    if (endIndex < plan.steps.length) {
      await step.do(`Chuyển sang chặng ${endIndex + 1}`, DEFAULT_RETRY, async () => {
        const id = `${runId}-${workflowToken.slice(0, 12)}-${endIndex}`;
        try {
          await this.env.CAMPAIGN_WORKFLOW.create({ id, params: { runId, workflowToken, startIndex: endIndex } });
        } catch {
          await this.env.CAMPAIGN_WORKFLOW.get(id);
        }
        return { continuedAt: endIndex };
      });
    }

    return {
      runId,
      status: endIndex < plan.steps.length ? "continued" : "completed",
      completedSteps: results.length,
      totalSteps: plan.steps.length,
      startIndex,
      endIndex,
    };
  }
}

export async function executePlannedStep(env, runId, workflowToken, plannedStep) {
  const response = await callVercel(env, {
    method: plannedStep.method ?? "POST",
    path: plannedStep.path,
    body: plannedStep.body ?? { runId, stepKey: plannedStep.key },
    workflowToken,
  });

  if (response?.terminal === true && response?.status === "needs_review") {
    throw new NonRetryableError(response.message ?? `Bước ${plannedStep.key} cần kiểm tra thủ công.`);
  }
  return response;
}

export async function callVercel(env, { method, path, body, workflowToken }) {
  if (!env.VERCEL_INTERNAL_BASE_URL) throw new Error("VERCEL_INTERNAL_BASE_URL chưa được cấu hình.");
  if (!path?.startsWith("/api/internal/workflow/")) {
    throw new NonRetryableError("Workflow chỉ được gọi endpoint nội bộ đã cho phép.");
  }

  const normalizedMethod = method.toUpperCase();
  const serializedBody = body === undefined ? "" : JSON.stringify(body);
  const headers = await signedHeaders({
    secret: env.WORKFLOW_SHARED_SECRET,
    method: normalizedMethod,
    pathname: path,
    body: serializedBody,
  });
  if (serializedBody) headers["content-type"] = "application/json";
  headers["x-workflow-token"] = requireWorkflowToken(workflowToken);

  const response = await fetch(new URL(path, env.VERCEL_INTERNAL_BASE_URL), {
    method: normalizedMethod,
    headers,
    body: serializedBody || undefined,
  });
  const responseBody = await parseResponse(response);

  if (response.status === 429 && responseBody?.retryable === true) return responseBody;
  if (!response.ok) {
    const message = responseBody?.error?.message ?? responseBody?.message ?? `Vercel trả về HTTP ${response.status}.`;
    if (response.status >= 400 && response.status < 500 && response.status !== 408 && response.status !== 429) {
      throw new NonRetryableError(message);
    }
    throw new Error(message);
  }
  return responseBody;
}

export function validatePlan(plan, runId) {
  if (!plan || plan.runId !== runId || !Array.isArray(plan.steps)) {
    throw new NonRetryableError("Kế hoạch Workflow không hợp lệ.");
  }
  for (const plannedStep of plan.steps) {
    if (!plannedStep?.key || !plannedStep?.path?.startsWith("/api/internal/workflow/")) {
      throw new NonRetryableError("Kế hoạch chứa bước không hợp lệ.");
    }
  }
}

function retryConfig(plannedStep) {
  return {
    retries: {
      limit: clampInteger(plannedStep.retryLimit, 0, 5, 3),
      delay: clampInteger(plannedStep.retryDelayMs, 1_000, 60_000, 5_000),
      backoff: "exponential",
    },
    timeout: "5 minutes",
  };
}

function workflowStepName(index, plannedStep) {
  return `${String(index + 1).padStart(4, "0")} · ${String(plannedStep.key).slice(0, 180)}`;
}

function requireRunId(runId) {
  if (typeof runId !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(runId)) {
    throw new NonRetryableError("runId không hợp lệ.");
  }
  return runId;
}

function requireWorkflowToken(token) {
  if (typeof token !== "string" || !/^[a-f0-9]{48}$/.test(token)) {
    throw new NonRetryableError("workflowToken không hợp lệ.");
  }
  return token;
}

function requireStartIndex(value) {
  if (value === undefined || value === null) return 0;
  if (!Number.isInteger(value) || value < 0) throw new NonRetryableError("startIndex không hợp lệ.");
  return value;
}

function clampInteger(value, minimum, maximum, fallback) {
  return Number.isInteger(value) ? Math.min(maximum, Math.max(minimum, value)) : fallback;
}

async function parseResponse(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { message: text.slice(0, 1_000) };
  }
}
