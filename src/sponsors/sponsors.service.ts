import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ListSponsorsDto } from './dto/list.dto';

@Injectable()
export class SponsorsService {
  constructor(private prisma: PrismaService) {}

  async list(dto: ListSponsorsDto) {
    const { q, limit = 50, page = 1, orderBy = 'name', order = 'asc' } = dto;

    const where: any = {
      roles: { has: 'SPONSOR' as any }, // Users que são padrinhos
    };

    if (q?.trim()) {
      const term = q.trim();
      where.OR = [
        { name:  { contains: term, mode: 'insensitive' } },
        { email: { contains: term, mode: 'insensitive' } },
        { phone: { contains: term, mode: 'insensitive' } },
        { profile: { phone: { contains: term, mode: 'insensitive' } } },
      ];
    }

    const [total, items] = await this.prisma.$transaction([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        orderBy: { [orderBy]: order },
        take: limit,
        skip: (page - 1) * limit,
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          createdAt: true,
          profile: { select: { phone: true } },
        },
      }),
    ]);

    // Normaliza contato (prioriza User.phone, senão Profile.phone)
    const normalized = items.map(u => ({
      id: u.id,
      name: u.name,
      email: u.email,
      contact: u.phone ?? u.profile?.phone ?? null,
      createdAt: u.createdAt,
    }));

    return { total, page, limit, items: normalized };
  }
}
