import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { WalletService } from './wallet.service';
import { WalletController } from './wallet.controller';
import { WalletAdminController } from './wallet-admin.controller';
import { WalletLedgerService } from './wallet-ledger.service';
import { PaymentGatewayService } from './payment-gateway.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { PaymentPartnersModule } from '../../payment-partners/payment-partners.module';

@Module({
  imports: [ConfigModule, NotificationsModule, PaymentPartnersModule],
  controllers: [WalletController, WalletAdminController],
  providers: [WalletService, WalletLedgerService, PaymentGatewayService],
  exports: [WalletService, WalletLedgerService, PaymentGatewayService],
})
export class WalletModule {}
