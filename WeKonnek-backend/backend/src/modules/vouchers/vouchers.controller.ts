import {
  Controller,
  Get,
  Post,
  Put,
  Param,
  Body,
  Query,
  UseGuards,
  Req,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { VouchersService } from './vouchers.service';
import { CreateVoucherDto } from './dto/create-voucher.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { VoucherStatus } from '@prisma/client';

@ApiTags('Vouchers')
@Controller('vouchers')
export class VouchersController {
  constructor(private readonly vouchersService: VouchersService) {}

  // ═══════════════════════════════════════════════════
  //  ADMIN ENDPOINTS
  // ═══════════════════════════════════════════════════

  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a new voucher (Admin)' })
  create(@Body() dto: CreateVoucherDto) {
    return this.vouchersService.create(dto);
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List all vouchers (Admin)' })
  @ApiQuery({ name: 'status', required: false, enum: VoucherStatus })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'offset', required: false })
  findAll(
    @Query('status') status?: VoucherStatus,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.vouchersService.findAll({
      status,
      limit: limit ? parseInt(limit) : undefined,
      offset: offset ? parseInt(offset) : undefined,
    });
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get voucher by ID' })
  findOne(@Param('id') id: string) {
    return this.vouchersService.findById(id);
  }

  @Put(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update voucher (Admin)' })
  update(@Param('id') id: string, @Body() data: Partial<CreateVoucherDto>) {
    return this.vouchersService.update(id, data as any);
  }

  @Put(':id/disable')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Disable a voucher (Admin)' })
  disable(@Param('id') id: string) {
    return this.vouchersService.disable(id);
  }

  @Get(':id/redemptions')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get redemption history for a voucher (Admin)' })
  getRedemptions(@Param('id') id: string) {
    return this.vouchersService.getRedemptionsByVoucher(id);
  }

  // ═══════════════════════════════════════════════════
  //  CUSTOMER ENDPOINTS
  // ═══════════════════════════════════════════════════

  @Get('customer/available')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List vouchers available for the current customer' })
  getAvailable(@Req() req: any) {
    return this.vouchersService.findAvailableForCustomer(req.user.id);
  }

  @Post('customer/claim')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Add a voucher to the current customer wallet' })
  claim(@Req() req: any, @Body() body: { code: string }) {
    return this.vouchersService.claim(body.code, req.user.id);
  }

  @Post('validate')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Validate a voucher code before checkout' })
  async validate(
    @Req() req: any,
    @Body()
    body: {
      code: string;
      orderSubtotal: number;
      orderType?: string;
      storeId?: string;
    },
  ) {
    const result = await this.vouchersService.validate(
      body.code,
      req.user.id,
      body.orderSubtotal,
      body.orderType,
      body.storeId,
    );

    if (!result.valid) {
      return { valid: false, reason: result.reason };
    }

    const voucher = result.voucher!;
    return {
      valid: true,
      voucherId: voucher.id,
      code: voucher.code,
      title: voucher.title,
      discountType: voucher.discountType,
      discountValue: voucher.discountValue,
      discountAmount: result.discountAmount,
    };
  }
}
