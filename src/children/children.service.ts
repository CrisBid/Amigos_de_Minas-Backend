import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../common/storage/storage.service';
import * as sharp from 'sharp';

@Injectable()
export class ChildrenService {
  constructor(private prisma: PrismaService, private storage: StorageService) {}

  // LISTAGEM: inclui media da campanha e permite fallback (scan) do FS
  // children.service.ts
  async list(campaignId?: string, scanFs = false) {
    const campaign = campaignId
      ? await this.prisma.campaign.findUnique({ where: { id: campaignId } })
      : null;

    const children = await this.prisma.child.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: 'desc' },
      include: {
        city: true,
        community: true,
        school: true,

        sponsorships: campaignId
          ? {
              where: { campaignId, status: { in: ['COMPLETED', 'PENDING'] } },
              select: { id: true, status: true, campaignId: true, createdAt: true },
              orderBy: { createdAt: 'desc' },
              take: 1,
            }
          : {
              where: { status: { in: ['COMPLETED', 'PENDING'] } },
              select: { id: true, status: true, campaignId: true, createdAt: true },
              orderBy: { createdAt: 'desc' },
              take: 1,
            },

        // 🔁 trocado: media -> images
        images: campaignId
          ? {
              where: { campaignId },
              select: { framedUrl: true, processedUrl: true, createdAt: true },
              orderBy: { createdAt: 'desc' },
              take: 1,
            }
          : false,
      },
    });

    // fallback de FS permanece igual
    if (!campaignId || !scanFs) return children;

    const campaignFolder = String(campaign?.publicId ?? campaign?.id ?? '');
    for (const c of children as any[]) {
      if (c.images && c.images.length > 0) continue; // 🔁 era c.media
      if (!c.city) continue;

      const cityFolder = String(c.city.publicId ?? c.city.id);
      const childFolder = c.publicId;

      const framedKey   = `campaigns/${campaignFolder}/${cityFolder}/${childFolder}/framed.webp`;
      const processedKey= `campaigns/${campaignFolder}/${cityFolder}/${childFolder}/processed.webp`;
      const originalJpg = `campaigns/${campaignFolder}/${cityFolder}/${childFolder}/original.jpg`;
      const originalPng = `campaigns/${campaignFolder}/${cityFolder}/${childFolder}/original.png`;
      const originalWebp= `campaigns/${campaignFolder}/${cityFolder}/${childFolder}/original.webp`;

      let url: string | null = null;
      if (await this.storage.exists(framedKey)) {
        url = `${process.env.API_PUBLIC_URL}/uploads/${framedKey}`;
      } else if (await this.storage.exists(processedKey)) {
        url = `${process.env.API_PUBLIC_URL}/uploads/${processedKey}`;
      } else if (await this.storage.exists(originalWebp)) {
        url = `${process.env.API_PUBLIC_URL}/uploads/${originalWebp}`;
      } else if (await this.storage.exists(originalJpg)) {
        url = `${process.env.API_PUBLIC_URL}/uploads/${originalJpg}`;
      } else if (await this.storage.exists(originalPng)) {
        url = `${process.env.API_PUBLIC_URL}/uploads/${originalPng}`;
      }

      if (url) {
        // 🔁 padroniza no mesmo formato que o include acima
        c.images = [{ framedUrl: url, processedUrl: url }];
      }
    }

    return children;
    }


  get(id: string) {
    return this.prisma.child.findUnique({ 
      where: { id },
      include: {
        city: true,
        community: true,
        school: true,
        sponsorships: true,
        images: true,
      }
    });
  }

  create(dto: any) { return this.prisma.child.create({ data: dto }); }
  update(id: string, dto: any) { return this.prisma.child.update({ where: { id }, data: dto }); }
  softDelete(id: string) { return this.prisma.child.update({ where: { id }, data: { deletedAt: new Date() } }); }

  // upload de foto por campanha (mantido), agora usando cidade/IDs numéricos
  async updatePhotoForCampaign(childId: string, campaignId: string, file: Express.Multer.File) {
    const [child, campaign] = await Promise.all([
      this.prisma.child.findUnique({ where: { id: childId }, include: { city: true } }),
      this.prisma.campaign.findUnique({ where: { id: campaignId } }),
    ]);
    if (!child) throw new NotFoundException('Criança não encontrada');
    if (!campaign) throw new NotFoundException('Campanha não encontrada');
    if (!child.city) throw new BadRequestException('Criança sem cidade vinculada');

    const campaignFolder = String(campaign.publicId ?? campaign.id);
    const cityFolder = String(child.city.publicId ?? child.city.id);
    const childPublicId = child.publicId;

    // 1) salva original
    const ext = file.mimetype.includes('png') ? 'png'
             : file.mimetype.includes('webp') ? 'webp'
             : file.mimetype.includes('avif') ? 'avif' : 'jpg';
    const originalKey = this.storage.pathOriginal(campaignFolder, cityFolder, childPublicId, ext);
    const { url: originalUrl } = await this.storage.saveRaw(file.buffer, originalKey);

    // 2) processa
    const processedBuf = await this.storage.toWebp(file.buffer);
    const processedKey = this.storage.pathProcessed(campaignFolder, cityFolder, childPublicId);
    const { url: processedUrl } = await this.storage.saveRaw(processedBuf, processedKey);

    // 3) compõe moldura, se houver
    let framedKey: string | null = null;
    let framedUrl: string | null = null;
    if (campaign.frameKey) {
      const frameBuf = await this.storage.readBufferByKey(campaign.frameKey);
      const cfg = (campaign.frameConfig as any) || {};
      const framedBuf = await this.storage.compositeFramed({
        photo: processedBuf,
        frame: frameBuf,
        width: cfg.width,
        height: cfg.height,
        fit: (cfg.fit || 'cover'),
        gravity: mapGravity(cfg.gravity || 'center'),
        cornerRadius: cfg.cornerRadius || 0,
      });
      framedKey = this.storage.pathFramed(campaignFolder, cityFolder, childPublicId);
      const saved = await this.storage.saveRaw(framedBuf, framedKey);
      framedUrl = saved.url;
    }

    // 4) upsert media por campanha
    const existing = await this.prisma.childImage.findFirst({
      where: { childId, campaignId },
      orderBy: { createdAt: 'desc' }, // em caso de múltiplas, pega a mais recente
    });

    let rec;
    if (!existing) {
      rec = await this.prisma.childImage.create({
        data: {
          childId,
          campaignId,
          originalKey, originalUrl,
          processedKey, processedUrl,
          framedKey: framedKey || null,
          framedUrl: framedUrl || null,
          status: 'COMPOSED', // ou PROCESSED conforme sua lógica
        },
      });
    } else {
      rec = await this.prisma.childImage.update({
        where: { id: existing.id },
        data: {
          originalKey, originalUrl,
          processedKey, processedUrl,
          framedKey: framedKey || null,
          framedUrl: framedUrl || null,
          status: 'COMPOSED',
        },
      });
    }

    return { photoUrl: rec.framedUrl || rec.processedUrl };
  }

  async deletePhotoForCampaign(childId: string, campaignId: string) {
    const media = await this.prisma.childImage.findFirst({
      where: { childId, campaignId },
      orderBy: { createdAt: 'desc' },
    });
    if (!media) return { ok: true };

    await Promise.all([
      this.storage.deleteByKey(media.originalKey || undefined),
      this.storage.deleteByKey(media.processedKey || undefined),
      this.storage.deleteByKey(media.framedKey || undefined),
      this.prisma.childImage.delete({ where: { id: media.id } }),
    ]);

    return { ok: true };
  }
}

function mapGravity(s: string): sharp.Gravity {
  switch (s) {
    case 'north': return 'north';
    case 'south': return 'south';
    case 'east': return 'east';
    case 'west': return 'west';
    case 'northwest': return 'northwest';
    case 'northeast': return 'northeast';
    case 'southwest': return 'southwest';
    case 'southeast': return 'southeast';
    default: return 'center';
  }
}
