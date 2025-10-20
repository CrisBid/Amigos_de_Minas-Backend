import { Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { ExportSponsorshipsService } from './export-sponsorships.service';
import { ExportSponsorshipsQueryDto } from './dto/export-sponsorships.dto';
// Importe seus guards/decorators conforme seu projeto
// import { AuthGuard } from '@/auth/guards/auth.guard';
// import { RolesGuard } from '@/auth/guards/roles.guard';
// import { Roles } from '@/auth/roles.decorator';

@Controller('admin/sponsorships')
export class ExportSponsorshipsController {
  constructor(private readonly service: ExportSponsorshipsService) {}

  @Get('export')
  // @UseGuards(AuthGuard, RolesGuard)
  // @Roles('ADMIN', 'STAFF')
  async exportExcel(@Query() query: ExportSponsorshipsQueryDto, @Res() res: Response) {
    const buffer = await this.service.generateExcel(query);

    const filename = `apadrinhamentos-${query.level || 'general'}.xlsx`;
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.end(buffer);
  }
}
