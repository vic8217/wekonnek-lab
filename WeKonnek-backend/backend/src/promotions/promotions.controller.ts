import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Req,
  UseGuards,
  ParseIntPipe,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { PromotionsService } from './promotions.service';
import { JwtAuthGuard } from '../modules/auth/guards/jwt-auth.guard';

@ApiTags('promotions')
@Controller('promotions')
export class PromotionsController {
  constructor(private readonly promotionsService: PromotionsService) {}

  // ─── Merchant Promotions (Discounts/Promos) ────────────
  // Static "merchant" routes MUST come before the `:id` param route

  @Get('merchant')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List merchant promotions (for discounts page)' })
  @ApiQuery({ name: 'filter', required: false })
  findMerchantPromotions(
    @Req() req: any,
    @Query('filter') filter?: string,
  ) {
    return this.promotionsService.findMerchantPromotions(req.user.id, filter);
  }

  @Get('merchant/:merchantId/active')
  @ApiOperation({ summary: 'List active customer-visible merchant promotions' })
  findActiveMerchantPromotions(
    @Param('merchantId', ParseIntPipe) merchantId: number,
  ) {
    return this.promotionsService.findActiveMerchantPromotions(merchantId);
  }

  @Post('merchant')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a merchant promotion' })
  createMerchantPromotion(@Req() req: any, @Body() body: any) {
    return this.promotionsService.createMerchantPromotion(req.user.id, body);
  }

  @Patch('merchant/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update a merchant promotion' })
  updateMerchantPromotion(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: any,
  ) {
    return this.promotionsService.updateMerchantPromotion(id, body);
  }

  @Delete('merchant/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete a merchant promotion' })
  deleteMerchantPromotion(@Param('id', ParseIntPipe) id: number) {
    return this.promotionsService.deleteMerchantPromotion(id);
  }

  // ─── Customer Promotions ("Looking For" ads) ───────────

  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a customer promotion / "Looking For" ad' })
  createCustomerPromotion(@Req() req: any, @Body() body: any) {
    return this.promotionsService.createCustomerPromotion(req.user.id, body);
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List customer promotions (own ads)' })
  @ApiQuery({ name: 'status', required: false })
  findCustomerPromotions(
    @Req() req: any,
    @Query('status') status?: string,
  ) {
    return this.promotionsService.findCustomerPromotions(req.user.id, status);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get a single customer promotion' })
  findOneCustomerPromotion(@Param('id', ParseIntPipe) id: number) {
    return this.promotionsService.findCustomerPromotionById(id);
  }
}
