import { Module } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { OrdersController } from './orders.controller';
import { UsersModule } from '../users/users.module';
import { StoresModule } from '../stores/stores.module';
import { ZonesModule } from '../zones/zones.module';
import { InvoicesModule } from '../invoices/invoices.module';
import { VouchersModule } from '../vouchers/vouchers.module';
import { LoyaltyModule } from '../loyalty/loyalty.module';

@Module({
  imports: [
    UsersModule,
    StoresModule,
    ZonesModule,
    InvoicesModule,
    VouchersModule,
    LoyaltyModule,
  ],
  controllers: [OrdersController],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}
