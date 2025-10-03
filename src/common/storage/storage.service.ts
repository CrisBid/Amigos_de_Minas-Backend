import { Injectable } from '@nestjs/common';
import { promises as fsp } from 'fs';
import { join, dirname } from 'path';
import { randomUUID } from 'crypto';
import sharp from 'sharp';

@Injectable()
export class StorageService {
  private baseDir = process.env.UPLOAD_DIR || 'uploads';
  private apiPublicUrl = process.env.API_PUBLIC_URL || 'http://localhost:3001';
  private publicPrefix = 'uploads'; // onde o static serve os arquivos

  private async ensureDir(dir: string) {
    try {
      await fsp.mkdir(dir, { recursive: true });
    } catch {}
  }

  /**
   * Monta a URL pública para uma key relativa (ex.: campaigns/2025/frame.webp)
   */
  publicUrl(key: string) {
    // não encodamos '/', apenas partes especiais já tendem a vir válidas no key
    return `${this.apiPublicUrl}/${this.publicPrefix}/${key}`;
  }

  /**
   * Caminho absoluto no filesystem a partir da key relativa
   */
  private absPathFromKey(key: string) {
    return join(process.cwd(), this.baseDir, key);
  }

  // --- IO ---
  /**
   * Salva um buffer bruto em uma key e retorna { key, url }
   * Alias usado pelos controllers (ex.: upload de layout)
   */
  async saveBuffer(key: string, buffer: Buffer) {
    const full = this.absPathFromKey(key);
    await this.ensureDir(dirname(full));
    await fsp.writeFile(full, buffer);
    return { key, url: this.publicUrl(key) };
  }

  /**
   * Mantido por retrocompatibilidade (equivalente a saveBuffer)
   */
  async saveRaw(buffer: Buffer, key: string) {
    return this.saveBuffer(key, buffer);
  }

  /**
   * Salva diretamente um arquivo do Multer (opcional)
   */
  async saveMulterFile(key: string, file: Express.Multer.File) {
    return this.saveBuffer(key, file.buffer);
  }

  async readBufferByKey(key: string) {
    const full = this.absPathFromKey(key);
    return fsp.readFile(full);
  }

  async exists(key: string) {
    const full = this.absPathFromKey(key);
    try {
      await fsp.access(full);
      return true;
    } catch {
      return false;
    }
  }

  async deleteByKey(key?: string) {
    if (!key) return;
    const full = this.absPathFromKey(key);
    try {
      await fsp.unlink(full);
    } catch {}
  }

  // --- helpers de pasta (compatível com seu Drive) ---
  // campaignFolder = campaign.publicId ?? campaign.id
  // cityFolder     = city.publicId ?? city.id
  // childFolder    = child.publicId (int)
  pathOriginal(campaignFolder: string, cityFolder: string, childPublicId: number, ext: string) {
    return `campaigns/${campaignFolder}/${cityFolder}/${childPublicId}/original.${ext}`;
  }

  pathProcessed(campaignFolder: string, cityFolder: string, childPublicId: number) {
    return `campaigns/${campaignFolder}/${cityFolder}/${childPublicId}/processed-${randomUUID()}.webp`;
  }

  pathFramed(campaignFolder: string, cityFolder: string, childPublicId: number) {
    return `campaigns/${campaignFolder}/${cityFolder}/${childPublicId}/framed-${randomUUID()}.webp`;
  }

  pathCampaignFrame(campaignFolder: string, ext: string) {
    return `campaigns/${campaignFolder}/frame.${ext}`;
  }

  // --- processamento ---
  async toWebp(buffer: Buffer, widthLimit = 1600, quality = 82) {
    const img = sharp(buffer, { failOnError: false }).rotate();
    const meta = await img.metadata();
    const resized = (meta.width || 0) > widthLimit ? img.resize(widthLimit) : img;
    return resized.webp({ quality }).toBuffer();
  }

  async compositeFramed(opts: {
    photo: Buffer;
    frame: Buffer;
    width?: number;
    height?: number;
    fit?: 'cover' | 'contain' | 'fill' | 'inside' | 'outside';
    gravity?: sharp.Gravity;
    cornerRadius?: number;
  }) {
    const { photo, frame, width, height, fit = 'cover', gravity = 'center', cornerRadius = 0 } = opts;
    const fMeta = await sharp(frame).metadata();
    const W = width || fMeta.width || 1080;
    const H = height || fMeta.height || 1080;

    let base = sharp(photo, { failOnError: false }).rotate().resize(W, H, { fit, position: gravity });

    if (cornerRadius > 0) {
      const r = Math.min(cornerRadius, Math.min(W, H) / 2);
      const mask = Buffer.from(
        `<svg width="${W}" height="${H}"><rect width="${W}" height="${H}" rx="${r}" ry="${r}"/></svg>`
      );
      base = base.composite([{ input: mask, blend: 'dest-in' }]);
    }

    const baseBuf = await base.webp({ quality: 88 }).toBuffer();
    return sharp(baseBuf, { failOnError: false })
      .composite([{ input: frame, gravity: 'center' }])
      .webp({ quality: 88 })
      .toBuffer();
  }
}
