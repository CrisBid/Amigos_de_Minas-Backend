// sponsorships.dto.ts
import { IsOptional, IsString, IsEnum, IsISO8601, IsNumber, Min } from 'class-validator';
import { SponsorshipStatus as PrismaSponsorshipStatus } from '@prisma/client';

export enum SponsorshipMethod {
  GIFT = 'GIFT',
  PIX = 'PIX',
}

// (opcional) reexport do type para uso externo
export type SponsorshipStatus = PrismaSponsorshipStatus;

export class UpdateSponsorshipDto {
  @IsOptional()
  @IsString()
  note?: string;

  @IsOptional()
  @IsString()
  collectionPointId?: string;

  @IsOptional()
  @IsEnum(PrismaSponsorshipStatus)
  status?: PrismaSponsorshipStatus;

  // ✅ permitir alterar o método (regras no service)
  @IsOptional()
  @IsEnum(SponsorshipMethod)
  method?: SponsorshipMethod;

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
