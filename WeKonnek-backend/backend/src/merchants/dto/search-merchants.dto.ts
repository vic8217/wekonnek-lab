import { IsOptional, IsNumber, IsString, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class SearchMerchantsDto {
  @ApiPropertyOptional({ example: 'jollibee', description: 'Keyword search on name / description' })
  @IsString()
  @IsOptional()
  search?: string;

  @ApiPropertyOptional({ example: 'jollibee', description: 'Alias for search (frontend compat)' })
  @IsString()
  @IsOptional()
  q?: string;

  @ApiPropertyOptional({ example: 1, description: 'Filter by category ID' })
  @IsInt()
  @IsOptional()
  @Type(() => Number)
  categoryId?: number;

  @ApiPropertyOptional({ example: 3, description: 'Filter by sub-category ID' })
  @IsInt()
  @IsOptional()
  @Type(() => Number)
  subCategoryId?: number;

  @ApiPropertyOptional({ example: 'Manila', description: 'Filter by city name' })
  @IsString()
  @IsOptional()
  city?: string;

  @ApiPropertyOptional({ example: 14.5995, description: 'Center latitude for geo search' })
  @IsNumber()
  @IsOptional()
  @Type(() => Number)
  @Min(-90)
  @Max(90)
  latitude?: number;

  @ApiPropertyOptional({ example: 120.9742, description: 'Center longitude for geo search' })
  @IsNumber()
  @IsOptional()
  @Type(() => Number)
  @Min(-180)
  @Max(180)
  longitude?: number;

  @ApiPropertyOptional({ example: 5, description: 'Radius in kilometers (used with lat/lng)' })
  @IsNumber()
  @IsOptional()
  @Type(() => Number)
  @Min(0)
  radius?: number;

  @ApiPropertyOptional({ example: 1, default: 1, description: 'Page number' })
  @IsInt()
  @IsOptional()
  @Type(() => Number)
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ example: 20, default: 20, description: 'Results per page (max 100)' })
  @IsInt()
  @IsOptional()
  @Type(() => Number)
  @Min(1)
  @Max(100)
  limit?: number = 20;
}
