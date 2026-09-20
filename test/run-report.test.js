import test from 'node:test';
import assert from 'node:assert/strict';
import { createRunSnapshot } from '../src/run-report.js';

test('creates a report snapshot without browser previews or private media locations', () => {
  const draft = {
    campaigns: [{
      clientId: 'campaign-1',
      name: 'Campaign 1',
      adAccountId: 'act_1',
      pageId: 'page-1',
      specialAdCategory: 'NONE',
      budgetStrategy: 'AD_SET',
      dailyBudget: 0,
      adSets: [{
        clientId: 'adset-1',
        name: 'Ad Set 1',
        conversionLocation: 'MESSAGING_APPS',
        destinationType: 'MESSENGER',
        optimizationGoal: 'CONVERSATIONS',
        dailyBudget: 100000,
        startTime: '',
        endTime: '',
        locationMode: 'REGIONS',
        includedRegions: [{ key: '1', name: 'Hồ Chí Minh', countryCode: 'VN', type: 'region' }],
        excludedRegions: [],
        ageMin: 23,
        ageMax: 45,
        genders: [2],
        advantageAudienceEnabled: false,
        includedCustomAudienceIds: ['audience-1'],
        excludedCustomAudienceIds: [],
        detailedTargeting: [{ id: 'interest-1', name: 'Spa', targetingField: 'interests' }],
        ads: [{
          clientId: 'ad-1',
          creativeGroupId: 'shared-1',
          name: 'VIDEO SẸO RỖ',
          primaryText: 'Nội dung',
          headline: 'Tiêu đề',
          mediaId: 'media-1',
          mediaPreviewUrl: 'blob:https://app/private-preview',
          publicationMode: 'DARK',
          conversation: { greeting: 'Xin chào' }
        }]
      }]
    }]
  };
  const selectedMedia = new Map([['media-1', {
    id: 'media-1',
    name: 'creative.mov',
    mimeType: 'video/quicktime',
    sizeBytes: 176898426,
    blobUrl: 'https://private.blob.vercel-storage.com/creative.mov',
    content: Buffer.from('private')
  }]]);

  const snapshot = createRunSnapshot({
    draft,
    selectedMedia,
    pages: [{ id: 'page-1', name: 'Duck Tool' }]
  });

  assert.equal(snapshot.version, 3);
  assert.equal(snapshot.adAccountId, 'act_1');
  assert.equal(snapshot.campaigns[0].adAccountId, 'act_1');
  assert.equal(snapshot.campaigns[0].pageId, 'page-1');
  assert.equal(snapshot.campaigns[0].pageName, 'Duck Tool');
  assert.equal('pageId' in snapshot.campaigns[0].adSets[0], false);
  assert.deepEqual(snapshot.campaigns[0].adSets[0].ads[0].media, {
    id: 'media-1',
    name: 'creative.mov',
    mimeType: 'video/quicktime',
    sizeBytes: 176898426
  });
  const serialized = JSON.stringify(snapshot);
  assert.doesNotMatch(serialized, /private-preview|vercel-storage|private/);
  assert.equal(snapshot.campaigns[0].adSets[0].ads[0].conversation.greeting, 'Xin chào');
});

test('creates an immutable v3 seeding snapshot without media storage details', () => {
  const draft = {
    campaigns: [{
      clientId: 'campaign-1',
      name: 'Campaign 1',
      adAccountId: 'act_1',
      pageId: 'page-1',
      specialAdCategory: 'NONE',
      budgetStrategy: 'AD_SET',
      dailyBudget: 0,
      seeding: {
        enabled: true,
        templateId: 'template-1',
        templateName: 'Triệt nách nữ',
        items: [{
          id: 'item-1',
          message: 'Nội dung comment',
          imageMediaId: 'media-1',
          imagePreviewUrl: 'blob:https://app/private-preview'
        }]
      },
      adSets: []
    }]
  };
  const selectedSeedingMedia = new Map([['media-1', {
    id: 'media-1',
    name: 'before-after.jpg',
    content: Buffer.from('private'),
    blobUrl: 'https://private.blob.vercel-storage.com/before-after.jpg',
    blobDownloadUrl: 'https://private.blob.vercel-storage.com/download',
    blobPathname: 'private/before-after.jpg',
    sourceUrl: 'https://example.test/private-source'
  }]]);

  const snapshot = createRunSnapshot({ draft, selectedSeedingMedia });
  draft.campaigns[0].seeding.items[0].message = 'Đã đổi sau khi chạy';

  assert.deepEqual(snapshot.campaigns[0].seeding, {
    enabled: true,
    templateId: 'template-1',
    templateName: 'Triệt nách nữ',
    items: [{
      id: 'item-1',
      message: 'Nội dung comment',
      imageMediaId: 'media-1',
      imageName: 'before-after.jpg'
    }]
  });
  assert.doesNotMatch(JSON.stringify(snapshot), /private-preview|vercel-storage|private-source/);
});

test('does not copy an untrusted draft image name when seeding metadata is missing', () => {
  const snapshot = createRunSnapshot({
    draft: {
      campaigns: [{
        clientId: 'campaign-1',
        name: 'Campaign 1',
        adAccountId: 'act_1',
        pageId: 'page-1',
        specialAdCategory: 'NONE',
        budgetStrategy: 'AD_SET',
        dailyBudget: 0,
        seeding: {
          enabled: true,
          templateId: 'template-1',
          templateName: 'Triệt nách nữ',
          items: [{
            id: 'item-1',
            message: 'Nội dung comment',
            imageMediaId: 'missing-media',
            imageName: 'https://signed.example.test/image.jpg?token=private-token'
          }]
        },
        adSets: []
      }]
    }
  });

  const item = snapshot.campaigns[0].seeding.items[0];
  assert.equal(item.imageName, '');
  assert.doesNotMatch(JSON.stringify(snapshot), /signed\.example\.test|private-token/);
});

test('stores no run-level account when Campaigns use different accounts', () => {
  const firstCampaign = {
    clientId: 'campaign-1', name: 'Campaign 1', adAccountId: 'act_1', pageId: 'page-1',
    specialAdCategory: 'NONE', budgetStrategy: 'AD_SET', dailyBudget: 0, adSets: []
  };
  const snapshot = createRunSnapshot({
    draft: {
      campaigns: [firstCampaign, {
        ...firstCampaign,
        clientId: 'campaign-2',
        adAccountId: 'act_2',
        pageId: 'page-2'
      }]
    },
    pages: [{ id: 'page-1', name: 'Page One' }, { id: 'page-2', name: 'Page Two' }]
  });

  assert.equal(snapshot.adAccountId, null);
  assert.deepEqual(snapshot.campaigns.map(({ adAccountId, pageName }) => [adAccountId, pageName]), [
    ['act_1', 'Page One'],
    ['act_2', 'Page Two']
  ]);
});
