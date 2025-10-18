import { IsEnum, IsNumber, IsOptional, IsString, Min, IsArray, IsUUID } from 'class-validator';
import { Transform } from 'class-transformer';
import { SponsorshipMethod } from './sponsorships.dto';

export class CreateSponsorshipDto {
  // Mantém compatibilidade: 1 único ID
  @IsOptional()
  @IsString()
  childId?: string;

  /**
   * Novo: múltiplos IDs
   * Aceita:
   *  - array JSON: ["a","b","c"]
   *  - string CSV:  "a,b,c"
   */
  @IsOptional()
  @Transform(({ value }) => {
    if (Array.isArray(value)) {
      return value.map((v) => String(v).trim()).filter(Boolean);
    }
    if (typeof value === 'string') {
      return value.split(',').map((s) => s.trim()).filter(Boolean);
    }
    return undefined;
  })
  @IsArray()
  @IsString({ each: true })
  childIds?: string[];

  @IsString()
  campaignId: string;

  @IsEnum(SponsorshipMethod)
  method: SponsorshipMethod; // obrigatório

  @IsOptional()
  @IsString()
  note?: string;

  @IsOptional()
  @IsString()
  collectionPointId?: string;
  

  // (OPCIONAIS – só para PIX, se quiser mandar)
  @IsOptional()
  @IsNumber()
  @Min(0)
  donationAmount?: number;

  @IsOptional()
  @IsString()
  pixTxid?: string;
}
