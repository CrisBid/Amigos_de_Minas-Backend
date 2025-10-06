import { IsOptional, IsString, IsNotEmpty, IsInt, Min, IsBoolean } from 'class-validator';
import { Transform, Type } from 'class-transformer';

export class CreateCommunityDto {
  @IsString() // era IsUUID()
  cityId: string;

  @IsString() @IsNotEmpty()
  name: string;

  @IsOptional() @IsString() slug?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsInt() publicId?: number;
}

export class UpdateCommunityDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() slug?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsInt() publicId?: number;
}

export class QueryCommunitiesDto {
  @IsOptional() @IsString()
  cityId?: string; // aceita cuid

  @IsOptional() @IsString()
  q?: string;

  // suporta page/pageSize vindos como string e converte
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

  // parâmetros extras só para leitura do query (serão normalizados no controller)
  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  page?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  pageSize?: number;
}
