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
import { ApiTags, ApiOperation, ApiQuery, ApiParam } from '@nestjs/swagger';
import { CategoriesService } from './categories.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { JwtAuthGuard } from '../modules/auth/guards/jwt-auth.guard';
import { MerchantsService } from '../merchants/merchants.service';

@ApiTags('categories')
@Controller('categories')
export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService, private readonly merchantsService: MerchantsService) {}

  private async merchantId(req: any) {
    const merchant = await this.merchantsService.findByUserId(req.user.id);
    if (!merchant) throw new ForbiddenException('No merchant profile is linked to this account');
    return (merchant as any).id as number;
  }

  @Get('merchant/mine')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Get categories available to the authenticated merchant' })
  async findMine(@Req() req: any) {
    return this.categoriesService.findForMerchant(await this.merchantId(req));
  }

  @Post('merchant/mine')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Create a custom category for the authenticated merchant' })
  async createMine(@Req() req: any, @Body() body: { name: string }) {
    return this.categoriesService.createForMerchant(await this.merchantId(req), body.name);
  }

  @Post()
  @ApiOperation({ summary: 'Create a new category' })
  create(@Body() createCategoryDto: CreateCategoryDto) {
    return this.categoriesService.create(createCategoryDto);
  }

  @Get()
  @ApiOperation({ summary: 'Get all categories' })
  @ApiQuery({ name: 'includeInactive', required: false, type: Boolean, description: 'Include inactive categories' })
  findAll(
    @Query('includeInactive', new DefaultValuePipe(false), ParseBoolPipe)
    includeInactive: boolean,
  ) {
    return this.categoriesService.findAll(includeInactive);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get category by ID' })
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.categoriesService.findOne(id);
  }

  @Get('slug/:slug')
  @ApiOperation({ summary: 'Get category by slug' })
  findBySlug(@Param('slug') slug: string) {
    return this.categoriesService.findBySlug(slug);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a category' })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateCategoryDto: UpdateCategoryDto,
  ) {
    return this.categoriesService.update(id, updateCategoryDto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a category' })
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.categoriesService.remove(id);
  }
}
