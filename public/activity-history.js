const RECENT_PAGE_SIZE = 5;
const FILTERED_PAGE_SIZE = 50;
const PUBLICATION_RETRY_DELAYS = [0, 5000, 15000, 30000, 60000];
const TERMINAL_RUN_STATUSES = new Set(['completed', 'completed_with_errors', 'failed']);

export function createActivityHistoryState() {
  return {
    open: false,
    loading: false,
    loadingMore: false,
    detailLoading: false,
    error: null,
    filters: { from: '', to: '' },
    datePickerOpen: false,
    datePickerMonth: '',
    draftFilters: { from: '', to: '' },
    loaded: false,
    items: [],
    nextOffset: null,
    selectedRunId: null,
    selectedCampaignClientId: null,
    detail: null,
    expandedCampaignKeys: [],
    mountedCampaignKeys: [],
    detailsByRun: {},
    detailLoadingByRun: {},
    detailErrorsByRun: {},
    publicationSyncing: false,
    publicationSyncAttempt: 0,
    publicationSyncError: null,
    publicationSync: null,
    realtimeRunId: null,
    realtimeAttempt: 0,
    realtimeRefreshing: false,
    realtimeError: null,
    seedingError: null,
    reportLoading: false,
    retryingAdKeys: []
  };
}

export function isActiveHistoryRun(run) {
  const runId = String(run?.id ?? run?.runId ?? '').trim();
  return Boolean(runId) && !TERMINAL_RUN_STATUSES.has(run?.status);
}

export function historyRunSummary(run, existing = {}) {
  const snapshot = run?.snapshot ?? existing.snapshot ?? null;
  const nodes = Array.isArray(run?.nodes) ? run.nodes : [];
  const campaigns = buildCampaignSummaries(snapshot, nodes);
  const nodeCount = (type) => nodes.filter((node) => node.type === type).length;
  const statusCount = (statuses) => nodes.filter((node) => statuses.includes(node.status)).length;
  return {
    ...existing,
    id: run?.id ?? run?.runId ?? existing.id,
    status: run?.status ?? existing.status ?? 'creating',
    adAccountId: run?.adAccountId ?? snapshot?.adAccountId ?? existing.adAccountId ?? null,
    createdAt: run?.createdAt ?? existing.createdAt ?? Date.now(),
    completedAt: run?.completedAt ?? existing.completedAt ?? null,
    workflowLeaseExpiresAt: run?.workflowLeaseExpiresAt ?? existing.workflowLeaseExpiresAt ?? null,
    legacy: snapshot ? false : Boolean(existing.legacy),
    campaigns: campaigns.length > 0 ? campaigns : (existing.campaigns ?? []),
    counts: {
      total: nodes.length,
      created: statusCount(['created', 'completed']),
      failed: statusCount(['failed']),
      skipped: statusCount(['skipped']),
      campaigns: nodeCount('campaign'),
      adSets: nodeCount('adSet'),
      ads: nodeCount('ad')
    }
  };
}

function buildCampaignSummaries(snapshot, nodes) {
  const campaigns = snapshot?.campaigns ?? [];
  const nodeById = new Map(nodes.map((node) => [String(node.clientId), node]));
  return campaigns.map((campaign) => {
    const adSets = campaign.adSets ?? [];
    const ads = adSets.flatMap((adSet) => adSet.ads ?? []);
    const relatedNodes = [
      nodeById.get(String(campaign.clientId)),
      ...adSets.map((adSet) => nodeById.get(String(adSet.clientId))),
      ...ads.map((ad) => nodeById.get(String(ad.clientId)))
    ].filter(Boolean);
    const failedNode = relatedNodes.find((node) => node.status === 'failed' || node.error);
    const skippedNode = relatedNodes.find((node) => node.status === 'skipped');
    const completed = relatedNodes.filter((node) => ['created', 'completed'].includes(node.status)).length;
    const total = 1 + adSets.length + ads.length;
    const status = failedNode || skippedNode ? 'failed' : completed === total ? 'created' : 'pending';
    return {
      clientId: String(campaign.clientId ?? ''),
      name: campaign.name ?? '',
      adAccountId: campaign.adAccountId ?? snapshot?.adAccountId ?? '',
      adSets: adSets.length,
      ads: ads.length,
      completed,
      total,
      status,
      errorMessage: failedNode?.error?.message ?? failedNode?.error?.error?.message
        ?? (skippedNode ? 'Một phần Campaign đã bị bỏ qua do lỗi trước đó.' : '')
    };
  });
}

export function publicationRetryDelay(attempt) {
  const index = Number.isInteger(attempt) && attempt >= 0 ? attempt : 0;
  return PUBLICATION_RETRY_DELAYS[index] ?? null;
}

export function hasMissingPublications(run) {
  return (run?.nodes ?? []).some((node) => node.type === 'ad'
    && node.status === 'created'
    && node.remoteId
    && (!node.postId || !safeFacebookPermalink(node.permalinkUrl)));
}

export function buildSeedingStatusByPost(run) {
  const jobsByPost = new Map();
  for (const job of run?.seeding?.jobs ?? []) {
    const postId = String(job?.postId ?? '').trim();
    if (!postId) continue;
    const jobs = jobsByPost.get(postId) ?? [];
    jobs.push(job);
    jobsByPost.set(postId, jobs);
  }

  const statuses = new Map();
  for (const [postId, jobs] of jobsByPost) {
    const selected = jobs
      .map((job) => ({ job, ...normalizeSeedingStatus(job.status) }))
      .sort((left, right) => right.priority - left.priority)[0];
    const errorJob = jobs.find((job) => normalizeSeedingStatus(job.status).status === selected.status && seedingErrorMessage(job));
    statuses.set(postId, {
      status: selected.status,
      label: selected.label,
      errorMessage: errorJob ? seedingErrorMessage(errorJob) : ''
    });
  }
  return statuses;
}

export function activityHistoryQuery(filters, offset = 0) {
  const filtered = Boolean(filters.from || filters.to);
  const query = { limit: filtered ? FILTERED_PAGE_SIZE : RECENT_PAGE_SIZE, offset };
  if (filters.from) query.from = localDayStart(filters.from).getTime();
  if (filters.to) query.to = localDayAfter(filters.to).getTime();
  if (query.from !== undefined && query.to !== undefined && query.to <= query.from) {
    throw new TypeError('Ngày kết thúc phải bằng hoặc sau ngày bắt đầu');
  }
  return query;
}

export function renderActivityHistory(history, { adAccounts = [] } = {}) {
  const accountNames = new Map(adAccounts.map((account) => [String(account.id), account.name]));
  const totalLabel = history.items.length > 0 ? `${history.items.length} lượt tạo đang hiển thị` : 'Theo dõi toàn bộ lượt tạo quảng cáo';
  return `
    <div class="history-shell">
      <header class="history-header">
        <div class="history-header-copy">
          <span class="history-eyebrow">Báo cáo Meta Ads</span>
          <h1>Lịch sử hoạt động</h1>
          <p>${escapeHtml(totalLabel)}</p>
        </div>
        <div class="history-header-actions">
          <button type="button" class="button-secondary history-report-button" data-action="open-activity-history-report" ${history.loading || history.reportLoading || history.items.length === 0 ? 'disabled' : ''} title="Xem danh sách bài quảng cáo đang hiển thị">
            <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"></rect><path d="M3 10h18M9 4v16"></path></svg>
            <span>${history.reportLoading ? 'Đang tải...' : 'Xem bảng'}</span>
          </button>
        </div>
      </header>
      ${history.selectedRunId && history.items.length === 0
      ? renderHistoryDetail(history, accountNames)
      : renderHistoryList(history, accountNames)}
    </div>`;
}

export function campaignServiceName(campaignName) {
  const normalizedName = String(campaignName ?? '').trim();
  if (!normalizedName) return 'Chưa xác định';
  const segments = normalizedName.split('_').map((segment) => segment.trim());
  if (segments.length >= 6) {
    const serviceSegments = segments.slice(1, -4).filter(Boolean);
    if (serviceSegments.length > 0) return serviceSegments.join(' ');
  }
  return segments[1] || normalizedName;
}

export function campaignEmployeeName(campaignName) {
  const normalizedName = String(campaignName ?? '').trim();
  if (!normalizedName) return 'Chưa xác định';
  return normalizedName.split('_')[0]?.trim() || 'Chưa xác định';
}

export function activityHistoryReportRows(runs = []) {
  const rows = [];
  for (const run of runs) {
    const nodes = Array.isArray(run?.nodes) ? run.nodes : [];
    const nodeById = new Map(nodes.map((node) => [String(node.clientId), node]));
    const campaigns = run?.snapshot?.campaigns ?? [];
    if (campaigns.length > 0) {
      for (const campaign of campaigns) {
        for (const adSet of campaign.adSets ?? []) {
          for (const ad of adSet.ads ?? []) {
            const result = nodeById.get(String(ad.clientId));
            rows.push(historyExportRow(run, campaign.name, ad.name, result?.permalinkUrl, result?.postId));
          }
        }
      }
      continue;
    }
    for (const ad of nodes.filter((node) => node.type === 'ad')) {
      const adSet = nodeById.get(String(ad.parentClientId ?? ''));
      const campaign = nodeById.get(String(adSet?.parentClientId ?? ''));
      rows.push(historyExportRow(run, campaign?.name, ad.name, ad.permalinkUrl, ad.postId));
    }
  }
  return uniqueHistoryReportRows(rows);
}

export function activityHistoryReportCopyText(rows = []) {
  const lines = [
    ['Ngày tạo', 'Tên nhân viên', 'Dịch vụ', 'Link bài quảng cáo'],
    ...rows.map((row) => [row.createdDate, row.employeeName, row.serviceName, row.postLink])
  ];
  return lines.map((line) => line.map(tabularCell).join('\t')).join('\n');
}

export function renderActivityHistoryReportTable(rows = []) {
  if (rows.length === 0) {
    return '<div class="history-report-dialog-empty"><strong>Chưa có bài quảng cáo</strong><p>Các bài chưa nhận được link từ Meta sẽ không có đường dẫn để sao chép.</p></div>';
  }
  return `
    <div class="history-report-dialog-table-wrap">
      <table class="history-report-dialog-table">
        <thead><tr><th>Ngày tạo</th><th>Tên nhân viên</th><th>Dịch vụ</th><th>Link bài quảng cáo</th></tr></thead>
        <tbody>${rows.map((row) => `
          <tr>
            <td>${escapeHtml(row.createdDate)}</td>
            <td>${escapeHtml(row.employeeName)}</td>
            <td>${escapeHtml(row.serviceName)}</td>
            <td>${row.postLink
      ? `<a href="${escapeHtml(row.postLink)}" target="_blank" rel="noopener noreferrer">${escapeHtml(row.postLink)}</a>`
      : '<span class="history-report-dialog-pending">Đang chờ link</span>'}</td>
          </tr>`).join('')}</tbody>
      </table>
    </div>`;
}

function historyExportRow(run, campaignName, adName, permalinkUrl, postId) {
  const normalizedCampaignName = String(campaignName ?? '').trim() || 'Không có dữ liệu';
  return {
    createdAt: formatDateTime(run?.createdAt),
    createdDate: formatDateOnly(run?.createdAt),
    employeeName: campaignEmployeeName(normalizedCampaignName),
    serviceName: campaignServiceName(normalizedCampaignName),
    campaignName: normalizedCampaignName,
    adName: String(adName ?? '').trim() || 'Quảng cáo',
    postLink: safeFacebookPermalink(permalinkUrl) || '',
    postId: String(postId ?? '').trim()
  };
}

function uniqueHistoryReportRows(rows) {
  const uniqueRows = [];
  const indexByPostId = new Map();
  const seenLinks = new Set();
  const seenPendingCampaigns = new Set();
  for (const row of rows) {
    if (row.postLink && seenLinks.has(row.postLink)) continue;
    if (row.postId && indexByPostId.has(row.postId)) {
      const index = indexByPostId.get(row.postId);
      if (!uniqueRows[index].postLink && row.postLink) {
        uniqueRows[index] = row;
        seenLinks.add(row.postLink);
      }
      continue;
    }
    if (!row.postId && !row.postLink) {
      const pendingKey = `${row.createdDate}\u0000${row.campaignName}`;
      if (seenPendingCampaigns.has(pendingKey)) continue;
      seenPendingCampaigns.add(pendingKey);
    }
    const index = uniqueRows.push(row) - 1;
    if (row.postId) indexByPostId.set(row.postId, index);
    if (row.postLink) seenLinks.add(row.postLink);
  }
  return uniqueRows;
}

function tabularCell(value) {
  return String(value ?? '').replace(/[\t\r\n]+/g, ' ').trim();
}

function renderHistoryList(history, accountNames) {
  return `
    ${renderHistoryDateFilter(history)}
    ${renderHistoryError(history.error)}
    <section class="history-list-panel">
      <header class="history-list-heading"><div><strong>Các lượt tạo quảng cáo</strong><span>Mỗi lượt tạo chứa các Campaign được gửi cùng lúc.</span></div><b>${history.items.length}</b></header>
      <div class="history-list" aria-live="polite">
        ${history.loading && history.items.length === 0
      ? '<div class="history-loading">Đang tải lịch sử...</div>'
      : history.items.length > 0
        ? history.items.map((run) => renderHistorySummary(run, accountNames, history)).join('')
        : '<div class="history-empty"><strong>Chưa có lịch sử phù hợp</strong><p>Các lượt tạo Ads mới sẽ được lưu tại đây.</p></div>'}
      </div>
    </section>
    ${history.nextOffset !== null ? `
      <div class="history-load-more">
        <button type="button" class="button-secondary" data-action="load-more-history"${history.loadingMore ? ' disabled' : ''}>
          ${history.loadingMore ? 'Đang tải...' : 'Tải thêm'}
        </button>
      </div>` : ''}`;
}

function renderHistoryDateFilter(history) {
  const label = history.filters.from || history.filters.to
    ? `${formatFilterDate(history.filters.from) || '...'} – ${formatFilterDate(history.filters.to) || '...'}`
    : 'Tất cả thời gian';
  return `
    <div class="history-date-filter">
      <button type="button" class="button-secondary history-date-trigger" data-action="toggle-history-date-picker" aria-expanded="${history.datePickerOpen ? 'true' : 'false'}">
        <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"></rect><path d="M8 3v4M16 3v4M3 10h18"></path></svg>
        <span class="history-date-trigger-copy"><small>Khoảng thời gian</small><strong>${escapeHtml(label)}</strong></span>
        <span class="dropdown-chevron-badge" aria-hidden="true"><svg viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"></polyline></svg></span>
      </button>
      ${history.filters.from || history.filters.to ? '<button type="button" class="history-clear-filter" data-action="clear-history-filter">Xóa bộ lọc</button>' : ''}
      ${history.datePickerOpen ? renderDatePicker(history) : ''}
    </div>`;
}

function renderDatePicker(history) {
  const base = parseMonth(history.datePickerMonth || history.draftFilters.from || formatDateInput(new Date()));
  const next = new Date(base.getFullYear(), base.getMonth() + 1, 1);
  const presets = [
    ['today', 'Hôm nay'], ['yesterday', 'Hôm qua'], ['last7', '7 ngày qua'],
    ['last30', '30 ngày qua'], ['thisWeek', 'Tuần này'], ['thisMonth', 'Tháng này'], ['lastMonth', 'Tháng trước']
  ];
  return `
    <div class="history-date-popover" role="dialog" aria-label="Chọn khoảng thời gian">
      <aside class="history-date-presets">
        ${presets.map(([value, label]) => `<button type="button" data-action="select-history-date-preset" data-preset="${value}">${label}</button>`).join('')}
      </aside>
      <div class="history-calendar-panel">
        <div class="history-calendars">
          <button type="button" class="history-month-nav" data-action="navigate-history-month" data-offset="-1" aria-label="Tháng trước">‹</button>
          ${renderCalendarMonth(base, history.draftFilters)}
          ${renderCalendarMonth(next, history.draftFilters)}
          <button type="button" class="history-month-nav" data-action="navigate-history-month" data-offset="1" aria-label="Tháng sau">›</button>
        </div>
        <footer class="history-date-footer">
          <div><strong>${formatFilterDate(history.draftFilters.from) || 'Chọn ngày bắt đầu'} – ${formatFilterDate(history.draftFilters.to) || 'Chọn ngày kết thúc'}</strong><small>Theo giờ TP. Hồ Chí Minh</small></div>
          <div><button type="button" class="button-secondary" data-action="cancel-history-date-picker">Hủy</button><button type="button" class="button-primary" data-action="apply-history-date-picker" ${!history.draftFilters.from || !history.draftFilters.to ? 'disabled' : ''}>Áp dụng</button></div>
        </footer>
      </div>
    </div>`;
}

function renderCalendarMonth(month, range) {
  const year = month.getFullYear();
  const monthIndex = month.getMonth();
  const firstWeekday = (new Date(year, monthIndex, 1).getDay() + 6) % 7;
  const gridStart = new Date(year, monthIndex, 1 - firstWeekday);
  const days = Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + index);
    const value = formatDateInput(date);
    const outside = date.getMonth() !== monthIndex;
    const selected = value === range.from || value === range.to;
    const inRange = Boolean(range.from && range.to && value > range.from && value < range.to);
    return `<button type="button" data-action="select-history-date" data-date="${value}" class="${outside ? 'is-outside ' : ''}${selected ? 'is-selected ' : ''}${inRange ? 'is-in-range' : ''}" ${outside ? 'tabindex="-1"' : ''}>${date.getDate()}</button>`;
  }).join('');
  return `
    <section class="history-calendar-month">
      <h3>Tháng ${monthIndex + 1}/${year}</h3>
      <div class="history-weekdays"><span>T2</span><span>T3</span><span>T4</span><span>T5</span><span>T6</span><span>T7</span><span>CN</span></div>
      <div class="history-calendar-grid">${days}</div>
    </section>`;
}

export function historyPresetRange(preset, now = new Date()) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let from = new Date(today);
  let to = new Date(today);
  if (preset === 'yesterday') from = to = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  if (preset === 'last7') from = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 6);
  if (preset === 'last30') from = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 29);
  if (preset === 'thisWeek') from = new Date(today.getFullYear(), today.getMonth(), today.getDate() - ((today.getDay() + 6) % 7));
  if (preset === 'thisMonth') from = new Date(today.getFullYear(), today.getMonth(), 1);
  if (preset === 'lastMonth') {
    from = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    to = new Date(today.getFullYear(), today.getMonth(), 0);
  }
  return { from: formatDateInput(from), to: formatDateInput(to) };
}

function renderHistorySummary(run, accountNames, history = {}) {
  const campaigns = run.campaigns ?? [];
  const counts = run.counts ?? {};
  const successful = Number(counts.created ?? 0);
  const failed = Number(counts.failed ?? 0);
  if (campaigns.length > 0) {
    const failedCampaigns = campaigns.filter((campaign) => campaign.status === 'failed').length;
    const expanded = runHasExpandedCampaign(history, run.id);
    return `<details class="history-run-card${failedCampaigns > 0 ? ' has-errors' : ''}"${expanded ? ' open' : ''}>
      <summary class="history-run-card-summary">
        <span class="history-run-status-icon" aria-hidden="true">${failedCampaigns > 0 ? '!' : '✓'}</span>
        <span class="history-run-card-copy"><strong>${escapeHtml(runAccountLabel(run, accountNames))}</strong><small>${escapeHtml(formatDateTime(run.createdAt))}</small></span>
        <span class="history-run-card-stats"><span>${campaigns.length} chiến dịch</span><span>${successful} đối tượng thành công</span>${failedCampaigns > 0 ? `<span class="is-danger">${failedCampaigns} chiến dịch lỗi</span>` : ''}</span>
        ${runWorkflowStalled(run) ? `<button type="button" class="button-primary history-resume-run" data-action="resume-run-workflow" data-run-id="${escapeHtml(run.id)}"${(history.resumingRunIds ?? []).includes(run.id) ? ' disabled' : ''}>${(history.resumingRunIds ?? []).includes(run.id) ? 'Đang chạy tiếp...' : 'Chạy tiếp'}</button>` : ''}
        <span class="history-run-toggle-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"></polyline></svg></span>
      </summary>
      <div class="history-run-card-content">${renderCampaignHistoryCards(run, accountNames, history)}</div>
    </details>`;
  }
  const healthy = failed === 0;
  return `<article class="history-summary${run.legacy ? ' is-legacy' : ''}${healthy ? ' is-success' : ' is-warning'}">
    <div class="history-status-icon" aria-hidden="true">${healthy ? '✓' : '!'}</div>
    <div class="history-summary-copy">
      <strong>${escapeHtml(runAccountLabel(run, accountNames))}</strong>
      <span>${escapeHtml(formatDateTime(run.createdAt))}</span>
      ${run.legacy ? '<p class="history-legacy-note">Dữ liệu cũ chưa đầy đủ</p>' : ''}
    </div>
    <div class="history-summary-meta">
      <span>${escapeHtml(counts.campaigns ?? 0)} chiến dịch</span><span>${escapeHtml(counts.adSets ?? 0)} nhóm</span><span>${escapeHtml(counts.ads ?? 0)} quảng cáo</span>
      <span class="is-success">${successful} thành công</span>${failed > 0 ? `<span class="is-danger">${failed} thất bại</span>` : ''}
    </div>
    <button type="button" data-action="open-history-report" data-run-id="${escapeHtml(run.id)}">Xem báo cáo →</button>
  </article>`;
}

// Lượt chưa kết thúc nhưng workflow không còn giữ lease → đã chết giữa chừng, cho phép chạy tiếp.
export function runWorkflowStalled(run, now = Date.now()) {
  if (['completed', 'completed_with_errors'].includes(run?.status)) return false;
  return !(Number(run?.workflowLeaseExpiresAt) > now);
}

function renderCampaignHistoryCards(run, accountNames, history) {
  return `<div class="history-campaign-card-grid">${(run.campaigns ?? []).map((campaign) => renderCampaignHistoryCard(campaign, run, accountNames, history)).join('')}</div>`;
}

function renderCampaignHistoryCard(campaign, run, accountNames, history) {
  const status = campaign.status ?? 'pending';
  const statusText = status === 'failed' ? 'Có lỗi' : status === 'created' ? 'Hoàn tất' : 'Chưa hoàn tất';
  const errorText = campaign.errorMessage ?? '';
  const progress = campaignHistoryProgress(campaign);
  const campaignAccount = accountName(campaign.adAccountId, accountNames) || runAccountLabel(run, accountNames);
  const expanded = isHistoryCampaignExpanded(history, run.id, campaign.clientId);
  const campaignKey = historyCampaignKey(run.id, campaign.clientId);
  const mounted = expanded || (history.mountedCampaignKeys ?? []).includes(campaignKey);
  const panelId = historyCampaignPanelId(campaign.clientId);
  return `<article class="history-campaign-item${expanded ? ' is-expanded' : ''}">
  <button type="button" class="history-campaign-card is-${escapeHtml(status)}" data-action="toggle-history-campaign" data-run-id="${escapeHtml(run.id)}" data-campaign-client-id="${escapeHtml(campaign.clientId)}" aria-expanded="${expanded}" aria-controls="${panelId}" aria-label="${expanded ? 'Thu gọn' : 'Mở'} báo cáo Campaign ${escapeHtml(campaign.name ?? 'chưa đặt tên')}">
    <span class="history-campaign-card-icon" aria-hidden="true">${status === 'failed' ? '!' : status === 'created' ? '✓' : '…'}</span>
    <span class="history-campaign-card-body">
      <span class="history-campaign-card-heading"><strong>${escapeHtml(campaign.name ?? 'Chiến dịch chưa đặt tên')}</strong><time>${escapeHtml(formatDateTime(run.createdAt))}</time></span>
      <span class="history-campaign-card-account">${escapeHtml(campaignAccount)}</span>
      <span class="history-campaign-card-metrics"><span><b>${escapeHtml(campaign.adSets)}</b> nhóm</span><span><b>${escapeHtml(campaign.ads)}</b> quảng cáo</span><span><b data-history-campaign-steps>${escapeHtml(campaign.completed)}/${escapeHtml(campaign.total)}</b> bước</span><span class="history-campaign-status is-${escapeHtml(status)}" data-history-campaign-status>${escapeHtml(statusText)}</span></span>
      <span class="history-campaign-progress is-${escapeHtml(status)}" data-history-campaign-progress role="progressbar" aria-label="Tiến độ ${escapeHtml(campaign.name ?? 'Chiến dịch chưa đặt tên')}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progress.percent}" aria-valuetext="${progress.percent}% · ${progress.completed}/${progress.total} bước hoàn tất">
        <span class="history-campaign-progress-label"><span>Tiến độ</span><span class="history-campaign-progress-value" data-history-progress-value aria-live="polite" aria-atomic="true">${progress.percent}%</span></span>
        <span class="history-campaign-progress-track"><span data-history-progress-fill style="--history-progress: ${progress.percent}%"></span></span>
      </span>
      ${errorText ? `<span class="history-campaign-card-error">${escapeHtml(errorText)}</span>` : ''}
    </span>
    <span class="history-campaign-card-action"><span>${expanded ? 'Thu gọn' : status === 'failed' ? 'Xem lỗi' : 'Mở báo cáo'}</span><b aria-hidden="true"><svg viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"></polyline></svg></b></span>
  </button>
  ${mounted ? `<div class="history-campaign-detail-shell${expanded ? ' is-open' : ''}" aria-hidden="${!expanded}"><section id="${panelId}" class="history-campaign-inline-detail" aria-label="Báo cáo ${escapeHtml(campaign.name ?? 'Campaign')}">${renderInlineCampaignDetail(history, accountNames, run.id, campaign.clientId)}</section></div>` : ''}
  </article>`;
}

function campaignHistoryProgress(campaign) {
  const total = Math.max(0, Number(campaign.total) || 0);
  const completed = Math.min(total, Math.max(0, Number(campaign.completed) || 0));
  return {
    completed,
    total,
    percent: total > 0 ? Math.round((completed / total) * 100) : 0
  };
}

export function historyCampaignKey(runId, campaignClientId) {
  return `${String(runId ?? '')}::${String(campaignClientId ?? '')}`;
}

function isHistoryCampaignExpanded(history, runId, campaignClientId) {
  if (Array.isArray(history.expandedCampaignKeys)) {
    return history.expandedCampaignKeys.includes(historyCampaignKey(runId, campaignClientId));
  }
  return String(history.selectedRunId ?? '') === String(runId ?? '')
    && String(history.selectedCampaignClientId ?? '') === String(campaignClientId ?? '');
}

function runHasExpandedCampaign(history, runId) {
  const prefix = `${String(runId ?? '')}::`;
  if (Array.isArray(history.expandedCampaignKeys)) {
    return history.expandedCampaignKeys.some((key) => String(key).startsWith(prefix));
  }
  return String(history.selectedRunId ?? '') === String(runId ?? '');
}

function historyCampaignPanelId(clientId) {
  return `history-campaign-panel-${String(clientId ?? 'campaign').replace(/[^a-zA-Z0-9_-]/g, '-')}`;
}

function renderInlineCampaignDetail(history, accountNames, runId, campaignClientId) {
  const detail = history.detailsByRun?.[runId]
    ?? (String(history.selectedRunId ?? '') === String(runId ?? '') ? history.detail : null);
  const loading = history.detailLoadingByRun?.[runId]
    ?? (String(history.selectedRunId ?? '') === String(runId ?? '') && history.detailLoading);
  const error = history.detailErrorsByRun?.[runId]
    ?? (String(history.selectedRunId ?? '') === String(runId ?? '') ? history.error : null);
  if (loading) return '<div class="history-inline-state">Đang tải báo cáo...</div>';
  if (error) return renderHistoryError(error);
  if (!detail) return '<div class="history-inline-state">Không tìm thấy báo cáo.</div>';
  const detailHistory = { ...history, detail, selectedRunId: runId, selectedCampaignClientId: campaignClientId };
  return `
    ${renderPublicationSync(detailHistory, detail)}
    ${renderHistorySeedingAlert(detail)}
    ${renderHistoryReport(detail, accountNames, campaignClientId, { inline: true, history: detailHistory })}`;
}

function renderHistoryDetail(history, accountNames) {
  if (history.detailLoading) return '<div class="history-loading">Đang tải báo cáo...</div>';
  if (history.error) return renderHistoryError(history.error);
  const run = history.detail;
  if (!run) return '<div class="history-empty"><strong>Không tìm thấy báo cáo</strong></div>';
  return `
    ${renderPublicationSync(history, run)}
    ${renderHistorySeedingAlert(run)}
    ${renderHistoryReport(run, accountNames, history.selectedCampaignClientId, { history })}`;
}

function renderHistorySeedingAlert(run) {
  const jobs = run?.seeding?.jobs ?? [];
  const failedJobs = jobs.filter((job) => normalizeSeedingStatus(job.status).status === 'failed');
  const reviewJobs = jobs.filter((job) => normalizeSeedingStatus(job.status).status === 'needs_review');
  if (failedJobs.length === 0 && reviewJobs.length === 0) return '';

  const example = [...failedJobs, ...reviewJobs].map(seedingErrorMessage).find(Boolean);
  return `
    <section class="history-seeding-alert" role="alert">
      <div class="history-seeding-alert-icon" aria-hidden="true">!</div>
      <div>
        <strong>Seeding cần xử lý</strong>
        <p>${pluralizeSeedingCount(failedJobs.length, 'bình luận thất bại')}${failedJobs.length && reviewJobs.length ? ' · ' : ''}${pluralizeSeedingCount(reviewJobs.length, 'bình luận cần kiểm tra')}</p>
        ${example ? `<small>Lỗi gần nhất: ${escapeHtml(truncateSeedingError(example))}</small>` : ''}
      </div>
    </section>`;
}

function pluralizeSeedingCount(count, label) {
  return count > 0 ? `${count} ${label}` : '';
}

function truncateSeedingError(message) {
  const value = String(message ?? '');
  return value.length > 280 ? `${value.slice(0, 280)}…` : value;
}

function renderHistoryPostActions(permalink) {
  if (!permalink) return '<span class="history-link-missing">Đang chờ link</span>';
  const safePermalink = escapeHtml(permalink);
  return `<div class="history-post-actions">
    <a class="history-post-action history-post-link" href="${safePermalink}" target="_blank" rel="noopener noreferrer" aria-label="Mở Post" title="Mở Post">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 5h5v5M19 5l-9 9M19 13v5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/></svg>
    </a>
    <button type="button" class="history-post-action history-copy-link" data-action="copy-history-value" data-copy-value="${safePermalink}" aria-label="Sao chép link Post" title="Sao chép link Post">
      <svg class="history-copy-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="11" height="11" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>
      <svg class="history-copy-success-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>
    </button>
  </div>`;
}

function renderHistoryReport(run, accountNames, selectedCampaignClientId = null, { inline = false, history = null } = {}) {
  const nodeById = new Map((run.nodes ?? []).map((node) => [node.clientId, node]));
  const seedingStatusByPost = buildSeedingStatusByPost(run);
  const campaigns = (run.snapshot?.campaigns ?? []).filter((campaign) => !selectedCampaignClientId
    || String(campaign.clientId) === String(selectedCampaignClientId));
  const rows = [];
  for (const campaign of campaigns) {
    for (const adSet of campaign.adSets ?? []) {
      for (const ad of adSet.ads ?? []) {
        const result = nodeById.get(ad.clientId);
        const permalink = safeFacebookPermalink(result?.permalinkUrl);
        rows.push(`
          <tr>
            <td>${escapeHtml(formatDateTime(run.createdAt))}</td>
            <td>${escapeHtml(accountName(campaign.adAccountId, accountNames) ?? runAccountLabel(run, accountNames))}</td>
            <td>${escapeHtml(campaign.name)}${renderHistoryObjectIds(campaign.clientId, nodeById.get(campaign.clientId)?.remoteId)}</td>
            <td>${escapeHtml(adSet.name)}${renderHistoryObjectIds(adSet.clientId, nodeById.get(adSet.clientId)?.remoteId)}</td>
            <td>${escapeHtml(ad.name)}${renderHistoryObjectIds(ad.clientId, result?.remoteId)}</td>
            <td>${renderHistorySeedingStatus(seedingStatusByPost.get(String(result?.postId ?? '')))}</td>
            <td>${renderHistoryPostActions(permalink)}</td>
          </tr>`);
      }
    }
  }
  if (rows.length === 0) {
    for (const node of run.nodes ?? []) {
      if (node.type !== 'ad') continue;
      const permalink = safeFacebookPermalink(node.permalinkUrl);
      rows.push(`
        <tr>
          <td>${escapeHtml(formatDateTime(run.createdAt))}</td>
          <td>${escapeHtml(runAccountLabel(run, accountNames))}</td>
          <td>Không có dữ liệu</td><td>Không có dữ liệu</td><td>${escapeHtml(node.name ?? 'Quảng cáo')}${renderHistoryObjectIds(node.clientId, node.remoteId)}</td>
          <td>${renderHistorySeedingStatus(seedingStatusByPost.get(String(node.postId ?? '')))}</td>
          <td>${renderHistoryPostActions(permalink)}</td>
        </tr>`);
    }
  }
  const selectedCampaign = campaigns[0];
  return `
    ${selectedCampaignClientId && !inline ? `<div class="history-campaign-filter"><div><span>Đang xem Campaign</span><strong>${escapeHtml(selectedCampaign?.name ?? selectedCampaignClientId)}</strong></div><button type="button" class="button-secondary" data-action="show-all-history-campaigns">Xem toàn bộ lượt tạo</button></div>` : ''}
    ${renderHistoryDiagnostics(run, campaigns, history)}
    <div class="history-report-table-wrap">
      <table class="history-report-table">
        <thead><tr><th>Thời gian tạo</th><th>Tài khoản quảng cáo</th><th>Tên chiến dịch</th><th>Tên nhóm quảng cáo</th><th>Tên quảng cáo</th><th>Trạng thái seeding</th><th>Link Post</th></tr></thead>
        <tbody>${rows.join('') || '<tr><td colspan="7">Chưa có quảng cáo trong lượt tạo này.</td></tr>'}</tbody>
      </table>
    </div>`;
}

function renderHistoryObjectIds(clientId, remoteId) {
  return `<div class="history-object-ids"><span>ID cục bộ: <code>${escapeHtml(clientId || 'Không có dữ liệu')}</code></span><span>ID Meta: <code>${escapeHtml(remoteId || 'Chưa có')}</code></span></div>`;
}

function renderHistoryDiagnostics(run, campaigns, history) {
  const campaignIds = new Set(campaigns.map((campaign) => String(campaign.clientId)));
  const adSetIds = new Set(campaigns.flatMap((campaign) => campaign.adSets ?? []).map((adSet) => String(adSet.clientId)));
  const adIds = new Set(campaigns.flatMap((campaign) => campaign.adSets ?? []).flatMap((adSet) => adSet.ads ?? []).map((ad) => String(ad.clientId)));
  const issues = (run.nodes ?? []).filter((node) => {
    const belongs = campaignIds.has(String(node.clientId)) || adSetIds.has(String(node.clientId)) || adIds.has(String(node.clientId));
    return belongs && (node.status === 'failed' || node.status === 'skipped' || node.error);
  });
  if (issues.length === 0) return '';
  const labels = { campaign: 'Chiến dịch', adSet: 'Nhóm quảng cáo', ad: 'Quảng cáo' };
  return `<section class="history-diagnostics"><div class="history-diagnostics-heading"><span class="eyebrow">Chẩn đoán</span><h3>Vấn đề cần xử lý</h3><p>${issues.length} đối tượng cần kiểm tra trong phạm vi đang xem.</p></div><div class="history-diagnostics-list">${issues.map((node) => {
    const message = node.error?.message ?? node.error?.error?.message ?? (node.status === 'skipped' ? 'Đã bỏ qua do đối tượng trước đó bị lỗi.' : 'Meta không trả về mô tả lỗi.');
    const retryKey = `${String(run.id)}::${String(node.clientId)}`;
    const retrying = (history?.retryingAdKeys ?? []).includes(retryKey);
    const retryAction = node.type === 'ad' && node.status === 'failed' && !node.remoteId
      ? `<button type="button" class="button-secondary history-retry-ad" data-action="retry-failed-ad" data-run-id="${escapeHtml(run.id)}" data-client-id="${escapeHtml(node.clientId)}"${retrying ? ' disabled' : ''}>${retrying ? 'Đang thử lại...' : 'Thử tạo lại quảng cáo'}</button>`
      : '';
    return `<article class="history-diagnostic-item is-${escapeHtml(node.status)}"><div><span>${escapeHtml(labels[node.type] ?? node.type)}</span><strong>${escapeHtml(node.name ?? 'Chưa đặt tên')}</strong></div><dl><div><dt>ID cục bộ</dt><dd>${escapeHtml(node.clientId)}</dd></div>${node.remoteId ? `<div><dt>ID Meta</dt><dd>${escapeHtml(node.remoteId)}</dd></div>` : ''}</dl><p>${escapeHtml(message)}</p>${retryAction}</article>`;
  }).join('')}</div></section>`;
}

function renderHistorySeedingStatus(value) {
  const status = value ?? { status: 'none', label: 'Chưa seeding', errorMessage: '' };
  const error = status.errorMessage ? String(status.errorMessage) : '';
  const shortError = error.length > 160 ? `${error.slice(0, 160)}…` : error;
  const style = {
    succeeded: 'success', progress: 'progress', failed: 'error', needs_review: 'review', none: 'empty'
  }[status.status] ?? 'empty';
  return `<div class="history-seeding-cell">
    <span class="history-seeding-status history-seeding-status-${style}">${escapeHtml(status.label)}</span>
    ${error ? `<small class="history-seeding-error" title="${escapeHtml(error)}">${escapeHtml(shortError)}</small>` : ''}
  </div>`;
}

function normalizeSeedingStatus(value) {
  const status = String(value ?? '').toLowerCase();
  if (status === 'failed') return { status: 'failed', label: 'Thất bại', priority: 6 };
  if (status === 'needs_review') return { status: 'needs_review', label: 'Cần kiểm tra', priority: 5 };
  if (status === 'pending' || status === 'posting') return { status: 'progress', label: 'Đang xử lý', priority: 4 };
  if (status === 'cancelled') return { status: 'none', label: 'Chưa seeding', priority: 3 };
  if (status === 'succeeded' || status === 'created') return { status: 'succeeded', label: 'Thành công', priority: 2 };
  if (status === 'none') return { status: 'none', label: 'Chưa seeding', priority: 1 };
  return { status: 'needs_review', label: 'Cần kiểm tra', priority: 5 };
}

function seedingErrorMessage(job) {
  const error = job?.error;
  if (typeof error === 'string') return error;
  return error?.message ? String(error.message) : '';
}

function renderPublicationSync(history, run) {
  if (!hasMissingPublications(run)) return '';
  const syncError = history.publicationSyncError ?? history.publicationSync?.errors?.[0];
  return `
    <section class="history-sync-status${history.publicationSyncing ? ' is-loading' : ''}" aria-live="polite">
      <div>
        <strong>${history.publicationSyncing ? 'Đang lấy Post ID từ Meta' : 'Đang chờ Meta trả Post ID'}</strong>
        <span>${history.publicationSyncing
      ? 'Báo cáo sẽ tự cập nhật khi Meta trả dữ liệu bài quảng cáo.'
      : 'Tool tự thử lại trong nền; anh cũng có thể lấy lại ngay.'}</span>
        ${syncError ? `<small>${escapeHtml(syncError.message ?? syncError)}</small>` : ''}
      </div>
      <button type="button" class="button-secondary" data-action="refresh-history-publications"${history.publicationSyncing ? ' disabled' : ''}>
        ${history.publicationSyncing ? 'Đang đồng bộ...' : 'Lấy lại link bài'}
      </button>
    </section>`;
}

function renderSnapshot(snapshot, nodeById) {
  const campaigns = snapshot?.campaigns ?? [];
  const snapshotVersion = Number(snapshot?.version ?? 1);
  return `<div class="history-hierarchy">${campaigns.map((campaign) => renderCampaign(campaign, nodeById, snapshotVersion)).join('')}</div>`;
}

function renderCampaign(campaign, nodeById, snapshotVersion) {
  const result = nodeById.get(campaign.clientId);
  return `
    <section class="history-campaign">
      ${historyNodeHeader('Chiến dịch', campaign.name, result)}
      ${snapshotVersion >= 2 ? `
        <div class="history-config-grid history-campaign-context">
          <span><small>Tài khoản quảng cáo</small>${escapeHtml(campaign.adAccountId ?? 'Chưa lưu')}</span>
          <span><small>Facebook Page</small>${escapeHtml(campaign.pageName ?? campaign.pageId ?? 'Chưa lưu')}</span>
        </div>` : ''}
      <div class="history-config-row">
        <span>Ngân sách: ${escapeHtml(campaign.budgetStrategy === 'CAMPAIGN' ? 'Chiến dịch' : 'Nhóm quảng cáo')}</span>
        ${campaign.budgetStrategy === 'CAMPAIGN' ? `<span>${formatCurrency(campaign.dailyBudget)}/ngày</span>` : ''}
      </div>
      <div class="history-adsets">${(campaign.adSets ?? []).map((adSet) => renderAdSet(adSet, nodeById, snapshotVersion)).join('')}</div>
    </section>`;
}

function renderAdSet(adSet, nodeById, snapshotVersion) {
  const result = nodeById.get(adSet.clientId);
  const included = locationNames(
    adSet.includedRegions,
    adSet.includedCities,
    adSet.includedCustomLocations
  );
  const excluded = locationNames(
    adSet.excludedRegions,
    adSet.excludedCities,
    adSet.excludedCustomLocations
  );
  return `
    <section class="history-adset">
      ${historyNodeHeader('Nhóm quảng cáo', adSet.name, result)}
      <div class="history-config-grid">
        ${snapshotVersion < 2 ? `<span><small>Page</small>${escapeHtml(adSet.pageName ?? adSet.pageId ?? 'Chưa lưu')}</span>` : ''}
        <span><small>Ngân sách</small>${formatCurrency(adSet.dailyBudget)}/ngày</span>
        <span><small>Độ tuổi</small>${escapeHtml(adSet.ageMin)}–${escapeHtml(adSet.ageMax)}</span>
        <span><small>Giới tính</small>${escapeHtml(genderLabel(adSet.genders))}</span>
        <span><small>Bao gồm</small>${escapeHtml(included || 'Không có')}</span>
        <span><small>Loại trừ</small>${escapeHtml(excluded || 'Không có')}</span>
      </div>
      <div class="history-ads">${(adSet.ads ?? []).map((ad) => renderAd(ad, nodeById.get(ad.clientId))).join('')}</div>
    </section>`;
}

function renderAd(ad, result) {
  const permalink = safeFacebookPermalink(result?.permalinkUrl);
  const primaryText = ad.primaryText || 'Không có';
  return `
    <article class="history-ad">
      ${historyNodeHeader('Quảng cáo', ad.name, result)}
      <div class="history-ad-content">
        <div><small>Phương tiện</small><strong>${escapeHtml(ad.media?.name ?? 'Chưa lưu')}</strong></div>
        <div><small>Tiêu đề</small><span>${escapeHtml(ad.headline || 'Không có')}</span></div>
        <details class="history-primary-copy">
          <summary>
            <small>Văn bản quảng cáo</small>
            <span class="history-copy-preview">${escapeHtml(primaryText)}</span>
            <span class="history-copy-toggle history-copy-more">Xem đầy đủ</span>
            <span class="history-copy-toggle history-copy-less">Thu gọn</span>
          </summary>
          <p>${escapeHtml(primaryText)}</p>
        </details>
      </div>
      ${historyPublication(result, permalink)}
    </article>`;
}

function renderLegacyNodes(nodes) {
  return `<div class="history-hierarchy">${nodes.map((node) => {
    const permalink = safeFacebookPermalink(node.permalinkUrl);
    return `<article class="history-ad history-legacy-node">
      ${historyNodeHeader(nodeTypeLabel(node.type), node.name ?? 'Tên chưa được lưu', node)}
      ${node.type === 'ad' ? historyPublication(node, permalink) : ''}
    </article>`;
  }).join('')}</div>`;
}

function historyNodeHeader(type, name, result) {
  return `
    <div class="history-node-header">
      <div><small>${escapeHtml(type)}</small><h3>${escapeHtml(name)}</h3></div>
      <div class="history-node-result">
        ${statusBadge(result?.status ?? 'unknown')}
        ${result?.remoteId ? `<span>ID Meta: ${escapeHtml(result.remoteId)}</span>` : ''}
      </div>
    </div>`;
}

function historyPublication(result, permalink) {
  const postId = result?.postId ? String(result.postId) : '';
  const hasPublication = Boolean(postId || permalink);
  return `
    <div class="history-publication${hasPublication ? '' : ' is-pending'}">
      ${postId ? `<span class="history-post-id"><small>Post ID</small><strong>${escapeHtml(postId)}</strong></span>` : ''}
      ${hasPublication ? `<div class="history-publication-actions">
        ${permalink ? `<a class="button-primary history-post-link" href="${escapeHtml(permalink)}" target="_blank" rel="noopener noreferrer">Mở bài Facebook</a>` : ''}
        ${permalink ? `<button type="button" class="button-secondary" data-action="copy-history-value" data-copy-value="${escapeHtml(permalink)}">Sao chép link</button>` : ''}
        ${postId ? `<button type="button" class="button-secondary" data-action="copy-history-value" data-copy-value="${escapeHtml(postId)}">Sao chép Post ID</button>` : ''}
      </div>` : '<span class="history-link-missing">Đang chờ Post ID và link bài quảng cáo</span>'}
      ${result?.error?.message ? `<p>${escapeHtml(result.error.message)}</p>` : ''}
    </div>`;
}

function statusBadge(status) {
  const labels = {
    creating: 'Đang tạo',
    retry_pending: 'Đang chờ hạn mức Meta',
    completed: 'Hoàn tất',
    completed_with_errors: 'Hoàn tất có lỗi',
    failed: 'Thất bại',
    created: 'Thành công',
    skipped: 'Đã bỏ qua',
    unknown: 'Chưa rõ'
  };
  return `<span class="history-status history-status-${escapeHtml(status)}">${escapeHtml(labels[status] ?? status)}</span>`;
}

function renderHistoryError(error) {
  return error ? `<div class="history-error" role="alert">${escapeHtml(error.message ?? error)}</div>` : '';
}

function localDayStart(value) {
  const parts = parseDateParts(value);
  return new Date(parts.year, parts.month - 1, parts.day);
}

function localDayAfter(value) {
  const parts = parseDateParts(value);
  return new Date(parts.year, parts.month - 1, parts.day + 1);
}

function parseDateParts(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new TypeError('Ngày lọc không hợp lệ');
  const parts = { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
  const date = new Date(parts.year, parts.month - 1, parts.day);
  if (date.getFullYear() !== parts.year || date.getMonth() !== parts.month - 1 || date.getDate() !== parts.day) {
    throw new TypeError('Ngày lọc không hợp lệ');
  }
  return parts;
}

function safeFacebookPermalink(value) {
  if (!value) return null;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    const allowedHost = host === 'facebook.com'
      || host.endsWith('.facebook.com');
    return url.protocol === 'https:' && allowedHost ? url.href : null;
  } catch {
    return null;
  }
}

function regionNames(regions = []) {
  return regions.map((region) => region.name).filter(Boolean).join(', ');
}

function locationNames(regions = [], cities = [], customLocations = []) {
  const regionLabels = regionNames(regions);
  const cityLabels = cities
    .map((city) => city?.name ? `${city.name} (${Number(city.radius) || 8} km)` : '')
    .filter(Boolean)
    .join(', ');
  const customLabels = customLocations
    .map((location) => location?.name ? `${location.name} (+${Number(location.radius) || 8} km)` : '')
    .filter(Boolean)
    .join(', ');
  return [regionLabels, cityLabels, customLabels].filter(Boolean).join(', ');
}

function genderLabel(genders = []) {
  if (genders.includes(1) && genders.includes(2)) return 'Tất cả';
  if (genders.includes(1)) return 'Nam';
  if (genders.includes(2)) return 'Nữ';
  return 'Tất cả';
}

function nodeTypeLabel(type) {
  return { campaign: 'Chiến dịch', adSet: 'Nhóm quảng cáo', ad: 'Quảng cáo' }[type] ?? type;
}

function runAccountLabel(run, accountNames = new Map()) {
  if (run.adAccountId) return accountName(run.adAccountId, accountNames) ?? run.adAccountId;
  const accountIds = [...new Set(
    (run.campaigns ?? run.snapshot?.campaigns ?? []).map((campaign) => campaign.adAccountId).filter(Boolean)
  )];
  if (accountIds.length === 1) return accountName(accountIds[0], accountNames) ?? accountIds[0];
  if (accountIds.length > 1) return `${accountIds.length} tài khoản`;
  return run.legacy ? 'Tài khoản chưa lưu' : 'Nhiều tài khoản';
}

function accountName(accountId, accountNames) {
  return accountId ? accountNames.get(String(accountId)) ?? null : null;
}

function parseMonth(value) {
  const match = /^(\d{4})-(\d{2})/.exec(String(value));
  return match ? new Date(Number(match[1]), Number(match[2]) - 1, 1) : new Date();
}

function formatDateInput(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatFilterDate(value) {
  if (!value) return '';
  const { year, month, day } = parseDateParts(value);
  return `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}`;
}

function formatDateTime(value) {
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp)) return 'Chưa lưu';
  return new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(timestamp));
}

function formatDateOnly(value) {
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp)) return 'Chưa lưu';
  return new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short' }).format(new Date(timestamp));
}

function formatCurrency(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return 'Chưa lưu';
  return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND', maximumFractionDigits: 0 }).format(amount);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
