import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { StorageService } from '../common/storage/storage.service';
import { CampaignsService } from './campaigns.service';
import { CampaignsController } from './campaigns.controller';
import { CampaignFramesService } from './campaign-frames.service';
import { CampaignFramesController } from './campaign-frames.controller';

@Module({
  imports: [PrismaModule],
  providers: [CampaignsService, CampaignFramesService, StorageService],
  controllers: [CampaignsController, CampaignFramesController],
  exports: [CampaignsService, CampaignFramesService],
})
export class CampaignsModule {}
