import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN','STAFF')
@Controller('users')
export class UsersController {
  constructor(private users: UsersService) {}

  @Get()
  list() { return this.users.findAll(); }

  @Get(':id')
  get(@Param('id') id: string) { return this.users.findById(id); }
}
