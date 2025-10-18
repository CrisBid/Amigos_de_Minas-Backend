import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { CollectionPointsService } from './collection-points.service';
import { CreateCollectionPointDto, UpdateCollectionPointDto } from './dto/collection-point.dto';

@Controller('collection-points')
export class CollectionPointsController {
  constructor(private service: CollectionPointsService) {}

  @Post()
  create(@Body() dto: CreateCollectionPointDto) {
    return this.service.create(dto);
  }

  @Get()
  list(@Query('q') q?: string, @Query('active') active?: string) {
    return this.service.list({ q, active: active === 'true' ? true : active === 'false' ? false : undefined });
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.service.get(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateCollectionPointDto) {
    return this.service.update(id, dto);
  }
}
