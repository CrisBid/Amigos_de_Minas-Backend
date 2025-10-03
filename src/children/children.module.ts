import { Module } from '@nestjs/common';
import { ChildrenService } from './children.service';
import { ChildrenController } from './children.controller';
import { ChildImagesModule } from '../child-images/child-images.module';

import { PrismaModule } from '../prisma/prisma.module';
import { CampaignsModule } from 'src/campaigns/campaigns.module';

@Module({
  imports: [
    PrismaModule,
    ChildImagesModule, // <<-- IMPORTANTE: traz o provider exportado
    CampaignsModule,
  ],
  providers: [ChildrenService],
  controllers: [ChildrenController],
})
export class ChildrenModule {}
