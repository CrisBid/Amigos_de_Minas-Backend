import { IsEnum, IsOptional, IsString } from 'class-validator';

export enum ExportLevel {
  GENERAL = 'general',     // abas por Cidade
  CITY = 'city',           // abas por Comunidade
  COMMUNITY = 'community', // abas por Escola
  SELECTION = 'selection', // ids de crianças selecionadas
}

export enum BindFilter {
  ALL = 'all',             // todas
  SPONSORED = 'sponsored', // somente com apadrinhamento (ativo)
  UNSPONSORED = 'unsponsored', // somente sem apadrinhamento (ativo)
}

export class ChildrenExportQueryDto {
  @IsEnum(ExportLevel)
  @IsOptional()
  level?: ExportLevel = ExportLevel.GENERAL;

  @IsEnum(BindFilter)
  @IsOptional()
  bind?: BindFilter = BindFilter.ALL;

  /** quando level = city */
  @IsString()
  @IsOptional()
  cityId?: string;

  /** quando level = community */
  @IsString()
  @IsOptional()
  communityId?: string;

  /** quando level = selection (ids de crianças) — separados por vírgula, espaço ou quebra de linha */
  @IsString()
  @IsOptional()
  ids?: string;
}
