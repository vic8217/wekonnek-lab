import { IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class VoidInvoiceDto {
  @ApiProperty({ description: 'Reason for voiding the invoice' })
  @IsString()
  @IsNotEmpty()
  reason: string;
}
