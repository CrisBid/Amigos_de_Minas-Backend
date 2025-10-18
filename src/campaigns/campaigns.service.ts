import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCampaignDto } from './dto/create-campaign.dto';
import { UpdateCampaignDto } from './dto/update-campaign.dto';
// Se você tiver os tipos do Prisma gerados, pode descomentar para ter autocomplete de enums etc.
// import { Prisma } from '@prisma/client';

type ListPagedParams = {
  status?: string;
  page?: number;
  pageSize?: number;
  q?: string;
};

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
