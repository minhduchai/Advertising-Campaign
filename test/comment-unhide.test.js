import test from 'node:test';
import assert from 'node:assert/strict';
import { processUnhidePage, UNHIDE_DELAY_MS } from '../src/comment-unhide.js';
import { createMetaClient } from '../src/meta-client.js';

function fixture() {
  let time = 1000000 + UNHIDE_DELAY_MS;
  const job = { post_id: '1_2', state: {} };
  const writes = [], changed = [];
  const api = {
    readPost: async () => ({ created_time: new Date(1000000).toISOString() }),
    listComments: async () => ({ data: [] }),
    unhide: async id => { changed.push(id); },
    readComment: async () => ({ is_hidden: false })
  };
  return { job, api, writes, changed, now: () => time, setTime: value => { time = value; },
    save: async (state, status, nextAt) => { job.state = structuredClone(state); writes.push({ status, nextAt }); } };
}

test('completed posts never run again', async () => {
  const f = fixture(); f.job.status = 'completed';
  f.api.readPost = async () => { throw Error('must not read again'); };
  assert.equal((await processUnhidePage(f)).status, 'completed');
});

test('Meta moderation requests use the page token, stream pagination and is_hidden=false', async () => {
  const requests = [];
  const client = createMetaClient({ apiVersion: 'v25.0' }, { fetchImpl: async (url, options) => {
    requests.push({ url: new URL(url), options });
    return Response.json(options.method === 'POST' ? { success: true } : { data: [] });
  } });
  await client.listModerationComments('fake-page-token', '1_2', { after: 'next', cutoff: 500000 });
  await client.unhideComment('fake-page-token', '1_3');
  assert.equal(requests[0].url.searchParams.get('filter'), 'stream');
  assert.equal(requests[0].url.searchParams.get('after'), 'next');
  assert.equal(requests[0].url.searchParams.get('until'), '500');
  assert.equal(requests[1].options.headers.authorization, 'Bearer fake-page-token');
  assert.equal(new URLSearchParams(requests[1].options.body).get('is_hidden'), 'false');
});

test('never unhides before 120h based on Meta post creation time', async () => {
  const f = fixture(); f.setTime(1000000 + UNHIDE_DELAY_MS - 1);
  f.api.listComments = async () => { throw Error('must not enumerate early'); };
  assert.equal((await processUnhidePage(f)).status, 'waiting');
  assert.deepEqual(f.changed, []);
});

test('includes hidden comments and replies, excludes new comments after fixed cutoff', async () => {
  const f = fixture(); const date = new Date(f.now() - 1).toISOString();
  f.api.listComments = async () => ({ data: [
    { id: 'hidden', is_hidden: true, can_hide: true, created_time: date },
    { id: 'reply', is_hidden: true, can_hide: true, created_time: date },
    { id: 'visible', is_hidden: false, created_time: date },
    { id: 'new', is_hidden: true, created_time: new Date(f.now() + 1000).toISOString() }
  ] });
  assert.equal((await processUnhidePage(f)).status, 'completed');
  assert.deepEqual(f.changed, ['hidden', 'reply']);
});

test('resume preserves processed comments and cutoff after a partial failure', async () => {
  const f = fixture(); const date = new Date(f.now() - 1).toISOString();
  f.api.listComments = async () => ({ data: ['a', 'b'].map(id => ({ id, is_hidden: true, created_time: date })) });
  f.api.unhide = async id => { if (id === 'b') throw Error('transient'); f.changed.push(id); };
  await assert.rejects(processUnhidePage(f), /transient/);
  const cutoff = f.job.state.cutoff;
  f.setTime(f.now() + 60000);
  f.api.unhide = async id => { f.changed.push(id); };
  await processUnhidePage(f);
  assert.deepEqual(f.changed, ['a', 'b']);
  assert.equal(f.job.state.cutoff, cutoff);
});

test('pagination is followed and incomplete permissions are not reported as success', async () => {
  const f = fixture();
  f.api.listComments = async (_post, after) => after ? { data: [{ id: 'blocked', is_hidden: true, can_hide: false, created_time: new Date(1000000).toISOString() }] } : { data: [], paging: { next: 'unused', cursors: { after: 'cursor' } } };
  assert.equal((await processUnhidePage(f)).status, 'pending');
  assert.equal((await processUnhidePage(f)).status, 'completed_with_errors');
  assert.deepEqual(f.changed, []);
});

test('old reused posts are excluded and failed verification stays retryable', async () => {
  const f = fixture();
  assert.equal((await processUnhidePage({ ...f, enabledAt: 2000000 })).status, 'excluded');
  const g = fixture();
  g.api.listComments = async () => ({ data: [{ id: 'a', is_hidden: true, created_time: new Date(1000000).toISOString() }] });
  g.api.readComment = async () => ({ is_hidden: true });
  await assert.rejects(processUnhidePage(g), /remains hidden/);
  assert.ok(!g.writes.some(w => w.status === 'completed'));
});
