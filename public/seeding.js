export function createEmptySeeding(randomId = () => globalThis.crypto.randomUUID()) {
  return {
    enabled: true,
    templateId: null,
    templateName: '',
    items: [{
      id: randomId(),
      message: '',
      imageMediaId: null,
      imageName: '',
      imageSize: 0,
      imageMimeType: '',
      imagePreviewUrl: ''
    }]
  };
}

export function applySeedingTemplate(campaign, template) {
  const previousSeeding = campaign.seeding ?? createEmptySeeding();
  campaign.seeding = {
    enabled: true,
    templateId: template.id,
    templateName: template.name,
    items: (template.items ?? []).map((item) => ({
      id: item.id,
      message: item.message,
      imageMediaId: item.imageMediaId ?? null,
      imageName: '',
      imageSize: 0,
      imageMimeType: '',
      imagePreviewUrl: ''
    }))
  };
  return campaign.seeding;
}

export function seedingContent(seeding) {
  return {
    templateId: seeding?.templateId ?? null,
    templateName: seeding?.templateName ?? '',
    items: (seeding?.items ?? []).map((item) => ({
      id: item.id,
      message: item.message,
      imageMediaId: item.imageMediaId ?? null
    }))
  };
}

export function isSeedingModified(seeding, template) {
  if (!seeding || !template) {
    return true;
  }
  return JSON.stringify({
    templateName: seeding.templateName ?? '',
    items: seedingContent(seeding).items
  }) !== JSON.stringify({
    templateName: template.name ?? '',
    items: (template.items ?? []).map((item) => ({
      id: item.id,
      message: item.message,
      imageMediaId: item.imageMediaId ?? null
    }))
  });
}
