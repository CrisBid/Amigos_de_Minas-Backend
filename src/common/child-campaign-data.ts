/** Select para trazer os dados por campanha (ID e presente) junto da criança. */
export const campaignDataSelect = {
  select: { campaignId: true, publicId: true, wantedGift: true },
} as const;

type CampaignData = { campaignId: string; publicId: number | null; wantedGift: string | null };

/**
 * Troca `publicId` e `wantedGift` da criança pelos registrados na campanha
 * (quando houver) e remove `campaignData` do objeto. Muta e retorna a criança.
 * Com registro nesta campanha, o presente é o dele — mesmo vazio: o presente
 * atual do cadastro pode ser o de outra campanha.
 */
export function applyCampaignData<T extends Record<string, any> | null | undefined>(child: T, campaignId?: string | null): T {
  if (!child) return child;
  const list: CampaignData[] = Array.isArray(child.campaignData) ? child.campaignData : [];
  const data = campaignId ? list.find((d) => d.campaignId === campaignId) : undefined;
  if (data?.publicId != null) (child as any).publicId = data.publicId;
  if (data) (child as any).wantedGift = data.wantedGift?.trim() ? data.wantedGift : null;
  delete (child as any).campaignData;
  return child;
}

/** Mesma coisa para um apadrinhamento: usa a campanha do próprio apadrinhamento. */
export function applySponsorshipCampaignData<T extends Record<string, any>>(sp: T): T {
  applyCampaignData(sp.child, sp.campaignId ?? sp.campaign?.id);
  return sp;
}
