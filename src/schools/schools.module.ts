import { Module } from '@nestjs/common';
import { SchoolsController } from './schools.controller';
import { SchoolsService } from './schools.service';
import { PrismaService } from '../prisma/prisma.service';

@Module({
  controllers: [SchoolsController],
  providers: [SchoolsService, PrismaService],
  exports: [SchoolsService],
})
export class SchoolsModule {}
