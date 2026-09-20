import test from 'node:test';
import assert from 'node:assert/strict';
import { recoverPublications } from '../src/publication-recovery.js';

test('retries a not-yet-ready post and persists it when Meta later returns it', async () => {
  const jobs = [{ attempts: 0 }], schedules = [], saved = [];
  let ready = false;
  const args = { jobs, now: () => 1000,
    lookup: async () => ready ? { postId: '1_2', permalinkUrl: 'https://www.facebook.com/1/posts/2' } : {},
    save: async (job, value) => saved.push(value),
    schedule: async (job, value) => schedules.push(value) };
  assert.equal((await recoverPublications(args)).pending, 1);
  assert.equal(schedules[0].nextAt, 61000);
  assert.equal(saved.length, 0);
  ready = true;
  assert.equal((await recoverPublications(args)).resolved, 1);
  assert.equal(saved[0].postId, '1_2');
  assert.equal(schedules[1].attempts, 0);
});

test('a failing lookup does not block later ads and logs no secret message', async () => {
  const schedules = [], saved = [];
  const result = await recoverPublications({
    jobs: [{ remote_id: 'bad', attempts: 20 }, { remote_id: 'good' }], now: () => 1000,
    lookup: async job => {
      if (job.remote_id === 'bad') throw Object.assign(new Error('secret token'), { meta: { code: 10 } });
      return { postId: '1_2', permalinkUrl: 'url' };
    },
    save: async job => saved.push(job.remote_id),
    schedule: async (job, value) => schedules.push(value)
  });
  assert.deepEqual(result, { checked: 2, resolved: 1, pending: 1, errors: 1 });
  assert.deepEqual(saved, ['good']);
  assert.deepEqual(schedules[0], { attempts: 21, nextAt: 3601000, code: '10' });
});

test('failed database save remains retryable', async () => {
  let scheduled;
  const result = await recoverPublications({ jobs: [{}], now: () => 0,
    lookup: async () => ({ postId: '1_2', permalinkUrl: 'url' }),
    save: async () => { throw new Error('database unavailable'); },
    schedule: async (job, value) => { scheduled = value; }
  });
  assert.equal(result.resolved, 0);
  assert.equal(scheduled.attempts, 1);
});
