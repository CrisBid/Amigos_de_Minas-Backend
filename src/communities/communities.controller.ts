import { Controller, Get, Post, Patch, Param, Body, Query, Delete } from '@nestjs/common';
import { CommunitiesService } from './communities.service';
import { CreateCommunityDto, UpdateCommunityDto, QueryCommunitiesDto } from './dto/communities.dto';

@Controller('communities')
export class CommunitiesController {
  constructor(private service: CommunitiesService) {}

  @Post()
  create(@Body() dto: CreateCommunityDto) {
    return this.service.create(dto);
  }

  @Get()
  list(@Query() query: QueryCommunitiesDto) {
    // se vier page/pageSize, converte para skip/take
    const take = query.pageSize ?? query.take ?? 20;
    const skip = query.page ? (query.page - 1) * take : (query.skip ?? 0);

    return this.service.findMany({
      cityId: query.cityId,
      q: query.q,
      skip,
      take,
      includeDeleted: query.includeDeleted ?? false,
    } as QueryCommunitiesDto);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateCommunityDto) {
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
