import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  UseGuards,
  Req,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { LoyaltyService } from './loyalty.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('Loyalty')
@Controller('loyalty')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class LoyaltyController {
  constructor(private readonly loyaltyService: LoyaltyService) {}

  @Get('balance')
  @ApiOperation({ summary: 'Get loyalty points balance and tier' })
  getBalance(@Req() req: any) {
    return this.loyaltyService.getBalance(req.user.id);
  }

  @Get('history')
  @ApiOperation({ summary: 'Get points transaction history' })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'offset', required: false })
  getHistory(
    @Req() req: any,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.loyaltyService.getTransactionHistory(
      req.user.id,
      limit ? parseInt(limit) : 20,
      offset ? parseInt(offset) : 0,
    );
  }

  @Post('redeem')
  @ApiOperation({ summary: 'Redeem points for a peso discount' })
  redeem(
    @Req() req: any,
    @Body() body: { points: number; orderId?: string },
  ) {
    return this.loyaltyService.redeemPoints(
      req.user.id,
      body.points,
      body.orderId,
    );
  }

  @Post('bonus')
  @ApiOperation({ summary: 'Award bonus points to a user (Admin)' })
  addBonus(@Body() body: { userId: string; points: number; description: string }) {
    return this.loyaltyService.addBonusPoints(
      body.userId,
      body.points,
      body.description,
    );
  }
}
