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

  /**
   * Salva a composição da imagem. Aceita o formato antigo (opções planas) ou
   * `{ config, frameId }`: `config` é a composição completa (ChildImage.Config) e
   * `frameId` troca o layout da imagem pelo layout atual da campanha/cidade.
   */
  async updateCompose(imageId: string, body: any) {
    const compose: ComposeOpts = body?.config ?? body ?? {};
    let img = await this.get(imageId);
    if (!img) return null;

    if (body?.frameId) {
      const frame = await this.prisma.campaignFrame.findUnique({ where: { id: String(body.frameId) } });
      if (frame && frame.campaignId === img.campaignId && frame.key !== img.layoutKey) {
        img = await this.prisma.childImage.update({
          where: { id: imageId },
          data: { layoutKey: frame.key, layoutUrl: frame.url },
        });
      }
    }

    // composição completa (canvas/photoRect) ou opções planas antigas
    const c: any = compose;
    const width = c.canvas?.width ?? c.width;
    const height = c.canvas?.height ?? c.height;
    const fit = c.photoRect?.fit ?? c.fit ?? 'cover';
    const gravity = c.photoRect?.gravity ?? c.gravity ?? 'center';
    const cornerRadius = c.photoRect?.cornerRadius ?? c.cornerRadius ?? 0;

    // Regerar framed se tiver layout e processed
    if (img.layoutKey && img.processedKey) {
      const base = await this.storage.readBufferByKey(img.processedKey);
      const frame = await this.storage.readBufferByKey(img.layoutKey);
      const composed = await this.storage.compositeFramed({
        photo: base,
        frame,
        width,
        height,
        fit,
        gravity,
        cornerRadius,
      });
      // salva uma nova versão framed (na pasta da framed atual, ou da processed se ainda não houver)
      const pathParts = (img.framedKey ?? img.processedKey).split('/');
      pathParts[pathParts.length - 1] = `framed-${Date.now()}.webp`;
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
