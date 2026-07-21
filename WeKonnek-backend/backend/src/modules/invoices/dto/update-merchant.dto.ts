import { IsString, IsOptional, IsBoolean, IsNumber, IsEmail } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateBillingProfileDto {
  @ApiPropertyOptional({ description: 'Registered business name (SEC/DTI)' })
  @IsOptional()
  @IsString()
  businessName?: string;

  @ApiPropertyOptional({ description: 'Trade name / DBA' })
  @IsOptional()
  @IsString()
  tradeName?: string;

  @ApiPropertyOptional({ description: 'BIR TIN (e.g., 123-456-789-000)' })
  @IsOptional()
  @IsString()
  tin?: string;

  @ApiPropertyOptional({ description: 'BIR-registered business address' })
  @IsOptional()
  @IsString()
  businessAddress?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  city?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  zipCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  website?: string;

  @ApiPropertyOptional({ description: 'VAT registered?' })
  @IsOptional()
  @IsBoolean()
  isVatRegistered?: boolean;

  @ApiPropertyOptional({ description: 'VAT rate (default 12%)' })
  @IsOptional()
  @IsNumber()
  vatRate?: number;

  @ApiPropertyOptional({ description: 'BIR Authority to Print number' })
  @IsOptional()
  @IsString()
  birPermitNumber?: string;

  @ApiPropertyOptional({ description: 'BIR permit date' })
  @IsOptional()
  @IsString()
  birPermitDate?: string;

  @ApiPropertyOptional({ description: 'Revenue District Office code' })
  @IsOptional()
  @IsString()
  rdoCode?: string;

  @ApiPropertyOptional({ description: 'Invoice serial prefix (e.g., WHP)' })
  @IsOptional()
  @IsString()
  invoicePrefix?: string;

  @ApiPropertyOptional({ description: 'Logo URL for PDF receipts' })
  @IsOptional()
  @IsString()
  logoUrl?: string;

  @ApiPropertyOptional({ description: 'Footer text on receipts' })
  @IsOptional()
  @IsString()
  receiptFooter?: string;

  @ApiPropertyOptional({ description: 'Terms and conditions text' })
  @IsOptional()
  @IsString()
  termsAndConditions?: string;
}
