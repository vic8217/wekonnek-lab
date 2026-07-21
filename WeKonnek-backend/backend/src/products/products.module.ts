import { Module } from '@nestjs/common';
import { ProductsService } from './products.service';
import { ProductsController } from './products.controller';
import { InventoryController } from './inventory.controller';
import { MerchantsModule } from '../merchants/merchants.module';

@Module({
  imports: [MerchantsModule],
  controllers: [ProductsController, InventoryController],
  providers: [ProductsService],
  exports: [ProductsService],
})
export class ProductsModule {}
