import { IsOptional, IsString, IsNotEmpty, IsUUID, IsInt, Min, IsBoolean } from 'class-validator';

export class CreateSchoolDto {
  @IsUUID()
  cityId: string;

  @IsOptional()
  @IsUUID()
  communityId?: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsOptional() @IsString() slug?: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsInt() publicId?: number;
}

export class UpdateSchoolDto {
  @IsOptional() @IsUUID() communityId?: string;
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() slug?: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsInt() publicId?: number;
}

export class QuerySchoolsDto {
  @IsOptional() @IsUUID() cityId?: string;
  @IsOptional() @IsUUID() communityId?: string;
  @IsOptional() @IsString() q?: string;
  @IsOptional() @IsInt() @Min(0) skip?: number = 0;
  @IsOptional() @IsInt() @Min(1) take?: number = 20;
  @IsOptional() @IsBoolean() includeDeleted?: boolean = false;
}
