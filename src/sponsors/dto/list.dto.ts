import { IsInt, IsOptional, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class ListSponsorsDto {
  @IsString()
  @IsOptional()
  q?: string; // nome, email, telefone

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  limit?: number = 50;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  page?: number = 1;

  @IsString()
  @IsOptional()
  orderBy?: 'name' | 'createdAt' = 'name';

  @IsString()
  @IsOptional()
  order?: 'asc' | 'desc' = 'asc';
}
