import { IsString, IsOptional } from 'class-validator';

export class CreateSponsorshipDto {
  @IsString() childId: string;
  @IsOptional() note?: string;
}
