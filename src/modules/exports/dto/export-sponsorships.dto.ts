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

  /** opcional: só os apadrinhamentos desta campanha */
  @IsString()
  @IsOptional()
  campaignId?: string;

  /** ex: ?method=PIX,GIFT */
  @IsString()
  @IsOptional()
  method?: string;

  /** colunas, na ordem: ?fields=publicId,childName,age,place,gift,sponsorName */
  @IsString()
  @IsOptional()
  fields?: string;

  /** agrupamento: community (padrão) | city | school | sponsor | collectionPoint | none */
  @IsString()
  @IsOptional()
  groupBy?: string;

  /** Excel: tabs (uma aba por grupo, padrão) | single (uma aba com títulos de grupo) */
  @IsString()
  @IsOptional()
  layout?: string;

  /** 0 = sem a aba "Padrinhos" no final */
  @IsString()
  @IsOptional()
  sponsorList?: string;

  /** 0 = sem o resumo dos presentes por comunidade */
  @IsString()
  @IsOptional()
  giftSummary?: string;

  /** ordem dentro do grupo: name (padrão) | id */
  @IsString()
  @IsOptional()
  sortBy?: string;
}
