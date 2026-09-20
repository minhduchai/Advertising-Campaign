import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyPublishEvent,
  createPublishProgress,
  mergeRunSnapshot
} from '../public/run-progress.js';

const draft = {
  campaigns: [{
    clientId: 'campaign-1',
    name: 'ChiÃ¡ÂºÂ¿n dÃ¡Â»â€¹ch Tin nhÃ¡ÂºÂ¯n',
    adSets: [{
      clientId: 'adset-1',
      name: 'NhÃƒÂ³m HÃ¡Â»â€œ ChÃƒÂ­ Minh',
      ads: [{ clientId: 'ad-1', name: 'Video 1' }]
    }]
  }]
};

const multiCampaignDraft = {
  campaigns: [
    {
      clientId: 'campaign-1',
      name: 'Triệt nách nữ',
      seeding: { enabled: true, items: [{ id: 'seed-1', message: 'Chi nhánh LG Clinic' }] },
      adSets: [{
        clientId: 'adset-1',
        name: 'Nữ 23-45',
        ads: [
          { clientId: 'ad-1', name: 'Video 1', creativeGroupId: 'creative-shared' },
          { clientId: 'ad-2', name: 'Video 2', creativeGroupId: 'creative-shared' }
        ]
      }]
    },
    {
      clientId: 'campaign-2',
      name: 'Trị sẹo rỗ',
      seeding: { enabled: true, items: [{ id: 'seed-2', message: 'Ưu đãi trị sẹo' }] },
      adSets: [{
        clientId: 'adset-2',
        name: 'Nam 23-45',
        ads: [{ clientId: 'ad-3', name: 'Video 3' }]
      }]
    }
  ]
};

test('creates ordered pending rows for every publishable object', () => {
  const progress = createPublishProgress(draft);
  assert.equal(progress.status, 'preparing');
  assert.equal(progress.total, 3);
  assert.equal(progress.percent, 0);
  assert.deepEqual(progress.nodes.map(({ clientId, type, status }) => [clientId, type, status]), [
    ['campaign-1', 'campaign', 'pending'],
    ['adset-1', 'adSet', 'pending'],
    ['ad-1', 'ad', 'pending']
  ]);
  assert.deepEqual(progress.overall, {
    completed: 0,
    total: 3,
    percent: 0,
    phase: 'creating',
    status: 'pending'
  });
  assert.deepEqual(progress.campaigns, [{
    clientId: 'campaign-1',
    name: draft.campaigns[0].name,
    completed: 0,
    total: 3,
    percent: 0,
    phase: 'creating',
    status: 'pending'
  }]);
});

test('counts skipped publish nodes only after the run reaches a terminal status', () => {
  const progress = createPublishProgress(draft);
  applyPublishEvent(progress, { type: 'node_updated', node: { clientId: 'campaign-1', type: 'campaign', status: 'creating' } });
  assert.deepEqual([progress.completed, progress.percent], [0, 0]);

  applyPublishEvent(progress, { type: 'node_updated', node: { clientId: 'campaign-1', type: 'campaign', status: 'created', remoteId: 'remote-campaign' } });
  assert.equal(progress.currentClientId, null);
  applyPublishEvent(progress, { type: 'node_updated', node: { clientId: 'adset-1', type: 'adSet', status: 'failed', error: { message: 'Invalid Page' } } });
  assert.deepEqual([progress.completed, progress.percent], [2, 66]);

  applyPublishEvent(progress, { type: 'node_updated', node: { clientId: 'ad-1', type: 'ad', status: 'skipped' } });
  assert.deepEqual([progress.completed, progress.percent], [2, 66]);

  applyPublishEvent(progress, { type: 'run_completed', status: 'completed_with_errors', nodes: [] });
  assert.deepEqual([progress.completed, progress.percent], [3, 100]);
  assert.equal(progress.overall.status, 'completed_with_errors');
});

test('merges repeated stream and recovery updates idempotently', () => {
  const progress = createPublishProgress(draft);
  const run = {
    id: 'run-1',
    status: 'completed_with_errors',
    nodes: [
      { clientId: 'campaign-1', type: 'campaign', status: 'created' },
      { clientId: 'adset-1', type: 'adSet', status: 'failed' },
      { clientId: 'ad-1', type: 'ad', status: 'skipped' }
    ]
  };
  mergeRunSnapshot(progress, run);
  mergeRunSnapshot(progress, run);
  assert.equal(progress.nodes.length, 3);
  assert.equal(progress.completed, 3);
  assert.equal(progress.percent, 100);
  assert.equal(progress.status, 'completed_with_errors');
});

test('attaches public seeding state only when a run snapshot is reread', () => {
  const progress = createPublishProgress(draft);
  assert.equal(progress.seeding, null);

  mergeRunSnapshot(progress, {
    id: 'run-1',
    status: 'completed',
    nodes: [],
    seeding: { summary: { total: 2, pending: 2 }, jobs: [] }
  });

  assert.deepEqual(progress.seeding, { summary: { total: 2, pending: 2 }, jobs: [] });
});

test('builds overall and per-campaign progress from publish nodes and unique seeding posts', () => {
  const progress = createPublishProgress(multiCampaignDraft);

  mergeRunSnapshot(progress, {
    id: 'run-multi',
    status: 'completed_with_errors',
    nodes: [
      { clientId: 'campaign-1', type: 'campaign', status: 'created' },
      { clientId: 'adset-1', type: 'adSet', parentClientId: 'campaign-1', status: 'created' },
      { clientId: 'ad-1', type: 'ad', parentClientId: 'adset-1', status: 'created', postId: 'page-1_100' },
      { clientId: 'ad-2', type: 'ad', parentClientId: 'adset-1', status: 'created', postId: 'page-1_100' },
      { clientId: 'campaign-2', type: 'campaign', status: 'created' },
      { clientId: 'adset-2', type: 'adSet', parentClientId: 'campaign-2', status: 'created' },
      { clientId: 'ad-3', type: 'ad', parentClientId: 'adset-2', status: 'failed', postId: 'page-2_200' }
    ],
    seeding: {
      jobs: [
        { id: 'job-1', campaignClientId: 'campaign-1', postId: 'page-1_100', status: 'created' },
        { id: 'job-2', campaignClientId: 'campaign-1', postId: 'page-1_100', status: 'pending' },
        { id: 'job-3', campaignClientId: 'campaign-2', postId: 'page-2_200', status: 'failed' }
      ]
    }
  });

  assert.deepEqual(progress.campaigns, [
    {
      clientId: 'campaign-1', name: 'Triệt nách nữ', completed: 6, total: 7,
      percent: 90, phase: 'seeding', status: 'running'
    },
    {
      clientId: 'campaign-2', name: 'Trị sẹo rỗ', completed: 5, total: 5,
      percent: 100, phase: 'complete', status: 'completed_with_errors'
    }
  ]);
  assert.deepEqual(progress.overall, {
    completed: 11,
    total: 12,
    percent: 93,
    phase: 'seeding',
    status: 'running'
  });
  assert.deepEqual(
    [progress.completed, progress.total, progress.percent],
    [progress.overall.completed, progress.overall.total, progress.overall.percent]
  );
});

test('reserves Post and seeding steps from the start so progress never drops after Ads finish', () => {
  const progress = createPublishProgress({ campaigns: [multiCampaignDraft.campaigns[0]] });
  const initialTotal = progress.total;

  for (const node of progress.nodes) {
    applyPublishEvent(progress, { type: 'node_updated', node: { ...node, status: 'created', ...(node.type === 'ad' ? { postId: 'page-1_100' } : {}) } });
  }
  const afterAds = progress.percent;
  mergeRunSnapshot(progress, {
    status: 'completed',
    seeding: { jobs: [{ campaignClientId: 'campaign-1', postId: 'page-1_100', status: 'pending' }] }
  });

  assert.equal(initialTotal, 6);
  assert.equal(progress.total, initialTotal);
  assert.ok(progress.percent >= afterAds);
  assert.equal(progress.percent, 80);
});

test('finishes one seeding step only after every comment job for the post is terminal', () => {
  const progress = createPublishProgress(multiCampaignDraft);
  const nodes = progress.nodes.map((node) => ({ ...node, status: 'created' }));
  nodes.find((node) => node.clientId === 'ad-1').postId = 'page-1_100';
  nodes.find((node) => node.clientId === 'ad-2').postId = 'page-1_100';
  nodes.find((node) => node.clientId === 'ad-3').postId = 'page-2_200';

  mergeRunSnapshot(progress, {
    status: 'completed',
    nodes,
    seeding: {
      jobs: [
        { campaignClientId: 'campaign-1', postId: 'page-1_100', status: 'created' },
        { campaignClientId: 'campaign-1', postId: 'page-1_100', status: 'cancelled' },
        { campaignClientId: 'campaign-2', postId: 'page-2_200', status: 'unexpected_meta_state' }
      ]
    }
  });

  assert.equal(progress.overall.percent, 93);
  assert.equal(progress.overall.phase, 'seeding');
  assert.equal(progress.overall.status, 'needs_review');
  assert.equal(progress.campaigns[0].status, 'completed_with_errors');
  assert.equal(progress.campaigns[1].status, 'needs_review');
});

test('keeps waiting seeding posts pending before jobs are prepared', () => {
  const progress = createPublishProgress({ campaigns: [multiCampaignDraft.campaigns[0]] });
  mergeRunSnapshot(progress, {
    status: 'completed',
    nodes: [
      { clientId: 'campaign-1', type: 'campaign', status: 'created' },
      { clientId: 'adset-1', type: 'adSet', parentClientId: 'campaign-1', status: 'created' },
      { clientId: 'ad-1', type: 'ad', parentClientId: 'adset-1', status: 'created' },
      { clientId: 'ad-2', type: 'ad', parentClientId: 'adset-1', status: 'created' }
    ],
    seeding: { jobs: [], waitingPostCount: 2 }
  });

  assert.deepEqual(progress.overall, {
    completed: 4,
    total: 6,
    percent: 70,
    phase: 'publishing',
    status: 'running'
  });
});

test('counts Post retrieval and seeding once for a shared Post ID', () => {
  const progress = createPublishProgress({ campaigns: [multiCampaignDraft.campaigns[0]] });
  mergeRunSnapshot(progress, {
    status: 'completed',
    nodes: [
      { clientId: 'campaign-1', type: 'campaign', status: 'created' },
      { clientId: 'adset-1', type: 'adSet', parentClientId: 'campaign-1', status: 'created' },
      { clientId: 'ad-1', type: 'ad', parentClientId: 'adset-1', status: 'created', postId: 'page-1_100' },
      { clientId: 'ad-2', type: 'ad', parentClientId: 'adset-1', status: 'created', postId: 'page-1_100' }
    ],
    seeding: {
      jobs: [{ campaignClientId: 'campaign-1', postId: 'page-1_100', status: 'pending' }],
      waitingPostCount: 0
    }
  });

  assert.deepEqual(progress.overall, {
    completed: 5,
    total: 6,
    percent: 80,
    phase: 'seeding',
    status: 'running'
  });
});

test('advances smoothly for every completed seeding comment', () => {
  const campaign = structuredClone(multiCampaignDraft.campaigns[0]);
  campaign.seeding.items = Array.from({ length: 8 }, (_, index) => ({
    id: `seed-${index + 1}`,
    message: `Bình luận ${index + 1}`
  }));
  const progress = createPublishProgress({ campaigns: [campaign] });
  const nodes = progress.nodes.map((node) => ({
    ...node,
    status: 'created',
    ...(node.type === 'ad' ? { postId: 'page-1_100' } : {})
  }));

  mergeRunSnapshot(progress, {
    status: 'completed',
    nodes,
    seeding: {
      jobs: campaign.seeding.items.map((item, index) => ({
        id: `job-${index + 1}`,
        campaignClientId: campaign.clientId,
        postId: 'page-1_100',
        position: index,
        status: index < 3 ? 'created' : 'pending'
      }))
    }
  });
  assert.equal(progress.percent, 87);

  progress.seeding.jobs[3].status = 'created';
  mergeRunSnapshot(progress, { seeding: progress.seeding });
  assert.equal(progress.percent, 90);
});

test('maps legacy jobs by post ID and groups unmapped data without crashing', () => {
  const progress = createPublishProgress({ campaigns: [multiCampaignDraft.campaigns[0]] });
  mergeRunSnapshot(progress, {
    status: 'completed',
    nodes: [
      { clientId: 'campaign-1', type: 'campaign', status: 'created' },
      { clientId: 'adset-1', type: 'adSet', parentClientId: 'campaign-1', status: 'created' },
      { clientId: 'ad-1', type: 'ad', parentClientId: 'adset-1', status: 'created', postId: 'page-1_100' },
      { clientId: 'legacy-ad', type: 'ad', parentClientId: 'missing-adset', status: 'created' }
    ],
    seeding: {
      jobs: [
        { postId: 'page-1_100', status: 'created' },
        { postId: 'legacy-post', status: 'created' }
      ]
    }
  });

  assert.equal(progress.campaigns[0].clientId, 'campaign-1');
  assert.deepEqual(progress.campaigns.at(-1), {
    clientId: '__unknown__',
    name: 'Không xác định',
    completed: 3,
    total: 3,
    percent: 100,
    phase: 'complete',
    status: 'completed'
  });
});

test('preserves legacy waiting post counts when campaign mapping is unavailable', () => {
  const progress = createPublishProgress({ campaigns: [] });

  mergeRunSnapshot(progress, {
    status: 'completed',
    nodes: [],
    seeding: { jobs: [], waitingPostCount: 2 }
  });

  assert.deepEqual(progress.overall, {
    completed: 0,
    total: 4,
    percent: 0,
    phase: 'publishing',
    status: 'running'
  });
  assert.deepEqual(progress.campaigns, [{
    clientId: '__unknown__',
    name: 'Không xác định',
    completed: 0,
    total: 4,
    percent: 0,
    phase: 'publishing',
    status: 'running'
  }]);
});
