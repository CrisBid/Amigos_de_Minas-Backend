import { Module } from '@nestjs/common';
import { PlacesController } from './places.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [PlacesController],
})
export class PlacesModule {}
