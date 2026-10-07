import { createSqlTransport } from './postgres-transport.js';
import { randomUUID } from 'node:crypto';
import { decryptToken } from './crypto.js';
import { processUnhidePage } from './comment-unhide.js';
import { createMetaClient } from './meta-client.js';
import { withErrorContext, setErrorContext, recordError } from './error-journal.js';

export function tickCommentUnhide(options) {
  return withErrorContext({ ownerMetaUserId: options.config.commentUnhideOwner, stage: 'comment-unhide' },
    () => tickCommentUnhideWithContext(options));
}

async function tickCommentUnhideWithContext({ config, db, metaClient }) {
  const owner = config.commentUnhideOwner;
  const enabledAt = config.commentUnhideEnabledAt;
  if (!owner || !Number.isFinite(enabledAt) || !config.databaseUrl) return { status: 'disabled' };
  const sql = createSqlTransport(config.databaseUrl);
  try {
  const now = Date.now();
  const signal = AbortSignal.timeout(85000);
  metaClient = createMetaClient(config, { fetchImpl: (url, options = {}) => fetch(url, {
    ...options, signal: options.signal ? AbortSignal.any([signal, options.signal]) : signal
  }) });
  // Old runs are excluded. One job per owner/Post ID even when multiple ads share a post.
  await sql`INSERT INTO comment_unhide_jobs (owner_id, post_id, run_id, state, next_at)
    SELECT DISTINCT ON (n.post_id) r.owner_meta_user_id, n.post_id, r.id, '{}'::jsonb, ${now}
    FROM runs r JOIN node_results n ON n.run_id = r.id
    WHERE r.owner_meta_user_id = ${owner} AND r.created_at >= ${enabledAt}
      AND n.type = 'ad' AND n.status = 'created' AND n.post_id ~ '^[0-9]+_[0-9]+$'
    ORDER BY n.post_id, r.created_at
    ON CONFLICT (owner_id, post_id) DO NOTHING`;
  const lease = randomUUID();
  const [job] = await sql`UPDATE comment_unhide_jobs SET lease = ${lease}, lease_until = ${now + 180000}
    WHERE (owner_id, post_id) = (SELECT owner_id, post_id FROM comment_unhide_jobs
      WHERE owner_id = ${owner} AND status = 'pending' AND next_at <= ${now}
        AND (lease_until IS NULL OR lease_until < ${now})
      ORDER BY next_at, post_id FOR UPDATE SKIP LOCKED LIMIT 1)
    RETURNING *`;
  if (!job) return { status: 'idle' };
  setErrorContext({ runId: job.run_id, clientId: job.post_id, nodeType: 'post' });
  try {
    const connection = await db.getConnection(owner);
    if (!connection) throw new Error('Meta connection missing');
    const token = decryptToken(connection.accessTokenCiphertext, config.tokenEncryptionKey);
    const pageId = job.post_id.split('_')[0];
    const context = await metaClient.getPageEngagementContext(token, [pageId]);
    const pageToken = context.pages?.get(pageId)?.accessToken;
    if (!context.permissionGranted || !pageToken) throw new Error('Page moderation permission missing');
    const api = {
      readPost: id => metaClient.readModerationPost(pageToken, id, { signal }),
      listComments: (id, after, cutoff) => metaClient.listModerationComments(pageToken, id, { after, cutoff, signal }),
      readComment: id => metaClient.readModerationComment(pageToken, id, { signal }),
      unhide: id => metaClient.unhideComment(pageToken, id, { signal })
    };
    const save = async (state, status, nextAt) => {
      const rows = await sql`UPDATE comment_unhide_jobs SET state = ${JSON.stringify(state)}::jsonb,
        status = ${status}, next_at = ${nextAt}, updated_at = ${Date.now()}
        WHERE owner_id = ${owner} AND post_id = ${job.post_id} AND lease = ${lease}
          AND lease_until > ${Date.now()} RETURNING post_id`;
      if (!rows.length) throw new Error('Unhide job lease lost');
    };
    const result = await processUnhidePage({ job, api, save, enabledAt });
    await sql`UPDATE comment_unhide_jobs SET lease = NULL, lease_until = NULL, attempts = 0, last_error = NULL
      WHERE owner_id = ${owner} AND post_id = ${job.post_id} AND lease = ${lease}`;
    return result;
  } catch (error) {
    recordError(error, { stage: 'comment-unhide', runId: job.run_id, clientId: job.post_id });
    const attempts = Number(job.attempts) + 1;
    // Do not log raw Meta errors/URLs or tokens. Keep a diagnostic code for manual review.
    const diagnostic = String(error.meta?.code ?? error.name ?? 'Error');
    await sql`UPDATE comment_unhide_jobs SET attempts = ${attempts},
      status = ${attempts >= 6 ? 'needs_review' : 'pending'}, last_error = ${diagnostic},
      next_at = ${Date.now() + Math.min(3600000, 60000 * 2 ** attempts)}, lease = NULL, lease_until = NULL
      WHERE owner_id = ${owner} AND post_id = ${job.post_id} AND lease = ${lease}`;
    return { status: attempts >= 6 ? 'needs_review' : 'retry_pending', code: diagnostic };
  }
  } finally {
    await sql.end?.();
  }
}
