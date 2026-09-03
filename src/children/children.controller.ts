import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
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
        minAge,
        maxAge,
      },
      { skip, take },
    );
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
  async statsOverview() {
    return this.service.statsOverview();
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

    // --- escolher layout: id específico OU ativo da campanha (com fallback retro) ---
    let frameToUse:
      | { id: string; key: string; url: string; config: any }
      | null = null;

    if (layoutId && layoutId.trim()) {
      const f = await this.prisma.campaignFrame.findUnique({ where: { id: layoutId.trim() } });
      if (f) frameToUse = { id: f.id, key: f.key, url: f.url, config: f.config };
    }

    if (!frameToUse) {
      const active = await this.campaignFrames.getActiveForCampaign(campaign.id);
      if (active) frameToUse = { id: active.id, key: active.key, url: active.url, config: active.config };
    }

    // cria registro usando o service (salva original, processed e framed)
    // recuperar e parsear o JSON de composição enviado como campo "Config"
    let composeConfig: any = undefined;
    try {
      if (body?.Config) composeConfig = JSON.parse(body.Config);
    } catch {
      // se vier inválido, ignore
    }

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
    // (opcional) validar campanha, se vier
    if (context.campaignId) {
      const exists = await this.prisma.campaign.findUnique({ where: { id: context.campaignId } });
      if (!exists) throw new BadRequestException('Campanha não encontrada');
    }

    const created: number[] = [];
    const updated: number[] = [];

    for (const c of children) {
      // publicId vem como string/number — normalize para int
      const pid = parseInt(String(c.publicId).trim(), 10);
      if (!Number.isFinite(pid)) {
        throw new BadRequestException(`publicId inválido: ${c.publicId}`);
      }

      const data:any = {
        publicId: pid,
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

      const exists = await this.prisma.child.findUnique({ where: { publicId: pid } });

      if (exists) {
        await this.prisma.child.update({
          where: { publicId: pid },
          data,
        });
        updated.push(pid);
      } else {
        await this.prisma.child.create({ data });
        created.push(pid);
      }
      // (opcional) se sua modelagem usa tabelas-ponte N:N, em vez de FKs diretas:
      /*
      if (context.communityId) {
        await this.prisma.childCommunity.upsert({
          where: { childId_communityId: { childId: exists?.id ?? (await this.prisma.child.findUnique({ where: { publicId: pid } }))!.id, communityId: context.communityId } },
          create: { childId: (await this.prisma.child.findUnique({ where: { publicId: pid } }))!.id, communityId: context.communityId },
          update: {},
        });
      }
      if (context.schoolId) {
        await this.prisma.childSchool.upsert({
          where: { childId_schoolId: { childId: ..., schoolId: context.schoolId } },
          create: { childId: ..., schoolId: context.schoolId },
          update: {},
        });
      }

      //(opcional) garanta o vínculo com a campanha (N:N) se existir a relação child<->campaign
      if (context.campaignId) {
        await this.prisma.child.update({
          where: { publicId: pid },
          data: { campaigns: { connect: { id: context.campaignId } } },
        });
      }
      */
    }

    return { created, updated };
  }
}
