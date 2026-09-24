import { catalogCounts, mergePageCatalog } from './page-catalog.js';
import { createMetaRateLimiter } from './meta-rate-limiter.js';
import { setTimeout as sleep } from 'node:timers/promises';

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

export function createMetaClient(config, { fetchImpl = fetch } = {}) {
  const rawFetch = fetchImpl;
  const rateLimiter = createMetaRateLimiter();
  fetchImpl = async (input, options = {}) => {
    const release = await rateLimiter.acquire(options.signal);
    try {
      const response = await rawFetch(input, options);
      rateLimiter.observe(response);
      return response;
    } finally {
      release();
    }
  };
  fetchImpl.rateLimiter = rateLimiter;
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

    async listPixels(token, accountId) {
      const data = await requestPaged(fetchImpl, `${graphBaseUrl}/${accountId}/adspixels`, {
        fields: 'id,name', limit: '100'
      }, token);
      return data.map((pixel) => ({ id: String(pixel.id), name: pixel.name ?? String(pixel.id) }));
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

      const payload = await postParams(
        fetchImpl,
        `${graphVideoBaseUrl}/${accountId}/advideos`,
        token,
        new URLSearchParams({ file_url: sourceUrl, title: media.name }),
        options
      );
      if (!payload.id) {
        throw new Error('Meta không trả về video ID');
      }
      return String(payload.id);
    },

    async getVideoStatus(token, videoId, options = {}) {
      const payload = await requestJson(fetchImpl, `${graphBaseUrl}/${videoId}`, {
        fields: 'status,thumbnails'
      }, token, options);
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
      const payload = await sendWithThrottleRetry(() => fetchImpl(`${graphBaseUrl}/${postId}`, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${pageToken}` },
        signal: options.signal
      }), options.signal, rateLimiter);
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

    async createAd(token, accountId, params, options = {}) {
      const payload = await postParams(fetchImpl, `${graphBaseUrl}/${accountId}/ads`, token, params, options);
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
        const post = await requestJson(fetchImpl, `${graphBaseUrl}/${postId}`, {
          fields: 'permalink_url'
        }, token, { ...lookupOptions, signal: AbortSignal.any([
          lookupOptions.signal, AbortSignal.timeout(2500)
        ]) });
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
    async findCreatedObject(token, parentId, edge, name, { sinceMs, signal } = {}) {
      if (!['campaigns', 'adsets', 'ads'].includes(edge)) throw new Error('Loại đối tượng cần tra không hợp lệ');
      const payload = await requestJson(fetchImpl, `${graphBaseUrl}/${parentId}/${edge}`, {
        fields: 'id,name,created_time',
        filtering: JSON.stringify([{ field: 'name', operator: 'EQUAL', value: String(name) }]),
        limit: '25'
      }, token, { signal });
      return (payload.data ?? []).filter((item) => (
        item?.name === name
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
  const firstUrl = new URL(initialUrl);
  for (const [key, value] of Object.entries(params)) {
    firstUrl.searchParams.set(key, value);
  }

  const data = [];
  let nextUrl = firstUrl.toString();
  while (nextUrl) {
    const response = await sendWithThrottleRetry(
      () => fetchImpl(nextUrl, { headers: { authorization: `Bearer ${token}` } }),
      undefined,
      fetchImpl.rateLimiter
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
  }), signal, fetchImpl.rateLimiter);
}

async function postParams(fetchImpl, url, token, params, { signal } = {}) {
  return sendWithThrottleRetry(() => fetchImpl(url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/x-www-form-urlencoded'
    },
    body: params.toString(),
    signal
  }), signal, fetchImpl.rateLimiter);
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
  }), signal, fetchImpl.rateLimiter);
}

async function readPayload(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

// Meta rate limit: HTTP 429, hoặc code 4/17/32/613 (app/user/page), 80000-80014 (business use case).
const THROTTLE_RETRY_DELAYS_MS = [30_000, 60_000, 120_000, 300_000];
const MAX_INLINE_THROTTLE_WAIT_MS = 30_000;

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

async function sendWithThrottleRetry(send, signal, rateLimiter) {
  for (let attempt = 0; ; attempt += 1) {
    const response = await send();
    const payload = await readPayload(response);
    if (response.ok) return payload;
    const waitMs = isThrottleResponse(response.status, payload) ? throttleWaitMs(response, attempt) : undefined;
    if (!(waitMs > 0)) throwMetaError(payload, response.status);
    rateLimiter?.recordThrottle(waitMs);
    // App-wide limit responses are already quota pressure; retrying the same
    // request here only amplifies the burst before the durable workflow queue.
    if (Number(payload?.error?.code) === 4) throwMetaThrottle(payload, response.status, waitMs);
    if (waitMs > MAX_INLINE_THROTTLE_WAIT_MS) throwMetaThrottle(payload, response.status, waitMs);
    await sleep(waitMs, undefined, { signal });
  }
}

function throwMetaThrottle(payload, status, retryAfterMs) {
  const error = new Error('Đang chờ hạn mức Meta');
  error.name = 'MetaThrottleError';
  error.statusCode = 429;
  error.retryable = true;
  error.retryAfterMs = retryAfterMs;
  error.meta = normalizeMetaError(payload, status);
  throw error;
}

function throwMetaError(payload, status) {
  const error = new Error(normalizeMetaError(payload, status).message);
  error.meta = normalizeMetaError(payload, status);
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
