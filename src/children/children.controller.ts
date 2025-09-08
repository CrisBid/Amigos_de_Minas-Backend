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
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';

import { ChildrenService } from './children.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

// Se você tiver DTOs para create/update, importe aqui
// import { CreateChildDto } from './dto/create-child.dto';
// import { UpdateChildDto } from './dto/update-child.dto';

@Controller('children')
export class ChildrenController {
  constructor(private service: ChildrenService) {}

  /** Lista crianças; se enviar campaignId, o service faz o "lazy hydrate" da mídia por campanha */
  @Get()
async list(@Query('campaignId') campaignId?: string, @Query('scan') scan?: string) {
  return this.service.list(campaignId, scan === '1');
}

  @Get(':id')
  get(@Param('id') id: string) {
    return this.service.get(id);
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

  // ----- FOTO POR CAMPANHA (ADMIN/STAFF) -----

  /** Envia/atualiza a foto de uma criança para UMA campanha específica */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'STAFF')
  @Post(':id/photo')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 8 * 1024 * 1024 }, // 8MB
      fileFilter: (req, file, cb) => {
        const ok = /image\/(jpeg|png|webp|avif)/.test(file.mimetype);
        if (!ok) return cb(new BadRequestException('Somente JPEG, PNG, WEBP ou AVIF'), false);
        cb(null, true);
      },
    }),
  )
  async uploadPhoto(
    @Param('id') childId: string,
    @UploadedFile() file: Express.Multer.File,
    @Query('campaignId') campaignId?: string,
  ) {
    if (!file) throw new BadRequestException('Arquivo não enviado (campo "file").');
    if (!campaignId) throw new BadRequestException('Informe campaignId na query.');
    // service salva processed/framed na MESMA pasta de <Campanha>/<Cidade>/ e faz upsert da mídia
    return this.service.updatePhotoForCampaign(childId, campaignId, file);
  }

  /** Remove a foto processada/framed de uma criança dentro de UMA campanha */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'STAFF')
  @Delete(':id/photo')
  async deletePhoto(@Param('id') childId: string, @Query('campaignId') campaignId?: string) {
    if (!campaignId) throw new BadRequestException('Informe campaignId na query.');
    return this.service.deletePhotoForCampaign(childId, campaignId);
  }
}
