import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const appSource = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
const appCss = await readFile(new URL('../public/app.css', import.meta.url), 'utf8');

test('starts inline tree progress without automatically opening the result drawer', () => {
  assert.match(appSource, /state\.publishProgress = createPublishProgress\(state\.draft\);[\s\S]*?state\.ui\.resultsOpen = false;[\s\S]*?render\(\);[\s\S]*?api\.publishDraft/);
});

test('applies streamed events to the result drawer and inline tree progress', () => {
  assert.match(appSource, /onEvent: \(event\) => \{[\s\S]*?applyPublishEvent\(state\.publishProgress, event\);[\s\S]*?renderResultsDrawer\(\{ preserveScroll: true \}\);[\s\S]*?renderWorkspaceTreeProgress\(\);/);
  assert.match(appSource, /function renderWorkspaceTreeProgress\(\) \{[\s\S]*?tree\.replaceWith\(nextTree\);/);
});

test('starts one realtime seeding loop as soon as the publish run starts', () => {
  assert.match(appSource, /function startRealtimeSeeding\(event\)/);
  assert.match(appSource, /if \(event\.type === 'run_started'\) startRealtimeSeeding\(event\)/);
  assert.match(appSource, /seedingRunner\.resume\(event\.runId\)/);
  assert.doesNotMatch(appSource, /function showPublishCompletion[\s\S]*?seedingRunner\.resume\(run\.id\)/);
});

test('recovers a known interrupted run without reposting it', () => {
  assert.match(appSource, /if \(error\.recoverable && state\.publishProgress\?\.runId\)[\s\S]*?recoverPublishRun\(state\.publishProgress\.runId\)/);
  assert.match(appSource, /async function recoverPublishRun\(runId\)[\s\S]*?api\.loadRun\(runId\)/);
  assert.doesNotMatch(appSource, /recoverPublishRun[\s\S]*?api\.publishDraft/);
});

test('closing results preserves active progress state', () => {
  assert.match(appSource, /resultsDrawer\.addEventListener\('click', \(event\) => \{[\s\S]*?state\.ui\.resultsOpen = false/);
  assert.doesNotMatch(appSource, /resultsDrawer\.addEventListener\('click', \(event\) => \{[\s\S]*?state\.publishProgress = null/);
});

test('bounds recovery and reports failed recovery without resending publication', () => {
  assert.match(appSource, /const publishRecoveryIntervalMs = 1000;/);
  assert.match(appSource, /const publishRecoveryFailureLimit = 12;/);
  assert.match(appSource, /const publishRecoveryTimeoutMs = 60 \* 60 \* 1000;/);
  assert.match(appSource, /recoverPublishRun\(state\.publishProgress\.runId\)[\s\S]*?catch \(recoveryError\)[\s\S]*?const trackingError = new Error\([\s\S]*?markPublishFailure\(state\.publishProgress, trackingError\)/);
  assert.match(appSource, /Theo dõi khôi phục đã dừng\. Lượt tạo không được gửi lại\./);
});

test('preserves drawer scroll only while it is rendered', () => {
  assert.match(appSource, /function renderResultsDrawer\(\{ preserveScroll = false \} = \{\}\) \{[\s\S]*?const shouldPreserveScroll = preserveScroll && state\.ui\.resultsOpen && state\.publishProgress;[\s\S]*?if \(shouldPreserveScroll\) resultsDrawer\.scrollTop = previousScrollTop;/);
});

test('locks publication before awaiting validation', () => {
  assert.match(appSource, /async function publishDraft\(\) \{[\s\S]*?if \(state\.running\) return;[\s\S]*?state\.running = true;[\s\S]*?state\.ui\.publishPhase = 'validating';[\s\S]*?render\(\);[\s\S]*?const valid = await validateCurrentDraft\(\);/);
  assert.match(appSource, /const confirmed = state\.ui\.localDemoResources \|\| await confirmActivePublish\(\);[\s\S]*?if \(!confirmed\) return;[\s\S]*?state\.ui\.publishPhase = 'publishing';[\s\S]*?api\.publishDraft/);
  assert.match(appSource, /async function publishDraft\(\) \{[\s\S]*?try \{[\s\S]*?const valid = await validateCurrentDraft\(\);[\s\S]*?finally \{[\s\S]*?state\.running = false;/);
  assert.match(appSource, /finally \{[\s\S]*?state\.running = false;[\s\S]*?state\.ui\.publishPhase = null;[\s\S]*?render\(\);/);
});

test('delegates the editor publish action after rerenders', () => {
  assert.match(appSource, /workspace\.addEventListener\('click', async \(event\) => \{[\s\S]*?if \(action === 'publish-draft'\) \{[\s\S]*?await publishDraft\(\);[\s\S]*?return;/);
  assert.doesNotMatch(appSource, /publishButton\.addEventListener\('click', publishDraft\)/);
});

test('delegates result-close clicks from the result drawer', () => {
  assert.match(appSource, /resultsDrawer\.addEventListener\('click', \(event\) => \{[\s\S]*?event\.target\.closest\('\[data-action="close-results"\]'\);[\s\S]*?state\.ui\.resultsOpen = false;[\s\S]*?renderResultsDrawer\(\);/);
  assert.doesNotMatch(appSource, /workspace\.addEventListener\('click',[\s\S]*?if \(action === 'close-results'\)/);
});

test('opens campaign-filtered details from any tree progress node', () => {
  assert.match(appSource, /action === 'open-campaign-results' \|\| action === 'open-node-results'/);
  assert.match(appSource, /state\.ui\.resultsCampaignClientId = match\?\.campaign\?\.clientId \?\? clientId/);
  assert.match(appSource, /state\.ui\.resultsOpen = true/);
  assert.match(appSource, /data-action="show-all-results"/);
});

test('uses a branded confirmation dialog before publishing ACTIVE ads', async () => {
  const indexSource = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.match(indexSource, /id="publish-confirmation"[^>]*class="publish-confirmation"/);
  assert.match(appSource, /function confirmActivePublish\(\)/);
  assert.match(appSource, /const confirmed = state\.ui\.localDemoResources \|\| await confirmActivePublish\(\)/);
  assert.match(appCss, /\.publish-confirmation::backdrop/);
});

test('uses one branded action dialog instead of browser confirmation boxes', async () => {
  const indexSource = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.match(indexSource, /id="action-confirmation"[^>]*class="action-confirmation"/);
  assert.match(appSource, /function confirmAction\(/);
  assert.doesNotMatch(appSource, /window\.confirm\(/);
  assert.match(appCss, /\.action-confirmation::backdrop/);
});

test('visibly opens the result drawer when campaign progress is clicked', () => {
  assert.match(appSource, /resultsDrawer\.classList\.toggle\('is-open', Boolean\(state\.ui\.resultsOpen && state\.publishProgress\)\)/);
  assert.match(appCss, /\.results-drawer\.is-open\s*\{[^}]*transform:\s*translateX\(0\)/s);
});

test('keeps the result drawer above the sticky editor header', () => {
  const drawerZIndex = Number(appCss.match(/\.results-drawer\s*\{[^}]*z-index:\s*(\d+)/s)?.[1]);
  const editorHeaderZIndex = Number(appCss.match(/\.editor-header\s*\{[^}]*z-index:\s*(\d+)/s)?.[1]);

  assert.ok(Number.isFinite(drawerZIndex));
  assert.ok(Number.isFinite(editorHeaderZIndex));
  assert.ok(drawerZIndex > editorHeaderZIndex);
});

test('provides a localhost-only progress demo without publishing to Meta', () => {
  assert.match(appSource, /function enableLocalProgressDemo\(\)/);
  assert.match(appSource, /\['localhost', '127\.0\.0\.1'\]\.includes\(window\.location\.hostname\)/);
  assert.match(appSource, /new URLSearchParams\(window\.location\.search\)\.get\('demoProgress'\) !== '1'/);
  assert.match(appSource, /state\.publishProgress = \{/);
  assert.match(appSource, /enableLocalProgressDemo\(\);[\s\S]*?render\(\);[\s\S]*?loadResources\(\);/);
});

test('lets a completed local demo run open safe simulated publication progress', async () => {
  const workspaceSource = await readFile(new URL('../public/workspace.js', import.meta.url), 'utf8');

  assert.match(workspaceSource, /\(!state\.connected && !state\.ui\?\.localDemoResources\)/);
  assert.match(workspaceSource, /localDemo \? 'Đăng thử' : 'Đăng'/);
  assert.match(appSource, /if \(state\.ui\.localDemoResources\) \{[\s\S]*?const result = await simulateLocalDemoPublish\(\);[\s\S]*?showPublishCompletion\(result, \{ localDemo: true \}\)/);
  assert.match(appSource, /chiến dịch thử không được gửi lên Meta/);
  assert.match(appSource, /async function simulateLocalDemoPublish\(\)[\s\S]*?createLocalDemoPublishNodes\(state\.draft\)[\s\S]*?mergeRunSnapshot\(state\.publishProgress, result\)/);
  assert.match(appSource, /return workspaceProgress\(state\)\.formComplete;/);
});

test('marks a recovered failed run without showing a completion toast', () => {
  assert.match(appSource, /const recovered = await recoverPublishRun\(state\.publishProgress\.runId\);[\s\S]*?if \(recovered\.status === 'failed'\) \{[\s\S]*?markPublishFailure\(state\.publishProgress,[\s\S]*?showToast\([\s\S]*?\} else \{[\s\S]*?showPublishCompletion\(recovered\);/);
  assert.match(appSource, /Khôi phục đã xác nhận lượt tạo thất bại\. Lượt tạo không được gửi lại\./);
});

test('hard-bounds each recovery read at the overall deadline', () => {
  assert.match(appSource, /const deadline = Date\.now\(\) \+ publishRecoveryTimeoutMs;/);
  assert.match(appSource, /const remainingMilliseconds = deadline - Date\.now\(\);[\s\S]*?if \(remainingMilliseconds <= 0\) throw createPublishRecoveryTimeoutError\(\);/);
  assert.match(appSource, /await wait\(Math\.min\(publishRecoveryIntervalMs, remainingMilliseconds\)\);[\s\S]*?if \(deadline - Date\.now\(\) <= 0\) throw createPublishRecoveryTimeoutError\(\);/);
  assert.match(appSource, /function loadRunBeforeDeadline\(runId, deadline\) \{[\s\S]*?Promise\.race\([\s\S]*?api\.loadRun\(runId\)[\s\S]*?setTimeout[\s\S]*?\.finally\(\(\) => clearTimeout\(timeoutId\)\)/);
});
