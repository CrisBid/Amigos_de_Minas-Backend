import { Module } from '@nestjs/common';
import { CollectionPointsService } from './collection-points.service';
import { CollectionPointsController } from './collection-points.controller';
import { PrismaService } from 'src/prisma/prisma.service';

@Module({
    controllers: [CollectionPointsController],
    providers: [CollectionPointsService, PrismaService],
    exports: [CollectionPointsService],
})
export class CollectionPointsModule {}