import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { CreateCommunityDto, UpdateCommunityDto, QueryCommunitiesDto } from './dto/communities.dto';

@Injectable()
export class CommunitiesService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateCommunityDto) {
    return this.prisma.community.create({
      data: {
        cityId: dto.cityId,
        name: dto.name,
        slug: dto.slug,
        description: dto.description,
        publicId: dto.publicId ?? null,
      },
    });
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

    return this.prisma.community.update({
      where: { id },
      data: {
        name: dto.name ?? undefined,
        slug: dto.slug ?? undefined,
        description: dto.description ?? undefined,
        publicId: dto.publicId ?? undefined,
      },
    });
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
