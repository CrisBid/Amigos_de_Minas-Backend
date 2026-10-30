import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
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

  // ---- layout por cidade ----

  listCityLayouts(campaignId: string) {
    return this.prisma.campaignCityLayout.findMany({
      where: { campaignId },
      select: { cityId: true, frameId: true },
    });
  }

  /** Define o layout da cidade nesta campanha; `frameId` vazio volta para o layout ativo da campanha. */
  async setCityLayout(campaignId: string, cityId: string, frameId?: string | null) {
    if (!frameId) {
      await this.prisma.campaignCityLayout.deleteMany({ where: { campaignId, cityId } });
      return { cityId, frameId: null };
    }
    const frame = await this.prisma.campaignFrame.findUnique({ where: { id: frameId }, select: { campaignId: true } });
    if (!frame || frame.campaignId !== campaignId) throw new BadRequestException('Layout não pertence a esta campanha.');
    const city = await this.prisma.city.findUnique({ where: { id: cityId }, select: { id: true } });
    if (!city) throw new NotFoundException('Cidade não encontrada');

    await this.prisma.campaignCityLayout.upsert({
      where: { campaignId_cityId: { campaignId, cityId } },
      create: { campaignId, cityId, frameId },
      update: { frameId },
    });
    return { cityId, frameId };
  }

  /** Layout para montar a foto de uma criança: o da cidade dela nesta campanha, senão o ativo da campanha. */
  async resolveForChild(campaignId: string, cityId?: string | null) {
    if (cityId) {
      const byCity = await this.prisma.campaignCityLayout.findUnique({
        where: { campaignId_cityId: { campaignId, cityId } },
        include: { frame: true },
      });
      if (byCity?.frame) return byCity.frame;
    }
    return this.getActiveForCampaign(campaignId);
  }
}
