import {
  Controller, Get, Param, Post, UseGuards, UseInterceptors, UploadedFile,
  Body, Patch, Delete, Query, BadRequestException
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CampaignsService } from './campaigns.service';
import { CampaignFramesService } from './campaign-frames.service';
import { StorageService } from '../common/storage/storage.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller()
export class CampaignFramesController {
  constructor(
    private campaigns: CampaignsService,
    private frames: CampaignFramesService,
    private storage: StorageService,
  ) {}

  // GET /campaigns/:id/layouts
  @Roles('ADMIN','STAFF')
  @Get('campaigns/:id/layouts')
  list(@Param('id') id: string) {
    return this.frames.list(id);
  }

  // POST /campaigns/:id/layouts  (form-data: file, name?, config?)
  @Roles('ADMIN','STAFF')
  @Post('campaigns/:id/layouts')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 12 * 1024 * 1024 },
      fileFilter: (req, file, cb) => {
        const ok = /image\/(png|jpeg|webp|avif)/.test(file.mimetype);
        cb(ok ? null : new Error('Tipo de arquivo inválido'), ok);
      },
    }),
  )
  async upload(@Param('id') id: string, @UploadedFile() file: Express.Multer.File, @Body() body: any) {
    if (!file) throw new BadRequestException('Arquivo ausente');
    const campaign = await this.campaigns.getByIdOrThrow(id);
    const folder = String((campaign as any).publicId ?? campaign.id);
    const cfg = body?.config ? JSON.parse(body.config) : undefined;
    const created = await this.frames.upload({ id: campaign.id, folder }, file, body?.name, cfg);
    return created;
  }

  // PATCH /campaign-frames/:frameId  (name/sort/config)
  @Roles('ADMIN','STAFF')
  @Patch('campaign-frames/:frameId')
  update(@Param('frameId') frameId: string, @Body() body: any) {
    const cfg = body?.config ?? undefined;
    return this.frames.updateMeta(frameId, { name: body?.name, sort: body?.sort, config: cfg });
  }

  // POST /campaign-frames/:frameId/set-active
  @Roles('ADMIN','STAFF')
  @Post('campaign-frames/:frameId/set-active')
  setActive(@Param('frameId') frameId: string) {
    return this.frames.setActive(frameId);
  }

  // DELETE /campaign-frames/:frameId
  @Roles('ADMIN','STAFF')
  @Delete('campaign-frames/:frameId')
  remove(@Param('frameId') frameId: string) {
    return this.frames.remove(frameId);
  }
}
