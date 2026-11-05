import { IsEmail, IsString, Length, MaxLength, MinLength } from 'class-validator';

export class ForgotPasswordDto {
  @IsEmail({}, { message: 'Informe um e-mail válido.' })
  @MaxLength(254)
  email: string;
}

export class ChangePasswordDto {
  @IsString()
  @MinLength(1, { message: 'Informe a senha atual.' })
  @MaxLength(128)
  currentPassword: string;

  @IsString()
  @MinLength(6, { message: 'A nova senha precisa ter pelo menos 6 caracteres.' })
  @MaxLength(128)
  newPassword: string;
}

export class ResetPasswordDto {
  @IsString()
  @Length(64, 64, { message: 'Link inválido.' })
  token: string;

  @IsString()
  @MinLength(6, { message: 'A senha precisa ter pelo menos 6 caracteres.' })
  @MaxLength(128)
  password: string;
}
