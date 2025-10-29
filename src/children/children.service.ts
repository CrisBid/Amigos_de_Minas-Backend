import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../common/storage/storage.service';
import * as sharp from 'sharp';
import { Prisma, SponsorshipStatus } from '@prisma/client';

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
      minAge,
      maxAge,
    }: ListOpts,
    { skip, take }: PageOpts,
  ) {
    // —— where base (sempre) —— //
    const where: any = { deletedAt: null };

    // —— filtros relacionais por ID —— //
    if (cityId) where.cityId = cityId;
    if (communityId) where.communityId = communityId;
    if (schoolId) where.schoolId = schoolId;

    // —— categoria —— //
    if (category) where.category = { equals: category };

    // —— busca textual (name / wantedGift / category) —— //
    if (q && q.trim()) {
      const query = q.trim();
      where.OR = [
        { name: { contains: query, mode: 'insensitive' } },
        { wantedGift: { contains: query, mode: 'insensitive' } },
        { category: { contains: query, mode: 'insensitive' } },
      ];
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
      },
    });

    // —— Enriquecimento por scan de FS apenas para itens desta página —— //
    if (campaignId && scanFs) {
      const campaign = await this.prisma.campaign.findUnique({ where: { id: campaignId } });
      const campaignFolder = String(campaign?.publicId ?? campaign?.id ?? '');

      for (const c of children as any[]) {
        if ((c.images?.length ?? 0) > 0) continue;
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

  private buildWhereForCategories(opts: CategoryOpts): Prisma.ChildWhereInput {
    const { campaignId, q, cityId, communityId, schoolId, status, minAge, maxAge } = opts;

    const where: Prisma.ChildWhereInput = {
      deletedAt: null,
      category: { not: null }, // só queremos categorias preenchidas
    };

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

  /** NOVO — retorna: geral + por cidade + por comunidade (tudo em um único payload) */
  async statsOverview(): Promise<{
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
        where: { childId: { in: childIds } },
        _max: { createdAt: true },
      });

      if (lastByChild.length > 0) {
        const orPairs = lastByChild.map(({ childId, _max }) => ({
          childId,
          createdAt: _max.createdAt!,
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
