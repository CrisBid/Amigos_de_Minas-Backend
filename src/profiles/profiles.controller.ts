import { Body, Controller, Get, Param, Patch, Put, Req, UseGuards } from '@nestjs/common';
import { ProfilesService } from './profiles.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';

@UseGuards(JwtAuthGuard)
@Controller('profiles')
export class ProfilesController {
  constructor(private service: ProfilesService) {}

  // GET /profiles/me
  @Get('me')
  async getMe(@Req() req: any) {
    const userId = req.user.sub as string;
    return this.service.getMe(userId);
  }

  // PUT /profiles/me
  @Put('me')
  async upsertMe(@Req() req: any, @Body() dto: UpdateProfileDto) {
    const userId = req.user.sub as string;
    return this.service.upsertMe(userId, dto);
  }

  @Patch('me')
  updateMePatch(@Req() req: any, @Body() dto: UpdateProfileDto) {
    const userId = req.user?.sub ?? req.user?.id;
    // Idem ao PUT; PATCH aceita parciais
    return this.service.upsertByUserId(userId, dto);
  }

  // ---- OPCIONAL: endpoints admin ----
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'STAFF')
  @Get(':userId')
  async getByUserId(@Param('userId') userId: string) {
    return this.service.getByUserId(userId, userId);
  }
}
