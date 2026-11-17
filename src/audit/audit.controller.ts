import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { AuditService } from './audit.service';

const int = (v?: string) => (v != null && /^\d+$/.test(v) ? parseInt(v, 10) : undefined);

/** Histórico de alterações (só leitura; desfazer fica na conferência com a origem) */
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
@Controller('audit')
export class AuditController {
  constructor(private audit: AuditService) {}

  @Get()
  list(@Query() q: Record<string, string>) {
    return this.audit.list({
      skip: int(q.skip),
      take: int(q.take),
      q: q.q,
      entity: q.entity || undefined,
      entityId: q.entityId || undefined,
      action: q.action || undefined,
      actorId: q.actorId || undefined,
      campaignId: q.campaignId || undefined,
      batchId: q.batchId || undefined,
      source: q.source || undefined,
      from: q.from || undefined,
      to: q.to || undefined,
    });
  }

  @Get('facets')
  facets() {
    return this.audit.facets();
  }

  @Get('batches')
  batches(@Query('campaignId') campaignId?: string, @Query('take') take?: string) {
    return this.audit.batches(campaignId || undefined, int(take) ?? 20);
  }
}
