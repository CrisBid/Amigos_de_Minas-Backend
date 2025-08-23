import { Body, Controller, Get, Param, Patch, Post, Delete, UseGuards } from '@nestjs/common';
import { ChildrenService } from './children.service';
import { CreateChildDto } from './dto/create-child.dto';
import { UpdateChildDto } from './dto/update-child.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

@Controller('children')
export class ChildrenController {
  constructor(private service: ChildrenService) {}

  @Get()
  list() { return this.service.list(); }

  @Get(':id')
  get(@Param('id') id: string) { return this.service.get(id); }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN','STAFF')
  @Post()
  create(@Body() dto: CreateChildDto) { return this.service.create(dto); }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN','STAFF')
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateChildDto) { return this.service.update(id, dto); }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN','STAFF')
  @Delete(':id')
  remove(@Param('id') id: string) { return this.service.softDelete(id); }
}
