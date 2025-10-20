import { Module } from '@nestjs/common';
import { ExportSponsorshipsController } from './export-sponsorships.controller';
import { ExportSponsorshipsService } from './export-sponsorships.service';
import { PrismaService } from '../../prisma/prisma.service';

@Module({
  controllers: [ExportSponsorshipsController],
  providers: [ExportSponsorshipsService, PrismaService],
  exports: [ExportSponsorshipsService],
})
export class ExportSponsorshipsModule {}
