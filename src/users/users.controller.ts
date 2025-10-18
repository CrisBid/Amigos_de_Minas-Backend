import { Controller, Get, Param, Patch, Body, Query, UseGuards } from '@nestjs/common';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { ListUsersDto } from './dto/list-users.dto';
import { UpdateUserRolesDto } from './dto/update-user-roles.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'STAFF')
@Controller('users')
export class UsersController {
  constructor(private users: UsersService) {}

  @Get()
  list(@Query() query: ListUsersDto) {
    return this.users.findAll({ query: query.query, roles: query.roles as any });
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.users.findById(id);
  }

  // PATCH /users/:id  -> { roles: Role[] }
  @Patch(':id')
  updateRoles(@Param('id') id: string, @Body() body: UpdateUserRolesDto) {
    return this.users.updateRoles(id, body.roles as any);
  }
}
