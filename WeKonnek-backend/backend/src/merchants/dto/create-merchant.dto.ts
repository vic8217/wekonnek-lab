import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsBoolean,
  IsEnum,
  IsNumber,
  IsEmail,
  IsUrl,
  IsIn,
  Min,
  Max,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
export enum BusinessType {
  STOREFRONT = 'storefront',
  MOBILE_CART = 'mobile_cart',
  HOME_BASED = 'home_based',
}

export class CreateMerchantDto {
  @ApiProperty({ example: 'Jollibee Binondo', description: 'Merchant display name' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ example: 'jollibee-binondo', description: 'URL-friendly slug (unique)' })
  @IsString()
  @IsNotEmpty()
  slug: string;

  @ApiPropertyOptional({ example: 'Your favorite Chickenjoy at Binondo branch' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({ example: 1, description: 'Parent category ID' })
  @IsNumber()
  @IsOptional()
  categoryId?: number;

  @ApiPropertyOptional({ example: 3, description: 'Sub-category ID' })
  @IsNumber()
  @IsOptional()
  subCategoryId?: number;

  @ApiProperty({ enum: BusinessType, example: BusinessType.STOREFRONT, description: 'Type of business' })
  @IsEnum(BusinessType)
  businessType: BusinessType;

  @ApiPropertyOptional({ example: '+639171234567' })
  @IsString()
  @IsOptional()
  phone?: string;

  @ApiPropertyOptional({ example: 'store@jollibee.com.ph' })
  @IsEmail()
  @IsOptional()
  email?: string;

  @ApiPropertyOptional({ example: 'https://jollibee.com.ph' })
  @IsUrl()
  @IsOptional()
  website?: string;

  @ApiPropertyOptional({ example: '123 Ongpin St, Binondo, Manila' })
  @IsString()
  @IsOptional()
  address?: string;

  @ApiPropertyOptional({ example: 14.5995, description: 'Latitude (-90 to 90)' })
  @IsNumber()
  @IsOptional()
  @Min(-90)
  @Max(90)
  latitude?: number;

  @ApiPropertyOptional({ example: 120.9742, description: 'Longitude (-180 to 180)' })
  @IsNumber()
  @IsOptional()
  @Min(-180)
  @Max(180)
  longitude?: number;

  @ApiPropertyOptional({ example: 'Manila' })
  @IsString()
  @IsOptional()
  city?: string;

  @IsString() @IsOptional() region?: string;
  @IsString() @IsOptional() councilDistrict?: string;
  @IsString() @IsOptional() geographicArea?: string;

  @ApiPropertyOptional({ example: 'Metro Manila' })
  @IsString()
  @IsOptional()
  state?: string;

  @ApiPropertyOptional({ example: '1006' })
  @IsString()
  @IsOptional()
  zipCode?: string;

  @ApiPropertyOptional({ example: 'Philippines' })
  @IsString()
  @IsOptional()
  country?: string;

  @ApiPropertyOptional({ example: 'https://example.com/logo.png' })
  @IsUrl()
  @IsOptional()
  logoUrl?: string;

  @ApiPropertyOptional({ example: 'https://example.com/cover.jpg' })
  @IsUrl()
  @IsOptional()
  coverImageUrl?: string;

  @ApiPropertyOptional({ default: true })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @ApiPropertyOptional({ default: false })
  @IsBoolean()
  @IsOptional()
  isVerified?: boolean;

  @ApiPropertyOptional({
    example: 'non_vat_percentage_tax',
    description: 'Business tax classification used for invoicing',
  })
  @IsString()
  @IsIn([
    '',
    'vat_registered',
    'non_vat_percentage_tax',
    'vat_exempt',
    'zero_rated_vat',
    'government_entity',
    'boi_peza_registered',
  ])
  @IsOptional()
  taxClassification?: string;

  @ApiPropertyOptional({ description: 'Tax Identification Number' })
  @IsString()
  @IsOptional()
  tin?: string;

  @ApiPropertyOptional({ description: 'BIR-registered business name' })
  @IsString()
  @IsOptional()
  registeredBusinessName?: string;
}
