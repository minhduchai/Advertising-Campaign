export const UNHIDE_DELAY_MS = 5 * 24 * 60 * 60 * 1000;

// One paginated pass with a fixed cutoff; never include comments arriving later.
export async function processUnhidePage({ job, api, save, now = Date.now, enabledAt = 0 }) {
  if (job.status && job.status !== 'pending') return { status: job.status };
  let state = { ...job.state };
  if (!state.postCreatedAt) {
    const post = await api.readPost(job.post_id);
    const created = Date.parse(post.created_time);
    if (!Number.isFinite(created)) throw new Error('Meta did not return post created_time');
    state.postCreatedAt = created;
    if (created < enabledAt) {
      await save(state, 'excluded', now());
      return { status: 'excluded' };
    }
    await save(state, 'pending', created + UNHIDE_DELAY_MS);
  }
  const dueAt = state.postCreatedAt + UNHIDE_DELAY_MS;
  if (now() < dueAt) return { status: 'waiting', dueAt };
  if (!state.cutoff) {
    state.cutoff = now();
    await save(state, 'pending', dueAt);
  }
  const page = await api.listComments(job.post_id, state.after, state.cutoff);
  if (!Array.isArray(page.data)) throw new Error('Invalid Meta comments response');
  state.processed ??= [];
  state.unhidden ??= 0;
  state.skipped ??= 0;
  for (const comment of page.data) {
    if (state.processed.includes(comment.id)) continue;
    const createdAt = Date.parse(comment.created_time);
    if (!Number.isFinite(createdAt)) throw new Error('Comment created_time missing');
    if (createdAt <= state.cutoff && comment.is_hidden === true) {
      if (comment.can_hide === false) state.skipped += 1;
      else {
        await api.unhide(comment.id);
        const verified = await api.readComment(comment.id);
        if (verified.is_hidden !== false) throw new Error('Comment remains hidden after update');
        state.unhidden += 1;
      }
    }
    state.processed.push(comment.id);
    await save(state, 'pending', dueAt);
  }
  const after = page.paging?.next ? page.paging?.cursors?.after : null;
  if (page.paging?.next && (!after || after === state.after)) throw new Error('Invalid comments pagination');
  state.after = after;
  state.processed = [];
  const status = after ? 'pending' : state.skipped ? 'completed_with_errors' : 'completed';
  await save(state, status, now());
  return { status, unhidden: state.unhidden, skipped: state.skipped };
}
