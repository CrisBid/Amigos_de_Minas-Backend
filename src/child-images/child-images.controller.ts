import { Body, Controller, Delete, Get, Param, Patch, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { ChildImagesService } from './child-images.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('child-images')
export class ChildImagesController {
  constructor(private service: ChildImagesService) {}

  @Roles('ADMIN','STAFF')
  @Get('by-child/:childId')
  list(@Param('childId') childId: string, @Query('campaignId') campaignId?: string) {
    return this.service.listForChild(childId, campaignId);
  }

  @Roles('ADMIN','STAFF')
  @Patch(':id/compose')
  updateCompose(@Param('id') id: string, @Body() body: any) {
    return this.service.updateCompose(id, body);
  }

  @Roles('ADMIN','STAFF')
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.service.delete(id);
  }
}
