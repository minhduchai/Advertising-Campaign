import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const appSource = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
const indexSource = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
const handlerSource = await readFile(new URL('../src/request-handler.js', import.meta.url), 'utf8');
const stylesheetSource = await readFile(new URL('../public/app.css', import.meta.url), 'utf8');

test('provides a dedicated history workspace tab', () => {
  assert.match(indexSource, /id="open-history-workspace"[\s\S]*?<span>Lịch sử<\/span>[\s\S]*?<\/button>/);
  assert.match(indexSource, /id="activity-history" class="activity-history-workspace"/);
  assert.match(appSource, /const openHistoryWorkspaceButton = document\.querySelector\('#open-history-workspace'\)/);
  assert.match(appSource, /state\.ui\.activeWorkspace = 'history'/);
  assert.doesNotMatch(indexSource, /activity-history-drawer/);
});

test('uses a flowing pill indicator for workspace tabs', () => {
  assert.match(indexSource, /class="workspace-mode-pill"/);
  assert.match(appSource, /function updateWorkspaceModePill/);
  assert.match(appSource, /updateWorkspaceModePill\(\{ animate: true \}\)/);
  assert.match(stylesheetSource, /@keyframes workspace-tab-flow/);
  assert.match(stylesheetSource, /prefers-reduced-motion: reduce/);
});

test('uses one compact Meta connection account control', () => {
  assert.match(indexSource, /id="connect-meta"[^>]*class="connection-account-button"/);
  assert.doesNotMatch(indexSource, /id="connection-status"/);
  assert.match(appSource, /state\.metaUser\?\.name \|\| 'Tài khoản Meta'/);
  assert.match(stylesheetSource, /\.connection-account-button\.is-connected/);
});

test('uses the available viewport width and readable report column sizes', () => {
  assert.match(stylesheetSource, /\.activity-history-workspace \.history-shell \{[\s\S]*?width: 100%;[\s\S]*?max-width: 1760px;/);
  assert.match(stylesheetSource, /\.history-campaign-inline-detail \.history-report-table \{\s*min-width: 1360px;/);
  assert.match(stylesheetSource, /\.history-report-table td:nth-child\(5\)\s*\{\s*width:\s*360px;\s*min-width:\s*360px;/);
  assert.match(stylesheetSource, /\.history-campaign-detail-shell \{[\s\S]*?grid-template-rows: 0fr;[\s\S]*?transition:/);
  assert.match(stylesheetSource, /\.history-campaign-item\.is-expanded \.history-campaign-detail-shell \{[\s\S]*?grid-template-rows: 1fr;/);
});

test('loads filtered pages and owner-scoped run detail through the API client', () => {
  assert.match(appSource, /openHistoryWorkspaceButton\?\.addEventListener\('click', async \(\) =>/);
  assert.match(appSource, /activityHistoryQuery\(history\.filters/);
  assert.match(appSource, /api\.listRuns\(query\)/);
  assert.match(appSource, /api\.loadRun\(runId\)/);
  assert.match(appSource, /action === 'load-more-history'/);
  assert.match(appSource, /if \(filtered && !append\)[\s\S]*?do \{[\s\S]*?api\.listRuns[\s\S]*?while \(nextOffset !== null\)/);
});

test('reuses the loaded activity history when reopening the tab', () => {
  assert.match(appSource, /if \(!state\.activityHistory\.loaded\) await loadActivityHistory\(\)/);
  assert.match(appSource, /history\.loaded = true/);
  assert.match(appSource, /function showPublishCompletion\(run,[\s\S]*?state\.activityHistory\.loaded = false/);
  assert.doesNotMatch(appSource, /openHistoryWorkspaceButton\?\.addEventListener[\s\S]*?state\.activityHistory\.detailsByRun = \{\}/);
});

test('opens multiple history campaign reports independently', () => {
  assert.match(appSource, /action === 'toggle-history-campaign'/);
  assert.match(appSource, /historyCampaignKey\(runId, campaignClientId\)/);
  assert.match(appSource, /history\.expandedCampaignKeys = \[\.\.\.expandedKeys, key\]/);
  assert.match(appSource, /history\.expandedCampaignKeys = expandedKeys\.filter/);
  assert.match(appSource, /await animateHistoryCampaignCollapse\(control\)/);
  assert.match(appSource, /function animateHistoryCampaignCollapse\(control\)/);
  assert.match(appSource, /const campaignClientId = control\.dataset\.campaignClientId \?\? null/);
  assert.match(appSource, /await loadActivityHistoryDetail\(runId, \{ resetScroll: false \}\)/);
});

test('automatically retries missing publications and supports manual refresh', () => {
  assert.match(appSource, /api\.refreshRunPublications\(runId\)/);
  assert.match(appSource, /publicationRetryDelay\(history\.publicationSyncAttempt\)/);
  assert.match(appSource, /hasMissingPublications\(history\.detail\)/);
  assert.match(appSource, /action === 'refresh-history-publications'/);
});

test('supports the smart date picker and resolves ad account names', () => {
  assert.match(appSource, /historyPresetRange\(control\.dataset\.preset\)/);
  assert.match(appSource, /action === 'select-history-date'/);
  assert.match(appSource, /action === 'apply-history-date-picker'/);
  assert.match(appSource, /renderActivityHistory\(history, \{ adAccounts: state\.resources\.adAccounts/);
});

test('copies the Facebook post link or Post ID from report actions', () => {
  assert.match(appSource, /action === 'copy-history-value'/);
  assert.match(appSource, /navigator\.clipboard\.writeText\(copyValue\)/);
});

test('opens a four-column activity table after loading cached or remote run details', () => {
  assert.match(indexSource, /id="activity-history-report-dialog"/);
  assert.match(indexSource, /data-copy-history-report/);
  assert.match(appSource, /action === 'open-activity-history-report'/);
  assert.match(appSource, /async function openActivityHistoryReport\(\)/);
  assert.match(appSource, /history\.detailsByRun\?\.\[runId\] \?\? await api\.loadRun\(runId\)/);
  assert.match(appSource, /activityHistoryReportRows\(runs\)/);
  assert.match(appSource, /renderActivityHistoryReportTable\(activityHistoryReportRowsCache\)/);
  assert.match(appSource, /navigator\.clipboard\.writeText\(activityHistoryReportCopyText\(activityHistoryReportRowsCache\)\)/);
  assert.match(stylesheetSource, /\.activity-history-report-dialog/);
});

test('cancels publication and realtime polling when Escape leaves the history tab', () => {
  assert.match(
    appSource,
    /if \(state\.activityHistory\.open\) \{\s+clearHistoryPublicationTimer\(\);\s+resetHistoryRealtimeSync\(\);\s+state\.activityHistory\.open = false;\s+state\.ui\.activeWorkspace = 'campaign';/
  );
});

test('mirrors streamed publish progress into history without another request', () => {
  const publishHandler = appSource.slice(appSource.indexOf('async function publishDraft()'), appSource.indexOf('async function simulateLocalDemoPublish()'));
  assert.match(publishHandler, /applyPublishEvent\(state\.publishProgress, event\);\s+syncLiveActivityHistory\(state\.publishProgress\);/);
  assert.match(appSource, /function syncLiveActivityHistory\(run,[\s\S]*?updateHistoryRunProgressDom\(summary\)/);
  assert.match(appSource, /data-history-progress-value/);
  assert.match(appSource, /data-history-progress-fill/);
});

test('polls only one active history run after refresh and pauses offscreen', () => {
  const scheduler = appSource.match(/function scheduleHistoryRealtimeRefresh[\s\S]*?\n}\n\nasync function refreshHistoryRealtimeRun/)?.[0] ?? '';
  const refresher = appSource.match(/async function refreshHistoryRealtimeRun[\s\S]*?\n}\n\nfunction updateHistoryRunProgressDom/)?.[0] ?? '';
  assert.match(scheduler, /document\.hidden/);
  assert.match(scheduler, /state\.running && String\(state\.publishProgress\?\.runId/);
  assert.match(scheduler, /historyRealtimeDelays/);
  assert.match(refresher, /api\.loadRun\(runId\)/);
  assert.match(refresher, /history\.realtimeAttempt \+= 1/);
  assert.match(appSource, /document\.addEventListener\('visibilitychange'/);
});

test('preserves report scroll while background publication sync rerenders', () => {
  assert.match(appSource, /preservedScrollTop = null/);
  assert.match(appSource, /preservedScrollTop \?\? historyWorkspace\.scrollTop/);
  assert.match(appSource, /historyWorkspace\.scrollTop = previousScrollTop/);
  assert.match(appSource, /previousWindowScroll[\s\S]*?window\.scrollY/);
  assert.match(appSource, /window\.scrollTo\(previousWindowScroll\.x, previousWindowScroll\.y\)/);
});

test('collapses a campaign report without rerendering the history workspace', () => {
  assert.match(
    appSource,
    /if \(expandedKeys\.includes\(key\)\) \{\s+await animateHistoryCampaignCollapse\(control\);\s+history\.expandedCampaignKeys[\s\S]*?finalizeHistoryCampaignCollapse\(control\);\s+return;/
  );
  assert.match(appSource, /function finalizeHistoryCampaignCollapse\(control\)[\s\S]*?control\.disabled = false/);
});

test('serves the activity-history browser module', () => {
  assert.match(handlerSource, /'\/activity-history\.js'/);
});

test('only resumes a refreshed history detail when seeding is safely pending', () => {
  assert.match(appSource, /loadActivityHistoryDetail\(runId,[\s\S]*?shouldAutoResumeSeeding\(history\.detail\.seeding\)[\s\S]*?seedingRunner\.resume\(runId\)/);
});

test('keeps the history report stable during incremental seeding updates', () => {
  const onUpdateSource = appSource.slice(
    appSource.indexOf('onUpdate:'),
    appSource.indexOf('onStop:')
  );
  assert.match(appSource, /function renderHistoryWorkspace\([\s\S]*?historyWorkspace\.scrollTop = previousScrollTop/);
  assert.doesNotMatch(onUpdateSource, /renderHistoryWorkspace\(\)/);
});

test('refreshes the authoritative run snapshot after seeding completes', () => {
  assert.match(appSource, /reason === 'complete'[\s\S]*?synchronizeCompletedRunProgress\(runId\)/);
  assert.match(appSource, /async function synchronizeCompletedRunProgress\(runId\)[\s\S]*?api\.loadRun\(runId\)[\s\S]*?mergeRunSnapshot\(state\.publishProgress, run\)[\s\S]*?renderWorkspaceTreeProgress\(\)/);
});

test('loads the private audience library after Meta resources', () => {
  assert.match(appSource, /render\(\);\s*await loadResources\(\);/);
  const loader = appSource.match(/async function loadAudienceTemplates[\s\S]*?\n}\n/)?.[0] ?? '';
  assert.match(loader, /if \(!state\.connected \|\| !state\.metaUser\?\.id\) return \[\];/);
  assert.match(loader, /api\.loadAudienceTemplates\(\)/);
});

test('routes tool and Meta audience selections to their separate libraries', () => {
  assert.match(appSource, /isToolAudienceTemplateId\(control\.value\)/);
  assert.match(appSource, /toolAudienceTemplateCompatibility\([\s\S]*?resourcesForCampaign\(state, context\.campaign\)\.customAudiences/);
  assert.match(appSource, /audienceTemplates\(\)\.find/);
  assert.match(appSource, /resourcesForCampaign\(state, context\.campaign\)\.savedAudiences/);
  assert.match(appSource, /applyAudienceTemplateToAdSet\(state, context\.adSet\.clientId, template\)/);
});

test('copies a modified Meta saved audience into the private tool library', () => {
  assert.match(appSource, /metaTemplateId[\s\S]*?api\.createAudienceTemplate\([\s\S]*?upsertAudienceTemplate\([\s\S]*?applyAudienceTemplateToAdSet/);
  assert.match(appSource, /Bản tùy chỉnh/);
});

test('routes tool audience create, update, duplicate and delete through the API client', () => {
  const handler = appSource.match(/async function handleAudienceClick[\s\S]*?\n}\n\nfunction audienceContext/)?.[0] ?? '';
  assert.match(handler, /'save-audience-template'/);
  assert.match(handler, /api\.createAudienceTemplate/);
  assert.match(handler, /api\.updateAudienceTemplate/);
  assert.match(handler, /api\.duplicateAudienceTemplate/);
  assert.match(handler, /api\.deleteAudienceTemplate/);
  assert.match(handler, /sourceAdAccountId:\s*context\.campaign\.adAccountId/);
  assert.doesNotMatch(handler, /if \(!state\.connected\)/);
  assert.match(handler, /catch \(error\) \{\s*showToast\(error\.message\);/);
});

test('enables the audience save action as soon as a valid name is typed', () => {
  assert.match(
    appSource,
    /control\.dataset\.audienceField === 'templateName'[\s\S]*?saveButton\.disabled = !control\.value\.trim\(\)/
  );
});
