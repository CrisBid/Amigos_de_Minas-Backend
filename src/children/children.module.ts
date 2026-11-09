import { Module } from '@nestjs/common';
import { ChildrenService } from './children.service';
import { ChildrenUpdateService } from './children-update.service';
import { ChildrenController } from './children.controller';
import { ChildImagesModule } from '../child-images/child-images.module';

import { PrismaModule } from '../prisma/prisma.module';
import { CampaignsModule } from 'src/campaigns/campaigns.module';
import { ComposeLiveService } from 'src/child-images/compose-live.service';

@Module({
  imports: [
    PrismaModule,
    ChildImagesModule, // <<-- IMPORTANTE: traz o provider exportado
    CampaignsModule,
  ],
  providers: [ChildrenService, ChildrenUpdateService, ComposeLiveService],
  controllers: [ChildrenController],
})
export class ChildrenModule {}
