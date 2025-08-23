import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateChildDto } from './dto/create-child.dto';
import { UpdateChildDto } from './dto/update-child.dto';

@Injectable()
export class ChildrenService {
  constructor(private prisma: PrismaService) {}

  list() {
    return this.prisma.child.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: 'desc' },
      include: {
        sponsorships: {
          where: { status: 'ACTIVE' },
          select: { id: true },
        },
      },
    });
  }

  get(id: string) {
    return this.prisma.child.findUnique({
      where: { id },
      include: {
        sponsorships: { where: { status: 'ACTIVE' }, select: { id: true } },
      },
    });
  }

  create(dto: CreateChildDto) {
    return this.prisma.child.create({ data: dto as any });
  }

  update(id: string, dto: UpdateChildDto) {
    return this.prisma.child.update({ where: { id }, data: dto as any });
  }

  softDelete(id: string) {
    return this.prisma.child.update({ where: { id }, data: { deletedAt: new Date() } });
  }
}
