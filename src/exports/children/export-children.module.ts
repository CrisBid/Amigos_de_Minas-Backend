import { Module } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import { ChildrenExportService } from './export-children.service';
import { ChildrenExportController } from './export-children.controller';

@Module({
  controllers: [ChildrenExportController],
  providers: [ChildrenExportService, PrismaService],
})
export class ChildrenExportModule {}
