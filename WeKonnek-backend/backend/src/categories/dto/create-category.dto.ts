import { IsString, IsNotEmpty, IsOptional, IsBoolean, IsInt, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateCategoryDto {
  @ApiProperty({ example: 'Food & Beverage', description: 'Category name' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ example: 'food-beverage', description: 'URL-friendly slug (unique)' })
  @IsString()
  @IsNotEmpty()
  slug: string;

  @ApiPropertyOptional({ example: 'Restaurants, cafes, and food stalls' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({ example: '🍔', description: 'Icon emoji or URL' })
  @IsString()
  @IsOptional()
  icon?: string;

  @ApiPropertyOptional({ default: true })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @ApiPropertyOptional({ example: 0, description: 'Display order (ascending)' })
  @IsInt()
  @Min(0)
  @IsOptional()
  displayOrder?: number;
}
