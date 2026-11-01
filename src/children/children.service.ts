import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../common/storage/storage.service';
import * as sharp from 'sharp';
import sharpLib from 'sharp';
import { Prisma, SponsorshipStatus } from '@prisma/client';
import { applyCampaignData, campaignDataSelect } from '../common/child-campaign-data';
import { applyCampaignImage, loadCampaignLayouts, resolveFrame } from '../common/campaign-images';

type PageOpts = { skip: number; take: number };
type ListOpts = {
  campaignId?: string;
  scanFs?: boolean;

  q?: string;
  cityId?: string;
  communityId?: string;
  schoolId?: string;
  category?: string;
  status?: 'available' | 'assigned';
  /** com/sem foto (na campanha, quando informada) */
  photo?: 'with' | 'without';
  minAge?: number;
  maxAge?: number;
};

type CategoryOpts = {
  campaignId?: string;
  q?: string;
  cityId?: string;
  communityId?: string;
  schoolId?: string;
  status?: 'available' | 'assigned';
  minAge?: number;
  maxAge?: number;
};

type Stats = {
  total: number;
  active: number;
  pending: number;
  in_progress: number;
  available: number;
  sponsorshipRate: number; // em %
};

type RegionFilter = {
  cityId?: string;
  communityId?: string;
  schoolId?: string;
};

type Totals = {
  total: number;
  active: number;
  pending: number;
  in_progress: number;
  available: number;
  sponsorshipRate: number; // %
};

type CityRow = {
  cityId: string;
  cityName: string;
  total: number;
  active: number;
  pending: number;
  in_progress: number;
  available: number;
  sponsorshipRate: number;
};

type CommunityRow = {
  communityId: string;
  communityName: string;
  cityId: string;
  cityName: string;
  total: number;
  active: number;
  pending: number;
  in_progress: number;
  available: number;
  sponsorshipRate: number;
};

// Remova este bloco do TOPO (seu const solto):
// const BUSY_STATUSES: SponsorshipStatus[] = [ ... ];

// Dentro da classe:
@Injectable()
export class ChildrenService {
  constructor(private prisma: PrismaService, private storage: StorageService) {}

  // ✅ ÚNICA FONTE DE VERDADE: tudo que torna a criança "ocupada/indisponível"
  private static readonly BUSY_STATUSES: SponsorshipStatus[] = [
    SponsorshipStatus.ENDED,
    SponsorshipStatus.CANCELLED,
    SponsorshipStatus.PENDING,
    SponsorshipStatus.COMPLETED,
    SponsorshipStatus.IN_PROGRESS,
    SponsorshipStatus.IN_PURCHASE,
    SponsorshipStatus.PACKED,
    SponsorshipStatus.BOXED,
    SponsorshipStatus.AWAITING_DELIVERY,
  ];

  // ✅ Grupo “em progresso” para estatísticas
  private static readonly IN_PROGRESS_GROUP: SponsorshipStatus[] = [
    SponsorshipStatus.IN_PROGRESS,
    SponsorshipStatus.IN_PURCHASE,
    SponsorshipStatus.PACKED,
    SponsorshipStatus.BOXED,
    SponsorshipStatus.AWAITING_DELIVERY,
  ];

  private addYears(base: Date, years: number) {
    const d = new Date(base);
    d.setFullYear(d.getFullYear() + years);
    return d;
  }

  /** Converte minAge/maxAge em um range de birthDate (gte/lte) */
  private buildBirthDateRange(minAge?: number, maxAge?: number) {
    // Idade = floor(diff in years). Para obter por birthDate:
    // minAge ⇒ nasceu até (hoje - minAge anos)  => birthDate <= maxBirth
    // maxAge ⇒ nasceu DEPOIS de (hoje - (maxAge + 1) anos)  => birthDate >= minBirth
    const today = new Date();
    const range: { gte?: Date; lte?: Date } = {};

    if (typeof minAge === 'number' && minAge >= 0) {
      // tem pelo menos minAge → nasceu em data <= hoje - minAge anos
      range.lte = this.addYears(today, -minAge);
    }
    if (typeof maxAge === 'number' && maxAge >= 0) {
      // tem no máximo maxAge → nasceu após hoje - (maxAge+1) anos (aprox: +1 dia)
      const minBirth = this.addYears(today, -(maxAge + 1));
      minBirth.setDate(minBirth.getDate() + 1);
      range.gte = minBirth;
    }

    // se range vazio, retorna undefined para não afetar o where
    return Object.keys(range).length ? range : undefined;
  }

  // LISTAGEM: inclui media da campanha e permite fallback (scan) do FS
  // children.service.ts
  async listPaginated(
    {
      campaignId,
      scanFs = false,
      q,
      cityId,
      communityId,
      schoolId,
      category,
      status,
      photo,
      minAge,
      maxAge,
    }: ListOpts,
    { skip, take }: PageOpts,
  ) {
    // —— where base (sempre) —— //
    const where: any = { deletedAt: null };

    // —— pertence à campanha? só entram crianças com foto publicada para ela
    // OU migradas manualmente para ela (tela de migração seletiva) —— //
    if (campaignId) {
      where.AND = [
        ...(where.AND ?? []),
        {
          OR: [
            { images: { some: { campaignId } } },
            { campaignIncludes: { some: { campaignId } } },
          ],
        },
      ];
    }

    // —— filtros relacionais por ID —— //
    if (cityId) where.cityId = cityId;
    if (communityId) where.communityId = communityId;
    if (schoolId) where.schoolId = schoolId;

    // —— categoria —— //
    if (category) where.category = { equals: category };

    // —— com/sem foto: na campanha (se informada) ou em qualquer campanha —— //
    if (photo === 'without' || photo === 'with') {
      const imageWhere = campaignId ? { campaignId } : {};
      where.AND = [
        ...(where.AND ?? []),
        { images: photo === 'without' ? { none: imageWhere } : { some: imageWhere } },
      ];
    }

    // —— busca textual (name / wantedGift / category) —— //
    if (q && q.trim()) {
      const query = q.trim();
      where.OR = [
        { name: { contains: query, mode: 'insensitive' } },
        { wantedGift: { contains: query, mode: 'insensitive' } },
        { category: { contains: query, mode: 'insensitive' } },
      ];
      // número: também pelo ID principal e pelo ID na campanha
      if (/^\d{1,9}$/.test(query)) {
        const n = parseInt(query, 10);
        where.OR.push(
          { publicId: n },
          { campaignData: { some: { publicId: n, ...(campaignId ? { campaignId } : {}) } } },
        );
      }
    }

    // —— filtro por faixa etária via birthDate —— //
    const birthDateRange = this.buildBirthDateRange(minAge, maxAge);
    if (birthDateRange) {
      where.birthDate = birthDateRange;
    }

    // —— status (available/assigned) —— //
    // Consideramos "ocupado" se tiver sponsorship com status em ACTIVE/PENDING/COMPLETED/IN_PROGRESS.
    // Escopo: se campaignId vier, filtramos por ela; senão, olhamos globalmente.

    // Filtro por status (available/assigned)
    if (status === 'assigned') {
      if (campaignId) {
        where.sponsorships = {
          some: {
            campaignId,
            status: { in: ChildrenService.BUSY_STATUSES },
          },
        };
      } else {
        where.sponsorships = {
          some: {
            status: { in: ChildrenService.BUSY_STATUSES },
          },
        };
      }
    } else if (status === 'available') {
      if (campaignId) {
        where.AND = [
          ...(where.AND ?? []),
          {
            sponsorships: {
              none: {
                campaignId,
                status: { in: ChildrenService.BUSY_STATUSES },
              },
            },
          },
        ];
      } else {
        where.AND = [
          ...(where.AND ?? []),
          {
            sponsorships: {
              none: { status: { in: ChildrenService.BUSY_STATUSES } },
            },
          },
        ];
      }
    }


    // —— total para paginação (com os mesmos filtros) —— //
    const total = await this.prisma.child.count({ where });

    // —— página —— //
    const children = await this.prisma.child.findMany({
      where,
      orderBy: { name: 'asc' },
      skip,
      take,
      include: {
        city: true,
        community: true,
        school: true,
        images: true,
        sponsorships: campaignId
        ? ({
            where: { campaignId, status: { in: ChildrenService.BUSY_STATUSES } },
            select: { id: true, status: true, campaignId: true, createdAt: true },
            orderBy: { createdAt: 'desc' },
            take: 1,
          } as Prisma.Child$sponsorshipsArgs)
        : ({
            where: { status: { in: ChildrenService.BUSY_STATUSES } },
            select: { id: true, status: true, campaignId: true, createdAt: true },
            orderBy: { createdAt: 'desc' },
            take: 1,
          } as Prisma.Child$sponsorshipsArgs),
        // ID e presente específicos desta campanha, quando houver
        ...(campaignId ? { campaignData: { where: { campaignId }, ...campaignDataSelect } } : {}),
      },
    });

    if (campaignId) {
      // ID/presente desta campanha e a imagem montada com o layout da cidade nesta campanha
      const layouts = (await loadCampaignLayouts(this.prisma, [campaignId])).get(campaignId);
      for (const c of children) {
        applyCampaignData(c, campaignId);
        applyCampaignImage(c as any, campaignId, layouts);
      }
    }

    // —— Enriquecimento por scan de FS apenas para itens desta página —— //
    if (campaignId && scanFs) {
      const campaign = await this.prisma.campaign.findUnique({ where: { id: campaignId } });
      const campaignFolder = String(campaign?.publicId ?? campaign?.id ?? '');

      for (const c of children as any[]) {
        // "só layout" (sem foto) não conta: ainda vale procurar a foto no disco
        if ((c.images ?? []).some((i: any) => !i.placeholder)) continue;
        if (!c.city) continue;

        const cityFolder = String(c.city.publicId ?? c.city.id);
        const childFolder = c.publicId;

        const framedKey    = `campaigns/${campaignFolder}/${cityFolder}/${childFolder}/framed.webp`;
        const processedKey = `campaigns/${campaignFolder}/${cityFolder}/${childFolder}/processed.webp`;
        const originalJpg  = `campaigns/${campaignFolder}/${cityFolder}/${childFolder}/original.jpg`;
        const originalPng  = `campaigns/${campaignFolder}/${cityFolder}/${childFolder}/original.png`;
        const originalWebp = `campaigns/${campaignFolder}/${cityFolder}/${childFolder}/original.webp`;

        let url: string | null = null;
        if (await this.storage.exists(framedKey)) {
          url = `${process.env.API_PUBLIC_URL}/uploads/${framedKey}`;
        } else if (await this.storage.exists(processedKey)) {
          url = `${process.env.API_PUBLIC_URL}/uploads/${processedKey}`;
        } else if (await this.storage.exists(originalWebp)) {
          url = `${process.env.API_PUBLIC_URL}/uploads/${originalWebp}`;
        } else if (await this.storage.exists(originalJpg)) {
          url = `${process.env.API_PUBLIC_URL}/uploads/${originalJpg}`;
        } else if (await this.storage.exists(originalPng)) {
          url = `${process.env.API_PUBLIC_URL}/uploads/${originalPng}`;
        }

        if (url) {
          c.images = [{ framedUrl: url, processedUrl: url }];
        }
      }
    }

    const hasMore = skip + children.length < total;
    return { items: children, total, hasMore, skip, take };
  }


  get(id: string) {
    return this.prisma.child.findUnique({ 
      where: { id },
      include: {
        city: true,
        community: true,
        school: true,
        sponsorships: true,
        images: true,
      }
    });
  }

  /**
   * Histórico da criança: todas as campanhas de que participou (foto publicada,
   * migração ou apadrinhamento), com ID, presente, foto, layout e apadrinhamentos de cada uma.
   * `image` é a foto enviada para a própria campanha; `display` é o que o site mostra
   * (foto da campanha montada com o layout atual ou, sem foto, só o layout com a área vazia).
   */
  async campaignHistory(childId: string) {
    const child = await this.prisma.child.findUnique({
      where: { id: childId },
      select: {
        id: true,
        publicId: true,
        cityId: true,
        wantedGift: true,
        photoUrl: true,
        images: {
          where: { campaignId: { not: null } },
          select: {
            id: true, campaignId: true, createdAt: true,
            framedUrl: true, processedUrl: true, originalUrl: true,
            layoutKey: true, layoutUrl: true, Config: true,
          },
          orderBy: { createdAt: 'desc' },
        },
        campaignIncludes: { select: { campaignId: true, sourceCampaignId: true, createdAt: true } },
        campaignData: campaignDataSelect,
        sponsorships: {
          select: {
            id: true, campaignId: true, status: true, method: true, createdAt: true,
            sponsor: { select: { id: true, name: true, email: true } },
          },
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    if (!child) throw new NotFoundException('Criança não encontrada');

    const campaignIds = new Set<string>([
      ...child.images.map((i) => i.campaignId!),
      ...child.campaignIncludes.map((i) => i.campaignId),
      ...child.campaignIncludes.map((i) => i.sourceCampaignId).filter((id): id is string => !!id),
      ...child.campaignData.map((d) => d.campaignId),
      ...child.sponsorships.map((s) => s.campaignId),
    ]);

    const campaigns = await this.prisma.campaign.findMany({
      where: { id: { in: Array.from(campaignIds) } },
      select: { id: true, name: true, year: true, status: true, startDate: true },
      orderBy: [{ year: 'desc' }, { startDate: 'desc' }],
    });
    const nameById = new Map(campaigns.map((c) => [c.id, c.name]));
    const layouts = await loadCampaignLayouts(this.prisma, campaigns.map((c) => c.id));

    // sem nenhum presente por campanha (dados anteriores ao histórico), o presente atual é o único conhecido
    const hasGiftHistory = child.campaignData.some((d) => d.wantedGift);

    return campaigns.map((campaign) => {
      const image = child.images.find((i) => i.campaignId === campaign.id);
      const include = child.campaignIncludes.find((i) => i.campaignId === campaign.id);
      const data = child.campaignData.find((d) => d.campaignId === campaign.id);
      const campaignLayouts = layouts.get(campaign.id);
      const resolved = resolveFrame(campaignLayouts, child.cityId);
      const display = applyCampaignImage({ images: [...child.images], cityId: child.cityId }, campaign.id, campaignLayouts).images?.[0] ?? null;
      const displaySource = display && !image ? child.images.find((i) => i.id === display.id) : null;
      return {
        campaign,
        publicId: data?.publicId ?? child.publicId,
        campaignPublicId: data?.publicId ?? null,
        wantedGift: data?.wantedGift ?? (hasGiftHistory ? null : child.wantedGift ?? null),
        giftFromHistory: !!data?.wantedGift,
        photoUrl: image ? image.framedUrl || image.processedUrl || image.originalUrl : null,
        hasPhoto: !!image,
        image: image ?? null,
        layout: resolved
          ? { id: resolved.frame.id, name: resolved.frame.name, url: resolved.frame.url, config: resolved.frame.config, source: resolved.source }
          : null,
        display,
        // foto mostrada vem de outra campanha (criança migrada sem foto nova)
        displayFromCampaign: displaySource?.campaignId
          ? { id: displaySource.campaignId, name: nameById.get(displaySource.campaignId) ?? null }
          : null,
        migratedFrom: include
          ? { id: include.sourceCampaignId, name: include.sourceCampaignId ? nameById.get(include.sourceCampaignId) ?? null : null, at: include.createdAt }
          : null,
        sponsorships: child.sponsorships.filter((s) => s.campaignId === campaign.id),
      };
    });
  }

  /**
   * Miniatura quadrada da FOTO da criança (sem moldura), para listagens. Com campanha,
   * só a foto dela (sem foto nesta campanha = sem miniatura); sem campanha, a mais recente.
   * Gera uma vez e reaproveita do disco.
   */
  async thumbnail(childId: string, width: number, campaignId?: string) {
    const select = { id: true, processedKey: true, originalKey: true } as const;
    const img = await this.prisma.childImage.findFirst({
      where: { childId, ...(campaignId ? { campaignId } : {}) },
      orderBy: { createdAt: 'desc' },
      select,
    });
    if (!img) throw new NotFoundException('Criança sem foto');

    const srcKey = img.processedKey || img.originalKey;
    const dir = srcKey.split('/').slice(0, -1).join('/');
    const thumbKey = `${dir}/thumb-${img.id}-${width}.webp`;
    if (await this.storage.exists(thumbKey)) return this.storage.readBufferByKey(thumbKey);

    const src = await this.storage.readBufferByKey(srcKey);
    const buf = await sharpLib(src)
      .rotate()
      .resize(width, width, { fit: 'cover', position: 'attention' })
      .webp({ quality: 72 })
      .toBuffer();
    await this.storage.saveBuffer(thumbKey, buf);
    return buf;
  }

  /**
   * ID e presente da criança em uma campanha. ID vazio volta a usar o ID principal;
   * o presente vira também o atual da criança quando a campanha é a mais recente dela.
   */
  async updateCampaignData(childId: string, campaignId: string, body: { publicId?: unknown; wantedGift?: unknown }) {
    const child = await this.prisma.child.findUnique({ where: { id: childId }, select: { id: true } });
    if (!child) throw new NotFoundException('Criança não encontrada');
    const campaign = await this.prisma.campaign.findUnique({ where: { id: campaignId }, select: { id: true } });
    if (!campaign) throw new NotFoundException('Campanha não encontrada');

    const rawId = String(body?.publicId ?? '').trim();
    const publicId = rawId ? parseInt(rawId, 10) : null;
    if (rawId && !Number.isFinite(publicId)) throw new BadRequestException('ID inválido.');
    const wantedGift = String(body?.wantedGift ?? '').trim() || null;

    if (publicId !== null) {
      const taken = await this.prisma.childCampaignData.findFirst({
        where: { campaignId, publicId, childId: { not: childId } },
        select: { child: { select: { name: true } } },
      });
      if (taken) throw new BadRequestException(`ID ${publicId} já usado nesta campanha por ${taken.child.name}.`);
    }

    const saved = await this.prisma.childCampaignData.upsert({
      where: { childId_campaignId: { childId, campaignId } },
      create: { childId, campaignId, publicId, wantedGift },
      update: { publicId, wantedGift },
      select: { publicId: true, wantedGift: true },
    });

    // campanha mais recente da criança → o presente também é o atual
    if (wantedGift) {
      const latest = await this.prisma.campaign.findFirst({
        where: {
          OR: [
            { images: { some: { childId } } },
            { includedChildren: { some: { childId } } },
            { childData: { some: { childId } } },
          ],
        },
        orderBy: [{ year: 'desc' }, { startDate: 'desc' }],
        select: { id: true },
      });
      if (latest?.id === campaignId) await this.prisma.child.update({ where: { id: childId }, data: { wantedGift } });
    }
    return saved;
  }

  private buildWhereForCategories(opts: CategoryOpts): Prisma.ChildWhereInput {
    const { campaignId, q, cityId, communityId, schoolId, status, minAge, maxAge } = opts;

    const where: Prisma.ChildWhereInput = {
      deletedAt: null,
      category: { not: null }, // só queremos categorias preenchidas
    };

    if (campaignId) {
      where.AND = [
        ...((where.AND as any[]) ?? []),
        {
          OR: [
            { images: { some: { campaignId } } },
            { campaignIncludes: { some: { campaignId } } },
          ],
        },
      ];
    }

    if (cityId) where.cityId = cityId;
    if (communityId) where.communityId = communityId;
    if (schoolId) where.schoolId = schoolId;

    if (q && q.trim()) {
      const query = q.trim();
      where.OR = [
        { name: { contains: query, mode: 'insensitive' } },
        { wantedGift: { contains: query, mode: 'insensitive' } },
        { category: { contains: query, mode: 'insensitive' } },
        { description: { contains: query, mode: 'insensitive' } },
      ];
    }

    const birthDateRange = this.buildBirthDateRange(minAge, maxAge);
    if (birthDateRange) where.birthDate = birthDateRange;

    // status lógico, igual ao da listagem
    if (status === 'assigned') {
      where.sponsorships = campaignId
        ? { some: { campaignId, status: { in: ChildrenService.BUSY_STATUSES } } }
        : { some: { status: { in: ChildrenService.BUSY_STATUSES } } };
    } else if (status === 'available') {
      where.AND = [
        campaignId
          ? { sponsorships: { none: { campaignId, status: { in: ChildrenService.BUSY_STATUSES } } } }
          : { sponsorships: { none: { status: { in: ChildrenService.BUSY_STATUSES } } } },
      ];
    }

    return where;
  }


  /** Categorias existentes (mais usadas primeiro) e pares presente → categoria já cadastrados. */
  async categoryHints() {
    const rows = await this.prisma.child.groupBy({
      by: ['category', 'wantedGift'],
      where: { deletedAt: null, category: { not: null } },
      _count: { _all: true },
    });
    const totals = new Map<string, number>();
    const gifts: { gift: string; category: string; count: number }[] = [];
    for (const r of rows) {
      const category = (r.category ?? '').trim();
      if (!category) continue;
      totals.set(category, (totals.get(category) ?? 0) + r._count._all);
      const gift = (r.wantedGift ?? '').trim();
      if (gift) gifts.push({ gift, category, count: r._count._all });
    }
    const categories = Array.from(totals, ([category, count]) => ({ category, count })).sort((a, b) => b.count - a.count);
    return { categories, gifts };
  }

  async listCategories(opts: CategoryOpts) {
    const where = this.buildWhereForCategories(opts);

    // groupBy traz a contagem por categoria + ordenação alfabética
    const rows = await this.prisma.child.groupBy({
      by: ['category'],
      where,
      _count: { _all: true },
      orderBy: { category: 'asc' },
    });

    // Remove nulos por segurança (já filtramos, mas garantimos)
    const items = rows
      .filter(r => r.category !== null)
      .map(r => ({ category: r.category as string, count: r._count._all }));

    return { items, total: items.length };
  }

  async stats() {
    // total de crianças (ajuste se Child não tiver deletedAt)
    let total = 0;
    try {
      total = await this.prisma.child.count({ where: { deletedAt: null } });
    } catch {
      total = await this.prisma.child.count();
    }

    // último sponsorship por criança (sem deletedAt)
    const lastByChild = await this.prisma.sponsorship.groupBy({
      by: ['childId'],
      _max: { createdAt: true },
    });

    if (lastByChild.length === 0) {
      return { total, active: 0, pending: 0, available: total, sponsorshipRate: 0 };
    }

    const orPairs = lastByChild.map(({ childId, _max }) => ({
      childId,
      createdAt: _max.createdAt!, // vem do groupBy
    }));

    const latest = await this.prisma.sponsorship.findMany({
      where: { OR: orPairs },
      select: { status: true },
    });

    // "active" = COMPLETED (mantendo contrato atual)
    const active = latest.filter(x => x.status === 'COMPLETED').length;
    const pending = latest.filter(x => x.status === 'PENDING').length;

    // "in_progress" = qualquer um dos grupos de progresso
    const in_progress = latest.filter(x =>
      ChildrenService.IN_PROGRESS_GROUP.includes(x.status)
    ).length;

    const available = Math.max(0, total - (active + pending + in_progress));
    const sponsorshipRate = total > 0 ? Math.round((active / total) * 100) : 0;

    return {
      total: Number(total),
      active: Number(active),
      pending: Number(pending),
      in_progress: Number(in_progress),
      available: Number(available),
      sponsorshipRate: Number(sponsorshipRate),
    };

  }

  /** Estatísticas restritas ao roster de UMA campanha (fotos publicadas + migrações manuais),
   *  com o status calculado apenas pelos sponsorships DA campanha selecionada. */
  async statsForCampaign(campaignId: string): Promise<Stats> {
    const rosterChildren = await this.prisma.child.findMany({
      where: {
        deletedAt: null,
        OR: [
          { images: { some: { campaignId } } },
          { campaignIncludes: { some: { campaignId } } },
        ],
      },
      select: { id: true },
    });
    const childIds = rosterChildren.map((c) => c.id);
    const total = childIds.length;

    if (total === 0) {
      return { total: 0, active: 0, pending: 0, in_progress: 0, available: 0, sponsorshipRate: 0 };
    }

    const lastByChild = await this.prisma.sponsorship.groupBy({
      by: ['childId'],
      where: { childId: { in: childIds }, campaignId },
      _max: { createdAt: true },
    });

    if (lastByChild.length === 0) {
      return { total, active: 0, pending: 0, in_progress: 0, available: total, sponsorshipRate: 0 };
    }

    const orPairs = lastByChild.map(({ childId, _max }) => ({
      childId,
      campaignId,
      createdAt: _max.createdAt!,
    }));

    const latest = await this.prisma.sponsorship.findMany({
      where: { OR: orPairs },
      select: { status: true },
    });

    const active = latest.filter((x) => x.status === 'COMPLETED').length;
    const pending = latest.filter((x) => x.status === 'PENDING').length;
    const in_progress = latest.filter((x) => ChildrenService.IN_PROGRESS_GROUP.includes(x.status)).length;

    const available = Math.max(0, total - (active + pending + in_progress));
    const sponsorshipRate = total > 0 ? Math.round((active / total) * 100) : 0;

    return {
      total: Number(total),
      active: Number(active),
      pending: Number(pending),
      in_progress: Number(in_progress),
      available: Number(available),
      sponsorshipRate: Number(sponsorshipRate),
    };
  }

  async statsFiltered({ cityId, communityId, schoolId }: RegionFilter): Promise<Stats> {
    // —— monta o filtro dos CHILDREN —— //
    const childWhere: any = {};
    // se você usa soft delete em Child:
    try {
      childWhere.deletedAt = null;
    } catch {
      // ignora se não existir
    }
    if (cityId) childWhere.cityId = cityId;
    if (communityId) childWhere.communityId = communityId;
    if (schoolId) childWhere.schoolId = schoolId;

    // —— pega apenas os IDs das crianças do recorte —— //
    const childIds = await this.prisma.child.findMany({
      where: childWhere,
      select: { id: true },
    });
    const ids = childIds.map(c => c.id);

    const total = ids.length;
    if (total === 0) {
      return { total: 0, active: 0, pending: 0, in_progress: 0, available: 0, sponsorshipRate: 0 };
    }

    // —— último sponsorship por criança do recorte —— //
    // (groupBy com where childId in [ids] é suportado no Prisma)
    const lastByChild = await this.prisma.sponsorship.groupBy({
      by: ['childId'],
      where: { childId: { in: ids } },
      _max: { createdAt: true },
    });

    if (lastByChild.length === 0) {
      // ninguém tem sponsorship: todo mundo "available"
      return {
        total,
        active: 0,
        pending: 0,
        in_progress: 0,
        available: total,
        sponsorshipRate: 0,
      };
    }

    const orPairs = lastByChild.map(({ childId, _max }) => ({
      childId,
      createdAt: _max.createdAt!,
    }));

    // pega os registros MAIS RECENTES (um por criança) e conta por status
    const latest = await this.prisma.sponsorship.findMany({
      where: { OR: orPairs },
      select: { status: true },
    });

    const active = latest.filter(x => x.status === 'COMPLETED').length;
    const pending = latest.filter(x => x.status === 'PENDING').length;
    const in_progress = latest.filter(x =>
      ChildrenService.IN_PROGRESS_GROUP.includes(x.status)
    ).length;

    const available = Math.max(0, total - (active + pending + in_progress));
    const sponsorshipRate = total > 0 ? Math.round((active / total) * 100) : 0;

    return {
      total: Number(total),
      active: Number(active),
      pending: Number(pending),
      in_progress: Number(in_progress),
      available: Number(available),
      sponsorshipRate: Number(sponsorshipRate),
    };
  }

  /** NOVO — retorna: geral + por cidade + por comunidade (tudo em um único payload).
   *  Com `campaignId`, só as crianças da campanha e só os apadrinhamentos dela. */
  async statsOverview(campaignId?: string): Promise<{
    general: Totals;
    byCity: CityRow[];
    byCommunity: CommunityRow[];
    generatedAt: string; // ISO
  }> {
    // 1) Carrega todas as crianças do recorte (sem/deletedAt dependendo do schema)
    const childWhere: any = {};
    try {
      childWhere.deletedAt = null;
    } catch {
      // ignore
    }
    if (campaignId) {
      childWhere.OR = [
        { images: { some: { campaignId } } },
        { campaignIncludes: { some: { campaignId } } },
      ];
    }

    const children = await this.prisma.child.findMany({
      where: childWhere,
      select: {
        id: true,
        cityId: true,
        communityId: true,
        city: { select: { id: true, name: true } },
        community: { select: { id: true, name: true, cityId: true, city: { select: { id: true, name: true } } } },
      },
    });

    const childIds = children.map(c => c.id);
    const totalChildren = childIds.length;

    // 2) Pega o ÚLTIMO sponsorship por criança
    let latestStatusByChild = new Map<string, SponsorshipStatus | null>();

    if (childIds.length > 0) {
      const lastByChild = await this.prisma.sponsorship.groupBy({
        by: ['childId'],
        where: { childId: { in: childIds }, ...(campaignId ? { campaignId } : {}) },
        _max: { createdAt: true },
      });

      if (lastByChild.length > 0) {
        const orPairs = lastByChild.map(({ childId, _max }) => ({
          childId,
          createdAt: _max.createdAt!,
          ...(campaignId ? { campaignId } : {}),
        }));

        const latest = await this.prisma.sponsorship.findMany({
          where: { OR: orPairs },
          select: { childId: true, status: true as const },
        });

        for (const item of latest) {
          latestStatusByChild.set(item.childId, item.status);
        }
      }
    }

    // Garante que todo childId exista no mapa (null = sem sponsorship)
    for (const cid of childIds) {
      if (!latestStatusByChild.has(cid)) latestStatusByChild.set(cid, null);
    }

    // 3) Agrega: geral
    let generalActive = 0, generalPending = 0, generalInProgress = 0;
    for (const cid of childIds) {
      const st = latestStatusByChild.get(cid);
      if (st === 'COMPLETED') generalActive++;
      else if (st === 'PENDING') generalPending++;
      else if (st && ChildrenService.IN_PROGRESS_GROUP.includes(st)) generalInProgress++;
    }
    const generalAvailable = Math.max(0, totalChildren - (generalActive + generalPending + generalInProgress));
    const generalRate = totalChildren > 0 ? Math.round((generalActive / totalChildren) * 100) : 0;
    const general: Totals = {
      total: totalChildren,
      active: generalActive,
      pending: generalPending,
      in_progress: generalInProgress,
      available: generalAvailable,
      sponsorshipRate: generalRate,
    };

    // 4) Agrega: por CIDADE
    const cityAgg = new Map<string, CityRow>();
    for (const c of children) {
      const cityId = c.city?.id ?? c.cityId ?? 'unknown';
      const cityName = c.city?.name ?? '—';
      if (!cityAgg.has(cityId)) {
        cityAgg.set(cityId, {
          cityId,
          cityName,
          total: 0,
          active: 0,
          pending: 0,
          in_progress: 0,
          available: 0,
          sponsorshipRate: 0,
        });
      }
      const row = cityAgg.get(cityId)!;
      row.total += 1;
      const st = latestStatusByChild.get(c.id);
      // por CIDADE
      if (st === 'COMPLETED') row.active += 1;
      else if (st === 'PENDING') row.pending += 1;
      else if (st && ChildrenService.IN_PROGRESS_GROUP.includes(st)) row.in_progress += 1;
    }
    // finalize available + rate
    for (const row of cityAgg.values()) {
      row.available = Math.max(0, row.total - (row.active + row.pending + row.in_progress));
      row.sponsorshipRate = row.total > 0 ? Math.round((row.active / row.total) * 100) : 0;
    }
    const byCity = Array.from(cityAgg.values()).sort((a, b) => a.cityName.localeCompare(b.cityName));

    // 5) Agrega: por COMUNIDADE
    const commAgg = new Map<string, CommunityRow>();
    for (const c of children) {
      const commId = c.community?.id ?? c.communityId ?? 'unknown';
      const commName = c.community?.name ?? '—';
      const cityId = c.community?.city?.id ?? c.city?.id ?? c.cityId ?? 'unknown';
      const cityName = c.community?.city?.name ?? c.city?.name ?? '—';

      if (!commAgg.has(commId)) {
        commAgg.set(commId, {
          communityId: commId,
          communityName: commName,
          cityId,
          cityName,
          total: 0,
          active: 0,
          pending: 0,
          in_progress: 0,
          available: 0,
          sponsorshipRate: 0,
        });
      }
      const row = commAgg.get(commId)!;
      row.total += 1;
      const st = latestStatusByChild.get(c.id);
      // por COMUNIDADE
      if (st === 'COMPLETED') row.active += 1;
      else if (st === 'PENDING') row.pending += 1;
      else if (st && ChildrenService.IN_PROGRESS_GROUP.includes(st)) row.in_progress += 1;
    }
    for (const row of commAgg.values()) {
      row.available = Math.max(0, row.total - (row.active + row.pending + row.in_progress));
      row.sponsorshipRate = row.total > 0 ? Math.round((row.active / row.total) * 100) : 0;
    }
    const byCommunity = Array.from(commAgg.values()).sort((a, b) => {
      const cityCmp = a.cityName.localeCompare(b.cityName);
      if (cityCmp !== 0) return cityCmp;
      return a.communityName.localeCompare(b.communityName);
    });

    return {
      general,
      byCity,
      byCommunity,
      generatedAt: new Date().toISOString(),
    };
  }
  
  create(dto: any) { return this.prisma.child.create({ data: dto }); }
  update(id: string, dto: any) { return this.prisma.child.update({ where: { id }, data: dto }); }
  softDelete(id: string) { return this.prisma.child.update({ where: { id }, data: { deletedAt: new Date() } }); }

  // upload de foto por campanha (mantido), agora usando cidade/IDs numéricos
  async updatePhotoForCampaign(childId: string, campaignId: string, file: Express.Multer.File) {
    const [child, campaign] = await Promise.all([
      this.prisma.child.findUnique({ where: { id: childId }, include: { city: true } }),
      this.prisma.campaign.findUnique({ where: { id: campaignId } }),
    ]);
    if (!child) throw new NotFoundException('Criança não encontrada');
    if (!campaign) throw new NotFoundException('Campanha não encontrada');
    if (!child.city) throw new BadRequestException('Criança sem cidade vinculada');

    const campaignFolder = String(campaign.publicId ?? campaign.id);
    const cityFolder = String(child.city.publicId ?? child.city.id);
    const childPublicId = child.publicId;

    // 1) salva original
    const ext = file.mimetype.includes('png') ? 'png'
             : file.mimetype.includes('webp') ? 'webp'
             : file.mimetype.includes('avif') ? 'avif' : 'jpg';
    const originalKey = this.storage.pathOriginal(campaignFolder, cityFolder, childPublicId, ext);
    const { url: originalUrl } = await this.storage.saveRaw(file.buffer, originalKey);

    // 2) processa
    const processedBuf = await this.storage.toWebp(file.buffer);
    const processedKey = this.storage.pathProcessed(campaignFolder, cityFolder, childPublicId);
    const { url: processedUrl } = await this.storage.saveRaw(processedBuf, processedKey);

    // 3) compõe moldura, se houver
    let framedKey: string | null = null;
    let framedUrl: string | null = null;
    if (campaign.frameKey) {
      const frameBuf = await this.storage.readBufferByKey(campaign.frameKey);
      const cfg = (campaign.frameConfig as any) || {};
      const framedBuf = await this.storage.compositeFramed({
        photo: processedBuf,
        frame: frameBuf,
        width: cfg.width,
        height: cfg.height,
        fit: (cfg.fit || 'cover'),
        gravity: mapGravity(cfg.gravity || 'center'),
        cornerRadius: cfg.cornerRadius || 0,
      });
      framedKey = this.storage.pathFramed(campaignFolder, cityFolder, childPublicId);
      const saved = await this.storage.saveRaw(framedBuf, framedKey);
      framedUrl = saved.url;
    }

    // 4) upsert media por campanha
    const existing = await this.prisma.childImage.findFirst({
      where: { childId, campaignId },
      orderBy: { createdAt: 'desc' }, // em caso de múltiplas, pega a mais recente
    });

    let rec;
    if (!existing) {
      rec = await this.prisma.childImage.create({
        data: {
          childId,
          campaignId,
          originalKey, originalUrl,
          processedKey, processedUrl,
          framedKey: framedKey || null,
          framedUrl: framedUrl || null,
          status: 'COMPOSED', // ou PROCESSED conforme sua lógica
        },
      });
    } else {
      rec = await this.prisma.childImage.update({
        where: { id: existing.id },
        data: {
          originalKey, originalUrl,
          processedKey, processedUrl,
          framedKey: framedKey || null,
          framedUrl: framedUrl || null,
          status: 'COMPOSED',
        },
      });
    }

    return { photoUrl: rec.framedUrl || rec.processedUrl };
  }

  async deletePhotoForCampaign(childId: string, campaignId: string) {
    const media = await this.prisma.childImage.findFirst({
      where: { childId, campaignId },
      orderBy: { createdAt: 'desc' },
    });
    if (!media) return { ok: true };

    await Promise.all([
      this.storage.deleteByKey(media.originalKey || undefined),
      this.storage.deleteByKey(media.processedKey || undefined),
      this.storage.deleteByKey(media.framedKey || undefined),
      this.prisma.childImage.delete({ where: { id: media.id } }),
    ]);

    return { ok: true };
  }
}

function mapGravity(s: string): sharp.Gravity {
  switch (s) {
    case 'north': return 'north';
    case 'south': return 'south';
    case 'east': return 'east';
    case 'west': return 'west';
    case 'northwest': return 'northwest';
    case 'northeast': return 'northeast';
    case 'southwest': return 'southwest';
    case 'southeast': return 'southeast';
    default: return 'center';
  }
}
