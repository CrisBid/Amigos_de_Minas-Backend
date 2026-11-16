import { Module } from '@nestjs/common';
import { GoogleClient } from './google.client';
import { SourceCheckService } from './source-check.service';
import { SourceCheckController } from './source-check.controller';

@Module({
  providers: [GoogleClient, SourceCheckService],
  controllers: [SourceCheckController],
})
export class SourceCheckModule {}
