import test from 'node:test';
import assert from 'node:assert/strict';
import {
  activityHistoryReportCopyText,
  activityHistoryReportRows,
  activityHistoryQuery,
  buildSeedingStatusByPost,
  campaignEmployeeName,
  campaignServiceName,
  createActivityHistoryState,
  hasMissingPublications,
  runWorkflowStalled,
  historyPresetRange,
  historyRunSummary,
  isActiveHistoryRun,
  publicationRetryDelay,
  renderActivityHistory,
  renderActivityHistoryReportTable
} from '../public/activity-history.js';

test('extracts the service from the approved Campaign naming convention', () => {
  assert.equal(
    campaignEmployeeName('Đức_Trị Thâm Nữ 500K_Messenger_LGCL_Hồ Chí Minh_04/09/2026'),
    'Đức'
  );
  assert.equal(
    campaignServiceName('Đức_Trị Thâm Nữ 500K_Messenger_LGCL_Hồ Chí Minh_04/09/2026'),
    'Trị Thâm Nữ 500K'
  );
  assert.equal(
    campaignServiceName('Đức_Trị_Thâm Nữ 500K_Messenger_LGCL_Hồ Chí Minh_04/09/2026'),
    'Trị Thâm Nữ 500K'
  );
  assert.equal(campaignServiceName('Campaign không theo quy tắc'), 'Campaign không theo quy tắc');
});

test('builds safe report rows and creates an Excel-friendly copied table', () => {
  const createdAt = new Date(2026, 8, 4, 14, 30).getTime();
  const run = {
    id: 'run-export',
    createdAt,
    snapshot: {
      campaigns: [{
        clientId: 'campaign-1',
        name: 'Đức_Trị Thâm Nữ 500K_Messenger_LGCL_Hồ Chí Minh_04/09/2026',
        adSets: [{
          clientId: 'adset-1',
          ads: [
            { clientId: 'ad-1', name: 'Video 1' },
            { clientId: 'ad-2', name: '=Video nguy hiểm' }
          ]
        }]
      }]
    },
    nodes: [
      { clientId: 'ad-1', type: 'ad', permalinkUrl: 'https://www.facebook.com/reel/123' },
      { clientId: 'ad-2', type: 'ad', permalinkUrl: 'javascript:alert(1)' }
    ]
  };

  const rows = activityHistoryReportRows([run]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].employeeName, 'Đức');
  assert.equal(rows[0].serviceName, 'Trị Thâm Nữ 500K');
  assert.equal(rows[0].postLink, 'https://www.facebook.com/reel/123');
  assert.equal(rows[1].postLink, '');

  const copiedTable = activityHistoryReportCopyText(rows);
  assert.ok(copiedTable.startsWith('Ngày tạo\tTên nhân viên\tDịch vụ\tLink bài quảng cáo'));
  assert.match(copiedTable, /Đức\tTrị Thâm Nữ 500K\thttps:\/\/www\.facebook\.com\/reel\/123/);

  const table = renderActivityHistoryReportTable(rows);
  assert.match(table, /<th>Ngày tạo<\/th><th>Tên nhân viên<\/th><th>Dịch vụ<\/th><th>Link bài quảng cáo<\/th>/);
  assert.match(table, /target="_blank" rel="noopener noreferrer"/);
  assert.match(table, /Đang chờ link/);
});

test('keeps only one activity report row for a shared Post ID or duplicate link', () => {
  const run = {
    createdAt: new Date(2026, 8, 4, 14, 30).getTime(),
    snapshot: {
      campaigns: [{
        name: 'Đức_Trị Thâm Nữ 500K_Messenger_LGCL_Hồ Chí Minh_04/09/2026',
        adSets: [
          { ads: [{ clientId: 'ad-1', name: 'Bản 1' }, { clientId: 'ad-2', name: 'Bản 2' }] },
          { ads: [{ clientId: 'ad-3', name: 'Bản 3' }, { clientId: 'ad-4', name: 'Bản 4' }] }
        ]
      }]
    },
    nodes: [
      { clientId: 'ad-1', postId: 'page_123', permalinkUrl: null },
      { clientId: 'ad-2', postId: 'page_123', permalinkUrl: 'https://www.facebook.com/posts/123' },
      { clientId: 'ad-3', postId: 'page_456', permalinkUrl: 'https://www.facebook.com/posts/456' },
      { clientId: 'ad-4', postId: 'page_789', permalinkUrl: 'https://www.facebook.com/posts/456' }
    ]
  };

  const rows = activityHistoryReportRows([run]);

  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((row) => row.postLink), [
    'https://www.facebook.com/posts/123',
    'https://www.facebook.com/posts/456'
  ]);
});

test('aggregates seeding jobs by Post ID using the reporting priority', () => {
  const statuses = buildSeedingStatusByPost({
    seeding: {
      jobs: [
        { postId: 'post-failed', status: 'created' },
        { postId: 'post-failed', status: 'failed', error: { message: 'Meta từ chối' } },
        { postId: 'post-review', status: 'created' },
        { postId: 'post-review', status: 'needs_review', error: 'Cần kiểm tra quyền' },
        { postId: 'post-progress', status: 'created' },
        { postId: 'post-progress', status: 'posting' },
        { postId: 'post-success', status: 'created' },
        { postId: 'post-cancelled', status: 'created' },
        { postId: 'post-cancelled', status: 'cancelled' },
        { postId: 'post-unknown', status: 'created' },
        { postId: 'post-unknown', status: 'unexpected_meta_state' }
      ]
    }
  });

  assert.deepEqual(statuses.get('post-failed'), {
    status: 'failed', label: 'Thất bại', errorMessage: 'Meta từ chối'
  });
  assert.deepEqual(statuses.get('post-review'), {
    status: 'needs_review', label: 'Cần kiểm tra', errorMessage: 'Cần kiểm tra quyền'
  });
  assert.deepEqual(statuses.get('post-progress'), {
    status: 'progress', label: 'Đang xử lý', errorMessage: ''
  });
  assert.deepEqual(statuses.get('post-success'), {
    status: 'succeeded', label: 'Thành công', errorMessage: ''
  });
  assert.deepEqual(statuses.get('post-cancelled'), {
    status: 'none', label: 'Chưa seeding', errorMessage: ''
  });
  assert.deepEqual(statuses.get('post-unknown'), {
    status: 'needs_review', label: 'Cần kiểm tra', errorMessage: ''
  });
  assert.equal(statuses.has(''), false);
});

test('builds an inclusive local date range for the history API', () => {
  const query = activityHistoryQuery({ from: '2026-08-01', to: '2026-08-12' }, 40);

  const from = new Date(query.from);
  const to = new Date(query.to);
  assert.deepEqual([from.getFullYear(), from.getMonth() + 1, from.getDate(), from.getHours()], [2026, 8, 1, 0]);
  assert.deepEqual([to.getFullYear(), to.getMonth() + 1, to.getDate(), to.getHours()], [2026, 8, 13, 0]);
  assert.equal(query.limit, 50);
  assert.equal(query.offset, 40);
});

test('loads only five recent runs until a date filter is applied', () => {
  assert.equal(activityHistoryQuery({ from: '', to: '' }).limit, 5);
  assert.equal(activityHistoryQuery({ from: '2026-08-01', to: '2026-08-18' }).limit, 50);
});

test('starts with an unloaded activity-history cache', () => {
  assert.equal(createActivityHistoryState().loaded, false);
});

test('builds live campaign percentages from an in-progress run snapshot', () => {
  const run = {
    id: 'run-live', status: 'creating', createdAt: 10,
    snapshot: { campaigns: [{
      clientId: 'campaign-live', name: 'Campaign live', adAccountId: 'act_1',
      adSets: [{ clientId: 'adset-live', ads: [{ clientId: 'ad-live' }] }]
    }] },
    nodes: [
      { clientId: 'campaign-live', type: 'campaign', status: 'created' },
      { clientId: 'adset-live', type: 'adSet', status: 'created' },
      { clientId: 'ad-live', type: 'ad', status: 'creating' }
    ]
  };

  const summary = historyRunSummary(run);

  assert.equal(isActiveHistoryRun(summary), true);
  assert.deepEqual(summary.campaigns[0], {
    clientId: 'campaign-live', name: 'Campaign live', adAccountId: 'act_1',
    adSets: 1, ads: 1, completed: 2, total: 3, status: 'pending', errorMessage: ''
  });
  assert.deepEqual(summary.counts, {
    total: 3, created: 2, failed: 0, skipped: 0, campaigns: 1, adSets: 1, ads: 1
  });

  const completed = historyRunSummary({
    ...run,
    status: 'completed',
    nodes: run.nodes.map((node) => ({ ...node, status: 'created' }))
  }, summary);
  assert.equal(isActiveHistoryRun(completed), false);
  assert.equal(completed.campaigns[0].completed, 3);
  assert.equal(completed.campaigns[0].status, 'created');
});

test('renders date filters, run summaries, legacy labels, and load-more control', () => {
  const history = createActivityHistoryState();
  history.filters = { from: '2026-08-01', to: '2026-08-12' };
  history.items = [{
    id: 'run-legacy',
    status: 'completed_with_errors',
    adAccountId: null,
    createdAt: new Date(2026, 7, 12, 9, 30).getTime(),
    completedAt: null,
    legacy: true,
    counts: { total: 5, created: 3, failed: 1, skipped: 1, campaigns: 1, adSets: 2, ads: 2 }
  }];
  history.nextOffset = 20;

  const html = renderActivityHistory(history, { adAccounts: [{ id: 'act_1', name: 'LG Clinic 37' }] });

  assert.match(html, /Lịch sử hoạt động/);
  assert.match(html, /01\/08\/2026/);
  assert.match(html, /12\/08\/2026/);
  assert.match(html, /data-action="toggle-history-date-picker"/);
  assert.match(html, /history-date-trigger-copy/);
  assert.doesNotMatch(html, /<span>Chọn ngày<\/span>/);
  assert.match(html, /Dữ liệu cũ chưa đầy đủ/);
  assert.match(html, /3 thành công/);
  assert.match(html, /1 thất bại/);
  assert.match(html, /history-status-icon/);
  assert.match(html, /Xem báo cáo/);
  assert.match(html, /history-summary-meta/);
  assert.match(html, /data-action="load-more-history"/);
  assert.match(html, /data-action="open-activity-history-report"/);
  assert.match(html, />Xem bảng</);
});

test('groups campaigns in a collapsible run card and renders campaign report as an inline accordion', () => {
  const history = createActivityHistoryState();
  history.items = [{
    id: 'run-cards', createdAt: 1, status: 'completed',
    campaigns: [
      { clientId: 'campaign-a', name: 'Triệt nách nữ', adAccountId: 'act_1', adSets: 1, ads: 1, completed: 3, total: 3, status: 'created', errorMessage: '' },
      { clientId: 'campaign-b', name: 'Trị sẹo rỗ', adAccountId: 'act_2', adSets: 0, ads: 0, completed: 0, total: 1, status: 'failed', errorMessage: '<Lỗi Campaign>' }
    ]
  }];

  const html = renderActivityHistory(history, { adAccounts: [{ id: 'act_1', name: 'LG Clinic 01' }, { id: 'act_2', name: 'LG Clinic 02' }] });

  assert.equal((html.match(/class="history-campaign-card is-/g) ?? []).length, 2);
  assert.match(html, /class="history-campaign-item"/);
  assert.match(html, /<button[^>]+class="history-campaign-card is-created"[^>]+data-action="toggle-history-campaign"[^>]+data-campaign-client-id="campaign-a"[^>]+aria-expanded="false"/);
  assert.match(html, /<button[^>]+class="history-campaign-card is-failed"[^>]+data-action="toggle-history-campaign"[^>]+data-campaign-client-id="campaign-b"[^>]+aria-expanded="false"/);
  assert.match(html, /<details class="history-run-card has-errors">/);
  assert.doesNotMatch(html, /<details class="history-run-card has-errors" open>/);
  assert.match(html, /class="history-run-card-summary"/);
  assert.match(html, /class="history-run-toggle-icon"/);
  assert.match(html, /<polyline points="6 9 12 15 18 9"><\/polyline>/);
  assert.match(html, /2 chiến dịch/);
  assert.match(html, /LG Clinic 01/);
  assert.match(html, /aria-label="Tiến độ Triệt nách nữ"/);
  assert.match(html, /aria-valuenow="100"/);
  assert.match(html, /data-history-progress-value aria-live="polite" aria-atomic="true">100%<\/span>/);
  assert.match(html, /data-history-progress-fill style="--history-progress: 100%"/);
  assert.match(html, /&lt;Lỗi Campaign&gt;/);
  assert.doesNotMatch(html, /<Lỗi Campaign>/);
});

test('shows rounded campaign completion percentage in activity history', () => {
  const history = createActivityHistoryState();
  history.items = [{
    id: 'run-progress', createdAt: 1, status: 'running',
    campaigns: [
      { clientId: 'campaign-progress', name: 'Triệt nách nữ', adAccountId: 'act_1', adSets: 4, ads: 4, completed: 7, total: 9, status: 'pending', errorMessage: '' }
    ]
  }];

  const html = renderActivityHistory(history);

  assert.match(html, /aria-valuenow="78"/);
  assert.match(html, /aria-valuetext="78% · 7\/9 bước hoàn tất"/);
  assert.match(html, /data-history-progress-value aria-live="polite" aria-atomic="true">78%<\/span>/);
  assert.match(html, /data-history-progress-fill style="--history-progress: 78%"/);
});

test('renders only the selected campaign report inside its expanded card', () => {
  const history = createActivityHistoryState();
  history.selectedRunId = 'run-inline';
  history.selectedCampaignClientId = 'campaign-a';
  history.expandedCampaignKeys = ['run-inline::campaign-a'];
  history.items = [{
    id: 'run-inline', createdAt: 1, status: 'completed',
    campaigns: [
      { clientId: 'campaign-a', name: 'Campaign A', adAccountId: 'act_1', adSets: 1, ads: 1, completed: 3, total: 3, status: 'created' },
      { clientId: 'campaign-b', name: 'Campaign B', adAccountId: 'act_1', adSets: 1, ads: 1, completed: 3, total: 3, status: 'created' }
    ]
  }];
  history.detail = {
    id: 'run-inline', createdAt: 1,
    snapshot: { campaigns: [{
      clientId: 'campaign-a', name: 'Campaign A', adAccountId: 'act_1', adSets: [{
        clientId: 'adset-a', name: 'Nhóm A', ads: [{ clientId: 'ad-a', name: 'Quảng cáo A' }]
      }]
    }] },
    nodes: [{ clientId: 'ad-a', type: 'ad', status: 'created', postId: 'page_1', permalinkUrl: 'https://www.facebook.com/1/posts/1' }]
  };

  const html = renderActivityHistory(history, { adAccounts: [{ id: 'act_1', name: 'LG Clinic 01' }] });

  assert.match(html, /<details class="history-run-card" open>/);
  assert.match(html, /data-campaign-client-id="campaign-a"[^>]+aria-expanded="true"/);
  assert.match(html, /id="history-campaign-panel-campaign-a"/);
  assert.match(html, /Quảng cáo A/);
  assert.doesNotMatch(html, /Chi tiết lượt tạo/);
  assert.doesNotMatch(html, /data-action="back-history-list"/);
});

test('keeps multiple campaign reports expanded across different runs', () => {
  const history = createActivityHistoryState();
  history.expandedCampaignKeys = ['run-a::campaign-a', 'run-b::campaign-b'];
  history.items = [
    { id: 'run-a', createdAt: 1, campaigns: [{ clientId: 'campaign-a', name: 'Campaign A', adAccountId: 'act_1', adSets: 1, ads: 1, completed: 3, total: 3, status: 'created' }] },
    { id: 'run-b', createdAt: 2, campaigns: [{ clientId: 'campaign-b', name: 'Campaign B', adAccountId: 'act_1', adSets: 1, ads: 1, completed: 3, total: 3, status: 'created' }] }
  ];
  history.detailsByRun = {
    'run-a': { id: 'run-a', snapshot: { campaigns: [{ clientId: 'campaign-a', name: 'Campaign A', adSets: [] }] }, nodes: [] },
    'run-b': { id: 'run-b', snapshot: { campaigns: [{ clientId: 'campaign-b', name: 'Campaign B', adSets: [] }] }, nodes: [] }
  };

  const html = renderActivityHistory(history, { adAccounts: [{ id: 'act_1', name: 'LG Clinic 01' }] });

  assert.equal((html.match(/<details class="history-run-card" open>/g) ?? []).length, 2);
  assert.equal((html.match(/class="history-campaign-item is-expanded"/g) ?? []).length, 2);
  assert.match(html, /id="history-campaign-panel-campaign-a"/);
  assert.match(html, /id="history-campaign-panel-campaign-b"/);
});

test('keeps every report closed when the multi-card expansion list is empty', () => {
  const history = createActivityHistoryState();
  history.selectedRunId = 'run-a';
  history.selectedCampaignClientId = 'campaign-a';
  history.expandedCampaignKeys = [];
  history.mountedCampaignKeys = ['run-a::campaign-a'];
  history.items = [{
    id: 'run-a', createdAt: 1,
    campaigns: [{ clientId: 'campaign-a', name: 'Campaign A', adSets: 1, ads: 1, completed: 3, total: 3, status: 'created' }]
  }];

  const html = renderActivityHistory(history);

  assert.doesNotMatch(html, /<details class="history-run-card" open>/);
  assert.doesNotMatch(html, /class="history-campaign-item is-expanded"/);
  assert.match(html, /data-campaign-client-id="campaign-a"[^>]+aria-expanded="false"/);
});

test('keeps loaded report markup mounted while collapsed for a smooth close animation', () => {
  const history = createActivityHistoryState();
  history.expandedCampaignKeys = [];
  history.mountedCampaignKeys = ['run-a::campaign-a'];
  history.items = [{
    id: 'run-a', createdAt: 1,
    campaigns: [{ clientId: 'campaign-a', name: 'Campaign A', adSets: 1, ads: 1, completed: 3, total: 3, status: 'created' }]
  }];
  history.detailsByRun = {
    'run-a': { id: 'run-a', snapshot: { campaigns: [{ clientId: 'campaign-a', name: 'Campaign A', adSets: [] }] }, nodes: [] }
  };

  const html = renderActivityHistory(history);

  assert.match(html, /class="history-campaign-detail-shell" aria-hidden="true"/);
  assert.match(html, /id="history-campaign-panel-campaign-a"/);
  assert.doesNotMatch(html, /history-campaign-detail-shell is-open/);
});

test('renders the approved six-column activity report with Facebook post actions', () => {
  const history = createActivityHistoryState();
  history.selectedRunId = 'run-1';
  history.detail = {
    id: 'run-1',
    status: 'completed',
    adAccountId: 'act_1',
    createdAt: new Date(2026, 7, 12, 10, 0).getTime(),
    completedAt: new Date(2026, 7, 12, 10, 2).getTime(),
    legacy: false,
    snapshot: {
      version: 2,
      adAccountId: 'act_1',
      campaigns: [{
        clientId: 'campaign-1', name: 'Campaign Sẹo Rỗ', adAccountId: 'act_1',
        pageId: 'page-1', pageName: 'Duck Tool', budgetStrategy: 'AD_SET', dailyBudget: 0,
        adSets: [{
          clientId: 'adset-1', name: 'Nữ 23–45',
          dailyBudget: 100000, ageMin: 23, ageMax: 45, genders: [2],
          includedRegions: [{ name: 'Thành phố Hồ Chí Minh' }], excludedRegions: [],
          ads: [{
            clientId: 'ad-1', name: 'VIDEO SẸO RỖ', primaryText: 'Nội dung', headline: 'Tiêu đề',
            media: { name: 'creative.mov', mimeType: 'video/quicktime', sizeBytes: 176898426 }
          }]
        }]
      }]
    },
    nodes: [
      { clientId: 'campaign-1', type: 'campaign', name: 'Campaign Sẹo Rỗ', status: 'created', remoteId: 'meta-campaign' },
      { clientId: 'adset-1', parentClientId: 'campaign-1', type: 'adSet', name: 'Nữ 23–45', status: 'created', remoteId: 'meta-adset' },
      {
        clientId: 'ad-1', parentClientId: 'adset-1', type: 'ad', name: 'VIDEO SẸO RỖ', status: 'created',
        remoteId: 'meta-ad', postId: 'page-1_123', permalinkUrl: 'https://www.facebook.com/reel/123'
      }
    ]
  };

  const html = renderActivityHistory(history, { adAccounts: [{ id: 'act_1', name: 'LG Clinic 37' }] });

  assert.match(html, /Campaign Sẹo Rỗ/);
  assert.match(html, /LG Clinic 37/);
  assert.match(html, /Nữ 23–45/);
  assert.match(html, /Thời gian tạo/);
  assert.match(html, /Tài khoản quảng cáo/);
  assert.match(html, /Tên chiến dịch/);
  assert.match(html, /Tên nhóm quảng cáo/);
  assert.match(html, /Tên quảng cáo/);
  assert.match(html, /Link Post/);
  assert.match(html, /VIDEO SẸO RỖ/);
  assert.match(html, /href="https:\/\/www\.facebook\.com\/reel\/123"/);
  assert.match(html, /target="_blank" rel="noopener noreferrer"/);
  assert.match(html, /class="history-post-actions"/);
  assert.match(html, /aria-label="Mở Post"/);
  assert.match(html, /aria-label="Sao chép link Post"/);
  assert.doesNotMatch(html, />Mở Post</);
  assert.doesNotMatch(html, />Sao chép</);
  assert.match(html, /data-action="copy-history-value" data-copy-value="https:\/\/www\.facebook\.com\/reel\/123"/);
  assert.doesNotMatch(html, /Văn bản quảng cáo|Ngân sách|Độ tuổi|Giới tính/);
});

test('tracks missing Facebook publications and exposes bounded retry delays', () => {
  const history = createActivityHistoryState();
  assert.equal(history.publicationSyncing, false);
  assert.equal(history.publicationSyncAttempt, 0);
  assert.equal(history.publicationSyncError, null);

  assert.equal(hasMissingPublications({
    nodes: [
      { type: 'campaign', status: 'created', remoteId: 'campaign-1' },
      { type: 'ad', status: 'created', remoteId: 'ad-1', postId: null, permalinkUrl: null }
    ]
  }), true);
  assert.equal(hasMissingPublications({
    nodes: [{
      type: 'ad', status: 'created', remoteId: 'ad-1',
      postId: 'page-1_123', permalinkUrl: 'https://www.facebook.com/reel/123'
    }]
  }), false);
  assert.deepEqual(
    [0, 1, 2, 3, 4, 5].map(publicationRetryDelay),
    [0, 5000, 15000, 30000, 60000, null]
  );
});

test('renders publication sync recovery when Meta has not returned a Post ID', () => {
  const history = createActivityHistoryState();
  history.selectedRunId = 'run-pending';
  history.publicationSyncAttempt = 2;
  history.detail = {
    id: 'run-pending', status: 'completed', adAccountId: 'act_1', createdAt: 1,
    completedAt: 2, legacy: true, snapshot: null,
    nodes: [{
      clientId: 'ad-1', type: 'ad', name: 'Quảng cáo chờ Post ID', status: 'created',
      remoteId: 'meta-ad', postId: null, permalinkUrl: null
    }]
  };

  const html = renderActivityHistory(history, { adAccounts: [{ id: 'act_1', name: 'LG Clinic 37' }] });

  assert.match(html, /Đang chờ Meta trả Post ID/);
  assert.match(html, /data-action="refresh-history-publications"/);
  assert.match(html, /Lấy lại link bài/);
  assert.doesNotMatch(html, /Chưa lấy được link Reel/);
});

test('does not label an Instagram permalink as a Facebook post link', () => {
  const history = createActivityHistoryState();
  history.selectedRunId = 'run-instagram';
  history.detail = {
    id: 'run-instagram', status: 'completed', legacy: true, snapshot: null, createdAt: 1,
    nodes: [{
      clientId: 'ad-1', type: 'ad', name: 'Legacy Ad', status: 'created',
      remoteId: 'meta-ad', postId: 'page-1_123',
      permalinkUrl: 'https://www.instagram.com/reel/instagram-only'
    }]
  };

  const html = renderActivityHistory(history, { adAccounts: [{ id: 'act_1', name: 'LG Clinic 37' }] });

  assert.doesNotMatch(html, /href="https:\/\/www\.instagram\.com/);
  assert.doesNotMatch(html, /Mở bài Facebook/);
});

test('keeps the six-column report for version 1 snapshots', () => {
  const history = createActivityHistoryState();
  history.selectedRunId = 'run-v1';
  history.detail = {
    id: 'run-v1', status: 'completed', adAccountId: 'act_1', createdAt: 1,
    completedAt: 2, legacy: false, nodes: [],
    snapshot: {
      version: 1,
      adAccountId: 'act_1',
      campaigns: [{
        clientId: 'campaign-1', name: 'Campaign cũ', budgetStrategy: 'AD_SET', dailyBudget: 0,
        adSets: [{
          clientId: 'adset-1', name: 'Nhóm cũ', pageId: 'page-old', pageName: 'Page phiên bản cũ',
          dailyBudget: 100000, ageMin: 18, ageMax: 45, genders: [],
          includedRegions: [], excludedRegions: [], ads: []
        }]
      }]
    }
  };

  const html = renderActivityHistory(history, { adAccounts: [{ id: 'act_1', name: 'LG Clinic 37' }] });

  assert.match(html, /Tên chiến dịch/);
  assert.match(html, /Tên quảng cáo/);
  assert.doesNotMatch(html, /Page phiên bản cũ/);
});

test('does not render an unsafe permalink as a link', () => {
  const history = createActivityHistoryState();
  history.selectedRunId = 'run-legacy';
  history.detail = {
    id: 'run-legacy', status: 'completed', legacy: true, snapshot: null, createdAt: 1,
    nodes: [{
      clientId: 'ad-1', type: 'ad', name: 'Legacy Ad', status: 'created',
      permalinkUrl: 'javascript:alert(1)'
    }]
  };

  const html = renderActivityHistory(history, { adAccounts: [{ id: 'act_1', name: 'LG Clinic 37' }] });

  assert.doesNotMatch(html, /href="javascript:/);
  assert.match(html, /Đang chờ link/);
});

test('keeps seeding details out of the compact activity report', () => {
  const history = createActivityHistoryState();
  history.selectedRunId = 'run-seeding';
  history.detail = {
    id: 'run-seeding', status: 'completed', adAccountId: 'act_1', createdAt: 1,
    completedAt: 2, legacy: false,
    snapshot: {
      version: 3,
      campaigns: [{
        clientId: 'campaign-1', name: 'Campaign lịch sử', pageName: 'Page 1',
        budgetStrategy: 'AD_SET', dailyBudget: 0,
        seeding: { templateName: 'Mẫu đã lưu' },
        adSets: [{
          clientId: 'adset-1', name: 'Nhóm 1', dailyBudget: 100000,
          ageMin: 18, ageMax: 65, genders: [], includedRegions: [], excludedRegions: [],
          ads: [{ clientId: 'ad-1', name: 'Ad 1', primaryText: '', headline: '', media: null }]
        }]
      }]
    },
    nodes: [{
      clientId: 'ad-1', parentClientId: 'adset-1', type: 'ad', name: 'Ad 1', status: 'created',
      remoteId: 'meta-ad', postId: 'page-1_100', permalinkUrl: 'https://www.facebook.com/reel/stored'
    }],
    seeding: {
      summary: { posts: 1, total: 1, pending: 0, posting: 0, created: 0, failed: 1, needsReview: 0, cancelled: 0 },
      jobs: [{
        id: 'job-1', campaignClientId: 'campaign-1', postId: 'page-1_100', position: 0,
        message: '<script>alert(1)</script>', status: 'failed', metaCommentId: null,
        error: { message: '<img src=x onerror=alert(2)>' }
      }],
      conflicts: [], waitingPostCount: 0
    }
  };

  const html = renderActivityHistory(history, { adAccounts: [{ id: 'act_1', name: 'LG Clinic 37' }] });

  assert.match(html, /Campaign lịch sử/);
  assert.match(html, /Nhóm 1/);
  assert.match(html, /Ad 1/);
  assert.match(html, /href="https:\/\/www\.facebook\.com\/reel\/stored"/);
  assert.doesNotMatch(html, /Seeding bình luận|Mẫu đã lưu|data-action="retry-seeding-job"/);
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
  assert.doesNotMatch(html, /<img src=x onerror=alert\(2\)>/);
});

test('renders a safe compact seeding status column shared by ads with the same Post ID', () => {
  const history = createActivityHistoryState();
  history.selectedRunId = 'run-seeding-status';
  const ads = [
    ['ad-1', 'Ad dùng chung 1', 'post-shared'],
    ['ad-2', 'Ad dùng chung 2', 'post-shared'],
    ['ad-3', 'Ad đang xử lý', 'post-progress'],
    ['ad-4', 'Ad thành công', 'post-success'],
    ['ad-5', 'Ad cần kiểm tra', 'post-review'],
    ['ad-6', 'Ad lịch sử cũ', 'post-without-job']
  ];
  const longError = `<img src=x onerror=alert(1)>${'Lỗi seeding '.repeat(20)}`;
  history.detail = {
    id: 'run-seeding-status', status: 'completed', adAccountId: 'act_1', createdAt: 1,
    snapshot: {
      version: 3,
      campaigns: [{
        clientId: 'campaign-1', name: 'Campaign', adAccountId: 'act_1',
        adSets: [{
          clientId: 'adset-1', name: 'Nhóm',
          ads: ads.map(([clientId, name]) => ({ clientId, name }))
        }]
      }]
    },
    nodes: ads.map(([clientId, name, postId]) => ({
      clientId, type: 'ad', name, status: 'created', postId,
      permalinkUrl: `https://www.facebook.com/${postId}`
    })),
    seeding: {
      jobs: [
        { postId: 'post-shared', status: 'succeeded' },
        { postId: 'post-shared', status: 'failed', error: { message: longError } },
        { postId: 'post-progress', status: 'pending' },
        { postId: 'post-success', status: 'succeeded' },
        { postId: 'post-review', status: 'needs_review', error: 'Kiểm tra lại quyền Page' }
      ]
    }
  };

  const html = renderActivityHistory(history, { adAccounts: [{ id: 'act_1', name: 'LG Clinic 37' }] });

  assert.match(html, /Trạng thái seeding/);
  assert.equal((html.match(/history-seeding-status-error/g) ?? []).length, 2);
  assert.match(html, /Đang xử lý/);
  assert.match(html, /Thành công/);
  assert.match(html, /Cần kiểm tra/);
  assert.match(html, /Chưa seeding/);
  assert.match(html, /title="&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(html, /Lỗi seeding[^<]{0,160}…/);
  assert.doesNotMatch(html, /<img src=x onerror=alert\(1\)>/);
});

test('keeps a persistent seeding failure alert above the activity report', () => {
  const history = createActivityHistoryState();
  history.selectedRunId = 'run-seeding-alert';
  history.detail = {
    id: 'run-seeding-alert', status: 'completed', createdAt: 1,
    snapshot: { version: 3, campaigns: [] }, nodes: [],
    seeding: {
      jobs: [
        { postId: 'post-1', status: 'failed', error: { message: 'R2 upload bị từ chối' } },
        { postId: 'post-2', status: 'needs_review', error: { message: 'Cần kiểm tra quyền Page' } }
      ]
    }
  };

  const html = renderActivityHistory(history);

  assert.match(html, /Seeding cần xử lý/);
  assert.match(html, /1 bình luận thất bại/);
  assert.match(html, /1 bình luận cần kiểm tra/);
  assert.match(html, /R2 upload bị từ chối/);
});

test('filters report rows to one campaign and renders escaped node diagnostics', () => {
  const history = createActivityHistoryState();
  history.selectedRunId = 'run-errors';
  history.selectedCampaignClientId = 'campaign-2';
  history.detail = {
    id: 'run-errors', status: 'completed_with_errors', createdAt: 1,
    snapshot: {
      campaigns: [
        { clientId: 'campaign-1', name: 'Campaign thành công', adAccountId: 'act_1', adSets: [{ clientId: 'adset-1', name: 'Nhóm 1', ads: [{ clientId: 'ad-1', name: 'Ad 1' }] }] },
        { clientId: 'campaign-2', name: 'Campaign lỗi', adAccountId: 'act_2', adSets: [{ clientId: 'adset-2', name: 'Nhóm lỗi', ads: [{ clientId: 'ad-2', name: 'Ad bị bỏ qua' }] }] }
      ]
    },
    nodes: [
      { clientId: 'campaign-1', type: 'campaign', name: 'Campaign thành công', status: 'created' },
      { clientId: 'adset-1', parentClientId: 'campaign-1', type: 'adSet', name: 'Nhóm 1', status: 'created' },
      { clientId: 'ad-1', parentClientId: 'adset-1', type: 'ad', name: 'Ad 1', status: 'created' },
      { clientId: 'campaign-2', type: 'campaign', name: 'Campaign lỗi', status: 'created' },
      { clientId: 'adset-2', parentClientId: 'campaign-2', type: 'adSet', name: 'Nhóm lỗi', status: 'failed', remoteId: 'meta-adset-2', error: { message: '<Invalid targeting>' } },
      { clientId: 'ad-2', parentClientId: 'adset-2', type: 'ad', name: 'Ad bị bỏ qua', status: 'skipped' }
    ]
  };

  const html = renderActivityHistory(history);

  assert.match(html, /Đang xem Campaign/);
  assert.match(html, /data-action="show-all-history-campaigns"/);
  assert.match(html, /Vấn đề cần xử lý/);
  assert.match(html, /Nhóm lỗi/);
  assert.match(html, /meta-adset-2/);
  assert.match(html, /&lt;Invalid targeting&gt;/);
  assert.match(html, /Ad bị bỏ qua/);
  assert.doesNotMatch(html, /Campaign thành công/);
  assert.doesNotMatch(html, /<Invalid targeting>/);
});

test('offers an inline retry action only for a failed Ad without a Meta ID', () => {
  const history = createActivityHistoryState();
  history.selectedRunId = 'run-ad-retry';
  history.retryingAdKeys = ['run-ad-retry::ad-1'];
  history.detail = {
    id: 'run-ad-retry', status: 'completed_with_errors', createdAt: 1,
    snapshot: {
      version: 3,
      campaigns: [{
        clientId: 'campaign-1', name: 'Campaign', adAccountId: 'act_1',
        adSets: [{ clientId: 'adset-1', name: 'Nhóm', ads: [{ clientId: 'ad-1', name: 'Ad lỗi' }] }]
      }]
    },
    nodes: [
      { clientId: 'campaign-1', type: 'campaign', status: 'created', remoteId: 'campaign-meta' },
      { clientId: 'adset-1', parentClientId: 'campaign-1', type: 'adSet', status: 'created', remoteId: 'adset-meta' },
      { clientId: 'ad-1', parentClientId: 'adset-1', type: 'ad', name: 'Ad lỗi', status: 'failed', error: { message: 'Meta tạm lỗi' } }
    ]
  };

  const html = renderActivityHistory(history);

  assert.match(html, /data-action="retry-failed-ad"/);
  assert.match(html, /data-run-id="run-ad-retry"/);
  assert.match(html, /data-client-id="ad-1"/);
  assert.match(html, /Đang thử lại\.\.\.<\/button>/);
  assert.match(html, /disabled/);
  history.detail.nodes[2].error.type = 'UncertainAdWriteError';
  const uncertainHtml = renderActivityHistory(history);
  assert.match(uncertainHtml, /data-action="resolve-ad-existing"/);
  assert.match(uncertainHtml, /data-action="resolve-ad-missing"/);
  assert.doesNotMatch(uncertainHtml, /data-action="retry-failed-ad"/);
  history.detail.nodes[1] = { ...history.detail.nodes[1], status: 'failed', remoteId: null };
  history.detail.nodes[2].status = 'skipped';
  const groupHtml = renderActivityHistory(history);
  assert.match(groupHtml, /data-action="retry-failed-adset"/);
  assert.match(groupHtml, /Thử tạo lại nhóm quảng cáo/);
  assert.doesNotMatch(groupHtml, /data-action="retry-failed-ad"/);
  history.detail.nodes[1].remoteId = 'already-created';
  assert.doesNotMatch(renderActivityHistory(history), /data-action="retry-failed-adset"/);
});

test('offers "Chạy tiếp" only for unfinished runs whose workflow lease has expired', () => {
  const now = 1_000_000;
  assert.equal(runWorkflowStalled({ status: 'creating', workflowLeaseExpiresAt: now - 1 }, now), true);
  assert.equal(runWorkflowStalled({ status: 'creating', workflowLeaseExpiresAt: null }, now), true);
  assert.equal(runWorkflowStalled({ status: 'failed', workflowLeaseExpiresAt: now - 1 }, now), true);
  assert.equal(runWorkflowStalled({ status: 'creating', workflowLeaseExpiresAt: now + 60_000 }, now), false);
  assert.equal(runWorkflowStalled({ status: 'completed_with_errors', workflowLeaseExpiresAt: now - 1 }, now), false);

  const history = createActivityHistoryState();
  history.items = [{
    id: 'run-stalled', createdAt: 1, status: 'creating', workflowLeaseExpiresAt: 1,
    campaigns: [{ clientId: 'c1', name: 'Triệt nách', adAccountId: 'act_1', adSets: 1, ads: 3, completed: 1, total: 5, status: 'creating', errorMessage: '' }]
  }];
  const html = renderActivityHistory(history, { adAccounts: [{ id: 'act_1', name: 'LG Clinic 27' }] });
  assert.match(html, /data-action="resume-run-workflow" data-run-id="run-stalled"/);
  assert.match(html, />Chạy tiếp</);
});

test('an empty date filter keeps the list and its filter instead of a stale selected run', () => {
  const history = createActivityHistoryState();
  history.loaded = true;
  history.selectedRunId = 'run-yesterday';
  history.selectedCampaignClientId = 'campaign-a';
  history.filters = { from: '2026-09-24', to: '2026-09-24' };
  history.detail = {
    id: 'run-yesterday', createdAt: 1,
    snapshot: { campaigns: [{ clientId: 'campaign-a', name: 'Campaign A', adSets: [] }] },
    nodes: []
  };

  const html = renderActivityHistory(history);

  assert.match(html, /data-action="toggle-history-date-picker"/);
  assert.match(html, /data-action="clear-history-filter"/);
  assert.match(html, /Chưa có lịch sử phù hợp/);
  assert.doesNotMatch(html, /<th>Tên nhóm quảng cáo<\/th>/);
});

test('reloading the list while a run is selected shows the loading list, not the stale run', () => {
  const history = createActivityHistoryState();
  history.loaded = true;
  history.loading = true;
  history.selectedRunId = 'run-a';
  history.detail = { id: 'run-a', createdAt: 1, snapshot: { campaigns: [] }, nodes: [] };

  const html = renderActivityHistory(history);

  assert.match(html, /Đang tải lịch sử/);
  assert.match(html, /data-action="toggle-history-date-picker"/);
});

test('a standalone run report always offers a way back to the list', () => {
  const history = createActivityHistoryState();
  history.selectedRunId = 'run-direct';
  history.detail = { id: 'run-direct', createdAt: 1, snapshot: { campaigns: [] }, nodes: [] };

  assert.match(renderActivityHistory(history), /data-action="back-history-list"/);
  history.detail = null;
  history.error = { message: 'Không tải được' };
  assert.match(renderActivityHistory(history), /data-action="back-history-list"/);
});
