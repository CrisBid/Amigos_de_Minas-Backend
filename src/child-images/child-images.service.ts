import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../common/storage/storage.service';

type ComposeOpts = {
  width?: number;
  height?: number;
  fit?: 'cover'|'contain'|'fill'|'inside'|'outside';
  gravity?: any; // sharp.Gravity
  cornerRadius?: number;
};

@Injectable()
export class ChildImagesService {
  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
  ) {}

  async createFromUpload(args: {
    childId: string;               // id (UUID) da criança
    childPublicId: number;         // publicId numérico (para pasta)
    campaign: { id: string; folder: string; frameKey?: string|null; frameUrl?: string|null; frameConfig?: any } | null;
    cityFolder: string;            // city.publicId || city.id || 'no-city'
    file: { buffer: Buffer; mime: string };
    compose?: ComposeOpts;         // preferências do enquadramento
  }) {
    const { childId, childPublicId, campaign, cityFolder, file, compose } = args;

    const ext = (file.mime.split('/')[1] || 'jpg').toLowerCase();
    const campaignFolder = String(campaign?.folder ?? 'no-campaign');

    // Caminhos
    const originalKey  = this.storage.pathOriginal(campaignFolder, cityFolder, childPublicId, ext);
    const processedKey = this.storage.pathProcessed(campaignFolder, cityFolder, childPublicId);

    // Salva original
    await this.storage.saveBuffer(originalKey, file.buffer);

    // Processa .webp "limpo"
    const webpBuf = await this.storage.toWebp(file.buffer, 1600, 82);
    await this.storage.saveBuffer(processedKey, webpBuf);

    // Composição com layout (se houver frame na campanha)
    let framedKey: string | undefined;
    let framedUrl: string | undefined;
    let composedBuf: Buffer | undefined;

    if (campaign?.frameKey) {
      const frameBuf = await this.storage.readBufferByKey(campaign.frameKey);
      composedBuf = await this.storage.compositeFramed({
        photo: webpBuf,
        frame: frameBuf,
        width: compose?.width,
        height: compose?.height,
        fit: compose?.fit ?? 'cover',
        gravity: compose?.gravity ?? 'center',
        cornerRadius: compose?.cornerRadius ?? 0,
      });
      const fk = this.storage.pathFramed(campaignFolder, cityFolder, childPublicId);
      await this.storage.saveBuffer(fk, composedBuf);
      framedKey = fk;
      framedUrl = this.storage.publicUrl(fk);
    }

    // Snapshot do layout/config
    const layoutKey = campaign?.frameKey ?? null;
    const layoutUrl = campaign?.frameUrl ?? null;

    // Cria registro
    const rec = await this.prisma.childImage.create({
      data: {
        childId,
        campaignId: campaign?.id ?? null,
        originalKey,
        originalUrl: this.storage.publicUrl(originalKey),
        processedKey,
        processedUrl: this.storage.publicUrl(processedKey),
        framedKey: framedKey ?? null,
        framedUrl: framedUrl ?? null,
        layoutKey,
        layoutUrl,
        Config: compose ? compose as any : undefined,
        status: framedKey ? 'COMPOSED' : 'PROCESSED',
      },
    });

    return rec;
  }

  listForChild(childId: string, campaignId?: string) {
    return this.prisma.childImage.findMany({
      where: { childId, campaignId: campaignId ?? undefined },
      orderBy: [{ createdAt: 'desc' }],
    });
  }

  get(imageId: string) {
    return this.prisma.childImage.findUnique({ where: { id: imageId } });
  }

  async updateCompose(imageId: string, compose: ComposeOpts) {
    const img = await this.get(imageId);
    if (!img) return null;
    // Regerar framed se tiver layout e processed
    if (img.layoutKey && img.processedKey) {
      const base = await this.storage.readBufferByKey(img.processedKey);
      const frame = await this.storage.readBufferByKey(img.layoutKey);
      const composed = await this.storage.compositeFramed({
        photo: base,
        frame,
        width: compose.width,
        height: compose.height,
        fit: compose.fit ?? 'cover',
        gravity: compose.gravity ?? 'center',
        cornerRadius: compose.cornerRadius ?? 0,
      });
      // salva uma nova versão framed
      const pathParts = img.framedKey?.split('/') ?? [];
      const idxFile = pathParts.length - 1;
      if (idxFile >= 0) pathParts[idxFile] = `framed-${Date.now()}.webp`;
      const newKey = pathParts.join('/');
      await this.storage.saveBuffer(newKey, composed);

      return this.prisma.childImage.update({
        where: { id: imageId },
        data: {
          framedKey: newKey,
          framedUrl: this.storage.publicUrl(newKey),
          Config: compose as any,
          status: 'COMPOSED',
          version: (img.version ?? 1) + 1,
        },
      });
    }

    // Sem layout → apenas salva composeConfig
    return this.prisma.childImage.update({
      where: { id: imageId },
      data: { Config: compose as any, version: (img.version ?? 1) + 1 },
    });
  }

  delete(imageId: string) {
    return this.prisma.childImage.delete({ where: { id: imageId } });
  }
}
