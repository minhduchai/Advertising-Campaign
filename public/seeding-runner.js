const blockingSummaryReasons = [
  ['needsReview', 'needs_review'],
  ['cancelled', 'cancelled'],
  ['posting', 'posting']
];
const postPollIntervalMs = 3_000;

export function createSeedingRunner({ api, wait = defaultWait, onUpdate = () => {}, onStop = () => {} }) {
  if (!api?.prepareRunSeeding || !api?.processNextSeeding) {
    throw new TypeError('Seeding runner requires prepareRunSeeding and processNextSeeding');
  }

  const loops = new Map();

  function resume(runId) {
    const normalizedRunId = String(runId ?? '').trim();
    if (!normalizedRunId) throw new TypeError('runId is required');
    const existing = loops.get(normalizedRunId);
    if (existing?.status === 'running') return existing.promise;

    const control = createPauseControl();
    const generation = (existing?.generation ?? 0) + 1;
    const entry = {
      generation,
      control,
      status: 'running',
      promise: null
    };
    let promise;
    promise = runLoop(normalizedRunId, control, { api, wait, onUpdate, onStop })
      .finally(() => {
        const current = loops.get(normalizedRunId);
        if (current?.generation === generation && current.promise === promise) {
          loops.delete(normalizedRunId);
        }
      });
    entry.promise = promise;
    loops.set(normalizedRunId, entry);
    return promise;
  }

  function pause(runId) {
    const entry = loops.get(String(runId ?? '').trim());
    if (!entry) return false;
    entry.status = 'paused';
    entry.control.pause();
    return true;
  }

  function isRunning(runId) {
    return loops.get(String(runId ?? '').trim())?.status === 'running';
  }

  return { resume, pause, isRunning };
}

export function shouldAutoResumeSeeding(seeding) {
  const summary = seeding?.summary ?? {};
  return (Number(summary.pending) > 0 || Number(seeding?.waitingPostCount) > 0)
    && Number(summary.posting) === 0
    && Number(summary.needsReview) === 0
    && Number(summary.cancelled) === 0
    && (seeding?.conflicts?.length ?? 0) === 0;
}

async function runLoop(runId, control, dependencies) {
  let state = null;
  let reason = null;
  let error = null;
  try {
    while (!reason && !control.paused) {
      const prepared = await dependencies.api.prepareRunSeeding(runId);
      state = seedingStateFrom(prepared);
      dependencies.onUpdate(state, { runId });
      reason = stopReason(state);
      if (reason || control.paused) break;

      if (Number(state.waitingPostCount) > 0 && Number(state.summary?.pending) === 0) {
        const interrupted = await control.wait(dependencies.wait, postPollIntervalMs);
        if (interrupted) break;
        continue;
      }

      const response = await dependencies.api.processNextSeeding(runId);
      state = seedingStateFrom(response);
      dependencies.onUpdate(state, { runId });
      reason = stopReason(state);
      if (reason || control.paused) break;

      const retryAfterMs = Number(response?.retryAfterMs);
      if (!Number.isFinite(retryAfterMs) || retryAfterMs <= 0) {
        reason = 'stalled';
        break;
      }
      const interrupted = await control.wait(dependencies.wait, retryAfterMs);
      if (interrupted) break;
    }
    if (control.paused) reason = 'paused';
  } catch (caught) {
    error = caught;
    reason = 'error';
  }

  dependencies.onStop({ runId, state, reason, error });
  return state;
}

function stopReason(seeding) {
  if ((seeding?.conflicts?.length ?? 0) > 0) return 'conflict';
  const summary = seeding?.summary ?? {};
  for (const [key, reason] of blockingSummaryReasons) {
    if (Number(summary[key]) > 0) return reason;
  }
  return Number(summary.pending) > 0 || Number(seeding?.waitingPostCount) > 0 ? null : 'complete';
}

function seedingStateFrom(payload) {
  const state = payload?.seeding ?? payload;
  if (!state || typeof state !== 'object' || Array.isArray(state) || !state.summary) {
    throw new TypeError('Seeding response is missing state');
  }
  return state;
}

function createPauseControl() {
  let releasePause;
  const pausePromise = new Promise((resolve) => { releasePause = resolve; });
  return {
    paused: false,
    pause() {
      if (this.paused) return;
      this.paused = true;
      releasePause();
    },
    async wait(wait, milliseconds) {
      if (this.paused) return true;
      return Promise.race([
        Promise.resolve().then(() => wait(milliseconds)).then(() => false),
        pausePromise.then(() => true)
      ]);
    }
  };
}

function defaultWait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
