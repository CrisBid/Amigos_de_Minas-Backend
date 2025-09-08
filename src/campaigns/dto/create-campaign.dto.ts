import { IsDateString, IsEnum, IsInt, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateCampaignDto {
  @IsString() @MaxLength(120) name: string;
  @IsString() @MaxLength(120) slug: string;
  @IsOptional() @IsInt() year?: number;
  @IsOptional() @IsString() @MaxLength(500) description?: string;
  @IsOptional() @IsDateString() startDate?: string;
  @IsOptional() @IsDateString() endDate?: string;
  @IsOptional() @IsEnum(['DRAFT','ACTIVE','FINISHED','ARCHIVED'] as any) status?: any;
}
