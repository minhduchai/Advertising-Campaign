import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { renderResults } from '../public/workspace.js';

const appSource = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
const handlerSource = await readFile(new URL('../src/request-handler.js', import.meta.url), 'utf8');

function progressFixture() {
  return {
    runId: 'run-1',
    status: 'completed',
    total: 1,
    completed: 1,
    percent: 100,
    snapshot: {
      version: 3,
      campaigns: [{
        clientId: 'campaign-1',
        name: 'Campaign <img src=x onerror=alert(1)>',
        seeding: { templateName: 'Mẫu <script>alert(1)</script>' },
        adSets: [{
          clientId: 'adset-1',
          ads: [
            { clientId: 'ad-1' },
            { clientId: 'ad-2' }
          ]
        }]
      }, {
        clientId: 'campaign-2',
        name: 'Campaign phụ',
        seeding: { templateName: 'Mẫu phụ' },
        adSets: [{ clientId: 'adset-2', ads: [{ clientId: 'ad-3' }] }]
      }]
    },
    nodes: [
      {
        clientId: 'ad-1', type: 'ad', status: 'created', postId: 'page-1_100',
        permalinkUrl: 'https://www.facebook.com/reel/stored-link'
      },
      {
        clientId: 'ad-2', type: 'ad', status: 'created', postId: 'page-1_100',
        permalinkUrl: 'https://www.facebook.com/reel/stored-link'
      },
      { clientId: 'ad-3', type: 'ad', status: 'created', postId: 'page-1_100' }
    ],
    seeding: {
      summary: { posts: 1, total: 2, pending: 0, posting: 0, created: 1, failed: 0, needsReview: 1, cancelled: 0 },
      jobs: [{
        id: 'job-created', campaignClientId: 'campaign-1', postId: 'page-1_100', position: 0,
        message: 'Đã đăng <b>không được render</b>', status: 'created', metaCommentId: 'comment-1', error: null
      }, {
        id: 'job-review', campaignClientId: 'campaign-1', postId: 'page-1_100', position: 1,
        message: 'Cần kiểm tra', status: 'needs_review', metaCommentId: null,
        error: { message: '<img src=x onerror=alert(2)>' }
      }],
      conflicts: [{ postId: 'page-1_200', campaignClientIds: ['campaign-1', 'campaign-2'] }],
      waitingPostCount: 0
    }
  };
}

test('renders compact grouped seeding results from snapshot and stored publications', () => {
  const html = renderResults(progressFixture());

  assert.match(html, /<strong>1\/2<\/strong><span>Bình luận<\/span>/);
  assert.match(html, /<strong>2<\/strong><span>Post ID<\/span>/);
  assert.equal((html.match(/class="seeding-post-link"/g) ?? []).length, 1);
  assert.match(html, /Campaign &lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(html, /Mẫu &lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /Đã đăng 1\/2 bình luận/);
  assert.match(html, /class="seeding-campaign-percent">50%/);
  assert.match(html, /href="https:\/\/www\.facebook\.com\/reel\/stored-link"/);
  assert.doesNotMatch(html, /href="[^"]*page-1_100/);
  assert.doesNotMatch(html, /Đã đăng &lt;b&gt;không được render&lt;\/b&gt;/);
  assert.match(html, /Bình luận #2/);
  assert.match(html, /1 bình luận cần xử lý/);
  assert.match(html, /data-action="retry-seeding-job"/);
  assert.match(html, /data-action="confirm-seeding-job"/);
  assert.doesNotMatch(html, /<b>không được render<\/b>/);
  assert.doesNotMatch(html, /<img src=x onerror=alert\(2\)>/);
});

test('filters seeding statistics and cards to the selected campaign', () => {
  const progress = progressFixture();
  progress.seeding.jobs.push({
    id: 'job-other', campaignClientId: 'campaign-2', postId: 'page-2_200', position: 0,
    message: 'Campaign khác', status: 'pending', metaCommentId: null, error: null
  });
  progress.seeding.summary = { total: 3, created: 1, pending: 1, needsReview: 1 };

  const html = renderResults(progress, { campaignClientId: 'campaign-1' });

  assert.match(html, /Đang xem Campaign/);
  assert.match(html, /<strong>1\/2<\/strong><span>Bình luận<\/span>/);
  assert.match(html, /Campaign &lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(html, /Campaign phụ/);
  assert.doesNotMatch(html, /page-2_200/);
  assert.doesNotMatch(html, />Dừng seeding</);
});

test('renders structured seeding statistics and a waiting Post ID message', () => {
  const progress = progressFixture();
  progress.seeding = {
    summary: { total: 1, created: 0, pending: 1, cancelled: 0 },
    jobs: [],
    conflicts: [],
    waitingPostCount: 1
  };

  const html = renderResults(progress);

  assert.match(html, /class="seeding-stat"[^>]*>[\s\S]*0\/1[\s\S]*Bình luận/);
  assert.match(html, /class="seeding-stat"[^>]*>[\s\S]*0[\s\S]*Post ID/);
  assert.match(html, /class="seeding-stat"[^>]*>[\s\S]*1[\s\S]*Đang chờ/);
  assert.match(html, />Dừng seeding</);
  assert.match(html, /Đang chờ lấy Post ID để bắt đầu seeding\./);
  assert.doesNotMatch(html, /Không có bình luận seeding cho lượt này/);
});

test('renders conflict choices without a default radio selection', () => {
  const html = renderResults(progressFixture());

  assert.match(html, /data-seeding-conflict/);
  assert.match(html, /Campaign phụ · Mẫu phụ/);
  assert.equal((html.match(/type="radio"/g) ?? []).length, 2);
  assert.doesNotMatch(html, /type="radio"[^>]* checked/);
  assert.match(html, /data-action="resolve-seeding-conflict"/);
  assert.match(html, />Dùng mẫu này</);
});

test('wires explicit server cancel and resume with duplicate-risk confirmations', () => {
  assert.match(appSource, /confirmAction\(\{[^}]*Bình luận có thể đã tồn tại/s);
  assert.match(appSource, /confirmAction\(\{[^}]*mở bài Facebook[^}]*kiểm tra/s);
  assert.match(appSource, /api\.cancelRunSeeding\(runId\)/);
  assert.match(appSource, /api\.resumeRunSeeding\(runId\)/);
  assert.match(appSource, /api\.retrySeedingJob\(runId, jobId\)/);
  assert.match(appSource, /api\.confirmSeedingJob\(runId, jobId\)/);
  assert.match(appSource, /api\.resolveSeedingConflict\(runId, \{ postId, campaignClientId \}\)/);
});

test('updates live progress without rerendering the history report for every comment', () => {
  const onUpdateSource = appSource.slice(
    appSource.indexOf('onUpdate:'),
    appSource.indexOf('onStop:')
  );
  assert.match(onUpdateSource, /renderResultsDrawer\(\{ preserveScroll: true \}\)/);
  assert.doesNotMatch(onUpdateSource, /renderHistoryWorkspace\(\)/);
  assert.doesNotMatch(onUpdateSource, /\brender\(\)/);
  assert.match(onUpdateSource, /mergeRunSnapshot\(state\.publishProgress, \{ seeding \}\)/);
  assert.match(onUpdateSource, /renderWorkspaceTreeProgress\(\)/);
  assert.match(onUpdateSource, /captureDrawerFocus\(resultsDrawer\)[\s\S]*?restoreDrawerFocus\(resultsDrawer/);
  assert.match(appSource, /if \(event\.type === 'run_started'\) startRealtimeSeeding\(event\)/);
  assert.doesNotMatch(appSource, /showPublishCompletion\(run\)[\s\S]*?seedingRunner\.resume\(run\.id\)/);
});

test('refreshes completed seeding state when reopening results or returning to the tab', () => {
  assert.match(appSource, /state\.ui\.resultsOpen = true;[\s\S]*synchronizeCompletedRunProgress\(state\.publishProgress\.runId\)/);
  assert.match(appSource, /visibilitychange[\s\S]*state\.ui\.resultsOpen[\s\S]*synchronizeCompletedRunProgress\(state\.publishProgress\.runId\)/);
});

test('serves the browser seeding runner module', () => {
  assert.match(handlerSource, /'\/seeding-runner\.js'/);
});

test('serializes seeding image uploads so multiple selections are retained', () => {
  assert.match(appSource, /queueSeedingImageUpload\(control\)/);
  assert.match(appSource, /seedingUploadQueue\s*=\s*queued\.catch/);
});
