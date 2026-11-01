import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSchoolDto, UpdateSchoolDto, QuerySchoolsDto } from './dto/schools.dto';

// comunidades atendidas pela escola (N:N), em ordem de vínculo
const communitiesInclude = {
  communities: {
    orderBy: { createdAt: 'asc' },
    select: { community: { select: { id: true, name: true } } },
  },
} satisfies Prisma.SchoolInclude;

type WithLinks = { communities: { community: { id: string; name: string } }[] };

/** Achata os vínculos: `communities: [{ id, name }]` e `communityIds` para o painel */
function present<T extends WithLinks>(school: T) {
  const communities = school.communities.map((l) => l.community);
  return { ...school, communities, communityIds: communities.map((c) => c.id) };
}

@Injectable()
export class SchoolsService {
  constructor(private prisma: PrismaService) {}

  /** Lista final de comunidades: `communityIds` quando vier; senão o `communityId` legado */
  private wantedCommunities(dto: { communityIds?: string[]; communityId?: string | null }): string[] | undefined {
    if (Array.isArray(dto.communityIds)) return [...new Set(dto.communityIds.filter(Boolean))];
    if (dto.communityId !== undefined) return dto.communityId ? [dto.communityId] : [];
    return undefined;
  }

  private async assertSameCity(cityId: string, communityIds: string[]) {
    if (!communityIds.length) return;
    const found = await this.prisma.community.count({ where: { id: { in: communityIds }, cityId } });
    if (found !== communityIds.length) throw new BadRequestException('Todas as comunidades precisam ser da mesma cidade da escola.');
  }

  async create(dto: CreateSchoolDto) {
    const communityIds = this.wantedCommunities(dto) ?? [];
    await this.assertSameCity(dto.cityId, communityIds);

    const created = await this.prisma.school.create({
      data: {
        cityId: dto.cityId,
        communityId: communityIds[0] ?? null,
        name: dto.name,
        slug: dto.slug,
        address: dto.address,
        publicId: dto.publicId ?? null,
        communities: { create: communityIds.map((communityId) => ({ communityId })) },
      },
      include: communitiesInclude,
    });
    return present(created);
  }

  async findMany(query: QuerySchoolsDto) {
    const take = query.take ?? 20;
    const skip = query.skip ?? 0;

    const where: Prisma.SchoolWhereInput = {
      cityId: query.cityId || undefined,
      // escolas que atendem a comunidade (inclusive as compartilhadas com outras)
      communities: query.communityId ? { some: { communityId: query.communityId } } : undefined,
      name: query.q
        ? { contains: query.q, mode: Prisma.QueryMode.insensitive }
        : undefined,
      deletedAt: query.includeDeleted ? undefined : null,
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.school.findMany({
        where,
        skip,
        take,
        orderBy: [{ name: 'asc' }],
        include: {
          city: { select: { id: true, name: true, state: true } },
          community: { select: { id: true, name: true } },
          ...communitiesInclude,
          _count: { select: { children: true } },
        },
      }),
      this.prisma.school.count({ where }),
    ]);

    return { items: items.map(present), total };
  }

  async findOne(id: string) {
    const item = await this.prisma.school.findFirst({
      where: { id },
      include: {
        city: true,
        community: true,
        ...communitiesInclude,
        _count: { select: { children: true } },
      },
    });
    if (!item) throw new NotFoundException('School not found');
    return present(item);
  }

  async update(id: string, dto: UpdateSchoolDto) {
    const exists = await this.prisma.school.findUnique({ where: { id } });
    if (!exists) throw new NotFoundException('School not found');

    const communityIds = this.wantedCommunities(dto);
    if (communityIds) await this.assertSameCity(exists.cityId, communityIds);

    const updated = await this.prisma.$transaction(async (tx) => {
      if (communityIds) {
        await tx.schoolCommunity.deleteMany({ where: { schoolId: id, communityId: { notIn: communityIds } } });
        await tx.schoolCommunity.createMany({
          data: communityIds.map((communityId) => ({ schoolId: id, communityId })),
          skipDuplicates: true,
        });
      }
      return tx.school.update({
        where: { id },
        data: {
          communityId: communityIds ? communityIds[0] ?? null : undefined,
          name: dto.name ?? undefined,
          slug: dto.slug ?? undefined,
          address: dto.address ?? undefined,
          publicId: dto.publicId ?? undefined,
        },
        include: communitiesInclude,
      });
    });
    return present(updated);
  }

  async softDelete(id: string) {
    const exists = await this.prisma.school.findUnique({ where: { id } });
    if (!exists) throw new NotFoundException('School not found');

    return this.prisma.school.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  async restore(id: string) {
    const exists = await this.prisma.school.findUnique({ where: { id } });
    if (!exists) throw new NotFoundException('School not found');

    return this.prisma.school.update({
      where: { id },
      data: { deletedAt: null },
    });
  }
}
