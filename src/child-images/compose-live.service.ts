import { Injectable } from '@nestjs/common';
import sharp from 'sharp';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../common/storage/storage.service';

type Gravity =
  | 'north'|'northeast'|'east'|'southeast'|'south'|'southwest'|'west'|'northwest'|'center';

@Injectable()
export class ComposeLiveService {
  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
  ) {}

  private mapGravity(g?: string): sharp.Gravity {
    const m: Record<string, sharp.Gravity> = {
      north: 'north', northeast: 'northeast', east: 'east',
      southeast: 'southeast', south: 'south', southwest: 'southwest',
      west: 'west', northwest: 'northwest', center: 'center',
    };
    return m[(g || 'center').toLowerCase()] ?? 'center';
  }

  private computeAge(birthDate?: Date | null) {
    if (!birthDate) return '';
    const d = new Date(birthDate);
    if (isNaN(d.getTime())) return '';
    const now = new Date();
    let age = now.getFullYear() - d.getFullYear();
    const m = now.getMonth() - d.getMonth();
    if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
    return `${age} anos`;
  }

  // Texto via SVG (wrap+alinhamento+letter-spacing+line-height)
  private svgTextLayer(opts: {
    text: string;
    x: number; y: number; maxWidth?: number;
    align?: 'left'|'center'|'right';
    fontFamily?: string; fontSize?: number; fontWeight?: number;
    fill?: string; uppercase?: boolean; letterSpacing?: number; lineHeight?: number;
    canvasW: number; canvasH: number;
  }) {
    const {
      text, x, y, maxWidth = 1000,
      align = 'left',
      fontFamily = 'sans-serif',
      fontSize = 42,
      fontWeight = 700,
      fill = '#000',
      uppercase = false,
      letterSpacing = 0,
      lineHeight = 1.1,
      canvasW, canvasH,
    } = opts;

    const content = (uppercase ? text.toUpperCase() : text)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

    return Buffer.from(
      `<svg width="${canvasW}" height="${canvasH}">
        <foreignObject x="${x}" y="${y}" width="${maxWidth}" height="${canvasH - y}">
          <div xmlns="http://www.w3.org/1999/xhtml"
               style="font-family:${fontFamily}; font-size:${fontSize}px; font-weight:${fontWeight};
                      color:${fill}; letter-spacing:${letterSpacing}px; line-height:${lineHeight};
                      text-align:${align}; white-space:pre-wrap; word-break:break-word;">
            ${content}
          </div>
        </foreignObject>
      </svg>`
    );
  }

  private isObject(v: any) { return v && typeof v === 'object' && !Array.isArray(v); }
  private deepMerge<T>(a: T, b: any): T {
    if (!this.isObject(a)) return (b ?? a) as T;
    if (!this.isObject(b)) return a;
    const out: any = Array.isArray(a) ? [...(a as any)] : { ...(a as any) };
    for (const k of Object.keys(b)) {
      const av = (a as any)[k], bv = b[k];
      if (Array.isArray(bv)) out[k] = bv;
      else if (this.isObject(bv)) out[k] = this.deepMerge(av ?? {}, bv);
      else out[k] = bv;
    }
    return out;
  }

  /**
   * Render dinâmico:
   * - foto da criança (fundo)
   * - layout/overlay por cima
   * - textos por cima
   */
  async renderChild(opts: {
    childIdOrPublic: string;
    campaignId: string;
    layoutId?: string | null;
    format?: 'webp'|'jpeg';
    quality?: number;
    overrideConfig?: any;
  }) {
    const {
      childIdOrPublic, campaignId, layoutId,
      format = 'webp', quality = 88,
      overrideConfig,
    } = opts;

    // --- Resolve criança (UUID ou publicId)
    const nChild = parseInt(childIdOrPublic, 10);
    const child =
      (await this.prisma.child.findUnique({ where: { id: childIdOrPublic } })) ||
      (Number.isFinite(nChild) ? await this.prisma.child.findFirst({ where: { publicId: nChild } }) : null);
    if (!child) throw new Error('child_not_found');

    // --- Resolve campanha (UUID ou publicId)
    const nCamp = parseInt(String(campaignId), 10);
    const camp =
      (await this.prisma.campaign.findUnique({ where: { id: String(campaignId) } })) ||
      (Number.isFinite(nCamp) ? await this.prisma.campaign.findFirst({ where: { publicId: nCamp } }) : null);
    if (!camp) throw new Error('campaign_not_found');

    // --- Frame/layout ativo ou forçado
    let frame = null as any;
    if (layoutId) frame = await this.prisma.campaignFrame.findUnique({ where: { id: layoutId } });
    if (!frame && (camp as any).activeFrameId) {
      frame = await this.prisma.campaignFrame.findUnique({ where: { id: (camp as any).activeFrameId } });
    }

    const legacyCfg = (camp as any).frameConfig ?? null;
    const frameKey  = frame?.key ?? (camp as any).frameKey ?? null;
    const frameUrl  = frame?.url ?? (camp as any).frameUrl ?? null;
    const frameCfg  = (frame as any)?.config ?? null;

    // --- Última imagem da criança nesta campanha (com snapshot + config)
    const lastImg = await this.prisma.childImage.findFirst({
      where: { childId: child.id, campaignId: camp.id },
      orderBy: [{ createdAt: 'desc' }],
      select: {
        originalKey: true, originalUrl: true,
        processedKey: true, processedUrl: true,
        framedKey: true, framedUrl: true,
        layoutKey: true, layoutUrl: true,
        Config: true,
        width: true, height: true,
        createdAt: true,
      },
    });

    // Buffer base da foto (processed → original)
    let photoBufBase: Buffer | null = null;
    if (lastImg?.processedKey) {
      photoBufBase = await this.storage.readBufferByKey(lastImg.processedKey).catch(() => null);
    }
    if (!photoBufBase && lastImg?.originalKey) {
      photoBufBase = await this.storage.readBufferByKey(lastImg.originalKey).catch(() => null);
    }
    if (!photoBufBase) throw new Error('photo_not_found');

    // --- Merge de configs: frame.config > camp.frameConfig > ChildImage.Config > override
    const itemCfg = (lastImg as any)?.Config ?? null;
    const cfg = this.deepMerge(
      this.deepMerge(frameCfg ?? {}, legacyCfg ?? {}),
      this.deepMerge(itemCfg ?? {}, overrideConfig ?? {}),
    );

    // --- Carrega layout (overlay) (frame/camp) → snapshot salvo na ChildImage (fallback)
    let layoutBuf: Buffer | null = null;
    if (frameKey || frameUrl) {
      layoutBuf = frameKey
        ? await this.storage.readBufferByKey(frameKey).catch(() => null)
        : await (await fetch(String(frameUrl))).arrayBuffer().then(b => Buffer.from(b)).catch(() => null);
    }
    if (!layoutBuf && (lastImg?.layoutKey || lastImg?.layoutUrl)) {
      layoutBuf = lastImg.layoutKey
        ? await this.storage.readBufferByKey(lastImg.layoutKey).catch(() => null)
        : await (await fetch(String(lastImg!.layoutUrl))).arrayBuffer().then(b => Buffer.from(b)).catch(() => null);
    }

    // --- Dimensões do canvas (igual ao front: canvas > layout > default 1080x1350)
    let W: number, H: number;
    if (cfg.canvas?.width && cfg.canvas?.height) {
      W = cfg.canvas.width; H = cfg.canvas.height;
    } else if (layoutBuf) {
      const meta = await sharp(layoutBuf).metadata();
      W = meta.width || 1080; H = meta.height || 1350;
    } else {
      W = 1080; H = 1350;
    }

    // Base transparente (ou com cor)
    let base = sharp({
      create: {
        width: W,
        height: H,
        channels: 4,
        background: cfg.canvas?.background ?? { r: 0, g: 0, b: 0, alpha: 0 },
      },
    });

    // --- FOTO (primeiro)
    const pr = cfg.photoRect || {};
    const rectW = Math.max(1, parseInt(String(pr.width ?? W), 10) || W);
    const rectH = Math.max(1, parseInt(String(pr.height ?? H), 10) || H);
    const rectX = Math.max(0, parseInt(String(pr.x ?? 0), 10) || 0);
    const rectY = Math.max(0, parseInt(String(pr.y ?? 0), 10) || 0);
    const fit = pr.fit || 'cover';
    const gravity = this.mapGravity(pr.gravity || 'center');
    const scale = typeof pr.scale === 'number' ? pr.scale : 1.0;
    const offX = parseInt(String(pr.offsetX ?? 0), 10) || 0;
    const offY = parseInt(String(pr.offsetY ?? 0), 10) || 0;
    const cornerRadius = pr.cornerRadius || 0;

    // ajusta foto para caber no rect (mesma lógica do front)
    let photo = sharp(photoBufBase, { failOnError: false })
      .rotate()
      .resize(rectW, rectH, { fit: fit as any, position: gravity });

    let photoOut = await photo.webp({ quality: 92 }).toBuffer();

    // aplica scale
    if (scale !== 1.0) {
      const sw = Math.round(rectW * scale);
      const sh = Math.round(rectH * scale);
      photoOut = await sharp(photoOut).resize(sw, sh, { fit: 'cover' }).toBuffer();
    }

    // cantos arredondados
    if (cornerRadius > 0) {
      const metaP = await sharp(photoOut).metadata();
      const pw = metaP.width || rectW, ph = metaP.height || rectH;
      const r = Math.min(cornerRadius, Math.min(pw, ph) / 2);
      const mask = Buffer.from(`<svg width="${pw}" height="${ph}">
        <rect width="${pw}" height="${ph}" rx="${r}" ry="${r}"/>
      </svg>`);
      photoOut = await sharp(photoOut).composite([{ input: mask, blend: 'dest-in' }]).toBuffer();
    }

    // posicionamento final no rect
    const pMeta = await sharp(photoOut).metadata();
    const placeX = rectX + Math.round((rectW - (pMeta.width || rectW)) / 2) + offX;
    const placeY = rectY + Math.round((rectH - (pMeta.height || rectH)) / 2) + offY;

    base = base.composite([{ input: photoOut, left: placeX, top: placeY }]);

    // --- LAYOUT (overlay por cima)
    if (layoutBuf) {
      const layoutPrepared = (cfg.layout?.resizeToCanvas || (cfg.canvas?.width && cfg.canvas?.height))
        ? await sharp(layoutBuf).resize(W, H, { fit: 'fill' }).toBuffer()
        : layoutBuf;

      const layoutOpacity =
        typeof cfg.layout?.opacity === 'number'
          ? Math.max(0, Math.min(1, cfg.layout.opacity))
          : 1;

      const overlay: any = {
        input: layoutPrepared,
        left: 0,
        top: 0,
        blend: 'over',
      };
      if (layoutOpacity < 1) {
        overlay.opacity = layoutOpacity;
      }

      base = (base as any).composite([overlay]);
    }

    // --- TEXTOS (por cima)
    // carrega nomes “oficiais” via relações para bater com o front
    const childFull = await this.prisma.child.findUnique({
      where: { id: child.id },
      include: {
        city: { select: { name: true } },
        // se não houver relação community na sua modelagem, remova esta linha
        community: { select: { name: true } } as any,
      },
    });

    const texts: any[] = Array.isArray(cfg?.texts) ? cfg.texts : [];
    const age = this.computeAge(child.birthDate);
    const valueByField: Record<string, string> = {
      name: childFull?.name ?? child.name ?? '',
      publicId: String(childFull?.publicId ?? child.publicId ?? ''),
      age,
      wantedGift: childFull?.wantedGift ?? child.wantedGift ?? '',
      cityName: childFull?.city?.name ?? (child as any).cityName ?? '',
      communityName: (childFull as any)?.community?.name ?? (child as any).communityName ?? '',
    };

    for (const t of texts) {
      const raw = (t?.template
        ? String(t.template)
            .replace(/\{name\}/g, valueByField.name)
            .replace(/\{publicId\}/g, valueByField.publicId)
            .replace(/\{age\}/g, valueByField.age)
            .replace(/\{wantedGift\}/g, valueByField.wantedGift)
            .replace(/\{cityName\}/g, valueByField.cityName)
            .replace(/\{communityName\}/g, valueByField.communityName)
        : (valueByField[t.field] ?? '')
      );
      const val = (t?.uppercase ? raw.toUpperCase() : raw).trim();
      if (!val) continue;

      const svg = this.svgTextLayer({
        text: val,
        x: t.x ?? 0,
        y: t.y ?? 0,
        maxWidth: t.maxWidth ?? W,
        align: (t.align || 'left'),
        fontFamily: t.font?.family || 'sans-serif',
        fontSize: t.font?.size || 42,
        fontWeight: t.font?.weight || 700,
        fill: t.fill || '#000',
        uppercase: !!t.uppercase,
        letterSpacing: t.letterSpacing || 0,
        lineHeight: t.lineHeight || 1.1,
        canvasW: W, canvasH: H,
      });
      base = base.composite([{ input: svg, left: 0, top: 0 }]);
    }

    // --- Saída
    return format === 'jpeg'
      ? base.jpeg({ quality }).toBuffer()
      : base.webp({ quality }).toBuffer();
  }
}
