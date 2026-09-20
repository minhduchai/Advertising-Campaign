export function createRunSnapshot({
  draft,
  selectedMedia = new Map(),
  selectedSeedingMedia = new Map(),
  pages = []
}) {
  const pageNames = new Map(pages.map((page) => [String(page.id), page.name ?? String(page.id)]));
  const campaigns = draft.campaigns ?? [];
  const accountIds = [...new Set(campaigns.map((campaign) => campaign.adAccountId).filter(Boolean))];
  return {
    version: 3,
    adAccountId: accountIds.length === 1 ? accountIds[0] : null,
    campaigns: campaigns.map((campaign) => ({
      clientId: campaign.clientId,
      name: campaign.name,
      adAccountId: campaign.adAccountId,
      pageId: campaign.pageId,
      pageName: pageNames.get(String(campaign.pageId)) ?? String(campaign.pageId),
      specialAdCategory: campaign.specialAdCategory,
      budgetStrategy: campaign.budgetStrategy,
      dailyBudget: campaign.dailyBudget,
      seeding: snapshotSeeding(campaign.seeding, selectedSeedingMedia),
      adSets: (campaign.adSets ?? []).map((adSet) => ({
        clientId: adSet.clientId,
        name: adSet.name,
        conversionLocation: adSet.conversionLocation,
        destinationType: adSet.destinationType,
        optimizationGoal: adSet.optimizationGoal,
        dailyBudget: adSet.dailyBudget,
        startTime: adSet.startTime,
        endTime: adSet.endTime,
        locationMode: adSet.locationMode,
        includedRegions: cloneJson(adSet.includedRegions ?? []),
        excludedRegions: cloneJson(adSet.excludedRegions ?? []),
        includedCities: cloneJson(adSet.includedCities ?? []),
        excludedCities: cloneJson(adSet.excludedCities ?? []),
        includedCustomLocations: cloneJson(adSet.includedCustomLocations ?? []),
        excludedCustomLocations: cloneJson(adSet.excludedCustomLocations ?? []),
        ageMin: adSet.ageMin,
        ageMax: adSet.ageMax,
        genders: [...(adSet.genders ?? [])],
        advantageAudienceEnabled: Boolean(adSet.advantageAudienceEnabled),
        includedCustomAudienceIds: [...(adSet.includedCustomAudienceIds ?? [])],
        excludedCustomAudienceIds: [...(adSet.excludedCustomAudienceIds ?? [])],
        detailedTargeting: cloneJson(adSet.detailedTargeting ?? []),
        ads: (adSet.ads ?? []).map((ad) => ({
          clientId: ad.clientId,
          creativeGroupId: ad.creativeGroupId ?? ad.clientId,
          name: ad.name,
          primaryText: ad.primaryText,
          headline: ad.headline,
          publicationMode: ad.publicationMode ?? 'DARK',
          conversation: cloneJson(ad.conversation ?? {}),
          media: reportMedia(selectedMedia.get(ad.mediaId), ad.mediaId)
        }))
      }))
    }))
  };
}

export function createRunExecutionDraft(draft) {
  return JSON.parse(JSON.stringify(draft, (key, value) => (
    /(?:previewUrl|uploadProgress|blobUrl|blobDownloadUrl|blobPathname)$/i.test(key) ? undefined : value
  )));
}

function snapshotSeeding(seeding, selectedSeedingMedia) {
  return {
    enabled: Boolean(seeding?.enabled),
    templateId: seeding?.templateId ?? null,
    templateName: seeding?.templateName ?? '',
    items: (seeding?.items ?? []).map((item) => ({
      id: item.id,
      message: item.message,
      imageMediaId: item.imageMediaId ?? null,
      imageName: selectedSeedingMedia.get(item.imageMediaId)?.name ?? ''
    }))
  };
}

function reportMedia(media, mediaId) {
  if (!media) return { id: mediaId, name: '', mimeType: '', sizeBytes: 0 };
  return {
    id: media.id ?? mediaId,
    name: media.name,
    mimeType: media.mimeType,
    sizeBytes: Number(media.sizeBytes ?? media.content?.byteLength ?? 0)
  };
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}
