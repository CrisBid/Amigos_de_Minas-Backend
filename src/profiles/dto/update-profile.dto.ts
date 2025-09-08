import { IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateProfileDto {
  // opcional: atualizar nome do usuário (User.name)
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(9)
  cep?: string;

  @IsOptional()
  @IsString()
  @MaxLength(180)
  address?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  city?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  profession?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  incomeRange?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  maritalStatus?: string;
}
