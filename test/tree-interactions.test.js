import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const appSource = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
const indexSource = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');

test('routes tree selection and node menus through pure state helpers', () => {
  assert.match(appSource, /if \(action === 'select-node'\)[\s\S]*?activateNode\(state, clientId\)/);
  assert.match(appSource, /if \(action === 'toggle-campaign-collapse'\)[\s\S]*?toggleCampaignCollapsed\(state, clientId\)/);
  assert.match(appSource, /if \(action === 'toggle-node-menu'\)[\s\S]*?toggleNodeMenu\(state, clientId\)/);
  assert.match(appSource, /document\.addEventListener\('click',[\s\S]*?closeNodeMenu\(state\)/);
});

test('removes the global account selector in favor of Campaign fields', () => {
  assert.doesNotMatch(indexSource, /id="ad-account"/);
  assert.doesNotMatch(appSource, /document\.querySelector\('#ad-account'\)/);
});

test('Escape closes a node menu before workspace drawers', () => {
  assert.match(
    appSource,
    /if \(event\.key !== 'Escape'\) return;[\s\S]*?const openNodeMenuId = state\.ui\.openNodeMenuId;[\s\S]*?if \(closeNodeMenu\(state\)\) \{[\s\S]*?render\(\);[\s\S]*?focusNodeMenuButton\(openNodeMenuId\);[\s\S]*?return;/
  );
});

test('uses hierarchy-specific delete confirmation copy', () => {
  assert.match(appSource, /function removeConfirmation\(match\)/);
  assert.match(appSource, /Xóa chiến dịch này và toàn bộ nhóm quảng cáo, quảng cáo bên trong\?/);
  assert.match(appSource, /Xóa nhóm quảng cáo này và toàn bộ quảng cáo bên trong\?/);
  assert.match(appSource, /Xóa quảng cáo này\?/);
});

test('keeps menu-button clicks isolated from row activation', () => {
  assert.match(
    appSource,
    /if \(action === 'toggle-node-menu'\) \{[\s\S]*?const opening = state\.ui\.openNodeMenuId !== clientId;[\s\S]*?if \(!toggleNodeMenu\(state, clientId\)\) return;[\s\S]*?render\(\);[\s\S]*?opening \? focusFirstNodeAction\(clientId\) : focusNodeMenuButton\(clientId\);[\s\S]*?return;/
  );
});

test('opens a node action menu upward when the tree footer would clip it', () => {
  assert.match(
    appSource,
    /if \(action === 'toggle-node-menu'\)[\s\S]*?render\(\);[\s\S]*?if \(opening\) positionOpenNodeMenu\(clientId\);/
  );
  assert.match(
    appSource,
    /function positionOpenNodeMenu\(clientId\)[\s\S]*?\.workspace-tree[\s\S]*?\.tree-footer[\s\S]*?opens-upward/
  );
});

test('closes the menu after hierarchy menu actions, including cancelled delete', () => {
  assert.match(appSource, /const campaign = addCampaign\(state\);[\s\S]*?closeNodeMenu\(state\);/);
  assert.match(appSource, /const adSet = addAdSet\(state, clientId\);\s*closeNodeMenu\(state\);/);
  assert.match(appSource, /const ad = addAd\(state, clientId\);\s*closeNodeMenu\(state\);/);
  assert.match(appSource, /if \(action === 'duplicate-adset'\)[\s\S]*?closeNodeMenu\(state\);[\s\S]*?requestAdSetDuplicateQuantity/);
  assert.match(appSource, /const copy = duplicateAd\(state, clientId\);\s*closeNodeMenu\(state\);/);
  assert.match(appSource, /const confirmed = await confirmAction\(\{[\s\S]*?message: removeConfirmation\(match\),[\s\S]*?\}\);\s*closeNodeMenu\(state\);\s*if \(!confirmed\)/);
});

test('supports minimal Campaign copy and a validated Ad Set quantity dialog', () => {
  assert.match(appSource, /if \(action === 'duplicate-campaign'\)[\s\S]*?duplicateCampaignSettings\(state, clientId\)/);
  assert.match(appSource, /requestAdSetDuplicateQuantity\(source\.node\.name\)/);
  assert.match(appSource, /duplicateAdSets\(state, clientId, quantity\)/);
  assert.match(indexSource, /id="duplicate-adset-quantity"[^>]*type="number"[^>]*min="1"[^>]*max="20"/);
  assert.match(indexSource, /<label for="duplicate-adset-quantity">Số lượng bản sao<\/label>/);
  assert.match(indexSource, /Nhân nhóm quảng cáo tương tự/);
});

test('shows missing requirements as red outlines without visible inline error copy', () => {
  assert.match(appSource, /className = 'progress-field-assistive-error sr-only'/);
  assert.match(appSource, /focusTarget\.setAttribute\('aria-invalid', 'true'\)/);
  assert.doesNotMatch(appSource, /className = 'progress-field-error'/);
});

test('restores a coherent tree focus target after rerendering actions', () => {
  assert.match(appSource, /function focusFirstNodeAction\(clientId\)/);
  assert.match(appSource, /function focusNodeMenuButton\(clientId\)/);
  assert.match(appSource, /function focusNodeMain\(clientId\)/);
  assert.match(appSource, /if \(action === 'select-node'\)[\s\S]*?render\(\);\s*focusNodeMain\(clientId\);/);
});

test('detaches shared creative state before conversation and media mutations', () => {
  assert.match(appSource, /function detachCreativeForAd\(ad\)[\s\S]*?detachAdCreative\(ad\)[\s\S]*?dismissSharedCreativeNotice\(\)/);
  assert.match(appSource, /if \(action === 'new-conversation-template'\)[\s\S]*?detachCreativeForAd\(ad\)[\s\S]*?ad\.conversation = createEmptyConversation/);
  assert.match(appSource, /function updateConversationControl\(control\)[\s\S]*?detachCreativeForAd\(context\.ad\)/);
  assert.match(appSource, /async function uploadMedia\(control\)[\s\S]*?detachCreativeForAd\(match\.node\)[\s\S]*?match\.node\.mediaId =/);
  assert.match(appSource, /const previousCreativeGroupId = match\?\.node\.creativeGroupId;[\s\S]*?updateNodeField\([\s\S]*?if \(match\?\.type === 'ad'[\s\S]*?dismissSharedCreativeNotice\(\)/);
});

test('updates the Messenger preview during typing without rerendering the workspace', () => {
  assert.match(
    appSource,
    /if \(\(control\.dataset\.conversationField \|\| control\.dataset\.conversationCollection\)[\s\S]*?if \(updateConversationControl\(control\)\) \{[\s\S]*?updateConversationPreview\(context\.ad\.conversation\);[\s\S]*?return;/
  );
  assert.match(
    appSource,
    /function updateConversationPreview\(conversation\)[\s\S]*?\.preview-bubble[\s\S]*?textContent[\s\S]*?\.preview-actions button[\s\S]*?compactConversationUrl/
  );
});

test('refreshes quick template save state during in-place conversation and seeding edits', () => {
  assert.match(appSource, /updateSeedingControl\(control\)[\s\S]*?refreshTemplateQuickSave\('seeding', control\.dataset\.clientId\)/);
  assert.match(appSource, /updateConversationControl\(control\)[\s\S]*?refreshTemplateQuickSave\('conversation', control\.dataset\.clientId\)/);
});

test('keeps a blank default conversation instead of auto-applying a saved template', () => {
  assert.doesNotMatch(appSource, /applyDefaultTemplateToCandidates/);
  assert.doesNotMatch(appSource, /applyCachedDefaultsToCampaign/);
  assert.match(
    appSource,
    /if \(control\.dataset\.action === 'select-conversation-template'\)[\s\S]*?if \(context && !control\.value\)[\s\S]*?context\.ad\.conversation = createDefaultConversation\(\)/
  );
});

test('dismisses location search results after a successful region selection', () => {
  assert.match(
    appSource,
    /if \(action === 'add-region'\)[\s\S]*?const added =[\s\S]*?moveCustomLocation\([\s\S]*?: moveRegion\(match\.node, region, control\.dataset\.regionTarget\)[\s\S]*?if \(added\) \{[\s\S]*?dismissLocationSearch\(\);[\s\S]*?render\(\);/
  );
  assert.match(
    appSource,
    /function dismissLocationSearch\(\) \{[\s\S]*?clearTimeout\(locationTimer\);[\s\S]*?locationSequence \+= 1;[\s\S]*?state\.ui\.locationQuery = '';[\s\S]*?state\.ui\.searchingLocations = false;[\s\S]*?activeAccountResources\(\)\.locationResults = \[\];[\s\S]*?\}/
  );
});

test('tracks media progress and commits replacement only after upload success', () => {
  assert.match(
    appSource,
    /async function uploadMedia\(control\)[\s\S]*?const requestId = crypto\.randomUUID\(\);[\s\S]*?state\.ui\.mediaUploads\[match\.node\.clientId\] = \{[\s\S]*?progress: 0[\s\S]*?render\(\);/
  );
  assert.match(
    appSource,
    /const result = state\.ui\.localDemoResources[\s\S]*?createLocalDemoMedia\(uploadFile, kind, onProgress\)[\s\S]*?api\.uploadAdMedia\(uploadFile, match\.campaign\.adAccountId, \{ onProgress \}\);[\s\S]*?detachCreativeForAd\(match\.node\)[\s\S]*?match\.node\.mediaId =[\s\S]*?match\.node\.mediaFileName = uploadFile\.name;[\s\S]*?match\.node\.mediaFileSize = uploadFile\.size;/
  );
  assert.match(
    appSource,
    /function updateMediaUploadProgress\(clientId, requestId, event\)[\s\S]*?Math\.max\(entry\.progress, progress\)[\s\S]*?aria-valuenow[\s\S]*?data-media-progress-value[\s\S]*?data-media-progress-fill/
  );
  assert.match(
    appSource,
    /const status = uploader\.querySelector\('\[data-media-progress-status\]'\);[\s\S]*?const detail = uploader\.querySelector\('\[data-media-progress-detail\]'\);[\s\S]*?status\.textContent = copy\.statusText;[\s\S]*?detail\.textContent = copy\.detailText;/
  );
  assert.match(
    appSource,
    /catch \(error\) \{[\s\S]*?URL\.revokeObjectURL\(previewUrl\);[\s\S]*?clearMediaUpload\(match\.node\.clientId, requestId\);[\s\S]*?showToast\(error\.message\);/
  );
});

test('accepts MOV creatives and normalizes missing browser MIME metadata', () => {
  assert.match(appSource, /'video\/quicktime'/);
  assert.match(appSource, /\['\.mov', 'video\/quicktime'\]/);
  assert.match(appSource, /function normalizeCreativeMediaFile\(file\)[\s\S]*?new File\(\[file\], file\.name, \{ type: mimeType, lastModified: file\.lastModified \}\)/);
  assert.match(appSource, /return \/\\\.\(\?:mp4\|mov\)\$\/i\.test\(name \?\? ''\) \? 'video' : 'image'/);
});

test('updates company video upload progress without rerendering the editor or closing dropdowns', () => {
  const networkUpload = appSource.match(/async function uploadMediaFromNetworkPath\(clientId, networkPath\) \{([\s\S]*?)\n\}\n\nfunction beginTelegramMediaUpload/);
  assert.ok(networkUpload);
  const progressHandler = networkUpload[1].match(/onProgress: \(status\) => \{([\s\S]*?)\n      \}/);
  assert.ok(progressHandler);
  assert.match(progressHandler[1], /updateMediaUploadProgress\(clientId, requestId/);
  assert.doesNotMatch(progressHandler[1], /render\(\)/);

  const reattach = appSource.match(/async function reattachTelegramUploads\(\) \{([\s\S]*?)\n\}\n\nfunction mediaKindFromName/);
  assert.ok(reattach);
  const reattachProgress = reattach[1].match(/onProgress: \(\{ mediaId, clientId, status \}\) => \{([\s\S]*?)\n    \},/);
  assert.ok(reattachProgress);
  assert.match(reattachProgress[1], /updateMediaUploadProgress\(clientId, requestId/);
  assert.doesNotMatch(reattachProgress[1], /updateMediaUploadProgress[\s\S]*?render\(\)/);
});

test('keeps sample media browser-local in demo mode without requiring Meta', () => {
  assert.match(appSource, /function createLocalDemoMedia\(file, kind, onProgress\)/);
  assert.match(appSource, /mediaId = `local-demo-\$\{crypto\.randomUUID\(\)\}`/);
  assert.match(appSource, /localDemo: true/);
  assert.match(appSource, /Đã nạp file mẫu để xem thử trên local/);
});

test('supports media drag and drop and clearing an uploaded creative', () => {
  assert.match(appSource, /workspace\.addEventListener\('dragover'/);
  assert.match(appSource, /workspace\.addEventListener\('drop'/);
  assert.match(appSource, /uploadMediaFile\(file, clientId\)/);
  assert.match(appSource, /if \(action === 'remove-media'\)[\s\S]*?clearAdMedia\(clientId\)/);
});

test('routes seeding actions without detaching shared ad creative', () => {
  assert.match(appSource, /if \(await handleSeedingClick\(action, clientId, control\)\) \{\s*return;\s*\}/);
  const handler = appSource.match(/async function handleSeedingClick\(action, clientId, control\) \{([\s\S]*?)\n\}\n\nfunction updateSeedingControl/);
  assert.ok(handler);
  assert.doesNotMatch(handler[1], /detachCreativeForAd|detachAdCreative|creativeGroupId/);
  assert.match(handler[1], /await validateCurrentDraft\(\)/);
});

test('applies one Campaign preset across names, audience, Seeding, and every Ad conversation', () => {
  assert.match(appSource, /if \(await handleCampaignPresetClick\(action, clientId, control\)\)/);
  assert.match(
    appSource,
    /if \(action === 'apply-campaign-preset'\)[\s\S]*?const campaignId = campaign\.clientId;[\s\S]*?const adAccountId = campaign\.adAccountId;[\s\S]*?const presetId = control\.dataset\.presetId;[\s\S]*?await ensureAccountResourcesForNode\(campaignId\)[\s\S]*?findNode\(state, campaignId\)[\s\S]*?campaignPresets\(\)\.find\(\(entry\) => entry\.id === presetId\)[\s\S]*?adAccountId !== adAccountId[\s\S]*?applyPresetToCampaign\(currentMatch\.node, currentPreset\)/
  );
  assert.match(appSource, /function applyPresetToCampaign\(campaign, preset\)[\s\S]*?campaign\.name = content\.campaignName/);
  assert.match(appSource, /\(campaign\.adSets \?\? \[\]\)\.forEach\(\(adSet\) => \{[\s\S]*?adSet\.name = content\.adSetName/);
  assert.match(appSource, /function campaignPresetAudience\(campaign, content\)[\s\S]*?toolAudienceTemplateCompatibility\([\s\S]*?campaignResources\.loaded/);
  assert.match(appSource, /applyAudienceTemplateToAdSet\(state, adSet\.clientId, audienceResult\.template\)/);
  assert.match(appSource, /\(adSet\.ads \?\? \[\]\)\.forEach\(\(ad\) => applyTemplateToAd\(ad, conversationTemplate\)\)/);
  assert.match(appSource, /applyCampaignSeedingTemplate\(state, campaign\.clientId, seedingTemplate\)/);
  assert.match(appSource, /async function loadResources\(\)[\s\S]*?await Promise\.all\(\[[\s\S]*?loadCampaignPresets\(\)[\s\S]*?\]\)/);
});

test('does not apply a Campaign preset when account resources are unavailable', () => {
  assert.match(
    appSource,
    /const accountResources = await ensureAccountResourcesForNode\(campaignId\);[\s\S]*?if \(!accountResources\?\.loaded\) \{[\s\S]*?showToast\([^)]*tài nguyên tài khoản[^)]*\)[\s\S]*?return true;[\s\S]*?\}/
  );
});

test('updates seeding text in place and commits image replacement only after upload success', () => {
  assert.match(
    appSource,
    /workspace\.addEventListener\('input',[\s\S]*?updateSeedingControl\(control\)[\s\S]*?validateCurrentDraft\(\{ renderView: false \}\)[\s\S]*?return;/
  );
  const upload = appSource.match(/async function uploadSeedingImage\(selection\) \{([\s\S]*?)\n\}\n\nfunction isCurrentSeedingUpload/);
  assert.ok(upload);
  assert.match(upload[1], /validateSeedingImageFile\(file\)[\s\S]*?await api\.uploadMedia\(file,/);
  assert.match(upload[1], /await api\.uploadMedia\(file,[\s\S]*?updateSeedingItem\([^\n]*?'imageMediaId', result\.mediaId \?\? result\.id\)/);
  assert.match(upload[1], /catch \(error\)[\s\S]*?showToast\(error\.message\)/);
});

test('replaces the owner-private seeding library when Meta resources reload', () => {
  assert.match(
    appSource,
    /async function loadResources\(\)[\s\S]*?state\.resources\.seedingTemplates = \[\];[\s\S]*?state\.resources\.seedingTemplatesLoaded = false;[\s\S]*?await Promise\.all\(\[[\s\S]*?loadSeedingTemplates\(\)[\s\S]*?\]\)/
  );
  assert.match(
    appSource,
    /const selectedTemplate = seedingTemplates\(\)\.find\([\s\S]*?campaign\.seeding\?\.templateId[\s\S]*?const deletedTemplate =[\s\S]*?const sourceId = action === 'delete-seeding-template'[\s\S]*?deletedTemplate\?\.id[\s\S]*?selectedTemplate\?\.id;/
  );
});

test('gates seeding loads and CRUD by owner generation plus latest request', () => {
  assert.match(appSource, /const seedingResourceRequests = createOwnerResourceRequestGate\(\);/);
  assert.match(appSource, /async function loadResources\(\)[\s\S]*?beginOwnerGeneration\(\)[\s\S]*?acceptOwner\([\s\S]*?payload\.metaUser\?\.id/);
  assert.match(appSource, /async function loadSeedingTemplates[\s\S]*?seedingResourceRequests\.begin\([\s\S]*?api\.loadSeedingTemplates\(\)[\s\S]*?request\.isCurrent/);
  assert.match(appSource, /async function handleSeedingClick[\s\S]*?seedingResourceRequests\.begin\([\s\S]*?request\.isCurrent/);
});

test('guards async template apply and upload completion with seeding snapshots', () => {
  assert.match(appSource, /captureCampaignSeedingSnapshot\(state, campaign\.clientId\)[\s\S]*?applyCampaignSeedingTemplate\(\s*state,\s*campaign\.clientId,\s*payload\.template,\s*requestSnapshot\s*\)/);
  assert.match(appSource, /captureSeedingUploadTarget\(state, context\.campaign\.clientId, item\.id\)/);
  assert.match(appSource, /function isCurrentSeedingUpload[\s\S]*?isSeedingUploadTargetCurrent\(state, entry\.uploadTarget\)/);
});

test('routes failed seeding library retry and keyboard upload button', () => {
  assert.match(appSource, /action === 'retry-seeding-templates'[\s\S]*?loadSeedingTemplates\(\{ force: true \}\)/);
  assert.match(appSource, /action === 'choose-seeding-image'[\s\S]*?document\.getElementById\(control\.dataset\.inputId\)\?\.click\(\)/);
});
