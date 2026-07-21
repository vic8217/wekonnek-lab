import { IsString, IsNotEmpty, IsOptional, IsBoolean, IsInt, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateSubCategoryDto {
  @ApiProperty({ example: 1, description: 'Parent category ID' })
  @IsInt()
  @IsNotEmpty()
  categoryId: number;

  @ApiProperty({ example: 'Fast Food', description: 'Sub-category name' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ example: 'fast-food', description: 'URL-friendly slug (unique within category)' })
  @IsString()
  @IsNotEmpty()
  slug: string;

  @ApiPropertyOptional({ example: 'Quick service restaurants' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({ example: '🍟', description: 'Emoji or icon URL' })
  @IsString()
  @IsOptional()
  icon?: string;

  @ApiPropertyOptional({ example: 'Electronics', description: 'Optional UI grouping label (e.g. Electronics, Fashion, Household)' })
  @IsString()
  @IsOptional()
  groupName?: string;

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
