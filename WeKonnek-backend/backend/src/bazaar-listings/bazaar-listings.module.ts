import { Module } from '@nestjs/common';
import { BazaarListingsController } from './bazaar-listings.controller';
import { BazaarListingsService } from './bazaar-listings.service';
import { PaymentGatewayService } from '../modules/wallet/payment-gateway.service';

@Module({ controllers: [BazaarListingsController], providers: [BazaarListingsService, PaymentGatewayService] })
export class BazaarListingsModule {}
