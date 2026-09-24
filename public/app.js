import { createApiClient } from './api-client.js';
import { createDraftStorage } from './draft-storage.js';
import { initializeThemeToggle } from './theme.js';
import { createLocationMapManager } from './location-map.js';
import { createTelegramUploadClient } from './telegram-upload-client.js';
import { applyLocalDemoResources, shouldUseLocalDemoResources } from './local-demo-resources.js';
import {
  addAd,
  addAdSet,
  addCampaign,
  addSeedingItem,
  applyAudienceTemplateToAdSet,
  detachAdSetAudienceTemplate,
  updateAdSetAudienceTemplateName,
  applyCampaignSeedingTemplate,
  activeCampaign,
  captureCampaignSeedingSnapshot,
  captureSeedingUploadTarget,
  changeCampaignAccount,
  clearPageCatalogState,
  createAccountResourceLoadCache,
  createAccountResourceRequestGate,
  createOwnerResourceRequestGate,
  createWorkspaceState,
  customizeCustomAudience,
  detachAdCreative,
  duplicateCampaignSettings,
  duplicateAd,
  duplicateAdSets,
  findNode,
  isToolAudienceTemplateId,
  toolAudienceTemplateCompatibility,
  moveRegion,
  moveCustomLocation,
  moveSeedingItem,
  pageCatalogIssues,
  removeNode,
  removeCity,
  removeCustomLocation,
  removeRegion,
  removeSeedingItem,
  archiveCompletedCampaigns,
  reconcileAvailableCampaignAccounts,
  relinkMatchingCreative,
  replaceCampaignSeeding,
  resourcesForCampaign,
  setAccountResources,
  sharedCreativeCount,
  activateNode,
  closeNodeMenu,
  toggleCampaignCollapsed,
  toggleAdSetCollapsed,
  toggleNodeMenu,
  updateCampaignSeeding,
  updateCityRadius,
  updateCustomLocationRadius,
  updateNodeField,
  updateSeedingItem,
  isSeedingUploadTargetCurrent,
  validateSeedingImageFile
} from './state.js';
import {
  applyConversationTemplate,
  conversationContent,
  createEmptyConversation,
  createDefaultConversation,
  isConversationModified
} from './conversation.js';
import {
  applyPublishEvent,
  createPublishProgress,
  isTerminalRunStatus,
  markPublishFailure,
  mergeRunSnapshot
} from './run-progress.js';
import { createEmptySeeding, isSeedingModified } from './seeding.js';
import { audienceTemplateContent } from './audience.js';
import {
  firstIncompleteRequirement,
  navigationGate,
  progressRequirement,
  requirementsForAdSet,
  requirementsForCampaign,
  stepIndex,
  workspaceProgress
} from './workspace-progress.js';
import { createSeedingRunner, shouldAutoResumeSeeding } from './seeding-runner.js';
import {
  prepareResourceComboboxForSearch,
  mediaUploadText,
  renderResults,
  renderSeedingWorkspace,
  renderLocationSearchResults,
  renderWorkspace,
  highlightResourceSearch,
  resourceSearchScore,
  resolveAccountComboboxSelection,
  resolvePageComboboxSelection,
  restoreResourceComboboxLabel
} from './workspace.js';
import { renderPreservingEditorScroll } from './workspace-view.js';
import {
  activityHistoryReportCopyText,
  activityHistoryReportRows,
  activityHistoryQuery,
  hasMissingPublications,
  historyCampaignKey,
  historyPresetRange,
  historyRunSummary,
  isActiveHistoryRun,
  publicationRetryDelay,
  renderActivityHistory,
  renderActivityHistoryReportTable
} from './activity-history.js';

const api = createApiClient();
const telegramUpload = createTelegramUploadClient();
const locationMaps = createLocationMapManager({ document });
const state = createWorkspaceState();
const draftStorage = createDraftStorage({
  storage: { getItem: (key) => window.localStorage.getItem(key), setItem: (key, value) => window.localStorage.setItem(key, value) },
  onError: () => showToast('Không thể lưu hoặc đọc bản nháp trên trình duyệt. Anh đừng đóng trang trước khi kiểm tra dung lượng lưu trữ.')
});
let sessionLoading = true;
// Nhớ tài khoản Meta của lần trước để hiện tên ngay khi F5, trong lúc chờ server xác nhận phiên.
const REMEMBERED_META_USER_KEY = 'meta-campaign-builder:meta-user';
const readRememberedMetaUser = () => {
  try { return JSON.parse(window.localStorage.getItem(REMEMBERED_META_USER_KEY)) || null; } catch { return null; }
};
const rememberMetaUser = (user) => {
  try {
    const value = user?.id ? JSON.stringify({ id: user.id, name: user.name ?? '' }) : null;
    if (value === null) window.localStorage.removeItem(REMEMBERED_META_USER_KEY);
    else if (window.localStorage.getItem(REMEMBERED_META_USER_KEY) !== value) window.localStorage.setItem(REMEMBERED_META_USER_KEY, value);
  } catch {}
};
const rememberedMetaUser = readRememberedMetaUser();
const creativeMediaMimeTypes = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'video/mp4',
  'video/quicktime'
]);
const creativeMediaMimeTypeByExtension = new Map([
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.png', 'image/png'],
  ['.webp', 'image/webp'],
  ['.mp4', 'video/mp4'],
  ['.mov', 'video/quicktime']
]);
const accountResourceLoads = createAccountResourceLoadCache();
const accountResourceRequests = createAccountResourceRequestGate();
const seedingResourceRequests = createOwnerResourceRequestGate();
const workspace = document.querySelector('#workspace');
const connectButton = document.querySelector('#connect-meta');
const metaAccountMenu = document.querySelector('#meta-account-menu');
const treeToggle = document.querySelector('#toggle-tree');
const reviewToggle = document.querySelector('#toggle-review');
const resultsDrawer = document.querySelector('#run-results');
const historyWorkspace = document.querySelector('#activity-history');
const workspaceModeNav = document.querySelector('#workspace-mode-nav');
const openCampaignWorkspaceButton = document.querySelector('#open-campaign-workspace');
const openHistoryWorkspaceButton = document.querySelector('#open-history-workspace');
const launchContextLabel = document.querySelector('[data-launch-context]');
const launchWorkspaceTitle = document.querySelector('[data-launch-title]');
const toastRegion = document.querySelector('#toast-region');
const actionConfirmation = document.querySelector('#action-confirmation');
const publishConfirmation = document.querySelector('#publish-confirmation');
const duplicateAdSetDialog = document.querySelector('#duplicate-adset-dialog');
const disconnectMetaConfirmation = document.querySelector('#disconnect-meta-confirmation');
const activityHistoryReportDialog = document.querySelector('#activity-history-report-dialog');
const activityHistoryReportContent = document.querySelector('[data-history-report-content]');
const activityHistoryReportCount = document.querySelector('[data-history-report-count]');
const activityHistoryReportCopyButton = document.querySelector('[data-copy-history-report]');
let activityHistoryReportRowsCache = [];
initializeThemeToggle({
  root: document.documentElement,
  button: document.querySelector('#toggle-theme'),
  storage: window.localStorage,
  mediaQuery: window.matchMedia('(prefers-color-scheme: dark)'),
  themeColorMeta: document.querySelector('meta[name="theme-color"]')
});
const seedingRunner = createSeedingRunner({
  api,
  wait: (milliseconds) => wait(milliseconds),
  onUpdate: (seeding, { runId }) => {
    if (state.publishProgress?.runId === runId) {
      mergeRunSnapshot(state.publishProgress, { seeding });
      state.publishProgress.seedingError = null;
    }
    if (state.activityHistory.selectedRunId === runId && state.activityHistory.detail) {
      state.activityHistory.detail.seeding = seeding;
      state.activityHistory.detailsByRun[runId] = state.activityHistory.detail;
      state.activityHistory.seedingError = null;
    }
    const resultsFocus = captureDrawerFocus(resultsDrawer);
    renderResultsDrawer({ preserveScroll: true });
    renderWorkspaceTreeProgress();
    restoreDrawerFocus(resultsDrawer, resultsFocus);
  },
  onStop: ({ runId, state: seeding, reason, error }) => {
    if (seeding) applySeedingState(runId, seeding);
    if (reason === 'complete') void synchronizeCompletedRunProgress(runId);
    if (!error && !['failed', 'needs_review', 'conflict', 'stalled'].includes(reason)) return;
    if (state.publishProgress?.runId === runId) state.publishProgress.seedingError = error;
    if (state.activityHistory.selectedRunId === runId) state.activityHistory.seedingError = error;
    const resultsFocus = captureDrawerFocus(resultsDrawer);
    const historyFocus = captureDrawerFocus(historyWorkspace);
    renderResultsDrawer({ preserveScroll: true });
    renderWorkspaceTreeProgress();
    renderHistoryWorkspace();
    restoreDrawerFocus(resultsDrawer, resultsFocus);
    restoreDrawerFocus(historyWorkspace, historyFocus);
    const failedJob = seeding?.jobs?.find((job) => ['failed', 'needs_review'].includes(job.status));
    const message = error?.message ?? failedJob?.error?.message ?? {
      conflict: 'Có Post ID trùng giữa nhiều chiến dịch, cần chọn mẫu seeding.',
      stalled: 'Meta chưa cho phép tiếp tục gửi bình luận.'
    }[reason] ?? 'Seeding chưa hoàn tất.';
    showToast(`Seeding đã dừng: ${message}`);
  }
});

let validationSequence = 0;
let targetingSequence = 0;
let locationSequence = 0;
let targetingTimer;
let locationTimer;
const completedRunMonitors = new Map();
const targetingSearchCache = new Map();
const locationSearchCache = new Map();
let historyPublicationTimer;
let historyRealtimeTimer;
let seedingUploadQueue = Promise.resolve();
let metaAccountMenuOpen = false;
let disconnectingMeta = false;
let smartResourceSearchFocusIntent = null;
let campaignPresetLoadSequence = 0;

const publishRecoveryIntervalMs = 1000;
const publishRecoveryFailureLimit = 12;
const publishRecoveryTimeoutMs = 60 * 60 * 1000;
const historyRealtimeDelays = [2000, 3000, 5000, 10000];

function render() {
  draftStorage.save(state);
  workspace.inert = sessionLoading;
  const resourcePickerState = captureSmartResourcePickerState();
  const activeWorkspace = state.ui?.activeWorkspace ?? 'campaign';
  workspace.hidden = activeWorkspace === 'history';
  historyWorkspace.hidden = activeWorkspace !== 'history';
  renderPreservingEditorScroll(workspace, state.selection?.clientId, () => {
    refreshProgressErrors();
    workspace.innerHTML = activeWorkspace === 'seeding'
      ? renderSeedingWorkspace(state)
      : renderWorkspace(state);
    locationMaps.sync(workspace);
    workspace.classList.toggle('tree-collapsed', Boolean(state.ui?.treeCollapsed));
    const campaignModeActive = activeWorkspace !== 'history';
    openCampaignWorkspaceButton?.classList.toggle('is-active', campaignModeActive);
    openCampaignWorkspaceButton?.setAttribute('aria-pressed', String(campaignModeActive));
    openHistoryWorkspaceButton?.classList.toggle('is-active', activeWorkspace === 'history');
    openHistoryWorkspaceButton?.setAttribute('aria-pressed', String(activeWorkspace === 'history'));
    updateWorkspaceModePill();
    restoreSmartResourcePickerState(resourcePickerState);
    applyProgressFieldErrors();
    queueMicrotask(() => focusIntendedSmartResourceSearch());
  });
  renderTopbar();
  renderResultsDrawer();
  renderHistoryWorkspace();
}

function updateWorkspaceModePill({ animate = false } = {}) {
  const activeButton = workspaceModeNav?.querySelector('.workspace-mode-button.is-active');
  const pill = workspaceModeNav?.querySelector('.workspace-mode-pill');
  if (!activeButton || !pill) return;
  const navRect = workspaceModeNav.getBoundingClientRect();
  const buttonRect = activeButton.getBoundingClientRect();
  pill.style.width = `${buttonRect.width}px`;
  pill.style.transform = `translateX(${buttonRect.left - navRect.left - 4}px)`;
  if (!animate) return;
  workspaceModeNav.classList.remove('is-flowing');
  void pill.offsetWidth;
  workspaceModeNav.classList.add('is-flowing');
}

window.addEventListener('resize', () => updateWorkspaceModePill());

function renderResultsDrawer({ preserveScroll = false } = {}) {
  const shouldPreserveScroll = preserveScroll && state.ui.resultsOpen && state.publishProgress;
  const previousScrollTop = shouldPreserveScroll ? resultsDrawer.scrollTop : 0;
  resultsDrawer.classList.toggle('is-open', Boolean(state.ui.resultsOpen && state.publishProgress));
  resultsDrawer.innerHTML = state.ui.resultsOpen && state.publishProgress
    ? renderResults(state.publishProgress, { campaignClientId: state.ui.resultsCampaignClientId })
    : '';
  if (shouldPreserveScroll) resultsDrawer.scrollTop = previousScrollTop;
}

function renderWorkspaceTreeProgress() {
  if ((state.ui?.activeWorkspace ?? 'campaign') !== 'campaign') return;
  const tree = workspace.querySelector('.workspace-tree');
  if (!tree) return;
  const scrollTop = tree.scrollTop;
  const active = document.activeElement;
  const focus = active && tree.contains(active)
    ? { id: active.id ?? '', action: active.dataset.action ?? '', clientId: active.dataset.clientId ?? '' }
    : null;
  const next = document.createElement('div');
  next.innerHTML = renderWorkspace(state);
  const nextTree = next.querySelector('.workspace-tree');
  if (!nextTree) return;
  tree.replaceWith(nextTree);
  nextTree.scrollTop = scrollTop;
  if (!focus) return;
  const target = focus.id
    ? nextTree.querySelector(`#${CSS.escape(focus.id)}`)
    : [...nextTree.querySelectorAll('[data-action][data-client-id]')].find((control) => (
        control.dataset.action === focus.action && control.dataset.clientId === focus.clientId
      ));
  target?.focus({ preventScroll: true });
}

openCampaignWorkspaceButton?.addEventListener('click', () => {
  if (state.ui.activeWorkspace === 'campaign') return;
  resetHistoryRealtimeSync();
  state.activityHistory.open = false;
  state.ui.activeWorkspace = 'campaign';
  state.ui.treeOpen = false;
  state.ui.reviewOpen = false;
  render();
  updateWorkspaceModePill({ animate: true });
});
openHistoryWorkspaceButton?.addEventListener('click', async () => {
  if (state.ui.activeWorkspace === 'history') return;
  resetHistoryPublicationSync();
  resetHistoryRealtimeSync();
  state.ui.activeWorkspace = 'history';
  state.ui.treeOpen = false;
  state.ui.reviewOpen = false;
  state.activityHistory.open = true;
  state.activityHistory.error = null;
  render();
  updateWorkspaceModePill({ animate: true });
  if (!state.activityHistory.loaded) await loadActivityHistory();
  else scheduleHistoryRealtimeRefresh({ immediate: true });
});
function renderHistoryWorkspace({ resetScroll = false, preservedScrollTop = null } = {}) {
  const history = state.activityHistory;
  const previousScrollTop = resetScroll
    ? 0
    : preservedScrollTop ?? historyWorkspace.scrollTop;
  const previousWindowScroll = resetScroll
    ? { x: window.scrollX, y: 0 }
    : { x: window.scrollX, y: window.scrollY };
  historyWorkspace.innerHTML = state.ui.activeWorkspace === 'history'
    ? renderActivityHistory(history, { adAccounts: state.resources.adAccounts ?? [] })
    : '';
  if (state.ui.activeWorkspace === 'history') {
    historyWorkspace.scrollTop = previousScrollTop;
    window.scrollTo(previousWindowScroll.x, previousWindowScroll.y);
  }
}

function renderTopbar() {
  const activeWorkspace = state.ui?.activeWorkspace ?? 'campaign';
  const workspaceHeading = {
    campaign: ['Bàn điều khiển phát hành', 'Xây chiến dịch'],
    seeding: ['Tương tác sau quảng cáo', 'Soạn seeding'],
    history: ['Theo dõi vận hành', 'Lịch sử hoạt động']
  }[activeWorkspace];
  if (launchContextLabel) launchContextLabel.textContent = workspaceHeading[0];
  if (launchWorkspaceTitle) launchWorkspaceTitle.textContent = workspaceHeading[1];
  if (treeToggle) {
    treeToggle.hidden = activeWorkspace !== 'campaign';
    treeToggle.setAttribute('aria-expanded', String(activeWorkspace === 'campaign' && state.ui.treeOpen));
    treeToggle.setAttribute('aria-label', state.ui.treeOpen ? 'Đóng cấu trúc chiến dịch' : 'Mở cấu trúc chiến dịch');
  }
  if (reviewToggle) {
    reviewToggle.hidden = true;
    reviewToggle.setAttribute('aria-expanded', 'false');
  }
  connectButton.disabled = sessionLoading;
  const restoringKnownUser = sessionLoading && Boolean(rememberedMetaUser?.name);
  const connectionLabel = sessionLoading
    ? (restoringKnownUser ? rememberedMetaUser.name : 'Đang khôi phục kết nối…')
    : state.connected ? state.metaUser?.name || 'Tài khoản Meta' : 'Kết nối Meta';
  if (!sessionLoading) rememberMetaUser(state.connected ? state.metaUser : null);
  connectButton.classList.toggle('is-connected', state.connected || restoringKnownUser);
  if (!state.connected) metaAccountMenuOpen = false;
  metaAccountMenu.hidden = !state.connected || !metaAccountMenuOpen;
  connectButton.setAttribute('aria-expanded', String(state.connected && metaAccountMenuOpen));
  connectButton.querySelector('.connection-account-label').textContent = connectionLabel;
  connectButton.setAttribute('aria-label', state.connected
    ? `Mở menu tài khoản Meta của ${connectionLabel}`
    : 'Kết nối Meta');
  connectButton.title = state.connected ? 'Tùy chọn tài khoản Meta' : 'Kết nối Meta';
  openHistoryWorkspaceButton.disabled = false;
}

function confirmActivePublish() {
  if (!publishConfirmation) return Promise.resolve(false);
  return new Promise((resolve) => {
    publishConfirmation.returnValue = 'cancel';
    publishConfirmation.addEventListener('close', () => {
      resolve(publishConfirmation.returnValue === 'confirm');
    }, { once: true });
    publishConfirmation.showModal();
  });
}

function confirmMetaDisconnect() {
  if (!disconnectMetaConfirmation) return Promise.resolve(false);
  return new Promise((resolve) => {
    disconnectMetaConfirmation.returnValue = 'cancel';
    disconnectMetaConfirmation.addEventListener('close', () => {
      resolve(disconnectMetaConfirmation.returnValue === 'confirm');
    }, { once: true });
    disconnectMetaConfirmation.showModal();
  });
}

function confirmAction({ title, message, confirmLabel = 'Tiếp tục', tone = 'danger' }) {
  if (!actionConfirmation) return Promise.resolve(false);
  actionConfirmation.querySelector('#action-confirmation-title').textContent = title;
  actionConfirmation.querySelector('#action-confirmation-message').textContent = message;
  const confirmButton = actionConfirmation.querySelector('[data-confirm-action]');
  confirmButton.textContent = confirmLabel;
  confirmButton.className = tone === 'warning' ? 'button-primary' : 'button-danger';
  actionConfirmation.dataset.tone = tone;
  return new Promise((resolve) => {
    actionConfirmation.returnValue = 'cancel';
    actionConfirmation.addEventListener('close', () => {
      resolve(actionConfirmation.returnValue === 'confirm');
    }, { once: true });
    actionConfirmation.showModal();
  });
}

function requestAdSetDuplicateQuantity(sourceName) {
  if (!duplicateAdSetDialog) return Promise.resolve(null);
  const form = duplicateAdSetDialog.querySelector('[data-duplicate-adset-form]');
  const input = duplicateAdSetDialog.querySelector('#duplicate-adset-quantity');
  const error = duplicateAdSetDialog.querySelector('#duplicate-adset-error');
  const source = duplicateAdSetDialog.querySelector('[data-duplicate-adset-source]');
  source.textContent = sourceName?.trim() || 'Nhóm quảng cáo chưa đặt tên';
  form.reset();
  input.removeAttribute('aria-invalid');
  error.hidden = true;

  return new Promise((resolve) => {
    let quantity = null;
    const handleInput = () => {
      input.removeAttribute('aria-invalid');
      error.hidden = true;
    };
    const handleSubmit = (event) => {
      if (event.submitter?.value !== 'confirm') return;
      const value = Number(input.value);
      if (!Number.isInteger(value) || value < 1 || value > 20) {
        event.preventDefault();
        input.setAttribute('aria-invalid', 'true');
        error.hidden = false;
        input.focus();
        return;
      }
      quantity = value;
    };
    const handleClose = () => {
      input.removeEventListener('input', handleInput);
      form.removeEventListener('submit', handleSubmit);
      resolve(duplicateAdSetDialog.returnValue === 'confirm' ? quantity : null);
    };
    input.addEventListener('input', handleInput);
    form.addEventListener('submit', handleSubmit);
    duplicateAdSetDialog.addEventListener('close', handleClose, { once: true });
    duplicateAdSetDialog.returnValue = 'cancel';
    duplicateAdSetDialog.showModal();
    requestAnimationFrame(() => {
      input.focus();
      input.select();
    });
  });
}

function resetDisconnectedMetaState() {
  accountResourceRequests.invalidate();
  seedingResourceRequests.beginOwnerGeneration();
  campaignPresetLoadSequence += 1;
  state.connected = false;
  state.metaUser = null;
  state.ui.localDemoResources = false;
  state.resources.adAccounts = [];
  state.resources.capabilities = {};
  state.resources.conversationTemplates = [];
  state.resources.conversationTemplatesLoaded = false;
  state.resources.audienceTemplates = [];
  state.resources.audienceTemplatesLoaded = false;
  state.resources.audienceTemplatesError = null;
  state.resources.seedingTemplates = [];
  state.resources.seedingTemplatesLoaded = false;
  state.resources.seedingTemplatesError = null;
  state.resources.campaignPresets = [];
  state.resources.campaignPresetsLoaded = false;
  state.resources.campaignPresetsError = null;
  state.ui.loadingCampaignPresets = false;
  state.ui.campaignPresetSelectionByCampaignId = {};
  state.resources.audienceTemplates = [];
  state.resources.audienceTemplatesLoaded = false;
  state.resources.audienceTemplatesError = null;
  clearPageCatalogState(state);
  state.draft.campaigns.forEach((campaign) => {
    campaign.adAccountId = '';
    campaign.pageId = '';
  });
  metaAccountMenuOpen = false;
}

async function disconnectMetaAccount({ reconnect = false } = {}) {
  if (disconnectingMeta) return;
  api.clearCache();
  disconnectingMeta = true;
  try {
    await api.disconnectMeta();
    draftStorage.save(state);
    draftStorage.suspend();
    resetDisconnectedMetaState();
    render();
    if (reconnect) {
      window.location.assign('/api/auth/meta/start');
      return;
    }
    await validateCurrentDraft();
    showToast('Đã ngắt kết nối Meta. Lịch sử và thư viện mẫu vẫn được giữ nguyên.');
  } catch (error) {
    showToast(error.message || 'Không thể ngắt kết nối Meta.');
  } finally {
    disconnectingMeta = false;
  }
}

publishConfirmation?.addEventListener('click', (event) => {
  if (event.target === publishConfirmation) publishConfirmation.close('cancel');
});

disconnectMetaConfirmation?.addEventListener('click', (event) => {
  if (event.target === disconnectMetaConfirmation) disconnectMetaConfirmation.close('cancel');
});

actionConfirmation?.addEventListener('click', (event) => {
  if (event.target === actionConfirmation) actionConfirmation.close('cancel');
});

duplicateAdSetDialog?.addEventListener('click', (event) => {
  if (event.target === duplicateAdSetDialog) duplicateAdSetDialog.close('cancel');
});

resultsDrawer.addEventListener('click', (event) => {
  const control = event.target.closest('[data-action="close-results"]');
  if (control) {
    state.ui.resultsOpen = false;
    state.ui.resultsCampaignClientId = null;
    renderResultsDrawer();
    return;
  }
  const showAll = event.target.closest('[data-action="show-all-results"]');
  if (showAll) {
    state.ui.resultsCampaignClientId = null;
    renderResultsDrawer();
    return;
  }
  const seedingControl = event.target.closest('[data-action]');
  if (isSeedingAction(seedingControl?.dataset.action)) void handleSeedingAction(seedingControl, resultsDrawer);
});

historyWorkspace.addEventListener('click', async (event) => {
  const control = event.target.closest('[data-action]');
  if (!control) return;
  const { action, runId } = control.dataset;
  if (isSeedingAction(action)) {
    await handleSeedingAction(control, historyWorkspace);
    return;
  }
  if (action === 'close-history') {
    clearHistoryPublicationTimer();
    state.ui.activeWorkspace = 'campaign';
    state.activityHistory.open = false;
    render();
    return;
  }
  if (action === 'clear-history-filter') {
    state.activityHistory.filters = { from: '', to: '' };
    state.activityHistory.draftFilters = { from: '', to: '' };
    state.activityHistory.datePickerOpen = false;
    await loadActivityHistory();
    return;
  }
  if (action === 'toggle-history-date-picker') {
    const history = state.activityHistory;
    history.datePickerOpen = !history.datePickerOpen;
    history.draftFilters = { ...history.filters };
    history.datePickerMonth = history.filters.from || history.datePickerMonth || historyMonthValue(new Date());
    renderHistoryWorkspace();
    return;
  }
  if (action === 'select-history-date-preset') {
    const history = state.activityHistory;
    history.draftFilters = historyPresetRange(control.dataset.preset);
    history.datePickerMonth = history.draftFilters.from;
    renderHistoryWorkspace();
    return;
  }
  if (action === 'select-history-date') {
    const history = state.activityHistory;
    const selectedDate = control.dataset.date;
    if (!history.draftFilters.from || history.draftFilters.to) {
      history.draftFilters = { from: selectedDate, to: '' };
    } else if (selectedDate < history.draftFilters.from) {
      history.draftFilters = { from: selectedDate, to: history.draftFilters.from };
    } else {
      history.draftFilters = { from: history.draftFilters.from, to: selectedDate };
    }
    renderHistoryWorkspace();
    return;
  }
  if (action === 'navigate-history-month') {
    state.activityHistory.datePickerMonth = shiftHistoryMonth(
      state.activityHistory.datePickerMonth,
      Number(control.dataset.offset)
    );
    renderHistoryWorkspace();
    return;
  }
  if (action === 'cancel-history-date-picker') {
    state.activityHistory.datePickerOpen = false;
    state.activityHistory.draftFilters = { ...state.activityHistory.filters };
    renderHistoryWorkspace();
    return;
  }
  if (action === 'apply-history-date-picker') {
    state.activityHistory.filters = { ...state.activityHistory.draftFilters };
    state.activityHistory.datePickerOpen = false;
    await loadActivityHistory();
    return;
  }
  if (action === 'load-more-history') {
    await loadActivityHistory({ append: true });
    return;
  }
  if (action === 'open-activity-history-report') {
    await openActivityHistoryReport();
    return;
  }
  if (action === 'toggle-history-campaign') {
    const campaignClientId = control.dataset.campaignClientId ?? null;
    const history = state.activityHistory;
    const key = historyCampaignKey(runId, campaignClientId);
    const expandedKeys = history.expandedCampaignKeys ?? [];
    if (expandedKeys.includes(key)) {
      await animateHistoryCampaignCollapse(control);
      history.expandedCampaignKeys = expandedKeys.filter((expandedKey) => expandedKey !== key);
      finalizeHistoryCampaignCollapse(control);
      return;
    }
    history.expandedCampaignKeys = [...expandedKeys, key];
    if (!(history.mountedCampaignKeys ?? []).includes(key)) {
      history.mountedCampaignKeys = [...(history.mountedCampaignKeys ?? []), key];
    }
    history.selectedRunId = runId;
    history.selectedCampaignClientId = campaignClientId;
    if (history.detailsByRun?.[runId]) {
      history.detail = history.detailsByRun[runId];
      history.error = history.detailErrorsByRun?.[runId] ?? null;
      renderHistoryWorkspace();
      return;
    }
    await loadActivityHistoryDetail(runId, { resetScroll: false });
    return;
  }
  if (action === 'show-all-history-campaigns') {
    state.activityHistory.selectedCampaignClientId = null;
    renderHistoryWorkspace({ resetScroll: true });
    return;
  }
  if (action === 'retry-failed-ad') {
    const clientId = control.dataset.clientId;
    if (!runId || !clientId) return;
    const history = state.activityHistory;
    const retryKey = `${runId}::${clientId}`;
    if ((history.retryingAdKeys ?? []).includes(retryKey)) return;
    history.retryingAdKeys = [...(history.retryingAdKeys ?? []), retryKey];
    renderHistoryWorkspace();
    try {
      const payload = await api.retryFailedAd(runId, clientId);
      if (payload.run) {
        history.detail = payload.run;
        history.detailsByRun = { ...(history.detailsByRun ?? {}), [runId]: payload.run };
        upsertActivityHistoryRun(payload.run);
      }
      resetHistoryPublicationSync();
      showToast('Đã bắt đầu thử tạo lại đúng quảng cáo bị lỗi.');
      renderHistoryWorkspace();
      scheduleHistoryRealtimeRefresh({ immediate: true });
      if (payload.run && shouldAutoResumeSeeding(payload.run.seeding)) void seedingRunner.resume(runId);
    } catch (error) {
      showToast(error.message || 'Không thể thử tạo lại quảng cáo.');
    } finally {
      history.retryingAdKeys = (history.retryingAdKeys ?? []).filter((key) => key !== retryKey);
      renderHistoryWorkspace();
    }
    return;
  }
  if (action === 'resume-run-workflow') {
    event.preventDefault(); // nút nằm trong <summary>, không để click mở/đóng thẻ
    if (!runId) return;
    const history = state.activityHistory;
    if ((history.resumingRunIds ?? []).includes(runId)) return;
    history.resumingRunIds = [...(history.resumingRunIds ?? []), runId];
    renderHistoryWorkspace();
    try {
      const payload = await api.resumeRunWorkflow(runId);
      showToast(payload.accepted ? 'Đã chạy tiếp lượt tạo. Các đối tượng còn thiếu sẽ được tạo tiếp.' : 'Lượt tạo này đã kết thúc, không cần chạy tiếp.');
      scheduleHistoryRealtimeRefresh({ immediate: true });
    } catch (error) {
      showToast(error.message || 'Không thể chạy tiếp lượt tạo.');
    } finally {
      history.resumingRunIds = (history.resumingRunIds ?? []).filter((id) => id !== runId);
      renderHistoryWorkspace();
    }
    return;
  }
  if (action === 'refresh-history-publications') {
    await refreshHistoryPublications({ reset: true });
    return;
  }
  if (action === 'copy-history-value') {
    const copyValue = control.dataset.copyValue;
    if (!copyValue) return;
    try {
      await navigator.clipboard.writeText(copyValue);
      control.classList.add('is-copied');
      control.setAttribute('aria-label', 'Đã sao chép link Post');
      control.setAttribute('title', 'Đã sao chép');
      window.setTimeout(() => {
        control.classList.remove('is-copied');
        control.setAttribute('aria-label', 'Sao chép link Post');
        control.setAttribute('title', 'Sao chép link Post');
      }, 1500);
      showToast('Đã sao chép.');
    } catch {
      showToast('Không thể sao chép. Hãy cho phép trình duyệt truy cập clipboard.');
    }
    return;
  }
  if (action === 'back-history-list') {
    resetHistoryPublicationSync();
    state.activityHistory.selectedRunId = null;
    state.activityHistory.selectedCampaignClientId = null;
    state.activityHistory.detail = null;
    state.activityHistory.error = null;
    renderHistoryWorkspace({ resetScroll: true });
    // The standalone report only shows before the list has loaded.
    if (!state.activityHistory.loaded) await loadActivityHistory();
  }
});

async function openActivityHistoryReport() {
  const history = state.activityHistory;
  if (history.reportLoading || history.items.length === 0 || !activityHistoryReportDialog) return;
  history.reportLoading = true;
  activityHistoryReportRowsCache = [];
  activityHistoryReportContent.innerHTML = '<div class="history-report-dialog-loading">Đang tổng hợp lịch sử quảng cáo...</div>';
  activityHistoryReportCount.textContent = 'Đang tải dữ liệu';
  activityHistoryReportCopyButton.disabled = true;
  if (!activityHistoryReportDialog.open) activityHistoryReportDialog.showModal();
  renderHistoryWorkspace();
  const runs = [];
  let skippedRuns = 0;
  try {
    for (const summary of history.items) {
      const runId = String(summary.id ?? '');
      if (!runId) continue;
      try {
        const run = history.detailsByRun?.[runId] ?? await api.loadRun(runId);
        history.detailsByRun = { ...(history.detailsByRun ?? {}), [runId]: run };
        runs.push(run);
      } catch {
        skippedRuns += 1;
      }
    }
    activityHistoryReportRowsCache = activityHistoryReportRows(runs);
    activityHistoryReportContent.innerHTML = renderActivityHistoryReportTable(activityHistoryReportRowsCache);
    activityHistoryReportCount.textContent = `${activityHistoryReportRowsCache.length} bài quảng cáo${skippedRuns ? ` · Bỏ qua ${skippedRuns} lượt không tải được` : ''}`;
    activityHistoryReportCopyButton.disabled = activityHistoryReportRowsCache.length === 0;
  } catch (error) {
    activityHistoryReportContent.innerHTML = '<div class="history-report-dialog-empty"><strong>Không thể tải bảng</strong><p>Vui lòng đóng bảng và thử lại.</p></div>';
    activityHistoryReportCount.textContent = 'Có lỗi khi tải dữ liệu';
    showToast(error.message || 'Không thể tổng hợp lịch sử hoạt động.');
  } finally {
    history.reportLoading = false;
    renderHistoryWorkspace();
  }
}

activityHistoryReportCopyButton?.addEventListener('click', async () => {
  if (activityHistoryReportRowsCache.length === 0) return;
  try {
    await navigator.clipboard.writeText(activityHistoryReportCopyText(activityHistoryReportRowsCache));
    activityHistoryReportCopyButton.classList.add('is-copied');
    activityHistoryReportCopyButton.querySelector('span').textContent = 'Đã sao chép';
    showToast(`Đã sao chép ${activityHistoryReportRowsCache.length} dòng. Anh có thể dán thẳng vào Excel.`);
    window.setTimeout(() => {
      activityHistoryReportCopyButton.classList.remove('is-copied');
      activityHistoryReportCopyButton.querySelector('span').textContent = 'Sao chép bảng';
    }, 1800);
  } catch {
    showToast('Không thể sao chép. Hãy cho phép trình duyệt truy cập clipboard.');
  }
});

function animateHistoryCampaignCollapse(control) {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return Promise.resolve();
  const item = control.closest('.history-campaign-item');
  const shell = item?.querySelector('.history-campaign-detail-shell');
  if (!item || !shell || typeof shell.animate !== 'function') return Promise.resolve();
  const height = shell.getBoundingClientRect().height;
  if (height <= 1) return Promise.resolve();
  control.disabled = true;
  item.classList.remove('is-expanded');
  control.setAttribute('aria-expanded', 'false');
  const animation = shell.animate([
    { height: `${height}px`, opacity: 1, transform: 'translateY(0)' },
    { height: '0px', opacity: 0, transform: 'translateY(-6px)' }
  ], {
    duration: 300,
    easing: 'cubic-bezier(.4, 0, .2, 1)',
    fill: 'forwards'
  });
  return animation.finished.catch(() => undefined);
}

function finalizeHistoryCampaignCollapse(control) {
  const item = control.closest('.history-campaign-item');
  const shell = item?.querySelector('.history-campaign-detail-shell');
  item?.classList.remove('is-expanded');
  shell?.classList.remove('is-open');
  shell?.setAttribute('aria-hidden', 'true');
  shell?.getAnimations().forEach((animation) => animation.cancel());
  control.setAttribute('aria-expanded', 'false');
  control.setAttribute('aria-label', control.getAttribute('aria-label')?.replace('Thu gọn', 'Mở') ?? 'Mở báo cáo');
  control.disabled = false;
  const label = control.querySelector('.history-campaign-card-action > span');
  if (label) label.textContent = 'Mở báo cáo';
}

function historyMonthValue(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-01`;
}

function shiftHistoryMonth(value, offset) {
  const match = /^(\d{4})-(\d{2})/.exec(String(value));
  const base = match ? new Date(Number(match[1]), Number(match[2]) - 1, 1) : new Date();
  return historyMonthValue(new Date(base.getFullYear(), base.getMonth() + offset, 1));
}

async function loadActivityHistory({ append = false } = {}) {
  const history = state.activityHistory;
  const offset = append ? history.nextOffset : 0;
  if (append && offset === null) return;
  history.error = null;
  history.loading = !append;
  history.loadingMore = append;
  if (!append) {
    history.items = [];
    history.nextOffset = null;
  }
  renderHistoryWorkspace();
  try {
    const filtered = Boolean(history.filters.from || history.filters.to);
    if (filtered && !append) {
      const items = [];
      let nextOffset = 0;
      do {
        const payload = await api.listRuns(activityHistoryQuery(history.filters, nextOffset));
        items.push(...(payload.items ?? []));
        nextOffset = payload.nextOffset ?? null;
      } while (nextOffset !== null);
      history.items = items;
      history.nextOffset = null;
    } else {
      const query = activityHistoryQuery(history.filters, offset ?? 0);
      const payload = await api.listRuns(query);
      history.items = append ? [...history.items, ...(payload.items ?? [])] : (payload.items ?? []);
      history.nextOffset = null;
    }
    history.loaded = true;
  } catch (error) {
    history.error = error;
  } finally {
    history.loading = false;
    history.loadingMore = false;
    renderHistoryWorkspace();
    scheduleHistoryRealtimeRefresh({ immediate: true });
  }
}

async function loadActivityHistoryDetail(runId, { resetScroll = true } = {}) {
  const history = state.activityHistory;
  resetHistoryPublicationSync();
  history.selectedRunId = runId;
  history.detail = history.detailsByRun?.[runId] ?? null;
  history.detailLoading = true;
  history.detailLoadingByRun = { ...(history.detailLoadingByRun ?? {}), [runId]: true };
  history.error = null;
  history.detailErrorsByRun = { ...(history.detailErrorsByRun ?? {}), [runId]: null };
  history.seedingError = null;
  renderHistoryWorkspace({ resetScroll });
  try {
    history.detail = await api.loadRun(runId);
    history.detailsByRun = { ...(history.detailsByRun ?? {}), [runId]: history.detail };
    if (shouldAutoResumeSeeding(history.detail.seeding)) void seedingRunner.resume(runId);
  } catch (error) {
    history.error = error;
    history.detailErrorsByRun = { ...(history.detailErrorsByRun ?? {}), [runId]: error };
  } finally {
    history.detailLoading = false;
    history.detailLoadingByRun = { ...(history.detailLoadingByRun ?? {}), [runId]: false };
    renderHistoryWorkspace();
    scheduleHistoryPublicationRefresh();
  }
}

function clearHistoryPublicationTimer() {
  if (!historyPublicationTimer) return;
  window.clearTimeout(historyPublicationTimer);
  historyPublicationTimer = undefined;
}

function resetHistoryPublicationSync() {
  clearHistoryPublicationTimer();
  const history = state.activityHistory;
  history.publicationSyncing = false;
  history.publicationSyncAttempt = 0;
  history.publicationSyncError = null;
  history.publicationSync = null;
}

function clearHistoryRealtimeTimer() {
  if (!historyRealtimeTimer) return;
  window.clearTimeout(historyRealtimeTimer);
  historyRealtimeTimer = undefined;
}

function resetHistoryRealtimeSync() {
  clearHistoryRealtimeTimer();
  const history = state.activityHistory;
  history.realtimeRunId = null;
  history.realtimeAttempt = 0;
  history.realtimeRefreshing = false;
  history.realtimeError = null;
}

function latestActiveHistoryRun() {
  return state.activityHistory.items.find((run) => isActiveHistoryRun(run)) ?? null;
}

function upsertActivityHistoryRun(run) {
  const history = state.activityHistory;
  const runId = String(run?.id ?? run?.runId ?? '');
  if (!runId) return null;
  const index = history.items.findIndex((item) => String(item.id) === runId);
  const summary = historyRunSummary(run, index >= 0 ? history.items[index] : {});
  history.items = index >= 0
    ? history.items.map((item, itemIndex) => itemIndex === index ? summary : item)
    : [summary, ...history.items];
  return summary;
}

function syncLiveActivityHistory(run, { forceRender = false } = {}) {
  const history = state.activityHistory;
  if (state.ui.localDemoResources || (!history.loaded && !history.open)) return;
  const summary = upsertActivityHistoryRun(run);
  if (!summary) return;
  if (history.open && state.ui.activeWorkspace === 'history') {
    const patched = !forceRender && isActiveHistoryRun(summary) && updateHistoryRunProgressDom(summary);
    if (!patched) renderHistoryWorkspace();
  }
  scheduleHistoryRealtimeRefresh();
}

function scheduleHistoryRealtimeRefresh({ immediate = false } = {}) {
  clearHistoryRealtimeTimer();
  const history = state.activityHistory;
  if (!history.open || state.ui.activeWorkspace !== 'history' || document.hidden || history.realtimeRefreshing) return;
  const activeRun = latestActiveHistoryRun();
  if (!activeRun) return;
  history.realtimeRunId = activeRun.id;
  if (state.running && String(state.publishProgress?.runId ?? '') === String(activeRun.id)) return;
  const delay = immediate ? 0 : historyRealtimeDelays[Math.min(history.realtimeAttempt, historyRealtimeDelays.length - 1)];
  historyRealtimeTimer = window.setTimeout(() => {
    historyRealtimeTimer = undefined;
    void refreshHistoryRealtimeRun();
  }, delay);
}

async function refreshHistoryRealtimeRun() {
  const history = state.activityHistory;
  const activeRun = latestActiveHistoryRun();
  const runId = String(activeRun?.id ?? '');
  if (!runId || history.realtimeRefreshing || document.hidden) return;
  history.realtimeRefreshing = true;
  history.realtimeRunId = runId;
  try {
    const run = await api.loadRun(runId);
    if (!history.open || state.ui.activeWorkspace !== 'history' || history.realtimeRunId !== runId) return;
    const summary = upsertActivityHistoryRun(run);
    if (history.selectedRunId === runId) {
      history.detail = run;
      history.detailsByRun[runId] = run;
    }
    history.realtimeAttempt = 0;
    history.realtimeError = null;
    if (!summary || !isActiveHistoryRun(summary) || !updateHistoryRunProgressDom(summary)) renderHistoryWorkspace();
  } catch (error) {
    if (history.open && history.realtimeRunId === runId) {
      history.realtimeAttempt += 1;
      history.realtimeError = error;
    }
  } finally {
    history.realtimeRefreshing = false;
    scheduleHistoryRealtimeRefresh();
  }
}

function updateHistoryRunProgressDom(summary) {
  let updated = false;
  for (const campaign of summary.campaigns ?? []) {
    const selector = `[data-action="toggle-history-campaign"][data-run-id="${CSS.escape(String(summary.id))}"][data-campaign-client-id="${CSS.escape(String(campaign.clientId))}"]`;
    const card = historyWorkspace.querySelector(selector);
    if (!card) continue;
    updated = true;
    const status = campaign.status ?? 'pending';
    const progress = historyCampaignProgress(campaign);
    card.classList.remove('is-pending', 'is-created', 'is-failed');
    card.classList.add(`is-${status}`);
    const icon = card.querySelector('.history-campaign-card-icon');
    if (icon) icon.textContent = status === 'failed' ? '!' : status === 'created' ? '✓' : '…';
    const steps = card.querySelector('[data-history-campaign-steps]');
    if (steps) steps.textContent = `${progress.completed}/${progress.total}`;
    const statusControl = card.querySelector('[data-history-campaign-status]');
    if (statusControl) {
      statusControl.classList.remove('is-pending', 'is-created', 'is-failed');
      statusControl.classList.add(`is-${status}`);
      statusControl.textContent = historyCampaignStatusText(status);
    }
    const progressControl = card.querySelector('[data-history-campaign-progress]');
    if (progressControl) {
      progressControl.classList.remove('is-pending', 'is-created', 'is-failed');
      progressControl.classList.add(`is-${status}`);
      progressControl.setAttribute('aria-valuenow', String(progress.percent));
      progressControl.setAttribute('aria-valuetext', `${progress.percent}% · ${progress.completed}/${progress.total} bước hoàn tất`);
    }
    const value = card.querySelector('[data-history-progress-value]');
    if (value) value.textContent = `${progress.percent}%`;
    const fill = card.querySelector('[data-history-progress-fill]');
    if (fill) fill.style.setProperty('--history-progress', `${progress.percent}%`);
  }
  return updated;
}

function historyCampaignProgress(campaign) {
  const total = Math.max(0, Number(campaign.total) || 0);
  const completed = Math.min(total, Math.max(0, Number(campaign.completed) || 0));
  return { completed, total, percent: total > 0 ? Math.round(completed / total * 100) : 0 };
}

function historyCampaignStatusText(status) {
  return status === 'failed' ? 'Có lỗi' : status === 'created' ? 'Hoàn tất' : 'Chưa hoàn tất';
}

function scheduleHistoryPublicationRefresh() {
  const history = state.activityHistory;
  clearHistoryPublicationTimer();
  if (!history.open || !history.selectedRunId || history.publicationSyncing
    || !hasMissingPublications(history.detail)) return;
  const delay = publicationRetryDelay(history.publicationSyncAttempt);
  if (delay === null) return;
  historyPublicationTimer = window.setTimeout(() => {
    historyPublicationTimer = undefined;
    void refreshHistoryPublications();
  }, delay);
}

async function refreshHistoryPublications({ reset = false } = {}) {
  const history = state.activityHistory;
  const runId = history.selectedRunId;
  if (reset) resetHistoryPublicationSync();
  if (!history.open || !runId || history.publicationSyncing
    || !hasMissingPublications(history.detail)) return;
  history.publicationSyncing = true;
  history.publicationSyncError = null;
  renderHistoryWorkspace();
  try {
    const payload = await api.refreshRunPublications(runId);
    if (!history.open || history.selectedRunId !== runId) return;
    history.detail = payload.run;
    history.publicationSync = payload.sync ?? null;
  } catch (error) {
    if (!history.open || history.selectedRunId !== runId) return;
    history.publicationSyncError = error;
  } finally {
    if (!history.open || history.selectedRunId !== runId) return;
    history.publicationSyncing = false;
    history.publicationSyncAttempt += 1;
    renderHistoryWorkspace();
    scheduleHistoryPublicationRefresh();
  }
}

workspace.addEventListener('click', async (event) => {
  const control = event.target.closest('[data-action]');
  if (!control) return;

  const { action, clientId } = control.dataset;
  if (action === 'close-mobile-panels') {
    state.ui.treeOpen = false;
    state.ui.reviewOpen = false;
    render();
    return;
  }
  if (action === 'publish-draft') {
    await publishDraft();
    return;
  }
  if (action === 'upload-media-from-network-path') {
    const pathInput = control.closest('.media-network-upload')?.querySelector('[data-network-path]');
    await uploadMediaFromNetworkPath(clientId, pathInput?.value ?? '');
    return;
  }
  if (action === 'remove-media') {
    await clearAdMedia(clientId);
    return;
  }
  if (action === 'open-campaign-results' || action === 'open-node-results') {
    const match = findNode(state, clientId);
    state.ui.resultsCampaignClientId = match?.campaign?.clientId ?? clientId;
    state.ui.resultsOpen = true;
    renderResultsDrawer();
    if (state.publishProgress?.runId) void synchronizeCompletedRunProgress(state.publishProgress.runId);
    return;
  }
  if (action === 'open-campaign-workspace') {
    state.ui.activeWorkspace = 'campaign';
    render();
    return;
  }
  if (action === 'open-campaign-seeding') {
    const match = findNode(state, clientId);
    if (match?.type !== 'campaign' || !activateNode(state, clientId)) return;
    resetHistoryRealtimeSync();
    state.activityHistory.open = false;
    state.ui.activeWorkspace = 'seeding';
    state.ui.treeOpen = false;
    state.ui.reviewOpen = false;
    render();
    queueMicrotask(() => workspace.querySelector('[data-seeding-workspace-title]')?.focus({ preventScroll: true }));
    return;
  }
  if (action === 'toggle-tree-collapse') {
    state.ui.treeCollapsed = !state.ui.treeCollapsed;
    render();
    return;
  }
  if (action === 'jump-to-validation-issue') {
    await jumpToValidationIssue(control);
    return;
  }
  if (action === 'progress-next') {
    await activateProgressReview();
    return;
  }
  if (action === 'progress-step') {
    await openSetupProgressStep(control.dataset.progressStep, clientId);
    return;
  }
  if (action === 'progress-requirement') {
    const requirement = progressRequirement(state, clientId, control.dataset.validationField);
    if (requirement && !requirement.complete) {
      const gate = navigationGate(state, clientId);
      await revealProgressRequirements(gate.allowed ? [requirement] : gate.missing);
    }
    return;
  }
  if (action === 'toggle-campaign-collapse') {
    if (!toggleCampaignCollapsed(state, clientId)) return;
    state.ui.animatedDisclosureId = clientId;
    render();
    state.ui.animatedDisclosureId = null;
    focusCampaignDisclosure(clientId);
    return;
  }
  if (action === 'toggle-adset-collapse') {
    if (!toggleAdSetCollapsed(state, clientId)) return;
    state.ui.animatedDisclosureId = clientId;
    render();
    state.ui.animatedDisclosureId = null;
    focusCampaignDisclosure(clientId);
    return;
  }

  if (action === 'toggle-node-menu') {
    const opening = state.ui.openNodeMenuId !== clientId;
    if (!toggleNodeMenu(state, clientId)) return;
    render();
    if (opening) positionOpenNodeMenu(clientId);
    opening ? focusFirstNodeAction(clientId) : focusNodeMenuButton(clientId);
    return;
  }

  if (action === 'select-node') {
    const gate = navigationGate(state, clientId);
    const current = findNode(state, state.selection?.clientId);
    const movingBack = current && gate.match && stepIndex(current.type) > stepIndex(gate.match.type);
    if (!gate.allowed && !movingBack) {
      await revealProgressRequirements(gate.missing);
      return;
    }
    if (!activateNode(state, clientId)) return;
    state.ui.progressReviewMode = false;
    state.ui.treeOpen = false;
    render();
    focusNodeMain(clientId);
    await ensureAccountResourcesForNode(clientId);
    await ensureConversationTemplatesForNode(clientId);
    return;
  }

  if (action === 'add-campaign') {
    const campaign = addCampaign(state);
    closeNodeMenu(state);
    render();
    focusNodeMain(campaign.clientId);
    await ensureAccountResourcesForNode(campaign.clientId);
    await validateCurrentDraft();
    return;
  }

  if (action === 'duplicate-campaign') {
    const copy = duplicateCampaignSettings(state, clientId);
    closeNodeMenu(state);
    render();
    if (!copy) return;
    focusNodeMain(copy.clientId);
    await ensureAccountResourcesForNode(copy.clientId);
    await validateCurrentDraft();
    showToast('Đã sao chép Campaign, cài đặt nhóm quảng cáo và Seeding.');
    return;
  }

  if (action === 'add-adset') {
    const parent = findNode(state, clientId);
    const missing = parent?.type === 'campaign'
      ? requirementsForCampaign(parent.campaign).filter((item) => !item.complete)
      : [];
    if (missing.length > 0) {
      await revealProgressRequirements(missing);
      return;
    }
    const adSet = addAdSet(state, clientId);
    closeNodeMenu(state);
    render();
    if (!adSet) return;
    focusNodeMain(adSet.clientId);
    await validateCurrentDraft();
    return;
  }

  if (action === 'add-ad') {
    const parent = findNode(state, clientId);
    const missing = parent?.type === 'adSet'
      ? requirementsForAdSet(parent.campaign, parent.adSet).filter((item) => !item.complete)
      : [];
    if (missing.length > 0) {
      await revealProgressRequirements(missing);
      return;
    }
    const ad = addAd(state, clientId);
    closeNodeMenu(state);
    render();
    if (!ad) return;
    focusNodeMain(ad.clientId);
    await validateCurrentDraft();
    return;
  }

  if (action === 'duplicate-adset') {
    const source = findNode(state, clientId);
    closeNodeMenu(state);
    render();
    if (source?.type !== 'adSet') return;
    const quantity = await requestAdSetDuplicateQuantity(source.node.name);
    if (!quantity) {
      focusNodeMenuButton(clientId);
      return;
    }
    const copies = duplicateAdSets(state, clientId, quantity);
    render();
    if (copies.length === 0) return;
    focusNodeMain(copies.at(-1).clientId);
    await validateCurrentDraft();
    showToast(`Đã nhân ${copies.length} nhóm quảng cáo tương tự từ nhóm đã chọn.`);
    return;
  }

  if (action === 'duplicate-ad') {
    const copy = duplicateAd(state, clientId);
    closeNodeMenu(state);
    render();
    if (!copy) return;
    focusNodeMain(copy.clientId);
    await validateCurrentDraft();
    return;
  }

  if (action === 'remove-node') {
    const match = findNode(state, clientId);
    if (!match) return;
    const confirmed = await confirmAction({
      title: removeConfirmationTitle(match),
      message: removeConfirmation(match),
      confirmLabel: removeConfirmationLabel(match)
    });
    closeNodeMenu(state);
    if (!confirmed) {
      render();
      focusNodeMenuButton(clientId);
      return;
    }
    if (!removeNode(state, clientId)) return;
    render();
    focusNodeMain(state.selection?.clientId);
    await validateCurrentDraft();
    return;
  }

  if (action === 'set-targeting-category') {
    state.ui.targetingCategory = control.dataset.category;
    activeAccountResources().targetingResults = [];
    render();
    return;
  }

  if (action === 'set-location-side') {
    state.ui.locationSelectionSide = control.dataset.locationSide === 'exclude' ? 'exclude' : 'include';
    render();
    return;
  }

  if (action === 'search-location') {
    await searchLocations({ includeAddresses: true });
    return;
  }

  if (action === 'add-region') {
    const match = findNode(state, clientId);
    const region = resourcesForCampaign(state, match?.campaign).locationResults.find(
      (result) => result.key === control.dataset.regionKey
        && result.type === control.dataset.regionType
    );
    const added = match?.type === 'adSet' && region && (
      ['custom_location', 'address', 'place'].includes(region.type)
        ? moveCustomLocation(match.node, { ...region, radius: region.radius ?? 10 }, control.dataset.regionTarget)
        : moveRegion(match.node, region, control.dataset.regionTarget)
    );
    if (added) {
      dismissLocationSearch();
      render();
      await validateCurrentDraft();
    }
    return;
  }

  if (action === 'remove-region') {
    const match = findNode(state, clientId);
    if (match?.type === 'adSet'
      && removeRegion(match.node, control.dataset.regionKey, control.dataset.regionTarget)) {
      render();
      await validateCurrentDraft();
    }
    return;
  }

  if (action === 'remove-city') {
    const match = findNode(state, clientId);
    if (match?.type === 'adSet'
      && removeCity(match.node, control.dataset.cityKey, control.dataset.regionTarget)) {
      render();
      await validateCurrentDraft();
    }
    return;
  }

  if (action === 'add-custom-location') {
    const match = findNode(state, clientId);
    const entry = control.closest('[data-custom-location-entry]');
    const latitudeInput = entry?.querySelector('[data-pin-latitude]')?.value.trim() ?? '';
    const longitudeInput = entry?.querySelector('[data-pin-longitude]')?.value.trim() ?? '';
    const latitude = Number(latitudeInput);
    const longitude = Number(longitudeInput);
    const radius = Number(entry?.querySelector('[data-pin-radius]')?.value);
    const name = entry?.querySelector('[data-pin-name]')?.value.trim()
      || `Ghim ${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
    if (match?.type !== 'adSet'
      || !latitudeInput || !longitudeInput
      || !Number.isFinite(latitude)
      || latitude < -90
      || latitude > 90
      || !Number.isFinite(longitude)
      || longitude < -180
      || longitude > 180) {
      showToast('Nhập vĩ độ và kinh độ hợp lệ trước khi thêm ghim.');
      return;
    }
    if (moveCustomLocation(match.node, {
      name,
      latitude,
      longitude,
      radius,
      countryCode: 'VN'
    }, control.dataset.regionTarget)) {
      render();
      await validateCurrentDraft();
    }
    return;
  }

  if (action === 'remove-custom-location') {
    const match = findNode(state, clientId);
    if (match?.type === 'adSet'
      && removeCustomLocation(match.node, control.dataset.locationKey, control.dataset.regionTarget)) {
      render();
      await validateCurrentDraft();
    }
    return;
  }

  if (action === 'search-targeting') {
    await searchTargeting();
    return;
  }

  if (action === 'add-targeting') {
    addTargetingItem(clientId, control.dataset.targetingId);
    render();
    await validateCurrentDraft();
    return;
  }

  if (action === 'remove-targeting') {
    const match = findNode(state, clientId);
    if (match?.type === 'adSet') {
      match.node.detailedTargeting = match.node.detailedTargeting.filter(
        (item) => item.id !== control.dataset.targetingId
      );
      render();
      await validateCurrentDraft();
    }
    return;
  }

  if (action === 'remove-custom-audience') {
    const match = findNode(state, clientId);
    if (match?.type === 'adSet') {
      const audienceId = control.dataset.audienceId;
      match.node.includedCustomAudienceIds = match.node.includedCustomAudienceIds.filter((id) => id !== audienceId);
      match.node.excludedCustomAudienceIds = match.node.excludedCustomAudienceIds.filter((id) => id !== audienceId);
      render();
      await validateCurrentDraft();
    }
    return;
  }

  if (await handleSeedingClick(action, clientId, control)) {
    return;
  }

  if (await handleCampaignPresetClick(action, clientId, control)) {
    return;
  }

  if (await handleAudienceClick(action, clientId, control)) {
    return;
  }

  if (await handleConversationClick(action, clientId, control)) {
    return;
  }

});

async function openSetupProgressStep(step, clientId) {
  const progress = workspaceProgress(state);
  const targetStep = progress.steps.find((entry) => entry.id === step);
  if (!targetStep) return;
  if (targetStep.locked) {
    await revealProgressRequirements(targetStep.gateRequirements.length
      ? targetStep.gateRequirements
      : targetStep.missing);
    return;
  }
  if (step === 'review') {
    await activateProgressReview();
    return;
  }
  const targetClientId = clientId || targetStep.targetClientId;
  if (targetClientId) await openProgressNode(targetClientId);
}

async function openProgressNode(clientId) {
  if (!activateNode(state, clientId)) return;
  state.ui.progressReviewMode = false;
  state.ui.treeOpen = false;
  state.ui.reviewOpen = false;
  render();
  focusNodeMain(clientId);
  await ensureAccountResourcesForNode(clientId);
  await ensureConversationTemplatesForNode(clientId);
}

async function activateProgressReview() {
  const firstMissing = firstIncompleteRequirement(state);
  if (firstMissing) {
    await revealProgressRequirements([firstMissing]);
    return;
  }
  state.ui.progressReviewMode = true;
  state.ui.reviewOpen = false;
  if (state.ui.localDemoResources) {
    state.issues = [];
    render();
    showToast('Đã điền đủ thông tin. Anh có thể bấm Đăng thử để xem toàn bộ tiến trình local.');
    return;
  }
  await validateCurrentDraft();
  state.ui.reviewOpen = false;
  if ((state.issues ?? []).length > 0) {
    await revealValidationIssues(state.issues);
    return;
  }
  render();
}

async function revealProgressRequirements(requirements) {
  const missing = requirements.filter((requirement) => !requirement.complete);
  if (missing.length === 0) return;
  const previous = state.ui.progressErrors ?? [];
  const byKey = new Map(previous.map((requirement) => [requirement.key, requirement]));
  missing.forEach((requirement) => byKey.set(requirement.key, requirement));
  state.ui.progressErrors = [...byKey.values()];
  state.ui.progressReviewMode = false;
  state.ui.treeOpen = false;
  state.ui.reviewOpen = false;
  render();
  showToast(`Còn ${missing.length} mục bắt buộc. Em đã đánh dấu vị trí cần hoàn thành.`);
  await jumpToProgressRequirement(missing[0]);
}

async function revealValidationIssues(issues) {
  const errors = (issues ?? []).map(validationIssueProgressError).filter(Boolean);
  if (errors.length === 0) {
    render();
    showToast(`Còn ${(issues ?? []).length} lỗi cần xử lý trước khi đăng.`);
    return true;
  }
  const previous = state.ui.progressErrors ?? [];
  const byKey = new Map(previous.map((entry) => [entry.key, entry]));
  errors.forEach((entry) => byKey.set(entry.key, entry));
  state.ui.progressErrors = [...byKey.values()];
  state.ui.progressReviewMode = false;
  state.ui.treeOpen = false;
  state.ui.reviewOpen = false;
  render();
  showToast(`Còn ${errors.length} lỗi. Em đã đánh dấu trực tiếp tại trường cần sửa.`);
  await jumpToProgressRequirement(errors[0]);
  return true;
}

function validationIssueProgressError(issue) {
  const path = String(issue?.path ?? '');
  const segments = path.split('.');
  if (segments[0] !== 'campaigns') return null;
  const campaign = state.draft?.campaigns?.[Number(segments[1])];
  if (!campaign) return null;
  let node = campaign;
  let fieldSegments = segments.slice(2);
  if (segments[2] === 'adSets') {
    const adSet = campaign.adSets?.[Number(segments[3])];
    if (!adSet) return null;
    node = adSet;
    fieldSegments = segments.slice(4);
    if (segments[4] === 'ads') {
      const ad = adSet.ads?.[Number(segments[5])];
      if (!ad) return null;
      node = ad;
      fieldSegments = segments.slice(6);
    }
  }
  const field = fieldSegments.join('.');
  if (!field) return null;
  if (['adAccountId', 'pageId'].includes(fieldSegments[0])) node = campaign;
  return {
    key: `issue:${path}`,
    issuePath: path,
    clientId: node.clientId,
    field,
    label: fieldSegments.at(-1) ?? field,
    complete: false,
    message: String(issue?.message ?? 'Kiểm tra lại trường này')
  };
}

async function jumpToProgressRequirement(requirement) {
  await jumpToValidationIssue({
    dataset: {
      clientId: requirement.clientId,
      validationField: requirement.field
    }
  });
}

async function jumpToValidationIssue(control) {
  const clientId = control.dataset.clientId;
  const fieldPath = control.dataset.validationField ?? '';
  if (!clientId || !activateNode(state, clientId)) {
    showToast('Không tìm thấy trường cần sửa. Hãy kiểm tra lại đối tượng.');
    return;
  }
  state.ui.treeOpen = false;
  state.ui.reviewOpen = false;
  state.ui.progressReviewMode = false;
  const useCampaignSeedingPicker = fieldPath === 'seeding.templateId';
  state.ui.activeWorkspace = fieldPath.startsWith('seeding') && !useCampaignSeedingPicker
    ? 'seeding'
    : 'campaign';
  render();
  await new Promise((resolve) => window.requestAnimationFrame(resolve));
  const target = validationTargetSelectors(clientId, fieldPath)
    .map((selector) => workspace.querySelector(selector))
    .find(Boolean);
  if (!target) {
    showToast('Đã mở đúng đối tượng nhưng không tìm thấy trường cụ thể.');
    return;
  }
  if (useCampaignSeedingPicker && target.matches('[data-campaign-seeding-template-picker]')) {
    target.open = true;
  }
  const highlightTarget = target.closest('.field, .smart-resource-picker, .media-dropzone, .location-editor, .conversation-composer, .template-card-picker, .template-card-dropdown, .editor-section') ?? target;
  workspace.querySelectorAll('.is-validation-highlight').forEach((element) => element.classList.remove('is-validation-highlight'));
  highlightTarget.classList.add('is-validation-highlight');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  highlightTarget.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center', inline: 'nearest' });
  const focusTarget = target.matches('input:not([type="hidden"]), select, textarea, button, summary, [tabindex]')
    ? target
    : target.querySelector('input:not([type="hidden"]), select, textarea, button, summary, [tabindex]:not([tabindex="-1"])');
  window.setTimeout(() => focusTarget?.focus({ preventScroll: true }), reduceMotion ? 0 : 320);
  window.setTimeout(() => highlightTarget.classList.remove('is-validation-highlight'), 3000);
}

function validationTargetSelectors(clientId, fieldPath) {
  const safeClientId = CSS.escape(String(clientId));
  const safeFieldPath = CSS.escape(String(fieldPath));
  const segments = String(fieldPath).split('.').filter(Boolean);
  const leaf = CSS.escape(segments.at(-1) ?? '');
  const selectors = [];
  if (fieldPath) selectors.push(`[data-client-id="${safeClientId}"][data-field="${safeFieldPath}"]`);
  if (leaf) selectors.push(`[data-client-id="${safeClientId}"][data-field="${leaf}"]`);
  if (leaf) selectors.push(`[data-client-id="${safeClientId}"][data-resource-kind="${leaf}"]`);
  if (segments[0] === 'conversation') {
    if (segments[1]) selectors.push(`[data-client-id="${safeClientId}"][data-conversation-field="${CSS.escape(segments[1])}"]`);
    selectors.push(`[data-validation-field="conversation"]`);
  }
  if (segments[0] === 'seeding') {
    if (segments[1] === 'templateId') selectors.push(
      `[data-client-id="${safeClientId}"][data-campaign-seeding-template-picker]`,
      '.seeding-template-card-picker'
    );
    if (segments[1]) selectors.push(`[data-client-id="${safeClientId}"][data-seeding-field="${CSS.escape(segments[1])}"]`);
    selectors.push('[data-seeding-section]');
  }
  if (['includedRegions', 'excludedRegions', 'includedCities', 'excludedCities', 'includedCustomLocations', 'excludedCustomLocations', 'regions', 'cities', 'customLocations', 'locationMode'].includes(segments[0])) selectors.push('.location-editor');
  if (segments[0] === 'ages') selectors.push(`[data-client-id="${safeClientId}"][data-field="ageMin"]`);
  if (segments[0] === 'schedule') selectors.push('.adset-setup-schedule-row');
  if (segments[0] === 'customAudiences') selectors.push('.audience-compact-custom');
  if (segments[0] === 'advantageAudienceEnabled') selectors.push('.audience-compact-header');
  if (segments[0] === 'mediaId') selectors.push(`[data-media-dropzone="${safeClientId}"]`);
  selectors.push(`.workspace-editor [data-client-id="${safeClientId}"]`, '.workspace-editor .editor-section');
  return selectors;
}

function refreshProgressErrors() {
  const current = state.ui?.progressErrors ?? [];
  state.ui.progressErrors = current
    .map((entry) => {
      if (entry.issuePath) {
        const issue = (state.issues ?? []).find((item) => String(item.path ?? '') === entry.issuePath);
        return issue ? { ...entry, message: String(issue.message ?? entry.message) } : null;
      }
      return progressRequirement(state, entry.clientId, entry.field);
    })
    .filter((entry) => entry && !entry.complete);
}

function applyProgressFieldErrors() {
  workspace.querySelectorAll('.progress-field-assistive-error').forEach((element) => element.remove());
  workspace.querySelectorAll('.has-progress-error').forEach((element) => element.classList.remove('has-progress-error'));
  workspace.querySelectorAll('[data-progress-invalid="true"]').forEach((element) => {
    element.removeAttribute('data-progress-invalid');
    element.removeAttribute('aria-invalid');
    element.removeAttribute('aria-describedby');
  });

  for (const requirement of state.ui?.progressErrors ?? []) {
    const target = validationTargetSelectors(requirement.clientId, requirement.field)
      .map((selector) => workspace.querySelector(selector))
      .find(Boolean);
    if (!target) continue;
    const container = target.closest('.field, .smart-resource-picker, .media-dropzone, .location-editor, .conversation-composer, .expand-select, .adset-setup-schedule-row, .audience-compact-custom, .audience-compact-header, .editor-section') ?? target;
    const errorId = `progress-error-${String(requirement.clientId).replace(/[^a-zA-Z0-9_-]/g, '-')}-${String(requirement.field).replace(/[^a-zA-Z0-9_-]/g, '-')}`;
    container.classList.add('has-progress-error');
    const focusTarget = target.matches('input:not([type="hidden"]), textarea, select, button, summary')
      ? target
      : target.querySelector('input:not([type="hidden"]), textarea, select, button, summary');
    if (focusTarget) {
      focusTarget.setAttribute('data-progress-invalid', 'true');
      focusTarget.setAttribute('aria-invalid', 'true');
      focusTarget.setAttribute('aria-describedby', errorId);
    }
    const message = document.createElement('p');
    message.id = errorId;
    message.className = 'progress-field-assistive-error sr-only';
    message.setAttribute('role', 'alert');
    message.textContent = String(requirement.message ?? 'Trường bắt buộc chưa hoàn thành');
    container.append(message);
  }
}

function progressFieldForControl(control) {
  if (control.dataset.conversationField) return `conversation.${control.dataset.conversationField}`;
  if (control.dataset.field) return control.dataset.field;
  if (control.dataset.resourceKind) return control.dataset.resourceKind;
  return '';
}

function syncProgressErrorForControl(control, { revealMissing = false } = {}) {
  const clientId = control.dataset.clientId;
  const field = progressFieldForControl(control);
  if (!clientId || !field) return;
  const requirement = progressRequirement(state, clientId, field);
  if (!requirement) return;
  const current = new Map((state.ui.progressErrors ?? []).map((entry) => [entry.key, entry]));
  if (requirement.complete) current.delete(requirement.key);
  else if (revealMissing || current.has(requirement.key)) current.set(requirement.key, requirement);
  state.ui.progressErrors = [...current.values()];
  applyProgressFieldErrors();
}

workspace.addEventListener('dragover', (event) => {
  const dropzone = event.target.closest('[data-media-dropzone]');
  if (!dropzone) return;
  event.preventDefault();
  if (dropzone.querySelector('[data-action="upload-media"]:disabled')) return;
  event.dataTransfer.dropEffect = 'copy';
  dropzone.classList.add('is-dragover');
});

workspace.addEventListener('dragleave', (event) => {
  const dropzone = event.target.closest('[data-media-dropzone]');
  if (!dropzone || dropzone.contains(event.relatedTarget)) return;
  dropzone.classList.remove('is-dragover');
});

workspace.addEventListener('drop', async (event) => {
  const dropzone = event.target.closest('[data-media-dropzone]');
  if (!dropzone) return;
  event.preventDefault();
  dropzone.classList.remove('is-dragover');
  const input = dropzone.querySelector('[data-action="upload-media"]');
  const file = event.dataTransfer?.files?.[0];
  if (!file || input?.disabled) return;
  await uploadMediaFile(file, dropzone.dataset.mediaDropzone);
});

workspace.addEventListener('input', (event) => {
  const control = event.target;
  if (control.matches('[data-currency-input]')) {
    const digits = control.value.replace(/\D/g, '');
    control.value = digits ? Number(digits).toLocaleString('vi-VN') : '';
  }

  if (control.matches('[data-role="targeting-query"]')) {
    state.ui.targetingQuery = control.value;
    scheduleTargetingSearch();
    return;
  }

  if (control.matches('[data-role="location-query"]')) {
    state.ui.locationQuery = control.value;
    scheduleLocationSearch();
    return;
  }

  if (control.matches('[data-location-radius]')) {
    const match = findNode(state, control.dataset.clientId);
    if (match?.type === 'adSet' && control.value !== '') {
      updateCityRadius(
        match.node,
        control.dataset.cityKey,
        control.dataset.regionTarget,
        Number(control.value)
      );
    }
    return;
  }

  if (control.matches('[data-custom-location-radius]')) {
    const match = findNode(state, control.dataset.clientId);
    if (match?.type === 'adSet' && control.value !== '') {
      updateCustomLocationRadius(
        match.node,
        control.dataset.locationKey,
        control.dataset.regionTarget,
        Number(control.value)
      );
    }
    return;
  }

  if (control.dataset.audienceField === 'templateName' && control.dataset.clientId) {
    updateAdSetAudienceTemplateName(state, control.dataset.clientId, control.value);
    const saveButton = control.closest('.audience-template-manager')
      ?.querySelector('[data-action="save-audience-template"]');
    if (saveButton) saveButton.disabled = !control.value.trim();
    return;
  }

  if (control.dataset.seedingField) {
    updateSeedingControl(control);
    refreshTemplateQuickSave('seeding', control.dataset.clientId);
    void validateCurrentDraft({ renderView: false });
    return;
  }

  if ((control.dataset.conversationField || control.dataset.conversationCollection)
    && control.type !== 'checkbox' && control.tagName !== 'SELECT') {
    if (updateConversationControl(control)) {
      const context = conversationContext(control.dataset.clientId);
      if (context) updateConversationPreview(context.ad.conversation);
      refreshTemplateQuickSave('conversation', control.dataset.clientId);
      syncProgressErrorForControl(control);
    }
    return;
  }

  if (control.dataset.field && control.dataset.clientId) {
    const match = findNode(state, control.dataset.clientId);
    const previousCreativeGroupId = match?.node.creativeGroupId;
    updateNodeField(
      state,
      control.dataset.clientId,
      control.dataset.field,
      normalizedFieldValue(control)
    );
    if (match?.type === 'ad'
      && previousCreativeGroupId !== match.node.creativeGroupId) {
      dismissSharedCreativeNotice();
    }
    syncProgressErrorForControl(control);
  }
});

workspace.addEventListener('focusout', (event) => {
  const control = event.target.closest('[data-client-id]');
  if (!control) return;
  const field = progressFieldForControl(control);
  if (!field) return;
  syncProgressErrorForControl(control, { revealMissing: true });
}, true);

workspace.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && event.target.matches('[data-role="location-query"]')) {
    event.preventDefault();
    void searchLocations({ includeAddresses: true });
  }
});

workspace.addEventListener('location-map-select', async (event) => {
  const host = event.target.closest('[data-location-map]');
  const match = findNode(state, host?.dataset.clientId);
  if (match?.type !== 'adSet' || match.node.clientId !== state.selection?.clientId) return;
  if (match.node.audienceTemplateId && !isToolAudienceTemplateId(match.node.audienceTemplateId)) return;
  const { latitude, longitude } = event.detail ?? {};
  const side = host.dataset.regionTarget === 'exclude' ? 'exclude' : 'include';
  const list = side === 'exclude' ? match.node.excludedCustomLocations : match.node.includedCustomLocations;
  const existing = (list ?? []).find((location) => location.key === host.dataset.locationKey);
  const newKey = `pin:${Number(latitude).toFixed(6)},${Number(longitude).toFixed(6)}`;
  if (!moveCustomLocation(match.node, {
    key: newKey,
    latitude,
    longitude,
    name: `Ghim ${Number(latitude).toFixed(5)}, ${Number(longitude).toFixed(5)}`,
    radius: existing?.radius ?? 10,
    distanceUnit: existing?.distanceUnit ?? 'kilometer'
  }, side)) return;
  if (existing && existing.key !== newKey) removeCustomLocation(match.node, existing.key, side);
  render();
  showToast(existing ? 'Đã cập nhật vị trí ghim.' : 'Đã thêm ghim. Anh có thể điều chỉnh bán kính bên dưới bản đồ.');
  await validateCurrentDraft();
});

workspace.addEventListener('change', async (event) => {
  const control = event.target;
  if (control.matches('[data-location-radius]')) {
    const match = findNode(state, control.dataset.clientId);
    if (match?.type === 'adSet' && updateCityRadius(
      match.node,
      control.dataset.cityKey,
      control.dataset.regionTarget,
      Number(control.value)
    )) {
      render();
      await validateCurrentDraft();
    }
    return;
  }
  if (control.matches('[data-custom-location-radius]')) {
    const match = findNode(state, control.dataset.clientId);
    if (match?.type === 'adSet' && updateCustomLocationRadius(
      match.node,
      control.dataset.locationKey,
      control.dataset.regionTarget,
      Number(control.value)
    )) {
      render();
      await validateCurrentDraft();
    }
    return;
  }
  if (control.dataset.resourceCombobox) {
    await handleResourceComboboxChange(control);
    focusRenderedSmartResourceTrigger(control);
    return;
  }
  if (control.dataset.action === 'upload-seeding-image') {
    await queueSeedingImageUpload(control);
    return;
  }
  if (control.dataset.action === 'upload-conversation-image') {
    await uploadConversationImage(control);
    return;
  }

  if (control.dataset.action === 'toggle-seeding') {
    updateCampaignSeeding(state, control.dataset.clientId, 'enabled', control.checked);
    render();
    await validateCurrentDraft();
    return;
  }

  if (control.dataset.action === 'select-seeding-template') {
    const context = seedingContext(control.dataset.clientId);
    if (!context || state.resources.seedingTemplatesLoaded !== true) return;
    const enabled = Boolean(context.campaign.seeding?.enabled);
    const template = seedingTemplates().find((entry) => entry.id === control.value);
    if (template) {
      applyCampaignSeedingTemplate(state, context.campaign.clientId, template);
    } else {
      const nextSeeding = createEmptySeeding();
      nextSeeding.enabled = enabled;
      replaceCampaignSeeding(state, context.campaign.clientId, nextSeeding);
    }
    discardStaleSeedingUploads();
    render();
    await validateCurrentDraft();
    return;
  }

  if (control.dataset.action === 'upload-media') {
    await uploadMedia(control);
    return;
  }

  if (control.dataset.action === 'move-custom-audience') {
    const context = audienceContext(control.dataset.clientId);
    const metaTemplateId = context?.adSet.audienceTemplateId
      && !isToolAudienceTemplateId(context.adSet.audienceTemplateId)
      ? context.adSet.audienceTemplateId
      : null;
    const metaTemplateName = metaTemplateId ? context.adSet.audienceTemplateName : '';
    if (customizeCustomAudience(
      state,
      control.dataset.clientId,
      control.value,
      control.dataset.audienceTarget
    )) {
      if (metaTemplateId && context) {
        state.ui.loadingAudienceTemplates = true;
        render();
        try {
          const templateInput = {
            name: uniqueAudienceTemplateName(`${metaTemplateName || 'Đối tượng Meta'} - Bản tùy chỉnh`),
            content: {
              ...audienceTemplateContent(context.adSet),
              sourceAdAccountId: context.campaign.adAccountId
            }
          };
          const payload = await api.createAudienceTemplate(templateInput);
          upsertAudienceTemplate(payload.template);
          applyAudienceTemplateToAdSet(state, context.adSet.clientId, payload.template);
          showToast('Đã tạo bản tùy chỉnh trong thư viện của bạn.');
        } catch (error) {
          showToast(`${error.message}. Thay đổi vẫn được giữ để anh lưu lại.`);
        } finally {
          state.ui.loadingAudienceTemplates = false;
        }
      }
      render();
      await validateCurrentDraft();
    }
    return;
  }

  if (control.dataset.action === 'select-audience-template') {
    const context = audienceContext(control.dataset.clientId);
    if (!context) return;
    if (!control.value) {
      detachAdSetAudienceTemplate(state, context.adSet.clientId);
    } else {
      const template = isToolAudienceTemplateId(control.value)
        ? audienceTemplates().find((entry) => entry.id === control.value)
        : (resourcesForCampaign(state, context.campaign).savedAudiences ?? [])
          .find((entry) => entry.id === control.value);
      if (template && isToolAudienceTemplateId(control.value)) {
        const compatibility = toolAudienceTemplateCompatibility(
          template,
          context.campaign.adAccountId,
          resourcesForCampaign(state, context.campaign).customAudiences ?? []
        );
        const allowedIds = new Set(compatibility.allowedCustomAudienceIds ?? []);
        const content = template.content ?? template;
        const filteredTemplate = {
          ...template,
          content: {
            ...content,
            includedCustomAudienceIds: (content.includedCustomAudienceIds ?? []).filter((id) => allowedIds.has(String(id))),
            excludedCustomAudienceIds: (content.excludedCustomAudienceIds ?? []).filter((id) => allowedIds.has(String(id)))
          }
        };
        applyAudienceTemplateToAdSet(state, context.adSet.clientId, filteredTemplate);
        context.adSet.audienceTemplateWarning = compatibility.warning;
        if (compatibility.warning) showToast(compatibility.warning);
      } else if (template) {
        applyAudienceTemplateToAdSet(state, context.adSet.clientId, template);
      }
    }
    render();
    await validateCurrentDraft();
    focusRenderedDropdownTrigger(control);
    return;
  }

  if (control.dataset.action === 'select-conversation-template') {
    const context = conversationContext(control.dataset.clientId);
    if (context && !control.value) {
      detachCreativeForAd(context.ad);
      context.ad.conversation = createDefaultConversation();
      render();
      await validateCurrentDraft();
      return;
    }
    const template = templatesForPage().find(
      (entry) => entry.id === control.value
    );
    if (context && template) {
      applyTemplateToAd(context.ad, template);
      render();
      await validateCurrentDraft();
      focusRenderedDropdownTrigger(control);
    }
    return;
  }

  if (control.dataset.conversationField || control.dataset.conversationCollection) {
    if (updateConversationControl(control)) {
      render();
      await validateCurrentDraft();
    }
    return;
  }

  if (!control.dataset.field || !control.dataset.clientId) return;
  if (control.type === 'radio' && !control.checked) return;

  const match = findNode(state, control.dataset.clientId);

  updateNodeField(
    state,
    control.dataset.clientId,
    control.dataset.field,
    normalizedFieldValue(control)
  );
  render();
  await validateCurrentDraft();
  focusRenderedDropdownTrigger(control);
});

async function handleResourceComboboxChange(control, explicitValue = control.value) {
  const match = findNode(state, control.dataset.clientId);
  if (match?.type !== 'campaign') return;
  if (control.dataset.resourceCombobox === 'adAccountId') {
    const accountId = resolveAccountComboboxSelection(
      state.resources.adAccounts,
      explicitValue
    );
    if (!accountId) {
      render();
      return;
    }
    accountResourceRequests.invalidate();
    changeCampaignAccount(state, match.node.clientId, accountId);
    clearActiveSearchResults();
    render();
    await ensureAccountResourcesForNode(match.node.clientId);
    await validateCurrentDraft();
    return;
  }
  const pages = state.resources.pages ?? [];
  const pageId = resolvePageComboboxSelection(pages, explicitValue, match.node.pageId);
  if (pageId === match.node.pageId) {
    render();
    return;
  }
  updateNodeField(state, match.node.clientId, 'pageId', pageId);
  render();
  await validateCurrentDraft();
}

workspace.addEventListener('pointerdown', (event) => {
  const control = event.target.closest('[data-resource-combobox]');
  if (!control || control.disabled) return;
  prepareResourceComboboxForSearch(control);
});

workspace.addEventListener('focusin', (event) => {
  const control = event.target.closest('[data-resource-combobox]');
  if (!control || control.disabled) return;
  prepareResourceComboboxForSearch(control);
});

workspace.addEventListener('focusout', (event) => {
  const control = event.target.closest('[data-resource-combobox]');
  if (!control) return;
  restoreResourceComboboxLabel(control);
});

connectButton.addEventListener('click', () => {
  if (sessionLoadingFailed) {
    sessionLoadingFailed = false;
    sessionLoading = true;
    render();
    void initializeWorkspace();
    return;
  }
  if (!state.connected) {
    window.location.assign('/api/auth/meta/start');
    return;
  }
  metaAccountMenuOpen = !metaAccountMenuOpen;
  renderTopbar();
});

metaAccountMenu?.addEventListener('click', async (event) => {
  const action = event.target.closest('[data-account-action]')?.dataset.accountAction;
  if (!action) return;
  metaAccountMenuOpen = false;
  renderTopbar();
  if (action === 'refresh') {
    api.clearCache();
    await loadResources();
    showToast('Đã tải lại dữ liệu mới nhất từ Meta.');
    return;
  }
  if (action === 'reconnect') {
    window.location.assign('/api/auth/meta/start');
    return;
  }
  if (action === 'switch') {
    await disconnectMetaAccount({ reconnect: true });
    return;
  }
  if (action === 'disconnect' && await confirmMetaDisconnect()) {
    await disconnectMetaAccount();
  }
});

document.addEventListener('click', (event) => {
  if (!metaAccountMenuOpen || event.target.closest('.connection-account-control')) return;
  metaAccountMenuOpen = false;
  renderTopbar();
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) clearHistoryRealtimeTimer();
  else {
    scheduleHistoryRealtimeRefresh({ immediate: true });
    if (state.ui.resultsOpen && state.publishProgress?.runId) {
      void synchronizeCompletedRunProgress(state.publishProgress.runId);
    }
  }
});

treeToggle.addEventListener('click', () => {
  state.ui.treeOpen = !state.ui.treeOpen;
  state.ui.reviewOpen = false;
  render();
});

reviewToggle.addEventListener('click', () => {
  state.ui.reviewOpen = !state.ui.reviewOpen;
  state.ui.treeOpen = false;
  render();
});

document.addEventListener('keydown', (event) => {
  if (event.defaultPrevented) return;
  if (event.key !== 'Escape') return;
  if (metaAccountMenuOpen) {
    metaAccountMenuOpen = false;
    renderTopbar();
    connectButton.focus();
    return;
  }
  const openTemplateDropdown = workspace.querySelector('[data-template-card-dropdown][open]');
  if (openTemplateDropdown) {
    closeTemplateDropdowns();
    openTemplateDropdown.querySelector('summary')?.focus();
    return;
  }
  const openNodeMenuId = state.ui.openNodeMenuId;
  if (closeNodeMenu(state)) {
    render();
    focusNodeMenuButton(openNodeMenuId);
    return;
  }
  if (state.activityHistory.open) {
    clearHistoryPublicationTimer();
    resetHistoryRealtimeSync();
    state.activityHistory.open = false;
    state.ui.activeWorkspace = 'campaign';
    render();
    openHistoryWorkspaceButton.focus();
    return;
  }
  state.ui.treeOpen = false;
  state.ui.reviewOpen = false;
  render();
});

document.addEventListener('click', (event) => {
  const templateDropdown = event.target.closest('[data-template-card-dropdown]');
  if (!templateDropdown) closeTemplateDropdowns();
  if (!state.ui.openNodeMenuId) return;
  if (event.target.closest('[data-node-menu], [data-action="toggle-node-menu"]')) return;
  const openNodeMenuId = state.ui.openNodeMenuId;
  closeNodeMenu(state);
  dismissNodeMenuView(openNodeMenuId);
});

function findTreeNodeRow(clientId) {
  if (!clientId) return null;
  return [...workspace.querySelectorAll('[data-node-id]')]
    .find((row) => row.dataset.nodeId === clientId) ?? null;
}

function focusFirstNodeAction(clientId) {
  findTreeNodeRow(clientId)?.querySelector('.node-action-menu-item')?.focus();
}

function positionOpenNodeMenu(clientId) {
  const row = workspace.querySelector(`[data-node-id="${clientId}"]`);
  const menu = row?.querySelector('.node-action-menu');
  const viewport = workspace.querySelector('.workspace-tree');
  const footer = workspace.querySelector('.tree-footer');
  if (!row || !menu || !viewport) return;

  menu.classList.remove('opens-upward');
  const rowRect = row.getBoundingClientRect();
  const viewportRect = viewport.getBoundingClientRect();
  const footerRect = footer?.getBoundingClientRect();
  const lowerBoundary = footerRect?.top ?? viewportRect.bottom;
  const menuHeight = menu.getBoundingClientRect().height;
  const spaceBelow = lowerBoundary - rowRect.bottom;
  const spaceAbove = rowRect.top - viewportRect.top;

  if (spaceBelow < menuHeight + 8 && spaceAbove > spaceBelow) {
    menu.classList.add('opens-upward');
  }
}

function focusNodeMenuButton(clientId) {
  findTreeNodeRow(clientId)?.querySelector('.node-menu-button')?.focus();
}

function focusCampaignDisclosure(clientId) {
  findTreeNodeRow(clientId)?.querySelector('.node-disclosure')?.focus();
}

function focusNodeMain(clientId) {
  findTreeNodeRow(clientId)?.querySelector('.tree-node-main')?.focus();
}

function dismissNodeMenuView(clientId) {
  const row = findTreeNodeRow(clientId);
  row?.querySelector('[data-node-menu]')?.remove();
  row?.querySelector('.node-menu-button')?.setAttribute('aria-expanded', 'false');
}

function removeConfirmation(match) {
  if (match?.type === 'campaign') {
    return 'Xóa chiến dịch này và toàn bộ nhóm quảng cáo, quảng cáo bên trong?';
  }
  if (match?.type === 'adSet') {
    return 'Xóa nhóm quảng cáo này và toàn bộ quảng cáo bên trong?';
  }
  return 'Xóa quảng cáo này?';
}

function removeConfirmationTitle(match) {
  if (match?.type === 'campaign') return 'Xóa chiến dịch?';
  if (match?.type === 'adSet') return 'Xóa nhóm quảng cáo?';
  return 'Xóa quảng cáo?';
}

function removeConfirmationLabel(match) {
  if (match?.type === 'campaign') return 'Xóa chiến dịch';
  if (match?.type === 'adSet') return 'Xóa nhóm quảng cáo';
  return 'Xóa quảng cáo';
}

async function loadResources() {
  const ownerGeneration = seedingResourceRequests.beginOwnerGeneration();
  campaignPresetLoadSequence += 1;
  discardAllSeedingUploads();
  state.ui.loadingSeedingTemplates = false;
  state.resources.seedingTemplates = [];
  state.resources.seedingTemplatesLoaded = false;
  state.resources.seedingTemplatesError = null;
  state.ui.loadingCampaignPresets = false;
  state.resources.campaignPresets = [];
  state.resources.campaignPresetsLoaded = false;
  state.resources.campaignPresetsError = null;
  state.ui.campaignPresetSelectionByCampaignId = {};
  render();
  if (shouldUseLocalDemoResources(window.location)) {
    seedingResourceRequests.acceptOwner(ownerGeneration, null);
    applyLocalDemoResources(state);
    reconcileAvailableCampaignAccounts(
      state,
      new Set(state.resources.adAccounts.map((account) => account.id))
    );
    render();
    showToast('Đã nạp dữ liệu demo local để kiểm tra các dropdown.');
    return;
  }
  try {
    const payload = await api.loadResources();
    if (!seedingResourceRequests.isGenerationCurrent(ownerGeneration)) return;
    if (!seedingResourceRequests.acceptOwner(ownerGeneration, payload.metaUser?.id)) return;
    state.connected = true;
    state.metaUser = payload.metaUser ?? null;
    state.ui.localDemoResources = false;
    state.resources.adAccounts = payload.adAccounts ?? [];
    state.resources.pages = payload.pages ?? [];
    state.resources.pageDiscovery = payload.pageDiscovery ?? state.resources.pageDiscovery;
    state.resources.mediaUploadMode = payload.mediaUploadMode ?? 'local';
    state.resources.capabilities = payload.capabilities ?? {};
    const availableAccountIds = new Set(state.resources.adAccounts.map((account) => account.id));
    reconcileAvailableCampaignAccounts(state, availableAccountIds);
    render();
    // Các loader này độc lập với nhau — chạy song song, mỗi cái tự xử lý lỗi và render phần của mình.
    await Promise.all([
      loadAudienceTemplates(),
      loadConversationTemplates(),
      loadSeedingTemplates(),
      loadCampaignPresets(),
      ensureAccountResourcesForNode(state.selection?.clientId)
    ]);
    if (!seedingResourceRequests.isGenerationCurrent(ownerGeneration)) return;
    await validateCurrentDraft();
  } catch (error) {
    if (!seedingResourceRequests.isGenerationCurrent(ownerGeneration)) return;
    if (error.status !== 401 && state.connected) {
      render();
      showToast(`Phiên Meta vẫn còn. Chưa tải được tài nguyên: ${error.message}. Anh có thể F5 để thử lại.`);
      return;
    }
    if (shouldUseLocalDemoResources(window.location, error)) {
      seedingResourceRequests.acceptOwner(ownerGeneration, null);
      applyLocalDemoResources(state);
      reconcileAvailableCampaignAccounts(
        state,
        new Set(state.resources.adAccounts.map((account) => account.id))
      );
      render();
      showToast('Chưa kết nối Meta — đang dùng dữ liệu demo để kiểm tra dropdown local.');
      return;
    }
    seedingResourceRequests.acceptOwner(ownerGeneration, null);
    state.connected = false;
    state.metaUser = null;
    state.resources.adAccounts = [];
    state.resources.conversationTemplates = [];
    state.resources.conversationTemplatesLoaded = false;
    state.resources.audienceTemplates = [];
    state.resources.audienceTemplatesLoaded = false;
    state.resources.audienceTemplatesError = null;
    state.resources.seedingTemplates = [];
    state.resources.seedingTemplatesLoaded = false;
    state.resources.seedingTemplatesError = null;
    state.resources.campaignPresets = [];
    state.resources.campaignPresetsLoaded = false;
    state.resources.campaignPresetsError = null;
    state.ui.loadingCampaignPresets = false;
    state.ui.campaignPresetSelectionByCampaignId = {};
    state.resources.capabilities = {};
    clearPageCatalogState(state);
    render();
    if (error.status !== 401) showToast(error.message);
  }
}

async function ensureAccountResourcesForNode(clientId) {
  const campaign = findNode(state, clientId)?.campaign ?? activeCampaign(state);
  if (!campaign?.adAccountId) return null;
  const cached = state.resources.accountResourcesById?.[campaign.adAccountId];
  if (cached?.loaded) return cached;
  return loadAdAccountResources(campaign.adAccountId);
}

async function loadAdAccountResources(requestedAccountId = activeCampaign(state)?.adAccountId) {
  if (!requestedAccountId) return null;
  const cached = state.resources.accountResourcesById?.[requestedAccountId];
  if (cached?.loaded) return cached;
  const request = accountResourceRequests.begin(requestedAccountId);
  const previousResources = state.resources.accountResourcesById?.[requestedAccountId];
  state.ui.loadingAccountResources = true;
  state.ui.loadingAccountId = requestedAccountId;
  render();
  try {
    return await accountResourceLoads.load(requestedAccountId, async () => {
      try {
        const payload = await api.loadAdAccountResources(requestedAccountId);
        const currentResources = state.resources.accountResourcesById?.[requestedAccountId]
          ?? previousResources;
        return setAccountResources(state, requestedAccountId, {
          loaded: true,
          customAudiences: payload.customAudiences ?? [],
          savedAudiences: payload.savedAudiences ?? [],
          pixels: payload.pixels ?? [],
          pixelsLoaded: payload.pixelsLoaded === true,
          promotablePageIds: payload.promotablePageIds ?? [],
          pageEligibilityKnown: payload.pageEligibilityKnown === true,
          targetingResults: currentResources?.targetingResults ?? [],
          locationResults: currentResources?.locationResults ?? []
        });
      } catch (error) {
        setAccountResources(state, requestedAccountId, previousResources ?? {});
        throw error;
      }
    });
  } catch (error) {
    if (request.isCurrent(activeCampaign(state)?.adAccountId)) {
      showToast(accountResourceErrorMessage(error));
    }
    return null;
  } finally {
    if (request.isCurrent(activeCampaign(state)?.adAccountId)) {
      state.ui.loadingAccountResources = false;
      state.ui.loadingAccountId = null;
      render();
      await validateCurrentDraft();
    }
  }
}

function accountResourceErrorMessage(error) {
  const code = Number(error?.payload?.code ?? error?.payload?.error?.code);
  if (code === 4 || /application request limit reached/i.test(String(error?.message ?? ''))) {
    return 'Meta đang tạm giới hạn lượt gọi của ứng dụng. Danh sách đã tải vẫn được giữ lại; vui lòng chờ vài phút rồi thử tài khoản chưa tải.';
  }
  return error?.message || 'Không thể tải tài nguyên của tài khoản quảng cáo.';
}

async function ensureConversationTemplatesForNode(clientId) {
  if (!state.connected || !clientId) return;
  await loadConversationTemplates();
}

async function loadConversationTemplates({ force = false } = {}) {
  if (!state.connected) return [];
  if (state.resources.conversationTemplatesLoaded && !force) {
    return templatesForPage();
  }

  state.ui.loadingConversationTemplates = true;
  render();
  try {
    const payload = await api.loadConversationTemplates();
    state.resources.conversationTemplates = payload.templates ?? [];
    state.resources.conversationTemplatesLoaded = true;
    return state.resources.conversationTemplates;
  } catch (error) {
    state.resources.conversationTemplates = [];
    state.resources.conversationTemplatesLoaded = false;
    showToast(error.message);
    return [];
  } finally {
    state.ui.loadingConversationTemplates = false;
    render();
  }
}

async function loadSeedingTemplates({ force = false } = {}) {
  const ownerId = state.metaUser?.id;
  if (!state.connected || !ownerId) return [];
  if (state.resources.seedingTemplatesLoaded && !force) {
    return seedingTemplates();
  }

  const request = seedingResourceRequests.begin(ownerId);
  state.ui.loadingSeedingTemplates = true;
  state.resources.seedingTemplatesError = null;
  render();
  try {
    const payload = await api.loadSeedingTemplates();
    if (!request.isCurrent(state.metaUser?.id)) return [];
    state.resources.seedingTemplates = payload.templates ?? [];
    state.resources.seedingTemplatesLoaded = true;
    state.resources.seedingTemplatesError = null;
    return state.resources.seedingTemplates;
  } catch (error) {
    if (!request.isCurrent(state.metaUser?.id)) return [];
    state.resources.seedingTemplatesLoaded = false;
    state.resources.seedingTemplatesError = error.message;
    return [];
  } finally {
    if (request.isCurrent(state.metaUser?.id)) {
      state.ui.loadingSeedingTemplates = false;
      render();
    }
  }
}

async function loadCampaignPresets({ force = false } = {}) {
  if (state.ui.localDemoResources) return state.resources.campaignPresets ?? [];
  const ownerId = state.metaUser?.id;
  if (!state.connected || !ownerId) return [];
  if (state.resources.campaignPresetsLoaded && !force) {
    return state.resources.campaignPresets ?? [];
  }

  const requestSequence = ++campaignPresetLoadSequence;
  state.ui.loadingCampaignPresets = true;
  state.resources.campaignPresetsError = null;
  render();
  try {
    const payload = await api.loadCampaignPresets();
    if (requestSequence !== campaignPresetLoadSequence || state.metaUser?.id !== ownerId) return [];
    state.resources.campaignPresets = payload.presets ?? [];
    state.resources.campaignPresetsLoaded = true;
    return state.resources.campaignPresets;
  } catch (error) {
    if (requestSequence !== campaignPresetLoadSequence || state.metaUser?.id !== ownerId) return [];
    state.resources.campaignPresets = [];
    state.resources.campaignPresetsLoaded = false;
    state.resources.campaignPresetsError = error.message;
    return [];
  } finally {
    if (requestSequence === campaignPresetLoadSequence && state.metaUser?.id === ownerId) {
      state.ui.loadingCampaignPresets = false;
      render();
    }
  }
}

async function handleCampaignPresetClick(action, clientId, control) {
  const supportedActions = new Set([
    'new-campaign-preset',
    'apply-campaign-preset',
    'save-campaign-preset',
    'delete-campaign-preset',
    'retry-campaign-presets'
  ]);
  if (!supportedActions.has(action)) return false;

  const match = findNode(state, clientId);
  if (match?.type !== 'campaign') return true;
  const campaign = match.node;

  if (action === 'retry-campaign-presets') {
    await loadCampaignPresets({ force: true });
    return true;
  }

  if (action === 'new-campaign-preset') {
    state.ui.campaignPresetSelectionByCampaignId[campaign.clientId] = null;
    render();
    queueMicrotask(() => {
      workspace.querySelector(`[data-campaign-preset-name][data-client-id="${CSS.escape(campaign.clientId)}"]`)?.focus();
    });
    return true;
  }

  if (action === 'apply-campaign-preset') {
    const preset = campaignPresets().find((entry) => entry.id === control.dataset.presetId);
    if (!preset) return true;
    const missingReference = campaignPresetMissingReference(preset);
    if (missingReference) {
      showToast(missingReference);
      return true;
    }
    const audienceWarning = applyPresetToCampaign(campaign, preset);
    state.ui.campaignPresetSelectionByCampaignId[campaign.clientId] = preset.id;
    render();
    await validateCurrentDraft();
    showToast(`Đã áp dụng cấu hình “${preset.name}” cho toàn bộ Campaign.${audienceWarning ? ` ${audienceWarning}` : ''}`);
    return true;
  }

  if (action === 'delete-campaign-preset') {
    const presetId = control.dataset.presetId;
    const preset = campaignPresets().find((entry) => entry.id === presetId);
    if (!preset) return true;
    state.ui.loadingCampaignPresets = true;
    render();
    try {
      if (!state.ui.localDemoResources) await api.deleteCampaignPreset(presetId);
      state.resources.campaignPresets = campaignPresets().filter((entry) => entry.id !== presetId);
      if (state.ui.campaignPresetSelectionByCampaignId[campaign.clientId] === presetId) {
        state.ui.campaignPresetSelectionByCampaignId[campaign.clientId] = null;
      }
      showToast(`Đã xóa cấu hình “${preset.name}”.`);
    } catch (error) {
      showToast(error.message);
    } finally {
      state.ui.loadingCampaignPresets = false;
      render();
    }
    return true;
  }

  const card = control.closest('[data-campaign-preset-card]');
  const presetName = card?.querySelector('[data-campaign-preset-name]')?.value.trim() ?? '';
  const input = campaignPresetInput(campaign, presetName);
  if (input.error) {
    showToast(input.error);
    return true;
  }

  const selectedPresetId = state.ui.campaignPresetSelectionByCampaignId[campaign.clientId];
  const selectedPreset = campaignPresets().find((entry) => entry.id === selectedPresetId);
  state.ui.loadingCampaignPresets = true;
  render();
  try {
    let savedPreset;
    if (state.ui.localDemoResources) {
      savedPreset = {
        id: selectedPreset?.id ?? crypto.randomUUID(),
        ...input.body,
        createdAt: selectedPreset?.createdAt ?? Date.now(),
        updatedAt: Date.now()
      };
    } else if (selectedPreset) {
      savedPreset = (await api.updateCampaignPreset(selectedPreset.id, input.body)).preset;
    } else {
      savedPreset = (await api.createCampaignPreset(input.body)).preset;
    }
    upsertCampaignPreset(savedPreset);
    state.ui.campaignPresetSelectionByCampaignId[campaign.clientId] = savedPreset.id;
    showToast(selectedPreset ? 'Đã cập nhật cấu hình.' : 'Đã lưu cấu hình mới.');
  } catch (error) {
    showToast(error.message);
  } finally {
    state.ui.loadingCampaignPresets = false;
    render();
  }
  return true;
}

function campaignPresets() {
  return state.resources.campaignPresets ?? [];
}

function upsertCampaignPreset(nextPreset) {
  const presets = campaignPresets();
  state.resources.campaignPresets = presets.some((preset) => preset.id === nextPreset.id)
    ? presets.map((preset) => preset.id === nextPreset.id ? nextPreset : preset)
    : [nextPreset, ...presets];
  state.resources.campaignPresetsLoaded = true;
}

function campaignPresetInput(campaign, name) {
  if (!name) return { error: 'Nhập tên cấu hình trước khi lưu.' };
  const campaignName = campaign.name?.trim();
  if (!campaignName) return { error: 'Nhập tên Campaign trước khi lưu cấu hình.' };
  const firstAdSet = campaign.adSets?.[0];
  const adSetName = firstAdSet?.name?.trim();
  if (!adSetName) return { error: 'Nhập tên nhóm quảng cáo trước khi lưu cấu hình.' };

  const seedingTemplate = seedingTemplates().find((template) => template.id === campaign.seeding?.templateId);
  if (!seedingTemplate) return { error: 'Chọn mẫu Seeding trước khi lưu cấu hình.' };

  const ads = (campaign.adSets ?? []).flatMap((adSet) => adSet.ads ?? []);
  const conversationTemplateIds = [...new Set(ads.map((ad) => ad.conversation?.sourceTemplateId).filter(Boolean))];
  if (conversationTemplateIds.length === 0) {
    return { error: 'Chọn mẫu Cuộc trò chuyện trước khi lưu cấu hình.' };
  }
  if (conversationTemplateIds.length > 1) {
    return { error: 'Các quảng cáo đang dùng nhiều mẫu Cuộc trò chuyện khác nhau. Hãy chọn một mẫu chung trước khi lưu.' };
  }
  const conversationTemplate = templatesForPage().find((template) => template.id === conversationTemplateIds[0]);
  if (!conversationTemplate) return { error: 'Mẫu Cuộc trò chuyện đang dùng không còn trong thư viện.' };

  const audienceTemplateName = firstAdSet.audienceTemplateName?.trim() || 'Thiết lập thủ công';

  return {
    body: {
      name,
      content: {
        campaignName,
        adSetName,
        audienceTemplateId: firstAdSet.audienceTemplateId ?? null,
        audienceTemplateName,
        audienceContent: {
          ...audienceTemplateContent(firstAdSet),
          sourceAdAccountId: campaign.adAccountId || null
        },
        seedingTemplateId: seedingTemplate.id,
        seedingTemplateName: seedingTemplate.name,
        conversationTemplateId: conversationTemplate.id,
        conversationTemplateName: conversationTemplate.name
      }
    }
  };
}

function campaignPresetMissingReference(preset) {
  const content = preset.content ?? {};
  if (!seedingTemplates().some((template) => template.id === content.seedingTemplateId)) {
    return `Mẫu Seeding “${content.seedingTemplateName || 'đã liên kết'}” không còn trong thư viện.`;
  }
  if (!templatesForPage().some((template) => template.id === content.conversationTemplateId)) {
    return `Mẫu Cuộc trò chuyện “${content.conversationTemplateName || 'đã liên kết'}” không còn trong thư viện.`;
  }
  return '';
}

function applyPresetToCampaign(campaign, preset) {
  const content = preset.content;
  const seedingTemplate = seedingTemplates().find((template) => template.id === content.seedingTemplateId);
  const conversationTemplate = templatesForPage().find((template) => template.id === content.conversationTemplateId);
  const audienceResult = campaignPresetAudience(campaign, content);
  campaign.name = content.campaignName;
  (campaign.adSets ?? []).forEach((adSet) => {
    adSet.name = content.adSetName;
    if (audienceResult.template) {
      applyAudienceTemplateToAdSet(state, adSet.clientId, audienceResult.template);
      adSet.audienceTemplateWarning = audienceResult.warning;
    }
    (adSet.ads ?? []).forEach((ad) => applyTemplateToAd(ad, conversationTemplate));
  });
  applyCampaignSeedingTemplate(state, campaign.clientId, seedingTemplate);
  return audienceResult.message;
}

function campaignPresetAudience(campaign, content) {
  if (!content.audienceContent) {
    return {
      template: null,
      warning: '',
      message: 'Cấu hình cũ chưa lưu Thiết lập đối tượng nên phần này được giữ nguyên.'
    };
  }
  const campaignResources = resourcesForCampaign(state, campaign);
  const compatibility = toolAudienceTemplateCompatibility(
    { content: content.audienceContent },
    campaign.adAccountId,
    campaignResources.customAudiences ?? []
  );
  const allowedIds = new Set(compatibility.allowedCustomAudienceIds ?? []);
  const linkedTemplateAvailable = isToolAudienceTemplateId(content.audienceTemplateId)
    ? audienceTemplates().some((template) => template.id === content.audienceTemplateId)
    : (campaignResources.savedAudiences ?? []).some((template) => template.id === content.audienceTemplateId);
  const template = {
    id: linkedTemplateAvailable ? content.audienceTemplateId : null,
    name: content.audienceTemplateName || 'Thiết lập từ cấu hình',
    content: {
      ...content.audienceContent,
      includedCustomAudienceIds: (content.audienceContent.includedCustomAudienceIds ?? [])
        .filter((id) => allowedIds.has(String(id))),
      excludedCustomAudienceIds: (content.audienceContent.excludedCustomAudienceIds ?? [])
        .filter((id) => allowedIds.has(String(id)))
    }
  };
  const unavailableMessage = content.audienceTemplateId && !linkedTemplateAvailable
    ? 'Mẫu đối tượng gốc không còn khả dụng; app đã áp dụng bản lưu và chuyển sang chế độ chỉnh sửa.'
    : '';
  return {
    template,
    warning: compatibility.warning,
    message: [compatibility.warning, unavailableMessage].filter(Boolean).join(' ')
  };
}

async function handleSeedingClick(action, clientId, control) {
  const supportedActions = new Set([
    'apply-seeding-template',
    'retry-seeding-templates',
    'choose-seeding-image',
    'new-seeding-template',
    'save-seeding-template',
    'duplicate-seeding-template',
    'delete-seeding-template',
    'add-seeding-item',
    'remove-seeding-item',
    'move-seeding-item',
    'remove-seeding-image'
  ]);
  if (!supportedActions.has(action)) return false;

  const context = seedingContext(clientId);
  if (!context) return true;
  const { campaign } = context;

  if (action === 'apply-seeding-template') {
    const template = seedingTemplates().find((entry) => entry.id === control.dataset.templateId);
    if (template) applyCampaignSeedingTemplate(state, campaign.clientId, template);
    discardStaleSeedingUploads();
    render();
    await validateCurrentDraft();
    return true;
  }

  if (action === 'retry-seeding-templates') {
    await loadSeedingTemplates({ force: true });
    return true;
  }

  if (action === 'choose-seeding-image') {
    document.getElementById(control.dataset.inputId)?.click();
    return true;
  }

  if (action === 'new-seeding-template') {
    if (state.resources.seedingTemplatesLoaded !== true) return true;
    const openEditor = control.dataset.openSeedingEditor === 'true';
    const nextSeeding = createEmptySeeding();
    replaceCampaignSeeding(state, campaign.clientId, nextSeeding);
    discardStaleSeedingUploads();
    if (openEditor) state.ui.activeWorkspace = 'seeding';
    render();
    if (openEditor) {
      queueMicrotask(() => workspace.querySelector('[data-seeding-workspace-title]')?.focus({ preventScroll: true }));
    }
    await validateCurrentDraft();
    return true;
  }

  if (action === 'add-seeding-item') {
    if (addSeedingItem(state, campaign.clientId)) {
      render();
      await validateCurrentDraft();
    }
    return true;
  }

  if (action === 'remove-seeding-item') {
    if (removeSeedingItem(state, campaign.clientId, control.dataset.itemId)) {
      discardStaleSeedingUploads();
      render();
      await validateCurrentDraft();
    }
    return true;
  }

  if (action === 'move-seeding-item') {
    if (moveSeedingItem(state, campaign.clientId, control.dataset.itemId, Number(control.dataset.offset))) {
      render();
      await validateCurrentDraft();
    }
    return true;
  }

  if (action === 'remove-seeding-image') {
    const item = campaign.seeding?.items?.find((entry) => entry.id === control.dataset.itemId);
    if (!item) return true;
    if (item.imagePreviewUrl?.startsWith('blob:')) URL.revokeObjectURL(item.imagePreviewUrl);
    updateSeedingItem(state, campaign.clientId, item.id, 'imageMediaId', null);
    updateSeedingItem(state, campaign.clientId, item.id, 'imageName', '');
    updateSeedingItem(state, campaign.clientId, item.id, 'imageSize', 0);
    updateSeedingItem(state, campaign.clientId, item.id, 'imageMimeType', '');
    updateSeedingItem(state, campaign.clientId, item.id, 'imagePreviewUrl', '');
    render();
    await validateCurrentDraft();
    return true;
  }

  const ownerId = state.metaUser?.id;
  if (!state.connected || !ownerId) {
    showToast('Kết nối Meta trước khi quản lý thư viện mẫu seeding.');
    return true;
  }
  if (state.resources.seedingTemplatesLoaded !== true) {
    showToast('Tải lại thư viện mẫu seeding trước khi quản lý mẫu.');
    return true;
  }

  const selectedTemplate = seedingTemplates().find(
    (template) => template.id === campaign.seeding?.templateId
  );
  const deletedTemplate = action === 'delete-seeding-template'
    ? seedingTemplates().find((template) => template.id === control.dataset.templateId)
    : null;
  const sourceId = action === 'delete-seeding-template'
    ? deletedTemplate?.id
    : selectedTemplate?.id;
  if (action === 'duplicate-seeding-template' && !sourceId) return true;
  if (action === 'delete-seeding-template' && !sourceId) return true;

  const input = seedingTemplateInput(campaign.seeding);
  const requestSnapshot = captureCampaignSeedingSnapshot(state, campaign.clientId);
  const request = seedingResourceRequests.begin(ownerId);

  const deletingTemplate = action === 'delete-seeding-template';
  if (deletingTemplate) {
    control.disabled = true;
    control.closest('.template-choice-wrap')?.classList.add('is-deleting');
  } else {
    state.ui.loadingSeedingTemplates = true;
    render();
  }
  try {
    if (action === 'save-seeding-template') {
      const payload = sourceId
        ? await api.updateSeedingTemplate(sourceId, input)
        : await api.createSeedingTemplate(input);
      if (!request.isCurrent(state.metaUser?.id)) return true;
      upsertSeedingTemplate(payload.template);
      const applied = applyCampaignSeedingTemplate(
        state,
        campaign.clientId,
        payload.template,
        requestSnapshot
      );
      discardStaleSeedingUploads();
      showToast(applied
        ? (sourceId ? 'Đã cập nhật mẫu seeding.' : 'Đã tạo mẫu seeding.')
        : 'Đã lưu vào thư viện; các chỉnh sửa mới trong Campaign được giữ lại.');
    }

    if (action === 'duplicate-seeding-template') {
      const payload = await api.duplicateSeedingTemplate(sourceId, {
        name: `${selectedTemplate.name} - Bản sao`
      });
      if (!request.isCurrent(state.metaUser?.id)) return true;
      upsertSeedingTemplate(payload.template);
      const applied = applyCampaignSeedingTemplate(
        state,
        campaign.clientId,
        payload.template,
        requestSnapshot
      );
      discardStaleSeedingUploads();
      showToast(applied
        ? 'Đã nhân bản mẫu seeding.'
        : 'Đã nhân bản trong thư viện; các chỉnh sửa mới trong Campaign được giữ lại.');
    }

    if (action === 'delete-seeding-template') {
      await api.deleteSeedingTemplate(sourceId);
      if (!request.isCurrent(state.metaUser?.id)) return true;
      state.resources.seedingTemplates = seedingTemplates().filter(
        (template) => template.id !== sourceId
      );
      for (const currentCampaign of state.draft.campaigns) {
        if (currentCampaign.seeding?.templateId === sourceId) {
          updateCampaignSeeding(state, currentCampaign.clientId, 'templateId', null);
        }
      }
      workspace.querySelectorAll(`[data-action="delete-seeding-template"][data-template-id="${CSS.escape(sourceId)}"]`)
        .forEach((button) => button.closest('.template-choice-wrap')?.remove());
      showToast('Đã xóa mẫu seeding.');
    }
  } catch (error) {
    if (request.isCurrent(state.metaUser?.id)) showToast(error.message);
  } finally {
    if (request.isCurrent(state.metaUser?.id)) {
      state.ui.loadingSeedingTemplates = false;
      render();
      await validateCurrentDraft();
    }
  }
  return true;
}

function updateSeedingControl(control) {
  if (control.dataset.itemId) {
    return updateSeedingItem(
      state,
      control.dataset.clientId,
      control.dataset.itemId,
      control.dataset.seedingField,
      control.value
    );
  }
  return updateCampaignSeeding(
    state,
    control.dataset.clientId,
    control.dataset.seedingField,
    control.value
  );
}

function refreshTemplateQuickSave(kind, clientId) {
  if (kind === 'seeding') {
    const campaign = seedingContext(clientId)?.campaign;
    const template = seedingTemplates().find((entry) => entry.id === campaign?.seeding?.templateId);
    const button = workspace.querySelector(
      template
        ? `.template-quick-save[data-client-id="${CSS.escape(clientId)}"]`
        : `[data-action="save-seeding-template"][data-client-id="${CSS.escape(clientId)}"]`
    );
    if (button) {
      button.disabled = template
        ? !isSeedingModified(campaign.seeding, template)
        : !state.connected || !campaign?.seeding?.templateName?.trim();
    }
    return;
  }
  const ad = conversationContext(clientId)?.ad;
  const template = templatesForPage().find((entry) => entry.id === ad?.conversation?.sourceTemplateId);
  const button = workspace.querySelector(
    template
      ? `.template-quick-save[data-client-id="${CSS.escape(clientId)}"]`
      : `[data-action="save-conversation-template"][data-client-id="${CSS.escape(clientId)}"]`
  );
  if (button) {
    button.disabled = template
      ? !isConversationModified(ad.conversation, template)
      : !state.connected || state.ui.loadingConversationTemplates || !ad?.conversation?.templateName?.trim();
  }
}

function seedingContext(clientId) {
  const match = findNode(state, clientId);
  return match?.type === 'campaign' ? { campaign: match.node } : null;
}

function seedingTemplates() {
  return state.resources.seedingTemplates ?? [];
}

function upsertSeedingTemplate(nextTemplate) {
  const templates = seedingTemplates();
  const found = templates.some((template) => template.id === nextTemplate.id);
  state.resources.seedingTemplates = found
    ? templates.map((template) => template.id === nextTemplate.id ? nextTemplate : template)
    : [nextTemplate, ...templates];
}

function seedingTemplateInput(seeding) {
  return {
    name: seeding?.templateName?.trim() ?? '',
    items: (seeding?.items ?? []).map((item) => ({
      id: item.id,
      message: item.message,
      imageMediaId: item.imageMediaId ?? null
    }))
  };
}

async function handleAudienceClick(action, clientId, control) {
  const supportedActions = new Set([
    'retry-audience-templates',
    'new-audience-template',
    'save-audience-template',
    'duplicate-audience-template',
    'delete-audience-template'
  ]);
  if (!supportedActions.has(action)) return false;

  const context = audienceContext(clientId);
  if (!context) return true;
  const { adSet } = context;

  if (action === 'retry-audience-templates') {
    await loadAudienceTemplates({ force: true });
    return true;
  }

  if (action === 'new-audience-template') {
    detachAdSetAudienceTemplate(state, adSet.clientId);
    render();
    return true;
  }

  state.ui.loadingAudienceTemplates = true;
  render();
  try {
    const name = (adSet.audienceTemplateName ?? '').trim();
    const templateInput = {
      name,
      content: {
        ...audienceTemplateContent(adSet),
        sourceAdAccountId: context.campaign.adAccountId
      }
    };
    if (action === 'save-audience-template') {
      const updating = isToolAudienceTemplateId(adSet.audienceTemplateId);
      const payload = updating
        ? await api.updateAudienceTemplate(adSet.audienceTemplateId, templateInput)
        : await api.createAudienceTemplate(templateInput);
      upsertAudienceTemplate(payload.template);
      applyAudienceTemplateToAdSet(state, adSet.clientId, payload.template);
      showToast(updating ? 'Đã cập nhật đối tượng.' : 'Đã lưu đối tượng mới.');
    }

    if (action === 'duplicate-audience-template' && isToolAudienceTemplateId(adSet.audienceTemplateId)) {
      const payload = await api.duplicateAudienceTemplate(adSet.audienceTemplateId, {
        name: `${name} - Bản sao`
      });
      upsertAudienceTemplate(payload.template);
      applyAudienceTemplateToAdSet(state, adSet.clientId, payload.template);
      showToast('Đã nhân bản đối tượng.');
    }

    if (action === 'delete-audience-template') {
      const sourceId = adSet.audienceTemplateId;
      const source = audienceTemplates().find((template) => template.id === sourceId);
      if (!isToolAudienceTemplateId(sourceId) || !source) return true;
      if (!await confirmAction({
        title: 'Xóa đối tượng đã lưu?',
        message: `Đối tượng “${source.name}” sẽ bị xóa khỏi thư viện của bạn.`,
        confirmLabel: 'Xóa đối tượng'
      })) return true;
      await api.deleteAudienceTemplate(sourceId);
      state.resources.audienceTemplates = audienceTemplates().filter((template) => template.id !== sourceId);
      for (const campaign of state.draft.campaigns) {
        for (const currentAdSet of campaign.adSets) {
          if (currentAdSet.audienceTemplateId === sourceId) {
            detachAdSetAudienceTemplate(state, currentAdSet.clientId);
          }
        }
      }
      showToast('Đã xóa đối tượng khỏi thư viện.');
    }
  } catch (error) {
    showToast(error.message);
  } finally {
    state.ui.loadingAudienceTemplates = false;
    render();
    await validateCurrentDraft();
  }
  return true;
}

function audienceContext(clientId) {
  const match = findNode(state, clientId);
  return match?.type === 'adSet' ? { adSet: match.node, campaign: match.campaign } : null;
}

function audienceTemplates() {
  return state.resources.audienceTemplates ?? [];
}

function upsertAudienceTemplate(nextTemplate) {
  const templates = audienceTemplates();
  const found = templates.some((template) => template.id === nextTemplate.id);
  state.resources.audienceTemplates = found
    ? templates.map((template) => template.id === nextTemplate.id ? nextTemplate : template)
    : [nextTemplate, ...templates];
}

function uniqueAudienceTemplateName(baseName) {
  const normalizedNames = new Set(audienceTemplates().map((template) => template.name.trim().toLocaleLowerCase('vi')));
  const fit = (value) => value.slice(0, 120).trim();
  let candidate = fit(baseName);
  let copyNumber = 2;
  while (normalizedNames.has(candidate.toLocaleLowerCase('vi'))) {
    const suffix = ` ${copyNumber}`;
    candidate = fit(`${baseName.slice(0, 120 - suffix.length)}${suffix}`);
    copyNumber += 1;
  }
  return candidate;
}

async function loadAudienceTemplates({ force = false } = {}) {
  if (!state.connected || !state.metaUser?.id) return [];
  if (state.resources.audienceTemplatesLoaded && !force) {
    return audienceTemplates();
  }

  state.ui.loadingAudienceTemplates = true;
  state.resources.audienceTemplatesError = null;
  render();
  try {
    const payload = await api.loadAudienceTemplates();
    state.resources.audienceTemplates = payload.templates ?? [];
    state.resources.audienceTemplatesLoaded = true;
    state.resources.audienceTemplatesError = null;
    return state.resources.audienceTemplates;
  } catch (error) {
    state.resources.audienceTemplatesLoaded = false;
    state.resources.audienceTemplatesError = error.message;
    return [];
  } finally {
    state.ui.loadingAudienceTemplates = false;
    render();
  }
}

async function handleConversationClick(action, clientId, control) {
  const supportedActions = new Set([
    'apply-conversation-template',
    'new-conversation-template',
    'save-conversation-template',
    'update-conversation-template',
    'duplicate-conversation-template',
    'delete-conversation-template',
    'add-customer-action',
    'remove-customer-action',
    'remove-conversation-image'
  ]);
  if (!supportedActions.has(action)) return false;

  const context = conversationContext(clientId);
  if (!context) return true;
  const { ad } = context;

  if (action === 'remove-conversation-image') {
    detachCreativeForAd(ad);
    Object.assign(ad.conversation, {
      imageMediaId: null,
      imagePreviewUrl: '',
      imageName: '',
      imageSize: 0,
      dirty: true
    });
    render();
    await validateCurrentDraft();
    return true;
  }

  if (action === 'apply-conversation-template') {
    const template = templatesForPage().find((entry) => entry.id === control.dataset.templateId);
    if (template) applyTemplateToAd(ad, template);
    render();
    await validateCurrentDraft();
    return true;
  }

  if (action === 'new-conversation-template') {
    detachCreativeForAd(ad);
    ad.conversation = createEmptyConversation();
    render();
    await validateCurrentDraft();
    return true;
  }

  if (action === 'add-customer-action' && ad.conversation.customerActions.length < 3) {
    detachCreativeForAd(ad);
    ad.conversation.customerActions.push({
      id: crypto.randomUUID(),
      label: '',
      type: 'OPEN_URL',
      value: ''
    });
    ad.conversation.dirty = true;
    render();
    await validateCurrentDraft();
    return true;
  }

  if (action === 'remove-customer-action' && ad.conversation.customerActions.length > 0) {
    detachCreativeForAd(ad);
    ad.conversation.customerActions = ad.conversation.customerActions.filter(
      (item) => item.id !== control.dataset.itemId
    );
    ad.conversation.dirty = true;
    render();
    await validateCurrentDraft();
    return true;
  }

  if (!state.connected) {
    showToast('Kết nối Meta trước khi quản lý thư viện mẫu của bạn.');
    return true;
  }

  state.ui.loadingConversationTemplates = true;
  render();
  try {
    const name = ad.conversation.templateName.trim();
    if (action === 'save-conversation-template') {
      const payload = await api.createConversationTemplate({
        name,
        template: conversationContent(ad.conversation, name)
      });
      upsertPageTemplate(null, null, payload.template);
      applyTemplateToAd(ad, payload.template);
      showToast('Đã lưu mẫu mới vào thư viện của bạn.');
    }

    if (action === 'update-conversation-template') {
      const sourceId = ad.conversation.sourceTemplateId;
      if (!sourceId) return true;
      const payload = await api.updateConversationTemplate(sourceId, {
        name,
        template: conversationContent(ad.conversation, name)
      });
      upsertPageTemplate(null, null, payload.template);
      applyTemplateToAd(ad, payload.template);
      showToast('Đã cập nhật mẫu của bạn.');
    }

    if (action === 'duplicate-conversation-template') {
      const sourceId = ad.conversation.sourceTemplateId;
      if (!sourceId) return true;
      const payload = await api.duplicateConversationTemplate(sourceId, {
        name: `${name} - Bản sao`
      });
      upsertPageTemplate(null, null, payload.template);
      applyTemplateToAd(ad, payload.template);
      showToast('Đã nhân bản mẫu của bạn.');
    }

    if (action === 'delete-conversation-template') {
      const sourceId = control.dataset.templateId || ad.conversation.sourceTemplateId;
      const source = templatesForPage().find((template) => template.id === sourceId);
      if (!sourceId || !source) return true;
      control.disabled = true;
      control.closest('.template-choice-wrap')?.classList.add('is-deleting');
      await api.deleteConversationTemplate(sourceId);
      state.resources.conversationTemplates = templatesForPage().filter(
        (template) => template.id !== sourceId
      );
      for (const campaign of state.draft.campaigns) {
        for (const currentAd of campaign.adSets.flatMap((adSet) => adSet.ads)) {
          if (currentAd.conversation.sourceTemplateId === sourceId) {
            currentAd.conversation.sourceTemplateId = null;
            currentAd.conversation.dirty = true;
          }
        }
      }
      workspace.querySelectorAll(`[data-action="delete-conversation-template"][data-template-id="${CSS.escape(sourceId)}"]`)
        .forEach((button) => button.closest('.template-choice-wrap')?.remove());
      const picker = control.closest('.conversation-template-card-picker');
      if (picker && ad.conversation.sourceTemplateId === null) {
        const currentName = picker.querySelector('.template-dropdown-current strong');
        if (currentName) currentName.textContent = 'Chọn một mẫu có sẵn';
        picker.querySelector('.template-quick-save')?.remove();
      }
      showToast('Đã xóa mẫu khỏi thư viện của bạn.');
    }
  } catch (error) {
    showToast(error.message);
  } finally {
    state.ui.loadingConversationTemplates = false;
    if (action === 'delete-conversation-template') {
      await validateCurrentDraft({ renderView: false });
    } else {
      render();
      await validateCurrentDraft();
    }
  }
  return true;
}


function updateConversationControl(control) {
  const context = conversationContext(control.dataset.clientId);
  if (!context) return false;
  const conversation = context.ad.conversation;
  if (control.dataset.conversationField) {
    const nextValue = control.type === 'checkbox'
      ? control.checked
      : control.value;
    if (Object.is(conversation[control.dataset.conversationField], nextValue)) return false;
    detachCreativeForAd(context.ad);
    conversation[control.dataset.conversationField] = nextValue;
  } else {
    const collection = conversation[control.dataset.conversationCollection];
    const item = collection?.find((entry) => entry.id === control.dataset.itemId);
    if (!item) return false;
    if (Object.is(item[control.dataset.itemField], control.value)) return false;
    detachCreativeForAd(context.ad);
    item[control.dataset.itemField] = control.value;
  }
  conversation.dirty = true;
  return true;
}

function updateConversationPreview(conversation) {
  const preview = workspace.querySelector('.conversation-preview');
  if (!preview) return;

  const message = preview.querySelector('.preview-bubble');
  if (message) {
    message.textContent = conversation.greeting || 'Lời chào sẽ hiển thị tại đây';
  }

  const buttons = preview.querySelectorAll('.preview-actions button');
  (conversation.customerActions ?? []).forEach((action, index) => {
    const button = buttons[index];
    if (!button) return;
    const label = action.label || 'Nút hành động';
    if (button.firstChild) button.firstChild.textContent = label;
    const url = button.querySelector('small');
    if (url) url.textContent = compactConversationUrl(action.value);
  });
}

function compactConversationUrl(value) {
  try {
    const url = new URL(value);
    return `${url.hostname}${url.pathname === '/' ? '' : url.pathname}`.slice(0, 42);
  } catch {
    return value || 'Chưa nhập URL';
  }
}


function conversationContext(clientId) {
  const match = findNode(state, clientId);
  return match?.type === 'ad'
    ? { ad: match.node, adSet: match.adSet, campaign: match.campaign }
    : null;
}

function detachCreativeForAd(ad) {
  if (sharedCreativeCount(state, ad.clientId) > 1) {
    detachAdCreative(ad);
    dismissSharedCreativeNotice();
  }
}

function dismissSharedCreativeNotice() {
  workspace.querySelector('.shared-creative-notice')?.remove();
}

function applyTemplateToAd(ad, template) {
  const currentContent = JSON.stringify(conversationContent(ad.conversation));
  const nextContent = JSON.stringify(conversationContent(template.template, template.name));
  if (currentContent !== nextContent) {
    detachCreativeForAd(ad);
  }
  const conversation = applyConversationTemplate(ad, template);
  relinkMatchingCreative(state, ad.clientId);
  return conversation;
}


function templatesForPage(accountId, pageId) {
  return state.resources.conversationTemplates ?? [];
}

function upsertPageTemplate(accountId, pageId, nextTemplate) {
  const templates = templatesForPage(accountId, pageId);
  const index = templates.findIndex((template) => template.id === nextTemplate.id);
  state.resources.conversationTemplates = index >= 0
    ? templates.map((template) => template.id === nextTemplate.id ? nextTemplate : template)
    : [...templates, nextTemplate];
}


async function validateCurrentDraft({ renderView = true } = {}) {
  draftStorage.save(state);
  const sequence = ++validationSequence;
  if (state.ui.localDemoResources) {
    state.issues = [];
    renderView ? render() : renderTopbar();
    return workspaceProgress(state).formComplete;
  }
  try {
    const payload = await api.validateDraft(state.draft);
    if (sequence !== validationSequence) return true;
    const schemaIssues = payload.errors ?? [];
    const permissionIssues = pageCatalogIssues(
      state.draft,
      state.resources.pages
    );
    state.issues = [...schemaIssues, ...permissionIssues];
    renderView ? render() : renderTopbar();
    return state.issues.length === 0;
  } catch (error) {
    if (sequence !== validationSequence) return false;
    if (Array.isArray(error.payload?.errors)) {
      const permissionIssues = pageCatalogIssues(
        state.draft,
        state.resources.pages
      );
      state.issues = [...error.payload.errors, ...permissionIssues];
    } else {
      state.issues = [{ path: 'server', message: error.message }];
    }
    renderView ? render() : renderTopbar();
    return false;
  }
}

async function publishDraft() {
  if (state.running) return;
  state.running = true;
  state.ui.publishPhase = 'validating';
  render();
  try {
    const valid = await validateCurrentDraft();
    if (!valid) {
      state.ui.reviewOpen = false;
      if (!await revealValidationIssues(state.issues)) {
        showToast('Hãy xử lý lỗi trước khi đăng.');
      }
      return;
    }

    const confirmed = state.ui.localDemoResources || await confirmActivePublish();
    if (!confirmed) return;

    draftStorage.markSubmitted(state);

    state.ui.publishPhase = 'publishing';
    state.publishProgress = createPublishProgress(state.draft);
    state.publishProgress.localDemo = Boolean(state.ui.localDemoResources);
    state.ui.resultsOpen = false;
    state.ui.resultsCampaignClientId = null;
    render();
    if (state.ui.localDemoResources) {
      const result = await simulateLocalDemoPublish();
      showPublishCompletion(result, { localDemo: true });
      return result;
    }
    let result = await api.publishDraft(state.draft, {
      onEvent: (event) => {
        applyPublishEvent(state.publishProgress, event);
        syncLiveActivityHistory(state.publishProgress);
        if (event.type === 'run_started') startRealtimeSeeding(event);
        renderResultsDrawer({ preserveScroll: true });
        renderWorkspaceTreeProgress();
      }
    });
    mergeRunSnapshot(state.publishProgress, result);
    syncLiveActivityHistory(state.publishProgress);
    if (!isTerminalRunStatus(result.status)) {
      state.publishProgress.runId = result.id;
      result = await recoverPublishRun(result.id);
    }
    showPublishCompletion(result);
  } catch (error) {
    if (error.recoverable && state.publishProgress?.runId) {
      try {
        const recovered = await recoverPublishRun(state.publishProgress.runId);
        if (recovered.status === 'failed') {
          const recoveryFailure = new Error('Khôi phục đã xác nhận lượt tạo thất bại. Lượt tạo không được gửi lại.');
          markPublishFailure(state.publishProgress, recoveryFailure);
          syncLiveActivityHistory(state.publishProgress, { forceRender: true });
          showToast(recoveryFailure.message);
        } else {
          showPublishCompletion(recovered);
        }
      } catch (recoveryError) {
        const trackingError = new Error('Theo dõi khôi phục đã dừng. Lượt tạo không được gửi lại.');
        markPublishFailure(state.publishProgress, trackingError);
        syncLiveActivityHistory(state.publishProgress, { forceRender: true });
        showToast(trackingError.message);
      }
    } else if (Array.isArray(error.payload?.errors)) {
      state.issues = error.payload.errors;
      state.ui.reviewOpen = false;
      showToast(error.message);
    } else {
      markPublishFailure(state.publishProgress, error);
      syncLiveActivityHistory(state.publishProgress, { forceRender: true });
      showToast(error.message);
    }
  } finally {
    state.running = false;
    state.ui.publishPhase = null;
    render();
  }
}

async function simulateLocalDemoPublish() {
  const runId = `local-demo-${Date.now()}`;
  const finalNodes = createLocalDemoPublishNodes(state.draft);
  applyPublishEvent(state.publishProgress, { type: 'run_started', runId });
  renderResultsDrawer({ preserveScroll: true });
  renderWorkspaceTreeProgress();

  for (const node of finalNodes) {
    applyPublishEvent(state.publishProgress, {
      type: 'node_updated',
      runId,
      node: { ...node, status: 'creating', remoteId: null, postId: null }
    });
    renderResultsDrawer({ preserveScroll: true });
    renderWorkspaceTreeProgress();
    await wait(180);
    applyPublishEvent(state.publishProgress, { type: 'node_updated', runId, node });
    renderResultsDrawer({ preserveScroll: true });
    renderWorkspaceTreeProgress();
    await wait(120);
  }

  const result = {
    id: runId,
    runId,
    status: 'completed',
    snapshot: state.draft,
    nodes: finalNodes,
    seeding: createLocalDemoSeeding(state.draft, finalNodes)
  };
  mergeRunSnapshot(state.publishProgress, result);
  renderResultsDrawer({ preserveScroll: true });
  renderWorkspaceTreeProgress();
  return result;
}

function createLocalDemoPublishNodes(draft) {
  const nodes = [];
  let sequence = 1;
  for (const campaign of draft.campaigns ?? []) {
    nodes.push(localDemoPublishNode(campaign, 'campaign', null, sequence++));
    for (const adSet of campaign.adSets ?? []) {
      nodes.push(localDemoPublishNode(adSet, 'adSet', campaign.clientId, sequence++));
      for (const ad of adSet.ads ?? []) {
        nodes.push(localDemoPublishNode(ad, 'ad', adSet.clientId, sequence++));
      }
    }
  }
  return nodes;
}

function localDemoPublishNode(node, type, parentClientId, sequence) {
  const suffix = String(sequence).padStart(3, '0');
  return {
    clientId: node.clientId,
    parentClientId,
    type,
    name: node.name,
    status: 'created',
    remoteId: `demo-${type}-${suffix}`,
    ...(type === 'ad' ? { postId: `demo-post-${suffix}` } : {})
  };
}

function createLocalDemoSeeding(draft, nodes) {
  const jobs = [];
  const nodeByClientId = new Map(nodes.map((node) => [String(node.clientId), node]));
  let sequence = 1;
  for (const campaign of draft.campaigns ?? []) {
    const items = campaign.seeding?.enabled === false ? [] : (campaign.seeding?.items ?? []);
    if (items.length === 0) continue;
    const creativeGroups = new Map();
    for (const adSet of campaign.adSets ?? []) {
      for (const ad of adSet.ads ?? []) {
        const groupId = String(ad.creativeGroupId ?? ad.clientId);
        if (!creativeGroups.has(groupId)) creativeGroups.set(groupId, ad);
      }
    }
    for (const ad of creativeGroups.values()) {
      const publishedAd = nodeByClientId.get(String(ad.clientId));
      for (const [position, item] of items.entries()) {
        jobs.push({
          id: `local-demo-job-${sequence++}`,
          campaignClientId: campaign.clientId,
          adClientId: ad.clientId,
          postId: publishedAd?.postId ?? '',
          position,
          message: item.message ?? '',
          status: 'created'
        });
      }
    }
  }
  if (jobs.length === 0) return null;
  return {
    summary: { total: jobs.length, pending: 0, posting: 0, created: jobs.length, failed: 0, cancelled: 0 },
    jobs,
    conflicts: [],
    waitingPostCount: 0
  };
}

function startRealtimeSeeding(event) {
  if (!event?.runId) return;
  void seedingRunner.resume(event.runId);
}

function showPublishCompletion(run, { localDemo = false } = {}) {
  if (!localDemo && run?.id) monitorCompletedRun(run.id);
  if (state.activityHistory.open && state.ui.activeWorkspace === 'history') {
    syncLiveActivityHistory(run, { forceRender: true });
  } else {
    state.activityHistory.loaded = false;
    state.activityHistory.items = [];
    state.activityHistory.nextOffset = null;
  }
  const archived = archiveCompletedCampaigns(state, state.publishProgress);
  if (archived.removed.length > 0) {
    const count = archived.removed.length;
    const hasRetainedErrors = run.status === 'completed_with_errors'
      || (state.publishProgress?.campaigns ?? []).some(
        (campaign) => campaign.status === 'completed_with_errors' || campaign.status === 'needs_review'
      );
    showToast(localDemo
      ? `Đã hoàn tất đăng thử và mở bản nháp mới. ${count} chiến dịch thử không được gửi lên Meta.`
      : hasRetainedErrors
        ? `Đã chuyển ${count} chiến dịch thành công khỏi bản nháp. Chiến dịch có lỗi vẫn được giữ lại để xử lý.`
        : `Đã đăng thành công và chuyển ${count} chiến dịch khỏi bản nháp. Kết quả vẫn được lưu trong Lịch sử.`);
    return;
  }
  showToast(run.status === 'completed_with_errors'
    ? 'Đã hoàn tất lượt tạo với một số lỗi. Chiến dịch có lỗi vẫn được giữ trong bản nháp.'
    : 'Đã hoàn tất lượt tạo. Các đối tượng đã được kích hoạt.');
}

function monitorCompletedRun(runId) {
  const normalizedRunId = String(runId ?? '').trim();
  if (!normalizedRunId || completedRunMonitors.has(normalizedRunId)) return;
  const monitor = (async () => {
    const deadline = Date.now() + 3 * 60_000;
    while (Date.now() < deadline) {
      await wait(3_000);
      try {
        const run = await api.loadRun(normalizedRunId);
        if (state.publishProgress?.runId === normalizedRunId) {
          mergeRunSnapshot(state.publishProgress, run);
          state.publishProgress.seedingError = null;
          renderResultsDrawer({ preserveScroll: true });
          renderWorkspaceTreeProgress();
        }
        if (state.activityHistory.selectedRunId === normalizedRunId) {
          state.activityHistory.detail = run;
          state.activityHistory.detailsByRun[normalizedRunId] = run;
          renderHistoryWorkspace();
        }
        const summary = run.seeding?.summary ?? {};
        const expected = (run.snapshot?.campaigns ?? []).some(campaign => campaign.seeding?.enabled);
        const ready = !expected || Number(summary.total) > 0;
        const active = Number(summary.pending) > 0 || Number(summary.posting) > 0
          || Number(run.seeding?.waitingPostCount) > 0;
        if (ready && !active) {
          if (state.publishProgress?.runId === normalizedRunId
            && archiveCompletedCampaigns(state, state.publishProgress).removed.length > 0) render();
          break;
        }
      } catch {}
    }
  })().finally(() => completedRunMonitors.delete(normalizedRunId));
  completedRunMonitors.set(normalizedRunId, monitor);
}

function isSeedingAction(action) {
  return new Set([
    'cancel-seeding',
    'resume-seeding',
    'retry-seeding-job',
    'confirm-seeding-job',
    'resolve-seeding-conflict'
  ]).has(action);
}

async function handleSeedingAction(control, drawer) {
  const { action, runId, jobId, postId } = control.dataset;
  if (!runId) {
    showToast('Không xác định được lượt seeding.');
    return;
  }

  if (action === 'retry-seeding-job'
    && !await confirmAction({
      title: 'Thử đăng lại bình luận?',
      message: 'Bình luận có thể đã tồn tại trên bài viết. Thử lại có nguy cơ tạo bình luận trùng.',
      confirmLabel: 'Vẫn thử lại',
      tone: 'warning'
    })) return;
  if (action === 'confirm-seeding-job'
    && !await confirmAction({
      title: 'Xác nhận bình luận đã tồn tại?',
      message: 'Chỉ tiếp tục sau khi đã mở bài Facebook và kiểm tra bình luận thực sự tồn tại.',
      confirmLabel: 'Đánh dấu đã có',
      tone: 'warning'
    })) return;

  const focus = captureDrawerFocus(drawer);
  try {
    let payload;
    if (action === 'cancel-seeding') {
      seedingRunner.pause(runId);
      payload = await api.cancelRunSeeding(runId);
    } else if (action === 'resume-seeding') {
      payload = await api.resumeRunSeeding(runId);
    } else if (action === 'retry-seeding-job') {
      if (!jobId) throw new Error('Không xác định được bình luận cần thử lại.');
      payload = await api.retrySeedingJob(runId, jobId);
    } else if (action === 'confirm-seeding-job') {
      if (!jobId) throw new Error('Không xác định được bình luận cần xác nhận.');
      payload = await api.confirmSeedingJob(runId, jobId);
    } else if (action === 'resolve-seeding-conflict') {
      const conflict = control.closest('[data-seeding-conflict]');
      const selected = conflict?.querySelector('input[type="radio"]:checked');
      const campaignClientId = selected?.dataset.campaignClientId;
      if (!postId || !campaignClientId) {
        showToast('Hãy chọn Campaign và mẫu cho Post này.');
        return;
      }
      payload = await api.resolveSeedingConflict(runId, { postId, campaignClientId });
    }

    applySeedingState(runId, payload?.seeding);
    if (action !== 'cancel-seeding') void seedingRunner.resume(runId);
  } catch (error) {
    if (error.payload?.seeding) applySeedingState(runId, error.payload.seeding);
    showToast(error.message);
  } finally {
    restoreDrawerFocus(drawer, focus);
  }
}

function applySeedingState(runId, seeding) {
  if (!seeding) return;
  if (state.publishProgress?.runId === runId) {
    mergeRunSnapshot(state.publishProgress, { seeding });
    state.publishProgress.seedingError = null;
  }
  if (state.activityHistory.selectedRunId === runId && state.activityHistory.detail) {
    state.activityHistory.detail.seeding = seeding;
    state.activityHistory.detailsByRun[runId] = state.activityHistory.detail;
    state.activityHistory.seedingError = null;
  }
  renderResultsDrawer({ preserveScroll: true });
  renderHistoryWorkspace();
  renderWorkspaceTreeProgress();
}

async function synchronizeCompletedRunProgress(runId) {
  try {
    const run = await api.loadRun(runId);
    if (state.publishProgress?.runId === runId) {
      mergeRunSnapshot(state.publishProgress, run);
      state.publishProgress.seedingError = null;
    }
    if (state.activityHistory.selectedRunId === runId) {
      state.activityHistory.detail = run;
      state.activityHistory.detailsByRun[runId] = run;
      state.activityHistory.seedingError = null;
    }
    syncLiveActivityHistory(run, { forceRender: true });
    renderResultsDrawer({ preserveScroll: true });
    renderHistoryWorkspace();
    renderWorkspaceTreeProgress();
  } catch {}
}

function captureDrawerFocus(drawer) {
  const active = document.activeElement;
  if (!active || !drawer.contains(active)) return null;
  return {
    tagName: active.tagName,
    action: active.dataset.action ?? '',
    runId: active.dataset.runId ?? '',
    jobId: active.dataset.jobId ?? '',
    postId: active.dataset.postId ?? '',
    campaignClientId: active.dataset.campaignClientId ?? ''
  };
}

function restoreDrawerFocus(drawer, focus) {
  if (!focus) return;
  const controls = drawer.querySelectorAll('button, a, input, summary');
  const target = [...controls].find((control) => control.tagName === focus.tagName
    && (control.dataset.action ?? '') === focus.action
    && (control.dataset.runId ?? '') === focus.runId
    && (control.dataset.jobId ?? '') === focus.jobId
    && (control.dataset.postId ?? '') === focus.postId
    && (control.dataset.campaignClientId ?? '') === focus.campaignClientId);
  target?.focus();
}

async function recoverPublishRun(runId) {
  state.publishProgress.status = 'recovering';
  renderResultsDrawer({ preserveScroll: true });
  renderWorkspaceTreeProgress();
  const deadline = Date.now() + publishRecoveryTimeoutMs;
  let consecutiveFailures = 0;

  while (true) {
    const remainingMilliseconds = deadline - Date.now();
    if (remainingMilliseconds <= 0) throw createPublishRecoveryTimeoutError();
    await wait(Math.min(publishRecoveryIntervalMs, remainingMilliseconds));
    if (deadline - Date.now() <= 0) throw createPublishRecoveryTimeoutError();
    try {
      const run = await loadRunBeforeDeadline(runId, deadline);
      consecutiveFailures = 0;
      mergeRunSnapshot(state.publishProgress, run);
      if (!isTerminalRunStatus(run.status)) state.publishProgress.status = 'recovering';
      syncLiveActivityHistory(state.publishProgress);
      renderResultsDrawer({ preserveScroll: true });
      renderWorkspaceTreeProgress();
      if (isTerminalRunStatus(run.status)) return run;
    } catch (error) {
      consecutiveFailures += 1;
      if (consecutiveFailures >= publishRecoveryFailureLimit) throw error;
    }
  }
}

function loadRunBeforeDeadline(runId, deadline) {
  const remainingMilliseconds = deadline - Date.now();
  if (remainingMilliseconds <= 0) throw createPublishRecoveryTimeoutError();
  let timeoutId;
  return Promise.race([
    api.loadRun(runId),
    new Promise((_, reject) => {
      timeoutId = setTimeout(() => reject(createPublishRecoveryTimeoutError()), remainingMilliseconds);
    })
  ]).finally(() => clearTimeout(timeoutId));
}

function createPublishRecoveryTimeoutError() {
  return new Error('Đã quá thời gian khôi phục tiến độ. Không gửi lại lượt tạo để tránh trùng quảng cáo.');
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function queueSeedingImageUpload(control) {
  const selection = {
    file: control.files?.[0] ?? null,
    clientId: control.dataset.clientId,
    itemId: control.dataset.itemId
  };
  const queued = seedingUploadQueue.then(
    () => uploadSeedingImage(selection),
    () => uploadSeedingImage(selection)
  );
  seedingUploadQueue = queued.catch(() => {});
  return queued;
}

async function uploadSeedingImage(selection) {
  const file = selection.file;
  if (!file) return;
  try {
    validateSeedingImageFile(file);
  } catch (error) {
    showToast(error.message);
    return;
  }

  const context = seedingContext(selection.clientId);
  const item = context?.campaign.seeding?.items?.find((entry) => entry.id === selection.itemId);
  if (!context || !item) return;
  const uploadTarget = captureSeedingUploadTarget(state, context.campaign.clientId, item.id);
  if (!uploadTarget) return;

  const uploadKey = `${context.campaign.clientId}:${item.id}`;
  const requestId = crypto.randomUUID();
  const previewUrl = URL.createObjectURL(file);
  state.ui.seedingUploads ??= {};
  state.ui.seedingUploads[uploadKey] = {
    requestId,
    uploadTarget,
    progress: 0,
    previewUrl,
    fileName: file.name,
    fileSize: file.size,
    fileType: file.type
  };
  render();

  try {
    const result = await api.uploadMedia(file, {
      mode: state.resources.mediaUploadMode ?? 'local',
      purpose: 'seeding',
      onProgress: (event) => updateSeedingUploadProgress(uploadKey, requestId, event)
    });
    if (!isCurrentSeedingUpload(uploadKey, requestId)) {
      URL.revokeObjectURL(previewUrl);
      clearSeedingUploadRequest(uploadKey, requestId);
      return;
    }
    const currentItem = uploadTarget.item;
    if (currentItem.imagePreviewUrl?.startsWith('blob:')) {
      URL.revokeObjectURL(currentItem.imagePreviewUrl);
    }
    URL.revokeObjectURL(previewUrl);
    updateSeedingItem(state, context.campaign.clientId, currentItem.id, 'imageMediaId', result.mediaId ?? result.id);
    updateSeedingItem(state, context.campaign.clientId, currentItem.id, 'imageName', file.name);
    updateSeedingItem(state, context.campaign.clientId, currentItem.id, 'imageSize', file.size);
    updateSeedingItem(state, context.campaign.clientId, currentItem.id, 'imageMimeType', file.type);
    updateSeedingItem(
      state,
      context.campaign.clientId,
      currentItem.id,
      'imagePreviewUrl',
      api.mediaPreviewUrl(currentItem.imageMediaId)
    );
    clearSeedingUpload(uploadKey, requestId);
    render();
    await validateCurrentDraft();
  } catch (error) {
    URL.revokeObjectURL(previewUrl);
    clearSeedingUpload(uploadKey, requestId);
    render();
    showToast(error.message);
  }
}

function isCurrentSeedingUpload(uploadKey, requestId) {
  const entry = state.ui.seedingUploads?.[uploadKey];
  return entry?.requestId === requestId
    && isSeedingUploadTargetCurrent(state, entry.uploadTarget);
}

function clearSeedingUpload(uploadKey, requestId) {
  if (!isCurrentSeedingUpload(uploadKey, requestId)) return false;
  delete state.ui.seedingUploads[uploadKey];
  return true;
}

function clearSeedingUploadRequest(uploadKey, requestId) {
  if (state.ui.seedingUploads?.[uploadKey]?.requestId !== requestId) return false;
  delete state.ui.seedingUploads[uploadKey];
  return true;
}

function discardStaleSeedingUploads() {
  for (const [uploadKey, upload] of Object.entries(state.ui.seedingUploads ?? {})) {
    if (isSeedingUploadTargetCurrent(state, upload.uploadTarget)) continue;
    URL.revokeObjectURL(upload.previewUrl);
    delete state.ui.seedingUploads[uploadKey];
  }
}

function discardAllSeedingUploads() {
  for (const upload of Object.values(state.ui.seedingUploads ?? {})) {
    URL.revokeObjectURL(upload.previewUrl);
  }
  state.ui.seedingUploads = {};
}

function updateSeedingUploadProgress(uploadKey, requestId, event) {
  if (!isCurrentSeedingUpload(uploadKey, requestId)) return;
  const entry = state.ui.seedingUploads[uploadKey];
  const measured = Number(event?.percentage);
  const loaded = Number(event?.loaded) || 0;
  const total = Number(event?.total) || 0;
  const progress = Math.max(0, Math.min(100, Math.round(
    Number.isFinite(measured)
      ? measured
      : total > 0 ? (loaded / total) * 100 : entry.progress
  )));
  entry.progress = Math.max(entry.progress, progress);

  const uploader = [...workspace.querySelectorAll('[data-seeding-upload-key]')]
    .find((element) => element.dataset.seedingUploadKey === uploadKey);
  if (!uploader) return;
  const progressbar = uploader.querySelector('[data-seeding-progress]');
  progressbar?.setAttribute('aria-valuenow', String(entry.progress));
  const value = uploader.querySelector('[data-seeding-progress-value]');
  const fill = uploader.querySelector('[data-seeding-progress-fill]');
  if (value) value.textContent = `${entry.progress}%`;
  if (fill) fill.style.width = `${entry.progress}%`;
}

async function uploadConversationImage(control) {
  const file = control.files?.[0];
  if (!file) return;
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    showToast('Ảnh cuộc trò chuyện phải là JPG, PNG hoặc WebP.');
    return;
  }
  const context = conversationContext(control.dataset.clientId);
  if (!context) return;
  const previewUrl = URL.createObjectURL(file);
  state.ui.conversationImageUploads ??= {};
  state.ui.conversationImageUploads[context.ad.clientId] = { previewUrl, fileName: file.name };
  render();
  try {
    const result = await api.uploadMedia(file, { mode: state.resources.mediaUploadMode ?? 'local' });
    const current = conversationContext(context.ad.clientId);
    if (!current) return;
    detachCreativeForAd(current.ad);
    const mediaId = result.mediaId ?? result.id;
    Object.assign(current.ad.conversation, {
      imageMediaId: mediaId,
      imagePreviewUrl: api.mediaPreviewUrl(mediaId),
      imageName: file.name,
      imageSize: file.size,
      dirty: true
    });
    URL.revokeObjectURL(previewUrl);
    delete state.ui.conversationImageUploads[context.ad.clientId];
    render();
    await validateCurrentDraft();
  } catch (error) {
    URL.revokeObjectURL(previewUrl);
    delete state.ui.conversationImageUploads[context.ad.clientId];
    render();
    showToast(error.message);
  }
}

async function uploadMedia(control) {
  const file = control.files?.[0];
  if (!file) return;
  await uploadMediaFile(file, control.dataset.clientId);
  control.value = '';
}

async function uploadMediaFile(file, clientId) {
  const match = findNode(state, clientId);
  if (match?.type !== 'ad') return;
  const uploadFile = normalizeCreativeMediaFile(file);
  if (!uploadFile) {
    showToast('Chọn file JPG, PNG, WebP, MP4 hoặc MOV.');
    return;
  }
  if (uploadFile.size > 500 * 1024 * 1024) {
    showToast('File tải lên không được vượt quá 500 MB.');
    return;
  }

  const requestId = crypto.randomUUID();
  const previewUrl = URL.createObjectURL(uploadFile);
  const kind = uploadFile.type.startsWith('video/') ? 'video' : 'image';
  state.ui.mediaUploads ??= {};
  state.ui.mediaUploads[match.node.clientId] = {
    requestId,
    status: 'uploading',
    progress: 0,
    previewUrl,
    kind,
    fileName: uploadFile.name,
    fileSize: uploadFile.size
  };
  render();

  try {
    const onProgress = (event) => updateMediaUploadProgress(match.node.clientId, requestId, event);
    const result = state.ui.localDemoResources
      ? createLocalDemoMedia(uploadFile, kind, onProgress)
      : await api.uploadAdMedia(uploadFile, match.campaign.adAccountId, { onProgress });
    if (!isCurrentMediaUpload(match.node.clientId, requestId)) {
      URL.revokeObjectURL(previewUrl);
      return;
    }
    if (match.node.mediaPreviewUrl?.startsWith('blob:')) {
      URL.revokeObjectURL(match.node.mediaPreviewUrl);
    }
    detachCreativeForAd(match.node);
    match.node.mediaPreviewUrl = previewUrl;
    match.node.mediaId = result.mediaId ?? result.id;
    match.node.mediaAsset = result.asset ?? null;
    match.node.mediaKind = result.kind ?? kind;
    match.node.mediaFileName = uploadFile.name;
    match.node.mediaFileSize = uploadFile.size;
    clearMediaUpload(match.node.clientId, requestId);
    render();
    await validateCurrentDraft();
    if (state.ui.localDemoResources) {
      showToast('Đã nạp file mẫu để xem thử trên local.');
    }
  } catch (error) {
    URL.revokeObjectURL(previewUrl);
    clearMediaUpload(match.node.clientId, requestId);
    render();
    showToast(error.message);
  }
}

function normalizeCreativeMediaFile(file) {
  const reportedMimeType = String(file?.type ?? '').trim().toLowerCase();
  const extension = String(file?.name ?? '').toLowerCase().match(/\.[^.]+$/)?.[0] ?? '';
  const mimeType = creativeMediaMimeTypes.has(reportedMimeType)
    ? reportedMimeType
    : creativeMediaMimeTypeByExtension.get(extension);
  if (!mimeType) return null;
  if (file.type === mimeType) return file;
  return new File([file], file.name, { type: mimeType, lastModified: file.lastModified });
}

function createLocalDemoMedia(file, kind, onProgress) {
  onProgress?.({ loaded: file.size, total: file.size, percentage: 100 });
  const mediaId = `local-demo-${crypto.randomUUID()}`;
  return {
    mediaId,
    id: mediaId,
    kind,
    asset: {
      kind,
      localDemo: true,
      name: file.name,
      mimeType: file.type,
      sizeBytes: file.size
    }
  };
}

async function uploadMediaFromNetworkPath(clientId, networkPath) {
  const match = findNode(state, clientId);
  if (match?.type !== 'ad' || state.ui.mediaUploads?.[clientId]) return;
  const path = String(networkPath ?? '').trim();
  if (!path) {
    showToast('Anh dán đường dẫn file trong ổ marketing trước nhé.');
    return;
  }

  const requestId = crypto.randomUUID();
  beginTelegramMediaUpload(clientId, requestId, {
    status: 'connecting',
    mediaId: ''
  });
  render();

  try {
    const result = await telegramUpload.uploadPath({
      clientId,
      path,
      onWaiting: (intent) => {
        const entry = state.ui.mediaUploads?.[clientId];
        if (!entry || entry.requestId !== requestId) return;
        entry.status = 'waiting';
        entry.mediaId = intent.mediaId;
        render();
      },
      onProgress: (status) => {
        const entry = state.ui.mediaUploads?.[clientId];
        if (!entry || entry.requestId !== requestId) return;
        entry.status = status.status;
        updateMediaUploadProgress(clientId, requestId, {
          percentage: status.percentage,
          loaded: status.uploadedBytes,
          total: status.totalBytes
        });
      }
    });
    await attachTelegramMedia(clientId, requestId, result);
  } catch (error) {
    if (!clearMediaUpload(clientId, requestId)) return;
    render();
    showToast(error.message);
  }
}

function beginTelegramMediaUpload(clientId, requestId, intent) {
  const match = findNode(state, clientId);
  if (match?.type !== 'ad') return false;
  state.ui.mediaUploads ??= {};
  state.ui.mediaUploads[clientId] = {
    requestId,
    source: 'telegram',
    mediaId: intent.mediaId ?? '',
    status: intent.status ?? 'waiting',
    progress: Math.max(0, Math.min(100, Math.round(Number(intent.percentage) || 0))),
    uploadedBytes: Math.max(0, Number(intent.uploadedBytes) || 0),
    totalBytes: Math.max(0, Number(intent.totalBytes) || 0),
    previewUrl: match.node.mediaPreviewUrl,
    kind: match.node.mediaKind,
    fileName: '',
    fileSize: 0
  };
  return true;
}

async function attachTelegramMedia(clientId, requestId, result) {
  if (!isCurrentMediaUpload(clientId, requestId)) return;
  const match = findNode(state, clientId);
  if (match?.type !== 'ad') return;
  if (match.node.mediaPreviewUrl?.startsWith('blob:')) {
    URL.revokeObjectURL(match.node.mediaPreviewUrl);
  }
  detachCreativeForAd(match.node);
  match.node.mediaId = result.mediaId;
  match.node.mediaAsset = result.asset ?? null;
  match.node.mediaKind = result.kind || mediaKindFromName(result.name);
  match.node.mediaPreviewUrl = api.mediaPreviewUrl(result.mediaId);
  match.node.mediaFileName = result.name ?? '';
  match.node.mediaFileSize = Math.max(0, Number(result.size) || 0);
  clearMediaUpload(clientId, requestId);
  render();
  await validateCurrentDraft();
}

async function reattachTelegramUploads() {
  await telegramUpload.reattach({
    onWaiting: ({ mediaId, clientId }) => {
      const requestId = `telegram:${mediaId}`;
      if (!state.ui.mediaUploads?.[clientId]) {
        if (!beginTelegramMediaUpload(clientId, requestId, { mediaId, status: 'waiting' })) return;
        render();
      }
    },
    onProgress: ({ mediaId, clientId, status }) => {
      const requestId = `telegram:${mediaId}`;
      if (!state.ui.mediaUploads?.[clientId]) {
        if (!beginTelegramMediaUpload(clientId, requestId, { mediaId, status: status.status })) return;
        render();
      }
      const entry = state.ui.mediaUploads?.[clientId];
      if (!entry || entry.requestId !== requestId) return;
      entry.status = status.status;
      updateMediaUploadProgress(clientId, requestId, {
        percentage: status.percentage,
        loaded: status.uploadedBytes,
        total: status.totalBytes
      });
    },
    onComplete: async ({ mediaId, clientId, result }) => {
      const requestId = `telegram:${mediaId}`;
      if (!state.ui.mediaUploads?.[clientId]) {
        if (!beginTelegramMediaUpload(clientId, requestId, { mediaId, status: 'waiting' })) return;
      }
      await attachTelegramMedia(clientId, requestId, result);
    },
    onError: ({ mediaId, clientId, error }) => {
      const requestId = `telegram:${mediaId}`;
      if (clearMediaUpload(clientId, requestId)) render();
      showToast(error.message);
    }
  });
}

function mediaKindFromName(name) {
  return /\.(?:mp4|mov)$/i.test(name ?? '') ? 'video' : 'image';
}

function mediaFileInput(clientId) {
  return [...workspace.querySelectorAll('[data-action="upload-media"]')]
    .find((element) => element.dataset.clientId === clientId);
}

async function clearAdMedia(clientId) {
  const match = findNode(state, clientId);
  if (match?.type !== 'ad' || state.ui.mediaUploads?.[clientId]) return;
  if (match.node.mediaPreviewUrl?.startsWith('blob:')) URL.revokeObjectURL(match.node.mediaPreviewUrl);
  detachCreativeForAd(match.node);
  match.node.mediaId = '';
  match.node.mediaAsset = null;
  match.node.mediaKind = '';
  match.node.mediaPreviewUrl = '';
  match.node.mediaFileName = '';
  match.node.mediaFileSize = 0;
  render();
  await validateCurrentDraft();
}

function isCurrentMediaUpload(clientId, requestId) {
  return state.ui.mediaUploads?.[clientId]?.requestId === requestId;
}

function clearMediaUpload(clientId, requestId) {
  if (!isCurrentMediaUpload(clientId, requestId)) return false;
  delete state.ui.mediaUploads[clientId];
  return true;
}

function updateMediaUploadProgress(clientId, requestId, event) {
  const entry = state.ui.mediaUploads?.[clientId];
  if (!entry || entry.requestId !== requestId) return;

  const measured = Number(event?.percentage);
  const loaded = Number(event?.loaded) || 0;
  const total = Number(event?.total) || 0;
  const progress = Math.max(0, Math.min(100, Math.round(
    Number.isFinite(measured)
      ? measured
      : total > 0 ? (loaded / total) * 100 : entry.progress
  )));
  entry.progress = Math.max(entry.progress, progress);
  entry.uploadedBytes = Math.max(entry.uploadedBytes || 0, loaded);
  if (total > 0) {
    entry.totalBytes = Math.max(entry.totalBytes || 0, total);
    entry.fileSize = entry.totalBytes;
  }

  const uploader = [...workspace.querySelectorAll('[data-upload-client-id]')]
    .find((element) => element.dataset.uploadClientId === clientId);
  if (!uploader) return;

  const progressbar = uploader.querySelector('[data-media-progress]');
  progressbar?.setAttribute('aria-valuenow', String(entry.progress));
  const value = uploader.querySelector('[data-media-progress-value]');
  const fill = uploader.querySelector('[data-media-progress-fill]');
  const status = uploader.querySelector('[data-media-progress-status]');
  const detail = uploader.querySelector('[data-media-progress-detail]');
  const copy = mediaUploadText(entry);
  if (value) value.textContent = `${entry.progress}%`;
  if (fill) fill.style.width = `${entry.progress}%`;
  if (status) status.textContent = copy.statusText;
  if (detail) detail.textContent = copy.detailText;
}

function scheduleTargetingSearch() {
  clearTimeout(targetingTimer);
  if (state.ui.targetingQuery.trim().length < 2) {
    activeAccountResources().targetingResults = [];
    return;
  }
  targetingTimer = setTimeout(searchTargeting, 600);
}

async function searchTargeting() {
  const query = state.ui.targetingQuery.trim();
  const campaign = activeCampaign(state);
  if (!campaign?.adAccountId || query.length < 2) return;
  const accountId = campaign.adAccountId;
  const resources = accountResources(accountId);
  const cacheKey = `${state.ui.targetingCategory}:${normalizeSearchCacheKey(query)}`;
  if (targetingSearchCache.has(cacheKey)) {
    resources.targetingResults = targetingSearchCache.get(cacheKey);
    render();
    return;
  }
  const sequence = ++targetingSequence;
  state.ui.searchingTargeting = true;
  render();
  try {
    const payload = await api.searchTargeting(
      accountId,
      state.ui.targetingCategory,
      query
    );
    if (sequence !== targetingSequence) return;
    resources.targetingResults = payload.results ?? [];
    targetingSearchCache.set(cacheKey, resources.targetingResults);
  } catch (error) {
    if (sequence !== targetingSequence) return;
    resources.targetingResults = [];
    showToast(error.message);
  } finally {
    if (sequence === targetingSequence) {
      state.ui.searchingTargeting = false;
      render();
    }
  }
}

function scheduleLocationSearch() {
  clearTimeout(locationTimer);
  locationSequence += 1;
  state.ui.searchingLocations = false;
  state.ui.locationSearchCompleted = false;
  state.ui.locationSearchError = '';
  state.ui.locationSearchWarnings = [];
  activeAccountResources().locationResults = [];
  updateLocationSearchView();
  if (state.ui.locationQuery.trim().length < 2) {
    return;
  }
  locationTimer = setTimeout(() => searchLocations(), 600);
}

function dismissLocationSearch() {
  clearTimeout(locationTimer);
  locationSequence += 1;
  state.ui.locationQuery = '';
  state.ui.searchingLocations = false;
  state.ui.locationSearchCompleted = false;
  state.ui.locationSearchError = '';
  state.ui.locationSearchWarnings = [];
  activeAccountResources().locationResults = [];
}

function updateLocationSearchView() {
  const match = findNode(state, state.selection?.clientId);
  if (match?.type !== 'adSet') return;
  const feedback = workspace.querySelector('.location-search-feedback');
  if (feedback) {
    feedback.innerHTML = renderLocationSearchResults(state, match.campaign, match.node);
    feedback.setAttribute('aria-busy', String(Boolean(state.ui.searchingLocations)));
  }
  const button = workspace.querySelector('[data-action="search-location"]');
  if (button) {
    button.disabled = Boolean(state.ui.searchingLocations);
    button.textContent = state.ui.searchingLocations ? 'Đang tìm...' : 'Tìm kiếm';
  }
}

async function searchLocations({ includeAddresses = false } = {}) {
  clearTimeout(locationTimer);
  const sequence = ++locationSequence;
  const query = state.ui.locationQuery.trim();
  const campaign = activeCampaign(state);
  state.ui.locationSearchError = '';
  state.ui.locationSearchWarnings = [];
  state.ui.searchingLocations = false;
  if (!campaign?.adAccountId || query.length < 2) {
    state.ui.locationSearchError = !campaign?.adAccountId
      ? 'Chọn tài khoản quảng cáo trước khi tìm vị trí.'
      : 'Nhập ít nhất 2 ký tự để tìm vị trí.';
    updateLocationSearchView();
    return;
  }
  const accountId = campaign.adAccountId;
  const selectedClientId = state.selection?.clientId;
  const resources = accountResources(accountId);
  const isCurrent = () => sequence === locationSequence
    && activeCampaign(state)?.adAccountId === accountId
    && state.selection?.clientId === selectedClientId
    && state.ui.locationQuery.trim() === query;
  const cacheKey = `${accountId}:${includeAddresses ? 'address' : 'meta'}:${normalizeSearchCacheKey(query)}`;
  const cached = locationSearchCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    resources.locationResults = cached.results;
    state.ui.locationSearchCompleted = true;
    updateLocationSearchView();
    return;
  }
  state.ui.searchingLocations = true;
  resources.locationResults = [];
  updateLocationSearchView();
  try {
    const payload = await api.searchLocations(accountId, query, { includeAddresses });
    if (!isCurrent()) return;
    const currentResources = accountResources(accountId);
    currentResources.locationResults = payload.results ?? [];
    state.ui.locationSearchWarnings = payload.warnings ?? [];
    if (currentResources.locationResults.length && !state.ui.locationSearchWarnings.length) {
      if (locationSearchCache.size >= 100) locationSearchCache.delete(locationSearchCache.keys().next().value);
      locationSearchCache.set(cacheKey, { results: currentResources.locationResults, expiresAt: Date.now() + 5 * 60 * 1000 });
    }
  } catch (error) {
    if (!isCurrent()) return;
    accountResources(accountId).locationResults = [];
    state.ui.locationSearchError = error.message || 'Không thể tìm vị trí lúc này. Anh thử lại nhé.';
  } finally {
    if (sequence === locationSequence) {
      state.ui.searchingLocations = false;
      state.ui.locationSearchCompleted = isCurrent();
      updateLocationSearchView();
    }
  }
}

function normalizeSearchCacheKey(query) {
  return String(query).normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('vi');
}

function addTargetingItem(clientId, targetingId) {
  const match = findNode(state, clientId);
  const item = resourcesForCampaign(state, match?.campaign).targetingResults
    .find((result) => result.id === targetingId);
  if (match?.type !== 'adSet' || !item) return;
  if (!match.node.detailedTargeting.some((entry) => entry.id === item.id)) {
    match.node.detailedTargeting.push({
      id: item.id,
      name: item.name,
      targetingField: item.targetingField
    });
  }
}

function normalizedFieldValue(control) {
  if (control.type === 'checkbox') return control.checked;
  if (control.dataset.field === 'genders') {
    return Number(control.value) === 0 ? [] : [Number(control.value)];
  }
  if (control.dataset.field === 'dailyBudget') {
    return Number(control.value.replace(/\D/g, ''));
  }
  if (['ageMin', 'ageMax'].includes(control.dataset.field)) {
    return Number(control.value);
  }
  return control.value;
}

function accountResources(accountId) {
  return state.resources.accountResourcesById?.[accountId]
    ?? setAccountResources(state, accountId, {});
}

function activeAccountResources() {
  const accountId = activeCampaign(state)?.adAccountId;
  return accountId ? accountResources(accountId) : { targetingResults: [], locationResults: [] };
}

function clearActiveSearchResults() {
  dismissLocationSearch();
  const resources = activeAccountResources();
  resources.targetingResults = [];
  resources.locationResults = [];
  state.ui.targetingQuery = '';
  state.ui.locationQuery = '';
}

function showToast(message) {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  toastRegion.append(toast);
  window.setTimeout(() => toast.remove(), 4200);
}

function enableLocalProgressDemo() {
  if (!['localhost', '127.0.0.1'].includes(window.location.hostname)) return;
  if (new URLSearchParams(window.location.search).get('demoProgress') !== '1') return;
  const campaign = state.draft.campaigns[0];
  const adSet = campaign?.adSets?.[0];
  const ad = adSet?.ads?.[0];
  if (!campaign || !adSet || !ad) return;
  state.publishProgress = {
    runId: 'local-progress-demo',
    status: 'creating',
    completed: 10,
    total: 13,
    percent: 76,
    currentClientId: ad.clientId,
    error: null,
    seeding: { summary: { total: 1, created: 0, pending: 1 }, jobs: [], waitingPostCount: 1 },
    seedingError: null,
    snapshot: state.draft,
    nodes: [
      { clientId: campaign.clientId, type: 'campaign', name: 'Demo Campaign', status: 'created', remoteId: 'demo-campaign' },
      { clientId: adSet.clientId, parentClientId: campaign.clientId, type: 'adSet', name: 'Demo Ad Set', status: 'created', remoteId: 'demo-adset' },
      { clientId: ad.clientId, parentClientId: adSet.clientId, type: 'ad', name: 'Demo Ad đang lấy Post ID', status: 'creating' }
    ],
    overall: {
      completed: 10,
      total: 13,
      percent: 76,
      phase: 'post',
      status: 'running'
    },
    campaigns: [{
      clientId: campaign.clientId,
      name: 'Demo Campaign — kiểm tra giao diện',
      completed: 10,
      total: 13,
      percent: 76,
      phase: 'post',
      status: 'running'
    }]
  };
}

enableLocalProgressDemo();
render();
void initializeWorkspace();

async function initializeWorkspace() {
  try {
    const session = await api.loadSession();
    if ((session.metaUser?.id ?? null) !== (rememberedMetaUser?.id ?? null)) api.clearCache();
    state.connected = session.connected === true;
    state.metaUser = session.metaUser ?? null;
    draftStorage.restore(state, session.metaUser?.id ?? 'anonymous');
    sessionLoading = false;
    render();
    await loadResources();
    if (state.connected) void reattachTelegramUploads();
  } catch (error) {
    sessionLoading = false;
    render();
    showToast(`Chưa kiểm tra được phiên đăng nhập: ${error.message}. Anh bấm nút tài khoản để thử lại.`);
    sessionLoadingFailed = true;
  }
}

let sessionLoadingFailed = false;
window.addEventListener('pagehide', () => draftStorage.save(state));
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') draftStorage.save(state);
});
for (const eventName of ['input', 'change', 'click']) {
  workspace.addEventListener(eventName, () => queueMicrotask(() => draftStorage.save(state)));
}

const startupParams = new URLSearchParams(window.location.search);
const preserveDemoQuery = startupParams.get('demoResources') === '1'
  || startupParams.get('demoProgress') === '1'
  || startupParams.get('realResources') === '1';
if (!preserveDemoQuery && (window.location.search || window.location.hash)) {
  window.history.replaceState({}, '', window.location.pathname);
}


function closeExpandableSelects(except = null) {
  workspace.querySelectorAll('[data-expand-select].is-open').forEach((root) => {
    if (root === except) return;
    root.classList.remove('is-open');
    root.classList.remove('is-dropup');
    root.querySelector('[data-expand-select-trigger]')?.setAttribute('aria-expanded', 'false');
    root.querySelector('.expand-select-expand')?.setAttribute('aria-hidden', 'true');
  });
}

function closeAgeDropdowns(except = null) {
  workspace.querySelectorAll('[data-age-dropdown].open').forEach((root) => {
    if (root === except) return;
    root.classList.remove('open');
    root.classList.remove('is-dropup');
    root.querySelector('[data-age-trigger]')?.setAttribute('aria-expanded', 'false');
    root.querySelector('.age-panel')?.setAttribute('aria-hidden', 'true');
  });
}

function closeDateTimePickers(except = null) {
  workspace.querySelectorAll('[data-datetime-picker].open').forEach((root) => {
    if (root === except) return;
    root.classList.remove('open');
    root.classList.remove('is-dropup');
    root.querySelector('[data-datetime-trigger]')?.setAttribute('aria-expanded', 'false');
    root.querySelector('.dt-panel')?.setAttribute('aria-hidden', 'true');
    restoreDateTimeDisplay(root);
  });
}

function closeTemplateDropdowns(except = null) {
  workspace.querySelectorAll('[data-template-card-dropdown][open]').forEach((root) => {
    if (root === except) return;
    root.open = false;
    root.classList.remove('is-dropup');
  });
}

function focusRenderedDropdownTrigger(control) {
  const expandRoot = control?.closest?.('[data-expand-select]');
  const ageRoot = control?.closest?.('[data-age-dropdown]');
  if (expandRoot) {
    const selectAction = expandRoot.dataset.selectAction || control.dataset.action;
    const clientId = expandRoot.dataset.clientId || control.dataset.clientId;
    const selector = selectAction
      ? `[data-expand-select][data-client-id="${CSS.escape(clientId ?? '')}"][data-select-action="${CSS.escape(selectAction)}"]`
      : `input[data-client-id="${CSS.escape(control.dataset.clientId ?? '')}"][data-field="${CSS.escape(control.dataset.field ?? '')}"]`;
    window.requestAnimationFrame(() => {
      const rendered = workspace.querySelector(selector);
      (rendered?.matches('[data-expand-select]') ? rendered : rendered?.closest('[data-expand-select]'))
        ?.querySelector('[data-expand-select-trigger]')
        ?.focus();
    });
    return;
  }
  if (ageRoot) {
    const selector = `input[data-client-id="${CSS.escape(control.dataset.clientId ?? '')}"][data-field="${CSS.escape(control.dataset.field ?? '')}"]`;
    window.requestAnimationFrame(() => {
      workspace.querySelector(selector)
        ?.closest('[data-age-dropdown]')
        ?.querySelector('[data-age-trigger]')
        ?.focus();
    });
  }
}

function focusRenderedSmartResourceTrigger(control) {
  const root = control?.closest?.('[data-smart-resource-picker]');
  if (!root) return;
  const resourceKind = root.dataset.resourceKind;
  const clientId = root.dataset.clientId || control.dataset.clientId;
  const selector = `[data-smart-resource-picker][data-resource-kind="${CSS.escape(resourceKind ?? '')}"][data-client-id="${CSS.escape(clientId ?? '')}"]`;
  window.requestAnimationFrame(() => {
    workspace.querySelector(selector)
      ?.querySelector('[data-action="toggle-smart-resource"]')
      ?.focus();
  });
}

function floatingDropdownParts(root) {
  if (!root) return {};
  return {
    trigger: root.querySelector('[data-expand-select-trigger], [data-age-trigger], [data-datetime-trigger], summary'),
    panel: root.querySelector('.expand-select-expand, .smart-resource-panel, .age-panel, .template-card-dropdown-panel, .dt-panel')
  };
}

function positionFloatingDropdown(root) {
  const { trigger, panel } = floatingDropdownParts(root);
  if (!trigger || !panel) return;
  root.classList.remove('is-dropup');
  panel.style.removeProperty('--floating-panel-max-height');
  const triggerRect = trigger.getBoundingClientRect();
  const viewportPadding = 12;
  const viewportTop = 0;
  const viewportBottom = window.innerHeight;
  const spaceBelow = Math.max(0, viewportBottom - triggerRect.bottom - viewportPadding);
  const spaceAbove = Math.max(0, triggerRect.top - viewportTop - viewportPadding);
  const desiredHeight = Math.min(panel.scrollHeight || 320, 420);
  const shouldDropUp = spaceBelow < Math.min(desiredHeight, 220) && spaceAbove > spaceBelow;
  root.classList.toggle('is-dropup', shouldDropUp);
  const availableSpace = Math.max(140, (shouldDropUp ? spaceAbove : spaceBelow) - 6);
  panel.style.setProperty('--floating-panel-max-height', `${Math.floor(availableSpace)}px`);
}

function closeAllFloatingDropdowns() {
  closeExpandableSelects();
  closeAgeDropdowns();
  closeDateTimePickers();
  closeTemplateDropdowns();
}

function padDateTimePart(value) {
  return String(value).padStart(2, '0');
}

function parseLocalDateTime(value) {
  const matched = String(value ?? '').match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!matched) return null;
  return {
    year: Number(matched[1]),
    month: Number(matched[2]) - 1,
    day: Number(matched[3]),
    hour: Number(matched[4]),
    minute: Number(matched[5])
  };
}

function formatDateTimeDisplay(value) {
  const parts = parseLocalDateTime(value);
  if (!parts) return 'dd/mm/yyyy --:--';
  return `${padDateTimePart(parts.day)}/${padDateTimePart(parts.month + 1)}/${parts.year} ${padDateTimePart(parts.hour)}:${padDateTimePart(parts.minute)}`;
}

function restoreDateTimeDisplay(root) {
  const input = root.querySelector('input[type="hidden"]');
  const display = root.querySelector('[data-datetime-display]');
  if (!input || !display) return;
  display.textContent = formatDateTimeDisplay(input.value);
  display.classList.toggle('filled', Boolean(input.value));
}

function pendingDateTimeValue(root) {
  const date = root.dataset.pendingDate;
  if (!date) return '';
  return `${date}T${padDateTimePart(root.dataset.pendingHour ?? 0)}:${padDateTimePart(root.dataset.pendingMinute ?? 0)}`;
}

function updatePendingDateTimeDisplay(root) {
  const display = root.querySelector('[data-datetime-display]');
  const value = pendingDateTimeValue(root);
  if (!display) return;
  display.textContent = formatDateTimeDisplay(value);
  display.classList.toggle('filled', Boolean(value));
}

function initializeDateTimePicker(root) {
  const input = root.querySelector('input[type="hidden"]');
  const current = parseLocalDateTime(input?.value);
  const today = new Date();
  root.dataset.pendingDate = current
    ? `${current.year}-${padDateTimePart(current.month + 1)}-${padDateTimePart(current.day)}`
    : '';
  root.dataset.pendingHour = String(current?.hour ?? 0);
  root.dataset.pendingMinute = String(current?.minute ?? 0);
  root.dataset.viewYear = String(current?.year ?? today.getFullYear());
  root.dataset.viewMonth = String(current?.month ?? today.getMonth());
  renderDateTimeCalendar(root);
  updateTimeColumnSelection(root, 'hour', Number(root.dataset.pendingHour), false);
  updateTimeColumnSelection(root, 'minute', Number(root.dataset.pendingMinute), false);
  window.setTimeout(() => {
    root.querySelectorAll('[data-time-part]').forEach((column) => {
      const part = column.dataset.timePart;
      const value = Number(part === 'hour' ? root.dataset.pendingHour : root.dataset.pendingMinute);
      column.scrollTop = value * 30;
    });
  }, 0);
}

function renderDateTimeCalendar(root) {
  const days = root.querySelector('[data-calendar-days]');
  const monthLabel = root.querySelector('[data-calendar-month-label]');
  if (!days || !monthLabel) return;
  const today = new Date();
  const year = Number(root.dataset.viewYear ?? today.getFullYear());
  const month = Number(root.dataset.viewMonth ?? today.getMonth());
  const selectedDate = root.dataset.pendingDate ?? '';
  const firstDay = new Date(year, month, 1);
  const startOffset = (firstDay.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPreviousMonth = new Date(year, month, 0).getDate();
  const cells = [];
  monthLabel.textContent = `Tháng ${month + 1} ${year}`;

  for (let offset = startOffset; offset > 0; offset -= 1) {
    cells.push(`<span class="cal-day muted" aria-hidden="true">${daysInPreviousMonth - offset + 1}</span>`);
  }
  for (let day = 1; day <= daysInMonth; day += 1) {
    const isoDate = `${year}-${padDateTimePart(month + 1)}-${padDateTimePart(day)}`;
    const isToday = day === today.getDate() && month === today.getMonth() && year === today.getFullYear();
    const isSelected = isoDate === selectedDate;
    cells.push(`<button type="button" class="cal-day${isToday ? ' today' : ''}${isSelected ? ' selected' : ''}" data-calendar-day="${isoDate}" aria-pressed="${isSelected}">${day}</button>`);
  }
  const remainder = (7 - (cells.length % 7)) % 7;
  for (let day = 1; day <= remainder; day += 1) {
    cells.push(`<span class="cal-day muted" aria-hidden="true">${day}</span>`);
  }
  days.innerHTML = cells.join('');
}

function updateTimeColumnSelection(root, part, value, scroll = true) {
  const max = part === 'hour' ? 23 : 59;
  const nextValue = Math.max(0, Math.min(max, Number(value) || 0));
  root.dataset[part === 'hour' ? 'pendingHour' : 'pendingMinute'] = String(nextValue);
  const column = root.querySelector(`[data-time-part="${part}"]`);
  column?.querySelectorAll('[data-time-value]').forEach((item) => {
    const active = Number(item.dataset.timeValue) === nextValue;
    item.classList.toggle('active', active);
    item.setAttribute('aria-pressed', String(active));
  });
  if (scroll && column) column.scrollTo({ top: nextValue * 30, behavior: 'smooth' });
  updatePendingDateTimeDisplay(root);
}

const dateTimeScrollTimers = new WeakMap();

function closeSmartResourcePickers(except = null) {
  closeExpandableSelects(except);
  workspace.querySelectorAll('[data-smart-resource-picker]').forEach((root) => {
    if (root === except) return;
    if (smartResourceSearchFocusIntent?.kind === root.dataset.resourceKind
      && smartResourceSearchFocusIntent?.clientId === root.dataset.clientId) {
      smartResourceSearchFocusIntent = null;
    }
    root.dataset.smartResourceActiveIndex = '-1';
    root.querySelector('[data-smart-resource-search]')?.removeAttribute('aria-activedescendant');
    root.querySelector('[data-action="toggle-smart-resource"]')?.removeAttribute('aria-activedescendant');
    root.querySelectorAll('[data-smart-resource-option]').forEach((option) => {
      option.classList.remove('is-active');
      option.tabIndex = -1;
    });
  });
}

function focusDropdownSearch(root, selector) {
  const focusSearch = ({ afterClick = false } = {}) => {
    if (selector === '[data-smart-resource-search]'
      && (smartResourceSearchFocusIntent?.kind !== root?.dataset.resourceKind
        || smartResourceSearchFocusIntent?.clientId !== root?.dataset.clientId)) return false;
    const search = root?.querySelector(selector);
    const trigger = root?.querySelector('[data-expand-select-trigger], summary');
    const isOpen = root?.classList.contains('is-open') || root?.open === true;
    if (!search || !root.isConnected || !isOpen) return false;
    if (afterClick
      && document.activeElement !== search
      && document.activeElement !== trigger
      && document.activeElement !== document.body) return false;
    search.focus({ preventScroll: true });
    const end = search.value.length;
    search.setSelectionRange?.(end, end);
    return document.activeElement === search;
  };

  // Focus synchronously while the click still has user activation. This also
  // opens the mobile keyboard reliably instead of waiting for a later frame.
  focusSearch();
  window.requestAnimationFrame(() => {
    if (!focusSearch({ afterClick: true })) {
      window.requestAnimationFrame(() => focusSearch({ afterClick: true }));
    }
  });
  window.setTimeout(() => focusSearch({ afterClick: true }), 80);
}

function focusIntendedSmartResourceSearch() {
  if (!smartResourceSearchFocusIntent) return;
  const root = [...workspace.querySelectorAll('[data-smart-resource-picker]')].find((candidate) => (
    candidate.dataset.resourceKind === smartResourceSearchFocusIntent.kind
    && candidate.dataset.clientId === smartResourceSearchFocusIntent.clientId
  ));
  if (!root?.classList.contains('is-open')) return;
  focusDropdownSearch(root, '[data-smart-resource-search]');
}

function maintainIntendedSmartResourceSearchFocus() {
  [0, 80, 240, 500].forEach((delay) => {
    window.setTimeout(() => focusIntendedSmartResourceSearch(), delay);
  });
}

function normalizeExpandableSearch(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLocaleLowerCase('vi')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function boundedSearchDistance(left, right, limit = 1) {
  if (Math.abs(left.length - right.length) > limit) return limit + 1;
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let row = 1; row <= left.length; row += 1) {
    const current = [row];
    let rowMinimum = current[0];
    for (let column = 1; column <= right.length; column += 1) {
      const cost = left[row - 1] === right[column - 1] ? 0 : 1;
      current[column] = Math.min(previous[column] + 1, current[column - 1] + 1, previous[column - 1] + cost);
      rowMinimum = Math.min(rowMinimum, current[column]);
    }
    if (rowMinimum > limit) return limit + 1;
    previous = current;
  }
  return previous[right.length];
}

function expandableSearchScore(value, query) {
  const haystack = normalizeExpandableSearch(value);
  const normalizedQuery = normalizeExpandableSearch(query);
  if (!normalizedQuery) return 0;
  if (!haystack) return -1;
  if (haystack === normalizedQuery) return 1200;
  if (haystack.startsWith(normalizedQuery)) return 1000;
  if (haystack.includes(normalizedQuery)) return 900;
  const compactHaystack = haystack.replaceAll(' ', '');
  const compactQuery = normalizedQuery.replaceAll(' ', '');
  if (compactHaystack.includes(compactQuery)) return 850;

  const words = haystack.split(' ').filter(Boolean);
  const tokens = normalizedQuery.split(' ').filter(Boolean);
  let score = 0;
  for (const token of tokens) {
    let tokenScore = 0;
    for (const word of words) {
      if (word === token) tokenScore = Math.max(tokenScore, 140);
      else if (word.startsWith(token)) tokenScore = Math.max(tokenScore, 110);
      else if (word.includes(token)) tokenScore = Math.max(tokenScore, 80);
      else if (token.length >= 4 && boundedSearchDistance(word, token, 1) <= 1) tokenScore = Math.max(tokenScore, 55);
    }
    if (!tokenScore) return -1;
    score += tokenScore;
  }
  return score;
}

function filterExpandableSelect(root, query) {
  const options = [...root.querySelectorAll('[data-expand-select-option]')];
  const optionsContainer = root.querySelector('.expand-select-options');
  let visible = 0;
  const ranked = options.map((option, index) => ({
    option,
    index: Number(option.dataset.searchOrder ?? index),
    score: expandableSearchScore(`${option.dataset.value ?? ''} ${option.dataset.label ?? ''} ${option.textContent ?? ''}`, query)
  }));
  ranked.forEach(({ option, index }) => { option.dataset.searchOrder = String(index); });
  ranked.sort((left, right) => query.trim() ? right.score - left.score || left.index - right.index : left.index - right.index);
  ranked.forEach(({ option, score }) => {
    option.hidden = score < 0;
    option.classList.remove('is-active');
    option.tabIndex = -1;
    if (score >= 0) visible += 1;
    optionsContainer?.append(option);
  });
  root.querySelector('[data-expand-select-empty]')?.classList.toggle('is-hidden', visible > 0);
  root.dataset.expandSelectActiveIndex = '-1';
}

function visibleExpandableOptions(root) {
  return [...root.querySelectorAll('[data-expand-select-option]')].filter((option) => !option.hidden && !option.disabled);
}

function focusExpandableOption(root, index) {
  const options = visibleExpandableOptions(root);
  if (!options.length) return;
  const next = Math.max(0, Math.min(options.length - 1, index));
  options.forEach((option, optionIndex) => {
    option.classList.toggle('is-active', optionIndex === next);
    option.tabIndex = optionIndex === next ? 0 : -1;
  });
  root.dataset.expandSelectActiveIndex = String(next);
  options[next].focus();
  options[next].scrollIntoView({ block: 'nearest' });
}

workspace.addEventListener('click', (event) => {
  const trigger = event.target.closest('[data-expand-select-trigger]:not([data-action="toggle-smart-resource"])');
  if (trigger) {
    const root = trigger.closest('[data-expand-select]');
    if (!root || trigger.disabled) return;
    const open = !root.classList.contains('is-open');
    closeExpandableSelects(open ? root : null);
    root.classList.toggle('is-open', open);
    trigger.setAttribute('aria-expanded', String(open));
    root.querySelector('.expand-select-expand')?.setAttribute('aria-hidden', String(!open));
    if (open) {
      positionFloatingDropdown(root);
      const search = root.querySelector('[data-expand-select-search]');
      filterExpandableSelect(root, search?.value ?? '');
      focusDropdownSearch(root, '[data-expand-select-search]');
    }
    return;
  }

  const option = event.target.closest('[data-expand-select-option]');
  if (!option || option.disabled) return;
  const root = option.closest('[data-expand-select]');
  const input = root?.querySelector('input[type="hidden"]');
  if (!root || !input) return;
  input.value = option.dataset.value ?? '';
  root.classList.remove('is-open');
  root.querySelector('[data-expand-select-trigger]')?.setAttribute('aria-expanded', 'false');
  root.querySelector('.expand-select-expand')?.setAttribute('aria-hidden', 'true');
  input.dispatchEvent(new Event('change', { bubbles: true }));
  focusRenderedDropdownTrigger(input);
});

workspace.addEventListener('input', (event) => {
  const search = event.target.closest('[data-expand-select-search]:not([data-smart-resource-search])');
  const root = search?.closest('[data-expand-select]');
  if (root) filterExpandableSelect(root, search.value);
});

workspace.addEventListener('keydown', (event) => {
  const root = event.target.closest('[data-expand-select]:not([data-smart-resource-picker])');
  if (!root || !root.classList.contains('is-open')) return;
  const options = visibleExpandableOptions(root);
  if (!options.length) return;
  const current = Number.parseInt(root.dataset.expandSelectActiveIndex ?? '-1', 10);
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    focusExpandableOption(root, event.key === 'ArrowDown' ? (current < 0 ? 0 : current + 1) : (current < 0 ? options.length - 1 : current - 1));
  } else if (event.key === 'Home' || event.key === 'End') {
    event.preventDefault();
    focusExpandableOption(root, event.key === 'Home' ? 0 : options.length - 1);
  } else if (event.key === 'Escape') {
    event.preventDefault();
    closeExpandableSelects();
    root.querySelector('[data-expand-select-trigger]')?.focus();
  } else if ((event.key === 'Enter' || event.key === ' ')
    && event.target.matches('[data-expand-select-option]:not(:disabled)')) {
    event.preventDefault();
    event.target.click();
  }
});

function openAgeDropdown(root) {
  closeAgeDropdowns(root);
  closeDateTimePickers();
  closeExpandableSelects();
  root.classList.add('open');
  root.querySelector('[data-age-trigger]')?.setAttribute('aria-expanded', 'true');
  root.querySelector('.age-panel')?.setAttribute('aria-hidden', 'false');
  positionFloatingDropdown(root);
}

function focusAgeOption(root, direction = 0) {
  const options = [...root.querySelectorAll('[data-age-option]:not(:disabled)')];
  if (!options.length) return;
  const focused = options.indexOf(document.activeElement);
  const selected = options.findIndex((option) => option.classList.contains('selected'));
  const current = focused >= 0 ? focused : Math.max(0, selected);
  const next = direction === Infinity
    ? options.length - 1
    : direction === -Infinity
      ? 0
      : Math.max(0, Math.min(options.length - 1, current + direction));
  options[next].focus();
  options[next].scrollIntoView({ block: 'nearest' });
}

workspace.addEventListener('click', (event) => {
  const trigger = event.target.closest('[data-age-trigger]');
  if (trigger) {
    const root = trigger.closest('[data-age-dropdown]');
    if (!root || trigger.disabled) return;
    const shouldOpen = !root.classList.contains('open');
    closeAgeDropdowns(shouldOpen ? root : null);
    closeDateTimePickers();
    closeExpandableSelects();
    root.classList.toggle('open', shouldOpen);
    trigger.setAttribute('aria-expanded', String(shouldOpen));
    root.querySelector('.age-panel')?.setAttribute('aria-hidden', String(!shouldOpen));
    if (shouldOpen) positionFloatingDropdown(root);
    return;
  }

  const option = event.target.closest('[data-age-option]');
  if (!option || option.disabled) return;
  const root = option.closest('[data-age-dropdown]');
  const input = root?.querySelector('input[type="hidden"]');
  if (!root || !input) return;
  input.value = option.dataset.value ?? '';
  closeAgeDropdowns();
  input.dispatchEvent(new Event('change', { bubbles: true }));
  focusRenderedDropdownTrigger(input);
});

workspace.addEventListener('keydown', (event) => {
  const root = event.target.closest('[data-age-dropdown]');
  if (!root) return;
  if (event.key === 'Escape' && root.classList.contains('open')) {
    event.preventDefault();
    closeAgeDropdowns();
    root.querySelector('[data-age-trigger]')?.focus();
    return;
  }
  if ((event.key === 'Enter' || event.key === ' ')
    && event.target.matches('[data-age-option]:not(:disabled)')) {
    event.preventDefault();
    event.target.click();
    return;
  }
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  if (!root.classList.contains('open')) openAgeDropdown(root);
  if (event.key === 'Home') focusAgeOption(root, -Infinity);
  else if (event.key === 'End') focusAgeOption(root, Infinity);
  else focusAgeOption(root, event.key === 'ArrowDown' ? 1 : -1);
});

workspace.addEventListener('click', (event) => {
  const trigger = event.target.closest('[data-datetime-trigger]');
  if (trigger) {
    const root = trigger.closest('[data-datetime-picker]');
    if (!root || trigger.disabled) return;
    const shouldOpen = !root.classList.contains('open');
    closeDateTimePickers(shouldOpen ? root : null);
    closeAgeDropdowns();
    closeExpandableSelects();
    root.classList.toggle('open', shouldOpen);
    trigger.setAttribute('aria-expanded', String(shouldOpen));
    root.querySelector('.dt-panel')?.setAttribute('aria-hidden', String(!shouldOpen));
    if (shouldOpen) {
      initializeDateTimePicker(root);
      positionFloatingDropdown(root);
    }
    return;
  }

  const root = event.target.closest('[data-datetime-picker]');
  if (!root) return;

  const navigation = event.target.closest('[data-calendar-nav]');
  if (navigation) {
    const current = new Date(Number(root.dataset.viewYear), Number(root.dataset.viewMonth), 1);
    current.setMonth(current.getMonth() + Number(navigation.dataset.calendarNav));
    root.dataset.viewYear = String(current.getFullYear());
    root.dataset.viewMonth = String(current.getMonth());
    renderDateTimeCalendar(root);
    return;
  }

  const day = event.target.closest('[data-calendar-day]');
  if (day) {
    root.dataset.pendingDate = day.dataset.calendarDay ?? '';
    renderDateTimeCalendar(root);
    updatePendingDateTimeDisplay(root);
    return;
  }

  const time = event.target.closest('[data-time-value]');
  if (time) {
    const part = time.closest('[data-time-part]')?.dataset.timePart;
    if (part) updateTimeColumnSelection(root, part, Number(time.dataset.timeValue));
    return;
  }

  if (event.target.closest('[data-datetime-today]')) {
    const today = new Date();
    root.dataset.pendingDate = `${today.getFullYear()}-${padDateTimePart(today.getMonth() + 1)}-${padDateTimePart(today.getDate())}`;
    root.dataset.viewYear = String(today.getFullYear());
    root.dataset.viewMonth = String(today.getMonth());
    renderDateTimeCalendar(root);
    updatePendingDateTimeDisplay(root);
    return;
  }

  const input = root.querySelector('input[type="hidden"]');
  if (!input) return;
  if (event.target.closest('[data-datetime-clear]')) {
    input.value = '';
    closeDateTimePickers();
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return;
  }
  if (event.target.closest('[data-datetime-confirm]')) {
    if (!root.dataset.pendingDate) {
      const today = new Date();
      root.dataset.pendingDate = `${today.getFullYear()}-${padDateTimePart(today.getMonth() + 1)}-${padDateTimePart(today.getDate())}`;
    }
    input.value = pendingDateTimeValue(root);
    closeDateTimePickers();
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }
});

workspace.addEventListener('keydown', (event) => {
  const root = event.target.closest('[data-datetime-picker]');
  if (!root || event.key !== 'Escape' || !root.classList.contains('open')) return;
  event.preventDefault();
  closeDateTimePickers();
  root.querySelector('[data-datetime-trigger]')?.focus();
});

workspace.addEventListener('scroll', (event) => {
  const column = event.target.closest?.('[data-time-part]');
  const root = column?.closest('[data-datetime-picker]');
  if (!column || !root?.classList.contains('open')) return;
  window.clearTimeout(dateTimeScrollTimers.get(column));
  const timer = window.setTimeout(() => {
    const value = Math.round(column.scrollTop / 30);
    updateTimeColumnSelection(root, column.dataset.timePart, value, false);
    const targetTop = value * 30;
    if (Math.abs(column.scrollTop - targetTop) > 1) column.scrollTo({ top: targetTop, behavior: 'smooth' });
  }, 80);
  dateTimeScrollTimers.set(column, timer);
}, true);

function captureSmartResourcePickerState() {
  const root = workspace.querySelector('[data-smart-resource-picker].is-open');
  if (!root) return null;
  const search = root.querySelector('[data-smart-resource-search]');
  return {
    kind: root.dataset.resourceKind,
    clientId: root.dataset.clientId,
    query: search?.value ?? '',
    focused: Boolean(search && root.contains(document.activeElement))
      || (smartResourceSearchFocusIntent?.kind === root.dataset.resourceKind
        && smartResourceSearchFocusIntent?.clientId === root.dataset.clientId)
  };
}

function restoreSmartResourcePickerState(state) {
  if (!state) return;
  const root = [...workspace.querySelectorAll('[data-smart-resource-picker]')].find((candidate) => (
    candidate.dataset.resourceKind === state.kind
    && candidate.dataset.clientId === state.clientId
  ));
  if (!root || root.classList.contains('is-disabled')) return;
  root.classList.add('is-open');
  root.querySelector('[data-action="toggle-smart-resource"]')?.setAttribute('aria-expanded', 'true');
  root.querySelector('.smart-resource-panel')?.setAttribute('aria-hidden', 'false');
  queueMicrotask(() => positionFloatingDropdown(root));
  const search = root.querySelector('[data-smart-resource-search]');
  if (!search) return;
  search.value = state.query;
  filterSmartResourcePicker(root, state.query);
  if (state.focused) queueMicrotask(() => focusDropdownSearch(root, '[data-smart-resource-search]'));
}

function filterSmartResourcePicker(root, query) {
  const normalized = String(query ?? '').trim();
  const options = [...root.querySelectorAll('[data-smart-resource-option]')];
  const ranked = options.map((option) => ({
    option,
    score: resourceSearchScore({
      id: option.dataset.value,
      name: option.dataset.name,
      detail: option.dataset.detail
    }, normalized),
    index: Number(option.dataset.searchIndex ?? 0)
  })).sort((left, right) => normalized
    ? right.score - left.score || left.index - right.index
    : left.index - right.index);
  const optionsContainer = root.querySelector('.smart-resource-options');
  ranked.forEach(({ option }) => optionsContainer?.append(option));
  let visible = 0;
  ranked.forEach(({ option, score }) => {
    const matches = !normalized || (score >= 0 && visible < 20);
    option.hidden = !matches;
    if (matches) visible += 1;
    const name = option.dataset.name ?? '';
    const detail = option.dataset.detail ?? '';
    const nameElement = option.querySelector('strong');
    const detailElement = option.querySelector('small');
    if (nameElement) nameElement.innerHTML = highlightResourceSearch(name, normalized);
    if (detailElement) detailElement.innerHTML = highlightResourceSearch(detail, normalized);
  });
  const empty = root.querySelector('[data-smart-resource-empty]');
  if (empty) empty.classList.toggle('is-hidden', visible > 0);
  root.dataset.smartResourceActiveIndex = '-1';
  root.querySelectorAll('[data-smart-resource-option]').forEach((option) => option.classList.remove('is-active'));
  root.querySelector('[data-smart-resource-search]')?.removeAttribute('aria-activedescendant');
  root.querySelector('[data-action="toggle-smart-resource"]')?.removeAttribute('aria-activedescendant');
}

function visibleSmartResourceOptions(root) {
  return [...root.querySelectorAll('[data-smart-resource-option]')]
    .filter((option) => !option.hidden && !option.disabled);
}

function moveSmartResourceSelection(root, direction) {
  const options = visibleSmartResourceOptions(root);
  if (!options.length) return null;
  const current = Number.parseInt(root.dataset.smartResourceActiveIndex ?? '-1', 10);
  const next = current < 0
    ? (direction > 0 ? 0 : options.length - 1)
    : (current + direction + options.length) % options.length;
  options.forEach((option, index) => {
    option.classList.toggle('is-active', index === next);
    option.tabIndex = index === next ? 0 : -1;
  });
  root.dataset.smartResourceActiveIndex = String(next);
  const activeId = options[next].id;
  root.querySelector('[data-smart-resource-search]')?.setAttribute('aria-activedescendant', activeId);
  root.querySelector('[data-action="toggle-smart-resource"]')?.setAttribute('aria-activedescendant', activeId);
  options[next].scrollIntoView({ block: 'nearest' });
  return options[next];
}

workspace.addEventListener('pointerdown', (event) => {
  const option = event.target.closest('[data-smart-resource-option]');
  if (option) {
    // A delayed search-focus retry must never steal focus between pointerdown
    // and click, otherwise the user's first option click is silently lost.
    smartResourceSearchFocusIntent = null;
    if (event.pointerType !== 'touch' && event.button === 0) event.preventDefault();
    return;
  }
  const trigger = event.target.closest('[data-action="toggle-smart-resource"]');
  if (!trigger || event.button !== 0) return;
  // Prevent the pointer's default button focus from overriding the search
  // focus assigned by the following click handler.
  event.preventDefault();
});

workspace.addEventListener('click', async (event) => {
  const trigger = event.target.closest('[data-action="toggle-smart-resource"]');
  if (trigger) {
    const root = trigger.closest('[data-smart-resource-picker]');
    if (!root || trigger.disabled) return;
    const open = !root.classList.contains('is-open');
    if (open) {
      smartResourceSearchFocusIntent = {
        kind: root.dataset.resourceKind,
        clientId: root.dataset.clientId
      };
    }
    closeSmartResourcePickers(open ? root : null);
    root.classList.toggle('is-open', open);
    trigger.setAttribute('aria-expanded', String(open));
    root.querySelector('.smart-resource-panel')?.setAttribute('aria-hidden', String(!open));
    if (open) {
      positionFloatingDropdown(root);
      const search = root.querySelector('[data-smart-resource-search]');
      if (search) {
        search.value = '';
        filterSmartResourcePicker(root, '');
        focusDropdownSearch(root, '[data-smart-resource-search]');
        maintainIntendedSmartResourceSearchFocus();
      }
    } else {
      trigger.focus({ preventScroll: true });
    }
    return;
  }
  const option = event.target.closest('[data-smart-resource-option]');
  if (!option) return;
  const root = option.closest('[data-smart-resource-picker]');
  const input = root?.querySelector('[data-resource-combobox]');
  if (!root || !input) return;
  smartResourceSearchFocusIntent = null;
  const selectedValue = option.dataset.value ?? '';
  input.value = selectedValue;
  root.classList.remove('is-open');
  root.querySelector('[data-action="toggle-smart-resource"]')?.setAttribute('aria-expanded', 'false');
  root.querySelector('.smart-resource-panel')?.setAttribute('aria-hidden', 'true');
  const selection = handleResourceComboboxChange(input, selectedValue);
  focusRenderedSmartResourceTrigger(input);
  await selection;
});

workspace.addEventListener('input', (event) => {
  const search = event.target.closest('[data-smart-resource-search]');
  if (!search) return;
  const root = search.closest('[data-smart-resource-picker]');
  if (root) filterSmartResourcePicker(root, search.value);
});

workspace.addEventListener('input', (event) => {
  const search = event.target.closest('[data-template-card-search]');
  if (!search) return;
  const dropdown = search.closest('[data-template-card-dropdown]');
  const grid = dropdown?.querySelector('.template-card-grid');
  let visible = 0;
  const items = [...(dropdown?.querySelectorAll('.template-choice-wrap') ?? [])];
  const ranked = items.map((item, index) => ({
    item,
    index: Number(item.dataset.searchOrder ?? index),
    score: expandableSearchScore(`${item.querySelector('[data-template-id]')?.dataset.templateId ?? ''} ${item.textContent ?? ''}`, search.value)
  }));
  ranked.forEach(({ item, index }) => { item.dataset.searchOrder = String(index); });
  ranked.sort((left, right) => search.value.trim() ? right.score - left.score || left.index - right.index : left.index - right.index);
  ranked.forEach(({ item, score }) => {
    item.hidden = score < 0;
    if (score >= 0) visible += 1;
    grid?.append(item);
  });
  dropdown?.querySelector('[data-template-card-empty-search]')?.classList.toggle('is-hidden', visible > 0);
});

workspace.addEventListener('keydown', (event) => {
  const root = event.target.closest('[data-smart-resource-picker]');
  if (!root) return;
  if (event.key === 'Tab') {
    smartResourceSearchFocusIntent = null;
    closeSmartResourcePickers();
    return;
  }
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    moveSmartResourceSelection(root, event.key === 'ArrowDown' ? 1 : -1);
    return;
  }
  if (event.key === 'Enter') {
    const options = visibleSmartResourceOptions(root);
    const activeIndex = Number.parseInt(root.dataset.smartResourceActiveIndex ?? '-1', 10);
    const option = options[activeIndex];
    if (option) {
      event.preventDefault();
      option.click();
    }
    return;
  }
  if (event.key === 'Escape') {
    event.preventDefault();
    closeSmartResourcePickers();
    root.querySelector('[data-action="toggle-smart-resource"]')?.focus();
  }
});

document.addEventListener('pointerdown', (event) => {
  if (!event.target.closest('[data-expand-select]')) closeExpandableSelects();
  if (!event.target.closest('[data-age-dropdown]')) closeAgeDropdowns();
  if (!event.target.closest('[data-datetime-picker]')) closeDateTimePickers();
  if (!event.target.closest('[data-template-card-dropdown]')) closeTemplateDropdowns();
});

workspace.addEventListener('toggle', (event) => {
  const root = event.target.closest?.('[data-template-card-dropdown]');
  if (!root) return;
  if (!root.open) {
    root.classList.remove('is-dropup');
    return;
  }
  closeTemplateDropdowns(root);
  queueMicrotask(() => positionFloatingDropdown(root));
  focusDropdownSearch(root, '[data-template-card-search]');
}, true);

document.addEventListener('scroll', (event) => {
  const target = event.target instanceof Element ? event.target : null;
  if (target?.closest('.expand-select-expand, .smart-resource-panel, .age-panel, .template-card-dropdown-panel, .dt-panel')) return;
  closeAllFloatingDropdowns();
}, true);

window.addEventListener('resize', closeAllFloatingDropdowns);
