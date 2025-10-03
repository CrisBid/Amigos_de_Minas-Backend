import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

// Stubs compatíveis com a tela: retornam arrays simples {id,name}
@UseGuards(JwtAuthGuard)
@Controller()
export class PlacesController {
  // /communities?cityId=...
  @Get('communities')
  listCommunities(@Query('cityId') cityId?: string) {
    // Se não houver modelo ainda, responda vazio (não quebra UI)
    // Estrutura: Option[] -> { id, name }
    return [];
  }

  // /schools?communityId=...
  @Get('schools')
  listSchools(@Query('communityId') communityId?: string) {
    return [];
  }
}
