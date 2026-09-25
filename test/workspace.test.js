import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as workspaceModule from '../public/workspace.js';
import { setAccountResources } from '../public/state.js';

const {
  highlightResourceSearch,
  renderResults,
  renderSeedingWorkspace,
  renderWorkspace,
  resolveAccountComboboxSelection,
  resourceSearchScore
} = workspaceModule;

function workspaceFixture({
  selectedClientId = 'campaign-1',
  budgetStrategy = 'AD_SET',
  issues = []
} = {}) {
  return {
    connected: true,
    running: false,
    selection: {
      clientId: selectedClientId,
      type: selectedClientId.startsWith('campaign')
        ? 'campaign'
        : selectedClientId.startsWith('adset') ? 'adSet' : 'ad'
    },
    issues,
    results: [],
    ui: {
      treeOpen: false,
      reviewOpen: false,
      targetingCategory: 'interest',
      targetingQuery: '',
      locationSelectionSide: 'include',
      locationQuery: '',
      loadingAccountResources: false,
      searchingTargeting: false,
      searchingLocations: false,
      loadingConversationTemplates: false,
      mediaUploads: {},
      collapsedCampaignIds: [],
      openNodeMenuId: null
    },
    resources: {
      adAccounts: [{ id: 'act_1', name: 'LG Clinic 37', currency: 'VND' }],
      pages: [{ id: 'page-1', name: 'LG Clinic', canAdvertise: true }],
      pageDiscovery: {
        loaded: true,
        requiresBusinessReconnect: false,
        warnings: [],
        counts: {
          total: 1,
          available: 1,
          unavailable: 0,
          promotable: 1,
          managed: 0,
          businessOwned: 0,
          businessClient: 0
        }
      },
      accountResourcesById: {
        act_1: {
          pages: [{ id: 'page-1', name: 'LG Clinic', canAdvertise: true }],
          pageDiscovery: {
            loaded: true,
            requiresBusinessReconnect: false,
            warnings: [],
            counts: {
              total: 1,
              available: 1,
              unavailable: 0,
              promotable: 1,
              managed: 0,
              businessOwned: 0,
              businessClient: 0
            }
          },
          customAudiences: [
            { id: 'ca-1', name: 'Đã nhắn tin', subtype: 'ENGAGEMENT' },
            { id: 'ca-2', name: 'Đã truy cập', subtype: 'CUSTOM' }
          ],
          targetingResults: [],
          locationResults: []
        }
      },
      conversationTemplates: [{
          id: 'template-1',
          pageId: 'page-1',
          name: 'Mẫu tư vấn',
          isDefault: true,
          template: {
            sourceTemplateId: null,
            templateName: 'Mẫu tư vấn',
            greeting: 'Chào bạn, chúng tôi có thể giúp gì?',
            quickReplies: [{ id: 'q1', title: 'Tôi cần tư vấn', payload: 'reply_q1' }],
            showBusinessPhoneNumber: false,
            businessPhoneNumber: '',
            customerActions: []
          }
        }],
      conversationTemplatesLoaded: true,
      seedingTemplates: [{
        id: 'seeding-template-1',
        name: 'Mẫu seeding tư vấn',
        items: [{ id: 'seed-1', message: 'Mình đã gửi thông tin cho bạn nhé.', imageMediaId: null }]
      }],
      seedingTemplatesLoaded: true,
      seedingTemplatesError: null
    },
    draft: {
      campaigns: [{
        clientId: 'campaign-1',
        name: 'Chiến dịch tháng 8',
        adAccountId: 'act_1',
        pageId: 'page-1',
        specialAdCategory: 'NONE',
        budgetStrategy,
        dailyBudget: 500000,
        seeding: {
          enabled: true,
          templateId: 'seeding-template-1',
          templateName: 'Mẫu seeding tư vấn',
          items: [{
            id: 'seed-1',
            message: 'Mình đã gửi thông tin cho bạn nhé.',
            imageMediaId: null,
            imageName: '',
            imageSize: 0,
            imagePreviewUrl: ''
          }]
        },
        adSets: [{
          clientId: 'adset-1',
          name: 'Nữ 18-45',
          conversionLocation: 'MESSAGING_APPS',
          destinationType: 'MESSENGER',
          optimizationGoal: 'CONVERSATIONS',
          dailyBudget: 100000,
          locationMode: 'REGIONS',
          includedRegions: [{
            key: '3984',
            name: 'Thành phố Hồ Chí Minh',
            type: 'region',
            countryCode: 'VN'
          }],
          excludedRegions: [],
          ageMin: 18,
          ageMax: 45,
          genders: [2],
          includedCustomAudienceIds: [],
          excludedCustomAudienceIds: [],
          detailedTargeting: [],
          advantageAudienceEnabled: false,
          startTime: '',
          endTime: '',
          ads: [{
            clientId: 'ad-1',
            creativeGroupId: 'ad-1',
            name: 'Ảnh 01',
            primaryText: '',
            headline: '',
            mediaId: null,
            mediaKind: '',
            mediaPreviewUrl: '',
            mediaFileName: '',
            mediaFileSize: 0,
            conversation: {
              sourceTemplateId: 'template-1',
              templateName: 'Mẫu tư vấn',
              greeting: 'Chào bạn, chúng tôi có thể giúp gì?',
              quickReplies: [{ id: 'q1', title: 'Tôi cần tư vấn', payload: 'reply_q1' }],
              showBusinessPhoneNumber: false,
              businessPhoneNumber: '',
              customerActions: [{
                id: 'a1',
                label: 'Đăng ký ngay',
                type: 'OPEN_URL',
                value: 'https://example.test/dang-ky'
              }],
              dirty: true
            }
          }]
        }]
      }]
    }
  };
}

test('shows the Telegram network upload for a connected Meta user', () => {
  const state = workspaceFixture({ selectedClientId: 'ad-1' });

  const connectedHtml = renderWorkspace(state);
  assert.match(connectedHtml, /Dán đường dẫn/);
  assert.match(connectedHtml, /Tải từ ổ chung qua Telegram/);

  state.connected = false;
  assert.doesNotMatch(renderWorkspace(state), /Tải từ ổ chung qua Telegram/);
});

test('shows required name placeholders while keeping fallback hierarchy labels', () => {
  const state = workspaceFixture({ selectedClientId: 'campaign-1' });
  state.draft.campaigns[0].name = '';
  state.draft.campaigns[0].adSets[0].name = '';
  state.draft.campaigns[0].adSets[0].ads[0].name = '';

  const campaignHtml = renderWorkspace(state);
  state.selection = { clientId: 'adset-1', type: 'adSet' };
  const adSetHtml = renderWorkspace(state);
  state.selection = { clientId: 'ad-1', type: 'ad' };
  const adHtml = renderWorkspace(state);

  assert.match(campaignHtml, /placeholder="Nhập tên chiến dịch"/);
  assert.match(adSetHtml, /placeholder="Nhập tên nhóm quảng cáo"/);
  assert.match(adHtml, /placeholder="Nhập tên quảng cáo"/);
  assert.match(campaignHtml, />Chiến dịch</);
  assert.match(campaignHtml, />Nhóm quảng cáo</);
  assert.match(campaignHtml, />Quảng cáo</);
});

test('combines conversion and schedule controls into one compact ad set card', () => {
  const html = renderWorkspace(workspaceFixture({ selectedClientId: 'adset-1' }));

  assert.match(html, /Chuyển đổi &amp; Ngân sách/);
  assert.match(html, /class="adset-setup-compact"/);
  assert.match(html, /data-field="dailyBudget"/);
  assert.match(html, /data-field="startTime"/);
  assert.match(html, /data-field="endTime"/);
  assert.doesNotMatch(html, /<h2>Ngân sách và lịch chạy<\/h2>/);
  assert.match(html, /value="100\.000"/);
});

test('formats campaign budget with Vietnamese thousands separators', () => {
  const state = workspaceFixture({ selectedClientId: 'campaign-1' });
  state.draft.campaigns[0].dailyBudget = 1000000;

  const html = renderWorkspace(state);

  assert.match(html, /data-field="dailyBudget"[^>]*value="1\.000\.000"/);
  assert.match(html, /inputmode="numeric"/);
});

test('shows a readable Facebook Page fallback in the compact conversion card', () => {
  const state = workspaceFixture({ selectedClientId: 'adset-1' });
  state.resources.pages[0].name = '';
  state.resources.accountResourcesById.act_1.pages[0].name = '';
  state.draft.campaigns[0].pageId = '';

  const html = renderWorkspace(state);

  assert.match(html, /Chưa chọn Facebook Page/);
});

test('renders all audience controls inside one compact targeting card', () => {
  const html = renderWorkspace(workspaceFixture({ selectedClientId: 'adset-1' }));

  assert.match(html, /class="audience-compact"/);
  assert.match(html, /class="audience-compact-top"/);
  assert.match(html, /data-audience-template-library/);
  assert.match(html, /data-role="location-query"/);
  assert.match(html, /data-role="targeting-query"/);
  assert.match(html, /class="audience-template-manager"/);
  assert.match(html, /class="audience-custom-field"[\s\S]*?>Bao gồm</);
  assert.match(html, /class="audience-custom-field"[\s\S]*?>Loại trừ</);
});

test('balances the saved and custom audience selectors for readable action labels', async () => {
  const cssSource = await readFile(new URL('../public/app.css', import.meta.url), 'utf8');

  assert.match(cssSource, /\.audience-compact-top\s*>\s*\.saved-audience-picker\s*\{[\s\S]*?flex:\s*\.8 1 0/);
  assert.match(cssSource, /\.audience-compact-custom\s*\{[\s\S]*?flex:\s*1\.2 1 0/);
  assert.match(cssSource, /\.audience-compact \.audience-custom-picker-row \.expand-select-avatar\s*\{[^}]*display:\s*none/s);
  assert.match(cssSource, /\.audience-compact \.audience-custom-picker-row \.expand-select-trigger-text\s*\{[^}]*white-space:\s*nowrap/s);
  assert.match(cssSource, /@media \(max-width:\s*1280px\)\s*\{[\s\S]*?\.audience-compact-top\s*\{[^}]*flex-direction:\s*column/s);
});

test('renders tree, the selected editor, and one inline continue action without a checklist panel', () => {
  const html = renderWorkspace(workspaceFixture({ selectedClientId: 'adset-1' }));

  assert.match(html, /class="workspace-tree/);
  assert.match(html, /class="workspace-editor/);
  assert.doesNotMatch(html, /class="workspace-review/);
  assert.match(html, /class="editor-header-action/);
  assert.match(html, /class="node-type-label">Nhóm quảng cáo</);
  assert.doesNotMatch(html, /class="unified-editor-nav"/);
  assert.doesNotMatch(html, /data-editor-level-section=/);
  assert.match(html, /Vị trí chuyển đổi/);
  assert.match(html, /Facebook Page/);
  assert.doesNotMatch(html, /data-client-id="adset-1"[^>]*data-field="pageId"/);
  assert.match(html, /Mục tiêu hiệu quả/);
  assert.match(html, /Giới tính/);
  assert.match(html, /Bao gồm/);
  assert.match(html, /Loại trừ/);
  assert.match(html, /Giới hạn hơn nữa số người tiếp cận quảng cáo/);
  assert.match(html, /Kiểm tra lần cuối/);
  assert.doesNotMatch(html, /Các mục cần hoàn thành/);
  assert.doesNotMatch(html, /Checklist trước khi đăng/);
  assert.doesNotMatch(html, /data-action="progress-requirement"/);
  assert.doesNotMatch(html, /safety-section/);
  assert.doesNotMatch(html, /An toàn khi tạo/);
});

test('renders Campaign, Ad Set, and Ad as separate editor screens', () => {
  const campaignHtml = renderWorkspace(workspaceFixture({ selectedClientId: 'campaign-1' }));
  const adSetHtml = renderWorkspace(workspaceFixture({ selectedClientId: 'adset-1' }));
  const adHtml = renderWorkspace(workspaceFixture({ selectedClientId: 'ad-1' }));

  assert.match(campaignHtml, /class="node-type-label">Chiến dịch</);
  assert.match(campaignHtml, /Chiến lược ngân sách/);
  assert.doesNotMatch(campaignHtml, /Giới hạn hơn nữa số người tiếp cận quảng cáo/);

  assert.match(adSetHtml, /class="node-type-label">Nhóm quảng cáo</);
  assert.match(adSetHtml, /Giới hạn hơn nữa số người tiếp cận quảng cáo/);
  assert.doesNotMatch(adSetHtml, /Soạn nội dung cuộc trò chuyện/);

  assert.match(adHtml, /class="node-type-label">Quảng cáo</);
  assert.match(adHtml, /Soạn nội dung cuộc trò chuyện/);
  assert.doesNotMatch(adHtml, /Chiến lược ngân sách/);
});

test('renders accessible publish and seeding progress inside campaign tree rows', () => {
  const state = workspaceFixture();
  state.draft.campaigns[0].seeding = {
    enabled: true,
    items: [{ id: 'seed-1' }, { id: 'seed-2' }]
  };
  state.publishProgress = {
    status: 'creating',
    overall: {
      completed: 5,
      total: 8,
      percent: 62,
      phase: 'seeding',
      status: 'running'
    },
    campaigns: [
      {
        clientId: 'campaign-1',
        name: 'Chiến dịch A',
        completed: 4,
        total: 5,
        percent: 80,
        phase: 'seeding',
        status: 'running'
      },
    ],
    nodes: [
      { clientId: 'campaign-1', type: 'campaign', status: 'created' },
      { clientId: 'adset-1', parentClientId: 'campaign-1', type: 'adSet', status: 'created' },
      { clientId: 'ad-1', parentClientId: 'adset-1', type: 'ad', status: 'created', postId: 'page-1_100' }
    ],
    seeding: {
      jobs: [
        { campaignClientId: 'campaign-1', postId: 'page-1_100', status: 'created' },
        { campaignClientId: 'campaign-1', postId: 'page-1_100', status: 'pending' }
      ]
    }
  };

  const html = renderWorkspace(state);

  assert.doesNotMatch(html, /class="workspace-review/);
  assert.doesNotMatch(html, /Tiến độ đăng|Các mục cần hoàn thành|mục đang thiếu/);
  assert.equal((html.match(/class="tree-node-progress-action is-running"/g) ?? []).length, 3);
  assert.match(html, /tree-node-row tree-node-campaign[^>]*has-run-progress[^>]*--tree-progress-ratio:0\.8/);
  assert.match(html, /data-action="open-node-results"[^>]*data-client-id="campaign-1"/);
  assert.match(html, /aria-label="Tiến độ Chiến dịch tháng 8"[^>]*aria-valuenow="80"/);
  assert.match(html, /tree-node-row tree-node-adSet[^>]*--tree-progress-ratio:0\.9/);
  assert.match(html, /tree-node-row tree-node-ad[^>]*--tree-progress-ratio:0\.9/);
  assert.match(html, />Đang seeding</);
});

test('normalizes unsafe tree progress percentages and completion states', () => {
  const state = workspaceFixture();
  state.runProgress = {
    status: 'completed',
    overall: {
      completed: '<2>',
      total: '<2>',
      percent: 140,
      phase: 'complete',
      status: 'completed'
    },
    campaigns: [{
      clientId: 'campaign-1',
      name: '<Campaign unsafe>',
      completed: 2,
      total: 2,
      percent: '20; color:red',
      phase: 'complete',
      status: 'completed'
    }]
  };

  const html = renderWorkspace(state);

  assert.match(html, /tree-node-campaign[^>]*is-run-completed/);
  assert.match(html, /data-action="open-node-results"[^>]*data-client-id="campaign-1"/);
  assert.match(html, /aria-valuenow="0"/);
  assert.match(html, /--tree-progress-ratio:0/);
  assert.doesNotMatch(html, /color:red/);

  state.runProgress.campaigns[0].status = 'completed_with_errors';
  const errorHtml = renderWorkspace(state);
  assert.match(errorHtml, /tree-node-campaign[^>]*is-run-completed_with_errors/);
  assert.match(errorHtml, />Có lỗi</);
});

test('styles inline tree progress for theme contrast and reduced motion', async () => {
  const css = await readFile(new URL('../public/app.css', import.meta.url), 'utf8');

  assert.match(css, /\.tree-node-row\.has-run-progress::after\s*\{[^}]*transform:\s*scaleX[^}]*transition:\s*transform/s);
  assert.match(css, /\.tree-node-row\.is-run-completed\s*\{[^}]*--tree-progress-color:\s*var\(--color-success\)/s);
  assert.match(css, /\.tree-node-progress-action:focus-visible\s*\{[^}]*outline:/s);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.tree-node-row\.has-run-progress::after/);
});

test('keeps account and Page selectors only on the separate Campaign editor', () => {
  const campaignHtml = renderWorkspace(workspaceFixture({ selectedClientId: 'campaign-1' }));
  const adSetHtml = renderWorkspace(workspaceFixture({ selectedClientId: 'adset-1' }));

  assert.match(campaignHtml, /data-resource-combobox="adAccountId"[^>]*data-client-id="campaign-1"/);
  assert.match(campaignHtml, /data-resource-combobox="pageId"[^>]*data-client-id="campaign-1"/);
  assert.match(campaignHtml, /data-resource-combobox="pageId"[^>]*value="LG Clinic · page-1"/);
  assert.doesNotMatch(adSetHtml, /data-resource-combobox="adAccountId"/);
  assert.doesNotMatch(adSetHtml, /data-resource-combobox="pageId"/);
  assert.doesNotMatch(adSetHtml, /data-client-id="adset-1"[^>]*data-field="pageId"/);
});

test('renders searchable account and Page comboboxes without discovery summary copy', () => {
  const html = renderWorkspace(workspaceFixture({ selectedClientId: 'campaign-1' }));

  assert.match(html, /data-resource-kind="adAccountId"[\s\S]*?data-smart-resource-search[^>]*placeholder="Tìm tên hoặc ID tài khoản/);
  assert.match(html, /data-resource-kind="pageId"[\s\S]*?data-smart-resource-search[^>]*placeholder="Tìm tên Page hoặc ID/);
  assert.match(html, /role="listbox"/);
  assert.match(html, /role="option"[^>]*aria-selected="true"/);
  assert.doesNotMatch(html, /<datalist/);
  assert.doesNotMatch(html, /Chọn Page có thể quảng cáo|Page khả dụng|Nguồn: .*quảng bá/);
});

test('renders non-age data selection dropdowns with the unified expandable control', () => {
  const campaignHtml = renderWorkspace(workspaceFixture({ selectedClientId: 'campaign-1' }));
  const adSetHtml = renderWorkspace(workspaceFixture({ selectedClientId: 'adset-1' }));

  assert.match(campaignHtml, /data-expand-select[^>]*data-resource-kind="adAccountId"/);
  assert.match(campaignHtml, /data-expand-select[^>]*data-resource-kind="pageId"/);
  assert.match(campaignHtml, /data-expand-select[^>]*data-select-field="specialAdCategory"/);
  assert.match(adSetHtml, /data-expand-select[^>]*data-select-action="select-audience-template"/);
  assert.match(adSetHtml, /data-expand-select[^>]*data-select-action="move-custom-audience"[^>]*data-audience-target="include"/);
  assert.match(adSetHtml, /data-expand-select[^>]*data-select-action="move-custom-audience"[^>]*data-audience-target="exclude"/);
  assert.doesNotMatch(`${campaignHtml}${adSetHtml}`, /<select/);
});

test('renders dedicated age dropdowns from 18 to 65', () => {
  const html = renderWorkspace(workspaceFixture({ selectedClientId: 'adset-1' }));

  assert.match(html, /class="age-dd"[^>]*data-age-dropdown/);
  assert.match(html, /class="age-dd-trigger"/);
  assert.match(html, /class="age-panel"/);
  assert.doesNotMatch(html, /data-age-option[^>]*data-value="13"/);
  assert.match(html, /data-age-option[^>]*data-value="18"/);
  assert.match(html, /data-age-option[^>]*data-value="65"/);
  assert.doesNotMatch(html, /audience-age-input[\s\S]*?data-expand-select/);
});

test('renders custom date and 24-hour time pickers without native datetime inputs', () => {
  const html = renderWorkspace(workspaceFixture({ selectedClientId: 'adset-1' }));

  assert.match(html, /data-datetime-picker[^>]*data-field="startTime"/);
  assert.match(html, /data-datetime-picker[^>]*data-field="endTime"/);
  assert.match(html, /class="dt-trigger"/);
  assert.match(html, /class="cal-days"/);
  assert.match(html, /class="time-col"[^>]*data-time-part="hour"/);
  assert.match(html, /class="time-col"[^>]*data-time-part="minute"/);
  assert.match(html, /data-time-value="23"/);
  assert.match(html, /data-time-value="59"/);
  assert.doesNotMatch(html, /type="datetime-local"/);
});

test('date and age pickers support keyboard closing and reduced motion', async () => {
  const [source, css] = await Promise.all([
    readFile(new URL('../public/app.js', import.meta.url), 'utf8'),
    readFile(new URL('../public/app.css', import.meta.url), 'utf8')
  ]);

  assert.match(source, /closeAgeDropdowns/);
  assert.match(source, /renderDateTimeCalendar/);
  assert.match(source, /data-datetime-confirm/);
  assert.match(source, /event\.key === 'Escape'/);
  assert.match(css, /\.age-dd\.open \.age-panel/);
  assert.match(css, /\.dt-field\.open \.dt-panel/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.dt-panel/);
});

test('age and expandable dropdown options support keyboard selection and restore trigger focus', async () => {
  const appSource = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');

  assert.match(appSource, /event\.key === 'Enter' \|\| event\.key === ' '/);
  assert.match(appSource, /event\.target\.matches\('\[data-age-option\]:not\(:disabled\)'\)[\s\S]*?event\.target\.click\(\)/);
  assert.match(appSource, /closest\('\[data-age-dropdown\]'\)[\s\S]*?querySelector\('\[data-age-trigger\]'\)[\s\S]*?focus\(\)/);
  assert.match(appSource, /event\.target\.matches\('\[data-expand-select-option\]:not\(:disabled\)'\)[\s\S]*?event\.target\.click\(\)/);
  assert.match(appSource, /function focusRenderedDropdownTrigger\(control\)[\s\S]*?data-select-action[\s\S]*?data-expand-select-trigger/);
  assert.match(appSource, /await validateCurrentDraft\(\);\s*focusRenderedDropdownTrigger\(control\)/);
});

test('all custom dropdowns float above layout without changing page height', async () => {
  const appSource = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const cssSource = await readFile(new URL('../public/app.css', import.meta.url), 'utf8');

  assert.match(appSource, /closeExpandableSelects/);
  assert.match(appSource, /data-expand-select-search/);
  assert.match(appSource, /event\.key === 'Home'/);
  assert.match(appSource, /event\.key === 'End'/);
  assert.match(cssSource, /\.expand-select-body/);
  assert.match(cssSource, /\.expand-select\s*\{[^}]*border:\s*1px solid var\(--color-border\)/);
  assert.match(cssSource, /\.expand-select-expand\s*\{[^}]*position:\s*absolute[^}]*opacity:\s*0[^}]*visibility:\s*hidden/s);
  assert.match(cssSource, /\.expand-select\.is-open\s*\{[^}]*box-shadow:/);
  assert.match(cssSource, /\.expand-select-body\s*\{[^}]*border-top:/);
  assert.match(cssSource, /\.expand-select-options\s*\{[^}]*max-height:[^}]*overflow:\s*auto/);
  assert.match(cssSource, /\.template-card-dropdown-panel\s*\{[^}]*position:\s*absolute[^}]*opacity:\s*0/s);
  assert.match(cssSource, /\.age-panel\s*\{[^}]*position:\s*absolute[^}]*opacity:\s*0/s);
  assert.doesNotMatch(cssSource, /\.(?:expand-select-expand|template-card-dropdown-panel|age-panel)\s*\{[^}]*grid-template-rows/s);
  assert.match(cssSource, /\.is-dropup\s+\.expand-select-expand/);
  assert.match(cssSource, /\.age-dd\.is-dropup\s+\.age-panel/);
  assert.match(cssSource, /\.template-card-dropdown\.is-dropup\s+\.template-card-dropdown-panel/);
  assert.match(cssSource, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.expand-select/);
});

test('floating dropdown panels stay visually attached to their triggers', async () => {
  const cssSource = await readFile(new URL('../public/app.css', import.meta.url), 'utf8');

  assert.match(cssSource, /\.expand-select-expand\s*\{[^}]*top:\s*calc\(100% - 1px\)[^}]*border-radius:\s*0 0 11px 11px/s);
  assert.match(cssSource, /\.smart-resource-panel\s*\{[^}]*top:\s*calc\(100% - 1px\)[^}]*border-radius:\s*0 0 11px 11px/s);
  assert.match(cssSource, /\.template-card-dropdown-panel\s*\{[^}]*top:\s*calc\(100% - 1px\)[^}]*border-radius:\s*0 0 10px 10px/s);
  assert.match(cssSource, /\.age-panel\s*\{[^}]*top:\s*calc\(100% - 1px\)[^}]*border-radius:\s*0 0 9px 9px/s);
});

test('open smart resource picker reads as one expanded select surface', async () => {
  const cssSource = await readFile(new URL('../public/app.css', import.meta.url), 'utf8');

  assert.match(cssSource, /\.expand-select\.is-open:not\(\.is-dropup\)\s*\{[^}]*border-bottom-color:\s*transparent/s);
  assert.match(cssSource, /\.smart-resource-panel\s*\{[^}]*right:\s*-1px[^}]*left:\s*-1px[^}]*width:\s*auto[^}]*border-top:\s*0[^}]*border-right-color:\s*var\(--color-primary\)[^}]*border-bottom-color:\s*var\(--color-primary\)[^}]*border-left-color:\s*var\(--color-primary\)/s);
});

test('age dropdown shows about ten choices before scrolling', async () => {
  const cssSource = await readFile(new URL('../public/app.css', import.meta.url), 'utf8');

  assert.match(cssSource, /\.age-panel\s*\{[^}]*max-height:\s*min\(var\(--floating-panel-max-height, 350px\), 350px\)/s);
  assert.match(cssSource, /\.age-panel-inner\s*\{[^}]*max-height:\s*min\(var\(--floating-panel-max-height, 350px\), 350px\)[^}]*overflow-y:\s*auto/s);
});

test('floating dropdowns flip near viewport edges and close on parent scroll', async () => {
  const appSource = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(appSource, /function positionFloatingDropdown\([^)]*\)[\s\S]*?getBoundingClientRect\(\)/);
  assert.match(appSource, /spaceBelow[\s\S]*?spaceAbove[\s\S]*?classList\.toggle\('is-dropup'/);
  assert.match(appSource, /document\.addEventListener\('scroll',[\s\S]*?closeAllFloatingDropdowns[\s\S]*?true\)/);
  assert.match(appSource, /closeTemplateDropdowns/);
});

test('smart resource dropdown supports arrow navigation, Enter selection, and Escape close', async () => {
  const appSource = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const cssSource = await readFile(new URL('../public/app.css', import.meta.url), 'utf8');
  const workspaceSource = await readFile(new URL('../public/workspace.js', import.meta.url), 'utf8');

  assert.match(appSource, /event\.key === 'ArrowDown'/);
  assert.match(appSource, /event\.key === 'ArrowUp'/);
  assert.match(appSource, /event\.key === 'Enter'[\s\S]*?\.click\(\)/);
  assert.match(appSource, /event\.key === 'Escape'[\s\S]*?closeSmartResourcePickers/);
  assert.match(cssSource, /\.smart-resource-picker-shell\s*>\s*\.field-label/);
  assert.match(cssSource, /\.expand-select\.smart-resource-picker\s*\{[^}]*overflow:\s*visible/);
  assert.match(cssSource, /\.smart-resource-panel\s*\{[^}]*position:\s*absolute/);
  assert.match(cssSource, /\.smart-resource-panel\s*\{[^}]*top:\s*calc\(100% - 1px\)/);
  assert.match(cssSource, /\.smart-resource-options\s*\{[^}]*max-height:\s*360px/);
  assert.match(cssSource, /\.smart-resource-option\[hidden\]\s*\{\s*display:\s*none/);
  assert.match(appSource, /const resourcePickerState = captureSmartResourcePickerState\(\)/);
  assert.match(appSource, /restoreSmartResourcePickerState\(resourcePickerState\)/);
  assert.match(appSource, /function captureSmartResourcePickerState\([\s\S]*?query: search\?\.value/);
  assert.match(appSource, /function restoreSmartResourcePickerState\([\s\S]*?filterSmartResourcePicker\(root, state\.query\)/);
  assert.match(appSource, /function focusDropdownSearch\(root, selector\)[\s\S]*?focusSearch\(\);[\s\S]*?requestAnimationFrame/);
  assert.match(appSource, /pointerdown[\s\S]*?toggle-smart-resource[\s\S]*?preventDefault/);
  assert.match(appSource, /smartResourceSearchFocusIntent[\s\S]*?captureSmartResourcePickerState/);
  assert.match(appSource, /function maintainIntendedSmartResourceSearchFocus\(\)[\s\S]*?0, 80, 240, 500/);
  assert.match(appSource, /restoreSmartResourcePickerState\(resourcePickerState\)[\s\S]*?focusIntendedSmartResourceSearch/);
  assert.match(appSource, /event\.key === 'Tab'[\s\S]*?smartResourceSearchFocusIntent = null/);
  assert.match(appSource, /state\.focused[\s\S]*?focusDropdownSearch\(root, '\[data-smart-resource-search\]'\)/);
  assert.match(appSource, /filter\(\(option\) => !option\.hidden && !option\.disabled\)/);
  assert.match(appSource, /aria-activedescendant/);
  assert.match(appSource, /function focusRenderedSmartResourceTrigger\(control\)/);
  assert.match(workspaceSource, /role="combobox"[^>]*aria-autocomplete="list"[^>]*aria-controls=/);
});

test('smart resource search ranks exact, prefix, accentless token and partial ID matches', () => {
  const page = { id: '813819228472671', name: 'LG Clinic Luxury Hồ Chí Minh', detail: 'ID 813819228472671' };

  assert.ok(resourceSearchScore(page, 'LG Clinic Luxury Hồ Chí Minh') > resourceSearchScore(page, 'lux'));
  assert.ok(resourceSearchScore(page, 'lg luxury') > 0);
  assert.ok(resourceSearchScore(page, 'ho chi minh') > 0);
  assert.ok(resourceSearchScore(page, '813819') > 0);
  assert.equal(resourceSearchScore(page, 'khong ton tai'), -1);
});

test('keeps active native resource helpers but removes the unused page option renderer', async () => {
  const appSource = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const workspaceSource = await readFile(new URL('../public/workspace.js', import.meta.url), 'utf8');
  assert.match(appSource, /prepareResourceComboboxForSearch/);
  assert.match(appSource, /restoreResourceComboboxLabel/);
  assert.doesNotMatch(workspaceSource, /function pageOptionGroup\(/);
});

test('smart resource search highlights matching text safely', () => {
  assert.equal(highlightResourceSearch('LG Clinic Luxury', 'lux'), 'LG Clinic <mark>Lux</mark>ury');
  assert.match(highlightResourceSearch('<LG Clinic>', 'clinic'), /&lt;LG <mark>Clinic<\/mark>&gt;/);
});

test('uses ID-inclusive account labels to resolve duplicate account names exactly', () => {
  const state = workspaceFixture({ selectedClientId: 'campaign-1' });
  state.resources.adAccounts = [
    { id: 'act_1', name: 'LG Clinic', currency: 'VND' },
    { id: 'act_2', name: 'LG Clinic', currency: 'VND' }
  ];

  const html = renderWorkspace(state);

  assert.match(html, /data-smart-resource-option data-value="act_1"/);
  assert.match(html, /data-smart-resource-option data-value="act_2"/);
  assert.equal(
    resolveAccountComboboxSelection(state.resources.adAccounts, 'LG Clinic · VND · act_2', 'act_1'),
    'act_2'
  );
});

test('keeps the shared Page catalog searchable before an ad account is chosen', () => {
  const state = workspaceFixture({ selectedClientId: 'campaign-1' });
  state.draft.campaigns[0].adAccountId = '';
  state.draft.campaigns[0].pageId = '';
  state.resources.pages = [
    { id: 'page-1', name: 'LG Clinic', canAdvertise: true },
    { id: 'page-2', name: 'LG Clinic Quận 7', canAdvertise: true }
  ];
  state.resources.accountResourcesById.act_1.pages = [{ id: 'legacy-page', name: 'Không dùng', canAdvertise: true }];

  const html = renderWorkspace(state);

  assert.doesNotMatch(html, /data-resource-combobox="pageId"[^>]*disabled/);
  assert.match(html, /data-smart-resource-option data-value="page-1"/);
  assert.match(html, /data-smart-resource-option data-value="page-2"/);
  assert.doesNotMatch(html, /Không dùng/);
});

test('shows restricted ad accounts and Pages in red without allowing selection', () => {
  const state = workspaceFixture({ selectedClientId: 'campaign-1' });
  state.draft.campaigns[0].adAccountId = '';
  state.draft.campaigns[0].pageId = '';
  state.resources.adAccounts = [{
    id: 'act_blocked', name: 'Tài khoản hạn chế', currency: 'VND',
    canAdvertise: false, unavailableReason: 'Tài khoản quảng cáo đã bị vô hiệu hóa'
  }];
  state.resources.pages = [{
    id: 'page-blocked', name: 'Page hạn chế', canAdvertise: false,
    unavailableReason: 'Meta chưa trả quyền tạo quảng cáo cho Page này'
  }];

  const html = renderWorkspace(state);

  assert.match(html, /class="smart-resource-option is-restricted"[^>]*data-value="act_blocked"[^>]*disabled/);
  assert.match(html, /Tài khoản quảng cáo đã bị vô hiệu hóa/);
  assert.match(html, /class="smart-resource-option is-restricted"[^>]*data-value="page-blocked"[^>]*disabled/);
  assert.match(html, /Meta chưa trả quyền tạo quảng cáo cho Page này/);
});

test('renders the selected Page and alternate choices from the shared catalog', () => {
  const state = workspaceFixture({ selectedClientId: 'campaign-1' });
  state.draft.campaigns[0].pageId = 'page-2';
  state.resources.pages = [
    { id: 'page-1', name: 'LG Clinic', canAdvertise: true },
    { id: 'page-2', name: 'LG Clinic Quận 7', canAdvertise: true }
  ];
  state.resources.accountResourcesById.act_1.pages = [{ id: 'page-1', name: 'LG Clinic', canAdvertise: true }];

  const html = renderWorkspace(state);

  assert.match(html, /data-resource-combobox="pageId"[^>]*value="LG Clinic Quận 7 · page-2"/);
  assert.match(html, /data-smart-resource-option data-value="page-1"/);
  assert.match(html, /data-smart-resource-option data-value="page-2"/);
});

test('preserves a selected Page when its search is cancelled or does not match', () => {
  const pages = [
    { id: 'page-1', name: 'LG Clinic', canAdvertise: true },
    { id: 'page-2', name: 'LG Clinic Quận 7', canAdvertise: true }
  ];

  assert.equal(typeof workspaceModule.prepareResourceComboboxForSearch, 'function');
  assert.equal(typeof workspaceModule.restoreResourceComboboxLabel, 'function');
  assert.equal(typeof workspaceModule.resolvePageComboboxSelection, 'function');

  const control = {
    value: 'LG Clinic · page-1',
    dataset: {},
    pickerCalls: 0,
    showPicker() {
      this.pickerCalls += 1;
    }
  };

  workspaceModule.prepareResourceComboboxForSearch(control);
  assert.equal(control.value, '');
  assert.equal(control.dataset.resourceComboboxLabel, 'LG Clinic · page-1');
  assert.equal(control.pickerCalls, 1);

  workspaceModule.restoreResourceComboboxLabel(control);
  assert.equal(control.value, 'LG Clinic · page-1');
  assert.equal(control.dataset.resourceComboboxLabel, undefined);
  assert.equal(workspaceModule.resolvePageComboboxSelection(pages, 'không khớp', 'page-1'), 'page-1');
});

test('keeps keyboard search usable when the native picker cannot open', () => {
  const control = {
    value: 'LG Clinic · page-1',
    dataset: {},
    showPicker() {
      throw new Error('NotAllowedError');
    }
  };

  assert.doesNotThrow(() => workspaceModule.prepareResourceComboboxForSearch(control));
  assert.equal(control.value, '');
  assert.equal(control.dataset.resourceComboboxLabel, 'LG Clinic · page-1');
});

test('uses ID-qualified Page labels to resolve duplicate Page names', () => {
  const pages = [
    { id: 'page-1', name: 'LG Clinic', canAdvertise: true },
    { id: 'page-2', name: 'LG Clinic', canAdvertise: true }
  ];

  assert.equal(typeof workspaceModule.pageDisplayLabel, 'function');
  assert.equal(workspaceModule.pageDisplayLabel(pages[0]), 'LG Clinic · page-1');
  assert.equal(workspaceModule.pageDisplayLabel(pages[1]), 'LG Clinic · page-2');
  assert.equal(workspaceModule.resolvePageComboboxSelection(pages, 'LG Clinic · page-2', 'page-1'), 'page-2');
  assert.equal(workspaceModule.resolvePageComboboxSelection(pages, 'page-1', 'page-2'), 'page-1');
  assert.equal(workspaceModule.resolvePageComboboxSelection(pages, 'LG Clinic', 'page-1'), 'page-1');
});

test('keeps incomplete setup guidance at the editor action without rendering a missing-items panel', () => {
  const state = workspaceFixture({ selectedClientId: 'campaign-1' });
  const campaign = state.draft.campaigns[0];
  campaign.name = '';
  campaign.adAccountId = '';
  campaign.pageId = '';
  state.issues = [];

  const html = renderWorkspace(state);

  assert.match(html, /Kiểm tra lần cuối/);
  assert.match(html, /class="editor-header-action/);
  assert.doesNotMatch(html, /mục đang thiếu/);
  assert.doesNotMatch(html, /Các mục cần hoàn thành/);
  assert.doesNotMatch(html, /class="workspace-review/);
  assert.match(html, /id="publish-draft"[^>]*disabled/);
  assert.doesNotMatch(html, /Thiết lập hợp lệ/);
  assert.doesNotMatch(html, /Không phát hiện lỗi/);
});

test('shows every saved audience field while locking its controls', () => {
  const state = workspaceFixture({ selectedClientId: 'adset-1' });
  const adSet = state.draft.campaigns[0].adSets[0];
  adSet.audienceTemplateId = 'saved-1';
  adSet.audienceTemplateName = 'Nữ TP.HCM';
  adSet.includedCustomAudienceIds = ['ca-1'];
  adSet.detailedTargeting = [{ id: 'interest-1', name: 'Chăm sóc da', type: 'interests' }];
  adSet.locales = [6];
  state.resources.accountResourcesById.act_1.savedAudiences = [{
    id: 'saved-1',
    name: 'Nữ TP.HCM',
    compatible: true,
    content: {
      ageMin: 18,
      ageMax: 45,
      genders: [2],
      locales: [6],
      includedRegions: adSet.includedRegions
    }
  }];

  const html = renderWorkspace(state);

  assert.match(html, /Đang dùng đối tượng đã lưu/);
  assert.match(html, /fieldset class="saved-audience-fields" disabled/);
  assert.match(html, /Đã nhắn tin/);
  assert.match(html, /Thành phố Hồ Chí Minh/);
  assert.match(html, /Chăm sóc da/);
  assert.match(html, /Ngôn ngữ/);
  assert.match(html, /Tiếng Việt/);
  assert.match(html, /value="2" checked/);
});

test('groups shared tool audiences separately from read-only Meta saved audiences', () => {
  const state = workspaceFixture({ selectedClientId: 'adset-1' });
  state.resources.audienceTemplates = [{
    id: 'tool_audience_shared-1',
    name: 'Nữ làm đẹp 23-45',
    content: {
      sourceAdAccountId: 'act_1',
      ageMin: 23,
      ageMax: 45,
      genders: [2],
      includedRegions: [],
      includedCustomAudienceIds: ['ca-1'],
      excludedCustomAudienceIds: []
    }
  }, {
    id: 'tool_audience_other-account',
    name: 'Custom Audience tài khoản khác',
    content: {
      sourceAdAccountId: 'act_2',
      includedCustomAudienceIds: ['ca-2'],
      excludedCustomAudienceIds: []
    }
  }, {
    id: 'tool_audience_global',
    name: 'Mẫu global không Custom Audience',
    content: {
      sourceAdAccountId: 'act_2',
      includedCustomAudienceIds: [],
      excludedCustomAudienceIds: []
    }
  }];
  state.resources.audienceTemplatesLoaded = true;
  state.resources.accountResourcesById.act_1.savedAudiences = [{
    id: 'saved_meta_1',
    name: 'Meta HCM',
    compatible: true,
    content: { ageMin: 18, ageMax: 45, genders: [], includedRegions: [] }
  }];

  const html = renderWorkspace(state);

  assert.match(html, /Thư viện của tôi/);
  assert.match(html, /data-value="tool_audience_shared-1"/);
  assert.match(html, /data-value="tool_audience_other-account"(?![^>]*disabled)/);
  assert.match(html, /Custom Audience tài khoản khác/);
  assert.doesNotMatch(html, /Custom Audience tài khoản khác · Bỏ qua/);
  assert.match(html, /data-value="tool_audience_global"(?![^>]*disabled)/);
  assert.match(html, /Meta Ads · Chỉ đọc/);
  assert.match(html, /data-value="saved_meta_1"/);
  assert.match(html, /data-audience-field="templateName"/);
  assert.match(html, /data-action="save-audience-template"/);
  assert.ok(
    html.indexOf('audience-template-manager') > html.indexOf('saved-audience-fields'),
    'the save controls should render after the targeting fields'
  );
});

test('keeps a tool audience selectable when a referenced Custom Audience is missing', () => {
  const state = workspaceFixture({ selectedClientId: 'adset-1' });
  state.resources.audienceTemplates = [{
    id: 'tool_audience_missing-custom',
    name: 'Audience đã xóa',
    content: {
      sourceAdAccountId: 'act_1',
      includedCustomAudienceIds: ['ca-deleted'],
      excludedCustomAudienceIds: []
    }
  }];
  state.resources.audienceTemplatesLoaded = true;

  const html = renderWorkspace(state);

  assert.match(html, /data-value="tool_audience_missing-custom"(?![^>]*disabled)/);
  assert.match(html, /Audience đã xóa · Bỏ qua 1 Custom Audience/);
});

test('keeps targeting editable and renders management actions for a selected tool audience', () => {
  const state = workspaceFixture({ selectedClientId: 'adset-1' });
  const adSet = state.draft.campaigns[0].adSets[0];
  state.resources.audienceTemplates = [{
    id: 'tool_audience_shared-1',
    name: 'Nữ làm đẹp 23-45',
    content: { ageMin: 23, ageMax: 45, genders: [2], includedRegions: [] }
  }];
  state.resources.audienceTemplatesLoaded = true;
  adSet.audienceTemplateId = 'tool_audience_shared-1';
  adSet.audienceTemplateName = 'Nữ làm đẹp 23-45';

  const html = renderWorkspace(state);

  assert.match(html, /data-audience-source="tool"/);
  assert.match(html, /fieldset class="saved-audience-fields" >/);
  assert.doesNotMatch(html, /fieldset class="saved-audience-fields" disabled/);
  assert.match(html, /data-action="save-audience-template"[^>]*>Lưu thay đổi</);
  assert.match(html, /data-action="duplicate-audience-template"/);
  assert.match(html, /data-action="delete-audience-template"/);
  assert.match(html, /data-action="new-audience-template"/);
});

test('keeps Meta saved audiences read-only without tool mutation actions', () => {
  const state = workspaceFixture({ selectedClientId: 'adset-1' });
  const adSet = state.draft.campaigns[0].adSets[0];
  state.resources.accountResourcesById.act_1.savedAudiences = [{
    id: 'saved_meta_1',
    name: 'Meta HCM',
    compatible: true,
    content: { ageMin: 18, ageMax: 45, genders: [], includedRegions: [] }
  }];
  adSet.audienceTemplateId = 'saved_meta_1';
  adSet.audienceTemplateName = 'Meta HCM';

  const html = renderWorkspace(state);

  assert.match(html, /data-audience-source="meta"/);
  assert.match(html, /Meta Ads · Chỉ đọc/);
  assert.match(html, /fieldset class="saved-audience-fields" disabled/);
  assert.doesNotMatch(html, /data-action="duplicate-audience-template"/);
  assert.doesNotMatch(html, /data-action="delete-audience-template"/);
});

test('shows a retryable shared-library error without requiring Meta connection', () => {
  const state = workspaceFixture({ selectedClientId: 'adset-1' });
  state.connected = false;
  state.resources.audienceTemplates = [];
  state.resources.audienceTemplatesLoaded = false;
  state.resources.audienceTemplatesError = 'Không thể tải thư viện';

  const html = renderWorkspace(state);

  assert.match(html, /Không thể tải thư viện/);
  assert.match(html, /data-action="retry-audience-templates"/);
  assert.match(html, /data-action="save-audience-template"/);
});

test('renders Ad content without publication mode choices', () => {
  const html = renderWorkspace(workspaceFixture({ selectedClientId: 'ad-1' }));

  assert.match(html, /data-action="upload-media"/);
  assert.match(html, /data-field="primaryText"/);
  assert.match(html, /data-field="headline"/);
  assert.doesNotMatch(html, /data-field="publicationMode"/);
  assert.doesNotMatch(html, /publication-mode-block|public-test-warning/);
});

test('places Ad copy before the media uploader', () => {
  const html = renderWorkspace(workspaceFixture({ selectedClientId: 'ad-1' }));
  const primaryTextIndex = html.indexOf('data-field="primaryText"');
  const headlineIndex = html.indexOf('data-field="headline"');
  const mediaIndex = html.indexOf('data-action="upload-media"');

  assert.ok(primaryTextIndex >= 0);
  assert.ok(headlineIndex > primaryTextIndex);
  assert.ok(mediaIndex > headlineIndex);
});

test('defines the approved 40/60 Ad content grid', async () => {
  const css = await readFile(new URL('../public/app.css', import.meta.url), 'utf8');

  assert.match(css, /\.creative-layout\s*\{[^}]*display:\s*grid[^}]*grid-template-columns:\s*minmax\(0, 2fr\) minmax\(0, 3fr\)/s);
  assert.match(css, /\.creative-copy-fields\s*\{[^}]*grid-template-rows:\s*minmax\(200px, 1fr\) auto/s);
  assert.doesNotMatch(css, /@media[^}]*\.creative-layout\s*\{[^}]*grid-template-columns:\s*1fr/s);
});

test('renders a compact Campaign seeding entry linked to the dedicated editor', () => {
  const state = workspaceFixture({ selectedClientId: 'campaign-1' });
  state.resources.capabilities = { pagesManageEngagement: true };
  state.resources.seedingTemplatesLoaded = true;
  state.resources.seedingTemplates = [];
  state.draft.campaigns[0].seeding = {
    enabled: false,
    templateId: null,
    templateName: '',
    items: [{ id: 'seed-1', message: '', imageMediaId: null, imageName: '', imageSize: 0, imagePreviewUrl: '' }]
  };

  const campaignHtml = renderWorkspace(state);
  assert.doesNotMatch(campaignHtml, /data-seeding-section/);
  assert.match(campaignHtml, /data-campaign-seeding-summary/);
  assert.match(campaignHtml, /data-campaign-seeding-template-picker[^>]*data-client-id="campaign-1"[^>]*data-validation-field="seeding\.templateId"/);
  assert.match(campaignHtml, /data-template-card-search[^>]*placeholder="Tìm mẫu seeding/);
  assert.match(campaignHtml, /data-action="new-seeding-template"[^>]*data-open-seeding-editor="true"/);
  assert.match(campaignHtml, /data-action="open-campaign-seeding"[^>]*data-client-id="campaign-1"/);
  assert.match(campaignHtml, /Chưa thiết lập/);

  const seedingHtml = renderSeedingWorkspace(state);
  assert.match(seedingHtml, /data-seeding-section/);
  assert.match(seedingHtml, /workspace-seeding-shell/);
  assert.match(seedingHtml, /workspace-seeding-layout/);
  assert.doesNotMatch(seedingHtml, /workspace-review/);
  assert.doesNotMatch(seedingHtml, /Kiểm tra thiết lập/);
  assert.match(seedingHtml, /Quay lại Chiến dịch/);
  assert.match(seedingHtml, /class="seeding-new-template-bar"/);
  assert.match(seedingHtml, /data-seeding-field="templateName"/);
  assert.match(seedingHtml, /data-action="save-seeding-template"[^>]*>Lưu mẫu mới</);
  assert.doesNotMatch(seedingHtml, /Quản lý mẫu seeding|data-seeding-template-library/);
});

test('renders searchable Campaign presets with create, apply, update, and delete actions', () => {
  const state = workspaceFixture({ selectedClientId: 'campaign-1' });
  state.resources.campaignPresetsLoaded = true;
  state.resources.campaignPresetsError = null;
  state.resources.campaignPresets = [{
    id: 'preset-1',
    name: 'Triệt bikini nữ',
    content: {
      campaignName: 'Campaign nữ',
      adSetName: 'No Target Nữ 22–45',
      audienceTemplateId: 'tool_audience_shared-1',
      audienceTemplateName: 'Nữ làm đẹp 22–45 · Hồ Chí Minh',
      audienceContent: {
        sourceAdAccountId: 'act_1',
        ageMin: 22,
        ageMax: 45,
        genders: [2]
      },
      seedingTemplateId: 'seeding-template-1',
      seedingTemplateName: 'Mẫu seeding tư vấn',
      conversationTemplateId: 'template-1',
      conversationTemplateName: 'Mẫu tư vấn'
    }
  }];
  state.ui.campaignPresetSelectionByCampaignId = { 'campaign-1': 'preset-1' };

  const html = renderWorkspace(state);
  assert.match(html, /Cấu hình sẵn/);
  assert.match(html, /data-template-card-search[^>]*placeholder="Tìm cấu hình/);
  assert.match(html, /data-action="new-campaign-preset"/);
  assert.match(html, /data-action="apply-campaign-preset"[^>]*data-preset-id="preset-1"/);
  assert.match(html, /data-action="delete-campaign-preset"[^>]*data-preset-id="preset-1"/);
  assert.match(html, /data-action="save-campaign-preset"[^>]*>Cập nhật cấu hình</);
  assert.match(html, /Campaign nữ/);
  assert.match(html, /No Target Nữ 22–45/);
  assert.match(html, /Nữ làm đẹp 22–45 · Hồ Chí Minh/);
});

test('renders seeding templates with the shared dropdown icon and per-card delete action', () => {
  const state = workspaceFixture({ selectedClientId: 'campaign-1' });
  state.resources.capabilities = { pagesManageEngagement: true };
  state.resources.seedingTemplatesLoaded = true;
  state.resources.seedingTemplates = [{
    id: 'seeding-template-1',
    name: 'Seeding trị nám',
    items: [{ id: 'seed-1', message: 'Nội dung', imageMediaId: null }]
  }];
  state.draft.campaigns[0].seeding = {
    enabled: true,
    templateId: 'seeding-template-1',
    templateName: 'Seeding trị nám',
    items: [{ id: 'seed-1', message: 'Nội dung', imageMediaId: null, imageName: '', imageSize: 0, imagePreviewUrl: '' }]
  };

  const html = renderSeedingWorkspace(state);

  assert.match(html, /class="template-dropdown-plus"/);
  assert.match(html, /data-action="delete-seeding-template"/);
  assert.match(html, /aria-label="Xóa mẫu Seeding trị nám"/);
  assert.doesNotMatch(html, /template-dropdown-chevron/);
});

test('keeps demo seeding templates selectable without a Meta connection', () => {
  const state = workspaceFixture({ selectedClientId: 'campaign-1' });
  state.connected = false;
  state.ui.localDemoResources = true;
  state.draft.campaigns[0].seeding = {
    enabled: true,
    templateId: null,
    templateName: '',
    items: []
  };

  const html = renderSeedingWorkspace(state);

  assert.match(html, /data-action="apply-seeding-template"/);
  assert.doesNotMatch(html, /data-action="apply-seeding-template"[^>]*disabled/);
  assert.match(html, /Bắt buộc chọn trước khi tạo quảng cáo/);
});

test('prevents a text caret from appearing on template dropdown controls', async () => {
  const css = await readFile(new URL('../public/app.css', import.meta.url), 'utf8');

  assert.match(css, /\.template-card-dropdown\s*>\s*summary\s*\{[^}]*user-select:\s*none[^}]*caret-color:\s*transparent/s);
  assert.match(css, /\.template-dropdown-plus\s*\{[^}]*pointer-events:\s*none/s);
});

test('shows template choices as readable single-column rows with create first', async () => {
  const state = workspaceFixture({ selectedClientId: 'campaign-1' });
  state.resources.capabilities = { pagesManageEngagement: true };
  state.resources.seedingTemplatesLoaded = true;
  state.resources.seedingTemplates = [{ id: 'seed-long', name: 'Mẫu seeding có tên rất dài cần hiển thị đầy đủ', items: [] }];
  state.draft.campaigns[0].seeding = { enabled: true, templateId: null, templateName: '', items: [] };

  const html = renderSeedingWorkspace(state);
  const createIndex = html.indexOf('data-action="new-seeding-template"');
  const templateIndex = html.indexOf('data-action="apply-seeding-template"');
  const css = await readFile(new URL('../public/app.css', import.meta.url), 'utf8');

  assert.ok(createIndex >= 0 && createIndex < templateIndex);
  assert.match(css, /\.template-card-dropdown-panel \.template-card-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/s);
  assert.match(css, /\.template-choice-copy strong\s*\{[^}]*white-space:\s*normal[^}]*overflow-wrap:\s*anywhere/s);
});

test('keeps seeding validation local without restoring a separate review panel', () => {
  const state = workspaceFixture({
    selectedClientId: 'campaign-1',
    issues: [{ path: 'campaigns.0.seeding.templateId', message: 'Chọn mẫu seeding' }]
  });
  state.draft.campaigns[0].seeding = { enabled: true, templateId: null, templateName: '', items: [] };

  const html = renderSeedingWorkspace(state);

  assert.doesNotMatch(html, /Cần xử lý trước khi tạo|workspace-review|data-action="jump-to-validation-issue"/);
  assert.match(html, /aria-label="Chọn mẫu seeding"/);
  assert.match(html, /Bắt buộc chọn trước khi tạo quảng cáo/);
});

test('keeps Seeding inside Campaign instead of the global workspace navigation', async () => {
  const [html, appSource] = await Promise.all([
    readFile(new URL('../public/index.html', import.meta.url), 'utf8'),
    readFile(new URL('../public/app.js', import.meta.url), 'utf8')
  ]);
  assert.doesNotMatch(html, /id="open-seeding-workspace"/);
  assert.match(html, /id="open-campaign-workspace"/);
  assert.match(html, /id="open-history-workspace"/);
  assert.match(appSource, /action === 'open-campaign-seeding'[\s\S]*?state\.ui\.activeWorkspace = 'seeding'/);
});

test('renders accessible three-dot menus for every hierarchy level', () => {
  const state = workspaceFixture();
  state.ui.openNodeMenuId = 'adset-1';

  const html = renderWorkspace(state);

  assert.match(html, /data-action="toggle-node-menu"[^>]*data-client-id="campaign-1"/);
  assert.match(html, /data-action="toggle-node-menu"[^>]*data-client-id="adset-1"/);
  assert.match(html, /data-action="toggle-node-menu"[^>]*data-client-id="ad-1"/);
  assert.match(html, /id="node-menu-button-adset-1"[^>]*aria-controls="node-actions-adset-1"/);
  assert.match(html, /id="node-actions-adset-1"[^>]*role="group"[^>]*aria-labelledby="node-menu-button-adset-1"/);
  assert.doesNotMatch(html, /role="menu"/);
  assert.doesNotMatch(html, /role="menuitem"/);
  assert.match(html, /Thêm nhóm quảng cáo mới/);
  assert.match(html, /Nhân nhóm quảng cáo tương tự/);
  assert.match(html, /Xóa nhóm quảng cáo/);
  assert.match(html, /data-action="add-adset"[^>]*data-client-id="campaign-1"/);
  assert.match(html, /data-action="duplicate-adset"[^>]*data-client-id="adset-1"/);
  assert.match(html, /data-action="remove-node"[^>]*data-client-id="adset-1"/);
  const campaignMenuState = workspaceFixture();
  campaignMenuState.ui.openNodeMenuId = 'campaign-1';
  const campaignMenuHtml = renderWorkspace(campaignMenuState);
  assert.match(campaignMenuHtml, /Sao chép Campaign và nhóm quảng cáo/);
  assert.match(campaignMenuHtml, /data-action="duplicate-campaign"[^>]*data-client-id="campaign-1"/);
  assert.match(campaignMenuHtml, /Thêm chiến dịch mới/);
  assert.match(campaignMenuHtml, /Xóa chiến dịch/);
  assert.match(campaignMenuHtml, /<button[^>]*data-action="add-campaign"(?![^>]*data-client-id)[^>]*>/);
  const adMenuState = workspaceFixture();
  adMenuState.ui.openNodeMenuId = 'ad-1';
  const adMenuHtml = renderWorkspace(adMenuState);
  assert.match(adMenuHtml, /Thêm quảng cáo mới/);
  assert.match(adMenuHtml, /Thêm quảng cáo tương tự/);
  assert.match(adMenuHtml, /Xóa quảng cáo/);
  assert.match(adMenuHtml, /data-action="add-ad"[^>]*data-client-id="adset-1"/);
  assert.match(adMenuHtml, /data-action="duplicate-ad"[^>]*data-client-id="ad-1"/);
  assert.doesNotMatch(html, /class="tree-add-row"/);
  assert.doesNotMatch(html, /class="editor-actions"/);
});

test('omits Campaign descendants when the Campaign is collapsed', () => {
  const expandedState = workspaceFixture();
  const collapsedState = workspaceFixture();
  collapsedState.ui.collapsedCampaignIds = ['campaign-1'];

  const expandedHtml = renderWorkspace(expandedState);
  const collapsedHtml = renderWorkspace(collapsedState);

  assert.match(expandedHtml, /data-action="toggle-campaign-collapse"[^>]*aria-expanded="true"/);
  assert.match(expandedHtml, /class="icon-bounce"[^>]*><svg viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"><\/polyline><\/svg>/);
  assert.doesNotMatch(expandedHtml, /data-action="select-node"[^>]*aria-expanded=/);
  assert.match(expandedHtml, /data-client-id="adset-1"/);
  assert.match(collapsedHtml, /data-action="toggle-campaign-collapse"[^>]*aria-expanded="false"/);
  assert.doesNotMatch(collapsedHtml, /data-action="select-node"[^>]*data-client-id="adset-1"/);
});

test('warns about a Page the ad account does not list for promotion but keeps it selectable', () => {
  const state = workspaceFixture({ selectedClientId: 'campaign-1' });
  state.draft.campaigns[0].pageId = 'page-2';
  state.resources.pages = [
    { id: 'page-1', name: 'LG Clinic', canAdvertise: true },
    { id: 'page-2', name: 'LG Portfolio', canAdvertise: true }
  ];
  setAccountResources(state, 'act_1', { loaded: true, promotablePageIds: ['page-1'], pageEligibilityKnown: true });

  const html = renderWorkspace(state);
  const option = (pageId) => new RegExp(`<button[^>]*data-value="${pageId}"[^>]*>`).exec(html)?.[0] ?? '';

  assert.match(option('page-2'), /is-warning/);
  assert.doesNotMatch(option('page-2'), /disabled/);
  assert.doesNotMatch(option('page-1'), /is-warning|disabled/);
  assert.match(html, /class="smart-resource-trigger[^"]*is-warning/);
  assert.match(html, /Không có trong danh sách Page quảng bá của tài khoản này/);
});

test('shows no Page warning while the ad account promotable Pages are unknown', () => {
  const state = workspaceFixture({ selectedClientId: 'campaign-1' });
  state.resources.pages = [
    { id: 'page-1', name: 'LG Clinic', canAdvertise: true },
    { id: 'page-2', name: 'LG Portfolio', canAdvertise: true }
  ];
  setAccountResources(state, 'act_1', { loaded: true, promotablePageIds: [], pageEligibilityKnown: false });

  assert.doesNotMatch(renderWorkspace(state), /is-warning/);
});

test('lists available and restricted Pages with reconnect guidance', () => {
  const state = workspaceFixture({ selectedClientId: 'campaign-1' });
  state.resources.pages = [
    { id: 'page-1', name: 'LG Clinic', sources: ['MANAGED'], canAdvertise: true, unavailableReason: null },
    { id: 'page-2', name: 'Locked Page', sources: ['BUSINESS_CLIENT'], canAdvertise: false, unavailableReason: 'Meta chưa trả quyền tạo quảng cáo cho Page này' }
  ];
  state.resources.pageDiscovery = {
    loaded: true,
    requiresBusinessReconnect: true,
    warnings: ['Kết nối lại Meta để tải Page trong Business Portfolio'],
    counts: { total: 2, available: 1, unavailable: 1, promotable: 0, managed: 1, businessOwned: 0, businessClient: 1 }
  };

  const html = renderWorkspace(state);
  assert.match(html, /data-smart-resource-option data-value="page-1"/);
  assert.match(html, /Locked Page/);
  assert.match(html, /class="smart-resource-option is-restricted"[^>]*data-value="page-2"[^>]*disabled/);
  assert.match(html, /href="\/api\/auth\/meta\/start"/);
});

test('renders every Page in the selector without a separate search input', () => {
  const state = workspaceFixture({ selectedClientId: 'campaign-1' });
  state.ui.pageQuery = 'không khớp';
  state.resources.pages = [
    { id: 'page-1', name: 'LG Clinic', canAdvertise: true },
    { id: 'page-2', name: 'Khác', canAdvertise: true }
  ];

  const html = renderWorkspace(state);
  assert.doesNotMatch(html, /data-role="page-query"/);
  assert.doesNotMatch(html, /value="page-1"[^>]*hidden/);
  assert.doesNotMatch(html, /value="page-2"[^>]*hidden/);
});

test('isolates Page resource failures to the requested Campaign account', async () => {
  const appSource = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');

  assert.match(appSource, /state\.resources\.adAccounts = \[\];[\s\S]*?clearPageCatalogState\(state\);/);
  assert.match(
    appSource,
    /accountResourceLoads\.load\(requestedAccountId,[\s\S]*?catch \(error\) \{\s+setAccountResources\(state, requestedAccountId, previousResources \?\? \{\}\);/
  );
  assert.match(
    appSource,
    /pageCatalogIssues\(\s*state\.draft,\s*state\.resources\.pages\s*\)/
  );
  assert.match(appSource, /handleResourceComboboxChange\(control\)/);
});

test('reconciles unavailable accounts through the campaign account helper', async () => {
  const appSource = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const resourcesLoader = appSource.match(
    /async function loadResources\(\) \{([\s\S]*?)\n\}\n\nasync function ensureAccountResourcesForNode/
  );

  assert.ok(resourcesLoader);
  assert.match(
    resourcesLoader[1],
    /reconcileAvailableCampaignAccounts\(state, availableAccountIds\);/
  );
  assert.doesNotMatch(resourcesLoader[1], /campaign\.pageId = '';/);
});

test('guards account resource success, failure, and finally after account changes', async () => {
  const appSource = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const loader = appSource.match(
    /async function loadAdAccountResources\(requestedAccountId = activeCampaign\(state\)\?\.adAccountId\) \{([\s\S]*?)\n\}\n\nasync function ensureConversationTemplatesForNode/
  );

  assert.ok(loader);
  assert.match(appSource, /const accountResourceRequests = createAccountResourceRequestGate\(\);/);
  assert.match(
    appSource,
    /async function handleResourceComboboxChange\(control, explicitValue = control\.value\)[\s\S]*?const accountId = resolveAccountComboboxSelection\([\s\S]*?if \(!accountId\) \{\s+render\(\);\s+return;\s+\}[\s\S]*?changeCampaignAccount\(state, match\.node\.clientId, accountId\)/
  );
  assert.match(
    appSource,
    /changeCampaignAccount\(state, match\.node\.clientId, accountId\);[\s\S]*?await ensureAccountResourcesForNode\(match\.node\.clientId\);/
  );
  assert.match(appSource, /function accountResourceErrorMessage\(error\)/);
  assert.match(appSource, /Meta đang tạm giới hạn lượt gọi của ứng dụng/);
  assert.match(loader[1], /const request = accountResourceRequests\.begin\(requestedAccountId\);/);
  assert.match(loader[1], /accountResourceLoads\.load\(requestedAccountId,/);
  assert.match(loader[1], /api\.loadAdAccountResources\(requestedAccountId\)/);
  assert.match(
    loader[1],
    /const payload = await api\.loadAdAccountResources\(requestedAccountId\);[\s\S]*?setAccountResources\(state, requestedAccountId, \{/
  );
  assert.match(
    loader[1],
    /catch \(error\) \{\s+if \(request\.isCurrent\(activeCampaign\(state\)\?\.adAccountId\)\) \{\s+showToast\(accountResourceErrorMessage\(error\)\);/
  );
  assert.match(
    loader[1],
    /finally \{\s+if \(request\.isCurrent\(activeCampaign\(state\)\?\.adAccountId\)\) \{[\s\S]*?state\.ui\.loadingAccountResources = false;[\s\S]*?await validateCurrentDraft\(\);\s+\}/
  );
});

test('caches account responses by requested ID while request gates control only the active UI', async () => {
  const appSource = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const loader = appSource.match(
    /async function loadAdAccountResources\(requestedAccountId = activeCampaign\(state\)\?\.adAccountId\) \{([\s\S]*?)\n\}\n\nfunction accountResourceErrorMessage/
  );

  assert.ok(loader);
  assert.match(appSource, /const accountResourceLoads = createAccountResourceLoadCache\(\);/);
  assert.match(loader[1], /accountResourceLoads\.load\(requestedAccountId,/);
  assert.match(
    loader[1],
    /const payload = await api\.loadAdAccountResources\(requestedAccountId\);[\s\S]*?setAccountResources\(state, requestedAccountId, \{[\s\S]*?loaded: true/
  );
  assert.match(loader[1], /if \(request\.isCurrent\(activeCampaign\(state\)\?\.adAccountId\)\) \{/);
  assert.doesNotMatch(
    loader[1],
    /const payload = await api\.loadAdAccountResources\(requestedAccountId\);\s+if \(!request\.isCurrent/
  );
});

test('loads the shared Page catalog independently from account resources', async () => {
  const appSource = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const resourcesLoader = appSource.match(
    /async function loadResources\(\) \{([\s\S]*?)\n\}\n\nasync function ensureAccountResourcesForNode/
  );
  const accountLoader = appSource.match(
    /async function loadAdAccountResources\(requestedAccountId = activeCampaign\(state\)\?\.adAccountId\) \{([\s\S]*?)\n\}\n\nfunction accountResourceErrorMessage/
  );

  assert.ok(resourcesLoader);
  assert.ok(accountLoader);
  assert.match(resourcesLoader[1], /state\.resources\.pages = payload\.pages \?\? \[\];/);
  assert.match(resourcesLoader[1], /state\.resources\.pageDiscovery = payload\.pageDiscovery \?\? state\.resources\.pageDiscovery;/);
  assert.match(accountLoader[1], /promotablePageIds/);
  assert.doesNotMatch(accountLoader[1], /payload\.pages|payload\.pageDiscovery/);
});

test('opens resource search from pointer and keyboard focus', async () => {
  const appSource = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');

  assert.match(
    appSource,
    /workspace\.addEventListener\('pointerdown',[\s\S]*?prepareResourceComboboxForSearch\(control\)/
  );
  assert.match(appSource, /workspace\.addEventListener\('focusin',[\s\S]*?prepareResourceComboboxForSearch\(control\)/);
  assert.match(
    appSource,
    /workspace\.addEventListener\('focusout',[\s\S]*?restoreResourceComboboxLabel\(control\)/
  );
});

test('does not let delayed resource-search focus consume the first option click', async () => {
  const appSource = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');

  assert.match(
    appSource,
    /workspace\.addEventListener\('pointerdown',[\s\S]*?data-smart-resource-option[\s\S]*?smartResourceSearchFocusIntent = null;[\s\S]*?event\.preventDefault\(\);[\s\S]*?toggle-smart-resource/
  );
  assert.match(
    appSource,
    /function focusDropdownSearch\(root, selector\)[\s\S]*?selector === '\[data-smart-resource-search\]'[\s\S]*?smartResourceSearchFocusIntent\?\.kind !== root\?\.dataset\.resourceKind/
  );
  assert.match(
    appSource,
    /const selectedValue = option\.dataset\.value \?\? '';[\s\S]*?handleResourceComboboxChange\(input, selectedValue\)/
  );
});

test('renders Campaign budget strategy controls', () => {
  const html = renderWorkspace(workspaceFixture({ selectedClientId: 'campaign-1' }));

  assert.match(html, /Chiến lược ngân sách/);
  assert.match(html, /Ngân sách chiến dịch/);
  assert.match(html, /Ngân sách nhóm quảng cáo/);
  assert.match(html, /data-field="budgetStrategy"/);
});

test('disables ad set budget when campaign budget is selected', () => {
  const html = renderWorkspace(workspaceFixture({
    budgetStrategy: 'CAMPAIGN',
    selectedClientId: 'adset-1'
  }));

  assert.match(html, /data-field="dailyBudget"[^>]*disabled/);
  assert.match(html, /Ngân sách được quản lý tại cấp chiến dịch/);
});

test('renders conversation creative fields and media upload', () => {
  const html = renderWorkspace(workspaceFixture({ selectedClientId: 'ad-1' }));

  assert.match(html, /Văn bản chính/);
  assert.match(html, /Tiêu đề/);
  assert.match(html, /Cuộc trò chuyện/);
  assert.match(html, /type="file"/);
});

test('renders an uploaded image thumbnail and success metadata', () => {
  const state = workspaceFixture({ selectedClientId: 'ad-1' });
  const ad = state.draft.campaigns[0].adSets[0].ads[0];
  ad.mediaId = 'media-1';
  ad.mediaKind = 'image';
  ad.mediaPreviewUrl = 'blob:image';
  ad.mediaFileName = 'banner.webp';
  ad.mediaFileSize = 2048;

  const html = renderWorkspace(state);

  assert.match(html, /<img[^>]+src="blob:image"/);
  assert.match(html, /Đã tải lên/);
  assert.match(html, /banner\.webp/);
  assert.match(html, /2 KB/);
  assert.match(html, /Thay tệp/);
});

test('renders a playable uploaded video with separate replacement control', () => {
  const state = workspaceFixture({ selectedClientId: 'ad-1' });
  const ad = state.draft.campaigns[0].adSets[0].ads[0];
  ad.mediaId = 'media-2';
  ad.mediaKind = 'video';
  ad.mediaPreviewUrl = 'blob:video';
  ad.mediaFileName = 'lenVIDEO_2908_DANG_KHOA_DANH_KHOAA_TRIETNACH400KHOOK2_TOAN_BO_NOI_DUNG_QUANG_CAO.mp4';
  ad.mediaFileSize = 3 * 1024 * 1024;

  const html = renderWorkspace(state);

  assert.match(html, /<video[^>]+src="blob:video"[^>]+controls[^>]+playsinline[^>]+preload="metadata"/);
  assert.doesNotMatch(html, /<video[^>]+muted/);
  assert.match(html, /class="media-replace-trigger"[^>]*for="media-file-ad-1"/);
  assert.match(html, /class="media-upload-filename"[^>]*title="lenVIDEO_2908_DANG_KHOA/);
  assert.match(html, /class="media-upload-size">3\.0 MB/);
  assert.match(html, /3\.0 MB/);
  assert.match(html, /data-action="remove-media"/);
});

test('renders an accessible single-file drag and drop media uploader', () => {
  const html = renderWorkspace(workspaceFixture({ selectedClientId: 'ad-1' }));

  assert.match(html, /data-media-dropzone="ad-1"/);
  assert.match(html, /Kéo thả vào đây hoặc/);
  assert.match(html, /chọn tệp/);
  assert.match(html, /accept="image\/jpeg,image\/png,image\/webp,video\/mp4,video\/quicktime,\.mov"/);
  assert.match(html, /JPG, PNG, WebP, MP4 hoặc MOV/);
  assert.match(html, /Tối đa 500 MB/);
});

test('renders upload percentage and disables replacement while uploading', () => {
  const state = workspaceFixture({ selectedClientId: 'ad-1' });
  state.ui.mediaUploads['ad-1'] = {
    requestId: 'upload-1',
    status: 'uploading',
    progress: 42,
    previewUrl: 'blob:pending',
    kind: 'image',
    fileName: 'banner.jpg',
    fileSize: 4096
  };

  const html = renderWorkspace(state);

  assert.match(html, /role="progressbar"/);
  assert.match(html, /aria-valuenow="42"/);
  assert.match(html, />42%<\/strong>/);
  assert.match(html, /data-action="upload-media"[^>]+disabled/);
  assert.match(html, /banner\.jpg/);
  assert.match(html, /4 KB/);
});

test('renders real company bot upload bytes and percentage', () => {
  const state = workspaceFixture({ selectedClientId: 'ad-1' });
  state.ui.mediaUploads['ad-1'] = {
    requestId: 'telegram-job-1',
    source: 'telegram',
    status: 'uploading',
    progress: 32,
    uploadedBytes: 32 * 1024 * 1024,
    totalBytes: 100 * 1024 * 1024,
    previewUrl: '',
    kind: 'video',
    fileName: '',
    fileSize: 100 * 1024 * 1024
  };

  const html = renderWorkspace(state);

  assert.match(html, /Bot máy công ty đang tải file/);
  assert.match(html, /aria-valuenow="32"/);
  assert.match(html, />32%<\/strong>/);
  assert.match(html, /Đã tải 32\.0 MB \/ 100\.0 MB/);
  assert.match(html, /data-media-progress-status/);
  assert.match(html, /data-media-progress-detail/);
});

test('keeps long uploaded media names inside the media card', async () => {
  const css = await readFile(new URL('../public/app.css', import.meta.url), 'utf8');

  assert.match(css, /\.media-upload-footer\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) auto/s);
  assert.match(css, /\.media-upload-filename\s*\{[^}]*overflow:\s*hidden[^}]*overflow-wrap:\s*anywhere[^}]*-webkit-line-clamp:\s*2/s);
  assert.match(css, /\.media-upload-meta\s*\{[^}]*min-width:\s*0/s);
});

test('shows the number of Ads sharing the selected creative group', () => {
  const state = workspaceFixture({ selectedClientId: 'ad-1' });
  const source = state.draft.campaigns[0].adSets[0].ads[0];
  state.draft.campaigns[0].adSets[0].ads.push({
    ...structuredClone(source),
    clientId: 'ad-2',
    name: 'Ảnh 01 - Bản sao'
  });

  const sharedHtml = renderWorkspace(state);
  state.draft.campaigns[0].adSets[0].ads[1].creativeGroupId = 'ad-2';
  const detachedHtml = renderWorkspace(state);

  assert.match(sharedHtml, /Đang dùng chung bài quảng cáo với 2 quảng cáo/);
  assert.doesNotMatch(detachedHtml, /Đang dùng chung bài quảng cáo/);
});

test('renders the shared conversation library, simple web-button form, JSON preview, and Messenger preview', () => {
  const html = renderWorkspace(workspaceFixture({ selectedClientId: 'ad-1' }));

  assert.match(html, /data-action="apply-conversation-template"/);
  assert.match(html, /data-action="delete-conversation-template"/);
  assert.match(html, /class="template-choice-delete"/);
  assert.match(html, /class="template-dropdown-plus"/);
  assert.match(html, /class="template-choice-card is-selected"/);
  assert.match(html, /data-action="update-conversation-template"/);
  assert.doesNotMatch(html, /data-action="default-conversation-template"/);
  assert.doesNotMatch(html, /· Mặc định/);
  assert.doesNotMatch(html, /template-state-badge is-default/);
  assert.match(html, /data-conversation-field="greeting"/);
  assert.doesNotMatch(html, /data-action="add-quick-reply"/);
  assert.doesNotMatch(html, /data-conversation-field="showBusinessPhoneNumber"/);
  assert.match(html, /data-action="add-customer-action"/);
  assert.match(html, /Tiêu đề nút/);
  assert.match(html, /URL trang web/);
  assert.match(html, /JSON sẽ gửi Meta/);
  assert.doesNotMatch(html, /data-role="conversation-json"/);
  assert.match(html, /class="conversation-preview/);
  assert.match(html, /Đăng ký ngay/);
});

test('prioritizes Conversation template cards before the composer and keeps management secondary', () => {
  const html = renderWorkspace(workspaceFixture({ selectedClientId: 'ad-1' }));

  assert.match(html, /data-conversation-composer/);
  assert.match(html, /Soạn nội dung cuộc trò chuyện/);
  assert.match(html, /Xem trước trên Messenger/);
  assert.match(html, /Mẫu cuộc trò chuyện/);
  assert.doesNotMatch(html, /Quản lý mẫu cuộc trò chuyện|Thư viện mẫu dùng chung|data-conversation-template-library/);
  assert.doesNotMatch(html, /Mẫu cuộc trò chuyện \(tùy chọn\)|Chọn nhanh một mẫu có sẵn hoặc tạo card mới|Điền lời chào và nút hành động|Tối đa 640 ký tự/);
  assert.match(html, /placeholder="Xin chào \{\{user_full_name\}\}, \.\.\."/);
  assert.match(html, /0–3 nút web/);
  assert.match(html, /data-action="upload-conversation-image"/);
  assert.match(html, /Chọn ảnh cho cuộc trò chuyện/);
  assert.ok(html.indexOf('conversation-template-card-picker') < html.indexOf('data-conversation-composer'));
});

test('defines a responsive two-column Conversation composer with a single-column mobile fallback', async () => {
  const css = await readFile(new URL('../public/app.css', import.meta.url), 'utf8');

  assert.match(css, /\.conversation-builder\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\) minmax\(260px, 320px\)/);
  assert.match(css, /@media \(max-width: 1199px\)\s*\{[\s\S]*?\.conversation-builder\s*\{[\s\S]*?grid-template-columns:\s*1fr;/);
  assert.match(css, /\.conversation-preview\s*\{[\s\S]*?position:\s*sticky;/);
});

test('uses one smart primary save action for existing and new conversation templates', () => {
  const existingState = workspaceFixture({ selectedClientId: 'ad-1' });
  const existingHtml = renderWorkspace(existingState);

  assert.match(existingHtml, /class="button-primary template-quick-save" data-action="update-conversation-template"[^>]*>Lưu thay đổi</);
  assert.doesNotMatch(existingHtml, /class="button-primary" data-action="save-conversation-template"/);

  existingState.draft.campaigns[0].adSets[0].ads[0].conversation.sourceTemplateId = null;
  const newHtml = renderWorkspace(existingState);

  assert.match(newHtml, /class="conversation-new-template-bar"/);
  assert.match(newHtml, /data-conversation-field="templateName"/);
  assert.match(newHtml, /class="button-primary" data-action="save-conversation-template"[^>]*>Lưu mẫu mới</);
  assert.doesNotMatch(newHtml, /data-action="update-conversation-template"/);
  assert.match(existingHtml, /data-template-card-dropdown/);
});

test('deletes conversation templates directly without a browser confirmation dialog', async () => {
  const appSource = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const deleteBranch = appSource.match(
    /if \(action === 'delete-conversation-template'\) \{[\s\S]*?showToast\('Đã xóa mẫu khỏi thư viện của bạn\.'\);\n    \}/
  )?.[0] ?? '';

  assert.ok(deleteBranch);
  assert.doesNotMatch(deleteBranch, /confirm\(/);
});

test('deletes conversation templates without reloading the library or workspace', async () => {
  const source = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const deleteFlow = source.match(/if \(action === 'delete-conversation-template'\) \{[\s\S]*?showToast\('Đã xóa mẫu khỏi thư viện của bạn\.'\);\n    \}/)?.[0] ?? '';

  assert.doesNotMatch(deleteFlow, /loadConversationTemplates/);
  assert.match(deleteFlow, /state\.resources\.conversationTemplates = templatesForPage\(\)\.filter/);
  assert.match(deleteFlow, /template-choice-wrap'\)\?\.remove\(\)/);
});

test('enables new conversation and seeding template saves while typing', async () => {
  const source = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');

  assert.match(source, /\[data-action="save-conversation-template"\]\[data-client-id=/);
  assert.match(source, /!ad\?\.conversation\?\.templateName\?\.trim\(\)/);
  assert.match(source, /\[data-action="save-seeding-template"\]\[data-client-id=/);
  assert.match(source, /!campaign\?\.seeding\?\.templateName\?\.trim\(\)/);
});

test('escapes user-provided names before rendering', () => {
  const state = workspaceFixture();
  state.draft.campaigns[0].name = '<img src=x onerror=alert(1)>';

  const html = renderWorkspace(state);

  assert.doesNotMatch(html, /<img src=x/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
});

test('renders per-node run results', () => {
  const html = renderResults([
    { clientId: 'campaign-1', type: 'campaign', status: 'created', remoteId: 'remote-1' },
    { clientId: 'adset-1', type: 'adSet', status: 'failed', error: { message: 'Invalid Page' } }
  ]);

  assert.match(html, /Thành công/);
  assert.match(html, /Thất bại/);
  assert.match(html, /remote-1/);
  assert.match(html, /Invalid Page/);
});

test('renders readable result cards with separate type, name, and identifiers', async () => {
  const html = renderResults([{
    clientId: '707ececc-2427-4c3e-9cf9-39f18902e2a3',
    type: 'campaign',
    name: 'Demo Campaign',
    status: 'created',
    remoteId: 'demo-campaign'
  }]);
  const css = await readFile(new URL('../public/app.css', import.meta.url), 'utf8');

  assert.match(html, /class="result-type">Chiến dịch</);
  assert.match(html, /class="result-name">Demo Campaign</);
  assert.match(html, /class="result-identifier"><span>ID cục bộ:<\/span><code>707ececc/);
  assert.match(html, /class="result-identifier"><span>ID Meta:<\/span><code>demo-campaign/);
  assert.match(css, /\.result-name\s*\{[^}]*overflow-wrap:\s*anywhere/s);
  assert.match(css, /\.result-identifier\s*\{[^}]*grid-template-columns/s);
  assert.match(css, /\.results-drawer\s*\{[^}]*width:\s*min\(100vw, 600px\)/s);
});

test('renders accessible live publication progress and pending rows', () => {
  const html = renderResults({
    status: 'creating',
    total: 3,
    completed: 1,
    percent: 33,
    currentClientId: 'adset-1',
    nodes: [
      { clientId: 'campaign-1', name: 'Tin nhắn', type: 'campaign', status: 'created' },
      { clientId: 'adset-1', name: 'Hồ Chí Minh', type: 'adSet', status: 'creating' },
      { clientId: 'ad-1', name: 'Video 1', type: 'ad', status: 'pending' }
    ]
  });

  assert.match(html, /role="progressbar"/);
  assert.match(html, /aria-valuemin="0"/);
  assert.match(html, /aria-valuemax="100"/);
  assert.match(html, /aria-valuenow="33"/);
  assert.match(html, /33%/);
  assert.match(html, /Đã hoàn thành 1\/3 bước/);
  assert.match(html, /Đang tạo Nhóm quảng cáo: Hồ Chí Minh/);
  assert.match(html, /class="run-progress-current" role="status" aria-live="polite" aria-atomic="true"/);
  assert.match(html, /Chờ xử lý/);
  assert.match(html, /Video 1/);
});

test('renders a compact drawer header and structured publication progress card', async () => {
  const html = renderResults({
    status: 'creating', completed: 10, total: 13, percent: 76, currentClientId: 'ad-1',
    nodes: [{ clientId: 'ad-1', name: 'Demo Ad', type: 'ad', status: 'creating' }]
  });
  const css = await readFile(new URL('../public/app.css', import.meta.url), 'utf8');

  assert.match(html, /class="results-title-group"/);
  assert.match(html, /aria-label="Đóng nhật ký"><span aria-hidden="true">×<\/span>/);
  assert.match(html, /class="run-progress-metric"/);
  assert.match(html, /class="run-progress-current"/);
  assert.match(css, /\.run-progress\s*\{[^}]*border-radius/s);
  assert.match(css, /\.run-progress-current\s*\{[^}]*display:\s*flex/s);
});

test('keeps an escaped run-level failure visible in the results drawer', () => {
  const html = renderResults({
    status: 'failed',
    total: 1,
    completed: 0,
    percent: 0,
    currentClientId: null,
    error: { message: '<Meta timeout & retry>' },
    nodes: [{ clientId: 'campaign-1', name: 'Campaign', type: 'campaign', status: 'creating' }]
  });

  assert.match(html, /&lt;Meta timeout &amp; retry&gt;/);
  assert.doesNotMatch(html, /<Meta timeout & retry>/);
});

test('keeps failed and skipped rows visible at 100 percent', () => {
  const html = renderResults({
    status: 'completed_with_errors',
    total: 2,
    completed: 2,
    percent: 100,
    currentClientId: null,
    nodes: [
      { clientId: 'adset-1', name: 'Nhóm lỗi', type: 'adSet', status: 'failed', error: { message: 'Invalid Page' } },
      { clientId: 'ad-1', name: 'Quảng cáo', type: 'ad', status: 'skipped' }
    ]
  });

  assert.match(html, /100%/);
  assert.match(html, /Hoàn tất với lỗi/);
  assert.match(html, /Invalid Page/);
  assert.match(html, /Đã bỏ qua/);
});

test('normalizes and bounds publication progress percentages', () => {
  const html = renderResults({
    status: 'creating',
    total: '<3>',
    completed: '<1>',
    percent: '20; color:red',
    currentClientId: '<adset-1>',
    nodes: [{ clientId: '<adset-1>', name: '<Hồ Chí Minh>', type: 'adSet', status: 'creating' }]
  });

  assert.doesNotMatch(html, /<Hồ Chí Minh>/);
  assert.match(html, /&lt;Hồ Chí Minh&gt;/);
  assert.match(html, /<strong>0%<\/strong>/);
  assert.match(html, /aria-valuenow="0"/);
  assert.match(html, /style="width: 0%"/);
  assert.doesNotMatch(html, /color:red/);

  const progressHtml = (percent) => renderResults({
    status: 'creating',
    total: 1,
    completed: 0,
    percent,
    currentClientId: null,
    nodes: [{ clientId: 'ad-1', name: 'Ad', type: 'ad', status: 'pending' }]
  });
  const belowMinimum = progressHtml(-1);
  const aboveMaximum = progressHtml(101);

  assert.match(belowMinimum, /aria-valuenow="0"/);
  assert.match(aboveMaximum, /aria-valuenow="100"/);
});

test('renders stable actions for hierarchy and audience edits', () => {
  const adSetMenuState = workspaceFixture({ selectedClientId: 'adset-1' });
  adSetMenuState.ui.openNodeMenuId = 'adset-1';
  const adSetMenuHtml = renderWorkspace(adSetMenuState);
  const adMenuState = workspaceFixture({ selectedClientId: 'adset-1' });
  adMenuState.ui.openNodeMenuId = 'ad-1';
  const html = renderWorkspace(adMenuState);

  assert.match(adSetMenuHtml, /data-action="add-adset"/);
  assert.match(html, /data-action="add-ad"/);
  assert.match(html, /data-action="select-node"/);
  assert.match(html, /data-action="move-custom-audience"/);
  assert.match(html, /data-action="search-targeting"/);
});

test('renders only Vietnam province and city targeting', () => {
  const state = workspaceFixture({ selectedClientId: 'adset-1' });
  state.ui.locationQuery = 'Thủ Đức';
  const adSet = state.draft.campaigns[0].adSets[0];
  adSet.locationMode = 'REGIONS';
  adSet.includedRegions = [{
    key: '3984',
    name: 'Thành phố Hồ Chí Minh',
    type: 'region',
    countryCode: 'VN'
  }];
  state.resources.accountResourcesById.act_1.locationResults = [{
    key: '3998',
    name: 'Nghệ An',
    type: 'region',
    countryCode: 'VN'
  }, {
    key: '2420605',
    name: 'Thủ Đức',
    type: 'city',
    countryCode: 'VN',
    region: 'Hồ Chí Minh'
  }];
  adSet.includedCities = [{
    key: '2420605',
    name: 'Thủ Đức',
    type: 'city',
    countryCode: 'VN',
    region: 'Hồ Chí Minh',
    radius: 8,
    distanceUnit: 'kilometer'
  }];
  const html = renderWorkspace(state);

  assert.doesNotMatch(html, /Toàn Việt Nam/);
  assert.doesNotMatch(html, /data-action="set-location-mode"/);
  assert.match(html, /Nhập địa chỉ, tên đường, tỉnh hoặc thành phố/);
  assert.match(html, /data-action="set-location-side"/);
  assert.match(html, /data-action="add-region"/);
  assert.match(html, /data-action="remove-region"/);
  assert.match(html, /data-location-chip-list[^>]*role="list"[^>]*tabindex="0"/);
  assert.match(html, /data-region-type="city"/);
  assert.match(html, /data-location-radius/);
  assert.match(html, /data-action="remove-city"/);
});

test('keeps long selected location lists compact with wrapping and internal scroll', async () => {
  const cssSource = await readFile(new URL('../public/app.css', import.meta.url), 'utf8');

  assert.match(cssSource, /\.selected-location-chips\s*\{[^}]*display:\s*flex[^}]*flex-wrap:\s*wrap/s);
  assert.match(cssSource, /\.selected-location-chips\s*\{[^}]*max-height:\s*122px[^}]*overflow-y:\s*auto/s);
  assert.match(cssSource, /\.selected-location-chips:focus-visible\s*\{[^}]*outline:/s);
});

test('renders precise pin radius targeting with a map and editable radius', () => {
  const state = workspaceFixture({ selectedClientId: 'adset-1' });
  const adSet = state.draft.campaigns[0].adSets[0];
  adSet.includedCustomLocations = [{
    key: 'pin:10.980400,106.651900',
    name: 'Phú Thọ, Thủ Dầu Một',
    type: 'custom_location',
    countryCode: 'VN',
    latitude: 10.9804,
    longitude: 106.6519,
    radius: 10,
    distanceUnit: 'kilometer'
  }];

  const html = renderWorkspace(state);

  assert.match(html, /data-custom-location-entry/);
  assert.match(html, /class="custom-location-card/);
  assert.match(html, /data-location-map="adset-1:include:pin:10\.980400,106\.651900"/);
  assert.match(html, /data-latitude="10\.9804" data-longitude="106\.6519" data-radius="10"/);
  assert.doesNotMatch(html, /openstreetmap\.org\/export\/embed\.html|custom-location-radius-ring/);
  assert.match(html, /data-custom-location-radius/);
  assert.match(html, /data-action="remove-custom-location"/);
  assert.match(html, /Phú Thọ, Thủ Dầu Một/);
  assert.match(html, /Thêm ghim bao gồm trên bản đồ/);
  assert.match(html, /data-location-map="adset-1:picker"/);
});

test('renders address results with source attribution and the chosen include/exclude side', () => {
  const state = workspaceFixture({ selectedClientId: 'adset-1' });
  state.ui.locationQuery = 'Đặng Văn Bi, Hồ Chí Minh';
  state.ui.locationSearchCompleted = true;
  state.ui.locationSelectionSide = 'exclude';
  state.resources.accountResourcesById.act_1.locationResults = [{
    key: 'pin:10.842861,106.763027', name: 'Đặng Văn Bi',
    address: 'Đặng Văn Bi, Thủ Đức, TP.HCM', type: 'custom_location',
    latitude: 10.842861, longitude: 106.763027, source: 'OpenStreetMap'
  }];
  const html = renderWorkspace(state);
  assert.match(html, /data-region-type="custom_location" data-region-target="exclude"/);
  assert.match(html, /Địa chỉ · Ghim bán kính/);
  assert.match(html, /OpenStreetMap contributors/);
  assert.match(html, /data-map-picker="true"/);
});

test('location search distinguishes no results from provider errors and pending searches', () => {
  const state = workspaceFixture({ selectedClientId: 'adset-1' });
  const campaign = state.draft.campaigns[0];
  const adSet = campaign.adSets[0];
  const render = () => workspaceModule.renderLocationSearchResults(state, campaign, adSet);
  state.ui.locationQuery = 'unknown address';
  state.ui.searchingLocations = true;
  assert.match(render(), /Đang tìm vị trí/);
  state.ui.searchingLocations = false;
  state.ui.locationSearchCompleted = true;
  assert.match(render(), /chọn một điểm trên bản đồ/);
  state.ui.locationSearchError = 'Không thể kết nối <provider>';
  assert.match(render(), /role="alert"/);
  assert.match(render(), /&lt;provider&gt;/);
});

test('blocks publishing on server issues without rendering a missing-items panel', () => {
  const html = renderWorkspace(workspaceFixture({
    issues: [{ path: 'campaigns.0.adSets.0.pageId', message: 'Chọn Facebook Page' }]
  }));

  assert.doesNotMatch(html, /Chọn Facebook Page/);
  assert.doesNotMatch(html, /class="workspace-review/);
  assert.match(html, /id="publish-draft"[^>]*data-action="publish-draft"[^>]*disabled/);
  assert.match(html, />\s*Đăng\s*<\/button>/);
  assert.doesNotMatch(html, /data-action="jump-to-validation-issue"/);
});

test('places the publish action in the Campaign editor only', async () => {
  const state = workspaceFixture();
  const campaignHtml = renderWorkspace(state);
  const seedingHtml = renderSeedingWorkspace(state);
  const indexHtml = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');

  assert.match(campaignHtml, /class="workspace-editor[\s\S]*?class="editor-header-action"[\s\S]*?data-action="publish-draft"/);
  assert.doesNotMatch(campaignHtml, /class="workspace-review/);
  assert.match(campaignHtml, /aria-label="Đăng chiến dịch và kích hoạt trên Meta"/);
  assert.doesNotMatch(seedingHtml, /data-action="publish-draft"/);
  assert.doesNotMatch(indexHtml, /id="publish-draft"/);

  state.running = true;
  const runningHtml = renderWorkspace(state);
  assert.match(runningHtml, /id="publish-draft"[^>]*aria-busy="true"[^>]*disabled/);
  assert.match(runningHtml, /aria-label="Đang kiểm tra thiết lập trước khi đăng"/);
  assert.match(runningHtml, />\s*Đang kiểm tra\.\.\.\s*<\/button>/);

  state.ui.publishPhase = 'publishing';
  const publishingHtml = renderWorkspace(state);
  assert.match(publishingHtml, /aria-label="Đang đăng chiến dịch lên Meta"/);
  assert.match(publishingHtml, />\s*Đang đăng\.\.\.\s*<\/button>/);
});

test('renders stable validation targets for campaign, ad set and ad fields', () => {
  const campaignHtml = renderWorkspace(workspaceFixture({ selectedClientId: 'campaign-1' }));
  const adSetHtml = renderWorkspace(workspaceFixture({ selectedClientId: 'adset-1' }));
  const adHtml = renderWorkspace(workspaceFixture({ selectedClientId: 'ad-1' }));

  assert.match(campaignHtml, /data-resource-kind="adAccountId"[^>]*data-validation-field="adAccountId"/);
  assert.match(campaignHtml, /data-resource-kind="pageId"[^>]*data-validation-field="pageId"/);
  assert.match(adSetHtml, /location-editor[^>]*data-validation-field="includedRegions"/);
  assert.match(adHtml, /data-media-dropzone="ad-1"[^>]*data-validation-field="mediaId"/);
  assert.match(adHtml, /data-conversation-composer[^>]*data-validation-field="conversation"/);
});

test('defines desktop workspace columns and responsive drawers', async () => {
  const css = await readFile(new URL('../public/app.css', import.meta.url), 'utf8');

  assert.match(css, /\.workspace-shell\s*\{/);
  assert.match(css, /grid-template-columns:\s*340px minmax\(500px, 1fr\)/);
  assert.doesNotMatch(css, /\.workspace-shell\.has-review-panel/);
  assert.match(css, /@media \(max-width: 1199px\)/);
  assert.match(css, /@media \(max-width: 768px\)/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /\.topbar-actions\s*\{[^}]*display:\s*flex/s);
  assert.match(css, /\.tree-node-row\s*\{/);
  assert.match(css, /body\s*\{[^}]*color:\s*var\(--color-text\)/);
  assert.match(css, /\.tree-node-main\s*\{[^}]*color:\s*inherit/);
  assert.match(css, /\.node-menu-button\s*\{/);
  assert.match(css, /\.node-action-menu\s*\{/);
  assert.match(css, /\.node-action-menu-item\.is-destructive\s*\{/);
  assert.match(css, /\.node-action-menu-item:focus-visible/);
  assert.match(css, /\.workspace-review\s*\{[^}]*grid-template-rows:\s*auto minmax\(0, 1fr\) auto[^}]*overflow:\s*hidden/s);
  assert.match(css, /\.review-content\s*\{[^}]*overflow-y:\s*auto/s);
  assert.match(css, /\.review-publish-footer \.publish-button\s*\{[^}]*width:\s*100%[^}]*min-height:\s*44px/s);
  assert.doesNotMatch(css, /\.publish-button:not\(\[hidden\]\)\s*\{[^}]*position:\s*fixed/s);
});

test('keeps the sticky editor header compact on desktop and mobile', async () => {
  const css = await readFile(new URL('../public/app.css', import.meta.url), 'utf8');
  const html = renderWorkspace(workspaceFixture({ selectedClientId: 'ad-1' }));

  assert.match(html, /<header class="editor-header">[\s\S]*?class="breadcrumbs"[\s\S]*?class="editor-title-row"[\s\S]*?class="editor-header-action"[\s\S]*?data-action="progress-next"/);
  assert.match(css, /\.editor-header\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) auto[^}]*padding:\s*6px 20px/s);
  assert.match(css, /\.editor-title-row h1\s*\{[^}]*overflow:\s*hidden[^}]*text-overflow:\s*ellipsis[^}]*white-space:\s*nowrap/s);
  assert.match(css, /@media \(max-width: 768px\)\s*\{[\s\S]*?\.editor-header\s*\{[^}]*min-height:\s*44px[^}]*padding:\s*5px 12px/s);
  assert.match(css, /\.editor-header \.breadcrumbs,[\s\S]*?\.editor-title-row \.node-type-label\s*\{[^}]*display:\s*none/s);
});

test('keeps the editor action footer in the document flow so it never covers form content', async () => {
  const css = await readFile(new URL('../public/app.css', import.meta.url), 'utf8');

  assert.match(css, /\.editor-body\s*\{[^}]*padding:\s*24px 28px 16px/s);
  assert.match(css, /\.editor-progress-footer\s*\{[^}]*position:\s*static[^}]*width:\s*min\(100%, 960px\)[^}]*background:\s*transparent/s);
  assert.doesNotMatch(css, /\.editor-progress-footer\s*\{[^}]*position:\s*(?:fixed|sticky)/s);
  assert.match(css, /@media \(max-width: 768px\)\s*\{[\s\S]*?\.editor-progress-footer\s*\{[^}]*padding:\s*0 12px calc\(12px \+ env\(safe-area-inset-bottom\)\)/s);
});

test('provides keyboard skip navigation and a 44px control target', async () => {
  const [html, css] = await Promise.all([
    readFile(new URL('../public/index.html', import.meta.url), 'utf8'),
    readFile(new URL('../public/app.css', import.meta.url), 'utf8')
  ]);

  assert.match(html, /class="skip-link"/);
  assert.match(html, /href="#workspace"/);
  assert.match(css, /--control-height:\s*44px/);
});

test('shows loading feedback for account resources and targeting search', () => {
  const state = workspaceFixture({ selectedClientId: 'adset-1' });
  state.ui.loadingAccountResources = true;
  state.ui.loadingAccountId = 'act_1';
  state.ui.searchingTargeting = true;
  state.ui.searchingLocations = true;

  const adSetHtml = renderWorkspace(state);
  state.selection = { clientId: 'campaign-1', type: 'campaign' };
  const campaignHtml = renderWorkspace(state);

  assert.doesNotMatch(campaignHtml, /data-resource-combobox="pageId"[^>]*disabled/);
  assert.match(adSetHtml, /data-action="search-targeting"[^>]*disabled/);
  assert.match(adSetHtml, /data-action="search-location"[^>]*disabled/);
  assert.match(adSetHtml, /Đang tìm/);
});

test('explains that location results come from Meta Vietnam regions', () => {
  const html = renderWorkspace(workspaceFixture({ selectedClientId: 'adset-1' }));

  assert.match(html, /Tỉnh\/thành phố Việt Nam từ Meta/);
  assert.doesNotMatch(html, /data-field="countries"/);
});
