import { Module } from '@nestjs/common';
import { GoogleClient } from './google.client';
import { SourceCheckService } from './source-check.service';
import { SourceSyncService } from './source-sync.service';
import { SourceCheckController } from './source-check.controller';
import { ChildrenModule } from '../children/children.module';
import { ChildImagesModule } from '../child-images/child-images.module';
import { CampaignsModule } from '../campaigns/campaigns.module';

@Module({
  imports: [ChildrenModule, ChildImagesModule, CampaignsModule],
  providers: [GoogleClient, SourceCheckService, SourceSyncService],
  controllers: [SourceCheckController],
})
export class SourceCheckModule {}
