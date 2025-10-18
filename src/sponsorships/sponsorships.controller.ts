import { BadRequestException, Body, Controller, Get, Param, Patch, Post, Delete, Query, Req, UseGuards } from '@nestjs/common';
import { SponsorshipsService } from './sponsorships.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { UpdateSponsorshipDto } from './dto/sponsorships.dto';
import { CreateSponsorshipDto } from './dto/create-sponsorship.dto';
import { TransferSponsorshipsDto } from './dto/transfer.dto';

@Controller('sponsorships')
@UseGuards(JwtAuthGuard)
export class SponsorshipsController {
  constructor(private service: SponsorshipsService) {}

  // Usuário logado cria um pedido de apadrinhamento (PENDING)
  @Post()
  async create(@Body() body: CreateSponsorshipDto, @Req() req: any) {
    if (!body.campaignId) throw new BadRequestException('campaignId é obrigatório');

    const sponsorUserId = req.user?.sub;
    if (!sponsorUserId) throw new BadRequestException('Usuário não autenticado.');

    const ids = normalizeIds(body.childId, body.childIds);
    if (ids.length === 0) throw new BadRequestException('Informe childId ou childIds.');

    // 👇 NORMALIZAR E REPASSAR
    const collectionPointId = body.collectionPointId ?? null;

    if (ids.length === 1) {
      return this.service.createOne({
        childId: ids[0],
        sponsorUserId,
        campaignId: body.campaignId,
        method: body.method,
        note: body.note,
        donationAmount: body.donationAmount,
        pixTxid: body.pixTxid,
        collectionPointId, // 👈 AQUI
      });
    }

    return this.service.createMany({
      childIds: ids,
      sponsorUserId,
      campaignId: body.campaignId,
      method: body.method,
      note: body.note,
      donationAmount: body.donationAmount,
      pixTxid: body.pixTxid,
      collectionPointId, // 👈 E AQUI
    });
  }


  @Get('me')
  mine(@Req() req: any, @Query('campaignId') campaignId?: string) {
    return this.service.mine(req.user.sub, campaignId);
  }

  @UseGuards(RolesGuard)
  @Roles('ADMIN','STAFF')
  @Get()
  listAll(@Query('campaignId') campaignId?: string) {
    return this.service.listAll(campaignId);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN','STAFF')
  @Post('transfer')
  async transfer(@Body() dto: TransferSponsorshipsDto) {
    return this.service.transfer(dto.sponsorshipIds, dto.toSponsorId);
  }

  // PATCH genérico — regras no service
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateSponsorshipDto, @Req() req: any) {
    return this.service.update(id, dto, req.user);
  }

  @UseGuards(RolesGuard)
  @Roles('ADMIN','STAFF')
  @Patch(':id/activate')
  activate(@Param('id') id: string) { return this.service.activate(id); }

  @UseGuards(RolesGuard)
  @Roles('ADMIN','STAFF')
  @Patch(':id/end')
  end(@Param('id') id: string) { return this.service.end(id); }

  @Delete(':id')
  remove(@Param('id') id: string, @Req() req: any) {
    return this.service.remove(id, req.user);
  }
}

// helper local
function normalizeIds(childId?: string, childIds?: string[]): string[] {
  if (Array.isArray(childIds) && childIds.length) {
    return [...new Set(childIds.map((s) => s?.trim()).filter(Boolean))];
  }
  if (childId) return [childId];
  return [];
}
