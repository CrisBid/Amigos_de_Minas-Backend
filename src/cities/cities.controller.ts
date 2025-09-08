import {
  Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards
} from '@nestjs/common';
import { CitiesService } from './cities.service';
import { CreateCityDto } from './dto/create-city.dto';
import { UpdateCityDto } from './dto/update-city.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('cities')
export class CitiesController {
  constructor(private readonly service: CitiesService) {}

  @Get()
  @Roles('ADMIN', 'STAFF')
  list(
    @Query('q') q?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.service.list({ q, page: Number(page), pageSize: Number(pageSize) });
  }

  @Get(':id')
  @Roles('ADMIN', 'STAFF')
  get(@Param('id') id: string) {
    return this.service.findById(id);
  }

  @Post()
  @Roles('ADMIN', 'STAFF')
  create(@Body() dto: CreateCityDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  @Roles('ADMIN', 'STAFF')
  update(@Param('id') id: string, @Body() dto: UpdateCityDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @Roles('ADMIN', 'STAFF')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
