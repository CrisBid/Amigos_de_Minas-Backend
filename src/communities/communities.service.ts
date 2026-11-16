import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { CreateCommunityDto, UpdateCommunityDto, QueryCommunitiesDto } from './dto/communities.dto';

@Injectable()
export class CommunitiesService {
  constructor(private prisma: PrismaService) {}

  /**
   * Cria a comunidade. O nome é único por cidade (o banco recusa repetido): se já existe uma
   * ativa com esse nome, avisa; se existe uma excluída, ela é reativada em vez de dar erro.
   */
  async create(dto: CreateCommunityDto) {
    const name = String(dto.name ?? '').trim().replace(/\s+/g, ' ');
    if (!name) throw new BadRequestException('Informe o nome da comunidade.');
    const city = await this.prisma.city.findUnique({ where: { id: dto.cityId }, select: { id: true, name: true } });
    if (!city) throw new BadRequestException('Cidade não encontrada.');

    // mesmo nome na cidade, sem diferença de maiúsculas (inclui as excluídas)
    const same = await this.prisma.community.findFirst({
      where: { cityId: city.id, name: { equals: name, mode: 'insensitive' } },
      select: { id: true, name: true, deletedAt: true, publicId: true },
    });
    if (same && !same.deletedAt) {
      throw new BadRequestException(`A comunidade "${same.name}" já existe em ${city.name}.`);
    }
    if (dto.publicId != null && dto.publicId !== same?.publicId) {
      const clash = await this.prisma.community.findFirst({
        where: { publicId: dto.publicId, ...(same ? { id: { not: same.id } } : {}) },
        select: { name: true },
      });
      if (clash) throw new BadRequestException(`O ID público ${dto.publicId} já pertence à comunidade "${clash.name}".`);
    }

    try {
      if (same) {
        return await this.prisma.community.update({
          where: { id: same.id },
          data: {
            name,
            deletedAt: null,
            slug: dto.slug ?? undefined,
            description: dto.description ?? undefined,
            publicId: dto.publicId ?? undefined,
          },
        });
      }
      return await this.prisma.community.create({
        data: {
          cityId: city.id,
          name,
          slug: dto.slug,
          description: dto.description,
          publicId: dto.publicId ?? null,
        },
      });
    } catch (e) {
      // corrida (duas pessoas criando ao mesmo tempo) ou outra regra de unicidade
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new BadRequestException(`Já existe uma comunidade "${name}" em ${city.name} (ou o ID público já está em uso).`);
      }
      throw e;
    }
  }

    async findMany(query: QueryCommunitiesDto) {
      const take = query.take ?? 20;
      const skip = query.skip ?? 0;

      const where: Prisma.CommunityWhereInput = {
        cityId: query.cityId,
        name: query.q ? { contains: query.q, mode: Prisma.QueryMode.insensitive } : undefined,
        deletedAt: query.includeDeleted ? undefined : null,
      };

      const [items, total] = await this.prisma.$transaction([
        this.prisma.community.findMany({
          where,
          skip,
          take,
          orderBy: [{ name: 'asc' }],
          include: {
            _count: { select: { schools: true, children: true } },
            city: { select: { id: true, name: true, state: true } },
          },
        }),
        this.prisma.community.count({ where }),
      ]);

      return { items, total };
    }


  async findOne(id: string) {
    const item = await this.prisma.community.findFirst({
      where: { id },
      include: {
        city: true,
        _count: { select: { schools: true, children: true } },
      },
    });
    if (!item) throw new NotFoundException('Community not found');
    return item;
  }

  async update(id: string, dto: UpdateCommunityDto) {
    const exists = await this.prisma.community.findUnique({ where: { id } });
    if (!exists) throw new NotFoundException('Community not found');

    const cityId = dto.cityId || exists.cityId;
    const name = dto.name?.trim() || exists.name;
    const cityChanged = cityId !== exists.cityId;

    let city: { id: string; name: string } | null = null;
    if (cityChanged) {
      city = await this.prisma.city.findUnique({ where: { id: cityId }, select: { id: true, name: true } });
      if (!city) throw new BadRequestException('Cidade não encontrada.');
    }

    // nome é único por cidade
    if (cityChanged || name !== exists.name) {
      const clash = await this.prisma.community.findFirst({ where: { cityId, name, id: { not: id } }, select: { id: true } });
      if (clash) throw new BadRequestException(`Já existe uma comunidade "${name}" nesta cidade.`);
    }
    if (dto.publicId != null && dto.publicId !== exists.publicId) {
      const clash = await this.prisma.community.findFirst({ where: { publicId: dto.publicId, id: { not: id } }, select: { id: true } });
      if (clash) throw new BadRequestException(`O ID público ${dto.publicId} já pertence a outra comunidade.`);
    }

    const updateCommunity = this.prisma.community.update({
      where: { id },
      data: {
        cityId,
        name,
        slug: dto.slug ?? undefined,
        description: dto.description ?? undefined,
        publicId: dto.publicId ?? undefined,
      },
    });
    if (!cityChanged) return updateCommunity;

    // mudou de cidade: crianças e escolas da comunidade vão junto
    const [updated] = await this.prisma.$transaction([
      updateCommunity,
      this.prisma.child.updateMany({ where: { communityId: id }, data: { cityId, cityName: city!.name } }),
      // escolas só desta comunidade vão junto; as compartilhadas ficam e perdem o vínculo com ela
      this.prisma.school.updateMany({
        where: { communities: { some: { communityId: id }, every: { communityId: id } } },
        data: { cityId },
      }),
      this.prisma.schoolCommunity.deleteMany({
        where: { communityId: id, school: { communities: { some: { communityId: { not: id } } } } },
      }),
      this.prisma.school.updateMany({
        where: { communityId: id, communities: { none: { communityId: id } } },
        data: { communityId: null },
      }),
    ]);
    return updated;
  }

  async softDelete(id: string) {
    const exists = await this.prisma.community.findUnique({ where: { id } });
    if (!exists) throw new NotFoundException('Community not found');

    return this.prisma.community.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  async restore(id: string) {
    const exists = await this.prisma.community.findUnique({ where: { id } });
    if (!exists) throw new NotFoundException('Community not found');

    return this.prisma.community.update({
      where: { id },
      data: { deletedAt: null },
    });
  }
}
