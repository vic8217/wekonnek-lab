import {
  Controller,
  Get,
  UseGuards,
  Req,
  ForbiddenException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ProductsService } from './products.service';
import { JwtAuthGuard } from '../modules/auth/guards/jwt-auth.guard';
import { MerchantsService } from '../merchants/merchants.service';

@ApiTags('inventory')
@Controller('inventory')
export class InventoryController {
  constructor(
    private readonly productsService: ProductsService,
    private readonly merchantsService: MerchantsService,
  ) {}

  @Get('low-stock')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get all low-stock products for the authenticated merchant' })
  async getLowStock(@Req() req: any) {
    const merchant = await this.merchantsService.findByUserId(req.user.id);
    if (!merchant) {
      throw new ForbiddenException('No merchant profile is linked to this account');
    }
    return this.productsService.findLowStock((merchant as any).id);
  }
}
