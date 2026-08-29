import { Module } from '@nestjs/common';
import { TrustTradeEligibilityService } from './trust-trade-eligibility.service';
import { TrustTradeService } from './trust-trade.service';

@Module({ providers: [TrustTradeEligibilityService, TrustTradeService], exports: [TrustTradeEligibilityService, TrustTradeService] })
export class TrustTradeModule {}
