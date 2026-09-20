export function buildCampaignSummaries(snapshot, nodes = []) {
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
    const status = failedNode ? 'failed' : skippedNode ? 'failed' : completed === total ? 'created' : 'pending';
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
