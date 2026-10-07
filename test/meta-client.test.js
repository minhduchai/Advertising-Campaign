import test from 'node:test';
import assert from 'node:assert/strict';
import { createMetaClient, normalizeMetaError } from '../src/meta-client.js';
import { testConfig } from './helpers.js';

test('reads Ad identity with bearer auth and refuses non-numeric IDs', async () => {
  let calls = 0;
  const client = createMetaClient(testConfig(), { fetchImpl: async (url, options) => {
    calls++;
    const parsed = new URL(url);
    assert.ok(parsed.pathname.endsWith('/123'));
    assert.equal(parsed.searchParams.get('fields'), 'id,name,account_id,campaign_id,adset_id,creative{id}');
    assert.equal(parsed.searchParams.has('access_token'), false);
    assert.equal(options.headers.authorization, 'Bearer test-token');
    return Response.json({ id: '123', account_id: '1' });
  } });
  assert.equal((await client.getAdIdentity('test-token', '123')).id, '123');
  await assert.rejects(client.getAdIdentity('test-token', '../me'), /Invalid Ad ID/);
  assert.equal(calls, 1);
});

test('Meta OAuth authorisation URL uses the configured Business Login flow', () => {
  const client = createMetaClient(testConfig(), { fetchImpl: async () => undefined });

  const url = new URL(client.createAuthorizationUrl('state-123'));

  assert.equal(url.searchParams.get('state'), 'state-123');
  assert.equal(url.searchParams.get('config_id'), 'test-login-config-id');
  assert.deepEqual(url.searchParams.get('scope').split(','), [
    'ads_read',
    'ads_management',
    'pages_show_list',
    'pages_read_engagement',
    'pages_read_user_content',
    'pages_manage_ads',
    'pages_manage_engagement',
    'business_management'
  ]);
});

test('uses bearer authorisation to list account and Page summaries', async () => {
  const requests = [];
  const client = createMetaClient(testConfig(), {
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return Response.json({
        data: url.includes('/adaccounts')
          ? [{ id: 'act_1', name: 'Account 1', currency: 'VND', account_status: 2, disable_reason: 1, access_token: 'never-returned' }]
          : [{ id: 'page_1', name: 'Page 1', tasks: ['ADVERTISE'] }]
      });
    }
  });

  const accounts = await client.listAdAccounts('EAAG-token');
  const pages = await client.listPages('EAAG-token');

  assert.deepEqual(accounts, [{
    id: 'act_1', name: 'Account 1', currency: 'VND', accountStatus: 2,
    canAdvertise: false, unavailableReason: 'Tài khoản quảng cáo đã bị vô hiệu hóa'
  }]);
  assert.deepEqual(pages, [{ id: 'page_1', name: 'Page 1', tasks: ['ADVERTISE'] }]);
  assert.equal(requests[0].options.headers.authorization, 'Bearer EAAG-token');
  assert.equal(requests[1].options.headers.authorization, 'Bearer EAAG-token');
  assert.equal(requests[1].options.method ?? 'GET', 'GET');
  assert.doesNotMatch(JSON.stringify(accounts), /access_token/);
});

test('loads Custom Audiences from the selected ad account', async () => {
  const client = createMetaClient(testConfig(), {
    fetchImpl: async () => Response.json({
        data: [{
          id: 'ca-1',
          name: 'Đã nhắn tin',
          subtype: 'ENGAGEMENT',
          delivery_status: { code: 200 }
        }]
      })
  });

  assert.deepEqual(await client.listCustomAudiences('token', 'act_1'), [{
    id: 'ca-1',
    name: 'Đã nhắn tin',
    subtype: 'ENGAGEMENT',
    deliveryStatus: { code: 200 }
  }]);
});

test('loads and normalizes Meta Saved Audiences for the selected ad account', async () => {
  const client = createMetaClient(testConfig(), {
    fetchImpl: async (url) => {
      assert.match(String(url), /\/act_1\/saved_audiences/);
      return Response.json({ data: [{
        id: 'saved-1',
        name: 'Tệp nữ 22-45 TP.HCM',
        description: 'Mẫu từ Meta',
        targeting: {
          age_min: 22,
          age_max: 45,
          genders: [2],
          locales: [24],
          geo_locations: {
            regions: [{ key: '3984', name: 'Thành phố Hồ Chí Minh' }],
            custom_locations: [{
              name: 'Phú Thọ, Thủ Dầu Một',
              latitude: 10.9804,
              longitude: 106.6519,
              radius: 10,
              distance_unit: 'kilometer'
            }]
          },
          excluded_geo_locations: { regions: [{ key: '3998', name: 'Nghệ An' }] },
          custom_audiences: [{ id: 'ca-1' }],
          excluded_custom_audiences: [{ id: 'ca-2' }],
          flexible_spec: [{ interests: [{ id: '6001', name: 'Spa' }] }]
        }
      }] });
    }
  });

  assert.deepEqual(await client.listSavedAudiences('TOKEN', 'act_1'), [{
    id: 'saved-1',
    name: 'Tệp nữ 22-45 TP.HCM',
    description: 'Mẫu từ Meta',
    compatible: true,
    issues: [],
    content: {
      ageMin: 22,
      ageMax: 45,
      genders: [2],
      locales: [24],
      includedRegions: [{ key: '3984', name: 'Thành phố Hồ Chí Minh', type: 'region', countryCode: 'VN' }],
      excludedRegions: [{ key: '3998', name: 'Nghệ An', type: 'region', countryCode: 'VN' }],
      includedCities: [],
      excludedCities: [],
      includedCustomLocations: [{
        key: 'pin:10.980400,106.651900',
        name: 'Phú Thọ, Thủ Dầu Một',
        type: 'custom_location',
        countryCode: 'VN',
        latitude: 10.9804,
        longitude: 106.6519,
        radius: 10,
        distanceUnit: 'kilometer'
      }],
      excludedCustomLocations: [],
      includedCustomAudienceIds: ['ca-1'],
      excludedCustomAudienceIds: ['ca-2'],
      detailedTargeting: [{ id: '6001', name: 'Spa', targetingField: 'interests' }]
    }
  }]);
});

test('loads every shared Page source through paging.next and merges the global catalog', async () => {
  const requests = [];
  const client = createMetaClient(testConfig(), {
    fetchImpl: async (url, options) => {
      const target = String(url);
      requests.push({ target, options });
      if (target.includes('/me/accounts')) {
        return Response.json({
          data: [{ id: 'page-2', name: 'Second', tasks: ['ADVERTISE'] }],
          paging: { next: 'https://graph.test/accounts-next' }
        });
      }
      if (target === 'https://graph.test/accounts-next') {
        return Response.json({
          data: [{
            id: 'page-5',
            name: 'Managed next',
            tasks: ['ADVERTISE'],
            access_token: 'never-returned',
            unknown_graph_field: 'never-returned'
          }]
        });
      }
      if (target.includes('/me/businesses')) {
        return Response.json({
          data: [{ id: 'business-1', name: 'Portfolio 1' }],
          paging: { next: 'https://graph.test/businesses-next' }
        });
      }
      if (target === 'https://graph.test/businesses-next') {
        return Response.json({ data: [{ id: 'business-2', name: 'Portfolio 2' }] });
      }
      if (target.includes('/business-1/owned_pages')) {
        return Response.json({
          data: [{ id: 'page-3', name: 'Owned', tasks: ['MANAGE'] }],
          paging: { next: 'https://graph.test/owned-next' }
        });
      }
      if (target === 'https://graph.test/owned-next') {
        return Response.json({ data: [{ id: 'page-6', name: 'Owned next', tasks: ['MANAGE'] }] });
      }
      if (target.includes('/business-1/client_pages')) {
        return Response.json({
          data: [{ id: 'page-4', name: 'Client', tasks: [] }],
          paging: { next: 'https://graph.test/client-next' }
        });
      }
      if (target === 'https://graph.test/client-next') {
        return Response.json({ data: [{ id: 'page-7', name: 'Client next', tasks: [] }] });
      }
      if (target.includes('/business-2/owned_pages') || target.includes('/business-2/client_pages')) {
        return Response.json({ data: [] });
      }
      throw new Error(`Unexpected URL: ${target}`);
    }
  });

  const result = await client.listGlobalPageCatalog('token');

  assert.deepEqual(result.pages.map((page) => page.id).sort(), [
    'page-2', 'page-3', 'page-4', 'page-5', 'page-6', 'page-7'
  ]);
  assert.deepEqual(result.pages.find((page) => page.id === 'page-2').sources, ['MANAGED']);
  assert.equal(result.pages.find((page) => page.id === 'page-4').canAdvertise, false);
  assert.deepEqual(result.pages.find((page) => page.id === 'page-5'), {
    id: 'page-5',
    name: 'Managed next',
    sources: ['MANAGED'],
    tasks: ['ADVERTISE'],
    promotionIneligibleReason: null,
    canAdvertise: true,
    unavailableReason: null
  });
  assert.equal(result.discovery.requiresBusinessReconnect, false);
  for (const nextUrl of [
    'https://graph.test/accounts-next',
    'https://graph.test/businesses-next',
    'https://graph.test/owned-next',
    'https://graph.test/client-next'
  ]) {
    assert.equal(requests.filter((request) => request.target === nextUrl).length, 1);
  }
  for (const request of requests) {
    assert.equal(request.options.headers.authorization, 'Bearer token');
    assert.equal(request.options.method ?? 'GET', 'GET');
  }
});

test('returns a partial global catalog when Business permission is missing', async () => {
  const client = createMetaClient(testConfig(), {
    fetchImpl: async (url) => {
      const target = String(url);
      if (target.includes('/me/businesses')) {
        return Response.json({ error: { message: '(#100) Missing Permission', code: 100 } }, { status: 400 });
      }
      if (target.includes('/me/accounts')) {
        return Response.json({ data: [{ id: 'page-2', name: 'Managed', tasks: ['ADVERTISE'] }] });
      }
      throw new Error(`Unexpected URL: ${target}`);
    }
  });

  const result = await client.listGlobalPageCatalog('token');
  assert.deepEqual(result.pages.map((page) => page.id), ['page-2']);
  assert.equal(result.discovery.requiresBusinessReconnect, true);
  assert.match(result.discovery.warnings[0], /Business Portfolio/);
});

test('recovers from an individual Business Page edge failure', async () => {
  const client = createMetaClient(testConfig(), {
    fetchImpl: async (url) => {
      const target = String(url);
      if (target.includes('/business-1/owned_pages')) {
        return Response.json({ error: { message: 'owned pages unavailable', code: 2 } }, { status: 500 });
      }
      if (target.includes('/business-1/client_pages')) {
        return Response.json({ data: [{ id: 'client-page', name: 'Client' }] });
      }
      if (target.includes('/me/businesses')) {
        return Response.json({ data: [{ id: 'business-1', name: 'Portfolio 1' }] });
      }
      return Response.json({ data: [] });
    }
  });

  const result = await client.listGlobalPageCatalog('token');

  assert.deepEqual(result.pages.map((page) => page.id), ['client-page']);
  assert.equal(result.discovery.requiresBusinessReconnect, false);
  assert.equal(result.discovery.warnings.length, 1);
});

test('fails global discovery when managed Pages cannot load', async () => {
  for (const failingPath of ['/me/accounts']) {
    const client = createMetaClient(testConfig(), {
      fetchImpl: async (url) => {
        const target = String(url);
        if (target.includes(failingPath)) {
          return Response.json({
            error: { message: 'base source unavailable', code: 2 }
          }, { status: 500 });
        }
        return Response.json({ data: [] });
      }
    });

    await assert.rejects(
      () => client.listGlobalPageCatalog('token'),
      /base source unavailable/
    );
  }
});

test('normalizes targeting search results with a safe targeting field', async () => {
  const client = createMetaClient(testConfig(), {
    fetchImpl: async () => Response.json({
      data: [{ id: '6001', name: 'Skincare', path: ['Beauty'] }]
    })
  });

  assert.deepEqual(
    await client.searchTargeting('token', { category: 'interest', query: 'skin' }),
    [{ id: '6001', name: 'Skincare', path: ['Beauty'], targetingField: 'interests' }]
  );
});

test('searches Meta locations and keeps Vietnam regions and cities', async () => {
  let requestedUrl;
  const client = createMetaClient(testConfig(), {
    fetchImpl: async (url) => {
      requestedUrl = new URL(url);
      return Response.json({
        data: [
          { key: '3984', name: 'Thành phố Hồ Chí Minh', type: 'region', country_code: 'VN' },
          {
            key: '2420605',
            name: 'Quận Bình Thạnh',
            type: 'city',
            country_code: 'VN',
            latitude: 10.8106,
            longitude: 106.7091
          },
          { key: '1', name: 'California', type: 'region', country_code: 'US' }
        ]
      });
    }
  });

  const results = await client.searchLocations('token', 'Hồ Chí Minh');

  assert.deepEqual(results, [
    {
      key: '3984',
      name: 'Thành phố Hồ Chí Minh',
      type: 'region',
      countryCode: 'VN'
    },
    {
      key: '2420605',
      name: 'Quận Bình Thạnh',
      type: 'city',
      countryCode: 'VN',
      region: '',
      latitude: 10.8106,
      longitude: 106.7091
    }
  ]);
  assert.equal(requestedUrl.searchParams.get('type'), 'adgeolocation');
  assert.equal(requestedUrl.searchParams.get('country_code'), 'VN');
  assert.deepEqual(JSON.parse(requestedUrl.searchParams.get('location_types')), ['region', 'city']);
});

test('does not treat blank or null Meta coordinates as a map center at zero', async () => {
  let requestedSignal;
  const client = createMetaClient(testConfig(), {
    fetchImpl: async (url, options) => {
      requestedSignal = options.signal;
      return Response.json({ data: [
        { key: '1', name: 'Null', type: 'city', country_code: 'VN', latitude: null, longitude: null },
        { key: '2', name: 'Blank', type: 'city', country_code: 'VN', latitude: '', longitude: ' ' },
        { key: '3', name: 'Valid', type: 'city', country_code: 'VN', latitude: '10.81', longitude: '106.71' }
      ] });
    }
  });
  const results = await client.searchLocations('token', 'Hồ Chí Minh');
  assert.equal(Object.hasOwn(results[0], 'latitude'), false);
  assert.equal(Object.hasOwn(results[1], 'longitude'), false);
  assert.equal(results[2].latitude, 10.81);
  assert.equal(results[2].longitude, 106.71);
  assert.ok(requestedSignal instanceof AbortSignal);
});

test('drops demographic targeting results whose field is not allowlisted', async () => {
  const client = createMetaClient(testConfig(), {
    fetchImpl: async () => Response.json({
      data: [
        { id: 'life-1', name: 'Newly engaged', type: 'life_events' },
        { id: 'unsafe-1', name: 'Unknown', type: 'unknown_field' }
      ]
    })
  });

  assert.deepEqual(
    await client.searchTargeting('token', { category: 'demographic', query: 'new' }),
    [{ id: 'life-1', name: 'Newly engaged', path: [], targetingField: 'life_events' }]
  );
});

test('exchanges OAuth code and retrieves the profile from Graph API', async () => {
  const client = createMetaClient(testConfig(), {
    fetchImpl: async (url) => Response.json(
      String(url).includes('oauth/access_token')
        ? { access_token: 'EAAG-issued-token' }
        : { id: 'meta-user-1', name: 'Minh' }
    )
  });

  assert.deepEqual(await client.exchangeCode('oauth-code'), { accessToken: 'EAAG-issued-token' });
  assert.deepEqual(await client.getProfile('EAAG-issued-token'), { id: 'meta-user-1', name: 'Minh' });
});

test('returns requested permission statuses across every Graph page', async () => {
  const requests = [];
  const client = createMetaClient(testConfig(), {
    fetchImpl: async (url, options) => {
      const target = String(url);
      requests.push({ target, options });
      if (target.includes('/me/permissions')) {
        return Response.json({
          data: [{ permission: 'pages_manage_posts', status: 'granted' }],
          paging: { next: 'https://graph.test/permissions-next' }
        });
      }
      return Response.json({
        data: [{ permission: 'pages_manage_engagement', status: 'granted' }]
      });
    }
  });

  const permissions = await client.getPermissionStatus('EAAG-token', [
    'pages_manage_posts',
    'pages_manage_engagement',
    'pages_read_engagement'
  ]);

  assert.deepEqual(permissions, {
    pages_manage_posts: true,
    pages_manage_engagement: true,
    pages_read_engagement: false
  });
  const initialRequest = new URL(requests[0].target);
  assert.equal(initialRequest.searchParams.get('fields'), 'permission,status');
  assert.equal(initialRequest.searchParams.get('limit'), '100');
  assert.equal(requests[0].options.headers.authorization, 'Bearer EAAG-token');
  assert.equal(requests[1].target, 'https://graph.test/permissions-next');
});

test('loads only requested Page engagement contexts while retaining Page tokens internally', async () => {
  const requests = [];
  const client = createMetaClient(testConfig(), {
    fetchImpl: async (url, options) => {
      const target = String(url);
      requests.push({ target, options });
      if (target.includes('/me/permissions')) {
        return Response.json({ data: [{ permission: 'pages_manage_engagement', status: 'granted' }] });
      }
      if (target.includes('/me/accounts')) {
        return Response.json({
          data: [{ id: 'page-ignored', name: 'Ignored', tasks: ['MODERATE'], access_token: 'ignored-token' }],
          paging: { next: 'https://graph.test/accounts-next' }
        });
      }
      return Response.json({
        data: [{ id: 'page-2', name: 'LG Clinic', tasks: ['MODERATE'], access_token: 'page-token-2' }]
      });
    }
  });

  const context = await client.getPageEngagementContext('EAAG-token', ['page-2']);

  assert.equal(context.permissionGranted, true);
  assert.deepEqual([...context.pages], [[
    'page-2',
    { name: 'LG Clinic', tasks: ['MODERATE'], accessToken: 'page-token-2' }
  ]]);
  assert.equal(context.pages.has('page-ignored'), false);
  assert.equal(requests.filter(({ target }) => target.includes('/me/permissions')).length, 1);
  assert.equal(requests.filter(({ target }) => target.includes('/me/accounts')).length, 1);
  assert.equal(requests.find(({ target }) => target.includes('/me/accounts')).options.headers.authorization, 'Bearer EAAG-token');
  assert.equal(requests.find(({ target }) => target === 'https://graph.test/accounts-next').options.headers.authorization, 'Bearer EAAG-token');
});

test('creates a Page comment with text and an image using the Page bearer token', async () => {
  let request;
  const controller = new AbortController();
  const client = createMetaClient(testConfig(), {
    fetchImpl: async (url, options) => {
      request = { url: String(url), options };
      return Response.json({ id: 'comment-1' });
    }
  });

  const commentId = await client.createPageComment('PAGE-TOKEN', '123_456', {
    message: 'Xem ưu đãi https://lgclinic.vn',
    attachmentUrl: 'https://blob.example/image.jpg?signed=1'
  }, { signal: controller.signal });

  assert.equal(commentId, 'comment-1');
  assert.equal(request.url, 'https://graph.facebook.com/v25.0/123_456/comments');
  assert.equal(request.options.headers.authorization, 'Bearer PAGE-TOKEN');
  assert.equal(request.options.signal.aborted, false);
  controller.abort();
  assert.equal(request.options.signal.aborted, true, 'the composed request timeout still honors caller cancellation');
  const body = new URLSearchParams(request.options.body);
  assert.equal(body.get('message'), 'Xem ưu đãi https://lgclinic.vn');
  assert.equal(body.get('attachment_url'), 'https://blob.example/image.jpg?signed=1');
});

test('creates text-only and image-only Page comments', async () => {
  const bodies = [];
  const client = createMetaClient(testConfig(), {
    fetchImpl: async (_url, options) => {
      bodies.push(new URLSearchParams(options.body));
      return Response.json({ id: `comment-${bodies.length}` });
    }
  });

  assert.equal(await client.createPageComment('PAGE-TOKEN', '123_456', { message: 'Text only' }), 'comment-1');
  assert.equal(await client.createPageComment('PAGE-TOKEN', '123_456', { attachmentUrl: 'https://blob.example/image.jpg' }), 'comment-2');
  assert.deepEqual([...bodies[0]], [['message', 'Text only']]);
  assert.deepEqual([...bodies[1]], [['attachment_url', 'https://blob.example/image.jpg']]);
});

test('requires a Comment ID and normalizes Graph errors when creating Page comments', async () => {
  const client = createMetaClient(testConfig(), {
    fetchImpl: async (url) => String(url).endsWith('/missing-id/comments')
      ? Response.json({ success: true })
      : Response.json({
        error: { message: 'Commenting is unavailable', type: 'OAuthException', code: 10, error_subcode: 200 }
      }, { status: 403 })
  });

  await assert.rejects(
    () => client.createPageComment('PAGE-TOKEN', 'missing-id', { message: 'Hello' }),
    /Meta không trả về Comment ID/
  );
  await assert.rejects(
    () => client.createPageComment('PAGE-TOKEN', 'graph-error', { message: 'Hello' }),
    (error) => error.message === 'Commenting is unavailable [Code 10, Subcode 200]' &&
      error.meta?.type === 'OAuthException' &&
      error.meta?.code === 10
  );
});

test('posts campaign parameters and uploads image media with bearer authorisation', async () => {
  const requests = [];
  const client = createMetaClient(testConfig(), {
    fetchImpl: async (url, options) => {
      requests.push({ url: String(url), options });
      return Response.json(String(url).includes('/adimages')
        ? { images: { creative: { hash: 'image-hash' } } }
        : { id: 'remote-campaign' });
    }
  });

  const campaignId = await client.createCampaign(
    'EAAG-token',
    'act_1',
    new URLSearchParams({ name: 'Campaign', status: 'PAUSED' })
  );
  const imageHash = await client.uploadImage('EAAG-token', 'act_1', {
    name: 'creative.jpg',
    mimeType: 'image/jpeg',
    content: Buffer.from('image')
  });

  assert.equal(campaignId, 'remote-campaign');
  assert.equal(imageHash, 'image-hash');
  assert.match(requests[0].url, /\/act_1\/campaigns$/);
  assert.equal(requests[0].options.method, 'POST');
  assert.equal(requests[0].options.headers.authorization, 'Bearer EAAG-token');
  assert.match(requests[1].url, /\/act_1\/adimages$/);
});

test('downloads an R2 image source before uploading its bytes to Meta', async () => {
  const requests = [];
  const client = createMetaClient(testConfig(), {
    fetchImpl: async (url, options = {}) => {
      requests.push({ url: String(url), options });
      if (String(url) === 'https://r2.example/creative.jpg') {
        return new Response(Buffer.from('r2-image-bytes'), {
          headers: { 'content-type': 'image/jpeg' }
        });
      }
      const uploaded = options.body.get('source');
      assert.equal(await uploaded.text(), 'r2-image-bytes');
      return Response.json({ images: { creative: { hash: 'r2-image-hash' } } });
    }
  });

  const imageHash = await client.uploadImage('EAAG-token', 'act_1', {
    name: 'creative.jpg',
    mimeType: 'image/jpeg',
    sourceUrl: 'https://r2.example/creative.jpg'
  });

  assert.equal(imageHash, 'r2-image-hash');
  assert.equal(requests.length, 2);
  assert.match(requests[1].url, /\/act_1\/adimages$/);
});

test('uploads an AdVideo from R2 with exactly one file_url request', async () => {
  const requests = [];
  const client = createMetaClient(testConfig(), {
    fetchImpl: async (url, options) => {
      requests.push({ url: String(url), options });
      return Response.json({ id: 'video-hosted' });
    }
  });
  const sourceUrl = 'https://signed-r2.example/creative.mov?signature=1';

  const videoId = await client.uploadVideo('EAAG-token', 'act_1', {
    name: 'creative.mov',
    mimeType: 'video/quicktime',
    sourceUrl
  });

  assert.equal(videoId, 'video-hosted');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'https://graph-video.facebook.com/v25.0/act_1/advideos');
  assert.equal(requests[0].options.headers.authorization, 'Bearer EAAG-token');
  const body = new URLSearchParams(requests[0].options.body);
  assert.equal(body.get('file_url'), sourceUrl);
  assert.equal(body.get('title'), 'creative.mov');
  assert.equal(body.has('upload_phase'), false);
  assert.equal(body.has('video_file_chunk'), false);
});

test('rejects an AdVideo without an R2 source URL before calling Meta', async () => {
  let calls = 0;
  const client = createMetaClient(testConfig(), {
    fetchImpl: async () => {
      calls += 1;
      return Response.json({ id: 'unexpected' });
    }
  });

  await assert.rejects(
    () => client.uploadVideo('EAAG-token', 'act_1', {
      name: 'creative.mov',
      mimeType: 'video/quicktime'
    }),
    /Video chưa có link nguồn R2 để Meta tải; không dùng upload chia mảnh/
  );
  assert.equal(calls, 0);
});

test('normalizes an AdVideo URL error without trying another upload path', async () => {
  let calls = 0;
  const sourceUrl = 'https://signed-r2.example/creative.mov?signature=1';
  const client = createMetaClient(testConfig(), {
    fetchImpl: async () => {
      calls += 1;
      return Response.json({
        error: {
          message: 'Could not download the video from file_url',
          type: 'OAuthException',
          code: 100,
          fbtrace_id: 'trace-video-url'
        }
      }, { status: 400 });
    }
  });

  await assert.rejects(
    () => client.uploadVideo('EAAG-token', 'act_1', {
      name: 'creative.mov',
      mimeType: 'video/quicktime',
      sourceUrl
    }),
    (error) => {
      assert.equal(error.meta?.type, 'OAuthException');
      assert.equal(error.meta?.code, 100);
      assert.equal(error.meta?.fbtraceId, 'trace-video-url');
      assert.match(error.message, /Could not download the video from file_url/);
      return true;
    }
  );
  assert.equal(calls, 1);
});

test('resolves a created Ad to its Facebook Reel permalink', async () => {
  const requests = [];
  const client = createMetaClient(testConfig(), {
    fetchImpl: async (url, options) => {
      requests.push({ url: String(url), options });
      const pathname = new URL(url).pathname;
      if (pathname.endsWith('/ad-1')) {
        return Response.json({
          creative: {
            effective_object_story_id: 'page-1_123'
          }
        });
      }
      return Response.json({ permalink_url: 'https://www.facebook.com/reel/123' });
    }
  });

  const publication = await client.getAdPublication('EAAG-token', 'ad-1');

  assert.deepEqual(publication, {
    postId: 'page-1_123',
    permalinkUrl: 'https://www.facebook.com/reel/123'
  });
  assert.equal(requests.length, 2);
  assert.match(requests[0].url, /\/ad-1\?fields=creative/);
  assert.match(requests[1].url, /\/page-1_123\?fields=permalink_url/);
  assert.ok(requests.every(({ options }) => options.headers.authorization === 'Bearer EAAG-token'));
});

test('keeps the Post ID and builds a Facebook post link when permalink lookup fails', async () => {
  const requests = [];
  const client = createMetaClient(testConfig(), {
    fetchImpl: async (url) => {
      requests.push(String(url));
      const pathname = new URL(url).pathname;
      if (pathname.endsWith('/ad-1')) {
        return Response.json({
          creative: {
            object_story_id: '123456789_987654321'
          }
        });
      }
      return Response.json({ error: { message: 'Post is still propagating', code: 100 } }, { status: 400 });
    }
  });

  const publication = await client.getAdPublication('EAAG-token', 'ad-1');

  assert.deepEqual(publication, {
    postId: '123456789_987654321',
    permalinkUrl: 'https://www.facebook.com/123456789/posts/987654321'
  });
  assert.equal(requests.length, 2);
});

test('does not mislabel an Instagram permalink as a Facebook post link', async () => {
  const client = createMetaClient(testConfig(), {
    fetchImpl: async () => Response.json({
      creative: {
        instagram_permalink_url: 'https://www.instagram.com/reel/example/'
      }
    })
  });

  assert.deepEqual(await client.getAdPublication('EAAG-token', 'ad-1'), {
    postId: null,
    permalinkUrl: null
  });
});

test('keeps an empty Meta error body actionable with its HTTP status', () => {
  assert.equal(
    normalizeMetaError({}, 413).message,
    'Meta từ chối vì dữ liệu tải lên quá lớn [HTTP 413]'
  );
});

test('copies a similar Ad as active', async () => {
  let request;
  const client = createMetaClient(testConfig(), {
    fetchImpl: async (url, options) => {
      request = { url: String(url), options };
      return Response.json({ copied_ad_id: 'remote-ad-copy' });
    }
  });

  const copiedAdId = await client.copyAd('EAAG-token', 'remote-ad-source', 'remote-adset-target');
  const body = new URLSearchParams(request.options.body);

  assert.equal(copiedAdId, 'remote-ad-copy');
  assert.match(request.url, /\/remote-ad-source\/copies$/);
  assert.equal(request.options.method, 'POST');
  assert.equal(request.options.headers.authorization, 'Bearer EAAG-token');
  assert.equal(body.get('adset_id'), 'remote-adset-target');
  assert.equal(body.get('status_option'), 'ACTIVE');
  assert.deepEqual(JSON.parse(body.get('rename_options')), { rename_strategy: 'NO_RENAME' });
});

test('preserves caller cancellation through every publishing Graph request', async () => {
  const controller = new AbortController();
  const observedSignals = [];
  const client = createMetaClient(testConfig(), {
    fetchImpl: async (url, options = {}) => {
      observedSignals.push(options.signal);
      const pathname = new URL(url).pathname;
      if (pathname.endsWith('/adimages')) return Response.json({ images: { creative: { hash: 'image-hash' } } });
      if (pathname.endsWith('/advideos')) return Response.json({ id: 'video-1' });
      if (pathname.endsWith('/video-1')) return Response.json({ status: { video_status: 'ready' }, thumbnails: { data: [] } });
      if (pathname.endsWith('/photos')) return Response.json({ id: 'photo-1', post_id: 'page-1_post-1' });
      if (pathname.endsWith('/ad-publication')) {
        return Response.json({ creative: { effective_object_story_id: 'page-1_post-2' } });
      }
      if (pathname.endsWith('/page-1_post-2')) {
        return Response.json({ permalink_url: 'https://www.facebook.com/reel/2' });
      }
      if (options.method === 'DELETE') return Response.json({ success: true });
      if (pathname.endsWith('/copies')) return Response.json({ copied_ad_id: 'ad-copy-1' });
      return Response.json({ id: `remote-${observedSignals.length}` });
    }
  });
  const options = { signal: controller.signal };
  const params = new URLSearchParams({ name: 'Paused object' });
  const media = { name: 'creative.jpg', mimeType: 'image/jpeg', content: Buffer.from('image') };
  const videoMedia = { name: 'creative.mp4', mimeType: 'video/mp4', sourceUrl: 'https://r2.example/creative.mp4' };

  await client.createCampaign('token', 'act_1', params, options);
  await client.createAdSet('token', 'act_1', params, options);
  await client.uploadImage('token', 'act_1', media, options);
  await client.uploadVideo('token', 'act_1', videoMedia, options);
  await client.getVideoStatus('token', 'video-1', options);
  await client.createPublicPhotoPost('page-token', 'page-1', media, 'Caption', options);
  await client.deletePagePost('page-token', 'page-1_post-1', options);
  await client.createCreative('token', 'act_1', params, options);
  await client.createAd('token', 'act_1', params, options);
  await client.getAdPublication('token', 'ad-publication', options);
  await client.copyAd('token', 'ad-source', 'adset-target', options);

  assert.equal(observedSignals.length, 12);
  assert.ok(observedSignals.every((signal) => signal && !signal.aborted));
  controller.abort();
  assert.ok(observedSignals.every((signal) => signal.aborted));
});

test('returns a usable post link when the optional permalink request stalls', async () => {
  const { setTimeout: sleep } = await import('node:timers/promises');
  const client = createMetaClient(testConfig(), {
    fetchImpl: async (url, options) => {
      if (new URL(url).pathname.endsWith('/ad-slow')) {
        return Response.json({ creative: { effective_object_story_id: '123_456' } });
      }
      await sleep(15000, null, { signal: options.signal });
      throw new Error('Permalink lookup should have timed out');
    }
  });
  const started = Date.now();
  assert.deepEqual(await client.getAdPublication('token', 'ad-slow'), {
    postId: '123_456', permalinkUrl: 'https://www.facebook.com/123/posts/456'
  });
  assert.ok(Date.now() - started < 6000);
});

test('retries a throttled Meta call after the backoff and gives up when the wait is too long', async () => {
  let calls = 0;
  const client = createMetaClient(testConfig(), {
    fetchImpl: async () => {
      calls += 1;
      return calls === 1
        ? Response.json({ error: { message: 'User request limit reached', code: 17 } }, { status: 400, headers: { 'retry-after': '0.01' } })
        : Response.json({ id: 'remote-campaign' });
    }
  });
  assert.equal(await client.createCampaign('token', 'act_1', new URLSearchParams({ name: 'C' })), 'remote-campaign');
  assert.equal(calls, 2);

  let slowCalls = 0;
  const slowClient = createMetaClient(testConfig(), {
    fetchImpl: async () => {
      slowCalls += 1;
      return Response.json({ error: { message: 'Throttled', code: 80004 } }, {
        status: 400,
        headers: { 'x-business-use-case-usage': JSON.stringify({ act_1: [{ estimated_time_to_regain_access: 5 }] }) }
      });
    }
  });
  await assert.rejects(
    () => slowClient.createCampaign('token', 'act_1', new URLSearchParams({ name: 'C' })),
    (error) => error.meta?.code === 80004
  );
  assert.equal(slowCalls, 1);
});

test('stops inline throttle retries at the limit even when Retry-After stays short', async () => {
  let calls = 0;
  const client = createMetaClient(testConfig(), {
    fetchImpl: async () => {
      calls += 1;
      if (calls > 10) throw new Error('retry loop did not stop');
      return Response.json({ error: { message: 'Calls to this api have exceeded the rate limit', code: 613 } }, {
        status: 400, headers: { 'retry-after': '0.01' }
      });
    }
  });

  await assert.rejects(
    () => client.createCampaign('token', 'act_1', new URLSearchParams({ name: 'C' })),
    (error) => error.name === 'MetaThrottleError' && error.retryAfterMs === 10 && error.meta?.code === 613
  );
  assert.equal(calls, 2, 'one request plus one inline retry');
});

test('never resends a write after a network error, since Meta may already have created it', async () => {
  let calls = 0;
  const client = createMetaClient(testConfig(), {
    fetchImpl: async () => {
      calls += 1;
      throw new TypeError('fetch failed');
    }
  });

  await assert.rejects(() => client.createPageComment('page-token', '1_2', { message: 'Hi' }), /fetch failed/);
  assert.equal(calls, 1);
});

test('aborts an inline throttle wait without sending another request', async () => {
  let calls = 0;
  const controller = new AbortController();
  const client = createMetaClient(testConfig(), {
    fetchImpl: async () => {
      calls += 1;
      setTimeout(() => controller.abort(), 5);
      return Response.json({ error: { message: 'User request limit reached', code: 17 } }, {
        status: 400, headers: { 'retry-after': '10' }
      });
    }
  });

  await assert.rejects(
    () => client.createCampaign('token', 'act_1', new URLSearchParams({ name: 'C' }), { signal: controller.signal }),
    { name: 'AbortError' }
  );
  assert.equal(calls, 1);
});

test('does not retry an app-wide code 4 limit inside the same request', async () => {
  let calls = 0;
  const client = createMetaClient(testConfig(), {
    fetchImpl: async () => {
      calls += 1;
      return Response.json({ error: { message: 'Application request limit reached', code: 4 } }, { status: 400 });
    }
  });

  await assert.rejects(
    () => client.createCampaign('token', 'act_1', new URLSearchParams({ name: 'C' })),
    (error) => error.name === 'MetaThrottleError' && error.meta?.code === 4
  );
  assert.equal(calls, 1);
});

const videoImportFailure = { error: { code: 1, message: "Please reduce the amount of data you're asking for, then retry your request" } };
const hostedVideo = { name: 'video.mp4', mimeType: 'video/mp4', sourceUrl: 'https://r2.example/video.mp4' };

test('retries an explicit Meta 500 video import failure once with the same source', async () => {
  const requests = [];
  const waits = [];
  const client = createMetaClient(testConfig(), {
    networkRetryDelay: async ms => waits.push(ms),
    fetchImpl: async (url, options) => {
      requests.push({ url: String(url), body: options.body });
      return requests.length === 1 ? Response.json(videoImportFailure, { status: 500 }) : Response.json({ id: 'recovered-video' });
    }
  });
  assert.equal(await client.uploadVideo('token', 'act_1', hostedVideo), 'recovered-video');
  assert.equal(requests.length, 2);
  assert.deepEqual(requests[0], requests[1]);
  assert.deepEqual(waits, [5000]);
});

test('bounds video import retries and does not replay unknown writes or ad creation', async () => {
  for (const scenario of ['persistent', 'missing-id', 'malformed', 'network', 'validation', 'ad']) {
    let calls = 0;
    const client = createMetaClient(testConfig(), {
      networkRetryDelay: async () => {},
      fetchImpl: async () => {
        calls++;
        if (scenario === 'missing-id') return Response.json({});
        if (scenario === 'malformed') return new Response('broken', { status: 500 });
        if (scenario === 'network') throw new TypeError('fetch failed', { cause: Object.assign(new Error('reset'), { code: 'ECONNRESET' }) });
        return Response.json(scenario === 'validation' ? { error: { code: 100, message: 'Invalid video' } } : videoImportFailure,
          { status: scenario === 'validation' ? 400 : 500 });
      }
    });
    await assert.rejects(() => scenario === 'ad'
      ? client.createAd('token', 'act_1', new URLSearchParams())
      : client.uploadVideo('token', 'act_1', hostedVideo));
    assert.equal(calls, scenario === 'persistent' ? 2 : 1, scenario);
  }
});

test('cancellation during video import retry prevents the second write', async () => {
  const controller = new AbortController();
  let calls = 0;
  const client = createMetaClient(testConfig(), {
    networkRetryDelay: async () => controller.abort(),
    fetchImpl: async () => { calls++; return Response.json(videoImportFailure, { status: 500 }); }
  });
  await assert.rejects(() => client.uploadVideo('token', 'act_1', hostedVideo, { signal: controller.signal }), { name: 'AbortError' });
  assert.equal(calls, 1);
});
