import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  ParseIntPipe,
  ParseBoolPipe,
  DefaultValuePipe,
  Req,
  UseGuards,
  ForbiddenException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { SubCategoriesService } from './sub-categories.service';
import { CreateSubCategoryDto } from './dto/create-sub-category.dto';
import { UpdateSubCategoryDto } from './dto/update-sub-category.dto';
import { JwtAuthGuard } from '../modules/auth/guards/jwt-auth.guard';
import { MerchantsService } from '../merchants/merchants.service';

@ApiTags('sub-categories')
@Controller('sub-categories')
export class SubCategoriesController {
  constructor(private readonly subCategoriesService: SubCategoriesService, private readonly merchantsService: MerchantsService) {}

  private async merchantId(req: any) {
    const merchant = await this.merchantsService.findByUserId(req.user.id);
    if (!merchant) throw new ForbiddenException('No merchant profile is linked to this account');
    return (merchant as any).id as number;
  }

  @Get('merchant/category/:categoryId')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Get subcategories available to the authenticated merchant' })
  async findMineByCategory(@Req() req: any, @Param('categoryId', ParseIntPipe) categoryId: number) {
    return this.subCategoriesService.findForMerchantCategory(await this.merchantId(req), categoryId);
  }

  @Post('merchant/mine')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Create a custom subcategory for the authenticated merchant' })
  async createMine(@Req() req: any, @Body() body: { categoryId: number; name: string }) {
    return this.subCategoriesService.createForMerchant(await this.merchantId(req), Number(body.categoryId), body.name);
  }

  @Post()
  @ApiOperation({ summary: 'Create a new sub-category' })
  create(@Body() createSubCategoryDto: CreateSubCategoryDto) {
    return this.subCategoriesService.create(createSubCategoryDto);
  }

  @Get()
  @ApiOperation({ summary: 'Get all sub-categories' })
  @ApiQuery({ name: 'includeInactive', required: false, type: Boolean })
  findAll(
    @Query('includeInactive', new DefaultValuePipe(false), ParseBoolPipe)
    includeInactive: boolean,
  ) {
    return this.subCategoriesService.findAll(includeInactive);
  }

  @Get('category/:categoryId')
  @ApiOperation({ summary: 'Get sub-categories by parent category ID' })
  @ApiQuery({ name: 'includeInactive', required: false, type: Boolean })
  findByCategory(
    @Param('categoryId', ParseIntPipe) categoryId: number,
    @Query('includeInactive', new DefaultValuePipe(false), ParseBoolPipe)
    includeInactive: boolean,
  ) {
    return this.subCategoriesService.findByCategory(categoryId, includeInactive);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get sub-category by ID' })
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.subCategoriesService.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a sub-category' })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateSubCategoryDto: UpdateSubCategoryDto,
  ) {
    return this.subCategoriesService.update(id, updateSubCategoryDto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a sub-category' })
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.subCategoriesService.remove(id);
  }
}
