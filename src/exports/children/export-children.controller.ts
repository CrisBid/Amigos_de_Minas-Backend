import { Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { ChildrenExportService } from './export-children.service';
import { ChildrenExportQueryDto } from './dto/query.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';

// dados das crianças (nome da mãe, nascimento): só a equipe acessa
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'STAFF')
@Controller('admin/children/export')
export class ChildrenExportController {
  constructor(private readonly service: ChildrenExportService) {}

  @Get()
  async export(@Query() query: ChildrenExportQueryDto, @Res() res: Response) {
    const buffer = await this.service.generateExcel(query);

    const filename = `criancas-${query.bind || 'all'}-${query.level || 'general'}.xlsx`;
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.end(buffer);
  }
}
