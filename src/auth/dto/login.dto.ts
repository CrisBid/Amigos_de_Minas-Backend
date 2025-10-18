import { IsString, MinLength } from 'class-validator';

export class LoginDto {
  @IsString()
  identifier: string; // pode ser e-mail OU telefone
  @IsString()
  @MinLength(4)
  password: string;
}
