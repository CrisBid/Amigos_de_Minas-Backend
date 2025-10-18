import { Body, Controller, Get, Param, Patch, Post, Delete, Query, BadRequestException, UseGuards, UploadedFile, UseInterceptors, NotFoundException  } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { CampaignsService } from './campaigns.service';
import { StorageService } from '../common/storage/storage.service';
import { CreateCampaignDto } from './dto/create-campaign.dto';
import { UpdateCampaignDto } from './dto/update-campaign.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { PrismaService } from '../prisma/prisma.service';

@Controller('campaigns')
export class CampaignsController {
  constructor(
    private service: CampaignsService, 
    private storage: StorageService,
    private prisma: PrismaService,
  ) {}

  @Get()
  list(@Query('status') status?: string) {
    return this.service.list(status);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.service.getById(id);
  }

  // Admin/Staff criam e editam
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN','STAFF')
  @Post()
  create(@Body() dto: CreateCampaignDto) {
    return this.service.create(dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN','STAFF')
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateCampaignDto) {
    return this.service.update(id, dto);
  }

  // ---- FRAME UPLOAD ----
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN','STAFF')
  @Post(':id/frame')
  @UseInterceptors(FileInterceptor('file', {
    storage: memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
      const ok = /image\/(png|webp|svg\+xml)/.test(file.mimetype);
      if (!ok) return cb(new BadRequestException('Envie PNG/WEBP/SVG com transparência'), false);
      cb(null, true);
    },
  }))
  async uploadFrame(@Param('id') id: string, @UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('Arquivo não enviado (file)');

    // 👉 buscar campanha para decidir a pasta (publicId ou id)
    const campaign = await this.service.getById(id);
    if (!campaign) throw new BadRequestException('Campanha não encontrada');

    const folder = String(campaign.publicId ?? campaign.id);
    const ext = file.mimetype.includes('svg') ? 'svg' : (file.mimetype.includes('webp') ? 'webp' : 'png');

    const key = this.storage.pathCampaignFrame(folder, ext);
    await this.storage.saveRaw(file.buffer, key);

    const url = `${process.env.API_PUBLIC_URL || 'http://localhost:3001'}/uploads/${key}`;
    await this.service.updateFrame(id, { frameKey: key, frameUrl: url });

    return { frameUrl: url };
  }

  /**
   * Alias compatível com o front:
   * POST /campaigns/:id/layout (form-data: file)
   */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'STAFF')
  @Post(':id/layout')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 12 * 1024 * 1024 },
      fileFilter: (req, file, cb) => {
        const ok = /image\/(jpeg|png|webp|avif)/.test(file.mimetype);
        cb(ok ? null : new Error('Tipo de arquivo inválido'), ok);
      },
    }),
  )
  async uploadLayout(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @Body() body: any, // recebe name, active, config (string JSON)
  ) {
    if (!file) throw new BadRequestException('Arquivo ausente');

    // 1) Campanha existe?
    const campaign = await this.service.getByIdOrThrow(id);
    const campaignFolder = String((campaign as any).publicId ?? campaign.id);

    // 2) Parse de meta vindos do form-data
    const name: string | undefined = body?.name ? String(body.name).trim() : undefined;
    // active pode vir como "true", "1" etc.
    const wantsActive =
      String(body?.active ?? '').toLowerCase() === 'true' ||
      String(body?.active ?? '') === '1';

    let cfg: any | undefined = undefined;
    if (body?.config) {
      try {
        cfg = typeof body.config === 'string' ? JSON.parse(body.config) : body.config;
      } catch {
        throw new BadRequestException('`config` inválido: deve ser JSON.');
      }
    }

    // 3) Cria o CampaignFrame (upload + registro)
    const ext = (file.mimetype.split('/')[1] || 'png').toLowerCase();
    const key = `campaigns/${campaignFolder}/layouts/layout-${Date.now()}.${ext}`;
    await this.storage.saveBuffer(key, file.buffer);
    const url = this.storage.publicUrl(key);

    const created = await this.prisma.campaignFrame.create({
      data: {
        campaignId: campaign.id,
        key,
        url,
        mime: file.mimetype,
        name: name ?? null,
        config: cfg ?? undefined,
      },
    });

    // 4) Tornar ativo:
    //    - se cliente pediu (active=true), OU
    //    - se a campanha ainda NÃO tem ativo
    const hasActiveAlready = !!campaign.activeFrameId;
    const shouldActivate = wantsActive || !hasActiveAlready;

    if (shouldActivate) {
      // desativa outros e marca este como ativo; seta atalho em Campaign
      await this.prisma.$transaction([
        this.prisma.campaignFrame.updateMany({ where: { campaignId: campaign.id }, data: { active: false } }),
        this.prisma.campaignFrame.update({ where: { id: created.id }, data: { active: true } }),
        this.prisma.campaign.update({ where: { id: campaign.id }, data: { activeFrameId: created.id } }),
      ]);

      // Retrocompat: também preenche frameKey/frameUrl/frameConfig na Campaign
      await this.service.updateFrame(campaign.id, { frameKey: key, frameUrl: url });
      if (cfg) {
        await this.service.updateFrameConfig(campaign.id, cfg);
      }
    }

    return {
      id: created.id,
      url: created.url,
      key: created.key,
      mime: created.mime,
      name: created.name,
      config: created.config,
      active: shouldActivate, // informa se ficou ativo agora
    };
  }

  // ---- FRAME CONFIG (layout) ----
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN','STAFF')
  @Patch(':id/frame-config')
  async updateFrameConfig(@Param('id') id: string, @Body() body: any) {
    // Exemplo body: { width:1080, height:1080, fit:'cover', gravity:'center', cornerRadius:24 }
    return this.service.updateFrameConfig(id, body);
  }

  // ---- REMOVER FRAME ----
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN','STAFF')
  @Delete(':id/frame')
  async deleteFrame(@Param('id') id: string) {
    const campaign = await this.service.getById(id);
    if (campaign?.frameKey) await this.storage.deleteByKey(campaign.frameKey);
    await this.service.updateFrame(id, { frameKey: null, frameUrl: null });
    return { ok: true };
  }
}
