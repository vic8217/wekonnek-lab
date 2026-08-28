import { Module } from '@nestjs/common';
import { MerchantsModule } from '../merchants/merchants.module';
import { ProductStudioController } from './product-studio.controller';
import { ProductStudioService } from './product-studio.service';

@Module({ imports: [MerchantsModule], controllers: [ProductStudioController], providers: [ProductStudioService] })
export class ProductStudioModule {}
