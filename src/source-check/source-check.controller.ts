import { Body, Controller, Get, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { AuditSkip } from '../audit/audit.interceptor';
import { SourceCheckService } from './source-check.service';
import { SourceSyncService, SyncItem } from './source-sync.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'STAFF')
@Controller('source-check')
export class SourceCheckController {
  constructor(private service: SourceCheckService, private sync: SourceSyncService) {}

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

  /** Confere o que cada ajuste vai fazer (padrinhos, comunidades, cadastros existentes) — não grava */
  @Post('plan')
  plan(@Body() body: { campaignId?: string; items?: SyncItem[] }) {
    return this.sync.plan(String(body?.campaignId ?? ''), Array.isArray(body?.items) ? body.items : []);
  }

  /** Grava os ajustes (até 50 por vez), cada um com registro no histórico */
  @AuditSkip()
  @Post('apply')
  apply(@Body() body: { campaignId?: string; batchId?: string; items?: SyncItem[] }, @Req() req: any) {
    return this.sync.apply(String(body?.campaignId ?? ''), String(body?.batchId ?? ''), Array.isArray(body?.items) ? body.items : [], req.user);
  }

  /** Desfaz um ajuste (volta a ficha da criança ao que era antes) */
  @AuditSkip()
  @Roles('ADMIN')
  @Post('undo')
  undo(@Body() body: { auditId?: string }, @Req() req: any) {
    return this.sync.undo(String(body?.auditId ?? ''), req.user);
  }

  /** Desfaz todos os ajustes de um lote, do último para o primeiro */
  @AuditSkip()
  @Roles('ADMIN')
  @Post('undo-batch')
  undoBatch(@Body() body: { batchId?: string }, @Req() req: any) {
    return this.sync.undoBatch(String(body?.batchId ?? ''), req.user);
  }
}
