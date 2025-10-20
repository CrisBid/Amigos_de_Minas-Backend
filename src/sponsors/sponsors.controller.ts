import { Controller, Get, Query } from '@nestjs/common';
import { SponsorsService } from './sponsors.service';
import { ListSponsorsDto } from './dto/list.dto';

// Aplique seus guards se necessário:
// @UseGuards(AuthGuard, RolesGuard)
// @Roles('ADMIN','STAFF')
@Controller('sponsors')
export class SponsorsController {
  constructor(private readonly service: SponsorsService) {}

  @Get()
  async list(@Query() dto: ListSponsorsDto) {
    return this.service.list(dto);
  }
}
