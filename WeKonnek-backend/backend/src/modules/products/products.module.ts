import { Module } from '@nestjs/common';
import { StoreProductsService } from './products.service';
import { StoreProductsController } from './products.controller';

@Module({
  controllers: [StoreProductsController],
  providers: [StoreProductsService],
  exports: [StoreProductsService],
})
export class StoreProductsModule {}
