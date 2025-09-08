import { PartialType } from '@nestjs/mapped-types';
import { CreateCityDto } from './create-city.dto';
import { IsOptional, IsString, Length } from 'class-validator';

export class UpdateCityDto extends PartialType(CreateCityDto) {
  @IsOptional()
  @IsString()
  @Length(2, 120)
  name?: string;
}
