import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsDateString,
  IsArray,
  Min,
  IsInt,
} from 'class-validator';
import { DiscountType } from '@prisma/client';

export class CreateVoucherDto {
  @ApiProperty({ example: 'SAVE50' })
  @IsString()
  code: string;

  @ApiProperty({ example: '₱50 OFF on orders above ₱300' })
  @IsString()
  title: string;

  @ApiPropertyOptional({ example: 'Min. Spend ₱300' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ enum: DiscountType })
  @IsEnum(DiscountType)
  discountType: DiscountType;

  @ApiProperty({ example: 50 })
  @IsNumber()
  @Min(0)
  discountValue: number;

  @ApiPropertyOptional({ example: 200, description: 'Cap for percentage discounts' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  maxDiscountAmount?: number;

  @ApiPropertyOptional({ example: 300 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  minOrderAmount?: number;

  @ApiPropertyOptional({ example: ['food', 'mart'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  applicableOrderTypes?: string[];

  @ApiPropertyOptional({ description: 'Restrict to a specific store' })
  @IsOptional()
  @IsString()
  storeId?: string;

  @ApiPropertyOptional({ example: 100, description: '0 = unlimited' })
  @IsOptional()
  @IsInt()
  @Min(0)
  maxTotalUses?: number;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  maxUsesPerUser?: number;

  @ApiProperty({ example: '2026-03-19T00:00:00Z' })
  @IsDateString()
  startsAt: string;

  @ApiProperty({ example: '2026-04-30T23:59:59Z' })
  @IsDateString()
  expiresAt: string;
}
