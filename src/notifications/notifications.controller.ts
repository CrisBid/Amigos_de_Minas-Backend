import { Body, Controller, Get, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { IsBoolean, IsOptional } from 'class-validator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { NotificationsService } from './notifications.service';

class NotificationPreferencesDto {
  @IsOptional()
  @IsBoolean()
  emailPendingSponsorships?: boolean;
}

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'STAFF')
@Controller('notifications')
export class NotificationsController {
  constructor(private service: NotificationsService) {}

  /** Sino do painel: total de pendentes e os mais recentes */
  @Get('pending')
  pending(@Query('campaignId') campaignId?: string) {
    return this.service.pendingSummary(campaignId || undefined);
  }

  @Get('preferences')
  preferences(@Req() req: any) {
    return this.service.getPreferences(req.user.sub);
  }

  @Put('preferences')
  setPreferences(@Req() req: any, @Body() body: NotificationPreferencesDto) {
    return this.service.setPreferences(req.user.sub, body);
  }

  @Post('test')
  test(@Req() req: any) {
    return this.service.sendTest(req.user.sub);
  }
}
