import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, Min, ValidateNested } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ALL_PRODUCT_TYPES } from '../product-types';

export const PRODUCT_TYPES = ALL_PRODUCT_TYPES;
export const AVAILABILITY_STATUSES = ['Available', 'Unavailable', 'Draft', 'Archived'] as const;

export class ProductOptionInput {
  @IsString() name: string;
  @IsArray() @IsString({ each: true }) values: string[];
}

export class ProductVariantInput {
  @IsString() sku: string;
  @IsOptional() @IsString() barcode?: string;
  @IsOptional() @IsNumber() @Min(0) price?: number;
  @IsOptional() @IsString() imageUrl?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() optionValues?: Record<string, string>;
}

export class ProductNoteInput {
  @IsString() title: string;
  @IsOptional() @IsString() text?: string;
  @IsOptional() @IsString() iconUrl?: string;
}

export class CreateProductDto {
  @IsOptional() @IsIn(['FOOD', 'NON_FOOD']) commerceDomain?: 'FOOD' | 'NON_FOOD';
  @ApiProperty({ example: 'Polo Shirt' }) @IsString() name: string;
  @ApiPropertyOptional() @IsOptional() @IsString() description?: string;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => ProductNoteInput) notes?: ProductNoteInput[];
  @ApiPropertyOptional({ enum: PRODUCT_TYPES }) @IsOptional() @IsIn(PRODUCT_TYPES) productType?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() brand?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() categoryId?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() subCategoryId?: number | null;
  @ApiProperty({ example: 'Piece' }) @IsString() unit: string;
  @ApiProperty({ example: 499 }) @IsNumber() @Min(0) sellingPrice: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) costPrice?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) discountPrice?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() baseSku?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() barcode?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() imageUrl?: string;
  @IsBoolean() hasVariants: boolean;
  @IsBoolean() trackInventory: boolean;
  @IsIn(AVAILABILITY_STATUSES) availabilityStatus: string;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => ProductOptionInput) options?: ProductOptionInput[];
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => ProductVariantInput) variants?: ProductVariantInput[];

  // Legacy inputs remain accepted while older clients migrate.
  @IsOptional() @IsString() productCode?: string;
  @IsOptional() @IsString() sku?: string;
  @IsOptional() @IsNumber() @Min(0) price?: number;
  @IsOptional() @IsInt() @Min(0) quantity?: number;
  @IsOptional() @IsBoolean() isAvailable?: boolean;
  @IsOptional() @IsInt() @Min(0) lowStockThreshold?: number;
}
