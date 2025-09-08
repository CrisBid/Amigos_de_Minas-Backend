// src/cities/cities.service.ts
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCityDto } from './dto/create-city.dto';
import { UpdateCityDto } from './dto/update-city.dto';
import { Prisma } from '@prisma/client'; // <-- importe o Prisma para usar QueryMode e tipos

@Injectable()
export class CitiesService {
  constructor(private prisma: PrismaService) {}

  async nextPublicId() {
    const last = await this.prisma.city.findFirst({
      orderBy: { publicId: 'desc' },
      select: { publicId: true },
    });
    return (last?.publicId ?? 0) + 1;
  }

  async list(params: { q?: string; page?: number; pageSize?: number }) {
    const page = Math.max(1, Number(params.page || 1));
    const pageSize = Math.min(100, Math.max(1, Number(params.pageSize || 20)));

    const where: Prisma.CityWhereInput = params.q
      ? {
          OR: [
            { name: { contains: params.q, mode: Prisma.QueryMode.insensitive } },
            { state: { contains: params.q, mode: Prisma.QueryMode.insensitive } },
          ],
        }
      : {};

    const [items, total] = await Promise.all([
      this.prisma.city.findMany({
        where,
        orderBy: [{ name: 'asc' }, { publicId: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.city.count({ where }),
    ]);

    return { items, total, page, pageSize, pages: Math.ceil(total / pageSize) };
  }

  async findById(id: string) {
    const city = await this.prisma.city.findUnique({ where: { id } });
    if (!city) throw new NotFoundException('City not found');
    return city;
  }

  async create(dto: CreateCityDto) {
    const publicId = dto.publicId ?? (await this.nextPublicId());
    const exists = await this.prisma.city.findUnique({ where: { publicId } });
    if (exists) throw new BadRequestException('publicId already in use');

    return this.prisma.city.create({
      data: {
        publicId,
        name: dto.name.trim(),
        state: dto.state?.trim(),
      },
    });
  }

  async update(id: string, dto: UpdateCityDto) {
    await this.findById(id);
    if (dto.publicId) {
      const other = await this.prisma.city.findUnique({ where: { publicId: dto.publicId } });
      if (other && other.id !== id) throw new BadRequestException('publicId already in use');
    }
    return this.prisma.city.update({
      where: { id },
      data: {
        ...(dto.publicId ? { publicId: dto.publicId } : {}),
        ...(dto.name ? { name: dto.name.trim() } : {}),
        ...(dto.state !== undefined ? { state: dto.state?.trim() ?? null } : {}),
      },
    });
  }

  async remove(id: string) {
    await this.findById(id);
    await this.prisma.child.updateMany({
      where: { cityId: id },
      data: { cityId: null },
    });
    return this.prisma.city.delete({ where: { id } });
  }
}
