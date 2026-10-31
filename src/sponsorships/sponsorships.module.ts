import { Module } from '@nestjs/common';
import { SponsorshipsService } from './sponsorships.service';
import { SponsorshipsController } from './sponsorships.controller';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [NotificationsModule],
  providers: [SponsorshipsService],
  controllers: [SponsorshipsController],
})
export class SponsorshipsModule {}
