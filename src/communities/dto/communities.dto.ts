import { IsOptional, IsString, IsNotEmpty, IsUUID, IsInt, Min, IsBoolean } from 'class-validator';

export class CreateCommunityDto {
  @IsUUID()
  cityId: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsOptional()
  @IsString()
  slug?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsInt()
  publicId?: number;
}

export class UpdateCommunityDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() slug?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsInt() publicId?: number;
}

export class QueryCommunitiesDto {
  @IsOptional() @IsUUID() cityId?: string;
  @IsOptional() @IsString() q?: string; // busca por nome
  @IsOptional() @IsInt() @Min(0) skip?: number = 0;
  @IsOptional() @IsInt() @Min(1) take?: number = 20;
  @IsOptional() @IsBoolean() includeDeleted?: boolean = false;
}
