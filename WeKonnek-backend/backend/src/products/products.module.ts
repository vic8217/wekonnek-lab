import { Module } from '@nestjs/common';
import { ProductsService } from './products.service';
import { ProductsController } from './products.controller';
import { InventoryController } from './inventory.controller';
import { MerchantsModule } from '../merchants/merchants.module';
import { ShopInventoryService } from './shop-inventory.service';

@Module({
  imports: [MerchantsModule],
  controllers: [ProductsController, InventoryController],
  providers: [ProductsService, ShopInventoryService],
  exports: [ProductsService, ShopInventoryService],
})
export class ProductsModule {}
