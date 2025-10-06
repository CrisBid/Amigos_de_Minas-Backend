import { IsOptional, IsString, IsNotEmpty, IsInt, Min, IsBoolean } from 'class-validator';
import { Transform, Type } from 'class-transformer';

export class CreateSchoolDto {
  @IsString() // era IsUUID()
  cityId: string;

  @IsOptional()
  @IsString() // era IsUUID()
  communityId?: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsOptional() @IsString() slug?: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsInt() publicId?: number;
}

export class UpdateSchoolDto {
  @IsOptional() @IsString() communityId?: string; // era IsUUID()
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() slug?: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsInt() publicId?: number;
}

export class QuerySchoolsDto {
  @IsOptional() @IsString()
  cityId?: string; // aceita cuid

  @IsOptional() @IsString()
  communityId?: string; // aceita cuid

  @IsOptional() @IsString()
  q?: string;

  // suporta skip/take e também page/pageSize
  @IsOptional() @Type(() => Number) @IsInt() @Min(0)
  skip?: number = 0;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  take?: number = 20;

  @IsOptional()
  @Transform(({ value }) => {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') return ['1','true','on','yes'].includes(value.toLowerCase());
    return false;
  })
  @IsBoolean()
  includeDeleted?: boolean = false;

  // extras vindos do front para paginação
  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  page?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  pageSize?: number;
}
