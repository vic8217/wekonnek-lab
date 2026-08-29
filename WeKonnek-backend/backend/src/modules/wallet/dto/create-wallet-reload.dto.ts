import { Type } from 'class-transformer';
import { Equals, IsNumber, Max, Min } from 'class-validator';

export class CreateWalletReloadDto {
  @Type(() => Number)
  @IsNumber()
  @Min(50)
  @Max(50000)
  amount: number;

  @Equals('paycools')
  provider: 'paycools';
}
