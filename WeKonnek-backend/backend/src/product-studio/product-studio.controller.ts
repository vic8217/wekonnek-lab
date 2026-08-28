import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../modules/auth/guards/jwt-auth.guard';
import { MerchantsService } from '../merchants/merchants.service';
import { ProductStudioService } from './product-studio.service';

@Controller('product-studio')
@UseGuards(JwtAuthGuard)
export class ProductStudioController {
  constructor(private readonly service: ProductStudioService, private readonly merchants: MerchantsService) {}

  private async merchantId(req: any) {
    const merchant = await this.merchants.findByUserId(req.user.id);
    if (!merchant) throw new Error('No merchant profile is linked to this account');
    return merchant.id;
  }

  @Get('mine') findMine(@Req() req: any) { return this.merchantId(req).then((merchantId) => this.service.findMine(merchantId)); }
  @Post('generations') create(@Req() req: any, @Body() body: { productId: number; categoryId: number; originalMediaId: string; style: string }) { return this.merchantId(req).then((merchantId) => this.service.create(merchantId, body)); }
  @Patch('generations/:id/approve') approve(@Req() req: any, @Param('id') id: string) { return this.merchantId(req).then((merchantId) => this.service.approve(merchantId, id)); }
}
