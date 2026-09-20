import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createSeedingRunner,
  shouldAutoResumeSeeding
} from '../public/seeding-runner.js';

function seedingState(overrides = {}) {
  return {
    summary: {
      posts: 1,
      total: 2,
      pending: 0,
      posting: 0,
      created: 0,
      failed: 0,
      needsReview: 0,
      cancelled: 0,
      ...(overrides.summary ?? {})
    },
    jobs: overrides.jobs ?? [],
    conflicts: overrides.conflicts ?? [],
    waitingPostCount: overrides.waitingPostCount ?? 0
  };
}

test('processes one comment per request and waits for the exact server delay', async () => {
  const waits = [];
  const updates = [];
  const responses = [
    {
      retryAfterMs: 3_421,
      seeding: seedingState({ summary: { pending: 1, created: 1 } })
    },
    {
      retryAfterMs: 4_000,
      seeding: seedingState({ summary: { pending: 0, created: 2 } })
    }
  ];
  const api = {
    processCalls: 0,
    async prepareRunSeeding() {
      return { seeding: seedingState({ summary: { pending: 2 } }) };
    },
    async processNextSeeding() {
      this.processCalls += 1;
      return responses.shift();
    }
  };
  const runner = createSeedingRunner({
    api,
    wait: async (milliseconds) => waits.push(milliseconds),
    onUpdate: (state) => updates.push(state)
  });

  await runner.resume('run-1');

  assert.deepEqual(waits, [3_421]);
  assert.equal(api.processCalls, 2);
  assert.equal(updates.at(-1).summary.created, 2);
  assert.equal(runner.isRunning('run-1'), false);
});

test('keeps polling preparation until Meta returns the Post ID', async () => {
  const waits = [];
  const updates = [];
  const api = {
    prepareCalls: 0,
    processCalls: 0,
    async prepareRunSeeding() {
      this.prepareCalls += 1;
      return this.prepareCalls === 1
        ? { seeding: seedingState({ waitingPostCount: 1 }) }
        : { seeding: seedingState({ summary: { pending: 1, total: 1 } }) };
    },
    async processNextSeeding() {
      this.processCalls += 1;
      return {
        retryAfterMs: 3_000,
        seeding: seedingState({ summary: { pending: 0, created: 1, total: 1 } })
      };
    }
  };
  const runner = createSeedingRunner({
    api,
    wait: async (milliseconds) => waits.push(milliseconds),
    onUpdate: (state) => updates.push(state)
  });

  await runner.resume('run-waiting-post');

  assert.equal(api.prepareCalls, 2);
  assert.equal(api.processCalls, 1);
  assert.deepEqual(waits, [3_000]);
  assert.equal(updates.at(-1).summary.created, 1);
});

test('seeds an available Post ID before a later Post ID joins the same loop', async () => {
  const processedPosts = [];
  let prepareCalls = 0;
  const api = {
    async prepareRunSeeding() {
      prepareCalls += 1;
      if (prepareCalls === 1) {
        return { seeding: seedingState({
          summary: { posts: 1, total: 1, pending: 1 },
          waitingPostCount: 1,
          jobs: [{ postId: 'post-a', status: 'pending' }]
        }) };
      }
      return { seeding: seedingState({
        summary: { posts: 2, total: 2, pending: 1, created: 1 },
        waitingPostCount: 0,
        jobs: [
          { postId: 'post-a', status: 'succeeded' },
          { postId: 'post-b', status: 'pending' }
        ]
      }) };
    },
    async processNextSeeding() {
      const postId = processedPosts.length === 0 ? 'post-a' : 'post-b';
      processedPosts.push(postId);
      return {
        retryAfterMs: 3_000,
        seeding: seedingState({
          summary: processedPosts.length === 1
            ? { posts: 1, total: 1, pending: 0, created: 1 }
            : { posts: 2, total: 2, pending: 0, created: 2 },
          waitingPostCount: processedPosts.length === 1 ? 1 : 0
        })
      };
    }
  };
  const runner = createSeedingRunner({ api, wait: async () => {} });

  await runner.resume('run-incremental-posts');

  assert.deepEqual(processedPosts, ['post-a', 'post-b']);
  assert.ok(prepareCalls >= 2);
});

test('treats null, undefined, NaN, negative, and zero retry delays as stalled', async () => {
  for (const retryAfterMs of [null, undefined, Number.NaN, -1, 0]) {
    const waits = [];
    const stops = [];
    const api = {
      processCalls: 0,
      async prepareRunSeeding() {
        return { seeding: seedingState({ summary: { pending: 1 } }) };
      },
      async processNextSeeding() {
        this.processCalls += 1;
        if (this.processCalls > 1) throw new Error('retry delay must not spin');
        return {
          retryAfterMs,
          seeding: seedingState({ summary: { pending: 1, created: 1 } })
        };
      }
    };
    const runner = createSeedingRunner({
      api,
      wait: async (milliseconds) => waits.push(milliseconds),
      onStop: (event) => stops.push(event)
    });

    await runner.resume(`run-${String(retryAfterMs)}`);

    assert.equal(api.processCalls, 1);
    assert.deepEqual(waits, []);
    assert.equal(stops.at(-1).reason, 'stalled');
    assert.equal(runner.isRunning(`run-${String(retryAfterMs)}`), false);
  }
});

test('returns the same promise instead of creating two loops for one run', async () => {
  let releaseWait;
  let waitStarted;
  const waitStartedPromise = new Promise((resolve) => { waitStarted = resolve; });
  const api = {
    processCalls: 0,
    async prepareRunSeeding() {
      return { seeding: seedingState({ summary: { pending: 1 } }) };
    },
    async processNextSeeding() {
      this.processCalls += 1;
      return {
        retryAfterMs: 3_000,
        seeding: seedingState({ summary: { pending: 1, created: 1, total: 2 } })
      };
    }
  };
  const runner = createSeedingRunner({
    api,
    wait: () => new Promise((resolve) => {
      releaseWait = resolve;
      waitStarted();
    })
  });

  const first = runner.resume('run-1');
  const second = runner.resume('run-1');
  assert.equal(first, second);
  await waitStartedPromise;
  assert.equal(runner.isRunning('run-1'), true);
  assert.equal(api.processCalls, 1);

  runner.pause('run-1');
  await first;
  releaseWait();
  await Promise.resolve();
  assert.equal(api.processCalls, 1);
});

test('creates a new generation after pause and resume before the old loop cleans up', async () => {
  const stops = [];
  const api = {
    processCalls: 0,
    async prepareRunSeeding() {
      return { seeding: seedingState({ summary: { pending: 2 } }) };
    },
    async processNextSeeding() {
      this.processCalls += 1;
      return {
        retryAfterMs: 5_000,
        seeding: seedingState({ summary: { pending: 1, created: this.processCalls } })
      };
    }
  };
  const runner = createSeedingRunner({
    api,
    wait: async () => new Promise(() => {
    }),
    onStop: (event) => stops.push(event)
  });

  const first = runner.resume('run-1');
  await Promise.resolve();
  assert.equal(api.processCalls, 1);
  assert.equal(runner.isRunning('run-1'), true);

  assert.equal(runner.pause('run-1'), true);
  const second = runner.resume('run-1');
  assert.notEqual(second, first);

  await Promise.resolve();
  assert.equal(api.processCalls, 2);
  assert.equal(runner.isRunning('run-1'), true);

  await first;
  assert.equal(runner.isRunning('run-1'), true);
  assert.equal(stops.at(-1).reason, 'paused');

  assert.equal(runner.pause('run-1'), true);
  await second;
  assert.equal(runner.isRunning('run-1'), false);
  assert.equal(stops.at(-1).reason, 'paused');
});

test('pause interrupts an active wait and prevents the next request', async () => {
  let releaseWait;
  let waitStarted;
  const waitStartedPromise = new Promise((resolve) => { waitStarted = resolve; });
  const api = {
    processCalls: 0,
    async prepareRunSeeding() {
      return { seeding: seedingState({ summary: { pending: 2 } }) };
    },
    async processNextSeeding() {
      this.processCalls += 1;
      return {
        retryAfterMs: 4_999,
        seeding: seedingState({ summary: { pending: 1, created: 1 } })
      };
    }
  };
  const stops = [];
  const runner = createSeedingRunner({
    api,
    wait: () => new Promise((resolve) => {
      releaseWait = resolve;
      waitStarted();
    }),
    onStop: (event) => stops.push(event)
  });

  const active = runner.resume('run-1');
  await waitStartedPromise;
  assert.equal(runner.pause('run-1'), true);
  await active;

  assert.equal(api.processCalls, 1);
  assert.equal(runner.isRunning('run-1'), false);
  assert.equal(stops.at(-1).reason, 'paused');
  releaseWait();
});

test('continues past failed comments but stops for needs-review or conflict state', async () => {
  const cases = [
    ['needs_review', seedingState({ summary: { pending: 1, needsReview: 1, total: 2 } }), 1],
    ['conflict', seedingState({ summary: { pending: 1 }, conflicts: [{ postId: 'page_1', campaignClientIds: ['a', 'b'] }] }), 0]
  ];

  for (const [expectedReason, blockedState, expectedProcessCalls] of cases) {
    const stops = [];
    const api = {
      processCalls: 0,
      async prepareRunSeeding() {
        return expectedProcessCalls === 0
          ? { seeding: blockedState }
          : { seeding: seedingState({ summary: { pending: 2 } }) };
      },
      async processNextSeeding() {
        this.processCalls += 1;
        return { retryAfterMs: 3_000, seeding: blockedState };
      }
    };
    const runner = createSeedingRunner({
      api,
      wait: async () => assert.fail('blocked states must not wait'),
      onStop: (event) => stops.push(event)
    });

    await runner.resume(`run-${expectedReason}`);

    assert.equal(api.processCalls, expectedProcessCalls);
    assert.equal(stops.at(-1).reason, expectedReason);
  }
});

test('surfaces request failures through onStop and removes the failed loop', async () => {
  const failure = new Error('network unavailable');
  const stops = [];
  const runner = createSeedingRunner({
    api: {
      async prepareRunSeeding() {
        return { seeding: seedingState({ summary: { pending: 1 } }) };
      },
      async processNextSeeding() {
        throw failure;
      }
    },
    onStop: (event) => stops.push(event)
  });

  await runner.resume('run-1');

  assert.equal(stops.at(-1).error, failure);
  assert.equal(stops.at(-1).reason, 'error');
  assert.equal(runner.isRunning('run-1'), false);
});

test('only auto-resumes a clean pending state after refresh', () => {
  assert.equal(shouldAutoResumeSeeding(seedingState({ summary: { pending: 1 } })), true);
  assert.equal(shouldAutoResumeSeeding(seedingState({ summary: { pending: 1, posting: 1 } })), false);
  assert.equal(shouldAutoResumeSeeding(seedingState({ summary: { pending: 1, failed: 1 } })), true);
  assert.equal(shouldAutoResumeSeeding(seedingState({ summary: { pending: 1, needsReview: 1 } })), false);
  assert.equal(shouldAutoResumeSeeding(seedingState({ summary: { pending: 1, cancelled: 1 } })), false);
  assert.equal(shouldAutoResumeSeeding(seedingState({
    summary: { pending: 1 },
    conflicts: [{ postId: 'page_1', campaignClientIds: ['a', 'b'] }]
  })), false);
  assert.equal(shouldAutoResumeSeeding(seedingState({ summary: { pending: 0 } })), false);
  assert.equal(shouldAutoResumeSeeding(seedingState({ waitingPostCount: 1 })), true);
});
