import { catalogCounts, mergePageCatalog } from './page-catalog.js';
import { createMetaRateLimiter, createSharedCooldowns } from './meta-rate-limiter.js';
import { setTimeout as sleep } from 'node:timers/promises';
import { createMetaReadCache } from './meta-read-cache.js';
import { recordError } from './error-journal.js';
import { getDefaultAutoSelectFamilyAttemptTimeout, setDefaultAutoSelectFamilyAttemptTimeout } from 'node:net';
import { recordMetaApiCall } from './meta-api-metrics.js';

const responseDiagnostics = new WeakMap();
const metaDiagnostic = Symbol('metaDiagnostic');

const targetingSearchMap = {
  interest: { type: 'adinterest', targetingField: 'interests' },
  behavior: { type: 'adTargetingCategory', className: 'behaviors', targetingField: 'behaviors' },
  demographic: { type: 'adTargetingCategory', className: 'demographics', targetingField: null }
};

const demographicFields = new Set([
  'life_events',
  'industries',
  'income',
  'family_statuses',
  'education_statuses',
  'relationship_statuses'
]);

const oauthScopes = [
  'ads_read',
  'ads_management',
  'pages_show_list',
  'pages_read_engagement',
  'pages_read_user_content',
  'pages_manage_ads',
  'pages_manage_engagement',
  'business_management'
];

export function createMetaClient(config, { fetchImpl = fetch, networkRetryDelay = sleep } = {}) {
  // Node's 250 ms address fallback was timing out IPv4 before trying an unreachable IPv6 route.
  if (getDefaultAutoSelectFamilyAttemptTimeout() < 1000) setDefaultAutoSelectFamilyAttemptTimeout(1000);
  const rawFetch = fetchImpl;
  const rateLimiter = createMetaRateLimiter({ cooldowns: createSharedCooldowns(config.metaReadCacheDirectory) });
  fetchImpl = async (input, options = {}) => {
    const timeoutSignal = AbortSignal.timeout(config.metaRequestTimeoutMs ?? 300_000);
    options = { ...options, signal: options.signal ? AbortSignal.any([options.signal, timeoutSignal]) : timeoutSignal };
    for (let attempt = 0; ; attempt++) {
      const release = await rateLimiter.acquire(options.signal, input).catch(error => {
        error.notDispatched = true;
        throw error;
      });
      const startedAt = Date.now();
      let responseReceived = false;
      const target = new URL(input);
      const secrets = [new Headers(options.headers).get('authorization')?.replace(/^Bearer\s+/i, ''),
        ...[...target.searchParams].filter(([key]) => /token|secret|code/i.test(key)).map(([, value]) => value)];
      try {
        if (options.signal.aborted) throw Object.assign(new DOMException('Request was cancelled before dispatch', 'AbortError'), { notDispatched: true });
        const response = await rawFetch(input, options);
        responseReceived = true;
        recordMetaApiCall(config.errorJournalDirectory, { input, options, response, startedAt, attempt: attempt + 1 });
        await rateLimiter.observe(response, input);
        const details = { secrets, method: options.method ?? 'GET', host: target.hostname, path: target.pathname,
          statusCode: response.status, startedAt, headersDurationMs: Date.now() - startedAt, attempt: attempt + 1 };
        responseDiagnostics.set(response, details);
        return response;
      } catch (error) {
        if (!responseReceived && !error.notDispatched) recordMetaApiCall(config.errorJournalDirectory, { input, options, error, startedAt, attempt: attempt + 1 });
        const readOnly = ['GET', 'HEAD'].includes(String(options.method ?? 'GET').toUpperCase());
        const causes = error?.cause?.errors?.length ? error.cause.errors : [error?.cause];
        const beforeConnect = isPreConnectFailure(error);
        const replayable = !options.body || typeof options.body === 'string' || options.body instanceof URLSearchParams || options.body instanceof FormData;
        if (error?.name === 'TypeError' && error.message === 'fetch failed') {
          error.networkCodes = [...new Set(causes.map(cause => cause?.code)
            .filter(code => typeof code === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(code)))];
          console.warn('[meta-network]', JSON.stringify({ method: options.method ?? 'GET',
            host: target.hostname, path: target.pathname, attempt: attempt + 1, codes: error.networkCodes }));
        }
        const retrying = !options.signal?.aborted && attempt < (readOnly ? 2 : 1)
          && error?.name === 'TypeError' && error.message === 'fetch failed' && (readOnly || beforeConnect && replayable);
        recordError(error, { stage: 'meta-request', method: options.method ?? 'GET', host: target.hostname,
          path: target.pathname, durationMs: Date.now() - startedAt, attempt: attempt + 1,
          retrying, networkCodes: error.networkCodes }, secrets);
        // Reads can be replayed; writes get one retry only when no connection was established.
        if (!retrying) throw error;
      } finally {
        release();
      }
      try { await networkRetryDelay([1000, 3000][attempt], undefined, { signal: options.signal }); }
      catch (error) { error.notDispatched = true; throw error; }
    }
  };
  fetchImpl.rateLimiter = rateLimiter;
  fetchImpl.readCache = createMetaReadCache({
    directory: config.metaReadCacheDirectory,
    encryptionKey: config.tokenEncryptionKey
  });
  const graphBaseUrl = `https://graph.facebook.com/${config.apiVersion}`;
  const graphVideoBaseUrl = `https://graph-video.facebook.com/${config.apiVersion}`;

  return {
    getRateLimitStatus: () => rateLimiter.status(),
    createAuthorizationUrl(state) {
      const url = new URL(`https://www.facebook.com/${config.apiVersion}/dialog/oauth`);
      url.searchParams.set('client_id', config.appId);
      url.searchParams.set('redirect_uri', config.redirectUri);
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('state', state);
      url.searchParams.set('config_id', config.loginConfigId);
      url.searchParams.set('scope', oauthScopes.join(','));
      return url.toString();
    },

    async exchangeCode(code) {
      const payload = await requestJson(fetchImpl, `${graphBaseUrl}/oauth/access_token`, {
        client_id: config.appId,
        client_secret: config.appSecret,
        redirect_uri: config.redirectUri,
        code
      });
      return { accessToken: payload.access_token };
    },

    async getProfile(token) {
      const payload = await requestJson(fetchImpl, `${graphBaseUrl}/me`, { fields: 'id,name' }, token);
      return { id: payload.id, name: payload.name };
    },

    async listAdAccounts(token) {
      const data = await requestPaged(fetchImpl, `${graphBaseUrl}/me/adaccounts`, {
        fields: 'id,name,account_id,currency,account_status,disable_reason,permitted_tasks',
        limit: '100'
      }, token);
      return data.map(publicAdAccount);
    },

    async listPages(token) {
      return fetchManagedPages(fetchImpl, graphBaseUrl, token);
    },

    async listPromotablePages(token, adAccountId) {
      return fetchPromotablePages(fetchImpl, graphBaseUrl, token, adAccountId);
    },

    async listGlobalPageCatalog(token) {
      const [managedPages, businessPages] = await Promise.all([
        fetchManagedPages(fetchImpl, graphBaseUrl, token),
        fetchBusinessPages(fetchImpl, graphBaseUrl, token)
      ]);
      const pages = mergePageCatalog({
        MANAGED: managedPages,
        BUSINESS_OWNED: businessPages.ownedPages,
        BUSINESS_CLIENT: businessPages.clientPages
      });
      return {
        pages,
        discovery: {
          requiresBusinessReconnect: businessPages.requiresBusinessReconnect,
          warnings: businessPages.warnings,
          counts: catalogCounts(pages)
        }
      };
    },

    async getPermissionStatus(token, permissionNames) {
      return fetchPermissionStatus(fetchImpl, graphBaseUrl, token, permissionNames);
    },

    async listPageCatalog(token, adAccountId) {
      const [promotablePages, managedPages, businessPages] = await Promise.all([
        fetchPromotablePages(fetchImpl, graphBaseUrl, token, adAccountId),
        fetchManagedPages(fetchImpl, graphBaseUrl, token),
        fetchBusinessPages(fetchImpl, graphBaseUrl, token)
      ]);
      const pages = mergePageCatalog({
        PROMOTABLE: promotablePages,
        MANAGED: managedPages,
        BUSINESS_OWNED: businessPages.ownedPages,
        BUSINESS_CLIENT: businessPages.clientPages
      });
      return {
        pages,
        discovery: {
          requiresBusinessReconnect: businessPages.requiresBusinessReconnect,
          warnings: businessPages.warnings,
          counts: catalogCounts(pages)
        }
      };
    },

    async getPagePublishingContext(token, pageIds) {
      const requestedPageIds = new Set((pageIds ?? []).map(String));
      const [permissions, managedPages] = await Promise.all([
        requestPaged(fetchImpl, `${graphBaseUrl}/me/permissions`, {
          fields: 'permission,status',
          limit: '100'
        }, token),
        requestPaged(fetchImpl, `${graphBaseUrl}/me/accounts`, {
          fields: 'id,name,tasks,access_token',
          limit: '100'
        }, token)
      ]);

      return {
        permissionGranted: permissions.some(
          (permission) => permission.permission === 'pages_manage_posts' && permission.status === 'granted'
        ),
        pages: new Map(managedPages
          .filter((page) => requestedPageIds.has(String(page.id)))
          .map((page) => [String(page.id), {
            accessToken: page.access_token ?? '',
            name: page.name ?? String(page.id),
            tasks: page.tasks ?? []
          }]))
      };
    },

    async getPageEngagementContext(token, pageIds) {
      const requestedPageIds = new Set((pageIds ?? []).map(String));
      const [permissions, managedPages] = await Promise.all([
        fetchPermissionStatus(fetchImpl, graphBaseUrl, token, ['pages_manage_engagement']),
        requestPaged(fetchImpl, `${graphBaseUrl}/me/accounts`, {
          fields: 'id,name,tasks,access_token',
          limit: '100'
        }, token)
      ]);

      return {
        permissionGranted: permissions.pages_manage_engagement,
        pages: new Map(managedPages
          .filter((page) => requestedPageIds.has(String(page.id)))
          .map((page) => [String(page.id), {
            accessToken: page.access_token ?? '',
            name: page.name ?? String(page.id),
            tasks: page.tasks ?? []
          }]))
      };
    },

    async listCustomAudiences(token, accountId) {
      const data = await requestPaged(fetchImpl, `${graphBaseUrl}/${accountId}/customaudiences`, {
        fields: 'id,name,subtype,delivery_status',
        limit: '100'
      }, token);
      return data.map((audience) => ({
        id: audience.id,
        name: audience.name,
        subtype: audience.subtype,
        deliveryStatus: audience.delivery_status
      }));
    },

    async listSavedAudiences(token, accountId) {
      const data = await requestPaged(fetchImpl, `${graphBaseUrl}/${accountId}/saved_audiences`, {
        fields: 'id,name,description,targeting,operation_status,run_status',
        limit: '100'
      }, token);
      return data.map(normalizeSavedAudience);
    },

    async searchTargeting(token, { category, query }) {
      const mapping = targetingSearchMap[category];
      if (!mapping) {
        throw new Error('Unsupported targeting category');
      }

      const params = { type: mapping.type, q: query, limit: '50' };
      if (mapping.className) {
        params.class = mapping.className;
      }
      const payload = await requestJson(fetchImpl, `${graphBaseUrl}/search`, params, token);

      return (payload.data ?? []).map((item) => {
        const targetingField = mapping.targetingField ?? demographicTargetingField(item);
        if (!targetingField) {
          return null;
        }
        return {
          id: item.id,
          name: item.name,
          path: Array.isArray(item.path) ? item.path : [],
          targetingField
        };
      }).filter(Boolean);
    },

    async searchLocations(token, query) {
      const payload = await requestJson(fetchImpl, `${graphBaseUrl}/search`, {
        type: 'adgeolocation',
        q: query,
        location_types: JSON.stringify(['region', 'city']),
        country_code: 'VN',
        limit: '50'
      }, token, { signal: AbortSignal.timeout(8000) });

      const seen = new Set();
      return (payload.data ?? []).filter((item) => {
        const key = String(item.key ?? '');
        const type = item.type === 'city' ? 'city' : item.type === 'region' ? 'region' : '';
        const identity = `${type}:${key}`;
        if (!key || !type || item.country_code !== 'VN' || seen.has(identity)) {
          return false;
        }
        seen.add(identity);
        return true;
      }).map((item) => ({
        key: String(item.key),
        name: item.name,
        type: item.type,
        countryCode: 'VN',
        ...(item.type === 'city' ? { region: item.region ?? '' } : {}),
        ...(validCoordinate(item.latitude, -90, 90) && validCoordinate(item.longitude, -180, 180)
          ? { latitude: Number(item.latitude), longitude: Number(item.longitude) }
          : {})
      }));
    },

    async createCampaign(token, accountId, params, options = {}) {
      const payload = await postParams(fetchImpl, `${graphBaseUrl}/${accountId}/campaigns`, token, params, options);
      return payload.id;
    },

    async createAdSet(token, accountId, params, options = {}) {
      const payload = await postParams(fetchImpl, `${graphBaseUrl}/${accountId}/adsets`, token, params, options);
      return payload.id;
    },

    async uploadImage(token, accountId, media, options = {}) {
      const resolvedMedia = await resolveImageMedia(rawFetch, media, options);
      const payload = await uploadMedia(fetchImpl, `${graphBaseUrl}/${accountId}/adimages`, token, resolvedMedia, {}, options);
      const uploadedImage = Object.values(payload.images ?? {})[0];
      if (!uploadedImage?.hash) {
        throw new Error('Meta không trả về image hash');
      }
      return uploadedImage.hash;
    },

    async uploadVideo(token, accountId, media, options = {}) {
      const sourceUrl = typeof media?.sourceUrl === 'string' ? media.sourceUrl.trim() : '';
      let parsedSourceUrl;
      try {
        parsedSourceUrl = new URL(sourceUrl);
      } catch {}
      if (!parsedSourceUrl || !['http:', 'https:'].includes(parsedSourceUrl.protocol)) {
        throw new Error('Video chưa có link nguồn R2 để Meta tải; không dùng upload chia mảnh');
      }

      let payload;
      for (let attempt = 0; ; attempt++) {
        try {
          payload = await postParams(
            fetchImpl,
            `${graphVideoBaseUrl}/${accountId}/advideos`,
            token,
            new URLSearchParams({ file_url: sourceUrl, title: media.name }),
            options
          );
          break;
        } catch (error) {
          // Only retry the explicit video import failure, never ad writes or unknown responses.
          if (attempt !== 0 || error.statusCode !== 500 || Number(error.meta?.code) !== 1
            || !/Please reduce the amount of data/i.test(error.meta?.message ?? '')) throw error;
          recordError(error, { stage: 'meta-video-import-retry', method: 'POST',
            host: 'graph-video.facebook.com', path: `/${config.apiVersion}/${accountId}/advideos`,
            attempt: 1, retrying: true }, [token, sourceUrl]);
          await networkRetryDelay(5000, undefined, { signal: options.signal });
          options.signal?.throwIfAborted();
        }
      }
      if (!payload.id) {
        throw new Error('Meta không trả về video ID');
      }
      return String(payload.id);
    },

    async getVideoStatus(token, videoId, options = {}) {
      const payload = await fetchImpl.readCache.load(
        JSON.stringify(['ready-video-thumbnail', graphBaseUrl, token, videoId]), 30 * 60_000,
        () => requestJson(fetchImpl, `${graphBaseUrl}/${videoId}`, {
          fields: 'status,thumbnails'
        }, token, options),
        { shouldCache: value => value?.status?.video_status === 'ready' && Boolean(value.thumbnails?.data?.[0]?.uri) }
      );
      const thumbnail = payload.thumbnails?.data?.[0];
      return {
        status: payload.status,
        thumbnail: thumbnail ? { imageUrl: thumbnail.uri } : undefined
      };
    },

    async createPublicPhotoPost(pageToken, pageId, media, message, options = {}) {
      const payload = await uploadMedia(
        fetchImpl,
        `${graphBaseUrl}/${pageId}/photos`,
        pageToken,
        media,
        { caption: message, published: 'true' },
        options
      );
      const photoId = payload.id;
      let postId = payload.post_id;
      if (!postId && photoId) {
        const photo = await requestJson(fetchImpl, `${graphBaseUrl}/${photoId}`, {
          fields: 'page_story_id'
        }, pageToken, options);
        postId = photo.page_story_id;
      }
      if (!photoId || !postId) {
        throw new Error('Meta không trả về ID bài viết công khai sau khi đăng ảnh');
      }
      return { photoId: String(photoId), postId: String(postId) };
    },

    async deletePagePost(pageToken, postId, options = {}) {
      const url = `${graphBaseUrl}/${postId}`;
      const payload = await sendWithThrottleRetry(() => fetchImpl(url, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${pageToken}` },
        signal: options.signal
      }), options.signal, rateLimiter, url);
      if (payload.success !== true) {
        throw new Error('Meta không xác nhận đã xóa bài viết công khai');
      }
      return true;
    },

    readModerationPost: (token, postId, options) => requestJson(fetchImpl, `${graphBaseUrl}/${postId}`, { fields: 'id,created_time' }, token, options),
    readModerationComment: (token, commentId, options) => requestJson(fetchImpl, `${graphBaseUrl}/${commentId}`, { fields: 'id,is_hidden' }, token, options),
    listModerationComments(token, postId, { after, cutoff, signal } = {}) {
      return requestJson(fetchImpl, `${graphBaseUrl}/${postId}/comments`, {
        fields: 'id,is_hidden,can_hide,created_time', filter: 'stream', order: 'chronological', limit: '10',
        ...(after ? { after } : {}), ...(cutoff ? { until: String(Math.floor(cutoff / 1000)) } : {})
      }, token, { signal });
    },
    async unhideComment(token, commentId, options) {
      const result = await postParams(fetchImpl, `${graphBaseUrl}/${commentId}`, token, new URLSearchParams({ is_hidden: 'false' }), options);
      if (result.success !== true) throw new Error('Meta did not confirm unhide');
      return true;
    },
    async createPageComment(pageToken, postId, { message, attachmentUrl }, options = {}) {
      const params = new URLSearchParams();
      if (String(message ?? '').trim()) params.set('message', String(message));
      if (attachmentUrl) params.set('attachment_url', attachmentUrl);
      const payload = await postParams(
        fetchImpl,
        `${graphBaseUrl}/${postId}/comments`,
        pageToken,
        params,
        options
      );
      if (!payload.id) {
        throw new Error('Meta không trả về Comment ID');
      }
      return String(payload.id);
    },

    async createCreative(token, accountId, params, options = {}) {
      const payload = await postParams(fetchImpl, `${graphBaseUrl}/${accountId}/adcreatives`, token, params, options);
      return payload.id;
    },

    async getAdIdentity(token, adId) {
      if (!/^\d+$/.test(String(adId))) throw new Error('Invalid Ad ID');
      return requestJson(fetchImpl, `${graphBaseUrl}/${adId}`, {
        fields: 'id,name,account_id,campaign_id,adset_id,creative{id}'
      }, token, { signal: AbortSignal.timeout(15000) });
    },

    async createAd(token, accountId, params, options = {}) {
      const payload = await postParams(fetchImpl, `${graphBaseUrl}/${accountId}/ads`, token, params, options);
      if (!((typeof payload?.id === 'string' && payload.id.trim()) || (typeof payload?.id === 'number' && payload.id > 0))) {
        const error = new Error('Meta trả về phản hồi nhưng thiếu Ad ID; hãy kiểm tra trên Meta trước khi thử tạo lại.');
        error.name = 'UncertainAdWriteError';
        throw error;
      }
      return payload.id;
    },

    async getAdPublication(token, adId, options = {}) {
      // Publication lookups must not spend the publishing deadline on a slow
      // Graph read or throttle backoff. A later refresh can retry missing IDs.
      const lookupSignal = AbortSignal.timeout(8000);
      const lookupOptions = { ...options, signal: options.signal
        ? AbortSignal.any([options.signal, lookupSignal]) : lookupSignal };
      const ad = await requestJson(fetchImpl, `${graphBaseUrl}/${adId}`, {
        fields: 'creative{effective_object_story_id,object_story_id,instagram_permalink_url}'
      }, token, lookupOptions);
      const creative = ad.creative ?? {};
      const rawPostId = creative.effective_object_story_id ?? creative.object_story_id ?? null;
      const postId = rawPostId ? String(rawPostId) : null;
      if (!postId) {
        return {
          postId: null,
          permalinkUrl: null
        };
      }
      const fallbackUrl = facebookPostFallbackUrl(postId);
      try {
        const post = await fetchImpl.readCache.load(
          JSON.stringify(['post-permalink', graphBaseUrl, token, postId]), 5 * 60_000,
          async () => {
            const read = (readToken = token) => requestJson(fetchImpl, `${graphBaseUrl}/${postId}`, {
              fields: 'permalink_url'
            }, readToken, { ...lookupOptions, signal: AbortSignal.any([
              lookupOptions.signal, AbortSignal.timeout(2500)
            ]) });
            // One permission probe per Page/token/5 minutes, shared by web and cron processes.
            const access = await fetchImpl.readCache.load(
              JSON.stringify(['post-permalink-access', graphBaseUrl, token, postId.split('_')[0]]), 5 * 60_000,
              async () => {
                let pageToken;
                // A user token can create Ads while only the Page token can read their posts.
                if (/^\d+$/.test(postId.split('_')[0])) {
                  try {
                    const page = await requestJson(fetchImpl, `${graphBaseUrl}/${postId.split('_')[0]}`,
                      { fields: 'access_token' }, token, { ...lookupOptions,
                        signal: AbortSignal.any([lookupOptions.signal, AbortSignal.timeout(2500)]) });
                    pageToken = page.access_token;
                  } catch (pageError) {
                    if (![10, 100, 200].includes(Number(pageError.meta?.code))) throw pageError;
                  }
                }
                try { return { postId, post: await read(pageToken), pageToken }; }
                catch (error) {
                  if (Number(error.meta?.code) !== 10) throw error;
                  return { denied: true };
                }
              }
            );
            if (access.denied) return {};
            return access.postId === postId ? access.post : read(access.pageToken);
          },
          { shouldCache: value => Boolean(value?.permalink_url) }
        );
        return {
          postId,
          permalinkUrl: post.permalink_url ?? fallbackUrl
        };
      } catch {
        return { postId, permalinkUrl: fallbackUrl };
      }
    },

    // Tra đối tượng đã tạo (campaigns/adsets/ads) cùng tên dưới một đối tượng cha, để nhận lại đối tượng mà lần chạy
    // trước tạo dở rồi bị ngắt. Chỉ trả những đối tượng khớp tên chính xác và (nếu có sinceMs) tạo sau mốc đó.
    async findCreatedObject(token, parentId, edge, name, { sinceMs, signal, creativeId } = {}) {
      if (!['campaigns', 'adsets', 'ads'].includes(edge)) throw new Error('Loại đối tượng cần tra không hợp lệ');
      const payload = await requestJson(fetchImpl, `${graphBaseUrl}/${parentId}/${edge}`, {
        fields: creativeId ? 'id,name,created_time,creative{id}' : 'id,name,created_time',
        filtering: JSON.stringify([{ field: 'name', operator: 'EQUAL', value: String(name) }]),
        limit: '25'
      }, token, { signal });
      if (creativeId && payload.paging?.next) throw new Error('Ad reconciliation is incomplete');
      return (payload.data ?? []).filter((item) => (
        item?.name === name
        && (!creativeId || String(item.creative?.id) === String(creativeId))
        && (!Number.isFinite(sinceMs) || Date.parse(item.created_time) >= sinceMs)
      ));
    },

    async copyAd(token, sourceAdId, targetAdSetId, options = {}) {
      const params = new URLSearchParams({
        adset_id: targetAdSetId,
        status_option: 'ACTIVE',
        rename_options: JSON.stringify({ rename_strategy: 'NO_RENAME' })
      });
      const payload = await postParams(fetchImpl, `${graphBaseUrl}/${sourceAdId}/copies`, token, params, options);
      const copiedAdId = payload.copied_ad_id ?? payload.id;
      if (!copiedAdId) {
        throw new Error('Meta không trả về ID quảng cáo sao chép');
      }
      return String(copiedAdId);
    }
  };
}

function publicAdAccount(account) {
  const accountStatus = Number(account.account_status);
  const canAdvertise = !Number.isFinite(accountStatus) || accountStatus === 1;
  return {
    id: account.id ?? `act_${account.account_id}`,
    name: account.name,
    currency: account.currency,
    accountStatus: Number.isFinite(accountStatus) ? accountStatus : null,
    canAdvertise,
    unavailableReason: canAdvertise ? null : adAccountStatusReason(accountStatus)
  };
}

function adAccountStatusReason(status) {
  const reasons = new Map([
    [2, 'Tài khoản quảng cáo đã bị vô hiệu hóa'],
    [3, 'Tài khoản quảng cáo có khoản thanh toán chưa hoàn tất'],
    [7, 'Tài khoản quảng cáo đang chờ Meta xem xét rủi ro'],
    [8, 'Tài khoản quảng cáo đang chờ xử lý thanh toán'],
    [9, 'Tài khoản quảng cáo đang trong thời gian gia hạn'],
    [100, 'Tài khoản quảng cáo đang chờ đóng'],
    [101, 'Tài khoản quảng cáo đã đóng']
  ]);
  return reasons.get(status) ?? `Tài khoản quảng cáo không hoạt động (trạng thái ${status})`;
}

async function resolveImageMedia(fetchImpl, media, { signal } = {}) {
  if (media.content !== undefined && media.content !== null) return media;
  if (!media.sourceUrl) throw new Error('Không tìm thấy dữ liệu ảnh để tải lên Meta');
  const response = await fetchImpl(media.sourceUrl, { signal });
  if (!response.ok) throw new Error(`Không tải được ảnh từ kho lưu trữ [HTTP ${response.status}]`);
  return {
    ...media,
    content: Buffer.from(await response.arrayBuffer())
  };
}

function facebookPostFallbackUrl(postId) {
  const value = String(postId ?? '').trim();
  if (/^\d+$/.test(value)) return `https://www.facebook.com/${value}`;
  const match = /^(\d+)_(\d+)$/.exec(value);
  return match ? `https://www.facebook.com/${match[1]}/posts/${match[2]}` : null;
}

export function normalizeMetaError(payload, status) {
  const source = payload?.error ?? payload ?? {};
  const mainMessage = source.message ?? (status === 413
    ? 'Meta từ chối vì dữ liệu tải lên quá lớn'
    : 'Meta API request failed');
  const userMsg = source.error_user_msg || source.error_user_title;
  const detailMessage = userMsg ? ` - ${userMsg}` : '';
  const subcodeText = source.error_subcode
    ? ` [Code ${source.code ?? status}, Subcode ${source.error_subcode}]`
    : (!source.message && status ? ` [HTTP ${status}]` : '');
  return {
    message: `${mainMessage}${detailMessage}${subcodeText}`,
    type: source.type ?? 'MetaApiError',
    code: source.code ?? status,
    subcode: source.error_subcode ?? null,
    fbtraceId: source.fbtrace_id ?? null
  };
}

async function fetchManagedPages(fetchImpl, graphBaseUrl, token) {
  return requestPageCatalogEdge(fetchImpl, `${graphBaseUrl}/me/accounts`, token);
}

async function fetchPromotablePages(fetchImpl, graphBaseUrl, token, adAccountId) {
  return requestPaged(fetchImpl, `${graphBaseUrl}/${adAccountId}/promote_pages`, {
    fields: 'id,name',
    limit: '100'
  }, token);
}

async function requestPageCatalogEdge(fetchImpl, url, token) {
  try {
    return await requestPaged(fetchImpl, url, {
      fields: 'id,name,tasks,promotion_ineligible_reason',
      limit: '100'
    }, token);
  } catch (error) {
    if (!/promotion_ineligible_reason|nonexisting field|unknown field/i.test(String(error?.message ?? ''))) throw error;
    return requestPaged(fetchImpl, url, {
      fields: 'id,name,tasks',
      limit: '100'
    }, token);
  }
}

async function fetchPermissionStatus(fetchImpl, graphBaseUrl, token, permissionNames) {
  const requestedPermissions = [...new Set((permissionNames ?? []).map(String))];
  const permissions = await requestPaged(fetchImpl, `${graphBaseUrl}/me/permissions`, {
    fields: 'permission,status',
    limit: '100'
  }, token);
  const grantedPermissions = new Set(permissions
    .filter((permission) => permission.status === 'granted')
    .map((permission) => permission.permission));
  return Object.fromEntries(requestedPermissions.map((permission) => [permission, grantedPermissions.has(permission)]));
}

async function fetchBusinessPages(fetchImpl, graphBaseUrl, token) {
  let businesses;
  try {
    businesses = await requestPaged(fetchImpl, `${graphBaseUrl}/me/businesses`, {
      fields: 'id,name',
      limit: '100'
    }, token);
  } catch (error) {
    if (!isMissingBusinessPermission(error)) throw error;
    return {
      ownedPages: [],
      clientPages: [],
      requiresBusinessReconnect: true,
      warnings: ['Kết nối lại Meta để tải Page trong Business Portfolio']
    };
  }

  const ownedPages = [];
  const clientPages = [];
  const warnings = [];
  await Promise.all(businesses.map(async (business) => {
    const edges = await Promise.allSettled([
      requestPageCatalogEdge(fetchImpl, `${graphBaseUrl}/${business.id}/owned_pages`, token),
      requestPageCatalogEdge(fetchImpl, `${graphBaseUrl}/${business.id}/client_pages`, token)
    ]);
    if (edges[0].status === 'fulfilled') ownedPages.push(...edges[0].value);
    else warnings.push(`Không tải được Page sở hữu của ${business.name ?? business.id}`);
    if (edges[1].status === 'fulfilled') clientPages.push(...edges[1].value);
    else warnings.push(`Không tải được Page đối tác của ${business.name ?? business.id}`);
  }));

  return { ownedPages, clientPages, requiresBusinessReconnect: false, warnings };
}

function isMissingBusinessPermission(error) {
  return [100, 200].includes(Number(error?.meta?.code)) &&
    /permission|business_management/i.test(String(error?.message ?? error?.meta?.message ?? ''));
}

async function requestPaged(fetchImpl, initialUrl, params, token) {
  // Cache only resource discovery, never mutations, video polling or ad results.
  if (/\/(?:me\/(?:permissions|accounts|businesses)|[^/]+\/(?:owned_pages|client_pages))$/.test(new URL(initialUrl).pathname)) {
    // Discovery may match the workspace's 15-minute cache. Permissions and Page tokens keep 5 minutes.
    const discoveryOnly = /\/(?:me\/businesses|[^/]+\/(?:owned_pages|client_pages))$/.test(new URL(initialUrl).pathname)
      && !String(params.fields ?? '').includes('access_token');
    return fetchImpl.readCache.load(JSON.stringify([initialUrl, params, token]), (discoveryOnly ? 15 : 5) * 60_000,
      () => requestPagedUncached(fetchImpl, initialUrl, params, token, AbortSignal.timeout(60_000)));
  }
  return requestPagedUncached(fetchImpl, initialUrl, params, token);
}

async function requestPagedUncached(fetchImpl, initialUrl, params, token, signal) {
  const firstUrl = new URL(initialUrl);
  for (const [key, value] of Object.entries(params)) {
    firstUrl.searchParams.set(key, value);
  }

  const data = [];
  let nextUrl = firstUrl.toString();
  while (nextUrl) {
    const response = await sendWithThrottleRetry(
      () => fetchImpl(nextUrl, { headers: { authorization: `Bearer ${token}` }, signal }),
      signal,
      fetchImpl.rateLimiter,
      nextUrl
    );
    const payload = response;

    data.push(...(payload.data ?? []));
    nextUrl = payload.paging?.next ?? null;
  }

  return data;
}

async function requestJson(fetchImpl, url, params, token, { signal } = {}) {
  const target = new URL(url);
  for (const [key, value] of Object.entries(params)) {
    target.searchParams.set(key, value);
  }

  return sendWithThrottleRetry(() => fetchImpl(target, {
    headers: token ? { authorization: `Bearer ${token}` } : undefined,
    signal
  }), signal, fetchImpl.rateLimiter, target);
}

async function postParams(fetchImpl, url, token, params, { signal } = {}) {
  try {
    const payload = await sendWithThrottleRetry(() => fetchImpl(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/x-www-form-urlencoded'
      },
      body: params.toString(),
      signal
    }), signal, fetchImpl.rateLimiter, url);
    if (['campaigns', 'adsets', 'adcreatives', 'advideos'].includes(new URL(url).pathname.split('/').at(-1))
      && !((typeof payload?.id === 'string' && payload.id.trim()) || (typeof payload?.id === 'number' && payload.id > 0))) {
      throw new TypeError('fetch failed', { cause: Object.assign(new Error('Meta response is missing an object ID'), { code: 'META_MISSING_ID' }) });
    }
    return payload;
  } catch (error) {
    if (error?.definiteRejection || error?.notDispatched) throw error;
    const beforeConnect = isPreConnectFailure(error);
    if ((error?.name === 'TypeError' && error.message === 'fetch failed' && !beforeConnect)
      || ['AbortError', 'TimeoutError'].includes(error?.name)) {
      const uncertain = new TypeError('fetch failed', { cause: error });
      uncertain.uncertainWrite = true;
      throw uncertain;
    }
    throw error;
  }
}

function isPreConnectFailure(error) {
  const causes = error?.cause?.errors?.length ? error.cause.errors : [error?.cause];
  return causes.every(cause => ['EAI_AGAIN', 'ENOTFOUND', 'ECONNREFUSED', 'ENETUNREACH', 'EHOSTUNREACH', 'UND_ERR_CONNECT_TIMEOUT'].includes(cause?.code)
    || cause?.code === 'ETIMEDOUT' && cause.syscall === 'connect');
}

async function uploadMedia(fetchImpl, url, token, media, fields = {}, { signal } = {}) {
  const formData = new FormData();
  formData.set('source', new Blob([media.content], { type: media.mimeType }), media.name);
  for (const [key, value] of Object.entries(fields)) {
    formData.set(key, String(value));
  }
  return sendWithThrottleRetry(() => fetchImpl(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: formData,
    signal
  }), signal, fetchImpl.rateLimiter, url);
}

async function readPayload(response) {
  const details = responseDiagnostics.get(response);
  try {
    const payload = await response.json();
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Meta response is not a JSON object');
    if (!response.ok) {
      const error = new Error(normalizeMetaError(payload, response.status).message);
      error.meta = normalizeMetaError(payload, response.status);
      const event = recordError(error, { ...details, durationMs: details ? Date.now() - details.startedAt : undefined,
        stage: 'meta-response', statusCode: response.status }, details?.secrets);
      if (payload && typeof payload === 'object') Object.defineProperty(payload, metaDiagnostic, { value: event });
    }
    return payload;
  } catch (error) {
    recordError(error, { ...details, durationMs: details ? Date.now() - details.startedAt : undefined,
      stage: 'meta-response-json', statusCode: response.status }, details?.secrets);
    throw new TypeError('fetch failed', { cause: error });
  }
}

// Meta rate limit: HTTP 429, hoặc code 4/17/32/613 (app/user/page), 80000-80014 (business use case).
const THROTTLE_RETRY_DELAYS_MS = [30_000, 60_000, 120_000, 300_000];
const MAX_INLINE_THROTTLE_WAIT_MS = 30_000;
// A throttle response means Meta did not run the request, so one short retry is safe even for
// writes; after that the caller defers with retryAfterMs instead of adding more quota pressure.
const MAX_INLINE_THROTTLE_RETRIES = 1;

export function isThrottleResponse(status, payload) {
  const code = Number(payload?.error?.code);
  return status === 429 || [4, 17, 32, 613].includes(code) || (code >= 80000 && code <= 80014);
}

export function isMetaThrottleError(error) {
  return error?.name === 'MetaThrottleError' || error?.retryable === true && Number(error?.statusCode) === 429;
}

export function throttleWaitMs(response, attempt) {
  const retryAfter = Number(response.headers?.get?.('retry-after'));
  if (retryAfter > 0) return retryAfter * 1000;
  try {
    const usage = JSON.parse(response.headers?.get?.('x-business-use-case-usage') ?? '');
    const minutes = Object.values(usage).flat().map((entry) => Number(entry?.estimated_time_to_regain_access)).find((value) => value > 0);
    if (minutes) return minutes * 60_000;
  } catch {}
  return THROTTLE_RETRY_DELAYS_MS[attempt];
}

async function sendWithThrottleRetry(send, signal, rateLimiter, url) {
  for (let attempt = 0; ; attempt += 1) {
    const response = await send();
    const payload = await readPayload(response);
    if (response.ok) return payload;
    const waitMs = isThrottleResponse(response.status, payload) ? throttleWaitMs(response, attempt) : undefined;
    if (!(waitMs > 0)) throwMetaError(payload, response.status);
    await rateLimiter?.recordThrottle(waitMs, { url, code: payload?.error?.code, headers: response.headers });
    // App-wide limit responses are already quota pressure; retrying the same
    // request here only amplifies the burst before the durable workflow queue.
    if (Number(payload?.error?.code) === 4) throwMetaThrottle(payload, response.status, waitMs);
    if (waitMs > MAX_INLINE_THROTTLE_WAIT_MS || attempt >= MAX_INLINE_THROTTLE_RETRIES) {
      throwMetaThrottle(payload, response.status, waitMs);
    }
    try { await sleep(waitMs, undefined, { signal }); }
    catch (error) { error.definiteRejection = true; throw error; }
  }
}

function throwMetaThrottle(payload, status, retryAfterMs) {
  const error = new Error('Đang chờ hạn mức Meta');
  error.name = 'MetaThrottleError';
  error.statusCode = 429;
  error.retryable = true;
  error.retryAfterMs = retryAfterMs;
  error.meta = payload?.[metaDiagnostic]?.error?.meta ?? normalizeMetaError(payload, status);
  error.diagnosticId = payload?.[metaDiagnostic]?.id;
  throw error;
}

function throwMetaError(payload, status) {
  const meta = payload?.[metaDiagnostic]?.error?.meta ?? normalizeMetaError(payload, status);
  const error = new Error(meta.message);
  error.meta = meta;
  error.statusCode = status;
  error.diagnosticId = payload?.[metaDiagnostic]?.id;
  throw error;
}

function demographicTargetingField(item) {
  const candidate = item.type ?? item.targeting_field ?? item.class;
  return demographicFields.has(candidate) ? candidate : null;
}

function normalizeSavedAudience(audience) {
  const targeting = audience.targeting ?? {};
  const issues = [];
  const ageRange = Array.isArray(targeting.age_range) && targeting.age_range.length === 2
    ? targeting.age_range.map(Number) : null;
  const advantageAudienceEnabled = Number(targeting.targeting_automation?.advantage_audience) === 1;
  // With Advantage+, age_min is a control; age_range is the saved age suggestion.
  const ageMin = Number((advantageAudienceEnabled ? ageRange?.[0] : null) ?? targeting.age_min ?? ageRange?.[0] ?? 18);
  const ageMax = Number((advantageAudienceEnabled ? ageRange?.[1] : null) ?? targeting.age_max ?? ageRange?.[1] ?? 65);
  const audienceControlAgeMin = Number(targeting.age_min ?? 18);
  if (!Number.isInteger(ageMin) || !Number.isInteger(ageMax) || ageMin < 13 || ageMax > 65 || ageMin > ageMax) {
    issues.push('Khoảng tuổi từ Meta không hợp lệ');
  }
  if (targeting.age_range != null && !ageRange) issues.push('Khoảng tuổi gợi ý từ Meta không hợp lệ');
  if (advantageAudienceEnabled && (!Number.isInteger(audienceControlAgeMin) || audienceControlAgeMin < 13 || audienceControlAgeMin > ageMin)) {
    issues.push('Tuổi tối thiểu kiểm soát Advantage+ không hợp lệ');
  }
  const includedRegions = savedRegions(targeting.geo_locations, issues, 'bao gồm');
  const excludedRegions = savedRegions(targeting.excluded_geo_locations, issues, 'loại trừ');
  const includedCities = savedCities(targeting.geo_locations, issues, 'bao gồm');
  const excludedCities = savedCities(targeting.excluded_geo_locations, issues, 'loại trừ');
  const includedCustomLocations = [
    ...savedPlaces(targeting.geo_locations, issues, 'bao gồm'),
    ...savedCustomLocations(targeting.geo_locations, issues, 'bao gồm')
  ];
  const excludedCustomLocations = [
    ...savedPlaces(targeting.excluded_geo_locations, issues, 'loại trừ'),
    ...savedCustomLocations(targeting.excluded_geo_locations, issues, 'loại trừ')
  ];
  const flexibleSpec = Array.isArray(targeting.flexible_spec) ? targeting.flexible_spec : [];
  if (flexibleSpec.length > 1) issues.push('Có nhiều nhóm nhắm mục tiêu AND');
  if (Array.isArray(targeting.exclusions) && targeting.exclusions.length > 0) {
    issues.push('Có loại trừ nhắm mục tiêu chi tiết');
  }
  const detailedTargeting = [];
  const group = flexibleSpec[0] ?? {};
  for (const [targetingField, items] of Object.entries(group)) {
    if (!['interests', 'behaviors', ...demographicFields].includes(targetingField)) {
      if (Array.isArray(items) && items.length > 0) issues.push(`Chưa hỗ trợ ${targetingField}`);
      continue;
    }
    for (const item of items ?? []) {
      if (!item?.id) continue;
      detailedTargeting.push({
        id: String(item.id),
        name: item.name ?? String(item.id),
        targetingField
      });
    }
  }
  return {
    id: String(audience.id),
    name: audience.name ?? String(audience.id),
    description: audience.description ?? '',
    compatible: issues.length === 0,
    issues,
    content: {
      ageMin,
      ageMax,
      ...(advantageAudienceEnabled ? { advantageAudienceEnabled, audienceControlAgeMin } : {}),
      genders: (targeting.genders ?? []).map(Number),
      locales: (targeting.locales ?? []).map(Number),
      includedRegions,
      excludedRegions,
      includedCities,
      excludedCities,
      includedCustomLocations,
      excludedCustomLocations,
      includedCustomAudienceIds: (targeting.custom_audiences ?? []).map((item) => String(item.id)),
      excludedCustomAudienceIds: (targeting.excluded_custom_audiences ?? []).map((item) => String(item.id)),
      detailedTargeting
    }
  };
}

function savedRegions(geoLocations = {}, issues, label) {
  const unsupported = ['countries', 'zips', 'geo_markets', 'electoral_districts']
    .some((field) => Array.isArray(geoLocations?.[field]) && geoLocations[field].length > 0);
  if (unsupported) issues.push(`Vị trí ${label} không chỉ gồm tỉnh/thành phố Việt Nam`);
  return (geoLocations?.regions ?? []).map((region) => ({
    key: String(region.key),
    name: region.name ?? String(region.key),
    type: 'region',
    countryCode: 'VN'
  }));
}

function savedCustomLocations(geoLocations = {}, issues, label) {
  return (geoLocations?.custom_locations ?? []).flatMap((location, index) => {
    const latitude = Number(location?.latitude);
    const longitude = Number(location?.longitude);
    const radius = Number(location?.radius);
    const distanceUnit = location.distance_unit ?? 'kilometer';
    if (!validCoordinate(location?.latitude, -90, 90)
      || !validCoordinate(location?.longitude, -180, 180)
      || !validSavedRadius(radius, distanceUnit)) {
      issues.push(`Ghim bán kính ${label} không hợp lệ`);
      return [];
    }
    return [{
      key: `pin:${latitude.toFixed(6)},${longitude.toFixed(6)}`,
      name: location.name || location.address_string || `Vị trí ghim ${index + 1}`,
      type: 'custom_location',
      countryCode: 'VN',
      latitude,
      longitude,
      radius,
      distanceUnit
    }];
  });
}

function savedPlaces(geoLocations = {}, issues, label) {
  return (geoLocations?.places ?? []).flatMap((place) => {
    const metaPlaceKey = String(place.key ?? '').trim();
    const radius = Number(place.radius);
    const distanceUnit = place.distance_unit ?? 'kilometer';
    if (!metaPlaceKey || !validSavedRadius(radius, distanceUnit)) {
      issues.push(`Địa điểm Meta ${label} không hợp lệ`);
      return [];
    }
    // Places are key-based Meta targets, not interchangeable with coordinate pins.
    // Keep them even if Meta omits the optional coordinates used for map preview.
    return [{
      key: `place:${metaPlaceKey}`,
      metaPlaceKey,
      name: place.name || metaPlaceKey,
      type: 'place',
      countryCode: place.country ?? 'VN',
      ...(validCoordinate(place.latitude, -90, 90) && validCoordinate(place.longitude, -180, 180)
        ? { latitude: Number(place.latitude), longitude: Number(place.longitude) } : {}),
      radius,
      distanceUnit
    }];
  });
}

function validCoordinate(value, minimum, maximum) {
  if (!['number', 'string'].includes(typeof value) || String(value).trim() === '') return false;
  const number = Number(value);
  return Number.isFinite(number) && number >= minimum && number <= maximum;
}


function savedCities(geoLocations = {}, issues, label) {
  return (geoLocations?.cities ?? []).flatMap((city) => {
    const radius = city.radius == null ? null : Number(city.radius);
    const distanceUnit = city.distance_unit ?? 'kilometer';
    if (!city?.key || (radius !== null && !validSavedRadius(radius, distanceUnit))) {
      issues.push(`Vị trí bán kính ${label} không hợp lệ`);
      return [];
    }
    return [{
      key: String(city.key),
      name: city.name ?? String(city.key),
      type: 'city',
      countryCode: 'VN',
      region: city.region ?? '',
      radius,
      distanceUnit
    }];
  });
}

function validSavedRadius(radius, unit) {
  return ['kilometer', 'mile'].includes(unit) && Number.isFinite(radius) && radius > 0
    && radius <= (unit === 'mile' ? 50 : 80);
}
