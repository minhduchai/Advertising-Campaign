export const WEBSITE_PIXEL_ID = '657921569053875';

export function applyFixedWebsiteTracking(ad) {
  ad.websiteEventsEnabled = true;
  ad.websitePixelId = WEBSITE_PIXEL_ID;
  return ad;
}
