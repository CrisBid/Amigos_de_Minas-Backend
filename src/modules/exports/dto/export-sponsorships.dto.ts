// src/modules/exports/dto/export-sponsorships.dto.ts
import { IsEnum, IsOptional, IsString, IsArray } from 'class-validator';
import { Type } from 'class-transformer';

export enum ExportLevel {
  GENERAL = 'general',
  CITY = 'city',
  COMMUNITY = 'community',
  SPONSOR = 'sponsor',
  SELECTION = 'selection',
}

export class ExportSponsorshipsQueryDto {
  @IsEnum(ExportLevel)
  @IsOptional()
  level?: ExportLevel = ExportLevel.GENERAL;

  /** Use quando level = city */
  @IsString()
  @IsOptional()
  cityId?: string;

  /** Use quando level = community */
  @IsString()
  @IsOptional()
  communityId?: string;

  /** Use quando level = sponsor */
  @IsString()
  @IsOptional()
  sponsorId?: string;

  /**
   * Use quando level = selection
   * Pode ser: ids=uuid1,uuid2,uuid3
   */
  @IsString()
  @IsOptional()
  ids?: string;

  /**
   * Filtros opcionais
   * ex: ?status=PENDING,IN_PROGRESS
   */
  @IsString()
  @IsOptional()
  status?: string;

  /** ex: ?method=PIX,GIFT */
  @IsString()
  @IsOptional()
  method?: string;
}
