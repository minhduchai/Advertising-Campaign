import { activeCampaign, findNode, activateNode } from './state.js';
import { escapeHtml } from './workspace.js';
import { navigationGate, workspaceProgress } from './workspace-progress.js';

const sections = [
  { id: 'setup', label: 'Thiết lập', type: 'campaign' },
  { id: 'audience', label: 'Đối tượng', type: 'adSet' },
  { id: 'content', label: 'Nội dung', type: 'ad' },
  { id: 'message', label: 'Cuộc trò chuyện', type: 'ad' }
];
const paths = {
  home: '<path d="m3 10 9-7 9 7v10H3Z"/><path d="M9 20v-8h6v8"/>',
  library: '<path d="M5 3h14v17H5zM8 7h8M8 11h5"/>',
  cloud: '<path d="M6 18a4 4 0 1 1 0-8 6 6 0 0 1 11-3 5 5 0 0 1 1 10H6"/><path d="m9 12 2 2 4-4"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M15 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h3"/>',
  more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  chevron: '<path d="m9 6 6 6-6 6"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  check: '<path d="m5 12 4 4 10-10"/>',
  link: '<path d="m10 13 4-4M8 15l-2 2a4 4 0 0 1-5-5l4-4a4 4 0 0 1 6 0M16 9l2-2a4 4 0 0 1 5 5l-4 4a4 4 0 0 1-6 0"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5 9-5ZM3 12l9 5 9-5M3 16l9 5 9-5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  message: '<path d="M21 14a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4Z"/><path d="M8 8h8M8 12h5"/>',
  panel: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/>',
  arrow: '<path d="M19 12H5m5-5-5 5 5 5"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8" cy="9" r="1"/><path d="m21 15-6-5L4 20"/>'
};
const icon = (name) => `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name] ?? paths.layers}</svg>`;

export function launchSection(state) {
  const match = findNode(state, state.selection?.clientId);
  if (match?.type === 'ad') return state.ui.launchSections?.[match.node.clientId] ?? 'content';
  return match?.type === 'adSet' ? 'audience' : 'setup';
}

export function sectionTarget(state, id) {
  const section = sections.find((entry) => entry.id === id);
  if (!section) return null;
  const progress = workspaceProgress(state);
  const node = section.type === 'campaign' ? progress.campaign : section.type === 'adSet' ? progress.adSet : progress.ad;
  return node ? { ...section, clientId: node.clientId, allowed: navigationGate(state, node.clientId).allowed } : null;
}

export function setSection(state, id, clientId = state.selection?.clientId) {
  if (!['content', 'message'].includes(id)) return;
  state.ui.launchSections ??= {};
  state.ui.launchSections[clientId] = id;
}

export function revealField(state, clientId, field) {
  if (findNode(state, clientId)?.type === 'ad') {
    setSection(state, field.startsWith('conversation') ? 'message' : 'content', clientId);
  }
  state.ui.launchReadinessOpen = false;
  state.ui.launchRevealName = field === 'name' ? clientId : null;
}

export function launchSummary(state) {
  const progress = workspaceProgress(state);
  const campaigns = state.draft?.campaigns ?? [];
  const adSets = campaigns.flatMap((campaign) => campaign.adSets ?? []);
  const ads = adSets.flatMap((adSet) => adSet.ads ?? []);
  const complete = progress.allRequirements.filter((entry) => entry.complete).length;
  const total = progress.allRequirements.length;
  const budgets = new Map();
  for (const campaign of campaigns) {
    const currency = state.resources.adAccounts?.find((entry) => entry.id === campaign.adAccountId)?.currency ?? 'VND';
    const budget = campaign.budgetStrategy === 'CAMPAIGN'
      ? Number(campaign.dailyBudget) || 0
      : (campaign.adSets ?? []).reduce((sum, entry) => sum + (Number(entry.dailyBudget) || 0), 0);
    budgets.set(currency, (budgets.get(currency) ?? 0) + Math.max(0, budget));
  }
  return {
    progress,
    counts: { campaigns: campaigns.length, adSets: adSets.length, ads: ads.length },
    complete, total,
    percent: total ? Math.round(complete / total * 100) : 0,
    missing: progress.allRequirements.filter((entry) => !entry.complete),
    budgets: [...budgets].map(([currency, amount]) => ({ currency, amount })),
    mode: state.ui.localDemoResources ? 'demo' : state.connected ? 'live' : 'disconnected'
  };
}

export function initializeChrome() {
  document.title = 'Launch Control — Local · Dữ liệu Meta';
  document.body.classList.add('launch-app');
  const rail = document.createElement('aside');
  rail.className = 'nav-rail launch-nav-rail';
  rail.setAttribute('aria-label', 'Điều hướng chính');
  rail.innerHTML = `<a class="brand-button" href="/?frontend=launch-control&realResources=1" aria-label="Launch Control"><span class="brand-glyph">M</span><span class="brand-name">MCB</span></a>`;
  const nav = document.querySelector('#workspace-mode-nav');
  nav.classList.add('global-nav');
  nav.querySelectorAll('.workspace-mode-button').forEach((button) => button.classList.add('nav-item'));
  nav.querySelector('#open-campaign-workspace').insertAdjacentHTML('afterbegin', icon('layers'));
  nav.querySelector('#open-history-workspace').insertAdjacentHTML('afterbegin', icon('clock'));
  nav.querySelector('#open-campaign-workspace').insertAdjacentHTML('beforebegin', `<button type="button" class="nav-item" data-launch-utility="overview">${icon('home')}<span>Tổng quan</span></button>`);
  nav.querySelector('#open-history-workspace').insertAdjacentHTML('beforebegin', `<button type="button" class="workspace-mode-button nav-item" data-launch-seeding>${icon('message')}<span>Seeding</span></button>`);
  nav.insertAdjacentHTML('beforeend', `<button type="button" class="nav-item" data-launch-utility="library">${icon('library')}<span>Thư viện</span></button>`);
  rail.append(nav);
  rail.insertAdjacentHTML('beforeend', '<div class="rail-footer"><a class="launch-return-link" href="/" title="Về giao diện hiện tại">Bản hiện tại</a><button type="button" class="help-avatar" data-launch-connect aria-label="Tài khoản Meta" data-launch-avatar>M</button></div>');
  document.body.prepend(rail);
  const brand = document.querySelector('.topbar-brand');
  brand.className = 'topbar-context';
  brand.querySelector('.brand-mark')?.remove();
  brand.querySelector('#toggle-tree').className = 'icon-button mobile-tree-toggle';
  brand.querySelector('.brand-copy').innerHTML = '<p class="eyebrow" data-launch-context>Bàn điều khiển phát hành</p><h1 data-launch-title>Xây chiến dịch</h1>';
  brand.insertAdjacentHTML('beforeend', '<span class="workspace-chip launch-preview-badge">Local</span>');
  const actions = document.querySelector('.topbar-actions');
  const connect = actions.querySelector('.connection-account-control');
  const theme = actions.querySelector('#toggle-theme');
  theme.classList.add('icon-button');
  connect.querySelector('button').classList.add('connection-chip');
  actions.prepend(connect);
  connect.after(theme);
  actions.insertAdjacentHTML('afterbegin', `<div class="save-state launch-save" role="status">${icon('cloud')}<span><strong data-launch-save-label>Bản nháp local</strong><small data-launch-save-detail>Trên máy của anh</small></span></div>`);
  actions.insertAdjacentHTML('beforeend', `<button type="button" class="icon-button launch-summary-toggle" data-launch-toggle-summary aria-controls="launch-readiness-panel" aria-expanded="false" aria-label="Mở trạng thái thiết lập">${icon('panel')}</button><button type="button" class="button-primary publish-action launch-check" data-launch-check disabled><span>Kiểm tra &amp; tạo</span><span class="button-count">0</span></button>`);
  document.querySelector('#workspace').classList.add('studio-shell');
}

export function applyEntrySection(state, search) {
  const id = new URLSearchParams(search).get('section');
  const target = sectionTarget(state, id);
  if (!target) return;
  activateNode(state, target.clientId);
  setSection(state, id, target.clientId);
  state.ui.activeWorkspace = 'campaign';
}

export function updateSaveStatus(saved) {
  const label = document.querySelector('[data-launch-save-label]');
  const detail = document.querySelector('[data-launch-save-detail]');
  if (!label) return;
  label.textContent = saved ? 'Đã tự lưu' : 'Chưa lưu local';
  detail.textContent = saved ? 'Trên trình duyệt này' : 'Giữ tab để không mất bản nháp';
  label.closest('.launch-save').classList.toggle('is-unsaved', !saved);
}

export function decorateTree(tree, state) {
  if (!tree || tree.querySelector('.launch-tree-head')) return;
  tree.classList.add('blueprint-panel');
  const summary = launchSummary(state);
  const head = document.createElement('div');
  head.className = 'launch-tree-head';
  head.innerHTML = `<div class="panel-heading"><div><p class="eyebrow">Blueprint</p><h2>Cấu trúc</h2></div><button type="button" class="icon-button small add-button" data-action="add-campaign" aria-label="Thêm chiến dịch">${icon('plus')}</button></div>
    <label class="search-box">${icon('search')}<input type="search" data-launch-tree-search aria-label="Tìm chiến dịch, nhóm hoặc quảng cáo" placeholder="Tìm campaign, ad set, ad…" autocomplete="off" value="${escapeHtml(state.ui.launchTreeQuery ?? '')}"><kbd>⌘ K</kbd></label>
    <div class="blueprint-summary" aria-label="Tổng quan cấu trúc"><div><strong>${summary.counts.campaigns}</strong><span>Campaign</span></div><div><strong>${summary.counts.adSets}</strong><span>Ad set</span></div><div><strong>${summary.counts.ads}</strong><span>Ads</span></div></div>`;
  tree.querySelector('.tree-header')?.remove();
  tree.querySelector('.tree-footer')?.remove();
  tree.prepend(head);
  tree.querySelector('.tree-list')?.classList.add('campaign-tree');
  for (const row of tree.querySelectorAll('[data-node-id]')) {
    const match = findNode(state, row.dataset.nodeId);
    if (!match) continue;
    const { node, type, campaign } = match;
    row.classList.remove('is-progress-locked');
    const main = row.querySelector('.tree-node-main');
    main.removeAttribute('aria-label');
    main.dataset.progressLocked = 'false';
    row.querySelector('.tree-progress-lock')?.remove();
    const missing = summary.progress.allRequirements.filter((entry) => entry.clientId === node.clientId && !entry.complete).length;
    row.classList.toggle('is-complete', !missing);
    let meta;
    if (type === 'campaign') {
      row.querySelector('.node-mark').innerHTML = icon('layers');
      const currency = state.resources.adAccounts?.find((entry) => entry.id === campaign.adAccountId)?.currency ?? 'VND';
      const budget = campaign.budgetStrategy === 'CAMPAIGN' ? Number(campaign.dailyBudget) || 0 : campaign.adSets.reduce((sum, group) => sum + (Number(group.dailyBudget) || 0), 0);
      meta = `${budget.toLocaleString('vi-VN')} ${currency === 'VND' ? '₫' : currency} / ngày`;
    } else if (type === 'adSet') {
      const regions = (node.includedRegions ?? []).map((entry) => entry.name || entry.label).filter(Boolean);
      meta = `${regions.join(' + ') || 'Chưa chọn vị trí'} · ${node.ageMin}–${node.ageMax}`;
    } else meta = `${node.mediaKind === 'video' ? 'Video' : 'Ảnh'} · Messenger`;
    row.querySelector('.node-copy small').textContent = meta;
    if (type !== 'ad' || missing) row.querySelector('.node-menu-button').insertAdjacentHTML('beforebegin', `<span class="launch-node-status${missing ? '' : ' is-complete'}" title="${missing ? missing + ' mục cần hoàn thành' : 'Thông tin đã đầy đủ'}">${missing || 'Ổn'}</span>`);
    if (type === 'adSet') {
      const leaves = row.parentElement.querySelector(':scope > .tree-children');
      leaves?.insertAdjacentHTML('beforeend', `<button type="button" class="launch-add-ad" data-action="add-ad" data-client-id="${escapeHtml(node.clientId)}">${icon('plus')}Thêm quảng cáo</button>`);
    }
  }
  tree.insertAdjacentHTML('beforeend', `<div class="panel-footer"><button type="button" class="button-secondary full-width" data-action="add-campaign">${icon('plus')}Thêm Campaign</button></div>`);
  filterTree(tree, state.ui.launchTreeQuery);
}

export function filterTree(tree, query = '') {
  const normalize = (text) => String(text ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').toLowerCase();
  const needle = normalize(query).trim();
  for (const group of [...tree.querySelectorAll('.tree-group')].reverse()) {
    const ownName = group.querySelector(':scope > .tree-node-row .node-copy strong')?.textContent ?? '';
    const matchingChild = [...group.querySelectorAll('.tree-group')].some((child) => !child.hidden);
    const matchingAd = [...group.querySelectorAll('.tree-node-ad .node-copy strong')].some((entry) => normalize(entry.textContent).includes(needle));
    group.hidden = Boolean(needle) && !normalize(ownName).includes(needle) && !matchingChild && !matchingAd;
  }
}

export function decorateWorkspace(workspace, state) {
  decorateTree(workspace.querySelector('.workspace-tree'), state);
  const editor = workspace.querySelector('.workspace-editor');
  const body = editor?.querySelector('.editor-body');
  if (!body) return;
  const match = findNode(state, state.selection?.clientId);
  if (!match) return;
  const current = launchSection(state);
  const nextButton = editor.querySelector('[data-action="progress-next"], [data-action="publish-draft"]');
  editor.className = 'editor-panel launch-editor';
  editor.querySelector('.editor-header').outerHTML = renderEntityHeader(state, match);
  const nav = document.createElement('nav');
  nav.className = 'section-tabs launch-section-nav';
  nav.setAttribute('aria-label', 'Các phần thiết lập');
  nav.innerHTML = sections.map((entry, index) => `<button type="button" data-action="launch-section" data-launch-section="${entry.id}" ${sectionTarget(state, entry.id) ? '' : 'disabled'}><span class="tab-index">${index + 1}</span><span>${entry.label}</span><span class="tab-status" data-launch-step-status="${entry.id}"></span></button>`).join('');
  editor.querySelector('.entity-header').after(nav);
  const scroll = document.createElement('div');
  scroll.className = 'editor-scroll workspace-editor';
  body.before(scroll);
  scroll.append(body);
  body.classList.add('editor-content');
  body.dataset.launchSection = current;
  body.querySelectorAll('.field').forEach((field) => field.classList.add('field-group'));
  body.querySelectorAll(':scope > .editor-section').forEach((card) => card.classList.add('form-card'));
  if (match.type === 'ad') {
    const cards = [...body.querySelectorAll(':scope > .editor-section')];
    const identity = cards.find((card) => card.querySelector('[data-field="name"]'));
    const creative = cards.find((card) => card.querySelector('[data-field="primaryText"]'));
    const conversation = cards.find((card) => card.querySelector('[data-conversation-field]'));
    if (identity) {
      const details = document.createElement('details');
      details.className = 'launch-identity';
      details.innerHTML = '<summary>Tên quảng cáo &amp; Page<span>Chỉnh sửa</span></summary>';
      identity.before(details);
      details.append(identity);
      details.hidden = current === 'message';
      details.open = state.ui.launchRevealName === match.node.clientId;
    }
    if (creative) {
      creative.hidden = current === 'message';
      const heading = creative.querySelector('.section-heading');
      heading.classList.add('card-heading');
      heading.innerHTML = `<div><p class="eyebrow">Creative</p><h3>Nội dung quảng cáo</h3><p>Chọn media và hoàn thiện phần khách hàng nhìn thấy trên Facebook.</p></div><span class="completion-chip" data-launch-creative-completion></span>`;
      creative.querySelector('.section-content').style.paddingTop = '0';
      const media = creative.querySelector('.media-uploader-shell');
      media.insertAdjacentHTML('afterbegin', '<span class="field-label">Ảnh / video quảng cáo <b>*</b></span>');
      const layout = creative.querySelector('.creative-layout');
      layout.prepend(media);
      const fields = creative.querySelector('.creative-copy-fields');
      fields.classList.add('fields-column');
      const primaryLabel = fields.querySelector('textarea').closest('.field');
      primaryLabel.querySelector('span').innerHTML = 'Văn bản chính <b>*</b><small data-launch-text-count></small>';
      primaryLabel.insertAdjacentHTML('beforeend', '<small class="helper-text">Dòng đầu nên nêu rõ ưu đãi quan trọng nhất.</small>');
      fields.querySelector('[data-field="headline"]').closest('.field').querySelector('span').innerHTML = 'Tiêu đề <b>*</b>';
      fields.insertAdjacentHTML('beforeend', `<div class="field-group"><span class="field-label">Hình thức bài viết</span><div class="select-control" aria-label="Bài quảng cáo ẩn, không đăng lên dòng thời gian Page"><span class="select-icon">${icon('lock')}</span><span><strong>Bài quảng cáo ẩn</strong><small>Không đăng lên dòng thời gian Page</small></span>${icon('chevron')}</div></div>`);
      const template = state.resources.conversationTemplates?.find((entry) => entry.id === match.node.conversation?.sourceTemplateId);
      const note = document.createElement('section');
      note.className = 'context-note';
      note.setAttribute('aria-label', 'Thông tin mẫu');
      note.innerHTML = `<span class="note-icon">${icon('library')}</span><div><strong>${template ? 'Đang dùng mẫu “' + escapeHtml(template.name) + '”' : 'Nội dung riêng của quảng cáo này'}</strong><p>Nội dung được lưu riêng cho quảng cáo này. Thay đổi thư viện không làm mất bản đang soạn.</p></div><button type="button" data-action="launch-section" data-launch-section="message">${template ? 'Đổi mẫu' : 'Chọn mẫu'}</button>`;
      if (current === 'content') body.prepend(note);
    }
    if (conversation) {
      conversation.hidden = current !== 'message';
      conversation.querySelector('.section-heading')?.insertAdjacentHTML('afterbegin', '<p class="eyebrow">Messenger</p>');
    }
    if (current === 'content') {
      body.insertAdjacentHTML('beforeend', renderMessageSummary(match.node));
    }
  } else {
    for (const card of body.querySelectorAll('.form-card')) {
      const heading = card.querySelector('.section-heading');
      if (heading) heading.insertAdjacentHTML('afterbegin', `<p class="eyebrow">${match.type === 'campaign' ? 'Campaign' : 'Audience'}</p>`);
    }
  }
  if (!state.connected && !state.ui.localDemoResources && current === 'setup') {
    body.insertAdjacentHTML('afterbegin', `<section class="context-note launch-connection-note"><span class="note-icon">${icon('cloud')}</span><div><strong>Kết nối Meta để tải dữ liệu thật</strong><p>Tài khoản quảng cáo, Page và thư viện mẫu từ phiên Meta của anh.</p></div><button type="button" data-launch-connect>Kết nối Meta</button></section>`);
  }
  if (nextButton) {
    const footer = document.createElement('div');
    footer.className = 'launch-editor-footer';
    nextButton.className = 'button-secondary compact';
    footer.append(nextButton);
    body.append(footer);
  }
  workspace.insertAdjacentHTML('beforeend', `<aside id="launch-readiness-panel" class="readiness-panel launch-readiness${state.ui.launchReadinessOpen ? ' is-open' : ''}" aria-label="Trạng thái thiết lập"><div class="readiness-scroll"><div data-launch-readiness-copy></div><section class="ad-preview-card"><div class="section-heading-row"><h3>Xem trước quảng cáo</h3><button type="button" data-launch-preview-expand aria-label="Phóng to xem trước quảng cáo">${icon('panel')}</button></div><div class="social-preview"><div class="social-header"><span class="page-avatar" data-launch-page-avatar>M</span><span><strong data-launch-preview-page></strong><small>Được tài trợ · Facebook</small></span>${icon('more')}</div><p data-launch-preview-text></p><div data-launch-preview-media></div><div class="social-cta"><span><strong data-launch-preview-headline></strong></span><span class="launch-social-cta-label">Gửi tin nhắn</span></div></div></section></div></aside><button type="button" class="launch-summary-scrim" data-launch-toggle-summary aria-label="Đóng trạng thái thiết lập" ${state.ui.launchReadinessOpen ? '' : 'hidden'}></button>`);
  refresh(workspace, state);
}

function renderEntityHeader(state, match) {
  const labels = { campaign: 'Chiến dịch', adSet: 'Nhóm quảng cáo', ad: 'Quảng cáo' };
  const path = [match.campaign, ...(match.type !== 'campaign' ? [match.adSet] : []), ...(match.type === 'ad' ? [match.node] : [])].filter(Boolean);
  const subtitle = match.type === 'ad' ? `Quảng cáo ${match.node.mediaKind === 'video' ? 'video' : 'ảnh'} · Messenger · Bài quảng cáo ẩn` : match.type === 'campaign' ? 'Lượt tương tác · Đấu giá · Messenger' : 'Nhóm quảng cáo · Đối tượng & ngân sách';
  const duplicateAction = { campaign: 'duplicate-campaign', adSet: 'duplicate-adset', ad: 'duplicate-ad' }[match.type];
  return `<header class="entity-header editor-header"><nav class="breadcrumbs" aria-label="Đường dẫn">${path.map((node, i) => `<button type="button" data-action="select-node" data-client-id="${escapeHtml(node.clientId)}">${escapeHtml(node.name || ['Chiến dịch', 'Nhóm quảng cáo', 'Quảng cáo'][i])}</button>`).join(icon('chevron'))}</nav><div class="entity-title-row editor-title-row"><div class="entity-title"><span class="entity-icon">${icon(match.type === 'ad' ? 'message' : 'layers')}</span><div><div class="title-line"><h1 data-launch-entity-name>${escapeHtml(match.node.name || labels[match.type])}</h1><span class="status-badge neutral">Bản nháp</span></div><p>${subtitle}</p></div></div><div class="entity-actions"><button type="button" class="button-secondary compact" data-action="${duplicateAction}" data-client-id="${escapeHtml(match.node.clientId)}">${icon('copy')}<span>Nhân bản</span></button><button type="button" class="icon-button" data-launch-rename aria-label="Chỉnh sửa tên">${icon('more')}</button></div></div></header>`;
}

function renderMessageSummary(ad) {
  const actions = ad.conversation?.customerActions ?? [];
  const invalid = actions.filter((action) => !/^https:\/\//i.test(action.value || '') || !action.label?.trim()).length;
  return `<section class="form-card compact-card launch-message-shortcut"><div class="card-heading inline"><div><p class="eyebrow">Messenger</p><h3>Hành động &amp; cuộc trò chuyện</h3><p>Nội dung chào và các nút khách hàng nhìn thấy sau khi mở Messenger.</p></div><button type="button" class="button-secondary compact" data-action="launch-section" data-launch-section="message">Mở trình soạn ${icon('chevron')}</button></div><div class="message-summary"><div><span class="summary-icon">${icon('message')}</span><span><small>Tin nhắn chào</small><strong data-launch-greeting>${escapeHtml(ad.conversation?.greeting || 'Chưa có lời chào')}</strong></span></div><div><span class="summary-icon">${icon('link')}</span><span><small>Nút hành động</small><strong>${actions.length} nút${invalid ? ' · ' + invalid + ' cần sửa' : ''}</strong></span>${invalid ? '<span class="status-badge danger">Cần sửa</span>' : ''}</div></div></section>`;
}

export function renderReadiness(state) {
  const summary = launchSummary(state);
  const { complete, total, percent, missing, counts } = summary;
  const money = summary.budgets.map(({ currency, amount }) => `${amount.toLocaleString('vi-VN')} ${currency === 'VND' ? '₫' : escapeHtml(currency)}`).join(' + ');
  const issue = (entry) => `<button type="button" class="issue-card warning" data-action="progress-requirement" data-client-id="${escapeHtml(entry.clientId)}" data-validation-field="${escapeHtml(entry.field)}"><span class="issue-icon">${icon(entry.field.startsWith('conversation') ? 'link' : 'layers')}</span><span><strong>${escapeHtml(entry.label)}</strong><small>${escapeHtml(findNode(state, entry.clientId)?.node.name || 'Chưa đặt tên')} · Cần hoàn thành</small></span><span class="row-chevron">${icon('chevron')}</span></button>`;
  return `<section class="readiness-overview"><div class="panel-heading"><div><p class="eyebrow">Launch readiness</p><h2>Sẵn sàng phát hành</h2></div><button type="button" class="icon-button small launch-readiness-close" data-launch-toggle-summary aria-label="Thu gọn trạng thái thiết lập">${icon('panel')}</button></div><div class="score-row"><div class="launch-score-ring" style="--launch-score:${percent}%" role="progressbar" aria-label="Mức hoàn thiện biểu mẫu" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent}"><strong>${percent}%</strong></div><div class="score-copy"><strong>${summary.progress.formComplete ? 'Đã điền đủ thông tin' : percent >= 80 ? 'Gần hoàn tất' : 'Đang hoàn thiện'}</strong><span>${complete} mục đạt · ${total - complete} mục cần xử lý</span></div></div></section>
    <section class="issues-section"><div class="section-heading-row"><h3>${missing.length ? 'Cần xử lý' : 'Thông tin đã đầy đủ'}</h3><span>${missing.length || '✓'}</span></div><div class="launch-missing-list">${missing.slice(0, 2).map(issue).join('')}</div>${missing.length > 2 ? `<details class="launch-more-issues"><summary>Xem thêm ${missing.length - 2} mục</summary><div class="launch-missing-list">${missing.slice(2).map(issue).join('')}</div></details>` : ''}</section>
    ${summary.progress.reviewActive && state.issues?.length ? `<div class="launch-server-errors" role="status"><strong>Kiểm tra chưa đạt</strong>${state.issues.map((entry) => `<p>${escapeHtml(entry.message)}</p>`).join('')}</div>` : ''}
    <section class="launch-summary"><div class="section-heading-row"><h3>Lượt tạo này</h3><button type="button" data-launch-utility="overview">Chi tiết</button></div><dl><div><dt>Cấu trúc</dt><dd>${counts.campaigns} Campaign · ${counts.adSets} Ad set · ${counts.ads} Ads</dd></div><div><dt>Ngân sách/ngày</dt><dd class="tabular">${money || 'Chưa có ngân sách'}</dd></div><div><dt>Trạng thái sau tạo</dt><dd><span class="status-dot"></span>ACTIVE</dd></div></dl></section>`;
}

export function safePreviewUrl(value) {
  const text = String(value ?? '');
  if (/^\/api\/media\//.test(text)) return text;
  try {
    const url = new URL(text);
    return ['https:', 'blob:'].includes(url.protocol) ? text : '';
  } catch { return ''; }
}

export function renderUtility(state, kind) {
  const summary = launchSummary(state);
  const library = kind === 'library';
  const ready = state.connected || state.ui.localDemoResources;
  const group = (title, entries, section, error) => `<section class="form-card"><div class="section-heading-row"><h3>${title}</h3><button type="button" data-launch-library-section="${section}">Mở trình chỉnh sửa</button></div>${error ? `<p role="status">${escapeHtml(error)}</p>` : entries?.length ? entries.map((entry) => `<div class="launch-library-row"><strong>${escapeHtml(entry.name || 'Chưa đặt tên')}</strong><span>${escapeHtml(entry.description || '')}</span></div>`).join('') : `<p>${ready ? 'Chưa có mẫu hoặc tài nguyên chưa tải. Mở trình chỉnh sửa để tải và quản lý.' : 'Kết nối Meta để tải thư viện của anh.'}</p>`}</section>`;
  return `<section class="launch-utility" aria-label="${library ? 'Thư viện mẫu' : 'Tổng quan bản nháp'}"><div class="launch-utility-content"><header class="launch-utility-header"><div><p class="eyebrow">Launch Control · Local</p><h2 tabindex="-1">${library ? 'Thư viện của anh' : 'Tổng quan bản nháp'}</h2></div><button type="button" class="button-secondary" data-launch-close-utility>Về chiến dịch</button></header>
    ${!ready ? '<section class="context-note"><div><strong>Chưa kết nối Meta</strong><p>Chỉ hiển thị dữ liệu thực của phiên này, không dùng số liệu minh họa.</p></div><button type="button" data-launch-connect>Kết nối Meta</button></section>' : ''}
    ${library ? group('Cấu hình chiến dịch', state.resources.campaignPresets, 'setup', state.resources.campaignPresetsError) + group('Mẫu cuộc trò chuyện', state.resources.conversationTemplates, 'message', state.resources.conversationTemplatesError) + group('Mẫu seeding', state.resources.seedingTemplates, 'setup', state.resources.seedingTemplatesError) + group('Mẫu đối tượng', state.resources.audienceTemplates, 'audience', state.resources.audienceTemplatesError)
      : `<div class="launch-utility-grid">${[['Campaign', summary.counts.campaigns], ['Nhóm quảng cáo', summary.counts.adSets], ['Quảng cáo', summary.counts.ads]].map(([label, value]) => `<section class="form-card"><strong class="big-value">${value}</strong><p>${label} trong bản nháp</p></section>`).join('')}</div><section class="form-card"><h3>Tài nguyên Meta</h3><p>${state.resources.adAccounts?.length ?? 0} tài khoản quảng cáo · ${state.resources.pages?.length ?? 0} Facebook Page đang tải trong phiên.</p><p>${summary.complete}/${summary.total} mục thiết lập đã hoàn thành. Đây là bản nháp local, không phải báo cáo chiến dịch đang chạy trên Meta.</p></section>`}
  </div></section>`;
}

export function openUtility(workspace, state, kind) {
  closeUtility(workspace, state);
  workspace.insertAdjacentHTML('beforeend', renderUtility(state, kind));
  document.querySelectorAll('.global-nav .nav-item').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.launchUtility === kind);
    button.setAttribute('aria-pressed', String(button.dataset.launchUtility === kind));
  });
  workspace.querySelector('.launch-utility h2')?.focus();
}

export function closeUtility(workspace, state) {
  workspace.querySelector('.launch-utility')?.remove();
  document.querySelectorAll('[data-launch-utility]').forEach((button) => {
    button.classList.remove('is-active');
    button.setAttribute('aria-pressed', 'false');
  });
  refresh(workspace, state);
}

export function openPreview(workspace) {
  document.querySelector('.launch-preview-dialog')?.remove();
  const preview = workspace.querySelector('.social-preview');
  if (!preview) return;
  const dialog = document.createElement('dialog');
  dialog.className = 'launch-preview-dialog';
  dialog.setAttribute('aria-label', 'Xem trước quảng cáo đang soạn');
  dialog.innerHTML = '<form method="dialog"><div class="section-heading-row"><h3>Xem trước quảng cáo</h3><button type="submit" class="button-secondary compact">Đóng</button></div></form>';
  dialog.append(preview.cloneNode(true));
  document.body.append(dialog);
  dialog.addEventListener('close', () => dialog.remove(), { once: true });
  dialog.showModal();
}

export function refresh(workspace, state) {
  const summary = launchSummary(state);
  const section = launchSection(state);
  const copy = workspace.querySelector('[data-launch-readiness-copy]');
  if (copy) {
    const html = renderReadiness(state);
    if (copy._launchHtml !== html) {
      const open = copy.querySelector('details')?.open ?? false;
      copy.innerHTML = html;
      if (copy.querySelector('details')) copy.querySelector('details').open = open;
      copy._launchHtml = html;
    }
  }
  for (const button of workspace.querySelectorAll('[data-launch-section]')) {
    const id = button.dataset.launchSection;
    const active = id === section;
    button.classList.toggle('is-active', active);
    active ? button.setAttribute('aria-current', 'step') : button.removeAttribute('aria-current');
    const target = sectionTarget(state, id);
    const requirements = summary.progress.allRequirements.filter((entry) => entry.clientId === target?.clientId
      && (id !== 'content' && id !== 'message' || (id === 'message') === entry.field.startsWith('conversation')));
    const missing = requirements.filter((entry) => !entry.complete).length;
    const status = button.querySelector('[data-launch-step-status]');
    if (status) {
      status.textContent = active ? 'Đang sửa' : requirements.length && !missing ? '✓' : missing ? missing + ' mục' : '';
      status.hidden = !status.textContent;
      status.classList.toggle('warning-text', !active && missing > 0);
    }
  }
  const campaign = activeCampaign(state);
  const ad = summary.progress.ad;
  const page = state.resources.pages?.find((entry) => entry.id === campaign?.pageId);
  const write = (selector, value) => { const node = workspace.querySelector(selector); if (node) node.textContent = value; };
  write('[data-launch-preview-page]', page?.name || 'Facebook Page của anh');
  write('[data-launch-preview-text]', ad?.primaryText || 'Nội dung quảng cáo sẽ hiển thị tại đây.');
  write('[data-launch-preview-headline]', ad?.headline || 'Tiêu đề quảng cáo');
  write('[data-launch-page-avatar]', (page?.name || 'M').slice(0, 1).toUpperCase());
  write('[data-launch-text-count]', ad?.primaryText?.length ? ad.primaryText.length + ' ký tự' : '');
  const creativeDone = ['mediaId', 'primaryText', 'headline'].filter((field) => ad?.[field]).length;
  write('[data-launch-creative-completion]', `${creativeDone}/3 trường`);
  const selected = findNode(state, state.selection?.clientId);
  write('[data-launch-entity-name]', selected?.node.name || ({ campaign: 'Chiến dịch', adSet: 'Nhóm quảng cáo', ad: 'Quảng cáo' }[selected?.type]) || '');
  const avatar = document.querySelector('[data-launch-avatar]');
  if (avatar) {
    avatar.textContent = (state.metaUser?.name || 'M').split(' ').filter(Boolean).slice(-2).map((part) => part[0]).join('').toUpperCase();
    avatar.title = state.metaUser?.name || 'Kết nối Meta';
  }
  workspace.querySelectorAll('[data-node-id]').forEach((row) => {
    const node = findNode(state, row.dataset.nodeId);
    const name = row.querySelector('.node-copy strong');
    if (name && node?.node.name) { name.textContent = node.node.name; name.title = node.node.name; }
  });
  const media = workspace.querySelector('[data-launch-preview-media]');
  const previewUrl = safePreviewUrl(ad?.mediaPreviewUrl);
  const mediaKey = `${ad?.mediaKind}:${previewUrl}`;
  if (media && media.dataset.mediaKey !== mediaKey) {
    media.dataset.mediaKey = mediaKey;
    media.innerHTML = previewUrl ? ad.mediaKind === 'video'
      ? `<video src="${escapeHtml(previewUrl)}" controls preload="metadata" aria-label="Video quảng cáo đang soạn"></video>`
      : `<img src="${escapeHtml(previewUrl)}" alt="Ảnh quảng cáo đang soạn">`
      : `<div class="launch-preview-empty">${icon('image')}<span>Ảnh hoặc video của anh</span></div>`;
  }
  const activeWorkspace = state.ui.activeWorkspace ?? 'campaign';
  const check = document.querySelector('[data-launch-check]');
  if (check) {
    check.hidden = activeWorkspace !== 'campaign';
    check.disabled = state.running || (!state.connected && !state.ui.localDemoResources);
    check.innerHTML = `<span>${state.running ? 'Đang xử lý…' : summary.progress.reviewComplete ? 'Tạo quảng cáo' : 'Kiểm tra &amp; tạo'}</span><span class="button-count">${summary.counts.ads}</span>`;
  }
  const toggle = document.querySelector('.topbar [data-launch-toggle-summary]');
  if (toggle) {
    toggle.hidden = activeWorkspace !== 'campaign';
    toggle.setAttribute('aria-expanded', String(Boolean(state.ui.launchReadinessOpen)));
  }
  const badge = document.querySelector('.launch-preview-badge');
  if (badge) badge.textContent = `${summary.counts.ads} quảng cáo · ${summary.mode === 'demo' ? 'Demo' : 'Local'}`;
  const seedButton = document.querySelector('[data-launch-seeding]');
  seedButton?.classList.toggle('is-active', activeWorkspace === 'seeding');
  seedButton?.setAttribute('aria-pressed', String(activeWorkspace === 'seeding'));
  document.querySelector('#open-campaign-workspace')?.classList.toggle('is-active', activeWorkspace === 'campaign');
}
