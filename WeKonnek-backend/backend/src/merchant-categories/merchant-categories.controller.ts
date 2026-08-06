import { Controller, Get, Param, ParseIntPipe } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { MerchantCategoriesService } from './merchant-categories.service';

@ApiTags('merchant-categories')
@Controller('merchant-categories')
export class MerchantCategoriesController {
  constructor(private readonly service: MerchantCategoriesService) {}

  @Get()
  @ApiOperation({ summary: 'List merchant business categories and subcategories' })
  findAll() { return this.service.findAll(); }

  @Get('slug/:slug')
  findBySlug(@Param('slug') slug: string) { return this.service.findBySlug(slug); }

  @Get(':categoryId/sub-categories')
  @ApiOperation({ summary: 'List business subcategories for a merchant category' })
  findSubCategories(@Param('categoryId', ParseIntPipe) categoryId: number) { return this.service.findSubCategories(categoryId); }
}
