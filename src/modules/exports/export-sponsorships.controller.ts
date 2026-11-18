import { Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { ExportSponsorshipsService } from './export-sponsorships.service';
import { ExportSponsorshipsQueryDto } from './dto/export-sponsorships.dto';

// tem nome, e-mail e telefone dos padrinhos: só a equipe acessa
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'STAFF')
@Controller('admin/sponsorships')
export class ExportSponsorshipsController {
  constructor(private readonly service: ExportSponsorshipsService) {}

  /** Excel com as colunas e o agrupamento escolhidos (+ aba de padrinhos) */
  @Get('export')
  async exportExcel(@Query() query: ExportSponsorshipsQueryDto, @Res() res: Response) {
    const buffer = await this.service.generateExcel(query);
    const filename = `apadrinhamentos-${new Date().toISOString().slice(0, 10)}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.end(buffer);
  }

  /** Mesmas linhas em JSON (prévia na tela e PDF da lista de presentes) */
  @Get('export/rows')
  rows(@Query() query: ExportSponsorshipsQueryDto) {
    return this.service.rows(query);
  }
}
