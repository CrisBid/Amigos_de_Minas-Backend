import { Body, Controller, Get, Post, Put, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { SourceCheckService } from './source-check.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'STAFF')
@Controller('source-check')
export class SourceCheckController {
  constructor(private service: SourceCheckService) {}

  /** Links da planilha e da pasta desta campanha + e-mail da conta de serviço */
  @Get('config')
  config(@Query('campaignId') campaignId: string) {
    return this.service.getConfig(campaignId);
  }

  @Put('config')
  setConfig(@Body() body: { campaignId?: string; sheetUrl?: string | null; photosFolderUrl?: string | null }) {
    return this.service.setConfig(String(body?.campaignId ?? ''), { sheetUrl: body?.sheetUrl, photosFolderUrl: body?.photosFolderUrl });
  }

  /** Abas da planilha (texto das células) */
  @Get('sheet')
  sheet(@Query('campaignId') campaignId: string) {
    return this.service.sheet(campaignId);
  }

  /** Arquivos da pasta de fotos, com subpastas e MD5 */
  @Get('photos')
  photos(@Query('campaignId') campaignId: string) {
    return this.service.photos(campaignId);
  }

  /** MD5 das fotos do site, para comparar com o do Drive */
  @Post('site-md5')
  siteMd5(@Body() body: { campaignId?: string; childIds?: string[] }) {
    return this.service.siteMd5(String(body?.campaignId ?? ''), Array.isArray(body?.childIds) ? body.childIds : []);
  }
}
