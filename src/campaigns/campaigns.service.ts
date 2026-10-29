import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCampaignDto } from './dto/create-campaign.dto';
import { UpdateCampaignDto } from './dto/update-campaign.dto';
import { Prisma } from '@prisma/client';

type ListPagedParams = {
  status?: string;
  page?: number;
  pageSize?: number;
  q?: string;
};

type MigrationItem = { childId: string; wantedGift?: string | null };

function bestImageUrl(img?: { framedUrl: string | null; processedUrl: string | null; originalUrl: string } | null) {
  if (!img) return null;
  return img.framedUrl || img.processedUrl || img.originalUrl || null;
}

@Injectable()
export class CampaignsService {
  constructor(private prisma: PrismaService) {}

  /**
   * Compatível com o que você já tinha:
   * lista simples (sem paginação), ordenada por ano e startDate.
   * A tela aceita array direto OU {items:[...]} — com isso continua ok.
   */
  list(status?: string) {
    return this.prisma.campaign.findMany({
      where: status ? { status: status as any } : undefined,
      orderBy: [{ year: 'desc' }, { startDate: 'desc' }],
    });
  }

  /**
   * Nova listagem com paginação e busca (para suportar ?status=ACTIVE&page=1&pageSize=200&q=...).
   * Retorna { items, page, pageSize, total }.
   */
  async listPaged(params: ListPagedParams = {}) {
    const page = Math.max(parseInt(String(params.page ?? 1), 10) || 1, 1);
    const pageSizeRaw = parseInt(String(params.pageSize ?? 50), 10) || 50;
    const pageSize = Math.min(Math.max(pageSizeRaw, 1), 500);
    const skip = (page - 1) * pageSize;

    // where dinâmico
    const where: any = {};
    if (params.status) where.status = params.status as any;
    if (params.q) {
      const q = String(params.q).trim();
      if (q) {
        where.OR = [
          { name: { contains: q, mode: 'insensitive' } },
          { description: { contains: q, mode: 'insensitive' } },
          { slug: { contains: q, mode: 'insensitive' } },
        ];
      }
    }

    const [items, total] = await this.prisma.$transaction([
      this.prisma.campaign.findMany({
        where,
        orderBy: [{ year: 'desc' }, { startDate: 'desc' }],
        skip,
        take: pageSize,
      }),
      this.prisma.campaign.count({ where }),
    ]);

    return { items, page, pageSize, total };
  }

  getById(id: string) {
    return this.prisma.campaign.findUnique({ where: { id } });
  }

  async getByIdOrThrow(id: string) {
    const c = await this.getById(id);
    if (!c) throw new NotFoundException('Campanha não encontrada');
    return c;
  }

  getBySlug(slug: string) {
    return this.prisma.campaign.findUnique({ where: { slug } });
  }

  create(dto: CreateCampaignDto) {
    return this.prisma.campaign.create({
      data: {
        name: dto.name,
        slug: dto.slug,
        year: dto.year,
        description: dto.description,
        startDate: dto.startDate ? new Date(dto.startDate) : undefined,
        endDate: dto.endDate ? new Date(dto.endDate) : undefined,
        status: dto.status ?? 'DRAFT',
      },
    });
  }

  update(id: string, dto: UpdateCampaignDto) {
    return this.prisma.campaign.update({
      where: { id },
      data: {
        name: dto.name,
        slug: dto.slug,
        year: dto.year,
        description: dto.description,
        startDate: dto.startDate ? new Date(dto.startDate) : undefined,
        endDate: dto.endDate ? new Date(dto.endDate) : undefined,
        status: dto.status,
      },
    });
  }

  /**
   * Migração seletiva de crianças: lista quem já foi incluído manualmente
   * nesta campanha (vindo de outra campanha), com dados básicos para exibição.
   */
  async listIncludedChildren(campaignId: string) {
    await this.getByIdOrThrow(campaignId);
    const rows = await this.prisma.campaignChildInclude.findMany({
      where: { campaignId },
      include: {
        child: {
          select: {
            id: true, publicId: true, name: true, cityName: true,
            city: { select: { id: true, name: true } },
            community: { select: { id: true, name: true } },
            campaignGifts: { where: { campaignId }, select: { wantedGift: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(({ child: { campaignGifts, ...child }, ...r }) => ({
      childId: r.childId,
      sourceCampaignId: r.sourceCampaignId,
      includedAt: r.createdAt,
      wantedGift: campaignGifts[0]?.wantedGift ?? null,
      child,
    }));
  }

  /**
   * Pré-visualização da migração colada da planilha: resolve os IDs públicos
   * e diz, para cada criança, se ela está na origem, se já está no destino,
   * qual o presente e a foto atuais.
   */
  async previewMigration(campaignId: string, publicIds: number[], sourceCampaignId?: string) {
    await this.getByIdOrThrow(campaignId);
    const ids = Array.from(new Set((publicIds ?? []).map((n) => parseInt(String(n), 10)).filter(Number.isFinite)));
    if (!ids.length) return { items: [], notFound: [] };

    const scope = [campaignId, ...(sourceCampaignId ? [sourceCampaignId] : [])];
    const children = await this.prisma.child.findMany({
      where: { publicId: { in: ids }, deletedAt: null },
      select: {
        id: true, publicId: true, name: true, wantedGift: true, photoUrl: true, cityName: true,
        city: { select: { id: true, name: true } },
        community: { select: { id: true, name: true } },
        images: {
          where: { campaignId: { in: scope } },
          select: { campaignId: true, framedUrl: true, processedUrl: true, originalUrl: true },
          orderBy: { createdAt: 'desc' },
        },
        campaignIncludes: { where: { campaignId: { in: scope } }, select: { campaignId: true } },
        campaignGifts: { where: { campaignId: { in: scope } }, select: { campaignId: true, wantedGift: true } },
      },
    });

    const items = children.map((c) => {
      const inCampaign = (id?: string) =>
        !!id && (c.images.some((i) => i.campaignId === id) || c.campaignIncludes.some((i) => i.campaignId === id));
      const giftIn = (id?: string) => c.campaignGifts.find((g) => g.campaignId === id)?.wantedGift ?? null;
      const imageIn = (id?: string) => c.images.find((i) => i.campaignId === id) ?? null;

      return {
        id: c.id,
        publicId: c.publicId,
        name: c.name,
        cityName: c.cityName,
        city: c.city,
        community: c.community,
        inSource: inCampaign(sourceCampaignId),
        alreadyInTarget: inCampaign(campaignId),
        currentGift: giftIn(sourceCampaignId) ?? c.wantedGift ?? null,
        targetGift: giftIn(campaignId),
        currentPhotoUrl: bestImageUrl(imageIn(sourceCampaignId)) ?? c.photoUrl ?? null,
        targetPhotoUrl: bestImageUrl(imageIn(campaignId)),
      };
    });

    const foundIds = new Set(children.map((c) => c.publicId));
    return { items, notFound: ids.filter((id) => !foundIds.has(id)) };
  }

  /**
   * Inclui as crianças selecionadas nesta campanha. Quando `items` traz o
   * presente da nova campanha, ele é gravado no histórico (ChildCampaignGift)
   * e passa a ser o presente atual da criança; o presente anterior é guardado
   * na campanha de origem, se ainda não estiver lá.
   */
  async addIncludedChildren(campaignId: string, childIds: string[], sourceCampaignId?: string, items: MigrationItem[] = []) {
    await this.getByIdOrThrow(campaignId);
    const ids = Array.from(new Set([...(childIds ?? []), ...items.map((i) => i.childId)].filter(Boolean)));
    if (!ids.length) throw new BadRequestException('Informe ao menos uma criança para migrar.');

    const children = await this.prisma.child.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        wantedGift: true,
        images: sourceCampaignId ? { where: { campaignId: sourceCampaignId }, select: { id: true }, take: 1 } : undefined,
        campaignIncludes: sourceCampaignId ? { where: { campaignId: sourceCampaignId }, select: { id: true } } : undefined,
        campaignGifts: sourceCampaignId ? { where: { campaignId: sourceCampaignId }, select: { id: true } } : undefined,
      },
    });
    if (children.length !== ids.length) throw new BadRequestException('Uma ou mais crianças informadas não existem.');
    const byId = new Map(children.map((c) => [c.id, c]));

    const giftOps = items.flatMap(({ childId, wantedGift }) => {
      const gift = String(wantedGift ?? '').trim();
      if (!gift) return [];
      const child = byId.get(childId)!;
      const ops: Prisma.PrismaPromise<unknown>[] = [];

      // guarda o presente anterior na campanha de origem antes de sobrescrever
      const inSource = (child.images?.length ?? 0) > 0 || (child.campaignIncludes?.length ?? 0) > 0;
      if (sourceCampaignId && inSource && !child.campaignGifts?.length && child.wantedGift?.trim()) {
        ops.push(this.prisma.childCampaignGift.create({
          data: { childId, campaignId: sourceCampaignId, wantedGift: child.wantedGift.trim() },
        }));
      }

      ops.push(
        this.prisma.childCampaignGift.upsert({
          where: { childId_campaignId: { childId, campaignId } },
          create: { childId, campaignId, wantedGift: gift },
          update: { wantedGift: gift },
        }),
        this.prisma.child.update({ where: { id: childId }, data: { wantedGift: gift } }),
      );
      return ops;
    });

    await this.prisma.$transaction([
      this.prisma.campaignChildInclude.createMany({
        data: ids.map((childId) => ({ campaignId, childId, sourceCampaignId: sourceCampaignId ?? null })),
        skipDuplicates: true,
      }),
      ...giftOps,
    ]);

    return { added: ids.length };
  }

  /** Remove crianças migradas anteriormente desta campanha (não afeta o cadastro original). */
  async removeIncludedChildren(campaignId: string, childIds: string[]) {
    const ids = Array.from(new Set((childIds ?? []).filter(Boolean)));
    if (!ids.length) return { removed: 0 };
    const [res] = await this.prisma.$transaction([
      this.prisma.campaignChildInclude.deleteMany({
        where: { campaignId, childId: { in: ids } },
      }),
      // o presente só pertence à campanha enquanto a criança faz parte dela (foto publicada mantém)
      this.prisma.childCampaignGift.deleteMany({
        where: { campaignId, childId: { in: ids }, child: { images: { none: { campaignId } } } },
      }),
    ]);
    return { removed: res.count };
  }

  /**
   * Usado pelo alias POST /campaigns/:id/layout — atualiza os campos de frame/layout.
   */
  updateFrame(id: string, data: { frameKey: string | null; frameUrl: string | null }) {
    return this.prisma.campaign.update({
      where: { id },
      data,
    });
  }

  /**
   * Guarda a configuração de composição do frame (overlay no front).
   * Mantido como você já tinha.
   */
  updateFrameConfig(id: string, cfg: any) {
    return this.prisma.campaign.update({
      where: { id },
      data: { frameConfig: cfg as any },
    });
  }

  /**
   * Exclui a campanha e seus recursos dependentes (frames/layouts).
   * Bloqueia a exclusão se já existirem apadrinhamentos vinculados,
   * para não perder histórico de doações.
   */
  async remove(id: string) {
    await this.getByIdOrThrow(id);

    const sponsorshipsCount = await this.prisma.sponsorship.count({ where: { campaignId: id } });
    if (sponsorshipsCount > 0) {
      throw new BadRequestException(
        'Não é possível excluir: esta campanha já possui apadrinhamentos vinculados. Arquive-a em vez de excluir.',
      );
    }

    await this.prisma.$transaction([
      // remove o vínculo de layout ativo antes de apagar os frames
      this.prisma.campaign.update({ where: { id }, data: { activeFrameId: null } }),
      this.prisma.campaignFrame.deleteMany({ where: { campaignId: id } }),
      this.prisma.childImage.updateMany({ where: { campaignId: id }, data: { campaignId: null } }),
      this.prisma.campaign.delete({ where: { id } }),
    ]);

    return { ok: true };
  }

  /**
   * Opcional: totalizador para paginação externa.
   */
  count(params: { status?: string; q?: string } = {}) {
    const where: any = {};
    if (params.status) where.status = params.status as any;
    if (params.q) {
      const q = String(params.q).trim();
      if (q) {
        where.OR = [
          { name: { contains: q, mode: 'insensitive' } },
          { description: { contains: q, mode: 'insensitive' } },
          { slug: { contains: q, mode: 'insensitive' } },
        ];
      }
    }
    return this.prisma.campaign.count({ where });
  }
}
