import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCampaignDto } from './dto/create-campaign.dto';
import { UpdateCampaignDto } from './dto/update-campaign.dto';
import { applyCampaignData, campaignDataSelect } from '../common/child-campaign-data';

type ListPagedParams = {
  status?: string;
  page?: number;
  pageSize?: number;
  q?: string;
};

type MigrationItem = { childId: string; wantedGift?: string | null; publicId?: number | null };

/** Criança da planilha que ainda não existe no cadastro. */
export type NewChildItem = {
  key?: string; // identificador do painel, devolvido junto com o id criado
  name: string;
  birthDate?: string | null; // yyyy-mm-dd
  age?: number | null;
  motherName?: string | null;
  wantedGift?: string | null;
  publicId?: number | null; // ID nesta campanha
};

type AddIncludedChildrenOpts = {
  childIds?: string[];
  sourceCampaignId?: string;
  items?: MigrationItem[];
  newChildren?: NewChildItem[];
  cityId?: string;
  communityId?: string | null;
};

type MigrationCandidatesParams = { sourceCampaignId?: string; cityId?: string; communityId?: string };

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
            id: true, publicId: true, name: true, wantedGift: true, cityName: true,
            city: { select: { id: true, name: true } },
            community: { select: { id: true, name: true } },
            campaignData: { where: { campaignId }, ...campaignDataSelect },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => {
      const giftInCampaign = r.child.campaignData[0]?.wantedGift ?? null;
      return {
        childId: r.childId,
        sourceCampaignId: r.sourceCampaignId,
        includedAt: r.createdAt,
        wantedGift: giftInCampaign,
        child: applyCampaignData(r.child, campaignId),
      };
    });
  }

  /**
   * Candidatas da migração colada da planilha: todas as crianças da cidade/comunidade
   * escolhida (o casamento com as linhas da planilha é feito pelo nome no painel,
   * porque o ID muda de uma campanha para outra). Para cada uma diz se está na origem,
   * se já está no destino, o ID/presente/foto em cada campanha. Também devolve os IDs
   * já usados na campanha de destino, para o painel avisar de conflitos.
   */
  async migrationCandidates(campaignId: string, { sourceCampaignId, cityId, communityId }: MigrationCandidatesParams) {
    await this.getByIdOrThrow(campaignId);
    if (!cityId && !communityId) throw new BadRequestException('Informe a cidade ou a comunidade.');

    const scope = [campaignId, ...(sourceCampaignId ? [sourceCampaignId] : [])];
    const [children, used] = await Promise.all([
      this.prisma.child.findMany({
        where: { deletedAt: null, ...(cityId ? { cityId } : {}), ...(communityId ? { communityId } : {}) },
        orderBy: { name: 'asc' },
        select: {
          id: true, publicId: true, name: true, birthDate: true, age: true, motherName: true,
          wantedGift: true, photoUrl: true, cityName: true,
          city: { select: { id: true, name: true } },
          community: { select: { id: true, name: true } },
          images: {
            where: { campaignId: { in: scope } },
            select: { campaignId: true, framedUrl: true, processedUrl: true, originalUrl: true },
            orderBy: { createdAt: 'desc' },
          },
          campaignIncludes: { where: { campaignId: { in: scope } }, select: { campaignId: true } },
          campaignData: { where: { campaignId: { in: scope } }, ...campaignDataSelect },
        },
      }),
      this.prisma.childCampaignData.findMany({
        where: { campaignId, publicId: { not: null } },
        select: { publicId: true, childId: true, child: { select: { name: true } } },
      }),
    ]);

    const items = children.map((c) => {
      const inCampaign = (id?: string) =>
        !!id && (c.images.some((i) => i.campaignId === id) || c.campaignIncludes.some((i) => i.campaignId === id));
      const dataIn = (id?: string) => c.campaignData.find((d) => d.campaignId === id) ?? null;
      const imageIn = (id?: string) => c.images.find((i) => i.campaignId === id) ?? null;

      return {
        id: c.id,
        name: c.name,
        birthDate: c.birthDate,
        age: c.age,
        motherName: c.motherName,
        cityName: c.cityName,
        city: c.city,
        community: c.community,
        inSource: inCampaign(sourceCampaignId),
        alreadyInTarget: inCampaign(campaignId),
        currentPublicId: dataIn(sourceCampaignId)?.publicId ?? c.publicId,
        targetPublicId: dataIn(campaignId)?.publicId ?? null,
        currentGift: dataIn(sourceCampaignId)?.wantedGift ?? c.wantedGift ?? null,
        targetGift: dataIn(campaignId)?.wantedGift ?? null,
        currentPhotoUrl: bestImageUrl(imageIn(sourceCampaignId)) ?? c.photoUrl ?? null,
        // foto sem layout (para pré-visualizar outra composição)
        currentRawPhotoUrl: (() => {
          const img = imageIn(sourceCampaignId) ?? c.images[0];
          return img ? img.processedUrl || img.originalUrl || null : null;
        })(),
        targetPhotoUrl: bestImageUrl(imageIn(campaignId)),
      };
    });

    return {
      items,
      usedTargetIds: used.map((u) => ({ publicId: u.publicId!, childId: u.childId, name: u.child.name })),
    };
  }

  /**
   * Inclui as crianças selecionadas nesta campanha. Cada item pode trazer o ID
   * da criança nesta campanha e o presente pedido; ambos ficam em ChildCampaignData.
   * O presente passa a ser o atual da criança, e o anterior é guardado na
   * campanha de origem, se ainda não estiver lá.
   *
   * `newChildren` são crianças da planilha que não existem no cadastro: são
   * criadas na cidade/comunidade informada e já entram nesta campanha. O ID
   * da planilha vira o ID delas nesta campanha e, se estiver livre, também o
   * ID principal do cadastro (senão usamos o próximo número livre).
   */
  async addIncludedChildren(campaignId: string, opts: AddIncludedChildrenOpts) {
    const { sourceCampaignId, cityId, communityId } = opts;
    const items = opts.items ?? [];
    const newChildren = (opts.newChildren ?? []).filter((n) => String(n?.name ?? '').trim());

    await this.getByIdOrThrow(campaignId);
    const ids = Array.from(new Set([...(opts.childIds ?? []), ...items.map((i) => i.childId)].filter(Boolean)));
    if (!ids.length && !newChildren.length) throw new BadRequestException('Informe ao menos uma criança para migrar.');

    // —— local das crianças novas —— //
    let city: { id: string; name: string } | null = null;
    if (newChildren.length) {
      if (!cityId) throw new BadRequestException('Informe a cidade para cadastrar as crianças novas.');
      city = await this.prisma.city.findUnique({ where: { id: cityId }, select: { id: true, name: true } });
      if (!city) throw new BadRequestException('Cidade não encontrada.');
      if (communityId) {
        const community = await this.prisma.community.findUnique({ where: { id: communityId }, select: { cityId: true } });
        if (!community || community.cityId !== city.id) throw new BadRequestException('Comunidade não encontrada nesta cidade.');
      }
    }

    const children = await this.prisma.child.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        wantedGift: true,
        images: sourceCampaignId ? { where: { campaignId: sourceCampaignId }, select: { id: true }, take: 1 } : undefined,
        campaignIncludes: sourceCampaignId ? { where: { campaignId: sourceCampaignId }, select: { id: true } } : undefined,
        campaignData: sourceCampaignId ? { where: { campaignId: sourceCampaignId }, select: { id: true } } : undefined,
      },
    });
    if (children.length !== ids.length) throw new BadRequestException('Uma ou mais crianças informadas não existem.');
    const byId = new Map(children.map((c) => [c.id, c]));

    const toInt = (v: unknown) => {
      const n = parseInt(String(v ?? ''), 10);
      return Number.isFinite(n) ? n : null;
    };
    const entries = items.map((i) => ({ childId: i.childId, gift: String(i.wantedGift ?? '').trim(), publicId: toInt(i.publicId) }));
    const fresh = newChildren.map((n) => ({ ...n, name: String(n.name).trim(), gift: String(n.wantedGift ?? '').trim(), publicId: toInt(n.publicId) }));

    // IDs nesta campanha: sem repetição no lote nem com crianças que ficam de fora dele
    const batchIds = [...entries, ...fresh].map((e) => e.publicId).filter((n): n is number => n !== null);
    const repeated = batchIds.filter((n, i) => batchIds.indexOf(n) !== i);
    if (repeated.length) {
      throw new BadRequestException(`ID repetido na lista: ${Array.from(new Set(repeated)).join(', ')}.`);
    }
    if (batchIds.length) {
      const taken = await this.prisma.childCampaignData.findMany({
        where: { campaignId, publicId: { in: batchIds }, childId: { notIn: entries.map((e) => e.childId) } },
        select: { publicId: true, child: { select: { name: true } } },
      });
      if (taken.length) {
        throw new BadRequestException(
          `ID já usado nesta campanha por outra criança: ${taken.map((t) => `${t.publicId} (${t.child.name})`).join(', ')}.`,
        );
      }
    }

    // ID principal das crianças novas: o da planilha se estiver livre no cadastro, senão o próximo número livre
    const globalIds: number[] = [];
    if (fresh.length) {
      const wanted = fresh.map((f) => f.publicId).filter((n): n is number => n !== null);
      const [used, max] = await Promise.all([
        this.prisma.child.findMany({ where: { publicId: { in: wanted } }, select: { publicId: true } }),
        this.prisma.child.aggregate({ _max: { publicId: true } }),
      ]);
      const usedSet = new Set(used.map((u) => u.publicId));
      let next = Math.max(max._max.publicId ?? 0, ...wanted) + 1;
      for (const f of fresh) {
        if (f.publicId !== null && !usedSet.has(f.publicId)) {
          usedSet.add(f.publicId);
          globalIds.push(f.publicId);
        } else {
          globalIds.push(next++);
        }
      }
    }

    const created = await this.prisma.$transaction(async (tx) => {
      if (ids.length) {
        await tx.campaignChildInclude.createMany({
          data: ids.map((childId) => ({ campaignId, childId, sourceCampaignId: sourceCampaignId ?? null })),
          skipDuplicates: true,
        });
      }

      // libera os IDs das crianças do lote antes de regravar (permite trocar IDs entre elas)
      const reassigned = entries.filter((e) => e.publicId !== null).map((e) => e.childId);
      if (reassigned.length) {
        await tx.childCampaignData.updateMany({ where: { campaignId, childId: { in: reassigned } }, data: { publicId: null } });
      }

      for (const { childId, gift, publicId } of entries) {
        if (!gift && publicId === null) continue;
        const child = byId.get(childId)!;

        if (gift) {
          // guarda o presente anterior na campanha de origem antes de sobrescrever o atual
          const inSource = (child.images?.length ?? 0) > 0 || (child.campaignIncludes?.length ?? 0) > 0;
          if (sourceCampaignId && inSource && !child.campaignData?.length && child.wantedGift?.trim()) {
            await tx.childCampaignData.create({
              data: { childId, campaignId: sourceCampaignId, wantedGift: child.wantedGift.trim() },
            });
          }
          await tx.child.update({ where: { id: childId }, data: { wantedGift: gift } });
        }

        const data = { ...(gift ? { wantedGift: gift } : {}), ...(publicId !== null ? { publicId } : {}) };
        await tx.childCampaignData.upsert({
          where: { childId_campaignId: { childId, campaignId } },
          create: { childId, campaignId, ...data },
          update: data,
        });
      }

      // —— crianças novas —— //
      const out: { key: string; childId: string; publicId: number }[] = [];
      for (const [i, f] of fresh.entries()) {
        const child = await tx.child.create({
          data: {
            publicId: globalIds[i],
            name: f.name,
            birthDate: f.birthDate ? new Date(`${f.birthDate}T00:00:00.000Z`) : null,
            age: toInt(f.age),
            motherName: String(f.motherName ?? '').trim() || null,
            wantedGift: f.gift || null,
            cityId: city!.id,
            cityName: city!.name,
            communityId: communityId || null,
            campaignIncludes: { create: { campaignId } },
            campaignData: { create: { campaignId, publicId: f.publicId, wantedGift: f.gift || null } },
          },
          select: { id: true, publicId: true },
        });
        out.push({ key: String(f.key ?? i), childId: child.id, publicId: child.publicId });
      }
      return out;
    }, { timeout: 120_000 });

    return { added: ids.length, created };
  }

  /** Remove crianças migradas anteriormente desta campanha (não afeta o cadastro original). */
  async removeIncludedChildren(campaignId: string, childIds: string[]) {
    const ids = Array.from(new Set((childIds ?? []).filter(Boolean)));
    if (!ids.length) return { removed: 0 };
    const [res] = await this.prisma.$transaction([
      this.prisma.campaignChildInclude.deleteMany({
        where: { campaignId, childId: { in: ids } },
      }),
      // ID e presente só pertencem à campanha enquanto a criança faz parte dela (foto publicada mantém)
      this.prisma.childCampaignData.deleteMany({
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
