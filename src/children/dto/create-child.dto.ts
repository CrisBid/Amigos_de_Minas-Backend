import { IsInt, IsOptional, IsString, IsUrl, Min } from 'class-validator';

export class CreateChildDto {
  @IsString() name: string;
  @IsOptional() birthDate?: Date;
  @IsOptional() @IsInt() @Min(0) age?: number;
  @IsOptional() @IsString() motherName?: string;
  @IsString() city: string;
  @IsOptional() @IsString() schoolLegacy?: string;
  @IsOptional() @IsString() category?: string;
  @IsOptional() @IsString() wantedGift?: string;
  @IsOptional() @IsUrl() photoUrl?: string;
  @IsOptional() @IsString() description?: string;
}
