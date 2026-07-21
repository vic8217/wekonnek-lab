import { IsString, IsNumber, IsBoolean, IsOptional, IsInt, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateProductDto {
  @ApiProperty({ example: 'Chickenjoy 1-pc', description: 'Product name' })
  @IsString()
  name: string;

  @ApiPropertyOptional({ example: 'Crispy fried chicken with gravy and rice' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ example: 'CJ-001', description: 'Product code (unique per merchant)' })
  @IsString()
  productCode: string;

  @ApiPropertyOptional({ example: 'SKU-CJ001' })
  @IsOptional()
  @IsString()
  sku?: string;

  @ApiProperty({ example: 89.00, description: 'Product price in PHP' })
  @IsNumber()
  @Min(0)
  price: number;

  @ApiProperty({ example: 100, description: 'Available stock quantity' })
  @IsInt()
  @Min(0)
  quantity: number;

  @ApiPropertyOptional({ example: 'https://example.com/chickenjoy.jpg' })
  @IsOptional()
  @IsString()
  imageUrl?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isAvailable?: boolean;

  @ApiPropertyOptional({ example: 10, description: 'Low-stock alert threshold' })
  @IsOptional()
  @IsInt()
  @Min(0)
  lowStockThreshold?: number;

  @ApiProperty({ example: 1, description: 'Category ID' })
  @IsInt()
  categoryId: number;

  @ApiPropertyOptional({ example: 3, description: 'Sub-category ID (optional — some categories have no sub-categories)' })
  @IsOptional()
  @IsInt()
  subCategoryId?: number;
}
