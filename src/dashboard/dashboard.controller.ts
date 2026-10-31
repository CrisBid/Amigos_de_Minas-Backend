import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { DashboardService } from './dashboard.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'STAFF')
@Controller('dashboard')
export class DashboardController {
  constructor(private service: DashboardService) {}

  /** GET /dashboard?campaignId= — indicadores, pendências, distribuição e atividade recente */
  @Get()
  overview(@Query('campaignId') campaignId?: string) {
    return this.service.overview(campaignId || undefined);
  }
}
