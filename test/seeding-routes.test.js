import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';
import { createSqliteDatabase } from '../src/db.js';
import { encryptToken, signSession } from '../src/crypto.js';
import { request, testConfig } from './helpers.js';

function jsonOptions(cookie, method = 'POST', body = {}) {
  return {
    method,
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify(body)
  };
}

function snapshot(campaigns = [campaignSnapshot()]) {
  return { version: 3, adAccountId: 'act_1', campaigns };
}

function campaignSnapshot({ clientId = 'campaign-1', adClientId = 'ad-1', items } = {}) {
  return {
    clientId,
    name: clientId,
    adAccountId: 'act_1',
    pageId: 'page-1',
    pageName: 'Page 1',
    seeding: {
      enabled: true,
      templateId: 'template-1',
      templateName: 'Mẫu hiện tại',
      items: items ?? [
        { id: 'item-1', message: 'Bình luận 1', imageMediaId: null, imageName: '' },
        { id: 'item-2', message: 'Bình luận 2', imageMediaId: null, imageName: '' }
      ]
    },
    adSets: [{ clientId: `${clientId}-adset`, ads: [{ clientId: adClientId, creativeGroupId: adClientId }] }]
  };
}

async function routeFixture(context, { runSnapshot = snapshot(), nodes, dbDecorator, metaOverrides = {} } = {}) {
  const config = testConfig();
  const database = createSqliteDatabase(':memory:');
  database.createSession({ id: 'session-owner' });
  database.attachMetaUser('session-owner', { id: 'owner-1', name: 'Owner' });
  database.createSession({ id: 'session-foreign' });
  database.attachMetaUser('session-foreign', { id: 'owner-2', name: 'Foreign' });
  database.upsertConnection({
    metaUserId: 'owner-1',
    metaUserName: 'Owner',
    accessTokenCiphertext: encryptToken('USER-TOKEN', config.tokenEncryptionKey)
  });
  database.upsertConnection({
    metaUserId: 'owner-2',
    metaUserName: 'Foreign',
    accessTokenCiphertext: encryptToken('FOREIGN-TOKEN', config.tokenEncryptionKey)
  });
  database.createRun({
    id: 'run-1', ownerMetaUserId: 'owner-1', status: 'completed', snapshot: runSnapshot, createdAt: 1_000
  });
  for (const node of nodes ?? [{
    clientId: 'ad-1', parentClientId: 'campaign-1-adset', type: 'ad', status: 'created',
    name: 'Ad 1', remoteId: 'remote-ad-1', postId: null, permalinkUrl: null, error: null
  }]) database.updateNodeResult('run-1', node);

  const calls = { publications: [], contexts: [], comments: [] };
  const metaClient = {
    async getAdPublication(token, remoteId) {
      calls.publications.push({ token, remoteId });
      return { postId: 'page-1_100', permalinkUrl: 'https://facebook.test/page-1/posts/100' };
    },
    async getPageEngagementContext(token, pageIds) {
      calls.contexts.push({ token, pageIds });
      return {
        permissionGranted: true,
        pages: new Map([['page-1', { accessToken: 'PAGE-TOKEN', tasks: ['MODERATE'] }]])
      };
    },
    async createPageComment(pageToken, postId, payload) {
      calls.comments.push({ pageToken, postId, payload });
      return `comment-${calls.comments.length}`;
    },
    ...metaOverrides
  };
  const db = dbDecorator ? dbDecorator(database) : database;
  const server = createServer({ config, db, metaClient });
  context.after(() => {
    server.close();
    database.close();
  });
  return {
    server,
    database,
    calls,
    ownerCookie: `meta_ads_session=${encodeURIComponent(signSession('session-owner', config.sessionSecret))}`,
    foreignCookie: `meta_ads_session=${encodeURIComponent(signSession('session-foreign', config.sessionSecret))}`
  };
}

test('prepare syncs publications, rereads the run, and next processes exactly one public job', async (context) => {
  const fixture = await routeFixture(context);

  const prepared = await request(
    fixture.server,
    '/api/runs/run-1/seeding/prepare',
    jsonOptions(fixture.ownerCookie)
  );

  assert.equal(prepared.status, 200);
  assert.equal(prepared.body.seeding.summary.total, 2);
  assert.equal(prepared.body.seeding.summary.pending, 2);
  assert.deepEqual(fixture.calls.publications, [{ token: 'USER-TOKEN', remoteId: 'remote-ad-1' }]);

  const next = await request(
    fixture.server,
    '/api/runs/run-1/seeding/next',
    jsonOptions(fixture.ownerCookie)
  );
  assert.equal(next.status, 200);
  assert.equal(next.body.job.status, 'created');
  assert.equal(next.body.seeding.summary.created, 1);
  assert.equal(fixture.calls.comments.length, 1);
  assert.deepEqual(fixture.calls.contexts, [{ token: 'USER-TOKEN', pageIds: ['page-1'] }]);
  assert.equal(fixture.calls.comments[0].pageToken, 'PAGE-TOKEN');
  assert.doesNotMatch(JSON.stringify([prepared.body, next.body]), /USER-TOKEN|PAGE-TOKEN|signed=1|access_token|blob:/i);
});

test('prepare never exposes publication-sync credentials or raw errors', async (context) => {
  const fixture = await routeFixture(context, {
    metaOverrides: {
      async getAdPublication() {
        const error = new Error('https://graph.test/post?access_token=private');
        error.meta = { message: 'Bearer USER-TOKEN https://blob.test/a?signed=1' };
        throw error;
      }
    }
  });

  const prepared = await request(
    fixture.server,
    '/api/runs/run-1/seeding/prepare',
    jsonOptions(fixture.ownerCookie)
  );

  assert.equal(prepared.status, 200);
  assert.equal(prepared.body.seeding.waitingPostCount, 1);
  assert.doesNotMatch(JSON.stringify(prepared.body), /USER-TOKEN|access_token|signed=1|blob\.test|Bearer/i);
});

test('prepare returns 404 without inserting when run ownership changes during sync', async (context) => {
  for (const changedRun of [
    null,
    { id: 'run-1', ownerMetaUserId: 'owner-2', secret: 'FOREIGN-RUN-SECRET' }
  ]) {
    await context.test(changedRun ? 'foreign' : 'missing', async (subcontext) => {
      let runReads = 0;
      let inserts = 0;
      const fixture = await routeFixture(subcontext, {
        dbDecorator(database) {
          return new Proxy(database, {
            get(target, property) {
              if (property === 'getRun') {
                return (runId) => {
                  runReads += 1;
                  return runReads === 1 ? target.getRun(runId) : changedRun;
                };
              }
              if (property === 'insertSeedingJobs') {
                return (...args) => {
                  inserts += 1;
                  return target.insertSeedingJobs(...args);
                };
              }
              return target[property];
            }
          });
        }
      });

      const response = await request(
        fixture.server,
        '/api/runs/run-1/seeding/prepare',
        jsonOptions(fixture.ownerCookie)
      );

      assert.equal(response.status, 404);
      assert.equal(inserts, 0);
      assert.doesNotMatch(JSON.stringify(response.body), /FOREIGN-RUN-SECRET|USER-TOKEN|PAGE-TOKEN/i);
    });
  }
});

test('seeding routes are exact, decode safely, and hide foreign or missing runs', async (context) => {
  const fixture = await routeFixture(context);
  const cases = [
    ['/api/runs/run-1/seeding/next', jsonOptions(fixture.foreignCookie), 404],
    ['/api/runs/missing/seeding', { headers: { cookie: fixture.ownerCookie } }, 404],
    ['/api/runs/%E0%A4%A/seeding/prepare', jsonOptions(fixture.ownerCookie), 404],
    ['/api/runs/run-1/seeding/jobs/%E0%A4%A/retry', jsonOptions(fixture.ownerCookie), 404],
    ['/api/runs/run-1/seeding/prepare/extra', jsonOptions(fixture.ownerCookie), 404],
    ['/api/runs/run-1/seeding/prepare', { method: 'GET', headers: { cookie: fixture.ownerCookie } }, 405]
  ];
  for (const [path, options, expectedStatus] of cases) {
    const response = await request(fixture.server, path, options);
    assert.equal(response.status, expectedStatus, path);
  }
});

test('conflict resolution validates falsy JSON and maps database races to a public 409 state', async (context) => {
  const campaigns = [
    campaignSnapshot({ clientId: 'campaign-1', adClientId: 'ad-1', items: [{ id: 'item-1', message: 'A', imageMediaId: null }] }),
    campaignSnapshot({ clientId: 'campaign-2', adClientId: 'ad-2', items: [{ id: 'item-2', message: 'B', imageMediaId: null }] })
  ];
  let insertCalls = 0;
  const fixture = await routeFixture(context, {
    runSnapshot: snapshot(campaigns),
    nodes: [
      { clientId: 'ad-1', type: 'ad', status: 'created', remoteId: 'remote-1', postId: 'page-1_100', permalinkUrl: 'https://facebook.test/100' },
      { clientId: 'ad-2', type: 'ad', status: 'created', remoteId: 'remote-2', postId: 'page-1_100', permalinkUrl: 'https://facebook.test/100' }
    ],
    dbDecorator(database) {
      const insert = database.insertSeedingJobs.bind(database);
      return new Proxy(database, {
        get(target, property) {
          if (property !== 'insertSeedingJobs') return target[property];
          return async (ownerMetaUserId, jobs) => {
            insertCalls += 1;
            if (insertCalls === 1) {
              await insert(ownerMetaUserId, jobs.map((job, index) => ({
                ...job,
                id: `concurrent-${index}`,
                campaignClientId: 'campaign-2',
                itemId: 'item-2',
                message: 'B'
              })));
              const error = new Error('Concurrent Campaign selection');
              error.code = 'SEEDING_POST_CONFLICT';
              throw error;
            }
            return insert(ownerMetaUserId, jobs);
          };
        }
      });
    }
  });

  for (const body of [false, null, 0, '']) {
    const invalid = await request(
      fixture.server,
      '/api/runs/run-1/seeding/conflicts/resolve',
      jsonOptions(fixture.ownerCookie, 'POST', body)
    );
    assert.equal(invalid.status, 422);
  }

  const raced = await request(
    fixture.server,
    '/api/runs/run-1/seeding/conflicts/resolve',
    jsonOptions(fixture.ownerCookie, 'POST', { postId: 'page-1_100', campaignClientId: 'campaign-1' })
  );
  assert.equal(raced.status, 409);
  assert.equal(raced.body.code, 'SEEDING_POST_CONFLICT');
  assert.equal(raced.body.seeding.summary.total, 1);
  assert.equal(raced.body.seeding.jobs[0].campaignClientId, 'campaign-2');
  assert.doesNotMatch(JSON.stringify(raced.body), /TOKEN|blob:|access_token/i);

  const resolved = await request(
    fixture.server,
    '/api/runs/run-1/seeding/conflicts/resolve',
    jsonOptions(fixture.ownerCookie, 'POST', { postId: 'page-1_100', campaignClientId: 'campaign-2' })
  );
  assert.equal(resolved.status, 200);
  assert.equal(resolved.body.seeding.jobs[0].campaignClientId, 'campaign-2');
});

test('conflict resolution sanitizes membership validation and rethrows unknown database errors', async (context) => {
  const campaigns = [
    campaignSnapshot({ clientId: 'campaign-1', adClientId: 'ad-1', items: [{ id: 'item-1', message: 'A', imageMediaId: null }] }),
    campaignSnapshot({ clientId: 'campaign-2', adClientId: 'ad-2', items: [{ id: 'item-2', message: 'B', imageMediaId: null }] })
  ];
  const nodes = [
    { clientId: 'ad-1', type: 'ad', status: 'created', remoteId: 'remote-1', postId: 'page-1_100', permalinkUrl: 'https://facebook.test/100' },
    { clientId: 'ad-2', type: 'ad', status: 'created', remoteId: 'remote-2', postId: 'page-1_100', permalinkUrl: 'https://facebook.test/100' }
  ];
  const validationFixture = await routeFixture(context, { runSnapshot: snapshot(campaigns), nodes });
  const invalid = await request(
    validationFixture.server,
    '/api/runs/run-1/seeding/conflicts/resolve',
    jsonOptions(validationFixture.ownerCookie, 'POST', {
      postId: 'page-1_100', campaignClientId: 'campaign-missing'
    })
  );
  assert.equal(invalid.status, 422);
  assert.deepEqual(invalid.body, { error: 'Campaign đã chọn không chứa Post này' });
  assert.doesNotMatch(JSON.stringify(invalid.body), /Selected Campaign does not contain/i);

  const databaseFixture = await routeFixture(context, {
    runSnapshot: snapshot(campaigns),
    nodes,
    dbDecorator(database) {
      return new Proxy(database, {
        get(target, property) {
          if (property === 'insertSeedingJobs') {
            return async () => {
              throw new Error('postgres://admin:DB-SECRET@private-host/internal');
            };
          }
          return target[property];
        }
      });
    }
  });
  const failed = await request(
    databaseFixture.server,
    '/api/runs/run-1/seeding/conflicts/resolve',
    jsonOptions(databaseFixture.ownerCookie, 'POST', {
      postId: 'page-1_100', campaignClientId: 'campaign-1'
    })
  );
  assert.equal(failed.status, 500);
  assert.deepEqual(failed.body, { error: 'Unexpected server error' });
  assert.doesNotMatch(JSON.stringify(failed.body), /DB-SECRET|private-host|postgres/i);
});

test('retry and confirm enforce state guards while cancel and resume return fresh state', async (context) => {
  const fixture = await routeFixture(context, { nodes: [] });
  await fixture.database.insertSeedingJobs('owner-1', [
    job({ id: 'job-failed', status: 'failed' }),
    job({ id: 'job-review', itemId: 'item-2', position: 1, status: 'needs_review' }),
    job({ id: 'job-created', itemId: 'item-3', position: 2, status: 'created' })
  ]);

  const retried = await request(fixture.server, '/api/runs/run-1/seeding/jobs/job-failed/retry', jsonOptions(fixture.ownerCookie));
  assert.equal(retried.status, 200);
  assert.equal(retried.body.seeding.jobs.find(({ id }) => id === 'job-failed').status, 'pending');

  const confirmed = await request(fixture.server, '/api/runs/run-1/seeding/jobs/job-review/confirm', jsonOptions(fixture.ownerCookie));
  assert.equal(confirmed.status, 200);
  assert.equal(confirmed.body.seeding.jobs.find(({ id }) => id === 'job-review').status, 'created');

  const guarded = await request(fixture.server, '/api/runs/run-1/seeding/jobs/job-created/retry', jsonOptions(fixture.ownerCookie));
  assert.equal(guarded.status, 409);
  const missing = await request(fixture.server, '/api/runs/run-1/seeding/jobs/missing/retry', jsonOptions(fixture.ownerCookie));
  assert.equal(missing.status, 404);

  const cancelled = await request(fixture.server, '/api/runs/run-1/seeding/cancel', jsonOptions(fixture.ownerCookie));
  assert.equal(cancelled.status, 200);
  assert.equal(cancelled.body.seeding.summary.cancelled, 1);
  const resumed = await request(fixture.server, '/api/runs/run-1/seeding/resume', jsonOptions(fixture.ownerCookie));
  assert.equal(resumed.status, 200);
  assert.equal(resumed.body.seeding.summary.pending, 1);
});

test('GET seeding and run detail expose only public owner-scoped state', async (context) => {
  const fixture = await routeFixture(context, { nodes: [] });
  await fixture.database.insertSeedingJobs('owner-1', [job({
    error: { message: 'failed https://blob.test/a?signed=1&access_token=secret', authorization: 'Bearer private' }
  })]);

  const state = await request(fixture.server, '/api/runs/run-1/seeding', { headers: { cookie: fixture.ownerCookie } });
  const detail = await request(fixture.server, '/api/runs/run-1', { headers: { cookie: fixture.ownerCookie } });

  assert.equal(state.status, 200);
  assert.equal(detail.body.seeding.summary.total, 1);
  assert.doesNotMatch(JSON.stringify([state.body, detail.body]), /signed=1|access_token=secret|Bearer private|blob\.test/i);
});

function job(overrides = {}) {
  return {
    id: 'job-1', runId: 'run-1', campaignClientId: 'campaign-1', pageId: 'page-1', postId: 'page-1_100',
    itemId: 'item-1', position: 0, sequence: 0, message: 'Bình luận', imageMediaId: null,
    status: 'pending', metaCommentId: null, error: null, attemptCount: 0, availableAt: 1,
    startedAt: null, completedAt: null, createdAt: 1, updatedAt: 1,
    ...overrides
  };
}
