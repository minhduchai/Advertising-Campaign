import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { dirname, resolve, win32 } from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { decryptToken, encryptToken, signSession, verifySession } from './crypto.js';
import { readBuffer, readFormData, readJson, sendJson, sendPublicFile } from './http.js';
import { publicCatalogPage } from './page-catalog.js';
import { validateDraft } from './draft.js';
import { validateConversation } from './conversation.js';
import { normalizeMetaConversationVariables } from '../public/conversation.js';
import { publishDraft } from './publisher.js';
import { MAX_MEDIA_BYTES } from './media-store.js';
import { acceptsRunStream, startRunStream, writeRunEvent } from './run-stream.js';
import { createRunExecutionDraft, createRunSnapshot } from './run-report.js';
import { syncRunPublications } from './publication-sync.js';
import { tickCommentUnhide } from './comment-unhide-scheduler.js';
import { reconcileWorkflowSeeding } from './workflow-seeding-finalize.js';
import {
  MAX_SEEDING_IMAGE_BYTES,
  normalizeSeedingTemplateInput,
  SEEDING_IMAGE_TYPES
} from './seeding-template.js';
import {
  createSeedingState,
  prepareRunSeeding,
  processNextSeedingJob,
  resolveSeedingConflict
} from './seeding-service.js';

const SESSION_COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
import {
  SHARED_CONVERSATION_OWNER_ID,
  SHARED_CONVERSATION_PAGE_ID
} from './shared-conversation-library.js';
import { validateAudienceTemplate } from './audience-template.js';
import { normalizeCampaignPresetInput } from './campaign-preset.js';
import { verifyWorkflowRequest, workflowAuthInput, WORKFLOW_MAX_CLOCK_SKEW_MS } from './workflow-auth.js';
import {
  createWorkflowExecutionPlan,
  workflowStepLogLine,
  WORKFLOW_PUBLISH_BATCH_SIZE,
  WORKFLOW_PUBLICATION_BATCH_SIZE,
  WORKFLOW_SEEDING_BATCH_SIZE
} from './workflow-plan.js';
import { prepareWorkflowMedia } from './workflow-media.js';
import { createWorkflowDispatcher } from './workflow-dispatcher.js';
import { createTelegramUploadAuth } from './telegram-upload-auth.js';
import { createMetaRequestCache } from './meta-request-cache.js';
import { createAddressGeocoder } from './address-geocoder.js';

const projectDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const publicDirectory = resolve(projectDirectory, 'public');
const publicFiles = new Set(['/draft-storage.js', '/app.css', '/launch-control.css', '/app.js', '/api.js', '/api-client.js', '/activity-history.js', '/audience.js', '/conversation.js', '/local-demo-resources.js', '/run-progress.js', '/seeding.js', '/seeding-runner.js', '/state.js', '/telegram-upload-client.js', '/theme.js', '/website-tracking.js', '/workspace.js', '/workspace-progress.js', '/workspace-view.js']);
publicFiles.add('/launch-preview.js');
publicFiles.add('/quick-create.js');
publicFiles.add('/quick-create.css');
publicFiles.add('/launch-preview.css');
publicFiles.add('/launch-concept.css');
publicFiles.add('/location-map.js');
publicFiles.add('/assets/lg-clinic-logo-128.png');
publicFiles.add('/assets/lg-clinic-logo.png');
publicFiles.add('/favicon.ico');
publicFiles.add('/terms.html');
publicFiles.add('/privacy.html');
publicFiles.add('/data-deletion.html');
publicFiles.add('/vendor/leaflet/leaflet.js');
publicFiles.add('/vendor/leaflet/leaflet.css');
const maxLocalMediaRequestBytes = MAX_MEDIA_BYTES + 1024 * 1024;
export const PUBLISH_DEADLINE_MS = 240_000;
// Cloudflare Workflow cắt fetch sang application server ở ~100s (524), nên mỗi bước phải trả về trước đó:
// không bắt đầu node mới sau SOFT, hủy hẳn ở HARD.
export const WORKFLOW_STEP_SOFT_DEADLINE_MS = 45_000;
export const WORKFLOW_STEP_HARD_DEADLINE_MS = 95_000;
const META_RESOURCE_TTL_MS = 15 * 60_000;
const META_ACCOUNT_RESOURCE_TTL_MS = 10 * 60_000;
const META_SEARCH_TTL_MS = 30 * 60_000;
const ADDRESS_SEARCH_TTL_MS = 24 * 60 * 60_000;
const WORKFLOW_LEASE_TTL_MS = 10 * 60_000;
const TELEGRAM_UPLOAD_JOB_TTL_MS = 6 * 60 * 60_000;
const TELEGRAM_UPLOAD_JOB_LEASE_MS = 2 * 60 * 60_000;

export function clampPublishDeadlineMs(value) {
  const milliseconds = Number(value);
  if (!Number.isFinite(milliseconds)) return PUBLISH_DEADLINE_MS;
  return Math.min(PUBLISH_DEADLINE_MS, Math.max(0, milliseconds));
}

export function isLocalMediaRequestTooLarge(contentLength) {
  return Number.isFinite(contentLength) && contentLength > maxLocalMediaRequestBytes;
}

export function createRequestHandler({ config, metaClient, db, mediaStore, addressGeocoder = createAddressGeocoder(config) }) {
  const workflowDispatcher = createWorkflowDispatcher({ config });
  const telegramUploadAuth = createTelegramUploadAuth({
    secret: config.sessionSecret,
    ttlMs: TELEGRAM_UPLOAD_JOB_TTL_MS
  });
  const metaRequestCache = createMetaRequestCache();
  return async function handleRequest(request, response) {
    const url = new URL(request.url, 'http://localhost');
    if (url.pathname === '/api/health') url.pathname = '/health';

    try {
      if (url.pathname === '/health') {
        sendJson(response, 200, { ok: true });
        return;
      }

      if (publicFiles.has(url.pathname)) {
        await sendPublicFile(response, publicDirectory, url.pathname.slice(1));
        return;
      }

      if (url.pathname.startsWith('/api/internal/workflow/')) {
        await handleInternalWorkflowRoute({
          request, response, url, config, db, metaClient, mediaStore, metaRequestCache
        });
        return;
      }

      if (url.pathname === '/api/telegram-upload/jobs/claim' && request.method === 'POST') {
        if (!authenticateTelegramWorkerRequest(request, config.telegramUploadWorkerSecret)) {
          return sendJson(response, 401, { error: 'Telegram worker không hợp lệ' });
        }
        const now = Date.now();
        const job = await db.claimNextTelegramUploadJob({
          now,
          leaseToken: randomBytes(24).toString('base64url'),
          leaseExpiresAt: now + TELEGRAM_UPLOAD_JOB_LEASE_MS
        });
        if (!job) {
          response.writeHead(204);
          response.end();
          return;
        }
        sendJson(response, 200, {
          jobId: job.id,
          mediaId: job.mediaId,
          path: job.networkPath,
          code: job.intentCode,
          leaseToken: job.leaseToken,
          expiresAt: job.expiresAt
        });
        return;
      }

      if (url.pathname === '/api/telegram-upload/jobs/result' && request.method === 'POST') {
        if (!authenticateTelegramWorkerRequest(request, config.telegramUploadWorkerSecret)) {
          return sendJson(response, 401, { error: 'Telegram worker không hợp lệ' });
        }
        const input = await readJson(request);
        if (!input?.jobId || !input?.leaseToken || !['completed', 'failed'].includes(input?.status)) {
          return sendJson(response, 400, { error: 'Kết quả job không hợp lệ' });
        }
        const job = await db.finishTelegramUploadJob({
          id: String(input.jobId),
          leaseToken: String(input.leaseToken),
          status: input.status,
          errorMessage: input.status === 'failed'
            ? String(input.error ?? 'Máy công ty không thể tải file').slice(0, 500)
            : null
        });
        if (!job) return sendJson(response, 409, { error: 'Job đã hết lease hoặc đã được xử lý' });
        sendJson(response, 200, { ok: true, jobId: job.id, status: job.status });
        return;
      }

      if (url.pathname === '/api/telegram-upload/jobs/progress' && request.method === 'POST') {
        if (!authenticateTelegramWorkerRequest(request, config.telegramUploadWorkerSecret)) {
          return sendJson(response, 401, { error: 'Telegram worker không hợp lệ' });
        }
        const input = await readJson(request);
        const uploadedBytes = Number(input?.uploadedBytes);
        const totalBytes = Number(input?.totalBytes);
        if (
          !input?.jobId
          || !input?.leaseToken
          || !Number.isSafeInteger(uploadedBytes)
          || !Number.isSafeInteger(totalBytes)
          || uploadedBytes < 0
          || totalBytes < 1
          || totalBytes > MAX_MEDIA_BYTES
          || uploadedBytes > totalBytes
        ) {
          return sendJson(response, 400, { error: 'Tiến độ job không hợp lệ' });
        }
        const now = Date.now();
        const job = await db.updateTelegramUploadJobProgress({
          id: String(input.jobId),
          leaseToken: String(input.leaseToken),
          uploadedBytes,
          totalBytes,
          now,
          leaseExpiresAt: now + TELEGRAM_UPLOAD_JOB_LEASE_MS
        });
        if (!job) return sendJson(response, 409, { error: 'Job đã hết lease hoặc đã được xử lý' });
        sendJson(response, 200, {
          ok: true,
          jobId: job.id,
          ...telegramUploadProgress(job)
        });
        return;
      }

      const telegramMultipartAction = matchTelegramUploadMultipartRoute(url.pathname);
      if (telegramMultipartAction && request.method === 'POST') {
        await handleTelegramR2Multipart({
          request,
          response,
          mediaStore,
          action: telegramMultipartAction,
          telegramUploadAuth,
          allowedMetaUserIds: config.telegramUploadAllowedMetaUserIds
        });
        return;
      }

      const session = await getOrCreateSession(request, response, config, db);

      if (url.pathname === '/api/auth/session' && request.method === 'GET') {
        const connection = session.metaUserId ? await db.getConnection(session.metaUserId) : null;
        sendJson(response, 200, {
          connected: Boolean(connection),
          metaUser: connection ? {
            id: session.metaUserId,
            name: session.metaUserName ?? connection.metaUserName ?? ''
          } : null
        });
        return;
      }

      if (url.pathname === '/api/telegram-upload/intent' && request.method === 'POST') {
        if (!session.metaUserId) return sendJson(response, 401, { error: 'Connect Meta first' });
        if (!canUseTelegramNetworkUpload(config, session.metaUserId)) {
          return sendJson(response, 403, { error: 'Tính năng thử nghiệm chưa được cấp cho tài khoản này' });
        }
        if (!mediaStore.r2) return sendJson(response, 404, { enabled: false });
        const intent = telegramUploadAuth.createIntent(session.metaUserId);
        const startParameter = `app_${intent.code}`;
        sendJson(response, 201, {
          mediaId: intent.mediaId,
          expiresAt: intent.expiresAt,
          deepLink: `https://t.me/${config.telegramBotUsername}?start=${startParameter}`
        });
        return;
      }

      if (url.pathname === '/api/telegram-upload/path-jobs' && request.method === 'POST') {
        if (!session.metaUserId) return sendJson(response, 401, { error: 'Connect Meta first' });
        if (!canUseTelegramNetworkUpload(config, session.metaUserId)) {
          return sendJson(response, 403, { error: 'Tính năng thử nghiệm chưa được cấp cho tài khoản này' });
        }
        if (!mediaStore.r2) return sendJson(response, 404, { enabled: false });
        if (!config.telegramUploadWorkerSecret) {
          return sendJson(response, 503, { error: 'Bot máy công ty chưa được kết nối với ứng dụng' });
        }
        const input = await readJson(request);
        const networkPath = normalizeTelegramNetworkPath(input?.path, config.telegramFileRoot);
        if (!networkPath) {
          return sendJson(response, 400, {
            error: `Chỉ nhận đường dẫn file ảnh hoặc video trong ${config.telegramFileRoot}`
          });
        }
        const intent = telegramUploadAuth.createIntent(session.metaUserId);
        const job = await db.createTelegramUploadJob({
          id: randomBytes(16).toString('hex'),
          ownerMetaUserId: session.metaUserId,
          mediaId: intent.mediaId,
          networkPath,
          intentCode: intent.code,
          expiresAt: intent.expiresAt
        });
        sendJson(response, 201, {
          jobId: job.id,
          mediaId: job.mediaId,
          expiresAt: job.expiresAt,
          status: job.status
        });
        return;
      }

      if (url.pathname === '/api/telegram-upload/status' && request.method === 'GET') {
        if (!session.metaUserId) return sendJson(response, 401, { error: 'Connect Meta first' });
        if (!canUseTelegramNetworkUpload(config, session.metaUserId)) {
          return sendJson(response, 403, { error: 'Tính năng thử nghiệm chưa được cấp cho tài khoản này' });
        }
        const mediaId = String(url.searchParams.get('mediaId') ?? '');
        if (!/^[a-f0-9]{32}$/.test(mediaId)) return sendJson(response, 400, { error: 'Media ID không hợp lệ' });
        const media = await db.getMedia(session.metaUserId, mediaId);
        if (!media) {
          const job = db.getTelegramUploadJobByMedia
            ? await db.getTelegramUploadJobByMedia(session.metaUserId, mediaId)
            : null;
          if (job?.status === 'failed') {
            return sendJson(response, 200, {
              status: 'failed',
              mediaId,
              error: job.errorMessage || 'Máy công ty không thể tải file'
            });
          }
          if (job && job.expiresAt <= Date.now()) {
            return sendJson(response, 200, { status: 'expired', mediaId });
          }
          return sendJson(response, 200, {
            status: job?.status ?? 'waiting',
            mediaId,
            ...telegramUploadProgress(job)
          });
        }
        sendJson(response, 200, {
          status: 'completed',
          mediaId: media.id,
          id: media.id,
          name: media.name,
          mimeType: media.mimeType,
          size: media.sizeBytes,
          sizeBytes: media.sizeBytes,
          uploadedBytes: media.sizeBytes,
          totalBytes: media.sizeBytes,
          percentage: 100
        });
        return;
      }

      if (url.pathname === '/api/r2-media/presign' && request.method === 'POST') {
        await handleR2Presign({ request, response, session, mediaStore });
        return;
      }

      if (url.pathname === '/api/r2-media/complete' && request.method === 'POST') {
        await handleR2Complete({ request, response, session, mediaStore });
        return;
      }

      const r2MultipartAction = matchR2MultipartRoute(url.pathname);
      if (r2MultipartAction && request.method === 'POST') {
        await handleR2Multipart({ request, response, session, mediaStore, action: r2MultipartAction });
        return;
      }

      if (url.pathname === '/') {
        await sendPublicFile(response, publicDirectory, 'index.html');
        return;
      }

      if (url.pathname === '/api/auth/meta/start') {
        const state = randomBytes(32).toString('base64url');
        await db.createOAuthState(session.id, state);
        sendRedirect(response, metaClient.createAuthorizationUrl(state));
        return;
      }

      if (url.pathname === '/api/auth/meta/callback') {
        await handleOAuthCallback({ url, response, session, db, config, metaClient, metaRequestCache });
        return;
      }

      if (url.pathname === '/api/auth/meta/disconnect' && request.method === 'POST') {
        const metaUserId = session.metaUserId;
        if (metaUserId) {
          await db.disconnectMetaUser(session.id, metaUserId);
          metaRequestCache.invalidatePrefix(`user:${metaUserId}:`);
        }
        sendJson(response, 200, { connected: false });
        return;
      }

      if (url.pathname === '/api/resources') {
        await handleResourceDiscovery({ response, session, db, config, metaClient, metaRequestCache });
        return;
      }

      if (url.pathname === '/api/ad-account-resources' && request.method === 'GET') {
        await handleAdAccountResources({ url, response, session, db, config, metaClient, metaRequestCache });
        return;
      }

      if (url.pathname === '/api/targeting-search' && request.method === 'GET') {
        await handleTargetingSearch({ url, response, session, db, config, metaClient, metaRequestCache });
        return;
      }

      if (url.pathname === '/api/location-search' && request.method === 'GET') {
        await handleLocationSearch({ url, response, session, db, config, metaClient, metaRequestCache, addressGeocoder });
        return;
      }

      if (url.pathname === '/api/conversation-templates') {
        await handleConversationTemplateCollection({ request, response, session, db });
        return;
      }

      if (url.pathname === '/api/audience-templates') {
        await handleAudienceTemplateCollection({ request, response, session, db });
        return;
      }

      const audienceTemplateRoute = matchAudienceTemplateRoute(url.pathname);
      if (audienceTemplateRoute) {
        if (audienceTemplateRoute.malformed) {
          sendJson(response, 404, { error: 'Not found' });
          return;
        }
        await handleAudienceTemplateItem({
          request,
          response,
          session,
          db,
          ...audienceTemplateRoute
        });
        return;
      }

      const conversationTemplateRoute = matchConversationTemplateRoute(url.pathname);
      if (conversationTemplateRoute) {
        if (conversationTemplateRoute.malformed) {
          sendJson(response, 404, { error: 'Not found' });
          return;
        }
        await handleConversationTemplateItem({
          request,
          response,
          session,
          db,
          ...conversationTemplateRoute
        });
        return;
      }

      if (url.pathname === '/api/seeding-templates') {
        await handleSeedingTemplateCollection({ request, response, session, db, mediaStore });
        return;
      }

      if (url.pathname === '/api/campaign-presets') {
        await handleCampaignPresetCollection({ request, response, session, db });
        return;
      }

      const seedingTemplateRoute = matchSeedingTemplateRoute(url.pathname);
      if (seedingTemplateRoute) {
        if (seedingTemplateRoute.malformed) {
          sendJson(response, 404, { error: 'Not found' });
          return;
        }
        await handleSeedingTemplateItem({
          request,
          response,
          session,
          db,
          mediaStore,
          ...seedingTemplateRoute
        });
        return;
      }

      const campaignPresetRoute = matchCampaignPresetRoute(url.pathname);
      if (campaignPresetRoute) {
        if (campaignPresetRoute.malformed) {
          sendJson(response, 404, { error: 'Not found' });
          return;
        }
        await handleCampaignPresetItem({
          request,
          response,
          session,
          db,
          ...campaignPresetRoute
        });
        return;
      }

      if (url.pathname === '/api/media' && request.method === 'POST') {
        if (config.mediaUploadMode !== 'local') {
          sendJson(response, 404, { error: 'Not found' });
          return;
        }
        await handleMediaUpload({ request, response, session, mediaStore });
        return;
      }

      const mediaPreviewRoute = matchMediaPreviewRoute(url.pathname);
      if (mediaPreviewRoute && request.method === 'GET') {
        if (mediaPreviewRoute.malformed) {
          sendJson(response, 404, { error: 'Not found' });
          return;
        }
        await handleMediaPreview({ response, session, mediaStore, mediaId: mediaPreviewRoute.mediaId });
        return;
      }

      if (url.pathname === '/api/drafts/validate' && request.method === 'POST') {
        const draft = await readJson(request, session.metaUserId ? undefined : 256 * 1024);
        const errors = validateDraft(draft);
        sendJson(response, errors.length > 0 ? 422 : 200, {
          valid: errors.length === 0,
          errors
        });
        return;
      }

      if (url.pathname === '/api/runs') {
        if (request.method === 'GET') {
          await handleRunList({ url, response, session, db });
          return;
        }
        if (request.method === 'POST') {
          await handleRunCreation({ request, response, session, db, config, metaClient, mediaStore, workflowDispatcher });
          return;
        }
      }

      const runSeedingRoute = matchRunSeedingRoute(url.pathname);
      if (runSeedingRoute) {
        if (runSeedingRoute.malformed) {
          sendJson(response, 404, { error: 'Not found' });
          return;
        }
        await handleRunSeedingRoute({
          request,
          response,
          session,
          db,
          config,
          metaClient,
          mediaStore,
          metaRequestCache,
          ...runSeedingRoute
        });
        return;
      }

      const publicationRefreshRoute = matchRunPublicationRefreshRoute(url.pathname);
      if (publicationRefreshRoute && request.method === 'POST') {
        if (publicationRefreshRoute.malformed) {
          sendJson(response, 404, { error: 'Not found' });
          return;
        }
        await handleRunPublicationRefresh({
          response,
          session,
          db,
          config,
          metaClient,
          runId: publicationRefreshRoute.runId
        });
        return;
      }

      const adRetryRoute = matchRunAdRetryRoute(url.pathname);
      if (adRetryRoute) {
        if (request.method !== 'POST') {
          sendJson(response, 405, { error: 'Phương thức không được hỗ trợ' });
          return;
        }
        await handleRunAdRetry({
          response,
          session,
          db,
          config,
          metaClient,
          mediaStore,
          workflowDispatcher,
          ...adRetryRoute
        });
        return;
      }

      const workflowResumeRoute = matchRunWorkflowResumeRoute(url.pathname);
      if (workflowResumeRoute && request.method === 'POST') {
        await handleRunWorkflowResume({
          response, session, db, workflowDispatcher, runId: workflowResumeRoute.runId
        });
        return;
      }

      const runReadRoute = matchRunReadRoute(url.pathname);
      if (runReadRoute && request.method === 'GET') {
        if (runReadRoute.malformed) {
          sendJson(response, 404, { error: 'Not found' });
          return;
        }
        await handleRunRead({ response, session, db, runId: runReadRoute.runId });
        return;
      }

      if (url.pathname.startsWith('/api/')) {
        sendJson(response, 404, { error: 'Not found' });
        return;
      }

      sendJson(response, 404, { error: 'Not found' });
    } catch (error) {
      const errorReference = randomBytes(6).toString('hex');
      console.error(`[api:${errorReference}] ${request.method} ${url.pathname}`, error);
      if (response.headersSent) {
        if (!response.writableEnded) response.end();
        return;
      }
      sendApiError(response, error);
    }
  }
}

async function handleOAuthCallback({ url, response, session, db, config, metaClient, metaRequestCache }) {
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  if (!code || !state) {
    sendJson(response, 400, { error: 'Missing OAuth code or state' });
    return;
  }

  const storedState = await db.consumeOAuthState(state);
  if (!storedState || storedState.sessionId !== session.id) {
    sendJson(response, 400, { error: 'Invalid or expired OAuth state' });
    return;
  }

  const { accessToken } = await metaClient.exchangeCode(code);
  const profile = await metaClient.getProfile(accessToken);
  await db.upsertConnection({
    metaUserId: profile.id,
    metaUserName: profile.name,
    accessTokenCiphertext: encryptToken(accessToken, config.tokenEncryptionKey)
  });
  await db.attachMetaUser(session.id, profile);
  metaRequestCache.invalidatePrefix(`user:${profile.id}:`);
  sendRedirect(response, '/?connected=1');
}

async function handleResourceDiscovery({ response, session, db, config, metaClient, metaRequestCache }) {
  if (!session.metaUserId) {
    sendJson(response, 401, { error: 'Connect Meta first' });
    return;
  }

  const connection = await db.getConnection(session.metaUserId);
  if (!connection) {
    sendJson(response, 401, { error: 'Connect Meta first' });
    return;
  }

  const token = decryptToken(connection.accessTokenCiphertext, config.tokenEncryptionKey);
  const { adAccounts, pageCatalog, permissions } = await metaRequestCache.load(
    `user:${session.metaUserId}:resources`,
    META_RESOURCE_TTL_MS,
    async () => {
      const [adAccounts, pageCatalog, permissions] = await Promise.all([
        metaClient.listAdAccounts(token),
        metaClient.listGlobalPageCatalog(token),
        metaClient.getPermissionStatus(token, ['pages_manage_engagement'])
      ]);
      return { adAccounts, pageCatalog, permissions };
    }
  );
  sendJson(response, 200, {
    connected: true,
    metaUser: {
      id: session.metaUserId,
      name: session.metaUserName ?? connection.metaUserName ?? ''
    },
    adAccounts,
    pages: pageCatalog.pages.map(publicCatalogPage),
    pageDiscovery: pageCatalog.discovery,
    mediaUploadMode: config.mediaUploadMode,
    capabilities: {
      pagesManageEngagement: permissions.pages_manage_engagement === true,
      telegramNetworkUpload: canUseTelegramNetworkUpload(config, session.metaUserId)
    }
  });
}

async function handleAdAccountResources({ url, response, session, db, config, metaClient, metaRequestCache }) {
  const connection = await getConnectedMetaConnection({ response, session, db });
  if (!connection) {
    return;
  }

  const adAccountId = url.searchParams.get('adAccountId');
  if (!isAdAccountId(adAccountId)) {
    sendJson(response, 400, { error: 'Tài khoản quảng cáo không hợp lệ' });
    return;
  }

  const token = decryptToken(connection.accessTokenCiphertext, config.tokenEncryptionKey);
  const { customAudiences, savedAudiences, promotablePages, pageEligibilityKnown, pixels, pixelsLoaded } = await metaRequestCache.load(
    `user:${session.metaUserId}:account:${adAccountId}`,
    META_ACCOUNT_RESOURCE_TTL_MS,
    async () => {
      const [customAudiences, savedAudiences, promotablePageResult, pixelResult] = await Promise.all([
        metaClient.listCustomAudiences(token, adAccountId),
        metaClient.listSavedAudiences(token, adAccountId),
        typeof metaClient.listPromotablePages === 'function'
          ? metaClient.listPromotablePages(token, adAccountId)
            .then((pages) => ({ pages, known: true }))
            .catch(() => ({ pages: [], known: false }))
          : Promise.resolve({ pages: [], known: false }),
        typeof metaClient.listPixels === 'function'
          ? metaClient.listPixels(token, adAccountId)
            .then((items) => ({ items, loaded: true }))
            .catch(() => ({ items: [], loaded: false }))
          : Promise.resolve({ items: [], loaded: false })
      ]);
      return {
        customAudiences,
        savedAudiences,
        promotablePages: promotablePageResult.pages,
        pageEligibilityKnown: promotablePageResult.known,
        pixels: pixelResult.items,
        pixelsLoaded: pixelResult.loaded
      };
    }
  );
  sendJson(response, 200, {
    customAudiences,
    savedAudiences,
    promotablePageIds: promotablePages.map((page) => String(page.id)),
    pageEligibilityKnown,
    pixels,
    pixelsLoaded
  });
}

async function handleTargetingSearch({ url, response, session, db, config, metaClient, metaRequestCache }) {
  const connection = await getConnectedMetaConnection({ response, session, db });
  if (!connection) {
    return;
  }

  const adAccountId = url.searchParams.get('adAccountId');
  if (!isAdAccountId(adAccountId)) {
    sendJson(response, 400, { error: 'Tài khoản quảng cáo không hợp lệ' });
    return;
  }

  const category = url.searchParams.get('category');
  if (!new Set(['interest', 'behavior', 'demographic']).has(category)) {
    sendJson(response, 400, { error: 'Loại nhắm mục tiêu không được hỗ trợ' });
    return;
  }

  const query = url.searchParams.get('query')?.trim() ?? '';
  if (query.length < 2) {
    sendJson(response, 400, { error: 'Nhập ít nhất 2 ký tự để tìm kiếm' });
    return;
  }

  const token = decryptToken(connection.accessTokenCiphertext, config.tokenEncryptionKey);
  const normalizedQuery = normalizeMetaSearchQuery(query);
  const results = await metaRequestCache.load(
    `user:${session.metaUserId}:targeting:${category}:${normalizedQuery}`,
    META_SEARCH_TTL_MS,
    () => metaClient.searchTargeting(token, { category, query })
  );
  sendJson(response, 200, { results });
}

async function handleLocationSearch({ url, response, session, db, config, metaClient, metaRequestCache, addressGeocoder }) {
  const connection = await getConnectedMetaConnection({ response, session, db });
  if (!connection) {
    return;
  }

  const adAccountId = url.searchParams.get('adAccountId');
  if (!isAdAccountId(adAccountId)) {
    sendJson(response, 400, { error: 'Tài khoản quảng cáo không hợp lệ' });
    return;
  }

  const query = url.searchParams.get('query')?.trim() ?? '';
  if (query.length < 2) {
    sendJson(response, 400, { error: 'Nhập ít nhất 2 ký tự để tìm vị trí' });
    return;
  }
  if (query.length > 250) {
    sendJson(response, 400, { error: 'Nhập tối đa 250 ký tự để tìm vị trí' });
    return;
  }

  const token = decryptToken(connection.accessTokenCiphertext, config.tokenEncryptionKey);
  const normalizedQuery = normalizeMetaSearchQuery(query);
  const metaSearch = metaRequestCache.load(
    `user:${session.metaUserId}:locations:${normalizedQuery}`,
    META_SEARCH_TTL_MS,
    () => metaClient.searchLocations(token, query)
  );
  if (url.searchParams.get('includeAddresses') !== '1') {
    sendJson(response, 200, { results: await metaSearch });
    return;
  }

  const [metaResult, addressResult] = await Promise.allSettled([
    metaSearch,
    metaRequestCache.load(
      `addresses:vn:${normalizedQuery}`,
      ADDRESS_SEARCH_TTL_MS,
      () => addressGeocoder.search(query)
    )
  ]);
  const results = [
    ...(metaResult.status === 'fulfilled' ? metaResult.value : []),
    ...(addressResult.status === 'fulfilled' ? addressResult.value : [])
  ];
  const warnings = [
    ...(metaResult.status === 'rejected' ? ['Chưa tải được tỉnh/thành phố từ Meta. Vui lòng tìm lại.'] : []),
    ...(addressResult.status === 'rejected' ? ['Chưa tải được địa chỉ và tên đường. Vui lòng tìm lại.'] : [])
  ];
  if (metaResult.status === 'rejected' && addressResult.status === 'rejected') {
    sendJson(response, 502, { error: 'Không tải được vị trí. Vui lòng thử tìm lại.' });
    return;
  }
  sendJson(response, 200, { results, ...(warnings.length ? { warnings } : {}) });
}

function normalizeMetaSearchQuery(query) {
  return String(query).normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('vi');
}

function cachedPageEngagementContext(cache, metaUserId, metaClient) {
  return (token, pageId) => cache.load(
    `user:${metaUserId}:page-engagement:${pageId}`,
    META_ACCOUNT_RESOURCE_TTL_MS,
    () => metaClient.getPageEngagementContext(token, [pageId])
  );
}

export async function processWorkflowSeedingBatch({ batchSize, processNext, wait = workflowWait }) {
  let processed = 0;
  let latest = { job: null, retryAfterMs: null };
  while (processed < batchSize) {
    latest = await processNext();
    if (!latest.job) {
      if (!Number.isFinite(Number(latest.retryAfterMs)) || Number(latest.retryAfterMs) <= 0) break;
      await wait(Number(latest.retryAfterMs));
      continue;
    }
    processed += 1;
    if (latest.job.status === 'needs_review') break;
    if (processed < batchSize && Number(latest.retryAfterMs) > 0) {
      await wait(Number(latest.retryAfterMs));
    }
  }
  return { ...latest, processed };
}

function workflowWait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function handleConversationTemplateCollection({ request, response, session, db }) {
  if (!['GET', 'POST'].includes(request.method)) {
    sendJson(response, 405, { error: 'Phương thức không được hỗ trợ' });
    return;
  }
  if (!await getConnectedMetaConnection({ response, session, db })) return;
  await claimLegacyTemplateLibrariesWithoutBlocking(db, session.metaUserId);

  if (request.method === 'GET') {
    const templates = (await db.listConversationTemplates(session.metaUserId)).map(publicConversationTemplate);
    sendJson(response, 200, { templates });
    return;
  }

  const input = await readJsonBodyOrRespond(request, response);
  if (!input) return;
  const normalized = normalizeConversationTemplateInput(input);
  if (normalized.errors.length > 0) {
    sendJson(response, 422, { errors: normalized.errors });
    return;
  }
  const template = await db.createConversationTemplate({
    ownerMetaUserId: session.metaUserId,
    pageId: SHARED_CONVERSATION_PAGE_ID,
    name: normalized.name,
    template: normalized.template
  });
  sendJson(response, 201, { template: publicConversationTemplate(template) });
}

async function handleConversationTemplateItem({ request, response, session, db, templateId, action }) {
  const methodAllowed = action
    ? request.method === 'POST'
    : new Set(['PUT', 'DELETE']).has(request.method);
  if (!methodAllowed) {
    sendJson(response, 405, { error: 'Phương thức không được hỗ trợ' });
    return;
  }
  if (!await getConnectedMetaConnection({ response, session, db })) return;
  await claimLegacyTemplateLibrariesWithoutBlocking(db, session.metaUserId);

  const input = await readJsonBodyOrRespond(request, response);
  if (!input) return;
  const existing = await db.getConversationTemplate(session.metaUserId, templateId);
  if (!existing) {
    sendJson(response, 404, { error: 'Không tìm thấy mẫu Cuộc trò chuyện' });
    return;
  }

  if (action === 'default') {
    const template = await db.setDefaultConversationTemplate({
      id: templateId,
      ownerMetaUserId: session.metaUserId,
      pageId: existing.pageId
    });
    sendJson(response, 200, { template: publicConversationTemplate(template) });
    return;
  }

  if (action === 'duplicate') {
    const name = String(input.name ?? `${existing.name} - Bản sao`).trim();
    const normalized = normalizeConversationTemplateInput({ name, template: existing.template });
    if (normalized.errors.length > 0) {
      sendJson(response, 422, { errors: normalized.errors });
      return;
    }
    const template = await db.duplicateConversationTemplate({
      id: templateId,
      ownerMetaUserId: session.metaUserId,
      name
    });
    sendJson(response, 201, { template: publicConversationTemplate(template) });
    return;
  }

  if (request.method === 'DELETE') {
    const deleted = await db.deleteConversationTemplate({
      id: templateId,
      ownerMetaUserId: session.metaUserId
    });
    sendJson(response, deleted ? 200 : 404, deleted
      ? { deleted: true }
      : { error: 'Không tìm thấy mẫu Cuộc trò chuyện' });
    return;
  }

  const normalized = normalizeConversationTemplateInput(input);
  if (normalized.errors.length > 0) {
    sendJson(response, 422, { errors: normalized.errors });
    return;
  }
  const template = await db.updateConversationTemplate({
    id: templateId,
    ownerMetaUserId: session.metaUserId,
    name: normalized.name,
    template: normalized.template
  });
  sendJson(response, 200, { template: publicConversationTemplate(template) });
}


function normalizeConversationTemplateInput(input) {
  const errors = [];
  const name = String(input.name ?? '').trim();
  if (!name) {
    errors.push({ path: 'name', message: 'Nhập tên mẫu Cuộc trò chuyện' });
  } else if (name.length > 120) {
    errors.push({ path: 'name', message: 'Tên mẫu tối đa 120 ký tự' });
  }
  const template = input.template && typeof input.template === 'object'
    ? {
        ...input.template,
        sourceTemplateId: null,
        templateName: name,
        greeting: normalizeMetaConversationVariables(input.template.greeting)
      }
    : input.template;
  errors.push(...validateConversation(template, 'template'));
  return { name, template, errors };
}

function publicConversationTemplate(template) {
  return {
    id: template.id,
    name: template.name,
    template: {
      ...template.template,
      greeting: normalizeMetaConversationVariables(template.template?.greeting)
    },
    isDefault: template.isDefault,
    createdAt: template.createdAt,
    updatedAt: template.updatedAt
  };
}

async function readJsonBodyOrRespond(request, response) {
  try {
    return await readJson(request);
  } catch (error) {
    sendJson(response, error?.statusCode ?? 400, {
      error: error?.statusCode === 413 ? error.message : 'Payload JSON không hợp lệ'
    });
    return undefined;
  }
}

function matchConversationTemplateRoute(pathname) {
  const match = /^\/api\/conversation-templates\/([^/]+)(?:\/(duplicate|default))?$/.exec(pathname);
  if (!match) return null;
  try {
    return { templateId: decodeURIComponent(match[1]), action: match[2] ?? null };
  } catch {
    return { malformed: true };
  }
}

async function handleAudienceTemplateCollection({ request, response, session, db }) {
  if (!['GET', 'POST'].includes(request.method)) {
    sendJson(response, 405, { error: 'Phương thức không được hỗ trợ' });
    return;
  }

  if (!await requireAudienceTemplateMutationAccess({ response, session, db })) return;
  await claimLegacyTemplateLibrariesWithoutBlocking(db, session.metaUserId);
  if (request.method === 'GET') {
    sendJson(response, 200, { templates: await db.listAudienceTemplates(session.metaUserId) });
    return;
  }

  const input = await readJsonBodyOrRespond(request, response);
  if (input === undefined) return;
  const normalized = validateAudienceTemplateOrRespond(input, response);
  if (!normalized) return;
  const result = await runAudienceTemplateMutation(response, () => (
    db.createAudienceTemplate(session.metaUserId, normalized)
  ));
  if (!result.ok) return;
  sendJson(response, 201, { template: result.value });
}

async function handleAudienceTemplateItem({ request, response, session, db, templateId, action }) {
  const methodAllowed = action === 'duplicate'
    ? request.method === 'POST'
    : new Set(['PUT', 'DELETE']).has(request.method);
  if (!methodAllowed) {
    sendJson(response, 405, { error: 'Phương thức không được hỗ trợ' });
    return;
  }
  if (!await requireAudienceTemplateMutationAccess({ response, session, db })) return;
  await claimLegacyTemplateLibrariesWithoutBlocking(db, session.metaUserId);

  if (request.method === 'DELETE') {
    const deleted = await db.deleteAudienceTemplate(session.metaUserId, templateId);
    sendJson(response, deleted ? 200 : 404, deleted
      ? { deleted: true }
      : { error: 'Không tìm thấy mẫu đối tượng' });
    return;
  }

  const input = await readJsonBodyOrRespond(request, response);
  if (input === undefined) return;

  if (action === 'duplicate') {
    const normalized = validateAudienceTemplateOrRespond({ name: input?.name, content: {} }, response);
    if (!normalized) return;
    const result = await runAudienceTemplateMutation(response, () => (
      db.duplicateAudienceTemplate(session.metaUserId, templateId, normalized.name)
    ));
    if (!result.ok) return;
    const template = result.value;
    sendJson(response, template ? 201 : 404, template
      ? { template }
      : { error: 'Không tìm thấy mẫu đối tượng' });
    return;
  }

  const normalized = validateAudienceTemplateOrRespond(input, response);
  if (!normalized) return;
  const result = await runAudienceTemplateMutation(response, () => (
    db.updateAudienceTemplate(session.metaUserId, templateId, normalized)
  ));
  if (!result.ok) return;
  const template = result.value;
  sendJson(response, template ? 200 : 404, template
    ? { template }
    : { error: 'Không tìm thấy mẫu đối tượng' });
}

async function runAudienceTemplateMutation(response, mutation) {
  try {
    return { ok: true, value: await mutation() };
  } catch (error) {
    if (!isAudienceTemplateUniqueNameError(error)) throw error;
    sendJson(response, 400, {
      error: 'Tên mẫu đối tượng đã tồn tại. Vui lòng chọn tên khác.'
    });
    return { ok: false };
  }
}

// The claim is a write transaction; it only matters right after a migration, so do it at most once per 10 min per owner.
const legacyClaimedAt = new WeakMap();
async function claimLegacyTemplateLibrariesWithoutBlocking(db, ownerMetaUserId) {
  if (!db.claimLegacyTemplateLibraries) return;
  const claimedAt = legacyClaimedAt.get(db) ?? legacyClaimedAt.set(db, new Map()).get(db);
  if (Date.now() - (claimedAt.get(ownerMetaUserId) ?? 0) < 10 * 60_000) return;
  try {
    await db.claimLegacyTemplateLibraries(ownerMetaUserId);
    claimedAt.set(ownerMetaUserId, Date.now());
  } catch (error) {
    console.warn('[templates] Không thể chuyển thư viện mẫu cũ; tiếp tục tải thư viện riêng.', error);
  }
}

function isAudienceTemplateUniqueNameError(error) {
  if (error?.code === '23505') return true;
  if (error?.errcode === 2067 && error?.code === 'ERR_SQLITE_ERROR') return true;
  return ['SQLITE_CONSTRAINT', 'SQLITE_CONSTRAINT_UNIQUE'].includes(error?.code)
    && /audience_templates\.name_key/i.test(String(error?.message ?? ''));
}

function validateAudienceTemplateOrRespond(input, response) {
  try {
    return validateAudienceTemplate(input);
  } catch (error) {
    if (error?.code !== 'AUDIENCE_TEMPLATE_VALIDATION') throw error;
    sendJson(response, 400, { error: error.message });
    return null;
  }
}

function matchAudienceTemplateRoute(pathname) {
  const match = /^\/api\/audience-templates\/([^/]+)(?:\/(duplicate))?$/.exec(pathname);
  if (!match) return null;
  try {
    return { templateId: decodeURIComponent(match[1]), action: match[2] ?? null };
  } catch {
    return { malformed: true };
  }
}

async function requireAudienceTemplateMutationAccess({ response, session, db }) {
  if (!session.metaUserId) {
    sendJson(response, 401, { error: 'Connect Meta first' });
    return null;
  }
  const connection = await db.getConnection(session.metaUserId);
  if (!connection) {
    sendJson(response, 403, {
      error: 'Meta connection is no longer available. Reconnect Meta first.'
    });
    return null;
  }
  return connection;
}

async function handleSeedingTemplateCollection({ request, response, session, db, mediaStore }) {
  if (!['GET', 'POST'].includes(request.method)) {
    sendJson(response, 405, { error: 'Phương thức không được hỗ trợ' });
    return;
  }
  if (!await getConnectedMetaConnection({ response, session, db })) return;

  if (request.method === 'GET') {
    const templates = await Promise.all((await db.listSeedingTemplates(session.metaUserId)).map(
      (template) => publicSeedingTemplate({ template, ownerMetaUserId: session.metaUserId, db })
    ));
    sendJson(response, 200, { templates });
    return;
  }

  const input = await readJsonBodyOrRespond(request, response);
  if (input === undefined) return;
  const normalized = await normalizeAndValidateSeedingTemplate({
    input,
    ownerMetaUserId: session.metaUserId,
    db, mediaStore
  });
  if (normalized.errors.length > 0) {
    sendJson(response, 422, { errors: normalized.errors });
    return;
  }
  const template = await db.createSeedingTemplate({
    ownerMetaUserId: session.metaUserId,
    name: normalized.name,
    items: normalized.items
  });
  sendJson(response, 201, {
    template: await publicSeedingTemplate({ template, ownerMetaUserId: session.metaUserId, db })
  });
}

async function handleSeedingTemplateItem({ request, response, session, db, mediaStore, templateId, action }) {
  const methodAllowed = action
    ? request.method === 'POST'
    : new Set(['PUT', 'DELETE']).has(request.method);
  if (!methodAllowed) {
    sendJson(response, 405, { error: 'Phương thức không được hỗ trợ' });
    return;
  }
  if (!await getConnectedMetaConnection({ response, session, db })) return;

  const existing = await db.getSeedingTemplate(session.metaUserId, templateId);
  if (!existing) {
    sendJson(response, 404, { error: 'Không tìm thấy mẫu seeding' });
    return;
  }

  if (request.method === 'DELETE') {
    const deleted = await db.deleteSeedingTemplate(session.metaUserId, templateId);
    sendJson(response, deleted ? 200 : 404, deleted
      ? { deleted: true }
      : { error: 'Không tìm thấy mẫu seeding' });
    return;
  }

  const input = await readJsonBodyOrRespond(request, response);
  if (input === undefined) return;

  if (action === 'duplicate') {
    const normalized = normalizeSeedingTemplateInput({
      name: input && typeof input === 'object'
        ? input.name ?? `${existing.name} - Bản sao`
        : '',
      items: existing.items
    });
    if (normalized.errors.length > 0) {
      sendJson(response, 422, { errors: normalized.errors });
      return;
    }
    const template = await db.duplicateSeedingTemplate({
      ownerMetaUserId: session.metaUserId,
      id: templateId,
      name: normalized.name
    });
    sendJson(response, 201, {
      template: await publicSeedingTemplate({ template, ownerMetaUserId: session.metaUserId, db })
    });
    return;
  }

  const normalized = await normalizeAndValidateSeedingTemplate({
    input,
    ownerMetaUserId: session.metaUserId,
    db, mediaStore
  });
  if (normalized.errors.length > 0) {
    sendJson(response, 422, { errors: normalized.errors });
    return;
  }
  const template = await db.updateSeedingTemplate({
    ownerMetaUserId: session.metaUserId,
    id: templateId,
    name: normalized.name,
    items: normalized.items
  });
  if (!template) {
    sendJson(response, 404, { error: 'Không tìm thấy mẫu seeding' });
    return;
  }
  sendJson(response, 200, {
    template: await publicSeedingTemplate({ template, ownerMetaUserId: session.metaUserId, db })
  });
}

function matchSeedingTemplateRoute(pathname) {
  const match = /^\/api\/seeding-templates\/([^/]+)(?:\/(duplicate))?$/.exec(pathname);
  if (!match) return null;
  try {
    return { templateId: decodeURIComponent(match[1]), action: match[2] ?? null };
  } catch {
    return { malformed: true };
  }
}

async function handleCampaignPresetCollection({ request, response, session, db }) {
  if (!['GET', 'POST'].includes(request.method)) {
    sendJson(response, 405, { error: 'Phương thức không được hỗ trợ' });
    return;
  }
  if (!await getConnectedMetaConnection({ response, session, db })) return;

  if (request.method === 'GET') {
    const presets = (await db.listCampaignPresets(session.metaUserId)).map(publicCampaignPreset);
    sendJson(response, 200, { presets });
    return;
  }

  const input = await readJsonBodyOrRespond(request, response);
  if (input === undefined) return;
  const normalized = normalizeCampaignPresetInput(input);
  normalized.errors.push(...await campaignPresetReferenceErrors({
    db,
    ownerMetaUserId: session.metaUserId,
    content: normalized.content
  }));
  if (normalized.errors.length > 0) {
    sendJson(response, 422, { errors: normalized.errors });
    return;
  }
  const preset = await db.createCampaignPreset({
    ownerMetaUserId: session.metaUserId,
    name: normalized.name,
    content: normalized.content
  });
  sendJson(response, 201, { preset: publicCampaignPreset(preset) });
}

async function handleCampaignPresetItem({ request, response, session, db, presetId }) {
  if (!['PUT', 'DELETE'].includes(request.method)) {
    sendJson(response, 405, { error: 'Phương thức không được hỗ trợ' });
    return;
  }
  if (!await getConnectedMetaConnection({ response, session, db })) return;

  const existing = await db.getCampaignPreset(session.metaUserId, presetId);
  if (!existing) {
    sendJson(response, 404, { error: 'Không tìm thấy cấu hình sẵn' });
    return;
  }

  if (request.method === 'DELETE') {
    const deleted = await db.deleteCampaignPreset(session.metaUserId, presetId);
    sendJson(response, deleted ? 200 : 404, deleted
      ? { deleted: true }
      : { error: 'Không tìm thấy cấu hình sẵn' });
    return;
  }

  const input = await readJsonBodyOrRespond(request, response);
  if (input === undefined) return;
  const normalized = normalizeCampaignPresetInput(input);
  normalized.errors.push(...await campaignPresetReferenceErrors({
    db,
    ownerMetaUserId: session.metaUserId,
    content: normalized.content
  }));
  if (normalized.errors.length > 0) {
    sendJson(response, 422, { errors: normalized.errors });
    return;
  }
  const preset = await db.updateCampaignPreset({
    ownerMetaUserId: session.metaUserId,
    id: presetId,
    name: normalized.name,
    content: normalized.content
  });
  sendJson(response, 200, { preset: publicCampaignPreset(preset) });
}

function matchCampaignPresetRoute(pathname) {
  const match = /^\/api\/campaign-presets\/([^/]+)$/.exec(pathname);
  if (!match) return null;
  try {
    return { presetId: decodeURIComponent(match[1]) };
  } catch {
    return { malformed: true };
  }
}

function publicCampaignPreset(preset) {
  return {
    id: preset.id,
    name: preset.name,
    content: preset.content,
    createdAt: preset.createdAt,
    updatedAt: preset.updatedAt
  };
}

async function campaignPresetReferenceErrors({ db, ownerMetaUserId, content }) {
  const errors = [];
  if (content.seedingTemplateId
    && !await db.getSeedingTemplate(ownerMetaUserId, content.seedingTemplateId)) {
    errors.push({
      path: 'content.seedingTemplateId',
      message: 'Mẫu seeding không tồn tại trong thư viện của bạn'
    });
  }
  if (content.conversationTemplateId
    && !await db.getConversationTemplate(ownerMetaUserId, content.conversationTemplateId)) {
    errors.push({
      path: 'content.conversationTemplateId',
      message: 'Mẫu cuộc trò chuyện không tồn tại trong thư viện của bạn'
    });
  }
  return errors;
}

async function normalizeAndValidateSeedingTemplate({ input, ownerMetaUserId, db, mediaStore }) {
  const normalized = normalizeSeedingTemplateInput(input);
  if (normalized.errors.length > 0) return normalized;

  const mediaIds = [...new Set(normalized.items
    .map(({ imageMediaId }) => imageMediaId)
    .filter(Boolean))];
  const mediaById = new Map(await Promise.all(mediaIds.map(async (mediaId) => [
    mediaId,
    await db.getMedia(ownerMetaUserId, mediaId)
  ])));
  const errors = normalized.items.flatMap((item, index) => {
    if (!item.imageMediaId) return [];
    const media = mediaById.get(item.imageMediaId);
    if (!media || !SEEDING_IMAGE_TYPES.has(media.mimeType) || media.sizeBytes > MAX_SEEDING_IMAGE_BYTES) {
      return [{
        path: `items.${index}.imageMediaId`,
        message: 'Media seeding phải là JPEG, PNG, MP4 hoặc MOV, tối đa 200 MB'
      }];
    }
    return [];
  });
  if (!errors.length && mediaStore?.preserveSeedingMedia) {
    for (const id of mediaIds) await mediaStore.preserveSeedingMedia({ ownerMetaUserId, id });
  }
  return { ...normalized, errors };
}

async function publicSeedingTemplate({ template, ownerMetaUserId, db }) {
  const items = await Promise.all(template.items.map(async (item) => {
    const media = item.imageMediaId
      ? await db.getMedia(ownerMetaUserId, item.imageMediaId)
      : null;
    return {
      id: item.id,
      message: item.message,
      imageMediaId: media ? item.imageMediaId : null,
      imageName: media?.name ?? '',
      imageSize: media?.sizeBytes ?? 0,
      imageMimeType: media?.mimeType ?? '',
      imagePreviewUrl: media ? mediaPreviewPath(media.id) : null
    };
  }));
  return {
    id: template.id,
    name: template.name,
    items,
    createdAt: template.createdAt,
    updatedAt: template.updatedAt
  };
}

function mediaPreviewPath(mediaId) {
  return `/api/media/${encodeURIComponent(mediaId)}/preview`;
}

async function handleMediaUpload({ request, response, session, mediaStore }) {
  if (!session.metaUserId) {
    sendJson(response, 401, { error: 'Connect Meta first' });
    return;
  }

  const contentLength = Number(request.headers['content-length'] ?? 0);
  if (isLocalMediaRequestTooLarge(contentLength)) {
    sendJson(response, 413, { error: 'Tệp vượt giới hạn 500 MB' });
    return;
  }

  const formData = await readFormData(request);
  const file = formData.get('file');
  if (!file || typeof file.arrayBuffer !== 'function') {
    sendJson(response, 400, { error: 'Chọn ảnh hoặc video' });
    return;
  }

  const media = await mediaStore.saveUpload({ ownerMetaUserId: session.metaUserId, file });
  sendJson(response, 201, { mediaId: media.id, kind: file.type.startsWith('image/') ? 'image' : 'video' });
}

function matchMediaPreviewRoute(pathname) {
  const match = /^\/api\/media\/([^/]+)\/preview$/.exec(pathname);
  if (!match) return null;
  try {
    return { mediaId: decodeURIComponent(match[1]) };
  } catch {
    return { malformed: true };
  }
}

async function handleMediaPreview({ response, session, mediaStore, mediaId }) {
  if (!session.metaUserId) {
    sendJson(response, 401, { error: 'Connect Meta first' });
    return;
  }

  let media;
  try {
    media = await mediaStore.getMedia({ ownerMetaUserId: session.metaUserId, id: mediaId });
  } catch {
    sendJson(response, 404, { error: 'Not found' });
    return;
  }

  const previewMimeTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime']);
  if (!media || !previewMimeTypes.has(media.mimeType)) {
    sendJson(response, 404, { error: 'Not found' });
    return;
  }

  if (!media.content && isSafeMediaPreviewUrl(media.sourceUrl)) {
    response.writeHead(302, {
      location: media.sourceUrl,
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff'
    });
    response.end();
    return;
  }

  if (!media.content) {
    sendJson(response, 404, { error: 'Not found' });
    return;
  }

  response.writeHead(200, {
    'content-type': media.mimeType,
    'cache-control': 'private, max-age=300',
    'x-content-type-options': 'nosniff'
  });
  await new Promise((resolve, reject) => {
    Readable.from(media.content)
      .once('error', reject)
      .pipe(response)
      .once('error', reject)
      .once('finish', resolve);
  });
}

function isSafeMediaPreviewUrl(value) {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

function matchRunReadRoute(pathname) {
  const match = pathname.match(/^\/api\/runs\/([^/]+)$/);
  if (!match) return null;
  try {
    return { runId: decodeURIComponent(match[1]) };
  } catch {
    return { malformed: true };
  }
}

function matchRunPublicationRefreshRoute(pathname) {
  const match = pathname.match(/^\/api\/runs\/([^/]+)\/publications\/refresh$/);
  if (!match) return null;
  try {
    return { runId: decodeURIComponent(match[1]) };
  } catch {
    return { malformed: true };
  }
}

function matchRunWorkflowResumeRoute(pathname) {
  const match = pathname.match(/^\/api\/runs\/([^/]+)\/workflow\/resume$/);
  if (!match) return null;
  try {
    return { runId: decodeURIComponent(match[1]) };
  } catch {
    return null;
  }
}

function matchRunAdRetryRoute(pathname) {
  const match = pathname.match(/^\/api\/runs\/([^/]+)\/ads\/([^/]+)\/retry$/);
  if (!match) return null;
  try {
    return {
      runId: decodeURIComponent(match[1]),
      clientId: decodeURIComponent(match[2])
    };
  } catch {
    return null;
  }
}

async function handleRunAdRetry({
  response,
  session,
  db,
  config,
  metaClient,
  mediaStore,
  workflowDispatcher,
  runId,
  clientId
}) {
  const run = await getOwnedRunOrRespond({ response, session, db, runId, execution: true });
  if (!run) return;
  if (!isTerminalRunStatusValue(run.status)) {
    sendJson(response, 409, { error: 'Lượt tạo vẫn đang được xử lý; chưa thể thử lại song song' });
    return;
  }
  const failedNode = run.nodes.find((node) => (
    node.type === 'ad'
    && String(node.clientId) === String(clientId)
    && node.status === 'failed'
    && !node.remoteId
  ));
  const target = findExecutionAd(run.execution, clientId);
  if (!failedNode || !target) {
    sendJson(response, 409, { error: 'Quảng cáo này không ở trạng thái có thể thử tạo lại' });
    return;
  }
  const campaignNode = run.nodes.find((node) => node.clientId === target.campaign.clientId && node.type === 'campaign');
  const adSetNode = run.nodes.find((node) => node.clientId === target.adSet.clientId && node.type === 'adSet');
  if (!campaignNode?.remoteId || !adSetNode?.remoteId) {
    sendJson(response, 409, { error: 'Campaign hoặc nhóm quảng cáo chưa được tạo thành công trên Meta' });
    return;
  }
  const connection = await db.getConnection(session.metaUserId);
  if (!connection) {
    sendJson(response, 401, { error: 'Hãy kết nối lại tài khoản Meta trước khi thử lại' });
    return;
  }

  const workflowToken = randomBytes(24).toString('hex');
  const claimed = await db.claimWorkflowLease(runId, workflowToken, Date.now(), WORKFLOW_LEASE_TTL_MS);
  if (!claimed) {
    sendJson(response, 409, { error: 'Lượt tạo đang được xử lý; không thể thử lại song song' });
    return;
  }

  const pendingNode = {
    clientId: failedNode.clientId,
    parentClientId: failedNode.parentClientId,
    type: 'ad',
    name: failedNode.name,
    status: 'retry_pending',
    error: null
  };
  try {
    await db.updateNodeResult(runId, pendingNode);
    await db.updateRunStatus(runId, 'retrying_ad', null);
    if (workflowDispatcher.enabled) {
      const dispatched = await workflowDispatcher.dispatch(runId, {
        restart: true,
        restartKey: `ad-${randomBytes(6).toString('hex')}`,
        workflowToken
      });
      const updatedRun = await db.getRun(runId);
      sendJson(response, 202, {
        accepted: true,
        run: runResponse(updatedRun, await loadPublicSeedingState(db, session.metaUserId, updatedRun)),
        ...dispatched
      });
      return;
    }

    const token = decryptToken(connection.accessTokenCiphertext, config.tokenEncryptionKey);
    const updatedRun = await retryRunAdLocally({
      runId,
      ownerMetaUserId: session.metaUserId,
      token,
      workflowToken,
      db,
      metaClient,
      mediaStore
    });
    sendJson(response, 200, {
      accepted: true,
      run: runResponse(updatedRun, await loadPublicSeedingState(db, session.metaUserId, updatedRun))
    });
  } catch (error) {
    try { await db.updateNodeResult(runId, failedNode); } catch {}
    try { await db.updateRunStatus(runId, run.status, run.completedAt ?? Date.now()); } catch {}
    try { await db.releaseWorkflowLease(runId, workflowToken); } catch {}
    throw error;
  }
}

function findExecutionAd(execution, clientId) {
  for (const campaign of execution?.campaigns ?? []) {
    for (const adSet of campaign.adSets ?? []) {
      const ad = (adSet.ads ?? []).find((entry) => String(entry.clientId) === String(clientId));
      if (ad) return { campaign, adSet, ad };
    }
  }
  return null;
}

async function retryRunAdLocally({ runId, ownerMetaUserId, token, workflowToken, db, metaClient, mediaStore }) {
  const run = await db.getRun(runId);
  const draft = run.execution;
  const mediaAssets = new Map();
  for (const campaign of draft.campaigns ?? []) {
    for (const adSet of campaign.adSets ?? []) {
      for (const ad of adSet.ads ?? []) {
        if (!ad.mediaAsset) continue;
        mediaAssets.set(ad.mediaId, {
          id: ad.mediaId,
          ownerMetaUserId,
          name: ad.mediaAsset.name ?? ad.mediaFileName ?? '',
          mimeType: ad.mediaAsset.mimeType ?? (ad.mediaAsset.kind === 'video' ? 'video/mp4' : 'image/jpeg'),
          sizeBytes: Number(ad.mediaAsset.sizeBytes) || 0,
          ...(ad.mediaAsset.imageHash ? { metaImageHash: ad.mediaAsset.imageHash } : {}),
          ...(ad.mediaAsset.videoId ? { metaVideoId: ad.mediaAsset.videoId } : {})
        });
      }
    }
  }
  let pagePublishingContexts = new Map();
  const publicTestAds = collectPublicTestAds(draft);
  if (publicTestAds.length > 0) {
    pagePublishingContexts = (await metaClient.getPagePublishingContext(
      token,
      [...new Set(publicTestAds.map(({ campaign }) => campaign.pageId))]
    )).pages;
  }
  const result = await publishDraft({
    draft,
    token,
    runId,
    ownerMetaUserId,
    metaClient,
    pagePublishingContexts,
    existingNodes: run.nodes,
    maxNewNodes: 1,
    onlyAdClientIds: new Set(run.nodes
      .filter((node) => node.type === 'ad' && node.status === 'retry_pending')
      .map((node) => String(node.clientId))),
    deadlineAt: Date.now() + 220_000,
    getMedia: async (requestedOwnerId, mediaId) => {
      if (String(requestedOwnerId) !== String(ownerMetaUserId)) return null;
      return mediaAssets.get(mediaId) ?? mediaStore.getMedia({ ownerMetaUserId, id: mediaId });
    },
    getMetaVideoId: (requestedOwnerId, mediaId, adAccountId) => (
      db.getMetaVideoId(requestedOwnerId, mediaId, adAccountId)
    ),
    saveMetaVideoId: (requestedOwnerId, mediaId, adAccountId, metaVideoId) => (
      db.saveMetaVideoId(requestedOwnerId, mediaId, adAccountId, metaVideoId)
    ),
    deleteMetaVideoId: (requestedOwnerId, mediaId, adAccountId, metaVideoId) => (
      db.deleteMetaVideoId(requestedOwnerId, mediaId, adAccountId, metaVideoId)
    ),
    onNodeUpdate: (targetRunId, node) => db.updateNodeResult(targetRunId, node)
  });
  const status = result.nodes.some((node) => ['failed', 'skipped'].includes(node.status))
    ? 'completed_with_errors'
    : 'completed';
  await db.updateRunStatus(runId, status);
  let updatedRun = await db.getRun(runId);
  await syncRunPublications({
    run: updatedRun,
    token,
    metaClient,
    updateNodeResult: (targetRunId, node) => db.updateNodeResult(targetRunId, node)
  });
  updatedRun = await db.getRun(runId);
  const existingJobs = await db.listSeedingJobs(ownerMetaUserId, runId);
  await prepareRunSeeding({
    run: updatedRun,
    ownerMetaUserId,
    existingJobs,
    insertJobs: (targetOwnerId, jobs) => db.insertSeedingJobs(targetOwnerId, jobs)
  });
  await db.releaseWorkflowLease(runId, workflowToken);
  return db.getRun(runId);
}

async function handleRunWorkflowResume({ response, session, db, workflowDispatcher, runId }) {
  if (!session.metaUserId) return sendJson(response, 401, { error: 'Connect Meta first' });
  const run = await db.getRun(runId);
  if (!run || run.ownerMetaUserId !== session.metaUserId) return sendRunNotFound(response);
  if (isTerminalRunStatusValue(run.status) && run.status !== 'failed') {
    return sendJson(response, 200, { accepted: false, reason: 'terminal', run });
  }
  if (run.status === 'failed' && !run.execution) {
    return sendJson(response, 200, { accepted: false, reason: 'terminal', run });
  }
  if (!workflowDispatcher.enabled) {
    return sendJson(response, 409, {
      accepted: false,
      reason: 'workflow_disabled',
      error: 'Workflow đang tắt; không thể khôi phục lượt tạo cũ. Hãy tạo lượt mới.',
      run
    });
  }
  const workflowToken = randomBytes(24).toString('hex');
  const claimed = await db.claimWorkflowLease(runId, workflowToken, Date.now(), WORKFLOW_LEASE_TTL_MS);
  if (!claimed) {
    return sendJson(response, 409, {
      error: 'Workflow đang hoạt động; không thể khôi phục song song vì có thể tạo trùng Campaign'
    });
  }
  try {
    if (typeof db.updateRunStatus === 'function') await db.updateRunStatus(runId, 'creating', null);
    const dispatched = await workflowDispatcher.dispatch(runId, { restart: true, workflowToken });
    const resumedRun = await db.getRun(runId);
    return sendJson(response, 202, { accepted: true, run: resumedRun, ...dispatched });
  } catch (error) {
    if (typeof db.updateRunStatus === 'function') await db.updateRunStatus(runId, run.status, run.completedAt ?? null);
    await db.releaseWorkflowLease(runId, workflowToken);
    throw error;
  }
}

function isTerminalRunStatusValue(status) {
  return new Set(['completed', 'completed_with_errors', 'failed']).has(status);
}

function matchRunSeedingRoute(pathname) {
  const match = /^\/api\/runs\/([^/]+)\/seeding(?:\/(prepare|next|cancel|resume)|\/conflicts\/(resolve)|\/jobs\/([^/]+)\/(retry|confirm))?$/.exec(pathname);
  if (!match) return null;
  try {
    return {
      runId: decodeURIComponent(match[1]),
      action: match[2] ?? match[3] ?? match[5] ?? 'read',
      jobId: match[4] ? decodeURIComponent(match[4]) : null
    };
  } catch {
    return { malformed: true };
  }
}

async function handleRunSeedingRoute({
  request,
  response,
  session,
  db,
  config,
  metaClient,
  mediaStore,
  metaRequestCache,
  runId,
  action,
  jobId
}) {
  const expectedMethod = action === 'read' ? 'GET' : 'POST';
  if (request.method !== expectedMethod) {
    sendJson(response, 405, { error: 'Phương thức không được hỗ trợ' });
    return;
  }
  const run = await getOwnedRunOrRespond({ response, session, db, runId });
  if (!run) return;

  if (action === 'read') {
    sendJson(response, 200, {
      seeding: await loadPublicSeedingState(db, session.metaUserId, run)
    });
    return;
  }

  if (action === 'prepare') {
    const connection = await getConnectedMetaConnection({ response, session, db });
    if (!connection) return;
    const token = decryptToken(connection.accessTokenCiphertext, config.tokenEncryptionKey);
    await syncRunPublications({
      run,
      token,
      metaClient,
      updateNodeResult: (targetRunId, node) => db.updateNodeResult(targetRunId, node)
    });
    const updatedRun = await db.getRun(runId, { execution: false });
    if (!updatedRun || updatedRun.ownerMetaUserId !== session.metaUserId) {
      sendRunNotFound(response);
      return;
    }
    const existingJobs = await db.listSeedingJobs(session.metaUserId, runId);
    try {
      await prepareRunSeeding({
        run: updatedRun,
        ownerMetaUserId: session.metaUserId,
        existingJobs,
        insertJobs: (ownerMetaUserId, jobs) => db.insertSeedingJobs(ownerMetaUserId, jobs)
      });
    } catch (error) {
      if (isSeedingPostConflict(error)) {
        await sendSeedingConflict(response, db, session.metaUserId, updatedRun);
        return;
      }
      throw error;
    }
    sendJson(response, 200, {
      seeding: await loadPublicSeedingState(db, session.metaUserId, updatedRun)
    });
    return;
  }

  if (action === 'next') {
    const connection = await getConnectedMetaConnection({ response, session, db });
    if (!connection) return;
    const result = await processNextSeedingJob({
      runId,
      ownerMetaUserId: session.metaUserId,
      db,
      metaClient,
      mediaStore,
      token: decryptToken(connection.accessTokenCiphertext, config.tokenEncryptionKey),
      loadPageEngagementContext: cachedPageEngagementContext(metaRequestCache, session.metaUserId, metaClient)
    });
    const seeding = await loadPublicSeedingState(db, session.metaUserId, run);
    sendJson(response, 200, {
      job: result.job ? seeding.jobs.find(({ id }) => id === result.job.id) ?? null : null,
      retryAfterMs: result.retryAfterMs,
      seeding
    });
    return;
  }

  if (action === 'resolve') {
    const input = await readJsonBodyOrRespond(request, response);
    if (input === undefined) return;
    const postId = typeof input === 'object' && input !== null ? String(input.postId ?? '').trim() : '';
    const campaignClientId = typeof input === 'object' && input !== null
      ? String(input.campaignClientId ?? '').trim()
      : '';
    if (!postId || !campaignClientId) {
      sendJson(response, 422, {
        errors: [
          ...(!postId ? [{ path: 'postId', message: 'Chọn Post cần xử lý' }] : []),
          ...(!campaignClientId ? [{ path: 'campaignClientId', message: 'Chọn Campaign' }] : [])
        ]
      });
      return;
    }
    const existingJobs = await db.listSeedingJobs(session.metaUserId, runId);
    try {
      await resolveSeedingConflict({
        run,
        ownerMetaUserId: session.metaUserId,
        postId,
        campaignClientId,
        existingJobs,
        insertJobs: (ownerMetaUserId, jobs) => db.insertSeedingJobs(ownerMetaUserId, jobs)
      });
    } catch (error) {
      if (error?.code === 'SEEDING_POST_CONFLICT') {
        await sendSeedingConflict(response, db, session.metaUserId, run);
        return;
      }
      if (error?.message === 'Selected Campaign does not contain this Post ID') {
        sendJson(response, 422, { error: 'Campaign đã chọn không chứa Post này' });
        return;
      }
      throw error;
    }
    sendJson(response, 200, {
      seeding: await loadPublicSeedingState(db, session.metaUserId, run)
    });
    return;
  }

  if (action === 'retry' || action === 'confirm') {
    const jobs = await db.listSeedingJobs(session.metaUserId, runId);
    const job = jobs.find((entry) => entry.id === jobId);
    if (!job) {
      sendJson(response, 404, { error: 'Không tìm thấy tác vụ seeding' });
      return;
    }
    const allowed = action === 'retry'
      ? new Set(['failed', 'needs_review']).has(job.status)
      : job.status === 'needs_review';
    if (!allowed) {
      sendJson(response, 409, {
        error: 'Trạng thái tác vụ seeding đã thay đổi',
        seeding: createSeedingState(run, jobs)
      });
      return;
    }
    const changed = action === 'retry'
      ? await db.retrySeedingJob({ ownerMetaUserId: session.metaUserId, runId, jobId, now: Date.now() })
      : await db.confirmSeedingJob({
        ownerMetaUserId: session.metaUserId,
        runId,
        jobId,
        metaCommentId: job.metaCommentId ?? null,
        now: Date.now()
      });
    if (!changed) {
      sendJson(response, 409, {
        error: 'Trạng thái tác vụ seeding đã thay đổi',
        seeding: await loadPublicSeedingState(db, session.metaUserId, run)
      });
      return;
    }
    sendJson(response, 200, {
      seeding: await loadPublicSeedingState(db, session.metaUserId, run)
    });
    return;
  }

  const changed = action === 'cancel'
    ? await db.cancelSeedingJobs(session.metaUserId, runId)
    : await db.resumeSeedingJobs(session.metaUserId, runId);
  sendJson(response, 200, {
    changed,
    seeding: await loadPublicSeedingState(db, session.metaUserId, run)
  });
}

// Most callers only need snapshot + nodes; pass execution: true to also load the full draft.
async function getOwnedRunOrRespond({ response, session, db, runId, execution = false }) {
  if (!session.metaUserId) {
    sendJson(response, 401, { error: 'Connect Meta first' });
    return null;
  }
  const run = await db.getRun(runId, { execution });
  if (!run || run.ownerMetaUserId !== session.metaUserId) {
    sendRunNotFound(response);
    return null;
  }
  return run;
}

function sendRunNotFound(response) {
  sendJson(response, 404, { error: 'Không tìm thấy lượt tạo' });
}

async function loadPublicSeedingState(db, ownerMetaUserId, run) {
  const jobs = await db.listSeedingJobs(ownerMetaUserId, run.id);
  return createSeedingState(run, jobs);
}

async function sendSeedingConflict(response, db, ownerMetaUserId, run) {
  sendJson(response, 409, {
    error: 'Post đã được chọn cho Campaign khác',
    code: 'SEEDING_POST_CONFLICT',
    seeding: await loadPublicSeedingState(db, ownerMetaUserId, run)
  });
}

function isSeedingPostConflict(error) {
  return error?.code === 'SEEDING_POST_CONFLICT';
}

async function handleRunPublicationRefresh({ response, session, db, config, metaClient, runId }) {
  const run = await getOwnedRunOrRespond({ response, session, db, runId });
  if (!run) return;
  const connection = await db.getConnection(session.metaUserId);
  if (!connection) {
    sendJson(response, 401, { error: 'Connect Meta first' });
    return;
  }
  const token = decryptToken(connection.accessTokenCiphertext, config.tokenEncryptionKey);
  const sync = await syncRunPublications({
    run,
    token,
    metaClient,
    updateNodeResult: (targetRunId, node) => db.updateNodeResult(targetRunId, node)
  });
  const updatedRun = await db.getRun(runId, { execution: false });
  if (!updatedRun || updatedRun.ownerMetaUserId !== session.metaUserId) {
    sendRunNotFound(response);
    return;
  }
  sendJson(response, 200, {
    run: runResponse(updatedRun, await loadPublicSeedingState(db, session.metaUserId, updatedRun)),
    sync
  });
}

async function handleRunRead({ response, session, db, runId }) {
  const run = await getOwnedRunOrRespond({ response, session, db, runId });
  if (!run) return;
  sendJson(response, 200, runResponse(
    run,
    await loadPublicSeedingState(db, session.metaUserId, run)
  ));
}

function runResponse(run, seeding) {
  return {
    id: run.id,
    status: run.status,
    adAccountId: run.adAccountId,
    snapshot: run.snapshot,
    createdAt: run.createdAt,
    completedAt: run.completedAt,
    workflowLeaseExpiresAt: run.workflowLeaseExpiresAt ?? null,
    legacy: Boolean(run.legacy),
    nodes: run.nodes,
    seeding
  };
}

async function handleRunList({ url, response, session, db }) {
  if (!session.metaUserId) {
    sendJson(response, 401, { error: 'Connect Meta first' });
    return;
  }
  let options;
  try {
    options = runHistoryOptions(url.searchParams);
  } catch (error) {
    sendJson(response, 400, { error: error.message });
    return;
  }
  const history = await db.listRuns(session.metaUserId, options);
  sendJson(response, 200, history);
}

function runHistoryOptions(searchParams) {
  const options = {
    from: historyInteger(searchParams, 'from', 0, 0, Number.MAX_SAFE_INTEGER),
    to: historyInteger(searchParams, 'to', Number.MAX_SAFE_INTEGER, 1, Number.MAX_SAFE_INTEGER),
    limit: historyInteger(searchParams, 'limit', 20, 1, 50),
    offset: historyInteger(searchParams, 'offset', 0, 0, Number.MAX_SAFE_INTEGER)
  };
  if (options.to <= options.from) {
    throw new TypeError('Khoảng ngày lịch sử không hợp lệ');
  }
  return options;
}

function historyInteger(searchParams, name, fallback, minimum, maximum) {
  const raw = searchParams.get(name);
  if (raw === null || raw === '') return fallback;
  if (!/^\d+$/.test(raw)) throw new TypeError(`Tham số ${name} không hợp lệ`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new TypeError(`Tham số ${name} không hợp lệ`);
  }
  return value;
}

async function handleInternalWorkflowRoute({ request, response, url, config, db, metaClient, mediaStore, metaRequestCache }) {
  if (!config.workflowEnabled || !config.workflowSharedSecret) {
    sendJson(response, 404, { error: 'Not found' });
    return;
  }
  const body = request.method === 'GET' ? '' : (await readBuffer(request, 64 * 1024)).toString('utf8');
  const now = Date.now();
  const authInput = workflowAuthInput(request, url.pathname, body);
  const verification = verifyWorkflowRequest(
    authInput,
    config.workflowSharedSecret,
    { now }
  );
  if (!verification.valid) {
    sendJson(response, 401, { error: `Workflow authentication failed: ${verification.reason}` });
    return;
  }
  const nonceHash = createHash('sha256').update(String(authInput.nonce)).digest('hex');
  const expiresAt = Number(authInput.timestamp) + WORKFLOW_MAX_CLOCK_SKEW_MS;
  if (!await db.claimWorkflowNonce(nonceHash, expiresAt, now)) {
    return sendJson(response, 401, { error: 'Workflow authentication failed: replay' });
  }

  if (url.pathname === '/api/internal/workflow/comment-unhide/tick') {
    if (request.method !== 'POST') return sendJson(response, 405, { error: 'Method not allowed' });
    return sendJson(response, 200, await tickCommentUnhide({ config, db, metaClient }));
  }
  const match = /^\/api\/internal\/workflow\/runs\/([^/]+)\/(plan|continue|media\/prepare|publications\/next|seeding\/prepare|seeding\/next|finalize)$/.exec(url.pathname);
  if (!match) return sendJson(response, 404, { error: 'Not found' });
  const runId = decodeURIComponent(match[1]);
  const action = match[2];
  if ((action === 'plan' && request.method !== 'GET') || (action !== 'plan' && request.method !== 'POST')) {
    return sendJson(response, 405, { error: 'Method not allowed' });
  }
  // Ghi một dòng log thời lượng cho mỗi bước workflow (chỉ các trường trong danh sách cho phép, không chứa token hay link ký sẵn).
  const stepStartedAt = Date.now();
  const stepInfo = {};
  const stepKey = (() => { try { return JSON.parse(body || '{}').stepKey ?? null; } catch { return null; } })();
  response.once('finish', () => {
    console.log(workflowStepLogLine({ runId, action, stepKey, status: response.statusCode, ms: Date.now() - stepStartedAt, ...stepInfo }));
  });
  const run = await db.getRun(runId);
  if (!run) return sendJson(response, 404, { error: 'Run not found' });
  const workflowToken = String(request.headers['x-workflow-token'] ?? '').trim();
  if (workflowToken) {
    const renewed = await db.renewWorkflowLease(runId, workflowToken, Date.now(), WORKFLOW_LEASE_TTL_MS);
    if (!renewed) {
      return sendJson(response, 409, { error: 'Workflow lease đã hết hạn hoặc đã được workflow khác tiếp quản' });
    }
  } else if (run.workflowToken) {
    return sendJson(response, 409, { error: 'Workflow không còn quyền xử lý lượt tạo này' });
  }
  if (action === 'plan') return sendJson(response, 200, createWorkflowExecutionPlan(run));

  const connection = await db.getConnection(run.ownerMetaUserId);
  if (!connection) return sendJson(response, 409, { error: 'Meta connection not found' });
  const token = decryptToken(connection.accessTokenCiphertext, config.tokenEncryptionKey);

  if (action === 'media/prepare') {
    const draft = run.execution;
    if (!draft) return sendJson(response, 409, { error: 'Run does not contain an execution draft' });
    const prepared = await prepareWorkflowMedia({
      runId,
      ownerMetaUserId: run.ownerMetaUserId,
      draft,
      existingNodes: run.nodes,
      token,
      metaClient,
      getMedia: (mediaId) => mediaStore.getMedia({ ownerMetaUserId: run.ownerMetaUserId, id: mediaId }),
      getMetaVideoId: (ownerMetaUserId, mediaId, adAccountId) => db.getMetaVideoId(ownerMetaUserId, mediaId, adAccountId),
      saveMetaVideoId: (ownerMetaUserId, mediaId, adAccountId, metaVideoId) => (
        db.saveMetaVideoId(ownerMetaUserId, mediaId, adAccountId, metaVideoId)
      ),
      deleteMetaVideoId: (ownerMetaUserId, mediaId, adAccountId, metaVideoId) => (
        db.deleteMetaVideoId(ownerMetaUserId, mediaId, adAccountId, metaVideoId)
      ),
      updateNodeResult: (targetRunId, node) => db.updateNodeResult(targetRunId, node),
      stopStartingAt: Date.now() + WORKFLOW_STEP_SOFT_DEADLINE_MS
    });
    Object.assign(stepInfo, { pending: prepared.pending, ready: prepared.ready, total: prepared.total });
    return sendJson(response, 200, prepared);
  }

  if (action === 'continue') {
    const draft = run.execution;
    if (!draft) return sendJson(response, 409, { error: 'Run does not contain an execution draft' });
    const retryingAd = run.status === 'retrying_ad';
    const retryAdClientIds = new Set(run.nodes
      .filter((node) => node.type === 'ad' && node.status === 'retry_pending')
      .map((node) => String(node.clientId)));
    if (retryingAd && retryAdClientIds.size === 0) {
      return sendJson(response, 200, { status: 'ads_created', complete: true });
    }
    const mediaAssets = new Map();
    for (const campaign of draft.campaigns ?? []) {
      for (const adSet of campaign.adSets ?? []) {
        for (const ad of adSet.ads ?? []) {
          if (!ad.mediaAsset) continue;
          mediaAssets.set(ad.mediaId, {
            id: ad.mediaId,
            ownerMetaUserId: run.ownerMetaUserId,
            name: ad.mediaAsset.name ?? ad.mediaFileName ?? '',
            mimeType: ad.mediaAsset.mimeType ?? (ad.mediaAsset.kind === 'video' ? 'video/mp4' : 'image/jpeg'),
            sizeBytes: Number(ad.mediaAsset.sizeBytes) || 0,
            ...(ad.mediaAsset.imageHash ? { metaImageHash: ad.mediaAsset.imageHash } : {}),
            ...(ad.mediaAsset.videoId ? { metaVideoId: ad.mediaAsset.videoId } : {})
          });
        }
      }
    }
    let pagePublishingContexts = new Map();
    const publicTestAds = collectPublicTestAds(draft);
    if (publicTestAds.length > 0) {
      pagePublishingContexts = (await metaClient.getPagePublishingContext(
        token,
        [...new Set(publicTestAds.map(({ campaign }) => campaign.pageId))]
      )).pages;
    }
    const result = await publishDraft({
      draft,
      token,
      runId,
      ownerMetaUserId: run.ownerMetaUserId,
      metaClient,
      pagePublishingContexts,
      existingNodes: run.nodes,
      maxNewNodes: WORKFLOW_PUBLISH_BATCH_SIZE,
      concurrency: config.publishConcurrency,
      onlyAdClientIds: retryingAd ? retryAdClientIds : null,
      deadlineAt: Date.now() + WORKFLOW_STEP_HARD_DEADLINE_MS,
      stopStartingAt: Date.now() + WORKFLOW_STEP_SOFT_DEADLINE_MS,
      // Quá mốc cứng thì trả deadlineHit để workflow làm tiếp, không trả lỗi 500 làm tiêu hao lượt thử.
      onDeadline: 'return',
      runStartedAt: run.createdAt,
      getMedia: async (ownerMetaUserId, mediaId) => {
        if (String(ownerMetaUserId) !== String(run.ownerMetaUserId)) return null;
        return mediaAssets.get(mediaId) ?? mediaStore.getMedia({ ownerMetaUserId, id: mediaId });
      },
      getMetaVideoId: (ownerMetaUserId, mediaId, adAccountId) => (
        db.getMetaVideoId(ownerMetaUserId, mediaId, adAccountId)
      ),
      saveMetaVideoId: (ownerMetaUserId, mediaId, adAccountId, metaVideoId) => (
        db.saveMetaVideoId(ownerMetaUserId, mediaId, adAccountId, metaVideoId)
      ),
      deleteMetaVideoId: (ownerMetaUserId, mediaId, adAccountId, metaVideoId) => (
        db.deleteMetaVideoId(ownerMetaUserId, mediaId, adAccountId, metaVideoId)
      ),
      onNodeUpdate: (targetRunId, node) => db.updateNodeResult(targetRunId, node)
    });
    Object.assign(stepInfo, { attempted: result.attempted, complete: result.complete, deadlineHit: Boolean(result.deadlineHit) });
    return sendJson(response, 200, {
      status: result.complete ? 'ads_created' : 'creating',
      complete: result.complete,
      attempted: result.attempted,
      ...(result.deadlineHit ? { deadlineHit: true } : {})
    });
  }

  if (action === 'publications/next') {
    const sync = await syncRunPublications({
      run,
      token,
      metaClient,
      maxGroups: WORKFLOW_PUBLICATION_BATCH_SIZE,
      updateNodeResult: (targetRunId, node) => db.updateNodeResult(targetRunId, node)
    });
    return sendJson(response, 200, { status: 'publications_checked', sync });
  }

  if (action === 'seeding/prepare') {
    const updatedRun = await db.getRun(runId);
    const existingJobs = await db.listSeedingJobs(run.ownerMetaUserId, runId);
    const prepared = await prepareRunSeeding({
      run: updatedRun,
      ownerMetaUserId: run.ownerMetaUserId,
      existingJobs,
      insertJobs: (ownerMetaUserId, jobs) => db.insertSeedingJobs(ownerMetaUserId, jobs)
    });
    if (prepared.conflicts.length > 0) {
      return sendJson(response, 409, { error: 'Seeding Post ID conflict', conflicts: prepared.conflicts });
    }
    return sendJson(response, 200, { status: 'seeding_prepared', jobs: prepared.jobs.length, waitingPostCount: prepared.waitingPostCount });
  }

  if (action === 'seeding/next') {
    const result = await processWorkflowSeedingBatch({
      batchSize: WORKFLOW_SEEDING_BATCH_SIZE,
      processNext: () => processNextSeedingJob({
        runId,
        ownerMetaUserId: run.ownerMetaUserId,
        db,
        metaClient,
        mediaStore,
        token,
        loadPageEngagementContext: cachedPageEngagementContext(metaRequestCache, run.ownerMetaUserId, metaClient)
      })
    });
    return sendJson(response, 200, {
      status: result.job?.status ?? 'idle',
      terminal: result.job?.status === 'needs_review',
      jobId: result.job?.id ?? null,
      retryAfterMs: result.retryAfterMs
    });
  }

  const reconciliation = await reconcileWorkflowSeeding({ run, db, token, metaClient, mediaStore,
    loadPageEngagementContext: cachedPageEngagementContext(metaRequestCache, run.ownerMetaUserId, metaClient) });
  if (reconciliation.pending || reconciliation.needsReview) {
    await db.updateRunStatus(runId, 'seeding', null);
    return sendJson(response, 200, { status: reconciliation.needsReview ? 'needs_review' : 'seeding',
      terminal: Boolean(reconciliation.needsReview), retryAfterMs: 30_000, ...reconciliation });
  }
  const finalRun = await db.getRun(runId);
  const jobs = await db.listSeedingJobs(run.ownerMetaUserId, runId);
  const failed = finalRun.nodes.some((node) => node.status === 'failed') || jobs.some((job) => ['failed', 'needs_review'].includes(job.status));
  const unfinished = finalRun.nodes.some((node) => ['creating', 'pending', 'retry_pending'].includes(node.status)) || jobs.some((job) => ['pending', 'posting'].includes(job.status));
  const status = unfinished ? 'completed_with_errors' : (failed ? 'completed_with_errors' : 'completed');
  await db.updateRunStatus(runId, status);
  if (workflowToken) await db.releaseWorkflowLease(runId, workflowToken);
  if (mediaStore.deleteTemporaryMedia) {
    const mediaIds = collectWorkflowCleanupMediaIds(finalRun);
    // Metadata only: mediaStore.getMedia would fetch every object just to delete it.
    const media = await Promise.all(mediaIds.map((id) => db.getMedia(run.ownerMetaUserId, id).catch(() => null)));
    await Promise.allSettled(media.filter(Boolean).map((item) => mediaStore.deleteTemporaryMedia(item)));
  }
  return sendJson(response, 200, { status, terminal: true });
}

export function collectWorkflowCleanupMediaIds(finalRun) {
  const protectedSeedingMediaIds = new Set(
    (finalRun?.execution?.campaigns ?? []).flatMap((campaign) => (
      (campaign.seeding?.items ?? []).map((item) => String(item.imageMediaId ?? '')).filter(Boolean)
    ))
  );
  const completedAdIds = new Set((finalRun?.nodes ?? [])
    .filter((node) => node.type === 'ad' && node.remoteId)
    .map((node) => String(node.clientId)));
  const mediaIds = new Set();
  for (const campaign of finalRun?.execution?.campaigns ?? []) {
    for (const adSet of campaign.adSets ?? []) for (const ad of adSet.ads ?? []) {
      if (
        !ad.mediaAsset
        && completedAdIds.has(String(ad.clientId))
        && !protectedSeedingMediaIds.has(String(ad.mediaId ?? ''))
      ) mediaIds.add(ad.mediaId);
    }
  }
  return [...mediaIds];
}

async function handleRunCreation({ request, response, session, db, config, metaClient, mediaStore, workflowDispatcher }) {
  const publishDeadlineMs = clampPublishDeadlineMs(config.publishDeadlineMs);
  const publishDeadlineAt = Date.now() + publishDeadlineMs;

  if (!session.metaUserId) {
    sendJson(response, 401, { error: 'Connect Meta first' });
    return;
  }

  let draft;
  try {
    draft = await readJson(request);
  } catch {
    sendJson(response, 400, { error: 'Payload JSON không hợp lệ' });
    return;
  }

  const issues = validateDraft(draft);
  if (issues.length > 0) {
    sendJson(response, 400, { errors: issues });
    return;
  }

  const selectedSeedingMedia = new Map();
  for (const [campaignIndex, campaign] of draft.campaigns.entries()) {
    if (!campaign.seeding) continue;
    const seedingPath = `campaigns.${campaignIndex}.seeding`;
    const templateId = String(campaign.seeding.templateId ?? '').trim();
    const template = await db.getSeedingTemplate(session.metaUserId, templateId);
    if (!template || String(template.ownerMetaUserId) !== String(session.metaUserId)) {
      sendJson(response, 400, {
        errors: [{ path: `${seedingPath}.templateId`, message: 'Mẫu seeding không còn tồn tại' }]
      });
      return;
    }
    const normalized = normalizeSeedingTemplateInput({
      name: campaign.seeding.templateName,
      items: campaign.seeding.items
    });
    if (normalized.errors.length > 0) {
      sendJson(response, 422, {
        errors: normalized.errors.map((error) => ({
          ...error,
          path: `${seedingPath}.${error.path === 'name' ? 'templateName' : error.path}`
        }))
      });
      return;
    }
    campaign.seeding = {
      enabled: true,
      templateId,
      templateName: normalized.name,
      items: normalized.items
    };
    for (const [itemIndex, item] of normalized.items.entries()) {
      if (!item.imageMediaId) continue;
      let media;
      try {
        media = await mediaStore.getMedia({
          ownerMetaUserId: session.metaUserId,
          id: item.imageMediaId
        });
      } catch {
        media = null;
      }
      const trusted = media
        && String(media.ownerMetaUserId) === String(session.metaUserId)
        && SEEDING_IMAGE_TYPES.has(media.mimeType)
        && Number.isSafeInteger(media.sizeBytes)
        && media.sizeBytes >= 0
        && media.sizeBytes <= MAX_SEEDING_IMAGE_BYTES;
      if (!trusted) {
        sendJson(response, 400, {
          errors: [{
            path: `${seedingPath}.items.${itemIndex}.imageMediaId`,
            message: 'Media seeding phải là JPEG, PNG, MP4 hoặc MOV thuộc tài khoản hiện tại, tối đa 200 MB'
          }]
        });
        return;
      }
      if (mediaStore.preserveSeedingMedia) {
        media = await mediaStore.preserveSeedingMedia({ ownerMetaUserId: session.metaUserId, id: item.imageMediaId });
      }
      selectedSeedingMedia.set(item.imageMediaId, media);
    }
  }

  const selectedMedia = new Map();
  for (const campaign of draft.campaigns) {
    for (const adSet of campaign.adSets) {
      for (const ad of adSet.ads) {
        if (ad.conversation?.imageMediaId) {
          let conversationImage;
          try {
            conversationImage = await mediaStore.getMedia({
              ownerMetaUserId: session.metaUserId,
              id: ad.conversation.imageMediaId
            });
          } catch {
            conversationImage = null;
          }
          if (!conversationImage?.mimeType?.startsWith('image/')) {
            sendJson(response, 400, { errors: [{
              path: `${ad.clientId}.conversation.imageMediaId`,
              message: 'Ảnh cuộc trò chuyện không hợp lệ hoặc không thuộc tài khoản hiện tại'
            }] });
            return;
          }
          const imageUrl = await mediaStore.getMetaFetchUrl({
            ownerMetaUserId: session.metaUserId,
            id: ad.conversation.imageMediaId
          });
          if (!imageUrl) {
            sendJson(response, 400, { errors: [{
              path: `${ad.clientId}.conversation.imageMediaId`,
              message: 'Ảnh cuộc trò chuyện cần chạy trên kho lưu trữ production để Meta có thể đọc'
            }] });
            return;
          }
          ad.conversation.imageUrl = imageUrl;
        }
        if (ad.mediaAsset) {
          const asset = ad.mediaAsset;
          selectedMedia.set(ad.mediaId, {
            id: ad.mediaId,
            ownerMetaUserId: session.metaUserId,
            name: asset.name ?? ad.mediaFileName ?? '',
            mimeType: asset.mimeType ?? (asset.kind === 'video' ? 'video/mp4' : 'image/jpeg'),
            sizeBytes: Number(asset.sizeBytes) || 0,
            ...(asset.imageHash ? { metaImageHash: asset.imageHash } : {}),
            ...(asset.videoId ? { metaVideoId: asset.videoId } : {})
          });
          continue;
        }
        if (selectedMedia.has(ad.mediaId)) continue; // same media reused across ads: validate/download once
        let media;
        try {
          media = await mediaStore.getMedia({ ownerMetaUserId: session.metaUserId, id: ad.mediaId });
        } catch {
          media = null;
        }
        if (!media || media.ownerMetaUserId !== session.metaUserId) {
          sendJson(response, 400, { errors: [{ path: `${ad.clientId}.mediaId`, message: 'Media không thuộc tài khoản hiện tại' }] });
          return;
        }
        selectedMedia.set(ad.mediaId, media);
      }
    }
  }

  const publicTestAds = collectPublicTestAds(draft);
  const publicMediaIssues = publicTestAds.flatMap(({ ad, path }) => {
    const media = selectedMedia.get(ad.mediaId);
    return media?.mimeType.startsWith('image/')
      ? []
      : [{ path: `${path}.mediaId`, message: 'Public Test hiện chỉ hỗ trợ ảnh; video cần Meta App Live' }];
  });
  if (publicMediaIssues.length > 0) {
    sendJson(response, 400, { errors: publicMediaIssues });
    return;
  }

  const connection = await db.getConnection(session.metaUserId);
  if (!connection) {
    sendJson(response, 401, { error: 'Connect Meta first' });
    return;
  }

  const token = decryptToken(connection.accessTokenCiphertext, config.tokenEncryptionKey);
  const selectedPageIds = [...new Set(draft.campaigns.map((campaign) => campaign.pageId))];
  const publishingContext = await metaClient.getPagePublishingContext(token, selectedPageIds);
  const pagePublishingContexts = publishingContext.pages;
  if (publicTestAds.length > 0) {
    const publishingIssues = publicTestPublishingIssues(publicTestAds, publishingContext);
    if (publishingIssues.length > 0) {
      sendJson(response, 403, { errors: publishingIssues });
      return;
    }
  }

  const streaming = acceptsRunStream(request);
  const snapshot = createRunSnapshot({
    draft,
    selectedMedia,
    selectedSeedingMedia,
    pages: [...pagePublishingContexts.entries()].map(([id, page]) => ({ id, name: page.name }))
  });
  const run = await db.createRun({
    ownerMetaUserId: session.metaUserId,
    status: 'creating',
    adAccountId: uniqueCampaignAccountId(draft),
    snapshot,
    execution: createRunExecutionDraft(draft)
  });
  if (workflowDispatcher.enabled) {
    const workflowToken = randomBytes(24).toString('hex');
    const claimed = await db.claimWorkflowLease(run.id, workflowToken, Date.now(), WORKFLOW_LEASE_TTL_MS);
    if (!claimed) {
      await db.updateRunStatus(run.id, 'dispatch_failed');
      sendJson(response, 409, { id: run.id, status: 'dispatch_failed', error: 'Không thể khóa lượt tạo workflow' });
      return;
    }
    try {
      const dispatched = await workflowDispatcher.dispatch(run.id, { workflowToken });
      await db.updateRunStatus(run.id, 'creating', null);
      sendJson(response, 202, { id: run.id, status: 'creating', nodes: [], workflowInstanceId: dispatched.workflowInstanceId });
      return;
    } catch (error) {
      await db.releaseWorkflowLease(run.id, workflowToken);
      await db.updateRunStatus(run.id, 'dispatch_failed');
      sendJson(response, 502, { id: run.id, status: 'dispatch_failed', error: error.message });
      return;
    }
  }
  if (streaming) {
    startRunStream(response);
    writeRunEvent(response, {
      type: 'run_started',
      runId: run.id,
      status: 'creating',
      total: countDraftNodes(draft)
    });
  }

  const publicationController = new AbortController();
  const publicationRemainingMs = Math.max(0, publishDeadlineAt - Date.now());
  let publicationTimer;
  if (publicationRemainingMs === 0) {
    publicationController.abort();
  } else {
    publicationTimer = setTimeout(
      () => publicationController.abort(),
      publicationRemainingMs
    );
    publicationTimer.unref?.();
  }

  const completedMediaIds = new Set();
  try {
    let nodePersistenceError;
    const result = await publishDraft({
      draft,
      token,
      runId: run.id,
      ownerMetaUserId: session.metaUserId,
      metaClient,
      deadlineAt: publishDeadlineAt,
      signal: publicationController.signal,
      concurrency: config.publishConcurrency,
      pagePublishingContexts,
      getMedia: async (ownerMetaUserId, mediaId) => (
        ownerMetaUserId === session.metaUserId ? selectedMedia.get(mediaId) ?? null : null
      ),
      getMetaVideoId: (ownerMetaUserId, mediaId, adAccountId) => (
        db.getMetaVideoId(ownerMetaUserId, mediaId, adAccountId)
      ),
      saveMetaVideoId: (ownerMetaUserId, mediaId, adAccountId, metaVideoId) => (
        db.saveMetaVideoId(ownerMetaUserId, mediaId, adAccountId, metaVideoId)
      ),
      deleteMetaVideoId: (ownerMetaUserId, mediaId, adAccountId, metaVideoId) => (
        db.deleteMetaVideoId(ownerMetaUserId, mediaId, adAccountId, metaVideoId)
      ),
      onNodeUpdate: async (runId, node) => {
        if (nodePersistenceError) throw nodePersistenceError;
        try {
          await db.updateNodeResult(runId, node);
        } catch (error) {
          nodePersistenceError = error;
          throw error;
        }
        if (streaming) writeRunEvent(response, { type: 'node_updated', runId, node });
      }
    });
    const status = result.nodes.some((node) => node.status === 'failed')
      ? 'completed_with_errors'
      : 'completed';
    const completedAdIds = new Set(result.nodes
      .filter((node) => node.type === 'ad' && node.remoteId)
      .map((node) => String(node.clientId)));
    for (const campaign of draft.campaigns ?? []) for (const adSet of campaign.adSets ?? []) {
      for (const ad of adSet.ads ?? []) if (completedAdIds.has(String(ad.clientId))) completedMediaIds.add(ad.mediaId);
    }
    await db.updateRunStatus(run.id, status);
    if (streaming) {
      writeRunEvent(response, { type: 'run_completed', runId: run.id, status, nodes: result.nodes });
      response.end();
      return;
    }
    sendJson(response, 201, result);
  } catch (error) {
    if (error?.retryable === true && Number(error.statusCode) === 429) {
      try { await db.updateRunStatus(run.id, 'creating', null); } catch {}
      sendApiError(response, error);
      return;
    }
    try {
      await db.updateRunStatus(run.id, 'failed');
    } catch {}
    if (streaming) {
      writeRunEvent(response, {
        type: 'run_failed',
        runId: run.id,
        status: 'failed',
        error: normalizeRunError(error)
      });
      response.end();
      return;
    }
    throw error;
  } finally {
    if (publicationTimer) clearTimeout(publicationTimer);
    if (mediaStore.deleteTemporaryMedia) {
      await Promise.allSettled([...selectedMedia.values()]
        .filter((media) => completedMediaIds.has(media.id))
        .map((media) => mediaStore.deleteTemporaryMedia(media)));
    }
  }
}

async function handleR2Presign({ request, response, session, mediaStore }) {
  if (!session.metaUserId) return sendJson(response, 401, { error: 'Connect Meta first' });
  if (!mediaStore.r2) return sendJson(response, 404, { enabled: false });
  const input = await readJson(request);
  const mediaId = randomBytes(16).toString('hex');
  const signed = await mediaStore.r2.presignUpload({ ownerMetaUserId: session.metaUserId, mediaId, name: input.name, mimeType: input.mimeType, sizeBytes: input.sizeBytes, purpose: input.purpose });
  sendJson(response, 200, { enabled: true, ...signed });
}

async function handleR2Complete({ request, response, session, mediaStore }) {
  if (!session.metaUserId) return sendJson(response, 401, { error: 'Connect Meta first' });
  if (!mediaStore.r2) return sendJson(response, 404, { enabled: false });
  const input = await readJson(request);
  const media = await mediaStore.r2.completeUpload({ ownerMetaUserId: session.metaUserId, input });
  sendJson(response, 201, { mediaId: media.id, id: media.id, name: media.name, mimeType: media.mimeType, sizeBytes: media.sizeBytes });
}

function matchR2MultipartRoute(pathname) {
  return /^\/api\/r2-media\/multipart\/(create|part|complete|abort)$/.exec(pathname)?.[1] ?? null;
}

function matchTelegramUploadMultipartRoute(pathname) {
  return /^\/api\/telegram-upload\/r2-multipart\/(create|part|complete|abort)$/.exec(pathname)?.[1] ?? null;
}

function authenticateTelegramWorkerRequest(request, configuredSecret) {
  const authorization = String(request.headers.authorization ?? '');
  const provided = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
  if (!configuredSecret || !provided) return false;
  const expectedBuffer = Buffer.from(configuredSecret);
  const providedBuffer = Buffer.from(provided);
  return expectedBuffer.length === providedBuffer.length
    && timingSafeEqual(expectedBuffer, providedBuffer);
}

export function normalizeTelegramNetworkPath(value, configuredRoot = '\\\\192.168.1.6\\marketing') {
  const raw = String(value ?? '').trim().replace(/^"|"$/g, '');
  if (!raw || raw.length > 2048 || raw.includes('\0') || !raw.startsWith('\\\\')) return null;
  if (raw.split(/[\\/]+/).includes('..')) return null;
  const root = win32.normalize(String(configuredRoot ?? '').trim());
  const normalized = win32.normalize(raw);
  const relative = win32.relative(root, normalized);
  if (!relative || relative === '..' || relative.startsWith(`..${win32.sep}`) || win32.isAbsolute(relative)) {
    return null;
  }
  if (!/\.(?:jpe?g|png|webp|mp4|mov)$/i.test(normalized)) return null;
  return normalized;
}

async function handleR2Multipart({ request, response, session, mediaStore, action }) {
  if (!session.metaUserId) return sendJson(response, 401, { error: 'Connect Meta first' });
  if (!mediaStore.r2) return sendJson(response, 404, { enabled: false });
  const input = await readJsonBodyOrRespond(request, response);
  if (input === undefined) return;
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    sendJson(response, 400, { error: 'Payload JSON không hợp lệ' });
    return;
  }
  return executeR2Multipart({
    response,
    mediaStore,
    action,
    input,
    ownerMetaUserId: session.metaUserId,
    createMediaId: randomBytes(16).toString('hex')
  });
}

async function handleTelegramR2Multipart({
  request,
  response,
  mediaStore,
  action,
  telegramUploadAuth,
  allowedMetaUserIds
}) {
  if (!mediaStore.r2) return sendJson(response, 404, { enabled: false });
  const input = await readJsonBodyOrRespond(request, response);
  if (input === undefined) return;
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    sendJson(response, 400, { error: 'Payload JSON không hợp lệ' });
    return;
  }
  const intent = telegramUploadAuth.verifyIntent(input.code);
  if (!intent) return sendJson(response, 401, { error: 'Phiên tải qua Telegram không hợp lệ hoặc đã hết hạn' });
  if (!allowedMetaUserIds?.has?.(String(intent.ownerMetaUserId))) {
    return sendJson(response, 403, { error: 'Tính năng thử nghiệm chưa được cấp cho tài khoản này' });
  }
  if (input.mediaId !== undefined && input.mediaId !== intent.mediaId) {
    return sendJson(response, 403, { error: 'Media ID không thuộc phiên Telegram này' });
  }
  const { code: _code, ...uploadInput } = input;
  return executeR2Multipart({
    response,
    mediaStore,
    action,
    input: uploadInput,
    ownerMetaUserId: intent.ownerMetaUserId,
    createMediaId: intent.mediaId
  });
}

async function executeR2Multipart({
  response,
  mediaStore,
  action,
  input,
  ownerMetaUserId,
  createMediaId
}) {
  const ownedInput = { ...input, ownerMetaUserId };

  if (action === 'create') {
    const result = await mediaStore.r2.createMultipartUpload({
      ...ownedInput,
      mediaId: createMediaId
    });
    sendJson(response, 201, result);
    return;
  }
  if (action === 'part') {
    sendJson(response, 200, await mediaStore.r2.presignMultipartPart(ownedInput));
    return;
  }
  if (action === 'complete') {
    const media = await mediaStore.r2.completeMultipartUpload(ownedInput);
    sendJson(response, 201, {
      mediaId: media.id,
      id: media.id,
      name: media.name,
      mimeType: media.mimeType,
      sizeBytes: media.sizeBytes
    });
    return;
  }
  sendJson(response, 200, await mediaStore.r2.abortMultipartUpload(ownedInput));
}

function canUseTelegramNetworkUpload(config, metaUserId) {
  return Boolean(metaUserId)
    && config.telegramUploadAllowedMetaUserIds?.has?.(String(metaUserId)) === true;
}

function telegramUploadProgress(job) {
  const uploadedBytes = Math.max(0, Number(job?.uploadedBytes) || 0);
  const totalBytes = Math.max(0, Number(job?.totalBytes) || 0);
  return {
    uploadedBytes,
    totalBytes,
    percentage: totalBytes > 0
      ? Math.max(0, Math.min(100, Math.round((uploadedBytes / totalBytes) * 100)))
      : 0
  };
}

function countDraftNodes(draft) {
  return (draft.campaigns ?? []).reduce((total, campaign) => (
    total + 1 + (campaign.adSets ?? []).reduce((adSetTotal, adSet) => (
      adSetTotal + 1 + (adSet.ads ?? []).length
    ), 0)
  ), 0);
}

function normalizeRunError(error) {
  return error.meta ?? {
    message: error.expose ? error.message : 'Lượt tạo trên Meta bị gián đoạn',
    type: error.name ?? 'Error'
  };
}

function collectPublicTestAds(draft) {
  const entries = [];
  draft.campaigns.forEach((campaign, campaignIndex) => {
    campaign.adSets.forEach((adSet, adSetIndex) => {
      adSet.ads.forEach((ad, adIndex) => {
        if ((ad.publicationMode ?? 'DARK') !== 'PUBLIC_TEST') return;
        entries.push({
          ad,
          adSet,
          campaign,
          path: `campaigns.${campaignIndex}.adSets.${adSetIndex}.ads.${adIndex}`
        });
      });
    });
  });
  return entries;
}

function publicTestPublishingIssues(publicTestAds, publishingContext) {
  if (!publishingContext.permissionGranted) {
    return publicTestAds.map(({ path }) => ({
      path: `${path}.publicationMode`,
      message: 'Kết nối lại Meta và cấp quyền pages_manage_posts để dùng Public Test'
    }));
  }

  return publicTestAds.flatMap(({ campaign, path }) => {
    const page = publishingContext.pages.get(String(campaign.pageId));
    if (!page?.accessToken) {
      return [{
        path: `${path}.publicationMode`,
        message: 'Public Test yêu cầu Page nằm trong /me/accounts và có Page access token'
      }];
    }
    if (!page.tasks.includes('CREATE_CONTENT')) {
      return [{
        path: `${path}.publicationMode`,
        message: `Bạn chưa có quyền tạo nội dung trên Page ${page.name}`
      }];
    }
    return [];
  });
}

function uniqueCampaignAccountId(draft) {
  const accountIds = [...new Set(draft.campaigns.map((campaign) => campaign.adAccountId))];
  return accountIds.length === 1 ? accountIds[0] : null;
}

function sendRedirect(response, location) {
  response.writeHead(302, { location });
  response.end();
}

function sendApiError(response, error) {
  if (error?.retryable === true && Number(error.statusCode) === 429) {
    sendJson(response, 429, {
      error: 'Đang chờ hạn mức Meta',
      retryable: true,
      retryAfterMs: Math.max(30_000, Number(error.retryAfterMs) || 30_000)
    });
    return;
  }
  const status = error.meta ? 502 : error.statusCode ?? 500;
  const body = error.meta ?? (error.expose ? { error: error.message } : { error: 'Unexpected server error' });
  sendJson(response, status, body);
}

async function getOrCreateSession(request, response, config, db) {
  const cookies = Object.fromEntries(
    (request.headers.cookie ?? '').split(';').filter(Boolean).map((part) => {
      const [name, ...value] = part.trim().split('=');
      try {
        return [name, decodeURIComponent(value.join('='))];
      } catch {
        return [name, ''];
      }
    })
  );
  const sessionId = verifySession(cookies.meta_ads_session, config.sessionSecret);
  const session = sessionId ? await db.getSession(sessionId) : null;

  if (session) {
    setSessionCookie(response, session.id, config);
    return session;
  }

  const createdSession = await db.createSession();
  setSessionCookie(response, createdSession.id, config);
  return createdSession;
}

function setSessionCookie(response, sessionId, config, now = Date.now()) {
  response.setHeader('Cache-Control', 'private, no-store');
  const signedSession = signSession(sessionId, config.sessionSecret);
  const secureAttribute = config.isProduction ? '; Secure' : '';
  const expires = new Date(now + SESSION_COOKIE_MAX_AGE_SECONDS * 1000).toUTCString();
  response.setHeader(
    'Set-Cookie',
    `meta_ads_session=${encodeURIComponent(signedSession)}; Path=/; Max-Age=${SESSION_COOKIE_MAX_AGE_SECONDS}; Expires=${expires}; HttpOnly; SameSite=Lax${secureAttribute}`
  );
}

async function getConnectedMetaConnection({ response, session, db }) {
  if (!session.metaUserId) {
    sendJson(response, 401, { error: 'Connect Meta first' });
    return null;
  }

  const connection = await db.getConnection(session.metaUserId);
  if (!connection) {
    sendJson(response, 401, { error: 'Connect Meta first' });
    return null;
  }

  return connection;
}

function isAdAccountId(value) {
  return typeof value === 'string' && /^act_\d+$/.test(value);
}
