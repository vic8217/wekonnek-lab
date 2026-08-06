import { Module } from '@nestjs/common';
import { MerchantCategoriesController } from './merchant-categories.controller';
import { MerchantCategoriesService } from './merchant-categories.service';

@Module({ controllers: [MerchantCategoriesController], providers: [MerchantCategoriesService], exports: [MerchantCategoriesService] })
export class MerchantCategoriesModule {}
