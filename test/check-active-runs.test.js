import test from 'node:test';
import assert from 'node:assert/strict';
import { countActiveRuns, isRunActive, STALE_RUN_MS, DIRECT_RUN_WINDOW_MS } from '../scripts/check-active-runs.js';

const NOW = 1_800_000_000_000;

test('a workflow run with an unexpired lease is active', () => {
  assert.equal(isRunActive({ status: 'creating', created_at: NOW - 60_000, workflow_lease_expires_at: NOW + 5_000 }, NOW), true);
  assert.equal(isRunActive({ status: 'seeding', created_at: NOW - 3_600_000, workflow_lease_expires_at: NOW + 1 }, NOW), true);
  assert.equal(isRunActive({ status: 'retrying_ad', created_at: NOW - 60_000, workflow_lease_expires_at: String(NOW + 5_000) }, NOW), true);
});

test('a workflow run whose lease has expired is idle and does not block a deploy', () => {
  assert.equal(isRunActive({ status: 'creating', created_at: NOW - 60_000, workflow_lease_expires_at: NOW - 1 }, NOW), false);
});

test('a direct run without a lease counts only for a short window after creation', () => {
  assert.equal(isRunActive({ status: 'creating', created_at: NOW - 60_000, workflow_lease_expires_at: null }, NOW), true);
  assert.equal(isRunActive({ status: 'creating', created_at: NOW - DIRECT_RUN_WINDOW_MS - 1, workflow_lease_expires_at: null }, NOW), false);
});

test('finished, stale or malformed runs are ignored', () => {
  for (const status of ['completed', 'completed_with_errors', 'failed']) {
    assert.equal(isRunActive({ status, created_at: NOW - 1000, workflow_lease_expires_at: NOW + 60_000 }, NOW), false);
  }
  assert.equal(isRunActive({ status: 'creating', created_at: NOW - STALE_RUN_MS - 1, workflow_lease_expires_at: NOW + 60_000 }, NOW), false);
  assert.equal(isRunActive({ status: 'creating', created_at: 'abc', workflow_lease_expires_at: NOW + 60_000 }, NOW), false);
  assert.equal(isRunActive(undefined, NOW), false);
});

test('countActiveRuns counts only the active ones', () => {
  const rows = [
    { status: 'creating', created_at: NOW - 1000, workflow_lease_expires_at: NOW + 5000 },
    { status: 'creating', created_at: NOW - 1000, workflow_lease_expires_at: NOW - 5000 },
    { status: 'completed', created_at: NOW - 1000, workflow_lease_expires_at: NOW + 5000 },
    { status: 'seeding', created_at: NOW - 1000, workflow_lease_expires_at: NOW + 5000 }
  ];
  assert.equal(countActiveRuns(rows, NOW), 2);
  assert.equal(countActiveRuns([], NOW), 0);
});
