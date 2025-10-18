import { IsOptional, IsString, IsEnum, IsArray } from 'class-validator';
import { Transform } from 'class-transformer';
import { Role } from '@prisma/client';

export class ListUsersDto {
  @IsOptional()
  @IsString()
  query?: string;

  // aceita roles=ADMIN ou roles=ADMIN,STAFF ou múltiplos roles no querystring
  @IsOptional()
  @IsArray()
  @IsEnum(Role, { each: true })
  @Transform(({ value }) => {
    if (!value) return undefined;
    if (Array.isArray(value)) return value;              // ?roles=ADMIN&roles=STAFF
    if (typeof value === 'string') return value.split(',').map(s => s.trim()).filter(Boolean); // roles=ADMIN,STAFF
    return undefined;
  })
  roles?: Role[];
}
