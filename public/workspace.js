import { WEBSITE_PIXEL_ID } from './website-tracking.js';
import {
  activeCampaign,
  calculateBudgetSummary,
  findNode,
  isToolAudienceTemplateId,
  toolAudienceTemplateCompatibility,
  isSeedingUploadTargetCurrent,
  resourcesForCampaign,
  sharedCreativeCount
} from './state.js';
import { formatConversationMessageJson, isConversationModified } from './conversation.js';
import { isSeedingModified } from './seeding.js';
import { navigationGate, workspaceProgress } from './workspace-progress.js';

const nodeLabels = {
  campaign: 'Chiến dịch',
  adSet: 'Nhóm quảng cáo',
  ad: 'Quảng cáo'
};

export function renderSeedingWorkspace(state) {
  const campaign = activeCampaign(state);
  if (!campaign) {
    return seedingWorkspaceLayout(state, `
      <section class="workspace-seeding-shell" aria-label="Seeding workspace">
        <div class="editor-empty empty-state">
          <span class="empty-kicker">Seeding</span>
          <h1>Ch\u1ecdn m\u1ed9t chi\u1ebfn d\u1ecbch tr\u01b0\u1edbc</h1>
          <p>Seeding s\u1ebd \u0111\u01b0\u1ee3c li\u00ean k\u1ebft v\u1edbi chi\u1ebfn d\u1ecbch \u0111ang ch\u1ecdn sau khi Ads \u0111\u01b0\u1ee3c t\u1ea1o.</p>
        </div>
      </section>`);
  }
  const adCount = (campaign.adSets ?? []).reduce((total, adSet) => total + (adSet.ads ?? []).length, 0);
  const seedingReady = adCount > 0;
  return seedingWorkspaceLayout(state, `
    <section class="workspace-seeding-shell" aria-label="Seeding workspace">
      <div class="workspace-seeding-header">
        <div>
          <span class="eyebrow">Seeding</span>
          <h1 tabindex="-1" data-seeding-workspace-title>So\u1ea1n b\u00ecnh lu\u1eadn seeding</h1>
          <p>Nh\u1eadp n\u1ed9i dung v\u00e0 th\u00eam \u1ea3nh ngay t\u1ea1i \u0111\u00e2y. Tool ch\u1ec9 ch\u1ea1y sau khi Ads c\u00f3 Post ID.</p>
        </div>
        <div class="workspace-seeding-actions">
          <span class="workspace-linked-status ${seedingReady ? 'is-ready' : ''}">${seedingReady ? 'Ads s\u1eb5n s\u00e0ng' : 'Ch\u01b0a c\u00f3 Ads'}</span>
          <button type="button" class="button-secondary workspace-seeding-back" data-action="open-campaign-workspace"><span aria-hidden="true">\u2190</span> Quay l\u1ea1i Chi\u1ebfn d\u1ecbch</button>
        </div>
      </div>
      <div class="workspace-seeding-context" role="status">
        <div><span class="field-label">Campaign \u0111ang so\u1ea1n</span><strong>${escapeHtml(campaign.name ?? 'Chi\u1ebfn d\u1ecbch m\u1edbi')}</strong></div>
        <small>${adCount} Ads \u00b7 ${seedingReady ? 'S\u1ebd ch\u1edd Post ID r\u1ed3i m\u1edbi g\u1eedi comment' : 'C\u00f3 th\u1ec3 so\u1ea1n tr\u01b0\u1edbc, t\u1ea1o Ads sau'}</small>
      </div>
      ${seedingEditor(state, campaign)}
    </section>`);
}

function seedingWorkspaceLayout(state, content) {
  return `
    <div class="workspace-seeding-layout">
      ${content}
    </div>`;
}

export function renderWorkspace(state) {
  return `
    <aside id="workspace-tree-panel" class="workspace-tree${state.ui?.treeOpen ? ' is-open' : ''}" aria-label="Cấu trúc chiến dịch">
      ${renderTree(state)}
    </aside>
    <section class="workspace-editor" aria-label="Trình chỉnh sửa">
      ${renderEditor(state)}
    </section>
    ${mobilePanelBackdrop(state)}`;
}

function mobilePanelBackdrop(state) {
  const open = Boolean(state.ui?.treeOpen || state.ui?.reviewOpen);
  return `<button type="button" class="workspace-mobile-backdrop${open ? ' is-visible' : ''}" data-action="close-mobile-panels" aria-label="Đóng bảng điều khiển"></button>`;
}

export function renderResults(progressOrNodes = [], { campaignClientId = null } = {}) {
  const progress = Array.isArray(progressOrNodes) ? null : (progressOrNodes ?? {});
  const localDemo = Boolean(progress?.localDemo);
  const allNodes = Array.isArray(progressOrNodes) ? progressOrNodes : (progress.nodes ?? []);
  const nodes = filterNodesByCampaign(allNodes, campaignClientId);
  if (nodes.length === 0 && !progress?.seeding && !progress?.seedingError) {
    return '<p class="results-empty">Chưa có lượt tạo nào trong phiên này.</p>';
  }

  return `
    <div class="results-sticky">
      <div class="results-header">
        <div class="results-title-group">
          <span class="eyebrow">${localDemo ? 'Nhật ký đăng thử local' : 'Nhật ký tạo quảng cáo Meta'}</span>
          <h2>Kết quả theo từng đối tượng</h2>
        </div>
        <button type="button" class="results-close-button" data-action="close-results" aria-label="Đóng nhật ký"><span aria-hidden="true">×</span></button>
      </div>
      ${progress ? renderRunProgress(progress, nodes) : ''}
    </div>
    ${campaignClientId ? `<div class="results-campaign-filter"><span>Đang xem Campaign: <strong>${escapeHtml(campaignName(progress, campaignClientId))}</strong></span><button type="button" class="button-secondary" data-action="show-all-results">Xem toàn bộ lượt tạo</button></div>` : ''}
    <div class="results-list">
      ${nodes.map((node) => renderResultNode(node, { localDemo })).join('')}
    </div>
    ${progress ? renderSeedingResults(progress, { campaignClientId }) : ''}`;
}

function filterNodesByCampaign(nodes, campaignClientId) {
  if (!campaignClientId) return nodes;
  const nodeById = new Map(nodes.map((node) => [String(node.clientId), node]));
  return nodes.filter((node) => {
    let current = node;
    while (current) {
      if (String(current.clientId) === String(campaignClientId)) return true;
      current = nodeById.get(String(current.parentClientId ?? ''));
    }
    return false;
  });
}

function campaignName(progress, campaignClientId) {
  return (progress?.snapshot?.campaigns ?? []).find((campaign) => String(campaign.clientId) === String(campaignClientId))?.name
    ?? progress?.campaigns?.find((campaign) => String(campaign.clientId) === String(campaignClientId))?.name
    ?? campaignClientId;
}

export function renderSeedingResults(run, { campaignClientId = null } = {}) {
  const seeding = run?.seeding;
  const error = run?.seedingError;
  if (!seeding && !error) return '';

  const allJobs = seeding?.jobs ?? [];
  const allConflicts = seeding?.conflicts ?? [];
  const jobs = campaignClientId
    ? allJobs.filter((job) => String(job.campaignClientId ?? '') === String(campaignClientId))
    : allJobs;
  const conflicts = campaignClientId
    ? allConflicts
      .filter((conflict) => (conflict.campaignClientIds ?? []).some((id) => String(id) === String(campaignClientId)))
      .map((conflict) => ({ ...conflict, campaignClientIds: [campaignClientId] }))
    : allConflicts;
  const summary = campaignClientId ? summarizeSeedingJobs(jobs) : (seeding?.summary ?? {});
  const campaigns = run?.snapshot?.campaigns ?? [];
  const campaignById = new Map(campaigns.map((campaign) => [String(campaign.clientId), campaign]));
  const campaignByAdId = campaignAdIndex(campaigns);
  const postIds = new Set([
    ...jobs.map((job) => String(job.postId ?? '')).filter(Boolean),
    ...conflicts.map((conflict) => String(conflict.postId ?? '')).filter(Boolean)
  ]);
  const groupedJobs = groupSeedingJobs(jobs, campaigns);
  const runId = String(run?.runId ?? run?.id ?? '');
  const waitingPostCount = campaignClientId
    ? campaignWaitingPostCount(run, campaignClientId, jobs)
    : Math.max(0, Number(seeding?.waitingPostCount) || 0);
  const createdCount = Math.max(0, Number(summary.created) || 0);
  const totalCount = Math.max(0, Number(summary.total) || 0);

  return `
    <section class="seeding-results" data-seeding-results data-run-id="${escapeHtml(runId)}">
      <header class="seeding-results-summary">
        <div class="seeding-summary-heading">
          <span class="eyebrow">Seeding bình luận</span>
          <h3>Tiến độ bình luận</h3>
          ${seedingStatusBadge(overallSeedingStatus({ ...seeding, summary, conflicts }, error))}
        </div>
        <div class="seeding-summary-stats">
          <div class="seeding-stat"><strong>${escapeHtml(createdCount)}/${escapeHtml(totalCount)}</strong><span>Bình luận</span></div>
          <div class="seeding-stat"><strong>${escapeHtml(postIds.size)}</strong><span>Post ID</span></div>
          <div class="seeding-stat"><strong>${escapeHtml(waitingPostCount)}</strong><span>Đang chờ</span></div>
        </div>
        <div class="seeding-summary-actions">
          ${!campaignClientId && Number(summary.pending) > 0 ? seedingActionButton('cancel-seeding', 'Dừng seeding', runId) : ''}
          ${!campaignClientId && Number(summary.cancelled) > 0 ? seedingActionButton('resume-seeding', 'Tiếp tục', runId, 'button-primary') : ''}
        </div>
      </header>
      ${error ? `<div class="seeding-runner-error" role="alert">${escapeHtml(error.message ?? error)}</div>` : ''}
      ${groupedJobs.map(({ campaignClientId, posts }) => {
    const campaign = campaignById.get(campaignClientId);
    const campaignJobs = posts.flatMap((post) => post.jobs);
    const completedCount = campaignJobs.filter((job) => job.status === 'created').length;
    const campaignTotal = campaignJobs.length;
    const campaignPercent = campaignTotal > 0 ? Math.round((completedCount / campaignTotal) * 100) : 0;
    const failedJobs = campaignJobs.filter((job) => ['failed', 'needs_review'].includes(job.status));
    return `
          <section class="seeding-campaign">
            <div class="seeding-campaign-heading">
              <div class="seeding-campaign-copy">
                <small>${escapeHtml(campaign?.seeding?.templateName ?? 'Mẫu seeding')}</small>
                <h4>${escapeHtml(campaign?.name ?? campaignClientId)}</h4>
                <span>Đã đăng ${escapeHtml(completedCount)}/${escapeHtml(campaignTotal)} bình luận</span>
              </div>
              <strong class="seeding-campaign-percent">${escapeHtml(campaignPercent)}%</strong>
            </div>
            <div class="seeding-campaign-progress" role="progressbar" aria-label="Tiến độ seeding" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${escapeHtml(campaignPercent)}">
              <span style="width:${escapeHtml(campaignPercent)}%"></span>
            </div>
            <div class="seeding-post-links">
              ${posts.map((post) => renderSeedingPostLink({
      post,
      campaignClientId,
      campaignByAdId,
      nodes: run?.nodes ?? []
    })).join('')}
            </div>
            ${failedJobs.length > 0 ? `
              <div class="seeding-campaign-errors" role="alert">
                <strong>${escapeHtml(failedJobs.length)} bình luận cần xử lý</strong>
                ${failedJobs.map((job) => renderSeedingFailure(job, runId, campaignClientId)).join('')}
              </div>` : ''}
          </section>`;
  }).join('')}
      ${conflicts.length > 0 ? `
        <section class="seeding-conflicts">
          <div class="seeding-conflict-heading"><strong>Cần chọn mẫu cho Post ID trùng</strong><span>Không có lựa chọn mặc định.</span></div>
          ${conflicts.map((conflict) => renderSeedingConflict(conflict, runId, campaignById)).join('')}
        </section>` : ''}
      ${!error && jobs.length === 0 && conflicts.length === 0
      ? `<p class="seeding-empty">${waitingPostCount > 0 ? 'Đang chờ lấy Post ID để bắt đầu seeding.' : 'Không có bình luận seeding cho lượt này.'}</p>`
      : ''}
    </section>`;
}

function summarizeSeedingJobs(jobs) {
  const summary = {
    total: jobs.length,
    pending: 0,
    posting: 0,
    created: 0,
    failed: 0,
    needsReview: 0,
    cancelled: 0
  };
  for (const job of jobs) {
    if (job.status === 'needs_review') summary.needsReview += 1;
    else if (job.status in summary) summary[job.status] += 1;
  }
  return summary;
}

function campaignWaitingPostCount(run, campaignClientId, jobs) {
  if (jobs.length > 0) return 0;
  const campaign = (run?.campaigns ?? []).find((entry) => String(entry.clientId) === String(campaignClientId));
  return (campaign?.seeding ?? []).filter((step) => !step.complete).length;
}

function campaignAdIndex(campaigns) {
  const index = new Map();
  for (const campaign of campaigns) {
    for (const adSet of campaign.adSets ?? []) {
      for (const ad of adSet.ads ?? []) index.set(String(ad.clientId), String(campaign.clientId));
    }
  }
  return index;
}

function groupSeedingJobs(jobs, campaigns) {
  const campaignOrder = new Map(campaigns.map((campaign, index) => [String(campaign.clientId), index]));
  const groups = new Map();
  for (const job of jobs) {
    const campaignClientId = String(job.campaignClientId ?? '');
    const postId = String(job.postId ?? '');
    if (!groups.has(campaignClientId)) groups.set(campaignClientId, new Map());
    const posts = groups.get(campaignClientId);
    if (!posts.has(postId)) posts.set(postId, []);
    posts.get(postId).push(job);
  }
  return [...groups]
    .sort(([left], [right]) => (campaignOrder.get(left) ?? Number.MAX_SAFE_INTEGER) - (campaignOrder.get(right) ?? Number.MAX_SAFE_INTEGER))
    .map(([campaignClientId, posts]) => ({
      campaignClientId,
      posts: [...posts].map(([postId, postJobs]) => ({
        postId,
        jobs: postJobs.sort((left, right) => Number(left.position) - Number(right.position))
      }))
    }));
}

function renderSeedingPostLink({ post, campaignClientId, campaignByAdId, nodes }) {
  const publication = nodes.find((node) => node?.type === 'ad'
    && String(node.postId ?? '') === post.postId
    && campaignByAdId.get(String(node.clientId)) === campaignClientId);
  const permalink = safeFacebookPermalink(publication?.permalinkUrl);
  return `
    <div class="seeding-post-link" data-seeding-post="${escapeHtml(post.postId)}">
      <span><small>Post ID</small><strong>${escapeHtml(post.postId)}</strong></span>
      ${permalink ? `<a href="${escapeHtml(permalink)}" target="_blank" rel="noopener noreferrer">Mở bài Facebook</a>` : ''}
    </div>`;
}

function renderSeedingFailure(job, runId, campaignClientId) {
  const commentNumber = Number(job.position) + 1;
  return `
    <div class="seeding-failure" data-job-id="${escapeHtml(job.id)}">
      <div><strong>Bình luận #${escapeHtml(commentNumber)}</strong><span>${escapeHtml(job.error?.message ?? 'Chưa thể đăng bình luận này.')}</span></div>
      <div class="seeding-comment-actions">
        ${seedingJobAction('retry-seeding-job', 'Thử lại', runId, job, campaignClientId)}
        ${job.status === 'needs_review' ? seedingJobAction('confirm-seeding-job', 'Đánh dấu đã có', runId, job, campaignClientId, 'button-primary') : ''}
      </div>
    </div>`;
}

function renderSeedingConflict(conflict, runId, campaignById) {
  const postId = String(conflict.postId ?? '');
  const radioName = `seeding-conflict-${postId}`;
  return `
    <fieldset class="seeding-conflict" data-seeding-conflict data-run-id="${escapeHtml(runId)}" data-post-id="${escapeHtml(postId)}">
      <legend>Post ID ${escapeHtml(postId)}</legend>
      <div class="seeding-conflict-options">
        ${(conflict.campaignClientIds ?? []).map((campaignClientId) => {
    const normalizedCampaignClientId = String(campaignClientId);
    const campaign = campaignById.get(normalizedCampaignClientId);
    return `
            <label>
              <input type="radio" name="${escapeHtml(radioName)}" value="${escapeHtml(normalizedCampaignClientId)}" data-campaign-client-id="${escapeHtml(normalizedCampaignClientId)}">
              <span>${escapeHtml(campaign?.name ?? normalizedCampaignClientId)} · ${escapeHtml(campaign?.seeding?.templateName ?? 'Mẫu chưa lưu tên')}</span>
            </label>`;
  }).join('')}
      </div>
      <button type="button" class="button-primary" data-action="resolve-seeding-conflict" data-run-id="${escapeHtml(runId)}" data-post-id="${escapeHtml(postId)}">Dùng mẫu này</button>
    </fieldset>`;
}

function seedingJobAction(action, label, runId, job, campaignClientId, className = 'button-secondary') {
  return `<button type="button" class="${className}" data-action="${action}" data-run-id="${escapeHtml(runId)}" data-job-id="${escapeHtml(job.id)}" data-post-id="${escapeHtml(job.postId)}" data-campaign-client-id="${escapeHtml(campaignClientId)}">${label}</button>`;
}

function seedingActionButton(action, label, runId, className = 'button-secondary') {
  return `<button type="button" class="${className}" data-action="${action}" data-run-id="${escapeHtml(runId)}">${label}</button>`;
}

function seedingStatusBadge(status) {
  const labels = {
    pending: 'Chờ',
    posting: 'Đang đăng',
    created: 'Đã đăng',
    failed: 'Thất bại',
    needs_review: 'Cần kiểm tra',
    cancelled: 'Đã dừng'
  };
  const normalizedStatus = status in labels ? status : 'pending';
  return `<span class="seeding-status seeding-status-${escapeHtml(normalizedStatus)}">${labels[normalizedStatus]}</span>`;
}

function overallSeedingStatus(seeding, error) {
  const summary = seeding?.summary ?? {};
  if (error || Number(summary.failed) > 0) return 'failed';
  if ((seeding?.conflicts?.length ?? 0) > 0 || Number(summary.needsReview) > 0) return 'needs_review';
  if (Number(summary.posting) > 0) return 'posting';
  if (Number(summary.pending) > 0) return 'pending';
  if (Number(summary.cancelled) > 0) return 'cancelled';
  return 'created';
}

function safeFacebookPermalink(value) {
  if (!value) return null;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return url.protocol === 'https:' && (host === 'facebook.com' || host.endsWith('.facebook.com'))
      ? url.href
      : null;
  } catch {
    return null;
  }
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function renderTree(state) {
  const campaigns = state.draft?.campaigns ?? [];
  return `
    <div class="pane-header tree-header">
      <div>
        <span class="eyebrow">Cấu trúc</span>
        <h2>Chiến dịch</h2>
      </div>
      <button type="button" class="icon-button add-button" data-action="add-campaign" aria-label="Thêm chiến dịch mới">+</button>
    </div>
    <nav class="tree-list" aria-label="Danh sách đối tượng quảng cáo">
      ${campaigns.length ? campaigns.map((campaign) => renderCampaignTree(state, campaign)).join('') : renderTreeEmpty()}
    </nav>
    <div class="tree-footer">
      <span class="tree-footer-stat"><b>${campaigns.length}</b><small>Chiến dịch</small></span>
      <span class="tree-footer-stat"><b>${countNodes(campaigns, 'adSet')}</b><small>Nhóm</small></span>
      <span class="tree-footer-stat"><b>${countNodes(campaigns, 'ad')}</b><small>Quảng cáo</small></span>
    </div>`;
}

function renderCampaignTree(state, campaign) {
  const selected = state.selection?.clientId === campaign.clientId;
  const collapsed = (state.ui?.collapsedCampaignIds ?? []).includes(campaign.clientId);
  return `
    <div class="tree-group">
      ${treeNode({
    state,
    clientId: campaign.clientId,
    type: 'campaign',
    name: campaign.name,
    selected,
    collapsed,
    meta: `${campaign.adSets.length} nhóm`,
    progress: treeNodeProgress(state, { campaign }),
    addAction: { action: 'add-campaign', clientId: null }
  })}
      ${collapsed ? '' : `<div class="tree-children">
        ${campaign.adSets.map((adSet) => renderAdSetTree(state, campaign, adSet)).join('')}
      </div>`}
    </div>`;
}

function renderAdSetTree(state, campaign, adSet) {
  const selected = state.selection?.clientId === adSet.clientId;
  const collapsed = (state.ui?.collapsedAdSetIds ?? []).includes(adSet.clientId);
  const locked = !navigationGate(state, adSet.clientId).allowed;
  return `
    <div class="tree-group tree-group-adset">
      ${treeNode({
    state,
    clientId: adSet.clientId,
    type: 'adSet',
    name: adSet.name,
    selected,
    collapsed,
    locked,
    meta: `${adSet.ads.length} quảng cáo`,
    progress: treeNodeProgress(state, { campaign, adSet }),
    addAction: { action: 'add-adset', clientId: campaign.clientId }
  })}
      ${collapsed ? '' : `<div class="tree-children tree-children-ads">
        ${adSet.ads.map((ad) => treeNode({
    state,
    clientId: ad.clientId,
    type: 'ad',
    name: ad.name,
    selected: state.selection?.clientId === ad.clientId,
    collapsed: false,
    locked: !navigationGate(state, ad.clientId).allowed,
    meta: ad.mediaId ? 'Có nội dung' : 'Chưa hoàn tất',
    progress: treeNodeProgress(state, { campaign, adSet, ad }),
    addAction: { action: 'add-ad', clientId: adSet.clientId }
  })).join('')}
      </div>`}
    </div>`;
}

function treeNode({ state, clientId, type, name, selected, collapsed, locked = false, meta, progress, addAction }) {
  const label = name || nodeLabels[type];
  const menuOpen = state.ui?.openNodeMenuId === clientId;
  const menuButtonId = `node-menu-button-${clientId}`;
  const menuId = `node-actions-${clientId}`;
  const hasChildren = type === 'campaign' || type === 'adSet';
  const toggleAction = type === 'campaign' ? 'toggle-campaign-collapse' : 'toggle-adset-collapse';
  const iconSvg = type === 'campaign'
    ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>'
    : type === 'adSet'
      ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>'
      : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>';
  const progressClass = progress ? ` has-run-progress is-run-${progress.status}` : '';
  const progressStyle = progress ? ` style="--tree-progress-ratio:${progress.ratio}"` : '';
  return `
    <div class="tree-node-row tree-node-${type}${selected ? ' is-selected' : ''}${locked ? ' is-progress-locked' : ''}${menuOpen ? ' has-open-menu' : ''}${progressClass}" data-node-id="${escapeHtml(clientId)}"${progressStyle}>
      ${hasChildren
      ? `<button type="button" class="node-disclosure${collapsed ? ' is-collapsed' : ''}${state.ui?.animatedDisclosureId === clientId ? ' is-bouncing' : ''}" data-action="${toggleAction}" data-client-id="${escapeHtml(clientId)}" aria-label="${collapsed ? 'Mở' : 'Thu'} ${escapeHtml(label)}" aria-expanded="${!collapsed}"><span class="icon-bounce" aria-hidden="true"><svg viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"></polyline></svg></span></button>`
      : '<span class="node-disclosure-spacer" aria-hidden="true"></span>'}
      <button type="button" class="tree-node-main" data-action="select-node" data-client-id="${escapeHtml(clientId)}" data-progress-locked="${locked}" aria-current="${selected ? 'true' : 'false'}"${locked ? ' aria-label="Hoàn tất bước trước để mở mục này"' : ''}>
        <span class="node-mark" aria-hidden="true">${iconSvg}</span>
        <span class="node-copy"><strong title="${escapeHtml(label)}">${escapeHtml(label)}</strong><small>${escapeHtml(meta)}</small></span>
        ${locked ? `<span class="tree-progress-lock" aria-hidden="true">${progressLockIcon()}</span>` : ''}
      </button>
      ${progress ? renderTreeNodeProgress(progress, label, clientId) : ''}
      <button type="button" id="${escapeHtml(menuButtonId)}" class="node-menu-button" data-action="toggle-node-menu" data-client-id="${escapeHtml(clientId)}" aria-label="Tùy chọn ${escapeHtml(label)}" aria-controls="${escapeHtml(menuId)}" aria-expanded="${menuOpen}">•••</button>
      ${menuOpen ? nodeActionMenu(clientId, type, addAction, menuButtonId, menuId) : ''}
    </div>`;
}

function renderTreeNodeProgress(progress, label, clientId) {
  const valueText = `${progress.percent}% · ${progress.label}`;
  return `
    <button type="button" class="tree-node-progress-action is-${progress.status}" data-action="open-node-results" data-client-id="${escapeHtml(clientId)}" aria-label="Xem kết quả ${escapeHtml(label)}: ${escapeHtml(valueText)}" title="Xem kết quả chi tiết">
      <span class="tree-node-progress-copy" role="progressbar" aria-label="Tiến độ ${escapeHtml(label)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progress.percent}" aria-valuetext="${escapeHtml(valueText)}">
        <strong>${progress.percent}%</strong>
        <small aria-live="polite" aria-atomic="true">${escapeHtml(progress.label)}</small>
      </span>
    </button>`;
}

function treeNodeProgress(state, { campaign, adSet = null, ad = null }) {
  const run = state.runProgress ?? state.publishProgress;
  if (!run) return null;

  if (!adSet && !ad) {
    const campaignProgress = (run.campaigns ?? []).find((entry) => String(entry.clientId) === String(campaign.clientId));
    if (campaignProgress) return normalizeTreeProgress(campaignProgress);
  }

  const scopedAds = ad
    ? [ad]
    : adSet
      ? (adSet.ads ?? [])
      : (campaign.adSets ?? []).flatMap((entry) => entry.ads ?? []);
  const scopedNodeIds = new Set([
    ...(!adSet && !ad ? [campaign.clientId] : []),
    ...(adSet && !ad ? [adSet.clientId] : []),
    ...scopedAds.map((entry) => entry.clientId)
  ].map(String));
  const nodes = (run.nodes ?? []).filter((node) => scopedNodeIds.has(String(node.clientId)));
  const runTerminal = ['completed', 'completed_with_errors', 'failed'].includes(run.status);
  const publishTotal = Math.max(scopedNodeIds.size, nodes.length, 1);
  const publishCompleted = nodes.filter((node) => publishNodeComplete(node.status, runTerminal)).length;
  const failedPublish = nodes.some((node) => node.status === 'failed' || node.status === 'skipped');

  const seedingItems = campaign.seeding?.enabled === false ? [] : (campaign.seeding?.items ?? []);
  const creativeGroups = new Map();
  for (const scopedAd of scopedAds) {
    const groupId = String(scopedAd.creativeGroupId ?? scopedAd.clientId);
    if (!creativeGroups.has(groupId)) creativeGroups.set(groupId, []);
    creativeGroups.get(groupId).push(scopedAd);
  }

  let publicationCompleted = 0;
  let seedingCompleted = 0;
  let failedSeeding = false;
  let needsReview = false;
  const publicationTotal = seedingItems.length > 0 ? creativeGroups.size : 0;
  const seedingTotal = seedingItems.length > 0 ? creativeGroups.size * seedingItems.length : 0;
  const jobs = run.seeding?.jobs ?? [];

  for (const groupAds of creativeGroups.values()) {
    if (seedingItems.length === 0) break;
    const groupNodes = groupAds
      .map((entry) => (run.nodes ?? []).find((node) => String(node.clientId) === String(entry.clientId)))
      .filter(Boolean);
    const postIds = new Set(groupNodes.map((node) => String(node.postId ?? '')).filter(Boolean));
    const allFailedWithoutPost = postIds.size === 0
      && groupNodes.length > 0
      && groupNodes.every((node) => publishNodeComplete(node.status, runTerminal))
      && groupNodes.every((node) => node.status === 'failed' || node.status === 'skipped');
    if (postIds.size > 0 || allFailedWithoutPost) publicationCompleted += 1;
    if (allFailedWithoutPost) {
      seedingCompleted += seedingItems.length;
      failedSeeding = true;
      continue;
    }
    const groupAdIds = new Set(groupAds.map((entry) => String(entry.clientId)));
    const groupJobs = jobs.filter((job) => groupAdIds.has(String(job.adClientId ?? ''))
      || postIds.has(String(job.postId ?? '')));
    seedingCompleted += Math.min(
      seedingItems.length,
      groupJobs.filter((job) => ['created', 'succeeded', 'failed', 'needs_review', 'cancelled'].includes(job.status)).length
    );
    failedSeeding ||= groupJobs.some((job) => ['failed', 'cancelled'].includes(job.status));
    needsReview ||= groupJobs.some((job) => job.status === 'needs_review');
  }

  const publishComplete = publishCompleted >= publishTotal;
  const publicationComplete = publicationCompleted >= publicationTotal;
  const seedingComplete = seedingCompleted >= seedingTotal;
  const phase = !publishComplete
    ? 'creating'
    : !publicationComplete
      ? 'publishing'
      : !seedingComplete
        ? 'seeding'
        : 'complete';
  const percent = weightedTreeProgress({
    publishCompleted,
    publishTotal,
    publicationCompleted,
    publicationTotal,
    seedingCompleted,
    seedingTotal
  });
  const status = needsReview
    ? 'needs_review'
    : phase !== 'complete'
      ? (percent === 0 && run.status === 'preparing' ? 'pending' : 'running')
      : (failedPublish || failedSeeding || run.status === 'failed' || run.seedingError
          ? 'completed_with_errors'
          : 'completed');
  return normalizeTreeProgress({ percent, phase, status });
}

function publishNodeComplete(status, runTerminal) {
  return ['created', 'failed'].includes(status) || (status === 'skipped' && runTerminal);
}

function weightedTreeProgress({
  publishCompleted,
  publishTotal,
  publicationCompleted,
  publicationTotal,
  seedingCompleted,
  seedingTotal
}) {
  const hasPublication = publicationTotal > 0;
  const hasSeeding = seedingTotal > 0;
  const publishWeight = 70 + (hasPublication ? 0 : 10) + (hasSeeding ? 0 : 20);
  const publicationWeight = hasPublication ? 10 + (hasSeeding ? 0 : 20) : 0;
  const seedingWeight = hasSeeding ? 20 : 0;
  const ratio = (completed, total) => total > 0 ? Math.min(1, completed / total) : 0;
  return Math.min(100, Math.floor(
    ratio(publishCompleted, publishTotal) * publishWeight
    + ratio(publicationCompleted, publicationTotal) * publicationWeight
    + ratio(seedingCompleted, seedingTotal) * seedingWeight
  ));
}

function normalizeTreeProgress(progress) {
  const numericPercent = Number(progress?.percent);
  const percent = Number.isFinite(numericPercent)
    ? Math.min(100, Math.max(0, Math.floor(numericPercent)))
    : 0;
  const phase = ['creating', 'publishing', 'seeding', 'complete'].includes(progress?.phase)
    ? progress.phase
    : progress?.phase === 'post' ? 'publishing' : 'creating';
  const allowedStatuses = ['pending', 'running', 'completed', 'completed_with_errors', 'needs_review'];
  const status = allowedStatuses.includes(progress?.status) ? progress.status : 'running';
  const label = status === 'needs_review'
    ? 'Cần kiểm tra'
    : status === 'completed_with_errors'
      ? 'Có lỗi'
      : status === 'completed'
        ? 'Hoàn tất'
        : status === 'pending'
          ? 'Chờ đăng'
          : phase === 'seeding'
            ? 'Đang seeding'
            : phase === 'publishing'
              ? 'Chờ Post ID'
              : 'Đang tạo';
  return { percent, ratio: percent / 100, phase, status, label };
}

function nodeActionMenu(clientId, type, addAction, menuButtonId, menuId) {
  if (type === 'campaign') {
    return `
      <div id="${escapeHtml(menuId)}" class="node-action-menu" role="group" aria-labelledby="${escapeHtml(menuButtonId)}" data-node-menu="${escapeHtml(clientId)}">
        <button type="button" class="node-action-menu-item" data-action="duplicate-campaign" data-client-id="${escapeHtml(clientId)}">Sao chép Campaign và nhóm quảng cáo</button>
        <button type="button" class="node-action-menu-item" data-action="add-adset" data-client-id="${escapeHtml(clientId)}">Thêm nhóm quảng cáo mới</button>
        <button type="button" class="node-action-menu-item" data-action="add-campaign">Thêm chiến dịch mới</button>
        <button type="button" class="node-action-menu-item is-destructive" data-action="remove-node" data-client-id="${escapeHtml(clientId)}">Xóa chiến dịch</button>
      </div>`;
  }

  if (type === 'adSet') {
    return `
      <div id="${escapeHtml(menuId)}" class="node-action-menu" role="group" aria-labelledby="${escapeHtml(menuButtonId)}" data-node-menu="${escapeHtml(clientId)}">
        <button type="button" class="node-action-menu-item" data-action="duplicate-adset" data-client-id="${escapeHtml(clientId)}">Nhân nhóm quảng cáo tương tự</button>
        <button type="button" class="node-action-menu-item" data-action="add-ad" data-client-id="${escapeHtml(clientId)}">Thêm quảng cáo mới</button>
        ${addAction?.clientId ? `<button type="button" class="node-action-menu-item" data-action="add-adset" data-client-id="${escapeHtml(addAction.clientId)}">Thêm nhóm quảng cáo mới</button>` : ''}
        <button type="button" class="node-action-menu-item is-destructive" data-action="remove-node" data-client-id="${escapeHtml(clientId)}">Xóa nhóm quảng cáo</button>
      </div>`;
  }

  return `
    <div id="${escapeHtml(menuId)}" class="node-action-menu" role="group" aria-labelledby="${escapeHtml(menuButtonId)}" data-node-menu="${escapeHtml(clientId)}">
      <button type="button" class="node-action-menu-item" data-action="duplicate-ad" data-client-id="${escapeHtml(clientId)}">Thêm quảng cáo tương tự</button>
      ${addAction?.clientId ? `<button type="button" class="node-action-menu-item" data-action="add-ad" data-client-id="${escapeHtml(addAction.clientId)}">Thêm quảng cáo mới</button>` : ''}
      <button type="button" class="node-action-menu-item is-destructive" data-action="remove-node" data-client-id="${escapeHtml(clientId)}">Xóa quảng cáo</button>
    </div>`;
}

function renderTreeEmpty() {
  return `
    <div class="empty-state compact-empty">
      <strong>Chưa có chiến dịch</strong>
      <p>Thêm chiến dịch đầu tiên để bắt đầu.</p>
    </div>`;
}

function renderEditor(state) {
  const selected = findNode(state, state.selection?.clientId);
  if (!selected) {
    return `
      <div class="editor-empty empty-state">
        <span class="empty-kicker">Workspace</span>
        <h1>Chọn một đối tượng để chỉnh sửa</h1>
        <p>Chiến dịch, nhóm quảng cáo và quảng cáo được quản lý trong cùng một màn hình.</p>
      </div>`;
  }

  const content = selected.type === 'campaign'
    ? renderCampaignEditor(state, selected.node)
    : selected.type === 'adSet'
      ? renderAdSetEditor(state, selected.campaign, selected.node)
      : renderAdEditor(state, selected.campaign, selected.adSet, selected.node);

  return `
    <header class="editor-header">
      <div class="breadcrumbs">
        <span>${escapeHtml(selected.campaign?.name || nodeLabels.campaign)}</span>
        ${selected.type !== 'campaign' ? `<span aria-hidden="true">/</span><span>${escapeHtml(selected.adSet?.name || nodeLabels.adSet)}</span>` : ''}
        ${selected.type === 'ad' ? `<span aria-hidden="true">/</span><span>${escapeHtml(selected.node.name || nodeLabels.ad)}</span>` : ''}
      </div>
      <div class="editor-title-row">
        <div>
          <span class="node-type-label">${nodeLabels[selected.type]}</span>
          <h1>${escapeHtml(selected.node.name || nodeLabels[selected.type])}</h1>
        </div>
        ${renderEditorProgressAction(state)}
      </div>
    </header>
    <div class="editor-body">${content}</div>`;
}

function renderCampaignEditor(state, campaign) {
  const campaignBudget = campaign.budgetStrategy === 'CAMPAIGN';
  return `
    ${campaignPresetCard(state, campaign)}
    ${section('', '', `
      <div class="field-stack">
        ${textField('Tên chiến dịch', campaign, 'name', { placeholder: 'Nhập tên chiến dịch' })}
        <div class="field-grid two-columns">
          ${lockedField('Mục tiêu chiến dịch', 'Lượt tương tác')}
          ${lockedField('Loại hình mua', 'Đấu giá')}
        </div>
        ${expandableSelect({
    label: 'Hạng mục quảng cáo đặc biệt',
    clientId: campaign.clientId,
    field: 'specialAdCategory',
    value: campaign.specialAdCategory,
    options: [
      { value: 'NONE', label: 'Không có' },
      { value: 'CREDIT', label: 'Tín dụng' },
      { value: 'EMPLOYMENT', label: 'Việc làm' },
      { value: 'HOUSING', label: 'Nhà ở' },
      { value: 'ISSUES_ELECTIONS_POLITICS', label: 'Vấn đề xã hội, bầu cử hoặc chính trị' }
    ]
  })}
      </div>`)}
    ${section('Tài khoản và Page', 'Mỗi chiến dịch sử dụng một tài khoản quảng cáo và một Facebook Page riêng.', `
      <div class="field-grid two-columns campaign-source-grid">
        ${accountPicker(state, campaign)}
        ${pagePicker(state, campaign)}
      </div>`)}
${section('Chiến lược ngân sách', 'Chọn nơi Meta quản lý ngân sách ngày.', `
      <div class="choice-grid budget-choice-grid">
        ${choiceCard({
    name: `budget-${campaign.clientId}`,
    clientId: campaign.clientId,
    field: 'budgetStrategy',
    value: 'CAMPAIGN',
    checked: campaignBudget,
    title: 'Ngân sách chiến dịch',
    description: 'Một ngân sách chung cho mọi nhóm quảng cáo trong chiến dịch.'
  })}
        ${choiceCard({
    name: `budget-${campaign.clientId}`,
    clientId: campaign.clientId,
    field: 'budgetStrategy',
    value: 'AD_SET',
    checked: !campaignBudget,
    title: 'Ngân sách nhóm quảng cáo',
    description: 'Đặt ngân sách riêng cho từng nhóm quảng cáo.'
  })}
      </div>
      <div class="field-row budget-input-row">
        ${numberField('Ngân sách chiến dịch mỗi ngày', campaign, 'dailyBudget', { disabled: !campaignBudget, suffix: '₫' })}
        <p class="field-help">${campaignBudget
      ? 'Meta phân bổ ngân sách giữa các nhóm quảng cáo.'
      : 'Đang tắt vì ngân sách được quản lý ở từng nhóm quảng cáo.'}</p>
      </div>`)}
    ${campaignSeedingCard(state, campaign)}
    `;
}

function campaignPresetCard(state, campaign) {
  const presets = state.resources.campaignPresets ?? [];
  const selectedPresetId = state.ui?.campaignPresetSelectionByCampaignId?.[campaign.clientId];
  const selectedPreset = presets.find((preset) => preset.id === selectedPresetId);
  const loading = Boolean(state.ui?.loadingCampaignPresets);
  const error = state.resources.campaignPresetsError;
  const libraryReady = Boolean(state.connected || state.ui?.localDemoResources)
    && state.resources.campaignPresetsLoaded === true
    && !error;
  const currentName = selectedPreset?.name ?? '';
  const emptyCopy = loading ? 'Đang tải thư viện cấu hình...' : 'Chưa có cấu hình nào trong thư viện.';
  return section('Cấu hình sẵn', 'Chọn một lần để tự điền tên Campaign, tên nhóm quảng cáo, đối tượng, mẫu Seeding và mẫu Cuộc trò chuyện.', `
    <div class="campaign-preset-card" data-campaign-preset-card>
      <details class="template-card-dropdown campaign-preset-picker" data-template-card-dropdown data-client-id="${escapeHtml(campaign.clientId)}">
        <summary aria-label="Chọn cấu hình sẵn cho Campaign">
          <span class="template-dropdown-current"><small>Cấu hình đang áp dụng</small><strong>${escapeHtml(currentName || 'Chọn một cấu hình có sẵn')}</strong></span>
          <span class="template-dropdown-plus" aria-hidden="true"><span class="line-h"></span><span class="line-v"></span></span>
        </summary>
        <div class="template-card-dropdown-panel">
          <div class="template-card-dropdown-inner">
            <label class="template-card-search">
              <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><path d="m16 16 4 4"></path></svg>
              <input type="search" data-template-card-search placeholder="Tìm cấu hình..." autocomplete="off" />
            </label>
            <div class="template-card-grid">
              <button type="button" class="template-choice-card is-create" data-action="new-campaign-preset" data-client-id="${escapeHtml(campaign.clientId)}" ${!libraryReady || loading ? 'disabled' : ''}>
                <span class="template-choice-mark" aria-hidden="true">+</span>
                <span class="template-choice-copy"><strong>Tạo cấu hình mới</strong><small>Lưu thiết lập hiện tại của Campaign</small></span>
              </button>
              ${presets.length ? presets.map((preset) => `
                <div class="template-choice-wrap${preset.id === selectedPresetId ? ' is-selected' : ''}">
                  <button type="button" class="template-choice-card${preset.id === selectedPresetId ? ' is-selected' : ''}" data-action="apply-campaign-preset" data-client-id="${escapeHtml(campaign.clientId)}" data-preset-id="${escapeHtml(preset.id)}" ${!libraryReady || loading ? 'disabled' : ''} aria-pressed="${preset.id === selectedPresetId}">
                    <span class="template-choice-mark" aria-hidden="true">${preset.id === selectedPresetId ? '✓' : 'C'}</span>
                    <span class="template-choice-copy"><strong>${escapeHtml(preset.name)}</strong><small>${escapeHtml(preset.content?.audienceTemplateName ?? 'Chưa lưu đối tượng')} · ${escapeHtml(preset.content?.seedingTemplateName ?? 'Chưa có mẫu Seeding')} · ${escapeHtml(preset.content?.conversationTemplateName ?? 'Chưa có mẫu Cuộc trò chuyện')}</small></span>
                  </button>
                  <button type="button" class="template-choice-delete" data-action="delete-campaign-preset" data-client-id="${escapeHtml(campaign.clientId)}" data-preset-id="${escapeHtml(preset.id)}" aria-label="Xóa cấu hình ${escapeHtml(preset.name)}" title="Xóa cấu hình" ${!libraryReady || loading ? 'disabled' : ''}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16"></path><path d="M9 7V4h6v3"></path><path d="M7 7l1 13h8l1-13"></path><path d="M10 11v5M14 11v5"></path></svg></button>
                </div>`).join('') : error
                  ? `<div class="template-card-load-error"><span>${escapeHtml(error)}</span><button type="button" class="button-secondary" data-action="retry-campaign-presets" data-client-id="${escapeHtml(campaign.clientId)}">Thử lại</button></div>`
                  : `<p class="template-card-empty">${emptyCopy}</p>`}
              <p class="template-card-empty is-hidden" data-template-card-empty-search>Không tìm thấy cấu hình phù hợp.</p>
            </div>
          </div>
        </div>
      </details>
      <div class="campaign-preset-form">
        <label class="field">
          <span>Tên cấu hình</span>
          <input data-campaign-preset-name data-client-id="${escapeHtml(campaign.clientId)}" value="${escapeHtml(currentName)}" maxlength="120" placeholder="Ví dụ: Triệt bikini nữ 990K" ${!libraryReady || loading ? 'disabled' : ''} />
        </label>
        <button type="button" class="button-primary" data-action="save-campaign-preset" data-client-id="${escapeHtml(campaign.clientId)}" ${!libraryReady || loading ? 'disabled' : ''}>${selectedPreset ? 'Cập nhật cấu hình' : 'Lưu cấu hình mới'}</button>
      </div>
      ${selectedPreset ? `<div class="campaign-preset-summary"><span><b>Campaign</b>${escapeHtml(selectedPreset.content?.campaignName ?? '')}</span><span><b>Nhóm quảng cáo</b>${escapeHtml(selectedPreset.content?.adSetName ?? '')}</span><span><b>Đối tượng</b>${escapeHtml(selectedPreset.content?.audienceTemplateName ?? 'Cấu hình cũ chưa lưu')}</span></div>` : ''}
    </div>`);
}

function campaignSeedingCard(state, campaign) {
  const seeding = campaign.seeding ?? {};
  const comments = (seeding.items ?? []).filter((item) => item.message?.trim() || item.imageMediaId);
  const templates = state.resources.seedingTemplates ?? [];
  const selectedTemplate = templates.find((template) => template.id === seeding.templateId);
  const loading = Boolean(state.ui?.loadingSeedingTemplates);
  const libraryReady = Boolean(state.connected || state.ui?.localDemoResources)
    && state.resources.seedingTemplatesLoaded === true
    && !state.resources.seedingTemplatesError;
  const hasTemplate = Boolean(seeding.templateId);
  const ready = hasTemplate && comments.length > 0;
  const status = ready ? 'Đã thiết lập' : hasTemplate ? 'Cần thêm bình luận' : 'Chưa thiết lập';
  const capabilityNote = state.resources.capabilities?.pagesManageEngagement === false
    ? ' · Cần kết nối lại quyền bình luận'
    : '';
  return section('Bình luận seeding', 'Cấu hình theo từng chiến dịch và chỉ chạy sau khi quảng cáo có Post ID.', `
    <article class="campaign-seeding-card${ready ? ' is-ready' : ''}" data-campaign-seeding-summary>
      <span class="campaign-seeding-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M7 17.5 3.5 20l1-4A8 8 0 1 1 7 17.5Z"></path><path d="M8 9.5h8M8 13h5"></path></svg></span>
      <div class="campaign-seeding-copy">
        <div class="campaign-seeding-title-row">
          <strong>Seeding của chiến dịch</strong>
          <span class="campaign-seeding-status${ready ? ' is-ready' : ''}">${escapeHtml(status)}</span>
        </div>
        <p>${comments.length} bình luận có nội dung${escapeHtml(capabilityNote)}</p>
      </div>
      <button type="button" class="button-secondary campaign-seeding-open" data-action="open-campaign-seeding" data-client-id="${escapeHtml(campaign.clientId)}" aria-label="${ready ? 'Chỉnh sửa' : 'Cài đặt'} bình luận seeding cho chiến dịch">${ready ? 'Chỉnh sửa' : 'Cài đặt'}<span aria-hidden="true">→</span></button>
      ${campaignSeedingTemplatePicker({
    campaign,
    templates,
    selectedTemplate,
    loading,
    disabled: !libraryReady
  })}
    </article>`);
}

function campaignSeedingTemplatePicker({ campaign, templates, selectedTemplate, loading, disabled }) {
  const seeding = campaign.seeding ?? {};
  const currentName = selectedTemplate?.name ?? seeding.templateName?.trim() ?? '';
  const emptyCopy = loading ? 'Đang tải thư viện mẫu...' : 'Chưa có mẫu nào trong thư viện.';
  return `
    <details class="template-card-dropdown campaign-seeding-picker" data-template-card-dropdown data-campaign-seeding-template-picker data-client-id="${escapeHtml(campaign.clientId)}" data-validation-field="seeding.templateId">
      <summary aria-label="Chọn mẫu seeding cho chiến dịch">
        <span class="template-dropdown-current"><small>Mẫu seeding đang áp dụng</small><strong>${escapeHtml(currentName || 'Chọn một mẫu có sẵn')}</strong></span>
        <span class="template-dropdown-plus" aria-hidden="true"><span class="line-h"></span><span class="line-v"></span></span>
      </summary>
      <div class="template-card-dropdown-panel">
        <div class="template-card-dropdown-inner">
          <label class="template-card-search">
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><path d="m16 16 4 4"></path></svg>
            <input type="search" data-template-card-search placeholder="Tìm mẫu seeding..." autocomplete="off" />
          </label>
          <div class="template-card-grid">
            <button type="button" class="template-choice-card is-create" data-action="new-seeding-template" data-open-seeding-editor="true" data-client-id="${escapeHtml(campaign.clientId)}" ${disabled || loading ? 'disabled' : ''}>
              <span class="template-choice-mark" aria-hidden="true">+</span>
              <span class="template-choice-copy"><strong>Tạo mẫu mới</strong><small>Mở trình soạn bình luận</small></span>
            </button>
            ${templates.length ? templates.map((template) => `
              <div class="template-choice-wrap${template.id === seeding.templateId ? ' is-selected' : ''}">
                <button type="button" class="template-choice-card${template.id === seeding.templateId ? ' is-selected' : ''}" data-action="apply-seeding-template" data-client-id="${escapeHtml(campaign.clientId)}" data-template-id="${escapeHtml(template.id)}" ${disabled || loading ? 'disabled' : ''} aria-pressed="${template.id === seeding.templateId}">
                  <span class="template-choice-mark" aria-hidden="true">${template.id === seeding.templateId ? '✓' : 'S'}</span>
                  <span class="template-choice-copy"><strong>${escapeHtml(template.name)}</strong><small>${template.items?.length ?? 0} bình luận</small></span>
                </button>
                <button type="button" class="template-choice-delete" data-action="delete-seeding-template" data-client-id="${escapeHtml(campaign.clientId)}" data-template-id="${escapeHtml(template.id)}" aria-label="Xóa mẫu ${escapeHtml(template.name)}" title="Xóa mẫu" ${disabled || loading ? 'disabled' : ''}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16"></path><path d="M9 7V4h6v3"></path><path d="M7 7l1 13h8l1-13"></path><path d="M10 11v5M14 11v5"></path></svg></button>
              </div>`).join('') : `<p class="template-card-empty">${emptyCopy}</p>`}
            <p class="template-card-empty is-hidden" data-template-card-empty-search>Không tìm thấy mẫu phù hợp.</p>
          </div>
        </div>
      </div>
    </details>`;
}

function renderAdSetEditor(state, campaign, adSet) {
  const budgetDisabled = campaign.budgetStrategy === 'CAMPAIGN';
  const pageName = campaignPageName(state, campaign);
  const savedAudienceLocked = Boolean(adSet.audienceTemplateId)
    && !isToolAudienceTemplateId(adSet.audienceTemplateId);
  return `
    ${section('', '', `
      ${textField('Tên nhóm quảng cáo', adSet, 'name', { placeholder: 'Nhập tên nhóm quảng cáo' })}`)}
    ${section('Chuyển đổi &amp; Ngân sách', 'Đích đến đã khóa theo luồng đã duyệt · Chỉ hỗ trợ ngân sách ngày', `
      <div class="adset-setup-compact">
        <div class="adset-setup-route-row">
          ${compactLockedValue('Ứng dụng nhắn tin', 'Vị trí chuyển đổi')}
          ${compactLockedValue(pageName, 'Facebook Page')}
          ${compactLockedValue('Tối đa hóa trò chuyện', 'Mục tiêu hiệu quả')}
          <div class="adset-messenger-chip"><span class="route-dot"></span><strong>Messenger</strong></div>
        </div>
        <div class="adset-setup-schedule-row">
          <label class="adset-budget-field">
            <span>Ngân sách mỗi ngày</span>
            <span class="adset-budget-input"><input data-field="dailyBudget" data-client-id="${escapeHtml(adSet.clientId)}" data-currency-input type="text" inputmode="numeric" value="${escapeHtml(formatCurrencyValue(adSet.dailyBudget))}"${budgetDisabled ? ' disabled' : ''} /><b>₫</b></span>
          </label>
          ${compactDateTimeField('Bắt đầu', adSet, 'startTime')}
          ${compactDateTimeField('Kết thúc', adSet, 'endTime')}
        </div>
        ${budgetDisabled ? '<p class="adset-setup-notice">Ngân sách được quản lý tại cấp chiến dịch.</p>' : ''}
      </div>
      `)}
    ${section('Đối tượng', 'Giới hạn rõ người có thể nhìn thấy quảng cáo.', `
      <div class="audience-compact">
        <div class="audience-compact-header">
          <div><strong>Thiết lập đối tượng</strong><small>Vị trí, độ tuổi và điều kiện nhắm mục tiêu</small></div>
          <div class="audience-advantage-status"><span><b>Advantage+</b><small>${adSet.advantageAudienceEnabled ? 'Đang bật · Theo đối tượng đã lưu' : 'Giới hạn thủ công'}</small></span>${adSet.advantageAudienceEnabled ? '' : '<span class="off-switch" aria-label="Đã tắt"><span></span></span>'}</div>
        </div>
        <div class="audience-compact-top">
          ${audienceTemplateLibrary(state, campaign, adSet)}
          <div class="audience-compact-custom">
            ${customAudienceEditor(state, campaign, adSet)}
          </div>
        </div>
        ${savedAudienceLocked ? '<div class="saved-audience-lock"><strong>Đang dùng đối tượng đã lưu</strong><span>Thông tin được hiển thị để kiểm tra và đã khóa chỉnh sửa.</span></div>' : ''}
        <fieldset class="saved-audience-fields" ${savedAudienceLocked ? 'disabled' : ''}>
          <div class="audience-compact-body">
            ${locationEditor(state, campaign, adSet)}
            ${adSet.advantageAudienceEnabled ? `<div class="audience-card-section"><strong>Kiểm soát đối tượng · Độ tuổi tối thiểu: ${escapeHtml(adSet.audienceControlAgeMin ?? 18)}</strong><p>Khoảng tuổi và giới tính bên dưới là gợi ý cho Advantage+. Meta có thể phân phối ngoài các gợi ý này.</p></div>` : ''}
            <div class="audience-divider"></div>
            <div class="audience-card-section audience-demo-row">
              <div class="audience-field">
                <span class="field-label">${adSet.advantageAudienceEnabled ? 'Độ tuổi gợi ý' : 'Độ tuổi'}</span>
                <div class="audience-age-range">
                  ${compactAgeInput(adSet, 'ageMin', 18, 65)}
                  <span class="audience-age-sep" aria-hidden="true">—</span>
                  ${compactAgeInput(adSet, 'ageMax', 18, 65)}
                </div>
              </div>
              <div class="audience-field">
                ${genderControl(adSet)}
              </div>
              <div class="audience-field">
                ${localeSummary(adSet)}
              </div>
            </div>
            <div class="audience-divider"></div>
            ${detailedTargetingEditor(state, campaign, adSet)}
          </div>
        </fieldset>
        ${audienceTemplateManager(state, adSet)}
      </div>
      `)}
    `;
}

function accountPicker(state, campaign) {
  const accounts = state.resources.adAccounts ?? [];
  const selected = accounts.find((account) => account.id === campaign.adAccountId);
  return resourcePicker({
    label: 'Tài khoản quảng cáo',
    kind: 'adAccountId',
    clientId: campaign.clientId,
    selectedId: campaign.adAccountId,
    selectedLabel: selected ? accountDisplayLabel(selected) : 'Chọn tài khoản quảng cáo',
    placeholder: 'Tìm tên hoặc ID tài khoản...',
    emptyMessage: 'Không tìm thấy tài khoản quảng cáo phù hợp',
    disabled: accounts.length === 0,
    options: accounts.map((account) => ({
      id: account.id,
      name: account.name || account.id,
      detail: account.canAdvertise === false
        ? account.unavailableReason || 'Tài khoản quảng cáo đang bị hạn chế'
        : [account.currency, account.id].filter(Boolean).join(' · '),
      search: accountDisplayLabel(account),
      label: accountDisplayLabel(account),
      legacyText: account.id,
      restricted: account.canAdvertise === false
    }))
  });
}

function pagePicker(state, campaign) {
  const pages = state.resources.pages ?? [];
  const accountResources = state.resources.accountResourcesById?.[campaign.adAccountId];
  const promotablePageIds = new Set(accountResources?.promotablePageIds ?? []);
  const eligibilityKnown = accountResources?.pageEligibilityKnown === true;
  const selected = pages.find((page) => page.id === campaign.pageId);
  const disabled = pages.length === 0;
  const reconnectWarning = state.resources.pageDiscovery?.requiresBusinessReconnect
    ? '<div class="page-reconnect-warning"><span>Kết nối lại Meta để tải Page trong Business Portfolio.</span><a href="/api/auth/meta/start">Kết nối lại</a></div>'
    : '';
  return resourcePicker({
    label: 'Facebook Page', kind: 'pageId', clientId: campaign.clientId, selectedId: campaign.pageId,
    selectedLabel: selected ? pageDisplayLabel(selected) : 'Chọn Facebook Page',
    placeholder: 'Tìm tên Page hoặc ID...', emptyMessage: 'Không tìm thấy kết quả phù hợp', disabled,
    options: pages.map((page) => {
      const restricted = page.canAdvertise === false;
      // Meta's promote_pages can leave out Business Portfolio Pages that Ads Manager still allows, so a Page
      // missing from it stays selectable with a warning instead of being locked.
      const warning = !restricted && eligibilityKnown && !promotablePageIds.has(String(page.id));
      return {
        id: page.id,
        name: page.name || page.id,
        detail: restricted
          ? page.unavailableReason || 'Page không thể quảng cáo bằng tài khoản đã chọn'
          : warning
            ? `ID ${page.id} · Không có trong danh sách Page quảng bá của tài khoản này, Meta có thể từ chối khi tạo quảng cáo`
            : `ID ${page.id}`,
        search: pageDisplayLabel(page),
        label: pageDisplayLabel(page),
        legacyText: '',
        restricted,
        warning
      };
    })
  }) + reconnectWarning;
}

function resourcePicker({ label, kind, clientId, selectedId, selectedLabel, placeholder, emptyMessage, disabled, options }) {
  const panelId = `resource-picker-${kind}-${clientId}`;
  const listboxId = `${panelId}-options`;
  const selected = options.find((option) => option.id === selectedId);
  const initial = (selected?.name ?? '?').trim().charAt(0).toUpperCase() || '?';
  const list = options.map((option, index) => `
    <button id="${escapeHtml(`${panelId}-option-${index}`)}" type="button" class="smart-resource-option${option.id === selectedId ? ' is-selected' : ''}${option.restricted ? ' is-restricted' : ''}${option.warning ? ' is-warning' : ''}" data-smart-resource-option data-value="${escapeHtml(option.id)}" data-name="${escapeHtml(option.name)}" data-detail="${escapeHtml(option.detail)}" data-search-index="${index}" role="option" aria-selected="${option.id === selectedId}" tabindex="-1"${option.restricted ? ' disabled aria-disabled="true"' : ''}>
      <span class="smart-resource-avatar">${escapeHtml((option.name ?? '?').trim().charAt(0).toUpperCase() || '?')}</span>
      <span class="smart-resource-option-copy"><strong>${escapeHtml(option.name)}</strong><small>${escapeHtml(option.detail)}</small></span>
      ${option.restricted ? '<span class="smart-resource-restricted-badge">Hạn chế</span>' : ''}
      ${option.warning ? '<span class="smart-resource-warning-badge">Lưu ý</span>' : ''}
      <span class="smart-resource-check" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m5 12 4.2 4.2L19 6.5"/></svg></span>
    </button>`).join('');
  return `
    <div class="smart-resource-picker-shell">
      <span class="field-label">${escapeHtml(label)}</span>
      <div class="smart-resource-picker expand-select${disabled ? ' is-disabled' : ''}" data-smart-resource-picker data-expand-select data-resource-kind="${escapeHtml(kind)}" data-validation-field="${escapeHtml(kind)}" data-client-id="${escapeHtml(clientId)}">
      <input type="hidden" data-resource-combobox="${escapeHtml(kind)}" data-client-id="${escapeHtml(clientId)}" value="${escapeHtml(selected ? (selected.label ?? selectedLabel) : '')}" />
      <button type="button" class="smart-resource-trigger expand-select-trigger${selected?.restricted ? ' is-restricted' : ''}${selected?.warning ? ' is-warning' : ''}" data-action="toggle-smart-resource" data-expand-select-trigger aria-label="${escapeHtml(`${label}: ${selectedLabel}${selected?.warning ? ` (${selected.detail})` : ''}`)}" aria-haspopup="listbox" aria-expanded="false" aria-controls="${escapeHtml(panelId)}" ${disabled ? 'disabled' : ''}>
        <span class="smart-resource-trigger-left"><span class="smart-resource-avatar">${escapeHtml(initial)}</span><span class="smart-resource-trigger-text${selected ? ' is-selected' : ''}">${escapeHtml(selectedLabel)}</span>${selected?.restricted ? '<span class="smart-resource-restricted-badge">Hạn chế</span>' : ''}${selected?.warning ? '<span class="smart-resource-warning-badge">Lưu ý</span>' : ''}</span>
        <span class="smart-resource-chevron" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg></span>
      </button>
      <div class="smart-resource-panel expand-select-expand" id="${escapeHtml(panelId)}" role="dialog" aria-label="${escapeHtml(label)}" aria-hidden="true"><div class="expand-select-expand-inner"><div class="expand-select-body">
        <div class="smart-resource-search expand-select-search"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.2 4.2"/></svg><input type="search" role="combobox" aria-label="${escapeHtml(`Tìm ${label}`)}" aria-autocomplete="list" aria-controls="${escapeHtml(listboxId)}" aria-expanded="true" data-smart-resource-search data-expand-select-search placeholder="${escapeHtml(placeholder)}" autocomplete="off" /></div>
        <div class="smart-resource-options expand-select-options" id="${escapeHtml(listboxId)}" role="listbox">${list || ''}<p class="smart-resource-empty${list ? ' is-hidden' : ''}" data-smart-resource-empty>${escapeHtml(emptyMessage)}</p></div>
      </div></div>
      </div>
      </div>
    </div>`;
}

function expandableSelect({ label, clientId, field = '', action = '', audienceTarget = '', value = '', options = [], searchable = false, placeholder = 'Tìm kiếm...', unselectedLabel = '', disabled = false, ariaLabel = '' }) {
  const selected = options.find((entry) => String(entry.value) === String(value));
  const selectedLabel = selected?.label ?? unselectedLabel ?? options[0]?.label ?? 'Chọn một mục';
  const controlAttributes = [
    clientId ? `data-client-id="${escapeHtml(clientId)}"` : '',
    field ? `data-field="${escapeHtml(field)}"` : '',
    action ? `data-action="${escapeHtml(action)}"` : '',
    audienceTarget ? `data-audience-target="${escapeHtml(audienceTarget)}"` : ''
  ].filter(Boolean).join(' ');
  const rootAttributes = [
    field ? `data-select-field="${escapeHtml(field)}"` : '',
    action ? `data-select-action="${escapeHtml(action)}"` : '',
    audienceTarget ? `data-audience-target="${escapeHtml(audienceTarget)}"` : ''
  ].filter(Boolean).join(' ');
  const inputId = `expand-select-input-${clientId}-${field || action}-${audienceTarget}`;
  return `
    <div class="expand-select${disabled ? ' is-disabled' : ''}" data-expand-select ${rootAttributes} data-client-id="${escapeHtml(clientId)}">
      ${label ? `<span class="field-label">${escapeHtml(label)}</span>` : ''}
      <input id="${escapeHtml(inputId)}" type="hidden" value="${escapeHtml(value)}" ${controlAttributes} />
      <button type="button" class="expand-select-trigger" data-expand-select-trigger aria-haspopup="listbox" aria-expanded="false" ${disabled ? 'disabled' : ''} aria-label="${escapeHtml(ariaLabel || label || selectedLabel)}">
        <span class="expand-select-trigger-left"><span class="expand-select-avatar">${escapeHtml((selectedLabel.trim().charAt(0) || '?').toUpperCase())}</span><span class="expand-select-trigger-text${selected ? ' is-selected' : ''}">${escapeHtml(selectedLabel)}</span></span>
        <span class="expand-select-chevron" aria-hidden="true"><svg viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"/></svg></span>
      </button>
      <div class="expand-select-expand" aria-hidden="true"><div class="expand-select-expand-inner"><div class="expand-select-body">
        ${searchable ? `<div class="expand-select-search"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg><input type="search" data-expand-select-search placeholder="${escapeHtml(placeholder)}" autocomplete="off" /></div>` : ''}
        <div class="expand-select-options" role="listbox">
          ${options.map((entry) => `<button type="button" class="expand-select-option${String(entry.value) === String(value) ? ' is-selected' : ''}${entry.disabled ? ' is-disabled' : ''}" data-expand-select-option data-value="${escapeHtml(entry.value)}" data-label="${escapeHtml(entry.label)}" role="option" aria-selected="${String(entry.value) === String(value)}" ${entry.disabled ? 'disabled aria-disabled="true"' : ''}><span class="expand-select-option-copy"><strong>${escapeHtml(entry.label)}</strong>${entry.detail ? `<small>${escapeHtml(entry.detail)}</small>` : ''}</span><span class="expand-select-option-check" aria-hidden="true"><svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg></span></button>`).join('')}
          <p class="expand-select-empty is-hidden" data-expand-select-empty>Không tìm thấy kết quả phù hợp</p>
        </div>
      </div></div></div>
    </div>`;
}

export function accountDisplayLabel(account) {
  const name = account?.name || account?.id;
  const currency = account?.currency;
  const accountId = account?.id;
  return [name, currency, account?.name ? accountId : null]
    .filter(Boolean)
    .join(' · ');
}

export function resolveAccountComboboxSelection(accounts, value) {
  const query = String(value ?? '').trim().toLocaleLowerCase('vi');
  const account = (accounts ?? []).find((entry) => (
    String(entry.id).toLocaleLowerCase('vi') === query
    || accountDisplayLabel(entry).toLocaleLowerCase('vi') === query
  ));
  return account?.id ?? null;
}

export function pageDisplayLabel(page) {
  return `${page?.name || page?.id} · ${page?.id}`;
}

export function resolvePageComboboxSelection(pages, value, selectedPageId) {
  const query = String(value ?? '').trim().toLocaleLowerCase('vi');
  const page = (pages ?? []).find((entry) => (
    String(entry.id).toLocaleLowerCase('vi') === query
    || pageDisplayLabel(entry).toLocaleLowerCase('vi') === query
  ));
  return page?.id ?? selectedPageId;
}

export function resourceSearchScore(resource, query) {
  const normalizedQuery = normalizeResourceSearch(query);
  if (!normalizedQuery) return 0;
  const id = normalizeResourceSearch(resource?.id);
  const name = normalizeResourceSearch(resource?.name);
  const detail = normalizeResourceSearch(resource?.detail);
  const combined = `${name} ${detail} ${id}`.trim();
  const tokens = normalizedQuery.split(/\s+/).filter(Boolean);
  if (id === normalizedQuery || name === normalizedQuery) return 1000;
  if (name.startsWith(normalizedQuery) || id.startsWith(normalizedQuery)) return 850;
  const words = combined.split(/[^a-z0-9]+/).filter(Boolean);
  if (tokens.every((token) => words.some((word) => word.startsWith(token)))) return 700;
  if (combined.includes(normalizedQuery)) return 600;
  if (tokens.every((token) => combined.includes(token))) return 400;
  return -1;
}

export function highlightResourceSearch(value, query) {
  const source = String(value ?? '');
  const tokens = normalizeResourceSearch(query).split(/\s+/).filter(Boolean);
  if (!source || tokens.length === 0) return escapeHtml(source);
  const { normalized, sourceIndexes } = normalizedResourceText(source);
  const ranges = [];
  for (const token of tokens) {
    let offset = 0;
    while (offset < normalized.length) {
      const found = normalized.indexOf(token, offset);
      if (found < 0) break;
      const start = sourceIndexes[found];
      const end = (sourceIndexes[found + token.length - 1] ?? start) + 1;
      ranges.push([start, end]);
      offset = found + token.length;
    }
  }
  if (ranges.length === 0) return escapeHtml(source);
  ranges.sort((left, right) => left[0] - right[0] || right[1] - left[1]);
  const merged = [];
  for (const range of ranges) {
    const previous = merged.at(-1);
    if (previous && range[0] <= previous[1]) previous[1] = Math.max(previous[1], range[1]);
    else merged.push([...range]);
  }
  let html = '';
  let cursor = 0;
  for (const [start, end] of merged) {
    html += escapeHtml(source.slice(cursor, start));
    html += `<mark>${escapeHtml(source.slice(start, end))}</mark>`;
    cursor = end;
  }
  return html + escapeHtml(source.slice(cursor));
}

function normalizeResourceSearch(value) {
  return String(value ?? '')
    .toLocaleLowerCase('vi')
    .replace(/đ/g, 'd')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function normalizedResourceText(value) {
  let normalized = '';
  const sourceIndexes = [];
  Array.from(String(value ?? '')).forEach((character, index) => {
    const normalizedCharacter = character
      .toLocaleLowerCase('vi')
      .replace(/đ/g, 'd')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
    for (const part of normalizedCharacter) {
      normalized += /[a-z0-9]/.test(part) ? part : ' ';
      sourceIndexes.push(index);
    }
  });
  return { normalized, sourceIndexes };
}

export function prepareResourceComboboxForSearch(control) {
  if (!control.value) return;
  control.dataset.resourceComboboxLabel = control.value;
  control.value = '';
  try {
    control.showPicker?.();
  } catch { }
}

export function restoreResourceComboboxLabel(control) {
  const label = control.dataset.resourceComboboxLabel;
  if (!label || control.value) return;
  control.value = label;
  delete control.dataset.resourceComboboxLabel;
}

function templateCardPicker({ kind, title, description, templates, selectedId, selectedTemplate, modified, clientId, loading, disabled }) {
  const applyAction = kind === 'seeding' ? 'apply-seeding-template' : 'apply-conversation-template';
  const newAction = kind === 'seeding' ? 'new-seeding-template' : 'new-conversation-template';
  const saveAction = kind === 'seeding' ? 'save-seeding-template' : 'update-conversation-template';
  const deleteAction = kind === 'seeding' ? 'delete-seeding-template' : 'delete-conversation-template';
  const emptyCopy = loading ? 'Đang tải thư viện mẫu...' : 'Chưa có mẫu nào trong thư viện.';
  return `
    <section class="template-card-picker ${kind}-template-card-picker" aria-label="${escapeHtml(title)}">
      <div class="template-card-picker-heading">
        <div><span class="eyebrow">Thư viện mẫu</span><h3>${escapeHtml(title)}</h3><p>${escapeHtml(description)}</p></div>
        ${loading ? '<span class="template-state-badge">Đang tải...</span>' : ''}
      </div>
      <div class="template-card-picker-controls">
        <details class="template-card-dropdown" data-template-card-dropdown>
          <summary aria-label="Mở danh sách ${escapeHtml(title)}">
            <span class="template-dropdown-current"><small>Mẫu đang áp dụng</small><strong>${escapeHtml(selectedTemplate?.name ?? 'Chọn một mẫu có sẵn')}</strong></span>
            <span class="template-dropdown-plus" aria-hidden="true"><span class="line-h"></span><span class="line-v"></span></span>
          </summary>
          <div class="template-card-dropdown-panel">
            <div class="template-card-dropdown-inner">
              <label class="template-card-search">
                <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><path d="m16 16 4 4"></path></svg>
                <input type="search" data-template-card-search placeholder="Tìm ${kind === 'seeding' ? 'mẫu seeding' : 'mẫu cuộc trò chuyện'}..." autocomplete="off" />
              </label>
              <div class="template-card-grid">
              <button type="button" class="template-choice-card is-create" data-action="${newAction}" data-client-id="${escapeHtml(clientId)}" ${disabled || loading ? 'disabled' : ''}>
                <span class="template-choice-mark" aria-hidden="true">+</span>
                <span class="template-choice-copy"><strong>Tạo mẫu mới</strong><small>Thêm card vào thư viện</small></span>
              </button>
              ${templates.length ? templates.map((template) => `
                <div class="template-choice-wrap${template.id === selectedId ? ' is-selected' : ''}">
                  <button type="button" class="template-choice-card${template.id === selectedId ? ' is-selected' : ''}" data-action="${applyAction}" data-client-id="${escapeHtml(clientId)}" data-template-id="${escapeHtml(template.id)}" ${disabled || loading ? 'disabled' : ''} aria-pressed="${template.id === selectedId}">
                    <span class="template-choice-mark" aria-hidden="true">${template.id === selectedId ? '✓' : kind === 'seeding' ? 'S' : 'M'}</span>
                    <span class="template-choice-copy"><strong>${escapeHtml(template.name)}</strong><small>${kind === 'seeding' ? `${template.items?.length ?? 0} bình luận` : 'Mẫu Messenger'}</small></span>
                  </button>
                  <button type="button" class="template-choice-delete" data-action="${deleteAction}" data-client-id="${escapeHtml(clientId)}" data-template-id="${escapeHtml(template.id)}" aria-label="Xóa mẫu ${escapeHtml(template.name)}" title="Xóa mẫu" ${disabled || loading ? 'disabled' : ''}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16"></path><path d="M9 7V4h6v3"></path><path d="M7 7l1 13h8l1-13"></path><path d="M10 11v5M14 11v5"></path></svg></button>
                </div>`).join('') : `<p class="template-card-empty">${emptyCopy}</p>`}
                <p class="template-card-empty is-hidden" data-template-card-empty-search>Không tìm thấy mẫu phù hợp.</p>
              </div>
            </div>
          </div>
        </details>
        ${selectedTemplate ? `<button type="button" class="button-primary template-quick-save" data-action="${saveAction}" data-client-id="${escapeHtml(clientId)}" ${disabled || loading || !modified ? 'disabled' : ''}>Lưu thay đổi</button>` : ''}
      </div>
      ${kind === 'seeding' ? '<p class="template-required-note"><span aria-hidden="true">!</span>Bắt buộc chọn trước khi tạo quảng cáo</p>' : ''}
    </section>`;
}

function seedingEditor(state, campaign) {
  const seeding = campaign.seeding ?? {};
  const items = seeding.items ?? [];
  const templates = state.resources.seedingTemplates ?? [];
  const selectedTemplate = templates.find((template) => template.id === seeding.templateId);
  const modified = selectedTemplate ? isSeedingModified(seeding, selectedTemplate) : true;
  const loading = Boolean(state.ui?.loadingSeedingTemplates);
  const loadError = state.resources.seedingTemplatesError;
  const loaded = state.resources.seedingTemplatesLoaded === true;
  const canManageComments = state.resources.capabilities?.pagesManageEngagement === true;
  const canUseLibrary = Boolean(state.connected || state.ui?.localDemoResources)
    && loaded
    && !loading
    && !loadError;
  const unavailableIdentity = (!loaded || loadError) && !selectedTemplate && seeding.templateId
    ? `<option value="${escapeHtml(seeding.templateId)}" selected>${escapeHtml(seeding.templateName || 'Mẫu đã chọn')} · chưa tải được thư viện</option>`
    : '';

  return `
    <div class="seeding-editor" data-seeding-section data-validation-field="seeding">
      ${templateCardPicker({
    kind: 'seeding',
    title: 'Chọn mẫu seeding',
    description: 'Bắt buộc chọn một mẫu cho chiến dịch này trước khi tạo quảng cáo.',
    templates,
    selectedId: seeding.templateId,
    selectedTemplate,
    modified,
    clientId: campaign.clientId,
    loading,
    disabled: !canUseLibrary
  })}
      ${loadError ? `
        <div class="seeding-library-error" role="alert">
          <span>${escapeHtml(loadError)}</span>
          <button type="button" class="button-secondary" data-action="retry-seeding-templates" data-client-id="${escapeHtml(campaign.clientId)}">Thử lại</button>
        </div>` : ''}
      ${unavailableIdentity ? '<p class="template-modified-note">Mẫu đã chọn chưa tải được từ thư viện. Hãy thử tải lại.</p>' : ''}
      ${selectedTemplate ? '' : `
        <div class="seeding-new-template-bar">
          <label class="field seeding-template-name">
            <span class="field-label">Tên mẫu mới</span>
            <input data-client-id="${escapeHtml(campaign.clientId)}" data-seeding-field="templateName" value="${escapeHtml(seeding.templateName)}" maxlength="120" placeholder="Ví dụ: Chăm sóc sau quảng cáo" />
          </label>
          <button type="button" class="button-primary" data-action="save-seeding-template" data-client-id="${escapeHtml(campaign.clientId)}" ${!canUseLibrary || !seeding.templateName?.trim() ? 'disabled' : ''}>Lưu mẫu mới</button>
        </div>`}
      <div class="seeding-composer" data-seeding-composer>
        <div class="seeding-composer-heading">
          <div>
            <span class="eyebrow">Nội dung mẫu đang chọn</span>
            <h2>Kiểm tra và chỉnh sửa bình luận</h2>
            <p>Mỗi Post ID duy nhất nhận bộ comment này một lần. Thứ tự bên dưới cũng là thứ tự gửi.</p>
          </div>
          <span class="required-feature-badge">Bắt buộc</span>
        </div>
        ${canManageComments ? '' : `
          <div class="seeding-capability-warning" role="note">
            <span>Meta chưa cấp <strong>pages_manage_engagement</strong>. Ads vẫn tạo được nhưng seeding không thể bình luận cho đến khi kết nối lại với quyền này.</span>
            <a href="/api/auth/meta/start">Kết nối lại Meta</a>
          </div>`}
        <div class="seeding-list-heading">
          <div><strong>Bình luận seeding</strong><small>Không giới hạn số lượng bình luận cho mỗi Post ID.</small></div>
          <span>${items.length}</span>
        </div>
        <div class="seeding-card-list">
          ${items.map((item, index) => seedingCard(state, campaign, item, index, items.length)).join('')}
        </div>
        <button type="button" class="button-secondary inline-add-button seeding-add-comment" data-action="add-seeding-item" data-client-id="${escapeHtml(campaign.clientId)}">+ Thêm bình luận mới</button>
      </div>
    </div>`;
}

function seedingCard(state, campaign, item, index, itemCount) {
  const inputId = `seeding-image-${campaign.clientId}-${item.id}`;
  const uploadKey = `${campaign.clientId}:${item.id}`;
  const uploadEntry = state.ui?.seedingUploads?.[uploadKey];
  const upload = isSeedingUploadTargetCurrent(state, uploadEntry?.uploadTarget)
    ? uploadEntry
    : null;
  const previewUrl = upload?.previewUrl || item.imagePreviewUrl;
  const fileName = upload?.fileName || item.imageName;
  const mimeType = upload?.fileType || item.imageMimeType || '';
  const isVideo = mimeType.startsWith('video/') || /\.(?:mp4|mov)$/i.test(fileName || '');
  return `
    <article class="seeding-card" data-seeding-item-id="${escapeHtml(item.id)}">
      <div class="seeding-card-heading">
        <div class="seeding-card-title">
          <span class="seeding-card-index">${index + 1}</span>
          <div><strong>Bình luận ${index + 1}</strong><small>Gửi theo thứ tự đã sắp xếp</small></div>
        </div>
        <div class="seeding-order-actions">
          <button type="button" class="icon-button seeding-icon-button" data-action="move-seeding-item" data-client-id="${escapeHtml(campaign.clientId)}" data-item-id="${escapeHtml(item.id)}" data-offset="-1" aria-label="Đưa bình luận ${index + 1} lên" ${index === 0 ? 'disabled' : ''}>↑</button>
          <button type="button" class="icon-button seeding-icon-button" data-action="move-seeding-item" data-client-id="${escapeHtml(campaign.clientId)}" data-item-id="${escapeHtml(item.id)}" data-offset="1" aria-label="Đưa bình luận ${index + 1} xuống" ${index === itemCount - 1 ? 'disabled' : ''}>↓</button>
          <button type="button" class="row-remove" data-action="remove-seeding-item" data-client-id="${escapeHtml(campaign.clientId)}" data-item-id="${escapeHtml(item.id)}" aria-label="Xóa bình luận ${index + 1}" ${itemCount <= 1 ? 'disabled' : ''}>×</button>
        </div>
      </div>
      <div class="seeding-card-content">
        <label class="field seeding-message-field">
          <span class="field-label">Nội dung bình luận</span>
          <textarea data-client-id="${escapeHtml(campaign.clientId)}" data-item-id="${escapeHtml(item.id)}" data-seeding-field="message" rows="6" maxlength="8000" placeholder="Nhập nội dung bình luận, có thể kèm link...">${escapeHtml(item.message)}</textarea>
          <small>Link được giữ dạng văn bản; tool không tự tải nội dung URL.</small>
        </label>
        <div class="seeding-image-control${upload ? ' is-uploading' : ''}">
          <input id="${escapeHtml(inputId)}" class="media-file-input" type="file" accept="image/jpeg,image/png,video/mp4,video/quicktime,.mov" aria-label="Chọn media cho bình luận ${index + 1}" data-action="upload-seeding-image" data-client-id="${escapeHtml(campaign.clientId)}" data-item-id="${escapeHtml(item.id)}" ${upload ? 'disabled' : ''} />
          ${previewUrl ? (isVideo ? `<video class="seeding-thumbnail" src="${escapeHtml(previewUrl)}" controls preload="metadata" aria-label="${escapeHtml(fileName ? `Xem trước ${fileName}` : `Video bình luận ${index + 1}`)}"></video>` : `<img class="seeding-thumbnail" src="${escapeHtml(previewUrl)}" alt="${escapeHtml(fileName ? `Xem trước ${fileName}` : `Ảnh bình luận ${index + 1}`)}" />`) : '<div class="seeding-image-empty"><strong>Thêm ảnh hoặc video</strong><small>JPEG, PNG, MP4 hoặc MOV · tối đa 200 MB</small></div>'}
          ${upload ? seedingUploadProgress(upload, uploadKey) : ''}
          <div class="seeding-image-actions">
            <button type="button" class="button-secondary seeding-file-trigger" data-action="choose-seeding-image" data-client-id="${escapeHtml(campaign.clientId)}" data-input-id="${escapeHtml(inputId)}" aria-controls="${escapeHtml(inputId)}" aria-label="${item.imageMediaId ? 'Thay' : 'Tải'} media bình luận ${index + 1}" ${upload ? 'disabled' : ''}>${item.imageMediaId ? 'Thay media' : 'Chọn ảnh/video'}</button>
            ${item.imageMediaId && !upload ? `<button type="button" class="icon-button seeding-icon-button" data-action="remove-seeding-image" data-client-id="${escapeHtml(campaign.clientId)}" data-item-id="${escapeHtml(item.id)}" aria-label="Xóa media bình luận ${index + 1}">×</button>` : ''}
          </div>
          ${item.imageMediaId && !upload ? `<small>${escapeHtml(item.imageName || 'Ảnh seeding')} · ${formatFileSize(item.imageSize)}</small>` : ''}
        </div>
      </div>
    </article>`;
}

function seedingUploadProgress(upload, uploadKey) {
  const progress = Math.max(0, Math.min(100, Math.round(Number(upload.progress) || 0)));
  return `
    <div class="media-upload-overlay seeding-upload-overlay" data-seeding-upload-key="${escapeHtml(uploadKey)}" aria-live="polite">
      <div class="media-upload-copy">
        <strong data-seeding-progress-value>${progress}%</strong>
        <span>Đang tải media seeding</span>
        <small>${escapeHtml(upload.fileName)} · ${formatFileSize(upload.fileSize)}</small>
      </div>
      <div class="media-progress-track" role="progressbar" aria-label="Tiến độ tải ${escapeHtml(upload.fileName)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progress}" data-seeding-progress>
        <span data-seeding-progress-fill style="width: ${progress}%"></span>
      </div>
    </div>`;
}

function campaignPageName(state, campaign) {
  const page = (state.resources.pages ?? [])
    .find((entry) => entry.id === campaign.pageId);
  return page?.name?.trim() || campaign.pageId || 'Chưa chọn Facebook Page';
}

function renderAdEditor(state, campaign, adSet, ad) {
  const sharedCount = sharedCreativeCount(state, ad.clientId);
  return `
    ${section('', '', `
      <div class="field-grid two-columns">
        ${textField('Tên quảng cáo', ad, 'name', { placeholder: 'Nhập tên quảng cáo' })}
        ${lockedField('Facebook Page', campaignPageName(state, campaign))}
      </div>`)}
    ${section('Nội dung quảng cáo', 'Chọn ảnh hoặc video và điền nội dung hiển thị.', `
      ${sharedCount > 1 ? `<div class="shared-creative-notice" role="status"><strong>Đang dùng chung bài quảng cáo với ${sharedCount} quảng cáo</strong><span>Đổi nội dung, media, Page hoặc Cuộc trò chuyện sẽ tự tách thành bài riêng.</span></div>` : ''}
      <div class="creative-layout">
        <div class="field-stack creative-copy-fields">
          <label class="field">
            <span class="field-label">Văn bản chính</span>
            <textarea data-client-id="${escapeHtml(ad.clientId)}" data-field="primaryText" rows="5" placeholder="Viết nội dung quảng cáo...">${escapeHtml(ad.primaryText)}</textarea>
          </label>
          ${textField('Tiêu đề', ad, 'headline', { placeholder: 'Tiêu đề ngắn gọn' })}
        </div>
        ${mediaUploader(state, ad)}
      </div>`)}
    ${section('Cuộc trò chuyện', '', conversationEditor(state, campaign, adSet, ad))}
    ${section('Theo dõi', '', websiteTrackingEditor(state, campaign, ad))}
    `;
}

function websiteTrackingEditor() {
  return `
    <label class="website-tracking-toggle">
      <input type="checkbox" checked disabled />
      <span>Sự kiện trên trang web</span>
    </label>
    <div class="website-tracking-details">
      <label class="field">
        <span class="field-label">Meta Pixel</span>
        <input type="text" value="${WEBSITE_PIXEL_ID}" readonly />
      </label>
      <p class="field-hint">Đã cố định cho mọi quảng cáo.</p>
    </div>`;
}

export function renderMediaUploader(state, ad) {
  const upload = state.ui?.mediaUploads?.[ad.clientId];
  const media = upload ?? {
    kind: ad.mediaKind,
    previewUrl: ad.mediaPreviewUrl,
    fileName: ad.mediaFileName,
    fileSize: ad.mediaFileSize
  };
  const inputId = `media-file-${ad.clientId}`;
  const hasPreview = Boolean(media.previewUrl);
  const canUploadFromNetwork = state.connected === true;
  return `
    <div class="media-uploader-shell">
      <div class="media-dropzone${hasPreview ? ' has-media' : ''}${upload ? ' is-uploading' : ''}" data-media-dropzone="${escapeHtml(ad.clientId)}" data-validation-field="mediaId">
        <input id="${escapeHtml(inputId)}" class="media-file-input" type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime,.mov" data-action="upload-media" data-client-id="${escapeHtml(ad.clientId)}" ${upload ? 'disabled' : ''} />
        ${hasPreview
      ? `<div class="media-preview-frame">${mediaPreview(media.kind, media.previewUrl, media.fileName)}</div>`
      : mediaEmptyState(inputId)}
        ${upload ? mediaUploadProgress(upload, ad.clientId) : uploadedMediaStatus(ad, inputId)}
      </div>
      ${canUploadFromNetwork ? `<div class="media-network-upload">
        <input type="text" class="media-network-path" data-network-path data-client-id="${escapeHtml(ad.clientId)}" placeholder="Dán đường dẫn \\\\192.168.1.6\\marketing\\..." autocomplete="off" spellcheck="false" ${upload ? 'disabled' : ''} />
        <button type="button" class="media-network-submit" data-action="upload-media-from-network-path" data-client-id="${escapeHtml(ad.clientId)}" ${upload ? 'disabled' : ''}>Tải từ ổ chung qua Telegram</button>
      </div>` : ''}
    </div>`;
}

const mediaUploader = renderMediaUploader;

function mediaPreview(kind, url, fileName) {
  if (kind === 'video') {
    return `<video src="${escapeHtml(url)}" controls playsinline preload="metadata" aria-label="Xem trước video ${escapeHtml(fileName || 'quảng cáo')}"></video>`;
  }
  return `<img src="${escapeHtml(url)}" alt="${escapeHtml(fileName ? `Xem trước ${fileName}` : 'Xem trước banner quảng cáo')}" />`;
}

function mediaEmptyState(inputId) {
  return `
    <label class="media-empty-trigger" for="${escapeHtml(inputId)}">
      <span class="upload-mark" aria-hidden="true">
        <svg viewBox="0 0 24 24" focusable="false"><path d="M12 16V4"></path><polyline points="7 9 12 4 17 9"></polyline><path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"></path></svg>
      </span>
      <strong>Kéo thả vào đây hoặc <span>chọn tệp</span></strong>
      <small>JPG, PNG, WebP, MP4 hoặc MOV · Tối đa 500 MB</small>
    </label>`;
}

function mediaUploadProgress(upload, clientId) {
  const progress = Math.max(0, Math.min(100, Math.round(Number(upload.progress) || 0)));
  const { statusText, detailText } = mediaUploadText(upload);
  return `
    <div class="media-upload-overlay" data-upload-client-id="${escapeHtml(clientId)}" aria-live="polite">
      <div class="media-upload-copy">
        <strong data-media-progress-value>${progress}%</strong>
        <span data-media-progress-status>${escapeHtml(statusText)}</span>
        <small data-media-progress-detail>${escapeHtml(detailText)}</small>
      </div>
      <div class="media-progress-track" role="progressbar" aria-label="Tiến độ tải ${escapeHtml(upload.fileName)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progress}" data-media-progress>
        <span data-media-progress-fill style="width: ${progress}%"></span>
      </div>
    </div>`;
}

export function mediaUploadText(upload = {}) {
  const telegramUpload = upload.source === 'telegram';
  const uploadedBytes = Math.max(0, Number(upload.uploadedBytes) || 0);
  const totalBytes = Math.max(0, Number(upload.totalBytes) || 0);
  const statusText = telegramUpload
    ? upload.status === 'connecting'
      ? 'Đang tạo yêu cầu'
      : upload.status === 'uploading'
        ? 'Bot máy công ty đang tải file'
        : 'Đang chờ bot máy công ty'
    : `Đang tải ${upload.kind === 'video' ? 'video' : 'banner'} lên`;
  const detailText = telegramUpload
    ? totalBytes > 0
      ? `Đã tải ${formatFileSize(uploadedBytes)} / ${formatFileSize(totalBytes)}`
      : 'File sẽ tự xuất hiện khi tải xong.'
    : `${upload.fileName} · ${formatFileSize(upload.fileSize)}`;
  return { statusText, detailText };
}

function uploadedMediaStatus(ad, inputId) {
  if (!ad.mediaId || !ad.mediaPreviewUrl) return '';
  const fallbackName = ad.mediaKind === 'video' ? 'Video quảng cáo' : 'Banner quảng cáo';
  const fileName = ad.mediaFileName || fallbackName;
  return `
    <div class="media-upload-footer" role="status">
      <span class="media-upload-success"><b aria-hidden="true">✓</b><span class="media-upload-meta"><strong>Đã tải lên</strong><small class="media-upload-filename" title="${escapeHtml(fileName)}">${escapeHtml(fileName)}</small><small class="media-upload-size">${formatFileSize(ad.mediaFileSize)}</small></span></span>
      <span class="media-upload-actions">
        <label class="media-replace-trigger" for="${escapeHtml(inputId)}">Thay tệp</label>
        <button type="button" class="media-remove-trigger" data-action="remove-media" data-client-id="${escapeHtml(ad.clientId)}">Xóa</button>
      </span>
    </div>`;
}

function formatFileSize(bytes) {
  const size = Math.max(0, Number(bytes) || 0);
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function formatTransferSpeed(speedBps) {
  return `${(Math.max(0, Number(speedBps) || 0) / (1024 * 1024)).toFixed(1)} MB/s`;
}

function formatTransferEta(etaSeconds, progress) {
  if (progress >= 100) return 'ETA 0 giây';
  const value = Number(etaSeconds);
  if (!Number.isFinite(value)) return 'ETA --';
  const seconds = Math.max(0, Math.ceil(value));
  if (seconds >= 3600) return `ETA ${Math.floor(seconds / 3600)} giờ ${Math.ceil((seconds % 3600) / 60)} phút`;
  if (seconds >= 60) return `ETA ${Math.ceil(seconds / 60)} phút`;
  return `ETA ${seconds} giây`;
}

function conversationEditor(state, campaign, adSet, ad) {
  const conversation = ad.conversation ?? {};
  const templates = state.resources.conversationTemplates ?? [];
  const selectedTemplate = templates.find((template) => template.id === conversation.sourceTemplateId);
  const modified = selectedTemplate ? isConversationModified(conversation, selectedTemplate) : true;
  const loading = Boolean(state.ui?.loadingConversationTemplates);
  const canUseLibrary = Boolean(state.connected);
  const pageName = campaignPageName(state, campaign);

  return `
    <div class="conversation-shell">
      ${templateCardPicker({
    kind: 'conversation',
    title: 'Mẫu cuộc trò chuyện',
    description: '',
    templates,
    selectedId: conversation.sourceTemplateId,
    selectedTemplate,
    modified,
    clientId: ad.clientId,
    loading,
    disabled: !canUseLibrary
  })}
      ${selectedTemplate ? '' : `
        <div class="conversation-new-template-bar">
          <label class="field conversation-template-name">
            <span class="field-label">Tên mẫu mới</span>
            <input data-client-id="${escapeHtml(ad.clientId)}" data-conversation-field="templateName" value="${escapeHtml(conversation.templateName)}" maxlength="120" placeholder="Ví dụ: Dịch vụ triệt nách nữ" />
          </label>
          <button type="button" class="button-primary" data-action="save-conversation-template" data-client-id="${escapeHtml(ad.clientId)}" ${!canUseLibrary || loading || !conversation.templateName?.trim() ? 'disabled' : ''}>Lưu mẫu mới</button>
        </div>`}
      <div class="conversation-destination">
        <span class="destination-logo" aria-hidden="true">M</span>
        <div><strong>Messenger · Cuộc trò chuyện</strong><small>Tool tự tạo đúng button-template JSON khi đăng quảng cáo.</small></div>
        <span class="locked-tag">Đã khóa</span>
      </div>
      <div class="conversation-composer" data-conversation-composer data-validation-field="conversation">
        <div class="conversation-composer-heading">
          <div>
            <span class="eyebrow">Nội dung gửi khách</span>
            <h3>Soạn nội dung cuộc trò chuyện</h3>
          </div>
          <span class="conversation-status-pill">0–3 nút web</span>
        </div>
        <div class="conversation-builder">
          <div class="conversation-form">
            <label class="field conversation-message-field">
              <span class="field-label">Nội dung tin nhắn</span>
              <textarea data-client-id="${escapeHtml(ad.clientId)}" data-conversation-field="greeting" rows="7" maxlength="${conversation.imageMediaId ? 80 : 640}" placeholder="Xin chào {{user_full_name}}, ...">${escapeHtml(conversation.greeting)}</textarea>
            </label>
            ${conversationImagePicker(state, ad)}
            ${sharedCustomerActionsEditor(ad.clientId, conversation.customerActions ?? [])}
            <details class="conversation-json-preview">
              <summary><span>JSON sẽ gửi Meta</span><small>Dành cho kiểm tra kỹ thuật</small></summary>
              <pre>${escapeHtml(formatConversationMessageJson(conversation))}</pre>
            </details>
          </div>
          ${conversationPreview(pageName, conversation)}
        </div>
      </div>
    </div>`;
}

function conversationImagePicker(state, ad) {
  const conversation = ad.conversation ?? {};
  const upload = state.ui?.conversationImageUploads?.[ad.clientId];
  const previewUrl = upload?.previewUrl || conversation.imagePreviewUrl;
  const inputId = `conversation-image-${ad.clientId}`;
  return `
    <div class="conversation-image-picker${previewUrl ? ' has-image' : ''}">
      <input id="${escapeHtml(inputId)}" class="media-file-input" type="file" accept="image/jpeg,image/png,image/webp" data-action="upload-conversation-image" data-client-id="${escapeHtml(ad.clientId)}" ${upload ? 'disabled' : ''} />
      ${previewUrl ? `
        <img src="${escapeHtml(previewUrl)}" alt="Xem trước ảnh cuộc trò chuyện" />
        <div class="conversation-image-meta"><span><strong>${upload ? 'Đang tải ảnh' : 'Ảnh cuộc trò chuyện'}</strong><small>${escapeHtml(upload?.fileName || conversation.imageName || '')}</small></span><span>
          <label for="${escapeHtml(inputId)}">Thay ảnh</label>
          <button type="button" data-action="remove-conversation-image" data-client-id="${escapeHtml(ad.clientId)}" ${upload ? 'disabled' : ''}>Xóa</button>
        </span></div>` : `
        <label class="conversation-image-empty" for="${escapeHtml(inputId)}"><strong>Chọn ảnh cho cuộc trò chuyện</strong><small>JPG, PNG hoặc WebP · Khi có ảnh, lời chào tối đa 80 ký tự</small></label>`}
    </div>`;
}

function sharedCustomerActionsEditor(clientId, actions) {
  return `
    <div class="conversation-subsection">
      <div class="conversation-subsection-heading">
        <div><strong>Các nút mở trang web</strong><small>Không bắt buộc · tối đa 3 nút, URL dùng HTTPS.</small></div>
        <span>${actions.length}/3</span>
      </div>
      <div class="conversation-action-list">
        ${actions.map((action, index) => `
          <div class="conversation-action-card">
            <div class="action-card-heading">
              <strong>Nút #${index + 1}</strong>
              <button type="button" class="row-remove" data-action="remove-customer-action" data-client-id="${escapeHtml(clientId)}" data-item-id="${escapeHtml(action.id)}" aria-label="Xóa nút ${index + 1}">×</button>
            </div>
            <label class="field">
              <span class="field-label">Tiêu đề nút</span>
              <input data-client-id="${escapeHtml(clientId)}" data-conversation-collection="customerActions" data-item-id="${escapeHtml(action.id)}" data-item-field="label" value="${escapeHtml(action.label)}" maxlength="20" placeholder="Đăng Ký Ngay" />
            </label>
            <label class="field">
              <span class="field-label">URL trang web</span>
              <input data-client-id="${escapeHtml(clientId)}" data-conversation-collection="customerActions" data-item-id="${escapeHtml(action.id)}" data-item-field="value" value="${escapeHtml(action.value)}" placeholder="https://lgclinic.vn/..." inputmode="url" />
            </label>
          </div>`).join('')}
      </div>
      <button type="button" class="button-secondary inline-add-button" data-action="add-customer-action" data-client-id="${escapeHtml(clientId)}" ${actions.length >= 3 ? 'disabled' : ''}>+ Thêm nút</button>
    </div>`;
}



function conversationPreview(pageName, conversation) {
  return `
    <aside class="conversation-preview" aria-label="Xem trước Cuộc trò chuyện">
      <div class="conversation-preview-label"><strong>Xem trước trên Messenger</strong><small>Hiển thị mô phỏng</small></div>
      <div class="conversation-preview-heading"><span class="messenger-avatar">M</span><div><strong>${escapeHtml(pageName)}</strong><small>Đoạn chat kinh doanh</small></div></div>
      <div class="conversation-phone-screen">
        <div class="preview-spacer"></div>
        ${conversation.imagePreviewUrl ? `<img class="preview-conversation-image" src="${escapeHtml(conversation.imagePreviewUrl)}" alt="Ảnh cuộc trò chuyện" />` : ''}
        <div class="preview-message-row"><span class="mini-avatar">M</span><div class="preview-bubble">${escapeHtml(conversation.greeting || 'Lời chào sẽ hiển thị tại đây')}</div></div>
        ${(conversation.customerActions ?? []).length ? `<div class="preview-actions">${conversation.customerActions.map((action) => `<button type="button" tabindex="-1">${escapeHtml(action.label || 'Nút hành động')}<small>${escapeHtml(compactUrl(action.value))}</small></button>`).join('')}</div>` : ''}
        <div class="preview-composer"><span>Aa</span><i>☺</i><b>👍</b></div>
      </div>
      <p>Bản xem trước mô phỏng để kiểm tra nội dung.</p>
    </aside>`;
}

function compactUrl(value) {
  try {
    const url = new URL(value);
    return `${url.hostname}${url.pathname === '/' ? '' : url.pathname}`.slice(0, 42);
  } catch {
    return value || 'Chưa nhập URL';
  }
}

function audienceTemplateLibrary(state, campaign, adSet) {
  const toolTemplates = state.resources?.audienceTemplates ?? [];
  const campaignResources = resourcesForCampaign(state, campaign);
  const metaTemplates = campaignResources.savedAudiences ?? [];
  const selectedSource = isToolAudienceTemplateId(adSet.audienceTemplateId)
    ? 'tool'
    : adSet.audienceTemplateId ? 'meta' : 'manual';
  const selectedTemplate = selectedSource === 'tool'
    ? toolTemplates.find((template) => template.id === adSet.audienceTemplateId)
    : metaTemplates.find((template) => template.id === adSet.audienceTemplateId);
  const loadingMeta = state.ui?.loadingAccountResources
    && state.ui?.loadingAccountId === campaign.adAccountId;
  const loadingTool = Boolean(state.ui?.loadingAudienceTemplates);
  const libraryError = state.resources?.audienceTemplatesError;
  return `
    <section class="template-library saved-audience-picker" data-audience-template-library data-audience-source="${selectedSource}">
      <div class="template-library-heading">
        <div><strong>Thư viện đối tượng</strong><small>Dùng mẫu riêng của bạn hoặc Saved Audience chỉ đọc từ Meta Ads.</small></div>
        ${loadingTool ? '<span class="template-state-badge">Đang tải thư viện...</span>' : ''}
      </div>
      ${libraryError ? `
        <div class="audience-library-alert" role="alert">
          <span>${escapeHtml(libraryError)}</span>
          <button type="button" class="button-secondary" data-action="retry-audience-templates" data-client-id="${escapeHtml(adSet.clientId)}">Thử lại</button>
        </div>` : ''}
      <div class="saved-audience-select-field">
        <span class="field-label">Sử dụng đối tượng đã lưu</span>
        ${expandableSelect({
    label: '',
    ariaLabel: 'Sử dụng đối tượng đã lưu',
    clientId: adSet.clientId,
    action: 'select-audience-template',
    value: adSet.audienceTemplateId ?? '',
    searchable: true,
    placeholder: 'Tìm tên đối tượng...',
    disabled: loadingTool,
    options: [
      { value: '', label: 'Tạo đối tượng mới', detail: 'Thiết lập thủ công' },
      ...toolTemplates.map((template) => toolAudienceTemplateEntry(template, campaign, campaignResources.customAudiences ?? [])),
      ...metaTemplates.map((template) => ({
        value: template.id,
        label: template.name,
        detail: template.compatible === false ? 'Meta Ads · Không tương thích' : 'Meta Ads · Chỉ đọc',
        disabled: loadingMeta || !campaign.adAccountId || template.compatible === false
      }))
    ]
  })}
      </div>
      ${selectedTemplate
    ? (adSet.audienceTemplateWarning ? `<div class="audience-library-alert audience-library-warning" role="status"><span>${escapeHtml(adSet.audienceTemplateWarning)}. Các thiết lập hợp lệ khác vẫn được giữ nguyên.</span></div>` : '')
    : (toolTemplates.length || metaTemplates.length) ? '<p class="template-modified-note">Chọn một mẫu để tự động điền đầy đủ vị trí, tuổi, giới tính và nhắm mục tiêu.</p>' : `
        <div class="saved-audience-empty">
          <span>Chưa có mẫu riêng. Điền targeting bên dưới rồi lưu mẫu đầu tiên.</span>
        </div>`}
    </section>`;
}

function audienceTemplateManager(state, adSet) {
  const selectedSource = isToolAudienceTemplateId(adSet.audienceTemplateId)
    ? 'tool'
    : adSet.audienceTemplateId ? 'meta' : 'manual';
  const loading = Boolean(state.ui?.loadingAudienceTemplates);
  const templateName = adSet.audienceTemplateName ?? '';
  const savingDisabled = loading || !templateName.trim();

  if (selectedSource === 'meta') {
    return `
      <div class="audience-meta-readonly" data-audience-source="meta">
        <span>Saved Audience từ Meta chỉ dùng để áp dụng, không thể sửa hoặc xóa trong tool.</span>
        <button type="button" class="button-secondary" data-action="new-audience-template" data-client-id="${escapeHtml(adSet.clientId)}">Tạo đối tượng mới</button>
      </div>`;
  }

  return `
    <div class="audience-template-manager" data-audience-source="${selectedSource}">
      <label class="field audience-template-name">
        <span class="field-label">Tên đối tượng</span>
        <input data-audience-field="templateName" data-client-id="${escapeHtml(adSet.clientId)}" value="${escapeHtml(templateName)}" placeholder="Ví dụ: Nữ làm đẹp 23–45 · Hồ Chí Minh" />
      </label>
      <div class="audience-template-actions">
        <button type="button" class="button-primary" data-action="save-audience-template" data-client-id="${escapeHtml(adSet.clientId)}" ${savingDisabled ? 'disabled' : ''}>${selectedSource === 'tool' ? 'Lưu thay đổi' : 'Lưu đối tượng'}</button>
        ${selectedSource === 'tool' ? `
          <button type="button" class="button-secondary" data-action="duplicate-audience-template" data-client-id="${escapeHtml(adSet.clientId)}" ${loading ? 'disabled' : ''}>Nhân bản</button>
          <button type="button" class="button-secondary" data-action="new-audience-template" data-client-id="${escapeHtml(adSet.clientId)}">Tạo đối tượng mới</button>
          <button type="button" class="button-danger-subtle" data-action="delete-audience-template" data-client-id="${escapeHtml(adSet.clientId)}" ${loading ? 'disabled' : ''}>Xóa</button>` : ''}
      </div>
    </div>`;
}

function toolAudienceTemplateOption(template, campaign, adSet, customAudiences) {
  const compatibility = toolAudienceTemplateCompatibility(template, campaign.adAccountId, customAudiences);
  const skippedCount = compatibility.skippedCustomAudienceIds?.length ?? 0;
  const label = skippedCount > 0
    ? `${template.name} · Bỏ qua ${skippedCount} Custom Audience`
    : template.name;
  return `<option value="${escapeHtml(template.id)}" ${template.id === adSet.audienceTemplateId ? 'selected' : ''}>${escapeHtml(label)}</option>`;
}

function toolAudienceTemplateEntry(template, campaign, customAudiences) {
  const compatibility = toolAudienceTemplateCompatibility(template, campaign.adAccountId, customAudiences);
  const skippedCount = compatibility.skippedCustomAudienceIds?.length ?? 0;
  return {
    value: template.id,
    label: skippedCount > 0 ? `${template.name} · Bỏ qua ${skippedCount} Custom Audience` : template.name,
    detail: 'Thư viện của tôi'
  };
}

function customAudienceEditor(state, campaign, adSet) {
  const audiences = resourcesForCampaign(state, campaign).customAudiences ?? [];
  const includedIds = adSet.includedCustomAudienceIds ?? [];
  const excludedIds = adSet.excludedCustomAudienceIds ?? [];
  const selectedIds = new Set([...includedIds, ...excludedIds]);
  const included = includedIds.map((id) => audiences.find((entry) => entry.id === id) ?? { id, name: id });
  const excluded = excludedIds.map((id) => audiences.find((entry) => entry.id === id) ?? { id, name: id });
  return `
    <div class="audience-card audience-card-custom">
      <div class="audience-card-section">
        <div class="audience-section-label audience-section-label-plain">
          <div><strong>Đối tượng tùy chỉnh</strong><small>Mỗi đối tượng chỉ có thể nằm ở một phía: bao gồm hoặc loại trừ</small></div>
        </div>
        <div class="audience-custom-picker-row">
          <div class="audience-custom-field">
            <span class="field-label">Bao gồm</span>
            ${expandableSelect({
    label: '', ariaLabel: 'Bao gồm', clientId: adSet.clientId, action: 'move-custom-audience', audienceTarget: 'include', value: '',
    searchable: true, placeholder: 'Tìm đối tượng...', unselectedLabel: 'Chọn đối tượng',
    options: audiences
      .filter((audience) => !selectedIds.has(audience.id) || includedIds.includes(audience.id))
      .map((audience) => ({ value: audience.id, label: audience.name, detail: audience.subtype ?? '' }))
  })}
          </div>
          <div class="audience-custom-field">
            <span class="field-label">Loại trừ</span>
            ${expandableSelect({
    label: '', ariaLabel: 'Loại trừ', clientId: adSet.clientId, action: 'move-custom-audience', audienceTarget: 'exclude', value: '',
    searchable: true, placeholder: 'Tìm đối tượng...', unselectedLabel: 'Chọn đối tượng',
    options: audiences
      .filter((audience) => !selectedIds.has(audience.id) || excludedIds.includes(audience.id))
      .map((audience) => ({ value: audience.id, label: audience.name, detail: audience.subtype ?? '' }))
  })}
          </div>
        </div>
        <div class="chip-list">
          ${included.length + excluded.length > 0
      ? [
        ...included.map((audience) => customAudienceChip(adSet.clientId, audience, 'include')),
        ...excluded.map((audience) => customAudienceChip(adSet.clientId, audience, 'exclude'))
      ].join('')
      : '<span class="empty-chip-copy">Chưa thêm đối tượng tùy chỉnh nào</span>'}
        </div>
      </div>
    </div>`;
}

function customAudienceChip(clientId, audience, side) {
  return `<span class="chip${side === 'include' ? ' chip-blue' : ' chip-red'}">
    <b class="chip-tag">${side === 'include' ? 'Gồm' : 'Loại'}</b>${escapeHtml(audience.name)}
    <button type="button" data-action="remove-custom-audience" data-client-id="${escapeHtml(clientId)}" data-audience-id="${escapeHtml(audience.id)}" aria-label="Bỏ ${escapeHtml(audience.name)}">×</button>
  </span>`;
}

function locationEditor(state, campaign, adSet) {
  const readOnly = Boolean(adSet.audienceTemplateId) && !isToolAudienceTemplateId(adSet.audienceTemplateId);
  const side = state.ui?.locationSelectionSide === 'exclude' ? 'exclude' : 'include';
  const searching = Boolean(state.ui?.searchingLocations);
  const included = adSet.includedRegions ?? [];
  const excluded = adSet.excludedRegions ?? [];
  const includedCities = adSet.includedCities ?? [];
  const excludedCities = adSet.excludedCities ?? [];
  const includedCustomLocations = adSet.includedCustomLocations ?? [];
  const excludedCustomLocations = adSet.excludedCustomLocations ?? [];
  const hasAny = included.length
    + excluded.length
    + includedCities.length
    + excludedCities.length
    + includedCustomLocations.length
    + excludedCustomLocations.length > 0;
  const selectedRegionChips = [
    ...included.map((region) => locationChip(adSet.clientId, region, 'include')),
    ...excluded.map((region) => locationChip(adSet.clientId, region, 'exclude'))
  ].join('');
  const selectedRadiusLocations = [
    ...includedCities.map((city) => radiusLocationCard(adSet.clientId, city, 'include')),
    ...excludedCities.map((city) => radiusLocationCard(adSet.clientId, city, 'exclude')),
    ...includedCustomLocations.map((location) => customLocationCard(adSet.clientId, location, 'include', readOnly)),
    ...excludedCustomLocations.map((location) => customLocationCard(adSet.clientId, location, 'exclude', readOnly))
  ].join('');
  const selectedRegionCount = included.length + excluded.length;
  const existingPin = includedCustomLocations[0] ?? excludedCustomLocations[0];
  const pickerMap = `<div class="custom-location-map" data-location-map="${escapeHtml(adSet.clientId)}:picker" data-client-id="${escapeHtml(adSet.clientId)}" data-latitude="${escapeHtml(existingPin?.latitude ?? 16)}" data-longitude="${escapeHtml(existingPin?.longitude ?? 106)}" data-radius="10" data-map-zoom="${existingPin ? 12 : 5}" data-map-picker="true" data-map-editable="true" data-region-target="${side}"></div>`;
  return `
    <div class="audience-card-section location-editor" data-validation-field="includedRegions">
      ${audienceSectionLabel('Vị trí', 'Người ở hoặc gần đây tại các vị trí đã chọn')}
      ${readOnly ? `<p class="location-source-note">${included.length + includedCities.length + includedCustomLocations.length} vị trí bao gồm · ${excluded.length + excludedCities.length + excludedCustomLocations.length} vị trí loại trừ</p>` : `<div class="location-search-panel">
        <div class="location-side-tabs segmented-tabs" role="tablist" aria-label="Cách áp dụng vị trí">
          ${locationSideButton('include', 'Bao gồm', side)}
          ${locationSideButton('exclude', 'Loại trừ', side)}
        </div>
        <div class="search-row">
          <input type="search" data-role="location-query" value="${escapeHtml(state.ui?.locationQuery ?? '')}" placeholder="Nhập địa chỉ, tên đường, tỉnh hoặc thành phố" aria-label="Tìm địa chỉ, tên đường, tỉnh hoặc thành phố" aria-describedby="location-search-feedback-${escapeHtml(adSet.clientId)}" autocomplete="off" />
          <button type="button" class="button-secondary" data-action="search-location" data-client-id="${escapeHtml(adSet.clientId)}" ${searching ? 'disabled' : ''}>${searching ? 'Đang tìm...' : 'Tìm kiếm'}</button>
        </div>
        <p class="location-search-hint">Gợi ý tỉnh/thành phố khi nhập · Nhấn Enter hoặc Tìm kiếm để tìm thêm địa chỉ, tên đường.</p>
        <div class="location-search-feedback" id="location-search-feedback-${escapeHtml(adSet.clientId)}" aria-live="polite" aria-busy="${searching}">${renderLocationSearchResults(state, campaign, adSet)}</div>
        ${customLocationEntry(adSet.clientId, side)}
      </div>`}
      ${readOnly ? '' : includedCustomLocations.length + excludedCustomLocations.length === 0 ? `<div class="location-picker-map">
        <div class="location-map-heading"><strong>Bản đồ vị trí</strong><small>Chọn một điểm trên bản đồ để thêm ghim bán kính.</small></div>
        ${pickerMap}
      </div>` : `<details class="location-picker-map"><summary class="location-map-heading">Thêm ghim ${side === 'exclude' ? 'loại trừ' : 'bao gồm'} trên bản đồ</summary>${pickerMap}</details>`}
      <div class="selected-location-list">
        ${hasAny
      ? `${selectedRegionChips ? `<div class="selected-location-chips" data-location-chip-list role="list" tabindex="0" aria-label="${selectedRegionCount} tỉnh hoặc thành phố đã chọn: ${included.length} bao gồm, ${excluded.length} loại trừ">${selectedRegionChips}</div>` : ''}${selectedRadiusLocations}`
      : '<span class="empty-chip-copy">Chưa chọn tỉnh/thành phố hoặc vị trí bán kính nào</span>'}
      </div>
      <p class="location-source-note">${readOnly ? 'Vị trí và bán kính được giữ theo đối tượng đã lưu trên Meta.' : 'Tỉnh/thành phố Việt Nam từ Meta · Địa chỉ và ghim trên bản đồ dùng bán kính tối đa 80 km hoặc 50 dặm. Kiểm tra vị trí ghim trước khi đăng.'}</p>
    </div>`;
}

export function renderLocationSearchResults(state, campaign, adSet) {
  const resources = resourcesForCampaign(state, campaign);
  const results = resources.locationResults ?? [];
  const side = state.ui?.locationSelectionSide === 'exclude' ? 'exclude' : 'include';
  if (state.ui?.searchingLocations) return '<p class="location-search-status" role="status">Đang tìm vị trí…</p>';
  if (state.ui?.locationSearchError) return `<p class="location-search-status is-error" role="alert">${escapeHtml(state.ui.locationSearchError)}</p>`;
  const query = state.ui?.locationQuery?.trim() ?? '';
  const warnings = (state.ui?.locationSearchWarnings ?? []).map((warning) => `<p class="location-search-status is-warning">${escapeHtml(typeof warning === 'string' ? warning : warning.message ?? '')}</p>`).join('');
  if (query.length < 2) return '';
  if (!results.length) return state.ui?.locationSearchCompleted
    ? `${warnings}<p class="location-search-status">Chưa tìm thấy vị trí phù hợp. Thử thêm quận, thành phố vào tên đường rồi bấm Tìm kiếm, hoặc chọn một điểm trên bản đồ.</p>`
    : '';
  return `${warnings}<div class="search-results location-results">${results.map((location) => {
    const isPin = ['custom_location', 'address', 'place'].includes(location.type);
    const typeLabel = isPin ? 'Địa chỉ · Ghim bán kính' : location.type === 'city' ? 'Thành phố · Bán kính' : 'Tỉnh/Thành phố';
    const detail = location.address || location.region || 'Việt Nam';
    return `<button type="button" class="search-result" data-action="add-region" data-client-id="${escapeHtml(adSet.clientId)}" data-region-key="${escapeHtml(location.key)}" data-region-type="${escapeHtml(location.type)}" data-region-target="${side}">
      <span><strong>${escapeHtml(location.name)}</strong><small>${escapeHtml(typeLabel)} · ${escapeHtml(detail)}</small></span>
      <span>${side === 'include' ? 'Bao gồm' : 'Loại trừ'}</span>
    </button>`;
  }).join('')}</div>${results.some((location) => location.source === 'OpenStreetMap') ? '<p class="location-geocoder-credit">Địa chỉ: © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a></p>' : ''}`;
}

function customLocationEntry(clientId, side) {
  return `<details class="custom-location-entry" data-custom-location-entry>
    <summary><span aria-hidden="true">⌖</span><strong>Nhập tọa độ</strong><small>Hoặc chọn vị trí trực tiếp trên bản đồ</small></summary>
    <div class="custom-location-entry-fields">
      <label><span>Tên vị trí</span><input type="text" data-pin-name placeholder="Ví dụ: Phú Thọ, Thủ Dầu Một" /></label>
      <label><span>Vĩ độ</span><input type="number" min="-90" max="90" step="0.000001" data-pin-latitude placeholder="10.9804" /></label>
      <label><span>Kinh độ</span><input type="number" min="-180" max="180" step="0.000001" data-pin-longitude placeholder="106.6519" /></label>
      <label><span>Bán kính</span><span class="custom-location-radius-input"><input type="number" min="1" max="80" step="1" value="10" data-pin-radius /><b>km</b></span></label>
      <button type="button" class="button-secondary" data-action="add-custom-location" data-client-id="${escapeHtml(clientId)}" data-region-target="${side}">Thêm ghim</button>
    </div>
  </details>`;
}

function audienceSectionLabel(title, description) {
  return `
    <div class="audience-section-label">
      <span class="audience-flag" aria-hidden="true">🇻🇳</span>
      <div><strong>${title}</strong><small>${description}</small></div>
    </div>`;
}

function locationSideButton(value, label, selectedSide) {
  const selected = selectedSide === value;
  return `<button type="button" role="tab" aria-selected="${selected}" data-action="set-location-side" data-location-side="${value}" class="${selected ? 'is-active' : ''}">${label}</button>`;
}

function locationChip(clientId, region, side) {
  return `<span class="chip${side === 'include' ? ' chip-blue' : ' chip-red'}" role="listitem">
    <b class="chip-tag">${side === 'include' ? 'Gồm' : 'Loại'}</b>${escapeHtml(region.name)}
    <button type="button" data-action="remove-region" data-client-id="${escapeHtml(clientId)}" data-region-key="${escapeHtml(region.key)}" data-region-target="${side}" aria-label="Bỏ ${escapeHtml(region.name)}">×</button>
  </span>`;
}

function radiusLocationCard(clientId, city, side) {
  const radius = city.radius == null ? null : Number(city.radius);
  const unitLabel = city.distanceUnit === 'mile' ? 'dặm' : 'km';
  return `<div class="radius-location-card${side === 'exclude' ? ' is-excluded' : ''}">
    <div class="radius-location-copy">
      <b class="chip-tag">${side === 'include' ? 'Gồm' : 'Loại'}</b>
      <span><strong>${escapeHtml(city.name)}</strong><small>${escapeHtml(city.region || 'Việt Nam')} · ${radius === null ? 'Chỉ thành phố' : 'Bán kính'}</small></span>
    </div>
    ${radius === null ? '<span class="radius-location-control">Chỉ trong thành phố · Không mở rộng bán kính</span>' : `<label class="radius-location-control">
      <span>Bán kính</span>
      <span><input type="number" min="0.01" max="${city.distanceUnit === 'mile' ? 50 : 80}" step="any" value="${escapeHtml(radius)}" data-location-radius data-client-id="${escapeHtml(clientId)}" data-city-key="${escapeHtml(city.key)}" data-region-target="${side}" aria-label="Bán kính quanh ${escapeHtml(city.name)}" /><b>${unitLabel}</b></span>
    </label>`}
    <button type="button" class="radius-location-remove" data-action="remove-city" data-client-id="${escapeHtml(clientId)}" data-city-key="${escapeHtml(city.key)}" data-region-target="${side}" aria-label="Bỏ vị trí bán kính ${escapeHtml(city.name)}">×</button>
  </div>`;
}

function customLocationCard(clientId, location, side, readOnly = false) {
  const radius = Number(location.radius) || 10;
  const unitLabel = location.distanceUnit === 'mile' ? 'dặm' : 'km';
  const locationKey = String(location.key || customLocationKey(location));
  const hasCoordinates = location.latitude != null && location.longitude != null
    && Number.isFinite(Number(location.latitude)) && Number.isFinite(Number(location.longitude));
  return `<article class="custom-location-card${side === 'exclude' ? ' is-excluded' : ''}">
    ${hasCoordinates ? `<div class="custom-location-map" aria-label="Bản đồ ${escapeHtml(location.name)}" data-location-map="${escapeHtml(`${clientId}:${side}:${locationKey}`)}" data-client-id="${escapeHtml(clientId)}" data-location-key="${escapeHtml(locationKey)}" data-latitude="${escapeHtml(location.latitude)}" data-longitude="${escapeHtml(location.longitude)}" data-radius="${escapeHtml(radius)}" data-distance-unit="${escapeHtml(location.distanceUnit ?? 'kilometer')}" data-map-editable="${!readOnly}" data-region-target="${side}"></div>` : ''}
    <div class="custom-location-toolbar">
      <div class="custom-location-copy">
        <b class="chip-tag">${side === 'include' ? 'Gồm' : 'Loại'}</b>
        <span><strong>${escapeHtml(location.name)}</strong><small>${location.type === 'place' ? 'Địa điểm Meta' : 'Ghim tọa độ'}${hasCoordinates ? ` · ${formatCoordinate(location.latitude)}, ${formatCoordinate(location.longitude)}` : ' · Meta không cung cấp tọa độ xem bản đồ'}</small></span>
      </div>
      <label class="radius-location-control">
        <span>Bán kính</span>
        <span><input type="number" min="0.01" max="${location.distanceUnit === 'mile' ? 50 : 80}" step="any" value="${escapeHtml(radius)}" data-custom-location-radius data-client-id="${escapeHtml(clientId)}" data-location-key="${escapeHtml(locationKey)}" data-region-target="${side}" aria-label="Bán kính quanh ${escapeHtml(location.name)}" /><b>${unitLabel}</b></span>
      </label>
      <button type="button" class="radius-location-remove" data-action="remove-custom-location" data-client-id="${escapeHtml(clientId)}" data-location-key="${escapeHtml(locationKey)}" data-region-target="${side}" aria-label="Bỏ ghim ${escapeHtml(location.name)}">×</button>
    </div>
  </article>`;
}

function customLocationKey(location) {
  return `pin:${Number(location.latitude).toFixed(6)},${Number(location.longitude).toFixed(6)}`;
}

function formatCoordinate(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(6) : '';
}

function detailedTargetingEditor(state, campaign, adSet) {
  const category = state.ui?.targetingCategory ?? 'interest';
  const results = resourcesForCampaign(state, campaign).targetingResults ?? [];
  const searching = Boolean(state.ui?.searchingTargeting);
  return `
    <div class="audience-card-section detailed-targeting">
      <div class="subsection-heading subsection-heading-flush">
        <h3>Giới hạn hơn nữa số người tiếp cận quảng cáo</h3>
        <p>Nhắm mục tiêu chi tiết theo sở thích, hành vi hoặc thông tin nhân khẩu học.</p>
      </div>
      <div class="segmented-tabs" role="tablist" aria-label="Loại nhắm mục tiêu">
        ${targetingTab('interest', 'Sở thích', category)}
        ${targetingTab('behavior', 'Hành vi', category)}
        ${targetingTab('demographic', 'Nhân khẩu học', category)}
      </div>
      <div class="search-row">
        <input type="search" data-role="targeting-query" value="${escapeHtml(state.ui?.targetingQuery ?? '')}" placeholder="Nhập ít nhất 2 ký tự" aria-label="Tìm nhắm mục tiêu" />
        <button type="button" class="button-secondary" data-action="search-targeting" data-client-id="${escapeHtml(adSet.clientId)}" ${searching ? 'disabled' : ''}>${searching ? 'Đang tìm...' : 'Tìm kiếm'}</button>
      </div>
      ${results.length ? `<div class="search-results">${results.map((item) => `
        <button type="button" class="search-result" data-action="add-targeting" data-client-id="${escapeHtml(adSet.clientId)}" data-targeting-id="${escapeHtml(item.id)}">
          <span><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml((item.path ?? []).join(' › '))}</small></span>
          <span>Thêm</span>
        </button>`).join('')}</div>` : ''}
      <div class="chip-list selected-targeting">
        ${adSet.detailedTargeting.length
      ? adSet.detailedTargeting.map((item) => `<span class="chip chip-blue">${escapeHtml(item.name)}<button type="button" data-action="remove-targeting" data-client-id="${escapeHtml(adSet.clientId)}" data-targeting-id="${escapeHtml(item.id)}" aria-label="Bỏ ${escapeHtml(item.name)}">×</button></span>`).join('')
      : '<span class="empty-chip-copy">Chưa thêm điều kiện thu hẹp</span>'}
      </div>
    </div>`;
}

function groupIssuesByNode(issues, campaigns) {
  const groups = new Map();
  for (const issue of issues) {
    const info = describeIssuePath(issue.path, campaigns);
    const key = info.clientId ?? '__general__';
    if (!groups.has(key)) groups.set(key, { ...info, items: [] });
    groups.get(key).items.push({
      label: info.fieldLabel,
      message: issue.message,
      path: String(issue.path ?? ''),
      fieldPath: info.fieldPath ?? ''
    });
  }
  return [...groups.values()];
}

function describeIssuePath(path, campaigns) {
  const segments = String(path ?? '').split('.');
  if (segments[0] !== 'campaigns') {
    const fieldPath = segments.join('.');
    return { breadcrumb: 'Chung', clientId: null, fieldLabel: humanizeField(fieldPath), fieldPath };
  }
  const campaignIndex = Number(segments[1]);
  const campaign = campaigns[campaignIndex];
  const campaignName = campaign?.name || `Chiến dịch ${campaignIndex + 1}`;
  if (segments[2] === undefined) {
    return { breadcrumb: campaignName, clientId: campaign?.clientId ?? null, fieldLabel: 'Chiến dịch', fieldPath: '' };
  }
  if (segments[2] === 'adSets') {
    const adSetIndex = Number(segments[3]);
    const adSet = campaign?.adSets?.[adSetIndex];
    const breadcrumb = `${campaignName} › ${adSet?.name || `Nhóm quảng cáo ${adSetIndex + 1}`}`;
    if (segments[4] === undefined) {
      return { breadcrumb, clientId: adSet?.clientId ?? null, fieldLabel: 'Nhóm quảng cáo', fieldPath: '' };
    }
    if (segments[4] === 'ads') {
      const adIndex = Number(segments[5]);
      const ad = adSet?.ads?.[adIndex];
      const adBreadcrumb = `${breadcrumb} › ${ad?.name || `Quảng cáo ${adIndex + 1}`}`;
      const fieldPath = segments.slice(6).join('.');
      return {
        breadcrumb: adBreadcrumb,
        clientId: ad?.clientId ?? null,
        fieldLabel: humanizeField(fieldPath),
        fieldPath
      };
    }
    const fieldPath = segments.slice(4).join('.');
    return { breadcrumb, clientId: adSet?.clientId ?? null, fieldLabel: humanizeField(fieldPath), fieldPath };
  }
  const fieldPath = segments.slice(2).join('.');
  return { breadcrumb: campaignName, clientId: campaign?.clientId ?? null, fieldLabel: humanizeField(fieldPath), fieldPath };
}

const issueFieldLabels = {
  name: 'Tên',
  adAccountId: 'Tài khoản quảng cáo',
  pageId: 'Facebook Page',
  dailyBudget: 'Ngân sách/ngày',
  includedRegions: 'Vị trí (Bao gồm)',
  excludedRegions: 'Vị trí (Loại trừ)',
  includedCities: 'Bán kính (Bao gồm)',
  excludedCities: 'Bán kính (Loại trừ)',
  includedCustomLocations: 'Ghim bán kính (Bao gồm)',
  excludedCustomLocations: 'Ghim bán kính (Loại trừ)',
  cities: 'Vị trí bán kính',
  customLocations: 'Ghim bán kính',
  ageMin: 'Độ tuổi tối thiểu',
  ageMax: 'Độ tuổi tối đa',
  genders: 'Giới tính',
  detailedTargeting: 'Nhắm mục tiêu chi tiết',
  primaryText: 'Văn bản chính',
  headline: 'Tiêu đề',
  mediaId: 'Ảnh/Video',
  startTime: 'Thời gian bắt đầu',
  endTime: 'Thời gian kết thúc'
};

function humanizeField(fieldPath) {
  if (!fieldPath) return 'Thiết lập chung';
  const segments = fieldPath.split('.');
  if (segments[0] === 'conversation') {
    if (segments[1] === 'templateName') return 'Tên mẫu Cuộc trò chuyện';
    if (segments[1] === 'greeting') return 'Lời chào Cuộc trò chuyện';
    if (segments[1] === 'customerActions') {
      const actionLabel = Number.isInteger(Number(segments[2])) ? `Nút #${Number(segments[2]) + 1}` : 'Nút hành động';
      if (segments[3] === 'label') return `${actionLabel} · Nhãn`;
      if (segments[3] === 'value') return `${actionLabel} · URL`;
      return actionLabel;
    }
    return 'Cuộc trò chuyện';
  }
  const leaf = segments[segments.length - 1];
  return issueFieldLabels[leaf] ?? leaf.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
}

function renderIssueGroups(groups) {
  return `<div class="issue-groups">${groups.map((group) => `
    <article class="issue-group">
      ${group.clientId
      ? `<button type="button" class="issue-group-jump" data-action="select-node" data-client-id="${escapeHtml(group.clientId)}">${escapeHtml(group.breadcrumb)}<span aria-hidden="true">→</span></button>`
      : `<div class="issue-group-heading">${escapeHtml(group.breadcrumb)}</div>`}
      <ul class="issue-group-list">
        ${group.items.map((item) => `<li>${group.clientId
        ? `<button type="button" class="issue-item-jump" data-action="jump-to-validation-issue" data-client-id="${escapeHtml(group.clientId)}" data-validation-path="${escapeHtml(item.path)}" data-validation-field="${escapeHtml(item.fieldPath)}"><span><small>${escapeHtml(item.label)}</small><b>${escapeHtml(item.message)}</b></span><span class="issue-item-arrow" aria-hidden="true">→</span></button>`
        : `<div class="issue-item-static"><small>${escapeHtml(item.label)}</small><span>${escapeHtml(item.message)}</span></div>`}</li>`).join('')}
      </ul>
    </article>`).join('')}</div>`;
}

function renderReview(state, { showPublishAction = true } = {}) {
  return renderLegacyReview(state, { showPublishAction });
}

function renderPublishProgressReview(runProgress, { localDemo = false } = {}) {
  return `
    <div class="pane-header review-header publish-progress-header">
      <div>
        <span class="eyebrow">${localDemo ? 'Mô phỏng an toàn trên local' : 'Đang tạo trên Meta'}</span>
        <h2>Tiến độ đăng</h2>
      </div>
    </div>
    <div class="review-content publish-progress-content">
      ${renderReviewProgress(runProgress)}
    </div>`;
}

function renderEditorProgressAction(state) {
  const progress = workspaceProgress(state);
  if (progress.reviewActive && progress.formComplete) {
    return renderPublishAction(state, { containerClass: 'editor-header-action' });
  }
  const label = 'Kiểm tra lần cuối';
  return `
    <div class="editor-header-action">
      <button type="button" class="button-primary publish-button progress-next-button" data-action="progress-next">${escapeHtml(label)}<span aria-hidden="true">→</span></button>
    </div>
    ${renderPublishAction(state, { hidden: true, containerClass: 'editor-header-action' })}`;
}

function progressLockIcon() {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="5" y="10" width="14" height="10" rx="2"></rect><path d="M8 10V7a4 4 0 0 1 8 0v3"></path></svg>';
}

function renderLegacyReview(state, { showPublishAction = true } = {}) {
  const issues = state.issues ?? [];
  const campaigns = state.draft?.campaigns ?? [];
  const progress = state.runProgress ?? state.publishProgress;
  const setupComplete = hasRequiredSetupFields(campaigns);
  const ready = issues.length === 0 && state.connected && setupComplete;
  const incomplete = issues.length === 0 && !ready;
  const readinessLabel = issues.length ? `${issues.length} lỗi` : ready ? 'Sẵn sàng' : 'Chưa hoàn tất';
  const summaryClass = issues.length ? 'has-errors' : ready ? 'is-valid' : 'is-incomplete';
  const summaryTitle = issues.length ? 'Cần xử lý trước khi tạo' : ready ? 'Thiết lập hợp lệ' : 'Chưa hoàn tất thiết lập';
  return `
    <div class="pane-header review-header">
      <div>
        <span class="eyebrow">Kiểm tra</span>
        <h2>Kiểm tra thiết lập</h2>
      </div>
      <span class="readiness-score ${ready ? 'is-ready' : incomplete ? 'is-incomplete' : ''}">${readinessLabel}</span>
    </div>
    <div class="review-content">
      ${renderReviewProgress(progress)}
      <section class="review-section validation-summary ${summaryClass}">
        <div class="review-section-heading">
          <div>
            <span class="review-section-kicker">Trạng thái thiết lập</span>
            <h3>${summaryTitle}</h3>
          </div>
          <span class="validation-status-icon" aria-hidden="true">${issues.length ? '!' : ready ? '✓' : '…'}</span>
        </div>
        ${issues.length
      ? renderIssueGroups(groupIssuesByNode(issues, campaigns))
        : ready
        ? '<p class="review-success-copy">Không phát hiện lỗi. Khi xác nhận, chiến dịch sẽ được tạo và kích hoạt ngay.</p>'
        : '<p class="review-incomplete-copy">Nhập đủ thông tin bắt buộc và kết nối Meta để kiểm tra thiết lập.</p>'}
      </section>
    </div>
    ${showPublishAction ? renderPublishAction(state) : ''}`;
}

function renderPublishAction(state, { hidden = false, containerClass = 'review-footer review-publish-footer' } = {}) {
  const blocked = publishBlocked(state);
  const localDemo = Boolean(state.ui?.localDemoResources);
  const publishing = state.ui?.publishPhase === 'publishing';
  const label = state.running
    ? (publishing ? (localDemo ? 'Đang chạy thử...' : 'Đang đăng...') : 'Đang kiểm tra...')
    : (localDemo ? 'Đăng thử' : 'Đăng');
  const accessibleLabel = state.running
    ? (publishing
        ? (localDemo ? 'Đang mô phỏng tiến trình đăng trên local' : 'Đang đăng chiến dịch lên Meta')
        : 'Đang kiểm tra thiết lập trước khi đăng')
    : (localDemo ? 'Chạy thử tiến trình đăng trên local, không gửi lên Meta' : 'Đăng chiến dịch và kích hoạt trên Meta');
  return `
    <div class="${containerClass}"${hidden ? ' hidden' : ''}>
      <button id="publish-draft" type="button" class="button-primary publish-button" data-action="publish-draft"
        aria-label="${accessibleLabel}" aria-busy="${Boolean(state.running)}" ${blocked ? 'disabled' : ''}>
        ${label}
      </button>
    </div>`;
}

function publishBlocked(state) {
  return (!state.connected && !state.ui?.localDemoResources)
    || (state.issues ?? []).length > 0
    || !workspaceProgress(state).formComplete
    || Boolean(state.running);
}

function hasRequiredSetupFields(campaigns) {
  return campaigns.length > 0 && campaigns.every((campaign) => (
    String(campaign?.name ?? '').trim()
    && String(campaign?.adAccountId ?? '').trim()
    && String(campaign?.pageId ?? '').trim()
    && Array.isArray(campaign?.adSets)
    && campaign.adSets.length > 0
    && campaign.adSets.every((adSet) => (
      String(adSet?.name ?? '').trim()
      && Array.isArray(adSet?.ads)
      && adSet.ads.length > 0
      && adSet.ads.every((ad) => String(ad?.name ?? '').trim())
    ))
  ));
}

function renderReviewProgress(progress) {
  if (!progress) return '';
  const overall = progress.overall ?? progress;
  const percent = normalizeProgressPercent(overall.percent);
  const completed = normalizeProgressCount(overall.completed);
  const total = normalizeProgressCount(overall.total);
  const status = normalizeProgressStatus(overall.status);
  const statusLabel = progressStatusLabel(overall.phase, status);
  const campaigns = Array.isArray(progress.campaigns) ? progress.campaigns : [];
  const valueText = `${percent}% · ${completed}/${total} bước hoàn tất`;

  return `
    <section class="review-progress-overview is-${status}" data-run-progress-overview aria-labelledby="review-progress-title">
      <div class="review-progress-heading">
        <div>
          <span class="eyebrow">Tiến độ lượt chạy</span>
          <h3 id="review-progress-title">Tiến độ tổng</h3>
        </div>
        <span class="review-progress-status is-${status}">${escapeHtml(statusLabel)}</span>
      </div>
      <div class="review-progress-summary">
        <div class="review-progress-ring is-${status}" role="progressbar" aria-label="Tiến độ tổng" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent}" aria-valuetext="${escapeHtml(valueText)}">
          <svg class="review-progress-ring-svg" viewBox="0 0 120 120" aria-hidden="true" focusable="false">
            <circle class="review-progress-ring-track" cx="60" cy="60" r="52" pathLength="100"></circle>
            <circle class="review-progress-ring-value" cx="60" cy="60" r="52" pathLength="100" style="stroke-dashoffset: ${100 - percent}"></circle>
          </svg>
          <span class="review-progress-ring-copy">
            ${percent === 100 && status === 'completed' ? '<span class="review-progress-check" aria-hidden="true">✓</span>' : ''}
            <strong class="review-progress-percent">${percent}%</strong>
          </span>
        </div>
        <div class="review-progress-copy">
          <strong>${escapeHtml(statusLabel)}</strong>
          <span>${completed}/${total} bước hoàn tất</span>
        </div>
      </div>
      ${campaigns.length > 0 ? `
        <div class="review-campaign-progress" aria-label="Tiến độ theo chiến dịch">
          <span class="review-campaign-label">Theo chiến dịch</span>
          ${campaigns.map(renderCampaignProgress).join('')}
        </div>` : ''}
    </section>`;
}

function renderCampaignProgress(campaign) {
  const percent = normalizeProgressPercent(campaign?.percent);
  const completed = normalizeProgressCount(campaign?.completed);
  const total = normalizeProgressCount(campaign?.total);
  const status = normalizeProgressStatus(campaign?.status);
  const statusLabel = progressStatusLabel(campaign?.phase, status);
  const name = campaign?.name ?? campaign?.clientId ?? 'Chiến dịch';
  return `
    <button type="button" class="campaign-progress-row is-${status}" data-action="open-campaign-results" data-client-id="${escapeHtml(campaign?.clientId)}" data-campaign-progress="${escapeHtml(campaign?.clientId)}">
      <div class="campaign-progress-heading">
        <strong>${escapeHtml(name)}</strong>
        <span>${percent}%</span>
      </div>
      <div class="campaign-progress-track" role="progressbar" aria-label="Tiến độ ${escapeHtml(name)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent}" aria-valuetext="${percent}% · ${completed}/${total} bước hoàn tất">
        <span class="campaign-progress-fill" style="width: ${percent}%"></span>
      </div>
      <div class="campaign-progress-meta">
        <span>${escapeHtml(statusLabel)}</span>
        <small>${completed}/${total} bước</small>
      </div>
    </button>`;
}

function normalizeProgressCount(value) {
  const count = Number(value);
  if (!Number.isFinite(count)) return 0;
  return Math.max(0, Math.floor(count));
}

function normalizeProgressStatus(value) {
  const statuses = new Set(['pending', 'running', 'completed', 'completed_with_errors', 'needs_review', 'failed']);
  return statuses.has(value) ? value : 'pending';
}

function progressStatusLabel(phase, status) {
  const statusLabels = {
    completed: 'Hoàn tất',
    completed_with_errors: 'Hoàn tất với lỗi',
    needs_review: 'Cần kiểm tra',
    failed: 'Không thể hoàn tất',
    pending: 'Đang chuẩn bị'
  };
  if (statusLabels[status]) return statusLabels[status];
  if (phase === 'publishing') return 'Đang lấy link Post';
  return phase === 'seeding' ? 'Đang seeding' : 'Đang tạo quảng cáo';
}

function renderResultNode(node, { localDemo = false } = {}) {
  const labels = {
    created: 'Thành công',
    failed: 'Thất bại',
    skipped: 'Đã bỏ qua',
    creating: 'Đang tạo',
    pending: 'Chờ xử lý',
    retry_pending: 'Đang chờ hạn mức Meta'
  };
  return `
    <article class="result-item result-${escapeHtml(node.status)}">
      <div class="result-status"><span></span>${escapeHtml(labels[node.status] ?? node.status)}</div>
      <div class="result-copy">
        <span class="result-type">${escapeHtml(nodeLabels[node.type] ?? node.type)}</span>
        <strong class="result-name">${escapeHtml(node.name ?? nodeLabels[node.type] ?? node.type)}</strong>
        <div class="result-identifiers">
          <small class="result-identifier"><span>ID cục bộ:</span><code>${escapeHtml(node.clientId)}</code></small>
          ${node.remoteId ? `<small class="result-identifier"><span>${localDemo ? 'ID mô phỏng:' : 'ID Meta:'}</span><code>${escapeHtml(node.remoteId)}</code></small>` : ''}
          ${node.postId ? `<small class="result-identifier"><span>ID bài viết:</span><code>${escapeHtml(node.postId)}</code></small>` : ''}
        </div>
        ${node.error?.message ? `<p class="result-error-message">${escapeHtml(node.error.message)}</p>` : ''}
      </div>
    </article>`;
}

function renderRunProgress(progress, nodes) {
  const progressLabel = progress?.localDemo ? 'Tiến độ đăng thử local' : 'Tiến độ tạo quảng cáo Meta';
  const percent = normalizeProgressPercent(progress.percent);
  const completed = escapeHtml(progress.completed);
  const total = escapeHtml(progress.total);
  return `
    <section class="run-progress" aria-label="${progressLabel}">
      <div class="run-progress-summary">
        <div class="run-progress-metric"><strong>${percent}%</strong><span>Đã hoàn thành ${completed}/${total} bước</span></div>
        <span class="run-progress-phase">${percent === 100 ? 'Hoàn tất' : 'Đang xử lý'}</span>
      </div>
      <div class="run-progress-track" role="progressbar" aria-label="${progressLabel}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent}">
        <span class="run-progress-fill" style="width: ${percent}%"></span>
      </div>
      <p class="run-progress-current" role="status" aria-live="polite" aria-atomic="true"><span aria-hidden="true"></span>${renderRunProgressActivity(progress, nodes)}</p>
      ${renderRunProgressError(progress, nodes)}
      ${progress.status === 'failed' && progress.error?.message
      ? `<p class="run-progress-error">${escapeHtml(progress.error.message)}</p>`
      : ''}
    </section>`;
}

function normalizeProgressPercent(value) {
  const percent = Number(value);
  if (!Number.isFinite(percent)) return 0;
  return Math.min(100, Math.max(0, Math.round(percent)));
}

function renderRunProgressActivity(progress, nodes) {
  const summaries = {
    preparing: 'Đang kiểm tra dữ liệu và quyền truy cập',
    recovering: 'Đang khôi phục trạng thái',
    completed: 'Hoàn tất',
    completed_with_errors: 'Hoàn tất với lỗi',
    failed: 'Không thể hoàn tất lượt tạo'
  };
  if (summaries[progress.status]) return summaries[progress.status];

  const currentNode = nodes.find((node) => node.clientId === progress.currentClientId);
  if (!currentNode) return 'Đang tạo quảng cáo Meta';
  return `Đang tạo ${escapeHtml(nodeLabels[currentNode.type] ?? currentNode.type)}: ${escapeHtml(currentNode.name)}`;
}

function section(title, description, content) {
  return `
    <section class="editor-section">
      ${title || description ? `<div class="section-heading">${title ? `<h2>${title}</h2>` : ''}${description ? `<p>${description}</p>` : ''}</div>` : ''}
      <div class="section-content">${content}</div>
    </section>`;
}

function textField(label, node, field, { placeholder = '' } = {}) {
  return `
    <label class="field">
      <span class="field-label">${label}</span>
      <input data-client-id="${escapeHtml(node.clientId)}" data-field="${field}" value="${escapeHtml(node[field])}" placeholder="${escapeHtml(placeholder)}" />
    </label>`;
}

function numberField(label, node, field, { disabled = false, suffix = '', min = 1, max = '' } = {}) {
  const currencyInput = suffix === '₫';
  return `
    <label class="field">
      <span class="field-label">${label}</span>
      <span class="input-with-suffix">
        <input data-field="${field}" data-client-id="${escapeHtml(node.clientId)}"${currencyInput ? ' data-currency-input type="text" inputmode="numeric"' : ` type="number" min="${min}" ${max !== '' ? `max="${max}"` : ''}`} value="${escapeHtml(currencyInput ? formatCurrencyValue(node[field]) : node[field])}"${disabled ? ' disabled' : ''} />
        ${suffix ? `<span>${suffix}</span>` : ''}
      </span>
    </label>`;
}

function formatCurrencyValue(value) {
  const digits = String(value ?? '').replace(/\D/g, '');
  return digits ? Number(digits).toLocaleString('vi-VN') : '';
}

function compactAgeInput(node, field, min, max) {
  if (node.audienceTemplateId && !isToolAudienceTemplateId(node.audienceTemplateId)) min = 13;
  const current = Math.min(max, Math.max(min, Number(node[field]) || min));
  const minimumAge = Math.min(max, Math.max(min, Number(node.ageMin) || min));
  const maximumAge = Math.min(max, Math.max(min, Number(node.ageMax) || max));
  const ariaLabel = field === 'ageMin' ? 'Tuổi tối thiểu' : 'Tuổi tối đa';
  const panelId = `age-panel-${node.clientId}-${field}`;
  const options = Array.from({ length: max - min + 1 }, (_, index) => min + index)
    .map((age) => {
      const disabled = field === 'ageMin' ? age > maximumAge : age < minimumAge;
      return {
        value: age,
        label: age === 65 ? '65+' : String(age),
        disabled
      };
    });
  return `<div class="audience-age-input">
    <div class="age-dd" data-age-dropdown>
      <input type="hidden" data-client-id="${escapeHtml(node.clientId)}" data-field="${escapeHtml(field)}" value="${current}" />
      <button type="button" class="age-dd-trigger" data-age-trigger aria-label="${ariaLabel}: ${current === 65 ? '65+' : current}" aria-haspopup="listbox" aria-expanded="false" aria-controls="${escapeHtml(panelId)}">
        <span>${current === 65 ? '65+' : current}</span>
        <span class="dropdown-chevron-badge" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m6 9 6 6 6-6" /></svg></span>
      </button>
      <div class="age-panel" id="${escapeHtml(panelId)}" role="listbox" aria-label="${ariaLabel}" aria-hidden="true">
        <div class="age-panel-inner">
          ${options.map((option) => `<button type="button" class="age-opt${option.value === current ? ' selected' : ''}" data-age-option data-value="${option.value}" role="option" aria-selected="${option.value === current}" ${option.disabled ? 'disabled aria-disabled="true"' : ''}>${option.label}</button>`).join('')}
        </div>
      </div>
    </div>
  </div>`;
}

function dateTimeField(label, node, field) {
  return dateTimePicker(label, node, field, 'field');
}

function lockedField(label, value) {
  return `
    <label class="field">
      <span class="field-label">${label}</span>
      <span class="locked-control"><span>${escapeHtml(value)}</span><small>Đã khóa</small></span>
    </label>`;
}

function compactLockedValue(value, label) {
  return `<div class="adset-locked-value" title="${escapeHtml(label)}: ${escapeHtml(value)}" aria-label="${escapeHtml(label)}: ${escapeHtml(value)}">
    <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="10" width="16" height="10" rx="2"></rect><path d="M8 10V7a4 4 0 0 1 8 0v3"></path></svg>
    <span>${escapeHtml(value)}</span>
  </div>`;
}

function compactDateTimeField(label, node, field) {
  return dateTimePicker(label, node, field, 'adset-date-field');
}

function dateTimePicker(label, node, field, variantClass) {
  const value = toLocalDateTime(node[field]);
  const parts = localDateTimeParts(value);
  return `<div class="${variantClass} dt-field" data-datetime-picker data-field="${field}" data-client-id="${escapeHtml(node.clientId)}" data-datetime-value="${escapeHtml(value)}">
    <input type="hidden" data-client-id="${escapeHtml(node.clientId)}" data-field="${field}" value="${escapeHtml(value)}" />
    <span class="field-label dt-field-label">${label}</span>
    <button type="button" class="dt-trigger" data-datetime-trigger aria-label="Chọn ${label.toLocaleLowerCase('vi')}" aria-haspopup="dialog" aria-expanded="false">
      <svg class="cal-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
      <span class="dt-value${value ? ' filled' : ''}" data-datetime-display>${escapeHtml(formatLocalDateTime(value))}</span>
      <span class="dropdown-chevron-badge" aria-hidden="true"><svg viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"></polyline></svg></span>
    </button>
    <div class="dt-panel" role="dialog" aria-label="Chọn ${label.toLocaleLowerCase('vi')}" aria-hidden="true">
      <div class="cal-box">
        <div class="cal-head">
          <strong class="cal-month-label" data-calendar-month-label>Tháng ${parts.month} ${parts.year}</strong>
          <div class="cal-nav">
            <button type="button" class="cal-nav-btn" data-calendar-nav="-1" aria-label="Tháng trước"><svg viewBox="0 0 24 24" aria-hidden="true"><polyline points="15 18 9 12 15 6"></polyline></svg></button>
            <button type="button" class="cal-nav-btn" data-calendar-nav="1" aria-label="Tháng sau"><svg viewBox="0 0 24 24" aria-hidden="true"><polyline points="9 18 15 12 9 6"></polyline></svg></button>
          </div>
        </div>
        <div class="cal-weekdays" aria-hidden="true"><span>H</span><span>B</span><span>T</span><span>N</span><span>S</span><span>B</span><span>C</span></div>
        <div class="cal-days" data-calendar-days></div>
        <div class="cal-footer">
          <button type="button" class="clear-btn" data-datetime-clear>Xóa</button>
          <button type="button" data-datetime-today>Hôm nay</button>
        </div>
      </div>
      <div class="time-box">
        <div class="time-head"><span>Giờ</span><span>Phút</span></div>
        <div class="time-cols">
          ${timePickerColumn('hour', 23, parts.hour)}
          ${timePickerColumn('minute', 59, parts.minute)}
        </div>
        <button type="button" class="time-confirm" data-datetime-confirm>Xong</button>
      </div>
    </div>
  </div>`;
}

function timePickerColumn(part, max, selected) {
  const items = Array.from({ length: max + 1 }, (_, value) => `<button type="button" class="time-item${value === selected ? ' active' : ''}" data-time-value="${String(value).padStart(2, '0')}" aria-pressed="${value === selected}">${String(value).padStart(2, '0')}</button>`).join('');
  return `<div class="time-col" data-time-part="${part}" role="listbox" aria-label="${part === 'hour' ? 'Giờ' : 'Phút'}">${items}</div>`;
}

function localDateTimeParts(value) {
  const matched = String(value ?? '').match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  const now = new Date();
  if (!matched) {
    return {
      year: now.getFullYear(),
      month: now.getMonth() + 1,
      day: now.getDate(),
      hour: 0,
      minute: 0
    };
  }
  return {
    year: Number(matched[1]),
    month: Number(matched[2]),
    day: Number(matched[3]),
    hour: Number(matched[4]),
    minute: Number(matched[5])
  };
}

function formatLocalDateTime(value) {
  const matched = String(value ?? '').match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  return matched ? `${matched[3]}/${matched[2]}/${matched[1]} ${matched[4]}:${matched[5]}` : 'dd/mm/yyyy --:--';
}

function choiceCard({ name, clientId, field, value, checked, title, description }) {
  return `
    <label class="choice-card${checked ? ' is-selected' : ''}">
      <input type="radio" name="${escapeHtml(name)}" data-client-id="${escapeHtml(clientId)}" data-field="${field}" value="${value}"${checked ? ' checked' : ''} />
      <span class="radio-mark"></span>
      <span><strong>${title}</strong><small>${description}</small></span>
    </label>`;
}

function genderControl(adSet) {
  const genders = Array.isArray(adSet.genders) ? adSet.genders : [];
  const parsedSelected = Number(genders[0]);
  const selected = [0, 1, 2].includes(parsedSelected) ? parsedSelected : 0;
  return `
    <fieldset class="field gender-field">
      <legend class="field-label">Giới tính</legend>
      <div class="segmented-control">
        ${genderOption(adSet.clientId, 'Tất cả', 0, selected)}
        ${genderOption(adSet.clientId, 'Nam', 1, selected)}
        ${genderOption(adSet.clientId, 'Nữ', 2, selected)}
      </div>
    </fieldset>`;
}

function genderOption(clientId, label, value, selected) {
  return `
    <label class="segment${selected === value ? ' is-selected' : ''}">
      <input type="radio" name="gender-${escapeHtml(clientId)}" data-client-id="${escapeHtml(clientId)}" data-field="genders" value="${value}"${selected === value ? ' checked' : ''} />
      <span>${label}</span>
    </label>`;
}

function localeSummary(adSet) {
  const locales = Array.isArray(adSet.locales) ? adSet.locales : [];
  const labels = locales.map((locale) => Number(locale) === 6
    ? 'Tiếng Việt'
    : `Locale Meta #${locale}`);
  const text = labels.length ? labels.join(', ') : 'Tất cả ngôn ngữ';
  return `
    <div class="field locale-field-compact">
      <span class="field-label">Ngôn ngữ</span>
      <div class="locale-badge" title="${escapeHtml(text)}">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"></circle><line x1="3.6" y1="9" x2="20.4" y2="9"></line><line x1="3.6" y1="15" x2="20.4" y2="15"></line><path d="M11.5 3a17 17 0 0 0 0 18"></path><path d="M12.5 3a17 17 0 0 1 0 18"></path></svg>
        <span>${escapeHtml(text)}</span>
      </div>
    </div>`;
}

function targetingTab(value, label, selected) {
  return `<button type="button" role="tab" aria-selected="${selected === value}" data-action="set-targeting-category" data-category="${value}" class="${selected === value ? 'is-active' : ''}">${label}</button>`;
}

function option(value, label, selectedValue) {
  return `<option value="${escapeHtml(value)}"${String(value) === String(selectedValue) ? ' selected' : ''}>${escapeHtml(label)}</option>`;
}

function reviewRow(label, value, passed) {
  return `<div class="review-row"><span>${label}</span><strong>${escapeHtml(value)}</strong><i class="review-check ${passed ? 'passed' : ''}" aria-hidden="true">${passed ? '✓' : '!'}</i></div>`;
}

function countNodes(campaigns, type) {
  if (type === 'adSet') {
    return campaigns.reduce((total, campaign) => total + campaign.adSets.length, 0);
  }
  return campaigns.reduce(
    (total, campaign) => total + campaign.adSets.reduce((sum, adSet) => sum + adSet.ads.length, 0),
    0
  );
}

function formatCurrency(value) {
  return `${new Intl.NumberFormat('vi-VN').format(value)} ₫`;
}

function toLocalDateTime(value) {
  return value ? String(value).slice(0, 16) : '';
}

function renderRunProgressError(progress, nodes) {
  const failedNode = nodes.find((node) => node.status === 'failed' || node.error);
  const details = failedNode?.error ?? progress?.error;
  if (!details) return '';
  const message = details.message ?? 'Không thể hoàn tất bước tạo trên Meta.';
  const nodeType = failedNode ? (nodeLabels[failedNode.type] ?? failedNode.type) : 'Lần chạy';
  const nodeName = failedNode?.name ?? 'Không xác định';
  const metadata = [
    details.code ? ['Mã Meta', details.code] : null,
    details.subcode ?? details.error_subcode ? ['Mã phụ', details.subcode ?? details.error_subcode] : null,
    details.fbtraceId ?? details.fbtrace_id ? ['Mã truy vết', details.fbtraceId ?? details.fbtrace_id] : null
  ].filter(Boolean);
  return `
    <section class="run-progress-error" role="alert" aria-live="assertive">
      <div class="run-progress-error-heading">
        <span class="run-progress-error-icon">!</span>
        <div><span>Đã phát hiện lỗi</span><strong>Dừng tại ${escapeHtml(nodeType)}: ${escapeHtml(nodeName)}</strong></div>
      </div>
      <p>${escapeHtml(message)}</p>
      ${metadata.length ? `<dl>${metadata.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join('')}</dl>` : ''}
      <small>Không gửi lại toàn bộ batch. Hãy xử lý hoặc thử lại đúng đối tượng đang lỗi.</small>
    </section>`;
}
