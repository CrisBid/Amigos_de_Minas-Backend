import { IsString, MaxLength, MinLength } from 'class-validator';

export class SetUserPasswordDto {
  @IsString()
  @MinLength(6, { message: 'A senha precisa ter pelo menos 6 caracteres.' })
  @MaxLength(128)
  password!: string;
}
