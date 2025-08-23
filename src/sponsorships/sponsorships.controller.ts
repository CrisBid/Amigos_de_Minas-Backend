import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
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
  create(@Body() body: { childId: string; note?: string }, @Req() req: any) {
    return this.service.create(body.childId, req.user.sub, body.note);
  }

  // Lista apadrinhamentos do usuário
  @Get('me')
  mine(@Req() req: any) {
    return this.service.mine(req.user.sub);
  }

  // Admin/Staff listam todos
  @UseGuards(RolesGuard)
  @Roles('ADMIN','STAFF')
  @Get()
  listAll() {
    return this.service.listAll();
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
