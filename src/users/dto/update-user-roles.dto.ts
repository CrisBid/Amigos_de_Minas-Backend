import { IsArray, ArrayNotEmpty, IsEnum } from 'class-validator';
import { Role } from '@prisma/client';

export class UpdateUserRolesDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsEnum(Role, { each: true })
  roles!: Role[];
}
