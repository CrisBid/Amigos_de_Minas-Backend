import { IsArray, IsString, ArrayMinSize } from 'class-validator';

export class TransferSponsorshipsDto {
  @IsArray() @ArrayMinSize(1)
  sponsorshipIds!: string[];

  @IsString()
  toSponsorId!: string;
}
