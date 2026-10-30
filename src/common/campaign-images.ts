import { PrismaService } from '../prisma/prisma.service';

type Frame = { id: string; key: string; url: string; name: string | null; config: unknown };

export type CampaignLayouts = { active: Frame | null; byCity: Map<string, Frame> };

type ImageLike = {
  campaignId?: string | null;
  layoutKey?: string | null;
  layoutUrl?: string | null;
  framedUrl?: string | null;
  Config?: unknown;
  createdAt?: Date | string;
  updatedAt?: Date | string;
  [k: string]: unknown;
};

const frameSelect = { id: true, key: true, url: true, name: true, config: true } as const;

/** Layout usado para a criança na campanha: o da cidade dela, senão o padrão. */
export function resolveFrame(layouts: CampaignLayouts | undefined, cityId?: string | null) {
  const byCity = cityId ? layouts?.byCity.get(cityId) : undefined;
  if (byCity) return { frame: byCity, source: 'city' as const };
  if (layouts?.active) return { frame: layouts.active, source: 'default' as const };
  return null;
}

/** Layout padrão e layouts por cidade de cada campanha. */
export async function loadCampaignLayouts(prisma: PrismaService, campaignIds: string[]) {
  const ids = Array.from(new Set(campaignIds.filter(Boolean)));
  const result = new Map<string, CampaignLayouts>();
  if (!ids.length) return result;

  const [campaigns, cityLayouts] = await Promise.all([
    prisma.campaign.findMany({ where: { id: { in: ids } }, select: { id: true, activeFrame: { select: frameSelect } } }),
    prisma.campaignCityLayout.findMany({ where: { campaignId: { in: ids } }, select: { campaignId: true, cityId: true, frame: { select: frameSelect } } }),
  ]);
  for (const c of campaigns) result.set(c.id, { active: c.activeFrame ?? null, byCity: new Map() });
  for (const l of cityLayouts) result.get(l.campaignId)?.byCity.set(l.cityId, l.frame);
  return result;
}

const time = (img: ImageLike) => new Date((img.createdAt ?? img.updatedAt ?? 0) as any).getTime();

/**
 * Deixa em `child.images` uma única imagem, montada para a campanha: a foto da
 * própria campanha (ou, para crianças migradas sem foto nova, a mais recente que
 * tiverem) com o layout atual da cidade da criança nesta campanha (ou o padrão).
 * Assim o layout por cidade vale mesmo para fotos enviadas antes de ele ser definido.
 */
export function applyCampaignImage<T extends { images?: ImageLike[]; cityId?: string | null }>(
  child: T,
  campaignId: string,
  layouts?: CampaignLayouts,
): T {
  const images = Array.isArray(child.images) ? child.images : [];
  if (!images.length) return child;

  const own = images.filter((i) => i.campaignId === campaignId).sort((a, b) => time(b) - time(a))[0];
  const base = own ?? [...images].sort((a, b) => time(b) - time(a))[0];
  const frame = resolveFrame(layouts, child.cityId)?.frame ?? null;

  // a arte pronta e o enquadramento salvos só servem se foram feitos com este mesmo layout
  const sameLayout = !!own && (!frame || own.layoutKey === frame.key);

  const config = sameLayout ? (base.Config ?? frame?.config ?? null) : (frame?.config ?? base.Config ?? null);

  child.images = [{
    ...base,
    campaignId,
    layoutKey: frame?.key ?? base.layoutKey ?? null,
    layoutUrl: frame?.url ?? base.layoutUrl ?? null,
    Config: config,
    // sem enquadramento não dá para montar no site: a arte antiga fica como reserva
    framedUrl: sameLayout || !config ? base.framedUrl ?? null : null,
  }];
  return child;
}
