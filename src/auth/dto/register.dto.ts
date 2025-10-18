import { IsEmail, IsOptional, IsString, MinLength } from 'class-validator';

export class RegisterDto {
  @IsString() name: string;
  @IsEmail() email: string;
  @IsString() @MinLength(6) password: string;

  // Login opcional por telefone
  @IsOptional() @IsString() phone?: string;

  // Roles opcionais
  @IsOptional() roles?: ('ADMIN'|'STAFF'|'SPONSOR')[];

  // ----- Campos de Profile (todos opcionais)
  @IsOptional() @IsString() cep?: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsString() city?: string;
  @IsOptional() @IsString() profession?: string;
  @IsOptional() @IsString() incomeRange?: string;
  @IsOptional() @IsString() maritalStatus?: string;
}
