import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, Max, Min } from 'class-validator';

export class AddDemoWalletCreditDto {
  @ApiProperty({ example: 500, description: 'Demo wallet credit in PHP' })
  @IsNumber()
  @Min(50)
  @Max(50000)
  amount: number;
}
