import { IsOptional, IsString, IsEnum, IsISO8601, IsNumber, Min, IsUUID } from 'class-validator';

export enum SponsorshipStatus {
  PENDING = 'PENDING',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  ENDED = 'ENDED',
  CANCELLED = 'CANCELLED',
}

export enum SponsorshipMethod {
  GIFT = 'GIFT',
  PIX = 'PIX',
}

export class UpdateSponsorshipDto {
  @IsOptional()
  @IsString()
  note?: string;

  @IsOptional()
  @IsString()
  collectionPointId?: string;

  @IsOptional()
  @IsEnum(SponsorshipStatus)
  status?: SponsorshipStatus;

  // ✅ NOVO: permitir alterar o método (com regras no service)
  @IsOptional()
  @IsEnum(SponsorshipMethod)
  method?: SponsorshipMethod;

  // (OPCIONAIS – caso queira já receber)
  @IsOptional()
  @IsNumber()
  @Min(0)
  donationAmount?: number;

  @IsOptional()
  @IsString()
  pixTxid?: string;

  @IsOptional()
  @IsISO8601()
  pixPaidAt?: string;

  // Permitir setar manualmente (apenas ADMIN/STAFF)
  @IsOptional()
  @IsISO8601()
  startDate?: string;

  @IsOptional()
  @IsISO8601()
  endDate?: string;
}
