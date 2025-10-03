import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../common/storage/storage.service';

@Injectable()
export class CampaignFramesService {
  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
  ) {}

  list(campaignId: string) {
    return this.prisma.campaignFrame.findMany({
      where: { campaignId },
      orderBy: [{ active: 'desc' }, { sort: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async upload(campaign: { id: string; folder: string }, file: { buffer: Buffer; mimetype: string }, name?: string, config?: any) {
    const ext = (file.mimetype.split('/')[1] || 'png').toLowerCase();
    const key = `campaigns/${campaign.folder}/layouts/layout-${Date.now()}.${ext}`;
    await this.storage.saveBuffer(key, file.buffer);
    const url = this.storage.publicUrl(key);

    const created = await this.prisma.campaignFrame.create({
      data: {
        campaignId: campaign.id,
        key, url, mime: file.mimetype,
        name: name ?? null,
        config: config ?? undefined,
      },
    });

    return created;
  }

  async setActive(frameId: string) {
    const frame = await this.prisma.campaignFrame.findUnique({ where: { id: frameId } });
    if (!frame) throw new NotFoundException('Layout não encontrado');

    // Desmarca os demais e marca este
    await this.prisma.$transaction([
      this.prisma.campaignFrame.updateMany({ where: { campaignId: frame.campaignId }, data: { active: false } }),
      this.prisma.campaignFrame.update({ where: { id: frameId }, data: { active: true } }),
      this.prisma.campaign.update({ where: { id: frame.campaignId }, data: { activeFrameId: frameId } }),
    ]);

    return { ok: true };
  }

  async updateMeta(frameId: string, data: { name?: string|null; sort?: number; config?: any }) {
    return this.prisma.campaignFrame.update({
      where: { id: frameId },
      data: {
        name: data.name ?? undefined,
        sort: typeof data.sort === 'number' ? data.sort : undefined,
        config: data.config ?? undefined,
      },
    });
  }

  async remove(frameId: string) {
    const frame = await this.prisma.campaignFrame.findUnique({ where: { id: frameId } });
    if (!frame) return { ok: true };

    // apaga o arquivo (opcional)
    await this.storage.deleteByKey(frame.key).catch(() => {});
    // desliga de activeFrameId se necessário
    await this.prisma.campaign.updateMany({
      where: { activeFrameId: frameId },
      data: { activeFrameId: null },
    });
    await this.prisma.campaignFrame.delete({ where: { id: frameId } });
    return { ok: true };
  }

  async getActiveForCampaign(campaignId: string) {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
      include: { activeFrame: true },
    });
    return campaign?.activeFrame ?? null;
  }

  async getById(id: string) {
    return this.prisma.campaignFrame.findUnique({ where: { id } });
  }
}
