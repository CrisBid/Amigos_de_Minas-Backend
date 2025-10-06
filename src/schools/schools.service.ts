import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSchoolDto, UpdateSchoolDto, QuerySchoolsDto } from './dto/schools.dto';

@Injectable()
export class SchoolsService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateSchoolDto) {
    return this.prisma.school.create({
      data: {
        cityId: dto.cityId,
        communityId: dto.communityId ?? null,
        name: dto.name,
        slug: dto.slug,
        address: dto.address,
        publicId: dto.publicId ?? null,
      },
    });
  }

  async findMany(query: QuerySchoolsDto) {
    const where: Prisma.SchoolWhereInput = {
        cityId: query.cityId,
        communityId: query.communityId,
        name: query.q
        ? { contains: query.q, mode: Prisma.QueryMode.insensitive } // ⬅️ aqui
        : undefined,
        deletedAt: query.includeDeleted ? undefined : null,
    };

    const [items, total] = await this.prisma.$transaction([
        this.prisma.school.findMany({
        where,
        skip: query.skip ?? 0,
        take: query.take ?? 20,
        orderBy: [{ name: 'asc' }],
        include: {
            city: { select: { id: true, name: true, state: true } },
            community: { select: { id: true, name: true } },
            _count: { select: { children: true } },
        },
        }),
        this.prisma.school.count({ where }),
    ]);

    return { items, total };
    }
  async findOne(id: string) {
    const item = await this.prisma.school.findFirst({
      where: { id },
      include: {
        city: true,
        community: true,
        _count: { select: { children: true } },
      },
    });
    if (!item) throw new NotFoundException('School not found');
    return item;
  }

  async update(id: string, dto: UpdateSchoolDto) {
    const exists = await this.prisma.school.findUnique({ where: { id } });
    if (!exists) throw new NotFoundException('School not found');

    return this.prisma.school.update({
      where: { id },
      data: {
        communityId: dto.communityId ?? undefined,
        name: dto.name ?? undefined,
        slug: dto.slug ?? undefined,
        address: dto.address ?? undefined,
        publicId: dto.publicId ?? undefined,
      },
    });
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
