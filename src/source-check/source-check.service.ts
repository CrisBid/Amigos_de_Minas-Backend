import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../common/storage/storage.service';
import { GoogleClient, googleIdFromUrl } from './google.client';

/**
 * Conferência com a origem: a planilha das crianças e a pasta de fotos de cada campanha no
 * Google. Só lê — a comparação com o site é feita na tela, e o que precisar mudar vai pela
 * tela de atualização de crianças.
 */
@Injectable()
export class SourceCheckService {
  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
    private google: GoogleClient,
  ) {}

  private async campaign(campaignId: string) {
    if (!campaignId) throw new BadRequestException('Escolha a campanha.');
    const c = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
      select: { id: true, name: true, sourceSheetId: true, sourcePhotosFolderId: true },
    });
    if (!c) throw new NotFoundException('Campanha não encontrada.');
    return c;
  }

  async getConfig(campaignId: string) {
    const c = await this.campaign(campaignId);
    return {
      sheetId: c.sourceSheetId,
      photosFolderId: c.sourcePhotosFolderId,
      sheetUrl: c.sourceSheetId ? `https://docs.google.com/spreadsheets/d/${c.sourceSheetId}` : null,
      photosFolderUrl: c.sourcePhotosFolderId ? `https://drive.google.com/drive/folders/${c.sourcePhotosFolderId}` : null,
      serviceAccountEmail: this.google.serviceAccountEmail,
    };
  }

  async setConfig(campaignId: string, body: { sheetUrl?: string | null; photosFolderUrl?: string | null }) {
    await this.campaign(campaignId);
    const data: { sourceSheetId?: string | null; sourcePhotosFolderId?: string | null } = {};
    if (body.sheetUrl !== undefined) {
      const id = googleIdFromUrl(body.sheetUrl);
      if (body.sheetUrl && !id) throw new BadRequestException('Link da planilha inválido.');
      data.sourceSheetId = id;
    }
    if (body.photosFolderUrl !== undefined) {
      const id = googleIdFromUrl(body.photosFolderUrl);
      if (body.photosFolderUrl && !id) throw new BadRequestException('Link da pasta de fotos inválido.');
      data.sourcePhotosFolderId = id;
    }
    await this.prisma.campaign.update({ where: { id: campaignId }, data });
    return this.getConfig(campaignId);
  }

  async sheet(campaignId: string) {
    const c = await this.campaign(campaignId);
    if (!c.sourceSheetId) throw new BadRequestException('Informe o link da planilha desta campanha.');
    return this.google.readSpreadsheet(c.sourceSheetId);
  }

  async photos(campaignId: string) {
    const c = await this.campaign(campaignId);
    if (!c.sourcePhotosFolderId) throw new BadRequestException('Informe o link da pasta de fotos desta campanha.');
    return this.google.listFolder(c.sourcePhotosFolderId);
  }

  /** Comunidades cadastradas (inclusive as excluídas), para achar as da planilha que faltam */
  async communities() {
    return this.prisma.community.findMany({
      orderBy: { name: 'asc' },
      select: { id: true, name: true, cityId: true, deletedAt: true },
    });
  }

  /** Escolas cadastradas (de todas as cidades), com as comunidades que atendem — para ligar às da planilha */
  async schools() {
    const rows = await this.prisma.school.findMany({
      where: { deletedAt: null },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, cityId: true, communities: { select: { communityId: true } }, _count: { select: { children: true } } },
    });
    return rows.map((s) => ({ id: s.id, name: s.name, cityId: s.cityId, communityIds: s.communities.map((c) => c.communityId), children: s._count.children }));
  }

  /** MD5 da foto original de cada criança nesta campanha (mesma conta que o Drive faz) */
  async siteMd5(campaignId: string, childIdsRaw: string[]) {
    await this.campaign(campaignId);
    const childIds = [...new Set((childIdsRaw ?? []).filter((id) => typeof id === 'string'))].slice(0, 1000);
    const images = await this.prisma.childImage.findMany({
      where: { campaignId, childId: { in: childIds } },
      orderBy: { createdAt: 'desc' },
      select: { childId: true, originalKey: true },
    });
    const latest = new Map<string, string>();
    for (const img of images) if (!latest.has(img.childId)) latest.set(img.childId, img.originalKey);
    const out: Record<string, string | null> = {};
    const entries = [...latest.entries()];
    for (let i = 0; i < entries.length; i += 8) {
      await Promise.all(entries.slice(i, i + 8).map(async ([childId, key]) => { out[childId] = await this.storage.md5ByKey(key); }));
    }
    return { md5: out };
  }
}
