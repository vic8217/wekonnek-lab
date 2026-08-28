import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Put,
  Param,
  Delete,
  Query,
  UseGuards,
  Req,
  Res,
  ForbiddenException,
  BadRequestException,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery, ApiConsumes } from '@nestjs/swagger';
import type { Response } from 'express';
import { ProductsService } from './products.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { JwtAuthGuard } from '../modules/auth/guards/jwt-auth.guard';
import { MerchantsService } from '../merchants/merchants.service';

@ApiTags('products')
@Controller('products')
export class ProductsController {
  constructor(
    private readonly productsService: ProductsService,
    private readonly merchantsService: MerchantsService,
  ) {}

  /** Resolve the merchant owned by the authenticated user. */
  private async resolveMerchantId(req: any): Promise<number> {
    const merchant = await this.merchantsService.findByUserId(req.user.id);
    if (!merchant) {
      throw new ForbiddenException('No merchant profile is linked to this account');
    }
    return (merchant as any).id;
  }

  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a product for the authenticated merchant' })
  async create(@Body() createProductDto: CreateProductDto, @Req() req: any) {
    const merchantId = await this.resolveMerchantId(req);
    return this.productsService.create(createProductDto, merchantId);
  }

  @Get()
  @ApiOperation({ summary: 'Get all products (optionally filtered by merchant)' })
  @ApiQuery({ name: 'merchantId', required: false })
  @ApiQuery({ name: 'available', required: false })
  findAll(
    @Query('merchantId') merchantId?: string,
    @Query('available') available?: string,
    @Query('search') search?: string,
    @Query('productType') productType?: string,
    @Query('categoryId') categoryId?: string,
    @Query('brand') brand?: string,
    @Query('hasVariants') hasVariants?: string,
    @Query('trackInventory') trackInventory?: string,
    @Query('availabilityStatus') availabilityStatus?: string,
    @Query('shopId') shopId?: string,
  ) {
    if (shopId) {
      if (!merchantId) throw new BadRequestException('merchantId is required when selecting a shop');
      return this.productsService.findForShop(Number(merchantId), Number(shopId));
    }
    return this.productsService.findAll(
      merchantId ? Number(merchantId) : undefined,
      available === 'true',
      { search, productType, categoryId, brand, hasVariants, trackInventory, availabilityStatus },
    );
  }

  @Get('merchant/mine')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get products for the authenticated merchant' })
  async findMine(@Req() req: any) {
    return this.productsService.findAll(await this.resolveMerchantId(req));
  }

  @Get('export')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Export merchant products as CSV' })
  async exportCsv(@Req() req: any, @Res() res: Response) {
    const merchantId = await this.resolveMerchantId(req);
    const products = await this.productsService.findAll(merchantId);

    const headers = ['name', 'description', 'brand', 'category', 'subcategory', 'unit', 'sellingPrice', 'costPrice', 'discountPrice', 'baseSku', 'barcode', 'hasVariants', 'optionName', 'optionValues', 'variantSkus', 'variantPrices', 'trackInventory', 'availabilityStatus'];
    const escCsv = (val: any) => {
      if (val == null) return '';
      const s = String(val);
      return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const rows = products.map((p: any) => {
      const option = p.options?.[0];
      const valueByVariant = (p.variants || []).map((variant: any) => variant.optionValues?.[0]?.optionValue?.value || '');
      return headers.map((h) => escCsv(
        h === 'category' ? p.category?.name
          : h === 'subcategory' ? p.subCategory?.name
            : h === 'optionName' ? option?.name
              : h === 'optionValues' ? (valueByVariant.length ? valueByVariant : option?.values?.map((value: any) => value.value) || []).join('|')
                : h === 'variantSkus' ? (p.variants || []).map((variant: any) => variant.sku).join('|')
                  : h === 'variantPrices' ? (p.variants || []).map((variant: any) => variant.price ?? '').join('|')
                    : p[h],
      )).join(',');
    });
    const csv = [headers.join(','), ...rows].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=products.csv');
    res.send(csv);
  }

  @Post('import')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Bulk import products from CSV' })
  async importCsv(@UploadedFile() file: any, @Req() req: any) {
    if (!file) throw new BadRequestException('CSV file is required');
    const merchantId = await this.resolveMerchantId(req);

    const content = file.buffer.toString('utf-8');
    const lines = content.split(/\r?\n/).filter((l: string) => l.trim());
    if (lines.length < 2) throw new BadRequestException('CSV must have a header row and at least one data row');

    const headerLine = lines[0];
    const headers = this.parseCsvLine(headerLine).map((h: string) => h.trim());

    const requiredFields = ['name', 'unit', 'sellingPrice', 'availabilityStatus'];
    for (const f of requiredFields) {
      if (!headers.includes(f)) {
        throw new BadRequestException(`Missing required column: ${f}`);
      }
    }

    const results = { created: 0, errors: [] as string[] };

    for (let i = 1; i < lines.length; i++) {
      try {
        const values = this.parseCsvLine(lines[i]);
        const row: any = {};
        headers.forEach((h: string, idx: number) => { row[h] = values[idx]?.trim() ?? ''; });

        if (!row.name) {
          results.errors.push(`Row ${i + 1}: name is required`);
          continue;
        }

        const categoryIds = row.category || row.subcategory
          ? await this.productsService.resolveCategoryIds(row.category, row.subcategory)
          : {
              categoryId: row.categoryId ? parseInt(row.categoryId) : undefined,
              subCategoryId: row.subCategoryId ? parseInt(row.subCategoryId) : undefined,
            };
        const hasVariants = row.hasVariants === 'true';
        let options: Array<{ name: string; values: string[] }> = [];
        let variants: Array<{ sku: string; price?: number; isActive: boolean; optionValues: Record<string, string> }> = [];
        if (hasVariants) {
          const optionName = String(row.optionName || '').trim();
          const optionValues = String(row.optionValues || '').split('|').map((value: string) => value.trim()).filter(Boolean);
          const variantSkus = String(row.variantSkus || '').split('|').map((value: string) => value.trim()).filter(Boolean);
          const variantPrices = String(row.variantPrices || '').split('|').map((value: string) => value.trim());
          if (!optionName || optionValues.length < 1 || variantSkus.length !== optionValues.length) {
            throw new BadRequestException('Variant rows require optionName and matching optionValues and variantSkus separated by |');
          }
          if (new Set(variantSkus).size !== variantSkus.length) throw new BadRequestException('Variant SKUs must be unique');
          options = [{ name: optionName, values: optionValues }];
          variants = optionValues.map((value: string, index: number) => ({
            sku: variantSkus[index],
            price: variantPrices[index] ? Number(variantPrices[index]) : undefined,
            isActive: true,
            optionValues: { [optionName]: value },
          }));
          if (variants.some(variant => variant.price !== undefined && (!Number.isFinite(variant.price) || variant.price < 0))) {
            throw new BadRequestException('Variant prices must be valid positive numbers');
          }
        }
        await this.productsService.create(
          {
            name: row.name,
            description: row.description || undefined,
            brand: row.brand || undefined,
            unit: row.unit,
            sellingPrice: parseFloat(row.sellingPrice) || 0,
            costPrice: row.costPrice ? parseFloat(row.costPrice) : undefined,
            discountPrice: row.discountPrice ? parseFloat(row.discountPrice) : undefined,
            baseSku: row.baseSku || undefined,
            barcode: row.barcode || undefined,
            hasVariants,
            trackInventory: row.trackInventory === 'true',
            availabilityStatus: row.availabilityStatus,
            options,
            variants,
            ...categoryIds,
          },
          merchantId,
        );
        results.created++;
      } catch (err: any) {
        results.errors.push(`Row ${i + 1}: ${err.message || 'Unknown error'}`);
      }
    }

    return results;
  }

  private parseCsvLine(line: string): string[] {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (inQuotes) {
        if (char === '"' && line[i + 1] === '"') {
          current += '"';
          i++;
        } else if (char === '"') {
          inQuotes = false;
        } else {
          current += char;
        }
      } else {
        if (char === '"') {
          inQuotes = true;
        } else if (char === ',') {
          result.push(current);
          current = '';
        } else {
          current += char;
        }
      }
    }
    result.push(current);
    return result;
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get product by ID' })
  findOne(@Param('id') id: string) {
    return this.productsService.findOne(+id);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update a product' })
  async update(
    @Param('id') id: string,
    @Body() updateProductDto: UpdateProductDto,
    @Req() req: any,
  ) {
    const merchantId = await this.resolveMerchantId(req);
    return this.productsService.update(+id, updateProductDto, merchantId);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete a product' })
  async remove(@Param('id') id: string, @Req() req: any) {
    const merchantId = await this.resolveMerchantId(req);
    return this.productsService.remove(+id, merchantId);
  }

  @Get(':id/categories')
  @ApiOperation({ summary: 'Get category assignments for a product' })
  getCategories(@Param('id') id: string) {
    return this.productsService.getCategories(+id);
  }

  @Put(':id/categories')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Replace category assignments for a product' })
  async syncCategories(
    @Param('id') id: string,
    @Body()
    body: {
      assignments: Array<{
        categoryId: number;
        subCategoryId?: number | null;
        isPrimary?: boolean;
      }>;
    },
    @Req() req: any,
  ) {
    const merchantId = await this.resolveMerchantId(req);
    return this.productsService.syncCategories(
      +id,
      merchantId,
      body?.assignments || [],
    );
  }
}
