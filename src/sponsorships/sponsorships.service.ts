import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service'

@Injectable()
export class SponsorshipsService {
  constructor(private prisma: PrismaService) {}

  async create(childId: string, sponsorUserId: string, note?: string) {
    // Evita duplicidade ativa
    const active = await this.prisma.sponsorship.findFirst({
      where: { childId, status: 'ACTIVE' },
    });
    if (active) throw new BadRequestException('Criança já possui apadrinhamento ativo.');

    return this.prisma.sponsorship.create({
      data: { childId, sponsorId: sponsorUserId, note, status: 'PENDING' },
    });
  }

  mine(sponsorUserId: string) {
    return this.prisma.sponsorship.findMany({
      where: { sponsorId: sponsorUserId },
      include: { child: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  listAll() {
    return this.prisma.sponsorship.findMany({
      include: { child: true, sponsor: { select: { id: true, name: true, email: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async activate(id: string) {
    return this.prisma.sponsorship.update({
      where: { id },
      data: { status: 'ACTIVE', startDate: new Date() },
    });
  }

  async end(id: string) {
    return this.prisma.sponsorship.update({
      where: { id },
      data: { status: 'ENDED', endDate: new Date() },
    });
  }
}
