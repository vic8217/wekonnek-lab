import { IsIn, IsNumber, IsOptional, IsString, Min, MinLength } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateWalletAdjustmentDto {
  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  amount: number;

  @IsIn(['credit', 'debit'])
  direction: 'credit' | 'debit';

  @IsString()
  @MinLength(3)
  reason: string;

  @IsOptional()
  @IsString()
  @MinLength(8)
  idempotencyKey?: string;
}
