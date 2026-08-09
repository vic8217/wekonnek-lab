import { Body, Controller, Get, Header, Param, ParseIntPipe, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../modules/auth/guards/jwt-auth.guard';
import { Roles, RolesGuard } from '../modules/auth/guards/roles.guard';
import { MerchantCategoriesService } from './merchant-categories.service';

@ApiTags('merchant-categories')
@Controller('merchant-categories')
export class MerchantCategoriesController {
  constructor(private readonly service: MerchantCategoriesService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'List merchant business categories and subcategories' })
  findAll() { return this.service.findAll(); }

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.admin, UserRole.staff)
  @ApiOperation({ summary: 'Create a merchant business category' })
  create(@Body() body: { name: string; description?: string; icon?: string }) { return this.service.create(body); }

  @Post(':categoryId/sub-categories')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.admin, UserRole.staff)
  @ApiOperation({ summary: 'Create a subcategory inside a merchant business category' })
  createSubCategory(
    @Param('categoryId', ParseIntPipe) categoryId: number,
    @Body() body: { name: string; groupName?: string },
  ) { return this.service.createSubCategory(categoryId, body); }

  @Get('slug/:slug')
  @Header('Cache-Control', 'no-store')
  findBySlug(@Param('slug') slug: string) { return this.service.findBySlug(slug); }

  @Get(':categoryId/sub-categories')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'List business subcategories for a merchant category' })
  findSubCategories(@Param('categoryId', ParseIntPipe) categoryId: number) { return this.service.findSubCategories(categoryId); }
}
