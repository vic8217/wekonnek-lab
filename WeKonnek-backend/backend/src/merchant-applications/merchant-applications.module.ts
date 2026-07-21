import { Module } from '@nestjs/common';
import { MerchantApplicationsService } from './merchant-applications.service';
import { MerchantApplicationsController } from './merchant-applications.controller';

@Module({
  controllers: [MerchantApplicationsController],
  providers: [MerchantApplicationsService],
  exports: [MerchantApplicationsService],
})
export class MerchantApplicationsModule {}
