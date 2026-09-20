import { activeCampaign } from './state.js';
import { escapeHtml, renderMediaUploader } from './workspace.js';
import { workspaceProgress } from './workspace-progress.js';

const ctx = (state) => {
  const campaign = activeCampaign(state) ?? state.draft?.campaigns?.[0];
  const adSet = campaign?.adSets?.[0];
  return { campaign, adSet, ad: adSet?.ads?.[0] };
};

export function applyEntryMode(state, search) {
  state.ui.launchMode = new URLSearchParams(search).get('mode') === 'quick' ? 'quick' : (state.ui.launchMode ?? 'detail');
}

export function quickProfile(state) {
  const { campaign, adSet } = ctx(state);
  const presetId = campaign && state.ui?.campaignPresetSelectionByCampaignId?.[campaign.clientId];
  const preset = (state.resources?.campaignPresets ?? []).find((entry) => entry.id === presetId);
  const account = (state.resources?.adAccounts ?? []).find((entry) => entry.id === campaign?.adAccountId);
  const page = (state.resources?.pages ?? []).find((entry) => entry.id === campaign?.pageId);
  const budget = campaign?.budgetStrategy === 'CAMPAIGN' ? campaign?.dailyBudget : adSet?.dailyBudget;
  const missing = [!preset && 'cấu hình dùng lại', !campaign?.adAccountId && 'tài khoản quảng cáo', !campaign?.pageId && 'Facebook Page', !(Number(budget) > 0) && 'ngân sách', !(adSet?.locations?.length || adSet?.customLocations?.length) && 'khu vực'].filter(Boolean);
  return { campaign, adSet, preset, account, page, budget, missing };
}

const money = (value, currency = 'VND') => Number(value) > 0
  ? `${Number(value).toLocaleString('vi-VN')} ${currency === 'VND' ? '₫' : currency}` : 'Chưa đặt';

function setupCard(state, p) {
  const presets = state.resources?.campaignPresets ?? [];
  if (!presets.length) return `<section class="quick-setup-card is-warning"><div><span class="quick-status-dot"></span><div><strong>Chưa có cấu hình dùng lại</strong><p>Thiết lập tài khoản, Page, ngân sách và đối tượng một lần trong chế độ chi tiết.</p></div></div><button type="button" class="button-secondary compact" data-quick-mode="detail" data-quick-section="setup">Thiết lập ngay</button></section>`;
  return `<section class="quick-profile-card"><div class="quick-profile-head"><div><p class="eyebrow">Cấu hình dùng lại</p><h2>${escapeHtml(p.preset?.name || 'Chọn cấu hình')}</h2></div><button type="button" class="button-secondary compact" data-quick-mode="detail" data-quick-section="setup">Chỉnh sửa</button></div>
    <div class="quick-preset-list">${presets.map((preset) => `<button type="button" class="quick-preset${p.preset?.id === preset.id ? ' is-selected' : ''}" data-action="apply-campaign-preset" data-client-id="${escapeHtml(p.campaign.clientId)}" data-preset-id="${escapeHtml(preset.id)}"><span>${p.preset?.id === preset.id ? '✓' : ''}</span><strong>${escapeHtml(preset.name)}</strong><small>${p.preset?.id === preset.id ? 'Đang dùng' : 'Áp dụng'}</small></button>`).join('')}</div>
    <dl class="quick-profile-summary"><div><dt>Tài khoản</dt><dd>${escapeHtml(p.account?.name || p.campaign.adAccountId || 'Chưa chọn')}</dd></div><div><dt>Page</dt><dd>${escapeHtml(p.page?.name || p.campaign.pageId || 'Chưa chọn')}</dd></div><div><dt>Ngân sách/ngày</dt><dd>${escapeHtml(money(p.budget, p.account?.currency))}</dd></div><div><dt>Đối tượng</dt><dd>${escapeHtml(p.adSet?.audienceTemplateName || 'Thiết lập riêng')}</dd></div></dl>
    <div class="${p.missing.length ? 'quick-profile-warning' : 'quick-profile-ready'}"><strong>${p.missing.length ? `Còn thiếu ${p.missing.length} mục` : '✓ Cấu hình đã sẵn sàng'}</strong><span>${p.missing.length ? escapeHtml(p.missing.join(', ')) : 'Anh chỉ cần thay media và nội dung.'}</span></div></section>`;
}

function preview(ad, pageName) {
  const url = String(ad?.mediaPreviewUrl ?? '');
  const safe = /^\/api\/media\//.test(url) || /^(https:|blob:)/.test(url) ? url : '';
  const media = safe ? (ad.mediaKind === 'video' ? `<video src="${escapeHtml(safe)}" controls playsinline></video>` : `<img src="${escapeHtml(safe)}" alt="Xem trước nội dung quảng cáo">`) : '<div class="quick-preview-empty">Ảnh hoặc video sẽ hiện ở đây</div>';
  return `<aside class="quick-preview-card"><div class="quick-preview-label"><span>Xem trước</span><small>Facebook Feed</small></div><article class="quick-social-card"><header><span class="quick-avatar">${escapeHtml((pageName || 'M')[0].toUpperCase())}</span><span><strong>${escapeHtml(pageName || 'Facebook Page')}</strong><small>Được tài trợ · 🌐</small></span><b>•••</b></header><p data-quick-preview-text>${escapeHtml(ad.primaryText || 'Nội dung quảng cáo sẽ hiển thị tại đây.')}</p><div class="quick-preview-media">${media}</div><footer><span><small>MESSENGER</small><strong data-quick-preview-headline>${escapeHtml(ad.headline || 'Tiêu đề quảng cáo')}</strong></span><button type="button" tabindex="-1">Gửi tin nhắn</button></footer></article><p class="quick-preview-note">Bản xem trước mang tính minh họa.</p></aside>`;
}

export function renderQuickWorkspace(state) {
  const { campaign, adSet, ad } = ctx(state);
  if (!campaign || !adSet || !ad) return '<section class="quick-empty"><h1>Chưa có cấu trúc quảng cáo</h1><button type="button" class="button-primary" data-quick-mode="detail">Mở thiết lập chi tiết</button></section>';
  const p = quickProfile(state);
  const missing = workspaceProgress(state).allRequirements.filter((entry) => !entry.complete);
  const contentMissing = [!ad.mediaId && 'media', !ad.primaryText?.trim() && 'văn bản chính', !ad.headline?.trim() && 'tiêu đề'].filter(Boolean);
  return `<section class="quick-create-workspace"><header class="quick-create-header"><div><p class="eyebrow">Launch Control</p><h1>Tạo quảng cáo nhanh</h1><p>Dùng lại thiết lập chuẩn, chỉ thay nội dung cho lượt chạy này.</p></div><div class="quick-mode-switch"><button type="button" class="is-active" aria-pressed="true">Tạo nhanh</button><button type="button" data-quick-mode="detail" aria-pressed="false">Thiết lập chi tiết</button></div></header>
    <div class="quick-create-grid"><main class="quick-main-column">${setupCard(state, p)}
      <section class="quick-content-card"><div class="quick-card-heading"><div><span class="quick-step">1</span><div><h2>Media quảng cáo</h2><p>Ảnh hoặc video cho quảng cáo này.</p></div></div><span class="${ad.mediaId ? 'quick-done' : 'quick-required'}">${ad.mediaId ? '✓ Đã có' : 'Bắt buộc'}</span></div>${renderMediaUploader(state, ad)}</section>
      <section class="quick-content-card"><div class="quick-card-heading"><div><span class="quick-step">2</span><div><h2>Nội dung hiển thị</h2><p>Viết ngắn gọn, rõ lợi ích và lời kêu gọi.</p></div></div><span class="quick-required">Bắt buộc</span></div><label class="field"><span class="field-label">Văn bản chính</span><textarea data-client-id="${escapeHtml(ad.clientId)}" data-field="primaryText" rows="6" maxlength="2200" placeholder="Nhập nội dung quảng cáo...">${escapeHtml(ad.primaryText)}</textarea><small><span data-quick-text-count>${ad.primaryText?.length || 0}</span>/2.200 ký tự</small></label><label class="field"><span class="field-label">Tiêu đề</span><input type="text" data-client-id="${escapeHtml(ad.clientId)}" data-field="headline" maxlength="255" value="${escapeHtml(ad.headline)}" placeholder="Tiêu đề ngắn gọn"><small>Nằm cạnh nút Gửi tin nhắn.</small></label></section>
      <section class="quick-review-bar"><div><strong>${missing.length ? `Còn ${missing.length} mục cần hoàn tất` : 'Đã sẵn sàng để kiểm tra'}</strong><span>${contentMissing.length ? `Thiếu ${contentMissing.join(', ')}.` : 'Media và nội dung đã đầy đủ.'}</span></div>${missing.length ? '<button type="button" class="button-secondary" data-quick-mode="detail" data-quick-section="setup">Xem mục còn thiếu</button>' : '<button type="button" class="button-primary" data-action="publish-draft">Kiểm tra &amp; tạo</button>'}</section>
    </main>${preview(ad, p.page?.name || campaign.pageId)}</div></section>`;
}

export function refreshQuickWorkspace(workspace, state) {
  if (state.ui?.launchMode !== 'quick') return;
  const { ad } = ctx(state); if (!ad) return;
  const write = (selector, value) => { const node = workspace.querySelector(selector); if (node) node.textContent = value; };
  write('[data-quick-preview-text]', ad.primaryText || 'Nội dung quảng cáo sẽ hiển thị tại đây.');
  write('[data-quick-preview-headline]', ad.headline || 'Tiêu đề quảng cáo');
  write('[data-quick-text-count]', ad.primaryText?.length || 0);
}
