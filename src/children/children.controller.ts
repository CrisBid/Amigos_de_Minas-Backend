import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  NotFoundException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';

import { ChildrenService } from './children.service';
import { ChildImagesService } from '../child-images/child-images.service';
import { CampaignFramesService } from '../campaigns/campaign-frames.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { StorageService } from '../common/storage/storage.service';
import { PrismaService } from '../prisma/prisma.service';
import { BulkCommitDto } from './dto/bulk-commit.dto';
import { ComposeLiveService } from 'src/child-images/compose-live.service';

import type { Response } from 'express';

// Se você tiver DTOs para create/update, importe aqui
// import { CreateChildDto } from './dto/create-child.dto';
// import { UpdateChildDto } from './dto/update-child.dto';


// helper seguro pra JSON em query
function parseJson<T = any>(raw?: string | null): T | undefined {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

@Controller('children')
export class ChildrenController {
  constructor(
    private service: ChildrenService,
    private prisma: PrismaService,
    private storage: StorageService,
    private childImages: ChildImagesService,
    private campaignFrames: CampaignFramesService,
    private composeLive: ComposeLiveService,
  ) {}

  /** Lista paginada; aceita campaignId, scan, skip, take e filtros */
  @Get()
  async list(
    @Query('campaignId') campaignId?: string,
    @Query('scan') scan?: string,
    @Query('skip') skipStr?: string,
    @Query('take') takeStr?: string,

    // —— novos filtros —— //
    @Query('q') q?: string,
    @Query('cityId') cityId?: string,
    @Query('communityId') communityId?: string,
    @Query('schoolId') schoolId?: string,
    @Query('category') category?: string,
    @Query('status') status?: 'available' | 'assigned',
    @Query('minAge') minAgeStr?: string,
    @Query('maxAge') maxAgeStr?: string,
    @Query('photo') photo?: 'with' | 'without',
  ) {
    const DEFAULT_TAKE = 24;
    const MAX_TAKE = 100;

    const skip = Number.isFinite(Number(skipStr)) ? Math.max(0, parseInt(String(skipStr!), 10)) : 0;
    const take = Number.isFinite(Number(takeStr))
      ? Math.min(Math.max(1, parseInt(String(takeStr!), 10)), MAX_TAKE)
      : DEFAULT_TAKE;

    const minAge = Number.isFinite(Number(minAgeStr)) ? parseInt(String(minAgeStr), 10) : undefined;
    const maxAge = Number.isFinite(Number(maxAgeStr)) ? parseInt(String(maxAgeStr), 10) : undefined;

    return this.service.listPaginated(
      {
        campaignId,
        scanFs: scan === '1',
        q,
        cityId,
        communityId,
        schoolId,
        category,
        status,
        photo: photo === 'with' || photo === 'without' ? photo : undefined,
        minAge,
        maxAge,
      },
      { skip, take },
    );
  }

  /** Categorias já usadas no cadastro e os presentes de cada uma (para sugerir categoria no cadastro guiado) */
  @Get('category-hints')
  categoryHints() {
    return this.service.categoryHints();
  }

  @Get('categories')
  async listCategories(
    @Query('campaignId') campaignId?: string,
    @Query('q') q?: string,
    @Query('cityId') cityId?: string,
    @Query('communityId') communityId?: string,
    @Query('schoolId') schoolId?: string,
    @Query('status') status?: 'available' | 'assigned',
    @Query('minAge') minAgeStr?: string,
    @Query('maxAge') maxAgeStr?: string,
  ) {
    const minAge = Number.isFinite(Number(minAgeStr)) ? parseInt(String(minAgeStr), 10) : undefined;
    const maxAge = Number.isFinite(Number(maxAgeStr)) ? parseInt(String(maxAgeStr), 10) : undefined;

    return this.service.listCategories({
      campaignId,
      q,
      cityId,
      communityId,
      schoolId,
      status,
      minAge,
      maxAge,
    });
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.service.get(id);
  }

  /** Miniatura da foto (sem moldura) para listagens: ?w=96&campaignId=...&v=<id da imagem p/ cache> */
  @Get(':id/thumb')
  async thumb(
    @Param('id') id: string,
    @Res() res: Response,
    @Query('w') w?: string,
    @Query('campaignId') campaignId?: string,
  ) {
    // poucos tamanhos possíveis, para não encher o disco de variações
    const SIZES = [64, 96, 128, 192, 256, 384];
    const want = parseInt(String(w ?? '96'), 10) || 96;
    const width = SIZES.find((s) => s >= want) ?? SIZES[SIZES.length - 1];
    try {
      const buf = await this.service.thumbnail(id, width, campaignId || undefined);
      res.setHeader('Content-Type', 'image/webp');
      // a URL muda quando a foto muda (?v=), então pode ficar em cache por bastante tempo
      res.setHeader('Cache-Control', 'public, max-age=2592000, immutable');
      return res.send(buf);
    } catch (e) {
      if (e instanceof NotFoundException) return res.status(404).send();
      throw e;
    }
  }

  /** Histórico: campanhas de que a criança participou, com presente, foto e apadrinhamentos */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'STAFF')
  @Get(':id/campaigns')
  campaignHistory(@Param('id') id: string) {
    return this.service.campaignHistory(id);
  }

  /** ID e presente da criança em uma campanha */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'STAFF')
  @Put(':id/campaigns/:campaignId')
  updateCampaignData(
    @Param('id') id: string,
    @Param('campaignId') campaignId: string,
    @Body() body: { publicId?: number | string | null; wantedGift?: string | null },
  ) {
    return this.service.updateCampaignData(id, campaignId, body);
  }

  /** Estatísticas globais, ou restritas ao roster de UMA campanha se `campaignId` vier */
  @Get('stats/all')
  async stats(@Query('campaignId') campaignId?: string) {
    if (campaignId) {
      const s = await this.service.statsForCampaign(campaignId);
      return {
        total: s.total ?? 0,
        active: s.active ?? 0,
        pending: s.pending ?? 0,
        in_progress: s.in_progress ?? 0,
        available: s.available ?? Math.max(0, (s.total ?? 0) - ((s.active ?? 0) + (s.pending ?? 0))),
        sponsorshipRate: s.sponsorshipRate ?? 0,
      };
    }
    const s = await this.service.stats();
    // força um objeto simples (sem undefined)
    return {
      total: s.total ?? 0,
      active: s.active ?? 0,
      pending: s.pending ?? 0,
      in_progress: s.in_progress ?? 0,
      available: s.available ?? Math.max(0, (s.total ?? 0) - ((s.active ?? 0) + (s.pending ?? 0))),
      sponsorshipRate: s.sponsorshipRate ?? 0,
    };
  }

  /** NOVA rota: tudo em um único payload (geral + por cidade + por comunidade) */
  @Get('stats/overview')
  async statsOverview(@Query('campaignId') campaignId?: string) {
    return this.service.statsOverview(campaignId || undefined);
  }

  /** Estatísticas filtradas por query (?cityId=...&communityId=...&schoolId=...) */
  @Get('stats/filtered')
  async statsFiltered(
    @Query('cityId') cityId?: string,
    @Query('communityId') communityId?: string,
    @Query('schoolId') schoolId?: string,
  ) {
    const s = await this.service.statsFiltered({ cityId, communityId, schoolId });
    return {
      total: s.total ?? 0,
      active: s.active ?? 0,
      pending: s.pending ?? 0,
      in_progress: s.in_progress ?? 0,
      available: s.available ?? Math.max(0, (s.total ?? 0) - ((s.active ?? 0) + (s.pending ?? 0))),
      sponsorshipRate: s.sponsorshipRate ?? 0,
    };
  }

  /** Atalhos REST semânticos */
  @Get('stats/city/:cityId')
  async statsByCity(@Param('cityId') cityId: string) {
    return this.statsFiltered(cityId, undefined, undefined);
  }

  @Get('stats/community/:communityId')
  async statsByCommunity(@Param('communityId') communityId: string) {
    return this.statsFiltered(undefined, communityId, undefined);
  }


  // ----- CRUD ADMIN (opcional) -----

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'STAFF')
  @Post()
  create(@Body() body: any /* CreateChildDto */) {
    return this.service.create(body);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'STAFF')
  @Patch(':id')
  update(@Param('id') id: string, @Body() body: any /* UpdateChildDto */) {
    return this.service.update(id, body);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'STAFF')
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.service.softDelete(id);
  }

  @Get(':id/render')
  async renderChildPreview(
    @Param('id') id: string,
    @Res() res: Response,
    // opcional — se não vier, resolvemos via último ChildImage
    @Query('campaignId') campaignId?: string,
    // opcional — força um frame específico
    @Query('layoutId') layoutId?: string,
    @Query('format') format: 'webp' | 'jpeg' = 'webp',
    @Query('q') q?: string,
    // overrides granulares
    @Query('config') configJson?: string,
    @Query('photoRect') photoRectJson?: string,
    @Query('layout') layoutJson?: string,
    @Query('texts') textsJson?: string,
  ) {
    const quality = Math.max(1, Math.min(parseInt(String(q ?? '88'), 10) || 88, 100));

    // Descobrir campaignId, se não informado
    let effectiveCampaignId = (campaignId ?? '').trim();
    if (!effectiveCampaignId) {
      // resolver criança (UUID ou publicId)
      const nChild = parseInt(id, 10);
      const child =
        (await this.prisma.child.findUnique({ where: { id } })) ||
        (Number.isFinite(nChild) ? await this.prisma.child.findFirst({ where: { publicId: nChild } }) : null);
      if (!child) throw new NotFoundException('Criança não encontrada');

      const lastImg = await this.prisma.childImage.findFirst({
        where: { childId: child.id, campaignId: { not: null } },
        orderBy: [{ createdAt: 'desc' }],
        select: { campaignId: true },
      });
      if (!lastImg?.campaignId) {
        throw new BadRequestException(
          'Não foi possível determinar a campanha a partir da imagem. Informe campaignId na URL.'
        );
      }
      effectiveCampaignId = lastImg.campaignId;
    }

    // Montar overrideConfig com os atalhos opcionais
    const overrideConfig = parseJson(configJson) ?? {};
    const photoRect = parseJson(photoRectJson);
    const layout = parseJson(layoutJson);
    const texts = parseJson(textsJson);
    if (photoRect) (overrideConfig as any).photoRect = { ...(overrideConfig as any).photoRect, ...photoRect };
    if (layout) (overrideConfig as any).layout = { ...(overrideConfig as any).layout, ...layout };
    if (texts) (overrideConfig as any).texts = texts;

    const buf = await this.composeLive.renderChild({
      childIdOrPublic: id,
      campaignId: effectiveCampaignId,
      layoutId: layoutId || null,
      format,
      quality,
      overrideConfig,
    });

    res.setHeader('Content-Type', format === 'jpeg' ? 'image/jpeg' : 'image/webp');
    res.setHeader('Cache-Control', 'public, max-age=300');
    return res.send(buf);
  }

  // ----- FOTO POR CAMPANHA (ADMIN/STAFF) -----

  /** Envia/atualiza a foto de uma criança para UMA campanha específica */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'STAFF')
  @Post(':id/photo')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 20 * 1024 * 1024 },
      fileFilter: (req, file, cb) => {
        const ok = /image\/(jpeg|png|webp|avif)/.test(file.mimetype);
        cb(ok ? null : new Error('Tipo de arquivo inválido'), ok as any);
      },
    }),
  )
  async uploadPhoto(
    @Param('id') id: string,
    @Query('campaignId') campaignId?: string,
    // >>> layoutId via @Query (em vez de req.query)
    @Query('layoutId') layoutId?: string,
    @Body() body?: any,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('Arquivo ausente');
    if (!campaignId) throw new BadRequestException('Informe campaignId na query.');

    // --- resolve criança: por id (UUID) OU publicId numérico ---
    const numericChildId = parseInt(String(id).trim(), 10);
    const child =
      (await this.prisma.child.findUnique({ where: { id } })) ||
      (Number.isFinite(numericChildId)
        ? // use findUnique se publicId for unique no schema; caso contrário, findFirst:
          (await this.prisma.child.findUnique({ where: { publicId: numericChildId } }).catch(() => null)) ||
          (await this.prisma.child.findFirst({ where: { publicId: numericChildId } }))
        : null);

    if (!child) throw new NotFoundException('Criança não encontrada');

    // --- resolve campanha: por id (UUID) OU publicId numérico ---
    const numericCampaignId = parseInt(String(campaignId).trim(), 10);
    const campaign =
      (await this.prisma.campaign.findUnique({ where: { id: String(campaignId) } })) ||
      (Number.isFinite(numericCampaignId)
        ? await this.prisma.campaign.findFirst({ where: { publicId: numericCampaignId } })
        : null);

    if (!campaign) throw new BadRequestException('Campanha não encontrada');

    // cidade (para pasta). Se não tiver cityId, usa marcador.
    const city = child.cityId
      ? await this.prisma.city.findUnique({ where: { id: child.cityId } })
      : null;

    const campaignFolder = String((campaign as any).publicId ?? campaign.id);
    const cityFolder = String((city as any)?.publicId ?? city?.id ?? 'no-city');

    // --- escolher layout: id específico OU o da cidade da criança OU ativo da campanha (com fallback retro) ---
    let frameToUse:
      | { id: string; key: string; url: string; config: any }
      | null = null;

    if (layoutId && layoutId.trim()) {
      const f = await this.prisma.campaignFrame.findUnique({ where: { id: layoutId.trim() } });
      if (f) frameToUse = { id: f.id, key: f.key, url: f.url, config: f.config };
    }

    if (!frameToUse) {
      const resolved = await this.campaignFrames.resolveForChild(campaign.id, child.cityId);
      if (resolved) frameToUse = { id: resolved.id, key: resolved.key, url: resolved.url, config: resolved.config };
    }

    // cria registro usando o service (salva original, processed e framed)
    // recuperar e parsear o JSON de composição enviado como campo "Config"
    let composeConfig: any = undefined;
    try {
      if (body?.Config) composeConfig = JSON.parse(body.Config);
    } catch {
      // se vier inválido, ignore
    }
    // sem Config enviado, usa a configuração do próprio layout escolhido
    if (!composeConfig && frameToUse?.config) composeConfig = frameToUse.config;

    const imgRecord = await this.childImages.createFromUpload({
      
      childId: child.id,
      childPublicId: child.publicId,
      campaign: {
        id: campaign.id,
        folder: campaignFolder,
        // retrocompat: se não houver frame ativo, usa frameKey/frameUrl do Campaign
        frameKey: frameToUse?.key ?? campaign.frameKey ?? null,
        frameUrl: frameToUse?.url ?? campaign.frameUrl ?? null,
        frameConfig: frameToUse?.config ?? campaign.frameConfig ?? null,
      },
      cityFolder,
      file: { buffer: file.buffer, mime: file.mimetype },
      // se quiser fixar dimensões/enquadramento padrão, defina compose:
      compose: composeConfig,
    });

    // (opcional) definir a "foto principal" da criança a partir do composed
    await this.prisma.child.update({
      where: { id: child.id },
      data: {
        photoUrl: imgRecord.framedUrl ?? imgRecord.processedUrl ?? imgRecord.originalUrl,
      },
    });

    return imgRecord;
  }

  /** Remove a foto processada/framed de uma criança dentro de UMA campanha */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'STAFF')
  @Delete(':id/photo')
  async deletePhoto(@Param('id') childId: string, @Query('campaignId') campaignId?: string) {
    if (!campaignId) throw new BadRequestException('Informe campaignId na query.');
    return this.service.deletePhotoForCampaign(childId, campaignId);
  }

  /**
   * Cadastro guiado: cria/atualiza as crianças da planilha na cidade/comunidade do contexto.
   * Com campanha, o ID da planilha é o ID da criança NESTA campanha (a numeração muda entre
   * campanhas), então a criança é procurada primeiro por esse ID na campanha e só depois pelo
   * ID principal — e, nesse caso, só se o nome também bater; senão é outra criança e ganha
   * cadastro novo. Todas entram na campanha (mesmo sem foto). Devolve `ids` (ID da planilha →
   * id interno) para o painel enviar as fotos para a criança certa.
   */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN','STAFF')
  @Post('bulk/commit')
  async bulkCommit(@Body() dto: BulkCommitDto) {
    const { children, context } = dto;
    if (!context?.cityId) {
      throw new BadRequestException('cityId é obrigatório em context');
    }
    // cidade para preencher cityName
    const city = await this.prisma.city.findUnique({ where: { id: context.cityId } });
    if (!city) throw new BadRequestException('Cidade não encontrada');

    if (context.communityId) {
      const exists = await this.prisma.community.findUnique({ where: { id: context.communityId } });
      if (!exists) throw new BadRequestException('Comunidade não encontrada');
    }
    if (context.schoolId) {
      const exists = await this.prisma.school.findUnique({ where: { id: context.schoolId } });
      if (!exists) throw new BadRequestException('Escola não encontrada');
    }
    const campaignId = context.campaignId || null;
    if (campaignId) {
      const exists = await this.prisma.campaign.findUnique({ where: { id: campaignId } });
      if (!exists) throw new BadRequestException('Campanha não encontrada');
    }

    // valida os IDs antes de gravar qualquer coisa
    const rows = children.map((c) => {
      const pid = parseInt(String(c.publicId).trim(), 10);
      if (!Number.isFinite(pid)) throw new BadRequestException(`publicId inválido: ${c.publicId}`);
      return { c, pid };
    });

    const sameName = (a?: string | null, b?: string | null) =>
      normalizeName(a) !== '' && normalizeName(a) === normalizeName(b);
    let nextFreeId: number | null = null;
    const takeFreeId = async () => {
      if (nextFreeId === null) {
        const max = await this.prisma.child.aggregate({ _max: { publicId: true } });
        nextFreeId = (max._max.publicId ?? 0) + 1;
      }
      return nextFreeId++;
    };

    const created: number[] = [];
    const updated: number[] = [];
    const ids: Record<string, string> = {};
    // ID da planilha que já era de outra criança no cadastro: criamos cadastro novo
    const renumbered: { publicId: number; newMainId: number; existingName: string; sameIdInCampaign: boolean }[] = [];

    for (const { c, pid } of rows) {
      const data: any = {
        name: c.name.trim(),
        // birthDate ISO (YYYY-MM-DD) -> Date
        birthDate: c.birthDate ? new Date(`${c.birthDate}T00:00:00.000Z`) : null,
        age: c.age ?? null,
        motherName: c.motherName ?? null,
        category: c.category ?? null,
        wantedGift: c.wantedGift ?? null,
        description: c.description ?? null,
        schoolLegacy: c.school ?? null,
        cityId: city.id,
        cityName: city.name, // importantíssimo p/ seu schema
      };
      if (context.communityId) data.communityId = context.communityId;
      if (context.schoolId)    data.schoolId = context.schoolId;

      // 1) quem já tem este ID nesta campanha
      let targetId: string | null = null;
      if (campaignId) {
        const inCampaign = await this.prisma.childCampaignData.findUnique({
          where: { campaignId_publicId: { campaignId, publicId: pid } },
          select: { childId: true },
        });
        targetId = inCampaign?.childId ?? null;
      }
      // 2) o ID principal — com campanha, só se for a mesma criança (mesmo nome)
      let mainIdTakenBy: string | null = null;
      // a outra criança também está nesta campanha sem ID próprio, então aparece com este mesmo número
      let sameIdInCampaign = false;
      if (!targetId) {
        const byMain = await this.prisma.child.findUnique({
          where: { publicId: pid },
          select: {
            id: true,
            name: true,
            ...(campaignId
              ? {
                  images: { where: { campaignId }, select: { id: true }, take: 1 },
                  campaignIncludes: { where: { campaignId }, select: { id: true } },
                  campaignData: { where: { campaignId }, select: { publicId: true } },
                }
              : {}),
          },
        });
        if (byMain && (!campaignId || sameName(byMain.name, data.name))) targetId = byMain.id;
        else if (byMain) {
          mainIdTakenBy = byMain.name;
          const b: any = byMain;
          const inCampaign = (b.images?.length ?? 0) > 0 || (b.campaignIncludes?.length ?? 0) > 0;
          sameIdInCampaign = inCampaign && b.campaignData?.[0]?.publicId == null;
        }
      }

      let saved: { id: string };
      if (targetId) {
        // não mexe no ID principal de quem já existe (pode ser outro número)
        saved = await this.prisma.child.update({ where: { id: targetId }, data, select: { id: true } });
        updated.push(pid);
      } else {
        const mainId = mainIdTakenBy ? await takeFreeId() : pid;
        saved = await this.prisma.child.create({ data: { ...data, publicId: mainId }, select: { id: true } });
        created.push(pid);
        if (mainIdTakenBy) renumbered.push({ publicId: pid, newMainId: mainId, existingName: mainIdTakenBy, sameIdInCampaign });
      }
      ids[String(pid)] = saved.id;

      if (campaignId) {
        // faz parte da campanha (mesmo sem foto) com o ID e o presente desta campanha
        const gift = String(c.wantedGift ?? '').trim() || null;
        await this.prisma.campaignChildInclude.createMany({
          data: [{ campaignId, childId: saved.id }],
          skipDuplicates: true,
        });
        await this.prisma.childCampaignData.upsert({
          where: { childId_campaignId: { childId: saved.id, campaignId } },
          create: { childId: saved.id, campaignId, publicId: pid, wantedGift: gift },
          update: { publicId: pid, ...(gift ? { wantedGift: gift } : {}) },
        });
      }
    }

    return { created, updated, ids, renumbered };
  }
}

/** Compara nomes ignorando acentos, caixa e espaços extras. */
function normalizeName(s?: string | null) {
  return (s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}
