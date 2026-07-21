import { IsNumber, IsEnum, IsString, Min, Max } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { WalletPaymentGateway } from '@prisma/client';

export class TopUpDto {
  @ApiProperty({ example: 500, description: 'Amount in PHP (min 50, max 50000)' })
  @IsNumber()
  @Min(50)
  @Max(50000)
  amount: number;

  @ApiProperty({ enum: WalletPaymentGateway, example: 'paymongo' })
  @IsEnum(WalletPaymentGateway)
  gateway: WalletPaymentGateway;

  @ApiProperty({ example: 'gcash', description: 'gcash, grab_pay, card, bank, maya_pay' })
  @IsString()
  paymentMethod: string;
}

export class WalletPayDto {
  @ApiProperty({ example: 272 })
  @IsNumber()
  @Min(1)
  amount: number;

  @ApiProperty({ example: 'uuid-order-id' })
  @IsString()
  orderId: string;

  @ApiProperty({ example: '123456', description: '6-digit wallet PIN' })
  @IsString()
  pin: string;

  @ApiProperty({ required: false })
  description?: string;
}

export class CashOutDto {
  @ApiProperty({ example: 2000 })
  @IsNumber()
  @Min(100)
  amount: number;

  @ApiProperty({ enum: ['maya', 'xendit'] })
  @IsEnum(WalletPaymentGateway)
  gateway: WalletPaymentGateway;

  @ApiProperty({ example: 'GCASH', description: 'Bank code or e-wallet name' })
  @IsString()
  bankCode: string;

  @ApiProperty({ example: '09171234567' })
  @IsString()
  accountNumber: string;

  @ApiProperty({ example: 'Juan dela Cruz' })
  @IsString()
  accountName: string;

  @ApiProperty({ example: '123456' })
  @IsString()
  pin: string;
}

export class TransferDto {
  @ApiProperty({ example: '09171234567' })
  @IsString()
  recipientPhone: string;

  @ApiProperty({ example: 100 })
  @IsNumber()
  @Min(1)
  amount: number;

  @ApiProperty({ example: '123456' })
  @IsString()
  pin: string;
}

export class SetPinDto {
  @ApiProperty({ example: '123456', description: '6-digit PIN' })
  @IsString()
  pin: string;
}
