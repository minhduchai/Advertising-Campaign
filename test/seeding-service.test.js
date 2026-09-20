import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildSeedingPreparation,
  createSeedingState,
  prepareRunSeeding,
  processNextSeedingJob,
  resolveSeedingConflict
} from '../src/seeding-service.js';

const NOW = 1_000;

function campaign({
  clientId = 'campaign-1',
  pageId = 'page-1',
  enabled = true,
  adIds = ['ad-1'],
  items = [
    { id: 'item-1', message: 'Comment 1', imageMediaId: null },
    { id: 'item-2', message: 'Comment 2', imageMediaId: null }
  ]
} = {}) {
  return {
    clientId,
    pageId,
    seeding: { enabled, templateId: 'template-1', templateName: 'Template', items },
    adSets: [{ clientId: `${clientId}-adset`, ads: adIds.map((clientId) => ({ clientId })) }]
  };
}

function runFixture({ campaigns = [campaign()], nodes } = {}) {
  return {
    id: 'run-1',
    ownerMetaUserId: 'meta-user-1',
    snapshot: { version: 3, campaigns },
    nodes: nodes ?? [{ clientId: 'ad-1', type: 'ad', status: 'created', postId: 'page-1_100' }]
  };
}

function existingJob(overrides = {}) {
  return {
    id: 'seed-job-1',
    runId: 'run-1',
    campaignClientId: 'campaign-1',
    pageId: 'page-1',
    postId: 'page-1_100',
    itemId: 'item-1',
    position: 0,
    sequence: 0,
    message: 'Comment 1',
    imageMediaId: null,
    status: 'pending',
    metaCommentId: null,
    error: null,
    attemptCount: 0,
    availableAt: NOW,
    startedAt: null,
    completedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides
  };
}

test('deduplicates a shared post inside one campaign while retaining item order', () => {
  const run = runFixture({
    campaigns: [campaign({ adIds: ['ad-1', 'ad-2'] })],
    nodes: [
      { clientId: 'ad-1', type: 'ad', status: 'created', postId: 'page-1_100' },
      { clientId: 'ad-2', type: 'ad', status: 'created', postId: 'page-1_100' }
    ]
  });

  const prepared = buildSeedingPreparation(run, [], { now: NOW });

  assert.deepEqual(Object.keys(prepared), ['jobs', 'conflicts', 'waitingPostCount', 'invalidTargets']);
  assert.equal(prepared.jobs.length, 2);
  assert.deepEqual(prepared.jobs.map(({ postId, position }) => [postId, position]), [
    ['page-1_100', 0],
    ['page-1_100', 1]
  ]);
  assert.deepEqual(prepared.jobs.map(({ sequence }) => sequence), [0, 0]);
});

test('creates ordered jobs for distinct posts and positions zero through nine', () => {
  const items = Array.from({ length: 10 }, (_, position) => ({
    id: `item-${position}`,
    message: `Comment ${position}`,
    imageMediaId: null
  }));
  const run = runFixture({
    campaigns: [campaign({ adIds: ['ad-1', 'ad-2'], items })],
    nodes: [
      { clientId: 'ad-1', type: 'ad', status: 'created', postId: 'page-1_100' },
      { clientId: 'ad-2', type: 'ad', status: 'created', postId: 'page-1_200' }
    ]
  });

  const prepared = buildSeedingPreparation(run, [], { now: NOW });

  assert.equal(prepared.jobs.length, 20);
  assert.deepEqual(prepared.jobs.slice(0, 10).map(({ position }) => position), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.deepEqual([...new Set(prepared.jobs.slice(0, 10).map(({ sequence }) => sequence))], [0]);
  assert.deepEqual([...new Set(prepared.jobs.slice(10).map(({ sequence }) => sequence))], [1]);
});

test('does not seed one post into multiple campaigns without a choice', () => {
  const run = runFixture({
    campaigns: [
      campaign({ clientId: 'campaign-1', pageId: 'page-1', adIds: ['ad-1'] }),
      campaign({ clientId: 'campaign-2', pageId: 'page-1', adIds: ['ad-2'] })
    ],
    nodes: [
      { clientId: 'ad-1', type: 'ad', status: 'created', postId: 'page-1_100' },
      { clientId: 'ad-2', type: 'ad', status: 'created', postId: 'page-1_100' }
    ]
  });

  const prepared = buildSeedingPreparation(run, [], { now: NOW });

  assert.equal(prepared.jobs.length, 0);
  assert.deepEqual(prepared.conflicts, [{
    postId: 'page-1_100',
    campaignClientIds: ['campaign-1', 'campaign-2']
  }]);
});

test('treats an existing campaign/post key as the prior conflict choice', () => {
  const run = runFixture({
    campaigns: [
      campaign({ clientId: 'campaign-1', pageId: 'page-1', adIds: ['ad-1'] }),
      campaign({ clientId: 'campaign-2', pageId: 'page-1', adIds: ['ad-2'] })
    ],
    nodes: [
      { clientId: 'ad-1', type: 'ad', status: 'created', postId: 'page-1_100' },
      { clientId: 'ad-2', type: 'ad', status: 'created', postId: 'page-1_100' }
    ]
  });

  const prepared = buildSeedingPreparation(run, [existingJob()], { now: NOW });

  assert.deepEqual(prepared.conflicts, []);
  assert.deepEqual(prepared.jobs.map(({ campaignClientId, itemId }) => [campaignClientId, itemId]), [
    ['campaign-1', 'item-2']
  ]);
});

test('does not treat another run existing key as a conflict choice', () => {
  const run = runFixture({
    campaigns: [
      campaign({ clientId: 'campaign-1', pageId: 'page-1', adIds: ['ad-1'] }),
      campaign({ clientId: 'campaign-2', pageId: 'page-1', adIds: ['ad-2'] })
    ],
    nodes: [
      { clientId: 'ad-1', type: 'ad', status: 'created', postId: 'page-1_100' },
      { clientId: 'ad-2', type: 'ad', status: 'created', postId: 'page-1_100' }
    ]
  });

  const prepared = buildSeedingPreparation(run, [existingJob({ runId: 'run-2' })], { now: NOW });

  assert.equal(prepared.jobs.length, 0);
  assert.deepEqual(prepared.conflicts[0].campaignClientIds, ['campaign-1', 'campaign-2']);
});

test('is idempotent for existing unique keys', () => {
  const run = runFixture();
  const prepared = buildSeedingPreparation(run, [
    existingJob(),
    existingJob({ id: 'seed-job-2', itemId: 'item-2', position: 1, message: 'Comment 2' })
  ], { now: NOW });

  assert.deepEqual(prepared.jobs, []);
  assert.deepEqual(prepared.conflicts, []);
});

test('ignores failed, skipped, disabled, and non-ad nodes', () => {
  const run = runFixture({
    campaigns: [
      campaign({ clientId: 'campaign-1', adIds: ['ad-created', 'ad-failed', 'ad-skipped'] }),
      campaign({ clientId: 'campaign-2', enabled: false, adIds: ['ad-disabled'] })
    ],
    nodes: [
      { clientId: 'ad-created', type: 'campaign', status: 'created', postId: 'page-1_100' },
      { clientId: 'ad-failed', type: 'ad', status: 'failed', postId: 'page-1_200' },
      { clientId: 'ad-skipped', type: 'ad', status: 'skipped', postId: 'page-1_300' },
      { clientId: 'ad-disabled', type: 'ad', status: 'created', postId: 'page-1_400' }
    ]
  });

  const prepared = buildSeedingPreparation(run, [], { now: NOW });

  assert.deepEqual(prepared.jobs, []);
  assert.equal(prepared.waitingPostCount, 0);
  assert.deepEqual(prepared.invalidTargets, []);
});

test('counts created ads waiting for a post ID without creating jobs', () => {
  const prepared = buildSeedingPreparation(runFixture({
    nodes: [{ clientId: 'ad-1', type: 'ad', status: 'created' }]
  }), [], { now: NOW });

  assert.equal(prepared.jobs.length, 0);
  assert.equal(prepared.waitingPostCount, 1);
});

test('rejects a post whose Page prefix does not match its campaign', () => {
  const prepared = buildSeedingPreparation(runFixture({
    nodes: [{ clientId: 'ad-1', type: 'ad', status: 'created', postId: 'page-2_100' }]
  }), [], { now: NOW });

  assert.equal(prepared.jobs.length, 0);
  assert.deepEqual(prepared.invalidTargets, [{
    campaignClientId: 'campaign-1',
    pageId: 'page-1',
    postId: 'page-2_100',
    reason: 'page_mismatch'
  }]);
});

test('prepareRunSeeding inserts only missing jobs across repeated preparation', async () => {
  const stored = [];
  const insertJobs = async (_ownerMetaUserId, jobs) => {
    for (const job of jobs) {
      if (!stored.some((entry) => entry.campaignClientId === job.campaignClientId &&
        entry.postId === job.postId && entry.itemId === job.itemId)) stored.push(job);
    }
    return jobs.length;
  };
  const run = runFixture();

  await prepareRunSeeding({ run, ownerMetaUserId: 'meta-user-1', existingJobs: stored, insertJobs, now: NOW });
  await prepareRunSeeding({ run, ownerMetaUserId: 'meta-user-1', existingJobs: stored, insertJobs, now: NOW });

  assert.equal(stored.length, 2);
});

test('resolveSeedingConflict inserts only the selected campaign jobs', async () => {
  const inserted = [];
  const run = runFixture({
    campaigns: [
      campaign({ clientId: 'campaign-1', pageId: 'page-1', adIds: ['ad-1'] }),
      campaign({ clientId: 'campaign-2', pageId: 'page-1', adIds: ['ad-2'] })
    ],
    nodes: [
      { clientId: 'ad-1', type: 'ad', status: 'created', postId: 'page-1_100' },
      { clientId: 'ad-2', type: 'ad', status: 'created', postId: 'page-1_100' }
    ]
  });

  const result = await resolveSeedingConflict({
    run,
    ownerMetaUserId: 'meta-user-1',
    postId: 'page-1_100',
    campaignClientId: 'campaign-2',
    existingJobs: [],
    insertJobs: async (_ownerMetaUserId, jobs) => inserted.push(...jobs),
    now: NOW
  });

  assert.equal(result.jobs.length, 2);
  assert.deepEqual([...new Set(inserted.map(({ campaignClientId }) => campaignClientId))], ['campaign-2']);
});

test('resolveSeedingConflict rejects a campaign that does not contain the post', async () => {
  await assert.rejects(() => resolveSeedingConflict({
    run: runFixture(),
    ownerMetaUserId: 'meta-user-1',
    postId: 'page-1_999',
    campaignClientId: 'campaign-1',
    existingJobs: [],
    insertJobs: () => assert.fail('invalid conflict resolution must not insert'),
    now: NOW
  }), /does not contain/i);
});

test('keeps stable sequence ordinals when a later target is prepared before resolving an earlier conflict', async () => {
  const run = runFixture({
    campaigns: [
      campaign({ clientId: 'campaign-1', pageId: 'page-1', adIds: ['ad-1'] }),
      campaign({ clientId: 'campaign-2', pageId: 'page-1', adIds: ['ad-2'] }),
      campaign({ clientId: 'campaign-3', pageId: 'page-1', adIds: ['ad-3'] })
    ],
    nodes: [
      { clientId: 'ad-1', type: 'ad', status: 'created', postId: 'page-1_100' },
      { clientId: 'ad-2', type: 'ad', status: 'created', postId: 'page-1_100' },
      { clientId: 'ad-3', type: 'ad', status: 'created', postId: 'page-1_200' }
    ]
  });
  const initial = buildSeedingPreparation(run, [], { now: NOW });
  const stored = [...initial.jobs];

  const resolved = await resolveSeedingConflict({
    run,
    ownerMetaUserId: 'meta-user-1',
    postId: 'page-1_100',
    campaignClientId: 'campaign-1',
    existingJobs: stored,
    insertJobs: async (_ownerMetaUserId, jobs) => stored.push(...jobs),
    now: NOW
  });

  assert.deepEqual([...new Set(initial.jobs.map(({ sequence }) => sequence))], [2]);
  assert.deepEqual([...new Set(resolved.jobs.map(({ sequence }) => sequence))], [0]);
  assert.deepEqual([...new Set(stored.map(({ sequence }) => sequence))], [2, 0]);
});

function processingJob(overrides = {}) {
  return existingJob({ status: 'posting', attemptCount: 1, startedAt: NOW, ...overrides });
}

function processingFixture({
  job = processingJob(),
  page = { accessToken: 'page-token', tasks: ['MODERATE'] },
  permissionGranted = true,
  createPageComment = async () => 'comment-1',
  mediaStore,
  finishError,
  jobs
} = {}) {
  const calls = { claims: [], finishes: [], comments: [], contexts: [] };
  const fixtureRunId = job?.runId ?? jobs?.[0]?.runId ?? 'run-1';
  const fixturePageId = job?.pageId ?? jobs?.[0]?.pageId ?? 'page-1';
  let claimed = false;
  const db = {
    async claimNextSeedingJob(input) {
      calls.claims.push(input);
      if (claimed) return null;
      claimed = true;
      return job;
    },
    async finishSeedingJob(input) {
      calls.finishes.push(input);
      if (finishError) throw finishError;
      Object.assign(job, {
        status: input.status,
        metaCommentId: input.metaCommentId,
        error: input.error,
        completedAt: input.now,
        updatedAt: input.now
      });
      return { ...job };
    },
    async listSeedingJobs() {
      return jobs ?? [job];
    }
  };
  const metaClient = {
    async getPageEngagementContext(token, pageIds) {
      calls.contexts.push({ token, pageIds });
      return { permissionGranted, pages: new Map(page ? [[fixturePageId, page]] : []) };
    },
    async createPageComment(...args) {
      calls.comments.push(args);
      return createPageComment(...args);
    }
  };
  return {
    input: {
      runId: fixtureRunId,
      ownerMetaUserId: 'meta-user-1',
      db,
      metaClient,
      mediaStore: mediaStore ?? {
        getMedia: () => assert.fail('text-only comment must not load media'),
        getMetaFetchUrl: () => assert.fail('text-only comment must not fetch a URL')
      },
      token: 'user-token',
      now: () => NOW,
      random: () => 0.5,
      timeoutMs: 20_000
    },
    calls,
    job
  };
}

test('claims exactly one job, posts it, and schedules a three-to-five second delay', async () => {
  const fixture = processingFixture();

  const result = await processNextSeedingJob(fixture.input);

  assert.equal(result.job.status, 'created');
  assert.equal(result.job.metaCommentId, 'comment-1');
  assert.ok(result.retryAfterMs >= 3_000 && result.retryAfterMs <= 5_000);
  assert.equal(fixture.calls.claims.length, 1);
  assert.equal(fixture.calls.comments.length, 1);
  assert.equal(fixture.calls.finishes[0].nextAvailableAt, NOW + result.retryAfterMs);
  assert.equal(fixture.calls.claims[0].staleBefore, NOW - 120_000);
});

test('uses inclusive random delay boundaries', async (context) => {
  for (const [label, random, expected] of [['zero', 0, 3_000], ['one', 1, 5_000]]) {
    await context.test(label, async () => {
      const fixture = processingFixture();
      fixture.input.random = () => random;
      const result = await processNextSeedingJob(fixture.input);
      assert.equal(result.retryAfterMs, expected);
      assert.equal(fixture.calls.finishes[0].nextAvailableAt, NOW + expected);
    });
  }
});

test('fails safely when pages_manage_engagement is missing', async () => {
  const fixture = processingFixture({ permissionGranted: false });
  const result = await processNextSeedingJob(fixture.input);

  assert.equal(result.job.status, 'failed');
  assert.match(result.job.error.message, /pages_manage_engagement/);
  assert.equal(fixture.calls.comments.length, 0);
});

test('fails safely when the Page is absent or lacks MODERATE', async (context) => {
  for (const [name, page] of [['absent', null], ['without task', { accessToken: 'page-token', tasks: ['CREATE_CONTENT'] }]]) {
    await context.test(name, async () => {
      const fixture = processingFixture({ page });
      const result = await processNextSeedingJob(fixture.input);
      assert.equal(result.job.status, 'failed');
      assert.match(result.job.error.message, page ? /MODERATE/ : /Page Access Token/);
      assert.equal(fixture.calls.comments.length, 0);
    });
  }
});

test('fails safely when the Page post prefix does not match the job Page', async () => {
  const fixture = processingFixture({ job: processingJob({ postId: 'page-2_100' }) });
  const result = await processNextSeedingJob(fixture.input);

  assert.equal(result.job.status, 'failed');
  assert.equal(fixture.calls.comments.length, 0);
});

test('uses only owned supported media at most 200 MB and requires an HTTPS fetch URL', async (context) => {
  const cases = [
    ['foreign owner', { ownerMetaUserId: 'meta-user-2', mimeType: 'image/jpeg', sizeBytes: 100 }, 'https://cdn.test/image.jpg'],
    ['wrong MIME', { ownerMetaUserId: 'meta-user-1', mimeType: 'image/webp', sizeBytes: 100 }, 'https://cdn.test/image.webp'],
    ['oversized', { ownerMetaUserId: 'meta-user-1', mimeType: 'video/mp4', sizeBytes: 200 * 1024 * 1024 + 1 }, 'https://cdn.test/video.mp4'],
    ['local URL', { ownerMetaUserId: 'meta-user-1', mimeType: 'image/jpeg', sizeBytes: 100 }, null],
    ['HTTP URL', { ownerMetaUserId: 'meta-user-1', mimeType: 'image/jpeg', sizeBytes: 100 }, 'http://cdn.test/image.jpg']
  ];

  for (const [name, metadata, url] of cases) {
    await context.test(name, async () => {
      const fixture = processingFixture({
        job: processingJob({ imageMediaId: 'media-1' }),
        mediaStore: {
          getMedia: async () => ({ id: 'media-1', ...metadata }),
          getMetaFetchUrl: async () => url
        }
      });
      const result = await processNextSeedingJob(fixture.input);
      assert.equal(result.job.status, 'failed');
      assert.equal(fixture.calls.comments.length, 0);
    });
  }
});

test('posts trusted image media by HTTPS attachment URL', async () => {
  const fixture = processingFixture({
    job: processingJob({ imageMediaId: 'media-1' }),
    mediaStore: {
      getMedia: async () => ({
        id: 'media-1', ownerMetaUserId: 'meta-user-1', mimeType: 'image/png', sizeBytes: 10 * 1024 * 1024
      }),
      getMetaFetchUrl: async () => 'https://cdn.test/image.png?signed=secret'
    }
  });

  const result = await processNextSeedingJob(fixture.input);

  assert.equal(result.job.status, 'created');
  assert.deepEqual(fixture.calls.comments[0].slice(0, 3), [
    'page-token',
    'page-1_100',
    { message: 'Comment 1', attachmentUrl: 'https://cdn.test/image.png?signed=secret' }
  ]);
});

test('posts trusted video media by HTTPS attachment URL', async () => {
  const fixture = processingFixture({
    job: processingJob({ imageMediaId: 'media-video' }),
    mediaStore: {
      getMedia: async () => ({
        id: 'media-video', ownerMetaUserId: 'meta-user-1', mimeType: 'video/mp4', sizeBytes: 200 * 1024 * 1024
      }),
      getMetaFetchUrl: async () => 'https://cdn.test/video.mp4?signed=secret'
    }
  });

  const result = await processNextSeedingJob(fixture.input);

  assert.equal(result.job.status, 'created');
  assert.equal(fixture.calls.comments[0][2].attachmentUrl, 'https://cdn.test/video.mp4?signed=secret');
});

test('classifies an explicit Meta error as failed without retrying', async () => {
  const error = new Error('Permission denied');
  error.meta = { message: 'Permission denied', type: 'OAuthException', code: 10, subcode: 200 };
  const fixture = processingFixture({ createPageComment: async () => { throw error; } });

  const result = await processNextSeedingJob(fixture.input);

  assert.equal(result.job.status, 'failed');
  assert.deepEqual(result.job.error, error.meta);
  assert.equal(fixture.calls.comments.length, 1);
  assert.equal(fixture.calls.claims.length, 1);
});

test('classifies abort, network, and closed connections as needs_review', async (context) => {
  const errors = [
    Object.assign(new Error('Aborted'), { name: 'AbortError' }),
    new TypeError('fetch failed'),
    Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' })
  ];
  for (const error of errors) {
    await context.test(error.name === 'Error' ? error.code : error.name, async () => {
      const fixture = processingFixture({ createPageComment: async () => { throw error; } });
      const result = await processNextSeedingJob(fixture.input);
      assert.equal(result.job.status, 'needs_review');
      assert.equal(fixture.calls.comments.length, 1);
    });
  }
});

test('classifies a network failure while loading Page context as failed before mutation', async () => {
  const fixture = processingFixture();
  fixture.input.metaClient.getPageEngagementContext = async () => { throw new TypeError('fetch failed'); };

  const result = await processNextSeedingJob(fixture.input);

  assert.equal(result.job.status, 'failed');
  assert.equal(fixture.calls.comments.length, 0);
});

test('classifies a media URL network failure as failed before mutation', async () => {
  const fixture = processingFixture({
    job: processingJob({ imageMediaId: 'media-1' }),
    mediaStore: {
      getMedia: async () => ({
        id: 'media-1', ownerMetaUserId: 'meta-user-1', mimeType: 'image/jpeg', sizeBytes: 100
      }),
      getMetaFetchUrl: async () => { throw new TypeError('fetch failed'); }
    }
  });

  const result = await processNextSeedingJob(fixture.input);

  assert.equal(result.job.status, 'failed');
  assert.equal(fixture.calls.comments.length, 0);
});

test('classifies a missing Comment ID after Meta mutation as needs_review', async () => {
  const fixture = processingFixture({
    createPageComment: async () => { throw new Error('Meta did not return a Comment ID'); }
  });

  const result = await processNextSeedingJob(fixture.input);

  assert.equal(result.job.status, 'needs_review');
  assert.equal(fixture.calls.comments.length, 1);
});

test('aborts an uncertain Meta request at the configured timeout', async () => {
  const fixture = processingFixture({
    createPageComment: async (_pageToken, _postId, _payload, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(Object.assign(new Error('Aborted'), { name: 'AbortError' })));
    })
  });
  fixture.input.timeoutMs = 5;

  const result = await processNextSeedingJob(fixture.input);

  assert.equal(result.job.status, 'needs_review');
});

test('leaves a Meta-created job posting when the database finish fails', async () => {
  const fixture = processingFixture({ finishError: new Error('database unavailable') });

  await assert.rejects(() => processNextSeedingJob(fixture.input), /database unavailable/);

  assert.equal(fixture.job.status, 'posting');
  assert.equal(fixture.calls.comments.length, 1);
  assert.equal(fixture.calls.finishes.length, 1);
});

test('returns the pending available_at delay when no job can be claimed', async () => {
  const pending = processingJob({ status: 'pending', availableAt: 4_500 });
  const fixture = processingFixture({ job: null, jobs: [pending] });

  const result = await processNextSeedingJob(fixture.input);

  assert.equal(result.job, null);
  assert.equal(result.retryAfterMs, 3_500);
  assert.equal(fixture.calls.comments.length, 0);
});

test('creates a public state summary without tokens or Blob URLs', () => {
  const run = runFixture();
  run.accessToken = 'run-secret';
  const jobs = [
    existingJob({ status: 'created', metaCommentId: 'comment-1' }),
    existingJob({
      id: 'seed-job-2',
      itemId: 'item-2',
      position: 1,
      message: 'Comment 2',
      status: 'pending',
      error: {
        message: 'Fetch https://private.blob.vercel-storage.com/image.jpg?token=secret failed',
        accessToken: 'job-secret',
        nested: { blobUrl: 'blob:https://app/private' }
      }
    })
  ];

  const state = createSeedingState(run, jobs);

  assert.deepEqual(state.summary, {
    posts: 1,
    total: 2,
    pending: 1,
    posting: 0,
    created: 1,
    failed: 0,
    needsReview: 0,
    cancelled: 0
  });
  assert.deepEqual(Object.keys(state.jobs[0]), [
    'id', 'campaignClientId', 'pageId', 'postId', 'position', 'message',
    'imageMediaId', 'status', 'metaCommentId', 'error'
  ]);
  assert.doesNotMatch(JSON.stringify(state), /run-secret|job-secret|vercel-storage|blob:https|token=secret/);
  assert.deepEqual(state.conflicts, []);
  assert.equal(state.waitingPostCount, 0);
});

test('public state scopes mixed jobs to the requested run', () => {
  const state = createSeedingState(runFixture(), [
    existingJob({ status: 'created' }),
    existingJob({ id: 'foreign-job', runId: 'run-2', campaignClientId: 'foreign-campaign', postId: 'page-9_900' })
  ]);

  assert.equal(state.summary.total, 1);
  assert.equal(state.summary.posts, 1);
  assert.deepEqual(state.jobs.map(({ id }) => id), ['seed-job-1']);
  assert.doesNotMatch(JSON.stringify(state), /foreign-job|foreign-campaign|page-9_900/);
});

test('public errors use a flat allowlist and redact bearer credentials', () => {
  const state = createSeedingState(runFixture(), [existingJob({
    status: 'failed',
    error: {
      message: 'Request used Bearer plain-secret and failed',
      type: 'OAuthException',
      code: 190,
      subcode: 463,
      fbtraceId: 'trace-1',
      authorization: 'Bearer nested-secret',
      bearer: 'another-secret',
      cookie: 'session=private',
      secret: 'private-secret',
      nested: { authorization: 'Bearer deep-secret' }
    }
  })]);

  assert.deepEqual(state.jobs[0].error, {
    message: 'Request used Bearer [redacted] and failed',
    type: 'OAuthException',
    code: 190,
    subcode: 463,
    fbtraceId: 'trace-1'
  });
  assert.doesNotMatch(JSON.stringify(state), /plain-secret|nested-secret|another-secret|session=private|private-secret|deep-secret/);
});
