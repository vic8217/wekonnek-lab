import { Body, Controller, ForbiddenException, Get, Param, ParseIntPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../modules/auth/guards/jwt-auth.guard';
import { MerchantsService } from '../merchants/merchants.service';
import { ProductsService } from './products.service';
import { ShopInventoryService } from './shop-inventory.service';
import { AssignShopProductDto, CreateInventoryMovementDto, TransferInventoryDto, UpdateReorderLevelDto } from './dto/shop-inventory.dto';

@ApiTags('inventory')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('inventory')
export class InventoryController {
  constructor(
    private readonly productsService: ProductsService,
    private readonly shopInventory: ShopInventoryService,
    private readonly merchantsService: MerchantsService,
  ) {}

  private async context(req: any, requestedShopId?: number) {
    const merchantId = req.user.merchantId || (await this.merchantsService.findByUserId(req.user.id) as any)?.id;
    if (!merchantId) throw new ForbiddenException('No merchant profile is linked to this account');
    const shopId = req.user.portal === 'shop' ? req.user.branchId : requestedShopId;
    if (!shopId) throw new ForbiddenException('A shop must be selected');
    await this.shopInventory.assertShop(Number(merchantId), Number(shopId));
    return { merchantId: Number(merchantId), shopId: Number(shopId) };
  }

  private async merchantId(req: any) {
    const merchantId = req.user.merchantId || (await this.merchantsService.findByUserId(req.user.id) as any)?.id;
    if (!merchantId) throw new ForbiddenException('No merchant profile is linked to this account');
    if (req.user.portal === 'shop') throw new ForbiddenException('Merchant-wide inventory is only available in the merchant portal');
    return Number(merchantId);
  }

  @Get('summary')
  @ApiOperation({ summary: 'Get inventory totals and per-shop balances for the authenticated merchant' })
  async summary(@Req() req: any) {
    return this.shopInventory.merchantSummary(await this.merchantId(req));
  }

  @Get()
  @ApiOperation({ summary: 'Get product assignments and balances for one shop' })
  async list(@Req() req: any, @Query('shopId') shopId?: string) {
    const scope = await this.context(req, shopId ? Number(shopId) : undefined);
    return this.shopInventory.list(scope.merchantId, scope.shopId);
  }

  @Patch('products/:productId')
  @ApiOperation({ summary: 'Assign, enable, disable, or override a merchant product for one shop' })
  async assign(@Req() req: any, @Param('productId', ParseIntPipe) productId: number, @Body() body: AssignShopProductDto, @Query('shopId') shopId?: string) {
    const scope = await this.context(req, shopId ? Number(shopId) : undefined);
    return this.shopInventory.assign(scope.merchantId, scope.shopId, productId, body.isEnabled, body.priceOverride);
  }

  @Get('products')
  @ApiOperation({ summary: 'Get the merchant catalogue and assignments for one shop' })
  async products(@Req() req: any, @Query('shopId') shopId?: string) {
    const scope = await this.context(req, shopId ? Number(shopId) : undefined);
    return this.shopInventory.shopProducts(scope.merchantId, scope.shopId);
  }

  @Patch('reorder-level')
  @ApiOperation({ summary: 'Set a shop-specific reorder level' })
  async reorderLevel(@Req() req: any, @Body() body: UpdateReorderLevelDto, @Query('shopId') shopId?: string) {
    const scope = await this.context(req, shopId ? Number(shopId) : undefined);
    return this.shopInventory.setReorderLevel(scope.merchantId, scope.shopId, body);
  }

  @Post('movements')
  @ApiOperation({ summary: 'Record a receipt, sale, return, or adjustment in one shop' })
  async move(@Req() req: any, @Body() body: CreateInventoryMovementDto, @Query('shopId') shopId?: string) {
    const scope = await this.context(req, shopId ? Number(shopId) : undefined);
    return this.shopInventory.move(scope.merchantId, scope.shopId, body, req.user.id);
  }

  @Get('movements')
  @ApiOperation({ summary: 'Get the inventory movement ledger for one shop' })
  async movements(@Req() req: any, @Query('shopId') shopId?: string, @Query('productId') productId?: string) {
    const scope = await this.context(req, shopId ? Number(shopId) : undefined);
    return this.shopInventory.movements(scope.merchantId, scope.shopId, productId ? Number(productId) : undefined);
  }

  @Post('transfers')
  @ApiOperation({ summary: 'Transfer stock between two shops owned by the merchant' })
  async transfer(@Req() req: any, @Body() body: TransferInventoryDto, @Query('shopId') shopId?: string) {
    const scope = await this.context(req, shopId ? Number(shopId) : undefined);
    return this.shopInventory.transfer(scope.merchantId, scope.shopId, body, req.user.id);
  }

  @Get('low-stock')
  @ApiOperation({ summary: 'Get low-stock balances for one selected shop' })
  async getLowStock(@Req() req: any, @Query('shopId') shopId?: string) {
    const scope = await this.context(req, shopId ? Number(shopId) : undefined);
    return this.productsService.findLowStock(scope.merchantId, scope.shopId);
  }
}
