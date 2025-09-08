import { Body, Controller, Get, Param, Patch, Post, Delete, Query, BadRequestException, UseGuards, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { CampaignsService } from './campaigns.service';
import { StorageService } from '../common/storage/storage.service';
import { CreateCampaignDto } from './dto/create-campaign.dto';
import { UpdateCampaignDto } from './dto/update-campaign.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

@Controller('campaigns')
export class CampaignsController {
  constructor(private service: CampaignsService, private storage: StorageService) {}

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
