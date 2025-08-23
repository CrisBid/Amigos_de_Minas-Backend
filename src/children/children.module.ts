import { Module } from '@nestjs/common';
import { ChildrenService } from './children.service';
import { ChildrenController } from './children.controller';

@Module({
  providers: [ChildrenService],
  controllers: [ChildrenController],
})
export class ChildrenModule {}
