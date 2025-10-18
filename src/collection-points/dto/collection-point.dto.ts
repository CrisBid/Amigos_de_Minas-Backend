import { IsBoolean, IsOptional, IsString, IsNumber, IsUUID } from 'class-validator'

export class CreateCollectionPointDto {
  @IsString() name: string
  @IsString() slug: string
  @IsOptional() @IsString() description?: string

  @IsOptional() @IsString() address?: string
  @IsOptional() @IsString() district?: string
  @IsOptional() @IsString() cityName?: string
  @IsOptional() @IsString() state?: string
  @IsOptional() @IsString() zipCode?: string

  @IsOptional() @IsNumber() lat?: number
  @IsOptional() @IsNumber() lng?: number

  @IsOptional() @IsString() responsibleUserId?: string

  @IsOptional() @IsString() phone?: string
  @IsOptional() openingJson?: any

  @IsOptional() @IsBoolean() active?: boolean
}

export class UpdateCollectionPointDto extends CreateCollectionPointDto {}
