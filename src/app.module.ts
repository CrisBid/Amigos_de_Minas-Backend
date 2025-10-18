import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { ChildrenModule } from './children/children.module';
import { SponsorshipsModule } from './sponsorships/sponsorships.module';
import { ProfilesModule } from './profiles/profiles.module';
import { CampaignsModule } from './campaigns/campaigns.module';
import { StorageModule } from './common/storage/storage.module';
import { CitiesModule } from './cities/cities.module';
import { ChildImagesModule } from './child-images/child-images.module';

import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
import { CommunitiesModule } from './communities/communities.module';
import { SchoolsModule } from './schools/schools.module';
import { CollectionPointsModule } from './collection-points/collection-points.module';

@Module({
  imports: [
    ServeStaticModule.forRoot({
      rootPath: join(process.cwd(), process.env.UPLOAD_DIR || 'uploads'),
      serveRoot: '/uploads',
      serveStaticOptions: {
        index: false,
        cacheControl: true,
        maxAge: '30d',
      },
    }),
    PrismaModule, 
    AuthModule, 
    UsersModule, 
    ChildrenModule, 
    SponsorshipsModule, 
    ProfilesModule, 
    CampaignsModule,
    StorageModule,
    CitiesModule,
    CommunitiesModule,
    SchoolsModule,
    ChildImagesModule,
    CollectionPointsModule
  ],
})
export class AppModule {}
