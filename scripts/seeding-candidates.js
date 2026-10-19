import { STALE_JOB_MS } from '../src/seeding-service.js';

export function seedingCandidates(sql, now = Date.now()) {
  return sql`SELECT r.id FROM runs r
    LEFT JOIN LATERAL (
      SELECT MIN(j.available_at) AS due_at FROM seeding_jobs j
      WHERE j.run_id = r.id AND (
        (j.status = 'posting' AND j.started_at < ${now - STALE_JOB_MS}) OR
        (j.status = 'pending' AND j.available_at <= ${now}
          AND NOT EXISTS (SELECT 1 FROM seeding_jobs p WHERE p.run_id = j.run_id AND p.status = 'posting')
          AND NOT EXISTS (SELECT 1 FROM seeding_jobs p WHERE p.run_id = j.run_id
            AND p.campaign_client_id = j.campaign_client_id AND p.post_id = j.post_id
            AND p.position < j.position AND p.status IN ('pending', 'posting', 'needs_review')))
      )
    ) due ON true
    WHERE r.status IN ('creating', 'retrying_ad', 'seeding', 'completed', 'completed_with_errors')
      AND (r.created_at >= ${now - 14 * 86400000} OR due.due_at IS NOT NULL)
    ORDER BY (due.due_at IS NOT NULL) DESC, due.due_at, r.created_at DESC LIMIT 20`;
}
