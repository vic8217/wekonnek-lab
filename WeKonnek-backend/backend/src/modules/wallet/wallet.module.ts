import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { WalletService } from './wallet.service';
import { WalletController } from './wallet.controller';
import { PaymentGatewayService } from './payment-gateway.service';

@Module({
  imports: [ConfigModule],
  controllers: [WalletController],
  providers: [WalletService, PaymentGatewayService],
  exports: [WalletService, PaymentGatewayService],
})
export class WalletModule {}
