import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service'

@Injectable()
export class SponsorshipsService {
  constructor(private prisma: PrismaService) {}

  async create(childId: string, sponsorUserId: string, campaignId: string, note?: string) {
    const dup = await this.prisma.sponsorship.findUnique({
      where: { childId_campaignId: { childId, campaignId } },
    });
    if (dup) throw new BadRequestException('Esta criança já está vinculada a esta campanha.');

    return this.prisma.sponsorship.create({
      data: { childId, sponsorId: sponsorUserId, campaignId, note, status: 'PENDING' },
      include: { child: true, campaign: true },
    });
  }

  mine(sponsorUserId: string, campaignId?: string) {
    return this.prisma.sponsorship.findMany({
      where: { sponsorId: sponsorUserId, ...(campaignId ? { campaignId } : {}) },
      include: {
        child: true,
        campaign: true,
      },
      orderBy: [{ createdAt: 'desc' }],
    });
  }

  listAll(campaignId?: string) {
    return this.prisma.sponsorship.findMany({
      where: campaignId ? { campaignId } : undefined,
      include: { child: true, sponsor: { select: { id: true, name: true, email: true } }, campaign: true },
      orderBy: [{ createdAt: 'desc' }],
    });
  }


  async activate(id: string) {
    return this.prisma.sponsorship.update({
      where: { id },
      data: { status: 'COMPLETED', startDate: new Date() },
    });
  }

  async end(id: string) {
    return this.prisma.sponsorship.update({
      where: { id },
      data: { status: 'ENDED', endDate: new Date() },
    });
  }
}
