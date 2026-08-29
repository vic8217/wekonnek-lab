import { Module } from '@nestjs/common';
import { MarketplaceOrdersModule } from '../orders/orders.module';
import { MerchantsModule } from '../merchants/merchants.module';
import { RfqController } from './rfq.controller';
import { RfqService } from './rfq.service';

@Module({ imports: [MarketplaceOrdersModule, MerchantsModule], controllers: [RfqController], providers: [RfqService] })
export class RfqModule {}
