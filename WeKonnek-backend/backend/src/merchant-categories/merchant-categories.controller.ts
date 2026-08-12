import { BadRequestException, Body, Controller, Get, Header, Param, ParseIntPipe, Post, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
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

  @Post('import')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.admin, UserRole.staff)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 2 * 1024 * 1024 } }))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Import merchant categories and subcategories from CSV' })
  importCsv(@UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new BadRequestException('CSV file is required');
    if (!file.originalname.toLowerCase().endsWith('.csv')) throw new BadRequestException('Only CSV files are supported');
    return this.service.importCsv(file.buffer.toString('utf8'));
  }

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
