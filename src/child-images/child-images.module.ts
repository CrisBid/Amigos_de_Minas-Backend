import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ChildImagesService } from './child-images.service';
import { StorageService } from '../common/storage/storage.service';
import { ChildImagesController } from './child-images.controller';

@Module({
  imports: [PrismaModule],
  providers: [ChildImagesService, StorageService],
  controllers: [ChildImagesController],
  exports: [ChildImagesService], // <<-- IMPORTANTE
})
export class ChildImagesModule {}
