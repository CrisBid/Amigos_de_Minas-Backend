import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { ChildrenModule } from './children/children.module';
import { SponsorshipsModule } from './sponsorships/sponsorships.module';

@Module({
  imports: [PrismaModule, AuthModule, UsersModule, ChildrenModule, SponsorshipsModule],
})
export class AppModule {}
