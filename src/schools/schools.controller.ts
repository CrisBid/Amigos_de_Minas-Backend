import { Controller, Get, Post, Patch, Param, Body, Query, Delete } from '@nestjs/common';
import { SchoolsService } from './schools.service';
import { CreateSchoolDto, UpdateSchoolDto, QuerySchoolsDto } from './dto/schools.dto';

@Controller('schools')
export class SchoolsController {
  constructor(private service: SchoolsService) {}

  @Post()
  create(@Body() dto: CreateSchoolDto) {
    return this.service.create(dto);
  }

  @Get()
  list(@Query() query: QuerySchoolsDto) {
    const take = query.pageSize ?? query.take ?? 20;
    const skip = query.page ? (query.page - 1) * take : (query.skip ?? 0);

    return this.service.findMany({
      cityId: query.cityId,
      communityId: query.communityId,
      q: query.q,
      includeDeleted: query.includeDeleted ?? false,
      skip,
      take,
    } as QuerySchoolsDto);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateSchoolDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  softDelete(@Param('id') id: string) {
    return this.service.softDelete(id);
  }

  @Patch(':id/restore')
  restore(@Param('id') id: string) {
    return this.service.restore(id);
  }
}
