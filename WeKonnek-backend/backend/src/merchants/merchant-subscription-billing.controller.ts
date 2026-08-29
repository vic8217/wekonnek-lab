import { Controller, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../modules/auth/guards/jwt-auth.guard';
import { Roles, RolesGuard } from '../modules/auth/guards/roles.guard';
import { MerchantSubscriptionBillingService } from './merchant-subscription-billing.service';

@ApiTags('subscriptions')
@Controller('admin/subscriptions')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class MerchantSubscriptionBillingController {
  constructor(private readonly billing: MerchantSubscriptionBillingService) {}

  @Post('run-daily-billing')
  @Roles(UserRole.admin)
  @ApiOperation({
    summary: "Run today's merchant subscription billing (idempotent)",
  })
  runDailyBilling() {
    return this.billing.runDailyBilling();
  }
}
