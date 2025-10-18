import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Role } from '@prisma/client';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async findAll(opts: { query?: string; roles?: Role[] } = {}) {
    const { query, roles } = opts;

    const where: any = {};

    // busca textual: name / email / phone (case-insensitive)
    if (query && query.trim()) {
      const q = query.trim();
      where.OR = [
        { name:  { contains: q, mode: 'insensitive' } },
        { email: { contains: q, mode: 'insensitive' } },
        { phone: { contains: q, mode: 'insensitive' } },
      ];
    }

    // filtro por papéis: se vier 1 ou mais, exigimos que possua pelo menos um deles
    if (roles && roles.length > 0) {
      // Prisma enum[]: usar `hasSome`
      where.roles = { hasSome: roles };
    }

    return this.prisma.user.findMany({
      where,
      select: { id: true, name: true, email: true, phone: true, roles: true, createdAt: true },
      orderBy: { name: 'asc' },
    });
  }

  findById(id: string) {
    return this.prisma.user.findUnique({
      where: { id },
      select: { 
        id: true, 
        name: true, 
        email: true, 
        phone: true, 
        roles: true, 
        profile: true,
        createdAt: true 
      },
    });
  }

  updateRoles(id: string, roles: Role[]) {
    return this.prisma.user.update({
      where: { id },
      data:  { roles },
      select: { id: true, name: true, email: true, phone: true, roles: true, createdAt: true },
    });
  }
}
