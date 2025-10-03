import { IsArray, IsInt, IsOptional, IsString, IsISO8601, ValidateNested, IsNotEmpty, IsObject } from 'class-validator';
import { Type } from 'class-transformer';

export class BulkChildDto {
  @IsNotEmpty() @IsString() publicId!: string | number;
  @IsNotEmpty() @IsString() name!: string;

  @IsOptional() @IsISO8601() birthDate?: string; // YYYY-MM-DD
  @IsOptional() @IsString() category?: string | null;
  @IsOptional() @IsString() wantedGift?: string | null;
  @IsOptional() @IsString() description?: string | null;
  @IsOptional() @IsString() school?: string | null;
}

export class BulkContextDto {
  @IsNotEmpty() @IsString() cityId!: string;
  @IsOptional() @IsString() communityId?: string | null;
  @IsOptional() @IsString() schoolId?: string | null;
  @IsOptional() @IsString() campaignId?: string | null;
}

export class BulkCommitDto {
  @IsArray() @ValidateNested({ each: true }) @Type(() => BulkChildDto)
  children!: BulkChildDto[];

  @IsObject() @ValidateNested() @Type(() => BulkContextDto)
  context!: BulkContextDto;
}
