import { BadRequestException, Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { SponsorshipsService } from './sponsorships.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';

@Controller('sponsorships')
@UseGuards(JwtAuthGuard)
export class SponsorshipsController {
  constructor(private service: SponsorshipsService) {}

  // Usuário logado cria um pedido de apadrinhamento (PENDING)
  @Post()
  create(
    @Body() body: { childId: string; campaignId: string; note?: string },
    @Req() req: any
  ) {
    if (!body.campaignId) throw new BadRequestException('campaignId é obrigatório');
    return this.service.create(body.childId, req.user.sub, body.campaignId, body.note);
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


  // Admin/Staff ativam ou encerram
  @UseGuards(RolesGuard)
  @Roles('ADMIN','STAFF')
  @Patch(':id/activate')
  activate(@Param('id') id: string) { return this.service.activate(id); }

  @UseGuards(RolesGuard)
  @Roles('ADMIN','STAFF')
  @Patch(':id/end')
  end(@Param('id') id: string) { return this.service.end(id); }
}
