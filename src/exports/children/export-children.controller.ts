import { Controller, Get, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ChildrenExportService } from './export-children.service';
import { ChildrenExportQueryDto } from './dto/query.dto';

// aplique seus guards/roles se necessário (ADMIN/STAFF)
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
