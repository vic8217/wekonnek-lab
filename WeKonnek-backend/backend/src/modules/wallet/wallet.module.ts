import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { WalletService } from './wallet.service';
import { WalletController } from './wallet.controller';
import { PaymentGatewayService } from './payment-gateway.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { PaymentPartnersModule } from '../../payment-partners/payment-partners.module';

@Module({
  imports: [ConfigModule, NotificationsModule, PaymentPartnersModule],
  controllers: [WalletController],
  providers: [WalletService, PaymentGatewayService],
  exports: [WalletService, PaymentGatewayService],
})
export class WalletModule {}
