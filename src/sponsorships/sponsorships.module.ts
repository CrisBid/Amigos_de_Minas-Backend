import { Module } from '@nestjs/common';
import { SponsorshipsService } from './sponsorships.service';
import { SponsorshipsController } from './sponsorships.controller';

@Module({
  providers: [SponsorshipsService],
  controllers: [SponsorshipsController],
})
export class SponsorshipsModule {}
