import { IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';

export class CreateCityDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(999999)
  publicId?: number; // opcional; se não vier, calculamos

  @IsString()
  @Length(2, 120)
  name!: string;

  @IsOptional()
  @IsString()
  @Length(2, 10)
  state?: string; // "MG", etc.
}
