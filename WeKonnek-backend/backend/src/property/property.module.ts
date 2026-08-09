import { Module } from '@nestjs/common';
import { PropertyController } from './property.controller';
import { PropertyService } from './property.service';
import { WalletModule } from '../modules/wallet/wallet.module';

@Module({ imports: [WalletModule], controllers: [PropertyController], providers: [PropertyService] })
export class PropertyModule {}
