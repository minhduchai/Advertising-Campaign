import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as campaignState from '../public/state.js';
import { applySeedingTemplate } from '../public/seeding.js';
import { renderSeedingWorkspace } from '../public/workspace.js';

function idSequence(...ids) {
  let index = 0;
  return () => ids[index++];
}

function seedingFixture() {
  const state = campaignState.createWorkspaceState({
    randomId: idSequence('campaign-1', 'adset-1', 'ad-1', 'conversation-1', 'seed-1')
  });
  const campaign = state.draft.campaigns[0];
  campaign.adAccountId = 'act_1';
  campaign.pageId = 'page-1';
  campaign.seeding = {
    enabled: true,
    templateId: 'template-1',
    templateName: 'Mẫu chăm sóc',
    items: [{
      id: 'seed-1',
      message: 'Xem chi tiết tại https://example.test/offer',
      imageMediaId: 'media-1',
      imageName: 'ket-qua.png',
      imageSize: 2048,
      imagePreviewUrl: '/api/media/media-1/preview'
    }]
  };
  state.connected = true;
  state.resources.adAccounts = [{ id: 'act_1', name: 'LG Clinic', currency: 'VND' }];
  state.resources.accountResourcesById.act_1 = {
    pages: [{ id: 'page-1', name: 'LG Clinic', canAdvertise: true }],
    pageDiscovery: { loaded: true, counts: { available: 1, unavailable: 0 } },
    customAudiences: [],
    targetingResults: [],
    locationResults: []
  };
  state.resources.capabilities = { pagesManageEngagement: true };
  state.resources.seedingTemplates = [{
    id: 'template-1',
    name: 'Mẫu chăm sóc',
    items: [{ id: 'seed-1', message: 'Nội dung gốc', imageMediaId: null }]
  }];
  state.resources.seedingTemplatesLoaded = true;
  return state;
}

test('renders the Facebook-like Seeding composer in its dedicated workspace', () => {
  const html = renderSeedingWorkspace(seedingFixture());

  assert.match(html, /data-seeding-composer/);
  assert.match(html, /data-action="apply-seeding-template"/);
  assert.doesNotMatch(html, /data-action="toggle-seeding"/);
  assert.match(html, /data-action="upload-seeding-image"/);
  assert.match(html, /Mỗi Post ID duy nhất nhận bộ comment này một lần/);
  assert.match(html, /data-action="new-seeding-template"/);
  assert.match(html, /data-action="save-seeding-template"/);
  assert.doesNotMatch(html, /data-action="duplicate-seeding-template"/);
  assert.match(html, /data-action="delete-seeding-template"/);
  assert.match(html, /data-template-card-dropdown/);
  assert.match(html, /class="button-primary template-quick-save" data-action="save-seeding-template"/);
});

test('shows required seeding template cards before the comment composer', () => {
  const state = seedingFixture();
  const campaign = state.draft.campaigns[0];
  campaign.seeding.templateId = null;
  campaign.seeding.templateName = '';
  campaign.seeding.items[0].message = '';
  campaign.seeding.items[0].imageMediaId = null;
  campaign.seeding.items[0].imageName = '';
  campaign.seeding.items[0].imageSize = 0;
  campaign.seeding.items[0].imagePreviewUrl = '';
  state.resources.seedingTemplates = [];

  const html = renderSeedingWorkspace(state);

  assert.ok(html.indexOf('Chọn mẫu seeding') < html.indexOf('N\u1ed9i dung b\u00ecnh lu\u1eadn'));
  assert.match(html, /Nội dung bình luận/);
  assert.match(html, /data-seeding-field="message"/);
  assert.match(html, /Thêm ảnh hoặc video/);
  assert.match(html, /data-action="choose-seeding-image"/);
  assert.match(html, /Bắt buộc chọn một mẫu/);
});

test('renders ordered cards with internal thumbnail controls and plain link text', () => {
  const html = renderSeedingWorkspace(seedingFixture());

  assert.match(html, /Bình luận 1/);
  assert.match(html, /<textarea[^>]*data-seeding-field="message"[^>]*>Xem chi tiết tại https:\/\/example\.test\/offer<\/textarea>/);
  assert.match(html, /<img[^>]*src="\/api\/media\/media-1\/preview"/);
  assert.doesNotMatch(html, /<img[^>]+src="https:\/\/example\.test\/offer"/);
  assert.match(html, /aria-label="Đưa bình luận 1 lên"/);
  assert.match(html, /aria-label="Đưa bình luận 1 xuống"/);
  assert.match(html, /aria-label="Xóa bình luận 1"/);
  assert.match(html, /aria-label="Thay media bình luận 1"/);
  assert.match(html, /aria-label="Xóa media bình luận 1"/);
});

test('shows reconnect guidance when Page engagement capability is missing', () => {
  const state = seedingFixture();
  state.resources.capabilities.pagesManageEngagement = false;

  const html = renderSeedingWorkspace(state);

  assert.match(html, /Kết nối lại Meta/);
  assert.match(html, /href="\/api\/auth\/meta\/start"/);
});

test('adds more than ten comments and preserves explicit ordering through move and remove', () => {
  assert.equal(typeof campaignState.addSeedingItem, 'function');
  assert.equal(typeof campaignState.moveSeedingItem, 'function');
  assert.equal(typeof campaignState.removeSeedingItem, 'function');
  const state = seedingFixture();
  const campaign = state.draft.campaigns[0];
  const ids = idSequence('seed-2', 'seed-3', 'seed-4', 'seed-5', 'seed-6', 'seed-7', 'seed-8', 'seed-9', 'seed-10', 'seed-11');

  for (let index = 0; index < 10; index += 1) {
    campaignState.addSeedingItem(state, campaign.clientId, ids);
  }
  assert.equal(campaign.seeding.items.length, 11);

  campaignState.moveSeedingItem(state, campaign.clientId, 'seed-10', -1);
  assert.deepEqual(campaign.seeding.items.slice(-3).map(({ id }) => id), ['seed-10', 'seed-9', 'seed-11']);
  campaignState.removeSeedingItem(state, campaign.clientId, 'seed-10');
  assert.equal(campaign.seeding.items.length, 10);
  assert.equal(campaign.seeding.items.some(({ id }) => id === 'seed-10'), false);
});

test('rejects invalid seeding move offsets without changing order', () => {
  const state = seedingFixture();
  const campaign = state.draft.campaigns[0];
  campaign.seeding.items.push({ id: 'seed-2', message: 'Hai', imageMediaId: null });
  const before = campaign.seeding.items.map(({ id }) => id);

  for (const offset of [0, 2, -2, '1', 'invalid', Number.NaN]) {
    assert.equal(campaignState.moveSeedingItem(state, campaign.clientId, 'seed-2', offset), false);
    assert.deepEqual(campaign.seeding.items.map(({ id }) => id), before);
  }
});

test('deep-copies a selected template and keeps it through Campaign account and Page changes', () => {
  const state = seedingFixture();
  const campaign = state.draft.campaigns[0];
  const template = {
    id: 'template-2',
    name: 'Mẫu độc lập',
    items: [{ id: 'source-1', message: 'Nội dung mẫu', imageMediaId: null }]
  };

  applySeedingTemplate(campaign, template);
  campaign.seeding.items[0].message = 'Nội dung chiến dịch';
  campaignState.changeCampaignAccount(state, campaign.clientId, 'act_2');
  campaign.pageId = 'page-2';

  assert.equal(template.items[0].message, 'Nội dung mẫu');
  assert.equal(campaign.seeding.templateId, 'template-2');
  assert.equal(campaign.seeding.items[0].message, 'Nội dung chiến dịch');
});

test('turning seeding off keeps the selected content intact', () => {
  assert.equal(typeof campaignState.updateCampaignSeeding, 'function');
  const state = seedingFixture();
  const campaign = state.draft.campaigns[0];
  const before = structuredClone(campaign.seeding.items);

  campaignState.updateCampaignSeeding(state, campaign.clientId, 'enabled', false);

  assert.equal(campaign.seeding.enabled, false);
  assert.deepEqual(campaign.seeding.items, before);
});

test('validates seeding image and video uploads up to 200 MB before API use', () => {
  assert.equal(typeof campaignState.validateSeedingImageFile, 'function');

  assert.doesNotThrow(() => campaignState.validateSeedingImageFile({ type: 'image/jpeg', size: 200 * 1024 * 1024 }));
  assert.doesNotThrow(() => campaignState.validateSeedingImageFile({ type: 'video/mp4', size: 200 * 1024 * 1024 }));
  assert.doesNotThrow(() => campaignState.validateSeedingImageFile({ type: 'video/quicktime', size: 200 * 1024 * 1024 }));
  assert.throws(
    () => campaignState.validateSeedingImageFile({ type: 'image/webp', size: 1024 }),
    /Media seeding chỉ hỗ trợ JPEG, PNG, MP4 hoặc MOV/
  );
  assert.throws(
    () => campaignState.validateSeedingImageFile({ type: 'video/mp4', size: 200 * 1024 * 1024 + 1 }),
    /Media seeding tối đa 200 MB/
  );
});

test('keeps seeding cards one-column on mobile and bounds thumbnails', async () => {
  const css = await readFile(new URL('../public/app.css', import.meta.url), 'utf8');

  assert.match(css, /\.seeding-thumbnail\s*\{[\s\S]*?max-width:\s*160px;[\s\S]*?max-height:\s*160px;/);
  assert.match(css, /@media \(max-width: 760px\)\s*\{[\s\S]*?\.seeding-card-content\s*\{[\s\S]*?grid-template-columns:\s*1fr;/);
});

test('keeps the hidden seeding file input from covering image action buttons', async () => {
  const css = await readFile(new URL('../public/app.css', import.meta.url), 'utf8');
  assert.match(css, /\.seeding-image-control\s*>\s*\.media-file-input\s*\{[\s\S]*?clip-path:\s*inset\(50%\)/);
});

test('rejects stale owner, load, and CRUD request tokens', () => {
  assert.equal(typeof campaignState.createOwnerResourceRequestGate, 'function');
  const gate = campaignState.createOwnerResourceRequestGate();
  const generationA = gate.beginOwnerGeneration();
  assert.equal(gate.acceptOwner(generationA, 'owner-a'), true);
  const loadA = gate.begin('owner-a');
  const newerCrudA = gate.begin('owner-a');

  assert.equal(loadA.isCurrent('owner-a'), false);
  assert.equal(newerCrudA.isCurrent('owner-a'), true);

  const generationB = gate.beginOwnerGeneration();
  assert.equal(gate.acceptOwner(generationB, 'owner-b'), true);
  const loadB = gate.begin('owner-b');

  assert.equal(newerCrudA.isCurrent('owner-b'), false);
  assert.equal(loadB.isCurrent('owner-b'), true);
});

test('keeps edits made while a template save response is in flight', () => {
  assert.equal(typeof campaignState.captureCampaignSeedingSnapshot, 'function');
  assert.equal(typeof campaignState.applyCampaignSeedingTemplate, 'function');
  const state = seedingFixture();
  const campaign = state.draft.campaigns[0];
  const requestSnapshot = campaignState.captureCampaignSeedingSnapshot(state, campaign.clientId);

  campaignState.updateSeedingItem(state, campaign.clientId, 'seed-1', 'message', 'Text nhập sau khi bấm lưu');
  const applied = campaignState.applyCampaignSeedingTemplate(state, campaign.clientId, {
    id: 'template-1',
    name: 'Mẫu chăm sóc',
    items: [{ id: 'seed-1', message: 'Text cũ từ response', imageMediaId: null }]
  }, requestSnapshot);

  assert.equal(applied, false);
  assert.equal(campaign.seeding.items[0].message, 'Text nhập sau khi bấm lưu');
});

test('invalidates an upload target when template switching replaces the seeding snapshot', () => {
  assert.equal(typeof campaignState.captureSeedingUploadTarget, 'function');
  assert.equal(typeof campaignState.isSeedingUploadTargetCurrent, 'function');
  const state = seedingFixture();
  const campaign = state.draft.campaigns[0];
  const target = campaignState.captureSeedingUploadTarget(state, campaign.clientId, 'seed-1');

  campaignState.applyCampaignSeedingTemplate(state, campaign.clientId, {
    id: 'template-2',
    name: 'Mẫu khác',
    items: [{ id: 'seed-1', message: 'Cùng item ID', imageMediaId: null }]
  });

  assert.equal(campaignState.isSeedingUploadTargetCurrent(state, target), false);
  assert.equal(campaign.seeding.items[0].imageMediaId, null);
});

test('renders failed library identity, retry, disabled CRUD, and a focusable upload trigger', () => {
  const state = seedingFixture();
  state.resources.seedingTemplates = [];
  state.resources.seedingTemplatesLoaded = false;
  state.resources.seedingTemplatesError = 'Không tải được thư viện mẫu';

  const html = renderSeedingWorkspace(state);

  assert.match(html, /Không tải được thư viện mẫu/);
  assert.match(html, /data-action="retry-seeding-templates"/);
  assert.match(html, /Mẫu đã chọn chưa tải được từ thư viện/);
  assert.match(html, /data-action="save-seeding-template"[^>]*disabled/);
  assert.doesNotMatch(html, /data-action="duplicate-seeding-template"/);
  assert.doesNotMatch(html, /data-action="delete-seeding-template"/);
  assert.match(html, /<button[^>]*data-action="choose-seeding-image"[^>]*aria-controls="seeding-image-campaign-1-seed-1"/);
  assert.doesNotMatch(html, /<label[^>]*class="button-secondary seeding-file-trigger"/);
});
